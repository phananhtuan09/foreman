const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { HerdrAdapter } = require("./herdr");

class ForemanError extends Error {}
class HomeLockError extends ForemanError {}
class ValidationError extends ForemanError {}
class StaleGenerationError extends ForemanError {}
class CleanupRefusedError extends ForemanError {}
class DeliveryError extends ForemanError {}
class ResourceBusyError extends ForemanError {}

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
  const projectsFile = path.join(roots.foremanHome, "data", "projects.json");
  if (!fs.existsSync(projectsFile)) atomicJson(projectsFile, { version: 1, projects: [] });
  const sequence = path.join(roots.foremanHome, "data", "sequence.json");
  if (!fs.existsSync(sequence)) atomicJson(sequence, { task: 1 });
  const backlog = path.join(roots.foremanHome, "data", "backlog.md");
  if (!fs.existsSync(backlog)) atomicWrite(backlog, "## Tasks\n\n");
  const done = path.join(roots.foremanHome, "data", "done.md");
  if (!fs.existsSync(done)) atomicWrite(done, "## Done\n\n");
  const resources = resourceFile(roots.foremanHome);
  if (!fs.existsSync(resources)) atomicJson(resources, { version: 1, leases: [] });
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

function loadProjects(home) { return readJson(projectFile(home)).projects || []; }
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
  if (!fs.existsSync(file)) return { version: 1, leases: [] };
  const state = readJson(file);
  return { version: 1, leases: Array.isArray(state.leases) ? state.leases : [] };
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
  atomicJson(resourceFile(roots.foremanHome), state);
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
    atomicJson(resourceFile(roots.foremanHome), state);
    return lease;
  });
}

function listResourceLeases({ roots } = {}) {
  return withHomeLock(roots.foremanHome, () => {
    const state = pruneResourceLeases(loadResourceState(roots.foremanHome));
    atomicJson(resourceFile(roots.foremanHome), state);
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
    if (projects.length >= 1) throw new ValidationError("Milestone 1 permits exactly one registered project");
    if (projects.some((p) => p.id === id || p.root === projectRoot)) throw new ValidationError("Duplicate project id or root");
    const project = { id, name, root: projectRoot, defaultBranch, deliveryMode, enabled: true };
    atomicJson(projectFile(roots.foremanHome), { version: 1, projects: [...projects, project] });
    return project;
  });
}

function allocateTaskId(home) {
  const file = path.join(home, "data", "sequence.json");
  const sequence = readJson(file);
  const id = `T-${String(sequence.task).padStart(6, "0")}`;
  sequence.task += 1;
  atomicJson(file, sequence);
  return id;
}

