const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Token usage of the worker sessions Foreman recorded, read from their Claude Code transcripts.
// Only Paseo workers on the Claude provider are counted; nothing is estimated or priced.
// A transcript is parsed again only when its size or modification time changes.

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const parsed = new Map();

function listDir(dir) { try { return fs.readdirSync(dir); } catch (_) { return []; } }
function claudeProjectsDir(env) { return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects"); }

// The session's own transcript and those of the subagents it started; a session ID that could leave the directory finds nothing.
function transcriptFiles(projectsDir, sessionId) {
  if (!SESSION_ID.test(sessionId)) return [];
  const files = [];
  for (const project of listDir(projectsDir)) {
    const main = path.join(projectsDir, project, `${sessionId}.jsonl`);
    if (!fs.existsSync(main)) continue;
    files.push(main);
    const subagents = path.join(projectsDir, project, sessionId, "subagents");
    for (const name of listDir(subagents).filter((entry) => entry.endsWith(".jsonl")).sort()) files.push(path.join(subagents, name));
  }
  return files;
}

/** The model calls of one transcript, oldest first; a response the transcript repeats once per content block counts once. */
function transcriptCalls(file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return []; }
  const known = parsed.get(file);
  if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.calls;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (_) { return []; }
  const byId = new Map();
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let row;
    try { row = JSON.parse(line); } catch (_) { continue; }
    const message = row.type === "assistant" ? row.message : null;
    const usage = message?.usage;
    const at = Date.parse(row.timestamp);
    if (!usage || message.model === "<synthetic>" || !Number.isFinite(at)) continue;
    const call = {
      at,
      input: usage.input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      output: usage.output_tokens || 0,
    };
    const id = message.id || row.requestId || row.uuid;
    const previous = byId.get(id);
    byId.set(id, previous ? { ...call, at: previous.at, output: Math.max(previous.output, call.output) } : call);
  }
  const calls = [...byId.values()].sort((left, right) => left.at - right.at);
  parsed.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, calls });
  return calls;
}

function emptyTotals() { return { tokens: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }; }
function addCall(totals, call) {
  totals.input += call.input;
  totals.cacheWrite += call.cacheWrite;
  totals.cacheRead += call.cacheRead;
  totals.output += call.output;
  totals.tokens += call.input + call.cacheWrite + call.cacheRead + call.output;
}
// Cache read over every input-side token, in percent, or null with no input.
function cacheHit(totals) {
  const input = totals.input + totals.cacheWrite + totals.cacheRead;
  return input ? Math.round((totals.cacheRead / input) * 1000) / 10 : null;
}
function startOfLocalDay(time) { const day = new Date(time); day.setHours(0, 0, 0, 0); return day.getTime(); }

function ranked(map) {
  return [...map.entries()].map(([key, totals]) => ({ key, tokens: totals.tokens })).filter((row) => row.tokens > 0).sort((left, right) => right.tokens - left.tokens);
}

/**
 * Usage over the last WINDOW_DAYS local days including today, for sessions `{ taskId, projectId, profile, provider, sessionId }`.
 * Days hold every day of the window, oldest first; a figure without a counted model call is null.
 */
function tokenUsage({ sessions, now = Date.now(), env = process.env }) {
  const today = startOfLocalDay(now);
  const days = Array.from({ length: WINDOW_DAYS }, (_, index) => startOfLocalDay(today - (WINDOW_DAYS - 1 - index) * DAY_MS + DAY_MS / 2));
  const start = days[0];
  const projectsDir = claudeProjectsDir(env);
  const total = emptyTotals();
  const perDay = days.map(() => emptyTotals());
  const byTask = new Map();
  const byProject = new Map();
  const byProfile = new Map();
  const resends = [];
  const coverage = { recorded: sessions.length, counted: 0, missing: 0, otherProvider: 0 };
  const seen = new Set();
  const files = new Set();
  let calls = 0;
  for (const session of sessions) {
    if (seen.has(session.sessionId)) continue;
    seen.add(session.sessionId);
    if (session.provider !== "claude") { coverage.otherProvider += 1; continue; }
    const transcripts = transcriptFiles(projectsDir, session.sessionId);
    if (!transcripts.length) { coverage.missing += 1; continue; }
    coverage.counted += 1;
    for (const file of transcripts) {
      files.add(file);
      transcriptCalls(file).forEach((call, index) => {
        if (call.at < start || call.at > now + DAY_MS) return;
        calls += 1;
        addCall(total, call);
        const day = days.findLastIndex((dayStart) => call.at >= dayStart);
        addCall(perDay[day], call);
        for (const [map, key] of [[byTask, session.taskId], [byProject, session.projectId], [byProfile, session.profile || "—"]]) {
          if (!map.has(key)) map.set(key, emptyTotals());
          addCall(map.get(key), call);
        }
        if (index > 0 && call.cacheWrite > call.cacheRead) resends.push({ taskId: session.taskId, projectId: session.projectId, at: call.at, tokens: call.cacheWrite, cacheRead: call.cacheRead });
      });
    }
  }
  for (const file of parsed.keys()) if (!files.has(file)) parsed.delete(file);
  const taskProject = new Map(sessions.map((session) => [session.taskId, session.projectId]));
  return {
    windowStart: start,
    windowDays: WINDOW_DAYS,
    calls,
    coverage,
    total: calls ? { ...total, hit: cacheHit(total) } : null,
    days: days.map((dayStart, index) => ({ at: dayStart, tokens: perDay[index].tokens, hit: cacheHit(perDay[index]) })),
    byTask: ranked(byTask).map(({ key, tokens }) => ({ taskId: key, projectId: taskProject.get(key) || null, tokens })),
    byProject: ranked(byProject).map(({ key, tokens }) => ({ projectId: key, tokens })),
    byProfile: ranked(byProfile).map(({ key, tokens }) => ({ profile: key, tokens })),
    resends: resends.sort((left, right) => right.at - left.at),
  };
}

module.exports = { WINDOW_DAYS, tokenUsage, transcriptCalls };
