const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { HerdrAdapter, HerdrCliTransport, HerdrCompatibilityError } = require("../src/herdr");
const { loadRoutingConfig } = require("../src/foreman");

function fakeHerdr({ version = "0.9.1", protocol = 22, endpointGeneration = 1, agentHelp, paneHelp } = {}) {
  const calls = [];
  let agentStatus = "working";
  const runner = (args) => {
    calls.push(args);
    if (args.join(" ") === "status client --json") return JSON.stringify({ version, protocol, endpoint_protocol_generation: endpointGeneration });
    if (args.join(" ") === "status server --json") return JSON.stringify({ running: true, compatible: true, endpoint_compatible: true, private_protocol_compatible: true, capabilities: { endpoint_protocol_generation: endpointGeneration } });
    if (args.join(" ") === "agent --help") return agentHelp || "herdr agent start\nherdr agent list\nherdr agent prompt\nherdr agent read\nherdr agent send-keys\n";
    if (args.join(" ") === "pane --help") return paneHelp || "herdr pane split\nherdr pane close\nherdr pane process-info\nherdr pane send-keys\nherdr pane read\n";
    if (args.join(" ") === "pane split --current --direction right --cwd /tmp/worktree --no-focus") return JSON.stringify({ result: { pane: { pane_id: "w1:p2" } } });
    if (args.join(" ") === "pane process-info --pane w1:p2") return JSON.stringify({ result: { process_info: { shell_pid: 42, foreground_processes: [{ pid: 42, name: "zsh" }] } } });
    if (args[0] === "agent" && args[1] === "start" && args[2] === "worker-1") return JSON.stringify({ result: { type: "agent_started" } });
    if (args[0] === "agent" && args[1] === "send-keys" && args[3] === "ctrl-c") { agentStatus = "idle"; return ""; }
    if (args[0] === "agent" && args[1] === "list") return JSON.stringify({ result: { agents: [{ name: "worker-1", agent: "codex", agent_status: agentStatus, cwd: "/tmp/worktree", pane_id: "w1:p2" }] } });
    if (args[0] === "agent" && args[1] === "prompt") return JSON.stringify({ result: { type: "agent_prompt_submitted" } });
    if (args[0] === "agent" && args[1] === "read") return "worker output";
    if (args.join(" ") === "pane close w1:p2") return JSON.stringify({ result: { type: "pane_closed" } });
    throw new Error(`Unexpected Herdr command: ${args.join(" ")}`);
  };
  return { calls, runner };
}

