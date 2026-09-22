const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordPackage,
  acceptTask, markLanded, releaseEndpoint, cleanupTask,
  listMessages, acknowledgeTaskMessage,
} = require("../src/foreman");
const { HerdrAdapter, HerdrCliTransport } = require("../src/herdr");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("live Herdr runtime dispatches a real worker and lands its artifact", { timeout: 180000, skip: process.env.RUN_HERDR_LIVE !== "1" ? "set RUN_HERDR_LIVE=1 to run against the installed Herdr daemon" : false }, async () => {
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
    registerProject({ roots, id: "live", root: project, defaultBranch: "main" });
    const owner = `liveworker${process.pid}`.slice(0, 30).replace(/[^a-z0-9_-]/g, "");
    adapter = new HerdrAdapter({ transport: new HerdrCliTransport({ command: "herdr", agentKind: process.env.FOREMAN_AGENT_KIND || "codex" }) });
    assert.equal(adapter.verifyCompatibility(), true);
    const task = createTask({ roots, projectId: "live", brief: "Create file/live-artifact.txt in the current workspace with exactly one line: foreman-live-ok. Do not commit, switch branches, reset, clean, merge, or edit any other file. After the file exists, stop and report completion." });
    assignment = assignTask({ roots, taskId: task.id, owner, adapter, resources: [{ key: "file/live-artifact.txt", mode: "write" }] });
    const brief = listMessages({ roots }).find((message) => message.messageId === assignment.briefMessageId);
    acknowledgeTaskMessage({ roots, taskId: task.id, messageId: brief.messageId, ack: { payloadDigest: brief.payloadDigest } });
    assert.equal(assignment.owner, owner);
    assert.equal(assignment.workspace, project);

    const deadline = Date.now() + 120000;
    let status = "unknown";
    while (Date.now() < deadline) {
      const inspection = adapter.inspect(assignment.endpoint);
      status = inspection.status;
      if (fs.existsSync(path.join(project, "file", "live-artifact.txt"))) break;
      if (["dead", "missing"].includes(status)) break;
      await wait(2000);
    }
    assert.equal(status === "dead" || status === "missing", false, `live worker exited before producing artifact: ${status}`);
    assert.equal(fs.readFileSync(path.join(project, "file", "live-artifact.txt"), "utf8"), "foreman-live-ok\n");
    const report = [`TASK: ${task.id}`, `PROJECT: live`, `AGENT: ${owner}`, `GENERATION: ${assignment.generation}`, "TYPE: completion", "", `Live Herdr status: ${adapter.inspect(assignment.endpoint).status}`, "Artifact exists in the bound workspace."].join("\n");
    recordPackage({ roots, taskId: task.id, raw: report, type: "completion" });
    acceptTask({ roots, taskId: task.id });
    execFileSync("git", ["-C", project, "add", "file/live-artifact.txt"]);
    execFileSync("git", ["-C", project, "commit", "-m", "live worker artifact"], { stdio: "pipe" });
    const commit = execFileSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    markLanded({ roots, taskId: task.id, evidence: { target: "local-only", commit, workspace: project } });
    releaseEndpoint({ roots, taskId: task.id, adapter });
    assert.equal(cleanupTask({ roots, taskId: task.id, workspaceReleased: true }), true);
    assert.equal(execFileSync("git", ["-C", project, "status", "--porcelain"], { encoding: "utf8" }), "");
  } finally {
    if (assignment && adapter) {
      try { releaseEndpoint({ roots: resolveRoots({ foremanRoot: project, foremanHome: home }), taskId: assignment.taskId, adapter }); } catch (_) {}
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
});
