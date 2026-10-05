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
  confirmTaskProfile,
  assignTask,
  dispatchReadyTasks,
  renderUserReport,
  fleetStatus,
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
    groups: {
      ordinary: { whenToUse: "Routine work under the current design.", profiles: ["codex-default", "omp-fast"] },
      deep: { whenToUse: "Work requiring a new design.", profiles: ["claude-deep"] },
    },
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

test("routing config preserves an optional Lead profile and rejects invalid or inactive choices", () => {
  const config = routingConfig();
  assert.equal(validateRoutingConfig(config).leadProfile, undefined);
  assert.equal(validateRoutingConfig({ ...config, leadProfile: "claude-deep" }).leadProfile, "claude-deep");
  for (const leadProfile of [null, true, "", "missing-profile"]) {
    assert.throws(() => validateRoutingConfig({ ...config, leadProfile }), /Routing leadProfile must name an active configured profile/);
  }
  config.profiles["claude-deep"].isActive = false;
  assert.throws(() => validateRoutingConfig({ ...config, leadProfile: "claude-deep" }), /Routing leadProfile must name an active configured profile/);
});

test("routing config supports codex, claude, omp, opencode and reads the repository file", () => {
  const f = fixture();
  try {
    assert.throws(() => initRoutingConfig({ roots: f.roots }), /Model routing config does not exist/);
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    const repositoryConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/model-routing.json"), "utf8"));
    fs.writeFileSync(path.join(f.roots.foremanRoot, "config", "model-routing.json"), `${JSON.stringify(repositoryConfig, null, 2)}\n`);
    const initialized = initRoutingConfig({ roots: f.roots });
    const allRepositoryProfiles = validateRoutingConfig(repositoryConfig, { includeAllProfiles: true }).allProfiles;
    assert.equal(initialized.file, path.join(f.roots.foremanRoot, "config", "model-routing.json"));
    assert.equal(initialized.config.router.tool, "codex");
    assert.equal(initialized.config.default, repositoryConfig.default);
    assert.equal(initialized.config.router.model, repositoryConfig.router.model);
    assert.ok(initialized.config.router.command.includes("--skip-git-repo-check"));
    assert.deepEqual(allRepositoryProfiles["codex-luna"].command, ["codex", "--yolo", "--config", 'model_reasoning_effort="high"']);
    assert.deepEqual(allRepositoryProfiles["opencode-sol"].command, ["opencode", "mini", "--standalone"]);
    assert.equal(allRepositoryProfiles["opencode-sol"].model, "openai/gpt-6.1-sol");
    assert.deepEqual(allRepositoryProfiles["opencode-luna"].command, ["opencode", "mini", "--standalone"]);
    assert.equal(allRepositoryProfiles["opencode-luna"].model, "openai/gpt-6-luna");
    assert.deepEqual([...initialized.config.inactiveProfiles].sort(), Object.entries(repositoryConfig.profiles).filter(([, profile]) => profile.isActive === false).map(([name]) => name).sort());
    assert.deepEqual(loadRoutingConfig(f.roots.foremanRoot), initialized.config);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "config", "model-routing.json")), false);
    const normalized = validateRoutingConfig(routingConfig());
    assert.deepEqual(Object.keys(normalized.profiles), ["codex-default", "claude-deep", "omp-fast"]);
    assert.deepEqual(normalized.groups.ordinary.profiles, ["codex-default", "omp-fast"]);
    assert.deepEqual(normalized.groups.deep.profiles, ["claude-deep"]);
    const withEffort = routingConfig();
    withEffort.router.effort = "low";
    withEffort.profiles["codex-default"].effort = "high";
    withEffort.profiles["claude-deep"].effort = "xhigh";
    withEffort.profiles["omp-fast"].effort = "medium";
    const normalizedEffort = validateRoutingConfig(withEffort);
    assert.deepEqual(normalizedEffort.router.command.slice(-2), ["--config", 'model_reasoning_effort="low"']);
    assert.deepEqual(normalizedEffort.profiles["codex-default"].command.slice(-2), ["--config", 'model_reasoning_effort="high"']);
    assert.deepEqual(normalizedEffort.profiles["claude-deep"].command.slice(-2), ["--effort", "xhigh"]);
    assert.deepEqual(normalizedEffort.profiles["omp-fast"].command.slice(-2), ["--thinking", "medium"]);
    assert.throws(() => validateRoutingConfig({ ...withEffort, router: { ...withEffort.router, effort: "ultra" } }), ValidationError);
    const openCode = routingConfig();
    openCode.groups.ordinary.profiles.push("opencode-worker");
    openCode.profiles["opencode-worker"] = { tool: "opencode", command: ["opencode", "mini", "--standalone"], model: "openai/gpt-6-sol", effort: null, whenToUse: "Explicit OpenCode requests." };
    assert.deepEqual(validateRoutingConfig(openCode).profiles["opencode-worker"].command, ["opencode", "mini", "--standalone"]);
    openCode.profiles["opencode-worker"].effort = "high";
    assert.equal(validateRoutingConfig(openCode).profiles["opencode-worker"].effort, "high");
    openCode.profiles["opencode-worker"].model = "openai/gpt-6-sol#deep";
    assert.throws(() => validateRoutingConfig(openCode), /must not both specify a variant/);
    openCode.profiles["opencode-worker"].effort = null;
    assert.equal(validateRoutingConfig(openCode).profiles["opencode-worker"].model, "openai/gpt-6-sol#deep");
    openCode.profiles["opencode-worker"].command = ["opencode", "mini", "--standalone", "--variant", "deep"];
    assert.throws(() => validateRoutingConfig(openCode), /must be configured through the model or effort field/);
    openCode.profiles["opencode-worker"].command = ["opencode", "mini", "--standalone"];
    openCode.profiles["opencode-worker"].model = "gpt-6-sol";
    assert.throws(() => validateRoutingConfig(openCode), /provider\/model/);
    openCode.profiles["opencode-worker"].model = "openai/gpt-6-sol";
    openCode.profiles["opencode-worker"].command = ["opencode", "mini"];
    assert.throws(() => validateRoutingConfig(openCode), /pane-local standalone server/);
    openCode.profiles["opencode-worker"].command = ["opencode", "--auto", "mini", "--standalone"];
    assert.throws(() => validateRoutingConfig(openCode), /does not support --auto/);
    openCode.profiles["opencode-worker"].command = ["opencode", "--standalone"];
    assert.throws(() => validateRoutingConfig(openCode), /interactive mini interface/);
    openCode.profiles["opencode-worker"].command = ["opencode", "mini", "--auto", "--standalone"];
    assert.throws(() => validateRoutingConfig(openCode), /does not support --auto/);
    assert.throws(() => validateRoutingConfig({ ...withEffort, profiles: { ...withEffort.profiles, "omp-fast": { ...withEffort.profiles["omp-fast"], command: ["omp", "--thinking", "low"] } } }), /must not duplicate its effort field/);
    assert.throws(() => validateRoutingConfig({ ...routingConfig(), router: { ...routingConfig().router, tool: "unknown" } }), ValidationError);
    const invalidGroups = routingConfig();
    invalidGroups.groups.ordinary.profiles.push("missing-profile");
    assert.throws(() => validateRoutingConfig(invalidGroups), /Unknown routing group profile/);
    invalidGroups.groups.ordinary.profiles.pop();
    invalidGroups.groups.deep.profiles.push("codex-default");
    assert.throws(() => validateRoutingConfig(invalidGroups), /belongs to multiple groups/);
    invalidGroups.groups.deep.profiles.pop();
    invalidGroups.groups.ordinary.profiles.pop();
    assert.throws(() => validateRoutingConfig(invalidGroups), /has no group/);
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
      confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: name });
      const assigned = assignTask({ roots: f.roots, taskId: task.id, owner: `worker-${name}`, adapter, resources: [{ key: `file/${name}`, mode: "write" }] });
      const expected = { name, ...profile };
      assert.deepEqual(requests.at(-1).dispatchProfile, expected);
      assert.deepEqual(assigned.dispatchProfile, expected);
      assert.equal(assigned.status, "working");
    }
    assert.equal(requests.length, Object.keys(config.profiles).length);
  } finally { f.cleanup(); }
});

