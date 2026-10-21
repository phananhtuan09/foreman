const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordReport,
  createDecision, answerDecision, deliverDecision, continueTask, acceptTask, discardTask, adoptExistingWorker, recoverDeadWorker, reassignWorker, HerdrAdapter,
} = require("../src/foreman");
const history = require("../src/history");

class FakeTransport {
  constructor() { this.next = 1; this.workers = new Map(); }
  verifyCompatibility() { return { compatible: true, protocol: 22, endpointProtocolGeneration: 1 }; }
  spawn(request) {
    const endpoint = `fake-${this.next++}`;
    this.workers.set(endpoint, { ...request, endpoint, status: "working" });
    return { endpoint, paneId: `pane-${endpoint}` };
  }
  inspect(endpoint) {
    const worker = this.workers.get(endpoint);
    if (!worker || worker.status === "missing") return { endpoint, status: "missing" };
    return { endpoint, owner: worker.owner, cwd: worker.cwd, status: worker.status };
  }
  list() { return [...this.workers.values()].filter((worker) => worker.status !== "missing").map((worker) => this.inspect(worker.endpoint)); }
  send(endpoint) { return this.workers.get(endpoint)?.status === "missing" ? { delivered: false } : { delivered: true, endpoint }; }
  stop(endpoint) {
    const worker = this.workers.get(endpoint);
    if (worker) worker.status = "missing";
    return { stopped: true };
  }
}

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-history-")));
  const project = path.join(base, "app");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "-q", "-b", "main", project]);
  execFileSync("git", ["-C", project, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
  const roots = resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  initHome(roots);
  registerProject({ roots, id: "app", root: project });
  const transport = new FakeTransport();
  return { base, roots, transport, adapter: new HerdrAdapter({ transport }), file: history.historyFile(roots.foremanHome), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

function lines(file) { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean); }

function reviewReady(f, brief = "secret brief words") {
  const task = createTask({ roots: f.roots, projectId: "app", brief });
  const assigned = assignTask({ roots: f.roots, taskId: task.id, owner: "worker-one", adapter: f.adapter, dispatchProfile: { name: "codex-high" } });
  return { task, assigned };
}

test("acceptance appends one metadata line with the task's timeline before deleting its records", () => {
  const f = fixture();
  try {
    const { task, assigned } = reviewReady(f);
    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "secret finding", why: "two outcomes", options: ["A", "B"], recommendation: "A" });
    answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "secret answer" });
    deliverDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, adapter: f.adapter });
    recordReport({ roots: f.roots, paneId: assigned.paneId, status: "done", summary: "secret report" });
    f.transport.workers.get(assigned.endpoint).status = "idle";
    continueTask({ roots: f.roots, taskId: task.id, text: "secret second round", original: "secret words", adapter: f.adapter });
    recordReport({ roots: f.roots, paneId: assigned.paneId, status: "done", summary: "secret second report" });
    const accepted = acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });

    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", task.id)), false);
    const [line] = lines(f.file);
    assert.doesNotMatch(line, /secret/);
    const record = JSON.parse(line);
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.taskId, task.id);
    assert.equal(record.projectId, "app");
    assert.equal(record.outcome, "accepted");
    assert.equal(record.endedAt, accepted.acceptedAt);
    assert.ok(record.createdAt);
    assert.equal(record.round, 2);
    assert.deepEqual(record.events.map((event) => event.type), ["created", "dispatch", "decision", "report", "round", "report", "accepted"]);
    assert.deepEqual(record.events.filter((event) => event.type === "report").map((event) => event.round), [1, 2]);
    const round = record.events.find((event) => event.type === "round");
    assert.deepEqual([round.round, round.generation], [2, 1]);
    assert.ok(round.deliveredAt);
    const dispatch = record.events.find((event) => event.type === "dispatch");
    assert.deepEqual([dispatch.generation, dispatch.owner, dispatch.profile], [1, "worker-one", "codex-high"]);
    const decided = record.events.find((event) => event.type === "decision");
    assert.ok(decided.answeredAt && decided.deliveredAt);
    assert.deepEqual(record.events[3], { type: "report", at: record.events[3].at, status: "done", round: 1, generation: 1 });
    assert.deepEqual(history.readHistory(f.roots.foremanHome), { records: [record], skipped: [] });
  } finally { f.cleanup(); }
});

