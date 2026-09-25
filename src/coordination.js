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
  if (!meta.status || !["routing", "queued", "pending", "pending-ack", "working", "blocked", "waiting-decision", "review-ready", "accepted", "cleaned"].includes(meta.status)) throw new SchemaValidationError(`Task metadata status is invalid: ${taskId || meta.taskId}`);
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
    workerEvents: path.join(home, "state", "events", "worker"),
    connections: path.join(home, "state", "connections"),
    wake: path.join(home, "state", "wake"),
    observer: path.join(home, "state", "observer"),
  };
}

function initCoordination(home) {
  const dirs = coordinationDirs(home);
  for (const key of ["messages", "workerEvents", "connections", "wake", "observer"]) fs.mkdirSync(dirs[key], { recursive: true, mode: 0o700 });
  migrateLegacyEvents(home);
  return dirs;
}

function messageFile(home, messageId) { return path.join(coordinationDirs(home).messages, `${messageId}.json`); }

function deliveryEnvelope({ roots, message }) {
  return {
    schemaVersion: 1,
    messageId: message.messageId,
    taskId: message.taskId,
    projectId: message.projectId,
    worker: message.worker,
    generation: message.generation,
    endpoint: message.endpoint,
    kind: message.kind,
    payloadDigest: message.payloadDigest,
    ackPath: path.join(roots.foremanHome, "state", "tasks", message.taskId, "inbox", `generation-${message.generation}-ack-${message.messageId}.json`),
    payload: message.payload,
  };
}

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

function safeToken(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(text)) throw new EventValidationError(`${label} is invalid`);
  return text;
}

function eventBucket(taskId) { return taskId ? safeToken(taskId, "Event task") : "_fleet"; }

function workerEventFile(home, taskId, id) {
  return path.join(coordinationDirs(home).workerEvents, eventBucket(taskId), `${safeToken(id, "Event")}.json`);
}

function connectionFile(home, taskId, worker) {
  return path.join(coordinationDirs(home).connections, `${safeToken(taskId, "Task")}-${safeToken(worker, "Worker")}.json`);
}

function migrateLegacyEvents(home) {
  for (const state of ["pending", "processing", "handled"]) {
    const dir = path.join(home, "state", "events", state);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const from = path.join(dir, name);
      let event;
      try { event = readJson(from); } catch (_) { continue; }
      if (!event?.eventId) continue;
      const target = workerEventFile(home, event.taskId, event.eventId);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (fs.existsSync(target)) { try { fs.unlinkSync(from); } catch (_) {} continue; }
      try { fs.renameSync(from, target); } catch (_) {}
    }
  }
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
  return withHomeLock(roots.foremanHome, () => {
    const acknowledged = updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
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
    }});
    noteWorkerAckUnlocked({ roots, taskId: acknowledged.taskId, worker: acknowledged.worker, generation: acknowledged.generation, messageId: acknowledged.messageId });
    return acknowledged;
  });
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
  const messages = listMessages({ roots, statuses: ["pending"] });
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
    try { result = adapter.send(message.endpoint || message.worker, deliveryPrompt(message)); }
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

