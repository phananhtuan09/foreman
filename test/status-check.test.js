const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const coordination = require("../src/coordination");

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-status-check-")));
  const project = path.join(base, "app");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "-b", "main", project], { stdio: "pipe" });
  const roots = core.resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  core.initHome(roots);
  core.registerProject({ roots, id: "app", root: project });
  const write = (taskId, meta) => {
    const dir = path.join(roots.foremanHome, "data", "tasks", taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "brief.md"), `${taskId} brief\n`);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ schemaVersion: 1, taskId, projectId: "app", generation: 0, type: "ship", dependencies: [], resources: [], owner: null, endpoint: null, backend: "herdr", status: "queued", createdAt: "2026-10-21T08:00:00.000Z", ...meta }));
  };
  write("T-000001", { status: "working", generation: 1, owner: "w1", endpoint: "pane-1", paneId: "pane-1", lastPromptAt: "2026-10-21T08:05:00.000Z", resourceLease: { leaseId: "L-1", taskId: "T-000001", owner: "w1", generation: 1, resources: [] } });
  write("T-000002", { status: "queued" });
  write("T-000003", { status: "working", generation: 1, owner: "w3", endpoint: "agent-3", backend: "paseo" });
  return { base, roots, record: () => coordination.readStatusCheck(roots.foremanHome), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("a fleet-wide status check keeps its result per backend; a project-scoped check keeps nothing", () => {
  const f = fixture();
  try {
    const adapter = { backend: "herdr", list: () => [{ endpoint: "pane-1", owner: "w1", status: "idle" }] };
    core.projectStatus({ roots: f.roots, adapter, projectId: "app" });
    assert.equal(fs.existsSync(coordination.statusCheckFile(f.roots.foremanHome)), false);

    const status = core.fleetStatus({ roots: f.roots, adapter });
    const herdr = f.record().backends.herdr;
    assert.equal(herdr.checkedAt, status.observedAt);
    assert.equal(herdr.workers, 1);
    assert.equal(herdr.error, null);
    assert.deepEqual(herdr.tasks["T-000001"], { generation: 1, endpoint: "pane-1", state: "idle", issues: [{ type: "worker.idle-without-report", reason: "worker stopped without reporting since its last prompt" }] });
    assert.equal(herdr.tasks["T-000002"].state, "queued");
    assert.equal(herdr.tasks["T-000003"], undefined, "a task on the other backend was not observed");
  } finally { f.cleanup(); }
});

test("a failed status check is recorded beside the last good result and still fails", () => {
  const f = fixture();
  try {
    core.fleetStatus({ roots: f.roots, adapter: { backend: "herdr", list: () => [] } });
    const before = f.record().backends.herdr;
    assert.throws(() => core.fleetStatus({ roots: f.roots, adapter: { backend: "herdr", list: () => { throw new Error("herdr is not running"); } } }), /herdr is not running/);
    const after = f.record().backends.herdr;
    assert.equal(after.error, "herdr is not running");
    assert.ok(after.failedAt >= before.checkedAt);
    assert.equal(after.checkedAt, before.checkedAt);
    assert.deepEqual(after.tasks, before.tasks);
  } finally { f.cleanup(); }
});

test("discarding a task drops it from the kept status check", () => {
  const f = fixture();
  try {
    core.fleetStatus({ roots: f.roots, adapter: { backend: "herdr", list: () => [] } });
    assert.ok(f.record().backends.herdr.tasks["T-000002"]);
    core.discardTask({ roots: f.roots, taskId: "T-000002", adapter: { backend: "herdr", list: () => [] } });
    assert.equal(f.record().backends.herdr.tasks["T-000002"], undefined);
    assert.ok(f.record().backends.herdr.tasks["T-000001"]);
  } finally { f.cleanup(); }
});