test("an adopted task keeps its adoption after its worker is replaced, and the line counts recoveries and reassignments", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "app", brief: "adopt this requirement" });
    f.transport.workers.set("codex-1", { endpoint: "codex-1", owner: "codex-1", cwd: path.join(f.base, "app"), status: "working" });
    adoptExistingWorker({ roots: f.roots, adapter: f.adapter, worker: "codex-1", taskId: task.id, explicit: true });
    f.transport.workers.get("codex-1").status = "missing";
    const recovered = recoverDeadWorker({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    const reassigned = reassignWorker({ roots: f.roots, taskId: task.id, adapter: f.adapter, owner: "worker-three" });
    assert.notEqual(reassigned.endpoint, recovered.endpoint);
    recordReport({ roots: f.roots, paneId: reassigned.paneId, status: "done", summary: "workspace checked" });
    acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });

    const record = JSON.parse(lines(f.file)[0]);
    const adopted = record.events.find((event) => event.type === "adopted");
    assert.deepEqual([adopted.generation, adopted.owner], [1, "codex-1"], "the adoption keeps the adopted worker, not the last one");
    assert.deepEqual(record.events.filter((event) => event.type === "dispatch").map((event) => [event.generation, event.replaced]), [[2, "missing"], [3, "human-reassign"]]);
    assert.deepEqual([record.generation, record.recoveryAttempts, record.reassignments], [3, 1, 1]);
  } finally { f.cleanup(); }
});

test("discard records the task as discarded", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "app", type: "scout", brief: "queued only" });
    assert.deepEqual(discardTask({ roots: f.roots, taskId: task.id }), { taskId: task.id, discarded: true, deleted: true });
    const record = JSON.parse(lines(f.file)[0]);
    assert.equal(record.outcome, "discarded");
    assert.deepEqual(record.events.map((event) => event.type), ["created", "discarded"]);
  } finally { f.cleanup(); }
});

test("a failed history write keeps the task records, and a retried acceptance writes the line once", () => {
  const f = fixture();
  try {
    const { task, assigned } = reviewReady(f);
    recordReport({ roots: f.roots, paneId: assigned.paneId, status: "done", summary: "done" });
    fs.mkdirSync(f.file);
    assert.throws(() => acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter }));
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", task.id)), true);
    fs.rmdirSync(f.file);
    acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(lines(f.file).length, 1);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "tasks", task.id)), false);
    const again = history.appendHistoryUnlocked({ home: f.roots.foremanHome, record: JSON.parse(lines(f.file)[0]) });
    assert.deepEqual(again, { appended: false, pruned: 0 });
  } finally { f.cleanup(); }
});

test("a new line drops records past the retention window and keeps unreadable lines", () => {
  const f = fixture();
  try {
    const old = { schemaVersion: 1, taskId: "T-000900", endedAt: "2024-01-01T00:00:00.000Z", events: [] };
    const recent = { schemaVersion: 1, taskId: "T-000901", endedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), events: [] };
    fs.writeFileSync(f.file, `${JSON.stringify(old)}\n{broken\n${JSON.stringify(recent)}`);
    const task = createTask({ roots: f.roots, projectId: "app", type: "scout", brief: "queued only" });
    discardTask({ roots: f.roots, taskId: task.id });
    const kept = lines(f.file);
    assert.deepEqual(kept.slice(0, 2), ["{broken", JSON.stringify(recent)]);
    assert.equal(JSON.parse(kept[2]).taskId, task.id);
    const read = history.readHistory(f.roots.foremanHome);
    assert.deepEqual(read.records.map((record) => record.taskId), ["T-000901", task.id]);
    assert.deepEqual(read.skipped, [{ line: 1 }]);
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test("an append after a line cut short starts on its own line", () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file, "{\"schemaVersion\":1,\"taskId\":\"T-0", { mode: 0o600 });
    const task = createTask({ roots: f.roots, projectId: "app", type: "scout", brief: "queued only" });
    discardTask({ roots: f.roots, taskId: task.id });
    assert.equal(lines(f.file).length, 2);
    assert.deepEqual(history.readHistory(f.roots.foremanHome).records.map((record) => record.taskId), [task.id]);
  } finally { f.cleanup(); }
});

test("retention days come from FOREMAN_HISTORY_RETENTION_DAYS when it is a whole number of at least one day", () => {
  assert.equal(history.retentionDays({}), 365);
  assert.equal(history.retentionDays({ FOREMAN_HISTORY_RETENTION_DAYS: "30" }), 30);
  assert.equal(history.retentionDays({ FOREMAN_HISTORY_RETENTION_DAYS: "-1" }), 365);
  assert.equal(history.retentionDays({ FOREMAN_HISTORY_RETENTION_DAYS: "0.001" }), 365);
});