function findEventFile(home, id) {
  const root = coordinationDirs(home).workerEvents;
  if (!fs.existsSync(root)) return null;
  for (const bucket of fs.readdirSync(root)) {
    const dir = path.join(root, bucket);
    if (!fs.statSync(dir).isDirectory()) continue;
    const file = path.join(dir, `${id}.json`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function walkWorkerEvents(home) {
  initCoordination(home);
  const root = coordinationDirs(home).workerEvents;
  const events = [];
  if (!fs.existsSync(root)) return events;
  for (const bucket of fs.readdirSync(root)) {
    const dir = path.join(root, bucket);
    let names;
    try { if (!fs.statSync(dir).isDirectory()) continue; names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try { events.push(validateEventRecord(readJson(path.join(dir, name)), name.slice(0, -5))); } catch (_) {}
    }
  }
  return events;
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
  const existing = findEventFile(roots.foremanHome, id);
  if (existing) {
    const duplicate = { event: validateEventRecord(readJson(existing), id), duplicate: true };
    signalWake(roots);
    return duplicate;
  }
  const file = workerEventFile(roots.foremanHome, taskId, id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const event = { schemaVersion: 1, eventId: id, dedupKey, taskId: taskId || null, projectId: projectId || null, worker: worker || null, generation: generation === undefined ? null : Number(generation), endpoint: endpoint || null, eventType, observedAt, source, evidence: evidence || null, status: "pending", createdAt: isoNow(), processingStartedAt: null, handledAt: null, handlingResult: null };
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(event, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const created = { event: validateEventRecord(event, id), duplicate: false };
    signalWake(roots);
    return created;
  } catch (error) {
    if (error.code === "EEXIST") {
      signalWake(roots);
      return { event: validateEventRecord(readJson(file), id), duplicate: true };
    }
    throw error;
  }
}

function listEvents({ roots, state = "pending" } = {}) {
  if (!["pending", "processing", "handled"].includes(state)) throw new EventValidationError(`Unknown event state: ${state}`);
  return walkWorkerEvents(roots.foremanHome).filter((event) => event.status === state);
}

function claimPath(file) { return `${file}.claim`; }

function readClaim(file) {
  const claim = claimPath(file);
  if (!fs.existsSync(claim)) return null;
  try { return { ...readJson(claim), file: claim, mtimeMs: fs.statSync(claim).mtimeMs }; }
  catch (_) { return { file: claim, mtimeMs: fs.statSync(claim).mtimeMs }; }
}

function signalWake(roots) {
  initCoordination(roots.foremanHome);
  const pending = walkWorkerEvents(roots.foremanHome)
    .filter((event) => event.status === "pending")
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.eventId.localeCompare(right.eventId));
  const latest = pending[pending.length - 1] || null;
  const signal = { schemaVersion: 1, version: 1, pending: pending.length > 0, pendingCount: pending.length, lastEventId: latest ? latest.eventId : null, lastEventType: latest ? latest.eventType : null, taskId: latest ? latest.taskId : null, updatedAt: isoNow() };
  atomicJson(path.join(coordinationDirs(roots.foremanHome).wake, "foreman.json"), signal);
  return signal;
}

function readWakeSignal(roots) {
  const file = path.join(roots.foremanHome, "state", "wake", "foreman.json");
  if (!fs.existsSync(file)) return null;
  const signal = readJson(file);
  assertSchemaVersion(signal, "Wake signal");
  if (!Number.isInteger(signal.pendingCount) || signal.pendingCount < 0 || signal.pending !== signal.pendingCount > 0) throw new SchemaValidationError("Wake signal is invalid");
  return signal;
}

function drainWakeQueue({ roots, handler, limit = 100, eventFilter } = {}) {
  const { withHomeLock } = require("./foreman");
  initCoordination(roots.foremanHome);
  const processed = [];
  for (const event of listEvents({ roots, state: "pending" }).filter((item) => !eventFilter || eventFilter(item)).slice(0, limit)) {
    const file = workerEventFile(roots.foremanHome, event.taskId, event.eventId);
    const claimed = withHomeLock(roots.foremanHome, () => {
      if (!fs.existsSync(file)) return false;
      const current = validateEventRecord(readJson(file), event.eventId);
      if (current.status !== "pending") return false;
      const existing = readClaim(file);
      if (existing && Date.now() - existing.mtimeMs < 60_000) return false;
      if (existing) { try { fs.unlinkSync(existing.file); } catch (_) {} }
      const fd = fs.openSync(claimPath(file), "wx", 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify({ schemaVersion: 1, eventId: event.eventId, claimedAt: isoNow() })}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      atomicJson(file, validateEventRecord({ ...current, status: "processing", processingStartedAt: isoNow() }, event.eventId));
      return true;
    });
    if (!claimed) continue;
    let result;
    try {
      result = typeof handler === "function" ? handler(event) : { handled: false, reason: "no handler" };
    } catch (error) { result = { handled: false, error: error.message }; }
    const next = withHomeLock(roots.foremanHome, () => {
      if (!fs.existsSync(file)) return null;
      const current = validateEventRecord(readJson(file), event.eventId);
      if (!result || result.handled !== true) {
        const pending = validateEventRecord({ ...current, status: "pending", processingStartedAt: null, handlingResult: result, lastHandlingFailureAt: isoNow() }, event.eventId);
        atomicJson(file, pending);
        try { fs.unlinkSync(claimPath(file)); } catch (_) {}
        return pending;
      }
      const handled = validateEventRecord({ ...current, status: "handled", processingStartedAt: current.processingStartedAt || isoNow(), handledAt: isoNow(), handlingResult: result }, event.eventId);
      atomicJson(file, handled);
      try { fs.unlinkSync(claimPath(file)); } catch (_) {}
      return handled;
    });
    if (next) processed.push(next);
  }
  signalWake(roots);
  return processed;
}

function recoverProcessingEventsUnlocked({ roots, maxAgeMs = 60_000 }) {
  initCoordination(roots.foremanHome);
  const cutoff = Date.now() - Math.max(0, Number(maxAgeMs) || 0);
  let count = 0;
  for (const event of walkWorkerEvents(roots.foremanHome)) {
    const file = workerEventFile(roots.foremanHome, event.taskId, event.eventId);
    const claim = readClaim(file);
    if (event.status === "processing") {
      const started = Date.parse(event.processingStartedAt || "");
      if (Number.isFinite(started) && started > cutoff) continue;
      try {
        atomicJson(file, validateEventRecord({ ...event, status: "pending", processingStartedAt: null }, event.eventId));
        if (claim) fs.unlinkSync(claim.file);
        count += 1;
      } catch (_) {}
    } else if (event.status === "pending" && claim && claim.mtimeMs <= cutoff) {
      try { fs.unlinkSync(claim.file); count += 1; } catch (_) {}
    }
  }
  return count;
}

function recoverProcessingEvents({ roots, maxAgeMs = 60_000 }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => recoverProcessingEventsUnlocked({ roots, maxAgeMs }));
}

function retainHandledEvents({ roots, maxAgeMs = 7 * 24 * 60 * 60 * 1000 }) {
  initCoordination(roots.foremanHome);
  const cutoff = Date.now() - Math.max(0, Number(maxAgeMs) || 0);
  let removed = 0;
  for (const event of listEvents({ roots, state: "handled" })) {
    const at = Date.parse(event.handledAt || event.createdAt || "");
    if (Number.isFinite(at) && at < cutoff) {
      const file = workerEventFile(roots.foremanHome, event.taskId, event.eventId);
      try { fs.unlinkSync(file); removed += 1; } catch (_) {}
      try { fs.unlinkSync(claimPath(file)); } catch (_) {}
    }
  }
  return removed;
}

function readConnectionFiles(home) {
  const dir = coordinationDirs(home).connections;
  if (!fs.existsSync(dir)) return [];
  const records = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "registry.json") continue;
    const record = readJson(path.join(dir, name));
    assertSchemaVersion(record, "Worker connection", { field: "taskId", value: record.taskId });
    if (!record.worker || !Number.isInteger(record.generation) || !record.projectId) throw new SchemaValidationError(`Worker connection identity is invalid: ${name}`);
    records.push(record);
  }
  return records;
}

