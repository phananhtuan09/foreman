const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const coordination = require("../src/coordination");

const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordReport, listMessages,
  adoptExistingWorker, promoteScout, recoverDeadWorker, continueTask, reassignWorker, createDecision, renderUserReport, listTasks, HerdrAdapter,
} = core;

function fixture({ routing = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-rounds-"));
  const project = path.join(base, "project");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "pipe" });
  execFileSync("git", ["-C", project, "config", "user.email", "rounds@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Rounds"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "pipe" });
  if (routing) {
    fs.mkdirSync(path.join(project, "config"), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "../config/model-routing.json"), path.join(project, "config", "model-routing.json"));
  }
  const roots = resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  initHome(roots);
  registerProject({ roots, id: "app", root: project });
  const workers = new Map();
  const sent = [];
  const interrupts = [];
  const state = { spawned: 0, failSend: false };
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, tool: true, command: true, model: true, reasoningEffort: true }),
    spawn(request) {
      state.spawned += 1;
      const endpoint = `worker-${state.spawned}`;
      workers.set(endpoint, { ...request, endpoint, paneId: `w1:p${state.spawned}`, status: "working" });
      return { endpoint, paneId: `w1:p${state.spawned}` };
    },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { return [...workers.values()]; },
    send(endpoint, text) {
      if (state.failSend) return { delivered: false };
      sent.push({ endpoint, text });
      return workers.has(endpoint) ? { delivered: true } : { delivered: false };
    },
    interrupt(endpoint) {
      interrupts.push(endpoint);
      const worker = workers.get(endpoint);
      if (!worker) return { interrupted: false };
      worker.status = "idle";
      return { interrupted: true };
    },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return {
    base, project, roots, routing, workers, sent, interrupts, state, adapter: new HerdrAdapter({ transport }),
    meta(taskId) { return JSON.parse(fs.readFileSync(path.join(roots.foremanHome, "data", "tasks", taskId, "meta.json"), "utf8")); },
    file(taskId, name) { return path.join(roots.foremanHome, "data", "tasks", taskId, name); },
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function dispatch(f, options = {}) {
  const { brief = "build it", type = "ship", resources, owner = "worker", ...rest } = options;
  const task = createTask({ roots: f.roots, projectId: "app", brief, type, ...(f.routing ? { routingRunner: () => ({ profile: "codex-luna" }) } : {}), ...rest });
  if (f.routing) core.confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "codex-luna" });
  const assignment = assignTask({ roots: f.roots, taskId: task.id, owner, adapter: f.adapter, resources });
  return { task, assignment };
}

function report(f, assignment, status, summary) {
  return recordReport({ roots: f.roots, paneId: assignment.paneId, status, summary });
}

test("task creation stores the user's original wording beside the brief and the router reads it", () => {
  const f = fixture();
  try {
    const routed = [];
    const withOriginal = createTask({
      roots: f.roots, projectId: "app", brief: "Investigate the double shipping fee.", original: "giao cho claude: điều tra phí ship, gấp",
      routingRunner: ({ prompt }) => { routed.push(prompt); return { profile: "default" }; },
    });
    assert.equal(fs.readFileSync(f.file(withOriginal.id, "brief.md"), "utf8"), "Investigate the double shipping fee.");
    assert.equal(fs.readFileSync(f.file(withOriginal.id, "original.md"), "utf8"), "giao cho claude: điều tra phí ship, gấp");
    const plain = createTask({ roots: f.roots, projectId: "app", brief: "No original given." });
    assert.equal(fs.existsSync(f.file(plain.id, "original.md")), false);
    assert.throws(() => createTask({ roots: f.roots, projectId: "app", brief: "x", original: "" }), /Original user wording/);
  } finally { f.cleanup(); }
});

