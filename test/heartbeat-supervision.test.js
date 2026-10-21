const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  resolveRoots, withHomeLock, createTask, fleetStatus, sessionContext, sessionHookContext, sessionHookOutput, supervisionCheck, ackNotices, syncHeartbeat, continueTask, createDecision, reconstructTask, acceptTask,
} = require("../src/foreman");
const { HEARTBEAT_PROMPT, HEARTBEAT_NAME, readSupervision, supervisionFile } = require("../src/supervision");
const { PaseoAdapter } = require("../src/paseo");
const { fixture, FakePaseoAdapter, routeAndAssign } = require("./support/paseo-fixture");

const FOREMAN_AGENT = "11111111-1111-4111-8111-111111111111";
const NEXT_FOREMAN_AGENT = "22222222-2222-4222-8222-222222222222";

// Paseo heartbeats keyed by ID, as the Paseo CLI exposes them: create, update, and delete, with no listing.
class HeartbeatPaseo extends FakePaseoAdapter {
  constructor() { super(); this.heartbeats = new Map(); this.heartbeatCalls = []; this.nextHeartbeat = 1; this.failDelete = false; }
  heartbeatCreate({ agentId, cron, name, prompt }) {
    const id = `hb${this.nextHeartbeat++}`;
    this.heartbeats.set(id, { id, agentId, cron, name, prompt });
    this.heartbeatCalls.push(`create:${id}:${agentId}`);
    return { id, status: "active" };
  }
  heartbeatUpdate({ heartbeatId, cron }) {
    this.heartbeatCalls.push(`update:${heartbeatId}`);
    const heartbeat = this.heartbeats.get(heartbeatId);
    if (!heartbeat) throw Object.assign(new Error(`Schedule not found: ${heartbeatId}`), { notFound: true });
    heartbeat.cron = cron;
    return heartbeat;
  }
  heartbeatDelete({ heartbeatId }) {
    this.heartbeatCalls.push(`delete:${heartbeatId}`);
    if (this.failDelete) throw new Error("daemon unavailable");
    if (!this.heartbeats.delete(heartbeatId)) throw Object.assign(new Error(`Schedule not found: ${heartbeatId}`), { notFound: true });
    return { id: heartbeatId, status: "deleted" };
  }
}

function heartbeatFixture() {
  const f = fixture();
  f.adapter = new HeartbeatPaseo();
  return f;
}

function heartbeatPrompt(id) {
  return `<paseo-system>\nSchedule "${HEARTBEAT_NAME}" fired (id=${id}, run=run-${Date.now()}).\n${HEARTBEAT_PROMPT}\n</paseo-system>`;
}

// One heartbeat turn as the prompt hook sees it in the Foreman agent.
function beat(f, id = [...f.adapter.heartbeats.keys()][0], agentId = FOREMAN_AGENT) {
  return sessionContext({ roots: f.roots, adapter: f.adapter, prompt: heartbeatPrompt(id), cwd: f.projectRoot, agentId });
}

function workerPrompts(f) { return f.adapter.calls.filter((call) => call.startsWith("send:") || call.startsWith("interrupt:")).length; }

function pendingKeys(text) { return [...String(text).matchAll(/^- ((?:T|B)-\d+\/\S+|fleet\/\S+):/gm)].map((match) => match[1]); }

