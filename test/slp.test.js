const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const coordination = require("../src/coordination");
const slp = require("../src/slp");

const REPO_ROOT = path.resolve(__dirname, "..");
const { FakePaseoAdapter, FakeHerdrAdapter, isolatedRoot, makeProject } = require("./helpers/slp-fakes");

function fixture({ skill = true, capacity = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-slp-"));
  const projectRoot = makeProject(base, "project", { skill });
  const home = path.join(base, "home");
  const roots = core.resolveRoots({ foremanRoot: isolatedRoot(base, capacity), foremanHome: home });
  core.initHome(roots);
  core.registerProject({ roots, id: "pilot", root: projectRoot, name: "Pilot" });
  return {
    base,
    projectRoot,
    roots,
    adapter: new FakePaseoAdapter(),
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function createSlpTask(f, brief = "Complete a small project change with independent review.", purpose = "delivery") {
  const task = core.createTask({
    roots: f.roots,
    projectId: "pilot",
    backend: "paseo",
    taskModel: "slp",
    purpose,
    brief,
    routingRunner: () => ({ profile: "claude-sonnet", reason: "Paseo S1 test profile." }),
  });
  core.confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-sonnet" });
  if (!slp.readLead(f.roots.foremanHome, "pilot")) slp.confirmProjectLeadProfile({ roots: f.roots, projectId: "pilot", profileName: "claude-sonnet", adapter: f.adapter });
  return task.id;
}

function envelope({ taskId, leadGeneration, requestId, action, payload, projectId = "pilot" }) {
  return JSON.stringify({ schemaVersion: 1, requestId, projectId, leadGeneration, taskId, action, payload });
}

function leadReconstruction(taskId, leadGeneration, requestId = "R-lead-reconstruction") {
  return envelope({
    taskId,
    leadGeneration,
    requestId,
    action: "report-task",
    payload: {
      status: "progress",
      summary: "Reconstructed the current project overview before resuming Peer coordination.",
      reconstruction: {
        projectState: "Reviewed the generated current task, Peer, report, and decision overview.",
        knowledge: "Reviewed applicable project instructions and durable knowledge references.",
        coreState: "Reconciled active assignments, pending decisions, and preserved Peer reports from canonical state.",
      },
    },
  });
}

function peerReport({ taskId, generation, summary, status = "done", checkResult = "passed", openItems = [], changedSurfaces = ["docs/pilot.md"] }) {
  return JSON.stringify({
    schemaVersion: 1,
    assignmentId: taskId,
    generation,
    status,
    summary,
    changedSurfaces,
    checks: [{ name: "focused check", result: checkResult, source: "peer run", evidence: "reported output" }],
    openItems,
  });
}

function implementationRequest(taskId, generation, requestId = "R-impl-1") {
  return envelope({
    taskId,
    leadGeneration: generation,
    requestId,
    action: "create-peer",
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

function peerRequest(taskId, generation, requestId, { role = "implementation", resources, scope = "docs", dependsOn = [], resolves = [] } = {}) {
  return envelope({
    taskId,
    leadGeneration: generation,
    requestId,
    action: "create-peer",
    payload: { role, brief: `Bounded ${role} work for ${requestId}.`, scope, resources, dependsOn, resolves },
  });
}

// The Lead answers once; the coordinator reads its final response and runs the request.
function leadSays(f, text) {
  const lead = slp.readLead(f.roots.foremanHome, "pilot");
  f.adapter.finish(lead.endpoint, text);
  slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
}

function acceptedReviewPayload(relatedAssignmentIds, reviewId, outcome = "accepted") {
  return {
    reviewAssignmentId: reviewId,
    relatedAssignmentIds: Array.isArray(relatedAssignmentIds) ? relatedAssignmentIds : [relatedAssignmentIds],
    outcome,
    evidence: ["docs/pilot.md", "focused check output"],
    changedSurfaces: ["docs/pilot.md"],
    checks: [{ name: "focused check", result: "passed", source: "review Peer", evidence: "passed" }],
    integrationResult: "passed",
    unresolvedRisks: [],
    summary: "Independent review found the task complete.",
  };
}

test("configured Lead profile binds on either backend while task Peers keep their confirmed profile", () => {
  for (const backend of ["paseo", "herdr"]) {
    const f = fixture();
    const adapter = backend === "paseo" ? f.adapter : new FakeHerdrAdapter();
    const configFile = path.join(f.roots.foremanRoot, "config", "model-routing.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    config.leadProfile = "opencode-sol";
    fs.writeFileSync(configFile, JSON.stringify(config));
    try {
      const bound = slp.confirmProjectLeadProfile({ roots: f.roots, projectId: "pilot", backend, adapter });
      assert.equal(bound.profileName, "opencode-sol");
      const task = core.createTask({ roots: f.roots, projectId: "pilot", backend, taskModel: "slp", brief: "Keep Lead and Peer profiles separate.", routingRunner: () => ({ profile: "claude-sonnet" }) });
      core.confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-sonnet" });
      config.leadProfile = "opencode-luna";
      fs.writeFileSync(configFile, JSON.stringify(config));
      slp.dispatchSlpTask({ roots: f.roots, taskId: task.id, adapter, startCoordinator: false });
      const lead = slp.readLead(f.roots.foremanHome, "pilot");
      assert.equal(lead.profileName, "opencode-sol", "a config change must not change the bound Lead");
      assert.equal(adapter.agents.get(lead.endpoint).dispatchProfile.name, "opencode-sol");
      const request = JSON.parse(implementationRequest(task.id, lead.generation));
      if (backend === "paseo") adapter.finish(lead.endpoint, JSON.stringify(request));
      else { adapter.idle(lead.endpoint); slp.submitLeadRequest({ roots: f.roots, paneId: lead.paneId, envelope: request }); }
      slp.coordinatorTick({ roots: f.roots, adapter });
      const peer = slp.listPeerTasks(f.roots, task.id)[0];
      assert.equal(adapter.agents.get(peer.endpoint).dispatchProfile.name, "claude-sonnet");
      assert.throws(() => slp.confirmProjectLeadProfile({ roots: f.roots, projectId: "pilot", backend, adapter }), /Cannot change a bound Lead profile/);
    } finally { f.cleanup(); }
  }
});

test("Lead binding requires an explicit profile when legacy config has no leadProfile", () => {
  const f = fixture();
  try {
    const configFile = path.join(f.roots.foremanRoot, "config", "model-routing.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    delete config.leadProfile;
    fs.writeFileSync(configFile, JSON.stringify(config));
    assert.throws(() => slp.confirmProjectLeadProfile({ roots: f.roots, projectId: "pilot", adapter: f.adapter }), /Configure leadProfile or pass --profile/);
    assert.equal(slp.readLead(f.roots.foremanHome, "pilot"), null);
    const bound = slp.confirmProjectLeadProfile({ roots: f.roots, projectId: "pilot", profileName: "claude-sonnet", adapter: f.adapter });
    assert.equal(bound.profileName, "claude-sonnet");
  } finally { f.cleanup(); }
});

test("SLP Peer prompt distinguishes logical resource claims from its workspace path", () => {
  const prompt = coordination.deliveryPrompt({
    kind: "task-brief",
    taskId: "T-000101",
    projectId: "foreman-runtime-smoke",
    worker: "peer-1",
    generation: 1,
    payload: {
      taskModel: "slp-peer",
      parentTaskId: "T-000100",
      peerRole: "exploration",
      cwd: "/repo/foreman",
      branch: "main",
      resources: [{ key: "workspace/foreman-runtime-smoke", mode: "read" }],
      brief: "Inspect S2 evidence.",
    },
  });
  assert.match(prompt, /Workspace: \/repo\/foreman/);
  assert.match(prompt, /Allowed resources \(logical lease keys, not filesystem paths\): workspace\/foreman-runtime-smoke \(read\)/);
  assert.match(prompt, /do not append a resource key to it/);
});

test("Paseo collection does not reread a verified-stopped SLP Peer timeline", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Exercise terminal Peer timeline collection filtering.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-collection-peer"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const peer = slp.listPeerTasks(f.roots, taskId)[0];
    const peerFile = path.join(f.roots.foremanHome, "data", "tasks", peer.taskId, "meta.json");
    f.adapter.stop(peer.endpoint);
    core.atomicJson(peerFile, { ...peer, status: "blocked", peerRuntimeStopped: true });
    f.adapter.read = () => { throw new Error("verified-stopped Peer must not be reread"); };
    assert.deepEqual(core.collectPaseoReports({ roots: f.roots, adapter: f.adapter }).tasks, []);
  } finally {
    f.cleanup();
  }
});

test("serial SLP flow restarts, refuses stale steering, supports correction, and leaves acceptance to the caller", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f);
    const dispatch = slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(dispatch.status, "working");
    const legacyView = core.projectStatus({ roots: f.roots, projectId: "pilot", adapter: f.adapter });
    assert.equal(legacyView.tasks.find((item) => item.taskId === taskId).state, "working");
    assert.deepEqual(legacyView.anomalies, [], "SLP task identity is not a missing Supervisor–Worker endpoint");
    assert.equal(legacyView.workers.length, 1, "the project runtime view includes its Paseo Lead");
    const lead1 = slp.readLead(f.roots.foremanHome, "pilot");
    const leadEndpoint1 = lead1.endpoint;
    const firstRequest = implementationRequest(taskId, lead1.generation);
    f.adapter.finish(leadEndpoint1, firstRequest);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });

    let peers = slp.listPeerTasks(f.roots, taskId);
    assert.equal(peers.length, 1);
    const implementation = peers[0];
    assert.equal(implementation.peerRole, "implementation");
    assert.ok(implementation.resourceLease);
    assert.equal(f.adapter.maxActivePeers, 1);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).leadGeneration, lead1.generation);

    f.adapter.becomeIdle(leadEndpoint1);
    f.adapter.finish(leadEndpoint1, firstRequest);
    delete require.cache[require.resolve("../src/slp")];
    const restartedSlp = require("../src/slp");
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.listPeerTasks(f.roots, taskId).length, 1, "replayed request after core reload must not duplicate its Peer");

    f.adapter.becomeIdle(leadEndpoint1);
    const handoff = restartedSlp.replaceProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(handoff.generation, lead1.generation + 1);
    assert.equal(handoff.peerAssignmentsPreserved, true);
    const lead2 = restartedSlp.readLead(f.roots.foremanHome, "pilot");
    const preservedImplementation = restartedSlp.readTask(f.roots.foremanHome, implementation.taskId);
    assert.equal(preservedImplementation.endpoint, implementation.endpoint);
    assert.deepEqual(preservedImplementation.resourceLease, implementation.resourceLease);
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).leadGeneration, lead2.generation);
    assert.equal(lead2.contextSignal.usedTokens, 2400);
    assert.equal(lead2.contextSignal.maxTokens, 100000);
    assert.ok(lead2.contextSignal.observedAt);

    f.adapter.becomeIdle(lead2.endpoint);
    const stale = envelope({ taskId, leadGeneration: lead1.generation, requestId: "R-stale-old-lead", action: "create-peer", payload: JSON.parse(firstRequest).payload });
    f.adapter.finish(lead2.endpoint, stale);
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.listPeerTasks(f.roots, taskId).length, 1, "old-generation request cannot create another Peer");
    const staleRequestFile = path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead1.generation}`, "R-stale-old-lead.json");
    assert.equal(JSON.parse(fs.readFileSync(staleRequestFile, "utf8")).status, "refused");

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, leadReconstruction(taskId, lead2.generation, "R-lead2-reconstruction"));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readLead(f.roots.foremanHome, "pilot").reconstruction.leadGeneration, lead2.generation);

    const implementationNow = restartedSlp.readTask(f.roots.foremanHome, implementation.taskId);
    f.adapter.finish(implementation.endpoint, peerReport({ taskId: implementation.taskId, generation: implementation.generation, summary: "Implementation is complete; independent review requested." }));
    f.adapter.becomeIdle(lead2.endpoint);
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const stoppedImplementation = restartedSlp.readTask(f.roots.foremanHome, implementation.taskId);
    assert.equal(stoppedImplementation.peerRuntimeStopped, true);
    assert.equal(stoppedImplementation.resourceLease, null);
    assert.equal(stoppedImplementation.peerReportDeliveredAt != null, true);
    assert.equal(f.adapter.maxActivePeers, 1, "implementation released its resource lease before the next Peer");

    const firstReviewPayload = {
      role: "review",
      brief: "Review the implementation independently and report whether it meets the original brief.",
      scope: "docs/pilot.md",
      resources: [{ key: "file/docs/pilot.md", mode: "read" }],
      dependsOn: [implementation.taskId],
      resolves: [],
    };
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-review-fail", action: "create-peer", payload: firstReviewPayload }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    let reviewPeers = restartedSlp.listPeerTasks(f.roots, taskId).filter((peer) => peer.peerRole === "review");
    assert.equal(reviewPeers.length, 1);
    const failedReview = reviewPeers[0];
    assert.ok(failedReview.resources.every((claim) => claim.mode === "read"));
    f.adapter.finish(failedReview.endpoint, peerReport({ taskId: failedReview.taskId, generation: failedReview.generation, summary: "Review found an implementation defect.", checkResult: "failed", openItems: ["Required heading is missing."] }));
    f.adapter.becomeIdle(lead2.endpoint);
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, failedReview.taskId).peerRuntimeStopped, true);

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-review-reject", action: "record-review", payload: acceptedReviewPayload(implementation.taskId, failedReview.taskId) }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).latestReviewId || null, null, "a failed review report cannot create an accepted review milestone");
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, implementation.taskId).status, "review-ready");

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-ready-before-review", action: "report-task", payload: { status: "ready", summary: "Should be refused without an accepted review." } }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).status, "working");

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-review-changes", action: "create-peer", payload: firstReviewPayload }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    reviewPeers = restartedSlp.listPeerTasks(f.roots, taskId).filter((peer) => peer.peerRole === "review");
    const changesReview = reviewPeers.find((peer) => peer.slpRequestId === "R-review-changes");
    assert.ok(changesReview);
    f.adapter.finish(changesReview.endpoint, peerReport({ taskId: changesReview.taskId, generation: changesReview.generation, summary: "The feature works, but a required heading needs correction.", openItems: ["Add the required heading."] }));
    f.adapter.becomeIdle(lead2.endpoint);
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-review-changes-record", action: "record-review", payload: {
      ...acceptedReviewPayload(implementation.taskId, changesReview.taskId, "changes-requested"),
      unresolvedRisks: ["The required heading is missing."],
      summary: "Request one bounded correction before final review.",
    } }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });

    const blockedImplementation = restartedSlp.readTask(f.roots.foremanHome, implementation.taskId);
    assert.equal(blockedImplementation.status, "blocked");
    assert.ok(blockedImplementation.slpReviewBlockerId);
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).reviewStatus, "changes-requested");

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-correction", action: "create-peer", payload: {
      role: "correction",
      brief: "Add the heading identified by the independent review and rerun the focused check.",
      scope: "docs/pilot.md",
      resources: [{ key: "file/docs/pilot.md", mode: "write" }],
      dependsOn: [],
      resolves: [implementation.taskId],
    } }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const correction = restartedSlp.listPeerTasks(f.roots, taskId).find((peer) => peer.peerRole === "correction");
    assert.ok(correction);
    f.adapter.finish(correction.endpoint, peerReport({ taskId: correction.taskId, generation: correction.generation, summary: "Added the missing heading and reran the focused check." }));
    f.adapter.becomeIdle(lead2.endpoint);
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, implementation.taskId).slpResolvedBy, correction.taskId);

    f.adapter.becomeIdle(lead2.endpoint);
    const finalReviewPayload = { ...firstReviewPayload, dependsOn: [correction.taskId] };
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-final-review", action: "create-peer", payload: finalReviewPayload }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    reviewPeers = restartedSlp.listPeerTasks(f.roots, taskId).filter((peer) => peer.peerRole === "review");
    const passingReview = reviewPeers.find((peer) => peer.slpRequestId === "R-final-review");
    assert.ok(passingReview);
    f.adapter.finish(passingReview.endpoint, peerReport({ taskId: passingReview.taskId, generation: passingReview.generation, summary: "Independent review passed after the correction." }));
    f.adapter.becomeIdle(lead2.endpoint);
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });

    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-record-review", action: "record-review", payload: acceptedReviewPayload([implementation.taskId, correction.taskId], passingReview.taskId) }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).reviewStatus, "accepted");
    f.adapter.becomeIdle(lead2.endpoint);
    f.adapter.finish(lead2.endpoint, envelope({ taskId, leadGeneration: lead2.generation, requestId: "R-report-ready", action: "report-task", payload: { status: "ready", summary: "Implementation and independent review are complete." } }));
    restartedSlp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).status, "review-ready");

    f.adapter.becomeIdle(lead2.endpoint);
    const secondTaskId = createSlpTask(f, "A second small task proves the project Lead remains reusable.");
    const waitingTaskId = createSlpTask(f, "A third task waits while the serial project capacity is occupied.");
    const leadBeforePause = restartedSlp.readLead(f.roots.foremanHome, "pilot");
    restartedSlp.pauseProjectLead({ roots: f.roots, projectId: "pilot", paused: true });
    assert.throws(() => restartedSlp.dispatchSlpTask({ roots: f.roots, taskId: waitingTaskId, adapter: f.adapter, startCoordinator: false }), /intake is paused/);
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, taskId).status, "review-ready");
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, waitingTaskId).status, "queued");
    assert.equal(restartedSlp.readLead(f.roots.foremanHome, "pilot").endpoint, leadBeforePause.endpoint);
    restartedSlp.pauseProjectLead({ roots: f.roots, projectId: "pilot", paused: false });
    const secondDispatch = restartedSlp.dispatchSlpTask({ roots: f.roots, taskId: secondTaskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(secondDispatch.leadEndpoint, lead2.endpoint);
    assert.equal(restartedSlp.readLead(f.roots.foremanHome, "pilot").endpoint, lead2.endpoint);
    const waitingDispatch = restartedSlp.dispatchSlpTask({ roots: f.roots, taskId: waitingTaskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(waitingDispatch.status, "waiting");
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, waitingTaskId).status, "queued");
    const projectView = JSON.parse(fs.readFileSync(path.join(f.projectRoot, ".foreman", "project-state.json"), "utf8"));
    assert.equal(projectView.projectId, "pilot");
    const gitExclude = execFileSync("git", ["-C", f.projectRoot, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
    assert.match(fs.readFileSync(path.resolve(f.projectRoot, gitExclude), "utf8"), /\/\.foreman\//);
    assert.equal(fs.readFileSync(path.join(f.projectRoot, "AGENTS.md"), "utf8"), "# Project instructions\nUse the repository checks.\n");

    const firstPeerId = restartedSlp.listPeerTasks(f.roots, taskId)[0].taskId;
    assert.throws(() => restartedSlp.acceptSlpTask({ roots: f.roots, taskId, adapter: f.adapter, afterPeerCleanup: () => { throw new Error("simulated interrupted cleanup"); } }), /simulated interrupted cleanup/);
    assert.equal(restartedSlp.readLead(f.roots.foremanHome, "pilot").endpoint, lead2.endpoint);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", secondTaskId, "meta.json")), true);
    const accepted = restartedSlp.acceptSlpTask({ roots: f.roots, taskId, adapter: f.adapter });
    assert.equal(accepted.closed, true);
    assert.equal(accepted.projectLeadPreserved, true);
    assert.equal(restartedSlp.readLead(f.roots.foremanHome, "pilot").endpoint, lead2.endpoint);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", firstPeerId, "meta.json")), false);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", secondTaskId, "meta.json")), true);
    const afterAcceptance = JSON.parse(fs.readFileSync(path.join(f.projectRoot, ".foreman", "project-state.json"), "utf8"));
    assert.deepEqual(afterAcceptance.activeTasks.map((task) => task.taskId).sort(), [secondTaskId, waitingTaskId].sort());
    assert.equal(restartedSlp.readTask(f.roots.foremanHome, waitingTaskId).status, "queued");
    assert.equal(f.adapter.maxActivePeers, 1);
  } finally {
    delete require.cache[require.resolve("../src/slp")];
    f.cleanup();
  }
});

test("SLP blockers preserve verbatim human decisions and resume only after delivery", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Handle a simulated human decision before changing the blocked behavior.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-decision-peer"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const peer = slp.listPeerTasks(f.roots, taskId)[0];
    f.adapter.becomeIdle(peer.endpoint);
    f.adapter.becomeIdle(lead.endpoint);
    const blocker = {
      status: "blocked",
      summary: "The project policy is ambiguous and requires a human choice.",
      decision: {
        finding: "Two valid behaviors conflict.",
        why: "Only the project owner can choose the product behavior.",
        options: ["Preserve behavior A.", "Adopt behavior B."],
        recommendation: "Preserve behavior A until the owner decides.",
        evidence: "docs/WORKFLOW.md#policy",
        impact: "The task cannot progress until this decision is recorded.",
        affectedAssignmentIds: [peer.taskId],
      },
    };
    f.adapter.finish(lead.endpoint, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-blocked", action: "report-task", payload: blocker }));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const blocked = slp.readTask(f.roots.foremanHome, taskId);
    assert.equal(blocked.status, "waiting-decision");
    const decisionFile = path.join(f.roots.foremanHome, "data", "tasks", taskId, "decisions", `${blocked.decisionId}.json`);
    const answer = "Choose behavior B exactly as described; retain the original requirement in the evidence note.";
    const answered = slp.answerSlpDecision({ roots: f.roots, taskId, decisionId: blocked.decisionId, response: answer });
    assert.equal(answered.humanResponse, answer);
    f.adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const delivered = JSON.parse(fs.readFileSync(decisionFile, "utf8"));
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.humanResponse, answer);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).status, "working");
    assert.equal(delivered.peerDeliveries[0].assignmentId, peer.taskId);
    assert.equal(delivered.peerDeliveries[0].delivered, true);
    const decisionMessage = f.adapter.sent.find((message) => message.messageId === delivered.peerDeliveries[0].messageId);
    assert.match(decisionMessage.prompt, new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    f.cleanup();
  }
});

test("completed Peer reports are stopped and durably retained when its Lead is unavailable", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Preserve Peer results while the project Lead runtime is unavailable.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-peer-report-outage"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const peer = slp.listPeerTasks(f.roots, taskId)[0];

    f.adapter.stop(lead.endpoint);
    f.adapter.finish(peer.endpoint, peerReport({ taskId: peer.taskId, generation: peer.generation, summary: "Peer completed while the Lead endpoint was stopped." }));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });

    const stored = slp.readTask(f.roots.foremanHome, peer.taskId);
    assert.equal(stored.peerRuntimeStopped, true);
    assert.equal(stored.resourceLease, null);
    assert.ok(stored.lastReport.file);
    assert.equal(stored.peerReportDeliveredAt || null, null);
    const reportMessage = core.listMessages({ roots: f.roots }).find((message) => message.kind === "slp-peer-report" && message.taskId === taskId);
    assert.equal(reportMessage.status, "pending");
    assert.match(reportMessage.payload.summary, /Peer completed while the Lead endpoint was stopped/);
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.report-delivery-pending"));

    // Recovery binds a new generation, then replays the durable notification only
    // once.  The stopped Lead never receives a second Peer or a reconstructed
    // report as a new runtime side effect.
    const replacement = slp.recoverProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(replacement.generation, lead.generation + 1);
    f.adapter.becomeIdle(replacement.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const deliveredPeer = slp.readTask(f.roots.foremanHome, peer.taskId);
    assert.ok(deliveredPeer.peerReportDeliveredAt);
    const deliveredMessage = core.listMessages({ roots: f.roots }).find((message) => message.messageId === reportMessage.messageId);
    assert.equal(deliveredMessage.status, "delivered");
    const deliveryCount = f.adapter.sent.filter((message) => message.messageId === reportMessage.messageId).length;
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(f.adapter.sent.filter((message) => message.messageId === reportMessage.messageId).length, deliveryCount);
  } finally {
    f.cleanup();
  }
});

test("S2 observes uncertainty without recovery, and explicit Peer and Lead recovery stay bounded", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Exercise bounded S2 observation and recovery without changing project files.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-s2-observation-peer"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const originalPeer = slp.listPeerTasks(f.roots, taskId)[0];
    const peerFile = path.join(f.roots.foremanHome, "data", "tasks", originalPeer.taskId, "meta.json");
    const agent = f.adapter.agents.get(originalPeer.endpoint);
    const staleAt = new Date(Date.now() - (16 * 60 * 1000)).toISOString();

    // Permission wait, unknown runtime state, idle/no-report, and stuck active
    // turn are distinct observations.  None is allowed to drop the lease or
    // infer that this Peer is dead.
    agent.status = "waiting";
    agent.pendingPermissions = ["permission-1"];
    f.adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.permission-wait"));

    agent.pendingPermissions = [];
    agent.status = "mystery";
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.runtime-unknown"));
    assert.equal(slp.readTask(f.roots.foremanHome, originalPeer.taskId).resourceLease.leaseId, originalPeer.resourceLease.leaseId);
    assert.throws(() => slp.recoverSlpPeer({ roots: f.roots, taskId: originalPeer.taskId, adapter: f.adapter, startCoordinator: false }), /first check was mystery/);

    core.atomicJson(peerFile, { ...slp.readTask(f.roots.foremanHome, originalPeer.taskId), lastPromptAt: staleAt, lastProgressAt: staleAt });
    agent.status = "idle";
    agent.activeTurn = null;
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.no-report"));

    const signal = { usedTokens: 2400, maxTokens: 100000, observedAt: staleAt };
    core.atomicJson(peerFile, { ...slp.readTask(f.roots.foremanHome, originalPeer.taskId), runtimeContextSignal: signal, lastProgressAt: staleAt });
    agent.lastUsage = { contextWindowUsedTokens: signal.usedTokens, contextWindowMaxTokens: signal.maxTokens };
    agent.status = "running";
    agent.activeTurn = { turnId: "stuck-turn", startedAt: staleAt };
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.stuck-turn"));
    assert.equal(slp.readTask(f.roots.foremanHome, originalPeer.taskId).resourceLease.leaseId, originalPeer.resourceLease.leaseId);

    // Only two matching stopped observations permit a new generation.  Repeated
    // recovery preserves the same workspace, scope, profile, claims, reports,
    // and bounded prior-generation history; the fourth attempt is refused.
    agent.status = "stopped";
    agent.activeTurn = null;
    let recovered = slp.recoverSlpPeer({ roots: f.roots, taskId: originalPeer.taskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(recovered.generation, originalPeer.generation + 1);
    assert.equal(recovered.workspace, originalPeer.workspace);
    assert.deepEqual(recovered.resources, originalPeer.resources);
    assert.deepEqual(recovered.dispatchProfile, originalPeer.dispatchProfile);
    assert.equal(slp.readTask(f.roots.foremanHome, originalPeer.taskId).previousGenerations.length, 1);
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      f.adapter.stop(recovered.endpoint);
      recovered = slp.recoverSlpPeer({ roots: f.roots, taskId: originalPeer.taskId, adapter: f.adapter, startCoordinator: false });
      assert.equal(recovered.recoveryAttempts, attempt);
    }
    f.adapter.stop(recovered.endpoint);
    const beforeExhaustion = slp.readTask(f.roots.foremanHome, originalPeer.taskId);
    assert.throws(() => slp.recoverSlpPeer({ roots: f.roots, taskId: originalPeer.taskId, adapter: f.adapter, startCoordinator: false }), /attempt limit is exhausted/);
    const exhausted = slp.readTask(f.roots.foremanHome, originalPeer.taskId);
    assert.equal(exhausted.endpoint, beforeExhaustion.endpoint);
    assert.deepEqual(exhausted.resourceLease, beforeExhaustion.resourceLease);
    assert.equal(exhausted.recoveryAttempts, 3);

    // Lead recovery uses the same two-observation fence and does not replace the
    // already recovered Peer or discard its generation history.
    f.adapter.stop(lead.endpoint);
    const leadRecovery = slp.recoverProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(leadRecovery.generation, lead.generation + 1);
    const peerAfterLeadRecovery = slp.readTask(f.roots.foremanHome, originalPeer.taskId);
    assert.equal(peerAfterLeadRecovery.endpoint, exhausted.endpoint);
    assert.equal(peerAfterLeadRecovery.generation, exhausted.generation);
    assert.equal(peerAfterLeadRecovery.previousGenerations.length, 3);
  } finally {
    f.cleanup();
  }
});

test("explicit Lead recovery can reconstruct from a confirmed queued task", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Keep this confirmed internal task queued until its recovered Lead is bound.", "validation");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    const taskFile = path.join(f.roots.foremanHome, "data", "tasks", taskId, "meta.json");
    core.atomicJson(taskFile, { ...slp.readTask(f.roots.foremanHome, taskId), status: "queued", leadGeneration: null, leadEndpoint: null });
    f.adapter.stop(lead.endpoint);

    const replacement = slp.recoverProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(replacement.generation, lead.generation + 1);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).status, "queued");
    assert.ok(replacement.handoffMessage?.delivered);

    f.adapter.becomeIdle(replacement.endpoint);
    const dispatched = slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(dispatched.leadEndpoint, replacement.endpoint);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).leadGeneration, replacement.generation);
  } finally {
    f.cleanup();
  }
});

test("safe-boundary Lead handoff carries a confirmed queued task into the replacement generation", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Keep this confirmed validation task queued through a deliberate Lead handoff.", "validation");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    const taskFile = path.join(f.roots.foremanHome, "data", "tasks", taskId, "meta.json");
    core.atomicJson(taskFile, { ...slp.readTask(f.roots.foremanHome, taskId), status: "queued", leadGeneration: null, leadEndpoint: null });
    f.adapter.becomeIdle(lead.endpoint);

    const replacement = slp.replaceProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(replacement.generation, lead.generation + 1);
    assert.ok(replacement.handoffMessage?.delivered);
    const handoffMessage = coordination.listMessages({ roots: f.roots }).find((message) => message.kind === "slp-lead-handoff");
    assert.deepEqual(handoffMessage.payload.activeTaskIds, []);
    assert.deepEqual(handoffMessage.payload.reconstructionTaskIds, [taskId]);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).leadGeneration, replacement.generation);

    f.adapter.becomeIdle(replacement.endpoint);
    const dispatched = slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    assert.equal(dispatched.leadEndpoint, replacement.endpoint);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).leadGeneration, replacement.generation);
  } finally {
    f.cleanup();
  }
});

test("replacement Lead must record bounded reconstruction before coordinating Peers", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Verify that a replacement Lead reconstructs project state before delegating.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const firstLead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.becomeIdle(firstLead.endpoint);
    const replacement = slp.replaceProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    assert.equal(replacement.generation, firstLead.generation + 1);
    assert.equal(lead.reconstructionRequiredGeneration, lead.generation);
    assert.ok(replacement.handoffMessage?.delivered);

    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-peer-before-reconstruction"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 0);
    const requestFile = path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, "R-peer-before-reconstruction.json");
    const refused = JSON.parse(fs.readFileSync(requestFile, "utf8"));
    assert.equal(refused.status, "refused");
    assert.match(refused.outcome.reason, /reconstruct/);

    f.adapter.becomeIdle(lead.endpoint);
    f.adapter.finish(lead.endpoint, envelope({
      taskId,
      leadGeneration: lead.generation,
      requestId: "R-incomplete-reconstruction",
      action: "report-task",
      payload: { status: "progress", summary: "Incomplete reconstruction.", reconstruction: { projectState: "Read.", coreState: "Reviewed tasks." } },
    }));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(slp.readLead(f.roots.foremanHome, "pilot").reconstruction, null);
    const incompleteFile = path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, "R-incomplete-reconstruction.json");
    assert.equal(JSON.parse(fs.readFileSync(incompleteFile, "utf8")).status, "refused");

    f.adapter.becomeIdle(lead.endpoint);
    f.adapter.finish(lead.endpoint, leadReconstruction(taskId, lead.generation));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const reconstructed = slp.readLead(f.roots.foremanHome, "pilot");
    assert.equal(reconstructed.reconstruction.leadGeneration, lead.generation);
    assert.equal(reconstructed.reconstruction.knowledge, "Reviewed applicable project instructions and durable knowledge references.");
    const view = JSON.parse(fs.readFileSync(path.join(f.projectRoot, ".foreman", "project-state.json"), "utf8"));
    assert.equal(view.lead.reconstructionRequired, false);
    assert.equal(view.lead.reconstruction.leadGeneration, lead.generation);

    f.adapter.becomeIdle(lead.endpoint);
    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-peer-after-reconstruction"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 1);
  } finally {
    f.cleanup();
  }
});

test("an interrupted Lead recovery resumes before and after its replacement is bound", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Preserve this active Peer across an interrupted Lead recovery.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-interrupted-recovery-peer"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const peer = slp.listPeerTasks(f.roots, taskId)[0];
    const originalSpawn = f.adapter.spawn.bind(f.adapter);
    f.adapter.stop(lead.endpoint);
    f.adapter.spawn = () => { throw new Error("simulated replacement launch interruption"); };
    assert.throws(() => slp.recoverProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false }), /simulated replacement launch interruption/);
    const beforeBind = slp.readLead(f.roots.foremanHome, "pilot");
    assert.equal(beforeBind.handoffPending, true);
    assert.equal(beforeBind.endpoint, null);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).endpoint, peer.endpoint);

    f.adapter.spawn = originalSpawn;
    const resumedBeforeBind = slp.recoverProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(resumedBeforeBind.recoveryResumed, true);
    const bound = slp.readLead(f.roots.foremanHome, "pilot");
    assert.equal(bound.handoffPending, false);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).endpoint, peer.endpoint);

    // This is the durable state a process can leave after it binds the new
    // endpoint but before it clears handoffPending.  Resume must reconcile it
    // without replacing that endpoint or its living Peer.
    const leadFile = path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "meta.json");
    core.atomicJson(leadFile, { ...bound, handoffPending: true, handoffTaskIds: [taskId] });
    const resumedAfterBind = slp.recoverProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(resumedAfterBind.recoveryResumed, true);
    const repaired = slp.readLead(f.roots.foremanHome, "pilot");
    assert.equal(repaired.endpoint, bound.endpoint);
    assert.equal(repaired.handoffPending, false);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).endpoint, peer.endpoint);
  } finally {
    f.cleanup();
  }
});

test("validation SLP tasks preserve blocked evidence in proof completion without entering delivery acceptance", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Prove bounded runtime behavior without changing project files.", "validation");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    const exploration = envelope({
      taskId,
      leadGeneration: lead.generation,
      requestId: "R-validation-peer",
      action: "create-peer",
      payload: {
        role: "exploration",
        brief: "Inspect the bounded runtime behavior and report evidence without editing files.",
        scope: "runtime behavior only",
        resources: [{ key: "workspace/pilot", mode: "read" }],
        dependsOn: [],
        resolves: [],
      },
    });
    f.adapter.finish(lead.endpoint, exploration);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const peer = slp.listPeerTasks(f.roots, taskId)[0];
    f.adapter.finish(peer.endpoint, peerReport({
      taskId: peer.taskId,
      generation: peer.generation,
      summary: "The assigned workspace was unavailable, so the requested checks were not run.",
      status: "blocked",
      checkResult: "not-run",
      openItems: ["Assigned workspace path was unavailable; S2 evidence remains unverified."],
    }));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    f.adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).peerRuntimeStopped, true);
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).status, "blocked");
    assert.equal(slp.readTask(f.roots.foremanHome, peer.taskId).slpResolvedBy, undefined);
    assert.ok(slp.readTask(f.roots.foremanHome, peer.taskId).peerReportDeliveredAt);

    const proofRequest = envelope({
      taskId,
      leadGeneration: lead.generation,
      requestId: "R-proof-complete",
      action: "report-task",
      payload: { status: "proof-complete", summary: "Bounded validation completed with preserved runtime evidence.", evidence: [peer.taskId] },
    });
    f.adapter.finish(lead.endpoint, proofRequest);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const completed = slp.readTask(f.roots.foremanHome, taskId);
    assert.equal(completed.status, "proof-complete");
    assert.equal(completed.purpose, "validation");
    assert.ok(fs.existsSync(completed.proofReport));
    assert.deepEqual(JSON.parse(fs.readFileSync(completed.proofReport, "utf8")).evidence.map((item) => item.taskId), [peer.taskId]);
    assert.throws(() => slp.acceptSlpTask({ roots: f.roots, taskId, adapter: f.adapter }), /Only a review-ready SLP task can be accepted/);
    assert.equal(slp.coordinatorHasWork(f.roots), true, "the retained project Lead still needs supervision");
  } finally {
    f.cleanup();
  }
});

test("the coordinator is started only while SLP work needs it", () => {
  const f = fixture();
  try {
    const starts = [];
    const start = (args) => { starts.push(args.backend); return { started: true }; };
    assert.deepEqual(slp.ensureCoordinatorRunning({ roots: f.roots, start }), { started: false, reason: "no-work" });
    assert.deepEqual(starts, []);

    const taskId = createSlpTask(f);
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    assert.deepEqual(slp.ensureCoordinatorRunning({ roots: f.roots, start }), { started: true });
    assert.deepEqual(starts, ["paseo"]);
  } finally {
    f.cleanup();
  }
});

test("an eligible queued SLP task can be explicitly designated for validation", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Mark this bounded runtime proof as validation before it starts.");
    const marked = slp.markValidationTask({ roots: f.roots, taskId, purpose: "validation" });
    assert.equal(marked.purpose, "validation");
    assert.equal(marked.peerCount, 0);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).purpose, "validation");
  } finally {
    f.cleanup();
  }
});

test("proof completion is refused for delivery tasks and validation cannot report ready", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f);
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    f.adapter.finish(lead.endpoint, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-delivery-proof-refused", action: "report-task", payload: { status: "proof-complete", summary: "Should not bypass product readiness.", evidence: ["T-000099"] } }));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const deliveryRequest = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, "R-delivery-proof-refused.json"), "utf8"));
    assert.equal(deliveryRequest.status, "refused");
    assert.match(deliveryRequest.outcome.reason, /only for tasks explicitly marked validation/);
  } finally {
    f.cleanup();
  }

  const g = fixture();
  try {
    const taskId = createSlpTask(g, "Validation cannot use the delivery readiness path.", "validation");
    slp.dispatchSlpTask({ roots: g.roots, taskId, adapter: g.adapter, startCoordinator: false });
    const lead = slp.readLead(g.roots.foremanHome, "pilot");
    g.adapter.finish(lead.endpoint, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-validation-ready-refused", action: "report-task", payload: { status: "ready", summary: "This must not ask for product acceptance." } }));
    slp.coordinatorTick({ roots: g.roots, adapter: g.adapter });
    const request = JSON.parse(fs.readFileSync(path.join(g.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, "R-validation-ready-refused.json"), "utf8"));
    assert.equal(request.status, "refused");
    assert.match(request.outcome.reason, /validation tasks record proof-complete/);
  } finally {
    g.cleanup();
  }
});

test("recovered invalid responses and delayed Peer delivery close their anomalies from durable evidence", () => {
  const f = fixture();
  try {
    const taskId = createSlpTask(f, "Verify that transient protocol failures are cleared after valid recovery evidence.");
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");

    f.adapter.finish(lead.endpoint, "This response does not match the request protocol.");
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "lead.request-invalid"));

    f.adapter.finish(lead.endpoint, implementationRequest(taskId, lead.generation, "R-valid-after-invalid"));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const peer = slp.listPeerTasks(f.roots, taskId)[0];
    assert.ok(peer);

    f.adapter.finish(peer.endpoint, "This response is not a Peer report.");
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.report-invalid"));
    f.adapter.becomeIdle(peer.endpoint);
    const leadAgent = f.adapter.agents.get(lead.endpoint);
    if (!leadAgent.activeTurn) f.adapter.send(lead.endpoint, "A bounded Lead turn is still processing.", { messageId: "M-test-lead-busy" });

    f.adapter.finish(peer.endpoint, peerReport({ taskId: peer.taskId, generation: peer.generation, summary: "The valid follow-up report recovers the transient parse error." }));
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const waitingPeer = slp.readTask(f.roots.foremanHome, peer.taskId);
    assert.equal(waitingPeer.peerRuntimeStopped, true);
    assert.equal(waitingPeer.peerReportDeliveredAt || null, null);
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.report-delivery-pending"));

    f.adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    const open = slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies;
    assert.equal(open.some((item) => ["lead.request-invalid", "peer.report-invalid", "peer.report-delivery-pending"].includes(item.type)), false);
    assert.ok(slp.readTask(f.roots.foremanHome, peer.taskId).peerReportDeliveredAt);
  } finally {
    f.cleanup();
  }
});

test("task model migration resumes from its byte-preserving backup and legacy tasks remain dispatchable", () => {
  const f = fixture();
  try {
    const task = core.createTask({ roots: f.roots, projectId: "pilot", brief: "Keep the legacy Supervisor–Worker flow operable.", routingRunner: () => ({ profile: "claude-sonnet", reason: "Legacy flow fixture." }) });
    const metaFile = path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json");
    const original = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    delete original.taskModel;
    const legacyBytes = `${JSON.stringify(original, null, 2)}\n`;
    fs.writeFileSync(metaFile, legacyBytes);
    fs.writeFileSync(`${metaFile}.pre-slp-task-model-v1`, legacyBytes);

    const migrated = core.migrateSlpTaskModels({ roots: f.roots });
    assert.deepEqual(migrated.migratedTaskIds, [task.id]);
    assert.equal(fs.readFileSync(`${metaFile}.pre-slp-task-model-v1`, "utf8"), legacyBytes);
    assert.equal(JSON.parse(fs.readFileSync(metaFile, "utf8")).taskModel, "supervisor-worker");
    core.migrateSlpTaskModels({ roots: f.roots });
    assert.equal(fs.readFileSync(`${metaFile}.pre-slp-task-model-v1`, "utf8"), legacyBytes);

    core.confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-sonnet" });
    const legacyAssignment = core.assignTask({ roots: f.roots, taskId: task.id, adapter: new FakeHerdrAdapter() });
    assert.equal(legacyAssignment.status, "working");
    assert.equal(core.taskModel(legacyAssignment), "supervisor-worker");
    assert.equal(core.acceptTask !== undefined, true);
  } finally {
    f.cleanup();
  }
});

test("missing Lead skill and unsupported SLP backend fail before Lead dispatch", () => {
  const f = fixture({ skill: false });
  try {
    const taskId = core.createTask({ roots: f.roots, projectId: "pilot", backend: "paseo", taskModel: "slp", brief: "Refuse dispatch without the required local Lead skill.", routingRunner: () => ({ profile: "claude-sonnet", reason: "Paseo pilot." }) }).id;
    core.confirmTaskProfile({ roots: f.roots, taskId, profile: "claude-sonnet" });
    assert.throws(() => slp.confirmProjectLeadProfile({ roots: f.roots, projectId: "pilot", profileName: "claude-sonnet", adapter: f.adapter }), /skill is missing/);
    assert.equal(f.adapter.agents.size, 0);

    const herdrTask = core.createTask({ roots: f.roots, projectId: "pilot", backend: "herdr", taskModel: "slp", brief: "SLP on a backend without SLP support must not fall back to legacy dispatch.", routingRunner: () => ({ profile: "claude-sonnet", reason: "Unsupported SLP backend fixture." }) }).id;
    core.confirmTaskProfile({ roots: f.roots, taskId: herdrTask, profile: "claude-sonnet" });
    assert.throws(() => slp.dispatchSlpTask({ roots: f.roots, taskId: herdrTask, adapter: { backend: "other", verifyCompatibility: () => true } }), /not supported on other/);
    assert.equal(f.adapter.agents.size, 0);
  } finally {
    f.cleanup();
  }
});

test("without capacity config the pilot stays serial for tasks and Peers", () => {
  const f = fixture();
  try {
    const first = createSlpTask(f, "First task.");
    const second = createSlpTask(f, "Second task.");
    assert.equal(slp.dispatchSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter, startCoordinator: false }).status, "working");
    const waiting = slp.dispatchSlpTask({ roots: f.roots, taskId: second, adapter: f.adapter, startCoordinator: false });
    assert.equal(waiting.status, "waiting");
    assert.match(waiting.waitingReason, /project task capacity \(1\) is held by /);
    assert.equal(slp.readTask(f.roots.foremanHome, second).waitingKind, "capacity");

    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    leadSays(f, peerRequest(first, lead.generation, "R-serial-a", { resources: [{ key: "file/docs/a", mode: "write" }] }));
    leadSays(f, peerRequest(first, lead.generation, "R-serial-b", { resources: [{ key: "file/docs/b", mode: "write" }] }));
    const requests = fs.readdirSync(path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`));
    const second_ = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, "R-serial-b.json"), "utf8"));
    assert.equal(requests.length >= 2, true);
    assert.equal(second_.status, "waiting");
    assert.match(second_.outcome.reason, /project Peer capacity \(1\)/);
    assert.equal(slp.listPeerTasks(f.roots, first).length, 1);
  } finally {
    f.cleanup();
  }
});

