const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class CoordinationError extends Error {}
class MessageValidationError extends CoordinationError {}
class SchemaValidationError extends CoordinationError {}

const SUPPORTED_SCHEMA_VERSION = 1;
const TASK_STATUSES = ["routing", "queued", "pending", "working", "blocked", "waiting-decision", "review-ready", "accepted", "cleaned"];

function isoNow() { return new Date().toISOString(); }
function digest(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }

function atomicWrite(file, content, { mode = 0o600 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    const fd = fs.openSync(temp, "wx", mode);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function atomicJson(file, value, options) { atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, options); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function assertSchemaVersion(record, kind, identity) {
  if (!record || typeof record !== "object" || !Number.isInteger(record.schemaVersion)) {
    throw new SchemaValidationError(`${kind} record has no valid schema version`);
  }
  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new SchemaValidationError(`${kind} schema version ${record.schemaVersion} is unsupported`);
  }
  if (identity && record[identity.field] !== identity.value) {
    throw new SchemaValidationError(`${kind} identity does not match ${identity.value}`);
  }
  return record;
}

function validateTaskMetaRecord(meta, taskId) {
  assertSchemaVersion(meta, "Task metadata", { field: "taskId", value: taskId || meta?.taskId });
  if (!meta.projectId || typeof meta.generation !== "number" || !Number.isInteger(meta.generation) || meta.generation < 0) {
    throw new SchemaValidationError(`Task metadata identity is invalid: ${taskId || meta.taskId}`);
  }
  if (!meta.type || !["ship", "scout"].includes(meta.type)) throw new SchemaValidationError(`Task metadata type is invalid: ${taskId || meta.taskId}`);
  if (!Array.isArray(meta.dependencies || []) || !Array.isArray(meta.resources || [])) throw new SchemaValidationError(`Task metadata collections are invalid: ${taskId || meta.taskId}`);
  if (!meta.status || !TASK_STATUSES.includes(meta.status)) throw new SchemaValidationError(`Task metadata status is invalid: ${taskId || meta.taskId}`);
  if (meta.owner !== null && meta.owner !== undefined && typeof meta.owner !== "string") throw new SchemaValidationError(`Task metadata owner is invalid: ${taskId || meta.taskId}`);
  if (meta.endpoint !== null && meta.endpoint !== undefined && typeof meta.endpoint !== "string") throw new SchemaValidationError(`Task metadata endpoint is invalid: ${taskId || meta.taskId}`);
  if (meta.backend !== undefined && !["herdr", "paseo"].includes(meta.backend)) throw new SchemaValidationError(`Task metadata backend is invalid: ${taskId || meta.taskId}`);
  if (meta.workspaceId !== undefined && meta.workspaceId !== null && typeof meta.workspaceId !== "string") throw new SchemaValidationError(`Task metadata workspace ID is invalid: ${taskId || meta.taskId}`);
  if (meta.round !== undefined && (!Number.isInteger(meta.round) || meta.round < 1)) throw new SchemaValidationError(`Task metadata round is invalid: ${taskId || meta.taskId}`);
  if (meta.everShip !== undefined && typeof meta.everShip !== "boolean") throw new SchemaValidationError(`Task metadata everShip is invalid: ${taskId || meta.taskId}`);
  return meta;
}

function validateMessageRecord(message, id) {
  assertSchemaVersion(message, "Message", { field: "messageId", value: id || message?.messageId });
  if (!message.taskId || !message.projectId || !message.worker || typeof message.generation !== "number" || !Number.isInteger(message.generation) || !message.kind || message.payload === undefined || !message.payloadDigest) {
    throw new SchemaValidationError(`Message identity is invalid: ${id || message?.messageId}`);
  }
  if (digest(message.payload) !== message.payloadDigest) throw new SchemaValidationError(`Message payload digest is invalid: ${message.messageId}`);
  if (!["pending", "delivered", "failed"].includes(message.status)) throw new SchemaValidationError(`Message lifecycle is invalid: ${message.messageId}`);
  if (!Number.isFinite(Date.parse(message.createdAt))) throw new SchemaValidationError(`Message timestamps are invalid: ${message.messageId}`);
  return message;
}

function taskDir(home, taskId) { return path.join(home, "data", "tasks", taskId); }
function metaFile(home, taskId) { return path.join(taskDir(home, taskId), "meta.json"); }
function roundsDir(home, taskId) { return path.join(taskDir(home, taskId), "rounds"); }
function roundFile(home, taskId, round) { return path.join(roundsDir(home, taskId), `round-${String(round).padStart(3, "0")}.json`); }

function validateRoundRecord(record, taskId, round) {
  assertSchemaVersion(record, "Round", { field: "taskId", value: taskId });
  if (!Number.isInteger(record.round) || record.round < 2 || (round !== undefined && record.round !== round)) throw new SchemaValidationError(`Round identity is invalid: ${taskId} round ${round ?? record.round}`);
  if (!["pending", "delivered", "failed"].includes(record.status)) throw new SchemaValidationError(`Round lifecycle is invalid: ${taskId} round ${record.round}`);
  if (typeof record.sent !== "string" || !record.sent || typeof record.original !== "string") throw new SchemaValidationError(`Round text is invalid: ${taskId} round ${record.round}`);
  return record;
}

// Round 1 is the task brief itself; later rounds are append-only records written by `task continue` and `task reassign`.
function listRounds({ roots, taskId, statuses }) {
  const dir = roundsDir(roots.foremanHome, taskId);
  if (!fs.existsSync(dir)) return [];
  const allowed = statuses ? new Set(statuses) : null;
  return fs.readdirSync(dir).filter((name) => /^round-\d+\.json$/.test(name)).sort()
    .map((name) => validateRoundRecord(readJson(path.join(dir, name)), taskId, Number(name.slice(6, -5))))
    .filter((record) => !allowed || allowed.has(record.status));
}

function writeRoundUnlocked({ roots, record }) {
  validateRoundRecord(record, record.taskId, record.round);
  atomicJson(roundFile(roots.foremanHome, record.taskId, record.round), record);
  return record;
}

function coordinationDirs(home) {
  return { messages: path.join(home, "data", "messages") };
}

function initCoordination(home) {
  const dirs = coordinationDirs(home);
  fs.mkdirSync(dirs.messages, { recursive: true, mode: 0o700 });
  return dirs;
}

function messageFile(home, messageId) { return path.join(coordinationDirs(home).messages, `${messageId}.json`); }

// The one report contract shared by every worker prompt and the worker stop hook.
const REPORT_COMMAND = [
  "\"$FOREMAN_ROOT/bin/foreman\" report --status <done|blocked|progress> <<'REPORT'",
  "<summary>",
  "REPORT",
  "",
  "Choose the status:",
  "- done: the task is complete. Summary: outcome, changed files, verification evidence, unresolved checks, risks.",
  "- blocked: only the user can unblock you. Summary: finding, why user authority is needed, options, your recommendation.",
  "- progress: you stopped before finishing for another reason. Summary: what is done, what remains, why you stopped.",
  "After the command succeeds, end your turn. If it fails, include the error in your final message.",
];

const MESSAGE_TITLES = { "foreman-message": "Foreman message", "human-decision": "Human decision" };

// Every worker prompt uses one fixed layout so each dispatch reads the same way.
function deliveryPrompt(message) {
  const payload = message.payload || {};
  const plainText = (value, indent = "") => {
    if (value == null) return "";
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return value.map((item) => `${indent}- ${plainText(item, `${indent}  `)}`).join("\n");
    return Object.entries(value).map(([key, item]) => `${indent}${key}: ${typeof item === "object" && item !== null ? `\n${plainText(item, `${indent}  `)}` : plainText(item)}`).join("\n");
  };
  const section = (title, body) => ["", `## ${title}`, body];
  const reportInstruction = payload.backend === "paseo"
    ? "At the end of this turn, return exactly one JSON object with fields status and summary. status must be done, blocked, or progress. The summary must describe outcome, changed files, verification evidence, unresolved checks, and risks. Do not call foreman report; Paseo returns this final response to Foreman."
    : ["When you finish, get blocked, or stop, report to Foreman from this pane with exactly one command:", "", ...REPORT_COMMAND].join("\n");
  if (message.kind === "task-brief") {
    const resources = (payload.resources || []).map((claim) => `${claim.key} (${claim.mode})`).join(", ");
    return [
      `Foreman task ${message.taskId} | project ${message.projectId} | ${payload.taskType || "ship"} | generation ${message.generation}`,
      `Workspace: ${payload.cwd}`,
      `Branch: ${payload.branch || "current checkout"}`,
      `Allowed resources: ${resources}`,
      ...section("User request", String(payload.brief || "")),
      ...(payload.notes ? section("Foreman notes", String(payload.notes)) : []),
      ...(payload.handoff ? section("Previous work and handoff", plainText(payload.handoff)) : []),
      ...section("Report", reportInstruction),
    ].join("\n");
  }
  return [
    `${MESSAGE_TITLES[message.kind] || message.kind} for task ${message.taskId} | project ${message.projectId}`,
    "",
    typeof payload === "string" ? payload : (payload.response || payload.request || plainText(payload)),
    ...section("Report", payload.backend === "paseo" ? reportInstruction : ["When you have handled this, report to Foreman again from this pane with exactly one command:", "", ...REPORT_COMMAND].join("\n")),
  ].join("\n");
}

function messageId({ taskId, generation, kind, payload, explicitId }) {
  if (explicitId) return String(explicitId);
  const seed = `${taskId}:${generation}:${kind}:${digest(payload)}:${crypto.randomBytes(8).toString("hex")}`;
  return `M-${digest(seed).slice(0, 24)}`;
}

function validateMessageInput(input) {
  if (!input || !input.taskId || !input.projectId || !input.worker || !Number.isInteger(Number(input.generation))) {
    throw new MessageValidationError("Message identity is incomplete");
  }
  if (!input.kind) throw new MessageValidationError("Message kind is required");
}

// Messages record what Foreman submitted to a worker; they are never resent.
function createMessageUnlocked({ roots, taskId, projectId, worker, generation, endpoint, kind, payload, explicitId }) {
  const input = { taskId, projectId, worker, generation, kind, payload };
  validateMessageInput(input);
  initCoordination(roots.foremanHome);
  const id = messageId({ ...input, explicitId });
  const file = messageFile(roots.foremanHome, id);
  if (fs.existsSync(file)) {
    const existing = validateMessageRecord(readJson(file), id);
    if (existing.taskId !== taskId || existing.projectId !== projectId || existing.worker !== worker || existing.generation !== Number(generation) || existing.kind !== kind || existing.payloadDigest !== digest(payload)) throw new MessageValidationError(`Message ID collision: ${id}`);
    return existing;
  }
  const message = {
    schemaVersion: 1,
    messageId: id,
    taskId,
    projectId,
    worker,
    generation: Number(generation),
    endpoint: endpoint || null,
    kind,
    createdAt: isoNow(),
    payload,
    payloadDigest: digest(payload),
    status: "pending",
    deliveredAt: null,
    failedAt: null,
    transportEvidence: null,
  };
  atomicJson(file, message);
  return validateMessageRecord(message, id);
}

function updateMessageUnlocked({ roots, messageId: id, mutate }) {
  const file = messageFile(roots.foremanHome, id);
  if (!fs.existsSync(file)) throw new MessageValidationError(`Unknown message: ${id}`);
  const current = validateMessageRecord(readJson(file), id);
  const next = mutate({ ...current });
  validateMessageRecord(next, id);
  atomicJson(file, next);
  return next;
}

function listMessages({ roots, statuses } = {}) {
  initCoordination(roots.foremanHome);
  const allowed = statuses ? new Set(statuses) : null;
  const dir = coordinationDirs(roots.foremanHome).messages;
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => validateMessageRecord(readJson(path.join(dir, name)), name.slice(0, -5))).filter((message) => !allowed || allowed.has(message.status));
}

