const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { HerdrAdapter } = require("./herdr");
const coordination = require("./coordination");

class ForemanError extends Error {}
class HomeLockError extends ForemanError {}
class ValidationError extends ForemanError {}
class StaleGenerationError extends ForemanError {}
class CleanupRefusedError extends ForemanError {}
class DeliveryError extends ForemanError {}
class ResourceBusyError extends ForemanError {}

const SUPPORTED_SCHEMA_VERSION = 1;

function canonical(p) {
  try { return fs.realpathSync(p); } catch (_) { throw new ValidationError(`Path does not exist: ${p}`); }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRealWithin(root, candidate) {
  const canonicalRoot = canonical(root);
  const parent = fs.existsSync(candidate) ? canonical(candidate) : canonical(path.dirname(candidate));
  if (!isWithin(canonicalRoot, parent)) throw new ValidationError("Path crosses the project boundary");
}

function atomicWrite(file, content, { mode = 0o600 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    const fd = fs.openSync(temp, "wx", mode);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    try { fsyncDirectory(path.dirname(file)); } catch (_) { /* best effort on platforms without directory fsync */ }
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function fsyncDirectory(dir) {
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function atomicJson(file, value) { atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function now() { return new Date().toISOString(); }

function validateVersionedRecord(record, kind, identity) {
  if (!record || typeof record !== "object" || !Number.isInteger(record.schemaVersion)) throw new ValidationError(`${kind} record has no valid schema version`);
  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new ValidationError(`${kind} schema version ${record.schemaVersion} is unsupported`);
  if (identity && record[identity.field] !== identity.value) throw new ValidationError(`${kind} identity does not match ${identity.value}`);
  return record;
}

/**
 * Migration seam for future schema versions.  The source is copied before a
 * replacement is made durable, so a crash leaves both the original and the
 * migrated record available for deterministic restart recovery.
 */
function migrateJsonRecord({ file, kind, migrate }) {
  const originalRaw = fs.readFileSync(file);
  const original = JSON.parse(originalRaw.toString("utf8"));
  if (Number(original.schemaVersion) === SUPPORTED_SCHEMA_VERSION) return validateVersionedRecord(original, kind);
  if (original.schemaVersion !== undefined && original.schemaVersion !== 0) {
    throw new ValidationError(`${kind} schema version ${original.schemaVersion} is unsupported`);
  }
  if (typeof migrate !== "function") throw new ValidationError(`${kind} schema version ${original.schemaVersion ?? "-"} is unsupported`);
  const migrated = migrate({ ...original });
  validateVersionedRecord(migrated, kind);
  const originalFile = `${file}.original-v${original.schemaVersion ?? "unknown"}`;
  if (!fs.existsSync(originalFile)) atomicWrite(originalFile, originalRaw);
  atomicJson(file, migrated);
  return validateVersionedRecord(readJson(file), kind);
}

function ensureVersionedRecord(file, kind, migrate) {
  if (!fs.existsSync(file)) return null;
  const record = readJson(file);
  if (record && record.schemaVersion === SUPPORTED_SCHEMA_VERSION) return record;
  return migrateJsonRecord({ file, kind, migrate });
}

class HomeLock {
  constructor(home) { this.home = home; this.dir = path.join(home, "state", ".lock"); this.held = false; }
  acquire() {
    fs.mkdirSync(path.dirname(this.dir), { recursive: true, mode: 0o700 });
    try {
      fs.mkdirSync(this.dir, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") throw new HomeLockError(`Foreman home is locked: ${this.home}`);
      throw error;
    }
    try {
      atomicWrite(path.join(this.dir, "owner.json"), `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: now() })}\n`);
      this.held = true;
      return this;
    } catch (error) {
      fs.rmSync(this.dir, { recursive: true, force: true });
      throw error;
    }
  }
  release() {
    if (!this.held) return;
    fs.rmSync(this.dir, { recursive: true, force: false });
    this.held = false;
  }
}

function resolveRoots({ foremanRoot = process.env.FOREMAN_ROOT || process.cwd(), foremanHome = process.env.FOREMAN_HOME || foremanRoot } = {}) {
  const root = canonical(foremanRoot);
  const home = path.resolve(foremanHome);
  if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const canonicalHome = canonical(home);
  return { foremanRoot: root, foremanHome: canonicalHome };
}

function initHome(roots) {
  for (const dir of ["config", "data", "data/tasks", "state", "state/tasks"]) {
    fs.mkdirSync(path.join(roots.foremanHome, dir), { recursive: true, mode: 0o700 });
  }
  coordination.initCoordination(roots.foremanHome);
  const projectsFile = path.join(roots.foremanHome, "data", "projects.json");
  if (!fs.existsSync(projectsFile)) atomicJson(projectsFile, { schemaVersion: 1, version: 1, projects: [] });
  const sequence = path.join(roots.foremanHome, "data", "sequence.json");
  if (!fs.existsSync(sequence)) atomicJson(sequence, { schemaVersion: 1, task: 1 });
  const backlog = path.join(roots.foremanHome, "data", "backlog.md");
  if (!fs.existsSync(backlog)) atomicWrite(backlog, "## Tasks\n\n");
  const done = path.join(roots.foremanHome, "data", "done.md");
  if (!fs.existsSync(done)) atomicWrite(done, "## Done\n\n");
  const resources = resourceFile(roots.foremanHome);
  if (!fs.existsSync(resources)) atomicJson(resources, { schemaVersion: 1, version: 1, leases: [] });
  ensureVersionedRecord(projectsFile, "Project registry", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  ensureVersionedRecord(sequence, "Task sequence", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  ensureVersionedRecord(resources, "Resource lease state", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  return roots;
}

function withHomeLock(home, fn) {
  const lock = new HomeLock(home).acquire();
  try { return fn(lock); } finally { lock.release(); }
}

function gitTop(root) {
  try { return canonical(execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()); }
  catch (error) { throw new ValidationError(`Not a Git worktree: ${root}`); }
}

function gitCommonDir(root) {
  try {
    const value = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    return canonical(path.isAbsolute(value) ? value : path.resolve(root, value));
  }
  catch (_) { throw new ValidationError(`Cannot inspect Git identity: ${root}`); }
}

function gitBranch(root) {
  try {
    const branch = execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim();
    if (!branch) throw new ValidationError(`Workspace is detached: ${root}`);
    return branch;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`Cannot inspect workspace branch: ${root}`);
  }
}

function validateWorkspace(project, workspacePath) {
  const workspace = canonical(workspacePath || project.root);
  if (gitTop(workspace) !== workspace) throw new ValidationError("Workspace must be a Git worktree root");
  if (gitCommonDir(workspace) !== gitCommonDir(project.root)) throw new ValidationError("Workspace belongs to a different Git project");
  const branch = gitBranch(workspace);
  return { path: workspace, branch };
}

function projectFile(home) { return path.join(home, "data", "projects.json"); }
function taskDir(home, id) { return path.join(home, "data", "tasks", id); }
function taskStateDir(home, id) { return path.join(home, "state", "tasks", id); }
function metaFile(home, id) { return path.join(taskStateDir(home, id), "meta.json"); }
function resourceFile(home) { return path.join(home, "state", "resources.json"); }

function loadProjects(home) {
  const record = ensureVersionedRecord(projectFile(home), "Project registry", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  validateVersionedRecord(record, "Project registry");
  if (!Array.isArray(record.projects)) throw new ValidationError("Project registry projects must be an array");
  for (const project of record.projects) if (!project || !/^[a-z0-9][a-z0-9-]*$/.test(project.id || "") || typeof project.root !== "string" || typeof project.enabled !== "boolean") throw new ValidationError("Project registry identity is invalid");
  return record.projects;
}
function findProject(home, id) {
  const project = loadProjects(home).find((item) => item.id === id);
  if (!project || !project.enabled) throw new ValidationError(`Unknown or disabled project: ${id}`);
  if (canonical(project.root) !== project.root || gitTop(project.root) !== project.root) throw new ValidationError(`Project root is no longer valid: ${id}`);
  return project;
}

function resourceKey(raw) {
  const key = String(raw || "").trim().replace(/^\/+|\/+$/g, "");
  if (!key || key.includes("\0") || key.includes("..")) throw new ValidationError("Resource key must be a non-empty path-independent identifier");
  return key;
}

function normalizeResourceClaims(resources) {
  const input = resources?.resources || resources || [];
  if (!Array.isArray(input)) throw new ValidationError("Resource claims must be an array");
  const claims = input.map((claim) => {
    const value = typeof claim === "string" ? { key: claim } : claim;
    if (!value || typeof value !== "object") throw new ValidationError("Invalid resource claim");
    const key = resourceKey(value.key || value.resource);
    const mode = value.mode === "shared" ? "read" : (value.mode || "exclusive");
    if (!["read", "write", "exclusive"].includes(mode)) throw new ValidationError(`Unsupported resource mode: ${mode}`);
    return { key, mode };
  });
  const unique = new Map();
  for (const claim of claims) {
    const previous = unique.get(claim.key);
    if (!previous || (previous.mode === "read" && claim.mode !== "read")) unique.set(claim.key, claim);
  }
  return [...unique.values()];
}

function resourceOverlaps(left, right) {
  const prefix = (parent, child) => child === parent || child.startsWith(`${parent}/`);
  const wildcardPrefix = (value) => value.endsWith("/**") ? value.slice(0, -3).replace(/\/+$/, "") : null;
  const leftPrefix = wildcardPrefix(left);
  const rightPrefix = wildcardPrefix(right);
  if (leftPrefix && prefix(leftPrefix, right)) return true;
  if (rightPrefix && prefix(rightPrefix, left)) return true;
  return prefix(left, right) || prefix(right, left);
}

function resourceModesConflict(left, right) {
  return !(left === "read" && right === "read");
}

function loadResourceState(home) {
  const file = resourceFile(home);
  if (!fs.existsSync(file)) return { schemaVersion: 1, version: 1, leases: [] };
  const state = ensureVersionedRecord(file, "Resource lease state", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  validateVersionedRecord(state, "Resource lease state");
  if (!Array.isArray(state.leases)) throw new ValidationError("Resource lease state leases must be an array");
  for (const lease of state.leases) {
    if (!lease || typeof lease !== "object" || !lease.leaseId || !lease.taskId || !lease.owner || typeof lease.generation !== "number" || !Number.isInteger(lease.generation) || !Array.isArray(lease.resources) || !Number.isFinite(Number(lease.expiresAt))) throw new ValidationError("Resource lease identity is invalid");
  }
  return { schemaVersion: 1, version: 1, leases: state.leases };
}

function pruneResourceLeases(state, at = Date.now()) {
  state.leases = state.leases.filter((lease) => !lease.expiresAt || lease.expiresAt > at);
  return state;
}

function resourceConflicts(claims, leases, ignoreLeaseId) {
  const conflicts = [];
  for (const lease of leases) {
    if (ignoreLeaseId && lease.leaseId === ignoreLeaseId) continue;
    for (const requested of claims) {
      for (const held of lease.resources || []) {
        if (resourceOverlaps(requested.key, held.key) && resourceModesConflict(requested.mode, held.mode)) {
          conflicts.push({ leaseId: lease.leaseId, taskId: lease.taskId, owner: lease.owner, requested, held });
        }
      }
    }
  }
  return conflicts;
}

function claimResourcesUnlocked({ roots, taskId, generation, owner, resources, ttlMs = 10 * 60 * 1000, ignoreLeaseId }) {
  const claims = normalizeResourceClaims(resources);
  const state = pruneResourceLeases(loadResourceState(roots.foremanHome));
  const conflicts = resourceConflicts(claims, state.leases, ignoreLeaseId);
  if (conflicts.length) {
    const error = new ResourceBusyError("Requested resources are already leased");
    error.conflicts = conflicts;
    throw error;
  }
  const lease = {
    leaseId: `L-${crypto.randomBytes(12).toString("hex")}`,
    taskId,
    generation,
    owner,
    resources: claims,
    acquiredAt: now(),
    expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || 10 * 60 * 1000),
  };
  state.leases.push(lease);
  atomicJson(resourceFile(roots.foremanHome), { ...state, schemaVersion: 1, version: 1 });
  return lease;
}

function claimResources({ roots, taskId, generation, owner, resources, ttlMs }) {
  return withHomeLock(roots.foremanHome, () => {
    initHome(roots);
    return claimResourcesUnlocked({ roots, taskId, generation, owner, resources, ttlMs });
  });
}

function releaseResourcesUnlocked({ roots, leaseId, taskId, generation } = {}) {
  const state = pruneResourceLeases(loadResourceState(roots.foremanHome));
  const before = state.leases.length;
  state.leases = state.leases.filter((lease) => {
    if (leaseId && lease.leaseId === leaseId) return false;
    if (!leaseId && taskId && lease.taskId === taskId && (generation === undefined || lease.generation === generation)) return false;
    return true;
  });
  if (state.leases.length !== before || !fs.existsSync(resourceFile(roots.foremanHome))) atomicJson(resourceFile(roots.foremanHome), state);
  return before - state.leases.length;
}

function releaseResources({ roots, leaseId, taskId, generation }) {
  return withHomeLock(roots.foremanHome, () => releaseResourcesUnlocked({ roots, leaseId, taskId, generation }));
}

function renewResources({ roots, leaseId, ttlMs = 10 * 60 * 1000 }) {
  return withHomeLock(roots.foremanHome, () => {
    const state = pruneResourceLeases(loadResourceState(roots.foremanHome));
    const lease = state.leases.find((item) => item.leaseId === leaseId);
    if (!lease) throw new ValidationError(`Unknown or expired resource lease: ${leaseId}`);
    lease.expiresAt = Date.now() + Math.max(1000, Number(ttlMs) || 10 * 60 * 1000);
    lease.renewedAt = now();
    atomicJson(resourceFile(roots.foremanHome), { ...state, schemaVersion: 1, version: 1 });
    return lease;
  });
}

function listResourceLeases({ roots } = {}) {
  return withHomeLock(roots.foremanHome, () => {
    const state = pruneResourceLeases(loadResourceState(roots.foremanHome));
    atomicJson(resourceFile(roots.foremanHome), { ...state, schemaVersion: 1, version: 1 });
    return state.leases;
  });
}

function registerProject({ roots, id, name = id, root, defaultBranch = "main", deliveryMode = "local-only" }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new ValidationError("Project id must be lowercase and path-independent");
  const projectRoot = gitTop(canonical(root));
  if (deliveryMode !== "local-only") throw new ValidationError("Only local-only delivery is supported in milestone 1");
  return withHomeLock(roots.foremanHome, () => {
    initHome(roots);
    const projects = loadProjects(roots.foremanHome);
    if (projects.some((p) => p.id === id || p.root === projectRoot)) throw new ValidationError("Duplicate project id or root");
    const project = { id, name, root: projectRoot, defaultBranch, deliveryMode, enabled: true };
    atomicJson(projectFile(roots.foremanHome), { schemaVersion: 1, version: 1, projects: [...projects, project] });
    return project;
  });
}

function allocateTaskId(home) {
  const file = path.join(home, "data", "sequence.json");
  const sequence = ensureVersionedRecord(file, "Task sequence", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  validateVersionedRecord(sequence, "Task sequence");
  if (!Number.isInteger(sequence.task) || sequence.task < 1) throw new ValidationError("Task sequence is invalid");
  const id = `T-${String(sequence.task).padStart(6, "0")}`;
  sequence.task += 1;
  atomicJson(file, sequence);
  return id;
}

function normalizeTaskType(type) {
  const value = String(type || "ship").toLowerCase();
  if (!["ship", "scout"].includes(value)) throw new ValidationError(`Unsupported task type: ${value}`);
  return value;
}

function normalizeDependencies(dependencies) {
  if (dependencies === undefined) return [];
  if (!Array.isArray(dependencies)) throw new ValidationError("Task dependencies must be an array");
  const values = [...new Set(dependencies.map((dependency) => String(dependency)))];
  for (const value of values) if (!/^T-\d{6,}$/.test(value)) throw new ValidationError(`Invalid dependency task ID: ${value}`);
  return values;
}

function taskMetaPath(home, id) { return metaFile(home, id); }

function validateDependenciesUnlocked({ home, projectId, dependencies }) {
  const tasks = new Map();
  const root = path.join(home, "state", "tasks");
  if (fs.existsSync(root)) {
    for (const id of fs.readdirSync(root)) {
      const file = taskMetaPath(home, id);
      if (fs.existsSync(file)) {
        const record = readJson(file);
        try { coordination.validateTaskMetaRecord(record, id); } catch (error) { throw new ValidationError(error.message); }
        tasks.set(id, record);
      }
    }
  }
  for (const dependency of dependencies) {
    const record = tasks.get(dependency);
    if (!record) throw new ValidationError(`Unknown task dependency: ${dependency}`);
    if (record.projectId !== projectId) throw new ValidationError("Cross-project task dependencies are not supported");
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new ValidationError("Task dependency cycle detected");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)?.dependencies || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const dependency of dependencies) visit(dependency);
}

function createTask({ roots, projectId, brief, type = "ship", taskType, dependencies = [] }) {
  if (typeof brief !== "string" || !brief) throw new ValidationError("Task brief must be non-empty verbatim text");
  const normalizedType = normalizeTaskType(taskType || type);
  const normalizedDependencies = normalizeDependencies(dependencies);
  return withHomeLock(roots.foremanHome, () => {
    initHome(roots);
    const project = findProject(roots.foremanHome, projectId);
    validateDependenciesUnlocked({ home: roots.foremanHome, projectId: project.id, dependencies: normalizedDependencies });
    const id = allocateTaskId(roots.foremanHome);
    const dir = taskDir(roots.foremanHome, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(taskStateDir(roots.foremanHome, id), { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dir, "brief.md"), brief);
    atomicWrite(path.join(dir, "decisions.md"), "");
    fs.mkdirSync(path.join(dir, "decisions"), { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dir, "report.md"), "");
    atomicWrite(path.join(dir, "history.jsonl"), `${JSON.stringify({ at: now(), status: "queued", projectId })}\n`);
    atomicJson(metaFile(roots.foremanHome, id), { schemaVersion: 1, taskId: id, projectId: project.id, type: normalizedType, dependencies: normalizedDependencies, owner: null, generation: 0, workspace: null, branch: null, resources: [], resourceLease: null, backend: "herdr", endpoint: null, status: "queued" });
    updateBacklog(roots.foremanHome, id, "[ ]", project.id, brief);
    return { id, projectId: project.id, type: normalizedType, dependencies: normalizedDependencies, brief };
  });
}

function dependencySatisfied(meta) {
  if (!meta) return false;
  if (meta.type === "scout") return ["accepted", "cleaned"].includes(meta.status);
  return meta.deliveryState === "landed";
}

function assertTaskDispatchable(home, taskId, { allowWaitingDecision = false } = {}) {
  const root = path.join(home, "state", "tasks");
  const meta = readMeta(home, taskId);
  if (["accepted", "review-ready", "cleaned"].includes(meta.status)) throw new ValidationError(`Task is terminal and cannot be dispatched: ${taskId}`);
  if (meta.status === "waiting-decision" && !allowWaitingDecision) throw new ValidationError(`Task is waiting for a human decision: ${taskId}`);
  for (const dependency of meta.dependencies || []) {
    const file = path.join(root, dependency, "meta.json");
    if (!fs.existsSync(file) || !dependencySatisfied(readMeta(home, dependency))) throw new ValidationError(`Task is blocked by dependency: ${dependency}`);
  }
  return meta;
}

function assignTask({ roots, taskId, owner, adapter, workspacePath, cwd, projectId, resources, preflight, leaseTtlMs, requireMessageAck = true, dispatchProfile, fallbackDispatchProfile, handoff }) {
  if (!owner) throw new ValidationError("An assignment owner is required");
  if (requireMessageAck === false) throw new ValidationError("Task brief ACK-gating cannot be disabled");
  owner = String(owner).replace(/^@/, "");
  return withHomeLock(roots.foremanHome, () => {
    initHome(roots);
    const brief = fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8");
    const prior = assertTaskDispatchable(roots.foremanHome, taskId, { allowWaitingDecision: Boolean(handoff?.handoffId) });
    const actualProjectId = projectId || prior?.projectId;
    if (!actualProjectId) throw new ValidationError("Task has no project binding");
    if (prior?.projectId && projectId && prior.projectId !== projectId) throw new ValidationError("Task project binding cannot be changed");
    const project = findProject(roots.foremanHome, actualProjectId);
    const generation = prior?.status === "pending" && !prior?.resourceLease
      ? (prior.generation || 0)
      : (prior?.generation || 0) + 1;
    const workspace = validateWorkspace(project, workspacePath || cwd || project.root);
    const taskType = prior.type || "ship";
    const requestedResources = resources === undefined && preflight === undefined
      ? [{ key: `workspace/${project.id}`, mode: taskType === "scout" ? "read" : "exclusive" }]
      : (resources === undefined ? preflight : resources);
    if (taskType === "scout" && normalizeResourceClaims(requestedResources).some((claim) => claim.mode !== "read")) throw new ValidationError("Scout tasks may only claim read resources");
    let resourceLease;
    try {
      resourceLease = claimResourcesUnlocked({ roots, taskId, generation, owner, resources: requestedResources, ttlMs: leaseTtlMs, ignoreLeaseId: prior?.resourceLease?.leaseId });
    } catch (error) {
      if (error instanceof ResourceBusyError) {
        const blocked = {
          ...(prior || { taskId, projectId: project.id, owner: null, generation: prior?.generation || 0, workspace: null, branch: null, resources: [], resourceLease: null, backend: "herdr", endpoint: null }),
          status: "pending",
          pendingResources: normalizeResourceClaims(requestedResources),
          blockedBy: error.conflicts,
          pendingAt: now(),
        };
        atomicJson(metaFile(roots.foremanHome, taskId), blocked);
      }
      throw error;
    }
    const pending = {
      schemaVersion: 1,
      taskId,
      projectId: project.id,
      type: taskType,
      dependencies: prior.dependencies || [],
      owner,
      generation,
      workspace: workspace.path,
      branch: workspace.branch,
      resources: resourceLease.resources,
      resourceLease,
      backend: "herdr",
      endpoint: null,
      status: "pending",
      dispatchProfile: dispatchProfile || prior.dispatchProfile || null,
      handoff: handoff || prior.handoff || null,
      recoveryAttempts: prior.recoveryAttempts || 0,
      handoffPending: handoff ? true : Boolean(prior.handoffPending),
    };
    fs.mkdirSync(path.join(taskStateDir(roots.foremanHome, taskId), "inbox"), { recursive: true, mode: 0o700 });
    atomicJson(metaFile(roots.foremanHome, taskId), pending);
    try {
      if (!adapter || typeof adapter.verifyCompatibility !== "function" || typeof adapter.spawn !== "function" || typeof adapter.inspect !== "function" || typeof adapter.send !== "function") throw new DeliveryError("Herdr adapter is required");
      const compatibility = adapter.verifyCompatibility();
      if (compatibility === false || compatibility?.compatible === false || compatibility?.endpointCompatible === false) throw new DeliveryError("Herdr adapter compatibility is not verified");
      let profile = dispatchProfile || prior.dispatchProfile || null;
      const capabilities = typeof adapter.capabilities === "function" ? adapter.capabilities() : (adapter.dispatchCapabilities || {});
      if (profile) {
        try { profile = validateDispatchProfile(profile, capabilities); }
        catch (error) {
          if (fallbackDispatchProfile === undefined) throw error;
          profile = validateDispatchProfile(fallbackDispatchProfile, capabilities);
        }
      } else if (fallbackDispatchProfile !== undefined) {
        profile = validateDispatchProfile(fallbackDispatchProfile, capabilities);
      }
      if (prior?.endpoint && prior.status !== "queued") {
        if (typeof adapter?.stop !== "function" || typeof adapter?.inspect !== "function") throw new DeliveryError("Previous worker must be stopped before reassignment");
        const stopped = adapter.stop(prior.endpoint);
        if (stopped === false || stopped?.stopped === false) throw new DeliveryError("Previous worker teardown was not confirmed");
        const inspectedPrior = adapter.inspect(prior.endpoint);
        if (inspectedPrior && inspectedPrior.status !== "missing" && inspectedPrior.status !== "stopped") throw new DeliveryError("Previous worker remains active; refusing reassignment");
      }
      const spawned = adapter.spawn({ taskId, projectId: project.id, owner, generation, cwd: workspace.path, branch: workspace.branch, resources: resourceLease.resources, resourceLeaseId: resourceLease.leaseId, workspaceMode: "shared-current-branch", gitAuthority: "client", brief, dispatchProfile: profile });
      const endpoint = spawned?.endpoint || spawned?.endpointId;
      if (!endpoint) throw new DeliveryError("Herdr did not return an endpoint identity");
      const inspected = adapter.inspect(endpoint);
      if (!inspected || inspected.endpoint !== endpoint || inspected.cwd !== workspace.path || inspected.owner !== owner) throw new DeliveryError("Herdr endpoint identity verification failed");
      const messagePayload = { taskId, projectId: project.id, owner, generation, cwd: workspace.path, branch: workspace.branch, resources: resourceLease.resources, resourceLeaseId: resourceLease.leaseId, workspaceMode: "shared-current-branch", gitAuthority: "client", instructions: ["Do not run git switch, reset, clean, merge, or commit.", "Do not change files outside the leased resources.", "Request a new resource lease before expanding scope."], brief, taskType, dispatchProfile: profile, handoff: handoff || prior.handoff || null, reportPath: path.join(taskStateDir(roots.foremanHome, taskId), "inbox", `generation-${generation}-completion.md`) };
      const message = coordination.createMessageUnlocked({ roots, taskId, projectId: project.id, worker: owner, generation, endpoint, kind: "task-brief", payload: messagePayload, explicitId: `M-${taskId}-${generation}-brief` });
      const delivered = adapter.send(endpoint, messagePayload);
      coordination.markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered: delivered !== false && delivered?.delivered !== false, evidence: delivered });
      if (delivered === false || delivered?.delivered === false) throw new DeliveryError("Herdr did not confirm brief delivery");
      const assigned = { ...pending, endpoint, status: "pending-ack", assignedAt: now(), briefMessageId: message.messageId, messageAckRequired: true, dispatchProfile: profile };
      if (prior?.resourceLease) releaseResourcesUnlocked({ roots, leaseId: prior.resourceLease.leaseId });
      atomicJson(metaFile(roots.foremanHome, taskId), assigned);
      updateBacklog(roots.foremanHome, taskId, "[ ]", project.id, brief, owner, generation);
      appendHistory(roots.foremanHome, taskId, { at: now(), status: assigned.status, owner, generation, workspace: workspace.path, messageId: message.messageId });
      for (const priorMessage of coordination.listMessages({ roots }).filter((item) => item.taskId === taskId && item.generation !== generation && ["pending", "delivered"].includes(item.status))) {
        coordination.failMessageUnlocked({ roots, messageId: priorMessage.messageId, reason: "assignment generation was replaced" });
      }
      coordination.registerWorkerUnlocked({ roots, taskId, projectId: project.id, worker: owner, endpoint, generation, status: "active", pid: Number.isInteger(inspected?.pid) ? inspected.pid : (Number.isInteger(spawned?.pid) ? spawned.pid : undefined), adapter: "herdr", lastAck: null, lastHeartbeat: now() });
      return assigned;
    } catch (error) {
      releaseResourcesUnlocked({ roots, leaseId: resourceLease.leaseId });
      if (prior) atomicJson(metaFile(roots.foremanHome, taskId), prior);
      else {
        atomicJson(metaFile(roots.foremanHome, taskId), { schemaVersion: 1, taskId, projectId: project.id, owner: null, generation: 0, workspace: null, branch: null, resources: [], resourceLease: null, backend: "herdr", endpoint: null, status: "queued", dispatchError: error.message });
        updateBacklog(roots.foremanHome, taskId, "[ ]", project.id, brief);
      }
      throw error;
    }
  });
}

function appendHistory(home, id, item) {
  const file = path.join(taskDir(home, id), "history.jsonl");
  fs.appendFileSync(file, `${JSON.stringify(item)}\n`);
}

function updateBacklog(home, taskId, status, projectId, brief, owner, generation) {
  const file = path.join(home, "data", "backlog.md");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const summary = brief.split(/\r?\n/)[0].trim().replace(/\s+/g, " ");
  const suffix = owner ? ` @${owner} · gen:${generation}` : "";
  const line = `- ${status} ${taskId} [${projectId}] ${summary}${suffix}`;
  const index = lines.findIndex((entry) => entry.includes(taskId));
  if (index >= 0) lines[index] = line;
  else {
    const header = lines.findIndex((entry) => entry.trim() === "## Tasks");
    lines.splice(header >= 0 ? header + 1 : lines.length, 0, line);
  }
  atomicWrite(file, `${lines.join("\n").replace(/\n+$/, "\n")}\n`);
}

function archiveBacklog(home, taskId, projectId, brief, owner, generation) {
  const file = path.join(home, "data", "backlog.md");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const index = lines.findIndex((entry) => entry.includes(taskId));
  const summary = brief.split(/\r?\n/)[0].trim().replace(/\s+/g, " ");
  const suffix = owner ? ` @${owner} · gen:${generation}` : "";
  const archived = `- [x] ${taskId} [${projectId}] ${summary}${suffix}`;
  if (index >= 0) lines.splice(index, 1);
  atomicWrite(file, `${lines.join("\n").replace(/\n+$/, "\n")}\n`);
  fs.appendFileSync(path.join(home, "data", "done.md"), `${archived}\n`);
}

function readMeta(home, taskId) {
  const file = metaFile(home, taskId);
  if (!fs.existsSync(file)) throw new ValidationError(`Unknown task: ${taskId}`);
  const meta = ensureVersionedRecord(file, "Task metadata", (value) => ({ ...value, schemaVersion: SUPPORTED_SCHEMA_VERSION }));
  try { return coordination.validateTaskMetaRecord(meta, taskId); }
  catch (error) { throw new ValidationError(error.message); }
}

function recordPackage({ roots, taskId, raw, type }) {
  if (typeof raw !== "string" || !raw) throw new ValidationError("Worker package must preserve non-empty original text");
  if (!["progress", "completion", "blocker"].includes(String(type).toLowerCase())) throw new ValidationError(`Unsupported worker package type: ${type}`);
  return withHomeLock(roots.foremanHome, () => recordPackageUnlocked({ roots, taskId, raw, type }));
}

function packageHeaders(raw) {
  return Object.fromEntries(raw.split(/\r?\n/).slice(0, 24).map((line) => line.match(/^([A-Z _]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2]]));
}

function quarantinePackageUnlocked({ roots, taskId, raw, name, reason }) {
  return coordination.quarantineExternal({ roots, taskId, name: name || `${Date.now()}-package.md`, raw, reason });
}

function validatePackageIdentity({ meta, taskId, raw, type }) {
  const headers = packageHeaders(raw);
  const generation = Number(headers.GENERATION);
  const projectId = headers.PROJECT;
  const agent = (headers.AGENT || "").replace(/^@/, "");
  const packageType = (headers.TYPE || type || "").toLowerCase();
  if (!Number.isInteger(generation) || generation !== meta.generation || projectId !== meta.projectId || agent !== meta.owner || packageType !== String(type).toLowerCase() || headers.TASK !== taskId || !headers.TYPE) {
    throw new StaleGenerationError("Worker package does not match the current assignment generation");
  }
  return { headers, generation, packageType };
}

function applyPackageUnlocked({ roots, taskId, raw, type, sourceName, writeCanonical = true }) {
  const meta = readMeta(roots.foremanHome, taskId);
  let lifecycleMeta = meta;
  const { headers, generation } = validatePackageIdentity({ meta, taskId, raw, type });
  const dir = path.join(taskStateDir(roots.foremanHome, taskId), "inbox");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `generation-${generation}-${type}.md`);
  if (headers.ACK_MESSAGE_ID) {
    const messageFile = coordination.messageFile(roots.foremanHome, headers.ACK_MESSAGE_ID);
    if (!fs.existsSync(messageFile)) throw new StaleGenerationError("Worker acknowledgement references an unknown message");
    const message = coordination.validateMessageRecord(readJson(messageFile), headers.ACK_MESSAGE_ID);
    if (message.taskId !== taskId || message.projectId !== meta.projectId || message.worker !== meta.owner || message.generation !== meta.generation || message.endpoint !== meta.endpoint || headers.PAYLOAD_DIGEST !== message.payloadDigest) throw new StaleGenerationError("Worker acknowledgement does not match the current message");
    const ack = { messageId: message.messageId, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, payloadDigest: message.payloadDigest, packageFile: file, acknowledgedAt: now() };
    coordination.updateMessageUnlocked({ roots, messageId: message.messageId, mutate: (item) => ({ ...item, status: "acknowledged", acknowledgedAt: now(), ack }) });
    if (meta.briefMessageId === message.messageId && meta.status === "pending-ack") {
      const acknowledgedMeta = { ...meta, status: "working", briefAcknowledgedAt: now() };
      atomicJson(metaFile(roots.foremanHome, taskId), acknowledgedMeta);
      updateBacklog(roots.foremanHome, taskId, "[~]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
      lifecycleMeta = acknowledgedMeta;
    } else if (meta.briefMessageId === message.messageId && meta.status === "waiting-decision") {
      lifecycleMeta = { ...meta, briefAcknowledgedAt: now() };
      atomicJson(metaFile(roots.foremanHome, taskId), lifecycleMeta);
    }
  }
  if (writeCanonical) atomicWrite(file, raw);
  if (type === "completion") atomicWrite(path.join(taskDir(roots.foremanHome, taskId), "report.md"), raw);
  else atomicWrite(path.join(taskStateDir(roots.foremanHome, taskId), "progress"), raw);
  if (type === "completion" && lifecycleMeta.completionPackage === file && ["review-ready", "accepted", "cleaned"].includes(lifecycleMeta.status)) return { file, generation, type, duplicate: true };
  if (type === "blocker" && lifecycleMeta.blockerPackage === file && lifecycleMeta.status === "blocked") return { file, generation, type, duplicate: true };
  if (type === "blocker" && !["pending-ack"].includes(lifecycleMeta.status)) {
    const next = { ...lifecycleMeta, status: "blocked", blockerPackage: file, blockerAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    appendHistory(roots.foremanHome, taskId, { at: now(), status: "blocked", generation });
  }
  if (type === "completion" && !["pending-ack", "waiting-decision"].includes(lifecycleMeta.status)) {
    const next = { ...lifecycleMeta, status: "review-ready", completionPackage: file, completionAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    updateBacklog(roots.foremanHome, taskId, "[v]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
    appendHistory(roots.foremanHome, taskId, { at: now(), status: "review-ready", generation });
  }
  return { file, generation, type };
}

function recordPackageUnlocked({ roots, taskId, raw, type }) {
  try { return applyPackageUnlocked({ roots, taskId, raw, type, writeCanonical: true }); }
  catch (error) {
    if (error instanceof StaleGenerationError || error instanceof ValidationError) quarantinePackageUnlocked({ roots, taskId, raw, name: `${Date.now()}-${type}.md`, reason: error.message });
    throw error;
  }
}

function parseInboxAck(raw, name) {
  let value;
  try { value = JSON.parse(raw); } catch (error) { throw new ValidationError(`Invalid acknowledgement JSON: ${name}`); }
  const timestamp = value?.timestamp || value?.acknowledgedAt;
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !value.messageId || !value.taskId || !value.projectId || !value.worker || typeof value.generation !== "number" || !Number.isInteger(value.generation) || !value.payloadDigest || !timestamp || !Number.isFinite(Date.parse(timestamp))) throw new ValidationError(`Invalid acknowledgement identity: ${name}`);
  return value;
}

function applyInboxAckUnlocked({ roots, taskId, raw, name }) {
  const meta = readMeta(roots.foremanHome, taskId);
  const ack = parseInboxAck(raw, name);
  const messagePath = coordination.messageFile(roots.foremanHome, ack.messageId);
  if (!fs.existsSync(messagePath)) throw new StaleGenerationError("Acknowledgement references an unknown message");
  const message = coordination.validateMessageRecord(readJson(messagePath), ack.messageId);
  if (ack.taskId !== taskId || ack.projectId !== meta.projectId || ack.worker !== meta.owner || Number(ack.generation) !== meta.generation || message.taskId !== taskId || message.projectId !== meta.projectId || message.worker !== meta.owner || message.generation !== meta.generation || message.endpoint !== meta.endpoint || ack.payloadDigest !== message.payloadDigest) throw new StaleGenerationError("Acknowledgement does not match the current assignment");
  if (message.kind === "human-decision" && message.payload?.decisionId) {
    const decisionFile = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${message.payload.decisionId}.json`);
    if (!fs.existsSync(decisionFile)) throw new StaleGenerationError("Decision acknowledgement references an unknown decision");
    const decision = readJson(decisionFile);
    if (decision.schemaVersion !== 1 || decision.decisionId !== message.payload.decisionId || !["delivered", "acknowledged"].includes(decision.status) || decision.taskId !== taskId || decision.projectId !== meta.projectId || decision.worker !== meta.owner || decision.generation !== meta.generation || decision.messageId !== message.messageId) throw new StaleGenerationError("Decision acknowledgement does not match the current decision");
    atomicJson(decisionFile, { ...decision, status: "acknowledged", acknowledgedAt: now() });
  }
  const updated = coordination.updateMessageUnlocked({ roots, messageId: ack.messageId, mutate: (item) => ({ ...item, status: "acknowledged", acknowledgedAt: now(), ack }) });
  if (meta.briefMessageId === ack.messageId && meta.status === "pending-ack") {
    const next = { ...meta, status: "working", briefAcknowledgedAt: now(), pendingMessageIds: (meta.pendingMessageIds || []).filter((id) => id !== ack.messageId) };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    updateBacklog(roots.foremanHome, taskId, "[~]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
  } else if (meta.briefMessageId === ack.messageId && meta.status === "waiting-decision") {
    atomicJson(metaFile(roots.foremanHome, taskId), { ...meta, briefAcknowledgedAt: now(), pendingMessageIds: (meta.pendingMessageIds || []).filter((id) => id !== ack.messageId) });
  } else if (message.kind === "recovery-handoff") {
    atomicJson(metaFile(roots.foremanHome, taskId), { ...meta, handoffPending: false, handoffAcknowledgedAt: now(), pendingMessageIds: (meta.pendingMessageIds || []).filter((id) => id !== ack.messageId) });
  }
  return updated;
}

function reconcileInboxUnlocked({ roots, taskId }) {
  const dir = path.join(taskStateDir(roots.foremanHome, taskId), "inbox");
  if (!fs.existsSync(dir)) return { applied: [], quarantined: [] };
  const applied = [];
  const quarantined = [];
  const inboxNames = fs.readdirSync(dir).filter((name) => name !== "quarantine" && !name.endsWith(".tmp"));
  inboxNames.sort((left, right) => Number(right.endsWith(".json")) - Number(left.endsWith(".json")) || left.localeCompare(right));
  for (const name of inboxNames) {
    const file = path.join(dir, name);
    if (!fs.statSync(file).isFile()) continue;
    const raw = fs.readFileSync(file);
    const text = raw.toString("utf8");
    const packageMatch = name.match(/^generation-(\d+)-(progress|completion|blocker)\.md$/);
    const isAck = name.endsWith(".json");
    try {
      if (packageMatch) applied.push(applyPackageUnlocked({ roots, taskId, raw: text, type: packageMatch[2], sourceName: name, writeCanonical: false }));
      else if (isAck) applied.push({ file, acknowledgement: applyInboxAckUnlocked({ roots, taskId, raw: text, name }) });
      else throw new ValidationError("Unrecognized worker inbox package");
    } catch (error) {
      const quarantine = quarantinePackageUnlocked({ roots, taskId, raw, name, reason: error.message });
      quarantined.push(quarantine);
      try { fs.unlinkSync(file); } catch (_) {}
    }
  }
  return { applied, quarantined };
}

function reconcileInbox({ roots, taskId }) {
  return withHomeLock(roots.foremanHome, () => reconcileInboxUnlocked({ roots, taskId }));
}

function acceptTask({ roots, taskId }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    if (meta.status !== "review-ready") throw new ValidationError("Only review-ready tasks can be accepted");
    if (!meta.completionPackage || !fs.existsSync(meta.completionPackage)) throw new ValidationError("A valid completion package is required before acceptance");
    const next = { ...meta, status: "accepted", acceptedAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    archiveBacklog(roots.foremanHome, taskId, meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
    appendHistory(roots.foremanHome, taskId, { at: now(), status: "accepted", generation: meta.generation });
    return next;
  });
}

function markLanded({ roots, taskId, evidence }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    if (meta.type === "scout") throw new ValidationError("Scout tasks do not require a landing commit");
    if (meta.status !== "accepted") throw new ValidationError("Task must be accepted before delivery is marked landed");
    if (!meta.workspace || !fs.existsSync(meta.workspace)) throw new CleanupRefusedError("Delivery cannot be proven without the bound workspace");
    const project = findProject(roots.foremanHome, meta.projectId);
    if (gitCommonDir(meta.workspace) !== gitCommonDir(project.root)) throw new ValidationError("Workspace belongs to a different Git project");
    if (evidence?.workspace && canonical(evidence.workspace) !== canonical(meta.workspace)) throw new ValidationError("Landing evidence belongs to a different workspace");
    if (!evidence || evidence.target !== "local-only" || typeof evidence.commit !== "string" || !/^[0-9a-f]{7,64}$/.test(evidence.commit)) throw new ValidationError("Explicit local-only landing evidence is required");
    try { execFileSync("git", ["-C", project.root, "cat-file", "-e", `${evidence.commit}^{commit}`], { stdio: "pipe" }); } catch (_) { throw new ValidationError("Landing commit does not exist"); }
    try { execFileSync("git", ["-C", project.root, "merge-base", "--is-ancestor", evidence.commit, project.defaultBranch], { stdio: "pipe" }); } catch (_) { throw new CleanupRefusedError("Landing commit is not reachable from the configured default branch"); }
    const next = { ...meta, deliveryState: "landed" };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    return next;
  });
}

function releaseEndpoint({ roots, taskId, adapter }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    if (!meta.endpoint) return meta;
    const project = findProject(roots.foremanHome, meta.projectId);
    if (meta.workspace && (!fs.existsSync(meta.workspace) || gitCommonDir(meta.workspace) !== gitCommonDir(project.root))) throw new CleanupRefusedError("Endpoint cleanup is bound to the task project workspace");
    if (!adapter || typeof adapter.stop !== "function" || typeof adapter.inspect !== "function") throw new CleanupRefusedError("Endpoint teardown cannot be verified");
    const stopped = adapter.stop(meta.endpoint);
    if (stopped === false || stopped?.stopped === false) throw new CleanupRefusedError("Endpoint teardown was not confirmed");
    let inspection;
    try { inspection = adapter.inspect(meta.endpoint); } catch (_) { throw new CleanupRefusedError("Endpoint inspection failed; refusing cleanup"); }
    if (!inspection || (inspection.status !== "missing" && inspection.status !== "stopped")) throw new CleanupRefusedError("Endpoint remains active or unverifiable");
    if (inspection.owner && meta.owner && inspection.owner !== meta.owner) throw new CleanupRefusedError("Endpoint owner does not match the task assignment");
    if (inspection.cwd && meta.workspace && path.resolve(inspection.cwd) !== path.resolve(meta.workspace)) throw new CleanupRefusedError("Endpoint workspace does not match the task assignment");
    const next = { ...meta, endpoint: null, endpointReleasedAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    coordination.retireWorkerUnlocked({ roots, taskId, worker: meta.owner });
    return next;
  });
}

function cleanupTask({ roots, taskId, discard = false, authorization = false, workspaceReleased = false }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    const project = findProject(roots.foremanHome, meta.projectId);
    if (meta.workspace && fs.existsSync(meta.workspace) && gitCommonDir(meta.workspace) !== gitCommonDir(project.root)) throw new CleanupRefusedError("Cleanup workspace belongs to another project");
    const deliveryComplete = meta.type === "scout" ? meta.status === "accepted" : meta.deliveryState === "landed";
    if (!deliveryComplete && !(discard && authorization)) throw new CleanupRefusedError("Cleanup refused while work is unlanded");
    if (meta.endpoint) throw new CleanupRefusedError("Cleanup requires endpoint teardown proof");
    if (!workspaceReleased && !(discard && authorization)) throw new CleanupRefusedError("Client workspace release proof is required");
    if (meta.resourceLease) {
      const leases = loadResourceState(roots.foremanHome).leases;
      const lease = leases.find((item) => item.leaseId === meta.resourceLease.leaseId);
      if (lease && (lease.taskId !== taskId || lease.owner !== meta.owner || Number(lease.generation) !== Number(meta.generation))) throw new CleanupRefusedError("Resource lease identity does not match the task assignment");
      releaseResourcesUnlocked({ roots, leaseId: meta.resourceLease.leaseId });
    }
    const next = { ...meta, resources: [], resourceLease: null, workspaceReleasedAt: now(), workspaceRetained: true, cleanupAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    return true;
  });
}

function reconstructTask({ roots, taskId }) {
  const dir = taskDir(roots.foremanHome, taskId);
  const meta = readMeta(roots.foremanHome, taskId);
  return { id: taskId, brief: fs.readFileSync(path.join(dir, "brief.md"), "utf8"), meta, progress: fs.existsSync(path.join(taskStateDir(roots.foremanHome, taskId), "progress")) ? fs.readFileSync(path.join(taskStateDir(roots.foremanHome, taskId), "progress"), "utf8") : null, report: fs.existsSync(path.join(dir, "report.md")) ? fs.readFileSync(path.join(dir, "report.md"), "utf8") : null };
}

function acknowledgeTaskMessage({ roots, taskId, messageId, ack = {} }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    const file = coordination.messageFile(roots.foremanHome, messageId);
    if (!fs.existsSync(file)) throw new ValidationError(`Unknown message: ${messageId}`);
    const message = coordination.validateMessageRecord(readJson(file), messageId);
    if (message.taskId !== taskId || message.projectId !== meta.projectId || message.generation !== meta.generation || message.worker !== meta.owner || message.endpoint !== meta.endpoint) throw new StaleGenerationError("Message acknowledgement belongs to a stale assignment");
    if (message.status === "failed") throw new ValidationError("A failed message cannot be acknowledged");
    const acknowledged = coordination.updateMessageUnlocked({ roots, messageId, mutate: (item) => {
      if (!ack.payloadDigest || ack.payloadDigest !== item.payloadDigest || ack.messageId && ack.messageId !== messageId || ack.taskId && ack.taskId !== taskId || ack.projectId && ack.projectId !== meta.projectId || ack.worker && ack.worker !== meta.owner || ack.generation !== undefined && Number(ack.generation) !== meta.generation) throw new ValidationError("Message acknowledgement identity or payload digest mismatch");
      return { ...item, status: "acknowledged", acknowledgedAt: now(), ack: { ...ack, messageId, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, payloadDigest: item.payloadDigest, acknowledgedAt: ack.acknowledgedAt || ack.timestamp || now() } };
    }});
    let next = { ...meta, pendingMessageIds: (meta.pendingMessageIds || []).filter((id) => id !== messageId) };
    if (meta.briefMessageId === messageId && meta.status === "pending-ack") {
      next = { ...next, status: "working", briefAcknowledgedAt: now() };
      atomicJson(metaFile(roots.foremanHome, taskId), next);
      updateBacklog(roots.foremanHome, taskId, "[~]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
      appendHistory(roots.foremanHome, taskId, { at: now(), status: "working", owner: meta.owner, generation: meta.generation, reason: "brief-acknowledged" });
    } else if (meta.briefMessageId === messageId && meta.status === "waiting-decision") {
      next = { ...next, briefAcknowledgedAt: now() };
      atomicJson(metaFile(roots.foremanHome, taskId), next);
    } else if (message.kind === "recovery-handoff") {
      next = { ...next, handoffPending: false, handoffAcknowledgedAt: now() };
      atomicJson(metaFile(roots.foremanHome, taskId), next);
    } else if (next.pendingMessageIds.length !== (meta.pendingMessageIds || []).length) {
      atomicJson(metaFile(roots.foremanHome, taskId), next);
    }
    coordination.noteWorkerAckUnlocked({ roots, taskId, worker: meta.owner, generation: meta.generation, messageId });
    return { message: acknowledged, task: next };
  });
}

function sendWorkerMessage({ roots, taskId, kind, payload, adapter, requireAck = true, maxAttempts, maxAgeMs }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    if (!meta.endpoint || !meta.owner) throw new DeliveryError("Task has no active worker endpoint");
    const message = coordination.createMessageUnlocked({ roots, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, endpoint: meta.endpoint, kind, payload, maxAttempts, maxAgeMs });
    let result;
    try { result = adapter.send(meta.endpoint, payload); }
    catch (error) { result = { delivered: false, error: error.message }; }
    const delivered = result !== false && result?.delivered !== false;
    const updated = coordination.markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered, evidence: result });
    if (!delivered) throw new DeliveryError(`Worker message delivery failed: ${message.messageId}`);
    const next = { ...meta, pendingMessageIds: [...new Set([...(meta.pendingMessageIds || []), message.messageId])], lastMessageAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    return { message: updated, task: next, acknowledged: !requireAck };
  });
}

function createDecision({ roots, taskId, finding, why, options, impact, evidence, recommendation, blocker = false }) {
  if (!finding || !why || !Array.isArray(options) || options.length < 2) throw new ValidationError("Decision Package requires finding, rationale, and at least two options");
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    const id = `D-${crypto.randomBytes(10).toString("hex")}`;
    const record = { schemaVersion: 1, decisionId: id, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, finding, whyHumanDecisionRequired: why, options, impact: impact || null, evidence: evidence || null, recommendation: recommendation === undefined ? "none available" : recommendation, blocker: Boolean(blocker), status: "pending", createdAt: now(), answeredAt: null, deliveredAt: null, acknowledgedAt: null, appliedAt: null, humanResponse: null };
    const dir = path.join(taskDir(roots.foremanHome, taskId), "decisions");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicJson(path.join(dir, `${id}.json`), record);
    atomicJson(metaFile(roots.foremanHome, taskId), { ...meta, status: "waiting-decision", decisionId: id });
    updateBacklog(roots.foremanHome, taskId, "[?]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
    appendHistory(roots.foremanHome, taskId, { at: now(), status: "waiting-decision", decisionId: id, generation: meta.generation });
    return record;
  });
}

function answerDecision({ roots, taskId, decisionId, response }) {
  if (typeof response !== "string" || !response) throw new ValidationError("Human decision must preserve non-empty verbatim text");
  return withHomeLock(roots.foremanHome, () => {
    const file = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${decisionId}.json`);
    if (!fs.existsSync(file)) throw new ValidationError(`Unknown decision: ${decisionId}`);
    const record = readJson(file);
    if (record.status !== "pending") throw new ValidationError("Decision is not awaiting a human response");
    const meta = readMeta(roots.foremanHome, taskId);
    if (record.schemaVersion !== 1 || record.decisionId !== decisionId || record.taskId !== taskId || record.projectId !== meta.projectId || record.generation !== meta.generation || record.worker !== meta.owner || meta.decisionId !== decisionId || meta.status !== "waiting-decision") throw new StaleGenerationError("Decision does not match the current assignment");
    const next = { ...record, status: "answered", answeredAt: now(), humanResponse: response };
    atomicJson(file, next);
    atomicWrite(path.join(taskDir(roots.foremanHome, taskId), "decisions.md"), `${response}\n`);
    return next;
  });
}

function deliverDecision({ roots, taskId, decisionId, adapter }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    const file = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${decisionId}.json`);
    if (!fs.existsSync(file)) throw new ValidationError(`Unknown decision: ${decisionId}`);
    const decision = readJson(file);
    if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.taskId !== taskId || decision.projectId !== meta.projectId) throw new ValidationError("Decision record identity is invalid");
    if (decision.status !== "answered") throw new ValidationError("Decision must be answered before delivery");
    if (!adapter || typeof adapter.send !== "function") throw new DeliveryError("A runtime adapter is required to deliver a decision");
    if (decision.generation !== meta.generation || decision.worker !== meta.owner || !meta.endpoint) throw new StaleGenerationError("Decision belongs to a stale assignment");
    const payload = { decisionId, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, response: decision.humanResponse, instructions: "Acknowledge this decision before resuming work." };
    const message = coordination.createMessageUnlocked({ roots, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, endpoint: meta.endpoint, kind: "human-decision", payload, explicitId: `M-${decisionId}` });
    const result = adapter.send(meta.endpoint, payload);
    const delivered = result !== false && result?.delivered !== false;
    coordination.markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered, evidence: result });
    if (!delivered) throw new DeliveryError("Human decision delivery failed");
    const nextDecision = { ...decision, status: "delivered", deliveredAt: now(), messageId: message.messageId };
    atomicJson(file, nextDecision);
    return nextDecision;
  });
}

function acknowledgeDecision({ roots, taskId, decisionId, messageId, ack }) {
  return withHomeLock(roots.foremanHome, () => {
    const file = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${decisionId}.json`);
    if (!fs.existsSync(file)) throw new ValidationError(`Unknown decision: ${decisionId}`);
    const decision = readJson(file);
    if (decision.messageId !== messageId) throw new ValidationError("Decision acknowledgement message mismatch");
    if (!['delivered', 'acknowledged'].includes(decision.status)) throw new ValidationError("Decision is not delivered to the worker");
    const meta = readMeta(roots.foremanHome, taskId);
    if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.taskId !== taskId || decision.projectId !== meta.projectId || decision.generation !== meta.generation || decision.worker !== meta.owner || !meta.endpoint) throw new StaleGenerationError("Decision acknowledgement belongs to a stale generation");
    const decisionMessageFile = coordination.messageFile(roots.foremanHome, messageId);
    if (!fs.existsSync(decisionMessageFile)) throw new ValidationError("Decision acknowledgement message is missing");
    const message = coordination.validateMessageRecord(readJson(decisionMessageFile), messageId);
    if (message.taskId !== taskId || message.projectId !== meta.projectId || message.worker !== meta.owner || message.generation !== meta.generation || message.endpoint !== meta.endpoint || message.kind !== "human-decision" || ack?.payloadDigest !== message.payloadDigest || ack?.messageId && ack.messageId !== messageId || ack?.taskId && ack.taskId !== taskId || ack?.projectId && ack.projectId !== meta.projectId || ack?.worker && ack.worker !== meta.owner || ack?.generation !== undefined && Number(ack.generation) !== meta.generation) throw new ValidationError("Decision acknowledgement identity or digest mismatch");
    if (message.status === "failed") throw new ValidationError("A failed decision message cannot be acknowledged");
    coordination.updateMessageUnlocked({ roots, messageId, mutate: (item) => ({ ...item, status: "acknowledged", acknowledgedAt: now(), ack: { ...ack, messageId, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, payloadDigest: message.payloadDigest, acknowledgedAt: ack.acknowledgedAt || ack.timestamp || now() } }) });
    const next = { ...decision, status: "acknowledged", acknowledgedAt: now() };
    atomicJson(file, next);
    return next;
  });
}

function applyDecision({ roots, taskId, decisionId }) {
  return withHomeLock(roots.foremanHome, () => {
    const file = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${decisionId}.json`);
    if (!fs.existsSync(file)) throw new ValidationError(`Unknown decision: ${decisionId}`);
    const meta = readMeta(roots.foremanHome, taskId);
    const decision = readJson(file);
    if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.taskId !== taskId || decision.projectId !== meta.projectId || decision.generation !== meta.generation || decision.worker !== meta.owner || decision.status !== "acknowledged") throw new ValidationError("Only an acknowledged current-generation decision can be applied");
    if (meta.status !== "waiting-decision" || meta.decisionId !== decisionId) throw new ValidationError("Decision is not the active decision for this task");
    if (meta.messageAckRequired && meta.briefMessageId) {
      const briefFile = coordination.messageFile(roots.foremanHome, meta.briefMessageId);
      if (!fs.existsSync(briefFile) || coordination.validateMessageRecord(readJson(briefFile), meta.briefMessageId).status !== "acknowledged") throw new ValidationError("Task brief must be acknowledged before the decision can resume work");
    }
    if (!decision.messageId || !fs.existsSync(coordination.messageFile(roots.foremanHome, decision.messageId))) throw new ValidationError("Decision acknowledgement message is missing");
    const message = coordination.validateMessageRecord(readJson(coordination.messageFile(roots.foremanHome, decision.messageId)), decision.messageId);
    if (message.status !== "acknowledged" || message.taskId !== taskId || message.projectId !== meta.projectId || message.worker !== meta.owner || message.generation !== meta.generation || message.endpoint !== meta.endpoint || message.kind !== "human-decision" || !message.ack || message.ack.messageId !== message.messageId || message.ack.taskId !== taskId || message.ack.projectId !== meta.projectId || message.ack.worker !== meta.owner || Number(message.ack.generation) !== meta.generation || message.ack.payloadDigest !== message.payloadDigest) throw new ValidationError("Decision acknowledgement is not valid for the current assignment");
    const next = { ...decision, status: "applied", appliedAt: now() };
    atomicJson(file, next);
    atomicJson(metaFile(roots.foremanHome, taskId), { ...meta, status: "working", decisionId: null, decisionAppliedAt: now() });
    updateBacklog(roots.foremanHome, taskId, "[~]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
    appendHistory(roots.foremanHome, taskId, { at: now(), status: "working", reason: "decision-applied", decisionId });
    return next;
  });
}

function promoteScout({ roots, taskId, brief, dependencies = [] }) {
  return withHomeLock(roots.foremanHome, () => {
    const scout = readMeta(roots.foremanHome, taskId);
    if (scout.type !== "scout" || scout.status !== "accepted") throw new ValidationError("Only an accepted scout can be promoted");
    const sourceReport = fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "report.md"), "utf8");
    const text = brief || `Implement accepted findings from scout ${taskId}.\n\nScout report:\n${sourceReport}`;
    const normalized = normalizeDependencies([...new Set([taskId, ...dependencies])]);
    validateDependenciesUnlocked({ home: roots.foremanHome, projectId: scout.projectId, dependencies: normalized.filter((id) => id !== taskId) });
    const id = allocateTaskId(roots.foremanHome);
    const dir = taskDir(roots.foremanHome, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(taskStateDir(roots.foremanHome, id), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(dir, "decisions"), { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dir, "brief.md"), text);
    atomicWrite(path.join(dir, "decisions.md"), "");
    atomicWrite(path.join(dir, "report.md"), "");
    atomicWrite(path.join(dir, "history.jsonl"), `${JSON.stringify({ at: now(), status: "queued", projectId: scout.projectId, promotedFrom: taskId })}\n`);
    atomicJson(metaFile(roots.foremanHome, id), { schemaVersion: 1, taskId: id, projectId: scout.projectId, type: "ship", dependencies: normalized, promotedFrom: taskId, owner: null, generation: 0, workspace: null, branch: null, resources: [], resourceLease: null, backend: "herdr", endpoint: null, status: "queued" });
    updateBacklog(roots.foremanHome, id, "[ ]", scout.projectId, text);
    return { id, projectId: scout.projectId, type: "ship", promotedFrom: taskId, dependencies: normalized, brief: text };
  });
}

function triageBlocker({ roots, taskId, raw, adapter, followUpPayload, decision, followUpMaxAttempts = 3, followUpMaxAgeMs = 60 * 60 * 1000 }) {
  if (typeof raw !== "string" || !raw) throw new ValidationError("Blocker package must preserve non-empty original text");
  const lines = Object.fromEntries(raw.split(/\r?\n/).slice(0, 24).map((line) => line.match(/^([A-Z _]+):\s*(.*)$/)).filter(Boolean).map((match) => [match[1].trim(), match[2]]));
  const authority = /^(yes|true|1)$/i.test(lines.AUTHORITY || "") || /^(product|architecture|compatibility|security|operational|acceptance)$/i.test(lines.BLOCKER_CLASS || "");
  const result = { kind: authority ? "authority" : "technical", rootCause: lines.ROOT_CAUSE || null, evidence: lines.EVIDENCE || null, nextAction: lines.NEXT_ACTION || null, canSelfResolve: /^(yes|true|1)$/i.test(lines.CAN_SELF_RESOLVE || ""), raw };
  const triageFile = path.join(taskStateDir(roots.foremanHome, taskId), "blocker-triage.json");
  let priorTriage = null;
  if (fs.existsSync(triageFile)) {
    try { priorTriage = readJson(triageFile); } catch (_) { priorTriage = null; }
  }
  const sameGeneration = priorTriage && Number(priorTriage.generation) === Number(readMeta(roots.foremanHome, taskId).generation);
  const followUpCount = sameGeneration ? Number(priorTriage.followUpCount || 0) : 0;
  if (!authority && adapter && followUpPayload) {
    if (followUpCount >= Math.max(1, Number(followUpMaxAttempts) || 3)) throw new ValidationError("Technical blocker follow-up attempt limit is exhausted");
    result.followUp = sendWorkerMessage({ roots, taskId, kind: "blocker-triage-follow-up", payload: followUpPayload, adapter, maxAttempts: followUpMaxAttempts, maxAgeMs: followUpMaxAgeMs });
    result.followUpCount = followUpCount + 1;
  }
  if (authority && decision) result.decision = createDecision({ roots, taskId, ...decision, finding: decision.finding || result.rootCause || "Worker authority blocker", evidence: decision.evidence || result.evidence });
  withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    atomicJson(triageFile, { schemaVersion: 1, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, authority, result, followUpCount: result.followUpCount || followUpCount, createdAt: now(), followUpMaxAttempts: Number(followUpMaxAttempts), followUpMaxAgeMs: Number(followUpMaxAgeMs) });
  });
  return result;
}

function emitWorkerEvent({ roots, taskId, eventType, worker, generation, payload }) {
  return withHomeLock(roots.foremanHome, () => coordination.emitWorkerEventUnlocked({ roots, taskId, eventType, worker, generation, payload }));
}

function recordWorkerHeartbeat({ roots, taskId, worker, generation, pid, endpoint }) {
  return withHomeLock(roots.foremanHome, () => coordination.recordHeartbeatUnlocked({ roots, taskId, worker, generation, pid, endpoint }));
}

function observeRuntime({ roots, adapter, missingConfirmationMs = 1000 }) { return coordination.observeOnce({ roots, adapter, missingConfirmationMs }); }
function reconcileFleet({ roots, adapter, emitEvents = true, missingConfirmationMs = 1000, requireCompletionPackage = true }) { return coordination.reconcileFleet({ roots, adapter, emitEvents, missingConfirmationMs, requireCompletionPackage }); }
function drainWakeQueue({ roots, handler, limit }) { return coordination.drainWakeQueue({ roots, handler, limit }); }
function recoverProcessingEvents({ roots, maxAgeMs }) { return coordination.recoverProcessingEvents({ roots, maxAgeMs }); }

function restartReconcile({ roots, adapter, eventHandler, retryMessages: retry = true }) {
  initHome(roots);
  let inbox = { applied: [], quarantined: [] };
  let retried = [];
  withHomeLock(roots.foremanHome, () => {
    const stateRoot = path.join(roots.foremanHome, "state", "tasks");
    if (fs.existsSync(stateRoot)) {
      for (const taskId of fs.readdirSync(stateRoot)) {
        if (!fs.existsSync(metaFile(roots.foremanHome, taskId))) continue;
        const result = reconcileInboxUnlocked({ roots, taskId });
        inbox.applied.push(...result.applied);
        inbox.quarantined.push(...result.quarantined);
      }
    }
    coordination.recoverProcessingEventsUnlocked({ roots });
    if (retry) retried = coordination.retryMessagesUnlocked({ roots, adapter });
    coordination.retainHandledEvents({ roots });
  });
  const handled = drainWakeQueue({ roots, handler: eventHandler });
  const fleet = withHomeLock(roots.foremanHome, () => {
    const result = coordination.reconcileFleetUnlocked({ roots, adapter, emitEvents: true });
    const observerFile = path.join(coordination.coordinationDirs(roots.foremanHome).observer, "last-observation.json");
    atomicJson(observerFile, { schemaVersion: 1, observedAt: now(), taskCount: result.tasks.length, workerCount: result.workers.length, tasks: result.tasks.map(({ taskId, meta, state, consistency, missingSince, missingCount, worker }) => ({ taskId, state, evidence: { generation: meta.generation, consistency, worker: worker || null }, missingSince, missingCount })) });
    return result;
  });
  return { inbox, fleet, retried, handled };
}

function buildHandoff({ roots, taskId, reason }) { return coordination.buildHandoffPackage({ roots, taskId, reason }); }

function recoverDeadWorker({ roots, taskId, adapter, owner, requireMessageAck = true, maxRecoveryAttempts = 3, missingConfirmationMs = 1000 }) {
  const fleet = coordination.reconcileFleet({ roots, adapter, emitEvents: true, missingConfirmationMs });
  const item = fleet.tasks.find((entry) => entry.taskId === taskId);
  if (!item || !["dead", "missing"].includes(item.state)) throw new ValidationError("Automatic recovery requires confirmed dead or missing runtime evidence");
  const handoff = buildHandoff({ roots, taskId, reason: item.state });
  let meta;
  withHomeLock(roots.foremanHome, () => {
    meta = readMeta(roots.foremanHome, taskId);
    const attempts = Number(meta.recoveryAttempts || 0);
    if (attempts >= Math.max(1, Number(maxRecoveryAttempts) || 3)) {
      coordination.createObserverEvent({ roots, eventType: "worker.recovery-exhausted", dedupKey: `${taskId}:${meta.generation}:recovery-exhausted`, taskId, projectId: meta.projectId, worker: meta.owner, generation: meta.generation, endpoint: meta.endpoint, evidence: { attempts, maxRecoveryAttempts }, source: "recovery" });
      throw new ValidationError("Automatic worker recovery attempt limit is exhausted");
    }
    atomicJson(metaFile(roots.foremanHome, taskId), { ...meta, recoveryAttempts: attempts + 1, handoffPending: handoff.handoffId });
    atomicWrite(path.join(taskStateDir(roots.foremanHome, taskId), "handoff.json"), `${JSON.stringify(handoff, null, 2)}\n`);
  });
  let assignment;
  try {
    assignment = assignTask({ roots, taskId, owner: owner || `${meta.owner || "worker"}-recovery`, adapter, workspacePath: meta.workspace, resources: meta.resources, requireMessageAck, handoff });
  } catch (error) {
    withHomeLock(roots.foremanHome, () => {
      const current = readMeta(roots.foremanHome, taskId);
      atomicJson(metaFile(roots.foremanHome, taskId), { ...current, recoveryAttempts: Math.max(Number(current.recoveryAttempts || 0), Number(meta.recoveryAttempts || 0) + 1), handoffPending: handoff.handoffId });
    });
    throw error;
  }
  const handoffMessage = sendWorkerMessage({ roots, taskId, kind: "recovery-handoff", payload: { ...handoff, generation: assignment.generation, owner: assignment.owner, endpoint: assignment.endpoint }, adapter, requireAck: true, maxAttempts: 3 });
  withHomeLock(roots.foremanHome, () => {
    const current = readMeta(roots.foremanHome, taskId);
    atomicJson(metaFile(roots.foremanHome, taskId), { ...current, handoffMessageId: handoffMessage.message.messageId, handoffPending: true });
  });
  return { ...assignment, handoff, handoffMessage: handoffMessage.message };
}

function listTasks({ roots, projectId, statuses } = {}) {
  initHome(roots);
  const root = path.join(roots.foremanHome, "state", "tasks");
  const allowed = statuses ? new Set(statuses) : null;
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((id) => fs.existsSync(metaFile(roots.foremanHome, id))).map((id) => readMeta(roots.foremanHome, id)).filter((meta) => (!projectId || meta.projectId === projectId) && (!allowed || allowed.has(meta.status)));
}

function fleetStatus({ roots, adapter, projectId, emitEvents = true, missingConfirmationMs = 1000 } = {}) {
  const reconciliation = reconcileFleet({ roots, adapter, emitEvents, missingConfirmationMs });
  const reconciledById = new Map(reconciliation.tasks.map((item) => [item.taskId, item]));
  const tasks = listTasks({ roots, projectId }).map((meta) => reconciledById.get(meta.taskId) || ({ taskId: meta.taskId, meta, worker: null, state: meta.status, consistency: null, issues: [] }));
  const workers = projectId ? reconciliation.workers.filter((worker) => tasks.some((item) => item.worker && (item.worker.endpoint || item.worker.endpointId || item.worker.pane_id || item.worker.name) === (worker.endpoint || worker.endpointId || worker.pane_id || worker.name))) : reconciliation.workers;
  const byStatus = {};
  for (const item of tasks) byStatus[item.state] = (byStatus[item.state] || 0) + 1;
  return {
    scope: projectId ? { projectId } : { fleet: true },
    observedAt: now(),
    workers,
    tasks,
    counts: { tasks: tasks.length, workers: workers.length, states: byStatus },
    anomalies: tasks.flatMap((item) => item.issues || []),
  };
}

function projectStatus({ roots, adapter, projectId, emitEvents = true, missingConfirmationMs = 1000 } = {}) {
  if (!projectId) throw new ValidationError("Project status requires a project ID");
  findProject(roots.foremanHome, projectId);
  return fleetStatus({ roots, adapter, projectId, emitEvents, missingConfirmationMs });
}

function dispatchReadyTasks({ roots, adapter, ownerForTask, maxConcurrency = Infinity, projectLimits = {}, assignmentOptions = {} }) {
  const active = listTasks({ roots }).filter((meta) => ["working", "pending-ack", "blocked", "waiting-decision"].includes(meta.status));
  const results = [];
  const fleetLimit = Number.isFinite(Number(maxConcurrency)) ? Number(maxConcurrency) : Infinity;
  const counts = new Map();
  for (const meta of active) counts.set(meta.projectId, (counts.get(meta.projectId) || 0) + 1);
  for (const task of listTasks({ roots, statuses: ["queued", "pending"] })) {
    if (results.length + active.length >= fleetLimit) break;
    const limit = Object.prototype.hasOwnProperty.call(projectLimits, task.projectId) ? Number(projectLimits[task.projectId]) : Infinity;
    if ((counts.get(task.projectId) || 0) >= limit) continue;
    const owner = ownerForTask?.(task) || task.owner;
    if (!owner) continue;
    try {
      const assignment = assignTask({ roots, taskId: task.taskId, owner, adapter, ...assignmentOptions });
      results.push(assignment);
      counts.set(task.projectId, (counts.get(task.projectId) || 0) + 1);
    } catch (error) {
      if (!(error instanceof ResourceBusyError) && !(error instanceof ValidationError)) throw error;
    }
  }
  return results;
}

function validateDispatchProfile(profile, capabilities = {}) {
  if (profile === undefined || profile === null) return null;
  if (typeof profile !== "object" || !profile.name) throw new ValidationError("Dispatch profile must have a name");
  for (const key of ["agentKind", "model", "reasoningEffort"]) if (profile[key] !== undefined && capabilities[key] === false) throw new ValidationError(`Runtime does not support dispatch profile field: ${key}`);
  return { ...profile };
}

module.exports = {
  ForemanError, HomeLockError, ValidationError, StaleGenerationError, CleanupRefusedError, DeliveryError, ResourceBusyError,
  HerdrAdapter, atomicWrite, atomicJson, resolveRoots, initHome, HomeLock, withHomeLock, validateVersionedRecord, migrateJsonRecord,
  registerProject, createTask, assignTask, recordPackage, reconstructTask, acceptTask, markLanded, releaseEndpoint, cleanupTask,
  acknowledgeTaskMessage, sendWorkerMessage, createDecision, answerDecision, deliverDecision, acknowledgeDecision, applyDecision, promoteScout, triageBlocker,
  observeRuntime, reconcileFleet, drainWakeQueue, recoverProcessingEvents, recoverDeadWorker, buildHandoff, reconcileInbox, reconcileInboxUnlocked,
  restartReconcile,
  listTasks, fleetStatus, projectStatus, dispatchReadyTasks, validateDispatchProfile,
  claimResources, releaseResources, renewResources, listResourceLeases, normalizeResourceClaims,
  findProject, validateWorkspace, isWithin, assertRealWithin,
  canonical, gitBranch, gitTop, gitCommonDir,
  createMessage: coordination.createMessage, acknowledgeMessage: coordination.acknowledgeMessage,
  listMessages: coordination.listMessages, retryMessages: coordination.retryMessages,
  createObserverEvent: coordination.createObserverEvent, listEvents: coordination.listEvents,
  coordinationDirs: coordination.coordinationDirs,
  DeterministicObserver: coordination.DeterministicObserver,
  WakeManager: coordination.WakeManager,
  emitWorkerEvent, recordWorkerHeartbeat,
  readWakeSignal: coordination.readWakeSignal,
  readWorkerRegistry: coordination.readWorkerRegistry,
};
