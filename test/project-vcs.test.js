const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordPackage, acceptTask, markLanded,
  releaseEndpoint, cleanupTask, listMessages, acknowledgeTaskMessage, fleetStatus, HerdrAdapter, ValidationError,
} = require("../src/foreman");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-vcs-"));
  const home = path.join(base, "home");
  const roots = resolveRoots({ foremanRoot: base, foremanHome: home });
  initHome(roots);
  const workers = new Map();
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
    spawn(request) { const endpoint = `worker-${workers.size + 1}`; workers.set(endpoint, { ...request, endpoint, status: "working" }); return { endpoint }; },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { return [...workers.values()]; },
    send(endpoint) { return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return { base, roots, workers, adapter: new HerdrAdapter({ transport }), cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

function plainProject(base, name) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), `${name}\n`);
  fs.writeFileSync(path.join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  return fs.realpathSync(root);
}

function gitProject(base, name, branch) {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", branch, root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "vcs@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Foreman VCS"]);
  fs.writeFileSync(path.join(root, "README.md"), `${name}\n`);
  execFileSync("git", ["-C", root, "add", "README.md"]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"], { stdio: "pipe" });
  return fs.realpathSync(root);
}

function packageFor(task, assignment, type, body) {
  return [`TASK: ${task.id}`, `PROJECT: ${task.projectId}`, `AGENT: ${assignment.owner}`, `GENERATION: ${assignment.generation}`, `TYPE: ${type}`, "", body].join("\n");
}

function dispatchAndAck(f, task, resources) {
  const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources });
  const message = listMessages({ roots: f.roots }).find((item) => item.messageId === assignment.briefMessageId);
  acknowledgeTaskMessage({ roots: f.roots, taskId: task.id, messageId: message.messageId, ack: { payloadDigest: message.payloadDigest } });
  return assignment;
}

test("registration records Git presence without a default branch", () => {
  const f = fixture();
  try {
    const plain = plainProject(f.base, "plain");
    const repo = gitProject(f.base, "repo", "develop");
    fs.mkdirSync(path.join(repo, "src"));
    assert.deepEqual(registerProject({ roots: f.roots, id: "plain", root: plain }), { id: "plain", name: "plain", root: plain, vcs: "none", deliveryMode: "local-only", enabled: true });
    assert.deepEqual(registerProject({ roots: f.roots, id: "repo", root: path.join(repo, "src") }), { id: "repo", name: "repo", root: repo, vcs: "git", deliveryMode: "local-only", enabled: true });
    assert.throws(() => registerProject({ roots: f.roots, id: "missing", root: path.join(f.base, "missing") }), ValidationError);
    assert.throws(() => registerProject({ roots: f.roots, id: "file", root: path.join(plain, "README.md") }), /not a directory/);
  } finally { f.cleanup(); }
});

test("ship work in a project without Git dispatches, lands on acceptance, and cleans up", () => {
  const f = fixture();
  try {
    const root = plainProject(f.base, "plain");
    registerProject({ roots: f.roots, id: "plain", root });
    const task = createTask({ roots: f.roots, projectId: "plain", brief: "edit readme" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, workspacePath: path.join(root, "node_modules") }), /project root/);
    const assignment = dispatchAndAck(f, task);
    assert.equal(assignment.workspace, root);
    assert.equal(assignment.branch, null);
    assert.equal(f.workers.get(assignment.endpoint).workspaceMode, "shared-directory");
    const state = fleetStatus({ roots: f.roots, adapter: f.adapter }).tasks.find((item) => item.taskId === task.id);
    assert.deepEqual(state.issues.filter((issue) => /project|branch|workspace/.test(issue.type)), []);
    fs.writeFileSync(path.join(root, "README.md"), "edited\n");
    recordPackage({ roots: f.roots, taskId: task.id, raw: packageFor(task, assignment, "completion", "edited README"), type: "completion" });
    assert.equal(acceptTask({ roots: f.roots, taskId: task.id }).deliveryState, "landed");
    assert.throws(() => markLanded({ roots: f.roots, taskId: task.id, evidence: { target: "local-only", commit: "abcdef1" } }), /landed on acceptance/);
    releaseEndpoint({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(cleanupTask({ roots: f.roots, taskId: task.id, workspaceReleased: true }), true);
  } finally { f.cleanup(); }
});

test("scout in a project without Git detects file changes outside excluded directories", () => {
  const f = fixture();
  try {
    const root = plainProject(f.base, "plain");
    registerProject({ roots: f.roots, id: "plain", root });
    const clean = createTask({ roots: f.roots, projectId: "plain", type: "scout", brief: "read only" });
    const cleanAssignment = dispatchAndAck(f, clean, [{ key: "file/README.md", mode: "read" }]);
    fs.writeFileSync(path.join(root, "node_modules", "dep", "index.js"), "module.exports = 2;\n");
    recordPackage({ roots: f.roots, taskId: clean.id, raw: packageFor(clean, cleanAssignment, "completion", "no edits"), type: "completion" });
    acceptTask({ roots: f.roots, taskId: clean.id });

    const dirty = createTask({ roots: f.roots, projectId: "plain", type: "scout", brief: "read only" });
    const dirtyAssignment = assignTask({ roots: f.roots, taskId: dirty.id, owner: "scout", adapter: f.adapter, resources: [{ key: "file/README.md", mode: "read" }] });
    const message = listMessages({ roots: f.roots }).find((item) => item.messageId === dirtyAssignment.briefMessageId);
    acknowledgeTaskMessage({ roots: f.roots, taskId: dirty.id, messageId: message.messageId, ack: { payloadDigest: message.payloadDigest } });
    fs.writeFileSync(path.join(root, "notes.txt"), "scout wrote this\n");
    assert.throws(() => recordPackage({ roots: f.roots, taskId: dirty.id, raw: packageFor(dirty, dirtyAssignment, "completion", "claimed no edits"), type: "completion" }), /Scout modified production files/);
  } finally { f.cleanup(); }
});

test("landing evidence must be reachable from the task branch", () => {
  const f = fixture();
  try {
    const root = gitProject(f.base, "repo", "develop");
    registerProject({ roots: f.roots, id: "repo", root });
    const task = createTask({ roots: f.roots, projectId: "repo", brief: "change on current branch" });
    const assignment = dispatchAndAck(f, task);
    assert.equal(assignment.branch, "develop");
    execFileSync("git", ["-C", root, "switch", "-c", "elsewhere"], { stdio: "pipe" });
    fs.writeFileSync(path.join(root, "other.txt"), "other\n");
    execFileSync("git", ["-C", root, "add", "other.txt"]);
    execFileSync("git", ["-C", root, "commit", "-m", "other"], { stdio: "pipe" });
    const elsewhere = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["-C", root, "switch", "develop"], { stdio: "pipe" });
    const landed = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    recordPackage({ roots: f.roots, taskId: task.id, raw: packageFor(task, assignment, "completion", "done"), type: "completion" });
    assert.equal(acceptTask({ roots: f.roots, taskId: task.id }).deliveryState, undefined);
    assert.throws(() => markLanded({ roots: f.roots, taskId: task.id, evidence: { target: "local-only", commit: elsewhere } }), /task branch/);
    assert.equal(markLanded({ roots: f.roots, taskId: task.id, evidence: { target: "local-only", commit: landed } }).deliveryState, "landed");
  } finally { f.cleanup(); }
});
