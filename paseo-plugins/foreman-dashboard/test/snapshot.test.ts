import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotStore, runSummaryCommand } from "../server/snapshot";
import { orderTasks, taskStamp, STAMP_LABEL } from "../shared/status";

const repo = path.resolve(__dirname, "../../..");

function makeHome(statuses: Record<string, Record<string, unknown>>) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-dash-")));
  for (const [taskId, extra] of Object.entries(statuses)) writeTask(home, taskId, extra);
  return home;
}
function writeTask(home: string, taskId: string, extra: Record<string, unknown>) {
  const dir = path.join(home, "data", "tasks", taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ schemaVersion: 1, taskId, projectId: "app", generation: 0, type: "ship", dependencies: [], resources: [], status: "queued", ...extra }));
  fs.writeFileSync(path.join(dir, "brief.md"), `Title ${taskId}\nsecret body\n`);
}
const summary = JSON.stringify({ tasks: [], skipped: [] });
function store(home: string | null, runs: { count: number }, clock: { now: number }, run = async () => { runs.count += 1; return summary; }) {
  return new SnapshotStore({
    readConfig: async () => (home === null ? null : { foremanRoot: repo, foremanHome: home }),
    runSummary: run,
    now: () => clock.now,
    minIntervalMs: 3000,
  });
}

test("unconfigured and missing homes show a setup message and create nothing", async () => {
  const runs = { count: 0 }; const clock = { now: 1_000 };
  assert.equal((await store(null, runs, clock).get()).state, "unconfigured");
  const missing = path.join(os.tmpdir(), `foreman-dash-missing-${process.pid}`);
  const snapshot = await store(missing, runs, clock).get();
  assert.equal(snapshot.state, "missing-home");
  assert.equal(fs.existsSync(missing), false);
  assert.equal(runs.count, 0);
});

test("no change spawns nothing; one change causes one summary run", async () => {
  const home = makeHome({ "T-000001": {} });
  const runs = { count: 0 }; const clock = { now: 1_000 };
  const s = store(home, runs, clock);
  await s.get();
  assert.equal(runs.count, 1);
  // Within the interval, and after it with no change: memory only.
  await s.get(); clock.now += 10_000; await s.get(); s.markDirty(); await s.get();
  assert.equal(runs.count, 1);
  // A Foreman write changes meta.json: exactly one more run, however many fetches follow.
  await new Promise((resolve) => setTimeout(resolve, 20));
  writeTask(home, "T-000001", { status: "working" });
  clock.now += 10_000;
  await Promise.all([s.get(), s.get(), s.get()]);
  await s.get();
  assert.equal(runs.count, 2);
});

test("a failing summary is reported once per change, not retried on every fetch", async () => {
  const home = makeHome({ "T-000001": {} });
  const runs = { count: 0 }; const clock = { now: 1_000 };
  const s = store(home, runs, clock, async () => { runs.count += 1; throw new Error("boom"); });
  assert.equal((await s.get()).state, "error");
  clock.now += 10_000;
  assert.equal((await s.get()).state, "error");
  assert.equal(runs.count, 1);
});

test("stamps from the real summary command match renderUserReport for the same home", async () => {
  const home = makeHome({
    "T-000001": { status: "review-ready", owner: "w" },
    "T-000002": { status: "waiting-decision", owner: "w" },
    "T-000003": { status: "blocked", owner: "w" },
    "T-000004": { status: "queued", routingProfile: "codex-luna" },
    "T-000005": { status: "working", owner: "w", endpoint: "a", dispatchProfile: { name: "claude-opus" } },
    "T-000006": { status: "routing" },
    "T-000007": { status: "accepted" },
  });
  const before = fs.readdirSync(path.join(home, "data", "tasks"));
  const out = JSON.parse(await runSummaryCommand({ foremanRoot: repo, foremanHome: home }));
  assert.deepEqual(fs.readdirSync(home), ["data"]);
  assert.deepEqual(fs.readdirSync(path.join(home, "data", "tasks")), before);
  const ordered = orderTasks(out.tasks);
  assert.deepEqual(ordered.map((t: { taskId: string }) => t.taskId), ["T-000003", "T-000002", "T-000001", "T-000004", "T-000005", "T-000006"]);
  const report = execFileSync("node", ["-e", `
    const core = require(${JSON.stringify(path.join(repo, "src/foreman.js"))});
    const roots = { foremanHome: ${JSON.stringify(home)} };
    const tasks = core.taskSummaries({ roots }).tasks.map((t) => ({ taskId: t.taskId, meta: { taskId: t.taskId, status: t.status, routingProfile: t.routingProfile, endpoint: t.endpoint, profileConfirmedAt: null } }));
    process.stdout.write(core.renderUserReport({ tasks }, roots));
  `], { encoding: "utf8" });
  const group = (heading: string) => [...(report.split(`### ${heading}\n`)[1]?.split("\n\n")[0].matchAll(/`(T-\d+)`/g) ?? [])].map((m) => m[1]);
  const byStamp = (stamp: string) => ordered.filter((t) => taskStamp(t) === stamp).map((t) => t.taskId);
  assert.deepEqual(group("Cần bạn duyệt"), byStamp("review"));
  assert.deepEqual(group("Cần bạn quyết").sort(), [...byStamp("decide"), ...byStamp("blocked")].sort());
  assert.deepEqual(group("Cần bạn chọn model"), byStamp("choose-model"));
  assert.equal(STAMP_LABEL[taskStamp(ordered[0])], "Bị chặn");
});

test("the server module never uses mutating, runtime or lock APIs", () => {
  const files = ["../index.server.ts", "../server/snapshot.ts"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");
  for (const forbidden of [/server\.before\(/, /\.send\(/, /\.archive\(/, /respondToPermission/, /timeline/i, /\.run\(/, /"status"\s*,/, /"collect"/, /HomeLock|\.lock/, /ctx\.paseo|context\.paseo|\{ paseo/]) {
    assert.doesNotMatch(files, forbidden, String(forbidden));
  }
  assert.match(files, /"task", "list", "--json", "--summary"/);
});
