const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class CoordinationError extends Error {}
class MessageValidationError extends CoordinationError {}
class EventValidationError extends CoordinationError {}

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

function createMessageUnlocked({ roots, taskId, projectId, worker, generation, endpoint, kind, payload, explicitId, maxAttempts = 5 }) {
  const input = { taskId, projectId, worker, generation, kind, payload };
  validateMessageInput(input);
  initCoordination(roots.foremanHome);
  const id = messageId({ ...input, explicitId });
  const file = messageFile(roots.foremanHome, id);
  if (fs.existsSync(file)) {
    const existing = readJson(file);
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
    lastAttemptAt: null,
    deliveredAt: null,
    acknowledgedAt: null,
    failedAt: null,
    transportEvidence: null,
    ack: null,
  };
  atomicJson(file, message);
  return message;
}

function createMessage({ roots, lock, ...input }) {
  if (lock) return createMessageUnlocked({ roots, ...input });
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => createMessageUnlocked({ roots, ...input }));
}

function updateMessageUnlocked({ roots, messageId: id, mutate }) {
  const file = messageFile(roots.foremanHome, id);
  if (!fs.existsSync(file)) throw new MessageValidationError(`Unknown message: ${id}`);
  const current = readJson(file);
  const next = mutate({ ...current });
  atomicJson(file, next);
  return next;
}

function acknowledgeMessage({ roots, messageId: id, ack }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    if (!ack || ack.messageId !== id || ack.taskId !== message.taskId || ack.projectId !== message.projectId || ack.worker !== message.worker || Number(ack.generation) !== message.generation || ack.payloadDigest !== message.payloadDigest) {
      throw new MessageValidationError("Acknowledgement identity or payload digest does not match the message");
    }
    if (message.status === "acknowledged") return message;
    message.status = "acknowledged";
    message.acknowledgedAt = isoNow();
    message.ack = ack;
    return message;
  }}));
}

function listMessages({ roots, statuses } = {}) {
  initCoordination(roots.foremanHome);
  const allowed = statuses ? new Set(statuses) : null;
  return fs.readdirSync(coordinationDirs(roots.foremanHome).messages).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(coordinationDirs(roots.foremanHome).messages, name))).filter((message) => !allowed || allowed.has(message.status));
}

function markMessageDeliveryUnlocked({ roots, messageId: id, delivered, evidence }) {
  return updateMessageUnlocked({ roots, messageId: id, mutate: (message) => {
    message.attempts += 1;
    message.lastAttemptAt = isoNow();
    message.transportEvidence = evidence || { delivered: Boolean(delivered) };
    if (delivered) {
      message.status = message.status === "acknowledged" ? "acknowledged" : "delivered";
      message.deliveredAt = message.deliveredAt || message.lastAttemptAt;
    } else if (message.attempts >= message.maxAttempts) {
      message.status = "failed";
      message.failedAt = message.lastAttemptAt;
    }
    return message;
  }});
}

function retryMessages({ roots, adapter, force = false, maxAgeMs = 24 * 60 * 60 * 1000 }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => {
    const messages = listMessages({ roots, statuses: ["pending", "delivered"] });
    const results = [];
    for (const message of messages) {
      const metaFilePath = path.join(roots.foremanHome, "state", "tasks", message.taskId, "meta.json");
      if (!fs.existsSync(metaFilePath)) {
        results.push(updateMessageUnlocked({ roots, messageId: message.messageId, mutate: (item) => ({ ...item, status: "failed", failedAt: item.failedAt || isoNow(), transportEvidence: { stale: true, reason: "task metadata is missing" } }) }));
        continue;
      }
      const meta = readJson(metaFilePath);
      if (meta.generation !== message.generation || meta.endpoint !== message.endpoint || meta.owner !== message.worker) {
        results.push(updateMessageUnlocked({ roots, messageId: message.messageId, mutate: (item) => ({ ...item, status: "failed", failedAt: item.failedAt || isoNow(), transportEvidence: { stale: true, reason: "message assignment generation is no longer current" } }) }));
        continue;
      }
      if (Date.now() - Date.parse(message.createdAt) > maxAgeMs) {
        results.push(updateMessageUnlocked({ roots, messageId: message.messageId, mutate: (item) => ({ ...item, status: "failed", failedAt: item.failedAt || isoNow() }) }));
        continue;
      }
      if (!force && message.status === "delivered" && message.lastAttemptAt && Date.now() - Date.parse(message.lastAttemptAt) < 1000) continue;
      if (!adapter || typeof adapter.send !== "function") continue;
      let result;
      try { result = adapter.send(message.endpoint || message.worker, message.payload); }
      catch (error) { result = { delivered: false, error: error.message }; }
      results.push(markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered: result !== false && result?.delivered !== false, evidence: result }));
    }
    return results;
  });
}