function markMessageDeliveryUnlocked({ roots, messageId: id, delivered, evidence }) {
  return updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    if (message.status !== "pending") return message;
    const at = isoNow();
    return delivered
      ? { ...message, status: "delivered", deliveredAt: at, transportEvidence: evidence || { delivered: true } }
      : { ...message, status: "failed", failedAt: at, transportEvidence: evidence || { delivered: false } };
  }});
}

function failMessageUnlocked({ roots, messageId: id, reason }) {
  return updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    if (message.status === "failed") return message;
    return { ...message, status: "failed", failedAt: message.failedAt || isoNow(), transportEvidence: { ...(message.transportEvidence || {}), reason } };
  }});
}

function purgeTaskRecordsUnlocked({ roots, taskId }) {
  const dirs = initCoordination(roots.foremanHome);
  for (const name of fs.readdirSync(dirs.messages)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dirs.messages, name);
    try {
      if (readJson(file).taskId === taskId) fs.unlinkSync(file);
    } catch (_) {
      // Preserve malformed external records for later inspection.
    }
  }
}

function activeTaskMetas(roots) {
  const root = path.join(roots.foremanHome, "data", "tasks");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((id) => fs.existsSync(metaFile(roots.foremanHome, id))).map((taskId) => ({ taskId, meta: validateTaskMetaRecord(readJson(metaFile(roots.foremanHome, taskId)), taskId) }));
}

