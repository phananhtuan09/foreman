const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots,
  initHome,
  registerProject,
  createTask,
  assignTask,
  recordPackage,
  acceptTask,
  listResourceLeases,
  ResourceBusyError,
  HerdrAdapter,
} = require("../src/foreman");

class RuntimeWorkerTransport {
  constructor() {
    this.next = 1;
    this.workers = new Map();
    this.messages = [];
  }

  verifyCompatibility() { return { compatible: true, protocol: 1, endpointProtocolGeneration: 1 }; }

  spawn(request) {
    const endpoint = `runtime-worker-${this.next++}`;
    const file = request.owner === "worker-1" ? "agent-one.txt" : "agent-two.txt";
    const script = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `setTimeout(() => fs.writeFileSync(path.join(process.cwd(), ${JSON.stringify(file)}), ${JSON.stringify(request.owner + " completed\n")}), ${request.owner === "worker-1" ? 80 : 20});`,
    ].join("\n");
    const child = spawn(process.execPath, ["-e", script], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"] });
    this.workers.set(endpoint, { ...request, endpoint, child, status: "working" });
    child.on("exit", () => { const worker = this.workers.get(endpoint); if (worker) worker.status = "done"; });
    return { endpoint };
  }

  inspect(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker) return { endpoint, status: "missing" };
    return { endpoint, cwd: worker.cwd, owner: worker.owner, status: worker.status };
  }

  send(endpoint, message) {
    if (!this.workers.has(endpoint)) return { delivered: false };
    this.messages.push({ endpoint, message });
    return { delivered: true };
  }

  stop(endpoint) {
    const worker = this.workers.get(endpoint);
    if (worker?.child.exitCode === null) worker.child.kill();
    if (worker) worker.status = "missing";
    return { stopped: true };
  }

  wait(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker || worker.child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      worker.child.once("error", reject);
      worker.child.once("exit", resolve);
    });
  }
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-runtime-"));
  const projectRoot = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "runtime@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman Runtime"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "runtime\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "pipe" });
  const roots = resolveRoots({ foremanRoot: projectRoot, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: projectRoot });
  const transport = new RuntimeWorkerTransport();
  return { base, projectRoot, roots, transport, adapter: new HerdrAdapter({ transport }) };
}

function packageFor(task, assignment, body) {
  return [
    `TASK: ${task.id}`,
    `PROJECT: ${task.projectId}`,
    `AGENT: ${assignment.owner}`,
    `GENERATION: ${assignment.generation}`,
    "TYPE: completion",
    "",
    body,
  ].join("\n");
}

test("runtime workers share the current branch with disjoint resource leases", async () => {
  const f = fixture();
  try {
    const one = createTask({ roots: f.roots, projectId: "fixture", brief: "write worker one file" });
    const two = createTask({ roots: f.roots, projectId: "fixture", brief: "write worker two file" });
    const assignmentOne = assignTask({ roots: f.roots, taskId: one.id, owner: "worker-1", adapter: f.adapter, resources: [{ key: "file/agent-one.txt", mode: "write" }] });
    const assignmentTwo = assignTask({ roots: f.roots, taskId: two.id, owner: "worker-2", adapter: f.adapter, resources: [{ key: "file/agent-two.txt", mode: "write" }] });
    assert.equal(assignmentOne.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(assignmentTwo.workspace, fs.realpathSync(f.projectRoot));
    assert.equal(assignmentOne.branch, "main");
    assert.equal(assignmentTwo.branch, "main");
    assert.match(f.transport.messages[0].message, /Allowed resources: file\/agent-one\.txt \(write\)/);
    assert.match(f.transport.messages[0].message, /write worker one file/);
    assert.throws(() => assignTask({ roots: f.roots, taskId: createTask({ roots: f.roots, projectId: "fixture", brief: "conflict" }).id, owner: "worker-3", adapter: f.adapter, resources: [{ key: "file/agent-one.txt", mode: "write" }] }), ResourceBusyError);

    await Promise.all([f.transport.wait(assignmentOne.endpoint), f.transport.wait(assignmentTwo.endpoint)]);
    assert.equal(fs.readFileSync(path.join(f.projectRoot, "agent-one.txt"), "utf8"), "worker-1 completed\n");
    assert.equal(fs.readFileSync(path.join(f.projectRoot, "agent-two.txt"), "utf8"), "worker-2 completed\n");

    recordPackage({ roots: f.roots, taskId: one.id, raw: packageFor(one, assignmentOne, "worker one done"), type: "completion" });
    recordPackage({ roots: f.roots, taskId: two.id, raw: packageFor(two, assignmentTwo, "worker two done"), type: "completion" });
    const acceptedOne = acceptTask({ roots: f.roots, taskId: one.id, adapter: f.adapter });
    const acceptedTwo = acceptTask({ roots: f.roots, taskId: two.id, adapter: f.adapter });
    assert.equal(acceptedOne.deleted, true);
    assert.equal(acceptedTwo.deleted, true);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", one.id)), false);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", two.id)), false);
    assert.deepEqual(listResourceLeases({ roots: f.roots }), []);
    assert.notEqual(execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain"], { encoding: "utf8" }), "");
  } finally {
    fs.rmSync(f.base, { recursive: true, force: true });
  }
});
