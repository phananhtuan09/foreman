const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const coordination = require("../src/coordination");
const slp = require("../src/slp");

const { REPO_ROOT, FakeHerdrAdapter, isolatedRoot, makeProject } = require("./helpers/slp-fakes");
// Longer than the 32-character Herdr agent name limit once prefixed.
const PROJECT_ID = "herdr-pilot-with-a-long-identifier";

function fixture({ skill = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-slp-herdr-"));
  const projectRoot = makeProject(base, "project", { skill });
  const roots = core.resolveRoots({ foremanRoot: isolatedRoot(base), foremanHome: path.join(base, "home") });
  core.initHome(roots);
  core.registerProject({ roots, id: PROJECT_ID, root: projectRoot, name: "Herdr pilot" });
  return { base, projectRoot, roots, adapter: new FakeHerdrAdapter(), cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

function createHerdrSlpTask(f, brief = "Complete a small project change on Herdr.") {
  const task = core.createTask({ roots: f.roots, projectId: PROJECT_ID, backend: "herdr", taskModel: "slp", brief, routingRunner: () => ({ profile: "claude-sonnet", reason: "Herdr SLP test profile." }) });
  core.confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-sonnet" });
  if (!slp.readLead(f.roots.foremanHome, PROJECT_ID)) slp.confirmProjectLeadProfile({ roots: f.roots, projectId: PROJECT_ID, profileName: "claude-sonnet", backend: "herdr", adapter: f.adapter });
  return task.id;
}

function envelope({ taskId, leadGeneration, requestId, action = "create-peer", payload }) {
  return { schemaVersion: 1, requestId, projectId: PROJECT_ID, leadGeneration, taskId, action, payload };
}

function implementationRequest(taskId, generation, requestId = "R-impl-1") {
  return envelope({
    taskId,
    leadGeneration: generation,
    requestId,
    payload: {
      role: "implementation",
      brief: "Add the requested bounded project change and report evidence.",
      scope: "docs/pilot.md",
      resources: [{ key: "file/docs/pilot.md", mode: "write" }],
      dependsOn: [],
      resolves: [],
    },
  });
}

function peerReport(peer, overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    assignmentId: peer.taskId,
    generation: peer.generation,
    status: "done",
    summary: "Implementation is complete.",
    changedSurfaces: ["docs/pilot.md"],
    checks: [{ name: "focused check", result: "passed", source: "peer run", evidence: "reported output" }],
    openItems: [],
    ...overrides,
  });
}

function startLead(f, taskId) {
  const dispatch = slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
  const lead = slp.readLead(f.roots.foremanHome, PROJECT_ID);
  return { dispatch, lead };
}

function tick(f) { return slp.coordinatorTick({ roots: f.roots, adapter: f.adapter }); }

test("Herdr Lead binds to a pane, gets a valid hashed name, and is told to use the request command", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { dispatch, lead } = startLead(f, taskId);
    assert.equal(dispatch.status, "working");
    assert.equal(lead.backend, "herdr");
    assert.match(lead.owner, /^slp-lead-[a-f0-9]{8}-g1$/);
    assert.equal(lead.paneId, f.adapter.agents.get(lead.endpoint).paneId);
    assert.equal(lead.timelineCursor, null);
    assert.equal(f.adapter.sent.length, 1);
    assert.match(f.adapter.sent[0].prompt, /bin\/foreman" lead request/);
    assert.doesNotMatch(f.adapter.sent[0].prompt, /final response/);
  } finally {
    f.cleanup();
  }
});

test("Herdr SLP dispatch is refused without changing backend when the adapter lacks a required capability or backend differs", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const incomplete = Object.assign(new FakeHerdrAdapter(), { stop: undefined });
    assert.throws(() => slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: incomplete }), /Herdr SLP requires list, send, and stop/);
    assert.throws(() => slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: { backend: "other", verifyCompatibility: () => true } }), /not supported on other/);
    const paseoLike = { backend: "paseo", verifyCompatibility: () => ({ compatible: true }), capabilities: () => ({}) };
    assert.throws(() => slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: paseoLike }), /bound to herdr|SLP task is bound to herdr/);
    assert.equal(f.adapter.agents.size, 0);
  } finally {
    f.cleanup();
  }
});

