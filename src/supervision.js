const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicJson, readJson, metaFile, assertSchemaVersion, validateTaskMetaRecord, SchemaValidationError } = require("./coordination");

// The Paseo heartbeat that wakes the Foreman session, and the notices Foreman has already told the user.
// `data/supervision.json` has one writer, the Foreman session through the CLI under the home lock.
// Task notices live in each task's `meta.notified` and leave with the task at acceptance or discard;
// fleet notices and the heartbeat record live in `data/supervision.json`.

const DEFAULT_HEARTBEAT_CRON = "*/5 * * * *";
const HEARTBEAT_NAME = "foreman-supervision";
const HEARTBEAT_PROMPT = [
  "Foreman supervision heartbeat.",
  "Follow the heartbeat turn in .agents/skills/foreman-paseo-heartbeat/SKILL.md: use the supervision context the prompt hook added,",
  "tell the user only what needs them, and end the turn without any text when nothing does.",
].join(" ");
// A heartbeat Foreman has not seen fire or confirmed for this long is checked again, because Paseo cannot list heartbeats.
const HEARTBEAT_CONFIRM_MS = 15 * 60 * 1000;
const CRON_FIELDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

// Rejects a cron Paseo would refuse, so a bad cadence is never saved; names such as MON are left to Paseo.
function validCron(cron) {
  const fields = String(cron).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, index) => field.split(",").every((token) => {
    const [range, step, extra] = token.split("/");
    if (extra !== undefined || (step !== undefined && !/^[1-9]\d*$/.test(step))) return false;
    if (range === "*" || /[A-Za-z]/.test(range)) return true;
    const bounds = range.split("-");
    if (bounds.length > 2 || !bounds.every((bound) => /^\d+$/.test(bound))) return false;
    const [min, max] = CRON_FIELDS[index];
    return bounds.every((bound) => Number(bound) >= min && Number(bound) <= max);
  }));
}

function supervisionFile(home) { return path.join(home, "data", "supervision.json"); }

function emptySupervision() { return { schemaVersion: 1, notified: {}, heartbeat: null, heartbeatCron: DEFAULT_HEARTBEAT_CRON, heartbeatEnabled: true }; }

function readSupervision(home) {
  const file = supervisionFile(home);
  if (!fs.existsSync(file)) return emptySupervision();
  const record = readJson(file);
  assertSchemaVersion(record, "Supervision record");
  if (!record.notified || typeof record.notified !== "object" || Array.isArray(record.notified)) throw new SchemaValidationError("Supervision record notices are invalid");
  if (record.heartbeat !== null && record.heartbeat !== undefined && (typeof record.heartbeat.heartbeatId !== "string" || typeof record.heartbeat.agentId !== "string")) throw new SchemaValidationError("Supervision heartbeat record is invalid");
  return { ...emptySupervision(), ...record };
}

function writeSupervisionUnlocked(home, record) { atomicJson(supervisionFile(home), { ...record, schemaVersion: 1 }); }

function shortDigest(text) { return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 12); }

// Notices the user needs, derived from durable task state; each key names exactly one event of one task.
function taskNotices(meta) {
  const base = { taskId: meta.taskId, projectId: meta.projectId, generation: meta.generation, round: meta.round || 1 };
  if (meta.status === "review-ready" && meta.completionReport) return [{ ...base, key: `${meta.taskId}/review-ready/${path.basename(meta.completionReport)}`, kind: "review-ready", report: meta.completionReport }];
  if (meta.status === "blocked" && meta.blockerReport) return [{ ...base, key: `${meta.taskId}/blocked/${path.basename(meta.blockerReport)}`, kind: "blocked", report: meta.blockerReport }];
  if (meta.status === "waiting-decision" && meta.decisionId) return [{ ...base, key: `${meta.taskId}/decision/${meta.decisionId}`, kind: "decision", decisionId: meta.decisionId }];
  return [];
}

