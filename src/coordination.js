const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class CoordinationError extends Error {}
class MessageValidationError extends CoordinationError {}
class EventValidationError extends CoordinationError {}
class SchemaValidationError extends CoordinationError {}

const SUPPORTED_SCHEMA_VERSION = 1;

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
  if (!meta.status || !["queued", "pending", "pending-ack", "working", "blocked", "waiting-decision", "review-ready", "accepted", "cleaned"].includes(meta.status)) throw new SchemaValidationError(`Task metadata status is invalid: ${taskId || meta.taskId}`);
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
  if (!["pending", "delivered", "acknowledged", "failed"].includes(message.status)) throw new SchemaValidationError(`Message lifecycle is invalid: ${message.messageId}`);
  if (!Number.isInteger(Number(message.attempts)) || Number(message.attempts) < 0 || !Number.isInteger(Number(message.maxAttempts)) || Number(message.maxAttempts) < 1) throw new SchemaValidationError(`Message retry fields are invalid: ${message.messageId}`);
  if (!Number.isFinite(Date.parse(message.createdAt)) || message.expiresAt && !Number.isFinite(Date.parse(message.expiresAt))) throw new SchemaValidationError(`Message timestamps are invalid: ${message.messageId}`);
  return message;
}

function validateEventRecord(event, id) {
  assertSchemaVersion(event, "Event", { field: "eventId", value: id || event?.eventId });
  if (!event.eventType || !event.dedupKey || !["pending", "processing", "handled"].includes(event.status)) throw new SchemaValidationError(`Event identity or lifecycle is invalid: ${id || event?.eventId}`);
  if (event.generation !== null && (typeof event.generation !== "number" || !Number.isInteger(event.generation))) throw new SchemaValidationError(`Event generation is invalid: ${id || event?.eventId}`);
  if (!Number.isFinite(Date.parse(event.createdAt)) || !Number.isFinite(Date.parse(event.observedAt))) throw new SchemaValidationError(`Event timestamps are invalid: ${id || event?.eventId}`);
  return event;
}

function quarantineExternal({ roots, taskId, name, raw, reason }) {
  const dir = path.join(roots.foremanHome, "state", "tasks", taskId, "inbox", "quarantine");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safe = String(name || "record").replace(/[^a-zA-Z0-9._-]/g, "_");
  let file = path.join(dir, `${Date.now()}-${safe}`);
  let suffix = 0;
  while (fs.existsSync(file)) file = path.join(dir, `${Date.now()}-${++suffix}-${safe}`);
  atomicWrite(file, Buffer.isBuffer(raw) ? raw : String(raw), { mode: 0o600 });
  return file;
}

function coordinationDirs(home) {
  return {
    messages: path.join(home, "state", "messages"),
    events: path.join(home, "state", "events"),
    pendingEvents: path.join(home, "state", "events", "pending"),
    processingEvents: path.join(home, "state", "events", "processing"),
    handledEvents: path.join(home, "state", "events", "handled"),
    observer: path.join(home, "state", "observer"),
  };
}

function initCoordination(home) {
  const dirs = coordinationDirs(home);
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dirs;
}

function messageFile(home, messageId) { return path.join(coordinationDirs(home).messages, `${messageId}.json`); }
function eventFile(home, state, eventId) { return path.join(coordinationDirs(home)[`${state}Events`], `${eventId}.json`); }

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

function createMessageUnlocked({ roots, taskId, projectId, worker, generation, endpoint, kind, payload, explicitId, maxAttempts = 5, maxAgeMs = 24 * 60 * 60 * 1000 }) {
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
  const createdAt = isoNow();
  const message = {
    schemaVersion: 1,
    messageId: id,
    taskId,
    projectId,
    worker,
    generation: Number(generation),
    endpoint: endpoint || null,
    kind,
    createdAt,
    payload,
    payloadDigest: digest(payload),
    status: "pending",
    attempts: 0,
    maxAttempts: Math.max(1, Number(maxAttempts) || 5),
    expiresAt: new Date(Date.now() + Math.max(1000, Number(maxAgeMs) || 24 * 60 * 60 * 1000)).toISOString(),
    lastAttemptAt: null,
    nextAttemptAt: null,
    deliveredAt: null,
    acknowledgedAt: null,
    failedAt: null,
    transportEvidence: null,
    ack: null,
  };
  atomicJson(file, message);
  return validateMessageRecord(message, id);
}