function eventId(input) {
  return `E-${digest(`${input.dedupKey || ""}:${input.eventType}:${input.taskId || ""}:${input.generation ?? ""}:${digest(input.evidence || "")}`).slice(0, 24)}`;
}

function createObserverEvent({ roots, eventType, dedupKey, taskId, projectId, worker, generation, endpoint, evidence, source = "observer", observedAt = isoNow() }) {
  if (!eventType || !dedupKey) throw new EventValidationError("Event type and deduplication key are required");
  initCoordination(roots.foremanHome);
  const id = eventId({ eventType, dedupKey, taskId, generation, evidence });
  const dirs = coordinationDirs(roots.foremanHome);
  for (const state of ["pending", "processing", "handled"]) {
    const existing = path.join(dirs[`${state}Events`], `${id}.json`);
    if (fs.existsSync(existing)) return { event: readJson(existing), duplicate: true };
  }
  const file = eventFile(roots.foremanHome, "pending", id);
  const event = { schemaVersion: 1, eventId: id, dedupKey, taskId: taskId || null, projectId: projectId || null, worker: worker || null, generation: generation === undefined ? null : Number(generation), endpoint: endpoint || null, eventType, observedAt, source, evidence: evidence || null, status: "pending", createdAt: isoNow(), processingStartedAt: null, handledAt: null, handlingResult: null };
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(event, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { event, duplicate: false };
  } catch (error) {
    if (error.code === "EEXIST") return { event: readJson(file), duplicate: true };
    throw error;
  }
}

function listEvents({ roots, state = "pending" } = {}) {
  initCoordination(roots.foremanHome);
  const dir = coordinationDirs(roots.foremanHome)[`${state}Events`];
  if (!dir) throw new EventValidationError(`Unknown event state: ${state}`);
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name)));
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
        const claimed = { ...event, status: "processing", processingStartedAt: isoNow() };
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
      const current = fs.existsSync(processing) ? readJson(processing) : event;
      if (result && result.handled === false) {
        const pending = { ...current, status: "pending", processingStartedAt: null, handlingResult: result, lastHandlingFailureAt: isoNow() };
        atomicJson(path.join(dirs.pendingEvents, `${event.eventId}.json`), pending);
        try { fs.unlinkSync(processing); } catch (_) {}
        return pending;
      }
      const handled = { ...current, status: "handled", processingStartedAt: current.processingStartedAt || isoNow(), handledAt: isoNow(), handlingResult: result };
      atomicJson(path.join(dirs.handledEvents, `${event.eventId}.json`), handled);
      try { fs.unlinkSync(processing); } catch (_) {}
      return handled;
    });
    processed.push(next);
  }
  return processed;
}

function recoverProcessingEvents({ roots, maxAgeMs = 60_000 }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => {
    initCoordination(roots.foremanHome);
    const dirs = coordinationDirs(roots.foremanHome);
    let count = 0;
    for (const event of listEvents({ roots, state: "processing" })) {
      if (event.processingStartedAt && Date.now() - Date.parse(event.processingStartedAt) < maxAgeMs) continue;
      try { fs.renameSync(path.join(dirs.processingEvents, `${event.eventId}.json`), path.join(dirs.pendingEvents, `${event.eventId}.json`)); count += 1; } catch (_) {}
    }
    return count;
  });
}

function activeTaskMetas(roots) {
  const root = path.join(roots.foremanHome, "state", "tasks");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((id) => fs.existsSync(metaPath(roots, id))).map((taskId) => ({ taskId, meta: readJson(metaPath(roots, taskId)) }));
}

function metaPath(roots, taskId) { return path.join(roots.foremanHome, "state", "tasks", taskId, "meta.json"); }

function runtimeWorkerFor(meta, workers) {
  return workers.find((worker) => worker.endpoint === meta.endpoint || worker.endpointId === meta.endpoint || worker.name === meta.endpoint || worker.agent === meta.endpoint || worker.pane_id === meta.endpoint || worker.owner === meta.owner || worker.name === meta.owner);
}

