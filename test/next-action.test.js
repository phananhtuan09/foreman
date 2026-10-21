const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const {
  resolveRoots, collectPaseoReports, continueTask, sendWorkerMessage, acceptTask, reconstructTask, addAttentionPoint, createDecision,
  proposeNextAction, nextActions, clearNextAction, taskHistory, resolveAttentionPoint, reopenAttentionPoint, supervisionCheck,
} = require("../src/foreman");
const { fixture, routeAndAssign } = require("./support/paseo-fixture");

function report(f, assignment, status, summary) {
  f.adapter.finish(assignment.endpoint, JSON.stringify({ status, summary }));
  collectPaseoReports({ roots: f.roots, adapter: f.adapter });
}

const VERIFY = "Verify the data migration from step 2 of your last report against a copy of the old records. Do not change the PR description. Report the evidence.";

test("next propose prints its highlight line by default and preserves the full object with --json", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    report(f, assignment, "done", "Implementation complete; verification remains.");
    const args = [path.join(__dirname, "..", "bin", "foreman"), "next", "propose", "--task", task.id, "--kind", "round", "--text", "Kiểm chứng migration còn thiếu", "--instruction", VERIFY];
    const env = { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome, FOREMAN_BACKEND: "paseo" };
    const printed = execFileSync(process.execPath, args, { encoding: "utf8", env });
    assert.equal(printed, `> ### ▶ BƯỚC TIẾP · ${task.id}\n>\n> **Kiểm chứng migration còn thiếu**\n>\n> 👉 Trả lời **"gửi"** để giao worker · **"bỏ"** để bỏ qua\n`);
    const json = JSON.parse(execFileSync(process.execPath, [...args, "--json"], { encoding: "utf8", env }));
    assert.equal(json.line, printed.replace(/\n$/u, ""));
    assert.equal(json.taskId, task.id);
    assert.equal(json.kind, "round");
    assert.equal(json.instruction, VERIFY);
    assert.deepEqual(reconstructTask({ roots: f.roots, taskId: task.id }).meta.nextAction.basis, json.basis);
    assert.equal(f.adapter.sent.length, 1, "neither output mode sends the proposed instruction");
  } finally { f.cleanup(); }
});

test("the one shown next action is sent verbatim when the user agrees, and only once", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Implement the migration; do not change the PR description.", "ship");
    report(f, assignment, "done", "Implemented. Next steps: 1. Update the PR description 2. Verify the migration");
    const shown = proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Kiểm chứng migration còn thiếu", instruction: VERIFY });
    assert.match(shown.line, new RegExp(`^> ### ▶ BƯỚC TIẾP · ${task.id}\n>\n> \\*\\*Kiểm chứng migration còn thiếu\\*\\*\n`));
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

test("a round that switches the task's mode says so in the shown line, and a changed mode makes the proposal stale", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f, "Inspect the README.", "scout");
    report(f, assignment, "done", "Found the typo on line 3.");
    const shown = proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Sửa lỗi chính tả ở dòng 3", instruction: "Fix the typo on line 3 of README.md.", type: "ship" });
    assert.match(shown.line, /> \*\*Sửa lỗi chính tả ở dòng 3\*\*\n>\n> ⚠️ Đổi sang chế độ ship: worker được ghi vào workspace\n/);
    const same = proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Đọc thêm phần cài đặt", instruction: "Read the install section.", type: "scout" });
    assert.doesNotMatch(same.line, /chế độ/, "no mode note when the mode stays the same");
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Sửa lỗi chính tả ở dòng 3", instruction: "Fix the typo on line 3 of README.md.", type: "ship" });
    const sent = continueTask({ roots: f.roots, taskId: task.id, fromNext: true, original: "gửi bước sửa lỗi", adapter: f.adapter });
    assert.equal(sent.round.mode, "ship", "the approved mode change still takes effect");
    assert.equal(sent.round.resources[0].mode, "exclusive");
  } finally { f.cleanup(); }
});

test("sending a shown round refuses mode and resource overrides before messaging the worker", () => {
  for (const type of [undefined, "scout"]) {
    const f = fixture();
    try {
      const { task, assignment } = routeAndAssign(f);
      report(f, assignment, "done", "Read the first section.");
      proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Đọc phần cài đặt", instruction: "Read the install section.", type });
      const before = f.adapter.sent.length;
      const send = (options) => continueTask({ roots: f.roots, taskId: task.id, fromNext: true, original: "gửi bước này", adapter: f.adapter, ...options });
      assert.throws(() => send({ type: "ship" }), /stored mode/);
      assert.throws(() => send({ resources: [{ key: "workspace/fixture", mode: "exclusive" }] }), /stored resources/);
      assert.equal(f.adapter.sent.length, before);
      assert.equal(reconstructTask({ roots: f.roots, taskId: task.id }).meta.type, "scout");
      const sent = send({ type: "scout" });
      assert.equal(sent.round.mode, "scout");
      assert.ok(sent.round.resources.every((claim) => claim.mode === "read"));
    } finally { f.cleanup(); }
  }
});

