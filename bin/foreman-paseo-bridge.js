#!/usr/bin/env node

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { createPaseoClient } = require("@getpaseo/client");

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); }
  catch (error) { throw new Error(`Invalid bridge request JSON: ${error.message}`); }
}

function paseoArgs(env = process.env) {
  const home = env.FOREMAN_PASEO_HOME || env.PASEO_HOME;
  return home ? ["--home", home] : [];
}

function paseoCommand(args, env = process.env) {
  const command = env.FOREMAN_PASEO_COMMAND || "paseo";
  return execFileSync(command, [...args, ...paseoArgs(env)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function canonicalDirectory(directory) {
  return fs.realpathSync(directory);
}

function daemonUrl(env = process.env) {
  const status = JSON.parse(paseoCommand(["daemon", "status", "--json"], env));
  if (status.connectedDaemon !== "reachable" || !status.listen) throw new Error("Selected Paseo daemon is not reachable");
  if (status.daemonVersion && !/^0\.10\./.test(status.daemonVersion)) throw new Error(`Paseo SDK adapter requires daemon 0.10.x; found ${status.daemonVersion}`);
  const listen = String(status.listen);
  if (/^wss?:\/\//.test(listen)) return listen.endsWith("/ws") ? listen : `${listen.replace(/\/$/, "")}/ws`;
  return `ws://${listen.replace(/\/$/, "")}/ws`;
}

function statusView(agent) {
  const labels = agent.labels || {};
  return {
    endpoint: agent.id,
    endpointId: agent.id,
    agentId: agent.id,
    owner: labels["foreman.owner"] || agent.id,
    taskId: labels["foreman.taskId"] || null,
    projectId: labels["foreman.projectId"] || null,
    generation: labels["foreman.generation"] ? Number(labels["foreman.generation"]) : null,
    cwd: agent.cwd || null,
    workspace: agent.workspaceId || null,
    workspaceId: agent.workspaceId || null,
    status: agent.archivedAt ? "stopped" : (agent.status || "unknown"),
    activeTurn: agent.activeTurn || null,
    requiresAttention: Boolean(agent.requiresAttention),
    attentionReason: agent.attentionReason || null,
    attentionTimestamp: agent.attentionTimestamp || null,
    pendingPermissions: agent.pendingPermissions || [],
    lastError: agent.lastError || null,
    lastUsage: agent.lastUsage || null,
    archivedAt: agent.archivedAt || null,
  };
}

async function withClient(input, action) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Paseo SDK requires Node.js 22 or newer");
  const client = createPaseoClient({
    url: daemonUrl(),
    password: process.env.FOREMAN_PASEO_PASSWORD || process.env.PASEO_PASSWORD,
    connectTimeoutMs: Number(process.env.FOREMAN_PASEO_TIMEOUT_MS || 10000),
    reconnect: { enabled: false },
  });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.close();
  }
}

async function validateProfile(client, profile, cwd) {
  if (!profile || typeof profile.provider !== "string" || typeof profile.model !== "string") throw new Error("Paseo dispatch profile has no provider or model");
  const available = await client.providers.listAvailable();
  const providerEntry = (available.providers || available.entries || []).find((entry) => entry.id === profile.provider || entry.provider === profile.provider);
  if (!providerEntry || (providerEntry.available !== true && providerEntry.status !== "available")) throw new Error(`Paseo provider is unavailable: ${profile.provider}`);
  const modelsResult = await client.providers.listModels(profile.provider, { cwd });
  const modelId = String(profile.model).replace(new RegExp(`^${profile.provider}\/`), "");
  if (!(modelsResult.models || []).some((model) => model.id === modelId)) throw new Error(`Paseo model is unavailable for ${profile.provider}: ${modelId}`);
  if (profile.modeId) {
    const modes = await client.providers.listModes(profile.provider, { cwd });
    if (!(modes.modes || []).some((mode) => mode.id === profile.modeId)) throw new Error(`Paseo mode is unavailable for ${profile.provider}: ${profile.modeId}`);
  }
  if (profile.thinkingOptionId) {
    const model = modelsResult.models.find((item) => item.id === modelId);
    if (!(model.thinkingOptions || []).some((option) => option.id === profile.thinkingOptionId)) throw new Error(`Paseo thinking option is unavailable for ${modelId}: ${profile.thinkingOptionId}`);
  }
  if (profile.featureValues && Object.keys(profile.featureValues).length) {
    const features = await client.providers.listFeatures({ provider: `${profile.provider}/${modelId}`, cwd, modeId: profile.modeId, thinkingOptionId: profile.thinkingOptionId });
    const known = new Set((features.features || []).map((feature) => feature.id));
    for (const id of Object.keys(profile.featureValues)) if (!known.has(id)) throw new Error(`Paseo feature is unavailable for ${profile.provider}: ${id}`);
  }
  return { ...profile, model: modelId };
}

async function listAgents(client) {
  const agents = [];
  let cursor;
  do {
    const page = await client.agents.list({ scope: "active", page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    agents.push(...(page.entries || []).map((entry) => entry.agent || entry));
    cursor = page.pageInfo?.nextCursor || undefined;
  } while (cursor);
  return agents.map(statusView);
}

async function main(action, input) {
  if (action === "interrupt") {
    const output = paseoCommand(["stop", "--json", input.endpoint], input.env || process.env);
    return { interrupted: true, endpoint: input.endpoint, output };
  }
  return withClient(input, async (client) => {
    if (action === "verify") {
      const providers = await client.providers.listAvailable();
      return { compatible: true, providers: providers.providers || providers.entries || [] };
    }
    if (action === "list") return listAgents(client);
    if (action === "spawn") {
      const profile = await validateProfile(client, input.dispatchProfile, input.cwd);
      const workspace = await client.workspaces.open({ cwd: input.cwd });
      if (workspace.directory && canonicalDirectory(workspace.directory) !== canonicalDirectory(input.cwd)) throw new Error("Paseo workspace directory does not match the Foreman workspace");
      const agent = await workspace.agents.create({
        title: input.owner,
        config: {
          provider: `${profile.provider}/${profile.model}`,
          ...(profile.modeId ? { modeId: profile.modeId } : {}),
          ...(profile.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId } : {}),
          ...(profile.featureValues ? { featureValues: profile.featureValues } : {}),
        },
        labels: {
          "foreman.owner": input.owner,
          "foreman.taskId": input.taskId,
          "foreman.projectId": input.projectId,
          "foreman.generation": String(input.generation),
        },
      });
      await agent.refresh();
      const snapshot = agent.current();
      if (!snapshot || snapshot.id !== agent.id || snapshot.workspaceId !== workspace.id || !snapshot.cwd || canonicalDirectory(snapshot.cwd) !== canonicalDirectory(input.cwd)) {
        await agent.archive().catch(() => {});
        throw new Error("Paseo agent identity or workspace verification failed");
      }
      return { ...statusView(snapshot), status: "idle", provider: profile.provider, model: profile.model };
    }
    if (action === "inspect" || action === "cursor" || action === "read" || action === "send" || action === "archive") {
      const agent = client.agents.ref(input.endpoint);
      const refreshed = await agent.refresh();
      if (!refreshed) {
        if (action === "inspect") return { endpoint: input.endpoint, endpointId: input.endpoint, agentId: input.endpoint, status: "missing" };
        throw new Error(`Paseo agent no longer exists: ${input.endpoint}`);
      }
      const snapshot = refreshed.agent;
      if (action === "inspect") return statusView(snapshot);
      if (action === "cursor") {
        const page = await agent.timeline.refetch({ direction: "tail", limit: 1, projection: "projected" });
        return { cursor: page.endCursor || null };
      }
      if (action === "read") {
        const options = { direction: input.cursor ? "after" : "tail", limit: 200, projection: "projected", ...(input.cursor ? { cursor: input.cursor } : {}) };
        const page = await agent.timeline.refetch(options);
        return {
          ...statusView(agent.current() || snapshot),
          entries: page.entries || [],
          cursor: page.endCursor || input.cursor || null,
          startCursor: page.startCursor || null,
          hasNewer: Boolean(page.hasNewer),
          gap: Boolean(page.gap),
          staleCursor: Boolean(page.staleCursor),
        };
      }
      if (action === "send") {
        await agent.send(input.prompt, input.messageId ? { messageId: input.messageId } : undefined);
        return { delivered: true, accepted: true, endpoint: input.endpoint };
      }
      if (action === "archive") {
        const result = await agent.archive();
        return { stopped: Boolean(result.archivedAt), archivedAt: result.archivedAt, endpoint: input.endpoint };
      }
    }
    throw new Error(`Unsupported Paseo bridge action: ${action}`);
  });
}

async function entrypoint() {
  const action = process.argv[2];
  const input = readInput();
  const result = await main(action, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

entrypoint().catch((error) => {
  process.stderr.write(`foreman Paseo bridge: ${error.message}\n`);
  process.exitCode = 2;
});
