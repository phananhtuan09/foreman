const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots,
  initHome,
  registerProject,
  createTask,
  assignTask,
  recordReport,
  reconstructTask,
  acceptTask,
  HerdrAdapter,
} = require("../src/foreman");

class SimulatedHerdrTransport {
  constructor() {
    this.nextEndpoint = 1;
    this.workers = new Map();
    this.messages = [];
  }

  verifyCompatibility() {
    return { compatible: true, protocol: 1, endpointProtocolGeneration: 1 };
  }

  spawn(request) {
    const endpoint = `sim-worker-${this.nextEndpoint++}`;
    this.workers.set(endpoint, { ...request, endpoint, paneId: `pane-${endpoint}`, status: "working" });
    return { endpoint, paneId: `pane-${endpoint}` };
  }

  inspect(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker || worker.status === "missing") return { endpoint, status: "missing" };
    return worker;
  }

  send(endpoint, message) {
    if (!this.workers.has(endpoint)) return { delivered: false };
    this.messages.push({ endpoint, message });
    return { delivered: true };
  }

  list() {
    return [...this.workers.values()].filter((worker) => worker.status !== "missing");
  }

  stop(endpoint) {
    const worker = this.workers.get(endpoint);
    if (worker) worker.status = "missing";
    return { stopped: true };
  }
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-e2e-"));
  const projectRoot = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman E2E"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "simulated e2e\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "pipe" });

  const roots = resolveRoots({ foremanRoot: projectRoot, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: projectRoot, name: "Fixture" });
  const transport = new SimulatedHerdrTransport();
  return {
    base,
    projectRoot,
    roots,
    transport,
    adapter: new HerdrAdapter({ transport }),
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function report(f, assignment, status, summary) {
  return recordReport({ roots: f.roots, paneId: assignment.paneId, status, summary });
}

test("simulated end-to-end flow coordinates two workers through delivery and cleanup", () => {
  const f = fixture();
  try {
    const cleanBefore = execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" });
    const taskOne = createTask({ roots: f.roots, projectId: "fixture", brief: "implement worker one slice" });
    const taskTwo = createTask({ roots: f.roots, projectId: "fixture", brief: "implement worker two slice" });

    const assignmentOne = assignTask({ roots: f.roots, taskId: taskOne.id, owner: "worker-1", adapter: f.adapter, resources: [{ key: "file/src/one", mode: "write" }] });
    const assignmentTwo = assignTask({ roots: f.roots, taskId: taskTwo.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "file/src/two", mode: "write" }] });
    assert.deepEqual(f.adapter.list().map((worker) => worker.owner), ["worker-1", "worker-2"]);
    assert.deepEqual(f.transport.messages.map(({ endpoint }) => endpoint), [assignmentOne.endpoint, assignmentTwo.endpoint]);
    assert.match(f.transport.messages[0].message, new RegExp(`Task ${taskOne.id} \\| project fixture`));
    assert.match(f.transport.messages[1].message, new RegExp(`Task ${taskTwo.id} \\| project fixture`));
    assert.doesNotMatch(f.transport.messages[0].message, /event emit|completion package/);

    report(f, assignmentOne, "progress", "worker one is halfway done");
    report(f, assignmentTwo, "progress", "worker two is halfway done");
    assert.match(reconstructTask({ roots: f.roots, taskId: taskOne.id }).lastReport, /worker one is halfway done$/);
    assert.match(reconstructTask({ roots: f.roots, taskId: taskTwo.id }).lastReport, /worker two is halfway done$/);

    report(f, assignmentOne, "done", "worker one complete");
    report(f, assignmentTwo, "done", "worker two complete");
    assert.match(reconstructTask({ roots: f.roots, taskId: taskOne.id }).report, /worker one complete$/);
    assert.match(reconstructTask({ roots: f.roots, taskId: taskTwo.id }).report, /worker two complete$/);

    const acceptedOne = acceptTask({ roots: f.roots, taskId: taskOne.id, adapter: f.adapter });
    const acceptedTwo = acceptTask({ roots: f.roots, taskId: taskTwo.id, adapter: f.adapter });
    assert.equal(acceptedOne.deleted, true);
    assert.equal(acceptedTwo.deleted, true);
    assert.deepEqual(f.adapter.list(), []);
    assert.equal(assignmentOne.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(assignmentTwo.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", taskOne.id)), false);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", taskTwo.id)), false);
    assert.equal(execFileSync("git", ["-C", f.projectRoot, "worktree", "list", "--porcelain"], { encoding: "utf8" }).split(/\n/).filter((line) => line.startsWith("worktree ")).length, 1);

    assert.equal(execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" }), cleanBefore);
  } finally {
    f.cleanup();
  }
});
