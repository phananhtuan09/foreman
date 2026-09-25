const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, adoptExistingWorker,
  recordPackage, acceptTask,
  listMessages, restartReconcile, drainWakeQueue, listEvents,
  createObserverEvent, fleetStatus, projectStatus, renderUserReport, runObserverLoop,
  startObserver, stopObserver, validateDispatchProfile, CleanupRefusedError, ValidationError, HerdrAdapter,
} = require("../src/foreman");

const bin = path.join(__dirname, "..", "bin", "foreman");

function gitProject(base, name) {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "audit@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Foreman Audit"]);
  fs.writeFileSync(path.join(root, "README.md"), `${name}\n`);
  execFileSync("git", ["-C", root, "add", "README.md"]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"], { stdio: "pipe" });
  return root;
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-audit-"));
  const alphaRoot = gitProject(base, "alpha");
  const betaRoot = gitProject(base, "beta");
  const home = path.join(base, "home");
  const roots = resolveRoots({ foremanRoot: alphaRoot, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "alpha", root: alphaRoot });
  registerProject({ roots, id: "beta", root: betaRoot });
  const workers = new Map();
  let spawns = 0;
  let stops = 0;
  let sends = 0;
  let lists = 0;
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
    spawn(request) {
      spawns += 1;
      const endpoint = `worker-${workers.size + 1}`;
      workers.set(endpoint, { ...request, endpoint, status: "working" });
      return { endpoint };
    },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { lists += 1; return [...workers.values()]; },
    send(endpoint) { sends += 1; return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { stops += 1; workers.delete(endpoint); return { stopped: true }; },
  };
  return {
    base, roots, alphaRoot, betaRoot, workers, transport, adapter: new HerdrAdapter({ transport }),
    counts: () => ({ spawns, stops, sends, lists }),
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function packageFor(task, assignment, type, body, extra = []) {
  return [`TASK: ${task.id}`, `PROJECT: ${task.projectId}`, `AGENT: ${assignment.owner}`, `GENERATION: ${assignment.generation}`, `TYPE: ${type}`, ...extra, "", body].join("\n");
}

test("dispatch profiles fail closed when runtime capability evidence is missing", () => {
  assert.throws(() => validateDispatchProfile({ name: "modelled", model: "x" }, { agentKind: true }), /model/);
  assert.deepEqual(validateDispatchProfile({ name: "kind-only", agentKind: "codex" }, { agentKind: true }), { name: "kind-only", agentKind: "codex" });
});

test("an event without a handler stays pending and production reconcile follows up or leaves it pending", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "alpha", brief: "keep the event" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const custom = createObserverEvent({ roots: f.roots, eventType: "worker.custom-gap", dedupKey: "custom-gap", taskId: task.id, projectId: "alpha", worker: assignment.owner, generation: assignment.generation, endpoint: assignment.endpoint, evidence: { reason: "unhandled" } });
    assert.equal(drainWakeQueue({ roots: f.roots }).find((event) => event.eventId === custom.event.eventId).status, "pending");
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).some((event) => event.eventId === custom.event.eventId), true);
    f.workers.get(assignment.endpoint).status = "dead";
    const before = f.counts();
    const result = restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    const meta = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8"));
    assert.equal(meta.generation, 2);
    assert.equal(meta.owner, "worker-recovery");
    assert.ok(result.handled.some((event) => event.eventType === "worker.dead" && event.status === "handled"));
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).some((event) => event.eventId === custom.event.eventId), true);
    assert.ok(f.counts().spawns > before.spawns);
    assert.ok(f.counts().stops > before.stops);
    assert.equal(f.adapter.relaunch, undefined);
  } finally { f.cleanup(); }
});

test("unknown runtime evidence is reported and does not spawn a replacement", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "alpha", brief: "stay unknown" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    createObserverEvent({ roots: f.roots, eventType: "worker.unknown", dedupKey: "unknown-once", taskId: task.id, projectId: "alpha", worker: assignment.owner, generation: assignment.generation, endpoint: assignment.endpoint, evidence: { state: "unknown" } });
    const before = f.counts().spawns;
    restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(f.counts().spawns, before);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8")).generation, assignment.generation);
    assert.equal(listEvents({ roots: f.roots, state: "handled" }).some((event) => event.eventType === "worker.unknown"), true);
  } finally { f.cleanup(); }
});

