const fs = require("node:fs");
const path = require("node:path");
const { atomicJson, readJson, taskDir, assertSchemaVersion, SchemaValidationError } = require("./coordination");

// Pending points of one task: obligations of the request, unanswered decisions, and checks still missing,
// kept across rounds in `data/tasks/<id>/attention.json`.
// The Foreman session is the only writer, through the CLI under the home lock; the file leaves with the task.
// Points are never deleted while the task lives, so a closed point keeps a later report from raising it again.

const OWNERS = ["user", "worker"];
const KINDS = ["decision", "obligation", "check"];
const RESOLUTIONS = ["answered", "verified", "dropped", "limit-accepted"];
const KIND_ORDER = { decision: 0, obligation: 1, check: 2 };

function attentionFile(home, taskId) { return path.join(taskDir(home, taskId), "attention.json"); }

function validateAttention(record, taskId) {
  assertSchemaVersion(record, "Attention", { field: "taskId", value: taskId });
  if (!Array.isArray(record.points)) throw new SchemaValidationError(`Attention points are invalid: ${taskId}`);
  for (const point of record.points) {
    if (!/^P\d+$/.test(String(point.id)) || !OWNERS.includes(point.owner) || !KINDS.includes(point.kind) || typeof point.text !== "string" || !["open", "resolved"].includes(point.status)) {
      throw new SchemaValidationError(`Attention point is invalid: ${taskId} ${point.id}`);
    }
  }
  return record;
}

function readAttention(home, taskId) {
  const file = attentionFile(home, taskId);
  if (!fs.existsSync(file)) return { schemaVersion: 1, taskId, points: [] };
  return validateAttention(readJson(file), taskId);
}

function writeAttentionUnlocked(home, record) { atomicJson(attentionFile(home, record.taskId), validateAttention(record, record.taskId)); }

// The same words, ignoring case, spacing, and trailing punctuation, are the same point.
function normalized(text) { return String(text).toLowerCase().replace(/\s+/g, " ").replace(/[.!?。]+$/u, "").trim(); }

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new SchemaValidationError(`${label} must not be empty`);
  return value.trim();
}

function findPoint(record, pointId) {
  const point = record.points.find((item) => item.id === pointId);
  if (!point) throw new SchemaValidationError(`Unknown attention point ${pointId} on ${record.taskId}`);
  return point;
}

function addPointUnlocked({ home, meta, owner, kind, text, action, source, at }) {
  if (!OWNERS.includes(owner)) throw new SchemaValidationError(`Attention owner must be one of: ${OWNERS.join(", ")}`);
  if (!KINDS.includes(kind)) throw new SchemaValidationError(`Attention kind must be one of: ${KINDS.join(", ")}`);
  const record = readAttention(home, meta.taskId);
  const words = requireText(text, "Attention text");
  const same = record.points.find((point) => normalized(point.text) === normalized(words));
  if (same) {
    const hint = same.status === "open" ? "it is still open" : `it was ${same.resolution?.how || "resolved"}; reopen it with a reason only if new evidence or a new request changed it`;
    throw new SchemaValidationError(`${meta.taskId} already has ${same.id} "${same.text}": ${hint}`);
  }
  const point = {
    id: `P${record.points.length + 1}`, owner, kind, text: words, action: action ? requireText(action, "Attention action") : null,
    source: { ...source, round: source?.round || meta.round || 1, generation: meta.generation }, status: "open",
    createdAt: at, updatedAt: at, snoozedUntil: null, resolution: null, history: [],
  };
  writeAttentionUnlocked(home, { ...record, points: [...record.points, point] });
  return { taskId: meta.taskId, point };
}

function updatePointUnlocked(home, taskId, pointId, change) {
  const record = readAttention(home, taskId);
  const point = findPoint(record, pointId);
  const next = change(point);
  writeAttentionUnlocked(home, { ...record, points: record.points.map((item) => (item.id === pointId ? next : item)) });
  return { taskId, point: next };
}

// A resolution names how the point closed and keeps the user's words or the evidence that closed it.
function resolvePointUnlocked({ home, taskId, pointId, how, text, source, at }) {
  if (!RESOLUTIONS.includes(how)) throw new SchemaValidationError(`Attention resolution must be one of: ${RESOLUTIONS.join(", ")}`);
  const words = requireText(text, "Resolution text");
  return updatePointUnlocked(home, taskId, pointId, (point) => {
    if (point.status !== "open") throw new SchemaValidationError(`${taskId} ${pointId} is already ${point.resolution?.how || point.status}`);
    return { ...point, status: "resolved", snoozedUntil: null, resolution: { how, text: words, source: source || null, at }, updatedAt: at };
  });
}

