const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");

function writeTask(home, taskId, meta, { brief = "Brief line\nsecret second line\n", rounds = {} } = {}) {
  const dir = path.join(home, "data", "tasks", taskId);
  fs.mkdirSync(path.join(dir, "rounds"), { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ schemaVersion: 1, taskId, projectId: "app", generation: 0, type: "ship", dependencies: [], resources: [], status: "queued", ...meta }));
  fs.writeFileSync(path.join(dir, "brief.md"), brief);
  for (const [round, record] of Object.entries(rounds)) {
    fs.writeFileSync(path.join(dir, "rounds", `round-${String(round).padStart(3, "0")}.json`), JSON.stringify({ schemaVersion: 1, taskId, round: Number(round), original: "o", ...record }));
  }
}

function snapshotTree(dir) {
  const out = {};
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      if (fs.statSync(file).isDirectory()) walk(file); else out[path.relative(dir, file)] = fs.readFileSync(file, "utf8");
    }
  };
  walk(dir);
  return out;
}

function fixtureHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-summary-")));
  writeTask(home, "T-000001", { status: "review-ready", owner: "w1", endpoint: "agent-1", backend: "paseo", dispatchProfile: { name: "claude-sonnet" } });
  writeTask(home, "T-000002", { status: "queued", routingProfile: "codex-luna" });
  writeTask(home, "T-000003", { status: "working", round: 2, owner: "w2", endpoint: "pane", dispatchProfile: { name: "claude-opus" } }, { rounds: { 2: { status: "delivered", sent: "Second round line\nmore", original: "User round two" } } });
  writeTask(home, "T-000004", { status: "accepted" });
  writeTask(home, "T-000005", { status: "blocked", owner: "w3" });
  // Legacy record without a schema version: must be shown without being migrated.
  const legacy = path.join(home, "data", "tasks", "T-000006");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "meta.json"), JSON.stringify({ taskId: "T-000006", projectId: "app", generation: 0, type: "scout", status: "pending" }));
  fs.writeFileSync(path.join(legacy, "brief.md"), "Legacy brief\n");
  // Malformed record must be skipped and reported.
  const broken = path.join(home, "data", "tasks", "T-000007");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "meta.json"), "{not json");
  return home;
}

test("taskSummaries lists non-accepted tasks, skips malformed ones and leaves the home byte-identical", () => {
  const home = fixtureHome();
  const before = snapshotTree(home);
  const { tasks, skipped } = core.taskSummaries({ roots: { foremanHome: home } });
  assert.deepEqual(snapshotTree(home), before);
  assert.deepEqual(tasks.map((task) => task.taskId), ["T-000001", "T-000002", "T-000003", "T-000005", "T-000006"]);
  assert.deepEqual(skipped.map((item) => item.taskId), ["T-000007"]);
  const byId = Object.fromEntries(tasks.map((task) => [task.taskId, task]));
  assert.equal(byId["T-000001"].title, "Brief line");
  assert.equal(byId["T-000001"].profile, "claude-sonnet");
  assert.equal(byId["T-000001"].endpoint, "agent-1");
  assert.equal(byId["T-000002"].needsProfileConfirmation, true);
  assert.equal(byId["T-000002"].routingProfile, "codex-luna");
  assert.equal(byId["T-000003"].title, "(vòng 2) Second round line");
  assert.equal(byId["T-000003"].round, 2);
  assert.deepEqual(byId["T-000003"].rounds, [{ round: 2, text: "User round two" }]);
  assert.equal(byId["T-000001"].brief, "Brief line\nsecret second line\n");
  assert.equal(byId["T-000006"].status, "pending");
  assert.equal(byId["T-000006"].backend, "herdr");
});

test("taskSummaries on a missing home returns nothing and creates nothing", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-summary-missing-"));
  const home = path.join(base, "nope");
  assert.deepEqual(core.taskSummaries({ roots: { foremanHome: home } }), { tasks: [], skipped: [] });
  assert.equal(fs.existsSync(home), false);
});

test("task list --json --summary does not initialize an empty or missing home", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-summary-cli-")));
  const missing = path.join(base, "missing");
  const out = execFileSync(process.execPath, [path.join(__dirname, "../bin/foreman"), "task", "list", "--json", "--summary"], { env: { ...process.env, FOREMAN_HOME: missing, FOREMAN_ROOT: missing }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), { tasks: [], skipped: [] });
  assert.equal(fs.existsSync(missing), false);
  const home = fixtureHome();
  const before = snapshotTree(home);
  const listed = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "../bin/foreman"), "task", "list", "--json", "--summary"], { env: { ...process.env, FOREMAN_HOME: home }, encoding: "utf8" }));
  assert.equal(listed.tasks.length, 5);
  assert.deepEqual(snapshotTree(home), before);
});
