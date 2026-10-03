const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const core = require("../../src/foreman");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILL = `---\nname: foreman-lead\ndescription: "Test Lead skill"\nmetadata:\n  protocol: foreman-slp/v1\n---\nFollow the project instructions.\n`;

class FakePaseoAdapter {
  constructor() {
    this.backend = "paseo";
    this.next = 1;
    this.agents = new Map();
    this.sent = [];
    this.maxActivePeers = 0;
  }

  verifyCompatibility() { return { compatible: true }; }
  capabilities() { return { provider: true, model: true, modeId: true, thinkingOptionId: true, featureValues: true }; }

  spawn(request) {
    const endpoint = `agent-${this.next++}`;
    const workspaceId = `workspace-${endpoint}`;
    const profile = request.dispatchProfile || {};
    const agent = {
      ...request,
      endpoint,
      endpointId: endpoint,
      agentId: endpoint,
      workspaceId,
      taskId: request.taskId || null,
      status: "idle",
      activeTurn: null,
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
      provider: profile.provider || null,
      model: profile.model || null,
      currentModeId: profile.modeId || null,
      thinkingOptionId: profile.thinkingOptionId || null,
      lastUsage: { contextWindowUsedTokens: 2400, contextWindowMaxTokens: 100000 },
      cursor: { epoch: `epoch-${endpoint}`, seq: 0 },
      entries: [],
    };
    this.agents.set(endpoint, agent);
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
      pendingPermissions: agent.pendingPermissions || [],
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
    agent.entries.push({
      seq: agent.cursor.seq,
      messageId,
      item: { type: "user_message", text: prompt, messageId },
    });
    agent.status = "running";
    agent.activeTurn = { turnId: `turn-${agent.cursor.seq}` };
    agent.requiresAttention = false;
    agent.attentionReason = null;
    this.sent.push({ endpoint, prompt, messageId });
    this.#measureActivePeers();
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

  finish(endpoint, text, { turnId, status = "finished" } = {}) {
    const agent = this.agents.get(endpoint);
    agent.cursor = { ...agent.cursor, seq: agent.cursor.seq + 1 };
    const currentTurn = turnId || `turn-${agent.cursor.seq}`;
    agent.entries.push({ seq: agent.cursor.seq, turnId: currentTurn, item: { type: "assistant_message", text } });
    agent.status = status;
    agent.activeTurn = null;
    agent.requiresAttention = true;
    agent.attentionReason = "finished";
    agent.attentionTimestamp = new Date().toISOString();
    this.#measureActivePeers();
  }

  becomeIdle(endpoint) {
    const agent = this.agents.get(endpoint);
    agent.status = "idle";
    agent.activeTurn = null;
    agent.requiresAttention = false;
    agent.attentionReason = null;
    this.#measureActivePeers();
  }

  stop(endpoint) {
    const agent = this.agents.get(endpoint);
    if (agent) {
      agent.status = "stopped";
      agent.activeTurn = null;
      this.#measureActivePeers();
    }
    return { stopped: true };
  }

  #measureActivePeers() {
    const active = [...this.agents.values()].filter((agent) => agent.taskId && !["missing", "stopped"].includes(agent.status)).length;
    this.maxActivePeers = Math.max(this.maxActivePeers, active);
  }
}

// A Herdr-shaped runtime: no timeline cursor, no message IDs, no active-turn or usage fields, snake_case listing.
class FakeHerdrAdapter {
  constructor() {
    this.backend = "herdr";
    this.next = 1;
    this.agents = new Map();
    this.sent = [];
  }

  verifyCompatibility() { return { compatible: true }; }
  capabilities() { return { agentKind: true, tool: true, command: true, model: true, reasoningEffort: false }; }

  spawn({ owner, cwd, dispatchProfile }) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(owner)) throw new Error(`Invalid Herdr agent name: ${owner}`);
    const n = this.next++;
    const agent = { owner, cwd, paneId: `pane-${n}`, workspaceId: `ws-${n}`, status: "idle", dispatchProfile };
    this.agents.set(owner, agent);
    return { endpoint: owner, endpointId: owner, paneId: agent.paneId, workspaceId: agent.workspaceId, owner, cwd, status: "idle" };
  }

  inspect(endpoint) {
    const agent = this.agents.get(endpoint);
    if (!agent || agent.status === "missing") return { endpoint, status: "missing" };
    return { endpoint, owner: agent.owner, cwd: agent.cwd, paneId: agent.paneId, workspaceId: agent.workspaceId, status: agent.status };
  }

  list() {
    return [...this.agents.values()].filter((agent) => agent.status !== "missing")
      .map((agent) => ({ name: agent.owner, pane_id: agent.paneId, workspace_id: agent.workspaceId, cwd: agent.cwd, agent_status: agent.status }));
  }

  send(endpoint, prompt) {
    const agent = this.agents.get(endpoint);
    if (!agent || agent.status === "missing") return { delivered: false };
    agent.status = "working";
    this.sent.push({ endpoint, prompt });
    return { delivered: true, verified: true };
  }

  stop(endpoint) {
    const agent = this.agents.get(endpoint);
    if (agent) agent.status = "missing";
    return { stopped: true };
  }

  idle(endpoint) { this.agents.get(endpoint).status = "idle"; }
}

// Each fixture gets its own Foreman root so a local config/slp-capacity.json never changes test behavior.
function isolatedRoot(base, capacity) {
  const root = path.join(base, "foreman-root");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  for (const name of ["model-routing.json", "paseo-agent-profiles.json"]) fs.copyFileSync(path.join(REPO_ROOT, "config", name), path.join(root, "config", name));
  if (capacity) fs.writeFileSync(path.join(root, "config", "slp-capacity.json"), JSON.stringify({ schemaVersion: 1, ...capacity }));
  return root;
}

function makeProject(base, name, { skill = true } = {}) {
  const projectRoot = path.join(base, name);
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "slp@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman SLP test"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "SLP fixture\n");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Project instructions\nUse the repository checks.\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md", "AGENTS.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "ignore" });
  if (skill) {
    const skillFile = path.join(projectRoot, ".claude", "skills", "foreman-lead", "SKILL.md");
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, SKILL);
  }
  return projectRoot;
}

module.exports = { REPO_ROOT, SKILL, FakePaseoAdapter, FakeHerdrAdapter, isolatedRoot, makeProject };