function createMessage({ roots, lock, ...input }) {
  if (lock) return createMessageUnlocked({ roots, ...input });
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => createMessageUnlocked({ roots, ...input }));
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

function acknowledgeMessage({ roots, messageId: id, ack }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    if (!ack || ack.messageId !== id || ack.taskId !== message.taskId || ack.projectId !== message.projectId || ack.worker !== message.worker || Number(ack.generation) !== message.generation || ack.payloadDigest !== message.payloadDigest) {
      throw new MessageValidationError("Acknowledgement identity or payload digest does not match the message");
    }
    const taskFile = path.join(roots.foremanHome, "state", "tasks", message.taskId, "meta.json");
    if (!fs.existsSync(taskFile)) throw new MessageValidationError("Acknowledgement task metadata is missing");
    const meta = validateTaskMetaRecord(readJson(taskFile), message.taskId);
    if (meta.projectId !== message.projectId || meta.owner !== message.worker || meta.generation !== message.generation || meta.endpoint !== message.endpoint) {
      throw new MessageValidationError("Acknowledgement does not match the current assignment");
    }
    if (message.status === "failed") throw new MessageValidationError("A failed message cannot be acknowledged");
    if (message.status === "acknowledged") return message;
    message.status = "acknowledged";
    message.acknowledgedAt = isoNow();
    message.ack = { ...ack, acknowledgedAt: ack.acknowledgedAt || ack.timestamp || isoNow() };
    return message;
  }}));
}

function listMessages({ roots, statuses } = {}) {
  initCoordination(roots.foremanHome);
  const allowed = statuses ? new Set(statuses) : null;
  return fs.readdirSync(coordinationDirs(roots.foremanHome).messages).filter((name) => name.endsWith(".json")).map((name) => validateMessageRecord(readJson(path.join(coordinationDirs(roots.foremanHome).messages, name)), name.slice(0, -5))).filter((message) => !allowed || allowed.has(message.status));
}

function markMessageDeliveryUnlocked({ roots, messageId: id, delivered, evidence }) {
  const updated = updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    if (message.status === "acknowledged" || message.status === "failed") return message;
    message.attempts += 1;
    message.lastAttemptAt = isoNow();
    message.transportEvidence = evidence || { delivered: Boolean(delivered) };
    if (delivered) {
      message.status = message.status === "acknowledged" ? "acknowledged" : "delivered";
      message.deliveredAt = message.deliveredAt || message.lastAttemptAt;
      message.nextAttemptAt = null;
    } else if (message.attempts >= message.maxAttempts) {
      message.status = "failed";
      message.failedAt = message.lastAttemptAt;
      message.nextAttemptAt = null;
    } else {
      const backoff = Math.min(60 * 60 * 1000, 1000 * (2 ** Math.max(0, message.attempts - 1)));
      message.nextAttemptAt = new Date(Date.now() + backoff).toISOString();
    }
    return message;
  }});
  if (updated.status === "failed") emitMessageFailureEvent({ roots, message: updated, reason: updated.transportEvidence?.stale ? updated.transportEvidence.reason : "delivery attempts exhausted" });
  return updated;
}

function emitMessageFailureEvent({ roots, message, reason }) {
  try {
    return createObserverEvent({ roots, eventType: "message.delivery-failed", dedupKey: `message-failed:${message.messageId}`, taskId: message.taskId, projectId: message.projectId, worker: message.worker, generation: message.generation, endpoint: message.endpoint, evidence: { messageId: message.messageId, reason, attempts: message.attempts, maxAttempts: message.maxAttempts, failedAt: message.failedAt }, source: "message-retry" });
  } catch (_) { return null; }
}

function failMessageUnlocked({ roots, messageId: id, reason }) {
  const item = updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    if (message.status === "failed") return message;
    return { ...message, status: "failed", failedAt: message.failedAt || isoNow(), nextAttemptAt: null, transportEvidence: { ...(message.transportEvidence || {}), stale: true, reason } };
  }});
  if (item.status === "failed") emitMessageFailureEvent({ roots, message: item, reason });
  return item;
}

