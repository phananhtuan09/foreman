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

function coordinationDirs(home) {
  return { messages: path.join(home, "data", "messages") };
}

function initCoordination(home) {
  const dirs = coordinationDirs(home);
  fs.mkdirSync(dirs.messages, { recursive: true, mode: 0o700 });
  return dirs;
}

function messageFile(home, messageId) { return path.join(coordinationDirs(home).messages, `${messageId}.json`); }

function deliveryPrompt(message) {
  const payload = message.payload || {};
  const plainText = (value, indent = "") => {
    if (value == null) return "";
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return value.map((item) => `${indent}- ${plainText(item, `${indent}  `)}`).join("\n");
    return Object.entries(value).map(([key, item]) => `${indent}${key}: ${typeof item === "object" && item !== null ? `\n${plainText(item, `${indent}  `)}` : plainText(item)}`).join("\n");
  };
  if (message.kind === "task-brief") {
    const resources = (payload.resources || []).map((claim) => `${claim.key} (${claim.mode})`).join(", ");
    return [
      `Task ${message.taskId} | project ${message.projectId}`,
      `Workspace: ${payload.cwd}`,
      `Allowed resources: ${resources}`,
      "",
      String(payload.brief || ""),
      ...(payload.handoff ? ["", "Previous work and handoff:", plainText(payload.handoff)] : []),
      "",
      ...(payload.instructions || []),
    ].join("\n");
  }
  return [
    `${message.kind} for task ${message.taskId}`,
    typeof payload === "string" ? payload : (payload.response || payload.request || plainText(payload)),
  ].join("\n\n");
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
  if (meta.endpoint) return workers.find((worker) => worker.endpoint === meta.endpoint || worker.endpointId === meta.endpoint || worker.name === meta.endpoint || worker.agent === meta.endpoint || worker.pane_id === meta.endpoint);
  return workers.find((worker) => worker.owner === meta.owner || worker.name === meta.owner);
}

function classifyRuntime(meta, worker) {
  if (!meta.endpoint) return meta.status === "pending" ? "pending" : "unknown";
  if (!worker) return "missing";
  if (worker.owner && worker.owner !== meta.owner && worker.name !== meta.owner) return "mismatch";
  const status = String(worker.status || worker.agent_status || "unknown").toLowerCase();
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
    if (hasGit && meta.workspace && fs.existsSync(meta.workspace)) {
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
    const worker = runtimeWorkerFor(meta, workers);
    const issues = taskConsistencyIssues({ roots, meta });
    if (worker?.projectId && worker.projectId !== meta.projectId) issues.push({ type: "task.runtime-project-mismatch", expected: meta.projectId, actual: worker.projectId });
    if (worker?.cwd && meta.workspace && path.resolve(worker.cwd) !== path.resolve(meta.workspace)) issues.push({ type: "task.runtime-workspace-mismatch", expected: meta.workspace, actual: worker.cwd });
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
    brief: read(path.join(dir, "brief.md")),
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
  digest, initCoordination, coordinationDirs, taskDir, metaFile, messageFile, deliveryPrompt, createMessageUnlocked,
  updateMessageUnlocked, listMessages, markMessageDeliveryUnlocked, failMessageUnlocked, purgeTaskRecordsUnlocked,
  activeTaskMetas, reconcileFleet, classifyRuntime, reportedSincePrompt, buildHandoffPackage,
};