test("Herdr 0.9 transport gates the contract and maps worker lifecycle commands", () => {
  const previous = process.env.HERDR_ENV;
  process.env.HERDR_ENV = "1";
  try {
    const fake = fakeHerdr();
    const transport = new HerdrCliTransport({ runner: fake.runner, agentKind: "codex" });
    const compatibility = transport.verifyCompatibility();
    assert.deepEqual(compatibility, {
      compatible: true,
      version: "0.9.1",
      protocol: 22,
      endpointProtocolGeneration: 1,
      endpointCompatible: true,
    });

    const spawned = transport.spawn({ owner: "worker-1", cwd: "/tmp/worktree" });
    assert.equal(spawned.endpoint, "worker-1");
    assert.equal(spawned.paneId, "w1:p2");
    assert.deepEqual(transport.inspect("worker-1"), {
      endpoint: "worker-1",
      owner: "worker-1",
      cwd: "/tmp/worktree",
      paneId: "w1:p2",
      status: "working",
    });
    assert.deepEqual(transport.send("worker-1", { taskId: "T-000001" }), { delivered: true });
    assert.equal(transport.read("worker-1"), "worker output");
    assert.deepEqual(transport.interrupt("worker-1"), { interrupted: true, endpoint: "worker-1" });
    const adapter = new HerdrAdapter({ transport });
    const interrupted = adapter.interrupt("worker-1");
    assert.equal(interrupted.verified, true);
    assert.equal(interrupted.inspection.status, "idle");
    assert.equal(adapter.relaunch, undefined);
    assert.deepEqual(transport.stop("worker-1"), { stopped: true });

    assert.ok(fake.calls.some((args) => args[0] === "pane" && args[1] === "split"));
    assert.ok(fake.calls.some((args) => args[0] === "agent" && args[1] === "start"));
    assert.ok(fake.calls.some((args) => args[0] === "agent" && args[1] === "prompt"));
    assert.equal(fake.calls.some((args) => args[1] === "send"), false);
  } finally {
    if (previous === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous;
  }
});

test("Herdr transport accepts a newer compatible release but rejects endpoint generation changes", () => {
  const compatible = new HerdrCliTransport({ runner: fakeHerdr({ version: "0.10.0", protocol: 23 }).runner });
  assert.equal(compatible.verifyCompatibility().compatible, true);

  const incompatible = new HerdrCliTransport({ runner: fakeHerdr({ endpointGeneration: 2 }).runner });
  assert.throws(() => incompatible.verifyCompatibility(), HerdrCompatibilityError);
  const missingInterrupt = new HerdrCliTransport({ runner: fakeHerdr({ agentHelp: "herdr agent start\nherdr agent list\nherdr agent prompt\nherdr agent read\n" }).runner });
  assert.throws(() => missingInterrupt.verifyCompatibility(), /send-keys/);
});

test("Herdr starts a routed coding tool with configured arguments and model", () => {
  const previous = process.env.HERDR_ENV;
  process.env.HERDR_ENV = "1";
  try {
    const fake = fakeHerdr();
    const transport = new HerdrCliTransport({ runner: fake.runner });
    transport.spawn({
      owner: "worker-1",
      cwd: "/tmp/worktree",
      dispatchProfile: {
        name: "claude-deep",
        tool: "claude",
        command: ["claude", "--dangerously-skip-permissions"],
        model: "claude-opus",
      },
    });
    assert.ok(fake.calls.some((args) => args.join(" ") === "agent start worker-1 --kind claude --pane w1:p2 -- --dangerously-skip-permissions --model claude-opus"));
  } finally {
    if (previous === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous;
  }
});

test("Herdr spawn command matches every profile in model-routing.json", () => {
  const previous = process.env.HERDR_ENV;
  process.env.HERDR_ENV = "1";
  try {
    const config = loadRoutingConfig(path.join(__dirname, ".."), { required: true });
    for (const [name, profile] of Object.entries(config.profiles)) {
      const fake = fakeHerdr();
      const transport = new HerdrCliTransport({ runner: fake.runner });
      transport.spawn({ owner: "worker-1", cwd: "/tmp/worktree", dispatchProfile: { name, ...profile } });
      const actual = fake.calls.find((args) => args[0] === "agent" && args[1] === "start");
      assert.deepEqual(actual, ["agent", "start", "worker-1", "--kind", profile.tool, "--pane", "w1:p2", "--", ...profile.command.slice(1), "--model", profile.model], name);
    }
  } finally {
    if (previous === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous;
  }
});

test("Herdr accepts an idle Claude endpoint when its prompt has no legacy hint text", () => {
  const transport = new HerdrCliTransport();
  transport._run = (args) => {
    if (args[0] === "pane" && args[1] === "read") return "❯\n";
    if (args[0] === "agent" && args[1] === "list") return JSON.stringify({ result: { agents: [{ name: "worker-1", pane_id: "w1:p2", agent_status: "idle", cwd: "/tmp/worktree" }] } });
    throw new Error(`Unexpected Herdr command: ${args.join(" ")}`);
  };
  assert.doesNotThrow(() => transport._ensureInteractiveReady("w1:p2", "worker-1", 100));
});

test("adapter interrupt fails closed unless a later inspection shows the endpoint survived idle", () => {
  let status = "working";
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    interrupt() { return { interrupted: true }; },
    inspect(endpoint) { return { endpoint, owner: "worker-1", cwd: "/tmp/worktree", status }; },
  };
  const adapter = new HerdrAdapter({ transport });
  assert.throws(() => adapter.interrupt("worker-1"), /not verified/);
  transport.interrupt = () => { status = "idle"; return { interrupted: true }; };
  assert.equal(adapter.interrupt("worker-1").verified, true);
  assert.equal(typeof adapter.relaunch, "undefined");
});
