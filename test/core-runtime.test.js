const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordPackage,
  listMessages, observeRuntime, listEvents, drainWakeQueue,
  recoverProcessingEvents, recoverDeadWorker, createDecision, answerDecision,
  deliverDecision, createTask: intake, acceptTask,
  dispatchReadyTasks, ResourceBusyError, HerdrAdapter, StaleGenerationError,
} = require("../src/foreman");

class ChildWorkerTransport {
  constructor() { this.next = 1; this.workers = new Map(); }

  verifyCompatibility() { return { compatible: true, protocol: 22, endpointProtocolGeneration: 1 }; }

  spawn(request) {
    const endpoint = `child-${this.next++}`;
    const output = path.join(request.cwd, `${request.owner}.out`);
    const script = request.owner.includes("dead")
      ? "setTimeout(() => process.exit(17), 40);"
      : `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(output)}, ${JSON.stringify(`${request.owner} completed\n`)}), 50);`;
    const child = spawn(process.execPath, ["-e", script], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const worker = { ...request, endpoint, child, status: "working" };
    this.workers.set(endpoint, worker);
    child.on("exit", (code) => { if (worker.status === "working") worker.status = code === 0 ? "done" : "dead"; });
    return { endpoint };
  }

  inspect(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker) return { endpoint, status: "missing" };
    return { endpoint, owner: worker.owner, cwd: worker.cwd, status: worker.status };
  }

  list() { return [...this.workers.values()].filter((worker) => worker.status !== "missing").map((worker) => this.inspect(worker.endpoint)); }

  send(endpoint, message) {
    const worker = this.workers.get(endpoint);
    if (!worker || worker.status === "missing") return { delivered: false };
    worker.messages = [...(worker.messages || []), message];
    return { delivered: true, endpoint, messageId: message.messageId || null };
  }

  interrupt(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker) return { interrupted: false };
    worker.child.kill("SIGINT");
    worker.status = "dead";
    return { interrupted: true };
  }

  stop(endpoint) {
    const worker = this.workers.get(endpoint);
    if (worker && worker.child.exitCode === null) worker.child.kill();
    if (worker) worker.status = "missing";
    return { stopped: true };
  }

  wait(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker || worker.child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => { worker.child.once("error", reject); worker.child.once("exit", resolve); });
  }
}

function gitProject(base, name) {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "runtime@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Foreman Runtime"]);
  fs.writeFileSync(path.join(root, "README.md"), `${name}\n`);
  execFileSync("git", ["-C", root, "add", "README.md"]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"], { stdio: "pipe" });
  return root;
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-core-runtime-"));
  const one = gitProject(base, "one");
  const two = gitProject(base, "two");
  const home = path.join(base, "home");
  const roots = resolveRoots({ foremanRoot: one, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "one", root: one });
  registerProject({ roots, id: "two", root: two });
  const transport = new ChildWorkerTransport();
  return { base, one, two, roots, transport, adapter: new HerdrAdapter({ transport }), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

function packageFor(task, assignment, type, body, extra = {}) {
  return [`TASK: ${task.id}`, `PROJECT: ${task.projectId}`, `AGENT: ${assignment.owner}`, `GENERATION: ${assignment.generation}`, `TYPE: ${type}`, ...Object.entries(extra).map(([key, value]) => `${key}: ${value}`), "", body].join("\n");
}

test("real child workers complete a direct assignment and survive observer/restart reconciliation", async () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "one", brief: "write a runtime artifact" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-real", adapter: f.adapter, resources: [{ key: "file/worker-real.out", mode: "write" }] });
    const message = listMessages({ roots: f.roots }).find((item) => item.messageId === assignment.briefMessageId);
    assert.equal(message.status, "delivered");
    assert.equal(assignment.status, "working");
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).status, "working");
    await f.transport.wait(assignment.endpoint);
    assert.equal(fs.readFileSync(path.join(f.one, "worker-real.out"), "utf8"), "worker-real completed\n");

    const observed = observeRuntime({ roots: f.roots, adapter: f.adapter });
    assert.equal(observed.tasks.find((item) => item.taskId === task.id).state, "unknown");
    const events = listEvents({ roots: f.roots, state: "pending" });
    assert.equal(events.filter((event) => event.taskId === task.id && event.eventType === "worker.unknown").length, 1);
    const handled = drainWakeQueue({ roots: f.roots, handler: (event) => ({ handled: true, observed: event.eventType }) });
    assert.ok(handled.some((event) => event.taskId === task.id));
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).some((event) => event.taskId === task.id), false);
    observeRuntime({ roots: f.roots, adapter: f.adapter });
    observeRuntime({ roots: f.roots, adapter: f.adapter });
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).some((event) => event.taskId === task.id && event.eventType === "worker.unknown"), false);
    recoverProcessingEvents({ roots: f.roots, maxAgeMs: 0 });

    const completion = packageFor(task, assignment, "completion", "runtime worker verified completion");
    recordPackage({ roots: f.roots, taskId: task.id, raw: completion, type: "completion" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).status, "review-ready");
    const accepted = acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(accepted.workerStopped, true);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", task.id)), false);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", task.id)), false);
  } finally { f.cleanup(); }
});

test("dead child recovery preserves handoff state and rejects stale completion", async () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "one", brief: "recover dead worker" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "dead-worker", adapter: f.adapter, resources: [{ key: "file/recovery", mode: "write" }] });
    await f.transport.wait(first.endpoint);
    const before = observeRuntime({ roots: f.roots, adapter: f.adapter });
    assert.equal(before.tasks.find((item) => item.taskId === task.id).state, "dead");
    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "replacement", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).owner, "replacement");
    const stale = packageFor(task, first, "completion", "stale completion");
    assert.throws(() => recordPackage({ roots: f.roots, taskId: task.id, raw: stale, type: "completion" }), StaleGenerationError);
    await f.transport.wait(replacement.endpoint);
  } finally { f.cleanup(); }
});

test("multi-project dependency, scout, decision, and scheduler paths use durable state", () => {
  const f = fixture();
  try {
    const scout = intake({ roots: f.roots, projectId: "two", type: "scout", brief: "audit project two" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: scout.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/a", mode: "write" }] }), /Scout tasks may only claim read/);
    const ship = intake({ roots: f.roots, projectId: "two", type: "ship", dependencies: [scout.id], brief: "implement audit findings" });
    const scheduledScout = dispatchReadyTasks({ roots: f.roots, adapter: f.adapter, ownerForTask: () => "shipper" });
    assert.equal(scheduledScout.length, 1);
    assert.equal(scheduledScout[0].taskId, scout.id);
    const scoutAssignment = assignTask({ roots: f.roots, taskId: scout.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/a", mode: "read" }] });
    const blocker = createDecision({ roots: f.roots, taskId: scout.id, finding: "policy choice", why: "two valid outcomes", options: ["A", "B"], impact: "scope", evidence: "runtime" });
    const answered = answerDecision({ roots: f.roots, taskId: scout.id, decisionId: blocker.decisionId, response: "A" });
    assert.equal(answered.humanResponse, "A");
    const delivered = deliverDecision({ roots: f.roots, taskId: scout.id, decisionId: blocker.decisionId, adapter: f.adapter });
    assert.equal(delivered.status, "delivered");
    assert.equal(scoutAssignment.projectId, "two");
    assert.equal(dispatchReadyTasks({ roots: f.roots, adapter: f.adapter, ownerForTask: () => "shipper" }).length, 0);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "projects.json")), true);
    assert.ok(ship.dependencies.includes(scout.id));
  } finally { f.cleanup(); }
});
