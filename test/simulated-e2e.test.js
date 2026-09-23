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
  recordPackage,
  reconstructTask,
  acceptTask,
  markLanded,
  releaseEndpoint,
  cleanupTask,
  listMessages,
  acknowledgeTaskMessage,
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
    this.workers.set(endpoint, { ...request, endpoint, status: "working" });
    return { endpoint };
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

function workerPackage(task, assignment, type, body) {
  return [
    `TASK: ${task.id}`,
    `PROJECT: ${task.projectId}`,
    `AGENT: ${assignment.owner}`,
    `GENERATION: ${assignment.generation}`,
    `TYPE: ${type}`,
    "",
    body,
  ].join("\n");
}

test("simulated end-to-end flow coordinates two workers through delivery and cleanup", () => {
  const f = fixture();
  try {
    const cleanBefore = execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" });
    const taskOne = createTask({ roots: f.roots, projectId: "fixture", brief: "implement worker one slice" });
    const taskTwo = createTask({ roots: f.roots, projectId: "fixture", brief: "implement worker two slice" });

    const assignmentOne = assignTask({ roots: f.roots, taskId: taskOne.id, owner: "worker-1", adapter: f.adapter, resources: [{ key: "file/src/one", mode: "write" }] });
    const assignmentTwo = assignTask({ roots: f.roots, taskId: taskTwo.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "file/src/two", mode: "write" }] });
    for (const [task, assignment] of [[taskOne, assignmentOne], [taskTwo, assignmentTwo]]) {
      const brief = listMessages({ roots: f.roots }).find((message) => message.messageId === assignment.briefMessageId);
      acknowledgeTaskMessage({ roots: f.roots, taskId: task.id, messageId: brief.messageId, ack: { payloadDigest: brief.payloadDigest } });
    }
    assert.deepEqual(f.adapter.list().map((worker) => worker.owner), ["worker-1", "worker-2"]);
    assert.deepEqual(f.transport.messages.map(({ message }) => message.worker), ["worker-1", "worker-2"]);
    assert.equal(f.transport.messages[0].message.generation, 1);
    assert.equal(f.transport.messages[1].message.generation, 1);

    const progressOne = workerPackage(taskOne, assignmentOne, "progress", "worker one is halfway done");
    const progressTwo = workerPackage(taskTwo, assignmentTwo, "progress", "worker two is halfway done");
    recordPackage({ roots: f.roots, taskId: taskOne.id, raw: progressOne, type: "progress" });
    recordPackage({ roots: f.roots, taskId: taskTwo.id, raw: progressTwo, type: "progress" });
    assert.equal(reconstructTask({ roots: f.roots, taskId: taskOne.id }).progress, progressOne);
    assert.equal(reconstructTask({ roots: f.roots, taskId: taskTwo.id }).progress, progressTwo);

    const completionOne = workerPackage(taskOne, assignmentOne, "completion", "worker one complete");
    const completionTwo = workerPackage(taskTwo, assignmentTwo, "completion", "worker two complete");
    recordPackage({ roots: f.roots, taskId: taskOne.id, raw: completionOne, type: "completion" });
    recordPackage({ roots: f.roots, taskId: taskTwo.id, raw: completionTwo, type: "completion" });
    assert.equal(reconstructTask({ roots: f.roots, taskId: taskOne.id }).report, completionOne);
    assert.equal(reconstructTask({ roots: f.roots, taskId: taskTwo.id }).report, completionTwo);

    acceptTask({ roots: f.roots, taskId: taskOne.id });
    acceptTask({ roots: f.roots, taskId: taskTwo.id });
    const commit = execFileSync("git", ["-C", f.projectRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    markLanded({ roots: f.roots, taskId: taskOne.id, evidence: { target: "local-only", commit } });
    markLanded({ roots: f.roots, taskId: taskTwo.id, evidence: { target: "local-only", commit } });

    releaseEndpoint({ roots: f.roots, taskId: taskOne.id, adapter: f.adapter });
    releaseEndpoint({ roots: f.roots, taskId: taskTwo.id, adapter: f.adapter });
    assert.deepEqual(f.adapter.list(), []);
    assert.equal(assignmentOne.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(assignmentTwo.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(cleanupTask({ roots: f.roots, taskId: taskOne.id, workspaceReleased: true }), true);
    assert.equal(cleanupTask({ roots: f.roots, taskId: taskTwo.id, workspaceReleased: true }), true);
    assert.equal(execFileSync("git", ["-C", f.projectRoot, "worktree", "list", "--porcelain"], { encoding: "utf8" }).split(/\n/).filter((line) => line.startsWith("worktree ")).length, 1);

    const backlog = fs.readFileSync(path.join(f.roots.foremanHome, "data", "backlog.md"), "utf8");
    const done = fs.readFileSync(path.join(f.roots.foremanHome, "data", "done.md"), "utf8");
    assert.equal(backlog.includes(taskOne.id), false);
    assert.equal(backlog.includes(taskTwo.id), false);
    assert.equal(done.includes(taskOne.id), true);
    assert.equal(done.includes(taskTwo.id), true);
    assert.equal(execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" }), cleanBefore);
  } finally {
    f.cleanup();
  }
});