test("the heartbeat starts with watched Paseo work, is never duplicated, and stops once nothing is left to tell", () => {
  const f = heartbeatFixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT }).action, "created");
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT }).action, "none");
    assert.equal(f.adapter.heartbeats.size, 1, "a second sync never creates a second heartbeat");
    const [id] = f.adapter.heartbeats.keys();
    assert.equal(f.adapter.heartbeats.get(id).cron, "*/5 * * * *");
    assert.equal(readSupervision(f.roots.foremanHome).heartbeat.heartbeatId, id, "the exact heartbeat ID is durable");

    // While the worker runs, a heartbeat turn checks once and has nothing to tell; the worker is not prompted.
    const prompts = workerPrompts(f);
    const quiet = beat(f);
    assert.match(quiet, /already ran; do not run them again/);
    assert.match(quiet, /Nothing needs the user: end this turn without any text/);
    assert.equal(workerPrompts(f), prompts);
    assert.ok(readSupervision(f.roots.foremanHome).heartbeat.lastFiredAt);

    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "done", summary: "Fixture inspected; README only." }));
    const told = beat(f);
    const key = `${task.id}/review-ready/generation-1-001-done.md`;
    assert.deepEqual(pendingKeys(told), [key], "the review-ready result is one notice");
    assert.match(told, /Fixture inspected/);
    assert.equal(workerPrompts(f), prompts, "collection and status never prompt the worker");
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.status, "review-ready", "the heartbeat does not accept the task");
    assert.equal(f.adapter.heartbeats.size, 1, "an untold result keeps the heartbeat");

    ackNotices({ roots: f.roots, keys: [key] });
    const after = beat(f);
    assert.deepEqual(pendingKeys(after), [], "a told result is not told again");
    assert.doesNotMatch(after, /Heartbeat sync/, "stopping the heartbeat is not news for the user");
    assert.equal(f.adapter.heartbeats.size, 0, "nothing left to watch stops the heartbeat");
    assert.equal(readSupervision(f.roots.foremanHome).heartbeat, null);
    assert.equal(sessionContext({ roots: f.roots, adapter: f.adapter, prompt: "còn gì không?", cwd: f.projectRoot, agentId: FOREMAN_AGENT }), null);

    // Continuing the task restores watching.
    continueTask({ roots: f.roots, taskId: task.id, text: "Also list the Git branch.", original: "xem thêm branch", adapter: f.adapter });
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT }).action, "created");
    assert.equal(f.adapter.heartbeats.size, 1);
  } finally { f.cleanup(); }
});

test("a quiet Foreman heartbeat is marked quiet so the prompt hook can end it before the model runs", () => {
  const f = heartbeatFixture();
  try {
    const { assignment } = routeAndAssign(f);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    const [id] = f.adapter.heartbeats.keys();
    const hook = (heartbeatId = id) => sessionHookContext({ roots: f.roots, adapter: f.adapter, prompt: heartbeatPrompt(heartbeatId), cwd: f.projectRoot, agentId: FOREMAN_AGENT });

    const quiet = hook();
    assert.equal(quiet.quiet, true, "a running worker with nothing to tell needs no model turn");
    assert.deepEqual(sessionHookOutput(quiet), { decision: "block", reason: "Foreman heartbeat: nothing needs the user." }, "the hook blocks the prompt instead of adding context");
    assert.ok(readSupervision(f.roots.foremanHome).heartbeat.lastFiredAt, "a blocked heartbeat still records that it fired");
    assert.equal(hook("foreign").quiet, false, "a heartbeat Foreman did not record still reaches the model");

    const agent = f.adapter.agents.get(assignment.endpoint);
    agent.attentionReason = "permission";
    const anomaly = hook();
    assert.equal(anomaly.quiet, false, "a new anomaly reaches the model");
    ackNotices({ roots: f.roots, keys: pendingKeys(anomaly.text) });
    const told = hook();
    assert.match(told.text, /Worker anomalies/, "the anomaly is still listed while it lasts");
    assert.equal(told.quiet, true, "an anomaly the user was already told does not need another model turn");
    agent.attentionReason = null;

    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "done", summary: "Fixture inspected; README only." }));
    const reported = hook();
    assert.equal(reported.quiet, false, "a new report reaches the model");
    assert.match(reported.text, /Fixture inspected/);
    assert.deepEqual(sessionHookOutput(reported), { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reported.text } }, "a turn with news gets the context, not a block");
    assert.equal(sessionHookOutput(null), null, "nothing new prints nothing");
    assert.equal(sessionHookContext({ roots: f.roots, adapter: f.adapter, prompt: "còn gì không?", cwd: f.projectRoot, agentId: FOREMAN_AGENT }).quiet, false, "a user prompt is never quiet");
  } finally { f.cleanup(); }
});

