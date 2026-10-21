const fs = require("node:fs");
const path = require("node:path");
const { metaFile, readJson, validateTaskMetaRecord } = require("./coordination");
const history = require("./history");

// Where a task's time went over a window: how long the user took to answer, and how long tasks waited on the user
// compared with the worker. Read-only: it reads task records and the ended-task history and writes nothing.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `7d`, `24h`, or an ISO date or time; the default is the last seven days. */
function parseSince(value, nowMs) {
  if (value === undefined || value === null || value === "") return nowMs - 7 * DAY_MS;
  const relative = /^(\d+)([hd])$/.exec(String(value).trim());
  if (relative) return nowMs - Number(relative[1]) * (relative[2] === "d" ? DAY_MS : HOUR_MS);
  const absolute = Date.parse(value);
  if (!Number.isFinite(absolute)) throw new Error(`--since must look like 7d, 24h, or an ISO date: ${value}`);
  return absolute;
}

// Each event moves the task to the side it now waits on; `end` closes the task.
function transitions(events) {
  const steps = [];
  for (const event of events) {
    if (event.type === "dispatch" || event.type === "adopted" || event.type === "round") steps.push({ at: event.at, side: "worker" });
    else if (event.type === "report") steps.push({ at: event.at, side: event.status === "progress" ? "worker" : "user" });
    else if (event.type === "decision") {
      steps.push({ at: event.at, side: "user" });
      if (event.answeredAt) steps.push({ at: event.answeredAt, side: "worker" });
    } else if (event.type === "accepted" || event.type === "discarded") steps.push({ at: event.at, side: "end" });
  }
  return steps.sort((left, right) => left.at.localeCompare(right.at));
}

// Time on each side, clipped to the window; a task still open counts up to now.
function waitingTime(events, sinceMs, nowMs) {
  const totals = { user: 0, worker: 0 };
  const steps = transitions(events);
  steps.forEach((step, index) => {
    if (step.side === "end") return;
    const start = Math.max(Date.parse(step.at), sinceMs);
    const end = Math.min(index + 1 < steps.length ? Date.parse(steps[index + 1].at) : nowMs, nowMs);
    if (end > start) totals[step.side] += end - start;
  });
  return totals;
}

// One sample per user answer that landed in the window: a decision answered, a blocked report followed by the next
// round, or a done report followed by the next round or acceptance.
function responseSamples(events, sinceMs, nowMs) {
  const samples = [];
  const answer = (index) => events.slice(index + 1).find((event) => ["round", "accepted", "discarded"].includes(event.type));
  events.forEach((event, index) => {
    if (event.type === "decision" && event.answeredAt) samples.push({ kind: "decision", from: event.at, to: event.answeredAt });
    if (event.type === "report" && (event.status === "blocked" || event.status === "done")) {
      const next = answer(index);
      if (next && next.type !== "discarded") samples.push({ kind: event.status === "blocked" ? "blocked" : "review", from: event.at, to: next.at });
    }
  });
  return samples.filter((sample) => {
    const to = Date.parse(sample.to);
    return to >= sinceMs && to <= nowMs;
  }).map((sample) => ({ kind: sample.kind, ms: Date.parse(sample.to) - Date.parse(sample.from) }));
}

function liveTasks(home) {
  const root = path.join(home, "data", "tasks");
  if (!fs.existsSync(root)) return { tasks: [], skipped: [] };
  const tasks = [];
  const skipped = [];
  for (const id of fs.readdirSync(root).sort()) {
    try {
      const meta = validateTaskMetaRecord(readJson(metaFile(home, id)), id);
      if (["accepted", "cleaned"].includes(meta.status)) continue;
      tasks.push({ taskId: id, events: history.taskTimeline(home, meta) });
    } catch (error) {
      skipped.push({ taskId: id, error: error.message });
    }
  }
  return { tasks, skipped };
}

function average(values) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }

