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
  confirmTaskProfile,
  assignTask,
  adoptExistingWorker,
  collectPaseoReports,
  recordPaseoReport,
  reconstructTask,
  listTasks,
  fleetStatus,
  sendWorkerMessage,
  createDecision,
  answerDecision,
  deliverDecision,
  recoverDeadWorker,
  acceptTask,
  listResourceLeases,
  ValidationError,
  StaleGenerationError,
} = require("../src/foreman");
const { syncPaseoProfiles, planPaseoProfileSync, loadPaseoRoutingConfig } = require("../src/paseo-routing");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-paseo-"));
  const projectRoot = path.join(base, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "paseo@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman Paseo"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "Paseo fixture\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "ignore" });
  fs.mkdirSync(path.join(projectRoot, "config"), { recursive: true });
  for (const file of ["model-routing.json", "paseo-agent-profiles.json"]) {
    fs.copyFileSync(path.join(__dirname, "../config", file), path.join(projectRoot, "config", file));
  }
  const routingFile = path.join(projectRoot, "config", "model-routing.json");
  const routing = JSON.parse(fs.readFileSync(routingFile, "utf8"));
  routing.default = "codex-luna";
  for (const profile of Object.values(routing.profiles)) profile.isActive = true;
  fs.writeFileSync(routingFile, `${JSON.stringify(routing, null, 2)}\n`);
  const roots = resolveRoots({ foremanRoot: projectRoot, foremanHome: path.join(base, "foreman-home") });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: projectRoot });
  const adapter = new FakePaseoAdapter();
  return { base, projectRoot, roots, adapter, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

class FakePaseoAdapter {
  constructor() { this.backend = "paseo"; this.next = 1; this.agents = new Map(); this.calls = []; }
  verifyCompatibility() { this.calls.push("verify"); return { compatible: true }; }
  capabilities() { return { provider: true, model: true, modeId: true, thinkingOptionId: true, featureValues: true }; }
  spawn(request) {
    const endpoint = `agent-${this.next}`;
    const workspaceId = `workspace-${this.next++}`;
    const agent = { ...request, endpoint, endpointId: endpoint, agentId: endpoint, workspaceId, status: "idle", attentionTimestamp: null, attentionReason: null, activeTurn: null, requiresAttention: false, cursor: { epoch: `epoch-${endpoint}`, seq: 0 }, entries: [] };
    this.agents.set(endpoint, agent);
    return { endpoint, endpointId: endpoint, agentId: endpoint, workspaceId, paneId: null };
  }
  inspect(endpoint) {
    this.calls.push(`inspect:${endpoint}`);
    const agent = this.agents.get(endpoint);
    return agent ? { endpoint, endpointId: endpoint, agentId: endpoint, owner: agent.owner, taskId: agent.taskId, projectId: agent.projectId, generation: agent.generation, cwd: agent.cwd, workspaceId: agent.workspaceId, status: agent.status, activeTurn: agent.activeTurn, requiresAttention: agent.requiresAttention, attentionReason: agent.attentionReason, attentionTimestamp: agent.attentionTimestamp } : { endpoint, status: "missing" };
  }
  cursor(endpoint) { const agent = this.agents.get(endpoint); return agent ? { ...agent.cursor } : null; }
  send(endpoint, prompt, options = {}) {
    const agent = this.agents.get(endpoint);
    if (!agent || agent.status === "missing" || agent.status === "stopped") return { delivered: false };
    this.calls.push(`send:${endpoint}`);
    this.sent = this.sent || [];
    this.sent.push({ endpoint, prompt, options });
    agent.status = "running";
    agent.requiresAttention = false;
    agent.attentionReason = null;
    agent.activeTurn = { turnId: `turn-${agent.cursor.seq + 1}` };
    return { delivered: true, accepted: true };
  }
  list() { return [...this.agents.values()].filter((agent) => !["missing", "stopped"].includes(agent.status)).map((agent) => this.inspect(agent.endpoint)); }
  read(endpoint, cursor) {
    const agent = this.agents.get(endpoint);
    if (!agent) throw new Error(`missing ${endpoint}`);
    const after = cursor?.seq ?? -1;
    return { ...this.inspect(endpoint), entries: agent.entries.filter((entry) => entry.seq > after).map(({ seq, ...entry }) => entry), cursor: { ...agent.cursor }, gap: Boolean(agent.gap), staleCursor: Boolean(agent.staleCursor) };
  }
  finish(endpoint, text, { status = "idle", reason = "finished", turnId } = {}) {
    const agent = this.agents.get(endpoint);
    const id = turnId || `turn-${agent.cursor.seq + 1}`;
    agent.cursor = { ...agent.cursor, seq: agent.cursor.seq + 1 };
    agent.entries.push({ seq: agent.cursor.seq, turnId: id, item: { type: "assistant_message", text } });
    agent.status = status;
    agent.requiresAttention = true;
    agent.attentionReason = reason;
    agent.attentionTimestamp = new Date().toISOString();
    agent.activeTurn = null;
  }
  stop(endpoint) {
    const agent = this.agents.get(endpoint);
    if (agent) agent.status = "stopped";
    return { stopped: true };
  }
}

function routeAndAssign(f, brief = "Inspect this fixture and report what it contains; do not edit files.", type = "scout") {
  const task = createTask({ roots: f.roots, projectId: "fixture", brief, type, backend: "paseo", routingRunner: () => ({ profile: "codex-luna", reason: "Codex is the configured default." }) });
  assert.equal(task.routing.profile, "codex-luna");
  const selected = confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "codex-luna" });
  assert.equal(selected.dispatchProfile.provider, "codex");
  const assignment = assignTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
  return { task, assignment };
}

