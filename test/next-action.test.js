const assert = require("node:assert/strict");
const test = require("node:test");
const {
  resolveRoots, collectPaseoReports, continueTask, sendWorkerMessage, acceptTask, reconstructTask, addAttentionPoint, createDecision,
  proposeNextAction, nextActions, clearNextAction, taskHistory,
} = require("../src/foreman");
const { fixture, routeAndAssign } = require("./support/paseo-fixture");

function report(f, assignment, status, summary) {
  f.adapter.finish(assignment.endpoint, JSON.stringify({ status, summary }));
  collectPaseoReports({ roots: f.roots, adapter: f.adapter });
}

const VERIFY = "Verify the data migration from step 2 of your last report against a copy of the old records. Do not change the PR description. Report the evidence.";

test("the one shown next action is sent verbatim when the user agrees, and only once", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Implement the migration; do not change the PR description.", "ship");
    report(f, assignment, "done", "Implemented. Next steps: 1. Update the PR description 2. Verify the migration");
    const shown = proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Kiểm chứng migration còn thiếu", instruction: VERIFY });
    assert.equal(shown.line, `> **▶ ${task.id} · Đề xuất: Kiểm chứng migration còn thiếu.**`);
    assert.deepEqual(nextActions({ roots: f.roots }).map((item) => [item.taskId, item.current]), [[task.id, true]]);

    // A fresh session still knows what "send that step" means.
    const restarted = resolveRoots({ foremanRoot: f.roots.foremanRoot, foremanHome: f.roots.foremanHome });
    const sent = continueTask({ roots: restarted, taskId: task.id, original: "gửi bước này", adapter: f.adapter, fromNext: true });
    assert.equal(sent.round.sent, VERIFY, "the worker receives exactly the reviewed instruction");
    assert.equal(sent.round.original, "gửi bước này");
    assert.match(f.adapter.sent.at(-1).prompt, /Do not change the PR description/, "the standing limit travels with the step");
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.nextAction, null);
    assert.throws(() => continueTask({ roots: f.roots, taskId: task.id, original: "gửi lại", adapter: f.adapter, fromNext: true }), /no proposed round/, "a sent step is never sent twice");
  } finally { f.cleanup(); }
});

test("a proposal made out of date by a new report, round, or decision is refused", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    report(f, assignment, "blocked", "Need A or B.");
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Tiếp tục theo A", instruction: "Continue with option A." });
    continueTask({ roots: f.roots, taskId: task.id, text: "Use option B.", original: "đổi ý, dùng B", adapter: f.adapter });
    assert.deepEqual(nextActions({ roots: f.roots }), [], "another round answers the shown step");

    report(f, assignment, "done", "Done with B.");
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Thêm test cho B", instruction: "Add tests for option B." });
    // Foreman asks the worker something else meanwhile; the task returns to working and the worker reports again.
    sendWorkerMessage({ roots: f.roots, taskId: task.id, payload: { request: "Which test runner do you use?" }, adapter: f.adapter });
    report(f, assignment, "progress", "Vitest.");
    const [stale] = nextActions({ roots: f.roots, taskId: task.id });
    assert.equal(stale.current, false);
    assert.match(stale.stale.join("; "), /a newer worker report arrived/);
    assert.match(stale.stale.join("; "), /now working, not review-ready/);
    assert.throws(() => continueTask({ roots: f.roots, taskId: task.id, original: "gửi bước này", adapter: f.adapter, fromNext: true }), /out of date: .*newer worker report/);

    report(f, assignment, "blocked", "Need a schema choice.");
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "decision", text: "Chọn schema: giữ cột cũ hay tách bảng?" });
    createDecision({ roots: f.roots, taskId: task.id, finding: "Schema choice", why: "Compatibility", options: ["keep", "split"] });
    assert.match(nextActions({ roots: f.roots, taskId: task.id })[0].stale.join("; "), /decision changed/);
  } finally { f.cleanup(); }
});

test("proposals are checked against the task, cleared on request, and leave with acceptance", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    assert.throws(() => proposeNextAction({ roots: f.roots, taskId: task.id, kind: "accept", text: "Chốt task" }), /Only a review-ready task/);
    assert.throws(() => proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Làm tiếp" }), /worker instruction must not be empty/);
    assert.throws(() => proposeNextAction({ roots: f.roots, taskId: task.id, kind: "clarify", text: "Hỏi phạm vi", instruction: "x" }), /Only a round proposal/);
    assert.throws(() => proposeNextAction({ roots: f.roots, taskId: task.id, kind: "merge", text: "x" }), /kind must be one of/);
    report(f, assignment, "done", "Goal reached; nothing pending.");
    const other = routeAndAssign(f);
    report(f, other.assignment, "done", "Also done.");
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "accept", text: "Chốt task" });
    proposeNextAction({ roots: f.roots, taskId: other.task.id, kind: "round", text: "Chạy lại test", instruction: "Run the tests again." });
    assert.equal(nextActions({ roots: f.roots }).length, 2, "every task's proposal is listed so a vague reference can be asked about");
    assert.throws(() => continueTask({ roots: f.roots, taskId: task.id, original: "làm bước đó", adapter: f.adapter, fromNext: true }), /no proposed round/, "accepting is never sent as a worker round");
    assert.throws(() => continueTask({ roots: f.roots, taskId: other.task.id, text: "x", original: "y", adapter: f.adapter, fromNext: true }), /do not pass --text/);
    assert.equal(clearNextAction({ roots: f.roots, taskId: other.task.id }).cleared, true);
    assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.status, "review-ready", "proposing acceptance does not accept");
    acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.deepEqual(nextActions({ roots: f.roots }), []);
  } finally { f.cleanup(); }
});

test("task history gives the user's words, rounds, reports, decisions, pending points, and the shown step without changing the task", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Only write a proposal for the cache; do not implement it.");
    report(f, assignment, "done", "Proposal: use an LRU cache. Next steps: 1. Implement it");
    continueTask({ roots: f.roots, taskId: task.id, text: "Add the eviction policy to the proposal.", original: "bổ sung eviction, vẫn chỉ proposal", adapter: f.adapter });
    report(f, assignment, "done", "Proposal updated with eviction.");
    addAttentionPoint({ roots: f.roots, taskId: task.id, owner: "user", kind: "decision", text: "Chọn TTL mặc định" });
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "decision", text: "Chọn TTL mặc định: 5 phút hay 1 giờ?" });
    const before = JSON.stringify(reconstructTask({ roots: f.roots, taskId: task.id }).meta);
    const history = taskHistory({ roots: f.roots, taskId: task.id });
    assert.equal(JSON.stringify(reconstructTask({ roots: f.roots, taskId: task.id }).meta), before, "reading history writes nothing");
    assert.match(history.brief, /do not implement it/);
    assert.deepEqual(history.rounds.map((round) => [round.round, round.original]), [[2, "bổ sung eviction, vẫn chỉ proposal"]]);
    assert.ok(history.roundReports.length >= 2);
    assert.match(history.lastReport.text, /Proposal updated with eviction/);
    assert.equal(history.attention[0].text, "Chọn TTL mặc định");
    assert.equal(history.nextAction.kind, "decision");
    assert.equal(history.nextAction.current, true);
  } finally { f.cleanup(); }
});
