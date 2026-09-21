const { spawnSync } = require("node:child_process");

class HerdrCompatibilityError extends Error {}

/**
 * The production adapter is intentionally conservative.  Herdr's CLI is
 * versioned independently, so callers must provide an explicitly verified
 * transport rather than having Foreman guess command syntax.
 */
class HerdrAdapter {
  constructor({ transport, requiredProtocol = 1 } = {}) {
    this.transport = transport;
    this.requiredProtocol = requiredProtocol;
  }

  verifyCompatibility() {
    if (!this.transport || typeof this.transport.verifyCompatibility !== "function") {
      throw new HerdrCompatibilityError("Herdr transport protocol cannot be verified");
    }
    const result = this.transport.verifyCompatibility();
    if (result !== true && result?.protocol !== this.requiredProtocol) {
      throw new HerdrCompatibilityError("Installed Herdr protocol is incompatible");
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
    if (typeof this.transport.send !== "function") throw new HerdrCompatibilityError("Herdr delivery is unavailable");
    return this.transport.send(endpoint, message);
  }

  stop(endpoint) {
    this.verifyCompatibility();
    if (typeof this.transport.stop !== "function") throw new HerdrCompatibilityError("Herdr endpoint stop is unavailable");
    return this.transport.stop(endpoint);
  }
}

/** Herdr 0.7-compatible command transport. It uses only documented CLI verbs. */
class HerdrCliTransport {
  constructor({ command = "herdr", agentCommand = process.env.FOREMAN_AGENT_COMMAND, minimumVersion = "0.7.0" } = {}) {
    this.command = command;
    this.agentCommand = Array.isArray(agentCommand) ? agentCommand : (agentCommand ? String(agentCommand).trim().split(/\s+/) : null);
    this.minimumVersion = minimumVersion;
  }

  _run(args) {
    const result = spawnSync(this.command, args, { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new HerdrCompatibilityError(`Herdr command failed (${args.join(" ")}): ${(result.stderr || result.error?.message || "unknown error").trim()}`);
    return result.stdout || result.stderr || "";
  }

  verifyCompatibility() {
    const versionText = this._run(["--version"]).trim();
    const match = versionText.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) throw new HerdrCompatibilityError("Herdr version cannot be parsed");
    const actual = match.slice(1).map(Number);
    const required = this.minimumVersion.split(".").map(Number);
    if (actual[0] < required[0] || (actual[0] === required[0] && actual[1] < required[1])) throw new HerdrCompatibilityError(`Herdr ${versionText} is below required ${this.minimumVersion}`);
    const help = this._run(["agent", "--help"]);
    for (const verb of ["start", "send", "list"]) if (!help.includes(`agent ${verb}`) && !help.includes(`  ${verb}`)) throw new HerdrCompatibilityError(`Herdr agent verb is unavailable: ${verb}`);
    if (!this.agentCommand?.length) throw new HerdrCompatibilityError("FOREMAN_AGENT_COMMAND is required for Herdr worker dispatch");
    return { protocol: 1, version: versionText };
  }

  spawn({ owner, cwd }) {
    this._run(["agent", "start", owner, "--cwd", cwd, "--no-focus", "--", ...this.agentCommand]);
    return { endpoint: owner };
  }

  inspect(endpoint) {
    let parsed;
    try { parsed = JSON.parse(this._run(["agent", "list"])); } catch (error) { throw new HerdrCompatibilityError(`Herdr agent list is not JSON: ${error.message}`); }
    const agents = parsed?.result?.agents || [];
    const found = agents.find((agent) => agent.name === endpoint || agent.agent === endpoint || agent.pane_id === endpoint);
    if (!found) return { endpoint, status: "missing" };
    return { endpoint, owner: found.name || found.agent, cwd: found.cwd, status: found.agent_status || "unknown" };
  }

  send(endpoint, message) {
    this._run(["agent", "send", endpoint, typeof message === "string" ? message : JSON.stringify(message)]);
    return { delivered: true };
  }

  stop() {
    throw new HerdrCompatibilityError("Herdr stop semantics are not available in the documented CLI; cleanup must fail closed");
  }
}

const JsonCommandTransport = HerdrCliTransport;
module.exports = { HerdrAdapter, HerdrCliTransport, JsonCommandTransport, HerdrCompatibilityError };