function retryMessagesUnlocked({ roots, adapter, force = false, maxAgeMs = 24 * 60 * 60 * 1000, baseBackoffMs = 1000, maxBackoffMs = 60 * 60 * 1000 }) {
  const messages = listMessages({ roots, statuses: ["pending", "delivered"] });
  const results = [];
  for (const message of messages) {
    const metaFilePath = path.join(roots.foremanHome, "state", "tasks", message.taskId, "meta.json");
    if (!fs.existsSync(metaFilePath)) {
      results.push(failMessageUnlocked({ roots, messageId: message.messageId, reason: "task metadata is missing" }));
      continue;
    }
    const meta = validateTaskMetaRecord(readJson(metaFilePath), message.taskId);
    if (meta.projectId !== message.projectId || meta.generation !== message.generation || meta.endpoint !== message.endpoint || meta.owner !== message.worker) {
      results.push(failMessageUnlocked({ roots, messageId: message.messageId, reason: "message assignment generation is no longer current" }));
      continue;
    }
    const age = Date.now() - Date.parse(message.createdAt);
    const expired = message.expiresAt ? Date.now() >= Date.parse(message.expiresAt) : age > maxAgeMs;
    if (!Number.isFinite(age) || expired || age > maxAgeMs) {
      results.push(failMessageUnlocked({ roots, messageId: message.messageId, reason: "message age limit exceeded" }));
      continue;
    }
    const backoffMs = Math.min(maxBackoffMs, Math.max(0, baseBackoffMs) * (2 ** Math.max(0, message.attempts - 1)));
    if (!force && message.lastAttemptAt && Date.now() - Date.parse(message.lastAttemptAt) < backoffMs) continue;
    if (!force && message.nextAttemptAt && Date.now() < Date.parse(message.nextAttemptAt)) continue;
    if (!adapter || typeof adapter.send !== "function") continue;
    let result;
    try { result = adapter.send(message.endpoint || message.worker, message.payload); }
    catch (error) { result = { delivered: false, error: error.message }; }
    results.push(markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered: result !== false && result?.delivered !== false, evidence: result }));
  }
  return results;
}

function retryMessages({ roots, adapter, force = false, maxAgeMs = 24 * 60 * 60 * 1000, baseBackoffMs = 1000, maxBackoffMs = 60 * 60 * 1000 }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => retryMessagesUnlocked({ roots, adapter, force, maxAgeMs, baseBackoffMs, maxBackoffMs }));
}

function eventId(input) {
  return `E-${digest(`${input.dedupKey || ""}:${input.eventType}:${input.taskId || ""}:${input.generation ?? ""}:${digest(input.evidence || "")}`).slice(0, 24)}`;
}

function createObserverEvent({ roots, eventType, dedupKey, taskId, projectId, worker, generation, endpoint, evidence, source = "observer", observedAt = isoNow() }) {
  if (!eventType || !dedupKey) throw new EventValidationError("Event type and deduplication key are required");
  initCoordination(roots.foremanHome);
  if (taskId) {
    const taskMetaFile = path.join(roots.foremanHome, "state", "tasks", taskId, "meta.json");
    if (fs.existsSync(taskMetaFile)) {
      const taskMeta = validateTaskMetaRecord(readJson(taskMetaFile), taskId);
      if (projectId && taskMeta.projectId !== projectId) throw new EventValidationError("Event project does not match the task project");
    }
  }
  const id = eventId({ eventType, dedupKey, taskId, generation, evidence });
  const dirs = coordinationDirs(roots.foremanHome);
  for (const state of ["pending", "processing", "handled"]) {
    const existing = path.join(dirs[`${state}Events`], `${id}.json`);
    if (fs.existsSync(existing)) return { event: validateEventRecord(readJson(existing), id), duplicate: true };
  }
  const file = eventFile(roots.foremanHome, "pending", id);
  const event = { schemaVersion: 1, eventId: id, dedupKey, taskId: taskId || null, projectId: projectId || null, worker: worker || null, generation: generation === undefined ? null : Number(generation), endpoint: endpoint || null, eventType, observedAt, source, evidence: evidence || null, status: "pending", createdAt: isoNow(), processingStartedAt: null, handledAt: null, handlingResult: null };
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(event, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { event: validateEventRecord(event, id), duplicate: false };
  } catch (error) {
    if (error.code === "EEXIST") return { event: validateEventRecord(readJson(file), id), duplicate: true };
    throw error;
  }
}