function createTask({ roots, projectId, brief }) {
  if (typeof brief !== "string" || !brief) throw new ValidationError("Task brief must be non-empty verbatim text");
  return withHomeLock(roots.foremanHome, () => {
    initHome(roots);
    const project = findProject(roots.foremanHome, projectId);
    const id = allocateTaskId(roots.foremanHome);
    const dir = taskDir(roots.foremanHome, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(taskStateDir(roots.foremanHome, id), { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dir, "brief.md"), brief);
    atomicWrite(path.join(dir, "decisions.md"), "");
    atomicWrite(path.join(dir, "report.md"), "");
    atomicWrite(path.join(dir, "history.jsonl"), `${JSON.stringify({ at: now(), status: "queued", projectId })}\n`);
    atomicJson(metaFile(roots.foremanHome, id), { taskId: id, projectId: project.id, owner: null, generation: 0, workspace: null, branch: null, resources: [], resourceLease: null, backend: "herdr", endpoint: null, status: "queued" });
    updateBacklog(roots.foremanHome, id, "[ ]", project.id, brief);
    return { id, projectId: project.id, brief };
  });
}

function assignTask({ roots, taskId, owner, adapter, workspacePath, cwd, projectId, resources, preflight, leaseTtlMs }) {
  if (!owner) throw new ValidationError("An assignment owner is required");
  owner = String(owner).replace(/^@/, "");
  return withHomeLock(roots.foremanHome, () => {
    initHome(roots);
    const brief = fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8");
    const prior = fs.existsSync(metaFile(roots.foremanHome, taskId)) ? readJson(metaFile(roots.foremanHome, taskId)) : null;
    const actualProjectId = projectId || prior?.projectId;
    if (!actualProjectId) throw new ValidationError("Task has no project binding");
    if (prior?.projectId && projectId && prior.projectId !== projectId) throw new ValidationError("Task project binding cannot be changed");
    const project = findProject(roots.foremanHome, actualProjectId);
    const generation = prior?.status === "pending" && !prior?.resourceLease
      ? (prior.generation || 0)
      : (prior?.generation || 0) + 1;
    const workspace = validateWorkspace(project, workspacePath || cwd || project.root);
    const requestedResources = resources === undefined && preflight === undefined
      ? [{ key: `workspace/${project.id}`, mode: "exclusive" }]
      : (resources === undefined ? preflight : resources);
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
      taskId,
      projectId: project.id,
      owner,
      generation,
      workspace: workspace.path,
      branch: workspace.branch,
      resources: resourceLease.resources,
      resourceLease,
      backend: "herdr",
      endpoint: null,
      status: "pending",
    };
    atomicJson(metaFile(roots.foremanHome, taskId), pending);
    try {
      if (prior?.endpoint && prior.status !== "queued") {
        if (typeof adapter?.stop !== "function" || typeof adapter?.inspect !== "function") throw new DeliveryError("Previous worker must be stopped before reassignment");
        const stopped = adapter.stop(prior.endpoint);
        if (stopped === false || stopped?.stopped === false) throw new DeliveryError("Previous worker teardown was not confirmed");
        const inspectedPrior = adapter.inspect(prior.endpoint);
        if (inspectedPrior && inspectedPrior.status !== "missing" && inspectedPrior.status !== "stopped") throw new DeliveryError("Previous worker remains active; refusing reassignment");
      }
      if (!adapter || typeof adapter.verifyCompatibility !== "function" || typeof adapter.spawn !== "function" || typeof adapter.inspect !== "function" || typeof adapter.send !== "function") throw new DeliveryError("Herdr adapter is required");
      adapter.verifyCompatibility();
      const spawned = adapter.spawn({ taskId, projectId: project.id, owner, generation, cwd: workspace.path, branch: workspace.branch, resources: resourceLease.resources, resourceLeaseId: resourceLease.leaseId, workspaceMode: "shared-current-branch", gitAuthority: "client", brief });
      const endpoint = spawned?.endpoint || spawned?.endpointId;
      if (!endpoint) throw new DeliveryError("Herdr did not return an endpoint identity");
      const inspected = adapter.inspect(endpoint);
      if (!inspected || inspected.endpoint !== endpoint || inspected.cwd !== workspace.path || inspected.owner !== owner) throw new DeliveryError("Herdr endpoint identity verification failed");
      const delivered = adapter.send(endpoint, { taskId, projectId: project.id, owner, generation, cwd: workspace.path, branch: workspace.branch, resources: resourceLease.resources, resourceLeaseId: resourceLease.leaseId, workspaceMode: "shared-current-branch", gitAuthority: "client", instructions: ["Do not run git switch, reset, clean, merge, or commit.", "Do not change files outside the leased resources.", "Request a new resource lease before expanding scope."], brief, reportPath: path.join(taskStateDir(roots.foremanHome, taskId), "inbox", `generation-${generation}-completion.md`) });
      if (delivered === false || delivered?.delivered === false) throw new DeliveryError("Herdr did not confirm brief delivery");
      const assigned = { ...pending, endpoint, status: "working", assignedAt: now() };
      if (prior?.resourceLease) releaseResourcesUnlocked({ roots, leaseId: prior.resourceLease.leaseId });
      atomicJson(metaFile(roots.foremanHome, taskId), assigned);
      updateBacklog(roots.foremanHome, taskId, "[~]", project.id, brief, owner, generation);
      appendHistory(roots.foremanHome, taskId, { at: now(), status: "working", owner, generation, workspace: workspace.path });
      return assigned;
    } catch (error) {
      releaseResourcesUnlocked({ roots, leaseId: resourceLease.leaseId });
      if (prior) atomicJson(metaFile(roots.foremanHome, taskId), prior);
      else {
        atomicJson(metaFile(roots.foremanHome, taskId), { taskId, projectId: project.id, owner: null, generation: 0, workspace: null, branch: null, resources: [], resourceLease: null, backend: "herdr", endpoint: null, status: "queued", dispatchError: error.message });
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

function readMeta(home, taskId) { return readJson(metaFile(home, taskId)); }

function recordPackage({ roots, taskId, raw, type }) {
  if (typeof raw !== "string" || !raw) throw new ValidationError("Worker package must preserve non-empty original text");
  return withHomeLock(roots.foremanHome, () => recordPackageUnlocked({ roots, taskId, raw, type }));
}

function recordPackageUnlocked({ roots, taskId, raw, type }) {
  const meta = readMeta(roots.foremanHome, taskId);
  const headers = Object.fromEntries(raw.split(/\r?\n/).slice(0, 12).map((line) => line.match(/^([A-Z _]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2]]));
  const generation = Number(headers.GENERATION);
  const projectId = headers.PROJECT;
  const agent = (headers.AGENT || "").replace(/^@/, "");
  const packageType = (headers.TYPE || type || "").toLowerCase();
  if (generation !== meta.generation || projectId !== meta.projectId || agent !== meta.owner || packageType !== String(type).toLowerCase() || (headers.TASK && headers.TASK !== taskId)) {
    const quarantine = path.join(taskStateDir(roots.foremanHome, taskId), "inbox", "quarantine");
    fs.mkdirSync(quarantine, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(quarantine, `${Date.now()}-stale.md`), raw);
    throw new StaleGenerationError("Worker package does not match the current assignment generation");
  }
  const dir = path.join(taskStateDir(roots.foremanHome, taskId), "inbox");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `generation-${generation}-${type}.md`);
  atomicWrite(file, raw);
  if (type === "completion") atomicWrite(path.join(taskDir(roots.foremanHome, taskId), "report.md"), raw);
  else atomicWrite(path.join(taskStateDir(roots.foremanHome, taskId), "progress"), raw);
  if (type === "completion") {
    const next = { ...meta, status: "review-ready", completionPackage: file };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    updateBacklog(roots.foremanHome, taskId, "[v]", meta.projectId, fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8"), meta.owner, meta.generation);
    appendHistory(roots.foremanHome, taskId, { at: now(), status: "review-ready", generation });
  }
  return { file, generation, type };
}

function acceptTask({ roots, taskId }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    if (meta.status !== "review-ready") throw new ValidationError("Only review-ready tasks can be accepted");
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
    if (!adapter || typeof adapter.stop !== "function" || typeof adapter.inspect !== "function") throw new CleanupRefusedError("Endpoint teardown cannot be verified");
    const stopped = adapter.stop(meta.endpoint);
    if (stopped === false || stopped?.stopped === false) throw new CleanupRefusedError("Endpoint teardown was not confirmed");
    let inspection;
    try { inspection = adapter.inspect(meta.endpoint); } catch (_) { throw new CleanupRefusedError("Endpoint inspection failed; refusing cleanup"); }
    if (!inspection || (inspection.status !== "missing" && inspection.status !== "stopped")) throw new CleanupRefusedError("Endpoint remains active or unverifiable");
    const next = { ...meta, endpoint: null, endpointReleasedAt: now() };
    atomicJson(metaFile(roots.foremanHome, taskId), next);
    return next;
  });
}

function cleanupTask({ roots, taskId, discard = false, authorization = false, workspaceReleased = false }) {
  return withHomeLock(roots.foremanHome, () => {
    const meta = readMeta(roots.foremanHome, taskId);
    if (meta.deliveryState !== "landed" && !(discard && authorization)) throw new CleanupRefusedError("Cleanup refused while work is unlanded");
    if (meta.endpoint) throw new CleanupRefusedError("Cleanup requires endpoint teardown proof");
    if (!workspaceReleased && !(discard && authorization)) throw new CleanupRefusedError("Client workspace release proof is required");
    if (meta.resourceLease) releaseResourcesUnlocked({ roots, leaseId: meta.resourceLease.leaseId });
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

module.exports = {
  ForemanError, HomeLockError, ValidationError, StaleGenerationError, CleanupRefusedError, DeliveryError, ResourceBusyError,
  HerdrAdapter, atomicWrite, atomicJson, resolveRoots, initHome, HomeLock, withHomeLock,
  registerProject, createTask, assignTask, recordPackage, reconstructTask, acceptTask, markLanded, releaseEndpoint, cleanupTask,
  claimResources, releaseResources, renewResources, listResourceLeases, normalizeResourceClaims,
  findProject, validateWorkspace, isWithin, assertRealWithin,
};
