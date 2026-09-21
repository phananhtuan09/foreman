const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  HomeLock, HomeLockError, ValidationError, StaleGenerationError, CleanupRefusedError,
  atomicWrite, resolveRoots, initHome, registerProject, createTask, assignTask,
  recordPackage, reconstructTask, acceptTask, markLanded, releaseEndpoint, cleanupTask,
} = require("../src/foreman");
const { HerdrAdapter } = require("../src/herdr");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-m1-"));
  const projectRoot = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman Test"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "fixture\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "pipe" });
  const roots = resolveRoots({ foremanRoot: projectRoot, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: projectRoot, name: "Fixture", defaultBranch: "main" });
  const endpoints = new Map();
  const adapter = {
    verifyCompatibility: () => ({ protocol: 1 }),
    spawn(request) { const endpoint = `endpoint-${endpoints.size + 1}`; endpoints.set(endpoint, { ...request, endpoint, status: "working" }); return { endpoint }; },
    send() { return { delivered: true }; },
    inspect(endpoint) { const item = endpoints.get(endpoint); return item?.status === "missing" ? { endpoint, status: "missing" } : item; },
    stop(endpoint) { endpoints.get(endpoint).status = "missing"; return { stopped: true }; },
  };
  return { base, projectRoot, home, roots, adapter, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

test("exclusive home lock refuses a second mutator", () => {
  const f = fixture();
  try {
    const first = new HomeLock(f.home).acquire();
    assert.throws(() => new HomeLock(f.home).acquire(), HomeLockError);
    first.release();
    assert.doesNotThrow(() => new HomeLock(f.home).acquire().release());
  } finally { f.cleanup(); }
});

test("atomic persistence leaves a complete file and no temporary file", () => {
  const f = fixture();
  try {
    const file = path.join(f.home, "data", "atomic.txt");
    atomicWrite(file, "complete\n");
    assert.equal(fs.readFileSync(file, "utf8"), "complete\n");
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp-")), []);
  } finally { f.cleanup(); }
});

test("task intake preserves the original brief and validates project boundary", () => {
  const f = fixture();
  try {
    const before = execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" });
    const brief = "thực thi giúp tôi Milestone đầu tiên lun đi sau khi nhớ test lại sau khi update spec.";
    const task = createTask({ roots: f.roots, projectId: "fixture", brief });
    assert.equal(execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" }), before);
    assert.equal(fs.readFileSync(path.join(f.home, "data", "tasks", task.id, "brief.md"), "utf8"), brief);
    assert.throws(() => createTask({ roots: f.roots, projectId: "other", brief: "x" }), ValidationError);
    assert.throws(() => require("../src/foreman").createWorktree({ roots: f.roots, projectId: "fixture", taskId: task.id, generation: 1, worktreePath: path.join(f.base, "outside") }), ValidationError);
  } finally { f.cleanup(); }
});

test("dispatch binds Herdr endpoint, worktree, owner, and generation", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "implement slice" });
    const meta = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-1", adapter: new HerdrAdapter({ transport: f.adapter }) });
    assert.equal(meta.generation, 1);
    assert.equal(meta.projectId, "fixture");
    assert.equal(meta.status, "working");
    assert.equal(meta.endpoint, "endpoint-1");
    assert.equal(fs.realpathSync(meta.worktree).startsWith(fs.realpathSync(path.join(f.home, "projects", "fixture"))), true);
  } finally { f.cleanup(); }
});

test("stale generation package is rejected and quarantined", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "handoff" });
    assignTask({ roots: f.roots, taskId: task.id, owner: "worker-1", adapter: f.adapter });
    assignTask({ roots: f.roots, taskId: task.id, owner: "worker-2", adapter: f.adapter });
    const stale = `TASK: ${task.id}\nPROJECT: fixture\nAGENT: worker-1\nGENERATION: 1\nTYPE: completion\n\nold`;
    assert.throws(() => recordPackage({ roots: f.roots, taskId: task.id, raw: stale, type: "completion" }), StaleGenerationError);
    assert.ok(fs.readdirSync(path.join(f.home, "state", "tasks", task.id, "inbox", "quarantine")).length > 0);
  } finally { f.cleanup(); }
});

test("completion, acceptance, restart reconstruction, and cleanup refusal preserve package", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "finish and verify" });
    assignTask({ roots: f.roots, taskId: task.id, owner: "worker-1", adapter: f.adapter });
    const progress = `TASK: ${task.id}\nPROJECT: fixture\nAGENT: worker-1\nGENERATION: 1\nTYPE: progress\n\nRAW progress package`;
    recordPackage({ roots: f.roots, taskId: task.id, raw: progress, type: "progress" });
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).progress, progress);
    const completion = `TASK: ${task.id}\nPROJECT: fixture\nAGENT: worker-1\nGENERATION: 1\nTYPE: completion\n\nRAW completion package`;
    recordPackage({ roots: f.roots, taskId: task.id, raw: completion, type: "completion" });
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).report, completion);
    assert.throws(() => cleanupTask({ roots: f.roots, taskId: task.id }), CleanupRefusedError);
    acceptTask({ roots: f.roots, taskId: task.id });
    assert.throws(() => releaseEndpoint({ roots: f.roots, taskId: task.id, adapter: { stop: () => ({ stopped: true }), inspect: () => { throw new Error("unavailable"); } } }), CleanupRefusedError);
    const commit = execFileSync("git", ["-C", f.projectRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    markLanded({ roots: f.roots, taskId: task.id, evidence: { target: "local-only", commit } });
    assert.equal(fs.readFileSync(path.join(f.home, "data", "backlog.md"), "utf8").includes(task.id), false);
    assert.equal(fs.readFileSync(path.join(f.home, "data", "done.md"), "utf8").includes(task.id), true);
    releaseEndpoint({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(cleanupTask({ roots: f.roots, taskId: task.id }), true);
  } finally { f.cleanup(); }
});
