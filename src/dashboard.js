const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./foreman");
const coordination = require("./coordination");
const attention = require("./attention");
const history = require("./history");
const supervision = require("./supervision");
const nextAction = require("./next-action");
const reviewLoad = require("./review-load");

// The web dashboard's view of the home: one snapshot of everything its screens show, built from `data/` without the home lock.
// Like `taskSummaries`, it never initializes the home, migrates a record, or calls a runtime; runtime evidence comes only
// from the last status check Foreman kept in `data/status-check.json`. A damaged record is skipped, never repaired.

const REPORT_CHARS = 20000;
const OUTBOX_LIMIT = 40;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LIVE = ["routing", "queued", "pending", "working", "blocked", "waiting-decision", "review-ready"];

const ms = (iso) => { const value = Date.parse(iso); return Number.isFinite(value) ? value : null; };
// The latest of ISO times and epoch milliseconds, or null when none is known.
function latest(values) {
  const times = values.map((value) => (typeof value === "number" ? value : ms(value))).filter((value) => value !== null);
  return times.length ? Math.max(...times) : null;
}
function readOptionalJson(file) { try { return coordination.readJson(file); } catch (_) { return null; } }
function readOptionalText(file) { try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; } }
function listDir(dir) { try { return fs.readdirSync(dir); } catch (_) { return []; } }
function firstLine(text) { return String(text || "").split(/\r?\n/).find((line) => line.trim())?.trim() || ""; }
function capped(text) { return text.length > REPORT_CHARS ? `${text.slice(0, REPORT_CHARS)}\n[…cắt bớt; đọc file report để xem đủ]` : text; }
function tilde(file) {
  const home = os.homedir();
  return file && home && (file === home || file.startsWith(`${home}${path.sep}`)) ? `~${file.slice(home.length)}` : file;
}

// The worker's "Next steps" list, kept apart from the rest of the summary.
function splitNextSteps(text) {
  const lines = text.split(/\r?\n/);
  let heading = -1;
  lines.forEach((line, index) => { if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?next steps(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i.test(line)) heading = index; });
  if (heading < 0) return { summary: text, steps: null };
  const steps = [];
  for (const line of lines.slice(heading + 1)) {
    const item = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (item) steps.push(item[1].trim());
    else if (line.trim() && steps.length) steps[steps.length - 1] += ` ${line.trim()}`;
  }
  return steps.length ? { summary: lines.slice(0, heading).join("\n").trim(), steps } : { summary: text, steps: null };
}

function readReport(file) {
  const text = readOptionalText(file);
  if (text === null) return null;
  const split = text.indexOf("\n\n");
  const header = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? "" : text.slice(split + 2);
  const field = (name) => header.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1] || null;
  const status = field("STATUS");
  const at = ms(field("REPORTED_AT"));
  if (!status || at === null) return null;
  // A Paseo report keeps the agent's raw JSON answer; its summary is what the worker wrote.
  const paseo = field("TURN") !== null ? core.parsePaseoReport(body) : null;
  const { summary, steps } = splitNextSteps((paseo ? paseo.summary : body).trim());
  return { status, at, round: Number(field("ROUND") || 1), generation: Number(field("GENERATION") || 0), summary: capped(summary), steps, file };
}

function taskReports(dir) {
  const reportsDir = path.join(dir, "reports");
  return listDir(reportsDir).filter((name) => name.endsWith(".md")).map((name) => readReport(path.join(reportsDir, name))).filter(Boolean).sort((left, right) => left.at - right.at);
}

// Rounds newest first. Round one is the brief and the user's own words; later rounds are the delivered round records.
function taskRounds(home, meta, reports) {
  const dir = coordination.taskDir(home, meta.taskId);
  const later = [];
  for (const name of listDir(path.join(dir, "rounds")).filter((entry) => /^round-\d+\.json$/.test(entry))) {
    try {
      const record = coordination.validateRoundRecord(readOptionalJson(path.join(dir, "rounds", name)), meta.taskId, Number(name.slice(6, -5)));
      if (record.status === "delivered") later.push(record);
    } catch (_) { /* a damaged round never hides the task */ }
  }
  const original = readOptionalText(path.join(dir, "original.md"));
  const brief = readOptionalText(path.join(dir, "brief.md")) || "";
  const distinct = (sent, said) => (said && sent.trim() === said.trim() ? null : sent);
  const rounds = [
    { round: 1, at: ms(meta.createdAt), original: original || null, sent: distinct(brief, original), mode: later.length ? null : meta.type, generation: null },
    ...later.map((record) => ({ round: record.round, at: ms(record.createdAt) ?? ms(record.deliveredAt), original: record.original || null, sent: distinct(record.sent, record.original), mode: record.mode || null, generation: record.generation ?? null })),
  ];
  return rounds.map((round) => ({ ...round, reports: reports.filter((report) => report.round === round.round).map(({ round: _, ...report }) => report) })).reverse();
}

