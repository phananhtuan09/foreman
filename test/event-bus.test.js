const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, HerdrAdapter,
  emitWorkerEvent, recordWorkerHeartbeat, readWorkerRegistry, reconcileFleet, DeterministicObserver,
  listMessages, sendWorkerMessage,
} = require("../src/foreman");
const { listEvents } = require("../src/coordination");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-events-"));
  const project = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "config", "user.email", "events@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Events"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "ignore" });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: project });
  const workers = new Map();
  const deliveries = [];
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
    spawn(request) { const endpoint = `herdr-${workers.size + 7}`; workers.set(endpoint, { ...request, endpoint, status: "working", pid: 1000 + workers.size }); return { endpoint, pid: 1000 + workers.size }; },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { return [...workers.values()]; },
    send(endpoint, message) { if (workers.has(endpoint)) deliveries.push({ endpoint, message }); return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return { base, roots, project, workers, deliveries, adapter: new HerdrAdapter({ transport }), cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

function metaPath(f, taskId) { return path.join(f.roots.foremanHome, "data", "tasks", taskId, "meta.json"); }

test("worker emit, observer wake, and registry keep assignment identity", async () => {
  const f = fixture();
  const wakes = [];
  const observer = new DeterministicObserver({ roots: f.roots, adapter: f.adapter, wake(signal) { wakes.push(signal); } });
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "emit a blocker" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-7", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const registered = readWorkerRegistry(f.roots);
    assert.equal(registered.totalActive, 1);
    assert.equal(registered.workers[assignment.endpoint].taskId, task.id);
    assert.equal(registered.workers[assignment.endpoint].status, "active");
    assert.equal(registered.workers[assignment.endpoint].generation, assignment.generation);
    assert.equal(registered.workers[assignment.endpoint].adapter, "herdr");
    assert.equal(registered.workers[assignment.endpoint].lastHeartbeat, null);
    assert.equal(JSON.parse(fs.readFileSync(metaPath(f, task.id), "utf8")).connection.status, "active");
    assert.equal(typeof f.deliveries[0].message, "string");
    assert.match(f.deliveries[0].message, new RegExp(`Task ${task.id} \\| project fixture`));
    assert.match(f.deliveries[0].message, /emit a blocker/);
    const brief = listMessages({ roots: f.roots }).find((message) => message.messageId === assignment.briefMessageId);
    assert.equal(brief.status, "delivered");
    assert.equal(brief.payload.endpoint, assignment.endpoint);

    const followUp = sendWorkerMessage({ roots: f.roots, taskId: task.id, kind: "status-request", payload: { request: "progress" }, adapter: f.adapter }).message;
    assert.equal(followUp.status, "delivered");

    assert.throws(() => emitWorkerEvent({ roots: f.roots, taskId: task.id, eventType: "blocked", payload: { reason: "unbound" } }), /identity/);
    const emitted = emitWorkerEvent({ roots: f.roots, taskId: task.id, projectId: "fixture", eventType: "blocked", worker: assignment.owner, generation: assignment.generation, endpoint: assignment.endpoint, payload: { reason: "schema" } });
    assert.equal(emitted.duplicate, false);
    assert.equal(emitted.event.eventType, "worker.blocked");
    assert.equal(emitted.event.source, "worker");
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "events", task.id, `${emitted.event.eventId}.json`)), true);
    observer.runOnce();
    assert.equal(wakes.length, 1);
    assert.ok(wakes[0].pending.some((event) => event.eventId === emitted.event.eventId));

    const duplicate = emitWorkerEvent({ roots: f.roots, taskId: task.id, projectId: "fixture", eventType: "blocked", worker: assignment.owner, generation: assignment.generation, endpoint: assignment.endpoint, payload: { reason: "schema" } });
    assert.equal(duplicate.duplicate, true);
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "worker.blocked" && event.taskId === task.id).length, 1);

    const later = emitWorkerEvent({ roots: f.roots, taskId: task.id, projectId: "fixture", eventType: "later", worker: assignment.owner, generation: assignment.generation, endpoint: assignment.endpoint, payload: { order: 2 } });
    assert.ok(listEvents({ roots: f.roots, state: "pending" }).some((event) => event.eventId === later.event.eventId));

    const before = listEvents({ roots: f.roots, state: "pending" }).length;
    assert.throws(() => emitWorkerEvent({ roots: f.roots, taskId: task.id, projectId: "fixture", eventType: "blocked", worker: assignment.owner, generation: assignment.generation + 9, endpoint: assignment.endpoint, payload: { reason: "stale" } }), /identity/);
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).length, before);
    assert.ok(fs.readdirSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "inbox", "quarantine")).length >= 1);

    const heartbeat = recordWorkerHeartbeat({ roots: f.roots, taskId: task.id, worker: assignment.owner, generation: assignment.generation, pid: 4242 });
    assert.equal(heartbeat.record.pid, 4242);
    assert.equal(heartbeat.record.status, "active");
    const heartbeatAt = heartbeat.record.lastHeartbeat;
    reconcileFleet({ roots: f.roots, adapter: f.adapter, requireCompletionPackage: false });
    assert.equal(readWorkerRegistry(f.roots).workers[assignment.endpoint].lastHeartbeat, heartbeatAt);

    const stale = JSON.parse(fs.readFileSync(metaPath(f, task.id), "utf8"));
    stale.connection.lastHeartbeat = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(metaPath(f, task.id), `${JSON.stringify(stale, null, 2)}\n`);
    f.workers.delete(assignment.endpoint);
    const unconfirmed = reconcileFleet({ roots: f.roots, adapter: f.adapter, missingConfirmationMs: 60_000, requireCompletionPackage: false });
    assert.equal(unconfirmed.tasks.find((item) => item.taskId === task.id).state, "unknown");
    const unknownRegistry = readWorkerRegistry(f.roots);
    assert.equal(unknownRegistry.workers[assignment.endpoint].status, "unknown");
    assert.equal(unknownRegistry.totalActive, 0);
    assert.equal(unknownRegistry.workers[assignment.endpoint].lastHeartbeat, "2020-01-01T00:00:00.000Z");

    f.workers.set(assignment.endpoint, { endpoint: assignment.endpoint, owner: assignment.owner, status: "dead", pid: 4242 });
    const dead = reconcileFleet({ roots: f.roots, adapter: f.adapter, requireCompletionPackage: false });
    assert.equal(dead.tasks.find((item) => item.taskId === task.id).state, "dead");
    assert.equal(readWorkerRegistry(f.roots).workers[assignment.endpoint].status, "dead");

    const cli = execFileSync(process.execPath, [path.join(__dirname, "../bin/foreman"), "event", "emit", task.id, "idle", "--project", "fixture", "--worker", assignment.owner, "--generation", String(assignment.generation), "--endpoint", assignment.endpoint, "--payload", "{\"ok\":true}"], { env: { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome }, encoding: "utf8" });
    assert.equal(JSON.parse(cli).event.eventType, "worker.idle");
  } finally {
    observer.stop();
    f.cleanup();
  }
});