test("review-ready wake retries until the bound Foreman pane receives it", () => {
  const f = fixture();
  const previousPane = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "foreman-pane";
  try {
    const task = createTask({ roots: f.roots, projectId: "alpha", brief: "report findings" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter });
    recordPackage({ roots: f.roots, taskId: task.id, raw: packageFor(task, assignment, "completion", "finished"), type: "completion" });
    const pending = () => listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "task.review-ready");
    assert.equal(pending().length, 1);

    restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(pending().length, 1);

    f.workers.set("foreman-pane", { endpoint: "foreman-pane", paneId: "foreman-pane", owner: "foreman", cwd: f.alphaRoot, status: "idle" });
    const before = f.counts().sends;
    restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(pending().length, 0);
    assert.equal(f.counts().sends, before + 1);
    restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(f.counts().sends, before + 1);
  } finally {
    if (previousPane === undefined) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previousPane;
    f.cleanup();
  }
});

test("adoption binds an active unassigned worker without resending the task", () => {
  const f = fixture();
  try {
    const cwd = fs.realpathSync(f.alphaRoot);
    f.workers.set("codex-1", { endpoint: "codex-1", owner: "codex-1", cwd, status: "working" });
    const task = createTask({ roots: f.roots, projectId: "alpha", brief: "adopt this requirement" });
    assert.throws(() => adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "codex-1", taskId: task.id }), /explicit request/);
    const sendsBefore = f.counts().sends;
    const spawnsBefore = f.counts().spawns;
    const adopted = adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "codex-1", taskId: task.id, explicit: true });
    assert.equal(adopted.status, "working");
    assert.equal(adopted.generation, 1);
    assert.equal(adopted.endpoint, "codex-1");
    assert.equal(adopted.workspace, cwd);
    assert.equal(adopted.resent, false);
    assert.equal(adopted.briefMessageId, undefined);
    assert.equal(f.counts().sends, sendsBefore);
    assert.equal(f.counts().spawns, spawnsBefore);
    assert.match(fs.readFileSync(path.join(f.roots.foremanHome, "data", "backlog.md"), "utf8"), /\[~\] T-/);
    assert.throws(() => adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "codex-1", brief: "second", projectId: "alpha", explicit: true }), /already assigned/);
    f.workers.set("idle-1", { endpoint: "idle-1", owner: "idle-1", cwd, status: "idle" });
    assert.throws(() => adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "idle-1", brief: "not active", projectId: "alpha", explicit: true }), /active runtime/);
    const elsewhere = gitProject(f.base, "elsewhere");
    f.workers.set("outsider", { endpoint: "outsider", owner: "outsider", cwd: fs.realpathSync(elsewhere), status: "working" });
    assert.throws(() => adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "outsider", brief: "wrong project", projectId: "alpha", explicit: true }), /does not belong/);
  } finally { f.cleanup(); }
});

test("an unmodified scout still reaches review-ready", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "alpha", type: "scout", brief: "read only audit" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/README.md", mode: "read" }] });
    const clean = packageFor(task, assignment, "completion", "no files changed");
    const unchanged = recordPackage({ roots: f.roots, taskId: task.id, raw: clean, type: "completion" });
    assert.equal(unchanged.type, "completion");
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8")).status, "review-ready");
  } finally { f.cleanup(); }
});

test("scout fingerprint detects content changes after a dirty baseline", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.alphaRoot, "README.md"), "dirty baseline\n");
    const task = createTask({ roots: f.roots, projectId: "alpha", type: "scout", brief: "do not write" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/README.md", mode: "read" }] });
    fs.writeFileSync(path.join(f.alphaRoot, "README.md"), "changed after baseline\n");
    const raw = packageFor(task, assignment, "completion", "claimed no edits");
    assert.throws(() => recordPackage({ roots: f.roots, taskId: task.id, raw, type: "completion" }), /Scout modified production files/);
  } finally { f.cleanup(); }
});

test("scout guard fail-closes when the scout writes a production file", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "alpha", type: "scout", brief: "do not write" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/README.md", mode: "read" }] });
    fs.writeFileSync(path.join(f.alphaRoot, "sneak.txt"), "scout wrote this\n");
    const raw = packageFor(task, assignment, "completion", "claimed no edits");
    assert.throws(() => recordPackage({ roots: f.roots, taskId: task.id, raw, type: "completion" }), /Scout modified production files/);
    const meta = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8"));
    assert.equal(meta.status, "working");
    const violation = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "scout-violation.json"), "utf8"));
    assert.equal(violation.violation.reason, "workspace-changed");
    assert.match(violation.violation.actual.status, /sneak\.txt/);
    const quarantine = path.join(f.roots.foremanHome, "state", "tasks", task.id, "inbox", "quarantine");
    assert.ok(fs.readdirSync(quarantine).some((name) => fs.readFileSync(path.join(quarantine, name), "utf8").includes("claimed no edits")));
    meta.status = "review-ready";
    meta.completionPackage = path.join(f.roots.foremanHome, "state", "tasks", task.id, "inbox", "generation-1-completion.md");
    fs.writeFileSync(meta.completionPackage, raw);
    fs.writeFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    assert.throws(() => acceptTask({ roots: f.roots, taskId: task.id }), /Scout modified production files/);
  } finally { f.cleanup(); }
});