/** Response times and waiting time for tasks active in the window, from the ended-task history and live task records. */
function fleetStats({ home, since, now = new Date() }) {
  const nowMs = now.getTime();
  const sinceMs = parseSince(since, nowMs);
  const ended = history.readHistory(home);
  const live = liveTasks(home);
  const endedInWindow = ended.records.filter((record) => Date.parse(record.endedAt) >= sinceMs);
  const tasks = [...endedInWindow.map((record) => ({ taskId: record.taskId, events: record.events || [] })), ...live.tasks];
  const samples = tasks.flatMap((task) => responseSamples(task.events, sinceMs, nowMs));
  const waiting = tasks.reduce((sum, task) => {
    const totals = waitingTime(task.events, sinceMs, nowMs);
    return { user: sum.user + totals.user, worker: sum.worker + totals.worker };
  }, { user: 0, worker: 0 });
  const response = Object.fromEntries(["decision", "blocked", "review"].map((kind) => {
    const values = samples.filter((sample) => sample.kind === kind).map((sample) => sample.ms);
    return [kind, { count: values.length, averageMs: average(values) }];
  }));
  return {
    since: new Date(sinceMs).toISOString(),
    until: now.toISOString(),
    ended: { accepted: endedInWindow.filter((record) => record.outcome === "accepted").length, discarded: endedInWindow.filter((record) => record.outcome === "discarded").length },
    response,
    waiting: { userMs: waiting.user, workerMs: waiting.worker },
    sources: { endedTasks: endedInWindow.length, liveTasks: live.tasks.length, historyFile: fs.existsSync(history.historyFile(home)) },
    skipped: { historyLines: ended.skipped, tasks: live.skipped },
  };
}

function duration(ms) {
  if (ms === null) return "—";
  if (ms < 60 * 1000) return "dưới 1 phút";
  if (ms < HOUR_MS) return `${Math.round(ms / 60000)} phút`;
  if (ms < 2 * DAY_MS) return `${(ms / HOUR_MS).toFixed(1).replace(".", ",")} giờ`;
  return `${(ms / DAY_MS).toFixed(1).replace(".", ",")} ngày`;
}

const RESPONSE_LABELS = { decision: "Trả lời decision", blocked: "Gỡ task bị chặn", review: "Duyệt kết quả (accept hoặc vòng mới)" };

function renderStats(stats) {
  const day = (iso) => iso.slice(0, 10);
  const lines = [`### Thống kê ${day(stats.since)} → ${day(stats.until)}`, ""];
  lines.push(`Task kết thúc: ${stats.ended.accepted} accept · ${stats.ended.discarded} discard`, "");
  lines.push("Thời gian bạn phản hồi (trung bình · số lần):");
  for (const [kind, label] of Object.entries(RESPONSE_LABELS)) lines.push(`- ${label}: ${duration(stats.response[kind].averageMs)} · ${stats.response[kind].count}`);
  const total = stats.waiting.userMs + stats.waiting.workerMs;
  lines.push("");
  if (total) {
    const userShare = Math.round((stats.waiting.userMs / total) * 100);
    lines.push(`Thời gian task: chờ bạn ${userShare}% (${duration(stats.waiting.userMs)}) · chờ worker ${100 - userShare}% (${duration(stats.waiting.workerMs)})`);
  } else lines.push("Thời gian task: chưa có dữ liệu trong khoảng này");
  const notes = [`${stats.sources.endedTasks} task đã kết thúc`, `${stats.sources.liveTasks} task đang mở`];
  if (!stats.sources.historyFile) notes.push("chưa có lịch sử task đã kết thúc");
  if (stats.skipped.historyLines.length) notes.push(`bỏ qua ${stats.skipped.historyLines.length} dòng lịch sử không đọc được`);
  if (stats.skipped.tasks.length) notes.push(`bỏ qua ${stats.skipped.tasks.length} task không đọc được`);
  lines.push("", `_Nguồn: ${notes.join(" · ")}._`);
  return `${lines.join("\n")}\n`;
}

module.exports = { parseSince, fleetStats, renderStats };