function runtimeWorkerFor(meta, workers) {
  if (meta.endpoint) return workers.find((worker) => worker.endpoint === meta.endpoint || worker.endpointId === meta.endpoint || worker.agentId === meta.endpoint || worker.id === meta.endpoint || worker.name === meta.endpoint || worker.agent === meta.endpoint || worker.pane_id === meta.endpoint);
  return workers.find((worker) => worker.owner === meta.owner || worker.name === meta.owner);
}

function classifyRuntime(meta, worker) {
  // A task that was never assigned has no worker to observe; its lifecycle status is its state.
  if (!meta.endpoint) return ["routing", "queued", "pending"].includes(meta.status) ? meta.status : "unknown";
  if (!worker) return "missing";
  if (worker.owner && worker.owner !== meta.owner && worker.name !== meta.owner) return "mismatch";
  if (worker.attentionReason === "permission" || (worker.pendingPermissions || []).length) return "waiting-input";
  const status = String(worker.status || worker.agent_status || "unknown").toLowerCase();
  if (worker.attentionReason === "error" || status === "error") return "unknown";
  if (status === "closed") return "unknown";
  if (["dead", "crashed", "terminated"].includes(status)) return "dead";
  if (["idle", "waiting", "done", "completed", "complete", "exited"].includes(status)) return "idle";
  if (status === "blocked") return "waiting-input";
  if (["working", "running", "busy"].includes(status)) return "working";
  return "unknown";
}