test("capacity config lets two tasks and two disjoint Peers run while the fleet endpoint cap holds", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 3, maxSlpEndpoints: 3 } });
  try {
    const first = createSlpTask(f, "First task.");
    const second = createSlpTask(f, "Second task.");
    const third = createSlpTask(f, "Third task.");
    assert.equal(slp.dispatchSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter, startCoordinator: false }).status, "working");
    f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
    assert.equal(slp.dispatchSlpTask({ roots: f.roots, taskId: second, adapter: f.adapter, startCoordinator: false }).status, "working");
    f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
    const waiting = slp.dispatchSlpTask({ roots: f.roots, taskId: third, adapter: f.adapter, startCoordinator: false });
    assert.equal(waiting.status, "waiting");
    assert.match(waiting.waitingReason, /project task capacity \(2\)/);

    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    leadSays(f, peerRequest(first, lead.generation, "R-a", { resources: [{ key: "file/docs/a", mode: "write" }] }));
    leadSays(f, peerRequest(second, lead.generation, "R-b", { resources: [{ key: "file/docs/b", mode: "write" }] }));
    const a = slp.listPeerTasks(f.roots, first)[0];
    const b = slp.listPeerTasks(f.roots, second)[0];
    assert.ok(a.endpoint && b.endpoint && a.resourceLease && b.resourceLease, "disjoint Peers run alongside each other");

    // Lead + two Peers fill the fleet cap of 3 even though the project allows three Peers.
    leadSays(f, peerRequest(first, lead.generation, "R-c", { role: "exploration", resources: [{ key: "file/docs/c", mode: "read" }] }));
    const saved = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, "R-c.json"), "utf8"));
    assert.equal(saved.status, "waiting");
    assert.match(saved.outcome.reason, /SLP endpoint capacity \(3\) is exhausted by 3 live endpoints/);
  } finally {
    f.cleanup();
  }
});

