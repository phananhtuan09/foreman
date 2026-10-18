const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, registerProject, createTask, confirmTaskProfile, assignTask, collectPaseoReports, continueTask, acceptTask, reconstructTask,
  addAttentionPoint, resolveAttentionPoint, snoozeAttentionPoint, reopenAttentionPoint, attentionReview, taskAttention, renderAttention,
} = require("../src/foreman");
const attention = require("../src/attention");
const { fixture, routeAndAssign } = require("./support/paseo-fixture");

const bin = path.join(__dirname, "..", "bin", "foreman");

function report(f, assignment, status, summary) {
  f.adapter.finish(assignment.endpoint, JSON.stringify({ status, summary }));
  collectPaseoReports({ roots: f.roots, adapter: f.adapter });
  return reconstructTask({ roots: f.roots, taskId: assignment.taskId }).meta.lastReport.file;
}

function texts(review) { return review.points.map((point) => `${point.taskId}:${point.text}`); }

test("pending points survive proposal, implement, and test rounds, and closing one leaves the others", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Propose how to migrate old records, then implement and test it.", "ship");
    const proposal = report(f, assignment, "done", "Proposal ready. Choose A (convert in place) or B (dual read).");
    const choice = addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "Chọn cách xử lý dữ liệu cũ: A hay B", report: proposal }).point;
    assert.deepEqual([choice.id, choice.source.round, choice.source.type], ["P1", 1, "report"]);

    continueTask({ roots: f.roots, taskId: task.id, text: "Implement the feature.", original: "làm đi", adapter: f.adapter });
    const implement = report(f, assignment, "done", "Implemented; migration not tested yet.");
    const migration = addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "worker", kind: "check", text: "Migration chưa được kiểm chứng", report: implement }).point;
    assert.equal(migration.source.round, 2, "the round comes from the report that raised the point");

    continueTask({ roots: f.roots, taskId: task.id, text: "Run the tests.", original: "test đi", adapter: f.adapter });
    report(f, assignment, "done", "Functional tests pass. No migration evidence.");
    // A new done report that does not mention earlier points keeps them.
    assert.deepEqual(texts(attentionReview({ roots: f.roots })), [`${task.id}:Chọn cách xử lý dữ liệu cũ: A hay B`, `${task.id}:Migration chưa được kiểm chứng`]);

    resolveAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P1", how: "answered", text: "chọn A", user: true });
    assert.deepEqual(texts(attentionReview({ roots: f.roots })), [`${task.id}:Migration chưa được kiểm chứng`], "answering one point closes only that point");
    assert.throws(() => resolveAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P1", how: "answered", text: "chọn B" }), /already answered/);
    assert.throws(() => addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "chọn cách xử lý dữ liệu cũ: a hay b." }), /already has P1 .*was answered; reopen/, "a later report repeating a closed question does not raise it again");
    assert.throws(() => addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "worker", kind: "check", text: "Migration chưa được kiểm chứng" }), /still open/);
  } finally { f.cleanup(); }
});

test("an answered decision stays answered across reviews, a failed delivery, and a restart", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    report(f, assignment, "blocked", "A or B?");
    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "A hay B" });
    resolveAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P1", how: "answered", text: "chọn A", user: true });
    // The worker is gone, so delivering the answer fails; the user's choice is not lost or asked again.
    f.adapter.agents.get(assignment.endpoint).status = "missing";
    assert.throws(() => continueTask({ roots: f.roots, taskId: task.id, text: "Use option A.", original: "chọn A", adapter: f.adapter }));
    for (let index = 0; index < 3; index += 1) assert.equal(attentionReview({ roots: f.roots }).open, 0);
    const restarted = resolveRoots({ foremanRoot: f.roots.foremanRoot, foremanHome: f.roots.foremanHome });
    const point = taskAttention({ roots: restarted, taskId: task.id }).points[0];
    assert.deepEqual([point.status, point.resolution.how, point.resolution.text, point.resolution.source.type], ["resolved", "answered", "chọn A", "user"]);
  } finally { f.cleanup(); }
});

test("snoozing hides exactly one point until tomorrow and survives a restart", () => {
  const f = fixture();
  try {
    const { task } = routeAndAssign(f);
    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "worker", kind: "check", text: "Chưa chạy test tích hợp" });
    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "Cần chọn tên bảng" });
    const snoozed = snoozeAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P1", until: "tomorrow" }).point;
    const until = new Date(snoozed.snoozedUntil);
    const today = new Date();
    assert.equal(until.getHours(), 0);
    assert.ok(until > today && until - today <= 24 * 60 * 60 * 1000);
    const review = attentionReview({ roots: f.roots });
    assert.deepEqual([review.open, review.snoozed], [1, 1]);
    assert.equal(review.points[0].id, "P2");
    const restarted = resolveRoots({ foremanRoot: f.roots.foremanRoot, foremanHome: f.roots.foremanHome });
    assert.equal(attentionReview({ roots: restarted }).snoozed, 1, "the snooze is durable");
    const later = attention.reviewAttention({ home: f.roots.foremanHome, metas: [reconstructTask({ roots: f.roots, taskId: task.id }).meta], projects: [], at: new Date(until.getTime() + 1000).toISOString() });
    assert.equal(later.open, 2, "the snoozed point returns the next day and was never closed");
    assert.throws(() => snoozeAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P2", until: "someday" }), /Snooze time is invalid/);
  } finally { f.cleanup(); }
});