test("a waiting blocker or anomaly is told once across heartbeats, and a new one is told again", () => {
  const f = heartbeatFixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "blocked", summary: "Need the staging password." }));
    const first = pendingKeys(beat(f));
    assert.deepEqual(first, [`${task.id}/blocked/generation-1-001-blocked.md`]);
    ackNotices({ roots: f.roots, keys: first });
    for (let index = 0; index < 3; index += 1) assert.deepEqual(pendingKeys(beat(f)), [], "the same blocker is not repeated each heartbeat");

    continueTask({ roots: f.roots, taskId: task.id, text: "Use the read-only fixture instead.", original: "dùng fixture", adapter: f.adapter });
    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "blocked", summary: "Need the staging password." }));
    assert.deepEqual(pendingKeys(beat(f)), [`${task.id}/blocked/generation-1-002-blocked.md`], "a new blocker with the same words is a new notice");
    ackNotices({ roots: f.roots, keys: [`${task.id}/blocked/generation-1-002-blocked.md`] });

    continueTask({ roots: f.roots, taskId: task.id, text: "Report without staging.", original: "bỏ staging", adapter: f.adapter });
    const agent = f.adapter.agents.get(assignment.endpoint);
    agent.attentionReason = "permission";
    const permission = pendingKeys(beat(f));
    assert.equal(permission.length, 1);
    assert.match(permission[0], new RegExp(`^${task.id}/anomaly/worker.waiting-input:g1:r3:[0-9a-f]{12}$`));
    ackNotices({ roots: f.roots, keys: permission });
    assert.deepEqual(pendingKeys(beat(f)), [], "a permission request that keeps waiting is not repeated");
    agent.attentionReason = null;
    assert.deepEqual(pendingKeys(beat(f)), []);
    assert.deepEqual(reconstructTask({ roots: f.roots, taskId: task.id }).meta.notified, {}, "a cleared anomaly leaves no mark");
    agent.attentionReason = "permission";
    assert.deepEqual(pendingKeys(beat(f)), permission, "a new permission request later is told again");
  } finally { f.cleanup(); }
});

test("notice marks and the heartbeat ID survive a restart, and an untold result is not lost", () => {
  const f = heartbeatFixture();
  try {
    const first = routeAndAssign(f);
    const second = routeAndAssign(f);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    f.adapter.finish(first.assignment.endpoint, JSON.stringify({ status: "done", summary: "first done" }));
    f.adapter.finish(second.assignment.endpoint, JSON.stringify({ status: "done", summary: "second done" }));
    const keys = pendingKeys(beat(f));
    assert.equal(keys.length, 2, "two results in one check are told together");
    ackNotices({ roots: f.roots, keys: [keys[0]] });

    // A fresh session reads the same home: the told result stays told and the untold one is still pending.
    const restarted = { ...f, roots: resolveRoots({ foremanRoot: f.roots.foremanRoot, foremanHome: f.roots.foremanHome }) };
    const id = readSupervision(restarted.roots.foremanHome).heartbeat.heartbeatId;
    assert.deepEqual(pendingKeys(beat(restarted, id)), [keys[1]]);
    assert.equal(syncHeartbeat({ roots: restarted.roots, adapter: f.adapter, agentId: FOREMAN_AGENT }).action, "none", "the recorded heartbeat is reused, not recreated");
    assert.equal(f.adapter.heartbeats.size, 1);
  } finally { f.cleanup(); }
});

test("a failed collection or status check is told once and is never read as healthy", () => {
  const f = heartbeatFixture();
  try {
    const { task } = routeAndAssign(f);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    const agent = [...f.adapter.agents.values()][0];
    agent.attentionReason = "permission";
    const permission = pendingKeys(beat(f));
    ackNotices({ roots: f.roots, keys: permission });

    const list = f.adapter.list.bind(f.adapter);
    f.adapter.list = () => { throw new Error("Paseo daemon unreachable"); };
    const failed = beat(f);
    assert.match(failed, /Runtime check unavailable: Paseo daemon unreachable/);
    const [runtimeKey] = pendingKeys(failed);
    assert.match(runtimeKey, /^fleet\/runtime\//);
    assert.match(failed, /not evidence that workers are fine, dead, or done/);
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.status, "working", "a failed check changes no task");
    ackNotices({ roots: f.roots, keys: [runtimeKey] });
    assert.deepEqual(pendingKeys(beat(f)), [], "the same lasting failure is not repeated");
    assert.ok(reconstructTask({ roots: f.roots, taskId: task.id }).meta.notified[permission[0]], "a failed check is not evidence that an anomaly cleared");

    f.adapter.list = list;
    assert.deepEqual(pendingKeys(beat(f)), []);
    assert.deepEqual(readSupervision(f.roots.foremanHome).notified, {}, "a recovered check retires the failure mark");
    f.adapter.list = () => { throw new Error("Paseo daemon unreachable"); };
    assert.deepEqual(pendingKeys(beat(f)), [runtimeKey], "the failure recurring later is told again");
  } finally { f.cleanup(); }
});