// True when the worker has reported since Foreman last prompted it.
function reportedSincePrompt(meta) {
  if (!meta.lastReport?.at) return false;
  return Date.parse(meta.lastReport.at) >= Date.parse(meta.lastPromptAt || meta.assignedAt || 0);
}

function taskConsistencyIssues({ roots, meta }) {
  const issues = [];
  if (["working", "blocked", "waiting-decision"].includes(meta.status) && !meta.endpoint) {
    issues.push({ type: "task.endpoint-missing", reason: "active assignment has no runtime endpoint" });
  }
  try {
    const { findProject, gitBranch, projectVcs, workspaceBelongsToProject } = require("./foreman");
    const project = findProject(roots.foremanHome, meta.projectId);
    const hasGit = projectVcs(project) === "git";
    if (meta.workspace && (!fs.existsSync(meta.workspace) || fs.realpathSync(meta.workspace) !== meta.workspace)) {
      issues.push({ type: "task.workspace-missing", reason: "workspace is missing or not canonical" });
    }
    if (hasGit && meta.workspace && meta.branch && fs.existsSync(meta.workspace)) {
      try { if (gitBranch(meta.workspace) !== meta.branch) issues.push({ type: "task.branch-mismatch", expected: meta.branch, actual: gitBranch(meta.workspace) }); }
      catch (error) { issues.push({ type: "task.branch-unreadable", reason: error.message }); }
    }
    if (meta.workspace && fs.existsSync(meta.workspace) && !workspaceBelongsToProject(project, meta.workspace)) {
      issues.push({ type: "task.project-mismatch", reason: "workspace belongs to a different project" });
    }
  } catch (error) {
    issues.push({ type: "task.project-invalid", reason: error.message });
  }
  if (meta.resourceLease) {
    const lease = meta.resourceLease;
    if (lease.taskId !== meta.taskId || lease.owner !== meta.owner || Number(lease.generation) !== Number(meta.generation)) {
      issues.push({ type: "task.resource-lease-invalid", reason: "lease identity does not match the assignment" });
    }
  } else if (["working", "blocked", "waiting-decision"].includes(meta.status)) {
    issues.push({ type: "task.resource-lease-missing", reason: "active assignment has no resource lease" });
  }
  return issues;
}