// "A: text", "(B) text", "Phương án C - text" or a bare text; a bare option is keyed by its position.
function decisionOption(raw, index) {
  if (raw && typeof raw === "object") return { key: String(raw.key || LETTERS[index]), title: String(raw.title || raw.text || ""), impact: raw.impact || null };
  const text = String(raw);
  const match = text.match(/^\s*(?:(?:option|phương án)\s+)?\(?([A-Z]|\d{1,2})\)?\s*[).:\-–—]\s*([\s\S]+)$/i);
  return match && match[1].length <= 2 ? { key: match[1].toUpperCase(), title: match[2].trim(), impact: null } : { key: LETTERS[index], title: text, impact: null };
}

function recommendedKey(recommendation, options) {
  if (typeof recommendation !== "string" || !recommendation.trim() || recommendation === "none available") return null;
  const text = recommendation.trim();
  const byTitle = options.find((option) => option.title.trim().toLowerCase() === text.toLowerCase());
  if (byTitle) return byTitle.key;
  const lead = text.match(/^(?:(?:option|phương án)\s+)?\(?([A-Z]|\d{1,2})\)?(?![\p{L}\p{N}])/iu)?.[1]?.toUpperCase();
  return lead && options.some((option) => option.key === lead) ? lead : null;
}

function taskDecisions(dir) {
  const decisionsDir = path.join(dir, "decisions");
  const records = listDir(decisionsDir).filter((name) => name.endsWith(".json")).map((name) => readOptionalJson(path.join(decisionsDir, name)))
    .filter((record) => record?.schemaVersion === 1 && typeof record.decisionId === "string")
    .sort((left, right) => (ms(left.createdAt) || 0) - (ms(right.createdAt) || 0));
  return records.map((record, index) => {
    const options = (record.options || []).map(decisionOption);
    return {
      id: record.decisionId, label: `D-${index + 1}`, state: record.status, createdAt: ms(record.createdAt), answeredAt: ms(record.answeredAt), deliveredAt: ms(record.deliveredAt),
      finding: record.finding, why: record.whyHumanDecisionRequired || null, options, recommendation: recommendedKey(record.recommendation, options),
      recommendationText: record.recommendation === "none available" ? null : record.recommendation || null, impact: record.impact || null, evidence: record.evidence || null,
      answer: record.humanResponse || null, blocker: Boolean(record.blocker),
    };
  });
}

function taskPoints(home, taskId, now) {
  let record;
  try { record = attention.readAttention(home, taskId); } catch (_) { return { points: [], raw: [] }; }
  const points = record.points.map((point) => {
    const snoozed = point.status === "open" && ms(point.snoozedUntil) !== null && ms(point.snoozedUntil) > now;
    return {
      id: point.id, owner: point.owner, kind: point.kind, text: point.text, action: point.action || null,
      state: point.status === "open" ? (snoozed ? "snoozed" : "open") : point.resolution?.how || "answered",
      since: ms(point.createdAt), until: snoozed ? ms(point.snoozedUntil) : null, round: point.source?.round || null, closedHow: point.resolution?.text || null,
    };
  });
  return { points, raw: record.points };
}

function handoffView(dir) {
  const record = readOptionalJson(path.join(dir, "handoff.json"));
  if (!record || record.schemaVersion !== 1) return null;
  return { reason: record.reason || null, previousOwner: record.previousOwner || null, previousEndpoint: record.previousEndpoint || null, previousGeneration: record.previousGeneration ?? null, createdAt: ms(record.createdAt) };
}

