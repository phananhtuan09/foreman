const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync: runSync } = require("node:child_process");

class PaseoProfileError extends Error {}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new PaseoProfileError(`${label} is not valid JSON: ${error.message}`); }
}

function normalizePaseoProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new PaseoProfileError("Paseo profile must be an object");
  for (const key of ["id", "name", "provider", "model"]) {
    if (typeof profile[key] !== "string" || !profile[key].trim()) throw new PaseoProfileError(`Paseo profile ${key} is required`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.id)) throw new PaseoProfileError(`Invalid Paseo profile ID: ${profile.id}`);
  if (!/^[a-z][a-z0-9_-]*$/.test(profile.provider)) throw new PaseoProfileError(`Invalid Paseo provider ID: ${profile.provider}`);
  for (const key of ["modeId", "thinkingOptionId", "notes"]) {
    if (profile[key] !== undefined && (typeof profile[key] !== "string" || !profile[key].trim())) throw new PaseoProfileError(`Paseo profile ${key} must be a non-empty string when set: ${profile.id}`);
  }
  if (profile.featureValues !== undefined && (!profile.featureValues || typeof profile.featureValues !== "object" || Array.isArray(profile.featureValues))) {
    throw new PaseoProfileError(`Paseo profile featureValues must be an object: ${profile.id}`);
  }
  return {
    ...profile,
    id: profile.id.trim(),
    name: profile.name.trim(),
    provider: profile.provider.trim(),
    model: profile.model.trim(),
    ...(profile.modeId ? { modeId: profile.modeId.trim() } : {}),
    ...(profile.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId.trim() } : {}),
    ...(profile.notes ? { notes: profile.notes.trim() } : {}),
  };
}

function loadPaseoProfiles(foremanRoot, { required = true } = {}) {
  const file = path.join(foremanRoot, "config", "paseo-agent-profiles.json");
  if (!fs.existsSync(file)) {
    if (required) throw new PaseoProfileError(`Paseo agent profiles file does not exist: ${file}`);
    return null;
  }
  const source = readJson(file, "Paseo agent profiles file");
  if (!Array.isArray(source) || !source.length) throw new PaseoProfileError("Paseo agent profiles must be a non-empty array");
  const profiles = source.map(normalizePaseoProfile);
  const byId = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
  if (Object.keys(byId).length !== profiles.length) throw new PaseoProfileError("Paseo agent profile IDs must be unique");
  for (const profile of profiles) if (!profile.id.startsWith("foreman-")) throw new PaseoProfileError(`Foreman-owned Paseo profile ID must start with foreman-: ${profile.id}`);
  return { file, profiles, byId };
}

function loadModelRoutingConfig(foremanRoot, { required = true } = {}) {
  try {
    const config = require("./foreman").loadRoutingConfig(foremanRoot, { required, includeAllProfiles: true });
    return config ? { file: path.join(foremanRoot, "config", "model-routing.json"), config } : null;
  } catch (error) {
    throw new PaseoProfileError(`Model routing config is invalid: ${error.message}`);
  }
}

function mapPaseoRoutingConfig(modelRouting, paseoProfiles) {
  const allProfiles = {};
  for (const [name, routingProfile] of Object.entries(modelRouting.allProfiles || modelRouting.profiles)) {
    const candidates = [`foreman-${name}`, name];
    const paseoProfile = candidates.map((id) => paseoProfiles.byId[id]).find(Boolean);
    if (!paseoProfile) throw new PaseoProfileError(`No Paseo profile maps to model routing profile: ${name}`);
    if (paseoProfile.provider !== routingProfile.tool) throw new PaseoProfileError(`Paseo profile provider does not match model routing tool: ${name}`);
    if (paseoProfile.model !== routingProfile.model) throw new PaseoProfileError(`Paseo profile model does not match model routing profile: ${name}`);
    allProfiles[name] = {
      ...routingProfile,
      ...paseoProfile,
      tool: routingProfile.tool,
      effort: routingProfile.effort,
      whenToUse: routingProfile.whenToUse,
      isActive: routingProfile.isActive !== false,
      paseoProfileId: paseoProfile.id,
    };
  }
  const profiles = Object.fromEntries(Object.keys(modelRouting.profiles).map((name) => {
    const { isActive, ...profile } = allProfiles[name];
    return [name, profile];
  }));
  return { ...modelRouting, profiles, allProfiles };
}

function loadPaseoRoutingConfig(foremanRoot, { required = true } = {}) {
  const modelRouting = loadModelRoutingConfig(foremanRoot, { required });
  if (!modelRouting) return null;
  const profileConfig = loadPaseoProfiles(foremanRoot, { required });
  if (!profileConfig) return null;
  return {
    file: modelRouting.file,
    profileFile: profileConfig.file,
    config: mapPaseoRoutingConfig(modelRouting.config, profileConfig),
  };
}

