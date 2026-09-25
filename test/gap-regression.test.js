const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask,
  listMessages, createDecision, answerDecision, restartReconcile,
  retryMessages, StaleGenerationError, ValidationError, HerdrAdapter,
  recoverDeadWorker, buildHandoff, migrateJsonRecord, reconcileFleet,
  findProject, listResourceLeases, withHomeLock, HomeLock, HomeLockError,
} = require("../src/foreman");
const { listEvents, DeterministicObserver } = require("../src/coordination");

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
    spawn(request) { const endpoint = `worker-${workers.size + 1}`; workers.set(endpoint, { ...request, endpoint, status: "working" }); return { endpoint }; },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { lists += 1; return [...workers.values()]; },
    send(endpoint) { return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return { base, roots, project, transport, workers, adapter: new HerdrAdapter({ transport }), get lists() { return lists; }, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

function packageFor(task, assignment, type, body) {
  return [`TASK: ${task.id}`, `PROJECT: ${task.projectId}`, `AGENT: ${assignment.owner}`, `GENERATION: ${assignment.generation}`, `TYPE: ${type}`, "", body].join("\n");
}

test("restart applies a valid direct inbox completion before its single runtime listing", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "restart inbox" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const inbox = path.join(f.roots.foremanHome, "data", "tasks", task.id, "inbox");
    const completion = packageFor(task, assignment, "completion", "durable completion");
    fs.writeFileSync(path.join(inbox, "generation-1-completion.md"), completion);
    const result = restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(f.lists, 1);
    assert.equal(result.inbox.applied.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).status, "review-ready");
  } finally { f.cleanup(); }
});

test("message retry fails once at its bound and emits one durable actionable event", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "retry" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const messageFile = path.join(f.roots.foremanHome, "data", "messages", `${assignment.briefMessageId}.json`);
    const message = JSON.parse(fs.readFileSync(messageFile, "utf8"));
    message.status = "pending";
    message.attempts = message.maxAttempts - 1;
    message.lastAttemptAt = new Date(0).toISOString();
    fs.writeFileSync(messageFile, `${JSON.stringify(message, null, 2)}\n`);
    const failed = retryMessages({ roots: f.roots, adapter: { send: () => ({ delivered: false }) }, force: true });
    assert.equal(failed[0].status, "failed");
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "message.delivery-failed").length, 1);
    retryMessages({ roots: f.roots, adapter: { send: () => ({ delivered: false }) }, force: true });
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "message.delivery-failed").length, 1);
  } finally { f.cleanup(); }
});

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
    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "successor", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.match(replacement.handoff.inspectFirst, /Inspect the existing workspace/);
    const handoffMessage = listMessages({ roots: f.roots }).find((item) => item.kind === "recovery-handoff");
    assert.equal(handoffMessage.generation, 2);
    assert.equal(handoffMessage.payload.inspectFirst, replacement.handoff.inspectFirst);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "handoff.json"), "utf8")).schemaVersion, 1);
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
    assert.equal(replacement.handoffMessage.generation, 2);
  } finally { f.cleanup(); }
});

test("schema migration keeps the original record and missing confirmation needs two durable observations", () => {
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
    assert.equal(reconcileFleet({ roots: f.roots, adapter: f.adapter, missingConfirmationMs: 60_000, requireCompletionPackage: false }).tasks.find((item) => item.taskId === task.id).state, "unknown");
    assert.equal(reconcileFleet({ roots: f.roots, adapter: f.adapter, missingConfirmationMs: 0, requireCompletionPackage: false }).tasks.find((item) => item.taskId === task.id).state, "missing");
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
    const state = reconcileFleet({ roots: f.roots, adapter: f.adapter, requireCompletionPackage: false }).tasks.find((item) => item.taskId === task.id);
    assert.equal(state.state, "working");
    assert.equal(state.issues.some((issue) => issue.type === "task.project-mismatch"), false);
    assert.equal(assignment.workspace, fs.realpathSync(linked));
  } finally { f.cleanup(); }
});

test("a runtime worker bound to a task by name is not reported as an orphan when it also has a pane ID", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "bound pane" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const adapter = { list: () => [{ pane_id: "w1:p1", name: assignment.endpoint, agent_status: "working" }, { pane_id: "w1:p2", name: "stranger", agent_status: "idle" }] };
    const result = reconcileFleet({ roots: f.roots, adapter });
    assert.equal(result.tasks[0].worker.name, assignment.endpoint);
    const orphans = listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "worker.orphan");
    assert.deepEqual(orphans.map((event) => event.endpoint), ["w1:p2"]);
  } finally { f.cleanup(); }
});

test("the observer loop skips a pass while another process holds the home lock", async () => {
  const f = fixture();
  const observer = new DeterministicObserver({ roots: f.roots, adapter: f.adapter, intervalMs: 100 });
  try {
    const lock = path.join(f.roots.foremanHome, "data", ".lock");
    fs.mkdirSync(lock);
    observer.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const listsWhileLocked = f.lists;
    fs.rmSync(lock, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(listsWhileLocked, 0);
    assert.ok(f.lists > 0);
  } finally { observer.stop(); f.cleanup(); }
});

test("a worker follows the brief reporting contract and wakes Foreman", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "protocol" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    const message = listMessages({ roots: f.roots }).find((item) => item.messageId === assignment.briefMessageId);
    const instructions = message.payload.instructions.join("\n");
    const completionPath = instructions.match(/completion package to (\S+)/)[1];
    const doneCommand = instructions.match(/then run: (.+ event emit .+ done .+)$/m)[1];
    assert.equal(completionPath, message.payload.reportPath);
    assert.match(instructions, /GENERATION: 1/);
    assert.equal(assignment.status, "working");
    assert.equal(message.status, "delivered");
    const headerBlock = instructions.match(/^TASK: .+\nPROJECT: .+\nAGENT: .+\nGENERATION: \d+\nTYPE: completion$/m)[0];
    fs.writeFileSync(completionPath, `${headerBlock}\n\noutcome: done\n`);
    execFileSync("/bin/sh", ["-c", doneCommand], { stdio: "pipe" });
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.taskId === task.id && event.eventType === "worker.done").length, 1);
    restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).status, "review-ready");
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