// When the task entered its current status, from the timestamps Foreman records for each transition.
function statusSince(meta, decisions) {
  const active = decisions.find((decision) => decision.id === meta.decisionId);
  switch (meta.status) {
    case "review-ready": return latest([meta.completionAt, meta.lastReport?.at]);
    case "blocked": return latest([meta.blockerAt, meta.lastReport?.at]);
    case "waiting-decision": return active?.createdAt ?? latest([meta.lastReport?.at]);
    case "working": return latest([meta.lastPromptAt, meta.assignedAt]);
    case "pending": return latest([meta.lastPromptAt, meta.profileConfirmedAt, meta.routedAt]);
    case "queued": return latest([meta.profileConfirmedAt, meta.routedAt]);
    default: return null;
  }
}

function runtimeEvidence(meta, check) {
  const backend = meta.backend || "herdr";
  const entry = check.backends?.[backend] || {};
  const issues = [];
  let runtime = meta.endpoint ? null : "none";
  const observed = entry.tasks?.[meta.taskId];
  if (observed && observed.generation === meta.generation && (observed.endpoint || null) === (meta.endpoint || null) && meta.endpoint) {
    runtime = observed.state;
    for (const issue of observed.issues || []) issues.push({ ...issue, at: ms(entry.checkedAt) });
  }
  const collected = entry.collection?.[meta.taskId];
  if (collected?.issue && collected.generation === meta.generation) issues.push({ ...collected.issue, at: ms(entry.collectedAt) });
  if (meta.paseoReportError?.type) issues.push({ type: meta.paseoReportError.type, reason: meta.paseoReportError.reason || null, reportFile: meta.paseoReportError.file || null, at: ms(meta.paseoReportAt) });
  const seen = new Set();
  return { runtime, issues: issues.filter((issue) => !seen.has(issue.type) && seen.add(issue.type)) };
}

function taskView({ home, meta, check, messages, now }) {
  const dir = coordination.taskDir(home, meta.taskId);
  const reports = taskReports(dir);
  const rounds = taskRounds(home, meta, reports);
  const decisions = taskDecisions(dir);
  const { points, raw } = taskPoints(home, meta.taskId, now);
  const { runtime, issues } = runtimeEvidence(meta, check);
  const own = messages.filter((message) => message.taskId === meta.taskId);
  let proposal = null;
  if (meta.nextAction?.text) {
    let fresh = false;
    try { fresh = nextAction.staleReasons(meta.nextAction, meta, raw).length === 0; } catch (_) {}
    proposal = { kind: meta.nextAction.kind, text: meta.nextAction.text, at: ms(meta.nextAction.proposedAt), fresh };
  }
  const lastActivityAt = latest([meta.createdAt, meta.routedAt, meta.assignedAt, meta.lastPromptAt, meta.lastReport?.at, ...reports.map((report) => report.at), ...decisions.flatMap((decision) => [decision.answeredAt, decision.deliveredAt])]);
  return {
    taskId: meta.taskId, projectId: meta.projectId, type: meta.type, status: meta.status, round: meta.round || 1, generation: meta.generation,
    backend: meta.backend || "herdr", endpoint: meta.endpoint || null, owner: meta.owner || null,
    profile: meta.dispatchProfile?.name || null, routingProfile: meta.routingProfile || null, routingNote: meta.routingReason || null,
    needsProfileConfirmation: Boolean(meta.routingProfile) && !meta.profileConfirmedAt && !meta.endpoint,
    title: firstLine(readOptionalText(path.join(dir, "brief.md"))) || meta.taskId,
    createdAt: ms(meta.createdAt), dispatchedAt: ms(meta.assignedAt) ?? ms(meta.adoption?.at || meta.adoptedAt), statusSince: statusSince(meta, decisions) ?? ms(meta.createdAt), lastActivityAt: lastActivityAt ?? ms(meta.createdAt),
    runtime, issues, workspace: meta.workspace || null, branch: meta.branch || null,
    lease: (meta.resourceLease?.resources || []).map(({ key, mode }) => ({ key, mode })), dependencies: meta.dependencies || [],
    handoff: handoffView(dir), rounds, decisions, attention: points, messages: own,
    unread: Boolean(meta.lastReport && !meta.lastReport.readAt), reviewSize: meta.status === "review-ready" ? reviewLoad.formatReviewLoad(meta.reviewLoad, "vi") : null,
    nextAction: proposal,
  };
}