/**
 * One read-only runtime check: a single listing compared with durable task state.
 * It never writes, interrupts a worker, or starts recovery.
 */
function reconcileFleet({ roots, adapter }) {
  let workers = [];
  if (adapter && typeof adapter.list === "function") workers = adapter.list() || [];
  const tasks = [];
  for (const { taskId, meta } of activeTaskMetas(roots)) {
    if (["accepted", "review-ready", "cleaned"].includes(meta.status)) continue;
    const adapterBackend = adapter?.backend || "herdr";
    if ((meta.backend || "herdr") !== adapterBackend) {
      tasks.push({ taskId, meta, worker: null, state: "unobserved", issues: [] });
      continue;
    }
    const worker = runtimeWorkerFor(meta, workers);
    const issues = taskConsistencyIssues({ roots, meta });
    const paseoTask = (meta.backend || "herdr") === "paseo";
    if (!paseoTask && worker?.projectId && worker.projectId !== meta.projectId) issues.push({ type: "task.runtime-project-mismatch", expected: meta.projectId, actual: worker.projectId });
    if (worker?.cwd && meta.workspace && path.resolve(worker.cwd) !== path.resolve(meta.workspace)) issues.push({ type: "task.runtime-workspace-mismatch", expected: meta.workspace, actual: worker.cwd });
    if (paseoTask) {
      if (!worker?.workspaceId || worker.workspaceId !== meta.workspaceId) issues.push({ type: "task.runtime-workspace-id-mismatch", expected: meta.workspaceId, actual: worker?.workspaceId || null });
      if (!meta.adopted) {
        if (worker?.taskId !== meta.taskId) issues.push({ type: "task.runtime-task-mismatch", expected: meta.taskId, actual: worker?.taskId || null });
        if (worker?.projectId !== meta.projectId) issues.push({ type: "task.runtime-project-mismatch", expected: meta.projectId, actual: worker?.projectId || null });
        if (worker?.generation == null || Number(worker.generation) !== Number(meta.generation)) issues.push({ type: "task.runtime-generation-mismatch", expected: meta.generation, actual: worker?.generation ?? null });
      }
    } else {
      if (worker?.workspaceId && meta.workspaceId && worker.workspaceId !== meta.workspaceId) issues.push({ type: "task.runtime-workspace-id-mismatch", expected: meta.workspaceId, actual: worker.workspaceId });
      if (worker?.taskId && worker.taskId !== meta.taskId) issues.push({ type: "task.runtime-task-mismatch", expected: meta.taskId, actual: worker.taskId });
      if (worker?.generation != null && Number(worker.generation) !== Number(meta.generation)) issues.push({ type: "task.runtime-generation-mismatch", expected: meta.generation, actual: worker.generation });
    }
    if (worker?.pane_id && meta.paneId && worker.pane_id !== meta.paneId) issues.push({ type: "task.runtime-pane-mismatch", expected: meta.paneId, actual: worker.pane_id });
    let state = classifyRuntime(meta, worker);
    if (issues.length && state !== "dead" && state !== "missing") state = "unknown";
    if (state === "idle" && meta.status === "working" && !reportedSincePrompt(meta)) issues.push({ type: "worker.idle-without-report", reason: "worker stopped without reporting since its last prompt" });
    if (state === "waiting-input") issues.push({ type: "worker.waiting-input", reason: "worker runtime is waiting for input" });
    if (["missing", "dead", "mismatch"].includes(state)) issues.push({ type: `worker.${state}`, reason: `runtime listing shows the worker as ${state}` });
    tasks.push({ taskId, meta, worker: worker || null, state, issues });
  }
  return { workers, tasks };
}

const ROUND_REPORT_LIMIT = 5;
const ROUND_REPORT_CHARS = 4000;

