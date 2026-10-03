const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const slp = require("../src/slp");
const { PaseoAdapter } = require("../src/paseo");
const { syncPaseoProfiles } = require("../src/paseo-routing");

// Real Paseo agents (Lead and Peers) in an isolated daemon and an isolated Foreman home; the user's fleet is never touched.
// It is opt-in because every run spends real model turns.
const enabled = process.env.RUN_PASEO_SLP_LIVE === "1";
const paseoCommand = process.env.FOREMAN_PASEO_COMMAND || "paseo";
const profileName = process.env.FOREMAN_SLP_LIVE_PROFILE || "opencode-luna";
const sourceRoot = path.resolve(__dirname, "..");

function paseo(args, env) {
  return execFileSync(paseoCommand, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function makeProject(base, name) {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "config", "user.email", "slp-live@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Foreman SLP live"]);
  fs.writeFileSync(path.join(root, "README.md"), `${name}: Foreman SLP live fixture.\n`);
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Project instructions\nThis is a disposable test project. Change only what the assignment names.\n");
  const skill = path.join(root, ".claude", "skills", "foreman-lead", "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, ".claude", "skills", "foreman-lead", "SKILL.md"), skill);
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"], { stdio: "ignore" });
  return root;
}


// Every brief fixes the exact requests, requestIds, and claims so a run proves Foreman's behavior rather than the Lead's planning.
const LEAD_RULES = [
  "Follow the installed foreman-lead skill and use exactly the Lead requests listed here, each with its exact requestId, one request per turn.",
  "Do not add other Peers.",
  "If a Foreman message needs none of the listed actions (for example an outcome that only confirms a dispatch or a wait), end the turn without any JSON envelope and with at most the plain word \"waiting\".",
];

function resourceJson(key, mode) { return JSON.stringify({ key, mode }); }

function readRequests(foremanHome, projectId) {
  const dir = path.join(foremanHome, "data", "slp", "leads", projectId, "requests");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^g\d+$/.test(name)).flatMap((name) => fs.readdirSync(path.join(dir, name)).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(fs.readFileSync(path.join(dir, name, file), "utf8"))));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// One isolated Paseo daemon plus one isolated Foreman home; nothing here can reach the user's daemon or fleet.
