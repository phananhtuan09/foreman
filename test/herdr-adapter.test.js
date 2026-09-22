const assert = require("node:assert/strict");
const test = require("node:test");
const { HerdrCliTransport, HerdrCompatibilityError } = require("../src/herdr");

function fakeHerdr({ version = "0.9.1", protocol = 22, endpointGeneration = 1 } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args.join(" ") === "status client --json") return JSON.stringify({ version, protocol, endpoint_protocol_generation: endpointGeneration });
    if (args.join(" ") === "status server --json") return JSON.stringify({ running: true, compatible: true, endpoint_compatible: true, private_protocol_compatible: true, capabilities: { endpoint_protocol_generation: endpointGeneration } });
    if (args.join(" ") === "agent --help") return "herdr agent start\nherdr agent list\nherdr agent prompt\nherdr agent read\n";
    if (args.join(" ") === "pane --help") return "herdr pane split\nherdr pane close\n";
    if (args.join(" ") === "pane split --current --direction right --cwd /tmp/worktree --no-focus") return JSON.stringify({ result: { pane: { pane_id: "w1:p2" } } });
    if (args.join(" ") === "agent start worker-1 --kind codex --pane w1:p2") return JSON.stringify({ result: { type: "agent_started" } });
    if (args[0] === "agent" && args[1] === "list") return JSON.stringify({ result: { agents: [{ name: "worker-1", agent: "codex", agent_status: "working", cwd: "/tmp/worktree", pane_id: "w1:p2" }] } });
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
});