test("Paseo profile sync replaces only repo-owned profiles and verifies the selected home", () => {
  const f = fixture();
  try {
    const repoProfiles = JSON.parse(fs.readFileSync(path.join(f.projectRoot, "config/paseo-agent-profiles.json"), "utf8"));
    const manual = [{ id: "manual-alpha", name: "Manual Alpha", provider: "codex" }, { id: "manual-beta", name: "Manual Beta", provider: "opencode" }];
    const plan = planPaseoProfileSync({ foremanRoot: f.projectRoot, currentProfiles: [manual[0], { id: "foreman-obsolete", name: "Old", provider: "codex" }, manual[1]] });
    assert.deepEqual(plan.profiles.filter(({ id }) => !id.startsWith("foreman-")), manual);
    assert.deepEqual(plan.profiles.filter(({ id }) => id.startsWith("foreman-")).map(({ id }) => id), repoProfiles.map(({ id }) => id));
    assert.throws(() => planPaseoProfileSync({ foremanRoot: f.projectRoot, currentProfiles: [{ id: "manual", name: "A", provider: "codex" }, { id: "manual", name: "B", provider: "codex" }] }), /duplicated/);

    const fakeHome = path.join(f.base, "paseo-home");
    const fakeCommand = path.join(f.base, "paseo-fake.js");
    fs.writeFileSync(fakeCommand, `#!/usr/bin/env node\nconst fs=require('node:fs');const path=require('node:path');const a=process.argv.slice(2);const i=a.indexOf('--home');const h=path.resolve(process.env.PASEO_FAKE_HOME||(i>=0?a[i+1]:process.env.HOME));const target=path.resolve(i>=0?a[i+1]:process.env.HOME);const f=path.join(target,'profiles.json');if(a[0]==='daemon'&&a[1]==='status'){process.stdout.write(JSON.stringify({home:h,connectedDaemon:'reachable',daemonVersion:'0.10.0'}));}else if(a[0]==='daemon'&&a[1]==='config'&&a[2]==='get'){process.stdout.write(JSON.stringify(fs.existsSync(f)?{set:true,value:JSON.parse(fs.readFileSync(f,'utf8'))}:{set:false}));}else if(a[0]==='daemon'&&a[1]==='config'&&a[2]==='set'){fs.mkdirSync(target,{recursive:true});fs.writeFileSync(f,JSON.stringify(JSON.parse(a[4])));process.stdout.write('ok');}else{process.exit(2);}\n`);
    fs.chmodSync(fakeCommand, 0o755);
    const env = { ...process.env, FOREMAN_PASEO_HOME: fakeHome, FOREMAN_PASEO_COMMAND: fakeCommand };
    const options = { command: fakeCommand, env };
    const existing = [manual[0], { id: "foreman-obsolete", name: "Old", provider: "codex" }, manual[1]];
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.writeFileSync(path.join(fakeHome, "profiles.json"), JSON.stringify(existing));
    const dry = syncPaseoProfiles({ foremanRoot: f.projectRoot, dryRun: true, commandOptions: options });
    assert.equal(dry.changed, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fakeHome, "profiles.json"), "utf8")), existing);
    const synced = syncPaseoProfiles({ foremanRoot: f.projectRoot, commandOptions: options });
    assert.equal(synced.preservedProfiles, 2);
    const installed = JSON.parse(fs.readFileSync(path.join(fakeHome, "profiles.json"), "utf8"));
    assert.deepEqual(installed.filter(({ id }) => !id.startsWith("foreman-")), manual);
    assert.deepEqual(installed.filter(({ id }) => id.startsWith("foreman-")).map(({ id }) => id), repoProfiles.map(({ id }) => id));
    assert.equal(syncPaseoProfiles({ foremanRoot: f.projectRoot, commandOptions: options }).changed, false);

    const cliHome = path.join(f.base, "paseo-cli-home");
    const cliForemanHome = path.join(f.base, "foreman-cli-home");
    const cliEnv = { ...env, FOREMAN_PASEO_HOME: cliHome, FOREMAN_HOME: cliForemanHome, FOREMAN_ROOT: path.resolve(__dirname, "..") };
    const cliOutput = execFileSync(path.join(__dirname, "../bin/foreman-paseo"), ["profiles", "sync"], { cwd: cliEnv.FOREMAN_ROOT, encoding: "utf8", env: cliEnv });
    assert.equal(JSON.parse(cliOutput).changed, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cliHome, "profiles.json"), "utf8")).length, repoProfiles.length);

    const wrongHome = { ...env, FOREMAN_PASEO_HOME: path.join(f.base, "other-home"), PASEO_FAKE_HOME: fakeHome };
    assert.throws(() => syncPaseoProfiles({ foremanRoot: f.projectRoot, commandOptions: { command: fakeCommand, env: wrongHome } }), /home mismatch/);
  } finally { f.cleanup(); }
});