test("only the bound Lead pane can submit requests, and Foreman core dispatches the Peer on Herdr", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    const request = implementationRequest(taskId, lead.generation);

    assert.throws(() => slp.submitLeadRequest({ roots: f.roots, paneId: "pane-unknown", envelope: request }), /not the current project Lead/);
    assert.throws(() => slp.submitLeadRequest({ roots: f.roots, paneId: null, envelope: request }), /not the current project Lead/);
    assert.throws(() => slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: { ...request, projectId: "other-project" } }), /does not match/);
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 0);

    const recorded = slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: request });
    assert.equal(recorded.status, "pending");
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 0, "submitting only records the request");

    tick(f);
    const peers = slp.listPeerTasks(f.roots, taskId);
    assert.equal(peers.length, 1);
    const peer = peers[0];
    assert.equal(peer.backend, "herdr");
    assert.equal(peer.peerRole, "implementation");
    assert.ok(peer.resourceLease);
    assert.ok(peer.paneId);
    const peerPrompt = f.adapter.sent.find((item) => item.endpoint === peer.endpoint).prompt;
    assert.match(peerPrompt, /report --status/);
    assert.match(peerPrompt, /"assignmentId"/);
    assert.match(peerPrompt, /JSON status must equal --status/);

    // A replay returns the recorded request instead of creating another Peer.
    slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: request });
    tick(f);
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 1);

    // The outcome reaches the Lead as a later message once its pane is idle.
    f.adapter.idle(lead.endpoint);
    tick(f);
    assert.ok(f.adapter.sent.some((item) => item.endpoint === lead.endpoint && /outcome/i.test(item.prompt) && item.prompt.includes("R-impl-1")));
  } finally {
    f.cleanup();
  }
});

test("a replaced Lead's pane can no longer submit requests", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    slp.replaceProjectLead({ roots: f.roots, projectId: PROJECT_ID, adapter: f.adapter, startCoordinator: false });
    const next = slp.readLead(f.roots.foremanHome, PROJECT_ID);
    assert.equal(next.generation, lead.generation + 1);
    assert.notEqual(next.paneId, lead.paneId);
    assert.throws(() => slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: implementationRequest(taskId, lead.generation, "R-old-pane") }), /not the current project Lead/);
    const stale = slp.submitLeadRequest({ roots: f.roots, paneId: next.paneId, envelope: implementationRequest(taskId, lead.generation, "R-old-generation") });
    assert.equal(stale.accepted === false || stale.status === "refused", true);
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 0);
  } finally {
    f.cleanup();
  }
});

