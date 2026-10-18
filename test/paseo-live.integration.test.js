const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const { PaseoAdapter } = require("../src/paseo");
const { syncPaseoProfiles } = require("../src/paseo-routing");
const { readSupervision } = require("../src/supervision");

const enabled = process.env.RUN_PASEO_LIVE === "1";
const paseoCommand = process.env.FOREMAN_PASEO_COMMAND || "paseo";
const sourceRoot = path.resolve(__dirname, "..");

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

// A solid-colour PNG: small, valid, and unambiguous for a vision model to name.
function solidPng(r, g, b, size = 64) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Starts an isolated Paseo daemon and a Foreman home with one fixture project; `run` gets the live pieces.
async function withLiveFixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-paseo-live-"));
  const paseoHome = path.join(base, "paseo-home");
  const foremanHome = path.join(base, "foreman-home");
  const projectRoot = path.join(base, "project");
  const foremanRoot = path.join(base, "foreman-root");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "paseo-live@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman Paseo Live"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "Paseo live integration fixture.\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "ignore" });
  fs.mkdirSync(path.join(foremanRoot, "config"), { recursive: true });
  for (const file of ["model-routing.json", "paseo-agent-profiles.json"]) fs.copyFileSync(path.join(sourceRoot, "config", file), path.join(foremanRoot, "config", file));
  const routingFile = path.join(foremanRoot, "config", "model-routing.json");
  const routing = JSON.parse(fs.readFileSync(routingFile, "utf8"));
  routing.default = "claude-sonnet";
  for (const profile of Object.values(routing.profiles)) profile.isActive = true;
  fs.writeFileSync(routingFile, `${JSON.stringify(routing, null, 2)}\n`);

  const env = { ...process.env, FOREMAN_PASEO_HOME: paseoHome, FOREMAN_PASEO_COMMAND: paseoCommand };
  const priorPaseoHome = process.env.FOREMAN_PASEO_HOME;
  const priorPaseoCommand = process.env.FOREMAN_PASEO_COMMAND;
  let daemonStarted = false;
  const fixture = { roots: core.resolveRoots({ foremanRoot, foremanHome }), projectRoot, paseoHome, env, adapter: null, assigned: null, agents: [] };
  try {
    fs.mkdirSync(paseoHome, { recursive: true });
    const port = await freePort();
    paseo(["daemon", "config", "set", "daemon.listen", `127.0.0.1:${port}`, "--home", paseoHome], env);
    paseo(["daemon", "start", "--home", paseoHome, "--timeout", "30"], env);
    daemonStarted = true;
    assert.equal(JSON.parse(paseo(["daemon", "status", "--json", "--home", paseoHome], env)).connectedDaemon, "reachable");

    core.initHome(fixture.roots);
    core.registerProject({ roots: fixture.roots, id: "paseo-live", root: projectRoot });
    const profileSync = syncPaseoProfiles({ foremanRoot, commandOptions: { command: paseoCommand, env } });
    assert.equal(profileSync.changed, true);
    process.env.FOREMAN_PASEO_HOME = paseoHome;
    process.env.FOREMAN_PASEO_COMMAND = paseoCommand;
    fixture.adapter = new PaseoAdapter({ timeoutMs: 30000 });
    await run(fixture);
  } finally {
    if (fixture.assigned && fixture.adapter) {
      try { fixture.adapter.stop(fixture.assigned.endpoint); } catch (_) {}
    }
    for (const agent of fixture.agents) {
      try { fixture.adapter.stop(agent); } catch (_) {}
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
}

// Collects until the task reaches `review-ready` (or blocks), failing fast on report problems.
async function waitForReport({ roots, adapter }, taskId, round = 1) {
  const deadline = Date.now() + 210000;
  let collection;
  while (Date.now() < deadline) {
    collection = core.collectPaseoReports({ roots, adapter });
    const meta = core.reconstructTask({ roots, taskId }).meta;
    if (["review-ready", "blocked"].includes(meta.status)) return meta;
    if (meta.paseoReportError || collection.tasks.some((item) => ["unavailable", "gap", "report-invalid"].includes(item.state))) {
      const invalidResponse = meta.paseoReportError?.file && fs.existsSync(meta.paseoReportError.file) ? fs.readFileSync(meta.paseoReportError.file, "utf8") : null;
      throw new Error(JSON.stringify({ round, collection, invalidResponse }));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Round ${round} did not report in time: ${JSON.stringify(collection)}`);
}

test("isolated Paseo daemon runs a scout through report collection, status, and acceptance", { skip: !enabled, timeout: 300000 }, async () => {
  await withLiveFixture(async (f) => {
    const { roots, adapter } = f;
    const task = core.createTask({
      roots,
      projectId: "paseo-live",
      type: "scout",
      backend: "paseo",
      brief: "Read only README.md in this temporary project, do not edit any file, and report a short observation using Foreman's required JSON report format.",
      routingRunner: () => ({ profile: "claude-sonnet", reason: "Use the configured test profile." }),
    });
    core.confirmTaskProfile({ roots, taskId: task.id, profile: "claude-sonnet" });
    f.assigned = core.assignTask({ roots, taskId: task.id, adapter });
    assert.equal(f.assigned.backend, "paseo");
    assert.ok(f.assigned.workspaceId);

    await waitForReport(f, task.id);
    const completed = core.reconstructTask({ roots, taskId: task.id });
    assert.equal(completed.meta.status, "review-ready");
    assert.match(completed.report, /"status"\s*:\s*"done"/);
    const status = core.fleetStatus({ roots, adapter });
    assert.equal(status.tasks.find((item) => item.taskId === task.id).meta.status, "review-ready");
    const accepted = core.acceptTask({ roots, taskId: task.id, adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(accepted.workerStopped, true);
    assert.deepEqual(core.listResourceLeases({ roots }), []);
    f.assigned = null;
  });
});

test("images reach a live Paseo worker in round one, a continued round, a message, and a replacement worker", { skip: !enabled, timeout: 600000 }, async () => {
  await withLiveFixture(async (f) => {
    const { roots, adapter } = f;
    const ask = "Look at the attached image, do not edit any file, and put the single dominant color name of the image (lowercase English, one word) in the report summary.";
    const task = core.createTask({
      roots,
      projectId: "paseo-live",
      type: "scout",
      backend: "paseo",
      brief: ask,
      images: [{ buffer: solidPng(255, 0, 0) }],
      routingRunner: () => ({ profile: "claude-sonnet", reason: "Use the configured test profile." }),
    });
    core.confirmTaskProfile({ roots, taskId: task.id, profile: "claude-sonnet" });
    f.assigned = core.assignTask({ roots, taskId: task.id, adapter });
    const copy = path.join(f.projectRoot, ".foreman", "attachments", task.id, `${task.attachments[0].id}.png`);
    assert.ok(fs.existsSync(copy), "the worker-visible copy was not written");
    assert.equal(execFileSync("git", ["-C", f.projectRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }), "");

    await waitForReport(f, task.id, 1);
    assert.match(core.reconstructTask({ roots, taskId: task.id }).report, /red/i, "round one did not describe the red image");

    core.continueTask({ roots, taskId: task.id, text: ask, original: "same question, new image", adapter, images: [{ buffer: solidPng(0, 0, 255) }] });
    await waitForReport(f, task.id, 2);
    assert.match(core.reconstructTask({ roots, taskId: task.id }).report, /blue/i, "the continued round did not describe the blue image");

    core.sendWorkerMessage({ roots, taskId: task.id, payload: { request: "Same question again for the attached image; report it as a new report." }, adapter, images: [{ buffer: solidPng(0, 200, 0) }] });
    await waitForReport(f, task.id, 3);
    assert.match(core.reconstructTask({ roots, taskId: task.id }).report, /green/i, "the message image was not described");

    const reassigned = core.reassignWorker({ roots, taskId: task.id, adapter, text: ask, original: "same question for a replacement worker", images: [{ buffer: solidPng(255, 255, 0) }] });
    f.assigned = reassigned.assignment || reassigned;
    await waitForReport(f, task.id, 4);
    assert.match(core.reconstructTask({ roots, taskId: task.id }).report, /yellow/i, "the replacement worker did not describe the new image");

    const accepted = core.acceptTask({ roots, taskId: task.id, adapter });
    assert.equal(accepted.deleted, true);
    assert.equal(accepted.imageCleanupError, undefined);
    assert.equal(fs.existsSync(path.join(f.projectRoot, ".foreman")), false, "accept left worker-visible images behind");
    f.assigned = null;
  });
});

async function waitFor(check, label, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// The Foreman agent runs in this checkout, so its Claude Code prompt hook is the repository's session-context hook.
test("a Paseo heartbeat wakes a real Foreman agent whose prompt hook collects the worker report without prompting the worker", { skip: !enabled, timeout: 1200000 }, async (t) => {
  await withLiveFixture(async (f) => {
    const { roots, adapter } = f;
    const task = core.createTask({
      roots, projectId: "paseo-live", type: "scout", backend: "paseo",
      brief: "Read only README.md in this temporary project, do not edit any file, and report its first line using Foreman's required JSON report format.",
      routingRunner: () => ({ profile: "claude-sonnet", reason: "Use the configured test profile." }),
    });
    core.confirmTaskProfile({ roots, taskId: task.id, profile: "claude-sonnet" });
    f.assigned = core.assignTask({ roots, taskId: task.id, adapter });

    // `init` in the agent must not rewrite the user's shell startup file.
    const foremanEnv = [`FOREMAN_ROOT=${sourceRoot}`, `FOREMAN_HOME=${roots.foremanHome}`, "FOREMAN_BACKEND=paseo", `FOREMAN_PASEO_HOME=${f.paseoHome}`, `FOREMAN_PASEO_COMMAND=${paseoCommand}`, `FOREMAN_SHELL_RC=${path.join(path.dirname(f.paseoHome), "shell-rc")}`];
    const created = JSON.parse(paseo(["run", "-d", "--json", "--provider", "claude", "--model", process.env.FOREMAN_LIVE_FOREMAN_MODEL || "claude-sonnet-5-5", "--mode", "bypassPermissions",
      "--cwd", sourceRoot, "--title", "foreman-heartbeat-live", ...foremanEnv.flatMap((entry) => ["--env", entry]), "--home", f.paseoHome,
      "DEV live heartbeat fixture: reply with the single word READY and do nothing else."], f.env));
    const foremanAgent = created.agentId;
    f.agents.push(foremanAgent);
    await waitFor(() => !adapter.inspect(foremanAgent).activeTurn, "the Foreman agent to finish its first turn");

    const sync = core.syncHeartbeat({ roots, adapter, agentId: foremanAgent, cron: "* * * * *" });
    assert.equal(sync.action, "created");
    const heartbeatId = sync.heartbeatId;
    assert.equal(core.syncHeartbeat({ roots, adapter, agentId: foremanAgent }).action, "none", "no duplicate heartbeat");

    // This test process never collects: the heartbeat turn's prompt hook must.
    const reviewReady = await waitFor(() => {
      const meta = core.reconstructTask({ roots, taskId: task.id }).meta;
      return meta.status === "review-ready" ? meta : null;
    }, "the heartbeat-triggered hook to collect the worker report", 600000);
    assert.ok(readSupervision(roots.foremanHome).heartbeat.lastFiredAt, "the hook recognized Foreman's heartbeat");
    assert.equal(core.listMessages({ roots }).filter((message) => message.taskId === task.id).length, 1, "the worker received only its brief");

    const key = `${task.id}/review-ready/${path.basename(reviewReady.completionReport)}`;
    await waitFor(() => core.reconstructTask({ roots, taskId: task.id }).meta.notified?.[key], "the Foreman agent to record that it told the result", 300000);

    // With nothing watched and nothing untold, the acknowledgement (or else the next heartbeat turn's hook) deletes the heartbeat.
    await waitFor(() => readSupervision(roots.foremanHome).heartbeat === null, "the heartbeat to stop", 300000);
    assert.throws(() => paseo(["heartbeat", "update", heartbeatId, "--cron", "* * * * *", "--json", "--home", f.paseoHome], { ...f.env, PASEO_AGENT_ID: foremanAgent }), /not found/i);
    await waitFor(() => !adapter.inspect(foremanAgent).activeTurn, "the last heartbeat turn to finish");

    const timeline = paseo(["logs", foremanAgent, "--home", f.paseoHome], f.env);
    const foremanView = adapter.inspect(foremanAgent);
    t.diagnostic(`Foreman agent after the quiet heartbeat turn: requiresAttention=${foremanView.requiresAttention} attentionReason=${foremanView.attentionReason}`);
    t.diagnostic(`Foreman agent timeline tail:\n${timeline.split("\n").slice(-25).join("\n")}`);
    assert.match(timeline, new RegExp(task.id), "the Foreman agent told the user about the review-ready task");
    assert.doesNotMatch(timeline.split(task.id).slice(-1)[0], /heartbeat/i, "the agent did not narrate heartbeat housekeeping to the user");
    assert.equal(core.reconstructTask({ roots, taskId: task.id }).meta.status, "review-ready", "the heartbeat did not accept the task");

    const accepted = core.acceptTask({ roots, taskId: task.id, adapter });
    assert.equal(accepted.deleted, true);
    f.assigned = null;
  });
});