test("two projects stay isolated across concurrent assignment, restart, status, and acceptance", () => {
  const f = fixture();
  try {
    const alpha = createTask({ roots: f.roots, projectId: "alpha", brief: "alpha work" });
    const beta = createTask({ roots: f.roots, projectId: "beta", brief: "beta work" });
    const alphaAssignment = assignTask({ roots: f.roots, taskId: alpha.id, owner: "alpha-worker", adapter: f.adapter, resources: [{ key: "file/alpha", mode: "write" }] });
    const betaAssignment = assignTask({ roots: f.roots, taskId: beta.id, owner: "beta-worker", adapter: f.adapter, resources: [{ key: "file/beta", mode: "write" }] });
    assert.equal(alphaAssignment.status, "working");
    assert.notEqual(alphaAssignment.endpoint, betaAssignment.endpoint);
    const cross = packageFor({ id: beta.id, projectId: "alpha" }, betaAssignment, "completion", "cross project");
    assert.throws(() => recordPackage({ roots: f.roots, taskId: beta.id, raw: cross, type: "completion" }), /does not match the current assignment/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", beta.id, "meta.json"), "utf8")).status, "working");
    const betaQuarantine = path.join(f.roots.foremanHome, "state", "tasks", beta.id, "inbox", "quarantine");
    assert.ok(fs.readdirSync(betaQuarantine).some((name) => fs.readFileSync(path.join(betaQuarantine, name), "utf8").includes("cross project")));

    const listsBefore = f.counts().lists;
    const restarted = restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(f.counts().lists - listsBefore, 1);
    assert.ok(restarted.fleet.tasks.some((item) => item.taskId === alpha.id));
    assert.ok(restarted.fleet.tasks.some((item) => item.taskId === beta.id));
    const fleet = fleetStatus({ roots: f.roots, adapter: f.adapter, emitEvents: false });
    const alphaStatus = projectStatus({ roots: f.roots, adapter: f.adapter, projectId: "alpha", emitEvents: false });
    const betaStatus = projectStatus({ roots: f.roots, adapter: f.adapter, projectId: "beta", emitEvents: false });
    for (const item of alphaStatus.tasks) {
      const match = fleet.tasks.find((entry) => entry.taskId === item.taskId);
      assert.equal(match.meta.status, item.meta.status);
      assert.equal(match.meta.owner, item.meta.owner);
      assert.equal(match.meta.projectId, "alpha");
    }
    assert.equal(alphaStatus.tasks.some((item) => item.meta.projectId === "beta"), false);
    assert.equal(betaStatus.tasks.some((item) => item.taskId === alpha.id), false);

    const registryFile = path.join(f.roots.foremanHome, "data", "projects.json");
    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    registry.projects.find((project) => project.id === "beta").enabled = false;
    fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    assert.throws(() => createTask({ roots: f.roots, projectId: "beta", brief: "disabled" }), /disabled/);
    registry.projects.find((project) => project.id === "beta").enabled = true;
    registry.projects.find((project) => project.id === "beta").root = path.join(f.betaRoot, "missing");
    fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    assert.throws(() => createTask({ roots: f.roots, projectId: "beta", brief: "missing" }), ValidationError);
    registry.projects.find((project) => project.id === "beta").root = path.join(f.betaRoot, "README.md");
    fs.mkdirSync(path.dirname(registry.projects.find((project) => project.id === "beta").root), { recursive: true });
    fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    assert.throws(() => assignTask({ roots: f.roots, taskId: beta.id, owner: "beta-worker", adapter: f.adapter }), /no longer valid|does not exist|Not a Git/);
    registry.projects.find((project) => project.id === "beta").root = fs.realpathSync(f.betaRoot);
    fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);

    const betaMetaPath = path.join(f.roots.foremanHome, "state", "tasks", beta.id, "meta.json");
    const betaMeta = JSON.parse(fs.readFileSync(betaMetaPath, "utf8"));
    const completionPackage = path.join(f.roots.foremanHome, "state", "tasks", beta.id, "inbox", "generation-1-completion.md");
    fs.mkdirSync(path.dirname(completionPackage), { recursive: true });
    fs.writeFileSync(completionPackage, packageFor(beta, { ...betaAssignment, owner: betaMeta.owner }, "completion", "beta done"));
    const moved = { ...betaMeta, status: "review-ready", completionPackage, workspace: fs.realpathSync(f.alphaRoot) };
    fs.writeFileSync(betaMetaPath, `${JSON.stringify(moved, null, 2)}\n`);
    const stopsBefore = f.counts().stops;
    assert.throws(() => acceptTask({ roots: f.roots, taskId: beta.id, adapter: f.adapter }), CleanupRefusedError);
    assert.equal(f.counts().stops, stopsBefore);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", alpha.id, "meta.json"), "utf8")).endpoint, alphaAssignment.endpoint);
    fs.writeFileSync(betaMetaPath, `${JSON.stringify(betaMeta, null, 2)}\n`);

    f.workers.get(alphaAssignment.endpoint).status = "idle";
    const next = createTask({ roots: f.roots, projectId: "alpha", brief: "reuse the idle endpoint" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: next.id, owner: "alpha-worker", adapter: f.adapter, reuseEndpoint: alphaAssignment.endpoint, resources: [{ key: "file/next", mode: "write" }] }), /non-terminal|not released|not reconciled/);
    recordPackage({ roots: f.roots, taskId: alpha.id, raw: packageFor(alpha, alphaAssignment, "completion", "alpha done"), type: "completion" });
    const accepted = acceptTask({ roots: f.roots, taskId: alpha.id, adapter: f.adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "state", "tasks", alpha.id)), false);
    assert.throws(() => assignTask({ roots: f.roots, taskId: next.id, owner: "alpha-worker", adapter: f.adapter, reuseEndpoint: alphaAssignment.endpoint, resources: [{ key: "file/next", mode: "write" }] }), /endpoint|idle|missing/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", next.id, "meta.json"), "utf8")).status, "queued");
    const otherProject = createTask({ roots: f.roots, projectId: "beta", brief: "cannot reuse alpha endpoint" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: otherProject.id, owner: "alpha-worker", adapter: f.adapter, workspacePath: f.betaRoot, reuseEndpoint: alphaAssignment.endpoint, resources: [{ key: "file/beta-next", mode: "write" }] }), /workspace|project|idle|endpoint/);
    const spawnsBefore = f.counts().spawns;
    const dispatched = assignTask({ roots: f.roots, taskId: next.id, owner: "alpha-worker-2", adapter: f.adapter, workspacePath: f.alphaRoot, resources: [{ key: "file/next", mode: "write" }] });
    assert.notEqual(dispatched.endpoint, alphaAssignment.endpoint);
    assert.equal(dispatched.status, "working");
    assert.equal(f.counts().spawns, spawnsBefore + 1);
  } finally { f.cleanup(); }
});