async function withLiveEnv({ projects, capacity = { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 3, maxSlpEndpoints: 8 } }, body) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-paseo-slp-live-"));
  const paseoHome = path.join(base, "paseo-home");
  const foremanHome = path.join(base, "foreman-home");
  const foremanRoot = path.join(base, "foreman-root");
  fs.mkdirSync(path.join(foremanRoot, "config"), { recursive: true });
  for (const file of ["model-routing.json", "paseo-agent-profiles.json"]) fs.copyFileSync(path.join(sourceRoot, "config", file), path.join(foremanRoot, "config", file));
  const routingFile = path.join(foremanRoot, "config", "model-routing.json");
  const routing = JSON.parse(fs.readFileSync(routingFile, "utf8"));
  for (const profile of Object.values(routing.profiles)) profile.isActive = true;
  fs.writeFileSync(routingFile, `${JSON.stringify(routing, null, 2)}\n`);
  fs.writeFileSync(path.join(foremanRoot, "config", "slp-capacity.json"), JSON.stringify({ schemaVersion: 1, ...capacity }));

  const env = { ...process.env, FOREMAN_PASEO_HOME: paseoHome, FOREMAN_PASEO_COMMAND: paseoCommand };
  const prior = { home: process.env.FOREMAN_PASEO_HOME, command: process.env.FOREMAN_PASEO_COMMAND };
  const roots = core.resolveRoots({ foremanRoot, foremanHome });
  let daemonStarted = false;
  let adapter;
  try {
    fs.mkdirSync(paseoHome, { recursive: true });
    const port = await freePort();
    paseo(["daemon", "config", "set", "daemon.listen", `127.0.0.1:${port}`, "--home", paseoHome], env);
    paseo(["daemon", "start", "--home", paseoHome, "--timeout", "30"], env);
    daemonStarted = true;
    process.env.FOREMAN_PASEO_HOME = paseoHome;
    process.env.FOREMAN_PASEO_COMMAND = paseoCommand;
    syncPaseoProfiles({ foremanRoot, commandOptions: { command: paseoCommand, env } });
    adapter = new PaseoAdapter({ timeoutMs: 60000 });
    adapter.verifyCompatibility();
    core.initHome(roots);
    for (const id of projects) core.registerProject({ roots, id, root: makeProject(base, id) });

    const started = Date.now();
    const ctx = {
      base, roots, adapter, foremanHome, projects,
      readTask: (taskId) => slp.readTask(foremanHome, taskId),
      peers: (taskId) => slp.listPeerTasks(roots, taskId),
      requests: (projectId) => readRequests(foremanHome, projectId),
      request: (projectId, requestId) => readRequests(foremanHome, projectId).find((item) => item.requestId === requestId),
      anomalies: (projectId) => slp.projectStatus({ roots, projectId }).anomalies,
      newTask(projectId, text) {
        const task = core.createTask({ roots, projectId, backend: "paseo", taskModel: "slp", brief: text, routingRunner: () => ({ profile: profileName, reason: "Live SLP check profile." }) });
        core.confirmTaskProfile({ roots, taskId: task.id, profile: profileName });
        if (!slp.readLead(foremanHome, projectId)) slp.confirmProjectLeadProfile({ roots, projectId, profileName, backend: "paseo", adapter });
        return task.id;
      },
      dispatch: (taskId) => slp.dispatchSlpTask({ roots, taskId, adapter, startCoordinator: false }),
      diagnostics() {
        return JSON.stringify(projects.map((id) => ({
          projectId: id,
          tasks: slp.listSlpTasks(roots, id).map((meta) => `${meta.taskId}:${meta.status}`),
          requests: readRequests(foremanHome, id).map((item) => `${item.requestId}:${item.status}${item.waitedMs ? `:waited${item.waitedMs}` : ""}`),
          anomalies: slp.projectStatus({ roots, projectId: id }).anomalies.map((item) => `${item.type}: ${item.reason}`),
        })), null, 1);
      },
      // Tick the coordinator until the condition holds; the request ceiling bounds token spend if a Lead loops.
      async until(label, condition, { timeoutMs = 2400000, maxRequestsPerProject = 45, onTick } = {}) {
        const deadline = Date.now() + timeoutMs;
        let lastLog = 0;
        const logged = new Set();
        while (Date.now() < deadline) {
          slp.coordinatorTick({ roots, adapter });
          if (onTick) onTick();
          for (const id of projects) {
            for (const item of readRequests(foremanHome, id)) {
              const mark = `${item.requestId}:${item.status}`;
              if (!logged.has(mark)) { logged.add(mark); process.stderr.write(`[live +${Math.round((Date.now() - started) / 1000)}s] ${id} ${mark}${item.status === "refused" ? ` ${JSON.stringify(item.outcome?.reason)}` : ""}\n`); }
            }
            if (readRequests(foremanHome, id).length > maxRequestsPerProject) throw new Error(`${label}: ${id} exceeded ${maxRequestsPerProject} Lead requests: ${this.diagnostics()}`);
          }
          if (condition()) return;
          if (Date.now() - lastLog > 60000) { lastLog = Date.now(); process.stderr.write(`[live +${Math.round((Date.now() - started) / 1000)}s] waiting for ${label}: ${projects.flatMap((id) => slp.listSlpTasks(roots, id).map((meta) => `${meta.taskId}:${meta.status}`)).join(", ")}\n`); }
          await sleep(4000);
        }
        throw new Error(`Timed out waiting for ${label}: ${this.diagnostics()}`);
      },
    };
    await body(ctx);
  } finally {
    if (adapter) {
      for (const id of projects) {
        try { const lead = slp.readLead(foremanHome, id); if (lead?.endpoint) adapter.stop(lead.endpoint); } catch (_) {}
      }
      try { for (const peer of core.listTasks({ roots }).filter((meta) => meta.taskModel === "slp-peer" && meta.endpoint && !meta.peerRuntimeStopped)) adapter.stop(peer.endpoint); } catch (_) {}
    }
    if (daemonStarted) { try { paseo(["daemon", "stop", "--home", paseoHome, "--timeout", "10"], env); } catch (_) {} }
    if (prior.home === undefined) delete process.env.FOREMAN_PASEO_HOME; else process.env.FOREMAN_PASEO_HOME = prior.home;
    if (prior.command === undefined) delete process.env.FOREMAN_PASEO_COMMAND; else process.env.FOREMAN_PASEO_COMMAND = prior.command;
    if (!process.env.KEEP_LIVE_FIXTURE) fs.rmSync(base, { recursive: true, force: true });
    else process.stderr.write(`[live] fixture kept at ${base}\n`);
  }
}

function printMetrics(label, metrics) {
  process.stderr.write(`[live] metrics ${label} ${JSON.stringify(metrics)}\n`);
}