test("promote and adopt carry the original wording", () => {
  const f = fixture();
  try {
    const scout = dispatch(f, { type: "scout", brief: "Why is checkout slow?", original: "T-1 vì sao checkout chậm?" });
    report(f, scout.assignment, "done", "the query is missing an index");
    const reused = promoteScout({ roots: f.roots, taskId: scout.task.id });
    assert.equal(fs.readFileSync(f.file(reused.id, "original.md"), "utf8"), "T-1 vì sao checkout chậm?");
    const reworded = promoteScout({ roots: f.roots, taskId: scout.task.id, brief: "Add the index.", original: "ok thêm index đi" });
    assert.equal(fs.readFileSync(f.file(reworded.id, "original.md"), "utf8"), "ok thêm index đi");
    const brief = promoteScout({ roots: f.roots, taskId: scout.task.id, brief: "Add the index again." });
    assert.equal(fs.existsSync(f.file(brief.id, "original.md")), false);
    f.workers.set("adoptee", { endpoint: "adoptee", owner: "adoptee", cwd: f.project, status: "working", paneId: "w9:p1" });
    const adopted = adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "adoptee", brief: "Take over the fix.", original: "nhận con worker đó", projectId: "app", explicit: true });
    assert.equal(fs.readFileSync(f.file(adopted.taskId, "original.md"), "utf8"), "nhận con worker đó");
  } finally { f.cleanup(); }
});

test("reports carry a ROUND header after round one and keep the round-one format", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    const first = report(f, assignment, "progress", "first look");
    assert.doesNotMatch(fs.readFileSync(first.file, "utf8"), /^ROUND:/m);
    assert.equal(f.meta(task.id).lastReport.round, 1);
    const meta = f.meta(task.id);
    fs.writeFileSync(f.file(task.id, "meta.json"), `${JSON.stringify({ ...meta, round: 2 }, null, 2)}\n`);
    const second = report(f, assignment, "done", "second look");
    assert.match(fs.readFileSync(second.file, "utf8"), /^GENERATION: 1\nROUND: 2\nSTATUS: done$/m);
    assert.equal(f.meta(task.id).lastReport.round, 2);
  } finally { f.cleanup(); }
});

test("meta validation rejects a malformed round or everShip", () => {
  const f = fixture();
  try {
    const { task } = dispatch(f);
    const meta = f.meta(task.id);
    assert.throws(() => coordination.validateTaskMetaRecord({ ...meta, round: 0 }, task.id), /round is invalid/);
    assert.throws(() => coordination.validateTaskMetaRecord({ ...meta, everShip: "yes" }, task.id), /everShip is invalid/);
    assert.doesNotThrow(() => coordination.validateTaskMetaRecord({ ...meta, round: 3, everShip: true }, task.id));
  } finally { f.cleanup(); }
});

test("a recovered worker receives every delivered round and the last report of each round, without the brief twice", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { brief: "Investigate the double fee.", original: "điều tra phí ship" });
    report(f, assignment, "done", "root cause: webhook retry\n\nNext steps:\n1. idempotency key");
    for (const round of [
      { round: 2, status: "delivered", sent: "Do step 1 from round 1.", original: "T-1 làm 1 đi", mode: "ship", supersedes: null },
      { round: 3, status: "failed", sent: "never delivered", original: "x", mode: "ship", supersedes: null },
    ]) coordination.writeRoundUnlocked({ roots: f.roots, record: { schemaVersion: 1, taskId: task.id, generation: 1, createdAt: new Date().toISOString(), resources: [], messageId: null, ...round } });
    const meta = f.meta(task.id);
    fs.writeFileSync(f.file(task.id, "meta.json"), `${JSON.stringify({ ...meta, status: "working", round: 2 }, null, 2)}\n`);
    report(f, assignment, "blocked", "needs a new column");
    f.workers.get(assignment.endpoint).status = "dead";
    const replacement = recoverDeadWorker({ roots: f.roots, taskId: task.id, owner: "successor", adapter: f.adapter });
    const handoff = replacement.handoff;
    assert.equal(handoff.brief, undefined);
    assert.equal(handoff.original, "điều tra phí ship");
    assert.deepEqual(handoff.rounds.map((item) => [item.round, item.sent, item.original]), [[2, "Do step 1 from round 1.", "T-1 làm 1 đi"]]);
    assert.deepEqual(handoff.roundReports.map((item) => [item.round, item.status]), [[1, "done"], [2, "blocked"]]);
    assert.match(handoff.roundReports[0].summary, /root cause: webhook retry/);
    const prompt = sent(f).at(-1).text;
    assert.equal(prompt.match(/Investigate the double fee\./g).length, 1);
    assert.match(prompt, /Do step 1 from round 1\./);
  } finally { f.cleanup(); }
});