function writeRegistryUnlocked(home) {
  const workers = {};
  for (const record of readConnectionFiles(home)) {
    if (record.retiredAt || record.status === "retired") continue;
    const key = record.endpoint || record.worker;
    workers[key] = { taskId: record.taskId, status: record.status, lastHeartbeat: record.lastHeartbeat || null, pid: record.pid ?? null, generation: record.generation, lastAck: record.lastAck ?? null, adapter: record.adapter || "herdr" };
  }
  const registry = { schemaVersion: 1, version: 1, totalActive: Object.values(workers).filter((item) => item.status === "active").length, lastUpdated: isoNow(), workers };
  atomicJson(path.join(coordinationDirs(home).connections, "registry.json"), registry);
  return registry;
}

function purgeTaskRecordsUnlocked({ roots, taskId }) {
  const dirs = initCoordination(roots.foremanHome);
  readConnectionFiles(roots.foremanHome);
  const taskBucket = path.join(dirs.workerEvents, eventBucket(taskId));
  const observerFile = path.join(dirs.observer, "last-observation.json");
  let observation = null;
  try { if (fs.existsSync(observerFile)) observation = readJson(observerFile); } catch (_) {}

  for (const name of fs.readdirSync(dirs.messages)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dirs.messages, name);
    try {
      if (readJson(file).taskId === taskId) fs.unlinkSync(file);
    } catch (_) {
      // Preserve malformed external records for later inspection.
    }
  }

  fs.rmSync(taskBucket, { recursive: true, force: true });
  for (const name of fs.readdirSync(dirs.connections)) {
    if (!name.endsWith(".json") || name === "registry.json") continue;
    const file = path.join(dirs.connections, name);
    try {
      if (readJson(file).taskId === taskId) fs.unlinkSync(file);
    } catch (_) {
      // Preserve malformed external records for later inspection.
    }
  }
  writeRegistryUnlocked(roots.foremanHome);

  if (observation && Array.isArray(observation.tasks)) {
    const tasks = observation.tasks.filter((item) => item.taskId !== taskId);
    atomicJson(observerFile, { ...observation, taskCount: tasks.length, tasks });
  }

  signalWake(roots);
}