function simpleBrief(projectName) {
  return [
    `In project ${projectName}, create the new file docs/live.txt containing exactly one line: "${projectName} live check". Change nothing else.`,
    ...LEAD_RULES,
    `1. requestId "S-impl": create-peer, role implementation, scope "docs/live.txt", resources [${resourceJson("file/docs/live.txt", "write")}], dependsOn []. The Peer brief must say: first run \`sleep 60\`, then create docs/live.txt with the exact line, and report changedSurfaces ["docs/live.txt"] with a check that shows the file content.`,
    `2. After the implementation report arrives: requestId "S-review", create-peer role review, scope "docs/live.txt", resources [${resourceJson("file/docs/live.txt", "read")}], dependsOn [the implementation assignment ID]. The review Peer only reads the file and reports whether it matches.`,
    "3. After the review report arrives and it passes: requestId \"S-record\", record-review with the review assignment, changedSurfaces [\"docs/live.txt\"], and the evidence you received.",
    "4. Then requestId \"S-ready\": report-task with status ready.",
  ].join("\n");
}

test("live Paseo SLP: two projects run the same project-relative path together, then measure, pause, and close", { skip: !enabled, timeout: 3000000 }, async () => {
  const ids = ["live-alpha", "live-beta"];
  await withLiveEnv({ projects: ids, capacity: { maxActiveTasksPerProject: 2, maxLivePeersPerProject: 2, maxSlpEndpoints: 6 } }, async (env) => {
    const { roots, adapter, foremanHome, base } = env;
    const taskIds = {};
    for (const id of ids) taskIds[id] = env.newTask(id, simpleBrief(id));
    for (const id of ids) env.dispatch(taskIds[id]);
    await env.until("both tasks review-ready", () => ids.every((id) => env.readTask(taskIds[id]).status === "review-ready"));

    // Real agents wrote the files in their own projects.
    for (const id of ids) {
      const content = fs.readFileSync(path.join(base, id, "docs", "live.txt"), "utf8");
      assert.match(content, new RegExp(`${id} live check`));
    }

    // The same project-relative path was claimed in both projects without either request waiting on the other.
    const metrics = Object.fromEntries(ids.map((id) => [id, slp.taskMetrics({ roots, taskId: taskIds[id] })]));
    for (const id of ids) {
      assert.equal(metrics[id].waitedRequests, 0, `${id} waited: ${env.diagnostics()}`);
      assert.ok(metrics[id].peerCount >= 2, `${id} peers`);
      assert.ok(metrics[id].leadRequests >= 4, `${id} requests`);
      assert.equal(metrics[id].humanInterventions, 0);
      printMetrics(`small:${id}`, metrics[id]);
    }
    const implementations = ids.map((id) => env.peers(taskIds[id]).find((peer) => peer.peerRole === "implementation"));
    const windows = implementations.map((peer) => ({ from: Date.parse(peer.assignedAt), to: Date.parse(peer.peerStoppedAt) }));
    assert.ok(windows[0].from < windows[1].to && windows[1].from < windows[0].to, `implementation Peers did not overlap: ${JSON.stringify(windows)}`);

    // Compact view, evidence on demand, and pause on live Leads.
    const view = slp.fleetView({ roots });
    assert.equal(view.totals.projects, 2);
    assert.equal(view.totals.readyForAcceptance, 2);
    const evidence = slp.taskEvidence({ roots, taskId: taskIds[ids[0]] });
    assert.ok(evidence.peers.every((peer) => peer.reportFile && fs.existsSync(peer.reportFile)));
    slp.pauseProjectLead({ roots, projectId: ids[0], paused: true });
    const third = env.newTask(ids[0], "Must not start while intake is paused.");
    assert.throws(() => env.dispatch(third), /intake is paused/);
    slp.coordinatorTick({ roots, adapter });
    assert.equal(env.readTask(third).status, "queued");

    // The test home's human closes both tasks; measurements are frozen and the Leads survive.
    const leadEndpoints = ids.map((id) => slp.readLead(foremanHome, id).endpoint);
    for (const id of ids) assert.equal(slp.acceptSlpTask({ roots, taskId: taskIds[id], adapter }).closed, true);
    const fleet = slp.fleetMetrics({ roots });
    for (const id of ids) {
      const closed = fleet.tasks.find((item) => item.taskId === taskIds[id]);
      assert.equal(closed.status, "accepted");
      assert.equal(closed.humanInterventions, 1);
      assert.equal(closed.peerCount, metrics[id].peerCount);
    }
    for (const endpoint of leadEndpoints) assert.notEqual(adapter.inspect(endpoint).status, "missing");
    process.stderr.write(`[live] metrics ${JSON.stringify(fleet.totals)}\n`);
  });
});

