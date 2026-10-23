const fs = require("node:fs");
const path = require("node:path");
const { taskDir, coordinationDirs, listRounds, readJson, atomicWrite } = require("./coordination");

// Ended-task history: one metadata line per accepted or discarded task in `data/task-history.jsonl`.
// The Foreman CLI is its only writer, under the home lock, just before acceptance or discard deletes the task records.
// It keeps identities, outcomes, and timestamps only; the user's words, reports, and decisions leave with the task.
// Lines older than the retention window are dropped when a new line is written.

const DEFAULT_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function historyFile(home) { return path.join(home, "data", "task-history.jsonl"); }

function retentionDays(env = process.env) {
  const days = Number(env.FOREMAN_HISTORY_RETENTION_DAYS);
  return Number.isInteger(days) && days >= 1 ? days : DEFAULT_RETENTION_DAYS;
}

function readOptionalJson(file) {
  try { return readJson(file); } catch (_) { return null; }
}

function reportEvents(dir) {
  const reportsDir = path.join(dir, "reports");
  if (!fs.existsSync(reportsDir)) return [];
  return fs.readdirSync(reportsDir).filter((name) => name.endsWith(".md")).flatMap((name) => {
    const header = fs.readFileSync(path.join(reportsDir, name), "utf8").split(/\r?\n\r?\n/, 1)[0];
    const at = header.match(/^REPORTED_AT: (.+)$/m)?.[1];
    const status = header.match(/^STATUS: (.+)$/m)?.[1];
    if (!at || !status) return [];
    return [{ type: "report", at, status, round: Number(header.match(/^ROUND: (\d+)$/m)?.[1] || 1), generation: Number(header.match(/^GENERATION: (\d+)$/m)?.[1] || 0) }];
  });
}

// Each assignment generation starts with its task-brief message, which names the worker, its profile, and, for a replacement,
// the handoff and why the previous worker was replaced (`dead`, `missing`, or `human-reassign`).
function dispatchEvents(home, taskId) {
  const dir = coordinationDirs(home).messages;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith(`M-${taskId}-`) && name.endsWith(".json")).flatMap((name) => {
    const message = readOptionalJson(path.join(dir, name));
    if (!message || message.taskId !== taskId || message.kind !== "task-brief" || message.status !== "delivered") return [];
    return [{ type: "dispatch", at: message.deliveredAt || message.createdAt, generation: message.generation, owner: message.worker, profile: message.payload?.dispatchProfile?.name || null, replaced: message.payload?.handoff?.reason || null, handoffId: message.payload?.handoff?.handoffId || null }];
  });
}

function decisionEvents(dir) {
  const decisionsDir = path.join(dir, "decisions");
  if (!fs.existsSync(decisionsDir)) return [];
  return fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).flatMap((name) => {
    const decision = readOptionalJson(path.join(decisionsDir, name));
    if (!decision?.createdAt) return [];
    return [{ type: "decision", at: decision.createdAt, decisionId: decision.decisionId, generation: decision.generation, answeredAt: decision.answeredAt || null, deliveredAt: decision.deliveredAt || null, supersededAt: decision.supersededAt || null }];
  });
}

/**
 * The timestamps of one live task, oldest first: creation, each worker dispatch or adoption, each later round the user asked for,
 * each worker report, and each decision with when it was answered and delivered.
 */
function taskTimeline(home, meta) {
  const dir = taskDir(home, meta.taskId);
  // Tasks adopted before `adoption` was recorded still carry the adopted worker in `adoptedAt`, `owner`, and `generation`.
  const adoption = meta.adoption || (meta.adoptedAt ? { at: meta.adoptedAt, owner: meta.owner, generation: meta.generation } : null);
  const rounds = listRounds({ roots: { foremanHome: home }, taskId: meta.taskId, statuses: ["delivered"] })
    .map((round) => ({ type: "round", at: round.createdAt, round: round.round, generation: round.generation, mode: round.mode || null, deliveredAt: round.deliveredAt || null }));
  const events = [
    ...(meta.createdAt ? [{ type: "created", at: meta.createdAt }] : []),
    ...dispatchEvents(home, meta.taskId),
    ...(adoption ? [{ type: "adopted", at: adoption.at, generation: adoption.generation, owner: adoption.owner }] : []),
    ...rounds,
    ...reportEvents(dir),
    ...decisionEvents(dir),
  ].filter((event) => event.at);
  // Times are compared as instants; one that does not parse sorts last instead of being dropped.
  const time = (event) => { const ms = Date.parse(event.at); return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER; };
  return events.sort((left, right) => time(left) - time(right));
}

function historyRecord({ home, meta, outcome, at }) {
  const events = taskTimeline(home, meta);
  return {
    schemaVersion: 1,
    taskId: meta.taskId,
    projectId: meta.projectId,
    type: meta.type || "ship",
    backend: meta.backend || "herdr",
    outcome,
    createdAt: meta.createdAt || null,
    endedAt: at,
    round: meta.round || 1,
    generation: meta.generation || 0,
    recoveryAttempts: meta.recoveryAttempts || 0,
    // A reassignment whose first dispatch failed is dispatched again with the same handoff, so it counts once.
    reassignments: new Set(events.filter((event) => event.type === "dispatch" && event.replaced === "human-reassign").map((event) => event.handoffId)).size,
    reviewLoad: meta.reviewLoad || null,
    workerSessions: meta.workerSessions || [],
    events: [...events, { type: outcome, at }],
  };
}

// A line that is not a version-1 history record is skipped and reported, never rewritten.
function parseHistory(text) {
  const records = [];
  const skipped = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let record;
    try { record = JSON.parse(line); } catch (_) { record = null; }
    if (!record || record.schemaVersion !== 1 || typeof record.taskId !== "string" || typeof record.endedAt !== "string") skipped.push({ line: index + 1, raw: line });
    else records.push({ record, raw: line });
  });
  return { records, skipped };
}

function readHistory(home) {
  const file = historyFile(home);
  if (!fs.existsSync(file)) return { records: [], skipped: [] };
  const { records, skipped } = parseHistory(fs.readFileSync(file, "utf8"));
  return { records: records.map((item) => item.record), skipped: skipped.map(({ line }) => ({ line })) };
}

/**
 * Appends one ended task. A task already in the history is not written twice, so an interrupted acceptance can be retried.
 * Records past the retention window are dropped by rewriting the file atomically; unreadable lines are kept as they are.
 */
function appendHistoryUnlocked({ home, record, days = retentionDays() }) {
  const file = historyFile(home);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const { records, skipped } = parseHistory(text);
  if (records.some((item) => item.record.taskId === record.taskId)) return { appended: false, pruned: 0 };
  const cutoff = Date.parse(record.endedAt) - days * DAY_MS;
  const kept = records.filter((item) => !(Date.parse(item.record.endedAt) < cutoff));
  const line = JSON.stringify(record);
  if (kept.length !== records.length) {
    const keptLines = new Set([...kept.map((item) => item.raw), ...skipped.map((item) => item.raw)]);
    const lines = text.split("\n").filter((raw) => raw.trim() && keptLines.has(raw));
    atomicWrite(file, `${[...lines, line].join("\n")}\n`);
    return { appended: true, pruned: records.length - kept.length };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a", 0o600);
  try {
    // A line cut short by a crash stays on its own line instead of corrupting the next record.
    fs.writeSync(fd, `${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  return { appended: true, pruned: 0 };
}

module.exports = { DEFAULT_RETENTION_DAYS, historyFile, retentionDays, taskTimeline, historyRecord, readHistory, appendHistoryUnlocked };