function listEvents({ roots, state = "pending" } = {}) {
  initCoordination(roots.foremanHome);
  const dir = coordinationDirs(roots.foremanHome)[`${state}Events`];
  if (!dir) throw new EventValidationError(`Unknown event state: ${state}`);
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => validateEventRecord(readJson(path.join(dir, name)), name.slice(0, -5)));
}

function drainWakeQueue({ roots, handler, limit = 100 }) {
  const { withHomeLock } = require("./foreman");
  initCoordination(roots.foremanHome);
  const dirs = coordinationDirs(roots.foremanHome);
  const processed = [];
  for (const event of listEvents({ roots, state: "pending" }).slice(0, limit)) {
    const claimed = withHomeLock(roots.foremanHome, () => {
      const pending = path.join(dirs.pendingEvents, `${event.eventId}.json`);
      const processing = path.join(dirs.processingEvents, `${event.eventId}.json`);
      try {
        fs.renameSync(pending, processing);
        const claimed = validateEventRecord({ ...event, status: "processing", processingStartedAt: isoNow() }, event.eventId);
        atomicJson(processing, claimed);
        return true;
      } catch (_) { return false; }
    });
    if (!claimed) continue;
    let result;
    try { result = handler ? handler(event) : { handled: true }; }
    catch (error) { result = { handled: false, error: error.message }; }
    const next = withHomeLock(roots.foremanHome, () => {
      const processing = path.join(dirs.processingEvents, `${event.eventId}.json`);
      const current = fs.existsSync(processing) ? validateEventRecord(readJson(processing), event.eventId) : event;
      if (result && result.handled === false) {
        const pending = validateEventRecord({ ...current, status: "pending", processingStartedAt: null, handlingResult: result, lastHandlingFailureAt: isoNow() }, event.eventId);
        atomicJson(path.join(dirs.pendingEvents, `${event.eventId}.json`), pending);
        try { fs.unlinkSync(processing); } catch (_) {}
        return pending;
      }
      const handled = validateEventRecord({ ...current, status: "handled", processingStartedAt: current.processingStartedAt || isoNow(), handledAt: isoNow(), handlingResult: result }, event.eventId);
      atomicJson(path.join(dirs.handledEvents, `${event.eventId}.json`), handled);
      try { fs.unlinkSync(processing); } catch (_) {}
      return handled;
    });
    processed.push(next);
  }
  return processed;
}

function recoverProcessingEventsUnlocked({ roots, maxAgeMs = 60_000 }) {
  initCoordination(roots.foremanHome);
  const dirs = coordinationDirs(roots.foremanHome);
  let count = 0;
  for (const event of listEvents({ roots, state: "processing" })) {
    if (event.processingStartedAt && Date.now() - Date.parse(event.processingStartedAt) < maxAgeMs) continue;
    try {
      const pending = validateEventRecord({ ...event, status: "pending", processingStartedAt: null }, event.eventId);
      atomicJson(path.join(dirs.pendingEvents, `${event.eventId}.json`), pending);
      fs.unlinkSync(path.join(dirs.processingEvents, `${event.eventId}.json`));
      count += 1;
    } catch (_) {}
  }
  return count;
}

function recoverProcessingEvents({ roots, maxAgeMs = 60_000 }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => recoverProcessingEventsUnlocked({ roots, maxAgeMs }));
}

function retainHandledEvents({ roots, maxAgeMs = 7 * 24 * 60 * 60 * 1000 }) {
  initCoordination(roots.foremanHome);
  const dir = coordinationDirs(roots.foremanHome).handledEvents;
  const cutoff = Date.now() - Math.max(0, Number(maxAgeMs) || 0);
  let removed = 0;
  for (const event of listEvents({ roots, state: "handled" })) {
    const at = Date.parse(event.handledAt || event.createdAt || "");
    if (Number.isFinite(at) && at < cutoff) {
      try { fs.unlinkSync(path.join(dir, `${event.eventId}.json`)); removed += 1; } catch (_) {}
    }
  }
  return removed;
}

