const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordReport, acceptTask, renderUserReport, HerdrAdapter,
} = require("../src/foreman");
const { captureReviewBase, measureReviewLoad, formatReviewLoad } = require("../src/review-load");
const { taskNotices } = require("../src/supervision");
const stats = require("../src/stats");
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
  send() { return { delivered: true }; }
  stop(endpoint) {
    const worker = this.workers.get(endpoint);
    if (worker) worker.status = "missing";
    return { stopped: true };
  }
}

const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { encoding: "utf8" });

function repo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-review-load-")));
  const root = path.join(base, "app");
  fs.mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "b.txt"), "keep\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  return { base, root };
}

test("review load counts commits, edits, and new files since dispatch, and leaves out paths dirty before it", () => {
  const { base, root } = repo();
  try {
    fs.writeFileSync(path.join(root, "b.txt"), "user edit before dispatch\n");
    fs.mkdirSync(path.join(root, "scratch"));
    fs.writeFileSync(path.join(root, "scratch", "note.txt"), "untracked before dispatch\n");
    const reviewBase = captureReviewBase(root, "2026-10-21T00:00:00.000Z");
    assert.deepEqual(reviewBase.dirty.sort(), ["b.txt", "scratch/"]);

    fs.writeFileSync(path.join(root, "a.txt"), "one\nTWO\nthree\nfour\n");
    git(root, "commit", "-q", "-am", "worker commit");
    fs.writeFileSync(path.join(root, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
    fs.writeFileSync(path.join(root, "new.txt"), "x\ny");
    fs.writeFileSync(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 0]));
    fs.writeFileSync(path.join(root, "b.txt"), "worker edit on a dirty file\n");
    fs.writeFileSync(path.join(root, "scratch", "more.txt"), "inside a dirty directory\n");

    const load = measureReviewLoad({ base: reviewBase, at: "2026-10-21T01:00:00.000Z" });
    assert.deepEqual(load, { files: 3, insertions: 5, deletions: 1, binary: 1, excluded: 3, sharedWith: [], approximate: false, at: "2026-10-21T01:00:00.000Z" });
    assert.equal(formatReviewLoad(load), "3 files, +5/−1 (1 binary; 3 files already changed before dispatch not counted)");
    assert.equal(formatReviewLoad({ ...load, excluded: 0, binary: 0, sharedWith: ["T-000009"] }, "vi"), "3 file, +5/−1 · gần đúng: workspace dùng chung với T-000009");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("review load leaves out a rename and a tabbed name dirty before dispatch, and measures links without following them", () => {
  const { base, root } = repo();
  try {
    fs.writeFileSync(path.join(root, "tab\tname.txt"), "first\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "tabbed name");
    git(root, "mv", "a.txt", "renamed.txt");
    fs.writeFileSync(path.join(root, "tab\tname.txt"), "user edit before dispatch\n");
    const reviewBase = captureReviewBase(root, "t0");
    assert.deepEqual(reviewBase.dirty.sort(), ["a.txt", "renamed.txt", "tab\tname.txt"]);

    fs.writeFileSync(path.join(root, "tab\tname.txt"), "worker edit on a dirty file\n");
    fs.symlinkSync("b.txt", path.join(root, "link-to-b"));
    fs.symlinkSync("nowhere.txt", path.join(root, "dangling"));
    const load = measureReviewLoad({ base: reviewBase, at: "t1" });
    assert.deepEqual(load, { files: 2, insertions: 2, deletions: 0, binary: 0, excluded: 3, sharedWith: [], approximate: false, at: "t1" });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("review load reports why it could not measure instead of failing", () => {
  const { base, root } = repo();
  try {
    assert.match(measureReviewLoad({ base: { workspace: root, commit: "0".repeat(40), dirty: [] } }).error, /bad object|unknown revision|invalid/);
    assert.equal(measureReviewLoad({ base: null }).error, "no base commit was recorded at dispatch");
    const outside = captureReviewBase(path.join(base, "missing"), "t");
    assert.equal(outside.commit, null);
    assert.ok(outside.error);
    assert.equal(formatReviewLoad({ error: "boom" }, "vi"), "không đo được cỡ thay đổi: boom");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("a done report records the review size that the notice, status, and history show", () => {
  const { base, root } = repo();
  try {
    const roots = resolveRoots({ foremanRoot: root, foremanHome: path.join(base, "home") });
    initHome(roots);
    registerProject({ roots, id: "app", root });
    const transport = new FakeTransport();
    const adapter = new HerdrAdapter({ transport });
    const task = createTask({ roots, projectId: "app", brief: "change a" });
    const assigned = assignTask({ roots, taskId: task.id, owner: "worker", adapter });
    assert.equal(assigned.reviewBase.commit, git(root, "rev-parse", "HEAD").trim());
    assert.deepEqual(assigned.reviewBase.dirty, []);

    fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
    recordReport({ roots, paneId: assigned.paneId, status: "done", summary: "done" });
    const meta = JSON.parse(fs.readFileSync(path.join(roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8"));
    assert.deepEqual([meta.reviewLoad.files, meta.reviewLoad.insertions, meta.reviewLoad.deletions], [1, 0, 1]);
    assert.equal(taskNotices(meta)[0].reason, "review size: 1 file, +0/−1");
    assert.match(renderUserReport({ tasks: [{ meta }] }, roots), /chờ duyệt \(1 file, \+0\/−1\)\./);

    acceptTask({ roots, taskId: task.id, adapter });
    assert.equal(history.readHistory(roots.foremanHome).records[0].reviewLoad.files, 1);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("a project without Git records no review base", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-review-plain-")));
  try {
    const root = path.join(base, "plain");
    fs.mkdirSync(root);
    const roots = resolveRoots({ foremanRoot: root, foremanHome: path.join(base, "home") });
    initHome(roots);
    registerProject({ roots, id: "plain", root });
    const task = createTask({ roots, projectId: "plain", brief: "edit" });
    const assigned = assignTask({ roots, taskId: task.id, owner: "worker", adapter: new HerdrAdapter({ transport: new FakeTransport() }) });
    assert.equal(assigned.reviewBase, undefined);
    recordReport({ roots, paneId: assigned.paneId, status: "done", summary: "done" });
    const meta = JSON.parse(fs.readFileSync(path.join(roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8"));
    assert.equal(meta.reviewLoad, undefined);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

function writeLiveTask(home, taskId, meta, { reports = [], decisions = [], messages = [] } = {}) {
  const dir = path.join(home, "data", "tasks", taskId);
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  fs.mkdirSync(path.join(dir, "decisions"), { recursive: true });
  fs.mkdirSync(path.join(home, "data", "messages"), { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ schemaVersion: 1, taskId, projectId: "app", generation: 1, type: "ship", dependencies: [], resources: [], ...meta }));
  reports.forEach((report, index) => fs.writeFileSync(path.join(dir, "reports", `generation-1-00${index + 1}-${report.status}.md`), `TASK: ${taskId}\nGENERATION: 1\nSTATUS: ${report.status}\nREPORTED_AT: ${report.at}\n\nbody`));
  decisions.forEach((decision) => fs.writeFileSync(path.join(dir, "decisions", `${decision.decisionId}.json`), JSON.stringify({ schemaVersion: 1, taskId, generation: 1, ...decision })));
  messages.forEach((message) => fs.writeFileSync(path.join(home, "data", "messages", `${message.messageId}.json`), JSON.stringify({ schemaVersion: 1, taskId, kind: "task-brief", status: "delivered", generation: 1, worker: "w", payload: {}, ...message })));
}

test("stats sum response times and waiting time from ended and live tasks inside the window", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-stats-")));
  try {
    const at = (hour) => new Date(Date.UTC(2026, 9, 20, hour)).toISOString();
    const ended = {
      schemaVersion: 1, taskId: "T-000001", projectId: "app", outcome: "accepted", endedAt: at(6),
      events: [
        { type: "created", at: at(0) },
        { type: "dispatch", at: at(1) },
        { type: "decision", at: at(2), answeredAt: at(3) },
        { type: "report", at: at(4), status: "done" },
        { type: "accepted", at: at(6) },
      ],
    };
    const old = { schemaVersion: 1, taskId: "T-000000", outcome: "discarded", endedAt: "2026-01-01T00:00:00.000Z", events: [] };
    fs.mkdirSync(path.join(home, "data"), { recursive: true });
    fs.writeFileSync(history.historyFile(home), `${JSON.stringify(old)}\n${JSON.stringify(ended)}\nnot json\n`);
    writeLiveTask(home, "T-000002", { status: "blocked", createdAt: at(7) }, {
      messages: [{ messageId: "M-T-000002-1-brief", createdAt: at(8), deliveredAt: at(8) }],
      reports: [{ status: "blocked", at: at(9) }],
    });

    const result = stats.fleetStats({ home, since: "2026-10-19", now: new Date(at(10)) });
    assert.deepEqual(result.ended, { accepted: 1, discarded: 0 });
    assert.deepEqual(result.response.decision, { count: 1, averageMs: 60 * 60 * 1000 });
    assert.deepEqual(result.response.review, { count: 1, averageMs: 2 * 60 * 60 * 1000 });
    assert.deepEqual(result.response.blocked, { count: 0, averageMs: null });
    // T-000001: worker 1-2 and 3-4, user 2-3 and 4-6; T-000002: worker 8-9, user 9-10 (still blocked).
    assert.deepEqual(result.waiting, { userMs: 4 * 60 * 60 * 1000, workerMs: 3 * 60 * 60 * 1000 });
    assert.deepEqual(result.sources, { endedTasks: 1, liveTasks: 1, historyFile: true });
    assert.deepEqual(result.skipped.historyLines, [{ line: 3 }]);

    const text = stats.renderStats(result);
    assert.match(text, /Task kết thúc: 1 accept · 0 discard/);
    assert.match(text, /Trả lời decision: 1,0 giờ · 1/);
    assert.match(text, /chờ bạn 57% \(4,0 giờ\) · chờ worker 43% \(3,0 giờ\)/);
    assert.match(text, /bỏ qua 1 dòng lịch sử không đọc được/);

    const clipped = stats.fleetStats({ home, since: "2026-10-20T05:00:00.000Z", now: new Date(at(10)) });
    assert.deepEqual(clipped.response.decision, { count: 0, averageMs: null });
    assert.deepEqual(clipped.waiting, { userMs: 2 * 60 * 60 * 1000, workerMs: 60 * 60 * 1000 });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("stats count one answer once, start waiting at the first worker, and skip damaged or duplicate history", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-stats-edges-")));
  try {
    const at = (hour) => new Date(Date.UTC(2026, 9, 20, hour)).toISOString();
    const line = (taskId, events) => ({ schemaVersion: 1, taskId, projectId: "app", outcome: "accepted", endedAt: events[events.length - 1].at, events });
    const resumed = line("T-000001", [
      { type: "decision", at: at(0), answeredAt: at(1) },
      { type: "dispatch", at: at(2) },
      { type: "report", at: at(3), status: "blocked" },
      { type: "report", at: at(4), status: "blocked" },
      { type: "report", at: at(5), status: "done" },
      { type: "accepted", at: at(7) },
    ]);
    const damaged = { ...line("T-000002", [{ type: "accepted", at: at(7) }]), events: {} };
    fs.mkdirSync(path.join(home, "data"), { recursive: true });
    fs.writeFileSync(history.historyFile(home), `${JSON.stringify(resumed)}\n${JSON.stringify(damaged)}\n`);
    // A task whose line is written but whose records are not deleted yet is counted once, from its line.
    writeLiveTask(home, "T-000001", { status: "review-ready", createdAt: at(0) }, {
      messages: [{ messageId: "M-T-000001-1-brief", createdAt: at(2), deliveredAt: at(2) }],
      reports: [{ status: "done", at: at(5) }],
    });

    const result = stats.fleetStats({ home, since: "2026-10-19", now: new Date(at(10)) });
    assert.deepEqual(result.response.blocked, { count: 0, averageMs: null }, "blocked reports the worker moved past are not user answers");
    assert.deepEqual(result.response.review, { count: 1, averageMs: 2 * 60 * 60 * 1000 });
    assert.deepEqual(result.response.decision, { count: 1, averageMs: 60 * 60 * 1000 });
    // Worker 2-3, user 3-4 and 4-5 (blocked), user 5-7 (review); the decision before dispatch adds nothing.
    assert.deepEqual(result.waiting, { userMs: 4 * 60 * 60 * 1000, workerMs: 60 * 60 * 1000 });
    assert.deepEqual(result.sources, { endedTasks: 1, liveTasks: 0, historyFile: true });
    assert.deepEqual(result.skipped.historyLines, [{ taskId: "T-000002", error: "the line's events are not a valid timeline" }]);
    assert.match(stats.renderStats(result), /bỏ qua 1 dòng lịch sử không đọc được/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("the stats command does not create a missing home", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-stats-cli-")));
  try {
    const home = path.join(base, "missing-home");
    const run = spawnSync(path.join(__dirname, "..", "bin", "foreman"), ["stats", "--json"], { env: { ...process.env, FOREMAN_HOME: home, FOREMAN_ROOT: base }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).sources.historyFile, false);
    assert.equal(fs.existsSync(home), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("stats on an empty home write nothing and say no history exists yet", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-stats-empty-")));
  try {
    const result = stats.fleetStats({ home, since: "24h" });
    assert.deepEqual(fs.readdirSync(home), []);
    assert.match(stats.renderStats(result), /chưa có lịch sử task đã kết thúc/);
    assert.throws(() => stats.parseSince("yesterday", Date.now()), /--since/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