function snoozePointUnlocked({ home, taskId, pointId, until, at }) {
  if (!Number.isFinite(Date.parse(until))) throw new SchemaValidationError(`Snooze time is invalid: ${until}`);
  return updatePointUnlocked(home, taskId, pointId, (point) => {
    if (point.status !== "open") throw new SchemaValidationError(`${taskId} ${pointId} is closed; only an open point can be snoozed`);
    return { ...point, snoozedUntil: new Date(until).toISOString(), updatedAt: at };
  });
}

// Reopening keeps the earlier resolution in history and states what changed.
function reopenPointUnlocked({ home, taskId, pointId, why, at }) {
  const reason = requireText(why, "Reopen reason");
  return updatePointUnlocked(home, taskId, pointId, (point) => {
    if (point.status === "open") throw new SchemaValidationError(`${taskId} ${pointId} is already open`);
    return { ...point, status: "open", resolution: null, history: [...point.history, { resolution: point.resolution, reopenedAt: at, why: reason }], updatedAt: at };
  });
}

// "tomorrow" is the start of the next local day; anything else must be a parseable time.
function snoozeUntil(value, at = new Date()) {
  if (String(value).trim().toLowerCase() === "tomorrow") {
    const next = new Date(at);
    next.setHours(24, 0, 0, 0);
    return next.toISOString();
  }
  return value;
}

/**
 * Reviews every task that has not ended, on every project: the open points that are not snoozed,
 * ordered user before worker, decision before obligation before check, oldest first.
 * The limit applies only to the highlight; every task is read.
 */
function reviewAttention({ home, metas, projects, at, limit = 3 }) {
  const time = Date.parse(at);
  const names = new Map((projects || []).map((project) => [project.id, project.name || project.id]));
  const open = [];
  let snoozed = 0;
  let tasksRead = 0;
  const skipped = [];
  for (const meta of metas) {
    if (["accepted", "cleaned"].includes(meta.status)) continue;
    tasksRead += 1;
    let record;
    try { record = readAttention(home, meta.taskId); } catch (error) { skipped.push({ taskId: meta.taskId, reason: error.message }); continue; }
    for (const point of record.points) {
      if (point.status !== "open") continue;
      if (point.snoozedUntil && Date.parse(point.snoozedUntil) > time) { snoozed += 1; continue; }
      open.push({ ...point, taskId: meta.taskId, projectId: meta.projectId, projectName: names.get(meta.projectId) || meta.projectId, taskStatus: meta.status });
    }
  }
  open.sort((left, right) => (left.owner === right.owner ? 0 : left.owner === "user" ? -1 : 1) || KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return { reviewedAt: at, tasksRead, open: open.length, user: open.filter((point) => point.owner === "user").length, worker: open.filter((point) => point.owner === "worker").length, snoozed, highlight: open.slice(0, limit), remaining: Math.max(0, open.length - limit), points: open, skipped };
}

function renderAttention(review) {
  if (!review.open) {
    const lines = ["Không còn điểm treo nào cần nhắc."];
    if (review.snoozed) lines.push(`(${review.snoozed} điểm đang hoãn nhắc.)`);
    return `${lines.join("\n")}\n`;
  }
  const lines = ["---", "", `> **📌 CÒN TREO · ${review.open} điểm cần chú ý**`];
  for (const point of review.highlight) {
    const who = point.owner === "user" ? "cần bạn" : "chờ worker";
    const action = point.action ? ` ${point.action}` : "";
    lines.push(">", `> **${point.projectName} · ${point.taskId}:** ${point.text.replace(/[.。]$/u, "")}${action ? ` —${action.replace(/[.。]$/u, "")}` : ""} — còn từ vòng ${point.source.round} · ${who}.`);
  }
  const tail = [];
  if (review.remaining) tail.push(`còn ${review.remaining} điểm khác`);
  if (review.snoozed) tail.push(`${review.snoozed} điểm đang hoãn`);
  if (tail.length) lines.push(">", `> _${tail.join("; ")}._`);
  lines.push("", "---");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  OWNERS, KINDS, RESOLUTIONS,
  attentionFile, readAttention, addPointUnlocked, resolvePointUnlocked, snoozePointUnlocked, reopenPointUnlocked, snoozeUntil, reviewAttention, renderAttention,
};