function activeTaskMetas(roots) {
  const root = path.join(roots.foremanHome, "state", "tasks");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((id) => fs.existsSync(metaPath(roots, id))).map((taskId) => ({ taskId, meta: validateTaskMetaRecord(readJson(metaPath(roots, taskId)), taskId) }));
}

function metaPath(roots, taskId) { return path.join(roots.foremanHome, "state", "tasks", taskId, "meta.json"); }

function runtimeWorkerFor(meta, workers) {
  if (meta.endpoint) return workers.find((worker) => worker.endpoint === meta.endpoint || worker.endpointId === meta.endpoint || worker.name === meta.endpoint || worker.agent === meta.endpoint || worker.pane_id === meta.endpoint);
  return workers.find((worker) => worker.owner === meta.owner || worker.name === meta.owner);
}

function validWorkerPackage(meta, type) {
  const file = type === "completion" ? meta.completionPackage : meta.blockerPackage;
  if (!file || !fs.existsSync(file)) return false;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const headers = Object.fromEntries(raw.split(/\r?\n/).slice(0, 24).map((line) => line.match(/^([A-Z _]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2]]));
    return headers.TASK === meta.taskId && headers.PROJECT === meta.projectId && (headers.AGENT || "").replace(/^@/, "") === meta.owner && Number(headers.GENERATION) === Number(meta.generation) && String(headers.TYPE || "").toLowerCase() === type;
  } catch (_) { return false; }
}

function classifyRuntime(meta, worker, { requirePackage = true } = {}) {
  if (!meta.endpoint) return meta.status === "pending" ? "pending" : "unknown";
  if (!worker) return "missing";
  if (worker.endpoint && worker.endpoint !== meta.endpoint && worker.endpointId !== meta.endpoint && worker.pane_id !== meta.endpoint && worker.name !== meta.endpoint) return "mismatch";
  if (worker.owner && worker.owner !== meta.owner && worker.name !== meta.owner) return "mismatch";
  if (meta.status === "blocked") return !requirePackage || validWorkerPackage(meta, "blocker") ? "blocked" : "unknown";
  const status = String(worker.status || worker.agent_status || "unknown").toLowerCase();
  if (["done", "completed", "complete", "exited"].includes(status)) return !requirePackage || validWorkerPackage(meta, "completion") ? "done" : "unknown";
  if (["dead", "crashed", "terminated"].includes(status)) return "dead";
  if (["idle", "waiting"].includes(status)) return "idle";
  if (["working", "running", "busy"].includes(status)) return "working";
  return "unknown";
}

function readLastObservation(roots) {
  const file = path.join(coordinationDirs(roots.foremanHome).observer, "last-observation.json");
  if (!fs.existsSync(file)) return { observedAt: null, tasks: [] };
  const record = readJson(file);
  assertSchemaVersion(record, "Observer observation");
  if (!Array.isArray(record.tasks)) throw new SchemaValidationError("Observer observation tasks are invalid");
  return record;
}