function claimBrief(projectName) {
  return [
    `In project ${projectName}, create docs/a.txt containing exactly one line "claim-a", docs/b.txt containing exactly one line "claim-b", and docs/c.txt containing exactly one line "claim-c". Change nothing else.`,
    ...LEAD_RULES,
    `1. requestId "C-impl-ab": create-peer, role implementation, scope "docs/a.txt", resources [${resourceJson("file/docs/a.txt", "write")}] and nothing else (the claim is deliberately narrow). The Peer brief must say: first run \`sleep 30\`, then create docs/a.txt with the line "claim-a" and docs/b.txt with the line "claim-b", and report changedSurfaces ["docs/a.txt","docs/b.txt"] with a check that shows both file contents.`,
    `2. requestId "C-impl-c": create-peer, role implementation, scope "docs/c.txt", resources [${resourceJson("file/docs/c.txt", "write")}], dependsOn []. The Peer brief must say: first run \`sleep 30\`, then create docs/c.txt with the line "claim-c", and report changedSurfaces ["docs/c.txt"] with a check that shows the file content.`,
    "3. When both implementation reports have arrived, Foreman marks C-impl-ab as exceeding its claim (claimExceeded lists docs/b.txt) and blocks it. Do not request a review yet. Send requestId \"C-fix\": create-peer, role correction, scope \"docs/a.txt docs/b.txt\", resources [" + [resourceJson("file/docs/a.txt", "write"), resourceJson("file/docs/b.txt", "write")].join(",") + "], dependsOn [], resolves [the C-impl-ab assignment ID]. The Peer brief must say: verify docs/a.txt and docs/b.txt contain exactly their lines, change nothing if they are correct, and report changedSurfaces [\"docs/a.txt\",\"docs/b.txt\"] with a check that shows both contents.",
    `4. After the correction report arrives: requestId "C-review", create-peer role review, scope "docs/a.txt docs/b.txt docs/c.txt", resources [${["a", "b", "c"].map((name) => resourceJson(`file/docs/${name}.txt`, "read")).join(",")}], dependsOn [the C-impl-c assignment ID, the C-fix assignment ID]. The review Peer only reads the three files and reports whether each matches its required line.`,
    "5. After the review report arrives and it passes: requestId \"C-record\", record-review with the review assignment as reviewAssignmentId, relatedAssignmentIds listing the C-impl-ab, C-impl-c, and C-fix assignment IDs, outcome accepted, changedSurfaces [\"docs/a.txt\",\"docs/b.txt\",\"docs/c.txt\"], and the evidence you received.",
    "6. Then requestId \"C-ready\": report-task with status ready.",
  ].join("\n");
}

test("live Paseo SLP: a Peer outside its claims is blocked until a correction Peer resolves it, and a larger task is measured", { skip: !enabled, timeout: 3000000 }, async () => {
  await withLiveEnv({ projects: ["live-claim"] }, async (env) => {
    const { roots, base } = env;
    const taskId = env.newTask("live-claim", claimBrief("live-claim"));
    env.dispatch(taskId);
    const seen = {};
    await env.until("claim task review-ready", () => env.readTask(taskId).status === "review-ready", {
      onTick() {
        const exceeded = env.peers(taskId).find((peer) => peer.slpRequestId === "C-impl-ab");
        if (!seen.claimExceeded && exceeded?.slpClaimExceeded) {
          seen.claimExceeded = exceeded.slpClaimExceeded;
          seen.status = exceeded.status;
          seen.leaseReleased = exceeded.resourceLease === null;
          seen.anomaly = env.anomalies("live-claim").some((item) => item.type === "peer.claim-exceeded" && item.assignmentId === exceeded.taskId);
          seen.reviewPeers = env.peers(taskId).filter((peer) => peer.peerRole === "review").length;
          process.stderr.write(`[live] claim exceeded observed: ${JSON.stringify(seen)}\n`);
        }
      },
    });

    // The out-of-claim report was a blocker (not review-ready) and no review had started while it stood.
    assert.deepEqual(seen.claimExceeded, ["docs/b.txt"]);
    assert.equal(seen.status, "blocked");
    assert.equal(seen.leaseReleased, true);
    assert.equal(seen.anomaly, true);
    assert.equal(seen.reviewPeers, 0);

    const peers = env.peers(taskId);
    const byRequest = (requestId) => peers.find((peer) => peer.slpRequestId === requestId);
    const blocked = byRequest("C-impl-ab");
    const correction = byRequest("C-fix");
    const review = byRequest("C-review");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.slpResolvedBy, correction.taskId, "the correction Peer resolved the blocker");
    assert.equal(correction.peerRole, "correction");
    assert.ok(Number(review.taskId.slice(2)) > Number(correction.taskId.slice(2)), "review followed the correction");
    assert.ok(!env.anomalies("live-claim").some((item) => item.type === "peer.claim-exceeded"), "the claim anomaly cleared");
    for (const name of ["a", "b", "c"]) assert.match(fs.readFileSync(path.join(base, "live-claim", "docs", `${name}.txt`), "utf8"), new RegExp(`claim-${name}`));

    // Two implementation Peers ran side by side with disjoint claims.
    const [first, second] = ["C-impl-ab", "C-impl-c"].map((requestId) => byRequest(requestId));
    assert.ok(Date.parse(first.assignedAt) < Date.parse(second.peerStoppedAt) && Date.parse(second.assignedAt) < Date.parse(first.peerStoppedAt), "implementation Peers overlapped");

    const metrics = slp.taskMetrics({ roots, taskId });
    assert.deepEqual(metrics.peersByRole, { implementation: 2, correction: 1, review: 1 });
    assert.equal(metrics.runtimeFailures, 0);
    assert.equal(metrics.humanInterventions, 0);
    printMetrics("larger:claim", metrics);
  });
});