test("the review reads every live task on every project, highlights three points, and never touches a worker", () => {
  const f = fixture();
  try {
    const otherRoot = path.join(f.base, "billing");
    fs.mkdirSync(otherRoot);
    execFileSync("git", ["init", "-b", "main", otherRoot], { stdio: "ignore" });
    registerProject({ roots: f.roots, id: "billing", name: "Billing", root: otherRoot });
    const first = routeAndAssign(f);
    const queued = createTask({ roots: f.roots, projectId: "billing", brief: "Plan the invoice export.", backend: "paseo", routingRunner: () => ({ profile: "codex-luna", reason: "default" }) });
    addAttentionPoint({ roots: f.roots, taskId: first.task.id, owner: "worker", kind: "check", text: "Migration chưa được kiểm chứng", action: "chờ worker chạy migration" });
    addAttentionPoint({ roots: f.roots, taskId: first.task.id, owner: "worker", kind: "obligation", text: "Chưa cập nhật tài liệu API" });
    addAttentionPoint({ roots: f.roots, taskId: queued.id, owner: "user", kind: "decision", text: "Đang chờ bạn chọn định dạng CSV hay XLSX" });
    addAttentionPoint({ roots: f.roots, taskId: queued.id, owner: "user", kind: "check", text: "Bạn cần xác nhận quyền truy cập S3" });
    const callsBefore = f.adapter.calls.length;
    const review = attentionReview({ roots: f.roots });
    assert.equal(f.adapter.calls.length, callsBefore, "the review never calls the runtime");
    assert.deepEqual([review.tasksRead, review.open, review.user, review.worker, review.remaining], [2, 4, 2, 2, 1]);
    assert.deepEqual(review.highlight.map((point) => `${point.taskId}/${point.id}`), [`${queued.id}/P1`, `${queued.id}/P2`, `${first.task.id}/P2`], "user points first, then decisions, obligations, checks");
    const block = renderAttention(review);
    assert.match(block, /^---\n\n> \*\*📌 CÒN TREO · 4 điểm cần chú ý\*\*/);
    assert.match(block, new RegExp(`> \\*\\*Billing · ${queued.id}:\\*\\* Đang chờ bạn chọn định dạng CSV hay XLSX — còn từ vòng 1 · cần bạn\\.`));
    assert.match(block, new RegExp(`> \\*\\*fixture · ${first.task.id}:\\*\\* Chưa cập nhật tài liệu API — còn từ vòng 1 · chờ worker\\.`));
    assert.match(block, /> _còn 1 điểm khác\._\n\n---\n$/);
    assert.equal(reconstructTask({ roots: f.roots, taskId: first.task.id }).meta.status, "working");

    const json = JSON.parse(execFileSync(process.execPath, [bin, "attention", "list", "--json", "--limit", "10"], { env: { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome, FOREMAN_BACKEND: "paseo" }, encoding: "utf8" }));
    assert.equal(json.highlight.length, 4);
    const rendered = execFileSync(process.execPath, [bin, "attention", "list"], { env: { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome, FOREMAN_BACKEND: "paseo" }, encoding: "utf8" });
    assert.equal(rendered, block);
  } finally { f.cleanup(); }
});

test("accepting a task removes its points, and a reopened point keeps its history", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    const evidence = report(f, assignment, "done", "Migration verified: 120 rows converted.");
    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "worker", kind: "check", text: "Migration chưa được kiểm chứng" });
    resolveAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P1", how: "verified", text: "Worker báo đã chuyển 120 dòng", report: evidence });
    const reopened = reopenAttentionPoint({ roots: f.roots, taskId: task.id, pointId: "P1", why: "Người dùng báo bảng archive chưa được chuyển" }).point;
    assert.equal(reopened.status, "open");
    assert.equal(reopened.history[0].resolution.how, "verified");
    assert.equal(reopened.history[0].why, "Người dùng báo bảng archive chưa được chuyển");
    assert.throws(() => addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "worker", kind: "check", text: "x", report: path.join(f.base, "elsewhere.md") }), /not a report of/);

    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "Giữ cột cũ không?" });
    assert.equal(attentionReview({ roots: f.roots }).open, 2);
    acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(attentionReview({ roots: f.roots }).open, 0, "an accepted task leaves no point behind");
    assert.throws(() => addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "late" }), /Unknown task/);
  } finally { f.cleanup(); }
});

test("a task whose points cannot be read is never reported as all clear, and a bad limit is refused", () => {
  const f = fixture();
  try {
    const { task } = routeAndAssign(f);
    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "worker", kind: "check", text: "Migration chưa được kiểm chứng" });
    require("node:fs").writeFileSync(require("../src/attention").attentionFile(f.roots.foremanHome, task.id), "{ not json");
    const review = attentionReview({ roots: f.roots });
    assert.deepEqual(review.skipped.map((item) => item.taskId), [task.id]);
    const block = renderAttention(review);
    assert.match(block, /^Chưa thể kết luận: Không đọc được điểm treo của /);
    assert.doesNotMatch(block, /Không còn điểm treo nào/);
    for (const limit of [Number.NaN, -1, 1.5]) assert.throws(() => attentionReview({ roots: f.roots, limit }), /non-negative whole number/);
  } finally { f.cleanup(); }
});