test("task creation always routes and persists the selected worker profile", () => {
  const f = fixture();
  try {
    const configured = routingConfig();
    configured.profiles["claude-deep"].effort = "high";
    configured.groups = {
      routine: { whenToUse: "Small changes under the current contract.", profiles: ["omp-fast", "codex-default"] },
      research: { whenToUse: "Design a new cross-system protocol.", profiles: ["claude-deep"] },
    };
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
    const groups = JSON.parse(request.prompt.match(/^Groups: (.+)$/m)[1]);
    assert.deepEqual(groups.map(({ group, whenToUse, profiles }) => ({
      group, whenToUse, profiles: profiles.map(({ profile }) => profile),
    })), [
      { group: "routine", whenToUse: "Small changes under the current contract.", profiles: ["omp-fast", "codex-default"] },
      { group: "research", whenToUse: "Design a new cross-system protocol.", profiles: ["claude-deep"] },
    ]);
    assert.match(request.prompt, /Refactor the lifecycle architecture/);
    assert.equal(task.routing.profile, "claude-deep");
    assert.equal(task.routing.source, "router");
    const meta = listTasks({ roots: f.roots })[0];
    assert.equal(meta.status, "queued");
    assert.equal(meta.dispatchProfile.tool, "claude");
    assert.deepEqual(meta.dispatchProfile.command, ["claude", "--dangerously-skip-permissions", "--effort", "high"]);
    assert.equal(meta.dispatchProfile.model, "claude-opus");
    assert.equal(meta.routingSource, "router");
    assert.equal(meta.routingReason, "Broad architectural work.");
    const record = task.routing;
    assert.equal(record.profile, "claude-deep");
    assert.equal(record.reason, "Broad architectural work.");
    assert.match(record.configDigest, /^[a-f0-9]{64}$/);
    assert.match(record.briefDigest, /^[a-f0-9]{64}$/);
  } finally { f.cleanup(); }
});

