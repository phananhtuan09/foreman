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
  adoptExistingWorker, promoteScout, recoverDeadWorker, HerdrAdapter,
} = core;

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-rounds-"));
  const project = path.join(base, "project");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "pipe" });
  execFileSync("git", ["-C", project, "config", "user.email", "rounds@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Rounds"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "pipe" });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  initHome(roots);
  registerProject({ roots, id: "app", root: project });
  const workers = new Map();
  const sent = [];
  const interrupts = [];
  const state = { spawned: 0, failSend: false };
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
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
    base, project, roots, workers, sent, interrupts, state, adapter: new HerdrAdapter({ transport }),
    meta(taskId) { return JSON.parse(fs.readFileSync(path.join(roots.foremanHome, "data", "tasks", taskId, "meta.json"), "utf8")); },
    file(taskId, name) { return path.join(roots.foremanHome, "data", "tasks", taskId, name); },
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function dispatch(f, options = {}) {
  const { brief = "build it", type = "ship", ...rest } = options;
  const task = createTask({ roots: f.roots, projectId: "app", brief, type, ...rest });
  const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter });
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

module.exports = { fixture, dispatch, report };