// The same anomaly on the same assignment and round is one notice however long it lasts.
function anomalyNotice(issue, meta) {
  const generation = meta?.generation ?? "-";
  const round = meta?.round || 1;
  const detail = issue.reportFile ? `:${path.basename(issue.reportFile)}` : "";
  const changed = issue.reason ? `:${shortDigest(issue.reason)}` : "";
  return { taskId: issue.taskId, projectId: issue.projectId, generation, round, key: `${issue.taskId}/anomaly/${issue.type}:g${generation}:r${round}${detail}${changed}`, kind: "anomaly", type: issue.type, reason: issue.reason || null };
}

function runtimeNotice(message) {
  return { taskId: null, projectId: null, key: `fleet/runtime/${shortDigest(message)}`, kind: "runtime-error", reason: message };
}

function collectNotices({ metas, anomalies = [], runtimeError = null }) {
  const byId = new Map(metas.map((meta) => [meta.taskId, meta]));
  const notices = metas.flatMap(taskNotices);
  const seen = new Set(notices.map((notice) => notice.key));
  for (const issue of anomalies) {
    if (!byId.has(issue.taskId)) continue;
    const notice = anomalyNotice(issue, byId.get(issue.taskId));
    if (!seen.has(notice.key)) { seen.add(notice.key); notices.push(notice); }
  }
  if (runtimeError) notices.push(runtimeNotice(runtimeError));
  return notices;
}

function isNotified(notice, metasById, supervision) {
  if (!notice.taskId) return Boolean(supervision.notified[notice.key]);
  return Boolean(metasById.get(notice.taskId)?.notified?.[notice.key]);
}

function pendingNotices(home, notices, metas) {
  const metasById = new Map(metas.map((meta) => [meta.taskId, meta]));
  const supervision = readSupervision(home);
  return notices.filter((notice) => !isNotified(notice, metasById, supervision));
}

// Keeps only the marks of notices that are still current, so an event that ends and later recurs is told again.
// Anomaly marks are kept when the status check failed, because a failed check is not evidence that they cleared.
// Only tasks on the observed backend lose anomaly marks, because a check of one backend says nothing about the other.
function pruneNotifiedUnlocked(home, { notices, statusKnown, backend = null }) {
  const current = new Set(notices.map((notice) => notice.key));
  const tasksRoot = path.join(home, "data", "tasks");
  for (const taskId of fs.existsSync(tasksRoot) ? fs.readdirSync(tasksRoot) : []) {
    const file = metaFile(home, taskId);
    if (!fs.existsSync(file)) continue;
    const meta = validateTaskMetaRecord(readJson(file), taskId);
    const marks = meta.notified || {};
    const kept = Object.fromEntries(Object.entries(marks).filter(([key]) => current.has(key) || ((!statusKnown || (meta.backend || "herdr") !== backend) && key.startsWith(`${taskId}/anomaly/`))));
    if (Object.keys(kept).length !== Object.keys(marks).length) atomicJson(file, { ...meta, notified: kept });
  }
  const supervision = readSupervision(home);
  const fleet = Object.fromEntries(Object.entries(supervision.notified).filter(([key]) => current.has(key)));
  if (Object.keys(fleet).length !== Object.keys(supervision.notified).length) writeSupervisionUnlocked(home, { ...supervision, notified: fleet });
}

const NOTICE_KEY = /^(fleet|[TB]-\d+)\/(review-ready|blocked|decision|anomaly|runtime)\/\S+$/;

// Records that Foreman told the user about these notices; the key binds task, event, assignment, and round.
function ackNoticesUnlocked(home, keys, at) {
  if (!Array.isArray(keys) || !keys.length) throw new SchemaValidationError("notice ack requires at least one --key");
  // Every key is validated before the first write, so a bad key cannot leave the batch half recorded.
  const writes = keys.map((key) => {
    const match = NOTICE_KEY.exec(String(key));
    if (!match) throw new SchemaValidationError(`Invalid notice key: ${key}`);
    const [, owner] = match;
    if (owner === "fleet") return { key, owner };
    const file = metaFile(home, owner);
    if (!fs.existsSync(file)) throw new SchemaValidationError(`Unknown task for notice: ${key}`);
    return { key, owner, file, meta: validateTaskMetaRecord(readJson(file), owner) };
  });
  for (const { key, owner, file, meta } of writes) {
    if (owner === "fleet") {
      const supervision = readSupervision(home);
      writeSupervisionUnlocked(home, { ...supervision, notified: { ...supervision.notified, [key]: at } });
    } else {
      const current = validateTaskMetaRecord(readJson(file), owner);
      atomicJson(file, { ...current, notified: { ...(current.notified || {}), [key]: at } });
    }
  }
  return { acked: keys, at };
}

