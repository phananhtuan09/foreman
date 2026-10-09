#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createPaseoClient } = require("@getpaseo/client");

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); }
  catch (error) { throw new Error(`Invalid bridge request JSON: ${error.message}`); }
}

// Foreman passes stored image files, not bytes; each is checked against its digest before it reaches the agent.
function inlineImages(images) {
  return (images || []).map((image) => {
    let buffer;
    try { buffer = fs.readFileSync(image.file); }
    catch (error) { throw new Error(`Image cannot be read for Paseo delivery: ${image.id || image.file}: ${error.code || error.message}`); }
    if (crypto.createHash("sha256").update(buffer).digest("hex") !== image.sha256) throw new Error(`Image does not match its digest: ${image.id || image.file}`);
    return { data: buffer.toString("base64"), mimeType: image.mimeType };
  });
}

function paseoArgs(env = process.env) {
  const home = env.FOREMAN_PASEO_HOME || env.PASEO_HOME;
  return home ? ["--home", home] : [];
}

function paseoCommand(args, env = process.env) {
  const command = env.FOREMAN_PASEO_COMMAND || "paseo";
  return execFileSync(command, [...args, ...paseoArgs(env)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function selectedPaseoHome(env = process.env) {
  return path.resolve(env.FOREMAN_PASEO_HOME || env.PASEO_HOME || path.join(os.homedir(), ".paseo"));
}

function comparableHome(home) {
  try { return fs.realpathSync(home); } catch (_) { return path.resolve(home); }
}

function canonicalDirectory(directory) {
  return fs.realpathSync(directory);
}

function daemonUrl(env = process.env) {
  const status = JSON.parse(paseoCommand(["daemon", "status", "--json"], env));
  if (status.connectedDaemon !== "reachable" || !status.listen) throw new Error("Selected Paseo daemon is not reachable");
  if (!status.home || comparableHome(status.home) !== comparableHome(selectedPaseoHome(env))) {
    throw new Error(`Paseo daemon home mismatch: expected ${selectedPaseoHome(env)}, found ${status.home || "unknown"}`);
  }
  if (typeof status.daemonVersion !== "string" || !/^0\.1[01]\./.test(status.daemonVersion)) {
    throw new Error(`Paseo SDK adapter requires daemon 0.10.x or 0.11.x; found ${status.daemonVersion || "unknown"}`);
  }
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
    routingProfile: labels["foreman.routingProfile"] || null,
    paseoProfileId: labels["foreman.paseoProfileId"] || null,
    paseoProfileName: labels["foreman.paseoProfileName"] || null,
    provider: agent.provider || null,
    model: agent.model || null,
    currentModeId: agent.currentModeId || null,
    thinkingOptionId: agent.thinkingOptionId || null,
    effectiveThinkingOptionId: agent.effectiveThinkingOptionId || null,
    features: agent.features || [],
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

const PROFILE_LAUNCH_FIELDS = ["provider", "model", "modeId", "thinkingOptionId", "featureValues"];

function comparableProfileValue(value) {
  return value === undefined ? null : value;
}

function profileLaunchSnapshot(profile) {
  return Object.fromEntries(PROFILE_LAUNCH_FIELDS.map((field) => [field, comparableProfileValue(profile?.[field])]));
}

function profileDifferences(expected, actual) {
  const expectedSnapshot = profileLaunchSnapshot(expected);
  const actualSnapshot = profileLaunchSnapshot(actual);
  return PROFILE_LAUNCH_FIELDS.filter((field) => JSON.stringify(expectedSnapshot[field]) !== JSON.stringify(actualSnapshot[field]))
    .map((field) => ({ field, expected: expectedSnapshot[field], actual: actualSnapshot[field] }));
}

async function readDaemonProfiles(client) {
  const result = await client.config.get();
  const profiles = result?.config?.agentProfiles;
  if (!Array.isArray(profiles)) throw new Error("Selected Paseo daemon has no readable agent profiles; run bin/foreman-paseo profiles sync");
  return profiles;
}

async function resolveDaemonProfile(client, dispatchProfile) {
  const id = dispatchProfile?.paseoProfileId;
  if (typeof id !== "string" || !id.trim()) throw new Error("Paseo dispatch profile is missing paseoProfileId; confirm the task profile again");
  const installed = (await readDaemonProfiles(client)).filter((profile) => profile && profile.id === id);
  if (installed.length !== 1) {
    if (!installed.length) throw new Error(`Paseo profile is not installed on the selected daemon: ${id}; run bin/foreman-paseo profiles sync`);
    throw new Error(`Paseo profile ID is duplicated on the selected daemon: ${id}; run bin/foreman-paseo profiles sync`);
  }
  const differences = profileDifferences(dispatchProfile, installed[0]);
  if (differences.length) {
    const detail = differences.map(({ field, expected, actual }) => `${field} expected ${JSON.stringify(expected)}, daemon has ${JSON.stringify(actual)}`).join("; ");
    throw new Error(`Paseo profile is out of sync: ${id}; ${detail}; run bin/foreman-paseo profiles sync`);
  }
  return installed[0];
}

function actualFeatureValues(snapshot) {
  return Object.fromEntries((snapshot?.features || []).filter((feature) => feature && typeof feature.id === "string").map((feature) => [feature.id, feature.value]));
}

function verifyAgentLaunchSettings(snapshot, dispatchProfile) {
  const expectedFeatures = dispatchProfile?.featureValues || {};
  const actualFeatures = actualFeatureValues(snapshot);
  const actual = {
    provider: snapshot?.provider,
    model: snapshot?.model,
    modeId: snapshot?.currentModeId,
    thinkingOptionId: snapshot?.thinkingOptionId ?? snapshot?.effectiveThinkingOptionId,
    featureValues: Object.fromEntries(Object.keys(expectedFeatures).map((id) => [id, actualFeatures[id]])),
  };
  const expected = { ...dispatchProfile, featureValues: expectedFeatures };
  const differences = profileDifferences(expected, actual);
  if (differences.length) {
    const detail = differences.map(({ field, expected: wanted, actual: received }) => `${field} expected ${JSON.stringify(wanted)}, agent has ${JSON.stringify(received)}`).join("; ");
    throw new Error(`Paseo agent launch settings verification failed: ${detail}`);
  }
}

async function withClient(input, action) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Paseo SDK requires Node.js 22 or newer");
  const env = input.env || process.env;
  const client = createPaseoClient({
    url: daemonUrl(env),
    password: env.FOREMAN_PASEO_PASSWORD || env.PASEO_PASSWORD,
    connectTimeoutMs: Number(env.FOREMAN_PASEO_TIMEOUT_MS || 10000),
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
    return withClient(input, async (client) => {
      const agent = client.agents.ref(input.endpoint);
      const refreshed = await agent.refresh();
      if (!refreshed) throw new Error(`Paseo agent no longer exists after interrupt: ${input.endpoint}`);
      const inspection = statusView(refreshed.agent);
      const status = String(inspection.status || "unknown").toLowerCase();
      if (inspection.activeTurn || ["working", "running", "busy"].includes(status)) {
        throw new Error("Paseo interrupt outcome is not verified; the agent is still running");
      }
      return { interrupted: true, verified: true, endpoint: input.endpoint, output, inspection };
    });
  }
  return withClient(input, async (client) => {
    if (action === "verify") {
      const providers = await client.providers.listAvailable();
      return { compatible: true, providers: providers.providers || providers.entries || [] };
    }
    if (action === "list") return listAgents(client);
    if (action === "spawn") {
      await resolveDaemonProfile(client, input.dispatchProfile);
      const profile = await validateProfile(client, input.dispatchProfile, input.cwd);
      const routingProfile = typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null;
      const paseoProfileId = profile.paseoProfileId;
      const paseoProfileName = typeof profile.profileLabel === "string" && profile.profileLabel.trim()
        ? profile.profileLabel.trim()
        : routingProfile;
      const workspace = await client.workspaces.open({ cwd: input.cwd });
      if (workspace.directory && canonicalDirectory(workspace.directory) !== canonicalDirectory(input.cwd)) throw new Error("Paseo workspace directory does not match the Foreman workspace");
      const agent = await workspace.agents.create({
        title: paseoProfileName ? `${input.taskId} · ${paseoProfileName}` : `${input.taskId} · ${input.owner}`,
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
          ...(routingProfile ? { "foreman.routingProfile": routingProfile } : {}),
          ...(paseoProfileId ? { "foreman.paseoProfileId": paseoProfileId } : {}),
          ...(paseoProfileName ? { "foreman.paseoProfileName": paseoProfileName } : {}),
        },
      });
      await agent.refresh();
      const snapshot = agent.current();
      const view = snapshot && statusView(snapshot);
      if (!snapshot || snapshot.id !== agent.id || snapshot.workspaceId !== workspace.id || !snapshot.cwd || canonicalDirectory(snapshot.cwd) !== canonicalDirectory(input.cwd)
        || view.owner !== input.owner || view.taskId !== input.taskId || view.projectId !== input.projectId || Number(view.generation) !== Number(input.generation)) {
        await agent.archive().catch(() => {});
        throw new Error("Paseo agent identity or workspace verification failed");
      }
      try { verifyAgentLaunchSettings(snapshot, profile); }
      catch (error) {
        await agent.archive().catch(() => {});
        throw error;
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
        const entries = [];
        let cursor = input.cursor || null;
        let page;
        let hasNewer = false;
        let gap = false;
        let staleCursor = false;
        const maxPages = 20;
        for (let pageCount = 0; pageCount < maxPages; pageCount += 1) {
          const options = { direction: cursor ? "after" : "tail", limit: 200, projection: "projected", ...(cursor ? { cursor } : {}) };
          page = await agent.timeline.refetch(options);
          entries.push(...(page.entries || []));
          cursor = page.endCursor || cursor;
          hasNewer = Boolean(page.hasNewer);
          gap = gap || Boolean(page.gap);
          staleCursor = staleCursor || Boolean(page.staleCursor);
          if (!hasNewer || !cursor) break;
        }
        return {
          ...statusView(agent.current() || snapshot),
          entries,
          cursor: cursor || input.cursor || null,
          startCursor: page?.startCursor || null,
          hasNewer,
          gap,
          staleCursor,
        };
      }
      if (action === "send") {
        const images = inlineImages(input.images);
        const options = { ...(input.messageId ? { messageId: input.messageId } : {}), ...(images.length ? { images } : {}) };
        await agent.send(input.prompt, Object.keys(options).length ? options : undefined);
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

if (require.main === module) {
  entrypoint().catch((error) => {
    process.stderr.write(`foreman Paseo bridge: ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = {
  actualFeatureValues,
  inlineImages,
  profileDifferences,
  profileLaunchSnapshot,
  resolveDaemonProfile,
  verifyAgentLaunchSettings,
};
