const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots,
  initHome,
  initRoutingConfig,
  loadRoutingConfig,
  validateRoutingConfig,
  registerProject,
  createTask,
  assignTask,
  listTasks,
  ValidationError,
} = require("../src/foreman");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-routing-"));
  const project = path.join(base, "project");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "config", "user.email", "routing@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Routing"]);
  fs.writeFileSync(path.join(project, "README.md"), "routing\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "ignore" });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: project });
  return { base, project, roots, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

function routingConfig() {
  return {
    schemaVersion: 1,
    router: {
      tool: "codex",
      command: "codex exec --sandbox read-only --ephemeral",
      model: "router-model",
      whenToUse: "Route every new task.",
    },
    default: "codex-default",
    profiles: {
      "codex-default": {
        tool: "codex",
        command: "codex --dangerously-bypass-approvals-and-sandbox",
        model: "default-codex",
        whenToUse: "General coding work.",
      },
      "claude-deep": {
        tool: "claude",
        command: ["claude", "--dangerously-skip-permissions"],
        model: "claude-opus",
        whenToUse: "Large architecture and difficult reasoning.",
      },
      "omp-fast": {
        tool: "omp",
        command: ["omp", "--auto-approve"],
        model: "fast-model",
        whenToUse: "Small isolated changes.",
      },
    },
  };
}

test("routing config supports codex, claude, omp and reads the repository file", () => {
  const f = fixture();
  try {
    assert.throws(() => initRoutingConfig({ roots: f.roots }), /Model routing config does not exist/);
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    fs.copyFileSync(path.join(__dirname, "../config/model-routing.json"), path.join(f.roots.foremanRoot, "config", "model-routing.json"));
    const initialized = initRoutingConfig({ roots: f.roots });
    assert.equal(initialized.file, path.join(f.roots.foremanRoot, "config", "model-routing.json"));
    assert.equal(initialized.config.router.tool, "codex");
    assert.equal(initialized.config.default, "codex-sol");
    assert.equal(initialized.config.router.model, "gpt-6-luna");
    assert.deepEqual(initialized.config.profiles["codex-sol"].command, ["codex", "--yolo", "--config", 'model_reasoning_effort="medium"']);
    assert.equal(initialized.config.profiles["claude-opus"].model, "claude-opus-5-5");
    assert.deepEqual(loadRoutingConfig(f.roots.foremanRoot), initialized.config);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "config", "model-routing.json")), false);
    const normalized = validateRoutingConfig(routingConfig());
    assert.deepEqual(Object.keys(normalized.profiles), ["codex-default", "claude-deep", "omp-fast"]);
    const withEffort = routingConfig();
    withEffort.router.effort = "low";
    withEffort.profiles["codex-default"].effort = "high";
    withEffort.profiles["claude-deep"].effort = "xhigh";
    const normalizedEffort = validateRoutingConfig(withEffort);
    assert.deepEqual(normalizedEffort.router.command.slice(-2), ["--config", 'model_reasoning_effort="low"']);
    assert.deepEqual(normalizedEffort.profiles["codex-default"].command.slice(-2), ["--config", 'model_reasoning_effort="high"']);
    assert.deepEqual(normalizedEffort.profiles["claude-deep"].command.slice(-2), ["--effort", "xhigh"]);
    assert.throws(() => validateRoutingConfig({ ...withEffort, router: { ...withEffort.router, effort: "ultra" } }), ValidationError);
    assert.throws(() => validateRoutingConfig({ ...withEffort, profiles: { ...withEffort.profiles, "omp-fast": { ...withEffort.profiles["omp-fast"], effort: "low" } } }), ValidationError);
    assert.throws(() => validateRoutingConfig({ ...routingConfig(), router: { ...routingConfig().router, tool: "unknown" } }), ValidationError);
  } finally { f.cleanup(); }
});