test("long round reports are truncated and only the five latest rounds are kept", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    for (let round = 1; round <= 7; round += 1) {
      const meta = f.meta(task.id);
      fs.writeFileSync(f.file(task.id, "meta.json"), `${JSON.stringify({ ...meta, status: "working", round }, null, 2)}\n`);
      report(f, assignment, "done", round === 7 ? "x".repeat(6000) : `report ${round}`);
    }
    const handoff = coordination.buildHandoffPackage({ roots: f.roots, taskId: task.id });
    assert.deepEqual(handoff.roundReports.map((item) => item.round), [3, 4, 5, 6, 7]);
    const last = handoff.roundReports.at(-1);
    assert.match(last.summary, /\[truncated; full report: .+\]$/);
    assert.ok(last.summary.length < 4200);
  } finally { f.cleanup(); }
});

function sent(f) { return f.sent; }

function idle(f, assignment) { f.workers.get(assignment.endpoint).status = "idle"; }

function rounds(f, taskId) { return coordination.listRounds({ roots: f.roots, taskId }); }

function proceed(f, taskId, options = {}) {
  return continueTask({ roots: f.roots, taskId, text: "Do step 1 from your last report.", original: "T-1 làm 1 đi, bảo nó chạy test", adapter: f.adapter, ...options });
}

test("continue sends the rewritten text to the same worker and keeps the user's words out of the prompt", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "found it\n\nNext steps:\n1. add a key");
    idle(f, assignment);
    const result = proceed(f, task.id);
    assert.equal(result.task.status, "working");
    assert.equal(result.task.round, 2);
    assert.equal(result.task.completionReport, null);
    assert.equal(result.task.endpoint, assignment.endpoint);
    assert.equal(result.task.generation, 1);
    const prompt = f.sent.at(-1).text;
    assert.equal(f.sent.at(-1).endpoint, assignment.endpoint);
    assert.match(prompt, /^Foreman task T-\d+ \| project app \| ship \| round 2 \| generation 1\nAllowed resources: workspace\/app \(exclusive\)\n\n## User request \(round 2\)\nDo step 1 from your last report\.\n\n## Report/);
    assert.doesNotMatch(prompt, /T-1 làm 1 đi|original/i);
    assert.equal(listMessages({ roots: f.roots }).filter((item) => item.kind === "task-update").length, 1);
    const [record] = rounds(f, task.id);
    assert.deepEqual([record.round, record.status, record.sent, record.original, record.mode, record.supersedes], [2, "delivered", "Do step 1 from your last report.", "T-1 làm 1 đi, bảo nó chạy test", "ship", null]);
    assert.equal(record.messageId, result.message.messageId);
  } finally { f.cleanup(); }
});

test("continue can attach the original words for reference when asked", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "done");
    idle(f, assignment);
    proceed(f, task.id, { withOriginal: true });
    assert.match(f.sent.at(-1).text, /## User's original words \(reference\)\nT-1 làm 1 đi, bảo nó chạy test/);
  } finally { f.cleanup(); }
});

test("continue answers a blocked report and a progress report, and its report is tagged with the new round", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "blocked", "need a column");
    idle(f, assignment);
    proceed(f, task.id);
    assert.equal(f.meta(task.id).status, "working");
    idle(f, assignment);
    const second = report(f, assignment, "progress", "half way");
    assert.match(fs.readFileSync(second.file, "utf8"), /^ROUND: 2$/m);
    proceed(f, task.id, { text: "Keep going.", original: "tiếp đi" });
    assert.equal(f.meta(task.id).round, 3);
    assert.deepEqual(rounds(f, task.id).map((item) => item.round), [2, 3]);
  } finally { f.cleanup(); }
});

test("continue refuses a task that is not waiting for the user", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    assert.throws(() => proceed(f, task.id), /still running/);
    idle(f, assignment);
    assert.throws(() => proceed(f, task.id), /stopped without reporting/);
    f.workers.get(assignment.endpoint).status = "mystery";
    assert.throws(() => proceed(f, task.id, { interrupt: true }), /unknown/);
    f.workers.get(assignment.endpoint).status = "idle";
    report(f, assignment, "blocked", "which db?");
    createDecision({ roots: f.roots, taskId: task.id, finding: "db", why: "needs product call", options: ["a", "b"] });
    assert.throws(() => proceed(f, task.id), /waiting for a human decision/);
    assert.throws(() => proceed(f, task.id, { text: " ", original: "x" }), /non-empty instruction/);
    assert.throws(() => proceed(f, task.id, { original: "" }), /original wording/);
    const queued = createTask({ roots: f.roots, projectId: "app", brief: "later" });
    assert.throws(() => proceed(f, queued.id), /only a task with an assigned worker/);
    assert.equal(rounds(f, task.id).length, 0);
  } finally { f.cleanup(); }
});