function readWorkerRegistry(roots) {
  initCoordination(roots.foremanHome);
  const file = path.join(coordinationDirs(roots.foremanHome).connections, "registry.json");
  if (!fs.existsSync(file)) return { schemaVersion: 1, version: 1, totalActive: 0, lastUpdated: null, workers: {} };
  const registry = readJson(file);
  assertSchemaVersion(registry, "Worker registry");
  if (registry.version !== 1 || !Number.isInteger(registry.totalActive) || !registry.workers || typeof registry.workers !== "object") throw new SchemaValidationError("Worker registry is invalid");
  return registry;
}

function registryStatus(runtimeState) {
  if (runtimeState === "working") return "active";
  if (["idle", "blocked", "done", "dead", "missing", "unknown", "active"].includes(runtimeState)) return runtimeState;
  return "unknown";
}

function registerWorkerUnlocked({ roots, taskId, projectId, worker, endpoint, generation, status = "active", pid, lastAck, adapter = "herdr", lastHeartbeat } = {}) {
  if (!taskId || !projectId || !worker || !Number.isInteger(Number(generation))) throw new EventValidationError("Worker registration identity is incomplete");
  initCoordination(roots.foremanHome);
  const home = roots.foremanHome;
  const file = connectionFile(home, taskId, worker);
  let previous = {};
  if (fs.existsSync(file)) {
    previous = readJson(file);
    assertSchemaVersion(previous, "Worker connection", { field: "taskId", value: taskId });
  }
  for (const record of readConnectionFiles(home)) {
    if (record.taskId !== taskId || record.worker === worker || record.retiredAt) continue;
    atomicJson(connectionFile(home, record.taskId, record.worker), { ...record, status: "retired", retiredAt: isoNow() });
  }
  const next = {
    schemaVersion: 1,
    version: 1,
    taskId,
    projectId,
    worker,
    endpoint: endpoint === undefined ? (previous.endpoint || null) : endpoint,
    status,
    lastHeartbeat: lastHeartbeat === undefined ? (previous.lastHeartbeat || null) : lastHeartbeat,
    pid: Number.isInteger(pid) ? pid : (previous.pid ?? null),
    generation: Number(generation),
    lastAck: lastAck === undefined ? (previous.lastAck ?? null) : lastAck,
    adapter: adapter || previous.adapter || "herdr",
    updatedAt: isoNow(),
    retiredAt: null,
  };
  atomicJson(file, next);
  return { record: next, registry: writeRegistryUnlocked(home) };
}

function retireWorkerUnlocked({ roots, taskId, worker }) {
  initCoordination(roots.foremanHome);
  const file = connectionFile(roots.foremanHome, taskId, worker);
  if (fs.existsSync(file)) {
    const current = readJson(file);
    assertSchemaVersion(current, "Worker connection", { field: "taskId", value: taskId });
    if (!current.retiredAt) atomicJson(file, { ...current, status: "retired", retiredAt: isoNow() });
  }
  return writeRegistryUnlocked(roots.foremanHome);
}

function noteWorkerAckUnlocked({ roots, taskId, worker, generation, messageId }) {
  const file = connectionFile(roots.foremanHome, taskId, worker);
  if (!fs.existsSync(file)) return null;
  const current = readJson(file);
  assertSchemaVersion(current, "Worker connection", { field: "taskId", value: taskId });
  if (current.retiredAt || Number(current.generation) !== Number(generation)) return null;
  atomicJson(file, { ...current, lastAck: messageId, updatedAt: isoNow() });
  return writeRegistryUnlocked(roots.foremanHome);
}