// Each claim lists the other live tasks whose claims overlap it in a conflicting mode, by the same rule dispatch applies.
function markLeaseOverlaps(tasks) {
  const claims = tasks.flatMap((task) => task.lease.map((claim) => ({ task, claim })));
  for (const { task, claim } of claims) {
    claim.overlaps = [...new Set(claims.filter((other) => other.task !== task && core.resourceOverlaps(claim.key, other.claim.key) && core.resourceModesConflict(claim.mode, other.claim.mode)).map((other) => other.task.taskId))];
  }
  for (const task of tasks) {
    const ids = [...new Set(task.lease.flatMap((claim) => claim.overlaps))];
    task.leaseOverlap = ids.length ? ids.join(", ") : null;
  }
}

function readMessages(home) {
  const dir = coordination.coordinationDirs(home).messages;
  return listDir(dir).filter((name) => name.endsWith(".json")).flatMap((name) => {
    try {
      const message = coordination.validateMessageRecord(readOptionalJson(path.join(dir, name)), name.slice(0, -5));
      const evidence = message.transportEvidence || {};
      return [{ id: message.messageId, taskId: message.taskId, kind: message.kind, state: message.status, generation: message.generation, createdAt: ms(message.createdAt), at: ms(message.deliveredAt || message.failedAt || message.createdAt), note: message.status === "failed" ? evidence.reason || evidence.error || null : null }];
    } catch (_) { return []; }
  }).sort((left, right) => (right.at || 0) - (left.at || 0));
}

function readProjects(home) {
  const record = readOptionalJson(path.join(home, "data", "projects.json"));
  if (!record || !Array.isArray(record.projects)) return [];
  return record.projects.filter((project) => project && typeof project.id === "string").map((project) => ({ id: project.id, name: project.name || project.id, root: project.root, vcs: project.vcs || "git", enabled: project.enabled !== false }));
}

function readProfiles(root) {
  const raw = readOptionalJson(path.join(root, "config", "model-routing.json"));
  let config = null;
  // The board shows the shared config, so it reads it as Paseo does: Herdr's narrower view would reject a Paseo-only default.
  try { config = core.loadRoutingConfig(root, { includeAllProfiles: true, backend: "paseo" }); } catch (_) {}
  if (!config || !raw) return { router: null, profiles: [] };
  const groupOf = (name) => Object.entries(raw.groups || {}).find(([, group]) => (group.profiles || []).includes(name))?.[0] || null;
  return {
    router: { tool: config.router.tool, model: config.router.model || null },
    profiles: Object.entries(config.allProfiles || config.profiles).map(([name, profile]) => ({
      name, group: groupOf(name), tool: profile.tool, model: profile.model || null, effort: profile.effort || null,
      active: profile.isActive !== false && !(config.inactiveProfiles || []).includes(name), isDefault: config.default === name, note: profile.whenToUse || null,
    })),
  };
}

function backendView(entry) {
  return { checkedAt: ms(entry.checkedAt), failedAt: ms(entry.failedAt), error: entry.error || null, workers: entry.workers ?? null, collectedAt: ms(entry.collectedAt) };
}

// The notices Foreman has not told the user yet, derived from task state and the kept check exactly as a supervision turn would.
function untoldNotices(home, metas, tasks, check) {
  const anomalies = tasks.flatMap((task) => task.issues.map(({ type, reason, reportFile }) => ({ taskId: task.taskId, projectId: task.projectId, owner: task.owner, type, reason, ...(reportFile ? { reportFile } : {}) })));
  const failed = Object.values(check.backends || {}).find((entry) => entry.error && (ms(entry.failedAt) || 0) > (ms(entry.checkedAt) || 0));
  try {
    const notices = supervision.collectNotices({ metas, anomalies, runtimeError: failed?.error || null });
    return supervision.pendingNotices(home, notices, metas).map((notice) => ({ key: notice.key, taskId: notice.taskId, kind: notice.kind, type: notice.type || null, reason: notice.reason || null }));
  } catch (_) { return []; }
}

/**
 * Everything the dashboard shows, as one JSON-ready object. `titles` remembers the title of each task the server has seen open,
 * because ended-task history keeps no task content.
 */