function waitBriefs() {
  const sharedWrite = resourceJson("file/docs/shared.txt", "write");
  const sharedRead = resourceJson("file/docs/shared.txt", "read");
  const one = [
    "Task one in project live-wait: create docs/shared.txt containing the line \"task one\". Change nothing else.",
    ...LEAD_RULES,
    `1. requestId "W1-impl": create-peer, role implementation, scope "docs/shared.txt", resources [${sharedWrite}], dependsOn []. The Peer brief must say: first run \`sleep 150\`, then create docs/shared.txt with the line "task one", and report changedSurfaces ["docs/shared.txt"] with a check that shows the file content.`,
    `2. After the implementation report arrives: requestId "W1-review", create-peer role review, scope "docs/shared.txt", resources [${sharedRead}], dependsOn [the W1-impl assignment ID]. The review Peer only reads the file and reports whether it contains the line "task one" (other lines from other tasks may also be present).`,
    "3. After the review report arrives and it passes: requestId \"W1-record\", record-review with the review assignment as reviewAssignmentId, relatedAssignmentIds [the W1-impl assignment ID], outcome accepted, changedSurfaces [\"docs/shared.txt\"], and the evidence you received.",
    "4. Then requestId \"W1-ready\": report-task with status ready.",
    "5. Only if Foreman later says this task's readiness was invalidated: requestId \"W1-review-2\", create-peer role review with the same scope, read claim, and dependsOn as step 2; after it passes, requestId \"W1-record-2\", record-review again with the same fields, then requestId \"W1-ready-2\": report-task ready.",
  ].join("\n");
  const two = [
    "Task two in project live-wait: append the line \"task two\" to docs/shared.txt. Change nothing else.",
    ...LEAD_RULES,
    `1. requestId "W2-impl": create-peer, role implementation, scope "docs/shared.txt", resources [${sharedWrite}], dependsOn []. The Peer brief must say: append the line "task two" to docs/shared.txt (the file may already exist; keep its other lines) and report changedSurfaces ["docs/shared.txt"] with a check that shows the file content. Another task's Peer may hold docs/shared.txt, so Foreman may record this request as waiting; never resend or recreate it, Foreman dispatches it by itself.`,
    "2. After the W2-impl report arrives: requestId \"W2-progress\", report-task with status progress and a one-line summary. Then take no further action on this task until Foreman sends a human follow-up.",
  ].join("\n");
  return { one, two };
}

