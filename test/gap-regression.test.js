const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask,
  listMessages, acknowledgeTaskMessage, createDecision, answerDecision,
  deliverDecision, acknowledgeDecision, applyDecision, restartReconcile,
  retryMessages, StaleGenerationError, ValidationError, HerdrAdapter,
  recoverDeadWorker, buildHandoff, migrateJsonRecord, reconcileFleet,
  findProject, listResourceLeases, readWorkerRegistry,
} = require("../src/foreman");
const { listEvents } = require("../src/coordination");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-gaps-"));
  const project = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "config", "user.email", "gaps@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Gaps"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "ignore" });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: home });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: project });
  const workers = new Map();
  let lists = 0;
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
    spawn(request) { const endpoint = `worker-${workers.size + 1}`; workers.set(endpoint, { ...request, endpoint, status: "working" }); return { endpoint }; },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { lists += 1; return [...workers.values()]; },
    send(endpoint) { return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return { base, roots, project, transport, workers, adapter: new HerdrAdapter({ transport }), get lists() { return lists; }, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

function packageFor(task, assignment, type, body) {
  return [`TASK: ${task.id}`, `PROJECT: ${task.projectId}`, `AGENT: ${assignment.owner}`, `GENERATION: ${assignment.generation}`, `TYPE: ${type}`, "", body].join("\n");
}

function acknowledgeBrief(roots, taskId, assignment) {
  const message = listMessages({ roots }).find((item) => item.messageId === assignment.briefMessageId);
  acknowledgeTaskMessage({ roots, taskId, messageId: message.messageId, ack: { payloadDigest: message.payloadDigest } });
}

test("brief ACK is required before working and backlog activation, with current identity checks", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "ack me" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, requireMessageAck: false }), ValidationError);
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    assert.equal(assignment.schemaVersion, 1);
    assert.equal(assignment.status, "pending-ack");
    const message = listMessages({ roots: f.roots }).find((item) => item.messageId === assignment.briefMessageId);
    assert.throws(() => acknowledgeTaskMessage({ roots: f.roots, taskId: task.id, messageId: message.messageId, ack: { payloadDigest: "wrong" } }), ValidationError);
    acknowledgeTaskMessage({ roots: f.roots, taskId: task.id, messageId: message.messageId, ack: { payloadDigest: message.payloadDigest } });
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8")).status, "working");
  } finally { f.cleanup(); }
});

test("a decision cannot be applied until the current generation ACKs delivery", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "decision" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    acknowledgeBrief(f.roots, task.id, assignment);
    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "choice", why: "authority", options: ["A", "B"] });
    answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "A" });
    assert.throws(() => applyDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId }), ValidationError);
    const delivered = deliverDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, adapter: f.adapter });
    const message = listMessages({ roots: f.roots }).find((item) => item.messageId === delivered.messageId);
    acknowledgeDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, messageId: message.messageId, ack: { payloadDigest: message.payloadDigest } });
    assert.equal(readWorkerRegistry(f.roots).workers[assignment.endpoint].lastAck, message.messageId);
    assert.equal(applyDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId }).status, "applied");
    assert.equal(assignment.generation, 1);
  } finally { f.cleanup(); }
});

test("restart applies a valid direct inbox completion before its single runtime listing and quarantines invalid ACK bytes", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "restart inbox" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    acknowledgeBrief(f.roots, task.id, assignment);
    const inbox = path.join(f.roots.foremanHome, "state", "tasks", task.id, "inbox");
    const completion = packageFor(task, assignment, "completion", "durable completion");
    fs.writeFileSync(path.join(inbox, "generation-1-completion.md"), completion);
    const invalidAck = Buffer.from("{\"messageId\":\"wrong\",\"payloadDigest\":\"bad\"}\n");
    fs.writeFileSync(path.join(inbox, "generation-1-ack.json"), invalidAck);
    const result = restartReconcile({ roots: f.roots, adapter: f.adapter, retryMessages: false });
    assert.equal(f.lists, 1);
    assert.equal(result.inbox.applied.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8")).status, "review-ready");
    const quarantine = fs.readdirSync(path.join(inbox, "quarantine"));
    assert.ok(quarantine.some((name) => fs.readFileSync(path.join(inbox, "quarantine", name)).equals(invalidAck)));
  } finally { f.cleanup(); }
});

test("message retry fails once at its bound and emits one durable actionable event", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "retry" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    acknowledgeBrief(f.roots, task.id, assignment);
    const messageFile = path.join(f.roots.foremanHome, "state", "messages", `${assignment.briefMessageId}.json`);
    const message = JSON.parse(fs.readFileSync(messageFile, "utf8"));
    message.status = "delivered";
    message.attempts = message.maxAttempts - 1;
    message.lastAttemptAt = new Date(0).toISOString();
    fs.writeFileSync(messageFile, `${JSON.stringify(message, null, 2)}\n`);
    const failed = retryMessages({ roots: f.roots, adapter: { send: () => ({ delivered: false }) }, force: true });
    assert.equal(failed[0].status, "failed");
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "message.delivery-failed").length, 1);
    retryMessages({ roots: f.roots, adapter: { send: () => ({ delivered: false }) }, force: true });
    assert.equal(listEvents({ roots: f.roots, state: "pending" }).filter((event) => event.eventType === "message.delivery-failed").length, 1);
  } finally { f.cleanup(); }
});

