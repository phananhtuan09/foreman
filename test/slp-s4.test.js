const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../src/foreman");
const coordination = require("../src/coordination");
const slp = require("../src/slp");
const { FakePaseoAdapter, FakeHerdrAdapter, isolatedRoot, makeProject } = require("./helpers/slp-fakes");

// A world is one Foreman home with several registered projects, each bound to either backend,
// served by one coordinator that picks the adapter from each project's bound backend.
function world(projects, capacity = { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-slp-s4-"));
  const roots = core.resolveRoots({ foremanRoot: isolatedRoot(base, capacity), foremanHome: path.join(base, "home") });
  core.initHome(roots);
  const adapters = { paseo: new FakePaseoAdapter(), herdr: new FakeHerdrAdapter() };
  const byId = {};
  for (const { id, backend } of projects) {
    const root = makeProject(base, id);
    core.registerProject({ roots, id, root, name: id });
    byId[id] = { id, backend, root };
  }
  return {
    base, roots, adapters, projects: byId,
    adapterOf(id) { return adapters[byId[id].backend]; },
    tick() { return slp.coordinatorTick({ roots, adapterFor: (backend) => adapters[backend] || null }); },
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function newTask(w, projectId, brief = "Complete a small project change with independent review.") {
  const { backend } = w.projects[projectId];
  const task = core.createTask({ roots: w.roots, projectId, backend, taskModel: "slp", brief, routingRunner: () => ({ profile: "claude-sonnet", reason: "S4 test profile." }) });
  core.confirmTaskProfile({ roots: w.roots, taskId: task.id, profile: "claude-sonnet" });
  if (!slp.readLead(w.roots.foremanHome, projectId)) slp.confirmProjectLeadProfile({ roots: w.roots, projectId, profileName: "claude-sonnet", backend, adapter: w.adapterOf(projectId) });
  return task.id;
}

function dispatch(w, projectId, taskId) {
  const result = slp.dispatchSlpTask({ roots: w.roots, taskId, adapter: w.adapterOf(projectId), startCoordinator: false });
  idleLead(w, projectId);
  return result;
}

function leadOf(w, projectId) { return slp.readLead(w.roots.foremanHome, projectId); }

function idleLead(w, projectId) {
  const lead = leadOf(w, projectId);
  if (!lead?.endpoint) return;
  const adapter = w.adapterOf(projectId);
  if (w.projects[projectId].backend === "paseo") adapter.becomeIdle(lead.endpoint);
  else adapter.idle(lead.endpoint);
}

function env(projectId, { taskId, leadGeneration, requestId, action = "create-peer", payload }) {
  return { schemaVersion: 1, requestId, projectId, leadGeneration, taskId, action, payload };
}

function peerRequest(projectId, taskId, generation, requestId, { role = "implementation", resources, scope = "docs", dependsOn = [], resolves = [] } = {}) {
  return env(projectId, { taskId, leadGeneration: generation, requestId, payload: { role, brief: `Bounded ${role} work for ${requestId}.`, scope, resources, dependsOn, resolves } });
}

// The project Lead acts: a Paseo Lead answers with the envelope, a Herdr Lead runs the request command.
function say(w, projectId, envelope) {
  const lead = leadOf(w, projectId);
  const adapter = w.adapterOf(projectId);
  if (w.projects[projectId].backend === "paseo") adapter.finish(lead.endpoint, JSON.stringify(envelope));
  else { adapter.idle(lead.endpoint); slp.submitLeadRequest({ roots: w.roots, paneId: lead.paneId, envelope }); }
  w.tick();
  idleLead(w, projectId);
}

function requestRecord(w, projectId, requestId) {
  const lead = leadOf(w, projectId);
  const file = path.join(w.roots.foremanHome, "data", "slp", "leads", projectId, "requests", `g${lead.generation}`, `${requestId}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function peerReport(peer, surfaces, summary = "Bounded work is complete.") {
  return JSON.stringify({ schemaVersion: 1, assignmentId: peer.taskId, generation: peer.generation, status: "done", summary, changedSurfaces: surfaces, checks: [{ name: "focused check", result: "passed", source: "peer run", evidence: "reported output" }], openItems: [] });
}

function peerDone(w, projectId, peer, surfaces) {
  const adapter = w.adapterOf(projectId);
  const changed = surfaces || (peer.resources || []).filter((claim) => claim.mode !== "read").map((claim) => claim.key);
  if (w.projects[projectId].backend === "paseo") adapter.finish(peer.endpoint, peerReport(peer, changed));
  else { core.recordReport({ roots: w.roots, paneId: peer.paneId, status: "done", summary: peerReport(peer, changed) }); adapter.idle(peer.endpoint); }
  idleLead(w, projectId);
  w.tick();
  idleLead(w, projectId);
  return slp.readTask(w.roots.foremanHome, peer.taskId);
}

function peers(w, taskId) { return slp.listPeerTasks(w.roots, taskId); }

function reviewPayload(related, reviewId, surface, outcome = "accepted") {
  return { reviewAssignmentId: reviewId, relatedAssignmentIds: related, outcome, evidence: [surface, "focused check output"], changedSurfaces: [surface], checks: [{ name: "focused check", result: "passed", source: "review Peer", evidence: "passed" }], integrationResult: "passed", unresolvedRisks: [], summary: "Independent review found the task complete." };
}

// Implementation, independent review, a recorded milestone, then a ready report: the shortest delivery flow.
function makeReady(w, projectId, taskId, key, prefix) {
  const generation = leadOf(w, projectId).generation;
  const surface = key.replace(/^file\//, "");
  say(w, projectId, peerRequest(projectId, taskId, generation, `${prefix}-impl`, { resources: [{ key, mode: "write" }] }));
  const implementation = peerDone(w, projectId, peers(w, taskId).find((peer) => peer.slpRequestId === `${prefix}-impl`));
  say(w, projectId, peerRequest(projectId, taskId, generation, `${prefix}-review`, { role: "review", resources: [{ key, mode: "read" }], dependsOn: [implementation.taskId] }));
  const review = peerDone(w, projectId, peers(w, taskId).find((peer) => peer.slpRequestId === `${prefix}-review`));
  say(w, projectId, env(projectId, { taskId, leadGeneration: generation, requestId: `${prefix}-record`, action: "record-review", payload: reviewPayload([implementation.taskId], review.taskId, surface) }));
  assert.equal(requestRecord(w, projectId, `${prefix}-record`).status, "completed");
  say(w, projectId, env(projectId, { taskId, leadGeneration: generation, requestId: `${prefix}-ready`, action: "report-task", payload: { status: "ready", summary: "Implementation and independent review are complete." } }));
  assert.equal(slp.readTask(w.roots.foremanHome, taskId).status, "review-ready");
  return { implementation, review };
}

const BACKENDS = ["paseo", "herdr"];

test("two projects on different backends run side by side and share only explicit service resources", () => {
  const w = world([{ id: "alpha", backend: "paseo" }, { id: "beta", backend: "herdr" }]);
  try {
    const ta = newTask(w, "alpha");
    const tb = newTask(w, "beta");
    dispatch(w, "alpha", ta);
    dispatch(w, "beta", tb);
    const ga = leadOf(w, "alpha").generation;
    const gb = leadOf(w, "beta").generation;

    // The same project-relative path in two projects names two different files.
    say(w, "alpha", peerRequest("alpha", ta, ga, "R-a-file", { resources: [{ key: "file/docs/shared.md", mode: "write" }] }));
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-file", { resources: [{ key: "file/docs/shared.md", mode: "write" }] }));
    assert.equal(requestRecord(w, "alpha", "R-a-file").status, "dispatched");
    assert.equal(requestRecord(w, "beta", "R-b-file").status, "dispatched", "a project-relative path does not conflict across projects");
    assert.equal(peers(w, ta)[0].backend, "paseo");
    assert.equal(peers(w, tb)[0].backend, "herdr");

    // A shared service identity is fleet-wide: the second project waits, then resumes without a human message.
    peerDone(w, "alpha", peers(w, ta)[0]);
    peerDone(w, "beta", peers(w, tb)[0]);
    say(w, "alpha", peerRequest("alpha", ta, ga, "R-a-db", { resources: [{ key: "db/shared-ledger", mode: "write" }] }));
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-db", { resources: [{ key: "db/shared-ledger", mode: "write" }] }));
    const waiting = requestRecord(w, "beta", "R-b-db");
    assert.equal(waiting.status, "waiting");
    assert.match(waiting.outcome.reason, /db\/shared-ledger/);
    assert.match(waiting.outcome.reason, new RegExp(peers(w, ta).find((peer) => peer.slpRequestId === "R-a-db").taskId));

    const view = slp.fleetView({ roots: w.roots });
    assert.equal(view.totals.projects, 2);
    assert.equal(view.projects.find((item) => item.projectId === "beta").waits, 1);
    assert.equal(view.projects.find((item) => item.projectId === "alpha").backend, "paseo");
    assert.match(slp.renderFleetView(view), /beta \[herdr\].*1 waiting/);

    peerDone(w, "alpha", peers(w, ta).find((peer) => peer.slpRequestId === "R-a-db"));
    w.tick();
    assert.equal(requestRecord(w, "beta", "R-b-db").status, "dispatched", "the wait resumes once the holder stops");
    assert.equal(peers(w, tb).filter((peer) => peer.slpRequestId === "R-b-db").length, 1);
  } finally {
    w.cleanup();
  }
});

test("an unknown-surface workspace claim serializes against code paths of its own project only", () => {
  const w = world([{ id: "alpha", backend: "paseo" }, { id: "beta", backend: "herdr" }]);
  try {
    const ta = newTask(w, "alpha");
    const tb = newTask(w, "beta");
    dispatch(w, "alpha", ta);
    dispatch(w, "beta", tb);
    const ga = leadOf(w, "alpha").generation;
    const gb = leadOf(w, "beta").generation;
    say(w, "alpha", peerRequest("alpha", ta, ga, "R-a-known", { resources: [{ key: "file/src/known.js", mode: "write" }] }));
    say(w, "alpha", peerRequest("alpha", ta, ga, "R-a-unknown", { resources: [{ key: "workspace/alpha", mode: "exclusive" }] }));
    const unknown = requestRecord(w, "alpha", "R-a-unknown");
    assert.equal(unknown.status, "waiting", "work whose write surface is unknown waits for known writers in the same project");
    assert.match(unknown.outcome.reason, /file\/src\/known\.js|workspace\/alpha/);
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-known", { resources: [{ key: "file/src/known.js", mode: "write" }] }));
    assert.equal(requestRecord(w, "beta", "R-b-known").status, "dispatched", "another project's code path is not held by alpha");
  } finally {
    w.cleanup();
  }
});

test("a Lead cannot reach another project's tasks, Peers, or evidence", () => {
  const w = world([{ id: "alpha", backend: "paseo" }, { id: "beta", backend: "herdr" }]);
  try {
    const ta = newTask(w, "alpha");
    const tb = newTask(w, "beta");
    dispatch(w, "alpha", ta);
    dispatch(w, "beta", tb);
    const ga = leadOf(w, "alpha").generation;
    const gb = leadOf(w, "beta").generation;
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-peer", { resources: [{ key: "file/docs/b.md", mode: "write" }] }));
    const betaPeer = peers(w, tb)[0];

    // A request for another project's task is refused and creates nothing.
    say(w, "alpha", peerRequest("alpha", tb, ga, "R-a-cross-task", { resources: [{ key: "file/docs/x.md", mode: "write" }] }));
    assert.equal(requestRecord(w, "alpha", "R-a-cross-task").status, "refused");
    assert.equal(peers(w, tb).length, 1);
    // A message to another project's Peer through the Lead's own task is refused.
    say(w, "alpha", env("alpha", { taskId: ta, leadGeneration: ga, requestId: "R-a-cross-msg", action: "message-peer", payload: { assignmentId: betaPeer.taskId, request: "Change course." } }));
    assert.equal(requestRecord(w, "alpha", "R-a-cross-msg").status, "refused");
    assert.equal(w.adapters.herdr.sent.filter((item) => item.endpoint === betaPeer.endpoint).length, 1, "only the original brief reached the Peer");
    // A review milestone cannot cite another project's Peer as evidence.
    say(w, "alpha", env("alpha", { taskId: ta, leadGeneration: ga, requestId: "R-a-cross-review", action: "record-review", payload: reviewPayload([betaPeer.taskId], betaPeer.taskId, "docs/b.md") }));
    assert.equal(requestRecord(w, "alpha", "R-a-cross-review").status, "refused");
    // A Herdr Lead pane cannot submit on behalf of another project.
    assert.throws(() => slp.submitLeadRequest({ roots: w.roots, paneId: leadOf(w, "beta").paneId, envelope: peerRequest("alpha", ta, ga, "R-b-cross-project", { resources: [{ key: "file/docs/y.md", mode: "write" }] }) }), /does not match the bound project Lead/);
    assert.equal(peers(w, ta).length, 0);
  } finally {
    w.cleanup();
  }
});

test("fleet endpoint capacity is shared across projects and backends", () => {
  const w = world([{ id: "alpha", backend: "paseo" }, { id: "beta", backend: "herdr" }], { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 3 });
  try {
    const ta = newTask(w, "alpha");
    const tb = newTask(w, "beta");
    dispatch(w, "alpha", ta);
    dispatch(w, "beta", tb);
    say(w, "alpha", peerRequest("alpha", ta, leadOf(w, "alpha").generation, "R-a-1", { resources: [{ key: "file/a.md", mode: "write" }] }));
    say(w, "beta", peerRequest("beta", tb, leadOf(w, "beta").generation, "R-b-1", { resources: [{ key: "file/b.md", mode: "write" }] }));
    assert.equal(requestRecord(w, "alpha", "R-a-1").status, "dispatched");
    const capped = requestRecord(w, "beta", "R-b-1");
    assert.equal(capped.status, "waiting");
    assert.match(capped.outcome.reason, /endpoint capacity \(3\)/);
    assert.equal(slp.fleetView({ roots: w.roots }).capacity.endpointsHeld, 3);
    peerDone(w, "alpha", peers(w, ta)[0]);
    w.tick();
    assert.equal(requestRecord(w, "beta", "R-b-1").status, "dispatched", "the capped project resumes when the fleet has room");
  } finally {
    w.cleanup();
  }
});

for (const backend of BACKENDS) {
  test(`${backend}: pausing new SLP intake keeps supervision, recovery, and closure of active work`, () => {
    const w = world([{ id: "pilot", backend }]);
    try {
      const t1 = newTask(w, "pilot", "Active task that must finish while intake is paused.");
      dispatch(w, "pilot", t1);
      const generation = leadOf(w, "pilot").generation;
      say(w, "pilot", peerRequest("pilot", t1, generation, "R-live", { resources: [{ key: "file/docs/live.md", mode: "write" }] }));
      const live = peers(w, t1)[0];

      slp.pauseProjectLead({ roots: w.roots, projectId: "pilot", paused: true });
      const t2 = newTask(w, "pilot", "Queued task that must wait for intake to reopen.");
      assert.throws(() => slp.dispatchSlpTask({ roots: w.roots, taskId: t2, adapter: w.adapterOf("pilot"), startCoordinator: false }), /intake is paused/);
      w.tick();
      assert.equal(slp.readTask(w.roots.foremanHome, t2).status, "queued", "the coordinator does not start paused work");
      assert.match(slp.renderFleetView(slp.fleetView({ roots: w.roots })), /intake paused/);

      // Supervision: a missing Peer is still observed, and explicit recovery still works while paused.
      const adapter = w.adapterOf("pilot");
      adapter.agents.get(live.endpoint).status = "missing";
      w.tick();
      assert.ok(slp.projectStatus({ roots: w.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.missing"));
      const recovered = slp.recoverSlpPeer({ roots: w.roots, taskId: live.taskId, adapter, startCoordinator: false });
      assert.equal(recovered.generation, live.generation + 1);
      idleLead(w, "pilot");

      // Closure: the active task still reaches readiness and human acceptance while paused.
      const done = peerDone(w, "pilot", slp.readTask(w.roots.foremanHome, live.taskId));
      assert.equal(done.status, "review-ready");
      say(w, "pilot", peerRequest("pilot", t1, generation, "R-review", { role: "review", resources: [{ key: "file/docs/live.md", mode: "read" }], dependsOn: [live.taskId] }));
      const review = peerDone(w, "pilot", peers(w, t1).find((peer) => peer.slpRequestId === "R-review"));
      say(w, "pilot", env("pilot", { taskId: t1, leadGeneration: generation, requestId: "R-record", action: "record-review", payload: reviewPayload([live.taskId], review.taskId, "docs/live.md") }));
      say(w, "pilot", env("pilot", { taskId: t1, leadGeneration: generation, requestId: "R-ready", action: "report-task", payload: { status: "ready", summary: "Complete." } }));
      assert.equal(slp.readTask(w.roots.foremanHome, t1).status, "review-ready");
      assert.equal(slp.acceptSlpTask({ roots: w.roots, taskId: t1, adapter }).closed, true);
      assert.equal(leadOf(w, "pilot").dispatchPaused, true, "closing a task does not reopen intake");

      // Reopening resumes the queued task without any other change.
      slp.pauseProjectLead({ roots: w.roots, projectId: "pilot", paused: false });
      w.tick();
      assert.equal(slp.readTask(w.roots.foremanHome, t2).status, "working");
    } finally {
      w.cleanup();
    }
  });

  test(`${backend}: an interrupted acceptance resumes from its closure record and keeps the task's measurements`, () => {
    const w = world([{ id: "pilot", backend }]);
    try {
      const t1 = newTask(w, "pilot", "Task closed in two attempts.");
      const t2 = newTask(w, "pilot", "Independent task that must be untouched.");
      dispatch(w, "pilot", t1);
      dispatch(w, "pilot", t2);
      const { implementation, review } = makeReady(w, "pilot", t1, "file/docs/one.md", "R-one");
      say(w, "pilot", peerRequest("pilot", t2, leadOf(w, "pilot").generation, "R-two-live", { resources: [{ key: "file/docs/two.md", mode: "write" }] }));
      const other = peers(w, t2)[0];
      const closureFile = path.join(w.roots.foremanHome, "data", "slp", "closures", `${t1}.json`);

      let cleaned = 0;
      assert.throws(() => slp.acceptSlpTask({ roots: w.roots, taskId: t1, adapter: w.adapterOf("pilot"), afterPeerCleanup: () => { cleaned += 1; throw new Error("simulated crash after the first Peer was removed"); } }), /simulated crash/);
      assert.equal(cleaned, 1);
      const closing = JSON.parse(fs.readFileSync(closureFile, "utf8"));
      assert.equal(closing.status, "closing");
      assert.equal(closing.metrics.peerCount, 2);
      assert.deepEqual(closing.peerTaskIds.sort(), [implementation.taskId, review.taskId].sort());

      const finished = slp.acceptSlpTask({ roots: w.roots, taskId: t1, adapter: w.adapterOf("pilot") });
      assert.equal(finished.closed, true);
      const closed = JSON.parse(fs.readFileSync(closureFile, "utf8"));
      assert.equal(closed.status, "complete");
      assert.deepEqual(closed.metrics, closing.metrics, "the measurement frozen at acceptance is not recomputed from purged records");
      assert.equal(fs.existsSync(path.join(w.roots.foremanHome, "data", "tasks", t1)), false);
      const after = slp.readTask(w.roots.foremanHome, other.taskId);
      assert.equal(after.endpoint, other.endpoint);
      assert.ok(after.resourceLease, "the other task's Peer keeps its lease");
      assert.equal(slp.fleetMetrics({ roots: w.roots }).tasks.find((item) => item.taskId === t1).status, "accepted");
    } finally {
      w.cleanup();
    }
  });

  test(`${backend}: a Lead prompt attempted without delivery proof is flagged uncertain and never resent`, () => {
    const w = world([{ id: "pilot", backend }]);
    try {
      const taskId = newTask(w, "pilot");
      dispatch(w, "pilot", taskId);
      const adapter = w.adapterOf("pilot");
      const lead = leadOf(w, "pilot");
      const sentBefore = adapter.sent.length;
      const message = coordination.listMessages({ roots: w.roots, statuses: ["pending", "delivered"] }).find((item) => item.kind === "slp-task-brief");
      const cursor = backend === "paseo" ? adapter.cursor(lead.endpoint) : null;
      core.withHomeLock(w.roots.foremanHome, () => {
        coordination.updateMessageUnlocked({ roots: w.roots, messageId: message.messageId, mutate: (current) => ({ ...current, status: "pending", deliveredAt: null, deliveryAttemptedAt: new Date().toISOString(), cursorBefore: cursor }) });
      });
      const [result] = slp.deliverPendingLeadMessages({ roots: w.roots, projectId: "pilot", adapter });
      assert.equal(result.uncertain, true);
      assert.equal(adapter.sent.length, sentBefore);
      assert.ok(slp.projectStatus({ roots: w.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "lead.message-delivery-uncertain"));
      assert.ok(slp.taskMetrics({ roots: w.roots, taskId }).runtimeFailureTypes.includes("lead.message-delivery-uncertain"), "the failure is attributed to the task whose message was affected");
    } finally {
      w.cleanup();
    }
  });
}

test("task metrics record Peers, correction cycles, waiting time, human interventions, and runtime failures", async () => {
  const w = world([{ id: "alpha", backend: "paseo" }, { id: "beta", backend: "herdr" }]);
  try {
    const ta = newTask(w, "alpha");
    const tb = newTask(w, "beta");
    dispatch(w, "alpha", ta);
    dispatch(w, "beta", tb);
    const ga = leadOf(w, "alpha").generation;
    const gb = leadOf(w, "beta").generation;

    // Beta waits on alpha's shared service for a measurable time.
    say(w, "alpha", peerRequest("alpha", ta, ga, "R-a-db", { resources: [{ key: "db/ledger", mode: "write" }] }));
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-db", { resources: [{ key: "db/ledger", mode: "write" }] }));
    assert.equal(requestRecord(w, "beta", "R-b-db").status, "waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
    const during = slp.taskMetrics({ roots: w.roots, taskId: tb });
    assert.ok(during.waitedMs >= 20, "an open wait is counted up to now");
    peerDone(w, "alpha", peers(w, ta)[0]);
    w.tick();
    const after = slp.taskMetrics({ roots: w.roots, taskId: tb });
    assert.ok(after.waitedMs >= 20);
    assert.equal(after.waitedRequests, 1);
    assert.equal(requestRecord(w, "beta", "R-b-db").waitingSince, null, "a resolved wait stops accumulating");
    const frozen = slp.taskMetrics({ roots: w.roots, taskId: tb }).waitedMs;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(slp.taskMetrics({ roots: w.roots, taskId: tb }).waitedMs, frozen);

    // A changes-requested review is one correction cycle; a missing Peer is a runtime failure for its task.
    const betaPeer = peers(w, tb).find((peer) => peer.slpRequestId === "R-b-db");
    peerDone(w, "beta", betaPeer);
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-review", { role: "review", resources: [{ key: "db/ledger", mode: "read" }], dependsOn: [betaPeer.taskId] }));
    const review = peerDone(w, "beta", peers(w, tb).find((peer) => peer.slpRequestId === "R-b-review"));
    say(w, "beta", env("beta", { taskId: tb, leadGeneration: gb, requestId: "R-b-changes", action: "record-review", payload: reviewPayload([betaPeer.taskId], review.taskId, "db/ledger", "changes-requested") }));
    say(w, "beta", peerRequest("beta", tb, gb, "R-b-live", { resources: [{ key: "file/docs/b.md", mode: "write" }] }));
    const live = peers(w, tb).find((peer) => peer.slpRequestId === "R-b-live");
    w.adapters.herdr.agents.get(live.endpoint).status = "missing";
    w.tick();
    slp.followupProjectLead({ roots: w.roots, taskId: tb, text: "Please keep the ledger migration reversible.", adapter: w.adapters.herdr, startCoordinator: false });

    const metrics = slp.taskMetrics({ roots: w.roots, taskId: tb });
    assert.equal(metrics.peerCount, 3);
    assert.deepEqual(metrics.peersByRole, { implementation: 2, review: 1 });
    assert.equal(metrics.correctionCycles, 1);
    assert.equal(metrics.humanFollowups, 1);
    assert.equal(metrics.humanInterventions, 1);
    assert.ok(metrics.runtimeFailureTypes.includes("peer.missing"));
    assert.equal(metrics.requestsByAction["record-review"], 1);
    assert.equal(slp.taskMetrics({ roots: w.roots, taskId: ta }).runtimeFailures, 0, "another project's failures are not attributed");

    const fleet = slp.fleetMetrics({ roots: w.roots });
    assert.equal(fleet.totals.tasks, 2);
    assert.equal(fleet.totals.peers, slp.taskMetrics({ roots: w.roots, taskId: ta }).peerCount + metrics.peerCount);
    assert.equal(slp.fleetMetrics({ roots: w.roots, projectId: "beta" }).totals.tasks, 1);
  } finally {
    w.cleanup();
  }
});

test("the compact views stay short while detailed evidence is available on demand", () => {
  const w = world([{ id: "alpha", backend: "paseo" }, { id: "beta", backend: "herdr" }]);
  try {
    const ta = newTask(w, "alpha");
    const tb = newTask(w, "beta");
    dispatch(w, "alpha", ta);
    dispatch(w, "beta", tb);
    makeReady(w, "alpha", ta, "file/docs/a.md", "R-a");
    say(w, "beta", peerRequest("beta", tb, leadOf(w, "beta").generation, "R-b-live", { resources: [{ key: "file/docs/b.md", mode: "write" }] }));

    const text = slp.renderFleetView(slp.fleetView({ roots: w.roots }));
    assert.ok(text.trimEnd().split("\n").length <= 3, "one summary line plus one line per project");
    assert.match(text, /alpha \[paseo\].*1 review-ready.*ready: T-\d+/);
    assert.match(text, /beta \[herdr\].*1 working.*1 Peer/);

    const evidence = slp.taskEvidence({ roots: w.roots, taskId: ta });
    assert.equal(evidence.peers.length, 2);
    assert.ok(evidence.peers.every((peer) => peer.reportFile && fs.existsSync(peer.reportFile)), "every Peer's verbatim report is attributable");
    assert.deepEqual(evidence.requests.map((request) => request.action), ["create-peer", "create-peer", "record-review", "report-task"]);
    assert.equal(evidence.reviews.length, 1);
    assert.equal(evidence.task.reviewStatus, "accepted");
    assert.equal(evidence.metrics.peerCount, 2);
    assert.throws(() => slp.taskEvidence({ roots: w.roots, taskId: "T-999999" }), /Unknown SLP task/);
  } finally {
    w.cleanup();
  }
});

for (const backend of BACKENDS) {
  test(`${backend}: the shortest delivery flow needs one Lead request per step and one human step`, () => {
    const w = world([{ id: "pilot", backend }]);
    try {
      const taskId = newTask(w, "pilot", "A small change with independent review.");
      dispatch(w, "pilot", taskId);
      makeReady(w, "pilot", taskId, "file/docs/small.md", "R-small");
      const ready = slp.taskMetrics({ roots: w.roots, taskId });
      // Regression guard for the current gates: implementation, independent review, milestone, and readiness.
      assert.equal(ready.leadRequests, 4);
      assert.equal(ready.peerCount, 2);
      assert.equal(ready.humanInterventions, 0, "nothing before acceptance needs the human");
      assert.equal(ready.runtimeFailures, 0);
      slp.acceptSlpTask({ roots: w.roots, taskId, adapter: w.adapterOf("pilot") });
      const closed = slp.fleetMetrics({ roots: w.roots }).tasks.find((item) => item.taskId === taskId);
      assert.equal(closed.humanInterventions, 1, "acceptance is the single human step");
      assert.equal(closed.leadRequests, 4);
    } finally {
      w.cleanup();
    }
  });
}

test("the slp CLI commands print the compact view, measurements, and evidence", () => {
  const { execFileSync } = require("node:child_process");
  const w = world([{ id: "alpha", backend: "paseo" }]);
  try {
    const ta = newTask(w, "alpha");
    dispatch(w, "alpha", ta);
    const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, "..", "bin", "foreman"), "slp", ...args], { encoding: "utf8", env: { PATH: process.env.PATH, FOREMAN_ROOT: w.roots.foremanRoot, FOREMAN_HOME: w.roots.foremanHome, FOREMAN_BACKEND: "paseo" } });
    assert.match(run("fleet"), /SLP fleet: 1 project\(s\).*\n- alpha \[paseo\]/);
    assert.equal(JSON.parse(run("fleet", "--json")).projects[0].projectId, "alpha");
    assert.equal(JSON.parse(run("metrics", "--project", "alpha")).totals.tasks, 1);
    assert.equal(JSON.parse(run("evidence", "--task", ta)).task.taskId, ta);
  } finally {
    w.cleanup();
  }
});

test("paseo: a near-miss Peer report is rejected at collection and a corrected report is accepted", () => {
  const w = world([{ id: "pilot", backend: "paseo" }]);
  try {
    const taskId = newTask(w, "pilot");
    dispatch(w, "pilot", taskId);
    say(w, "pilot", peerRequest("pilot", taskId, leadOf(w, "pilot").generation, "R-near-miss", { resources: [{ key: "file/docs/n.md", mode: "write" }] }));
    const peer = peers(w, taskId)[0];
    const adapter = w.adapters.paseo;
    adapter.finish(peer.endpoint, peerReport(peer, ["docs/n.md"]).replace('"schemaVersion":1', '"schemaVersion":"1"'));
    w.tick();
    const stuck = slp.readTask(w.roots.foremanHome, peer.taskId);
    assert.equal(stuck.status, "working", "an unusable report does not complete the Peer");
    assert.equal(stuck.peerRuntimeStopped, undefined);
    const anomaly = slp.projectStatus({ roots: w.roots, projectId: "pilot" }).anomalies.find((item) => item.type === "peer.report-invalid");
    assert.match(anomaly.reason, /schemaVersion must be the number 1/);
    assert.equal(slp.projectStatus({ roots: w.roots, projectId: "pilot" }).anomalies.some((item) => item.type === "peer.report-missing"), false);

    adapter.send(peer.endpoint, "Resubmit your report as the exact normalized JSON object.");
    adapter.finish(peer.endpoint, peerReport(peer, ["docs/n.md"]));
    idleLead(w, "pilot");
    w.tick();
    assert.equal(slp.readTask(w.roots.foremanHome, peer.taskId).peerRuntimeStopped, true);
    assert.equal(slp.readTask(w.roots.foremanHome, peer.taskId).status, "review-ready");
  } finally {
    w.cleanup();
  }
});