test("live Paseo SLP: a conflicting request waits and resumes by itself, and an overlapping Peer invalidates another task's readiness", { skip: !enabled, timeout: 3000000 }, async () => {
  await withLiveEnv({ projects: ["live-wait"] }, async (env) => {
    const { roots, base } = env;
    const briefs = waitBriefs();
    const first = env.newTask("live-wait", briefs.one);
    const second = env.newTask("live-wait", briefs.two);
    env.dispatch(first);
    const seen = { sentFollowup: false, outcomeContext: null };
    let secondDispatched = false;
    await env.until("task one ready, invalidated, and ready again", () => {
      const meta = env.readTask(first);
      return meta.status === "review-ready" && (meta.invalidatedEvidence || []).length === 1
        && env.peers(second).some((peer) => peer.slpRequestId === "W2-impl-2" && peer.peerRuntimeStopped);
    }, {
      onTick() {
        // The second task starts only once the first task's slow implementation Peer holds the shared file.
        if (!secondDispatched && env.peers(first).some((peer) => peer.slpRequestId === "W1-impl" && peer.endpoint)) { env.dispatch(second); secondDispatched = true; }
        const waiting = env.request("live-wait", "W2-impl");
        if (waiting?.status === "waiting" && !seen.wait) {
          seen.wait = { waitKind: waiting.outcome.waitKind, reason: waiting.outcome.reason, inbox: slp.sessionContext({ roots }), pendingPeers: env.peers(second).filter((peer) => peer.slpRequestId === "W2-impl").length };
          process.stderr.write(`[live] wait observed: ${JSON.stringify(seen.wait)}\n`);
        }
        const firstDone = env.readTask(first).status === "review-ready" && !(env.readTask(first).invalidatedEvidence || []).length;
        const secondEdit = env.peers(second).find((peer) => peer.slpRequestId === "W2-impl");
        if (!seen.sentFollowup && firstDone && secondEdit?.peerReportDeliveredAt) {
          seen.firstReviewId = env.readTask(first).latestReviewId;
          slp.followupProjectLead({ roots, taskId: second, adapter: env.adapter, startCoordinator: false, text: [
            "Human follow-up for this task: request one more edit now.",
            `requestId "W2-impl-2": create-peer, role implementation, scope "docs/shared.txt", resources [${resourceJson("file/docs/shared.txt", "write")}], dependsOn []. The Peer brief must say: append the line "task two again" to docs/shared.txt, keep its other lines, and report changedSurfaces ["docs/shared.txt"] with a check that shows the file content.`,
            "After its report arrives, send requestId \"W2-progress-2\": report-task with status progress.",
          ].join("\n") });
          seen.sentFollowup = true;
          process.stderr.write("[live] follow-up sent after task one became ready\n");
        }
      },
    });

    // The conflicting request was held by core while the holder ran, the human inbox said so, and it resumed without a Lead resend.
    assert.equal(seen.wait.waitKind, "resource");
    assert.match(seen.wait.reason, /held by T-\d+ on file\/docs\/shared\.txt/);
    assert.match(seen.wait.inbox, new RegExp(`SLP task ${second} in live-wait is waiting \\(resource\\); it resumes automatically`));
    const request = env.request("live-wait", "W2-impl");
    assert.equal(request.status, "dispatched");
    assert.ok(request.waitedMs > 0, `waitedMs ${request.waitedMs}`);
    assert.equal(request.waitingSince, null);
    const edits = env.peers(second).filter((peer) => peer.slpRequestId === "W2-impl");
    assert.equal(edits.length, 1, "exactly one Peer exists for the waiting request");
    const holder = env.peers(first).find((peer) => peer.slpRequestId === "W1-impl");
    assert.ok(Date.parse(edits[0].assignedAt) >= Date.parse(holder.peerStoppedAt), "the waiter started only after the holder stopped");
    const outcomes = coordinationOutcomes(roots, "W2-impl");
    assert.equal(outcomes.filter((item) => item === "dispatched").length, 1, "the Lead was told once");

    // The overlapping Peer invalidated the first task's accepted review once, kept it as evidence, and a new review restored readiness.
    const meta = env.readTask(first);
    assert.equal(meta.invalidatedEvidence.length, 1);
    assert.equal(meta.invalidatedEvidence[0].reviewId, seen.firstReviewId);
    const extra = env.peers(second).find((peer) => peer.slpRequestId === "W2-impl-2");
    assert.equal(meta.invalidatedEvidence[0].invalidatedBy, extra.taskId);
    assert.notEqual(meta.latestReviewId, seen.firstReviewId, "a new review was recorded");
    assert.ok(fs.existsSync(path.join(env.foremanHome, "data", "tasks", first, "reviews", `${seen.firstReviewId}.json`)), "the earlier review stays as evidence");
    assert.equal(env.peers(first).filter((peer) => peer.peerRole === "review").length, 2);
    const content = fs.readFileSync(path.join(base, "live-wait", "docs", "shared.txt"), "utf8");
    for (const line of ["task one", "task two", "task two again"]) assert.match(content, new RegExp(line));
    printMetrics("wait:first", slp.taskMetrics({ roots, taskId: first }));
    printMetrics("wait:second", slp.taskMetrics({ roots, taskId: second }));
  });
});

// Dispatch outcomes core delivered to the Lead for one request.
function coordinationOutcomes(roots, requestId) {
  return require("../src/coordination").listMessages({ roots })
    .filter((message) => message.kind === "slp-request-outcome" && message.payload.requestId === requestId)
    .map((message) => message.payload.outcome.status);
}

function blockedBriefs() {
  const blocked = [
    "Task A in project live-blocked needs a human product decision before any work: the brief does not say whether the greeting text is formal or casual.",
    "Do not create any Peer for this task.",
    ...LEAD_RULES.slice(0, 1),
    "1. requestId \"BA-blocked\": report-task with status blocked, summary \"Task A needs a product choice.\", and payload.decision = {\"finding\":\"The brief does not say whether the greeting is formal or casual.\",\"why\":\"Product tone belongs to the human.\",\"options\":[\"formal\",\"casual\"],\"impact\":\"Changes user-visible copy.\",\"evidence\":\"The Task A brief.\",\"recommendation\":\"casual\"}.",
  ].join("\n");
  const running = [
    "Task B in project live-blocked: create the new file docs/b.txt containing exactly one line \"blocked-b\". Change nothing else.",
    ...LEAD_RULES,
    `1. requestId "BB-impl": create-peer, role implementation, scope "docs/b.txt", resources [${resourceJson("file/docs/b.txt", "write")}], dependsOn []. The Peer brief must say: first run \`sleep 90\`, then create docs/b.txt with the line "blocked-b", and report changedSurfaces ["docs/b.txt"] with a check that shows the file content.`,
    `2. After the implementation report arrives: requestId "BB-review", create-peer role review, scope "docs/b.txt", resources [${resourceJson("file/docs/b.txt", "read")}], dependsOn [the implementation assignment ID]. The review Peer only reads the file and reports whether it matches.`,
    "3. After the review report arrives and it passes: requestId \"BB-record\", record-review with the review assignment, changedSurfaces [\"docs/b.txt\"], and the evidence you received.",
    "4. Then requestId \"BB-ready\": report-task with status ready.",
  ].join("\n");
  return { blocked, running };
}