function recordHeartbeatUnlocked({ roots, taskId, worker, generation, pid, endpoint }) {
  if (!taskId || !worker || !Number.isInteger(Number(generation))) throw new EventValidationError("Heartbeat identity is incomplete");
  const taskMetaFile = path.join(roots.foremanHome, "state", "tasks", taskId, "meta.json");
  if (!fs.existsSync(taskMetaFile)) throw new EventValidationError("Heartbeat task does not exist");
  const meta = validateTaskMetaRecord(readJson(taskMetaFile), taskId);
  if (meta.owner !== worker || meta.generation !== Number(generation) || (endpoint && meta.endpoint !== endpoint)) {
    quarantineExternal({ roots, taskId, name: "heartbeat.json", raw: JSON.stringify({ taskId, worker, generation, pid: pid ?? null, endpoint: endpoint || null }), reason: "heartbeat identity does not match the current assignment" });
    throw new EventValidationError("Heartbeat identity does not match the current assignment");
  }
  const file = connectionFile(roots.foremanHome, taskId, worker);
  if (!fs.existsSync(file)) throw new EventValidationError("Worker is not registered");
  const current = readJson(file);
  assertSchemaVersion(current, "Worker connection", { field: "taskId", value: taskId });
  if (current.retiredAt || current.status === "retired") throw new EventValidationError("Retired worker cannot record a heartbeat");
  return registerWorkerUnlocked({ roots, taskId, projectId: meta.projectId, worker, endpoint: meta.endpoint, generation: meta.generation, status: current.status, pid: Number.isInteger(pid) ? pid : current.pid, lastAck: current.lastAck ?? null, adapter: current.adapter || meta.backend || "herdr", lastHeartbeat: isoNow() });
}

function syncRegistryUnlocked({ roots, tasks }) {
  for (const item of tasks || []) {
    const meta = item.meta;
    if (!meta?.owner || !meta.taskId || !Number.isInteger(meta.generation) || meta.generation < 1 || !meta.endpoint) continue;
    const runtimePid = Number.isInteger(item.worker?.pid) ? item.worker.pid : undefined;
    registerWorkerUnlocked({ roots, taskId: meta.taskId, projectId: meta.projectId, worker: meta.owner, endpoint: meta.endpoint, generation: meta.generation, status: registryStatus(item.state), pid: runtimePid, adapter: meta.backend || "herdr" });
  }
  return writeRegistryUnlocked(roots.foremanHome);
}