function taskConsistencyEvidence({ roots, meta, messages }) {
  const issues = [];
  const evidence = { project: true, workspace: true, branch: true, lease: true, messages: true, inbox: true, generation: true, endpoint: true };
  if (["working", "pending-ack", "blocked", "waiting-decision"].includes(meta.status) && !meta.endpoint) {
    evidence.endpoint = false;
    issues.push({ type: "task.endpoint-missing", reason: "active assignment has no runtime endpoint" });
  }
  try {
    const { findProject, gitBranch, gitCommonDir } = require("./foreman");
    const project = findProject(roots.foremanHome, meta.projectId);
    if (meta.workspace && (!fs.existsSync(meta.workspace) || fs.realpathSync(meta.workspace) !== meta.workspace)) {
      evidence.workspace = false; issues.push({ type: "task.workspace-missing", reason: "workspace is missing or not canonical" });
    }
    if (meta.workspace && fs.existsSync(meta.workspace)) {
      try { if (gitBranch(meta.workspace) !== meta.branch) { evidence.branch = false; issues.push({ type: "task.branch-mismatch", expected: meta.branch, actual: gitBranch(meta.workspace) }); } }
      catch (error) { evidence.branch = false; issues.push({ type: "task.branch-unreadable", reason: error.message }); }
    }
    if (meta.workspace && fs.existsSync(meta.workspace) && gitCommonDir(meta.workspace) !== gitCommonDir(project.root)) {
      evidence.project = false; issues.push({ type: "task.project-mismatch", reason: "workspace belongs to a different Git project" });
    }
  } catch (error) {
    evidence.project = false; issues.push({ type: "task.project-invalid", reason: error.message });
  }
  if (meta.resourceLease) {
    try {
      const state = readJson(path.join(roots.foremanHome, "state", "resources.json"));
      const lease = (state.leases || []).find((item) => item.leaseId === meta.resourceLease.leaseId);
      if (!lease || lease.taskId !== meta.taskId || lease.owner !== meta.owner || Number(lease.generation) !== Number(meta.generation) || (lease.expiresAt && lease.expiresAt <= Date.now())) {
        evidence.lease = false; issues.push({ type: "task.resource-lease-invalid", reason: "lease identity or expiry does not match" });
      }
    } catch (error) { evidence.lease = false; issues.push({ type: "task.resource-lease-invalid", reason: error.message }); }
  } else if (["working", "pending-ack", "blocked", "waiting-decision"].includes(meta.status)) {
    evidence.lease = false; issues.push({ type: "task.resource-lease-missing", reason: "active assignment has no resource lease" });
  }
  for (const message of messages.filter((item) => item.taskId === meta.taskId && ["pending", "delivered", "acknowledged"].includes(item.status) && (item.generation === meta.generation || ["pending", "delivered"].includes(item.status)))) {
    if (message.projectId !== meta.projectId || message.worker !== meta.owner || message.generation !== meta.generation || message.endpoint !== meta.endpoint) {
      evidence.messages = false; issues.push({ type: "task.message-stale", messageId: message.messageId, reason: "message identity does not match current assignment" });
    }
  }
  const inbox = path.join(roots.foremanHome, "state", "tasks", meta.taskId, "inbox");
  if (fs.existsSync(inbox)) {
    for (const name of fs.readdirSync(inbox)) {
      if (name === "quarantine" || name.endsWith(".tmp")) continue;
      const file = path.join(inbox, name);
      if (!fs.statSync(file).isFile()) continue;
      const raw = fs.readFileSync(file, "utf8");
      const packageMatch = name.match(/^generation-(\d+)-(progress|completion|blocker)\.md$/);
      try {
        if (packageMatch) {
          const headers = Object.fromEntries(raw.split(/\r?\n/).slice(0, 24).map((line) => line.match(/^([A-Z _]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2]]));
          if (Number(packageMatch[1]) !== meta.generation || headers.TASK !== meta.taskId || headers.PROJECT !== meta.projectId || (headers.AGENT || "").replace(/^@/, "") !== meta.owner || String(headers.TYPE || "").toLowerCase() !== packageMatch[2]) throw new Error("package identity does not match current generation");
        } else if (name.endsWith(".json")) {
          const ack = JSON.parse(raw);
          if (ack.schemaVersion !== 1 || !ack.messageId || ack.taskId !== meta.taskId || ack.projectId !== meta.projectId || ack.worker !== meta.owner || typeof ack.generation !== "number" || !Number.isInteger(ack.generation) || ack.generation !== meta.generation || !ack.payloadDigest || !(ack.timestamp || ack.acknowledgedAt) || !Number.isFinite(Date.parse(ack.timestamp || ack.acknowledgedAt))) throw new Error("acknowledgement identity is invalid");
        } else throw new Error("unrecognized inbox package");
      } catch (error) {
        evidence.inbox = false;
        issues.push({ type: "task.inbox-invalid", name, reason: error.message });
      }
    }
  }
  return { evidence, issues };
}

