const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask,
  listMessages, createDecision, answerDecision, recordReport, ValidationError, HerdrAdapter,
  recoverDeadWorker, buildHandoff, migrateJsonRecord, fleetStatus,
  findProject, listResourceLeases, withHomeLock, HomeLock, HomeLockError,
} = require("../src/foreman");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-gaps-"));
  const project = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "config", "user.email", "gaps@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Gaps"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "ignore" });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: project });
  const workers = new Map();
  let lists = 0;
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
    spawn(request) { const endpoint = `worker-${workers.size + 1}`; workers.set(endpoint, { ...request, endpoint, status: "working" }); return { endpoint, paneId: `pane-${endpoint}` }; },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { lists += 1; return [...workers.values()]; },
    send(endpoint) { return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return { base, roots, project, transport, workers, adapter: new HerdrAdapter({ transport }), get lists() { return lists; }, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

test("unsupported profile fails before spawn and explicit fallback is forwarded unchanged", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "profile" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, dispatchProfile: { name: "full", model: "unsupported" } }), ValidationError);
    const fallback = { name: "agent-only", agentKind: "codex" };
    const assigned = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, dispatchProfile: { name: "full", model: "unsupported" }, fallbackDispatchProfile: fallback });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).dispatchProfile, fallback);
    assert.equal(assigned.dispatchProfile.name, "agent-only");
  } finally { f.cleanup(); }
});

test("dead recovery sends a durable inspect-first handoff and bounds repeated attempts", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "recover" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    f.workers.get(first.endpoint).status = "dead";
    recordReport({ roots: f.roots, paneId: first.paneId, status: "progress", summary: "half of the work is done" });
    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "successor", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.match(replacement.handoff.inspectFirst, /Inspect the existing workspace/);
    assert.match(replacement.handoff.lastReport, /half of the work is done$/);
    const brief = listMessages({ roots: f.roots }).find((item) => item.kind === "task-brief" && item.generation === 2);
    assert.equal(brief.payload.handoff.inspectFirst, replacement.handoff.inspectFirst);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "handoff.json"), "utf8")).schemaVersion, 1);
    const killCurrent = () => { f.workers.get(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).endpoint).status = "dead"; };
    killCurrent();
    recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "third", adapter: f.adapter });
    killCurrent();
    recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "fourth", adapter: f.adapter });
    killCurrent();
    assert.throws(() => recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "fifth", adapter: f.adapter }), /attempt limit is exhausted/);
  } finally { f.cleanup(); }
});

test("dead recovery carries prior-generation decisions into the successor handoff", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "recover decision" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter });
    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "choice", why: "authority", options: ["A", "B"] });
    answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "A" });
    f.workers.get(first.endpoint).status = "dead";

    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "successor", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.deepEqual(replacement.handoff.decisions.map((item) => item.generation), [1]);
    assert.equal(listMessages({ roots: f.roots }).find((item) => item.kind === "task-brief" && item.generation === 2).payload.handoff.decisions[0].humanResponse, "A");
  } finally { f.cleanup(); }
});

test("schema migration keeps the original record and a missing worker is reported from one listing", () => {
  const f = fixture();
  try {
    const migrationFile = path.join(f.roots.foremanHome, "data", "migration.json");
    fs.writeFileSync(migrationFile, "{\"schemaVersion\":0,\"value\":\"original\"}\n");
    migrateJsonRecord({ file: migrationFile, kind: "migration", migrate: (record) => ({ ...record, schemaVersion: 1 }) });
    assert.equal(fs.readFileSync(`${migrationFile}.original-v0`, "utf8"), "{\"schemaVersion\":0,\"value\":\"original\"}\n");
    const unsupportedFile = path.join(f.roots.foremanHome, "data", "unsupported.json");
    fs.writeFileSync(unsupportedFile, "{\"schemaVersion\":2,\"value\":\"future\"}\n");
    assert.throws(() => migrateJsonRecord({ file: unsupportedFile, kind: "unsupported", migrate: (record) => ({ ...record, schemaVersion: 1 }) }), ValidationError);
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "missing" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    f.workers.delete(assignment.endpoint);
    assert.equal(fleetStatus({ roots: f.roots, adapter: f.adapter }).tasks.find((item) => item.taskId === task.id).state, "missing");
    assert.equal(buildHandoff({ roots: f.roots, taskId: task.id, reason: "missing" }).reason, "missing");
  } finally { f.cleanup(); }
});