test("Paseo maps inactive model profiles without making them selectable", () => {
  const f = fixture();
  try {
    const routingFile = path.join(f.projectRoot, "config/model-routing.json");
    const routing = JSON.parse(fs.readFileSync(routingFile, "utf8"));
    routing.profiles["codex-sol"].isActive = false;
    fs.writeFileSync(routingFile, `${JSON.stringify(routing, null, 2)}\n`);
    const loaded = loadPaseoRoutingConfig(f.projectRoot, { required: true }).config;
    assert.equal(loaded.profiles["codex-sol"], undefined);
    assert.equal(loaded.allProfiles["codex-sol"].paseoProfileId, "foreman-codex-sol");
    assert.equal(loaded.allProfiles["codex-sol"].isActive, false);
    assert.deepEqual(Object.keys(loaded.allProfiles).sort(), Object.keys(routing.profiles).sort());
  } finally { f.cleanup(); }
});

test("Paseo Claude profile carries the permission mode into dispatch", () => {
  const f = fixture();
  try {
    const profiles = loadPaseoRoutingConfig(f.projectRoot, { required: true }).config.profiles;
    assert.equal(profiles["claude-opus"].modeId, "bypassPermissions");
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Inspect README.md.", type: "scout", backend: "paseo", routingRunner: () => ({ profile: "claude-sonnet", reason: "Use Claude." }) });
    const selected = confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-sonnet" });
    assert.equal(selected.dispatchProfile.modeId, "bypassPermissions");
    const assignment = assignTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(f.adapter.agents.get(assignment.endpoint).dispatchProfile.modeId, "bypassPermissions");
  } finally { f.cleanup(); }
});