test("an invalid capacity config refuses SLP dispatch instead of widening capacity", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 0, maxLivePeersPerProject: 2 } });
  try {
    const taskId = createSlpTask(f);
    assert.throws(() => slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false }), /maxActiveTasksPerProject must be a positive integer/);
  } finally {
    f.cleanup();
  }
});

function requestRecord(f, requestId) {
  const lead = slp.readLead(f.roots.foremanHome, "pilot");
  return JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead.generation}`, `${requestId}.json`), "utf8"));
}

// Finish a live Peer with a valid done report and let the coordinator stop it and deliver the report once.
function finishPeer(f, peer, summary = "Bounded work is complete.", changedSurfaces) {
  const surfaces = changedSurfaces || (peer.resources || []).filter((claim) => claim.mode !== "read").map((claim) => claim.key);
  f.adapter.finish(peer.endpoint, peerReport({ taskId: peer.taskId, generation: peer.generation, summary, changedSurfaces: surfaces }));
  f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
  slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
  f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
  return slp.readTask(f.roots.foremanHome, peer.taskId);
}

test("a raw done report does not unlock a dependent Peer; a Lead-recorded milestone unlocks it once", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  try {
    const taskId = createSlpTask(f);
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    leadSays(f, peerRequest(taskId, lead.generation, "R-explore", { role: "exploration", resources: [{ key: "file/docs/a", mode: "read" }] }));
    const exploration = finishPeer(f, slp.listPeerTasks(f.roots, taskId)[0]);
    assert.equal(exploration.peerRuntimeStopped, true);
    assert.ok(exploration.peerReportDeliveredAt);

    const dependent = peerRequest(taskId, lead.generation, "R-dependent", { resources: [{ key: "file/docs/b", mode: "write" }], dependsOn: [exploration.taskId] });
    leadSays(f, dependent);
    assert.equal(requestRecord(f, "R-dependent").status, "waiting");
    assert.match(requestRecord(f, "R-dependent").outcome.reason, /Lead-recorded review milestone/);
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 1, "raw done does not create the dependent Peer");

    // Milestones cannot name implementation Peers, unknown Peers, or lack evidence.
    const milestone = { kind: "prerequisite", assignmentId: exploration.taskId, evidence: ["reports/exploration"], summary: "Reviewed the exploration report; claims are sound." };
    leadSays(f, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-ms-bad", action: "record-review", payload: { ...milestone, evidence: [] } }));
    assert.equal(requestRecord(f, "R-ms-bad").status, "refused");
    leadSays(f, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-ms-unknown", action: "record-review", payload: { ...milestone, assignmentId: "T-999999" } }));
    assert.equal(requestRecord(f, "R-ms-unknown").status, "refused");

    leadSays(f, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-ms", action: "record-review", payload: milestone }));
    assert.equal(requestRecord(f, "R-ms").status, "completed");
    assert.ok(slp.readTask(f.roots.foremanHome, exploration.taskId).reviewMilestoneId);
    assert.equal(slp.readTask(f.roots.foremanHome, taskId).reviewStatus ?? null, null, "a prerequisite milestone is not task readiness");

    leadSays(f, dependent);
    assert.equal(requestRecord(f, "R-dependent").status, "dispatched");
    leadSays(f, dependent);
    assert.equal(slp.listPeerTasks(f.roots, taskId).length, 2, "replaying the request does not activate the dependent twice");
    leadSays(f, envelope({ taskId, leadGeneration: lead.generation, requestId: "R-ms-again", action: "record-review", payload: milestone }));
    assert.equal(requestRecord(f, "R-ms-again").status, "refused", "a second milestone for the same Peer is refused");
  } finally {
    f.cleanup();
  }
});

test("core resumes a resource-conflicted Peer after the holder stops and tells the Lead once", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  try {
    const first = createSlpTask(f, "Task that changes the schema.");
    const second = createSlpTask(f, "Task that also changes the schema.");
    slp.dispatchSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter, startCoordinator: false });
    f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
    slp.dispatchSlpTask({ roots: f.roots, taskId: second, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    const schema = [{ key: "db/app/schema", mode: "write" }];
    leadSays(f, peerRequest(first, lead.generation, "R-holder", { resources: schema }));
    leadSays(f, peerRequest(second, lead.generation, "R-waiter", { resources: schema }));

    const waiting = requestRecord(f, "R-waiter");
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.outcome.waitKind, "resource");
    const holder = slp.listPeerTasks(f.roots, first)[0];
    assert.match(waiting.outcome.reason, new RegExp(`held by ${holder.taskId} on db/app/schema`));
    const inbox = slp.sessionContext({ roots: f.roots });
    assert.match(inbox, new RegExp(`SLP task ${second} in pilot is waiting \\(resource\\); it resumes automatically`));
    assert.equal(slp.buildProjectState({ roots: f.roots, projectId: "pilot" }).activeTasks.find((task) => task.taskId === second).waits[0].kind, "resource");
    assert.equal(slp.coordinatorHasWork(f.roots), true);

    // A tick with no state change must not rewrite the wait or notify the Lead.
    const stamp = waiting.updatedAt;
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(requestRecord(f, "R-waiter").updatedAt, stamp);

    // The holder finishes; the same tick stops it, releases its lease, and dispatches the waiter without a Lead resend.
    finishPeer(f, holder);
    const resumed = requestRecord(f, "R-waiter");
    assert.equal(resumed.status, "dispatched");
    const waiter = slp.listPeerTasks(f.roots, second);
    assert.equal(waiter.length, 1);
    assert.ok(waiter[0].endpoint && waiter[0].resourceLease);
    const outcomes = coordination.listMessages({ roots: f.roots }).filter((message) => message.kind === "slp-request-outcome" && message.payload.requestId === "R-waiter" && message.payload.outcome.status === "dispatched");
    assert.equal(outcomes.length, 1);

    f.adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(slp.listPeerTasks(f.roots, second).length, 1, "later ticks create no duplicate Peer");
    assert.equal(coordination.listMessages({ roots: f.roots }).filter((message) => message.kind === "slp-request-outcome" && message.payload.requestId === "R-waiter" && message.payload.outcome.status === "dispatched").length, 1);
    assert.doesNotMatch(slp.sessionContext({ roots: f.roots }) || "", /is waiting \(resource\)/);
  } finally {
    f.cleanup();
  }
});

test("Lead rollover supersedes core-owned waits, keeps live Peers, and lets the new Lead resubmit without duplicates", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  try {
    const first = createSlpTask(f, "Task that changes the schema.");
    const second = createSlpTask(f, "Task that also changes the schema.");
    slp.dispatchSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter, startCoordinator: false });
    f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
    slp.dispatchSlpTask({ roots: f.roots, taskId: second, adapter: f.adapter, startCoordinator: false });
    const lead1 = slp.readLead(f.roots.foremanHome, "pilot");
    const schema = [{ key: "db/app/schema", mode: "write" }];
    leadSays(f, peerRequest(first, lead1.generation, "R-holder", { resources: schema }));
    const waiterRequest = peerRequest(second, lead1.generation, "R-waiter", { resources: schema });
    leadSays(f, waiterRequest);
    assert.equal(requestRecord(f, "R-waiter").status, "waiting");
    const holder = slp.listPeerTasks(f.roots, first)[0];
    const pendingWaiter = slp.listPeerTasks(f.roots, second)[0];
    assert.equal(pendingWaiter.resourceLease, null, "the waiting Peer record holds no lease");

    f.adapter.becomeIdle(lead1.endpoint);
    const replaced = slp.replaceProjectLead({ roots: f.roots, projectId: "pilot", adapter: f.adapter, startCoordinator: false });
    assert.equal(replaced.generation, lead1.generation + 1);
    const lead2 = slp.readLead(f.roots.foremanHome, "pilot");
    const stale = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "slp", "leads", "pilot", "requests", `g${lead1.generation}`, "R-waiter.json"), "utf8"));
    assert.equal(stale.status, "refused");
    assert.match(stale.outcome.reason, /superseded by Lead handoff to generation 2; resubmit with the same requestId and payload/);
    assert.equal(stale.outcome.previousWait.waitKind, "resource", "the original wait is preserved as evidence");
    const heldAfter = slp.readTask(f.roots.foremanHome, holder.taskId);
    assert.equal(heldAfter.endpoint, holder.endpoint);
    assert.equal(heldAfter.resourceLease.leaseId, holder.resourceLease.leaseId, "the live Peer and its lease survive rollover");
    const handoff = coordination.listMessages({ roots: f.roots }).find((message) => message.kind === "slp-lead-handoff" && message.payload.leadGeneration === lead2.generation);
    assert.deepEqual(handoff.payload.supersededRequests.map((item) => [item.requestId, item.assignmentId]), [["R-waiter", pendingWaiter.taskId]]);

    // The old generation is fenced; the new one must reconstruct, then resubmit the same request.
    leadSays(f, peerRequest(first, lead1.generation, "R-old-steer", { role: "exploration", resources: [{ key: "file/docs/z", mode: "read" }] }));
    assert.equal(slp.listPeerTasks(f.roots, first).length, 1, "old-generation steering creates nothing");
    leadSays(f, leadReconstruction(first, lead2.generation));
    leadSays(f, peerRequest(second, lead2.generation, "R-waiter", { resources: schema }));
    assert.equal(requestRecord(f, "R-waiter").status, "waiting");
    assert.equal(slp.listPeerTasks(f.roots, second).length, 1, "resubmission reuses the pending Peer record");

    finishPeer(f, heldAfter);
    assert.equal(requestRecord(f, "R-waiter").status, "dispatched");
    const waiter = slp.listPeerTasks(f.roots, second);
    assert.equal(waiter.length, 1);
    assert.equal(waiter[0].taskId, pendingWaiter.taskId);
    assert.ok(waiter[0].endpoint && waiter[0].resourceLease);
  } finally {
    f.cleanup();
  }
});

test("with several active tasks the Lead holds no claim and protocol corrections go to the task it was last prompted for", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  try {
    const first = createSlpTask(f, "First task.");
    const second = createSlpTask(f, "Second task.");
    slp.dispatchSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter, startCoordinator: false });
    f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
    slp.dispatchSlpTask({ roots: f.roots, taskId: second, adapter: f.adapter, startCoordinator: false });
    f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);

    const briefs = coordination.listMessages({ roots: f.roots }).filter((message) => message.kind === "slp-task-brief");
    assert.equal(briefs.length, 2);
    for (const brief of briefs) {
      assert.equal(brief.payload.resources, undefined, "the Lead brief carries no workspace claim");
      assert.match(coordination.deliveryPrompt(brief), /Resource claims: none held by the Lead/);
    }

    leadSays(f, "I will think about this later.");
    const errors = coordination.listMessages({ roots: f.roots }).filter((message) => message.kind === "slp-request-error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].taskId, second, "the correction targets the task most recently sent to the Lead");
  } finally {
    f.cleanup();
  }
});

test("a Peer report outside its write claims blocks review until a correction Peer resolves it", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  try {
    const taskId = createSlpTask(f);
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    const claims = [{ key: "file/docs/pilot.md", mode: "write" }];
    leadSays(f, peerRequest(taskId, lead.generation, "R-impl", { resources: claims }));
    const implementation = slp.listPeerTasks(f.roots, taskId)[0];
    const stopped = finishPeer(f, implementation, "Changed the docs and a source file.", ["docs/pilot.md", "src/other.js"]);
    assert.equal(stopped.status, "blocked", "an out-of-claim report is a blocker, not review-ready");
    assert.deepEqual(stopped.slpClaimExceeded, ["src/other.js"]);
    assert.equal(stopped.resourceLease, null, "the stopped Peer still releases its lease");
    assert.ok(slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.claim-exceeded" && item.assignmentId === implementation.taskId && /src\/other\.js/.test(item.reason)));
    const delivered = coordination.listMessages({ roots: f.roots }).find((message) => message.kind === "slp-peer-report" && message.payload.assignmentId === implementation.taskId);
    assert.deepEqual(delivered.payload.claimExceeded, ["src/other.js"], "the Lead is told which surfaces exceeded the claim");

    // Independent review cannot start on an exceeded report.
    leadSays(f, peerRequest(taskId, lead.generation, "R-review", { role: "review", resources: [{ key: "file/docs/pilot.md", mode: "read" }], dependsOn: [implementation.taskId] }));
    assert.equal(requestRecord(f, "R-review").status, "waiting");

    // A correction with adequate claims resolves the blocker and clears the anomaly.
    leadSays(f, peerRequest(taskId, lead.generation, "R-fix", { role: "correction", resources: [{ key: "file/docs/pilot.md", mode: "write" }, { key: "file/src/other.js", mode: "write" }], resolves: [implementation.taskId] }));
    const correction = slp.listPeerTasks(f.roots, taskId).find((peer) => peer.peerRole === "correction");
    assert.ok(correction);
    const fixed = finishPeer(f, correction, "Kept all changes within the declared claims.");
    assert.equal(fixed.status, "review-ready");
    assert.equal(slp.readTask(f.roots.foremanHome, implementation.taskId).slpResolvedBy, correction.taskId);
    assert.ok(!slp.projectStatus({ roots: f.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.claim-exceeded"));
  } finally {
    f.cleanup();
  }
});

test("a workspace-exclusive claim covers any surface and review Peers may write only verification resources", () => {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  try {
    const taskId = createSlpTask(f);
    slp.dispatchSlpTask({ roots: f.roots, taskId, adapter: f.adapter, startCoordinator: false });
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    leadSays(f, peerRequest(taskId, lead.generation, "R-wide", { resources: [{ key: "workspace/pilot", mode: "exclusive" }] }));
    const implementation = finishPeer(f, slp.listPeerTasks(f.roots, taskId)[0], "Touched several places.", ["src/a.js", "docs/b.md"]);
    assert.equal(implementation.status, "review-ready");
    assert.equal(implementation.slpClaimExceeded, undefined);

    leadSays(f, peerRequest(taskId, lead.generation, "R-review-code", { role: "review", resources: [{ key: "file/src/a.js", mode: "write" }], dependsOn: [implementation.taskId] }));
    assert.equal(requestRecord(f, "R-review-code").status, "refused");
    assert.match(requestRecord(f, "R-review-code").outcome.reason, /verification resources/);
    leadSays(f, peerRequest(taskId, lead.generation, "R-review-env", { role: "review", resources: [{ key: "file/src/a.js", mode: "read" }, { key: "test/env/main", mode: "write" }], dependsOn: [implementation.taskId] }));
    assert.equal(requestRecord(f, "R-review-env").status, "dispatched");
    const review = slp.listPeerTasks(f.roots, taskId).find((peer) => peer.peerRole === "review");
    assert.deepEqual(review.resources.map((claim) => `${claim.key}:${claim.mode}`).sort(), ["file/src/a.js:read", "test/env/main:write"]);
  } finally {
    f.cleanup();
  }
});

// Drive one task through implementation, independent review, a recorded milestone, and a ready report.
function makeTaskReady(f, taskId, key, prefix) {
  const lead = slp.readLead(f.roots.foremanHome, "pilot");
  const surface = key.replace(/^file\//, "");
  leadSays(f, peerRequest(taskId, lead.generation, `${prefix}-impl`, { resources: [{ key, mode: "write" }] }));
  const implementation = finishPeer(f, slp.listPeerTasks(f.roots, taskId).find((peer) => peer.slpRequestId === `${prefix}-impl`));
  leadSays(f, peerRequest(taskId, lead.generation, `${prefix}-review`, { role: "review", resources: [{ key, mode: "read" }], dependsOn: [implementation.taskId] }));
  const review = finishPeer(f, slp.listPeerTasks(f.roots, taskId).find((peer) => peer.slpRequestId === `${prefix}-review`));
  leadSays(f, envelope({ taskId, leadGeneration: lead.generation, requestId: `${prefix}-record`, action: "record-review", payload: { ...acceptedReviewPayload([implementation.taskId], review.taskId), changedSurfaces: [surface] } }));
  assert.equal(requestRecord(f, `${prefix}-record`).status, "completed");
  leadSays(f, envelope({ taskId, leadGeneration: lead.generation, requestId: `${prefix}-ready`, action: "report-task", payload: { status: "ready", summary: "Implementation and independent review are complete." } }));
  assert.equal(slp.readTask(f.roots.foremanHome, taskId).status, "review-ready");
  return { implementation, review };
}

function twoTaskFixture() {
  const f = fixture({ capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } });
  const first = createSlpTask(f, "Task A changes docs/a.");
  const second = createSlpTask(f, "Task B changes other files.");
  slp.dispatchSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter, startCoordinator: false });
  f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
  slp.dispatchSlpTask({ roots: f.roots, taskId: second, adapter: f.adapter, startCoordinator: false });
  f.adapter.becomeIdle(slp.readLead(f.roots.foremanHome, "pilot").endpoint);
  return { f, first, second };
}

test("a Peer that may change a surface another task's accepted review covered invalidates that readiness once", () => {
  const { f, first, second } = twoTaskFixture();
  try {
    const { review } = makeTaskReady(f, first, "file/docs/a", "R-a");
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    const readyBefore = slp.readTask(f.roots.foremanHome, first);
    assert.equal(readyBefore.reviewStatus, "accepted");

    // A disjoint Peer on the other task leaves task A ready.
    leadSays(f, peerRequest(second, lead.generation, "R-b-disjoint", { resources: [{ key: "file/docs/elsewhere", mode: "write" }] }));
    assert.equal(slp.readTask(f.roots.foremanHome, first).status, "review-ready");

    // An overlapping Peer clears the review pointers and sends the task back to the Lead.
    leadSays(f, peerRequest(second, lead.generation, "R-b-overlap", { resources: [{ key: "file/docs/a/section", mode: "write" }] }));
    const invalidated = slp.readTask(f.roots.foremanHome, first);
    assert.equal(invalidated.status, "working");
    assert.equal(invalidated.latestReviewId, null);
    assert.equal(invalidated.reviewStatus, null);
    assert.equal(invalidated.completionReport, undefined);
    assert.match(invalidated.waitingReason, /readiness invalidated: Peer T-\d+ on /);
    assert.equal(invalidated.invalidatedEvidence.length, 1);
    assert.equal(invalidated.invalidatedEvidence[0].reviewId, readyBefore.latestReviewId);
    assert.ok(fs.existsSync(readyBefore.completionReport), "the prior completion evidence stays on disk");
    assert.ok(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", first, "reviews", `${readyBefore.latestReviewId}.json`)));
    assert.equal(slp.readTask(f.roots.foremanHome, review.taskId).parentTaskId, first, "A's Peers are untouched");
    const notices = coordination.listMessages({ roots: f.roots }).filter((message) => message.kind === "slp-readiness-invalidated");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].taskId, first);

    // Readiness cannot be reported again without a new independent review.
    f.adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots: f.roots, adapter: f.adapter });
    assert.equal(coordination.listMessages({ roots: f.roots }).find((message) => message.kind === "slp-readiness-invalidated").status, "delivered");
    leadSays(f, envelope({ taskId: first, leadGeneration: lead.generation, requestId: "R-a-ready-again", action: "report-task", payload: { status: "ready", summary: "Still done." } }));
    assert.equal(requestRecord(f, "R-a-ready-again").status, "refused");
    assert.match(requestRecord(f, "R-a-ready-again").outcome.reason, /accepted independent review milestone/);
  } finally {
    f.cleanup();
  }
});

test("accepting one task leaves another task's live Peer, lease, and evidence untouched", () => {
  const { f, first, second } = twoTaskFixture();
  try {
    makeTaskReady(f, first, "file/docs/a", "R-a");
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    leadSays(f, peerRequest(second, lead.generation, "R-b-live", { resources: [{ key: "file/docs/b", mode: "write" }] }));
    const live = slp.listPeerTasks(f.roots, second)[0];
    assert.ok(live.endpoint && live.resourceLease);
    const secondDir = path.join(f.roots.foremanHome, "data", "tasks", second);

    const accepted = slp.acceptSlpTask({ roots: f.roots, taskId: first, adapter: f.adapter });
    assert.equal(accepted.closed, true);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", first)), false);
    const after = slp.readTask(f.roots.foremanHome, live.taskId);
    assert.equal(after.endpoint, live.endpoint);
    assert.equal(after.peerRuntimeStopped, undefined);
    assert.equal(after.resourceLease.leaseId, live.resourceLease.leaseId);
    assert.equal(f.adapter.inspect(live.endpoint).status !== "stopped", true, "the other task's Peer keeps running");
    assert.ok(fs.existsSync(secondDir) && fs.existsSync(path.join(secondDir, "brief.md")));
    assert.equal(slp.readLead(f.roots.foremanHome, "pilot").endpoint, lead.endpoint);
  } finally {
    f.cleanup();
  }
});

test("a task blocked on a human decision leaves the independent task's Peers running", () => {
  const { f, first, second } = twoTaskFixture();
  try {
    const lead = slp.readLead(f.roots.foremanHome, "pilot");
    leadSays(f, envelope({
      taskId: first,
      leadGeneration: lead.generation,
      requestId: "R-a-blocked",
      action: "report-task",
      payload: {
        status: "blocked",
        summary: "The task needs a product choice.",
        decision: { finding: "Two behaviors are possible.", why: "Product behavior belongs to the human.", options: ["Keep", "Change"], impact: "Changes visible behavior.", evidence: "Brief is ambiguous.", recommendation: "Keep" },
      },
    }));
    assert.equal(slp.readTask(f.roots.foremanHome, first).status, "waiting-decision");

    f.adapter.becomeIdle(lead.endpoint);
    leadSays(f, peerRequest(second, lead.generation, "R-b-runs", { resources: [{ key: "file/docs/b", mode: "write" }] }));
    assert.equal(requestRecord(f, "R-b-runs").status, "dispatched");
    const live = slp.listPeerTasks(f.roots, second)[0];
    assert.ok(live.endpoint && live.resourceLease);
    assert.equal(slp.readTask(f.roots.foremanHome, second).status, "working");
    assert.match(slp.sessionContext({ roots: f.roots }), new RegExp(`SLP task ${first} in pilot awaits human decision`));
  } finally {
    f.cleanup();
  }
});