function buildSnapshot({ roots, now = Date.now(), titles = new Map() }) {
  const home = roots.foremanHome;
  const base = { schemaVersion: 1, generatedAt: now, home: tilde(home) };
  if (!fs.existsSync(path.join(home, "data"))) return { ...base, state: "missing-home" };
  try {
    let check = { backends: {} };
    try { check = coordination.readStatusCheck(home); } catch (_) {}
    const messages = readMessages(home);
    const tasks = [];
    const skipped = [];
    const metas = [];
    for (const taskId of listDir(path.join(home, "data", "tasks")).sort()) {
      const file = coordination.metaFile(home, taskId);
      if (!fs.existsSync(file)) continue;
      try {
        const record = coordination.readJson(file);
        // Legacy records have no schema version yet; they are read as version 1 and never rewritten.
        const meta = coordination.validateTaskMetaRecord(record && typeof record === "object" && !record.schemaVersion ? { ...record, schemaVersion: 1 } : record, taskId);
        if (!LIVE.includes(meta.status)) continue;
        metas.push(meta);
        const task = taskView({ home, meta, check, messages, now });
        titles.set(task.taskId, task.title);
        tasks.push(task);
      } catch (error) { skipped.push({ taskId, reason: error.message }); }
    }
    markLeaseOverlaps(tasks);
    const projects = readProjects(home);
    for (const task of tasks) task.vcs = projects.find((project) => project.id === task.projectId)?.vcs || null;
    let sup = null;
    try {
      const record = supervision.readSupervision(home);
      const heartbeat = record.heartbeat;
      sup = { heartbeat: heartbeat ? { id: heartbeat.heartbeatId, agent: heartbeat.agentId, cron: record.heartbeatCron, lastFiredAt: ms(heartbeat.lastFiredAt), confirmedAt: ms(heartbeat.confirmedAt), createdAt: ms(heartbeat.createdAt) } : null, enabled: record.heartbeatEnabled !== false, cron: record.heartbeatCron };
    } catch (_) {}
    const ended = history.readHistory(home);
    return {
      ...base,
      state: "ready",
      tasks,
      skipped,
      projects,
      ...readProfiles(roots.foremanRoot),
      supervision: sup,
      backends: Object.fromEntries(Object.entries(check.backends || {}).map(([backend, entry]) => [backend, backendView(entry)])),
      outbox: messages.filter((message) => message.state !== "delivered").concat(messages.filter((message) => message.state === "delivered")).slice(0, OUTBOX_LIMIT),
      untold: untoldNotices(home, metas, tasks, check),
      history: ended.records.map((record) => ({ taskId: record.taskId, projectId: record.projectId, type: record.type, backend: record.backend, outcome: record.outcome, createdAt: ms(record.createdAt), endedAt: ms(record.endedAt), round: record.round, generation: record.generation, title: titles.get(record.taskId) || null }))
        .sort((left, right) => (right.endedAt || 0) - (left.endedAt || 0)),
      historySkipped: ended.skipped.length,
      nextExpiryAt: tasks.flatMap((task) => task.attention.map((point) => point.until)).filter((until) => until !== null).reduce((min, until) => (min === null || until < min ? until : min), null),
    };
  } catch (error) {
    return { ...base, state: "error", error: error.message };
  }
}

/** A cheap digest of every file the snapshot reads; it changes whenever Foreman writes one of them. */
function fingerprint({ roots }) {
  const hash = crypto.createHash("sha1");
  const add = (file) => {
    try { const stat = fs.statSync(file); hash.update(`${file}:${stat.mtimeMs}:${stat.size}\n`); } catch (_) { hash.update(`${file}:-\n`); }
  };
  const data = path.join(roots.foremanHome, "data");
  add(data);
  for (const name of ["projects.json", "supervision.json", "status-check.json", "task-history.jsonl"]) add(path.join(data, name));
  add(path.join(roots.foremanRoot, "config", "model-routing.json"));
  const tasksDir = path.join(data, "tasks");
  for (const taskId of listDir(tasksDir)) {
    for (const name of listDir(path.join(tasksDir, taskId))) {
      if (name === "attachments") continue;
      const file = path.join(tasksDir, taskId, name);
      if (["rounds", "reports", "decisions"].includes(name)) for (const child of listDir(file)) add(path.join(file, child));
      else add(file);
    }
  }
  for (const name of listDir(path.join(data, "messages"))) add(path.join(data, "messages", name));
  return hash.digest("hex");
}

module.exports = { buildSnapshot, fingerprint, splitNextSteps, decisionOption, recommendedKey };