test("live Paseo SLP: a task blocked on a human decision leaves the project's other task running to readiness", { skip: !enabled, timeout: 3000000 }, async () => {
  await withLiveEnv({ projects: ["live-blocked"] }, async (env) => {
    const { roots, base } = env;
    const briefs = blockedBriefs();
    const blocked = env.newTask("live-blocked", briefs.blocked);
    const running = env.newTask("live-blocked", briefs.running);
    env.dispatch(blocked);
    env.dispatch(running);
    const seen = {};
    await env.until("task B review-ready beside blocked task A", () => env.readTask(running).status === "review-ready", {
      onTick() {
        const live = env.peers(running).find((peer) => peer.endpoint && !peer.peerRuntimeStopped && peer.resourceLease);
        if (!seen.beside && live && env.readTask(blocked).status === "waiting-decision") {
          seen.beside = { peer: live.taskId, blockedStatus: env.readTask(blocked).status, inbox: slp.sessionContext({ roots }) };
          process.stderr.write(`[live] blocked task beside a running Peer observed: ${JSON.stringify(seen.beside)}\n`);
        }
      },
    });
    assert.ok(seen.beside, "task B's Peer ran while task A awaited its decision");
    assert.match(seen.beside.inbox, new RegExp(`SLP task ${blocked} in live-blocked awaits human decision`));
    assert.equal(env.readTask(blocked).status, "waiting-decision");
    assert.equal(env.peers(blocked).length, 0, "the blocked task has no Peers");
    assert.match(fs.readFileSync(path.join(base, "live-blocked", "docs", "b.txt"), "utf8"), /blocked-b/);
    const metrics = slp.taskMetrics({ roots, taskId: running });
    assert.equal(metrics.runtimeFailures, 0);
    printMetrics("blocked:running", metrics);
    printMetrics("blocked:blocked", slp.taskMetrics({ roots, taskId: blocked }));
  });
});

function rolloverBrief() {
  const claim = (name) => resourceJson(`file/docs/${name}.txt`, "write");
  const peerBrief = (name, line) => `The Peer brief must say: first run \`sleep 330\` as a timing aid (skip the sleep if you are a recovered session continuing after a handoff), then create docs/${name}.txt with the line "${line}", and report changedSurfaces ["docs/${name}.txt"] with a check that shows the file content.`;
  return [
    "In project live-roll, create docs/r1.txt containing exactly one line \"roll-1\" and docs/r2.txt containing exactly one line \"roll-2\". Change nothing else.",
    ...LEAD_RULES,
    "Lead generation 1:",
    `1. requestId "L1-impl-1": create-peer, role implementation, scope "docs/r1.txt", resources [${claim("r1")}], dependsOn []. ${peerBrief("r1", "roll-1")}`,
    `2. requestId "L1-impl-2": create-peer, role implementation, scope "docs/r2.txt", resources [${claim("r2")}], dependsOn []. ${peerBrief("r2", "roll-2")}`,
    "3. After both Peers are dispatched: requestId \"L1-progress\", report-task with status progress and a one-line summary that both implementation Peers are running.",
    "A replacement Lead (a leadGeneration above 1, introduced by a Foreman handoff message) must not create the two implementation Peers again; they stay assigned. It follows:",
    "a. First request: requestId \"L2-reconstruct\", report-task with status progress, a one-line summary, and payload.reconstruction = {\"projectState\":\"Read the generated project state.\",\"knowledge\":\"Read the project instructions.\",\"coreState\":\"Both implementation Peers are still assigned.\"}.",
    "b. Whenever a Peer report arrives but the reports of both implementation Peers (docs/r1.txt and docs/r2.txt) have not both arrived, end the turn without any JSON envelope.",
    `c. When both implementation reports have arrived: requestId "L2-review", create-peer role review, scope "docs/r1.txt docs/r2.txt", resources [${resourceJson("file/docs/r1.txt", "read")},${resourceJson("file/docs/r2.txt", "read")}], dependsOn [both implementation assignment IDs]. The review Peer only reads both files and reports whether each matches its line.`,
    "d. After the review report arrives and it passes: requestId \"L2-record\", record-review with the review assignment as reviewAssignmentId, relatedAssignmentIds listing both implementation assignment IDs, outcome accepted, changedSurfaces [\"docs/r1.txt\",\"docs/r2.txt\"], and the evidence you received.",
    "e. Then requestId \"L2-ready\": report-task with status ready.",
  ].join("\n");
}