test("heartbeat sync replaces a missing or previous-session heartbeat, keeps a record it could not delete, and follows enable and cadence", () => {
  const f = heartbeatFixture();
  try {
    routeAndAssign(f);
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter }).action, "unavailable", "outside a Paseo agent nothing is created");
    assert.equal(f.adapter.heartbeats.size, 0);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    const [first] = f.adapter.heartbeats.keys();

    // Paseo cannot list heartbeats, so an unconfirmed record is checked and recreated only when Paseo no longer has it.
    f.adapter.heartbeats.delete(first);
    const file = supervisionFile(f.roots.foremanHome);
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...record, heartbeat: { ...record.heartbeat, confirmedAt: "2000-01-01T00:00:00.000Z" } }));
    const recreated = syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    assert.equal(recreated.action, "recreated");
    assert.equal(recreated.missing, first);
    assert.equal(f.adapter.heartbeats.size, 1);

    const changed = syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT, cron: "*/10 * * * *" });
    assert.equal(changed.action, "updated");
    assert.equal([...f.adapter.heartbeats.values()][0].cron, "*/10 * * * *");
    assert.throws(() => syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT, cron: "every 5 minutes" }), /valid five-field cron/);
    assert.throws(() => syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT, cron: "60 * * * *" }), /valid five-field cron/);

    const replaced = syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: NEXT_FOREMAN_AGENT });
    assert.equal(replaced.action, "created");
    assert.equal(replaced.replaced, recreated.heartbeatId);
    assert.deepEqual([...f.adapter.heartbeats.values()].map((heartbeat) => [heartbeat.agentId, heartbeat.cron]), [[NEXT_FOREMAN_AGENT, "*/10 * * * *"]], "a new session keeps the chosen cadence and runs the only heartbeat");

    f.adapter.failDelete = true;
    const kept = syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: NEXT_FOREMAN_AGENT, enable: false });
    assert.equal(kept.action, "error");
    assert.equal(readSupervision(f.roots.foremanHome).heartbeat.heartbeatId, replaced.heartbeatId, "a heartbeat that may still run keeps its record");
    f.adapter.failDelete = false;
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: NEXT_FOREMAN_AGENT }).action, "deleted", "a disabled heartbeat stays off while work runs");
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: NEXT_FOREMAN_AGENT }).action, "none");
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: NEXT_FOREMAN_AGENT, enable: true }).action, "created");
  } finally { f.cleanup(); }
});

test("an unrecorded heartbeat is flagged, unknown notices are refused, and Foreman's own decisions and accepted tasks need no notice", () => {
  const f = heartbeatFixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    assert.match(beat(f, "deadbeef"), /deadbeef, which is not the heartbeat Foreman recorded \(hb1\); do not delete it unless the user asks/);
    assert.throws(() => ackNotices({ roots: f.roots, keys: ["T-999999/review-ready/x.md"] }), /Unknown task/);
    assert.throws(() => ackNotices({ roots: f.roots, keys: ["anything"] }), /Invalid notice key/);

    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "progress", summary: "half way" }));
    assert.deepEqual(pendingKeys(beat(f)), [], "a progress report is stored without a notice");
    f.adapter.agents.get(assignment.endpoint).status = "running";
    createDecision({ roots: f.roots, taskId: task.id, finding: "Two data formats", why: "Compatibility choice", options: ["keep", "migrate"] });
    assert.deepEqual(supervisionCheck({ roots: f.roots, adapter: f.adapter }).notices, [], "a Decision Package is asked in the turn Foreman creates it");

    const done = routeAndAssign(f);
    f.adapter.finish(done.assignment.endpoint, JSON.stringify({ status: "done", summary: "done" }));
    assert.equal(pendingKeys(beat(f)).length, 1);
    acceptTask({ roots: f.roots, taskId: done.task.id, adapter: f.adapter });
    assert.deepEqual(pendingKeys(beat(f)), [], "an accepted task leaves no notice behind");
  } finally { f.cleanup(); }
});