test("Herdr Peer reports must be the normalized object, and the Peer is stopped only after its pane is idle", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: implementationRequest(taskId, lead.generation) });
    tick(f);
    const peer = slp.listPeerTasks(f.roots, taskId)[0];

    assert.throws(() => core.recordReport({ roots: f.roots, paneId: peer.paneId, status: "done", summary: "Finished." }), /normalized JSON report/);
    assert.throws(() => core.recordReport({ roots: f.roots, paneId: peer.paneId, status: "done", summary: peerReport(peer, { assignmentId: "T-999999" }) }), /normalized JSON report/);
    assert.throws(() => core.recordReport({ roots: f.roots, paneId: peer.paneId, status: "blocked", summary: peerReport(peer) }), /status must equal/);
    assert.throws(() => core.recordReport({ roots: f.roots, paneId: peer.paneId, status: "done", summary: peerReport(peer, { checks: [{ name: "x", result: "maybe", source: "s", evidence: "e" }] }) }), /normalized JSON report/);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).status, "working");

    const reported = core.recordReport({ roots: f.roots, paneId: peer.paneId, status: "done", summary: peerReport(peer) });
    assert.equal(reported.taskStatus, "review-ready");
    assert.equal(slp.readReportPayload(slp.readTask(f.roots.foremanHome, peer.taskId)).changedSurfaces[0], "docs/pilot.md");

    // The pane is still finishing the turn that submitted the report: do not close it.
    f.adapter.agents.get(peer.endpoint).status = "working";
    f.adapter.idle(lead.endpoint);
    tick(f);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).peerRuntimeStopped, undefined);
    assert.equal(f.adapter.agents.get(peer.endpoint).status, "working");

    f.adapter.idle(peer.endpoint);
    tick(f);
    const stopped = slp.readTask(f.roots.foremanHome, peer.taskId);
    assert.equal(stopped.peerRuntimeStopped, true);
    assert.equal(stopped.resourceLease, null);
    assert.equal(f.adapter.agents.get(peer.endpoint).status, "missing");

    f.adapter.idle(lead.endpoint);
    tick(f);
    assert.ok(slp.readTask(f.roots.foremanHome, peer.taskId).peerReportDeliveredAt, "the preserved report reached the Lead");
    assert.ok(f.adapter.sent.some((item) => item.endpoint === lead.endpoint && item.prompt.includes(peer.taskId) && /Peer report/.test(item.prompt)));
  } finally {
    f.cleanup();
  }
});

test("an attempted Herdr prompt without delivery proof is marked uncertain and never resent", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    const before = f.adapter.sent.length;
    const message = coordination.listMessages({ roots: f.roots, statuses: ["delivered", "pending"] }).find((item) => item.kind === "slp-task-brief");
    // Simulate an interrupted send: the attempt marker exists but the delivery result was never recorded.
    core.withHomeLock(f.roots.foremanHome, () => {
      coordination.updateMessageUnlocked({ roots: f.roots, messageId: message.messageId, mutate: (current) => ({ ...current, status: "pending", deliveredAt: null, deliveryAttemptedAt: new Date().toISOString() }) });
    });
    const results = slp.deliverPendingLeadMessages({ roots: f.roots, projectId: PROJECT_ID, adapter: f.adapter });
    assert.equal(results[0].uncertain, true);
    assert.equal(f.adapter.sent.length, before, "an unverifiable prompt is not sent again");
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: PROJECT_ID }).anomalies.some((item) => item.type === "lead.message-delivery-uncertain"));
  } finally {
    f.cleanup();
  }
});

test("Herdr blocked status is reported as a Lead wait, not a failure", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.agents.get(lead.endpoint).status = "blocked";
    const result = tick(f);
    assert.equal(result[0].lead.state, "waiting-input");
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: PROJECT_ID }).anomalies.some((item) => item.type === "lead.permission-wait"));
  } finally {
    f.cleanup();
  }
});

test("a Lead idle without a new request after an actionable prompt is flagged once the bound elapses", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    core.withHomeLock(f.roots.foremanHome, () => core.atomicJson(path.join(f.roots.foremanHome, "data", "slp", "leads", PROJECT_ID, "meta.json"), { ...slp.readLead(f.roots.foremanHome, PROJECT_ID), lastPromptAt: old }));
    tick(f);
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: PROJECT_ID }).anomalies.some((item) => item.type === "lead.no-report"));
    slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: implementationRequest(taskId, lead.generation) });
    assert.equal(slp.projectStatus({ roots: f.roots, projectId: PROJECT_ID }).anomalies.some((item) => item.type === "lead.no-report"), false);
  } finally {
    f.cleanup();
  }
});