test("Paseo profile mismatch keeps the task queued with a reviewable dispatch error", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Inspect README.md.", type: "scout", backend: "paseo", routingRunner: () => ({ profile: "codex-luna", reason: "Use Codex." }) });
    confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "codex-luna" });
    const adapter = Object.create(f.adapter);
    adapter.spawn = () => { throw new Error("Paseo profile is out of sync: foreman-codex-luna; run bin/foreman-paseo profiles sync"); };
    assert.throws(() => assignTask({ roots: f.roots, taskId: task.id, adapter }), /profile is out of sync/);
    const meta = reconstructTask({ roots: f.roots, taskId: task.id }).meta;
    assert.equal(meta.status, "queued");
    assert.match(meta.dispatchError, /profiles sync/);
  } finally { f.cleanup(); }
});

test("Paseo routes through repo profiles, dispatches a durable brief, collects a valid report, and accepts after archive", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    assert.equal(assignment.backend, "paseo");
    assert.equal(assignment.workspaceId, "workspace-1");
    assert.equal(assignment.paneId, null);
    assert.equal(assignment.dispatchProfile.name, "codex-luna");
    assert.equal(assignment.dispatchProfile.paseoProfileId, "foreman-codex-luna");
    const sent = f.adapter.sent[0];
    assert.equal(sent.options.messageId, assignment.briefMessageId);
    assert.match(sent.prompt, /return exactly one JSON object/i);
    assert.doesNotMatch(sent.prompt, /"\$FOREMAN_ROOT\/bin\/foreman" report/);

    f.adapter.finish(assignment.endpoint, `\n\n---\n\n${JSON.stringify({ status: "done", summary: "Read README.md; no files changed." })}`);
    const result = collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    assert.equal(result.tasks[0].status, "done");
    const completed = reconstructTask({ roots: f.roots, taskId: task.id });
    assert.equal(completed.meta.status, "review-ready");
    assert.match(completed.report, /\n\n---\n\n\{"status":"done"/);
    assert.match(completed.report, /"summary":"Read README\.md; no files changed\."/);
    assert.equal(collectPaseoReports({ roots: f.roots, adapter: f.adapter }).tasks.length, 0);
    const accepted = acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(accepted.workerStopped, true);
    assert.equal(accepted.deleted, true);
    assert.deepEqual(listResourceLeases({ roots: f.roots }), []);
  } finally { f.cleanup(); }
});

test("Paseo progress, blocked, follow-up, and decision delivery use the correct timeline cursor", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Follow up through a decision; do not edit files.");
    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "progress", summary: "Inspected the fixture." }));
    collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.status, "working");

    const followup = sendWorkerMessage({ roots: f.roots, taskId: task.id, payload: { request: "Please state the remaining dependency." }, adapter: f.adapter });
    assert.equal(followup.task.paseoCursor.seq, 1);
    assert.equal(f.adapter.sent.at(-1).options.messageId, followup.message.messageId);
    assert.match(f.adapter.sent.at(-1).prompt, /return exactly one JSON object/i);
    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "blocked", summary: "Need a user decision." }));
    collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.status, "blocked");

    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "The API can be changed in two ways.", why: "Only the user can choose compatibility behavior.", options: ["Keep old clients working", "Remove the old format"] });
    answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "Keep old clients working." });
    const delivered = deliverDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, adapter: f.adapter });
    assert.equal(delivered.status, "delivered");
    assert.match(f.adapter.sent.at(-1).prompt, /Keep old clients working/);
    assert.match(f.adapter.sent.at(-1).prompt, /Paseo returns this final response/i);
    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "progress", summary: "Applied the human decision conceptually." }));
    collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.lastReport.status, "progress");
  } finally { f.cleanup(); }
});

