const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { resolveRoots, initHome, registerProject, createTask, confirmTaskProfile, assignTask } = require("../../src/foreman");

// A Foreman home with one registered Git project and a Paseo adapter whose agents the test drives.
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-paseo-")));
  const projectRoot = path.join(base, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "paseo@example.invalid"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Foreman Paseo"]);
  fs.writeFileSync(path.join(projectRoot, "README.md"), "Paseo fixture\n");
  execFileSync("git", ["-C", projectRoot, "add", "README.md"]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"], { stdio: "ignore" });
  fs.mkdirSync(path.join(projectRoot, "config"), { recursive: true });
  for (const file of ["model-routing.json", "paseo-agent-profiles.json"]) {
    fs.copyFileSync(path.join(__dirname, "../../config", file), path.join(projectRoot, "config", file));
  }
  const routingFile = path.join(projectRoot, "config", "model-routing.json");
  const routing = JSON.parse(fs.readFileSync(routingFile, "utf8"));
  routing.default = "codex-luna";
  for (const profile of Object.values(routing.profiles)) profile.isActive = true;
  fs.writeFileSync(routingFile, `${JSON.stringify(routing, null, 2)}\n`);
  const roots = resolveRoots({ foremanRoot: projectRoot, foremanHome: path.join(base, "foreman-home") });
  initHome(roots);
  registerProject({ roots, id: "fixture", root: projectRoot });
  const adapter = new FakePaseoAdapter();
  return { base, projectRoot, roots, adapter, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

class FakePaseoAdapter {
  constructor() { this.backend = "paseo"; this.next = 1; this.agents = new Map(); this.calls = []; }
  verifyCompatibility() { this.calls.push("verify"); return { compatible: true }; }
  capabilities() { return { provider: true, model: true, modeId: true, thinkingOptionId: true, featureValues: true }; }
  spawn(request) {
    const endpoint = `agent-${this.next}`;
    const workspaceId = `workspace-${this.next++}`;
    const agent = { ...request, endpoint, endpointId: endpoint, agentId: endpoint, workspaceId, status: "idle", attentionTimestamp: null, attentionReason: null, activeTurn: null, requiresAttention: false, cursor: { epoch: `epoch-${endpoint}`, seq: 0 }, entries: [] };
    this.agents.set(endpoint, agent);
    return { endpoint, endpointId: endpoint, agentId: endpoint, workspaceId, paneId: null };
  }
  inspect(endpoint) {
    this.calls.push(`inspect:${endpoint}`);
    const agent = this.agents.get(endpoint);
    return agent ? { endpoint, endpointId: endpoint, agentId: endpoint, provider: agent.dispatchProfile?.provider || null, providerSessionId: agent.providerSessionId || null, owner: agent.owner, taskId: agent.taskId, projectId: agent.projectId, generation: agent.generation, cwd: agent.cwd, workspaceId: agent.workspaceId, status: agent.status, activeTurn: agent.activeTurn, requiresAttention: agent.requiresAttention, attentionReason: agent.attentionReason, attentionTimestamp: agent.attentionTimestamp } : { endpoint, status: "missing" };
  }
  cursor(endpoint) { const agent = this.agents.get(endpoint); return agent ? { ...agent.cursor } : null; }
  send(endpoint, prompt, options = {}) {
    const agent = this.agents.get(endpoint);
    if (!agent || agent.status === "missing" || agent.status === "stopped") return { delivered: false };
    this.calls.push(`send:${endpoint}`);
    this.sent = this.sent || [];
    this.sent.push({ endpoint, prompt, options });
    agent.status = "running";
    agent.requiresAttention = false;
    agent.attentionReason = null;
    agent.activeTurn = { turnId: `turn-${agent.cursor.seq + 1}` };
    return { delivered: true, accepted: true };
  }
  list() { return [...this.agents.values()].filter((agent) => !["missing", "stopped"].includes(agent.status)).map((agent) => this.inspect(agent.endpoint)); }
  read(endpoint, cursor) {
    const agent = this.agents.get(endpoint);
    if (!agent) throw new Error(`missing ${endpoint}`);
    const after = cursor?.seq ?? -1;
    return { ...this.inspect(endpoint), entries: agent.entries.filter((entry) => entry.seq > after).map(({ seq, ...entry }) => entry), cursor: { ...agent.cursor }, gap: Boolean(agent.gap), staleCursor: Boolean(agent.staleCursor), hasNewer: Boolean(agent.hasNewer) };
  }
  finish(endpoint, text, { status = "idle", reason = "finished", turnId, requiresAttention = true } = {}) {
    const agent = this.agents.get(endpoint);
    const id = turnId || `turn-${agent.cursor.seq + 1}`;
    agent.cursor = { ...agent.cursor, seq: agent.cursor.seq + 1 };
    agent.entries.push({ seq: agent.cursor.seq, turnId: id, item: { type: "assistant_message", text } });
    agent.status = status;
    agent.requiresAttention = requiresAttention;
    agent.attentionReason = reason;
    agent.attentionTimestamp = requiresAttention ? new Date().toISOString() : null;
    agent.activeTurn = null;
  }
  stop(endpoint) {
    const agent = this.agents.get(endpoint);
    if (agent) agent.status = "stopped";
    return { stopped: true };
  }
}

function routeAndAssign(f, brief = "Inspect this fixture and report what it contains; do not edit files.", type = "scout") {
  const task = createTask({ roots: f.roots, projectId: "fixture", brief, type, backend: "paseo", routingRunner: () => ({ profile: "codex-luna", reason: "Codex is the configured default." }) });
  assert.equal(task.routing.profile, "codex-luna");
  const selected = confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "codex-luna" });
  assert.equal(selected.dispatchProfile.provider, "codex");
  const assignment = assignTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
  return { task, assignment };
}

module.exports = { fixture, FakePaseoAdapter, routeAndAssign };