test("startup migrates legacy home records and accepts an external linked worktree", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.roots.foremanHome, "data", "projects.json"), JSON.stringify({ version: 1, projects: [{ id: "fixture", name: "Fixture", root: f.project, defaultBranch: "main", deliveryMode: "local-only", enabled: true }] }));
    fs.writeFileSync(path.join(f.roots.foremanHome, "data", "sequence.json"), JSON.stringify({ task: 1 }));
    initHome(f.roots);
    assert.equal(findProject(f.roots.foremanHome, "fixture").id, "fixture");
    assert.equal(listResourceLeases({ roots: f.roots }).length, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "sequence.json"), "utf8")).schemaVersion, 1);

    const linked = path.join(f.base, "linked");
    execFileSync("git", ["-C", f.project, "worktree", "add", "-b", "linked-worker", linked], { stdio: "pipe" });
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "use linked worktree" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, workspacePath: linked });
    const state = fleetStatus({ roots: f.roots, adapter: f.adapter }).tasks.find((item) => item.taskId === task.id);
    assert.equal(state.state, "working");
    assert.equal(state.issues.some((issue) => issue.type === "task.project-mismatch"), false);
    assert.equal(assignment.workspace, fs.realpathSync(linked));
  } finally { f.cleanup(); }
});

test("a runtime worker bound to a task by name is matched even when it also has a pane ID", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "bound pane" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const adapter = { list: () => [{ pane_id: "pane-worker-1", name: assignment.endpoint, agent_status: "working" }, { pane_id: "w1:p2", name: "stranger", agent_status: "idle" }] };
    const result = fleetStatus({ roots: f.roots, adapter });
    assert.equal(result.tasks[0].worker.name, assignment.endpoint);
    assert.equal(result.tasks[0].state, "working");
    assert.deepEqual(result.anomalies, []);
    const moved = { list: () => [{ pane_id: "w9:p9", name: assignment.endpoint, agent_status: "working" }] };
    assert.deepEqual(fleetStatus({ roots: f.roots, adapter: moved }).anomalies.map((issue) => issue.type), ["task.runtime-pane-mismatch"]);
  } finally { f.cleanup(); }
});

test("a command waits briefly for another process to release the home lock", () => {
  const f = fixture();
  try {
    const lock = path.join(f.roots.foremanHome, "data", ".lock");
    fs.mkdirSync(lock);
    const holder = require("node:child_process").spawn(process.execPath, ["-e", `setTimeout(() => require("node:fs").rmSync(${JSON.stringify(lock)}, { recursive: true }), 300)`], { stdio: "ignore" });
    try { assert.equal(withHomeLock(f.roots.foremanHome, () => "acquired"), "acquired"); } finally { holder.kill(); }
  } finally { f.cleanup(); }
});

test("an abandoned home lock is recovered only when its owner is provably gone", () => {
  const f = fixture();
  try {
    const lock = path.join(f.roots.foremanHome, "data", ".lock");
    const holdLock = (owner, ageMs = 0) => {
      fs.rmSync(lock, { recursive: true, force: true });
      fs.mkdirSync(lock);
      if (owner) fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify(owner));
      const at = new Date(Date.now() - ageMs);
      fs.utimesSync(lock, at, at);
    };
    const deadPid = require("node:child_process").spawnSync(process.execPath, ["-e", ""]).pid;
    holdLock({ pid: deadPid, host: os.hostname() });
    assert.equal(withHomeLock(f.roots.foremanHome, () => "recovered"), "recovered");
    holdLock({ pid: process.pid, host: os.hostname() });
    assert.throws(() => new HomeLock(f.roots.foremanHome, { waitMs: 200 }).acquire(), HomeLockError);
    holdLock({ pid: deadPid, host: `${os.hostname()}-elsewhere` });
    assert.throws(() => new HomeLock(f.roots.foremanHome, { waitMs: 200 }).acquire(), HomeLockError);
    holdLock(null);
    assert.throws(() => new HomeLock(f.roots.foremanHome, { waitMs: 200 }).acquire(), HomeLockError);
    holdLock(null, 60 * 1000);
    assert.equal(withHomeLock(f.roots.foremanHome, () => "recovered"), "recovered");
    assert.equal(fs.existsSync(`${lock}-breaker`), false);
  } finally { f.cleanup(); }
});