test("live Paseo SLP: a Lead rollover and a Peer recovery keep the other live Peers and finish the task", { skip: !enabled, timeout: 3000000 }, async () => {
  await withLiveEnv({ projects: ["live-roll"] }, async (env) => {
    const { roots, adapter, base, foremanHome } = env;
    const taskId = env.newTask("live-roll", rolloverBrief());
    env.dispatch(taskId);
    const liveBoth = () => {
      const peers = env.peers(taskId).filter((peer) => peer.endpoint && !peer.peerRuntimeStopped && peer.resourceLease);
      return peers.length === 2 ? peers : null;
    };
    const progress = () => env.request("live-roll", "L1-progress");
    await env.until("both Peers live and the generation 1 progress request recorded", () => liveBoth() && progress()?.status === "completed");

    const [peerOne, peerTwo] = ["L1-impl-1", "L1-impl-2"].map((requestId) => env.peers(taskId).find((peer) => peer.slpRequestId === requestId));
    const leaseBefore = peerOne.resourceLease.leaseId;
    const leadBefore = slp.readLead(foremanHome, "live-roll");

    // Replace the Lead while both Peers run; the replacement may need a few ticks until the old Lead has no unreconciled message.
    let replaced = null;
    await env.until("Lead replacement at a safe boundary", () => {
      try { replaced = slp.replaceProjectLead({ roots, projectId: "live-roll", adapter, startCoordinator: false }); return true; }
      catch (error) { if (!(error instanceof slp.SlpError)) throw error; process.stderr.write(`[live] replacement not yet possible: ${error.message}\n`); return false; }
    }, { timeoutMs: 600000 });
    assert.equal(replaced.generation, leadBefore.generation + 1);
    assert.equal(replaced.peerAssignmentsPreserved, true);
    assert.notEqual(replaced.endpoint, leadBefore.endpoint);
    for (const peer of [peerOne, peerTwo]) {
      const current = env.readTask(peer.taskId);
      assert.equal(current.endpoint, peer.endpoint, "the live Peer survives the rollover");
      assert.equal(current.resourceLease.leaseId, peer.resourceLease.leaseId);
    }

    // Kill the second Peer's runtime and recover only that assignment; the first Peer is untouched.
    adapter.stop(peerTwo.endpoint);
    assert.ok(["stopped", "missing"].includes(adapter.inspect(peerTwo.endpoint).status));
    const recovered = slp.recoverSlpPeer({ roots, taskId: peerTwo.taskId, adapter, startCoordinator: false });
    assert.equal(recovered.priorGeneration, peerTwo.generation);
    assert.notEqual(recovered.endpoint, peerTwo.endpoint);
    const afterRecovery = env.readTask(peerTwo.taskId);
    assert.equal(afterRecovery.generation, peerTwo.generation + 1);
    assert.equal(afterRecovery.previousGenerations.length, 1);
    assert.equal(env.readTask(peerOne.taskId).endpoint, peerOne.endpoint, "the other live Peer is untouched by the recovery");
    assert.equal(env.readTask(peerOne.taskId).generation, peerOne.generation);
    assert.equal(env.readTask(peerOne.taskId).resourceLease.leaseId, leaseBefore);

    await env.until("task review-ready under the replacement Lead", () => env.readTask(taskId).status === "review-ready");
    const lead = slp.readLead(foremanHome, "live-roll");
    assert.equal(lead.generation, leadBefore.generation + 1);
    assert.ok(lead.reconstruction, "the replacement Lead recorded its reconstruction");
    const peers = env.peers(taskId);
    assert.equal(peers.length, 3, "no Peer was duplicated");
    assert.equal(peers.filter((peer) => peer.peerRole === "implementation").length, 2);
    assert.equal(env.readTask(peerOne.taskId).generation, peerOne.generation, "the first Peer never needed recovery");
    for (const [name, line] of [["r1", "roll-1"], ["r2", "roll-2"]]) assert.match(fs.readFileSync(path.join(base, "live-roll", "docs", `${name}.txt`), "utf8"), new RegExp(line));
    const metrics = slp.taskMetrics({ roots, taskId });
    assert.equal(metrics.peerCount, 3);
    printMetrics("rollover", metrics);
  });
});