function emitWorkerEventUnlocked({ roots, taskId, projectId, eventType, worker, generation, endpoint, payload }) {
  initCoordination(roots.foremanHome);
  const taskMetaFile = path.join(roots.foremanHome, "state", "tasks", taskId, "meta.json");
  if (!fs.existsSync(taskMetaFile)) throw new EventValidationError("Event task does not exist");
  const meta = validateTaskMetaRecord(readJson(taskMetaFile), taskId);
  const typeToken = String(eventType || "");
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(typeToken) || typeToken.startsWith("message.") || typeToken.startsWith("task.")) throw new EventValidationError("Event type is invalid");
  const normalized = typeToken.includes(".") ? typeToken : `worker.${typeToken}`;
  const boundGeneration = Number(generation);
  if (!projectId || !worker || !endpoint || !Number.isInteger(boundGeneration)
    || !meta.owner || !meta.endpoint || projectId !== meta.projectId || worker !== meta.owner
    || boundGeneration !== meta.generation || endpoint !== meta.endpoint) {
    quarantineExternal({ roots, taskId, name: `event-${normalized}.json`, raw: JSON.stringify({ taskId, projectId: projectId || null, eventType: normalized, worker: worker || null, generation: Number.isFinite(boundGeneration) ? boundGeneration : null, endpoint: endpoint || null, payload: payload ?? null }), reason: "event identity does not match the current assignment" });
    throw new EventValidationError("Event identity does not match the current assignment");
  }
  return createObserverEvent({ roots, eventType: normalized, dedupKey: `worker-emit:${taskId}:${boundGeneration}:${normalized}:${digest(payload ?? null)}`, taskId, projectId, worker, generation: boundGeneration, endpoint, evidence: { payload: payload ?? null, emittedBy: "worker" }, source: "worker" });
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
    const { findProject, gitBranch, projectVcs, workspaceBelongsToProject } = require("./foreman");
    const project = findProject(roots.foremanHome, meta.projectId);
    const hasGit = projectVcs(project) === "git";
    if (meta.workspace && (!fs.existsSync(meta.workspace) || fs.realpathSync(meta.workspace) !== meta.workspace)) {
      evidence.workspace = false; issues.push({ type: "task.workspace-missing", reason: "workspace is missing or not canonical" });
    }
    if (hasGit && meta.workspace && fs.existsSync(meta.workspace)) {
      try { if (gitBranch(meta.workspace) !== meta.branch) { evidence.branch = false; issues.push({ type: "task.branch-mismatch", expected: meta.branch, actual: gitBranch(meta.workspace) }); } }
      catch (error) { evidence.branch = false; issues.push({ type: "task.branch-unreadable", reason: error.message }); }
    }
    if (meta.workspace && fs.existsSync(meta.workspace) && !workspaceBelongsToProject(project, meta.workspace)) {
      evidence.project = false; issues.push({ type: "task.project-mismatch", reason: "workspace belongs to a different project" });
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
  for (const message of messages.filter((item) => item.taskId === meta.taskId && ["pending", "delivered", "acknowledged"].includes(item.status) && (item.generation === meta.generation || item.status === "pending"))) {
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
  const boundWorkers = new Set(states.map((item) => item.worker).filter(Boolean));
  for (const worker of workers) {
    const endpoint = worker.endpoint || worker.endpointId || worker.pane_id || worker.name;
    if (endpoint && !boundWorkers.has(worker) && !knownEndpoints.has(endpoint) && emitEvents) createObserverEvent({ roots, eventType: "worker.orphan", dedupKey: `orphan:${endpoint}`, worker: worker.owner || worker.name, endpoint, evidence: worker, source: "reconciliation" });
  }
  syncRegistryUnlocked({ roots, tasks: states });
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

function observeOnce({ roots, adapter, missingConfirmationMs = 1000, inboxSettleMs = 2000 }) {
  const { withHomeLock, reconcileInboxUnlocked } = require("./foreman");
  const result = withHomeLock(roots.foremanHome, () => {
    // Workers write acknowledgements without emitting an event, so each pass applies new ones.
    // Files are written in place; leave ones that may still be in progress for a later pass.
    for (const { taskId } of activeTaskMetas(roots)) reconcileInboxUnlocked({ roots, taskId, settleMs: inboxSettleMs, acknowledgementsOnly: true });
    return reconcileFleetUnlocked({ roots, adapter, emitEvents: true, missingConfirmationMs });
  });
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
      // A busy home lock or transient runtime failure skips this pass; the next tick observes again.
      try { this.runOnce(); } catch (_) {} finally { this.timer = setTimeout(tick, this.intervalMs); }
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

class WakeManager {
  constructor({ roots, onWake } = {}) {
    this.roots = roots;
    this.onWake = onWake;
    this.watcher = null;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return this;
    initCoordination(this.roots.foremanHome);
    this.running = true;
    const dir = coordinationDirs(this.roots.foremanHome).wake;
    const scheduleWake = () => {
      if (!this.running) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        try {
          const signal = readWakeSignal(this.roots);
          if (signal?.pendingCount > 0 && typeof this.onWake === "function") this.onWake(signal);
        } catch (_) {}
      }, 30);
    };
    this.watcher = fs.watch(dir, scheduleWake);
    scheduleWake();
    return this;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.watcher) this.watcher.close();
    this.watcher = null;
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
  digest, initCoordination, coordinationDirs, messageFile, deliveryEnvelope, deliveryPrompt, createMessageUnlocked, createMessage,
  updateMessageUnlocked, acknowledgeMessage, listMessages, markMessageDeliveryUnlocked, retryMessages, retryMessagesUnlocked, failMessageUnlocked,
  eventId, createObserverEvent, listEvents, drainWakeQueue, recoverProcessingEvents, recoverProcessingEventsUnlocked, retainHandledEvents,
  signalWake, readWakeSignal, registerWorkerUnlocked, retireWorkerUnlocked, noteWorkerAckUnlocked, recordHeartbeatUnlocked, syncRegistryUnlocked, readWorkerRegistry, emitWorkerEventUnlocked, purgeTaskRecordsUnlocked,
  observeOnce, DeterministicObserver, WakeManager, reconcileFleet, reconcileFleetUnlocked, classifyRuntime, buildHandoffPackage,
};