// A Paseo heartbeat prompt arrives as `<paseo-system>Schedule "NAME" fired (id=ID, run=RUN).\nPROMPT</paseo-system>`.
function parseHeartbeatPrompt(prompt) {
  const match = /<paseo-system>[\s\S]*?Schedule "([^"]*)" fired \(id=([^,)\s]+)/.exec(String(prompt || ""));
  return match ? { name: match[1], heartbeatId: match[2] } : null;
}

// A Paseo worker may still report, or a task notice is still untold: the heartbeat has something to watch.
// `anomalies` are the untold anomaly notices of the latest check, which no task record holds.
function heartbeatNeeded(metas, anomalies = []) {
  const paseo = metas.filter((meta) => (meta.backend || "herdr") === "paseo");
  if (paseo.some((meta) => meta.status === "working" && meta.endpoint)) return true;
  if (anomalies.some((notice) => paseo.some((meta) => meta.taskId === notice.taskId))) return true;
  return paseo.some((meta) => taskNotices(meta).some((notice) => !meta.notified?.[notice.key]));
}

function recordHeartbeatFiredUnlocked(home, heartbeatId, at) {
  const supervision = readSupervision(home);
  if (supervision.heartbeat?.heartbeatId !== heartbeatId) return false;
  writeSupervisionUnlocked(home, { ...supervision, heartbeat: { ...supervision.heartbeat, lastFiredAt: at, confirmedAt: at } });
  return true;
}

/**
 * Creates, updates, or deletes the one Paseo heartbeat of the current Foreman agent so it runs only while work is watched.
 * The heartbeat ID is persisted before anything else depends on it and is never guessed: a heartbeat Foreman did
 * not create is never touched, and a recorded one that Paseo no longer has is replaced.
 * `withLock` wraps only the reads and writes of the supervision record, so the slow Paseo CLI calls run outside the home lock;
 * the record is checked again before it is written, and a sync that lost a race deletes the heartbeat it just created.
 */
function syncHeartbeat({ withLock = (fn) => fn(), ...params }) {
  const created = [];
  try { return runHeartbeatSync(params, withLock, created); }
  catch (error) {
    if (!error.heartbeatConflict) throw error;
    const current = withLock(() => readSupervision(params.home).heartbeat);
    for (const heartbeatId of created) {
      if (current?.heartbeatId === heartbeatId) continue;
      try { params.adapter.heartbeatDelete({ agentId: params.agentId, heartbeatId }); } catch (_) {}
    }
    return { needed: null, action: "error", reason: "the heartbeat record changed while syncing; run heartbeat sync again", heartbeatId: current?.heartbeatId || null };
  }
}