test("continue with interrupt stops a running worker, marks the replaced round, and tells the worker", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "first");
    f.workers.get(assignment.endpoint).status = "idle";
    proceed(f, task.id);
    f.workers.get(assignment.endpoint).status = "working";
    const result = proceed(f, task.id, { text: "Only change the handler.", original: "dừng, chỉ sửa handler", interrupt: true });
    assert.deepEqual(f.interrupts, [assignment.endpoint]);
    assert.equal(result.interrupted, true);
    assert.equal(result.round.round, 3);
    assert.equal(result.round.supersedes, 2);
    assert.match(f.sent.at(-1).text, /This replaces round 2, which was interrupted before you reported\. Inspect the workspace/);
  } finally { f.cleanup(); }
});

test("interrupt does not send ctrl-c to a worker that already stopped", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "first");
    idle(f, assignment);
    const result = proceed(f, task.id, { interrupt: true });
    assert.deepEqual(f.interrupts, []);
    assert.equal(result.interrupted, false);
    assert.equal(result.round.supersedes, null);
  } finally { f.cleanup(); }
});

test("switching a scout to ship raises the lease, and back to scout keeps the write lease", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { type: "scout" });
    assert.deepEqual(f.meta(task.id).resourceLease.resources, [{ key: "workspace/app", mode: "read" }]);
    report(f, assignment, "done", "investigated");
    idle(f, assignment);
    const shipped = proceed(f, task.id, { type: "ship" });
    assert.equal(shipped.task.type, "ship");
    assert.deepEqual(shipped.task.resourceLease.resources, [{ key: "workspace/app", mode: "exclusive" }]);
    assert.notEqual(shipped.task.resourceLease.leaseId, assignment.resourceLease.leaseId);
    assert.deepEqual([shipped.task.resourceLease.taskId, shipped.task.resourceLease.generation, shipped.task.resourceLease.owner], [task.id, 1, "worker"]);
    assert.match(f.sent.at(-1).text, /\| ship \| round 2 .*\nAllowed resources: workspace\/app \(exclusive\) \(changed from workspace\/app \(read\)\)/s);
    idle(f, assignment);
    report(f, assignment, "blocked", "needs a table");
    idle(f, assignment);
    const back = proceed(f, task.id, { type: "scout", text: "Assess the table option. Change no more code.", original: "đừng sửa gì thêm" });
    assert.equal(back.task.type, "scout");
    assert.equal(back.task.everShip, true);
    assert.deepEqual(back.task.resourceLease.resources, [{ key: "workspace/app", mode: "exclusive" }]);
    assert.equal(back.task.resourceLease.leaseId, shipped.task.resourceLease.leaseId);
    assert.match(f.sent.at(-1).text, /\| scout \(read-only for this round\) \| round 3 /);
    assert.doesNotMatch(f.sent.at(-1).text, /changed from/);
    assert.equal(back.round.mode, "scout");
  } finally { f.cleanup(); }
});

test("a scout that never shipped cannot be given write resources", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { type: "scout" });
    report(f, assignment, "done", "investigated");
    idle(f, assignment);
    assert.throws(() => proceed(f, task.id, { resources: [{ key: "file/src/**", mode: "write" }] }), /Scout tasks may only claim read resources/);
    assert.equal(rounds(f, task.id).length, 0);
    assert.equal(f.meta(task.id).status, "review-ready");
  } finally { f.cleanup(); }
});

test("raising the lease warns about overlapping leases instead of refusing", () => {
  const f = fixture();
  try {
    const scout = dispatch(f, { type: "scout" });
    const other = createTask({ roots: f.roots, projectId: "app", brief: "other work" });
    assignTask({ roots: f.roots, taskId: other.id, owner: "other", adapter: f.adapter, resources: [{ key: "file/src/cart.js", mode: "write" }] });
    report(f, scout.assignment, "done", "investigated");
    idle(f, scout.assignment);
    const result = proceed(f, scout.task.id, { type: "ship", resources: [{ key: "file/src/**", mode: "write" }] });
    assert.deepEqual(result.task.resourceLease.conflicts.map((item) => item.taskId), [other.id]);
    assert.equal(result.task.status, "working");
  } finally { f.cleanup(); }
});

