const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, acceptTask,
} = require("../src/foreman");
const { HerdrAdapter, HerdrCliTransport } = require("../src/herdr");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readMeta = (home, taskId) => JSON.parse(fs.readFileSync(path.join(home, "data", "tasks", taskId, "meta.json"), "utf8"));
// The worker's shell may carry another Foreman home, so the report command pins this test's home.
const reportCommand = (roots, status) => `FOREMAN_ROOT=${roots.foremanRoot} FOREMAN_HOME=${roots.foremanHome} ${path.join(__dirname, "..", "bin", "foreman")} report --status ${status} --summary`;

test("live Herdr runtime dispatches a real worker and acceptance removes its task records", { timeout: 180000, skip: process.env.RUN_HERDR_LIVE !== "1" ? "set RUN_HERDR_LIVE=1 to run against the installed Herdr daemon" : false }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-herdr-live-"));
  const project = path.join(base, "project");
  const home = path.join(base, "home");
  let assignment;
  let adapter;
  try {
    fs.mkdirSync(project, { recursive: true });
    execFileSync("git", ["init", "-b", "main", project], { stdio: "pipe" });
    execFileSync("git", ["-C", project, "config", "user.email", "live@example.invalid"]);
    execFileSync("git", ["-C", project, "config", "user.name", "Foreman Live Runtime"]);
    fs.writeFileSync(path.join(project, "README.md"), "live fixture\n");
    execFileSync("git", ["-C", project, "add", "README.md"]);
    execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "pipe" });

    const roots = resolveRoots({ foremanRoot: project, foremanHome: home });
    initHome(roots);
    registerProject({ roots, id: "live", root: project });
    const owner = `liveworker${process.pid}`.slice(0, 30).replace(/[^a-z0-9_-]/g, "");
    adapter = new HerdrAdapter({ transport: new HerdrCliTransport({ command: "herdr", agentKind: process.env.FOREMAN_AGENT_KIND || "codex" }) });
    assert.equal(adapter.verifyCompatibility(), true);
    const task = createTask({ roots, projectId: "live", brief: `Create file/live-artifact.txt in the current workspace with exactly one line: foreman-live-ok. Then run this command exactly once: ${reportCommand(roots, "done")} "artifact created". Do not commit, switch branches, reset, clean, merge, or edit any other file.` });
    assignment = assignTask({ roots, taskId: task.id, owner, adapter, resources: [{ key: "file/live-artifact.txt", mode: "write" }] });
    assert.equal(assignment.owner, owner);
    assert.equal(assignment.workspace, fs.realpathSync(project));

    assert.ok(assignment.paneId, "Herdr spawn did not return the worker pane");
    const deadline = Date.now() + 120000;
    let status = "unknown";
    while (Date.now() < deadline) {
      status = adapter.inspect(assignment.endpoint).status;
      if (readMeta(home, task.id).status === "review-ready") break;
      if (["dead", "missing"].includes(status)) break;
      await wait(2000);
    }
    assert.equal(status === "dead" || status === "missing", false, `live worker exited before reporting: ${status}`);
    assert.equal(readMeta(home, task.id).status, "review-ready", "live worker did not report through its pane identity");
    assert.equal(fs.readFileSync(path.join(project, "file", "live-artifact.txt"), "utf8"), "foreman-live-ok\n");
    const accepted = acceptTask({ roots, taskId: task.id, adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(accepted.workspaceRetained, fs.realpathSync(project));
    assert.equal(fs.existsSync(path.join(home, "data", "tasks", task.id)), false);
    assert.equal(fs.existsSync(path.join(home, "data", "tasks", task.id)), false);
    assert.notEqual(execFileSync("git", ["-C", project, "status", "--porcelain"], { encoding: "utf8" }), "");
  } finally {
    if (assignment && adapter) {
      try { adapter.stop(assignment.endpoint); } catch (_) {}
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("live scout reports from the current repository workspace without editing it", { timeout: 180000, skip: process.env.RUN_HERDR_LIVE !== "1" ? "set RUN_HERDR_LIVE=1 to run against the installed Herdr daemon" : false }, async () => {
  const project = fs.realpathSync(path.join(__dirname, ".."));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-herdr-connect-"));
  const roots = resolveRoots({ foremanRoot: project, foremanHome: home });
  const owner = `connectworker${process.pid}`.slice(0, 30).replace(/[^a-z0-9_-]/g, "");
  const adapter = new HerdrAdapter({ transport: new HerdrCliTransport({ command: "herdr", agentKind: process.env.FOREMAN_AGENT_KIND || "codex" }) });
  const before = execFileSync("git", ["-C", project, "status", "--porcelain"], { encoding: "utf8" });
  let assignment;
  try {
    initHome(roots);
    registerProject({ roots, id: "foreman", root: project });
    const task = createTask({ roots, projectId: "foreman", type: "scout", brief: `Do not modify any repository file. Run this command exactly once, then stop: ${reportCommand(roots, "done")} "scout connected".` });
    assignment = assignTask({ roots, taskId: task.id, owner, adapter, resources: [{ key: "workspace/foreman", mode: "read" }] });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (readMeta(home, task.id).status === "review-ready") break;
      const status = adapter.inspect(assignment.endpoint).status;
      if (["dead", "missing"].includes(status)) break;
      await wait(2000);
    }
    assert.equal(readMeta(home, task.id).status, "review-ready", "current-workspace scout did not report");
    assert.equal(execFileSync("git", ["-C", project, "status", "--porcelain"], { encoding: "utf8" }), before);
  } finally {
    if (assignment) {
      try { adapter.stop(assignment.endpoint); } catch (_) {}
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});