function runHeartbeatSync({ home, adapter, agentId, metas, anomalies, cron, enable, at }, withLock, created) {
  if (cron !== undefined && !validCron(cron)) throw new SchemaValidationError(`Heartbeat cron is not a valid five-field cron: ${cron}`);
  const supervision = withLock(() => readSupervision(home));
  const settings = {
    heartbeatCron: cron !== undefined ? String(cron).trim() : supervision.heartbeatCron || DEFAULT_HEARTBEAT_CRON,
    heartbeatEnabled: enable !== undefined ? Boolean(enable) : supervision.heartbeatEnabled !== false,
  };
  const needed = settings.heartbeatEnabled && heartbeatNeeded(metas, anomalies);
  let heartbeat = supervision.heartbeat || null;
  const result = { needed, enabled: settings.heartbeatEnabled, cron: settings.heartbeatCron, action: "none", heartbeatId: heartbeat?.heartbeatId || null };
  let rejected = false;
  // A cadence Paseo rejected is not saved, so later automatic syncs do not keep retrying it.
  const save = () => withLock(() => {
    const current = readSupervision(home);
    if ((current.heartbeat?.heartbeatId || null) !== (supervision.heartbeat?.heartbeatId || null)) throw Object.assign(new Error("heartbeat record changed"), { heartbeatConflict: true });
    writeSupervisionUnlocked(home, { ...current, ...settings, ...(rejected ? { heartbeatCron: supervision.heartbeatCron || DEFAULT_HEARTBEAT_CRON } : {}), heartbeat });
  });
  if (!adapter || typeof adapter.heartbeatCreate !== "function") {
    save();
    return { ...result, action: "unavailable", reason: "the selected runtime has no heartbeat support" };
  }
  // Without an agent only a recorded heartbeat can still be deleted, by the agent that owns it.
  if (!agentId && !(heartbeat && !needed)) {
    save();
    return { ...result, action: "unavailable", reason: "this Foreman session is not running inside a Paseo agent (PASEO_AGENT_ID is unset)" };
  }
  const remove = (record) => {
    try { adapter.heartbeatDelete({ agentId: record.agentId, heartbeatId: record.heartbeatId }); return { deleted: record.heartbeatId }; }
    catch (error) {
      if (error.notFound) return { deleted: record.heartbeatId, alreadyGone: true };
      return { error: error.message };
    }
  };
  if (agentId && heartbeat && heartbeat.agentId !== agentId) {
    // A new Foreman session replaces the previous session's heartbeat instead of running a second one.
    const removed = remove(heartbeat);
    if (removed.error) {
      save();
      return { ...result, action: "error", reason: `previous heartbeat ${heartbeat.heartbeatId} of agent ${heartbeat.agentId} could not be deleted: ${removed.error}` };
    }
    result.replaced = heartbeat.heartbeatId;
    heartbeat = null;
  }
  const create = () => {
    const response = adapter.heartbeatCreate({ agentId, cron: settings.heartbeatCron, name: HEARTBEAT_NAME, prompt: HEARTBEAT_PROMPT });
    if (!response?.id) throw new SchemaValidationError("Paseo did not return a heartbeat ID");
    created.push(String(response.id));
    heartbeat = { heartbeatId: String(response.id), agentId, cron: settings.heartbeatCron, name: HEARTBEAT_NAME, createdAt: at, confirmedAt: at, lastFiredAt: null };
  };
  try {
    if (needed && !heartbeat) {
      create();
      result.action = "created";
    } else if (needed) {
      const stale = Date.parse(at) - Date.parse(heartbeat.confirmedAt || heartbeat.createdAt || 0) > HEARTBEAT_CONFIRM_MS;
      if (heartbeat.cron !== settings.heartbeatCron || stale) {
        try {
          adapter.heartbeatUpdate({ agentId, heartbeatId: heartbeat.heartbeatId, cron: settings.heartbeatCron });
          result.action = heartbeat.cron !== settings.heartbeatCron ? "updated" : "confirmed";
          heartbeat = { ...heartbeat, cron: settings.heartbeatCron, confirmedAt: at };
        } catch (error) {
          if (!error.notFound) throw error;
          result.missing = heartbeat.heartbeatId;
          heartbeat = null;
          create();
          result.action = "recreated";
        }
      }
    } else if (heartbeat) {
      const removed = remove(heartbeat);
      if (removed.error) {
        save();
        return { ...result, action: "error", reason: `heartbeat ${heartbeat.heartbeatId} could not be deleted: ${removed.error}` };
      }
      heartbeat = null;
      result.action = "deleted";
    }
  } catch (error) {
    rejected = true;
    save();
    return { ...result, action: "error", heartbeatId: heartbeat?.heartbeatId || null, reason: error.message };
  }
  save();
  return { ...result, heartbeatId: heartbeat?.heartbeatId || null };
}

module.exports = {
  validCron, DEFAULT_HEARTBEAT_CRON, HEARTBEAT_NAME, HEARTBEAT_PROMPT,
  supervisionFile, readSupervision, taskNotices, collectNotices, pendingNotices, pruneNotifiedUnlocked, ackNoticesUnlocked,
  parseHeartbeatPrompt, heartbeatNeeded, recordHeartbeatFiredUnlocked, syncHeartbeat,
};