test("the coordinator leaves a project untouched when no adapter serves its backend", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    startLead(f, taskId);
    const sentBefore = f.adapter.sent.length;
    slp.coordinatorTick({ roots: f.roots, adapterFor: (backend) => (backend === "paseo" ? f.adapter : null) });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: PROJECT_ID }).anomalies.some((item) => item.type === "coordinator.adapter-unavailable"));
    assert.equal(f.adapter.sent.length, sentBefore);
    slp.coordinatorTick({ roots: f.roots, adapterFor: (backend) => (backend === "herdr" ? f.adapter : null) });
    assert.equal(slp.projectStatus({ roots: f.roots, projectId: PROJECT_ID }).anomalies.some((item) => item.type === "coordinator.adapter-unavailable"), false);
  } finally {
    f.cleanup();
  }
});

test("Lead recovery uses two matching missing checks on Herdr and keeps living Peers", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: implementationRequest(taskId, lead.generation) });
    tick(f);
    const peer = slp.listPeerTasks(f.roots, taskId)[0];
    f.adapter.agents.get(lead.endpoint).status = "missing";
    const recovered = slp.recoverProjectLead({ roots: f.roots, projectId: PROJECT_ID, adapter: f.adapter, startCoordinator: false });
    assert.equal(recovered.generation, lead.generation + 1);
    assert.equal(recovered.peerAssignmentsPreserved, true);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).endpoint, peer.endpoint);
    assert.match(slp.readLead(f.roots.foremanHome, PROJECT_ID).owner, /^slp-lead-[a-f0-9]{8}-g2$/);
  } finally {
    f.cleanup();
  }
});

test("a Lead can message a live Herdr Peer and an explicit Peer recovery needs two matching missing checks", () => {
  const f = fixture();
  try {
    const taskId = createHerdrSlpTask(f);
    const { lead } = startLead(f, taskId);
    f.adapter.idle(lead.endpoint);
    slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: implementationRequest(taskId, lead.generation) });
    tick(f);
    const peer = slp.listPeerTasks(f.roots, taskId)[0];

    f.adapter.idle(peer.endpoint);
    f.adapter.idle(lead.endpoint);
    slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: envelope({ taskId, leadGeneration: lead.generation, requestId: "R-msg-1", action: "message-peer", payload: { assignmentId: peer.taskId, request: "Please also cover the edge case." } }) });
    tick(f);
    const delivered = f.adapter.sent.filter((item) => item.endpoint === peer.endpoint);
    assert.equal(delivered.length, 2, "brief plus the Lead's message");
    assert.match(delivered[1].prompt, /edge case/);

    assert.throws(() => slp.recoverSlpPeer({ roots: f.roots, taskId: peer.taskId, adapter: f.adapter, startCoordinator: false }), /requires confirmed dead or missing/);
    f.adapter.agents.get(peer.endpoint).status = "missing";
    const recovered = slp.recoverSlpPeer({ roots: f.roots, taskId: peer.taskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(recovered.generation, peer.generation + 1);
    assert.match(recovered.owner, /^slp-t-\d+-r2$/);
    assert.ok(f.adapter.agents.get(recovered.endpoint));
  } finally {
    f.cleanup();
  }
});

test("the lead request command refuses to run outside a bound Herdr pane or with invalid input", () => {
  const f = fixture();
  try {
    const run = (env, input) => {
      try {
        execFileSync(process.execPath, [path.join(REPO_ROOT, "bin", "foreman"), "lead", "request"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome, ...env } });
        return "";
      } catch (error) { return error.stderr; }
    };
    assert.match(run({ FOREMAN_BACKEND: "paseo", HERDR_PANE_ID: "pane-1" }, "{}"), /for Herdr Leads/);
    assert.match(run({ FOREMAN_BACKEND: "herdr" }, "{}"), /HERDR_PANE_ID is not set/);
    assert.match(run({ FOREMAN_BACKEND: "herdr", HERDR_PANE_ID: "pane-1" }, "not json"), /not valid JSON/);
    assert.match(run({ FOREMAN_BACKEND: "herdr", HERDR_PANE_ID: "pane-1" }, "{}"), /envelope is invalid/);
  } finally {
    f.cleanup();
  }
});
