const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordReport,
  listMessages, fleetStatus, recoverDeadWorker, createDecision, answerDecision,
  deliverDecision, createTask: intake, acceptTask, discardQueuedTask,
  dispatchReadyTasks, HerdrAdapter, ValidationError,
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
    return { endpoint, paneId: `pane-${endpoint}` };
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

test("real child workers complete a direct assignment and a status check flags the missing report", async () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "one", brief: "write a runtime artifact" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-real", adapter: f.adapter, resources: [{ key: "file/worker-real.out", mode: "write" }] });
    const message = listMessages({ roots: f.roots }).find((item) => item.messageId === assignment.briefMessageId);
    assert.equal(message.status, "delivered");
    assert.equal(assignment.status, "working");
    await f.transport.wait(assignment.endpoint);
    assert.equal(fs.readFileSync(path.join(f.one, "worker-real.out"), "utf8"), "worker-real completed\n");

    const observed = fleetStatus({ roots: f.roots, adapter: f.adapter });
    const item = observed.tasks.find((entry) => entry.taskId === task.id);
    assert.equal(item.state, "idle");
    assert.deepEqual(item.issues.map((issue) => issue.type), ["worker.idle-without-report"]);

    recordReport({ roots: f.roots, paneId: assignment.paneId, status: "done", summary: "runtime worker verified completion" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).status, "review-ready");
    const accepted = acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(accepted.workerStopped, true);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", task.id)), false);
  } finally { f.cleanup(); }
});

test("an untouched queued test task can be explicitly discarded but assigned or depended-on tasks cannot", () => {
  const f = fixture();
  try {
    const queued = createTask({ roots: f.roots, projectId: "one", type: "scout", brief: "remove test intake" });
    assert.deepEqual(discardQueuedTask({ roots: f.roots, taskId: queued.id }), { taskId: queued.id, discarded: true, deleted: true });
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", queued.id)), false);

    const dependency = createTask({ roots: f.roots, projectId: "one", type: "scout", brief: "dependency" });
    createTask({ roots: f.roots, projectId: "one", type: "scout", dependencies: [dependency.id], brief: "dependent" });
    assert.throws(() => discardQueuedTask({ roots: f.roots, taskId: dependency.id }), /still a dependency/);

    const assigned = createTask({ roots: f.roots, projectId: "one", type: "scout", brief: "assigned" });
    assignTask({ roots: f.roots, taskId: assigned.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/read", mode: "read" }] });
    assert.throws(() => discardQueuedTask({ roots: f.roots, taskId: assigned.id }), /Only untouched, unassigned queued tasks/);
  } finally { f.cleanup(); }
});

test("dead child recovery preserves handoff state and rejects the old pane", async () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "one", brief: "recover dead worker" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "dead-worker", adapter: f.adapter, resources: [{ key: "file/recovery", mode: "write" }] });
    await f.transport.wait(first.endpoint);
    assert.equal(fleetStatus({ roots: f.roots, adapter: f.adapter }).tasks.find((item) => item.taskId === task.id).state, "dead");
    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "replacement", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).owner, "replacement");
    assert.throws(() => recordReport({ roots: f.roots, paneId: first.paneId, status: "done", summary: "stale completion" }), ValidationError);
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
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", scout.id, "meta.json"), "utf8")).status, "working");
    assert.equal(scoutAssignment.projectId, "two");
    assert.equal(dispatchReadyTasks({ roots: f.roots, adapter: f.adapter, ownerForTask: () => "shipper" }).length, 0);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "projects.json")), true);
    assert.ok(ship.dependencies.includes(scout.id));
  } finally { f.cleanup(); }
});