test("a changed pending point makes the shown step stale across a restart", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    report(f, assignment, "done", "Implementation complete; migration verification remains.");
    const opts = { roots: f.roots, taskId: task.id };
    addAttentionPoint({ ...opts, owner: "worker", kind: "check", text: "Migration verification" });
    proposeNextAction({ ...opts, kind: "round", text: "Kiểm chứng migration", instruction: VERIFY });
    resolveAttentionPoint({ ...opts, pointId: "P1", how: "dropped", text: "Bỏ kiểm chứng migration", user: true });
    const restarted = resolveRoots({ foremanRoot: f.roots.foremanRoot, foremanHome: f.roots.foremanHome });
    const stale = nextActions({ ...opts, roots: restarted })[0];
    assert.equal(stale.current, false);
    assert.match(stale.stale.join("; "), /pending points changed/);
    assert.equal(taskHistory(opts).nextAction.current, false);
    const before = f.adapter.sent.length;
    assert.throws(() => continueTask({ ...opts, roots: restarted, fromNext: true, original: "gửi bước này", adapter: f.adapter }), /out of date: .*pending points changed/);
    assert.equal(f.adapter.sent.length, before);
    proposeNextAction({ ...opts, kind: "accept", text: "Chốt task" });
    assert.equal(nextActions(opts)[0].current, true, "a new proposal uses the changed points");
    reopenAttentionPoint({ ...opts, pointId: "P1", why: "New data requires verification" });
    assert.equal(nextActions(opts)[0].current, false, "reopening also invalidates an acceptance proposal");
  } finally { f.cleanup(); }
});

test("next show keeps readable tasks and marks unreadable points unsafe without changing state", () => {
  const f = fixture();
  try {
    const tasks = [routeAndAssign(f), routeAndAssign(f)];
    for (const { task, assignment } of tasks) {
      report(f, assignment, "done", "Inspection complete.");
      proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Đọc thêm README", instruction: "Read the next section of README.md." });
    }
    const [broken, healthy] = tasks.map(({ task }) => task);
    const file = require("../src/attention").attentionFile(f.roots.foremanHome, broken.id);
    const metaBefore = JSON.stringify(reconstructTask({ roots: f.roots, taskId: broken.id }).meta);
    const messagesBefore = f.adapter.sent.length;
    for (const content of ["{ not json", JSON.stringify({ schemaVersion: 99, taskId: broken.id, points: [] })]) {
      fs.writeFileSync(file, content);
      const shown = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "..", "bin", "foreman"), "next", "show"], { encoding: "utf8", env: { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome, FOREMAN_BACKEND: "paseo" } }));
      assert.equal(shown.find((item) => item.taskId === healthy.id).current, true);
      const unreadable = shown.find((item) => item.taskId === broken.id);
      assert.equal(unreadable.current, false);
      assert.match(unreadable.stale.join("; "), /pending points could not be read/);
      assert.deepEqual(nextActions({ roots: f.roots, taskId: broken.id }), [unreadable]);
      assert.throws(() => continueTask({ roots: f.roots, taskId: broken.id, fromNext: true, original: "gửi bước này", adapter: f.adapter }));
      assert.equal(JSON.stringify(reconstructTask({ roots: f.roots, taskId: broken.id }).meta), metaBefore);
      assert.equal(fs.readFileSync(file, "utf8"), content, "show never rewrites unreadable state");
      assert.equal(f.adapter.sent.length, messagesBefore, "unsafe proposals never reach the worker");
    }
  } finally { f.cleanup(); }
});

test("next propose records the review-ready or blocked notice of the report it closes as told", () => {
  const f = fixture();
  try {
    const { task, assignment } = routeAndAssign(f);
    const untold = () => supervisionCheck({ roots: f.roots, adapter: f.adapter }).notices.map((notice) => notice.key);
    const notified = () => JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "meta.json"), "utf8")).notified;
    report(f, assignment, "blocked", "Need A or B.");
    const blocked = `${task.id}/blocked/generation-1-001-blocked.md`;
    assert.deepEqual(untold(), [blocked]);
    assert.deepEqual(proposeNextAction({ roots: f.roots, taskId: task.id, kind: "decision", text: "Chọn A hay B?" }).told, [blocked]);
    assert.deepEqual(untold(), [], "the block is shown with the report, so the blocker is not told twice");
    const firstTold = notified()[blocked];
    assert.deepEqual(proposeNextAction({ roots: f.roots, taskId: task.id, kind: "decision", text: "Chọn A hay B nhé?" }).told, [], "a reworded proposal does not tell the blocker again");
    assert.equal(notified()[blocked], firstTold, "the first told time is kept");

    continueTask({ roots: f.roots, taskId: task.id, text: "Use option A.", original: "dùng A", adapter: f.adapter });
    report(f, assignment, "progress", "Half done.");
    assert.deepEqual(proposeNextAction({ roots: f.roots, taskId: task.id, kind: "round", text: "Làm tiếp", instruction: "Finish option A." }).told, [], "a progress report has no notice");
    report(f, assignment, "done", "Done with A.");
    const ready = untold();
    assert.equal(ready.length, 1);
    assert.match(ready[0], new RegExp(`^${task.id}/review-ready/`));
    proposeNextAction({ roots: f.roots, taskId: task.id, kind: "accept", text: "Chốt task" });
    assert.deepEqual(untold(), []);
  } finally { f.cleanup(); }
});