function reconcileFleetUnlocked({ roots, adapter, emitEvents = true, missingConfirmationMs = 1000, requireCompletionPackage = true }) {
  initCoordination(roots.foremanHome);
  let workers = [];
  if (adapter && typeof adapter.list === "function") workers = adapter.list() || [];
  const previous = readLastObservation(roots);
  const previousTasks = new Map((previous.tasks || []).map((item) => [item.taskId, item]));
  const messages = listMessages({ roots });
  const states = [];
  for (const { taskId, meta } of activeTaskMetas(roots)) {
    if (["accepted", "review-ready", "cleaned"].includes(meta.status)) continue;
    const worker = runtimeWorkerFor(meta, workers);
    const consistency = taskConsistencyEvidence({ roots, meta, messages });
    if (worker?.projectId && worker.projectId !== meta.projectId) consistency.issues.push({ type: "task.runtime-project-mismatch", expected: meta.projectId, actual: worker.projectId });
    if (worker?.cwd && meta.workspace && path.resolve(worker.cwd) !== path.resolve(meta.workspace)) consistency.issues.push({ type: "task.runtime-workspace-mismatch", expected: meta.workspace, actual: worker.cwd });
    if (worker?.branch && meta.branch && worker.branch !== meta.branch) consistency.issues.push({ type: "task.runtime-branch-mismatch", expected: meta.branch, actual: worker.branch });
    if (consistency.issues.some((issue) => issue.type.startsWith("task.runtime-"))) consistency.evidence.endpoint = false;
    let state = classifyRuntime(meta, worker, { requirePackage: requireCompletionPackage });
    const prior = previousTasks.get(taskId);
    let missingSince = prior?.missingSince || null;
    let missingCount = Number(prior?.missingCount || 0);
    if (!worker && meta.endpoint) {
      missingSince = missingSince || isoNow();
      missingCount += 1;
      const confirmed = missingConfirmationMs <= 0 || (Date.now() - Date.parse(missingSince) >= missingConfirmationMs);
      state = confirmed ? "missing" : "unknown";
    } else {
      missingSince = null;
      missingCount = 0;
    }
    if (consistency.issues.length && state !== "dead" && state !== "missing") state = "unknown";
    const item = { taskId, meta, worker, state, consistency: consistency.evidence, issues: consistency.issues, missingSince, missingCount };
    states.push(item);
    if (emitEvents) {
      const currentEvidence = { generation: meta.generation, consistency: consistency.evidence, worker: worker || null };
      const transition = !prior || prior.state !== state || digest(prior.evidence || {}) !== digest(currentEvidence);
      if (transition && ["missing", "dead", "mismatch", "unknown", "blocked", "done", "idle"].includes(state)) {
        createObserverEvent({ roots, eventType: `worker.${state}`, dedupKey: `${taskId}:${meta.generation}:${meta.endpoint || "none"}:${state}:${digest(worker || { state, consistency: consistency.evidence })}`, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, endpoint: meta.endpoint, evidence: { worker: worker || null, consistency: consistency.evidence, issues: consistency.issues, missingSince, missingCount }, source: "reconciliation" });
      }
      for (const issue of consistency.issues) createObserverEvent({ roots, eventType: issue.type, dedupKey: `${taskId}:${meta.generation}:${issue.type}:${digest(issue)}`, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, endpoint: meta.endpoint, evidence: issue, source: "reconciliation" });
    }
  }
  const knownEndpoints = new Set(states.map((item) => item.meta.endpoint).filter(Boolean));
  for (const worker of workers) {
    const endpoint = worker.endpoint || worker.endpointId || worker.pane_id || worker.name;
    if (endpoint && !knownEndpoints.has(endpoint) && emitEvents) createObserverEvent({ roots, eventType: "worker.orphan", dedupKey: `orphan:${endpoint}`, worker: worker.owner || worker.name, endpoint, evidence: worker, source: "reconciliation" });
  }
  return { workers, tasks: states };
}

function reconcileFleet({ roots, adapter, emitEvents = true, missingConfirmationMs = 1000, requireCompletionPackage = true }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => {
    const result = reconcileFleetUnlocked({ roots, adapter, emitEvents, missingConfirmationMs, requireCompletionPackage });
    atomicJson(path.join(coordinationDirs(roots.foremanHome).observer, "last-observation.json"), { schemaVersion: 1, observedAt: isoNow(), taskCount: result.tasks.length, workerCount: result.workers.length, tasks: result.tasks.map(({ taskId, meta, state, consistency, missingSince, missingCount, worker }) => ({ taskId, state, evidence: { generation: meta.generation, consistency, worker: worker || null }, missingSince, missingCount })) });
    return result;
  });
}