test("the Paseo adapter manages heartbeats through the Paseo CLI as the Foreman agent", () => {
  const f = fixture();
  const prior = { command: process.env.FOREMAN_PASEO_COMMAND, home: process.env.FOREMAN_PASEO_HOME };
  try {
    const log = path.join(f.base, "paseo-calls.jsonl");
    const fake = path.join(f.base, "paseo-fake.js");
    fs.writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:a,agent:process.env.PASEO_AGENT_ID})+'\\n');if(a[1]==='delete'&&a[2]==='gone'){process.stdout.write(JSON.stringify({error:{message:'Schedule not found: gone requestType=schedule/inspect'}}));process.exit(1);}process.stdout.write(JSON.stringify({id:a[1]==='create'?'abc123':a[2],status:a[1]==='delete'?'deleted':'active'}));\n`);
    fs.chmodSync(fake, 0o755);
    process.env.FOREMAN_PASEO_COMMAND = fake;
    process.env.FOREMAN_PASEO_HOME = path.join(f.base, "paseo-home");
    const adapter = new PaseoAdapter({ timeoutMs: 10000 });
    assert.equal(adapter.heartbeatCreate({ agentId: FOREMAN_AGENT, cron: "*/5 * * * *", name: HEARTBEAT_NAME, prompt: HEARTBEAT_PROMPT }).id, "abc123");
    adapter.heartbeatUpdate({ agentId: FOREMAN_AGENT, heartbeatId: "abc123", cron: "*/10 * * * *" });
    adapter.heartbeatDelete({ agentId: FOREMAN_AGENT, heartbeatId: "abc123" });
    assert.throws(() => adapter.heartbeatDelete({ agentId: FOREMAN_AGENT, heartbeatId: "gone" }), (error) => error.notFound === true && /Schedule not found/.test(error.message));
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const home = ["--home", process.env.FOREMAN_PASEO_HOME];
    assert.deepEqual(calls[0], { args: ["heartbeat", "create", "--cron", "*/5 * * * *", "--name", HEARTBEAT_NAME, HEARTBEAT_PROMPT, "--json", ...home], agent: FOREMAN_AGENT });
    assert.deepEqual(calls[1].args, ["heartbeat", "update", "abc123", "--cron", "*/10 * * * *", "--json", ...home]);
    assert.deepEqual(calls[2].args, ["heartbeat", "delete", "abc123", "--json", ...home]);
  } finally {
    if (prior.command === undefined) delete process.env.FOREMAN_PASEO_COMMAND; else process.env.FOREMAN_PASEO_COMMAND = prior.command;
    if (prior.home === undefined) delete process.env.FOREMAN_PASEO_HOME; else process.env.FOREMAN_PASEO_HOME = prior.home;
    f.cleanup();
  }
});

test("a Paseo task waiting for dispatch has no runtime anomaly to tell", () => {
  const f = heartbeatFixture();
  try {
    createTask({ roots: f.roots, projectId: "fixture", brief: "Inspect later.", backend: "paseo", routingRunner: () => ({ profile: "codex-luna", reason: "default" }) });
    assert.deepEqual(fleetStatus({ roots: f.roots, adapter: f.adapter }).anomalies, []);
    assert.deepEqual(supervisionCheck({ roots: f.roots, adapter: f.adapter }).notices, []);
  } finally { f.cleanup(); }
});

test("Paseo heartbeat calls run outside the home lock, and a schedule that is not Foreman's heartbeat keeps its normal answer", () => {
  const f = heartbeatFixture();
  try {
    routeAndAssign(f);
    const create = f.adapter.heartbeatCreate.bind(f.adapter);
    f.adapter.heartbeatCreate = (args) => {
      assert.equal(withHomeLock(f.roots.foremanHome, () => "free"), "free", "other commands can take the home lock during the CLI call");
      return create(args);
    };
    assert.equal(syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT }).action, "created");

    const other = sessionContext({ roots: f.roots, adapter: f.adapter, prompt: `<paseo-system>\nSchedule "my-reminder" fired (id=user1, run=r1).\nRemind me to stretch.\n</paseo-system>`, cwd: f.projectRoot, agentId: FOREMAN_AGENT });
    assert.doesNotMatch(String(other), /Foreman Paseo heartbeat/);
    assert.doesNotMatch(String(other), /end this turn without any text/);
  } finally { f.cleanup(); }
});

test("a recorded heartbeat is deleted when heartbeat sync --disable runs outside a Paseo agent", () => {
  const f = heartbeatFixture();
  try {
    routeAndAssign(f);
    syncHeartbeat({ roots: f.roots, adapter: f.adapter, agentId: FOREMAN_AGENT });
    assert.equal(f.adapter.heartbeats.size, 1);
    const disabled = syncHeartbeat({ roots: f.roots, adapter: f.adapter, enable: false });
    assert.equal(disabled.action, "deleted");
    assert.equal(f.adapter.heartbeats.size, 0);
    assert.equal(readSupervision(f.roots.foremanHome).heartbeatEnabled, false);
  } finally { f.cleanup(); }
});