test("each configured profile reaches worker spawn unchanged", () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    fs.copyFileSync(path.join(__dirname, "../config/model-routing.json"), path.join(f.roots.foremanRoot, "config", "model-routing.json"));
    const config = loadRoutingConfig(f.roots.foremanRoot);
    const requests = [];
    const adapter = {
      verifyCompatibility: () => ({ compatible: true }),
      capabilities: () => ({ agentKind: true, tool: true, command: true, model: true, reasoningEffort: false }),
      spawn(request) { requests.push(request); return { endpoint: request.owner }; },
      inspect(endpoint) { const request = requests.find((item) => item.owner === endpoint); return { endpoint, owner: endpoint, cwd: request.cwd, status: "working" }; },
      send() { return { delivered: true }; },
    };
    for (const [name, profile] of Object.entries(config.profiles)) {
      const task = createTask({ roots: f.roots, projectId: "fixture", brief: `Test ${name}`, routingRunner: () => ({ profile: name, reason: "Test selection." }) });
      assert.equal(task.routing.profile, name);
      const assigned = assignTask({ roots: f.roots, taskId: task.id, owner: `worker-${name}`, adapter, resources: [{ key: `file/${name}`, mode: "write" }] });
      const expected = { name, ...profile };
      assert.deepEqual(requests.at(-1).dispatchProfile, expected);
      assert.deepEqual(assigned.dispatchProfile, expected);
      assert.equal(assigned.status, "pending-ack");
    }
    assert.equal(requests.length, Object.keys(config.profiles).length);
  } finally { f.cleanup(); }
});

test("task creation always routes and persists the selected worker profile", () => {
  const f = fixture();
  try {
    const configured = routingConfig();
    configured.profiles["claude-deep"].effort = "high";
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    fs.writeFileSync(path.join(f.roots.foremanRoot, "config", "model-routing.json"), `${JSON.stringify(configured, null, 2)}\n`);
    fs.mkdirSync(path.join(f.roots.foremanHome, "config"));
    fs.writeFileSync(path.join(f.roots.foremanHome, "config", "model-routing.json"), "invalid legacy config\n");
    let request;
    const task = createTask({
      roots: f.roots,
      projectId: "fixture",
      brief: "Refactor the lifecycle architecture across the repository.",
      routingRunner(input) { request = input; return { profile: "claude-deep", reason: "Broad architectural work." }; },
    });
    assert.match(request.prompt, /claude-deep/);
    assert.match(request.prompt, /Refactor the lifecycle architecture/);
    assert.equal(task.routing.profile, "claude-deep");
    assert.equal(task.routing.source, "router");
    const meta = listTasks({ roots: f.roots })[0];
    assert.equal(meta.status, "queued");
    assert.equal(meta.dispatchProfile.tool, "claude");
    assert.deepEqual(meta.dispatchProfile.command, ["claude", "--dangerously-skip-permissions", "--effort", "high"]);
    assert.equal(meta.dispatchProfile.model, "claude-opus");
    const record = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "routing.json"), "utf8"));
    assert.equal(record.profile, "claude-deep");
    assert.equal(record.reason, "Broad architectural work.");
    assert.match(record.configDigest, /^[a-f0-9]{64}$/);
    assert.match(record.briefDigest, /^[a-f0-9]{64}$/);
  } finally { f.cleanup(); }
});

test("router failure selects only the configured default profile", () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    fs.writeFileSync(path.join(f.roots.foremanRoot, "config", "model-routing.json"), `${JSON.stringify(routingConfig(), null, 2)}\n`);
    const task = createTask({
      roots: f.roots,
      projectId: "fixture",
      brief: "Do a task.",
      routingRunner() { return { profile: "invented-profile" }; },
    });
    assert.equal(task.routing.profile, "codex-default");
    assert.equal(task.routing.source, "default");
    assert.match(task.routing.error, /unknown profile/);
    assert.equal(listTasks({ roots: f.roots })[0].dispatchProfile.name, "codex-default");
  } finally { f.cleanup(); }
});

test("an unconfigured source checkout still records that routing ran", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Keep compatibility." });
    assert.equal(task.routing.source, "unconfigured");
    assert.equal(task.routing.profile, null);
    assert.equal(listTasks({ roots: f.roots })[0].status, "queued");
  } finally { f.cleanup(); }
});