function classifyRuntime(meta, worker) {
  if (!meta.endpoint) return meta.status === "pending" ? "pending" : "unknown";
  if (!worker) return "missing";
  if (worker.endpoint && worker.endpoint !== meta.endpoint && worker.endpointId !== meta.endpoint && worker.pane_id !== meta.endpoint && worker.name !== meta.endpoint) return "mismatch";
  if (worker.owner && worker.owner !== meta.owner && worker.name !== meta.owner) return "mismatch";
  if (meta.status === "blocked") return "blocked";
  const status = String(worker.status || worker.agent_status || "unknown").toLowerCase();
  if (["done", "completed", "complete", "exited"].includes(status)) return "done";
  if (["dead", "crashed", "terminated"].includes(status)) return "dead";
  if (["idle", "waiting"].includes(status)) return "idle";
  if (["working", "running", "busy"].includes(status)) return "working";
  return "unknown";
}

function reconcileFleetUnlocked({ roots, adapter, emitEvents = true }) {
  initCoordination(roots.foremanHome);
  let workers = [];
  if (adapter && typeof adapter.list === "function") workers = adapter.list() || [];
  const states = [];
  for (const { taskId, meta } of activeTaskMetas(roots)) {
    if (["accepted", "review-ready", "cleaned"].includes(meta.status)) continue;
    const worker = runtimeWorkerFor(meta, workers);
    const state = classifyRuntime(meta, worker);
    const item = { taskId, meta, worker, state };
    states.push(item);
    if (emitEvents && ["missing", "dead", "mismatch", "unknown", "blocked", "done", "idle"].includes(state)) {
      createObserverEvent({ roots, eventType: `worker.${state}`, dedupKey: `${taskId}:${meta.generation}:${meta.endpoint || "none"}:${state}`, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, endpoint: meta.endpoint, evidence: worker || { reason: "runtime listing did not match" }, source: "reconciliation" });
    }
  }
  const knownEndpoints = new Set(states.map((item) => item.meta.endpoint).filter(Boolean));
  for (const worker of workers) {
    const endpoint = worker.endpoint || worker.endpointId || worker.pane_id || worker.name;
    if (endpoint && !knownEndpoints.has(endpoint) && emitEvents) createObserverEvent({ roots, eventType: "worker.orphan", dedupKey: `orphan:${endpoint}`, worker: worker.owner || worker.name, endpoint, evidence: worker, source: "reconciliation" });
  }
  return { workers, tasks: states };
}

function reconcileFleet({ roots, adapter, emitEvents = true }) {
  const { withHomeLock } = require("./foreman");
  return withHomeLock(roots.foremanHome, () => reconcileFleetUnlocked({ roots, adapter, emitEvents }));
}

function observeOnce({ roots, adapter }) {
  const result = reconcileFleet({ roots, adapter, emitEvents: true });
  atomicJson(path.join(coordinationDirs(roots.foremanHome).observer, "last-observation.json"), { observedAt: isoNow(), taskCount: result.tasks.length, workerCount: result.workers.length, states: result.tasks.map(({ taskId, state }) => ({ taskId, state })) });
  return result;
}

class DeterministicObserver {
  constructor({ roots, adapter, intervalMs = 1000, wake } = {}) {
    this.roots = roots;
    this.adapter = adapter;
    this.intervalMs = Math.max(100, Number(intervalMs) || 1000);
    this.wake = wake;
    this.timer = null;
    this.running = false;
  }

  runOnce() {
    const result = observeOnce({ roots: this.roots, adapter: this.adapter });
    const pending = listEvents({ roots: this.roots, state: "pending" });
    if (pending.length && typeof this.wake === "function") this.wake({ pending, result });
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
  const meta = readJson(path.join(state, "meta.json"));
  const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  return { schemaVersion: 1, taskId, projectId: meta.projectId, previousOwner: meta.owner, previousGeneration: meta.generation, reason, brief: read(path.join(dir, "brief.md")), decisions: read(path.join(dir, "decisions.md")), progress: read(path.join(state, "progress")), report: read(path.join(dir, "report.md")), workspace: meta.workspace, branch: meta.branch, resources: meta.resources || [], evidence: meta.evidence || null, unresolvedChecks: meta.unresolvedChecks || [] };
}

module.exports = {
  CoordinationError, MessageValidationError, EventValidationError,
  digest, initCoordination, coordinationDirs, messageFile, createMessageUnlocked, createMessage,
  updateMessageUnlocked, acknowledgeMessage, listMessages, markMessageDeliveryUnlocked, retryMessages,
  eventId, createObserverEvent, listEvents, drainWakeQueue, recoverProcessingEvents,
  observeOnce, DeterministicObserver, reconcileFleet, reconcileFleetUnlocked, classifyRuntime, buildHandoffPackage,
};
