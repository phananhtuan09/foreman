const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const slp = require("../src/slp");

const REPO_ROOT = path.resolve(__dirname, "..");
const AGENTS = "# Project instructions\nUse the repository checks.\n";
const SKILL = `---\nname: foreman-lead\ndescription: "Test Lead skill"\nmetadata:\n  protocol: foreman-slp/v1\n---\nFollow the project instructions.\n`;
const REPORT_SUMMARY = "Added the requested bounded change and ran the focused check.";

// Minimal in-memory Paseo adapter: no daemon, no runtime endpoint, no real FOREMAN_HOME.
class FakePaseoAdapter {
  constructor() {
    this.backend = "paseo";
    this.next = 1;
    this.agents = new Map();
  }

  verifyCompatibility() { return { compatible: true }; }
  capabilities() { return { provider: true, model: true, modeId: true, thinkingOptionId: true, featureValues: true }; }

  spawn(request) {
    const endpoint = `agent-${this.next++}`;
    const workspaceId = `workspace-${endpoint}`;
    this.agents.set(endpoint, {
      ...request,
      endpoint,
      workspaceId,
      taskId: request.taskId || null,
      status: "idle",
      activeTurn: null,
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
      lastUsage: { contextWindowUsedTokens: 2400, contextWindowMaxTokens: 100000 },
      cursor: { epoch: `epoch-${endpoint}`, seq: 0 },
      entries: [],
    });
    return { endpoint, endpointId: endpoint, agentId: endpoint, workspaceId, paneId: null };
  }

  inspect(endpoint) {
    const agent = this.agents.get(endpoint);
    if (!agent) return { endpoint, status: "missing" };
    return {
      endpoint,
      owner: agent.owner,
      taskId: agent.taskId,
      projectId: agent.projectId,
      generation: agent.generation,
      cwd: agent.cwd,
      workspaceId: agent.workspaceId,
      status: agent.status,
      activeTurn: agent.activeTurn,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      attentionTimestamp: agent.attentionTimestamp,
      pendingPermissions: [],
      lastUsage: agent.lastUsage,
    };
  }

  cursor(endpoint) {
    const agent = this.agents.get(endpoint);
    return agent ? { ...agent.cursor } : null;
  }

  send(endpoint, prompt, { messageId } = {}) {
    const agent = this.agents.get(endpoint);
    if (!agent || ["missing", "stopped"].includes(agent.status)) return { delivered: false };
    agent.cursor = { ...agent.cursor, seq: agent.cursor.seq + 1 };
    agent.entries.push({ seq: agent.cursor.seq, messageId, item: { type: "user_message", text: prompt, messageId } });
    agent.status = "running";
    agent.activeTurn = { turnId: `turn-${agent.cursor.seq}` };
    agent.requiresAttention = false;
    agent.attentionReason = null;
    return { delivered: true, accepted: true, endpoint };
  }

  read(endpoint, cursor) {
    const agent = this.agents.get(endpoint);
    if (!agent) throw new Error(`missing ${endpoint}`);
    const after = cursor?.epoch === agent.cursor.epoch ? cursor.seq : 0;
    return {
      ...this.inspect(endpoint),
      entries: agent.entries.filter((entry) => entry.seq > after).map((entry) => ({ ...entry, item: { ...entry.item } })),
      cursor: { ...agent.cursor },
      gap: false,
      staleCursor: false,
      hasNewer: false,
    };
  }

  list() {
    return [...this.agents.values()].filter((agent) => !["missing", "stopped"].includes(agent.status)).map((agent) => this.inspect(agent.endpoint));
  }

  finish(endpoint, text) {
    const agent = this.agents.get(endpoint);
    agent.cursor = { ...agent.cursor, seq: agent.cursor.seq + 1 };
    agent.entries.push({ seq: agent.cursor.seq, turnId: `turn-${agent.cursor.seq}`, item: { type: "assistant_message", text } });
    agent.status = "finished";
    agent.activeTurn = null;
    agent.requiresAttention = true;
    agent.attentionReason = "finished";
    agent.attentionTimestamp = new Date().toISOString();
  }

  becomeIdle(endpoint) {
    const agent = this.agents.get(endpoint);
    agent.status = "idle";
    agent.activeTurn = null;
    agent.requiresAttention = false;
    agent.attentionReason = null;
  }

  stop(endpoint) {
    const agent = this.agents.get(endpoint);
    if (agent) {
      agent.status = "stopped";
      agent.activeTurn = null;
    }
    return { stopped: true };
  }
}