test("a failed send marks the round failed, restores mode and lease, and a retry reuses the round number", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { type: "scout" });
    report(f, assignment, "done", "investigated");
    idle(f, assignment);
    const before = f.meta(task.id);
    f.state.failSend = true;
    assert.throws(() => proceed(f, task.id, { type: "ship" }), /delivery failed/);
    const [failed] = rounds(f, task.id);
    assert.deepEqual([failed.round, failed.status], [2, "failed"]);
    assert.deepEqual(f.meta(task.id), before);
    f.state.failSend = false;
    const retry = proceed(f, task.id, { type: "ship" });
    assert.equal(retry.round.round, 2);
    assert.deepEqual(rounds(f, task.id).map((item) => [item.round, item.status]), [[2, "delivered"]]);
    assert.equal(f.meta(task.id).round, 2);
  } finally { f.cleanup(); }
});

test("status lines show the round and the first line of the latest instruction", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { brief: "Investigate the double fee." });
    report(f, assignment, "done", "root cause found");
    assert.match(renderUserReport({ tasks: listTasks({ roots: f.roots }) }, f.roots), /`T-\d+` Investigate the double fee\. — Theo @worker: chờ duyệt/);
    idle(f, assignment);
    proceed(f, task.id, { text: "Add the idempotency key.\nKeep the UI as is.", original: "làm 1" });
    report(f, assignment, "blocked", "needs a column");
    assert.match(renderUserReport({ tasks: listTasks({ roots: f.roots }) }, f.roots), /`T-\d+` \(vòng 2\) Add the idempotency key\. — Theo @worker: worker báo bị chặn/);
  } finally { f.cleanup(); }
});

function reassign(f, taskId, options = {}) { return reassignWorker({ roots: f.roots, taskId, adapter: f.adapter, ...options }); }

test("reassign gives a review-ready task to a new worker that reads every round and only reports", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { brief: "Investigate the double fee." });
    report(f, assignment, "done", "root cause: webhook retry\n\nNext steps:\n1. add a key");
    idle(f, assignment);
    proceed(f, task.id);
    idle(f, assignment);
    report(f, assignment, "done", "added the key");
    idle(f, assignment);
    const before = f.meta(task.id);
    const result = reassign(f, task.id);
    assert.equal(result.generation, 2);
    assert.equal(result.status, "working");
    assert.notEqual(result.endpoint, assignment.endpoint);
    assert.equal(f.workers.has(assignment.endpoint), false);
    assert.equal(result.owner, "app-t-" + task.id.slice(2).toLowerCase() + "-r2");
    assert.equal(result.round, 2);
    assert.equal(result.recoveryAttempts, before.recoveryAttempts || 0);
    assert.equal(result.handoff.reason, "human-reassign");
    assert.deepEqual(result.handoff.roundReports.map((item) => [item.round, item.status]), [[1, "done"], [2, "done"]]);
    const prompt = f.sent.at(-1).text;
    assert.equal(f.sent.at(-1).endpoint, result.endpoint);
    assert.match(prompt, /Investigate the double fee\./);
    assert.match(prompt, /root cause: webhook retry/);
    assert.match(prompt, /Do not change anything yet/);
    assert.doesNotMatch(prompt, /nextRequest/);
    assert.throws(() => recordReport({ roots: f.roots, paneId: assignment.paneId, status: "done", summary: "from the old pane" }), /not bound to an active Foreman task/);
    assert.deepEqual(rounds(f, task.id).map((item) => item.round), [2]);
    assert.deepEqual(result.resourceLease.resources, [{ key: "workspace/app", mode: "exclusive" }]);
    assert.equal(result.resourceLease.generation, 2);
  } finally { f.cleanup(); }
});