function observeOnce({ roots, adapter, missingConfirmationMs = 1000 }) {
  const { withHomeLock } = require("./foreman");
  const result = withHomeLock(roots.foremanHome, () => reconcileFleetUnlocked({ roots, adapter, emitEvents: true, missingConfirmationMs }));
  atomicJson(path.join(coordinationDirs(roots.foremanHome).observer, "last-observation.json"), { schemaVersion: 1, observedAt: isoNow(), taskCount: result.tasks.length, workerCount: result.workers.length, tasks: result.tasks.map(({ taskId, meta, state, consistency, missingSince, missingCount, worker }) => ({ taskId, state, evidence: { generation: meta.generation, consistency, worker: worker || null }, missingSince, missingCount })) });
  return result;
}

class DeterministicObserver {
  constructor({ roots, adapter, intervalMs = 1000, wake, wakeCooldownMs } = {}) {
    this.roots = roots;
    this.adapter = adapter;
    this.intervalMs = Math.max(100, Number(intervalMs) || 1000);
    this.wake = wake;
    this.wakeCooldownMs = Math.max(100, Number(wakeCooldownMs ?? intervalMs) || intervalMs);
    this.lastWakeAt = 0;
    this.timer = null;
    this.running = false;
  }

  runOnce() {
    const result = observeOnce({ roots: this.roots, adapter: this.adapter });
    const pending = listEvents({ roots: this.roots, state: "pending" });
    if (pending.length && typeof this.wake === "function" && Date.now() - this.lastWakeAt >= this.wakeCooldownMs) {
      this.lastWakeAt = Date.now();
      this.wake({ pending: pending.slice(0, 100), result });
    }
    return result;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      try { this.runOnce(); } finally { this.timer = setTimeout(tick, this.intervalMs); }
    };
    tick();
    return this;
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function buildHandoffPackage({ roots, taskId, reason = "recovery" }) {
  const dir = path.join(roots.foremanHome, "data", "tasks", taskId);
  const state = path.join(roots.foremanHome, "state", "tasks", taskId);
  const meta = validateTaskMetaRecord(readJson(path.join(state, "meta.json")), taskId);
  const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const decisionsDir = path.join(dir, "decisions");
  const decisions = fs.existsSync(decisionsDir) ? fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const decision = readJson(path.join(decisionsDir, name));
    assertSchemaVersion(decision, "Decision", { field: "decisionId", value: name.slice(0, -5) });
    if (decision.taskId !== taskId || decision.projectId !== meta.projectId || typeof decision.generation !== "number" || decision.generation > meta.generation) throw new SchemaValidationError(`Decision identity is stale: ${name}`);
    return decision;
  }) : [];
  const evidenceFile = path.join(state, "evidence.json");
  const unresolvedFile = path.join(state, "unresolved-checks.json");
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
    decisionsVerbatim: read(path.join(dir, "decisions.md")),
    progress: read(path.join(state, "progress")),
    report: read(path.join(dir, "report.md")),
    workspace: meta.workspace,
    branch: meta.branch,
    resources: meta.resources || [],
    resourceLease: meta.resourceLease || null,
    evidence: meta.evidence || (fs.existsSync(evidenceFile) ? read(evidenceFile) : null),
    unresolvedChecks: meta.unresolvedChecks || (fs.existsSync(unresolvedFile) ? read(unresolvedFile) : []),
    inspectFirst: "Inspect the existing workspace, current branch, leased resources, latest progress, report, and unresolved checks before changing anything. Treat prior worker claims as evidence to verify, not assumptions.",
    createdAt: isoNow(),
  };
}

module.exports = {
  CoordinationError, MessageValidationError, EventValidationError, SchemaValidationError, SUPPORTED_SCHEMA_VERSION,
  assertSchemaVersion, validateTaskMetaRecord, validateMessageRecord, validateEventRecord, quarantineExternal,
  digest, initCoordination, coordinationDirs, messageFile, createMessageUnlocked, createMessage,
  updateMessageUnlocked, acknowledgeMessage, listMessages, markMessageDeliveryUnlocked, retryMessages, retryMessagesUnlocked, failMessageUnlocked,
  eventId, createObserverEvent, listEvents, drainWakeQueue, recoverProcessingEvents, recoverProcessingEventsUnlocked, retainHandledEvents,
  observeOnce, DeterministicObserver, reconcileFleet, reconcileFleetUnlocked, classifyRuntime, buildHandoffPackage,
};