test("unsupported profile fails before spawn and explicit fallback is forwarded unchanged", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "profile" });
    assert.throws(() => assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, dispatchProfile: { name: "full", model: "unsupported" } }), ValidationError);
    const fallback = { name: "agent-only", agentKind: "codex" };
    const assigned = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, dispatchProfile: { name: "full", model: "unsupported" }, fallbackDispatchProfile: fallback });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "meta.json"), "utf8")).dispatchProfile, fallback);
    assert.equal(assigned.dispatchProfile.name, "agent-only");
  } finally { f.cleanup(); }
});

test("dead recovery sends a durable inspect-first handoff and bounds repeated attempts", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "recover" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    f.workers.get(first.endpoint).status = "dead";
    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "successor", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.match(replacement.handoff.inspectFirst, /Inspect the existing workspace/);
    const handoffMessage = listMessages({ roots: f.roots }).find((item) => item.kind === "recovery-handoff");
    assert.equal(handoffMessage.generation, 2);
    assert.equal(handoffMessage.payload.inspectFirst, replacement.handoff.inspectFirst);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "state", "tasks", task.id, "handoff.json"), "utf8")).schemaVersion, 1);
  } finally { f.cleanup(); }
});

test("dead recovery carries prior-generation decisions into the successor handoff", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "recover decision" });
    const first = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter });
    acknowledgeBrief(f.roots, task.id, first);
    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "choice", why: "authority", options: ["A", "B"] });
    answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "A" });
    f.workers.get(first.endpoint).status = "dead";

    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "successor", adapter: f.adapter });
    assert.equal(replacement.generation, 2);
    assert.deepEqual(replacement.handoff.decisions.map((item) => item.generation), [1]);
    assert.equal(replacement.handoffMessage.generation, 2);
  } finally { f.cleanup(); }
});

test("schema migration keeps the original record and missing confirmation needs two durable observations", () => {
  const f = fixture();
  try {
    const migrationFile = path.join(f.roots.foremanHome, "data", "migration.json");
    fs.writeFileSync(migrationFile, "{\"schemaVersion\":0,\"value\":\"original\"}\n");
    migrateJsonRecord({ file: migrationFile, kind: "migration", migrate: (record) => ({ ...record, schemaVersion: 1 }) });
    assert.equal(fs.readFileSync(`${migrationFile}.original-v0`, "utf8"), "{\"schemaVersion\":0,\"value\":\"original\"}\n");
    const unsupportedFile = path.join(f.roots.foremanHome, "data", "unsupported.json");
    fs.writeFileSync(unsupportedFile, "{\"schemaVersion\":2,\"value\":\"future\"}\n");
    assert.throws(() => migrateJsonRecord({ file: unsupportedFile, kind: "unsupported", migrate: (record) => ({ ...record, schemaVersion: 1 }) }), ValidationError);
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "missing" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: "file/out", mode: "write" }] });
    f.workers.delete(assignment.endpoint);
    assert.equal(reconcileFleet({ roots: f.roots, adapter: f.adapter, missingConfirmationMs: 60_000, requireCompletionPackage: false }).tasks.find((item) => item.taskId === task.id).state, "unknown");
    assert.equal(reconcileFleet({ roots: f.roots, adapter: f.adapter, missingConfirmationMs: 0, requireCompletionPackage: false }).tasks.find((item) => item.taskId === task.id).state, "missing");
    assert.equal(buildHandoff({ roots: f.roots, taskId: task.id, reason: "missing" }).reason, "missing");
  } finally { f.cleanup(); }
});

test("startup migrates legacy home records and accepts an external linked worktree", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.roots.foremanHome, "data", "projects.json"), JSON.stringify({ version: 1, projects: [{ id: "fixture", name: "Fixture", root: f.project, defaultBranch: "main", deliveryMode: "local-only", enabled: true }] }));
    fs.writeFileSync(path.join(f.roots.foremanHome, "data", "sequence.json"), JSON.stringify({ task: 1 }));
    fs.writeFileSync(path.join(f.roots.foremanHome, "state", "resources.json"), JSON.stringify({ version: 1, leases: [] }));
    initHome(f.roots);
    assert.equal(findProject(f.roots.foremanHome, "fixture").id, "fixture");
    assert.equal(listResourceLeases({ roots: f.roots }).length, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "sequence.json"), "utf8")).schemaVersion, 1);

    const linked = path.join(f.base, "linked");
    execFileSync("git", ["-C", f.project, "worktree", "add", "-b", "linked-worker", linked], { stdio: "pipe" });
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "use linked worktree" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, workspacePath: linked });
    const state = reconcileFleet({ roots: f.roots, adapter: f.adapter, requireCompletionPackage: false }).tasks.find((item) => item.taskId === task.id);
    assert.equal(state.state, "working");
    assert.equal(state.issues.some((issue) => issue.type === "task.project-mismatch"), false);
    assert.equal(assignment.workspace, fs.realpathSync(linked));
  } finally { f.cleanup(); }
});
