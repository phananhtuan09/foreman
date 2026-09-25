const { spawnSync } = require("node:child_process");
const path = require("node:path");

class HerdrCompatibilityError extends Error {}

function parseVersion(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new HerdrCompatibilityError(`Herdr version cannot be parsed: ${value || "-"}`);
  return { text: match[0], major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function isBelow(actual, required) {
  return actual.major < required.major
    || (actual.major === required.major && actual.minor < required.minor)
    || (actual.major === required.major && actual.minor === required.minor && actual.patch < required.patch);
}

/**
 * The core adapter is deliberately narrow.  Herdr-specific protocol details
 * remain in the transport so task state never depends on Herdr identifiers.
 */
class HerdrAdapter {
  constructor({ transport, requiredProtocol, requiredEndpointGeneration, interruptTimeoutMs = 2000, interruptPollMs = 50 } = {}) {
    this.transport = transport;
    this.requiredProtocol = requiredProtocol;
    this.requiredEndpointGeneration = requiredEndpointGeneration;
    this.interruptTimeoutMs = interruptTimeoutMs;
    this.interruptPollMs = interruptPollMs;
  }

  verifyCompatibility() {
    if (!this.transport || typeof this.transport.verifyCompatibility !== "function") {
      throw new HerdrCompatibilityError("Herdr transport protocol cannot be verified");
    }
    const result = this.transport.verifyCompatibility();
    if (result === true) return true;
    if (!result || result.compatible === false || result.endpointCompatible === false) {
      throw new HerdrCompatibilityError("Installed Herdr protocol is incompatible");
    }
    if (this.requiredProtocol !== undefined && result.protocol !== this.requiredProtocol) {
      throw new HerdrCompatibilityError(`Herdr protocol ${result.protocol ?? "-"} is not ${this.requiredProtocol}`);
    }
    if (this.requiredEndpointGeneration !== undefined && result.endpointProtocolGeneration !== this.requiredEndpointGeneration) {
      throw new HerdrCompatibilityError(`Herdr endpoint generation ${result.endpointProtocolGeneration ?? "-"} is not ${this.requiredEndpointGeneration}`);
    }
    return true;
  }

  spawn(request) {
    this.verifyCompatibility();
    if (typeof this.transport.spawn !== "function") throw new HerdrCompatibilityError("Herdr spawn is unavailable");
    return this.transport.spawn(request);
  }

  inspect(endpoint) {
    this.verifyCompatibility();
    if (typeof this.transport.inspect !== "function") throw new HerdrCompatibilityError("Herdr endpoint inspection is unavailable");
    return this.transport.inspect(endpoint);
  }

  send(endpoint, message) {
    this.verifyCompatibility();
    if (typeof this.transport.send !== "function") throw new HerdrCompatibilityError("Herdr prompt delivery is unavailable");
    return this.transport.send(endpoint, message);
  }

  interrupt(endpoint) {
    this.verifyCompatibility();
    if (typeof this.transport.interrupt !== "function") throw new HerdrCompatibilityError("Herdr worker interruption is unavailable");
    const result = this.transport.interrupt(endpoint);
    if (!result || result.interrupted === false) throw new HerdrCompatibilityError("Herdr interrupt was not confirmed");
    const deadline = Date.now() + Math.max(0, Number(this.interruptTimeoutMs) || 0);
    let inspection;
    while (true) {
      try { inspection = this.inspect(endpoint); } catch (_) { inspection = null; }
      const status = String(inspection?.status || inspection?.agent_status || "").toLowerCase();
      if (inspection && ["idle", "waiting", "blocked", "done", "completed", "complete"].includes(status)) {
        return { interrupted: true, verified: true, inspection };
      }
      if (Date.now() >= deadline) break;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(wait, 0, 0, Math.max(1, Number(this.interruptPollMs) || 1));
    }
    throw new HerdrCompatibilityError("Herdr interrupt outcome is not verified");
  }

  stop(endpoint) {
    this.verifyCompatibility();
    if (typeof this.transport.stop !== "function") throw new HerdrCompatibilityError("Herdr endpoint stop is unavailable");
    return this.transport.stop(endpoint);
  }

  capabilities() {
    this.verifyCompatibility();
    if (typeof this.transport.capabilities === "function") return this.transport.capabilities();
    return { agentKind: true };
  }

  list() {
    this.verifyCompatibility();
    if (typeof this.transport.list !== "function") throw new HerdrCompatibilityError("Herdr agent listing is unavailable");
    return this.transport.list();
  }

  read(endpoint, options) {
    this.verifyCompatibility();
    if (typeof this.transport.read !== "function") throw new HerdrCompatibilityError("Herdr agent output reading is unavailable");
    return this.transport.read(endpoint, options);
  }
}

/** Herdr 0.9-compatible command transport using the documented CLI contract. */
class HerdrCliTransport {
  constructor({
    command = "herdr",
    agentKind = process.env.FOREMAN_AGENT_KIND || "codex",
    minimumVersion = "0.9.1",
    minimumProtocol = 22,
    endpointProtocolGeneration = 1,
    paneDirection = "right",
    runner,
  } = {}) {
    this.command = command;
    this.agentKind = agentKind;
    this.minimumVersion = parseVersion(minimumVersion);
    this.minimumProtocol = minimumProtocol;
    this.endpointProtocolGeneration = endpointProtocolGeneration;
    this.paneDirection = paneDirection;
    this.runner = runner;
  }

  _run(args) {
    if (this.runner) return String(this.runner(args) ?? "");
    const result = spawnSync(this.command, args, { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      throw new HerdrCompatibilityError(`Herdr command failed (${args.join(" ")}): ${(result.stderr || result.error?.message || "unknown error").trim()}`);
    }
    return result.stdout || result.stderr || "";
  }

  _runJson(args) {
    const output = this._run(args);
    try { return JSON.parse(output); }
    catch (error) { throw new HerdrCompatibilityError(`Herdr command returned invalid JSON (${args.join(" ")}): ${error.message}`); }
  }

  _sleep(ms) {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(wait, 0, 0, ms);
  }

  _ensureInteractiveReady(paneId, owner, timeoutMs = 15000) {
    if (this.runner) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let output = "";
      try { output = this._run(["pane", "read", paneId, "--lines", "100"]); } catch (_) {}
      if (/Press enter to continue|Yes, continue/i.test(output)) {
        this._run(["pane", "send-keys", paneId, "return"]);
        this._sleep(500);
        continue;
      }
      if (/Ask Codex to do anything|Ask Claude to do anything|Ask Gemini to do anything|Ask .* to do anything/i.test(output)) return;
      try {
        const inspection = this.inspect(owner);
        if (inspection.paneId === paneId && ["idle", "waiting"].includes(inspection.status)) return;
      } catch (_) {}
      this._sleep(250);
    }
    throw new HerdrCompatibilityError("Herdr agent did not reach an interactive prompt");
  }

  _waitForAvailableShell(paneId, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = this._runJson(["pane", "process-info", "--pane", paneId]);
      const info = result?.result?.process_info;
      if (info?.shell_pid && Array.isArray(info.foreground_processes)
        && info.foreground_processes.some((process) => process.pid === info.shell_pid)) return;
      this._sleep(50);
    }
    throw new HerdrCompatibilityError("Herdr pane did not reach an available shell prompt");
  }

  _startAgentWhenAvailable({ owner, agentKind, paneId, agentArgs = [] }, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const args = ["agent", "start", owner, "--kind", agentKind, "--pane", paneId];
      if (agentArgs.length) args.push("--", ...agentArgs);
      try { return this._runJson(args); }
      catch (error) {
        if (!String(error.message).includes("agent_pane_busy") || Date.now() >= deadline) throw error;
        this._sleep(50);
      }
    }
  }

  _verifyCommandSurface() {
    const agentHelp = this._run(["agent", "--help"]);
    const hasVerb = (help, verb, prefix) => help.includes(`${prefix} ${verb}`) || new RegExp(`\\n\\s+${verb}(?:\\s|$)`, "m").test(help);
    for (const verb of ["start", "list", "prompt", "read", "send-keys"]) {
      if (!hasVerb(agentHelp, verb, "herdr agent")) throw new HerdrCompatibilityError(`Herdr agent verb is unavailable: ${verb}`);
    }
    const paneHelp = this._run(["pane", "--help"]);
    for (const verb of ["list", "close", "process-info"]) {
      if (!hasVerb(paneHelp, verb, "herdr pane")) throw new HerdrCompatibilityError(`Herdr pane verb is unavailable: ${verb}`);
    }
    const workspaceHelp = this._run(["workspace", "--help"]);
    for (const verb of ["create", "get", "close"]) {
      if (!hasVerb(workspaceHelp, verb, "herdr workspace")) throw new HerdrCompatibilityError(`Herdr workspace verb is unavailable: ${verb}`);
    }
    if (!this.runner) {
      for (const verb of ["send-keys", "read"]) {
        if (!hasVerb(paneHelp, verb, "herdr pane")) throw new HerdrCompatibilityError(`Herdr pane verb is unavailable: ${verb}`);
      }
    }
  }

  verifyCompatibility() {
    const client = this._runJson(["status", "client", "--json"]);
    const server = this._runJson(["status", "server", "--json"]);
    const version = parseVersion(client.version || server.version);
    if (isBelow(version, this.minimumVersion)) {
      throw new HerdrCompatibilityError(`Herdr ${version.text} is below required ${this.minimumVersion.text}`);
    }
    if (!Number.isInteger(client.protocol) || client.protocol < this.minimumProtocol) {
      throw new HerdrCompatibilityError(`Herdr protocol ${client.protocol ?? "-"} is below required ${this.minimumProtocol}`);
    }
    const endpointGeneration = client.endpoint_protocol_generation ?? server.capabilities?.endpoint_protocol_generation;
    if (endpointGeneration !== this.endpointProtocolGeneration) {
      throw new HerdrCompatibilityError(`Herdr endpoint generation ${endpointGeneration ?? "-"} is not ${this.endpointProtocolGeneration}`);
    }
    if (server.running === false || server.compatible === false || server.endpoint_compatible === false || server.private_protocol_compatible === false) {
      throw new HerdrCompatibilityError("Herdr client/server endpoint is incompatible");
    }
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(this.agentKind)) {
      throw new HerdrCompatibilityError(`Invalid Herdr agent kind: ${this.agentKind}`);
    }
    if (!['right', 'down'].includes(this.paneDirection)) throw new HerdrCompatibilityError(`Invalid pane direction: ${this.paneDirection}`);
    this._verifyCommandSurface();
    return {
      compatible: true,
      version: version.text,
      protocol: client.protocol,
      endpointProtocolGeneration: endpointGeneration,
      endpointCompatible: server.endpoint_compatible !== false,
    };
  }

  capabilities() {
    return { agentKind: true, tool: true, command: true, model: true, reasoningEffort: false };
  }

  spawn({ owner, cwd, agentKind = this.agentKind, dispatchProfile } = {}) {
    if (process.env.HERDR_ENV !== "1") throw new HerdrCompatibilityError("Herdr worker dispatch requires HERDR_ENV=1");
    if (dispatchProfile?.tool) agentKind = dispatchProfile.tool;
    else if (dispatchProfile?.agentKind) agentKind = dispatchProfile.agentKind;
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(owner)) throw new HerdrCompatibilityError(`Invalid Herdr agent name: ${owner}`);
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(agentKind)) throw new HerdrCompatibilityError(`Invalid Herdr agent kind: ${agentKind}`);
    let agentArgs = [];
    if (dispatchProfile?.command) {
      const command = Array.isArray(dispatchProfile.command) ? dispatchProfile.command.map(String) : String(dispatchProfile.command).trim().split(/\s+/);
      if (!command.length || !command[0]) throw new HerdrCompatibilityError("Dispatch profile command is empty");
      const executable = path.basename(command[0]).replace(/\.(?:cmd|exe)$/i, "");
      if (executable !== agentKind) throw new HerdrCompatibilityError("Dispatch profile command does not match its tool");
      agentArgs = command.slice(1);
    }
    if (dispatchProfile?.model && dispatchProfile.model !== "default" && !agentArgs.some((arg) => arg === "--model" || arg === "-m" || arg.startsWith("--model="))) {
      agentArgs.push("--model", dispatchProfile.model);
    }
    const created = this._runJson(["workspace", "create", "--cwd", cwd, "--label", `foreman-${owner}`, "--no-focus"]);
    const workspaceId = created?.result?.workspace?.workspace_id || created?.result?.workspace_id;
    if (!workspaceId) throw new HerdrCompatibilityError("Herdr workspace create did not return an identity");
    try {
      const paneId = created?.result?.root_pane?.pane_id;
      if (!paneId) throw new HerdrCompatibilityError("Herdr workspace has no pane identity");
      this._waitForAvailableShell(paneId);
      this._startAgentWhenAvailable({ owner, agentKind, paneId, agentArgs });
      this._ensureInteractiveReady(paneId, owner);
      return { endpoint: owner, endpointId: owner, paneId, workspaceId, owner, cwd, status: "idle", dispatchProfile: dispatchProfile || null };
    } catch (error) {
      try { this._run(["workspace", "close", workspaceId]); } catch (_) {}
      throw error;
    }
  }

  list() {
    const parsed = this._runJson(["agent", "list"]);
    const agents = parsed?.result?.agents;
    if (!Array.isArray(agents)) throw new HerdrCompatibilityError("Herdr agent list has no agents array");
    return agents;
  }

  inspect(endpoint) {
    const found = this.list().find((agent) => agent.name === endpoint || agent.agent === endpoint || agent.pane_id === endpoint);
    if (!found) return { endpoint, status: "missing" };
    return {
      endpoint,
      owner: found.name || found.agent,
      cwd: found.cwd || found.foreground_cwd,
      paneId: found.pane_id,
      workspaceId: found.workspace_id,
      status: found.agent_status || "unknown",
    };
  }

  send(endpoint, message) {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    this._run(["agent", "prompt", endpoint, text]);
    if (this.runner) return { delivered: true };
    this._sleep(2000);
    let after;
    try { after = this.inspect(endpoint); } catch (_) { after = null; }
    return { delivered: true, inspectedStatus: after?.status || "unknown", verified: Boolean(after && after.status !== "missing" && after.owner === endpoint) };
  }

  interrupt(endpoint) {
    this._run(["agent", "send-keys", endpoint, "ctrl-c"]);
    return { interrupted: true, endpoint };
  }

  read(endpoint, { source = "recent-unwrapped", lines = 120 } = {}) {
    return this._run(["agent", "read", endpoint, "--source", source, "--lines", String(lines)]);
  }

  stop(endpoint) {
    const current = this.inspect(endpoint);
    if (current.status === "missing") return { stopped: true };
    if (!current.paneId) throw new HerdrCompatibilityError("Herdr endpoint has no pane identity");
    if (current.workspaceId) {
      const workspace = this._runJson(["workspace", "get", current.workspaceId])?.result?.workspace;
      if (workspace?.label === `foreman-${endpoint}`) {
        const panes = this._runJson(["pane", "list", "--workspace", current.workspaceId])?.result?.panes;
        if (panes?.length === 1 && panes[0].pane_id === current.paneId) {
          this._run(["workspace", "close", current.workspaceId]);
          return { stopped: true };
        }
      }
    }
    this._run(["pane", "close", current.paneId]);
    return { stopped: true };
  }
}

const JsonCommandTransport = HerdrCliTransport;
module.exports = { HerdrAdapter, HerdrCliTransport, JsonCommandTransport, HerdrCompatibilityError };