function planPaseoProfileSync({ foremanRoot, currentProfiles }) {
  const source = loadPaseoProfiles(foremanRoot);
  const nextOwned = source.profiles;
  const current = currentProfiles || [];
  if (!Array.isArray(current)) throw new PaseoProfileError("Paseo daemon agentProfiles must be an array");
  const seen = new Set();
  for (const profile of current) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new PaseoProfileError("Every installed Paseo profile must be an object");
    for (const key of ["id", "name", "provider"]) {
      if (typeof profile[key] !== "string" || !profile[key].trim()) throw new PaseoProfileError(`Every installed Paseo profile must have a non-empty ${key}`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.id) || profile.id.trim() !== profile.id) throw new PaseoProfileError(`Installed Paseo profile ID is invalid: ${profile.id}`);
    for (const key of ["model", "modeId", "thinkingOptionId", "notes"]) {
      if (profile[key] !== undefined && (typeof profile[key] !== "string" || !profile[key].trim())) throw new PaseoProfileError(`Installed Paseo profile ${key} is invalid: ${profile.id}`);
    }
    if (profile.featureValues !== undefined && (!profile.featureValues || typeof profile.featureValues !== "object" || Array.isArray(profile.featureValues))) throw new PaseoProfileError(`Installed Paseo profile featureValues is invalid: ${profile.id}`);
    if (seen.has(profile.id)) throw new PaseoProfileError(`Installed Paseo profile IDs are duplicated: ${profile.id}`);
    seen.add(profile.id);
  }
  const firstOwned = current.findIndex((profile) => profile.id.startsWith("foreman-"));
  const preserved = current.filter((profile) => !profile.id.startsWith("foreman-"));
  const insertionIndex = firstOwned < 0 ? preserved.length : current.slice(0, firstOwned).filter((profile) => !profile.id.startsWith("foreman-")).length;
  preserved.splice(insertionIndex, 0, ...nextOwned);
  return { file: source.file, previousCount: current.length, profiles: preserved, managedProfiles: nextOwned.length, preservedProfiles: current.filter((profile) => !profile.id.startsWith("foreman-")).length };
}

function paseoCommand(args, { command = process.env.FOREMAN_PASEO_COMMAND || "paseo", env = process.env } = {}) {
  const result = runSync(command, args, { encoding: "utf8", env, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new PaseoProfileError(`Paseo command failed (${args[0]}): ${(result.stderr || result.error?.message || "unknown error").trim()}`);
  return result.stdout.trim();
}

function paseoHomeArgs(env = process.env) {
  const home = env.FOREMAN_PASEO_HOME || env.PASEO_HOME;
  return home ? ["--home", path.resolve(home)] : [];
}

function readInstalledProfiles(options = {}) {
  const output = paseoCommand(["daemon", "config", "get", "daemon.agentProfiles", ...paseoHomeArgs(options.env)], options);
  let result;
  try { result = JSON.parse(output); }
  catch (error) { throw new PaseoProfileError(`Paseo config get returned invalid JSON: ${error.message}`); }
  if (!result || result.set !== true) return [];
  if (!Array.isArray(result.value)) throw new PaseoProfileError("Paseo daemon.agentProfiles is set but is not an array");
  return result.value;
}

function selectedPaseoHome(env = process.env) {
  return path.resolve(env.FOREMAN_PASEO_HOME || env.PASEO_HOME || path.join(os.homedir(), ".paseo"));
}

function comparableHome(home) {
  try { return fs.realpathSync(home); } catch (_) { return path.resolve(home); }
}

function verifySelectedDaemon(options = {}) {
  const expectedHome = selectedPaseoHome(options.env);
  const statusOutput = paseoCommand(["daemon", "status", "--json", ...paseoHomeArgs(options.env)], options);
  let status;
  try { status = JSON.parse(statusOutput); }
  catch (error) { throw new PaseoProfileError(`Paseo daemon status returned invalid JSON: ${error.message}`); }
  if (status.connectedDaemon !== "reachable") throw new PaseoProfileError("Selected Paseo daemon is not reachable; refusing profile sync");
  if (!status.home || comparableHome(status.home) !== comparableHome(expectedHome)) {
    throw new PaseoProfileError(`Paseo daemon home mismatch: expected ${expectedHome}, found ${status.home || "unknown"}`);
  }
  if (typeof status.daemonVersion !== "string" || !/^0\.10\./.test(status.daemonVersion)) {
    throw new PaseoProfileError(`Paseo profile sync requires daemon 0.10.x; found ${status.daemonVersion || "unknown"}`);
  }
  return { home: expectedHome, daemonVersion: status.daemonVersion || null };
}

function syncPaseoProfiles({ foremanRoot, dryRun = false, commandOptions } = {}) {
  const daemon = verifySelectedDaemon(commandOptions);
  const current = readInstalledProfiles(commandOptions);
  const plan = planPaseoProfileSync({ foremanRoot, currentProfiles: current });
  const changed = JSON.stringify(current) !== JSON.stringify(plan.profiles);
  if (!dryRun && changed) {
    paseoCommand(["daemon", "config", "set", "daemon.agentProfiles", JSON.stringify(plan.profiles), ...paseoHomeArgs(commandOptions?.env)], commandOptions);
    const installed = readInstalledProfiles(commandOptions);
    if (JSON.stringify(installed) !== JSON.stringify(plan.profiles)) throw new PaseoProfileError("Paseo profile sync verification failed: installed profiles differ from repo source");
  }
  return { file: plan.file, paseoHome: daemon.home, daemonVersion: daemon.daemonVersion, dryRun, changed, managedProfiles: plan.managedProfiles, preservedProfiles: current.filter((profile) => !profile.id.startsWith("foreman-")).length, totalProfiles: plan.profiles.length };
}

module.exports = {
  PaseoProfileError,
  normalizePaseoProfile,
  loadPaseoProfiles,
  loadModelRoutingConfig,
  loadPaseoRoutingConfig,
  mapPaseoRoutingConfig,
  planPaseoProfileSync,
  selectedPaseoHome,
  verifySelectedDaemon,
  syncPaseoProfiles,
};