test("adopting a Paseo agent sends the persisted brief and binds later reports to its workspace", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Adopt this already running agent and inspect README.md.", backend: "paseo", routingRunner: () => ({ profile: "codex-luna", reason: "test" }) });
    const endpoint = "agent-existing";
    f.adapter.agents.set(endpoint, {
      endpoint,
      endpointId: endpoint,
      agentId: endpoint,
      owner: null,
      taskId: null,
      projectId: null,
      generation: null,
      cwd: f.projectRoot,
      workspaceId: "workspace-existing",
      status: "running",
      cursor: { epoch: "existing-epoch", seq: 4 },
      entries: [],
      activeTurn: { turnId: "existing-turn" },
      requiresAttention: false,
    });
    const adopted = adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: endpoint, taskId: task.id, explicit: true });
    assert.equal(adopted.backend, "paseo");
    assert.equal(adopted.endpoint, endpoint);
    assert.equal(adopted.workspaceId, "workspace-existing");
    assert.equal(adopted.resent, true);
    assert.equal(f.adapter.sent.at(-1).options.messageId, adopted.briefMessageId);
    assert.match(f.adapter.sent.at(-1).prompt, /exactly one JSON object/i);
    f.adapter.finish(endpoint, JSON.stringify({ status: "done", summary: "README inspected after adoption." }));
    const adoptedMeta = reconstructTask({ roots: f.roots, taskId: task.id }).meta;
    const snapshot = f.adapter.read(endpoint, adoptedMeta.paseoCursor);
    assert.equal(snapshot.cwd && fs.realpathSync(snapshot.cwd), fs.realpathSync(adoptedMeta.workspace));
    assert.equal(snapshot.workspaceId, adoptedMeta.workspaceId);
    const collection = collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.status, "review-ready", JSON.stringify(collection));
  } finally { f.cleanup(); }
});

test("Paseo rejects invalid, duplicate, stale-generation, and timeline-gap reports without claiming completion", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    f.adapter.finish(assignment.endpoint, "This is not the required JSON report.");
    const invalid = collectPaseoReports({ roots: f.roots, adapter: f.adapter }).tasks[0];
    assert.equal(invalid.state, "report-invalid");
    const metaAfterInvalid = reconstructTask({ roots: f.roots, taskId: task.id }).meta;
    assert.equal(metaAfterInvalid.status, "working");
    assert.equal(metaAfterInvalid.paseoReportError.type, "worker.report-invalid");
    assert.match(fs.readFileSync(metaAfterInvalid.paseoReportError.file, "utf8"), /not the required JSON report/);
    const duplicate = recordPaseoReport({ roots: f.roots, taskId: task.id, endpoint: assignment.endpoint, generation: assignment.generation, turnId: "turn-1", cursor: metaAfterInvalid.paseoCursor, raw: "Still invalid" });
    assert.equal(duplicate.duplicate, true);
    assert.throws(() => recordPaseoReport({ roots: f.roots, taskId: task.id, endpoint: assignment.endpoint, generation: assignment.generation - 1, turnId: "old", raw: JSON.stringify({ status: "done", summary: "stale" }) }), StaleGenerationError);

    const second = routeAndAssign(f, "A timeline-gap case.");
    f.adapter.agents.get(second.assignment.endpoint).gap = true;
    const gap = collectPaseoReports({ roots: f.roots, adapter: f.adapter }).tasks.find((item) => item.taskId === second.task.id);
    assert.equal(gap.state, "gap");
    assert.equal(reconstructTask({ roots: f.roots, taskId: second.task.id }).meta.status, "working");
  } finally { f.cleanup(); }
});

test("Paseo recovery uses confirmed missing evidence and mixed-backend status stays unobserved", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Recovery test.");
    const herdr = createTask({ roots: f.roots, projectId: "fixture", brief: "Existing Herdr assignment." });
    const beforeMismatchCalls = f.adapter.calls.length;
    assert.throws(() => assignTask({ roots: f.roots, taskId: herdr.id, adapter: f.adapter }), /Task backend is herdr/);
    assert.equal(f.adapter.calls.length, beforeMismatchCalls);
    const status = fleetStatus({ roots: f.roots, adapter: f.adapter });
    assert.equal(status.tasks.find((item) => item.taskId === herdr.id).state, "unobserved");

    f.adapter.agents.delete(assignment.endpoint);
    const recovered = recoverDeadWorker({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(recovered.generation, assignment.generation + 1);
    assert.notEqual(recovered.endpoint, assignment.endpoint);
    assert.equal(recovered.status, "working");
    assert.equal(recovered.backend, "paseo");
    assert.equal(f.adapter.sent.at(-1).options.messageId, recovered.briefMessageId);
    assert.match(f.adapter.sent.at(-1).prompt, /Previous work and handoff/);
    f.adapter.finish(recovered.endpoint, JSON.stringify({ status: "done", summary: "Recovered and completed." }));
    collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    assert.equal(acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter }).deleted, true);
  } finally { f.cleanup(); }
});