test("reassign with a request records a new round and sends it after the handoff", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "blocked", "which store?");
    idle(f, assignment);
    const result = reassign(f, task.id, { text: "Use the payment_events table.", original: "dùng bảng riêng đi" });
    assert.equal(result.roundRecord.round, 2);
    assert.deepEqual([result.roundRecord.generation, result.roundRecord.status, result.roundRecord.sent, result.roundRecord.original], [2, "delivered", "Use the payment_events table.", "dùng bảng riêng đi"]);
    assert.equal(f.meta(task.id).round, 2);
    const prompt = f.sent.at(-1).text;
    assert.match(prompt, /## Previous work and handoff[\s\S]*Inspect the workspace first, then carry out nextRequest\.[\s\S]*## User request \(round 2\)\nUse the payment_events table\.\n\n## Report/);
    assert.equal(prompt.match(/Use the payment_events table\./g).length, 1);
    assert.deepEqual(rounds(f, task.id).map((item) => [item.round, item.status]), [[2, "delivered"]]);
  } finally { f.cleanup(); }
});

test("reassign is not limited by the recovery attempt bound", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "first");
    for (let generation = 2; generation <= 6; generation += 1) {
      const current = f.meta(task.id);
      idle(f, { endpoint: current.endpoint });
      const result = reassign(f, task.id);
      assert.equal(result.generation, generation);
      idle(f, { endpoint: result.endpoint });
      report(f, { paneId: result.paneId }, "done", `report ${generation}`);
    }
    assert.equal(f.meta(task.id).recoveryAttempts || 0, 0);
  } finally { f.cleanup(); }
});

test("reassign refuses tasks it cannot move safely", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "blocked", "which db?");
    createDecision({ roots: f.roots, taskId: task.id, finding: "db", why: "product call", options: ["a", "b"] });
    assert.throws(() => reassign(f, task.id), /waiting for a human decision/);
    const other = dispatch(f, { brief: "second", owner: "second", resources: [{ key: "file/other", mode: "write" }] });
    assert.throws(() => reassign(f, other.task.id, { text: "x" }), /needs both/);
    assert.throws(() => reassign(f, other.task.id, { text: "x", original: " " }), /non-empty/);
    f.workers.get(other.assignment.endpoint).status = "dead";
    assert.throws(() => reassign(f, other.task.id), /unknown|use task recover/);
    f.workers.get(other.assignment.endpoint).status = "mystery";
    assert.throws(() => reassign(f, other.task.id), /run status/);
    const queued = createTask({ roots: f.roots, projectId: "app", brief: "later" });
    assert.throws(() => reassign(f, queued.id), /only a task with an assigned worker/);
    assert.equal(f.meta(other.task.id).generation, 1);
  } finally { f.cleanup(); }
});

test("reassign can change the worker profile and the mode in the same step", () => {
  const f = fixture({ routing: true });
  try {
    const { task, assignment } = dispatch(f, { type: "scout" });
    report(f, assignment, "done", "investigated");
    idle(f, assignment);
    assert.throws(() => reassign(f, task.id, { profile: "codex-sol" }), /inactive/);
    assert.throws(() => reassign(f, task.id, { profile: "invented" }), /Unknown worker profile/);
    assert.equal(f.meta(task.id).generation, 1);
    const result = reassign(f, task.id, { profile: "claude-opus", type: "ship", text: "Add the key.", original: "sửa đi" });
    assert.equal(result.dispatchProfile.name, "claude-opus");
    assert.equal(f.workers.get(result.endpoint).dispatchProfile.model, "claude-opus-5-5");
    assert.equal(result.type, "ship");
    assert.deepEqual(result.resourceLease.resources, [{ key: "workspace/app", mode: "exclusive" }]);
    assert.match(f.sent.at(-1).text, /\| ship \| generation 2/);
    assert.equal(result.roundRecord.mode, "ship");
  } finally { f.cleanup(); }
});

test("a failed reassignment leaves the requested mode undone", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { type: "scout" });
    report(f, assignment, "done", "investigated");
    idle(f, assignment);
    f.state.failSend = true;
    assert.throws(() => reassign(f, task.id, { type: "ship", text: "Add the key.", original: "sửa đi" }), /did not confirm brief delivery|delivery/);
    assert.equal(f.meta(task.id).type, "scout");
    assert.equal(rounds(f, task.id).length, 0);
  } finally { f.cleanup(); }
});

module.exports = { fixture, dispatch, report, idle, rounds, proceed, reassign };
