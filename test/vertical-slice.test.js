const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  HomeLock, HomeLockError, ValidationError, CleanupRefusedError, ResourceBusyError,
  atomicWrite, resolveRoots, initHome, registerProject, createTask, assignTask,
  recordReport, reconstructTask, acceptTask,
  listResourceLeases,
  validateWorkspace,
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
  registerProject({ roots, id: "fixture", root: projectRoot, name: "Fixture" });
  const endpoints = new Map();
  const adapter = {
    verifyCompatibility: () => ({ protocol: 1 }),
    spawn(request) { const endpoint = `endpoint-${endpoints.size + 1}`; endpoints.set(endpoint, { ...request, endpoint, paneId: `pane-${endpoint}`, status: "working" }); return { endpoint, paneId: `pane-${endpoint}` }; },
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

test("resource leases allow disjoint work and block overlapping work", () => {
  const f = fixture();
  try {
    const one = createTask({ roots: f.roots, projectId: "fixture", brief: "auth" });
    const two = createTask({ roots: f.roots, projectId: "fixture", brief: "users" });
    const first = assignTask({ roots: f.roots, taskId: one.id, owner: "worker-1", adapter: f.adapter, resources: [{ key: "file/src/auth/**", mode: "write" }] }).resourceLease;
    assert.throws(() => assignTask({ roots: f.roots, taskId: two.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "file/src/auth/login", mode: "read" }] }), ResourceBusyError);
    const second = assignTask({ roots: f.roots, taskId: two.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "db/users/record/2", mode: "write" }] }).resourceLease;
    assert.deepEqual(listResourceLeases({ roots: f.roots }).map((lease) => lease.leaseId).sort(), [first.leaseId, second.leaseId].sort());
  } finally { f.cleanup(); }
});

test("a resource lease is held until acceptance however long the worker takes", () => {
  const f = fixture();
  try {
    const one = createTask({ roots: f.roots, projectId: "fixture", brief: "long task" });
    const two = createTask({ roots: f.roots, projectId: "fixture", brief: "overlapping task" });
    assignTask({ roots: f.roots, taskId: one.id, owner: "worker-1", adapter: f.adapter, resources: [{ key: "file/src/**", mode: "write" }] });
    const realNow = Date.now;
    Date.now = () => realNow() + 24 * 60 * 60 * 1000;
    try {
      assert.equal(listResourceLeases({ roots: f.roots }).length, 1);
      assert.throws(() => assignTask({ roots: f.roots, taskId: two.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "file/src/app.js", mode: "write" }] }), ResourceBusyError);
    } finally { Date.now = realNow; }
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
    assert.throws(() => validateWorkspace({ root: f.projectRoot }, path.join(f.base, "outside")), ValidationError);
    const workspace = validateWorkspace({ root: f.projectRoot }, f.projectRoot);
    assert.equal(workspace.path, fs.realpathSync(f.projectRoot));
    assert.equal(execFileSync("git", ["-C", f.projectRoot, "worktree", "list", "--porcelain"], { encoding: "utf8" }).split(/\n/).filter((line) => line.startsWith("worktree ")).length, 1);
  } finally { f.cleanup(); }
});

test("dispatch binds Herdr endpoint, workspace, owner, and generation", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "implement slice" });
    const meta = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-1", adapter: new HerdrAdapter({ transport: f.adapter }) });
    const active = JSON.parse(fs.readFileSync(path.join(f.home, "data", "tasks", task.id, "meta.json"), "utf8"));
    assert.equal(meta.generation, 1);
    assert.equal(meta.projectId, "fixture");
    assert.equal(active.status, "working");
    assert.equal(meta.endpoint, "endpoint-1");
    assert.equal(meta.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(meta.branch, "main");
  } finally { f.cleanup(); }
});

test("a replaced generation's worker pane cannot report", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "handoff" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-1", adapter: f.adapter });
    const second = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-2", adapter: f.adapter });
    assert.notEqual(first.paneId, second.paneId);
    assert.throws(() => recordReport({ roots: f.roots, paneId: first.paneId, status: "done", summary: "old" }), ValidationError);
    assert.equal(fs.existsSync(path.join(f.home, "data", "tasks", task.id, "reports")), false);
  } finally { f.cleanup(); }
});

test("completion, acceptance, and restart reconstruction end by deleting task records", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "finish and verify" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-1", adapter: f.adapter });
    recordReport({ roots: f.roots, paneId: assignment.paneId, status: "progress", summary: "RAW progress report" });
    assert.match(reconstructTask({ roots: f.roots, taskId: task.id }).lastReport, /\n\nRAW progress report$/);
    recordReport({ roots: f.roots, paneId: assignment.paneId, status: "done", summary: "RAW completion report" });
    assert.match(reconstructTask({ roots: f.roots, taskId: task.id }).report, /STATUS: done\n.*\n\nRAW completion report$/);
    assert.throws(() => acceptTask({ roots: f.roots, taskId: task.id, adapter: { stop: () => ({ stopped: true }), inspect: () => { throw new Error("unavailable"); } } }), CleanupRefusedError);
    assert.equal(fs.existsSync(path.join(f.home, "data", "tasks", task.id)), true);
    const accepted = acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(fs.existsSync(path.join(f.home, "data", "tasks", task.id)), false);
    assert.deepEqual(listResourceLeases({ roots: f.roots }), []);
  } finally { f.cleanup(); }
});
