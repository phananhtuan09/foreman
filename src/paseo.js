const { spawnSync } = require("node:child_process");
const path = require("node:path");

class PaseoCompatibilityError extends Error {}

class PaseoAdapter {
  constructor({ node = process.execPath, bridge = path.join(__dirname, "..", "bin", "foreman-paseo-bridge.js"), timeoutMs = 120000, runner } = {}) {
    this.node = node;
    this.bridge = bridge;
    this.timeoutMs = timeoutMs;
    this.runner = runner;
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
    return this._call("send", { endpoint, prompt, messageId: options.messageId });
  }

  interrupt(endpoint) { return this._call("interrupt", { endpoint }); }

  stop(endpoint) { return this._call("archive", { endpoint }); }
}

module.exports = { PaseoAdapter, PaseoCompatibilityError };
