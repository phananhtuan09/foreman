const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const test = require("node:test");
const core = require("../src/foreman");
const dashboard = require("../src/dashboard");
const { createDashboardServer } = require("../src/dashboard-server");
const { buildDashboardHome } = require("./support/dashboard-fixture");

function snapshotTree(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file); else out[path.relative(dir, file)] = `${stat.mtimeMs}:${fs.readFileSync(file, "utf8")}`;
    }
  };
  walk(dir);
  return out;
}

function get(port, urlPath, { host = `127.0.0.1:${port}`, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, type: response.headers["content-type"], body }));
    });
    request.on("error", reject);
    request.end();
  });
}

// Reads Server-Sent Events until `until` accepts a snapshot or the time runs out.
function readEvents(port, until, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const snapshots = [];
    const timer = setTimeout(() => { request.destroy(); reject(new Error(`no matching snapshot after ${snapshots.length} events`)); }, timeoutMs);
    const request = http.get({ host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}` } }, (response) => {
      let buffer = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (!data) continue;
          const snapshot = JSON.parse(data.slice(6));
          snapshots.push(snapshot);
          if (until(snapshot, snapshots)) { clearTimeout(timer); request.destroy(); resolve(snapshots); return; }
        }
      });
    });
    request.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
  });
}

test("the snapshot shows what the board needs from Foreman's own records and leaves the home untouched", () => {
  const f = buildDashboardHome();
  try {
    const before = snapshotTree(f.roots.foremanHome);
    const snap = dashboard.buildSnapshot({ roots: f.roots });
    assert.deepEqual(snapshotTree(f.roots.foremanHome), before);
    assert.equal(snap.state, "ready");
    const byId = Object.fromEntries(snap.tasks.map((task) => [task.taskId, task]));
    const { ids } = f;
    assert.deepEqual(snap.tasks.map((task) => task.taskId).sort(), [ids.done, ids.blocked, ids.deciding, ids.working, ids.silent, ids.choose, ids.waiting].sort());

    const done = byId[ids.done];
    assert.equal(done.status, "review-ready");
    assert.equal(done.title, "Add the login form");
    assert.equal(done.reviewSize, "0 file, +0/−0");
    assert.deepEqual(done.reviewChange, { files: 0, lines: 0 }, "the review size also arrives as numbers to order reviews by");
    assert.equal(byId[ids.blocked].reviewChange, null);
    assert.equal(done.rounds[0].original, "Làm form đăng nhập có kiểm tra dữ liệu.");
    assert.deepEqual(done.rounds[0].reports[0].steps, ["Accept task. (recommended)", "Thêm test cho màn hình nhỏ."]);
    assert.equal(done.rounds[0].reports[0].summary, "Kết quả: form đăng nhập có kiểm tra dữ liệu.\nBằng chứng: 12/12 test pass.");
    assert.equal(done.statusSince, done.rounds[0].reports[0].at);
    assert.equal(done.unread, true);

    const deciding = byId[ids.deciding];
    assert.equal(deciding.decisions.length, 1);
    assert.deepEqual(deciding.decisions[0].options.map((option) => [option.key, option.title]), [["A", "Tạo agent mới với handoff gọn"], ["B", "Giữ agent cũ, resend context đã nén"]]);
    assert.equal(deciding.decisions[0].recommendation, "A");
    assert.equal(deciding.decisions[0].id, f.decisionId);
    assert.equal(deciding.statusSince, deciding.decisions[0].createdAt);

    const working = byId[ids.working];
    assert.equal(working.round, 2);
    assert.deepEqual(working.rounds.map((round) => [round.round, round.original]), [[2, "Thêm phần xử lý sự cố."], [1, "Viết lại trang quick start cho người mới."]]);
    assert.deepEqual(working.attention.map((point) => [point.id, point.owner, point.state]), [["P1", "user", "open"], ["P2", "worker", "open"]]);
    assert.equal(working.runtime, "working");
    assert.equal(working.leaseOverlap, ids.silent, "a read claim over the content tree overlaps the write claim below it");

    const silent = byId[ids.silent];
    assert.equal(silent.runtime, "idle");
    assert.deepEqual(silent.issues.map((issue) => issue.type), ["worker.idle-without-report"]);
    assert.equal(byId[ids.done].runtime, null, "a review-ready task is not observed by the status check");
    assert.equal(byId[ids.choose].runtime, "none");
    assert.equal(byId[ids.choose].needsProfileConfirmation, true);
    assert.deepEqual(byId[ids.waiting].dependencies, [ids.done]);

    assert.ok(snap.backends.herdr.checkedAt);
    assert.deepEqual(snap.untold.map((notice) => notice.kind).sort(), ["anomaly", "blocked", "review-ready"]);
    assert.deepEqual(snap.history.map((record) => [record.taskId, record.outcome]), [[ids.discarded, "discarded"], [ids.accepted, "accepted"]]);
    assert.deepEqual(snap.projects.map((project) => project.id), ["app", "docs"]);
    assert.ok(snap.profiles.some((profile) => profile.name === "claude-sonnet" && profile.isDefault));
    assert.deepEqual(snap.skipped, []);
  } finally { f.cleanup(); }
});

test("the snapshot carries Foreman's reports of a task verbatim, and a new one changes the fingerprint", () => {
  const f = buildDashboardHome();
  try {
    const { ids } = f;
    const empty = dashboard.buildSnapshot({ roots: f.roots }).tasks.find((task) => task.taskId === ids.deciding);
    assert.deepEqual(empty.foremanReports, []);
    const before = dashboard.fingerprint({ roots: f.roots });
    const summary = "**Cần bạn chọn** cách nối tiếp khi cache hết hạn.\n\n| Phương án | Chi phí |\n|---|---|\n| A | thấp |";
    core.proposeNextAction({ roots: f.roots, taskId: ids.deciding, kind: "decision", text: "Chọn A hay B", summary });
    assert.notEqual(dashboard.fingerprint({ roots: f.roots }), before);
    const [shown] = dashboard.buildSnapshot({ roots: f.roots }).tasks.find((task) => task.taskId === ids.deciding).foremanReports;
    assert.equal(shown.summary, summary);
    assert.equal(shown.round, 1);
    assert.equal(shown.kind, "decision");
    assert.match(shown.line, /Cần bạn quyết/u);
    assert.ok(shown.at);
  } finally { f.cleanup(); }
});

test("the snapshot of a missing home creates nothing, and a damaged task is skipped instead of failing the board", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-dashboard-missing-")));
  try {
    const home = path.join(base, "home");
    assert.equal(dashboard.buildSnapshot({ roots: { foremanRoot: base, foremanHome: home } }).state, "missing-home");
    assert.equal(fs.existsSync(home), false);
    fs.mkdirSync(path.join(home, "data", "tasks", "T-000001"), { recursive: true });
    fs.writeFileSync(path.join(home, "data", "tasks", "T-000001", "meta.json"), "{not json");
    const snap = dashboard.buildSnapshot({ roots: { foremanRoot: base, foremanHome: home } });
    assert.equal(snap.state, "ready");
    assert.deepEqual(snap.tasks, []);
    assert.deepEqual(snap.skipped.map((item) => item.taskId), ["T-000001"]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("the board lists every routing profile when the default is a Paseo-only profile", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-dashboard-routing-")));
  try {
    const routing = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "model-routing.json"), "utf8"));
    fs.mkdirSync(path.join(base, "config"));
    fs.writeFileSync(path.join(base, "config", "model-routing.json"), JSON.stringify({ ...routing, default: "antigravity-flash" }));
    const home = path.join(base, "home");
    fs.mkdirSync(path.join(home, "data", "tasks"), { recursive: true });
    const snap = dashboard.buildSnapshot({ roots: { foremanRoot: base, foremanHome: home } });
    assert.deepEqual(snap.profiles.map((profile) => profile.name).sort(), Object.keys(routing.profiles).sort());
    assert.ok(snap.profiles.some((profile) => profile.name === "antigravity-flash" && profile.isDefault && profile.tool === "antigravity"));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("decision options, recommendations and Next steps are read the way workers and Foreman write them", () => {
  assert.deepEqual(dashboard.decisionOption("B) Keep the agent", 0), { key: "B", title: "Keep the agent", impact: null });
  assert.deepEqual(dashboard.decisionOption("Phương án C - giữ nguyên", 2), { key: "C", title: "giữ nguyên", impact: null });
  assert.deepEqual(dashboard.decisionOption("Use a heuristic", 1), { key: "B", title: "Use a heuristic", impact: null });
  const options = [{ key: "A", title: "Use a heuristic" }, { key: "B", title: "Wait for the API" }];
  assert.equal(dashboard.recommendedKey("B because it is exact", options), "B");
  assert.equal(dashboard.recommendedKey("Wait for the API", options), "B");
  assert.equal(dashboard.recommendedKey("Accept as is", options), null);
  assert.equal(dashboard.recommendedKey("none available", options), null);
  assert.deepEqual(dashboard.splitNextSteps("Done.\n\n**Next steps:**\n1. Accept.\n2. Add a test\n   for small screens."), { summary: "Done.", steps: ["Accept.", "Add a test for small screens."] });
  assert.deepEqual(dashboard.splitNextSteps("No list here."), { summary: "No list here.", steps: null });
});

test("dashboard serve answers only its own host, read-only, and pushes a new snapshot when Foreman writes", async () => {
  const f = buildDashboardHome();
  const server = createDashboardServer({ roots: f.roots, port: 0, pollMs: 50 });
  try {
    await server.listen();
    const port = server.server.address().port;
    const page = await get(port, "/");
    assert.equal(page.status, 200);
    assert.match(page.body, /\/app\/main\.js/);
    const css = await get(port, "/ds/bundle.css");
    assert.equal(css.status, 200);
    assert.doesNotMatch(css.body, /fonts\.googleapis\.com/, "fonts are served locally");
    assert.equal((await get(port, "/fonts/fonts.css")).status, 200);
    assert.equal((await get(port, "/app/../../src/foreman.js")).status, 404);
    assert.equal((await get(port, "/api/snapshot", { host: `evil.example:${port}` })).status, 421);
    assert.equal((await get(port, "/api/snapshot", { method: "POST" })).status, 405);
    const snapshot = await get(port, "/api/snapshot");
    assert.equal(JSON.parse(snapshot.body).tasks.length, 7);
    assert.equal(JSON.parse(snapshot.body).server.bind, "127.0.0.1");

    const before = snapshotTree(f.roots.foremanHome);
    const events = readEvents(port, (snap, all) => all.length > 1 && snap.tasks.find((task) => task.taskId === f.ids.done)?.attention.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(snapshotTree(f.roots.foremanHome), before, "serving never writes the home");
    core.addAttentionPoint({ roots: f.roots, taskId: f.ids.done, owner: "user", kind: "check", text: "Thử trên màn hình nhỏ.", user: true });
    const received = await events;
    assert.equal(received.at(-1).tasks.find((task) => task.taskId === f.ids.done).attention[0].text, "Thử trên màn hình nhỏ.");
  } finally {
    await server.close();
    f.cleanup();
  }
});

test("dashboard serve ends a HEAD request for the event stream and shows a snooze as ended once its time passes", async () => {
  const f = buildDashboardHome();
  let clock = Date.now();
  const server = createDashboardServer({ roots: f.roots, port: 0, pollMs: 50, now: () => clock });
  try {
    await server.listen();
    const port = server.server.address().port;
    const head = await get(port, "/api/events", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");

    const point = core.addAttentionPoint({ roots: f.roots, taskId: f.ids.done, owner: "user", kind: "check", text: "Xem lại sau.", user: true });
    const until = new Date(clock + 60000).toISOString();
    core.snoozeAttentionPoint({ roots: f.roots, taskId: f.ids.done, pointId: point.point.id, until });
    const stateOf = async () => JSON.parse((await get(port, "/api/snapshot")).body).tasks.find((task) => task.taskId === f.ids.done).attention.at(-1).state;
    assert.equal(await stateOf(), "snoozed");
    clock += 120000;
    assert.equal(await stateOf(), "open", "the snapshot is rebuilt although no file changed");
  } finally {
    await server.close();
    f.cleanup();
  }
});

// The browser modules read React from `window`; a stub that keeps elements as plain objects lets them run under Node.
async function importApp(name) {
  globalThis.window ??= { React: { createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }), Fragment: "frag" }, Foreman: {} };
  return import(require("node:url").pathToFileURL(path.join(__dirname, "..", "dashboard", "app", name)).href);
}

function textOf(node) {
  if (node == null || node === false) return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.children);
}

function findAll(node, type, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object") { if (node.type === type) out.push(node); findAll(node.children, type, out); }
  return out;
}

test("dashboard Markdown keeps underscores inside words and escaped pipes inside table cells", async () => {
  const { Markdown } = await importApp("markdown.js");
  const para = Markdown({ text: "See git_log_file.md and a__b__c but _this_ is emphasis." });
  assert.equal(textOf(para), "See git_log_file.md and a__b__c but this is emphasis.");
  assert.deepEqual(findAll(para, "em").map(textOf), ["this"]);
  assert.equal(findAll(para, "strong").length, 0);

  const table = Markdown({ text: "| Check | Result |\n| --- | --- |\n| a\\|b | passed |" });
  assert.deepEqual(findAll(table, "td").map(textOf), ["a|b", "passed"]);
  assert.deepEqual(findAll(table, "th").map(textOf), ["Check", "Result"]);
});

test("dashboard Chờ bạn orders quick ascending and risk descending, with an unmeasured size counted as medium", async () => {
  const { byOrder, reason } = await importApp("inbox.js");
  const task = (id, extra = {}) => ({ taskId: id, type: "build", round: 1, lease: [], attention: [], reviewChange: { files: 1, lines: 0 }, ...extra });
  const item = (t, ms = 0) => ({ id: t.taskId, ms, task: t });
  const ids = (items, order) => items.slice().sort(byOrder(order)).map((i) => i.id);

  const small = task("small"), big = task("big", { reviewChange: { files: 9, lines: 0 } }), unmeasured = task("unmeasured", { reviewChange: null });
  const items = [item(big), item(small), item(unmeasured)];
  assert.deepEqual(ids(items, "quick"), ["small", "unmeasured", "big"]);
  assert.deepEqual(ids(items, "risk"), ["big", "unmeasured", "small"]);

  // Rework, open points, shipped code, write leases, and overlaps each move a task as weighed.
  const rework = task("rework", { round: 3 }), pointed = task("pointed", { attention: [{ state: "open" }] });
  assert.deepEqual(ids([item(pointed), item(rework), item(small)], "quick"), ["small", "pointed", "rework"]);
  const ship = task("ship", { type: "ship" }), writes = task("writes", { lease: [{ mode: "write" }, { mode: "write" }, { mode: "read" }] }), overlap = task("overlap", { leaseOverlap: "T-9" });
  assert.deepEqual(ids([item(small), item(writes), item(ship), item(overlap)], "risk"), ["overlap", "ship", "writes", "small"]);

  // Equal weights fall back to the oldest first, as does the age order.
  const older = item(task("older"), 5000), newer = item(task("newer"), 1000);
  assert.deepEqual(ids([newer, older], "quick"), ["older", "newer"]);
  assert.deepEqual(ids([newer, older], "risk"), ["older", "newer"]);
  assert.deepEqual(ids([item(small, 1), item(big, 9)], "age"), ["big", "small"]);

  // The explanation names every input the order used.
  assert.equal(reason(writes, "risk"), "build · 1 file · 0 dòng · 2 lease ghi");
  assert.equal(reason(writes, "quick"), "1 file · 0 dòng");
  assert.equal(reason(unmeasured, "quick"), "chưa đo cỡ, tính như review vừa");
});