// The last done or blocked report of each of the most recent rounds; a report without a ROUND header belongs to round 1.
function collectRoundReports(dir) {
  const reportsDir = path.join(dir, "reports");
  if (!fs.existsSync(reportsDir)) return [];
  const byRound = new Map();
  for (const name of fs.readdirSync(reportsDir).filter((item) => item.endsWith(".md"))) {
    const file = path.join(reportsDir, name);
    const text = fs.readFileSync(file, "utf8");
    const header = text.split(/\r?\n\r?\n/, 1)[0];
    const status = header.match(/^STATUS: (.+)$/m)?.[1];
    if (status !== "done" && status !== "blocked") continue;
    const round = Number(header.match(/^ROUND: (\d+)$/m)?.[1] || 1);
    const at = header.match(/^REPORTED_AT: (.+)$/m)?.[1] || "";
    const previous = byRound.get(round);
    if (!previous || at >= previous.at) byRound.set(round, { round, status, at, file, text });
  }
  return [...byRound.values()].sort((left, right) => left.round - right.round).slice(-ROUND_REPORT_LIMIT).map(({ round, status, at, file, text }) => {
    const body = text.slice(text.indexOf("\n\n") + 2);
    return { round, status, at, file, summary: body.length > ROUND_REPORT_CHARS ? `${body.slice(0, ROUND_REPORT_CHARS)}\n[truncated; full report: ${file}]` : body };
  });
}

function buildHandoffPackage({ roots, taskId, reason = "recovery" }) {
  const dir = taskDir(roots.foremanHome, taskId);
  const meta = validateTaskMetaRecord(readJson(metaFile(roots.foremanHome, taskId)), taskId);
  const read = (file) => file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const decisionsDir = path.join(dir, "decisions");
  const decisions = fs.existsSync(decisionsDir) ? fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const decision = readJson(path.join(decisionsDir, name));
    assertSchemaVersion(decision, "Decision", { field: "decisionId", value: name.slice(0, -5) });
    if (decision.taskId !== taskId || decision.projectId !== meta.projectId || typeof decision.generation !== "number" || decision.generation > meta.generation) throw new SchemaValidationError(`Decision identity is stale: ${name}`);
    return decision;
  }) : [];
  const rounds = listRounds({ roots, taskId, statuses: ["delivered"] }).map((round) => ({ round: round.round, mode: round.mode, sent: round.sent, original: round.original, supersedes: round.supersedes ?? null }));
  const roundReports = collectRoundReports(dir);
  const evidenceFile = path.join(dir, "evidence.json");
  const unresolvedFile = path.join(dir, "unresolved-checks.json");
  return {
    schemaVersion: 1,
    handoffId: `H-${taskId}-${meta.generation}-${digest(`${taskId}:${meta.generation}:${reason}`).slice(0, 16)}`,
    taskId,
    projectId: meta.projectId,
    previousOwner: meta.owner,
    previousEndpoint: meta.endpoint,
    previousGeneration: meta.generation,
    reason,
    // The brief itself reaches the successor as the task's "User request"; only what came after it travels here.
    original: read(path.join(dir, "original.md")),
    rounds,
    roundReports,
    decisions,
    lastReport: read(meta.lastReport?.file),
    workspace: meta.workspace,
    branch: meta.branch,
    resources: meta.resources || [],
    resourceLease: meta.resourceLease || null,
    evidence: meta.evidence || (fs.existsSync(evidenceFile) ? read(evidenceFile) : null),
    unresolvedChecks: meta.unresolvedChecks || (fs.existsSync(unresolvedFile) ? read(unresolvedFile) : []),
    inspectFirst: "Inspect the existing workspace, current branch, leased resources, latest report, and unresolved checks before changing anything. Treat prior worker claims as evidence to verify, not assumptions.",
    createdAt: isoNow(),
  };
}

module.exports = {
  CoordinationError, MessageValidationError, SchemaValidationError, SUPPORTED_SCHEMA_VERSION,
  assertSchemaVersion, validateTaskMetaRecord, validateMessageRecord,
  digest, initCoordination, coordinationDirs, taskDir, metaFile, roundsDir, roundFile, listRounds, writeRoundUnlocked, validateRoundRecord, messageFile, REPORT_COMMAND, deliveryPrompt, createMessageUnlocked,
  updateMessageUnlocked, listMessages, markMessageDeliveryUnlocked, failMessageUnlocked, purgeTaskRecordsUnlocked,
  activeTaskMetas, reconcileFleet, classifyRuntime, reportedSincePrompt, buildHandoffPackage,
};
