const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const { PaseoAdapter } = require("../src/paseo");
const { syncPaseoProfiles } = require("../src/paseo-routing");

const enabled = process.env.RUN_PASEO_LIVE === "1";
const paseoCommand = process.env.FOREMAN_PASEO_COMMAND || "paseo";
const foremanRoot = path.resolve(__dirname, "..");

function paseo(args, env) {
  return execFileSync(paseoCommand, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("isolated Paseo daemon runs a scout through report collection, status, and acceptance", { skip: !enabled, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-paseo-live-"));
  const paseoHome = path.join(base, "paseo-home");
  const foremanHome = path.join(base, "foreman-home");
  const projectRoot = path.join(base, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "paseo-live@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman Paseo Live"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "Paseo live integration fixture.\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "ignore" });

  const env = { ...process.env, FOREMAN_PASEO_HOME: paseoHome, FOREMAN_PASEO_COMMAND: paseoCommand };
  const priorPaseoHome = process.env.FOREMAN_PASEO_HOME;
  const priorPaseoCommand = process.env.FOREMAN_PASEO_COMMAND;
  let daemonStarted = false;
  let adapter;
  let assigned;
  const roots = core.resolveRoots({ foremanRoot, foremanHome });
  try {
    fs.mkdirSync(paseoHome, { recursive: true });
    const port = await freePort();
    paseo(["daemon", "config", "set", "daemon.listen", `127.0.0.1:${port}`, "--home", paseoHome], env);
    paseo(["daemon", "start", "--home", paseoHome, "--timeout", "30"], env);
    daemonStarted = true;
    assert.equal(JSON.parse(paseo(["daemon", "status", "--json", "--home", paseoHome], env)).connectedDaemon, "reachable");

    core.initHome(roots);
    core.registerProject({ roots, id: "paseo-live", root: projectRoot });
    const profileSync = syncPaseoProfiles({ foremanRoot, commandOptions: { command: paseoCommand, env } });
    assert.equal(profileSync.changed, true);
    process.env.FOREMAN_PASEO_HOME = paseoHome;
    process.env.FOREMAN_PASEO_COMMAND = paseoCommand;
    adapter = new PaseoAdapter({ timeoutMs: 30000 });

    const task = core.createTask({
      roots,
      projectId: "paseo-live",
      type: "scout",
      backend: "paseo",
      brief: "Read only README.md in this temporary project, do not edit any file, and report a short observation using Foreman's required JSON report format.",
      routingRunner: () => ({ profile: "foreman-codex-luna", reason: "Use the configured test profile." }),
    });
    core.confirmTaskProfile({ roots, taskId: task.id, profile: "foreman-codex-luna" });
    assigned = core.assignTask({ roots, taskId: task.id, adapter });
    assert.equal(assigned.backend, "paseo");
    assert.ok(assigned.workspaceId);

    const deadline = Date.now() + 210000;
    let collection;
    while (Date.now() < deadline) {
      collection = core.collectPaseoReports({ roots, adapter });
      const meta = core.reconstructTask({ roots, taskId: task.id }).meta;
      if (["review-ready", "blocked"].includes(meta.status)) break;
      if (meta.paseoReportError || collection.tasks.some((item) => ["unavailable", "gap", "report-invalid"].includes(item.state))) {
        const invalidResponse = meta.paseoReportError?.file && fs.existsSync(meta.paseoReportError.file) ? fs.readFileSync(meta.paseoReportError.file, "utf8") : null;
        throw new Error(JSON.stringify({ collection, invalidResponse }));
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const completed = core.reconstructTask({ roots, taskId: task.id });
    assert.equal(completed.meta.status, "review-ready", JSON.stringify(collection));
    assert.match(completed.report, /"status"\s*:\s*"done"/);
    const status = core.fleetStatus({ roots, adapter });
    assert.equal(status.tasks.find((item) => item.taskId === task.id).meta.status, "review-ready");
    const accepted = core.acceptTask({ roots, taskId: task.id, adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(accepted.workerStopped, true);
    assert.deepEqual(core.listResourceLeases({ roots }), []);
    assigned = null;
  } finally {
    if (assigned && adapter) {
      try { adapter.stop(assigned.endpoint); } catch (_) {}
    }
    if (daemonStarted) {
      try { paseo(["daemon", "stop", "--home", paseoHome, "--timeout", "10"], env); } catch (_) {}
    }
    if (priorPaseoHome === undefined) delete process.env.FOREMAN_PASEO_HOME;
    else process.env.FOREMAN_PASEO_HOME = priorPaseoHome;
    if (priorPaseoCommand === undefined) delete process.env.FOREMAN_PASEO_COMMAND;
    else process.env.FOREMAN_PASEO_COMMAND = priorPaseoCommand;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