test("default status output is grouped Vietnamese and the CLI delegates production commands", () => {
  const f = fixture();
  const loop = [];
  try {
    const task = createTask({ roots: f.roots, projectId: "alpha", brief: "chờ duyệt báo cáo" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    recordPackage({ roots: f.roots, taskId: task.id, raw: packageFor(task, assignment, "completion", "xong"), type: "completion" });
    const report = renderUserReport(fleetStatus({ roots: f.roots, adapter: f.adapter, emitEvents: false }), f.roots);
    assert.match(report, /### Cần bạn duyệt/);
    assert.match(report, new RegExp(task.id));
    assert.doesNotMatch(report, /### Cần bạn quyết/);
    assert.match(report, /Đang chạy: 0 · Chờ giao: 0/);
    const listed = execFileSync(process.execPath, [bin, "task", "list"], { env: { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome }, encoding: "utf8" });
    assert.match(listed, /Cần bạn duyệt/);
    assert.doesNotMatch(listed, /^\s*\{/);
    const taskMetaFile = path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json");
    const taskMeta = JSON.parse(fs.readFileSync(taskMetaFile, "utf8"));
    fs.writeFileSync(taskMetaFile, `${JSON.stringify({ ...taskMeta, endpoint: null }, null, 2)}\n`);
    const accepted = execFileSync(process.execPath, [bin, "task", "accept", "--task", task.id], { env: { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome }, encoding: "utf8" });
    assert.equal(JSON.parse(accepted).deleted, true);
    const help = execFileSync(process.execPath, [bin, "help"], { encoding: "utf8" });
    for (const phrase of ["task dispatch", "task schedule", "task adopt", "task recover", "task accept", "decision apply", "observer once", "observer start", "observer stop"]) {
      assert.match(help, new RegExp(phrase));
    }
    for (const removed of ["task mark-landed", "task release-endpoint", "task release-lease", "task cleanup"]) assert.doesNotMatch(help, new RegExp(removed));
    const idle = startObserver({ roots: f.roots });
    assert.equal(idle.started, false);
    assert.equal(stopObserver({ roots: f.roots }).reason, "not running");
    const running = createTask({ roots: f.roots, projectId: "alpha", brief: "still running" });
    const runningAssignment = assignTask({ roots: f.roots, taskId: running.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "file/other", mode: "write" }] });
    loop.push(runObserverLoop({ roots: f.roots, adapter: f.adapter, intervalMs: 500 }));
    loop[0].stop();
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "state", "observer", "supervisor.json")), false);
  } finally {
    for (const item of loop) { try { item.stop(); } catch (_) {} }
    f.cleanup();
  }
});
