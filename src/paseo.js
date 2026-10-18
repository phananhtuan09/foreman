const { spawnSync, execFileSync } = require("node:child_process");
const path = require("node:path");

class PaseoCompatibilityError extends Error {}
class PaseoHeartbeatError extends Error {
  constructor(message, { notFound = false } = {}) { super(message); this.notFound = notFound; }
}

class PaseoAdapter {
  constructor({ node = process.execPath, bridge = path.join(__dirname, "..", "bin", "foreman-paseo-bridge.js"), timeoutMs = 120000, heartbeatTimeoutMs = 10000, runner, heartbeatRunner } = {}) {
    this.node = node;
    this.bridge = bridge;
    this.timeoutMs = timeoutMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.runner = runner;
    this.heartbeatRunner = heartbeatRunner;
    this.backend = "paseo";
    this.dispatchCapabilities = { provider: true, model: true, modeId: true, thinkingOptionId: true, featureValues: true };
  }

  _call(action, payload = {}) {
    if (this.runner) return this.runner(action, payload);
    const result = spawnSync(this.node, [this.bridge, action], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: process.env,
      timeout: this.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const error = (result.stderr || result.error?.message || "unknown Paseo bridge error").trim();
      throw new PaseoCompatibilityError(error.replace(/^foreman Paseo bridge:\s*/, ""));
    }
    try { return JSON.parse(result.stdout); }
    catch (error) { throw new PaseoCompatibilityError(`Paseo bridge returned invalid JSON: ${error.message}`); }
  }

  verifyCompatibility() {
    const result = this._call("verify");
    if (result?.compatible !== true) throw new PaseoCompatibilityError("Paseo SDK compatibility is not verified");
    return { compatible: true, backend: "paseo", providers: result.providers || [] };
  }

  capabilities() { return { ...this.dispatchCapabilities }; }

  spawn(request) {
    const result = this._call("spawn", request);
    if (!result?.agentId || !result?.workspaceId || result.endpoint !== result.agentId) throw new PaseoCompatibilityError("Paseo did not return a verified agent and workspace identity");
    return { ...result, endpoint: result.agentId, endpointId: result.agentId, paneId: null };
  }

  list() { return this._call("list"); }

  inspect(endpoint) { return this._call("inspect", { endpoint }); }

  cursor(endpoint) { return this._call("cursor", { endpoint }).cursor || null; }

  read(endpoint, cursor) { return this._call("read", { endpoint, cursor }); }

  send(endpoint, message, options = {}) {
    const prompt = String(message);
    const images = (options.images || []).map(({ id, file, sha256, mimeType }) => ({ id, file, sha256, mimeType }));
    return this._call("send", { endpoint, prompt, messageId: options.messageId, ...(images.length ? { images } : {}) });
  }

  interrupt(endpoint) { return this._call("interrupt", { endpoint }); }

  stop(endpoint) { return this._call("archive", { endpoint }); }

  // Heartbeats are not in the SDK, so they go through the Paseo CLI, which acts for the agent named by PASEO_AGENT_ID.
  _heartbeat(agentId, args) {
    if (this.heartbeatRunner) return this.heartbeatRunner(agentId, args);
    const home = process.env.FOREMAN_PASEO_HOME || process.env.PASEO_HOME;
    try {
      const stdout = execFileSync(process.env.FOREMAN_PASEO_COMMAND || "paseo", ["heartbeat", ...args, "--json", ...(home ? ["--home", home] : [])], {
        encoding: "utf8", env: { ...process.env, PASEO_AGENT_ID: agentId }, stdio: ["ignore", "pipe", "pipe"], timeout: this.heartbeatTimeoutMs,
      });
      return JSON.parse(stdout);
    } catch (error) {
      let message = error.message;
      try { message = JSON.parse(error.stdout || error.stderr || "").error?.message || message; } catch (_) {}
      throw new PaseoHeartbeatError(`Paseo heartbeat ${args[0]} failed: ${String(message).split("\n")[0]}`, { notFound: /not found/i.test(String(message)) });
    }
  }

  heartbeatCreate({ agentId, cron, name, prompt }) { return this._heartbeat(agentId, ["create", "--cron", cron, "--name", name, prompt]); }

  heartbeatUpdate({ agentId, heartbeatId, cron }) { return this._heartbeat(agentId, ["update", heartbeatId, "--cron", cron]); }

  heartbeatDelete({ agentId, heartbeatId }) { return this._heartbeat(agentId, ["delete", heartbeatId]); }
}

module.exports = { PaseoAdapter, PaseoCompatibilityError, PaseoHeartbeatError };