test("generated project state projects the SLP task, Peer assignment and report after the verified stop", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-slp-projection-"));
  try {
    const projectRoot = path.join(base, "project");
    const home = path.join(base, "home");
    fs.mkdirSync(projectRoot, { recursive: true });
    execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
    execFileSync("git", ["-C", projectRoot, "config", "user.email", "slp@example.invalid"]);
    execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman SLP test"]);
    fs.writeFileSync(path.join(projectRoot, "README.md"), "SLP fixture\n");
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), AGENTS);
    execFileSync("git", ["-C", projectRoot, "add", "README.md", "AGENTS.md"]);
    execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "ignore" });
    const skillFile = path.join(projectRoot, ".claude", "skills", "foreman-lead", "SKILL.md");
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, SKILL);
    const agentsBefore = fs.readFileSync(path.join(projectRoot, "AGENTS.md"));

    // Isolated root: a local config/slp-capacity.json must not change this serial scenario.
    const isolatedRoot = require("./helpers/slp-fakes").isolatedRoot(base);
    const roots = core.resolveRoots({ foremanRoot: isolatedRoot, foremanHome: home });
    core.initHome(roots);
    core.registerProject({ roots, id: "pilot", root: projectRoot, name: "Pilot" });
    const adapter = new FakePaseoAdapter();

    // Create and confirm the SLP task, then bind the project Lead.
    const task = core.createTask({
      roots,
      projectId: "pilot",
      backend: "paseo",
      taskModel: "slp",
      brief: "Complete one small project change.",
      routingRunner: () => ({ profile: "claude-sonnet", reason: "Projection test profile." }),
    });
    core.confirmTaskProfile({ roots, taskId: task.id, profile: "claude-sonnet" });
    slp.confirmProjectLeadProfile({ roots, projectId: "pilot", profileName: "claude-sonnet", adapter });
    const dispatch = slp.dispatchSlpTask({ roots, taskId: task.id, adapter, startCoordinator: false });
    assert.equal(dispatch.status, "working");
    const lead = slp.readLead(roots.foremanHome, "pilot");
    assert.ok(lead.endpoint);
    assert.equal(slp.readTask(roots.foremanHome, task.id).leadGeneration, lead.generation);

    // The Lead requests exactly one implementation Peer.
    adapter.finish(lead.endpoint, JSON.stringify({
      schemaVersion: 1,
      requestId: "R-impl-1",
      projectId: "pilot",
      leadGeneration: lead.generation,
      taskId: task.id,
      action: "create-peer",
      payload: {
        role: "implementation",
        brief: "Add the requested bounded project change and report evidence.",
        scope: "docs/pilot.md",
        resources: [{ key: "file/docs/pilot.md", mode: "write" }],
        dependsOn: [],
        resolves: [],
      },
    }));
    slp.coordinatorTick({ roots, adapter });
    const peers = slp.listPeerTasks(roots, task.id);
    assert.equal(peers.length, 1);
    const peer = peers[0];
    assert.equal(peer.peerRole, "implementation");

    // The Peer returns a valid report; the next tick collects it and performs the verified stop.
    adapter.finish(peer.endpoint, JSON.stringify({
      schemaVersion: 1,
      assignmentId: peer.taskId,
      generation: peer.generation,
      status: "done",
      summary: REPORT_SUMMARY,
      changedSurfaces: ["docs/pilot.md"],
      checks: [{ name: "focused check", result: "passed", source: "peer run", evidence: "reported output" }],
      openItems: [],
    }));
    adapter.becomeIdle(lead.endpoint);
    slp.coordinatorTick({ roots, adapter });
    const stoppedPeer = slp.readTask(roots.foremanHome, peer.taskId);
    assert.equal(stoppedPeer.peerRuntimeStopped, true);
    assert.equal(adapter.agents.get(peer.endpoint).status, "stopped");

    // The generated project view reflects the task, Peer assignment and report summary.
    const view = JSON.parse(fs.readFileSync(path.join(projectRoot, ".foreman", "project-state.json"), "utf8"));
    assert.equal(view.projectId, "pilot");
    const projectedTask = view.activeTasks.find((item) => item.taskId === task.id);
    assert.ok(projectedTask, "project state lists the SLP task");
    assert.equal(projectedTask.peerAssignments.length, 1);
    const projectedPeer = projectedTask.peerAssignments[0];
    assert.equal(projectedPeer.assignmentId, peer.taskId);
    assert.equal(projectedPeer.role, "implementation");
    assert.equal(projectedPeer.status, "stopped");
    assert.equal(projectedPeer.report.status, "done");
    assert.equal(projectedPeer.report.summary, REPORT_SUMMARY);
    assert.deepEqual(view.requests, [], "completed historical request outcomes do not accumulate in the current project view");

    const pendingEnvelope = {
      schemaVersion: 1,
      requestId: "R-projection-pending",
      projectId: "pilot",
      leadGeneration: lead.generation,
      taskId: task.id,
      action: "message-peer",
      payload: { assignmentId: peer.taskId, request: "Wait for a safe current-Lead turn." },
    };
    const pendingRequest = slp.recordLeadRequest({
      roots,
      sourceEndpoint: lead.endpoint,
      sourceGeneration: lead.generation,
      sourceWorkspaceId: lead.workspaceId,
      envelope: pendingEnvelope,
    });
    assert.equal(pendingRequest.status, "pending");
    slp.writeProjectState({ roots, projectId: "pilot" });
    const pendingView = JSON.parse(fs.readFileSync(path.join(projectRoot, ".foreman", "project-state.json"), "utf8"));
    assert.deepEqual(pendingView.requests.map((request) => request.requestId), ["R-projection-pending"]);
    assert.equal(pendingView.requests[0].status, "pending");

    // The generated directory stays out of the project's git status and instructions are untouched.
    const exclude = execFileSync("git", ["-C", projectRoot, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
    assert.match(fs.readFileSync(path.resolve(projectRoot, exclude), "utf8"), /^\/\.foreman\/$/m);
    assert.deepEqual(fs.readFileSync(path.join(projectRoot, "AGENTS.md")), agentsBefore);
    assert.equal(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"), AGENTS);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
