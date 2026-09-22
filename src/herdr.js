const { spawnSync } = require("node:child_process");

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
  constructor({ transport, requiredProtocol, requiredEndpointGeneration } = {}) {
    this.transport = transport;
    this.requiredProtocol = requiredProtocol;
    this.requiredEndpointGeneration = requiredEndpointGeneration;
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

  stop(endpoint) {
    this.verifyCompatibility();
    if (typeof this.transport.stop !== "function") throw new HerdrCompatibilityError("Herdr endpoint stop is unavailable");
    return this.transport.stop(endpoint);
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

  _verifyCommandSurface() {
    const agentHelp = this._run(["agent", "--help"]);
    const hasVerb = (help, verb, prefix) => help.includes(`${prefix} ${verb}`) || new RegExp(`\\n\\s+${verb}(?:\\s|$)`, "m").test(help);
    for (const verb of ["start", "list", "prompt", "read"]) {
      if (!hasVerb(agentHelp, verb, "herdr agent")) throw new HerdrCompatibilityError(`Herdr agent verb is unavailable: ${verb}`);
    }
    const paneHelp = this._run(["pane", "--help"]);
    for (const verb of ["split", "close"]) {
      if (!hasVerb(paneHelp, verb, "herdr pane")) throw new HerdrCompatibilityError(`Herdr pane verb is unavailable: ${verb}`);
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

  spawn({ owner, cwd, agentKind = this.agentKind }) {
    if (process.env.HERDR_ENV !== "1") throw new HerdrCompatibilityError("Herdr worker dispatch requires HERDR_ENV=1");
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(owner)) throw new HerdrCompatibilityError(`Invalid Herdr agent name: ${owner}`);
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(agentKind)) throw new HerdrCompatibilityError(`Invalid Herdr agent kind: ${agentKind}`);
    const split = this._runJson(["pane", "split", "--current", "--direction", this.paneDirection, "--cwd", cwd, "--no-focus"]);
    const paneId = split?.result?.pane?.pane_id || split?.result?.pane_id;
    if (!paneId) throw new HerdrCompatibilityError("Herdr pane split did not return a pane identity");
    this._runJson(["agent", "start", owner, "--kind", agentKind, "--pane", paneId]);
    return { endpoint: owner, endpointId: owner, paneId, owner, cwd, status: "idle" };
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
      status: found.agent_status || "unknown",
    };
  }

  send(endpoint, message) {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    this._run(["agent", "prompt", endpoint, text]);
    return { delivered: true };
  }

  read(endpoint, { source = "recent-unwrapped", lines = 120 } = {}) {
    return this._run(["agent", "read", endpoint, "--source", source, "--lines", String(lines)]);
  }

  stop(endpoint) {
    const current = this.inspect(endpoint);
    if (current.status === "missing") return { stopped: true };
    if (!current.paneId) throw new HerdrCompatibilityError("Herdr endpoint has no pane identity");
    this._run(["pane", "close", current.paneId]);
    return { stopped: true };
  }
}

const JsonCommandTransport = HerdrCliTransport;
module.exports = { HerdrAdapter, HerdrCliTransport, JsonCommandTransport, HerdrCompatibilityError };