test("a routed task dispatches only after the human confirms a recommended or other active profile", () => {
  const f = fixture();
  try {
    const configured = routingConfig();
    configured.profiles["omp-fast"].isActive = false;
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    fs.writeFileSync(path.join(f.roots.foremanRoot, "config", "model-routing.json"), `${JSON.stringify(configured, null, 2)}\n`);
    const spawned = [];
    const adapter = {
      verifyCompatibility: () => ({ compatible: true }),
      capabilities: () => ({ agentKind: true, tool: true, command: true, model: true, reasoningEffort: false }),
      spawn(request) { spawned.push(request); return { endpoint: request.owner }; },
      inspect(endpoint) { const request = spawned.find((item) => item.owner === endpoint); return { endpoint, owner: endpoint, cwd: request.cwd, status: "working" }; },
      send() { return { delivered: true }; },
    };
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Routine fix.", routingRunner: () => ({ profile: "claude-deep", reason: "Test selection." }) });
    assert.deepEqual(task.routing.profileOptions.map(({ option, profile, recommended }) => ({ option, profile, recommended })), [
      { option: 1, profile: "claude-deep", recommended: true },
      { option: 2, profile: "codex-default", recommended: false },
    ]);
    assert.throws(() => assignTask({ roots: f.roots, taskId: task.id, adapter }), /not confirmed/);
    assert.deepEqual(dispatchReadyTasks({ roots: f.roots, adapter }), []);
    assert.equal(spawned.length, 0);
    assert.match(renderUserReport({ tasks: listTasks({ roots: f.roots }) }, f.roots), /Cần bạn chọn model[\s\S]*đề xuất `claude-deep`/);
    assert.throws(() => confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "omp-fast" }), /inactive/);
    assert.throws(() => confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "invented" }), /Unknown worker profile/);
    const confirmed = confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "codex-default" });
    assert.equal(confirmed.recommended, "claude-deep");
    const waiting = fleetStatus({ roots: f.roots, adapter: { list: () => [] } });
    assert.equal(waiting.tasks[0].state, "queued");
    assert.doesNotMatch(renderUserReport(waiting, f.roots), /Bất thường|chọn model/);
    const assigned = assignTask({ roots: f.roots, taskId: task.id, adapter });
    assert.equal(spawned[0].dispatchProfile.name, "codex-default");
    assert.equal(assigned.dispatchProfile.model, "default-codex");
    assert.equal(assigned.routingProfile, "claude-deep");
    assert.throws(() => confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-deep" }), /unassigned queued task/);
  } finally { f.cleanup(); }
});

test("inactive profiles are hidden from the router and never selected", () => {
  const f = fixture();
  try {
    const configured = routingConfig();
    configured.profiles["claude-deep"].isActive = false;
    configured.profiles["omp-fast"].isActive = true;
    const normalized = validateRoutingConfig(configured);
    assert.deepEqual(Object.keys(normalized.profiles), ["codex-default", "omp-fast"]);
    assert.deepEqual(normalized.inactiveProfiles, ["claude-deep"]);
    assert.deepEqual(Object.keys(normalized.groups), ["ordinary"]);
    assert.throws(() => validateRoutingConfig({ ...configured, default: "claude-deep" }), /active configured profile/);
    assert.throws(() => validateRoutingConfig({ ...configured, profiles: { ...configured.profiles, "omp-fast": { ...configured.profiles["omp-fast"], isActive: "no" } } }), /isActive must be a boolean/);
    fs.mkdirSync(path.join(f.roots.foremanRoot, "config"));
    fs.writeFileSync(path.join(f.roots.foremanRoot, "config", "model-routing.json"), `${JSON.stringify(configured, null, 2)}\n`);
    let prompt;
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Deep work.", routingRunner(input) { prompt = input.prompt; return { profile: "claude-deep" }; } });
    assert.doesNotMatch(prompt, /claude-deep/);
    assert.equal(task.routing.profile, "codex-default");
    assert.equal(task.routing.source, "default");
    assert.match(task.routing.error, /inactive profile/);
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
