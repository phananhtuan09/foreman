const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const core = require("./foreman");
const coordination = require("./coordination");

const SLP_BACKEND = "paseo";
const SLP_BACKENDS = new Set(["paseo", "herdr"]);
const SLP_PROTOCOL = "foreman-slp/v1";
const PEER_ROLES = new Set(["exploration", "audit", "implementation", "review", "correction"]);
const REQUEST_ACTIONS = new Set(["create-peer", "message-peer", "record-review", "report-task"]);
const ACTIVE_PEER_STATES = new Set(["working", "blocked", "waiting-decision", "pending"]);
const MAX_CORRECTION_CYCLES = 2;
const LEAD_CONTEXT_ROLLOVER_RATIO = 0.8;
const LEAD_FALLBACK_ACTIONABLE_TURNS = 32;
const ACTIVE_TURN_NO_PROGRESS_MS = 15 * 60 * 1000;
// Waits that clear when other state changes; uncertain-endpoint and decision waits are never retried here.
const REEVALUATED_WAITS = new Set(["resource", "capacity", "prerequisite"]);

class SlpError extends core.ValidationError {}

function now() { return new Date().toISOString(); }
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function boundedSummary(value, limit = 1200) {
  const text = String(value || "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
function runtimeAttentionReason(inspection, fallback) {
  const detail = typeof inspection.lastError === "string" ? inspection.lastError : inspection.lastError?.message;
  return boundedSummary([inspection.attentionReason || fallback, detail].filter(Boolean).join(": "));
}
function slpData(home) { return path.join(home, "data", "slp"); }
function leadsDir(home) { return path.join(slpData(home), "leads"); }
function leadDir(home, projectId) { return path.join(leadsDir(home), projectId); }
function leadFile(home, projectId) { return path.join(leadDir(home, projectId), "meta.json"); }
function requestDir(home, projectId, generation) { return path.join(leadDir(home, projectId), "requests", `g${generation}`); }
function requestFile(home, projectId, generation, requestId) { return path.join(requestDir(home, projectId, generation), `${requestId}.json`); }
function taskDir(home, taskId) { return path.join(home, "data", "tasks", taskId); }
function taskMetaFile(home, taskId) { return path.join(taskDir(home, taskId), "meta.json"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function readTask(home, taskId) {
  const file = taskMetaFile(home, taskId);
  if (!fs.existsSync(file)) throw new SlpError(`Unknown SLP task: ${taskId}`);
  const meta = readJson(file);
  if (meta.schemaVersion !== 1 || meta.taskId !== taskId) throw new SlpError(`Task record identity is invalid: ${taskId}`);
  return meta;
}
function readLead(home, projectId) {
  const file = leadFile(home, projectId);
  if (!fs.existsSync(file)) return null;
  const lead = readJson(file);
  if (lead.schemaVersion !== 1 || lead.projectId !== projectId || !Number.isInteger(lead.generation)) throw new SlpError(`Project Lead record identity is invalid: ${projectId}`);
  return lead;
}
function writeTaskUnlocked(roots, meta) {
  core.atomicJson(taskMetaFile(roots.foremanHome, meta.taskId), meta);
  return meta;
}
function writeTask(roots, meta) {
  return core.withHomeLock(roots.foremanHome, () => writeTaskUnlocked(roots, meta));
}
function adapterBackend(adapter) { return adapter?.backend || "herdr"; }
// Herdr has no timeline cursor, message IDs, or structured turn output, so the Lead and Peers use command-submitted requests and reports there.
function usesTimeline(adapter) { return adapterBackend(adapter) === "paseo"; }
function assertSlpBackend(adapter, operation) {
  const backend = adapterBackend(adapter);
  if (!SLP_BACKENDS.has(backend)) {
    throw new SlpError(`SLP ${operation} is not supported on ${backend}; existing Supervisor–Worker tasks remain available`);
  }
  if (!adapter || typeof adapter.verifyCompatibility !== "function") throw new SlpError(`SLP requires a verified ${backend} adapter`);
  const result = adapter.verifyCompatibility();
  if (result === false || result?.compatible === false) throw new SlpError(`${backend} compatibility is not verified for SLP`);
  if (backend === "herdr" && (typeof adapter.list !== "function" || typeof adapter.stop !== "function" || typeof adapter.send !== "function")) {
    throw new SlpError("Herdr SLP requires list, send, and stop support; new SLP dispatch is refused without changing backend");
  }
}
// Herdr agent names are limited to 32 lowercase characters, so long project IDs are hashed.
function runtimeOwnerName(adapter, prefix, projectId, suffix) {
  const plain = `${prefix}-${projectId}-${suffix}`;
  if (usesTimeline(adapter) || /^[a-z][a-z0-9_-]{0,31}$/.test(plain)) return plain;
  return `${prefix}-${digest(projectId).slice(0, 8)}-${suffix}`;
}
function recoveredPeerOwner(adapter, peer) {
  const generation = peer.generation + 1;
  return usesTimeline(adapter) ? `${peer.projectId}-${peer.taskId}-r${generation}`.toLowerCase() : `slp-${peer.taskId}-r${generation}`.toLowerCase();
}

// Herdr cannot read a spawned agent's model or mode back; its profile fields are checked only against the configured tool.
const PROFILE_CAPABILITIES = {
  paseo: { provider: true, model: true, modeId: true, thinkingOptionId: true, featureValues: true },
  herdr: { agentKind: true, tool: true, command: true, model: true, reasoningEffort: false },
};
function configuredProfile({ roots, profileName, backend = SLP_BACKEND }) {
  const routing = core.initRoutingConfig({ roots, backend }).config;
  if (routing.inactiveProfiles.includes(profileName)) throw new SlpError(`Worker profile is inactive: ${profileName}`);
  const selected = routing.profiles[profileName];
  if (!selected) throw new SlpError(`Unknown worker profile: ${profileName}`);
  const profile = core.materializeDispatchProfile(backend, selected, profileName);
  return core.validateDispatchProfile(profile, PROFILE_CAPABILITIES[backend] || {});
}

function skillPathFor(projectRoot, profile) {
  const tool = profile?.provider || profile?.tool;
  if (tool === "claude") return path.join(projectRoot, ".claude", "skills", "foreman-lead", "SKILL.md");
  if (tool === "opencode") return path.join(projectRoot, ".claude", "skills", "foreman-lead", "SKILL.md");
  if (tool === "codex" || tool === "antigravity") return path.join(projectRoot, ".agents", "skills", "foreman-lead", "SKILL.md");
  throw new SlpError(`No supported local Lead skill discovery path for ${tool || "the selected tool"}`);
}

function verifyPilotPrerequisites({ roots, project, profile }) {
  const skillFile = skillPathFor(project.root, profile);
  if (!fs.existsSync(skillFile)) throw new SlpError(`Compatible local foreman-lead skill is missing: ${skillFile}`);
  const skill = fs.readFileSync(skillFile, "utf8");
  const frontmatter = skill.match(/^---\s*\n([\s\S]*?)\n---/);
  const protocolDeclaration = new RegExp(`^metadata:\\s*\\n[ \\t]+protocol:\\s*["']?${SLP_PROTOCOL.replaceAll("/", "\\/")}["']?\\s*$`, "m");
  if (!frontmatter || !/^name:\s*foreman-lead\s*$/m.test(frontmatter[1]) || !protocolDeclaration.test(frontmatter[1])) {
    throw new SlpError(`Installed foreman-lead skill is incompatible with ${SLP_PROTOCOL}`);
  }
  const instructionFiles = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map((name) => path.join(project.root, name)).filter((file) => fs.existsSync(file));
  if (!instructionFiles.length) throw new SlpError("Project has no discoverable root agent instructions");
  return { skillFile, instructionFiles, workflowFile: fs.existsSync(path.join(project.root, "docs", "WORKFLOW.md")) ? path.join(project.root, "docs", "WORKFLOW.md") : null };
}

function projectStatePath(projectRoot) { return path.join(projectRoot, ".foreman", "project-state.json"); }

function ensureLocalGitExclude(project) {
  if (core.projectVcs(project) !== "git") return;
  let exclude;
  try {
    const { execFileSync } = require("node:child_process");
    const gitPath = execFileSync("git", ["-C", project.root, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
    exclude = path.isAbsolute(gitPath) ? gitPath : path.resolve(project.root, gitPath);
  } catch (error) {
    throw new SlpError(`Cannot configure the project-local ignore for generated Foreman state: ${error.message}`);
  }
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  if (/^\/?\.foreman\/?$/m.test(current)) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const suffix = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(exclude, `${suffix}# Foreman generated project view\n/.foreman/\n`);
}

function listSlpTasks(roots, projectId) {
  return core.listTasks({ roots, projectId }).filter((meta) => core.taskModel(meta) === "slp");
}
function leadReconstructionTasks(roots, projectId) {
  return listSlpTasks(roots, projectId).filter((item) => ["working", "blocked", "waiting-decision"].includes(item.status)
    || (item.status === "queued" && item.profileConfirmedAt && item.dispatchProfile));
}
function listPeerTasks(roots, parentTaskId) {
  return core.listTasks({ roots }).filter((meta) => meta.taskModel === "slp-peer" && meta.parentTaskId === parentTaskId);
}

function buildProjectState({ roots, projectId }) {
  const project = core.findProject(roots.foremanHome, projectId);
  const lead = readLead(roots.foremanHome, projectId);
  const closing = new Set(closedTaskMetrics(roots, projectId).filter((item) => item.status === "closing").map((item) => item.taskId));
  const tasks = listSlpTasks(roots, projectId).filter((meta) => !["accepted", "cleaned"].includes(meta.status)).map((meta) => {
    const briefFile = path.join(taskDir(roots.foremanHome, meta.taskId), "brief.md");
    const reviewFile = meta.latestReviewId ? path.join(taskDir(roots.foremanHome, meta.taskId), "reviews", `${meta.latestReviewId}.json`) : null;
    const latestReview = reviewFile && fs.existsSync(reviewFile) ? readJson(reviewFile) : null;
    const waits = outstandingWaits(roots, projectId).filter((request) => request.taskId === meta.taskId)
      .map((request) => ({ requestId: request.requestId, kind: request.outcome.waitKind, reason: request.outcome.reason }));
    return {
      taskId: meta.taskId,
      status: closing.has(meta.taskId) ? "closing" : meta.status,
      brief: fs.existsSync(briefFile) ? fs.readFileSync(briefFile, "utf8") : null,
      leadGeneration: meta.leadGeneration ?? null,
      waitingReason: meta.waitingReason || null,
      peerAssignments: listPeerTasks(roots, meta.taskId).map((peer) => ({
        assignmentId: peer.taskId,
        generation: peer.generation,
        role: peer.peerRole,
        status: peer.peerRuntimeStopped ? "stopped" : peer.status,
        endpoint: peer.endpoint || null,
        resources: peer.resources || [],
        dependencies: peer.slpPeerDependencies || [],
        report: peer.lastReport ? { status: peer.lastReport.status, summary: boundedSummary(readReportPayload(peer)?.summary), file: peer.lastReport.file, at: peer.lastReport.at } : null,
        reviewResolvedBy: peer.slpResolvedBy || null,
        reviewMilestoneId: peer.reviewMilestoneId || null,
      })),
      waits,
      latestReviewId: meta.latestReviewId || null,
      latestReview: latestReview ? { outcome: latestReview.outcome, summary: latestReview.summary, evidence: latestReview.evidence, changedSurfaces: latestReview.changedSurfaces, checks: latestReview.checks, unresolvedRisks: latestReview.unresolvedRisks } : null,
      purpose: meta.purpose || "delivery",
      nextAction: closing.has(meta.taskId) ? "resume-acceptance" : (meta.status === "review-ready" ? "human-acceptance" : (meta.status === "proof-complete" ? "proof-recorded" : (meta.status === "waiting-decision" ? "human-decision" : ((meta.waitingReason || waits.length) ? "wait-for-resource-or-prerequisite" : "project-lead")))),
    };
  });
  const pendingDecisions = tasks.flatMap((task) => {
    const directory = path.join(taskDir(roots.foremanHome, task.taskId), "decisions");
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(directory, name))).filter((record) => record.status === "pending").map((record) => ({ decisionId: record.decisionId, taskId: record.taskId, finding: record.finding, createdAt: record.createdAt }));
  });
  const requests = [];
  const requestsRoot = path.join(leadDir(roots.foremanHome, projectId), "requests");
  if (fs.existsSync(requestsRoot)) {
    for (const generation of fs.readdirSync(requestsRoot)) {
      const directory = path.join(requestsRoot, generation);
      if (!fs.statSync(directory).isDirectory()) continue;
      for (const name of fs.readdirSync(directory).filter((item) => item.endsWith(".json"))) {
        const request = readJson(path.join(directory, name));
        if (request.schemaVersion === 1 && request.projectId === projectId && ["pending", "waiting"].includes(request.status)) {
          requests.push({
            requestId: request.requestId,
            taskId: request.taskId,
            leadGeneration: request.leadGeneration,
            action: request.action,
            status: request.status,
            outcome: request.outcome ? {
              status: request.outcome.status || null,
              reason: request.outcome.reason || null,
              blockedBy: request.outcome.blockedBy || null,
            } : null,
            updatedAt: request.updatedAt,
          });
        }
      }
    }
  }
  return {
    schemaVersion: 1,
    projectId,
    projectRoot: project.root,
    generatedAt: now(),
    lead: lead ? {
      projectId,
      generation: lead.generation,
      endpoint: lead.endpoint || null,
      workspaceId: lead.workspaceId || null,
      profile: lead.profileName,
      status: lead.status,
      dispatchPaused: Boolean(lead.dispatchPaused),
      contextSignal: lead.contextSignal || null,
      actionableTurns: Number(lead.actionableTurns || 0),
      reconstructionRequired: Number(lead.reconstructionRequiredGeneration) === Number(lead.generation)
        && Number(lead.reconstruction?.leadGeneration) !== Number(lead.generation),
      reconstruction: Number(lead.reconstruction?.leadGeneration) === Number(lead.generation)
        ? lead.reconstruction
        : null,
    } : null,
    activeTasks: tasks,
    pendingDecisions,
    requests: requests.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
  };
}

function writeProjectState({ roots, projectId }) {
  return core.withHomeLock(roots.foremanHome, () => {
    const project = core.findProject(roots.foremanHome, projectId);
    ensureLocalGitExclude(project);
    const file = projectStatePath(project.root);
    core.atomicJson(file, buildProjectState({ roots, projectId }));
    return file;
  });
}

function recordAnomaly({ roots, projectId, taskId = null, assignmentId = null, type, reason, endpoint = null }) {
  const dir = path.join(slpData(roots.foremanHome), "anomalies");
  const existing = readAnomalies(roots, projectId).find((item) => item.taskId === taskId && item.assignmentId === assignmentId && item.endpoint === endpoint && item.type === type && item.reason === String(reason));
  if (existing) return existing;
  const id = `AN-${crypto.randomBytes(10).toString("hex")}`;
  const record = { schemaVersion: 1, anomalyId: id, projectId, taskId, assignmentId, endpoint, type, reason: String(reason), createdAt: now(), resolvedAt: null };
  core.withHomeLock(roots.foremanHome, () => core.atomicJson(path.join(dir, `${id}.json`), record));
  return record;
}

function readAnomalies(roots, projectId) {
  const dir = path.join(slpData(roots.foremanHome), "anomalies");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name))).filter((item) => !projectId || item.projectId === projectId).filter((item) => !item.resolvedAt);
}

function resolveAnomalies({ roots, projectId, endpoint, assignmentId, types }) {
  const dir = path.join(slpData(roots.foremanHome), "anomalies");
  if (!fs.existsSync(dir)) return [];
  const wantedTypes = new Set(types || []);
  return core.withHomeLock(roots.foremanHome, () => {
    const resolved = [];
    for (const name of fs.readdirSync(dir).filter((item) => item.endsWith(".json"))) {
      const file = path.join(dir, name);
      const anomaly = readJson(file);
      if (anomaly.projectId !== projectId || anomaly.resolvedAt || (wantedTypes.size && !wantedTypes.has(anomaly.type))
        || (endpoint !== undefined && anomaly.endpoint !== endpoint) || (assignmentId !== undefined && anomaly.assignmentId !== assignmentId)) continue;
      const next = { ...anomaly, resolvedAt: now() };
      core.atomicJson(file, next);
      resolved.push(next);
    }
    return resolved;
  });
}

function resolveRecoveredAnomalies({ roots, projectId, lead, peers }) {
  for (const anomaly of readAnomalies(roots, projectId)) {
    if (anomaly.type === "lead.request-invalid" && lead?.endpoint === anomaly.endpoint) {
      const laterValidRequest = requestsForLead(roots, projectId, lead.generation).some((request) => request.sourceEndpoint === lead.endpoint
        && Number(request.sourceGeneration) === Number(lead.generation)
        && Number(request.leadGeneration) === Number(lead.generation)
        && Date.parse(request.createdAt) > Date.parse(anomaly.createdAt)
        && ["dispatched", "completed", "refused"].includes(request.status));
      if (laterValidRequest) resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.request-invalid"] });
      continue;
    }
    const peer = peers.find((item) => item.taskId === anomaly.assignmentId);
    if (peer?.lastReport?.file && readReportPayload(peer)) {
      if (anomaly.type === "peer.report-missing") resolveAnomalies({ roots, projectId, assignmentId: peer.taskId, types: ["peer.report-missing"] });
      else if (anomaly.type === "peer.report-invalid" && peer.lastReport.status === "done") resolveAnomalies({ roots, projectId, assignmentId: peer.taskId, types: ["peer.report-invalid"] });
    }
    if (!peer?.peerRuntimeStopped) continue;
    if (anomaly.type === "peer.report-invalid" && peer.lastReport?.status === "done" && readReportPayload(peer)) {
      resolveAnomalies({ roots, projectId, assignmentId: peer.taskId, types: ["peer.report-invalid"] });
    } else if (anomaly.type === "peer.report-delivery-pending" && peer.peerReportDeliveredAt) {
      resolveAnomalies({ roots, projectId, assignmentId: peer.taskId, types: ["peer.report-delivery-pending"] });
    }
  }
}

function confirmProjectLeadProfile({ roots, projectId, profileName, backend = SLP_BACKEND, adapter }) {
  adapter = adapter || { backend };
  if (adapterBackend(adapter) !== backend) throw new SlpError(`Lead profile binding requested on ${backend} but the runtime adapter is ${adapterBackend(adapter)}`);
  assertSlpBackend(adapter, "Lead profile binding");
  const project = core.findProject(roots.foremanHome, projectId);
  if (profileName === undefined) profileName = core.initRoutingConfig({ roots, backend }).config.leadProfile;
  if (profileName === undefined) throw new SlpError("Configure leadProfile or pass --profile to bind the project Lead");
  const profile = configuredProfile({ roots, profileName, backend });
  core.validateDispatchProfile(profile, adapter.capabilities());
  verifyPilotPrerequisites({ roots, project, profile });
  return core.withHomeLock(roots.foremanHome, () => {
    const existing = readLead(roots.foremanHome, projectId);
    if (existing?.endpoint && !["stopped", "missing"].includes(existing.status)) throw new SlpError("Cannot change a bound Lead profile while its project session exists");
    const lead = {
      schemaVersion: 1,
      projectId,
      generation: existing?.generation || 0,
      backend,
      profileName,
      dispatchProfile: profile,
      profileConfirmedAt: now(),
      status: "bound",
      endpoint: null,
      workspaceId: null,
      workspace: project.root,
      timelineCursor: null,
      contextSignal: null,
    };
    core.atomicJson(leadFile(roots.foremanHome, projectId), lead);
    return lead;
  });
}

function leadInstruction({ roots, project, lead, reason }) {
  const viewFile = projectStatePath(project.root);
  const rootInstructions = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map((name) => path.join(project.root, name)).filter((file) => fs.existsSync(file));
  const workflow = fs.existsSync(path.join(project.root, "docs", "WORKFLOW.md")) ? path.join(project.root, "docs", "WORKFLOW.md") : null;
  return [
    `You are the project Lead for ${project.id}. Foreman SLP protocol ${SLP_PROTOCOL}.`,
    `Project root: ${project.root}`,
    `Lead generation: ${lead.generation}`,
    `Confirmed project Lead profile: ${lead.profileName}`,
    `Load and follow the installed skill: ${skillPathFor(project.root, lead.dispatchProfile)}`,
    `Read project instructions: ${rootInstructions.join(", ")}`,
    ...(workflow ? [`Read project workflow: ${workflow}`] : []),
    `Read the generated current project overview: ${viewFile}`,
    "The generated .foreman directory is read-only. Use Foreman's request protocol for every Peer operation.",
    ...(usesTimeline({ backend: lead.backend }) ? ["When no action is needed, return exactly waiting; do not invent a request or repeat a prior action."] : []),
    ...(Number(lead.reconstructionRequiredGeneration) === Number(lead.generation)
      ? ["Before any other request in this Lead generation, submit one report-task progress request with a concise summary and reconstruction object containing non-empty projectState, knowledge, and coreState summaries. The projectState summary must cover the generated overview; knowledge must cite relevant project knowledge or explicitly say none applies; coreState must summarize active tasks, decisions, and preserved Peer reports. Core will refuse other requests until this checkpoint is recorded."]
      : []),
    reason ? `\n${reason}` : "",
  ].filter(Boolean).join("\n");
}

// Paseo labels every agent with project, generation, and workspace; Herdr exposes only the name, pane, workspace, and cwd.
// Herdr generation and project identity therefore come from the durable binding and the generation-bearing owner name.
function verifyRuntimeIdentity({ adapter, expected, actual, operation }) {
  const herdr = adapterBackend(adapter) === "herdr";
  const common = actual && actual.endpoint === expected.endpoint && actual.owner === expected.owner
    && actual.cwd && core.canonical(actual.cwd) === core.canonical(expected.workspace) && actual.workspaceId === expected.workspaceId;
  const labeled = herdr ? (!expected.paneId || actual?.paneId === expected.paneId)
    : (actual?.projectId === expected.projectId && Number(actual?.generation) === Number(expected.generation));
  if (!common || !labeled) throw new SlpError(`${herdr ? "Herdr" : "Paseo"} ${operation} identity does not match the bound project assignment`);
}

// A runtime that no longer exists has no identity to compare; callers classify the `missing` state themselves.
function verifyPresentIdentity(args) {
  if (String(args.actual?.status || "").toLowerCase() === "missing") return;
  verifyRuntimeIdentity(args);
}

// Without config/slp-capacity.json the pilot stays serial: one active task and one live Peer per project.
// The file is local operator configuration; an invalid file refuses SLP work instead of widening capacity.
function slpCapacity(roots) {
  const capacity = { maxActiveTasksPerProject: 1, maxLivePeersPerProject: 1, maxSlpEndpoints: null };
  const file = path.join(roots.foremanRoot, "config", "slp-capacity.json");
  if (!fs.existsSync(file)) return capacity;
  let value;
  try { value = readJson(file); } catch (error) { throw new SlpError(`SLP capacity config is unreadable: ${error.message}`); }
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) throw new SlpError("SLP capacity config requires schemaVersion 1");
  for (const key of Object.keys(capacity)) {
    if (value[key] === undefined && key === "maxSlpEndpoints") continue;
    if (!Number.isInteger(value[key]) || value[key] < 1) throw new SlpError(`SLP capacity config ${key} must be a positive integer`);
    capacity[key] = value[key];
  }
  return capacity;
}

function livePeersForProject(roots, projectId) {
  return core.listTasks({ roots, projectId }).filter((meta) => meta.taskModel === "slp-peer"
    && ACTIVE_PEER_STATES.has(meta.status) && meta.resourceLease && !meta.peerRuntimeStopped);
}

function activeTopLevelTasks(roots, projectId, exceptTaskId) {
  return listSlpTasks(roots, projectId).filter((meta) => meta.taskId !== exceptTaskId
    && ["working", "blocked", "waiting-decision"].includes(meta.status));
}

// Bound Lead sessions plus Peer endpoints that are not verified stopped; fleet-wide, regardless of project.
function slpEndpointCount(roots) {
  const leaders = fs.existsSync(leadsDir(roots.foremanHome))
    ? fs.readdirSync(leadsDir(roots.foremanHome)).filter((projectId) => readLead(roots.foremanHome, projectId)?.endpoint).length
    : 0;
  const peers = core.listTasks({ roots }).filter((meta) => meta.taskModel === "slp-peer" && meta.endpoint && !meta.peerRuntimeStopped).length;
  return leaders + peers;
}

function endpointCapacityHeld(roots, extra = 1) {
  const { maxSlpEndpoints } = slpCapacity(roots);
  if (maxSlpEndpoints === null) return null;
  const count = slpEndpointCount(roots);
  return count + extra > maxSlpEndpoints ? { count, maxSlpEndpoints } : null;
}

function markValidationTask({ roots, taskId, purpose }) {
  if (purpose !== "validation") throw new SlpError("The only supported task-purpose transition is to validation");
  const parent = readTask(roots.foremanHome, taskId);
  if (core.taskModel(parent) !== "slp") throw new SlpError("Task purpose is available only for SLP top-level tasks");
  if (parent.purpose === "validation") return { taskId, purpose: "validation", unchanged: true };
  if (parent.purpose && parent.purpose !== "delivery") throw new SlpError(`Unsupported current task purpose: ${parent.purpose}`);
  if (!["queued", "working", "blocked", "waiting-decision"].includes(parent.status)) throw new SlpError("Only an active or queued SLP task can be marked as validation");
  const peers = listPeerTasks(roots, taskId);
  for (const peer of peers) {
    if (!["exploration", "audit"].includes(peer.peerRole)) throw new SlpError(`Validation tasks cannot contain ${peer.peerRole} Peer ${peer.taskId}`);
    if (peer.resourceLease || (peer.endpoint && !peer.peerRuntimeStopped)) throw new SlpError(`Peer ${peer.taskId} must be stopped and release its resource lease before marking validation`);
    if (!peer.peerReportDeliveredAt || !peer.lastReport?.file || !fs.existsSync(peer.lastReport.file)) throw new SlpError(`Peer ${peer.taskId} must have a preserved report delivered to the Lead before marking validation`);
  }
  const decisionsDir = path.join(taskDir(roots.foremanHome, taskId), "decisions");
  if (fs.existsSync(decisionsDir)) {
    const openDecision = fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(decisionsDir, name)))
      .find((item) => item.status === "pending" || (item.status === "answered" && !item.deliveredAt));
    if (openDecision) throw new SlpError(`Decision ${openDecision.decisionId} must be reconciled before marking validation`);
  }
  core.withHomeLock(roots.foremanHome, () => {
    const current = readTask(roots.foremanHome, taskId);
    if (current.purpose && current.purpose !== "delivery") throw new SlpError("Task purpose changed during validation marking");
    writeTaskUnlocked(roots, { ...current, purpose: "validation", purposeMarkedAt: now() });
  });
  writeProjectState({ roots, projectId: parent.projectId });
  return { taskId, purpose: "validation", peerCount: peers.length };
}

function nextProjectLeadGeneration(lead) {
  return Math.max(1, Number(lead?.generation || 0) + 1);
}

function captureContextSignal(usage) {
  if (!usage || !Number.isSafeInteger(usage.contextWindowUsedTokens) || usage.contextWindowUsedTokens < 0
    || !Number.isSafeInteger(usage.contextWindowMaxTokens) || usage.contextWindowMaxTokens <= 0
    || usage.contextWindowUsedTokens > usage.contextWindowMaxTokens) return null;
  return { usedTokens: usage.contextWindowUsedTokens, maxTokens: usage.contextWindowMaxTokens, observedAt: now() };
}

function validContextSignal(signal) {
  const observedAt = Date.parse(signal?.observedAt || "");
  return Number.isSafeInteger(signal?.usedTokens) && signal.usedTokens >= 0
    && Number.isSafeInteger(signal?.maxTokens) && signal.maxTokens > 0
    && signal.usedTokens <= signal.maxTokens && Number.isFinite(observedAt) && observedAt <= Date.now();
}

function shouldRolloverLead(lead) {
  const turns = Number(lead?.actionableTurns || 0);
  if (turns >= LEAD_FALLBACK_ACTIONABLE_TURNS) return true;
  const signal = lead?.contextSignal;
  return Boolean(validContextSignal(signal) && signal.usedTokens / signal.maxTokens >= LEAD_CONTEXT_ROLLOVER_RATIO);
}

function completePendingLeadHandoff({ roots, projectId, lead, adapter }) {
  if (!lead?.handoffPending) return lead;
  const reconstructionTasks = leadReconstructionTasks(roots, projectId);
  const reconstructionTaskIds = reconstructionTasks.map((item) => item.taskId);
  const activeTaskIds = reconstructionTasks.filter((item) => ["working", "blocked", "waiting-decision"].includes(item.status)).map((item) => item.taskId);
  core.withHomeLock(roots.foremanHome, () => {
    const currentLead = readLead(roots.foremanHome, projectId);
    if (currentLead.endpoint !== lead.endpoint || currentLead.generation !== lead.generation || !currentLead.handoffPending) throw new SlpError("Project Lead changed during handoff reconciliation");
    for (const meta of reconstructionTasks) {
      const current = readTask(roots.foremanHome, meta.taskId);
      writeTaskUnlocked(roots, { ...current, leadGeneration: lead.generation, leadEndpoint: lead.endpoint });
      const decisionsDir = path.join(taskDir(roots.foremanHome, meta.taskId), "decisions");
      if (fs.existsSync(decisionsDir)) {
        for (const name of fs.readdirSync(decisionsDir).filter((item) => item.endsWith(".json"))) {
          const file = path.join(decisionsDir, name);
          const decision = readJson(file);
          if (["pending", "answered"].includes(decision.status) && decision.leadGeneration !== lead.generation) core.atomicJson(file, { ...decision, leadGeneration: lead.generation });
        }
      }
    }
    // Core messages are addressed to a Lead generation, not to an immortal
    // endpoint.  Move unsent messages to the fenced replacement generation so
    // a report or request outcome survives a Lead/Core outage.  Keep every
    // prior attempt as evidence and reset only the per-endpoint attempt marker:
    // a message that may have reached the old endpoint must never be blindly
    // retried there, while the replacement still needs one durable delivery.
    for (const message of coordination.listMessages({ roots, statuses: ["pending"] })) {
      if (message.projectId !== projectId || message.payload?.taskModel !== "slp"
        || Number(message.generation) >= Number(currentLead.generation)) continue;
      coordination.updateMessageUnlocked({
        roots,
        messageId: message.messageId,
        mutate: (current) => ({
          ...current,
          worker: currentLead.owner,
          generation: currentLead.generation,
          endpoint: currentLead.endpoint,
          deliveryAttemptedAt: null,
          cursorBefore: null,
          transferredAt: now(),
          priorLeadDeliveries: [...(current.priorLeadDeliveries || []), {
            endpoint: current.endpoint || null,
            worker: current.worker,
            generation: current.generation,
            deliveryAttemptedAt: current.deliveryAttemptedAt || null,
            cursorBefore: current.cursorBefore || null,
            transportEvidence: current.transportEvidence || null,
          }],
        }),
      });
    }
  });
  writeProjectState({ roots, projectId });
  const taskId = reconstructionTaskIds[0] || lead.handoffTaskIds?.[0];
  if (!taskId) throw new SlpError("Lead handoff has no active task for durable reconstruction");
  const project = core.findProject(roots.foremanHome, projectId);
  const message = sendLeadMessage({
    roots,
    projectId,
    taskId,
    kind: "slp-lead-handoff",
    payload: {
      projectId,
      leadGeneration: lead.generation,
      taskId,
      activeTaskIds,
      reconstructionTaskIds,
      projectState: projectStatePath(project.root),
      leadSkill: skillPathFor(project.root, lead.dispatchProfile),
      reconstructionRequired: Number(lead.reconstructionRequiredGeneration) === Number(lead.generation),
      reconstructionFields: ["projectState", "knowledge", "coreState"],
      supersededRequests: lead.supersededRequests || [],
      ...(lead.supersededRequests?.length ? { supersededNote: "These waiting Peer requests were superseded by this handoff. After reconstruction, resubmit each with the same requestId and payload under the new Lead generation; an existing pending Peer assignment is reused." } : {}),
      handoff: true,
    },
    adapter,
    requestId: `lead-handoff-${projectId}-g${lead.generation}`,
  });
  if (!message.messageId) {
    recordAnomaly({ roots, projectId, taskId, type: "lead.handoff-message-pending", endpoint: lead.endpoint, reason: message.reason || "durable reconstruction message could not be prepared" });
    return { ...lead, handoffMessage: message };
  }
  if (message.failed) {
    recordAnomaly({ roots, projectId, taskId, type: "lead.handoff-message-failed", endpoint: lead.endpoint, reason: message.reason || "replacement Lead reconstruction message failed" });
    return { ...lead, handoffMessage: message };
  }
  core.withHomeLock(roots.foremanHome, () => {
    const current = readLead(roots.foremanHome, projectId);
    if (current.endpoint === lead.endpoint && current.generation === lead.generation) core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, handoffPending: false, handoffTaskIds: [], supersededRequests: [], handoffMessageId: message.messageId, handoffMessageStatus: message.delivered ? "delivered" : "pending" });
  });
  return { ...lead, handoffPending: false, handoffMessage: message };
}

// Herdr lists agents with snake_case fields and no owner; normalize them to the shape inspect() returns.
function visibleAgent(adapter, owner) {
  const found = (adapter.list() || []).find((agent) => agent.owner === owner || (!usesTimeline(adapter) && (agent.name === owner || agent.agent === owner)));
  if (!found || usesTimeline(adapter)) return found || null;
  return { endpoint: owner, owner, cwd: found.cwd || found.foreground_cwd, paneId: found.pane_id, workspaceId: found.workspace_id, status: found.agent_status || "unknown" };
}

function matchingRuntimeAgent(adapter, { owner, projectId, generation, workspace, profile }) {
  const found = visibleAgent(adapter, owner);
  if (!found) return null;
  const expected = { endpoint: found.endpoint, owner, projectId, generation, workspace, workspaceId: found.workspaceId, paneId: found.paneId };
  verifyRuntimeIdentity({ adapter, expected, actual: found, operation: "spawn recovery" });
  if (profile?.provider && found.provider !== profile.provider) throw new SlpError("Existing endpoint has a different provider than the confirmed profile");
  if (profile?.model && found.model !== profile.model) throw new SlpError("Existing endpoint has a different model than the confirmed profile");
  if (profile?.modeId && found.currentModeId !== profile.modeId) throw new SlpError("Existing endpoint has a different mode than the confirmed profile");
  return found;
}

function startLeadSession({ roots, projectId, adapter, reason }) {
  assertSlpBackend(adapter, "Lead dispatch");
  const project = core.findProject(roots.foremanHome, projectId);
  let lead = readLead(roots.foremanHome, projectId);
  if (!lead || !lead.profileConfirmedAt || !lead.dispatchProfile) throw new SlpError("Project Lead profile is not confirmed; bind a human-confirmed profile first");
  verifyPilotPrerequisites({ roots, project, profile: lead.dispatchProfile });
  if (lead.backend !== adapterBackend(adapter)) throw new SlpError(`Project Lead is bound to ${lead.backend}; SLP dispatch cannot change backend`);
  if (lead.endpoint) {
    let inspection;
    try { inspection = adapter.inspect(lead.endpoint); }
    catch (error) { recordAnomaly({ roots, projectId, type: "lead.inspect-failed", endpoint: lead.endpoint, reason: error.message }); throw new SlpError(`Project Lead inspection failed: ${error.message}`); }
    if (["missing", "stopped"].includes(String(inspection?.status || "").toLowerCase())) {
      recordAnomaly({ roots, projectId, type: `lead.${inspection.status}`, endpoint: lead.endpoint, reason: "Bound Lead is unavailable; automatic replacement is disabled" });
      throw new SlpError("Bound project Lead is missing or stopped; use an explicit safe-boundary Lead handoff");
    }
    try { verifyRuntimeIdentity({ adapter, expected: lead, actual: inspection, operation: "Lead dispatch" }); }
    catch (error) { recordAnomaly({ roots, projectId, type: "lead.identity-mismatch", endpoint: lead.endpoint, reason: error.message }); throw error; }
    return lead.handoffPending ? completePendingLeadHandoff({ roots, projectId, lead, adapter }) : lead;
  }
  const generation = Number(lead.pendingGeneration || nextProjectLeadGeneration(lead));
  const owner = runtimeOwnerName(adapter, "slp-lead", projectId, `g${generation}`);
  const reusable = matchingRuntimeAgent(adapter, { owner, projectId, generation, workspace: project.root, profile: lead.dispatchProfile });
  if (!reusable) {
    const held = endpointCapacityHeld(roots);
    if (held) throw new SlpError(`SLP endpoint capacity (${held.maxSlpEndpoints}) is exhausted by ${held.count} live Lead and Peer endpoints; no Lead was started`);
  }
  const spawned = reusable || adapter.spawn({
    taskId: null,
    projectId,
    owner,
    generation,
    cwd: project.root,
    branch: null,
    resources: [],
    workspaceMode: core.projectVcs(project) === "git" ? "shared-current-branch" : "shared-directory",
    gitAuthority: "client",
    brief: leadInstruction({ roots, project, lead: { ...lead, generation }, reason }),
    dispatchProfile: lead.dispatchProfile,
  });
  const endpoint = spawned.endpoint || spawned.endpointId;
  if (!endpoint) throw new SlpError(`${adapterBackend(adapter)} did not return the project Lead endpoint identity`);
  const inspection = adapter.inspect(endpoint);
  const bound = { endpoint, owner, projectId, generation, workspace: project.root, workspaceId: spawned.workspaceId || inspection.workspaceId, paneId: spawned.paneId || inspection.paneId || null };
  verifyRuntimeIdentity({ adapter, expected: bound, actual: inspection, operation: "Lead bind" });
  const cursor = usesTimeline(adapter) ? adapter.cursor(endpoint) : null;
  lead = {
    ...lead,
    generation,
    pendingGeneration: null,
    status: "working",
    endpoint,
    owner,
    workspace: project.root,
    workspaceId: inspection.workspaceId,
    paneId: bound.paneId,
    timelineCursor: cursor || null,
    boundAt: now(),
    replacedAt: lead.endpoint ? now() : (lead.replacedAt || null),
    lastUsageAt: null,
    contextSignal: captureContextSignal(inspection.lastUsage),
    actionableTurns: 0,
  };
  core.withHomeLock(roots.foremanHome, () => core.atomicJson(leadFile(roots.foremanHome, projectId), lead));
  writeProjectState({ roots, projectId });
  if (lead.handoffPending) return completePendingLeadHandoff({ roots, projectId, lead, adapter });
  return lead;
}

function ensurePeerProfile(meta) {
  if (!meta.dispatchProfile || !meta.profileConfirmedAt) throw new SlpError(`Task Peer profile is not confirmed: ${meta.taskId}`);
  return meta.dispatchProfile;
}

function deliverLeadOutboxMessage({ roots, lead, message, adapter }) {
  if (message.status === "delivered") return { delivered: true, duplicate: true, messageId: message.messageId };
  if (message.status === "failed") return { delivered: false, failed: true, messageId: message.messageId, reason: message.transportEvidence?.reason || "prior delivery failed" };
  if (message.endpoint !== lead.endpoint || message.worker !== lead.owner || Number(message.generation) !== Number(lead.generation)) {
    recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.message-stale", endpoint: message.endpoint, reason: "outbox message no longer matches the current Lead generation" });
    return { delivered: false, waiting: true, messageId: message.messageId, reason: "message belongs to a stale Lead generation" };
  }
  if (message.deliveryAttemptedAt && !usesTimeline(adapter)) {
    // Herdr prompts carry no message ID or timeline, so an attempted delivery cannot be proven and is never resent.
    recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.message-delivery-uncertain", endpoint: lead.endpoint, reason: `Message ${message.messageId} was attempted but its delivery cannot be verified on Herdr; it will not be sent again` });
    return { delivered: false, waiting: true, uncertain: true, messageId: message.messageId };
  }
  if (message.deliveryAttemptedAt) {
    let timeline;
    try { timeline = adapter.read(lead.endpoint, message.cursorBefore || lead.timelineCursor || null); }
    catch (error) {
      recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.message-reconcile-failed", endpoint: lead.endpoint, reason: error.message });
      return { delivered: false, waiting: true, messageId: message.messageId, reason: error.message };
    }
    try { verifyRuntimeIdentity({ adapter, expected: lead, actual: timeline, operation: "Lead message reconciliation" }); }
    catch (error) {
      recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.message-identity-mismatch", endpoint: lead.endpoint, reason: error.message });
      return { delivered: false, waiting: true, messageId: message.messageId, reason: error.message };
    }
    const found = (timeline.entries || []).some((entry) => entry.messageId === message.messageId || entry.item?.messageId === message.messageId || entry.item?.id === message.messageId);
    if (!found) {
      recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.message-delivery-uncertain", endpoint: lead.endpoint, reason: `Message ${message.messageId} was attempted but its delivery cannot be verified; it will not be sent again` });
      return { delivered: false, waiting: true, uncertain: true, messageId: message.messageId };
    }
    core.withHomeLock(roots.foremanHome, () => {
      coordination.markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered: true, evidence: { reconciled: true, cursor: message.cursorBefore || null } });
      const current = readLead(roots.foremanHome, message.projectId);
      if (current?.endpoint === lead.endpoint && Number(current.generation) === Number(lead.generation)) core.atomicJson(leadFile(roots.foremanHome, message.projectId), { ...current, timelineCursor: message.cursorBefore || current.timelineCursor || null, lastPromptAt: message.deliveryAttemptedAt, lastProgressAt: message.deliveryAttemptedAt });
    });
    return { delivered: true, reconciled: true, messageId: message.messageId };
  }
  let inspection;
  try { inspection = adapter.inspect(lead.endpoint); }
  catch (error) { recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.inspect-failed", endpoint: lead.endpoint, reason: error.message }); return { delivered: false, waiting: true, messageId: message.messageId, reason: error.message }; }
  try { verifyRuntimeIdentity({ adapter, expected: lead, actual: inspection, operation: "Lead message" }); }
  catch (error) { recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.identity-mismatch", endpoint: lead.endpoint, reason: error.message }); return { delivered: false, waiting: true, messageId: message.messageId, reason: error.message }; }
  if (inspection.activeTurn || !["idle", "finished", "done"].includes(String(inspection.status).toLowerCase())) return { delivered: false, waiting: true, messageId: message.messageId, reason: "project Lead is still processing another turn" };
  if (usesTimeline(adapter)) {
    let pending;
    try { pending = adapter.read(lead.endpoint, lead.timelineCursor || null); }
    catch (error) { return { delivered: false, waiting: true, messageId: message.messageId, reason: `project Lead timeline could not be checked before delivery: ${error.message}` }; }
    try { verifyRuntimeIdentity({ adapter, expected: lead, actual: pending, operation: "Lead message pre-delivery check" }); }
    catch (error) { recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.timeline-identity-mismatch", endpoint: lead.endpoint, reason: error.message }); return { delivered: false, waiting: true, messageId: message.messageId, reason: error.message }; }
    if (pending.gap || pending.staleCursor) return { delivered: false, waiting: true, messageId: message.messageId, reason: "project Lead timeline continuity is uncertain" };
    if (assistantTexts(pending.entries).length) return { delivered: false, waiting: true, messageId: message.messageId, reason: "project Lead has an uncollected response" };
  }
  let cursor = null;
  try { if (usesTimeline(adapter)) cursor = adapter.cursor(lead.endpoint); }
  catch (error) { recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.cursor-failed", endpoint: lead.endpoint, reason: error.message }); return { delivered: false, waiting: true, messageId: message.messageId, reason: error.message }; }
  const attemptedAt = now();
  core.withHomeLock(roots.foremanHome, () => {
    coordination.updateMessageUnlocked({ roots, messageId: message.messageId, mutate: (current) => ({ ...current, deliveryAttemptedAt: attemptedAt, cursorBefore: cursor || null }) });
    const current = readLead(roots.foremanHome, message.projectId);
    if (current?.endpoint === lead.endpoint && Number(current.generation) === Number(lead.generation)) core.atomicJson(leadFile(roots.foremanHome, message.projectId), { ...current, timelineCursor: cursor || current.timelineCursor || null, lastPromptAt: attemptedAt, lastProgressAt: attemptedAt });
  });
  let result;
  try { result = adapter.send(lead.endpoint, coordination.deliveryPrompt(message), { messageId: message.messageId }); }
  catch (error) { result = { delivered: false, uncertain: true, error: error.message }; }
  const delivered = result !== false && result?.delivered !== false;
  core.withHomeLock(roots.foremanHome, () => {
    if (result?.uncertain) coordination.updateMessageUnlocked({ roots, messageId: message.messageId, mutate: (current) => ({ ...current, transportEvidence: result }) });
    else coordination.markMessageDeliveryUnlocked({ roots, messageId: message.messageId, delivered, evidence: result });
    const current = readLead(roots.foremanHome, message.projectId);
    if (current?.endpoint === lead.endpoint && Number(current.generation) === Number(lead.generation)) core.atomicJson(leadFile(roots.foremanHome, message.projectId), { ...current, timelineCursor: cursor || current.timelineCursor || null, lastPromptAt: attemptedAt });
  });
  if (result?.uncertain) return { delivered: false, waiting: true, uncertain: true, messageId: message.messageId, reason: result.error };
  if (!delivered) {
    recordAnomaly({ roots, projectId: message.projectId, taskId: message.taskId, type: "lead.delivery-failed", endpoint: lead.endpoint, reason: result?.error || `message ${message.messageId} was not delivered` });
    return { delivered: false, failed: true, messageId: message.messageId, reason: result?.error || "delivery was not confirmed" };
  }
  return { delivered: true, messageId: message.messageId, evidence: result };
}

function sendLeadMessage({ roots, projectId, taskId, kind, payload, adapter, requestId }) {
  assertSlpBackend(adapter, "Lead message delivery");
  const lead = readLead(roots.foremanHome, projectId);
  if (!lead?.endpoint || lead.status !== "working") {
    const reason = "project Lead endpoint is unavailable";
    recordAnomaly({ roots, projectId, taskId, type: "lead.message-pending", endpoint: lead?.endpoint || null, reason: `${kind}: ${reason}` });
    return { delivered: false, waiting: true, reason };
  }
  const messageId = `M-SLP-${digest({ projectId, taskId, kind, requestId: requestId || null, leadGeneration: lead.generation, payload }).slice(0, 28)}`;
  let message;
  core.withHomeLock(roots.foremanHome, () => {
    message = coordination.createMessageUnlocked({ roots, taskId, projectId, worker: lead.owner, generation: lead.generation, endpoint: lead.endpoint, kind, payload: { ...payload, backend: adapterBackend(adapter), taskModel: "slp" }, explicitId: messageId });
  });
  const result = deliverLeadOutboxMessage({ roots, lead, message, adapter });
  if (result.delivered) resolveAnomalies({ roots, projectId, taskId, endpoint: lead.endpoint, types: ["lead.message-pending"] });
  return result;
}

function deliverPendingLeadMessages({ roots, projectId, adapter }) {
  const lead = readLead(roots.foremanHome, projectId);
  if (!lead?.endpoint) return [];
  return coordination.listMessages({ roots, statuses: ["pending"] })
    .filter((message) => message.projectId === projectId && message.payload?.taskModel === "slp" && message.worker === lead.owner && Number(message.generation) === Number(lead.generation))
    .map((message) => {
      const result = deliverLeadOutboxMessage({ roots, lead, message, adapter });
      // A report may have become pending while its original Lead was down.
      // Once the transferred outbox message reaches the current generation,
      // persist that fact on the Peer too, so later ticks cannot redeliver it.
      if (result.delivered && message.kind === "slp-peer-report" && message.payload?.assignmentId) {
        try {
          core.withHomeLock(roots.foremanHome, () => {
            const peer = readTask(roots.foremanHome, message.payload.assignmentId);
            if (peer.projectId !== projectId || !peer.peerRuntimeStopped || peer.peerReportDeliveredAt) return;
            core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), { ...peer, peerReportDeliveredAt: now() });
          });
          resolveAnomalies({ roots, projectId, assignmentId: message.payload.assignmentId, types: ["peer.report-delivery-pending"] });
        } catch (error) {
          recordAnomaly({ roots, projectId, taskId: message.taskId, assignmentId: message.payload.assignmentId, type: "peer.report-delivery-record-failed", endpoint: lead.endpoint, reason: error.message });
        }
      }
      return result;
    });
}

function dispatchSlpTask({ roots, taskId, adapter, startCoordinator = true }) {
  const meta = readTask(roots.foremanHome, taskId);
  if (core.taskModel(meta) !== "slp") throw new SlpError(`Task is not an SLP task: ${taskId}`);
  assertSlpBackend(adapter, "task dispatch");
  if (adapterBackend(adapter) !== meta.backend) {
    throw new SlpError(`SLP task is bound to ${meta.backend}; unsupported SLP backend dispatch is refused without fallback`);
  }
  if (!meta.profileConfirmedAt || !meta.dispatchProfile) throw new SlpError(`Task Peer profile is not confirmed; run task confirm first: ${taskId}`);
  if ((meta.dependencies || []).length) throw new SlpError("SLP pilot tasks do not support top-level dependency scheduling");
  core.migrateSlpTaskModels({ roots });
  const project = core.findProject(roots.foremanHome, meta.projectId);
  const leadProfile = readLead(roots.foremanHome, project.id);
  if (!leadProfile?.profileConfirmedAt || !leadProfile.dispatchProfile) throw new SlpError(`Project Lead profile is not confirmed for ${project.id}`);
  if (leadProfile.dispatchPaused) throw new SlpError(`SLP intake is paused for project ${project.id}; existing tasks and evidence remain available`);
  verifyPilotPrerequisites({ roots, project, profile: leadProfile.dispatchProfile });
  core.validateDispatchProfile(leadProfile.dispatchProfile, adapter.capabilities());
  ensurePeerProfile(meta);
  const capacity = slpCapacity(roots);
  const activeTasks = activeTopLevelTasks(roots, project.id, taskId);
  if (activeTasks.length >= capacity.maxActiveTasksPerProject) {
    const waiting = { ...meta, status: "queued", waitingKind: "capacity", waitingReason: `project task capacity (${capacity.maxActiveTasksPerProject}) is held by ${activeTasks.map((item) => item.taskId).join(", ")}`, waitingAt: now() };
    writeTask(roots, waiting);
    writeProjectState({ roots, projectId: project.id });
    return { taskId, status: "waiting", waitingReason: waiting.waitingReason, leadReused: Boolean(leadProfile.endpoint) };
  }
  const lead = startLeadSession({ roots, projectId: project.id, adapter, reason: "Reconstruct the active project state before handling a top-level task." });
  const current = readTask(roots.foremanHome, taskId);
  if (["accepted", "review-ready", "proof-complete", "cleaned"].includes(current.status)) throw new SlpError(`SLP task is terminal: ${taskId}`);
  const brief = fs.readFileSync(path.join(taskDir(roots.foremanHome, taskId), "brief.md"), "utf8");
  const notesFile = path.join(taskDir(roots.foremanHome, taskId), "notes.md");
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : null;
  const task = writeTask(roots, {
    ...current,
    status: "working",
    waitingReason: null,
    waitingKind: null,
    leadGeneration: lead.generation,
    leadEndpoint: lead.endpoint,
    startedAt: current.startedAt || now(),
  });
  writeProjectState({ roots, projectId: project.id });
  const message = sendLeadMessage({
    roots,
    projectId: project.id,
    taskId,
    kind: "slp-task-brief",
    payload: {
      taskId,
      projectId: project.id,
      leadGeneration: lead.generation,
      profile: task.dispatchProfile?.name,
      brief,
      notes,
      cwd: project.root,
      branch: core.projectVcs(project) === "git" ? core.gitBranch(project.root) : null,
      leadSkill: skillPathFor(project.root, lead.dispatchProfile),
      projectState: projectStatePath(project.root),
    },
    adapter,
    requestId: `task-${taskId}-g${lead.generation}`,
  });
  if (!message.delivered) {
    recordAnomaly({ roots, projectId: project.id, taskId, type: "task.lead-delivery-pending", endpoint: lead.endpoint, reason: message.reason || "Lead brief is waiting for delivery" });
    if (message.failed) writeTask(roots, { ...readTask(roots.foremanHome, taskId), status: "blocked", waitingReason: message.reason });
  }
  if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
  return { taskId, status: message.delivered ? "working" : (message.waiting ? "waiting" : "blocked"), leadEndpoint: lead.endpoint, leadGeneration: lead.generation, leadMessageId: message.messageId || null, delivery: message };
}

function followupProjectLead({ roots, taskId, text, adapter, startCoordinator = true }) {
  assertSlpBackend(adapter, "Lead follow-up");
  const task = readTask(roots.foremanHome, taskId);
  if (core.taskModel(task) !== "slp" || !["working", "blocked", "waiting-decision"].includes(task.status)) {
    throw new SlpError(`Lead follow-up requires an active SLP task: ${taskId}`);
  }
  if (typeof text !== "string" || !text.trim()) throw new SlpError("Lead follow-up requires non-empty text");
  const lead = readLead(roots.foremanHome, task.projectId);
  if (!lead?.endpoint || lead.endpoint !== task.leadEndpoint || Number(lead.generation) !== Number(task.leadGeneration)) {
    throw new SlpError("Task is not bound to the current live project Lead generation");
  }
  const inspection = adapter.inspect(lead.endpoint);
  verifyRuntimeIdentity({ adapter, expected: lead, actual: inspection, operation: "Lead follow-up" });
  const message = sendLeadMessage({
    roots,
    projectId: task.projectId,
    taskId,
    kind: "slp-human-followup",
    payload: { taskId, projectId: task.projectId, leadGeneration: lead.generation, text: text.trim() },
    adapter,
    requestId: `human-followup-${crypto.randomBytes(12).toString("hex")}`,
  });
  if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
  return { taskId, leadEndpoint: lead.endpoint, leadGeneration: lead.generation, delivery: message };
}

// Core-owned waits (resource, capacity, prerequisite) belong to one Lead generation and must not stall a handoff.
// Each is refused as superseded and preserved; the replacement Lead is told to resubmit it with the same requestId
// and payload, which reuses any pending Peer record instead of creating a duplicate.
function supersedeCoreWaitsUnlocked({ roots, projectId, lead, toGeneration }) {
  const superseded = [];
  for (const request of requestsForLead(roots, projectId, lead.generation)) {
    if (request.status !== "waiting" || request.action !== "create-peer" || !REEVALUATED_WAITS.has(request.outcome?.waitKind)) continue;
    const reason = `superseded by Lead handoff to generation ${toGeneration}; resubmit with the same requestId and payload after reconstruction`;
    core.atomicJson(requestFile(roots.foremanHome, projectId, request.leadGeneration, request.requestId), withWaitAccounting(request, {
      ...request,
      status: "refused",
      outcome: { status: "refused", reason, supersededByGeneration: toGeneration, previousWait: request.outcome },
      updatedAt: now(),
    }));
    const peer = listPeerTasks(roots, request.taskId).find((item) => item.slpRequestId === request.requestId);
    superseded.push({ requestId: request.requestId, taskId: request.taskId, assignmentId: peer?.taskId || null, waitKind: request.outcome.waitKind });
  }
  return superseded;
}

function replaceProjectLead({ roots, projectId, adapter, profileName, startCoordinator = true }) {
  assertSlpBackend(adapter, "Lead handoff");
  let lead = readLead(roots.foremanHome, projectId);
  if (lead?.handoffPending && !lead.endpoint) {
    if (profileName && profileName !== lead.profileName) throw new SlpError(`A Lead handoff is already pending with profile ${lead.profileName}`);
    const resumed = startLeadSession({ roots, projectId, adapter, reason: "Resume the recorded deliberate Lead handoff and reconstruct from canonical project state." });
    if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
    return { projectId, endpoint: resumed.endpoint, generation: resumed.generation, handoffResumed: true, peerAssignmentsPreserved: true };
  }
  if (!lead?.endpoint) throw new SlpError(`Project has no bound Lead session: ${projectId}`);
  let nextProfile = null;
  if (profileName) {
    const project = core.findProject(roots.foremanHome, projectId);
    nextProfile = configuredProfile({ roots, profileName, backend: lead.backend });
    verifyPilotPrerequisites({ roots, project, profile: nextProfile });
    core.validateDispatchProfile(nextProfile, adapter.capabilities());
  }
  const inspection = adapter.inspect(lead.endpoint);
  if (["missing", "stopped"].includes(String(inspection?.status || "").toLowerCase())) throw new SlpError("Lead endpoint is missing or stopped; S1 handoff requires a verified safe turn boundary");
  verifyRuntimeIdentity({ adapter, expected: lead, actual: inspection, operation: "Lead handoff" });
  if (inspection.activeTurn || !["idle", "finished", "done"].includes(String(inspection.status).toLowerCase())) {
    throw new SlpError("Lead replacement is permitted only at a confirmed safe turn boundary");
  }
  const reconstructionTasks = leadReconstructionTasks(roots, projectId);
  if (!reconstructionTasks.length) throw new SlpError("Lead handoff requires an active or confirmed queued task to carry the durable reconstruction message");
  const outstanding = requestsForLead(roots, projectId, lead.generation).find((request) => request.status === "pending"
    || (request.status === "waiting" && !(request.action === "create-peer" && REEVALUATED_WAITS.has(request.outcome?.waitKind))));
  if (outstanding) throw new SlpError(`Lead replacement waits for request ${outstanding.requestId} to be reconciled`);
  const pendingMessage = coordination.listMessages({ roots, statuses: ["pending"] }).find((message) => message.projectId === projectId && message.worker === lead.owner && Number(message.generation) === Number(lead.generation) && message.payload?.taskModel === "slp");
  if (pendingMessage) throw new SlpError(`Lead replacement waits for message ${pendingMessage.messageId} to be reconciled`);
  const stopped = adapter.stop(lead.endpoint);
  if (!stopped || stopped.stopped === false) throw new SlpError("Old Lead stop was not verified");
  const after = adapter.inspect(lead.endpoint);
  if (!after || !["stopped", "missing"].includes(String(after.status).toLowerCase())) throw new SlpError("Old Lead endpoint remains live; refusing replacement");
  core.withHomeLock(roots.foremanHome, () => {
    const current = readLead(roots.foremanHome, projectId);
    if (current.endpoint !== lead.endpoint || current.generation !== lead.generation) throw new SlpError("Project Lead changed during handoff");
    const generation = lead.generation + 1;
    const handoffTaskIds = reconstructionTasks.map((item) => item.taskId);
    const supersededRequests = supersedeCoreWaitsUnlocked({ roots, projectId, lead: current, toGeneration: generation });
    const next = {
      ...current,
      supersededRequests,
      ...(nextProfile ? { profileName, dispatchProfile: nextProfile, profileConfirmedAt: now() } : {}),
      generation, pendingGeneration: generation, handoffPending: true, handoffTaskIds,
      reconstructionRequiredGeneration: generation,
      reconstruction: null,
      status: "bound", endpoint: null, workspaceId: null, timelineCursor: null,
      previousEndpoint: lead.endpoint, replacedAt: now(),
    };
    core.atomicJson(leadFile(roots.foremanHome, projectId), next);
  });
  writeProjectState({ roots, projectId });
  const nextLead = startLeadSession({ roots, projectId, adapter, reason: "This is a deliberate Lead handoff. Rebuild the project overview from the generated state, current task records, original briefs, pending decisions, and preserved Peer reports. Living Peers remain assigned; do not duplicate them." });
  if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
  return { projectId, priorEndpoint: lead.endpoint, priorGeneration: lead.generation, endpoint: nextLead.endpoint, generation: nextLead.generation, handoffMessage: nextLead.handoffMessage || null, peerAssignmentsPreserved: true };
}

function recoverProjectLead({ roots, projectId, adapter, profileName, startCoordinator = true }) {
  assertSlpBackend(adapter, "Lead recovery");
  let lead = readLead(roots.foremanHome, projectId);
  if (!lead) throw new SlpError(`Project Lead is not bound: ${projectId}`);
  if (lead.handoffPending) {
    if (profileName && profileName !== lead.profileName) throw new SlpError(`A Lead handoff is already pending with profile ${lead.profileName}`);
    const resumed = startLeadSession({ roots, projectId, adapter, reason: "Resume the recorded Lead recovery and reconstruct from canonical project state." });
    if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
    return { projectId, endpoint: resumed.endpoint, generation: resumed.generation, recoveryResumed: true, peerAssignmentsPreserved: true };
  }
  if (!lead.endpoint) throw new SlpError(`Project has no bound Lead endpoint to recover: ${projectId}`);
  const first = adapter.inspect(lead.endpoint);
  const firstState = String(first?.status || "unknown").toLowerCase();
  if (!["missing", "stopped"].includes(firstState)) throw new SlpError(`Lead recovery requires confirmed dead or missing evidence; first check was ${firstState}`);
  if (firstState !== "missing") verifyRuntimeIdentity({ adapter, expected: lead, actual: first, operation: "Lead recovery" });
  const second = adapter.inspect(lead.endpoint);
  const secondState = String(second?.status || "unknown").toLowerCase();
  if (secondState !== firstState) throw new SlpError(`Lead recovery checks disagree: ${firstState} then ${secondState}`);
  if (secondState !== "missing") verifyRuntimeIdentity({ adapter, expected: lead, actual: second, operation: "Lead recovery" });
  const recoveryTasks = leadReconstructionTasks(roots, projectId);
  if (!recoveryTasks.length) throw new SlpError("Lead recovery requires an active task or a confirmed queued task for durable reconstruction");
  let nextProfile = null;
  if (profileName) {
    const project = core.findProject(roots.foremanHome, projectId);
    nextProfile = configuredProfile({ roots, profileName, backend: lead.backend });
    verifyPilotPrerequisites({ roots, project, profile: nextProfile });
    core.validateDispatchProfile(nextProfile, adapter.capabilities());
  }
  const generation = lead.generation + 1;
  core.withHomeLock(roots.foremanHome, () => {
    const current = readLead(roots.foremanHome, projectId);
    if (current.endpoint !== lead.endpoint || current.generation !== lead.generation) throw new SlpError("Project Lead changed during recovery checks");
    const handoffTaskIds = recoveryTasks.map((item) => item.taskId);
    const supersededRequests = supersedeCoreWaitsUnlocked({ roots, projectId, lead: current, toGeneration: generation });
    lead = {
      ...current,
      supersededRequests,
      ...(nextProfile ? { profileName, dispatchProfile: nextProfile, profileConfirmedAt: now() } : {}),
      generation,
      pendingGeneration: generation,
      handoffPending: true,
      handoffTaskIds,
      reconstructionRequiredGeneration: generation,
      reconstruction: null,
      status: "bound",
      endpoint: null,
      workspaceId: null,
      timelineCursor: null,
      previousEndpoint: current.endpoint,
      replacedAt: now(),
      recoveryReason: secondState,
    };
    core.atomicJson(leadFile(roots.foremanHome, projectId), lead);
  });
  writeProjectState({ roots, projectId });
  const nextLead = startLeadSession({ roots, projectId, adapter, reason: `Recover the unavailable Lead generation ${generation - 1} after two matching ${secondState} checks. Rebuild all active tasks from canonical state. Preserve every living Peer and do not duplicate assignments.` });
  if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
  return { projectId, priorEndpoint: lead.previousEndpoint, priorGeneration: generation - 1, endpoint: nextLead.endpoint, generation, recoveredFrom: secondState, handoffMessage: nextLead.handoffMessage || null, peerAssignmentsPreserved: true };
}

function recoverSlpPeer({ roots, taskId, adapter, maxRecoveryAttempts = 3, startCoordinator = true }) {
  assertSlpBackend(adapter, "Peer recovery");
  const peer = readTask(roots.foremanHome, taskId);
  if (peer.taskModel !== "slp-peer" || !peer.endpoint || peer.peerRuntimeStopped || !["working", "blocked"].includes(peer.status)) {
    throw new SlpError("Peer recovery requires a live SLP assignment record in working or blocked state");
  }
  const inspect = () => adapter.inspect(peer.endpoint);
  const first = inspect();
  const firstState = String(first?.status || "unknown").toLowerCase();
  if (!["missing", "stopped"].includes(firstState)) throw new SlpError(`Peer recovery requires confirmed dead or missing evidence; first check was ${firstState}`);
  if (firstState !== "missing") verifyRuntimeIdentity({ adapter, expected: peer, actual: first, operation: "Peer recovery" });
  const second = inspect();
  const secondState = String(second?.status || "unknown").toLowerCase();
  if (secondState !== firstState) throw new SlpError(`Peer recovery checks disagree: ${firstState} then ${secondState}`);
  if (secondState !== "missing") verifyRuntimeIdentity({ adapter, expected: peer, actual: second, operation: "Peer recovery" });
  const otherPeers = livePeersForProject(roots, peer.projectId).filter((item) => item.taskId !== peer.taskId);
  if (otherPeers.length >= slpCapacity(roots).maxLivePeersPerProject) throw new SlpError(`Peer recovery waits for Peer capacity held by ${otherPeers.map((item) => item.taskId).join(", ")}`);
  const attempts = Number(peer.recoveryAttempts || 0);
  if (attempts >= Math.max(1, Number(maxRecoveryAttempts) || 3)) throw new SlpError("Peer recovery attempt limit is exhausted");
  const handoff = core.buildHandoff({ roots, taskId, reason: secondState });
  const previousGenerations = [...(peer.previousGenerations || []), {
    generation: peer.generation,
    endpoint: peer.endpoint,
    state: secondState,
    observedAt: now(),
    reportFile: peer.lastReport?.file || null,
    report: peer.lastReport?.file ? boundedSummary(readReportPayload(peer)?.summary, 2000) : null,
  }];
  core.withHomeLock(roots.foremanHome, () => {
    const current = readTask(roots.foremanHome, taskId);
    if (current.endpoint !== peer.endpoint || current.generation !== peer.generation || current.peerRuntimeStopped) throw new SlpError("Peer assignment changed during recovery checks");
    core.atomicJson(taskMetaFile(roots.foremanHome, taskId), {
      ...current,
      recoveryAttempts: attempts + 1,
      recoveryPending: true,
      recoveryChecks: [{ status: firstState, observedAt: now() }, { status: secondState, observedAt: now() }],
      previousGenerations,
      handoffPending: handoff.handoffId,
    });
    core.atomicJson(path.join(taskDir(roots.foremanHome, taskId), "handoff.json"), handoff);
  });
  const assignment = core.assignTask({
    roots,
    taskId,
    owner: recoveredPeerOwner(adapter, peer),
    adapter,
    workspacePath: peer.workspace,
    resources: peer.resources,
    dispatchProfile: ensurePeerProfile(peer),
    handoff,
    allowResourceConflicts: false,
  });
  core.withHomeLock(roots.foremanHome, () => {
    const current = readTask(roots.foremanHome, taskId);
    if (current.generation !== peer.generation + 1 || current.endpoint !== assignment.endpoint) throw new SlpError("Recovered Peer identity did not bind to the expected next generation");
    core.atomicJson(taskMetaFile(roots.foremanHome, taskId), { ...current, recoveryPending: false, previousGenerations });
  });
  writeProjectState({ roots, projectId: peer.projectId });
  if (startCoordinator) startCoordinatorProcess({ roots, backend: adapter.backend });
  return { ...assignment, recoveredFrom: secondState, priorGeneration: peer.generation, priorEndpoint: peer.endpoint, recoveryAttempts: attempts + 1 };
}

function validateLeadEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.schemaVersion !== 1
    || typeof envelope.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(envelope.requestId)
    || typeof envelope.projectId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(envelope.projectId) || !/^T-\d{6,}$/.test(String(envelope.taskId || ""))
    || !Number.isInteger(envelope.leadGeneration) || !REQUEST_ACTIONS.has(envelope.action)
    || !envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    throw new SlpError("Lead request envelope is invalid");
  }
  return envelope;
}

function responseTaskId(roots, projectId, preferredTaskId) {
  try {
    const candidate = readTask(roots.foremanHome, preferredTaskId);
    if (candidate.projectId === projectId && core.taskModel(candidate) === "slp") return candidate.taskId;
  } catch (_) {}
  return listSlpTasks(roots, projectId).find((meta) => ["working", "blocked", "waiting-decision"].includes(meta.status))?.taskId || null;
}

function pendingDecisionForTask(roots, taskId, leadGeneration) {
  const directory = path.join(taskDir(roots.foremanHome, taskId), "decisions");
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(directory, name)))
    .find((record) => record.status === "pending" && Number(record.leadGeneration) === Number(leadGeneration)) || null;
}

function recordLeadRequest({ roots, sourceEndpoint, sourceGeneration, sourceWorkspaceId, envelope }) {
  validateLeadEnvelope(envelope);
  const lead = readLead(roots.foremanHome, envelope.projectId);
  const payloadDigest = digest({ taskId: envelope.taskId, action: envelope.action, payload: envelope.payload });
  const file = requestFile(roots.foremanHome, envelope.projectId, envelope.leadGeneration, envelope.requestId);
  const sourceBound = Boolean(lead && sourceEndpoint === lead.endpoint && Number(sourceGeneration) === Number(lead.generation)
    && envelope.leadGeneration === lead.generation && sourceWorkspaceId === lead.workspaceId);
  let task = null;
  try { task = readTask(roots.foremanHome, envelope.taskId); } catch (_) {}
  const validTask = task && core.taskModel(task) === "slp" && task.projectId === envelope.projectId && lead && task.backend === lead.backend
    && Number(task.leadGeneration) === Number(envelope.leadGeneration) && ["working", "blocked", "waiting-decision"].includes(task.status);
  const previous = fs.existsSync(file) ? readJson(file) : null;
  if (previous) {
    if (!sourceBound || !validTask) {
      const reason = !sourceBound ? "request source is not the current project Lead generation" : "task is not bound to this project and Lead generation";
      recordAnomaly({ roots, projectId: envelope.projectId, taskId: envelope.taskId, type: "request.stale-replay", endpoint: sourceEndpoint, reason });
      return { accepted: false, status: "refused", reason, requestId: envelope.requestId };
    }
    if (previous.payloadDigest !== payloadDigest) {
      recordAnomaly({ roots, projectId: envelope.projectId, taskId: envelope.taskId, type: "request.id-reuse", endpoint: sourceEndpoint, reason: `Request ID ${envelope.requestId} was reused with a different payload` });
      return { accepted: false, status: "refused", reason: "requestId was reused with a different payload", requestId: envelope.requestId };
    }
    return previous;
  }
  const request = {
    schemaVersion: 1,
    requestId: envelope.requestId,
    projectId: lead?.projectId || envelope.projectId,
    taskId: envelope.taskId,
    sourceEndpoint,
    sourceGeneration: Number(sourceGeneration),
    sourceWorkspaceId: sourceWorkspaceId || null,
    leadGeneration: envelope.leadGeneration,
    action: envelope.action,
    payload: envelope.payload,
    payloadDigest,
    status: sourceBound && validTask ? "pending" : "refused",
    outcome: sourceBound && validTask ? null : { status: "refused", reason: !sourceBound ? "request source is not the current project Lead generation" : "task is not bound to this project" },
    createdAt: now(),
    updatedAt: now(),
    outcomeDeliveredAt: null,
  };
  core.withHomeLock(roots.foremanHome, () => core.atomicJson(file, request));
  if (request.status === "refused") recordAnomaly({ roots, projectId: request.projectId, taskId: request.taskId, type: "request.stale-or-mismatched", endpoint: sourceEndpoint, reason: request.outcome.reason });
  return request;
}

// A request's time in `waiting` is kept on the request itself, so the cost of serialization outlives the wait.
function withWaitAccounting(previous, next) {
  if (next.status === "waiting" && !previous.waitingSince) return { ...next, waitingSince: next.updatedAt };
  if (next.status !== "waiting" && previous.waitingSince) {
    return { ...next, waitingSince: null, waitedMs: Number(previous.waitedMs || 0) + Math.max(0, Date.parse(next.updatedAt) - Date.parse(previous.waitingSince)) };
  }
  return next;
}

function updateRequest(roots, request, status, outcome) {
  const file = requestFile(roots.foremanHome, request.projectId, request.leadGeneration, request.requestId);
  return core.withHomeLock(roots.foremanHome, () => {
    const current = readJson(file);
    if (current.payloadDigest !== request.payloadDigest) throw new SlpError("Lead request digest changed while processing");
    if (["dispatched", "completed", "refused"].includes(current.status)) return current;
    if (current.status === status && JSON.stringify(current.outcome) === JSON.stringify(outcome)) return current;
    const next = withWaitAccounting(current, { ...current, status, outcome, updatedAt: now() });
    core.atomicJson(file, next);
    return next;
  });
}

function readReportPayload(meta) {
  const file = meta.lastReport?.file;
  if (!file || !fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/\n\n([\s\S]*)$/);
  if (!match) return null;
  return core.parseSlpPeerReport(match[1], meta);
}

function normalizeResources(raw, projectId, readOnly = false) {
  if (raw === undefined || raw === null || !Array.isArray(raw)) throw new SlpError("create-peer requires a resources array; use a workspace-exclusive claim when the write surface is unknown");
  const claims = raw.length ? core.normalizeResourceClaims(raw) : [{ key: `workspace/${projectId}`, mode: readOnly ? "read" : "exclusive" }];
  if (!claims.length) return [{ key: `workspace/${projectId}`, mode: readOnly ? "read" : "exclusive" }];
  return claims;
}

function resourceWait(error) {
  const holders = [...new Set((error.conflicts || []).map((item) => item.taskId))];
  const keys = [...new Set((error.conflicts || []).map((item) => item.held?.key).filter(Boolean))];
  return { status: "waiting", waitKind: "resource", reason: `requested resources are held by ${holders.join(", ") || "another assignment"}${keys.length ? ` on ${keys.join(", ")}` : ""}`, blockedBy: error.conflicts };
}

function openPeerForRequest(roots, parentTaskId, requestId) {
  return listPeerTasks(roots, parentTaskId).find((peer) => peer.slpRequestId === requestId) || null;
}

function processCreatePeer({ roots, request, adapter }) {
  const parent = readTask(roots.foremanHome, request.taskId);
  const project = core.findProject(roots.foremanHome, parent.projectId);
  const lead = readLead(roots.foremanHome, parent.projectId);
  if (!lead || lead.generation !== request.leadGeneration || lead.endpoint !== request.sourceEndpoint) return { status: "refused", reason: "Lead generation is stale" };
  if (parent.status !== "working" || parent.leadGeneration !== lead.generation) return { status: "refused", reason: `task is ${parent.status} or belongs to another Lead generation` };
  const payload = request.payload;
  if (payload.profile !== undefined || payload.dispatchProfile !== undefined) return { status: "refused", reason: "Lead requests cannot select or change worker profiles" };
  if (!PEER_ROLES.has(payload.role) || typeof payload.brief !== "string" || !payload.brief.trim() || typeof payload.scope !== "string" || !payload.scope.trim()) {
    return { status: "refused", reason: "create-peer requires a supported role, bounded brief, and explicit scope" };
  }
  if (!Array.isArray(payload.dependsOn || []) || (payload.dependsOn || []).some((id) => typeof id !== "string" || !/^T-\d{6,}$/.test(id))) return { status: "refused", reason: "dependsOn must be an array of direct Peer assignment IDs" };
  const peers = listPeerTasks(roots, parent.taskId);
  // A prerequisite unlocks dependents only through a Lead-recorded review milestone, never a raw `done` report.
  // The independent review Peer is the exception: it exists to produce that milestone for implementation/correction work.
  const unmet = (payload.dependsOn || []).filter((id) => {
    const prerequisite = peers.find((peer) => peer.taskId === id);
    if (!prerequisite || prerequisite.status !== "review-ready" || !prerequisite.peerRuntimeStopped || prerequisite.lastReport?.status !== "done") return true;
    if (payload.role === "review" && ["implementation", "correction"].includes(prerequisite.peerRole)) return false;
    return !prerequisite.reviewMilestoneId;
  });
  if (unmet.length) return { status: "waiting", waitKind: "prerequisite", reason: "Peer prerequisites require a verified stop and a Lead-recorded review milestone", dependsOn: unmet };
  if (!Array.isArray(payload.resolves || []) || (payload.resolves || []).some((id) => typeof id !== "string" || !/^T-\d{6,}$/.test(id))) return { status: "refused", reason: "resolves must be an array of direct blocked Peer assignment IDs" };
  const resolves = [...new Set(payload.resolves || [])];
  if (resolves.some((id) => !peers.some((peer) => peer.taskId === id && peer.status === "blocked" && !peer.slpResolvedBy))) return { status: "refused", reason: "resolves may reference only unresolved blocked Peers on this task" };
  if (payload.role === "correction" && !resolves.length) return { status: "refused", reason: "correction Peers must identify the blocked assignment they resolve" };
  const priorCorrections = peers.filter((peer) => peer.peerRole === "correction" && peer.endpoint && peer.slpRequestId !== request.requestId).length;
  if (payload.role === "correction" && Math.max(Number(parent.reviewCycles || 0), priorCorrections) >= MAX_CORRECTION_CYCLES) return { status: "refused", reason: `correction/review limit of ${MAX_CORRECTION_CYCLES} cycles is exhausted; escalate through Foreman` };
  const readOnly = ["exploration", "audit", "review"].includes(payload.role);
  const resources = normalizeResources(payload.resources, project.id, readOnly);
  if (["exploration", "audit"].includes(payload.role) && resources.some((claim) => claim.mode !== "read")) {
    return { status: "refused", reason: `${payload.role} Peers may claim read resources only` };
  }
  if (payload.role === "review" && resources.some((claim) => claim.mode !== "read" && !VERIFICATION_PREFIXES.some((prefix) => claim.key.startsWith(prefix)))) {
    return { status: "refused", reason: "review Peers may hold write claims only on verification resources (db/, test/, service/, mcp/); code surfaces stay read-only" };
  }
  if (payload.role === "review" && !peers.some((peer) => ["implementation", "correction"].includes(peer.peerRole) && peer.status === "review-ready" && peer.peerRuntimeStopped && peer.lastReport?.status === "done" && readReportPayload(peer))) {
    return { status: "waiting", waitKind: "prerequisite", reason: "Independent review waits for a completed, verified-stopped implementation or correction Peer" };
  }
  const existing = openPeerForRequest(roots, parent.taskId, request.requestId);
  if (existing?.endpoint) return { status: existing.peerRuntimeStopped ? "completed" : "dispatched", assignmentId: existing.taskId, generation: existing.generation, endpoint: existing.endpoint };
  const capacity = slpCapacity(roots);
  const activePeers = livePeersForProject(roots, project.id).filter((item) => item.taskId !== existing?.taskId);
  if (activePeers.length >= capacity.maxLivePeersPerProject) return { status: "waiting", waitKind: "capacity", reason: `project Peer capacity (${capacity.maxLivePeersPerProject}) is held by ${activePeers.map((item) => item.taskId).join(", ")}`, blockedBy: activePeers.map((item) => item.taskId) };
  if (!existing?.endpoint) {
    const held = endpointCapacityHeld(roots);
    if (held) return { status: "waiting", waitKind: "capacity", reason: `SLP endpoint capacity (${held.maxSlpEndpoints}) is exhausted by ${held.count} live endpoints` };
  }
  const profile = ensurePeerProfile(parent);
  core.validateDispatchProfile(profile, adapter.capabilities());
  let peer = existing;
  if (!peer) {
    const originalBrief = fs.readFileSync(path.join(taskDir(roots.foremanHome, parent.taskId), "brief.md"), "utf8");
    const notesFile = path.join(taskDir(roots.foremanHome, parent.taskId), "notes.md");
    const originalNotes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : "";
    const decisionsDir = path.join(taskDir(roots.foremanHome, parent.taskId), "decisions");
    const decisions = fs.existsSync(decisionsDir)
      ? fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(decisionsDir, name))).filter((decision) => decision.status === "delivered")
      : [];
    const brief = [
      "Original human requirements (preserve verbatim):",
      originalBrief,
      "",
      `Peer role: ${payload.role}`,
      `Delegated scope: ${payload.scope}`,
      "",
      "Peer assignment:",
      payload.brief,
      ...(decisions.length ? ["", "Human decisions to preserve verbatim:", ...decisions.map((decision) => `- ${decision.decisionId}: ${decision.humanResponse}`)] : []),
      ...(originalNotes ? ["", "Supporting context from Foreman:", originalNotes] : []),
    ].join("\n");
    const owner = `slp-peer-${digest({ projectId: project.id, taskId: parent.taskId, requestId: request.requestId }).slice(0, 16)}`;
    peer = core.createSlpPeerTask({
      roots,
      projectId: project.id,
      brief,
      parentTaskId: parent.taskId,
      peerRole: payload.role,
      owner,
      requestId: request.requestId,
      requestDigest: request.payloadDigest,
      delegatedScope: payload.scope,
      resources,
      peerDependencies: payload.dependsOn || [],
      resolvesBlockers: resolves,
    });
    peer = readTask(roots.foremanHome, peer.id);
  }
  if (peer.resourceLease && !peer.endpoint) {
    const visible = visibleAgent(adapter, peer.owner);
    if (visible) {
      const expected = { endpoint: visible.endpoint, owner: peer.owner, projectId: peer.projectId, generation: peer.generation, workspace: project.root, workspaceId: visible.workspaceId, paneId: visible.paneId };
      try { verifyRuntimeIdentity({ adapter, expected, actual: visible, operation: "Peer dispatch recovery" }); }
      catch (error) { recordAnomaly({ roots, projectId: project.id, taskId: parent.taskId, assignmentId: peer.taskId, type: "peer.identity-mismatch", endpoint: visible.endpoint, reason: error.message }); return { status: "waiting", reason: "existing endpoint identity is uncertain; lease retained" }; }
      peer = core.withHomeLock(roots.foremanHome, () => {
        const current = readTask(roots.foremanHome, peer.taskId);
        const next = { ...current, endpoint: visible.endpoint, workspaceId: visible.workspaceId, status: "working", assignedAt: current.assignedAt || now(), deliveryUnverified: "Recovered endpoint identity after coordinator restart" };
        core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), next);
        return next;
      });
    } else {
      recordAnomaly({ roots, projectId: project.id, taskId: parent.taskId, assignmentId: peer.taskId, type: "peer.dispatch-uncertain", endpoint: null, reason: "Peer has a durable lease but no verified endpoint after restart; no replacement was started" });
      return { status: "waiting", reason: "Peer endpoint is uncertain; lease retained for inspection" };
    }
  }
  if (!peer.endpoint) {
    try {
      peer = core.assignTask({
        roots,
        taskId: peer.taskId,
        owner: peer.owner || (usesTimeline(adapter) ? null : `slp-${peer.taskId}`.toLowerCase()),
        adapter,
        workspacePath: project.root,
        resources,
        dispatchProfile: profile,
        allowResourceConflicts: false,
      });
    } catch (error) {
      if (error instanceof core.ResourceBusyError) return resourceWait(error);
      if (error instanceof core.ValidationError) return { status: "refused", reason: error.message };
      throw error;
    }
  }
  if (!peer.endpoint) return { status: "waiting", reason: peer.deliveryUnverified || "Peer dispatch outcome is not verified; lease remains bound" };
  if (["implementation", "correction"].includes(peer.peerRole)) {
    invalidateOverlappingReadiness({ roots, byPeer: peer, keys: (peer.resources || []).filter((claim) => claim.mode !== "read").map((claim) => claim.key), adapter });
  }
  const parentNow = readTask(roots.foremanHome, parent.taskId);
  writeTask(roots, { ...parentNow, status: "working", waitingReason: null, leadGeneration: lead.generation, lastPeerRequestAt: now() });
  writeProjectState({ roots, projectId: project.id });
  return { status: "dispatched", assignmentId: peer.taskId, generation: peer.generation, endpoint: peer.endpoint, role: peer.peerRole, workspace: peer.workspace, resources: peer.resources };
}

function processMessagePeer({ roots, request, adapter }) {
  const parent = readTask(roots.foremanHome, request.taskId);
  const assignmentId = request.payload.assignmentId;
  const peer = listPeerTasks(roots, parent.taskId).find((item) => item.taskId === assignmentId);
  if (!peer || !peer.endpoint || peer.peerRuntimeStopped || !["working", "blocked"].includes(peer.status)) return { status: "refused", reason: "message-peer must target a live direct Peer on this task" };
  if (typeof request.payload.request !== "string" || !request.payload.request.trim()) return { status: "refused", reason: "message-peer requires a non-empty request" };
  const explicitMessageId = `M-SLP-${digest({ projectId: parent.projectId, taskId: parent.taskId, assignmentId, generation: peer.generation, requestId: request.requestId }).slice(0, 28)}`;
  const result = core.sendWorkerMessage({ roots, taskId: peer.taskId, payload: { request: request.payload.request }, adapter, explicitMessageId });
  if (result.delivery?.uncertain) {
    const reason = result.delivery.error || "Peer steering delivery is uncertain; it will be reconciled without resending";
    recordAnomaly({ roots, projectId: parent.projectId, taskId: parent.taskId, assignmentId, type: "peer.message-delivery-uncertain", endpoint: peer.endpoint, reason });
    return { status: "waiting", waitKind: "message", assignmentId, generation: peer.generation, messageId: result.message.messageId, reason };
  }
  resolveAnomalies({ roots, projectId: parent.projectId, assignmentId, types: ["peer.message-delivery-uncertain"] });
  return { status: "dispatched", assignmentId, generation: peer.generation, messageId: result.message.messageId };
}

// Lightweight milestone for a read-only exploration or audit Peer that other Peers depend on.
// It records the Lead's review of the delivered report and does not affect task readiness.
function savePrerequisiteMilestone({ roots, request, parent }) {
  const payload = request.payload;
  const peer = listPeerTasks(roots, parent.taskId).find((item) => item.taskId === payload.assignmentId);
  if (!peer) return { status: "refused", reason: "prerequisite milestone must reference a direct Peer on this task" };
  if (!["exploration", "audit"].includes(peer.peerRole)) return { status: "refused", reason: "implementation and correction prerequisites need an independent review milestone" };
  if (peer.status !== "review-ready" || !peer.peerRuntimeStopped || peer.lastReport?.status !== "done" || !peer.peerReportDeliveredAt) return { status: "refused", reason: "prerequisite Peer must have a delivered done report and a verified stop" };
  if (peer.reviewMilestoneId) return { status: "refused", reason: "prerequisite milestone is already recorded for this Peer" };
  const report = readReportPayload(peer);
  if (!report) return { status: "refused", reason: "prerequisite Peer report is missing or does not match its assignment identity" };
  if (report.openItems.length || report.checks.some((check) => ["failed", "error"].includes(check?.result))) return { status: "refused", reason: "prerequisite Peer report has open items or failed checks" };
  if (!Array.isArray(payload.evidence) || !payload.evidence.length || payload.evidence.some((item) => typeof item !== "string" || !item.trim())) return { status: "refused", reason: "prerequisite milestone requires evidence references" };
  if (typeof payload.summary !== "string" || !payload.summary.trim()) return { status: "refused", reason: "prerequisite milestone requires the Lead's review summary" };
  const id = `RV-${crypto.randomBytes(10).toString("hex")}`;
  const record = {
    schemaVersion: 1,
    milestoneId: id,
    kind: "prerequisite",
    taskId: parent.taskId,
    projectId: parent.projectId,
    leadGeneration: request.leadGeneration,
    assignmentId: peer.taskId,
    outcome: "accepted",
    evidence: payload.evidence,
    summary: boundedSummary(payload.summary),
    createdAt: now(),
  };
  core.withHomeLock(roots.foremanHome, () => {
    core.atomicJson(path.join(taskDir(roots.foremanHome, parent.taskId), "reviews", `${id}.json`), record);
    writeTaskUnlocked(roots, { ...readTask(roots.foremanHome, peer.taskId), reviewMilestoneId: id });
  });
  writeProjectState({ roots, projectId: parent.projectId });
  return { status: "completed", milestoneId: id, kind: "prerequisite", assignmentId: peer.taskId };
}

function saveReviewMilestone({ roots, request }) {
  const parent = readTask(roots.foremanHome, request.taskId);
  if (parent.status !== "working") return { status: "refused", reason: `review milestone requires an active task; task is ${parent.status}` };
  const payload = request.payload;
  if (payload.kind === "prerequisite") return savePrerequisiteMilestone({ roots, request, parent });
  const peers = listPeerTasks(roots, parent.taskId);
  const review = peers.find((peer) => peer.taskId === payload.reviewAssignmentId);
  if (!review || review.peerRole !== "review" || review.status !== "review-ready" || !review.peerRuntimeStopped || review.lastReport?.status !== "done") {
    return { status: "refused", reason: "record-review requires a completed, stopped, independent review Peer" };
  }
  const report = readReportPayload(review);
  if (!report) return { status: "refused", reason: "review Peer report is missing or does not match its assignment identity" };
  if (!Array.isArray(payload.relatedAssignmentIds) || !payload.relatedAssignmentIds.length) return { status: "refused", reason: "record-review requires relatedAssignmentIds: a non-empty array of every completed implementation/correction Peer assignment ID it reviews (alongside reviewAssignmentId, evidence, changedSurfaces, checks, integrationResult, unresolvedRisks, outcome, summary)" };
  const related = payload.relatedAssignmentIds.map((id) => peers.find((peer) => peer.taskId === id));
  if (related.some((peer) => !peer || !["implementation", "correction"].includes(peer.peerRole) || !peer.peerRuntimeStopped
    || !((peer.status === "review-ready" && peer.lastReport?.status === "done") || (peer.status === "blocked" && peer.slpResolvedBy)))) {
    return { status: "refused", reason: "review evidence must reference completed implementation/correction Peers and resolved review blockers" };
  }
  if (peers.some((peer) => ["implementation", "correction"].includes(peer.peerRole) && peer.status === "blocked" && !peer.slpResolvedBy)) return { status: "refused", reason: "review cannot pass while an implementation or correction Peer remains blocked" };
  if (!Array.isArray(payload.evidence) || !payload.evidence.length || payload.evidence.some((item) => typeof item !== "string" || !item.trim())) {
    return { status: "refused", reason: "record-review requires artifact or check evidence references" };
  }
  if (!["accepted", "changes-requested"].includes(payload.outcome)) return { status: "refused", reason: "review outcome must be accepted or changes-requested" };
  if (!Array.isArray(payload.changedSurfaces) || !payload.changedSurfaces.length || payload.changedSurfaces.some((item) => typeof item !== "string" || !item.trim())) return { status: "refused", reason: "record-review requires the reviewed changed surfaces" };
  if (!Array.isArray(payload.checks) || payload.checks.some((check) => !check || typeof check.name !== "string" || !check.name.trim() || !["passed", "failed", "error", "skipped", "not-run"].includes(check.result) || typeof check.source !== "string" || !check.source.trim() || typeof check.evidence !== "string" || !check.evidence.trim())) return { status: "refused", reason: "record-review requires checks with result, source, and evidence" };
  if (!["passed", "failed", "not-run"].includes(payload.integrationResult)) return { status: "refused", reason: "record-review requires an integrationResult of passed, failed, or not-run" };
  if (!Array.isArray(payload.unresolvedRisks) || payload.unresolvedRisks.some((item) => typeof item !== "string" || !item.trim())) return { status: "refused", reason: "record-review requires an unresolvedRisks array" };
  if (payload.outcome === "accepted" && (report.openItems.length || payload.unresolvedRisks.length)) return { status: "refused", reason: "accepted review cannot contain unresolved open items or risks" };
  if (payload.outcome === "accepted" && (!payload.checks.length || payload.integrationResult !== "passed" || payload.checks.some((check) => check.result !== "passed"))) return { status: "refused", reason: "accepted review requires passed integration and at least one evidenced passing check" };
  if (report.checks.some((check) => check?.result === "failed" || check?.result === "error")) return { status: "refused", reason: "review Peer report contains a failed required check" };
  const expectedRelated = peers.filter((peer) => ["implementation", "correction"].includes(peer.peerRole) && peer.peerRuntimeStopped
    && ((peer.status === "review-ready" && peer.lastReport?.status === "done") || (peer.status === "blocked" && peer.slpResolvedBy))).map((peer) => peer.taskId).sort();
  const actualRelated = [...new Set(related.map((peer) => peer.taskId))].sort();
  if (!expectedRelated.length || JSON.stringify(expectedRelated) !== JSON.stringify(actualRelated)) return { status: "refused", reason: "review milestone must cover every completed implementation and correction Peer" };
  if (Number(review.taskId.slice(2)) <= Math.max(...actualRelated.map((id) => Number(id.slice(2))))) return { status: "refused", reason: "independent review assignment must follow the implementation evidence it reviews" };
  const cycle = Number(parent.reviewCycles || 0) + (payload.outcome === "changes-requested" ? 1 : 0);
  if (payload.outcome === "changes-requested" && cycle > MAX_CORRECTION_CYCLES) return { status: "refused", reason: `correction/review limit of ${MAX_CORRECTION_CYCLES} cycles is exhausted; escalate through Foreman` };
  const id = `RV-${crypto.randomBytes(10).toString("hex")}`;
  const record = {
    schemaVersion: 1,
    milestoneId: id,
    taskId: parent.taskId,
    projectId: parent.projectId,
    leadGeneration: request.leadGeneration,
    reviewAssignmentId: review.taskId,
    relatedAssignmentIds: related.map((peer) => peer.taskId),
    outcome: payload.outcome,
    evidence: payload.evidence,
    changedSurfaces: payload.changedSurfaces,
    checks: payload.checks,
    integrationResult: payload.integrationResult,
    unresolvedRisks: payload.unresolvedRisks,
    summary: String(payload.summary || report.summary),
    findings: payload.findings || report.openItems,
    cycle,
    createdAt: now(),
  };
  const dir = path.join(taskDir(roots.foremanHome, parent.taskId), "reviews");
  core.withHomeLock(roots.foremanHome, () => {
    core.atomicJson(path.join(dir, `${id}.json`), record);
    const current = readTask(roots.foremanHome, parent.taskId);
    writeTaskUnlocked(roots, { ...current, latestReviewId: id, reviewCycles: record.cycle, reviewStatus: record.outcome });
    if (record.outcome === "accepted") {
      for (const peer of related) {
        const currentPeer = readTask(roots.foremanHome, peer.taskId);
        writeTaskUnlocked(roots, { ...currentPeer, reviewMilestoneId: id });
      }
    } else {
      for (const peer of related) {
        const currentPeer = readTask(roots.foremanHome, peer.taskId);
        const { slpResolvedBy, slpResolvedAt, ...unresolved } = currentPeer;
        writeTaskUnlocked(roots, { ...unresolved, status: "blocked", peerRuntimeStopped: true, resourceLease: null, slpReviewBlockerId: id, slpReviewFindings: record.findings });
      }
    }
  });
  writeProjectState({ roots, projectId: parent.projectId });
  return { status: "completed", milestoneId: id, outcome: record.outcome, reviewAssignmentId: review.taskId, relatedAssignmentIds: record.relatedAssignmentIds, cycle: record.cycle };
}

function createSlpDecision({ roots, request, parent, payload }) {
  const decision = payload.decision;
  if (!decision || typeof decision !== "object" || typeof decision.finding !== "string" || !decision.finding.trim() || typeof decision.why !== "string" || !decision.why.trim()
    || !Array.isArray(decision.options) || decision.options.length < 2 || decision.options.some((option) => typeof option !== "string" || !option.trim())
    || typeof decision.impact !== "string" || !decision.impact.trim() || typeof decision.evidence !== "string" || !decision.evidence.trim()
    || typeof decision.recommendation !== "string" || !decision.recommendation.trim()) {
    return { status: "refused", reason: "A human-decision blocker requires finding, why, at least two options, impact, evidence, and a recommendation" };
  }
  const peers = listPeerTasks(roots, parent.taskId);
  const affectedAssignmentIds = decision.affectedAssignmentIds || [];
  if (!Array.isArray(affectedAssignmentIds) || affectedAssignmentIds.some((id) => typeof id !== "string" || !peers.some((peer) => peer.taskId === id && peer.endpoint && !peer.peerRuntimeStopped && ["working", "blocked"].includes(peer.status)))) {
    return { status: "refused", reason: "affectedAssignmentIds must identify current live Peers on this task" };
  }
  const id = `D-${crypto.randomBytes(10).toString("hex")}`;
  const record = {
    schemaVersion: 1,
    decisionId: id,
    taskId: parent.taskId,
    projectId: parent.projectId,
    worker: null,
    generation: 0,
    leadGeneration: request.leadGeneration,
    finding: String(decision.finding),
    whyHumanDecisionRequired: String(decision.why),
    options: decision.options.map(String),
    affectedAssignmentIds: [...new Set(affectedAssignmentIds)],
    impact: decision.impact,
    evidence: decision.evidence,
    recommendation: decision.recommendation,
    blocker: true,
    status: "pending",
    createdAt: now(),
    answeredAt: null,
    deliveredAt: null,
    humanResponse: null,
  };
  const dir = path.join(taskDir(roots.foremanHome, parent.taskId), "decisions");
  core.withHomeLock(roots.foremanHome, () => {
    core.atomicJson(path.join(dir, `${id}.json`), record);
    const current = readTask(roots.foremanHome, parent.taskId);
    writeTaskUnlocked(roots, { ...current, status: "waiting-decision", waitingReason: `human decision ${id}`, decisionId: id, blockedAt: now() });
  });
  writeProjectState({ roots, projectId: parent.projectId });
  return { status: "waiting", decisionId: id, reason: "human decision is required" };
}

function leadReconstructionCheckpoint(payload) {
  const source = payload?.reconstruction;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const sections = ["projectState", "knowledge", "coreState"];
  if (sections.some((key) => typeof source[key] !== "string" || !source[key].trim() || source[key].trim().length > 2000)) return null;
  return Object.fromEntries(sections.map((key) => [key, source[key].trim()]));
}

function reportTask({ roots, request }) {
  const parent = readTask(roots.foremanHome, request.taskId);
  const payload = request.payload;
  if (!["ready", "blocked", "progress", "proof-complete"].includes(payload.status) || typeof payload.summary !== "string" || !payload.summary.trim()) {
    return { status: "refused", reason: "report-task requires ready, blocked, progress, or proof-complete and a non-empty summary" };
  }
  const hasReconstruction = Object.prototype.hasOwnProperty.call(payload, "reconstruction");
  const reconstruction = hasReconstruction ? leadReconstructionCheckpoint(payload) : null;
  if (hasReconstruction && (!reconstruction || payload.status !== "progress")) {
    return { status: "refused", reason: "Lead reconstruction requires progress status and non-empty projectState, knowledge, and coreState summaries of at most 2000 characters each" };
  }
  if (!["working", "blocked", "waiting-decision"].includes(parent.status)) return { status: "refused", reason: `task is ${parent.status} and cannot accept another Lead status report` };
  if (payload.status === "proof-complete") {
    if (parent.purpose !== "validation") return { status: "refused", reason: "proof-complete is available only for tasks explicitly marked validation" };
    if (parent.status === "waiting-decision") return { status: "refused", reason: "task still awaits a human decision" };
    if (!Array.isArray(payload.evidence) || payload.evidence.some((id) => typeof id !== "string") || new Set(payload.evidence).size !== payload.evidence.length) {
      return { status: "refused", reason: "proof-complete requires a unique evidence array of Peer task IDs" };
    }
    const peers = listPeerTasks(roots, parent.taskId);
    if (!peers.length) return { status: "refused", reason: "proof-complete requires at least one preserved validation Peer report" };
    const expected = peers.map((peer) => peer.taskId).sort();
    if (JSON.stringify([...payload.evidence].sort()) !== JSON.stringify(expected)) return { status: "refused", reason: "proof-complete evidence must reference every Peer on this validation task exactly once" };
    // A validation proof records what the bounded attempt established, including
    // a blocked Peer report; it does not claim a blocked finding was resolved or
    // that the gate passed. Delivery readiness retains its separate blocker checks.
    for (const peer of peers) {
      if (!["exploration", "audit"].includes(peer.peerRole)) return { status: "refused", reason: `validation Peer ${peer.taskId} has unsupported role ${peer.peerRole}` };
      if (peer.resourceLease || (peer.endpoint && !peer.peerRuntimeStopped)) return { status: "refused", reason: `Peer ${peer.taskId} may still be running or writing` };
      if (!peer.peerReportDeliveredAt || !peer.lastReport?.file || !fs.existsSync(peer.lastReport.file) || !readReportPayload(peer)) {
        return { status: "refused", reason: `Peer ${peer.taskId} does not have a preserved report delivered to the Lead` };
      }
    }
    const decisionsDir = path.join(taskDir(roots.foremanHome, parent.taskId), "decisions");
    if (fs.existsSync(decisionsDir)) {
      const openDecision = fs.readdirSync(decisionsDir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(decisionsDir, name)))
        .find((item) => item.status === "pending" || (item.status === "answered" && !item.deliveredAt));
      if (openDecision) return { status: "refused", reason: `decision ${openDecision.decisionId} is not reconciled` };
    }
    const completion = {
      schemaVersion: 1,
      taskId: parent.taskId,
      projectId: parent.projectId,
      leadGeneration: request.leadGeneration,
      status: "proof-complete",
      summary: payload.summary,
      evidence: peers.map((peer) => ({ taskId: peer.taskId, report: peer.lastReport.file, reportStatus: peer.lastReport.status })),
      createdAt: now(),
    };
    const file = path.join(taskDir(roots.foremanHome, parent.taskId), "proof.json");
    core.withHomeLock(roots.foremanHome, () => {
      core.atomicJson(file, completion);
      const current = readTask(roots.foremanHome, parent.taskId);
      writeTaskUnlocked(roots, { ...current, status: "proof-complete", proofReport: file, proofAt: completion.createdAt, latestLeadSummary: payload.summary, waitingReason: null, leadGeneration: request.leadGeneration });
    });
    writeProjectState({ roots, projectId: parent.projectId });
    return { status: "completed", taskStatus: "proof-complete", proofFile: file, peerAssignmentIds: peers.map((peer) => peer.taskId) };
  }
  if (parent.purpose === "validation" && payload.status === "ready") return { status: "refused", reason: "validation tasks record proof-complete and cannot enter product review or acceptance" };
  if (payload.status === "ready") {
    if (parent.status === "waiting-decision") return { status: "refused", reason: "task still awaits a human decision" };
    const reviewDir = path.join(taskDir(roots.foremanHome, parent.taskId), "reviews");
    const latest = parent.latestReviewId && fs.existsSync(path.join(reviewDir, `${parent.latestReviewId}.json`)) ? readJson(path.join(reviewDir, `${parent.latestReviewId}.json`)) : null;
    if (!latest || latest.outcome !== "accepted") return { status: "refused", reason: "task readiness requires an accepted independent review milestone" };
    const peers = listPeerTasks(roots, parent.taskId);
    const related = latest.relatedAssignmentIds.map((id) => peers.find((peer) => peer.taskId === id));
    const reviewed = peers.find((peer) => peer.taskId === latest.reviewAssignmentId);
    if (!reviewed || reviewed.peerRole !== "review" || related.some((peer) => !peer || !["implementation", "correction"].includes(peer.peerRole))) {
      return { status: "refused", reason: "accepted review evidence does not reference distinct implementation and review Peers" };
    }
    const expectedRelated = peers.filter((peer) => ["implementation", "correction"].includes(peer.peerRole) && peer.peerRuntimeStopped
      && ((peer.status === "review-ready" && peer.lastReport?.status === "done") || (peer.status === "blocked" && peer.slpResolvedBy))).map((peer) => peer.taskId).sort();
    if (JSON.stringify(expectedRelated) !== JSON.stringify([...latest.relatedAssignmentIds].sort())) return { status: "refused", reason: "the latest review does not cover the current implementation and correction reports" };
    const unresolved = peers.filter((peer) => peer.resourceLease && !peer.peerRuntimeStopped);
    if (unresolved.length) return { status: "refused", reason: `Peer ${unresolved[0].taskId} may still be writing` };
    const openBlocked = peers.find((peer) => peer.status === "blocked" && !peer.slpResolvedBy);
    if (openBlocked) return { status: "refused", reason: `Peer blocker ${openBlocked.taskId} has not been resolved by a correction assignment` };
    const incomplete = peers.find((peer) => ["implementation", "correction"].includes(peer.peerRole) && !((peer.status === "review-ready" && peer.peerRuntimeStopped && peer.lastReport?.status === "done") || (peer.status === "blocked" && peer.peerRuntimeStopped && peer.slpResolvedBy)));
    if (incomplete) return { status: "refused", reason: `implementation or correction Peer ${incomplete.taskId} has not completed reviewable work` };
    const implementationReports = related.map((peer) => ({ peer, report: readReportPayload(peer) }));
    if (implementationReports.some(({ peer, report }) => !report || !peer.peerRuntimeStopped
      || (peer.status === "review-ready" && (report.status !== "done" || report.openItems.length || report.checks.some((check) => ["failed", "error"].includes(check?.result))))
      || (peer.status === "blocked" && !peer.slpResolvedBy))) {
      return { status: "refused", reason: "implementation evidence has missing reports, unresolved items, or failed checks" };
    }
    const completion = {
      schemaVersion: 1,
      taskId: parent.taskId,
      projectId: parent.projectId,
      leadGeneration: request.leadGeneration,
      status: "ready",
      summary: payload.summary,
      reviewMilestoneId: latest.milestoneId,
      peerAssignmentIds: peers.map((peer) => peer.taskId),
      createdAt: now(),
    };
    const file = path.join(taskDir(roots.foremanHome, parent.taskId), "completion.json");
    core.withHomeLock(roots.foremanHome, () => {
      core.atomicJson(file, completion);
      const current = readTask(roots.foremanHome, parent.taskId);
      writeTaskUnlocked(roots, { ...current, status: "review-ready", completionReport: file, completionAt: completion.createdAt, waitingReason: null, leadGeneration: request.leadGeneration });
    });
    writeProjectState({ roots, projectId: parent.projectId });
    return { status: "completed", taskStatus: "review-ready", completionFile: file, reviewMilestoneId: latest.milestoneId };
  }
  if (payload.status === "blocked") {
    if (!payload.decision) return { status: "refused", reason: "blocked reports require a human decision package" };
    return createSlpDecision({ roots, request, parent, payload });
  }
  core.withHomeLock(roots.foremanHome, () => {
    const current = readTask(roots.foremanHome, parent.taskId);
    const lead = reconstruction ? readLead(roots.foremanHome, parent.projectId) : null;
    if (reconstruction && (!lead || lead.endpoint !== request.sourceEndpoint || lead.generation !== request.leadGeneration
      || lead.reconstructionRequiredGeneration !== request.leadGeneration)) {
      throw new SlpError("Lead reconstruction checkpoint is not required by the current generation");
    }
    const waitingDecision = current.status === "waiting-decision";
    writeTaskUnlocked(roots, {
      ...current,
      status: waitingDecision ? current.status : (payload.status === "blocked" ? "blocked" : "working"),
      latestLeadSummary: payload.summary,
      waitingReason: waitingDecision ? current.waitingReason : (payload.status === "blocked" ? payload.summary : null),
      leadGeneration: request.leadGeneration,
      updatedAt: now(),
    });
    if (reconstruction) {
      core.atomicJson(leadFile(roots.foremanHome, parent.projectId), {
        ...lead,
        reconstruction: {
          leadGeneration: request.leadGeneration,
          taskId: parent.taskId,
          summary: payload.summary.trim().slice(0, 2000),
          ...reconstruction,
          recordedAt: now(),
        },
      });
    }
  });
  writeProjectState({ roots, projectId: parent.projectId });
  return { status: payload.status === "blocked" ? "waiting" : "completed", taskStatus: payload.status === "blocked" ? "blocked" : "working", summary: payload.summary };
}

function processRequest({ roots, request, adapter }) {
  if (["dispatched", "completed", "refused"].includes(request.status)) return request;
  let parent;
  try { parent = readTask(roots.foremanHome, request.taskId); } catch (error) {
    const outcome = { status: "refused", reason: "request task record is unavailable" };
    const stale = updateRequest(roots, request, "refused", outcome);
    recordAnomaly({ roots, projectId: request.projectId, taskId: request.taskId, type: "request.task-missing", endpoint: request.sourceEndpoint, reason: error.message });
    return stale;
  }
  const currentLead = readLead(roots.foremanHome, request.projectId);
  if (!currentLead || currentLead.endpoint !== request.sourceEndpoint || currentLead.generation !== request.leadGeneration
    || parent.projectId !== request.projectId || core.taskModel(parent) !== "slp" || parent.leadGeneration !== request.leadGeneration) {
    const outcome = { status: "refused", reason: "request is stale or does not match the current task and project Lead generation" };
    const stale = updateRequest(roots, request, "refused", outcome);
    recordAnomaly({ roots, projectId: request.projectId, taskId: request.taskId, type: "request.stale-at-processing", endpoint: request.sourceEndpoint, reason: outcome.reason });
    return stale;
  }
  const hasReconstruction = Object.prototype.hasOwnProperty.call(request.payload, "reconstruction");
  const reconstruction = hasReconstruction && request.action === "report-task" && request.payload.status === "progress"
    ? leadReconstructionCheckpoint(request.payload)
    : null;
  if (hasReconstruction && !reconstruction) {
    const outcome = { status: "refused", reason: "Lead reconstruction requires progress status and non-empty projectState, knowledge, and coreState summaries of at most 2000 characters each" };
    const refused = updateRequest(roots, request, "refused", outcome);
    writeProjectState({ roots, projectId: request.projectId });
    return refused;
  }
  const reconstructionRequired = Number(currentLead.reconstructionRequiredGeneration) === Number(request.leadGeneration)
    && Number(currentLead.reconstruction?.leadGeneration) !== Number(request.leadGeneration);
  if (reconstructionRequired && !reconstruction) {
    const outcome = { status: "refused", reason: "Replacement Lead must record a bounded project reconstruction before making other requests" };
    const refused = updateRequest(roots, request, "refused", outcome);
    writeProjectState({ roots, projectId: request.projectId });
    return refused;
  }
  if (reconstruction && !reconstructionRequired) {
    const outcome = { status: "refused", reason: "A reconstruction checkpoint is accepted only once when required by a replacement or recovered Lead generation" };
    const refused = updateRequest(roots, request, "refused", outcome);
    writeProjectState({ roots, projectId: request.projectId });
    return refused;
  }
  const pendingDecision = pendingDecisionForTask(roots, parent.taskId, request.leadGeneration);
  if (pendingDecision && !reconstruction) {
    const outcome = { status: "waiting", reason: `task awaits human decision ${pendingDecision.decisionId}` };
    const waiting = updateRequest(roots, request, "waiting", outcome);
    writeProjectState({ roots, projectId: request.projectId });
    return waiting;
  }
  let outcome;
  try {
    if (request.action === "create-peer") outcome = processCreatePeer({ roots, request, adapter });
    else if (request.action === "message-peer") outcome = processMessagePeer({ roots, request, adapter });
    else if (request.action === "record-review") outcome = saveReviewMilestone({ roots, request });
    else if (request.action === "report-task") outcome = reportTask({ roots, request });
    else outcome = { status: "refused", reason: `Unsupported Lead action: ${request.action}` };
  } catch (error) {
    if (error instanceof core.ResourceBusyError) outcome = resourceWait(error);
    else if (error instanceof core.ValidationError) outcome = { status: "refused", reason: error.message };
    else {
      recordAnomaly({ roots, projectId: request.projectId, taskId: request.taskId, type: "request.processing-failed", endpoint: request.sourceEndpoint, reason: error.message });
      outcome = { status: "refused", reason: `request processing stopped safely after an unexpected core error: ${error.message}` };
    }
  }
  const status = outcome.status === "dispatched" ? "dispatched"
    : outcome.status === "waiting" ? "waiting"
      : outcome.status === "refused" ? "refused"
        : "completed";
  const updated = updateRequest(roots, request, status, outcome);
  writeProjectState({ roots, projectId: request.projectId });
  return updated;
}

function outstandingWaits(roots, projectId) {
  const lead = readLead(roots.foremanHome, projectId);
  if (!lead) return [];
  return requestsForLead(roots, projectId, lead.generation)
    .filter((request) => request.status === "waiting" && request.action === "create-peer" && REEVALUATED_WAITS.has(request.outcome?.waitKind));
}

// Core, not the Lead, reevaluates resource, capacity, and prerequisite waits in request order.
// The Lead is told once when a wait resolves; it never has to resend the request.
function reevaluateWaitingRequests({ roots, projectId, adapter }) {
  const resolved = [];
  const lead = readLead(roots.foremanHome, projectId);
  const steering = lead ? requestsForLead(roots, projectId, lead.generation).filter((request) => request.status === "waiting" && request.action === "message-peer" && request.outcome?.waitKind === "message") : [];
  for (const waiting of [...outstandingWaits(roots, projectId), ...steering]) {
    let parent;
    try { parent = readTask(roots.foremanHome, waiting.taskId); } catch (_) { continue; }
    if (parent.status !== "working") continue;
    const saved = processRequest({ roots, request: waiting, adapter });
    if (saved.status === "waiting") continue;
    const delivered = sendLeadMessage({ roots, projectId, taskId: saved.taskId, kind: "slp-request-outcome", payload: { requestId: saved.requestId, action: saved.action, outcome: saved.outcome }, adapter, requestId: `outcome-${saved.requestId}-${saved.status}` });
    if (delivered.delivered) {
      core.withHomeLock(roots.foremanHome, () => {
        const file = requestFile(roots.foremanHome, projectId, saved.leadGeneration, saved.requestId);
        core.atomicJson(file, { ...readJson(file), outcomeDeliveredAt: now(), outcomeDelivery: delivered });
      });
    }
    resolved.push({ requestId: saved.requestId, status: saved.status, delivered: Boolean(delivered.delivered) });
  }
  return resolved;
}

function assistantTexts(entries) {
  const responses = [];
  for (const source of entries || []) {
    const item = source?.item || source;
    if (item?.type !== "assistant_message" || typeof item.text !== "string") continue;
    const messageId = item.messageId || item.id || null;
    const response = { text: item.text, messageId, seqEnd: source?.seqEnd };
    const turnId = source?.turnId || (messageId ? `message:${messageId}` : null);
    if (turnId && responses.at(-1)?.turnId === turnId) responses[responses.length - 1] = { ...response, turnId };
    else responses.push({ ...response, turnId });
  }
  return responses;
}

function parseLeadEnvelope(text) {
  if (typeof text !== "string") return null;
  const value = core.normalizePaseoResponse(text);
  try { return validateLeadEnvelope(JSON.parse(value)); } catch (_) { return null; }
}

function requestsForLead(roots, projectId, generation) {
  const dir = requestDir(roots.foremanHome, projectId, generation);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name))).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

// A Lead with several active tasks answers its most recent core message; blame that task, not the first one listed.
function latestPromptedTask(roots, projectId, lead) {
  const active = listSlpTasks(roots, projectId).filter((item) => ["working", "blocked", "waiting-decision"].includes(item.status));
  const byId = new Map(active.map((item) => [item.taskId, item]));
  const latest = coordination.listMessages({ roots })
    .filter((message) => message.projectId === projectId && message.worker === lead.owner && Number(message.generation) === Number(lead.generation) && byId.has(message.taskId))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  return latest ? byId.get(latest.taskId) : (active[0] || null);
}

function pollLead({ roots, projectId, adapter }) {
  const lead = readLead(roots.foremanHome, projectId);
  if (!lead?.endpoint || lead.status !== "working") return { state: "unbound" };
  let inspection;
  try { inspection = adapter.inspect(lead.endpoint); }
  catch (error) {
    recordAnomaly({ roots, projectId, type: "lead.inspect-failed", endpoint: lead.endpoint, reason: error.message });
    return { state: "unavailable", error: error.message };
  }
  try { verifyPresentIdentity({ adapter, expected: lead, actual: inspection, operation: "Lead observation" }); }
  catch (error) {
    recordAnomaly({ roots, projectId, type: "lead.identity-mismatch", endpoint: lead.endpoint, reason: error.message });
    return { state: "mismatch", error: error.message };
  }
  const contextSignal = captureContextSignal(inspection.lastUsage);
  if (contextSignal) {
    const usageProgressed = !lead.contextSignal || contextSignal.usedTokens !== lead.contextSignal.usedTokens || contextSignal.maxTokens !== lead.contextSignal.maxTokens;
    core.withHomeLock(roots.foremanHome, () => {
      const current = readLead(roots.foremanHome, projectId);
      if (current.endpoint === lead.endpoint && current.generation === lead.generation) core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, contextSignal, lastUsageAt: contextSignal.observedAt, ...(usageProgressed ? { lastProgressAt: contextSignal.observedAt } : {}) });
    });
    resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.context-signal-missing"] });
  } else if (usesTimeline(adapter) && !inspection.activeTurn && !lead.contextSignal && !["missing", "stopped"].includes(String(inspection.status || "").toLowerCase())) {
    recordAnomaly({ roots, projectId, type: "lead.context-signal-missing", endpoint: lead.endpoint, reason: "Paseo did not report bounded context usage for the Lead endpoint" });
  }
  if (inspection.status === "missing" || inspection.status === "stopped") {
    recordAnomaly({ roots, projectId, type: `lead.${inspection.status}`, endpoint: lead.endpoint, reason: "Project Lead endpoint is unavailable; living Peers and their leases remain unchanged" });
    return { state: inspection.status };
  }
  if (!["running", "working", "idle", "finished", "done", "waiting", "error", ...(usesTimeline(adapter) ? [] : ["blocked"])].includes(String(inspection.status || "unknown").toLowerCase())) {
    recordAnomaly({ roots, projectId, type: "lead.runtime-unknown", endpoint: lead.endpoint, reason: `Unrecognized runtime state ${String(inspection.status || "unknown")}; no recovery or rollover is inferred` });
    return { state: "unknown" };
  }
  resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.runtime-unknown"] });
  const expectedFinishedAttention = inspection.attentionReason === "finished";
  const herdrBlocked = !usesTimeline(adapter) && String(inspection.status).toLowerCase() === "blocked";
  if ((inspection.requiresAttention && !expectedFinishedAttention) || inspection.pendingPermissions?.length || herdrBlocked) {
    if (herdrBlocked) recordAnomaly({ roots, projectId, type: "lead.permission-wait", endpoint: lead.endpoint, reason: "Herdr reports the Lead is blocked awaiting input" });
    else if (inspection.pendingPermissions?.length) recordAnomaly({ roots, projectId, type: "lead.permission-wait", endpoint: lead.endpoint, reason: `${inspection.pendingPermissions.length} permission request(s) await a human response` });
    else recordAnomaly({ roots, projectId, type: "lead.attention-required", endpoint: lead.endpoint, reason: runtimeAttentionReason(inspection, "Lead runtime requires attention") });
  } else resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.attention-required", "lead.permission-wait"] });
  if (inspection.pendingPermissions?.length || inspection.attentionReason === "permission" || herdrBlocked) return { state: "waiting-input" };
  if (inspection.activeTurn) {
    const startedAt = Date.parse(inspection.activeTurn.startedAt || "");
    const lastProgressAt = Date.parse(lead.lastProgressAt || lead.lastPromptAt || "");
    if (Number.isFinite(startedAt) && Date.now() - startedAt >= ACTIVE_TURN_NO_PROGRESS_MS
      && Number.isFinite(lastProgressAt) && Date.now() - lastProgressAt >= ACTIVE_TURN_NO_PROGRESS_MS) {
      recordAnomaly({ roots, projectId, type: "lead.stuck-turn", endpoint: lead.endpoint, reason: `Lead context usage has not advanced for at least ${Math.round(ACTIVE_TURN_NO_PROGRESS_MS / 60000)} minutes; endpoint liveness is not inferred` });
    }
    return { state: "working" };
  }
  resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.stuck-turn"] });
  if (!["idle", "finished", "done"].includes(String(inspection.status).toLowerCase())) return { state: "working" };
  if (!usesTimeline(adapter)) return processHerdrLeadRequests({ roots, projectId, lead, adapter });
  let timeline;
  try { timeline = adapter.read(lead.endpoint, lead.timelineCursor || null); }
  catch (error) {
    recordAnomaly({ roots, projectId, type: "lead.timeline-unavailable", endpoint: lead.endpoint, reason: error.message });
    return { state: "unavailable", error: error.message };
  }
  try { verifyRuntimeIdentity({ adapter, expected: lead, actual: timeline, operation: "Lead report collection" }); }
  catch (error) {
    recordAnomaly({ roots, projectId, type: "lead.timeline-identity-mismatch", endpoint: lead.endpoint, reason: error.message });
    return { state: "mismatch", error: error.message };
  }
  if (timeline.gap || timeline.staleCursor) {
    recordAnomaly({ roots, projectId, type: timeline.gap ? "lead.timeline-gap" : "lead.timeline-cursor-stale", endpoint: lead.endpoint, reason: "Timeline continuity is uncertain; no request was executed" });
    return { state: "uncertain" };
  }
  const responses = assistantTexts(timeline.entries);
  if (!responses.length) {
    const task = latestPromptedTask(roots, projectId, lead);
    if (task && task.status !== "waiting-decision" && lead.lastPromptAt && Date.now() - Date.parse(lead.lastPromptAt) >= ACTIVE_TURN_NO_PROGRESS_MS) {
      recordAnomaly({ roots, projectId, taskId: task.taskId, type: "lead.no-report", endpoint: lead.endpoint, reason: "Lead is idle without a new report after an actionable prompt; endpoint liveness is not inferred" });
    }
    return { state: "idle" };
  }
  const response = responses[0];
  const responseCursor = Number.isInteger(response.seqEnd) && timeline.cursor
    ? { ...timeline.cursor, seq: response.seqEnd }
    : timeline.cursor;
  if (core.normalizePaseoResponse(response.text) === "waiting") {
    core.withHomeLock(roots.foremanHome, () => {
      const current = readLead(roots.foremanHome, projectId);
      if (current.endpoint === lead.endpoint && current.generation === lead.generation) {
        core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, timelineCursor: responseCursor || current.timelineCursor || null, actionableTurns: Number(current.actionableTurns || 0) + 1 });
      }
    });
    resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.request-invalid"] });
    return { state: "idle" };
  }
  core.withHomeLock(roots.foremanHome, () => {
    const current = readLead(roots.foremanHome, projectId);
    if (current.endpoint === lead.endpoint && current.generation === lead.generation) {
      core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, timelineCursor: responseCursor || current.timelineCursor || null, actionableTurns: Number(current.actionableTurns || 0) + 1 });
    }
  });
  resolveAnomalies({ roots, projectId, taskId: responseTaskId(roots, projectId, null) || undefined, endpoint: lead.endpoint, types: ["lead.no-report"] });
  const envelope = parseLeadEnvelope(response.text);
  if (!envelope) {
    core.withHomeLock(roots.foremanHome, () => {
      const current = readLead(roots.foremanHome, projectId);
      if (current.endpoint === lead.endpoint && current.generation === lead.generation) core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, timelineCursor: responseCursor || current.timelineCursor || null });
    });
    recordAnomaly({ roots, projectId, type: "lead.request-invalid", endpoint: lead.endpoint, reason: "Latest Lead response did not contain exactly one valid SLP request envelope" });
    const activeTask = latestPromptedTask(roots, projectId, lead);
    if (activeTask) sendLeadMessage({ roots, projectId, taskId: activeTask.taskId, kind: "slp-request-error", payload: { error: "Return exactly one supported JSON request envelope as the final response for each Lead action." }, adapter, requestId: `invalid-${response.messageId || digest(response.text).slice(0, 10)}` });
    return { state: "invalid-response" };
  }
  resolveAnomalies({ roots, projectId, endpoint: lead.endpoint, types: ["lead.request-invalid"] });
  if (envelope.projectId !== projectId) {
    recordAnomaly({ roots, projectId, taskId: envelope.taskId, type: "request.cross-project", endpoint: lead.endpoint, reason: "Lead request projectId does not match the bound project Lead" });
    const safeTaskId = responseTaskId(roots, projectId, envelope.taskId);
    const delivered = safeTaskId ? sendLeadMessage({ roots, projectId, taskId: safeTaskId, kind: "slp-request-outcome", payload: { requestId: envelope.requestId, action: envelope.action, outcome: { status: "refused", reason: "request projectId does not match the bound project Lead" } }, adapter, requestId: `cross-project-${envelope.requestId}` }) : { delivered: false, waiting: true, reason: "no active project task is available to carry the refusal" };
    core.withHomeLock(roots.foremanHome, () => {
      const current = readLead(roots.foremanHome, projectId);
      if (current.endpoint === lead.endpoint && current.generation === lead.generation) core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, timelineCursor: responseCursor || current.timelineCursor || null });
    });
    return { state: "refused", requestId: envelope.requestId, reason: "request projectId does not match the bound project Lead", delivered };
  }
  const request = recordLeadRequest({ roots, sourceEndpoint: lead.endpoint, sourceGeneration: lead.generation, sourceWorkspaceId: lead.workspaceId, envelope });
  if (request.accepted === false) {
    const safeTaskId = responseTaskId(roots, projectId, envelope.taskId);
    const delivered = safeTaskId ? sendLeadMessage({ roots, projectId, taskId: safeTaskId, kind: "slp-request-outcome", payload: { requestId: envelope.requestId, action: envelope.action, outcome: { status: "refused", reason: request.reason } }, adapter, requestId: `request-conflict-${envelope.requestId}-${digest(envelope.payload).slice(0, 12)}` }) : { delivered: false, waiting: true, reason: "no active project task is available to carry the refusal" };
    core.withHomeLock(roots.foremanHome, () => {
      const current = readLead(roots.foremanHome, projectId);
      if (current.endpoint === lead.endpoint && current.generation === lead.generation) core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, timelineCursor: responseCursor || current.timelineCursor || null });
    });
    return { state: "refused", requestId: envelope.requestId, reason: request.reason, delivered };
  }
  return finishRequest({ roots, projectId, lead, request, adapter, timelineCursor: responseCursor });
}

// Process one recorded request and carry its outcome to the Lead; the cursor is kept when delivery waits.
function finishRequest({ roots, projectId, lead, request, adapter, timelineCursor }) {
  const envelope = request;
  if (request.status === "pending" || request.status === "waiting") processRequest({ roots, request, adapter });
  const requestRecordFile = requestFile(roots.foremanHome, lead.projectId, envelope.leadGeneration, envelope.requestId);
  const saved = readJson(requestRecordFile);
  const taskId = responseTaskId(roots, projectId, saved.taskId);
  const result = saved.outcome || { status: saved.status, requestId: saved.requestId };
  const delivered = taskId ? sendLeadMessage({ roots, projectId, taskId, kind: "slp-request-outcome", payload: { requestId: saved.requestId, action: saved.action, outcome: result }, adapter, requestId: `outcome-${saved.requestId}` }) : { delivered: false, waiting: true, reason: "no active project task is available to carry the request outcome" };
  core.withHomeLock(roots.foremanHome, () => {
    const current = readJson(requestRecordFile);
    core.atomicJson(requestRecordFile, { ...current, outcomeDeliveredAt: delivered.delivered ? now() : current.outcomeDeliveredAt, outcomeDelivery: delivered });
  });
  core.withHomeLock(roots.foremanHome, () => {
    const current = readLead(roots.foremanHome, projectId);
    if (current.endpoint === lead.endpoint && current.generation === lead.generation && !delivered.delivered) core.atomicJson(leadFile(roots.foremanHome, projectId), { ...current, timelineCursor: timelineCursor || current.timelineCursor || null });
  });
  return { state: saved.status, requestId: saved.requestId, outcome: result, delivered };
}

// Herdr Leads submit requests through `foreman lead request`; the coordinator processes what was recorded.
function leadForPane(roots, paneId) {
  const root = leadsDir(roots.foremanHome);
  if (!paneId || !fs.existsSync(root)) return null;
  for (const projectId of fs.readdirSync(root)) {
    const lead = fs.existsSync(leadFile(roots.foremanHome, projectId)) ? readLead(roots.foremanHome, projectId) : null;
    if (lead?.backend === "herdr" && lead.endpoint && lead.status === "working" && lead.paneId === paneId) return lead;
  }
  return null;
}

function submitLeadRequest({ roots, paneId, envelope }) {
  validateLeadEnvelope(envelope);
  const lead = leadForPane(roots, paneId);
  if (!lead) throw new SlpError("This pane is not the current project Lead; Lead requests are accepted only from the bound Lead pane");
  if (envelope.projectId !== lead.projectId) {
    recordAnomaly({ roots, projectId: lead.projectId, taskId: envelope.taskId, type: "request.cross-project", endpoint: lead.endpoint, reason: "Lead request projectId does not match the bound project Lead" });
    throw new SlpError("Lead request projectId does not match the bound project Lead");
  }
  const isNew = !fs.existsSync(requestFile(roots.foremanHome, envelope.projectId, envelope.leadGeneration, envelope.requestId));
  const request = recordLeadRequest({ roots, sourceEndpoint: lead.endpoint, sourceGeneration: lead.generation, sourceWorkspaceId: lead.workspaceId, envelope });
  if (request.accepted !== false) {
    core.withHomeLock(roots.foremanHome, () => {
      const current = readLead(roots.foremanHome, lead.projectId);
      if (current.endpoint === lead.endpoint && current.generation === lead.generation) {
        core.atomicJson(leadFile(roots.foremanHome, lead.projectId), { ...current, lastRequestAt: now(), actionableTurns: Number(current.actionableTurns || 0) + (isNew ? 1 : 0) });
      }
    });
    resolveAnomalies({ roots, projectId: lead.projectId, endpoint: lead.endpoint, types: ["lead.no-report"] });
  }
  return request;
}

function processHerdrLeadRequests({ roots, projectId, lead, adapter }) {
  const pending = requestsForLead(roots, projectId, lead.generation).filter((request) => request.status === "pending");
  if (!pending.length) {
    const task = latestPromptedTask(roots, projectId, lead);
    const lastAction = Date.parse(lead.lastRequestAt || "") || 0;
    const promptedAt = Date.parse(lead.lastPromptAt || "");
    if (task && task.status !== "waiting-decision" && Number.isFinite(promptedAt) && promptedAt > lastAction && Date.now() - promptedAt >= ACTIVE_TURN_NO_PROGRESS_MS) {
      recordAnomaly({ roots, projectId, taskId: task.taskId, type: "lead.no-report", endpoint: lead.endpoint, reason: "Lead is idle without a new request after an actionable prompt; endpoint liveness is not inferred" });
    }
    return { state: "idle" };
  }
  const results = pending.map((request) => finishRequest({ roots, projectId, lead, request, adapter, timelineCursor: null }));
  return results.at(-1);
}

function stopReportedPeer({ roots, peer, adapter }) {
  const reportedProgress = peer.status === "working" && peer.lastReport?.status === "progress";
  if (!peer.endpoint || peer.peerRuntimeStopped || (!reportedProgress && !["review-ready", "blocked"].includes(peer.status))) return peer;
  if (peer.lastReport?.at && peer.lastPromptAt && Date.parse(peer.lastReport.at) < Date.parse(peer.lastPromptAt)) return peer;
  if (coordination.listMessages({ roots, statuses: ["pending"] }).some((message) => message.taskId === peer.taskId && message.endpoint === peer.endpoint && Number(message.generation) === Number(peer.generation) && message.kind === "foreman-message")) return peer;
  let before;
  try { before = adapter.inspect(peer.endpoint); }
  catch (error) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.inspect-failed", endpoint: peer.endpoint, reason: error.message });
    return peer;
  }
  const expected = { endpoint: peer.endpoint, owner: peer.owner, projectId: peer.projectId, generation: peer.generation, workspace: peer.workspace, workspaceId: peer.workspaceId, paneId: peer.paneId };
  try { verifyPresentIdentity({ adapter, expected, actual: before, operation: "Peer stop" }); }
  catch (error) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.identity-mismatch", endpoint: peer.endpoint, reason: error.message });
    return peer;
  }
  if (before.activeTurn) return peer;
  // Herdr has no active-turn field: the pane must be idle so the turn that submitted the report has ended.
  if (!usesTimeline(adapter) && !["idle", "done", "missing", "stopped"].includes(String(before.status).toLowerCase())) return peer;
  try {
    if (!["missing", "stopped"].includes(String(before.status).toLowerCase())) {
      const stopped = adapter.stop(peer.endpoint);
      if (!stopped || stopped.stopped === false) throw new SlpError(`${adapterBackend(adapter)} did not confirm Peer stop`);
    }
    const after = adapter.inspect(peer.endpoint);
    if (!after || !["missing", "stopped"].includes(String(after.status).toLowerCase())) throw new SlpError("Peer endpoint remains active after stop");
    const clearedClaimBlockers = [];
    const result = core.withHomeLock(roots.foremanHome, () => {
      const current = readTask(roots.foremanHome, peer.taskId);
      const next = { ...current, resourceLease: null, peerRuntimeStopped: true, peerStoppedAt: now(), endpoint: current.endpoint, ...(current.pendingResources ? { pendingResources: [] } : {}) };
      core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), next);
      const correctionReport = next.peerRole === "correction" ? readReportPayload(next) : null;
      if (next.peerRole === "correction" && next.status === "review-ready" && correctionReport?.status === "done"
        && !next.slpClaimExceeded?.length && !correctionReport.openItems.length
        && !correctionReport.checks.some((check) => ["failed", "error", "not-run"].includes(check.result))) {
        for (const blockedId of next.resolvesBlockers || []) {
          const blockedFile = taskMetaFile(roots.foremanHome, blockedId);
          if (!fs.existsSync(blockedFile)) continue;
          const blocked = readTask(roots.foremanHome, blockedId);
          if (blocked.parentTaskId === next.parentTaskId && blocked.status === "blocked" && !blocked.slpResolvedBy) {
            core.atomicJson(blockedFile, { ...blocked, slpResolvedBy: next.taskId, slpResolvedAt: now() });
            if (blocked.slpClaimExceeded) clearedClaimBlockers.push(blocked);
          }
        }
      }
      return next;
    });
    // The home lock is not reentrant, so anomaly resolution waits until the Peer record is durable.
    for (const blocked of clearedClaimBlockers) resolveAnomalies({ roots, projectId: blocked.projectId, assignmentId: blocked.taskId, types: ["peer.claim-exceeded"] });
    return result;
  } catch (error) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.stop-unverified", endpoint: peer.endpoint, reason: error.message });
    return peer;
  }
}

function observePeerHealth({ roots, peer, adapter }) {
  if (!peer.endpoint || peer.peerRuntimeStopped || !["working", "blocked"].includes(peer.status)) return;
  let inspection;
  try { inspection = adapter.inspect(peer.endpoint); }
  catch (error) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.runtime-unknown", endpoint: peer.endpoint, reason: error.message });
    return;
  }
  const expected = { endpoint: peer.endpoint, owner: peer.owner, projectId: peer.projectId, generation: peer.generation, workspace: peer.workspace, workspaceId: peer.workspaceId, paneId: peer.paneId };
  try { verifyPresentIdentity({ adapter, expected, actual: inspection, operation: "Peer health observation" }); }
  catch (error) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.runtime-unknown", endpoint: peer.endpoint, reason: error.message });
    return;
  }
  const usageSignal = captureContextSignal(inspection.lastUsage);
  let lastProgressAt = peer.lastProgressAt || peer.lastPromptAt || null;
  if (usageSignal) {
    const progressed = !peer.runtimeContextSignal || usageSignal.usedTokens !== peer.runtimeContextSignal.usedTokens || usageSignal.maxTokens !== peer.runtimeContextSignal.maxTokens;
    if (progressed) lastProgressAt = usageSignal.observedAt;
    core.withHomeLock(roots.foremanHome, () => {
      const current = readTask(roots.foremanHome, peer.taskId);
      if (current.endpoint === peer.endpoint && current.generation === peer.generation) {
        core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), { ...current, runtimeContextSignal: usageSignal, ...(progressed ? { lastProgressAt } : {}) });
      }
    });
  }
  const status = String(inspection.status || "unknown").toLowerCase();
  if (["missing", "stopped"].includes(status)) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: `peer.${status}`, endpoint: peer.endpoint, reason: "Peer endpoint is unavailable; its resource lease remains held pending explicit recovery" });
    return;
  }
  if (!["running", "working", "idle", "finished", "done", "waiting", "error", ...(usesTimeline(adapter) ? [] : ["blocked"])].includes(status)) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.runtime-unknown", endpoint: peer.endpoint, reason: `Unrecognized runtime state ${status}; resource lease remains held` });
    return;
  }
  if (inspection.pendingPermissions?.length || inspection.attentionReason === "permission" || (!usesTimeline(adapter) && status === "blocked")) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.permission-wait", endpoint: peer.endpoint, reason: `${inspection.pendingPermissions?.length || 1} permission request(s) await a human response` });
  } else resolveAnomalies({ roots, projectId: peer.projectId, assignmentId: peer.taskId, endpoint: peer.endpoint, types: ["peer.permission-wait"] });
  if ((inspection.requiresAttention && inspection.attentionReason === "error") || status === "error") {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.attention-required", endpoint: peer.endpoint, reason: runtimeAttentionReason(inspection, "Peer runtime requires attention") });
  } else resolveAnomalies({ roots, projectId: peer.projectId, assignmentId: peer.taskId, endpoint: peer.endpoint, types: ["peer.attention-required"] });
  if (inspection.activeTurn) {
    const startedAt = Date.parse(inspection.activeTurn.startedAt || "");
    const progressAt = Date.parse(lastProgressAt || "");
    if (Number.isFinite(startedAt) && Date.now() - startedAt >= ACTIVE_TURN_NO_PROGRESS_MS
      && Number.isFinite(progressAt) && Date.now() - progressAt >= ACTIVE_TURN_NO_PROGRESS_MS) {
      recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.stuck-turn", endpoint: peer.endpoint, reason: `Peer context usage has not advanced for at least ${Math.round(ACTIVE_TURN_NO_PROGRESS_MS / 60000)} minutes; endpoint liveness is not inferred` });
    } else resolveAnomalies({ roots, projectId: peer.projectId, assignmentId: peer.taskId, endpoint: peer.endpoint, types: ["peer.stuck-turn"] });
    return;
  }
  resolveAnomalies({ roots, projectId: peer.projectId, assignmentId: peer.taskId, endpoint: peer.endpoint, types: ["peer.stuck-turn", "peer.missing", "peer.stopped", "peer.runtime-unknown"] });
  if (["idle", "finished", "done"].includes(status) && !peer.lastReport?.file && peer.lastPromptAt
    && Date.now() - Date.parse(peer.lastPromptAt) >= ACTIVE_TURN_NO_PROGRESS_MS) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.no-report", endpoint: peer.endpoint, reason: "Peer is idle without a report after an actionable prompt; its resource lease remains held" });
  } else resolveAnomalies({ roots, projectId: peer.projectId, assignmentId: peer.taskId, endpoint: peer.endpoint, types: ["peer.no-report"] });
}

const RESOURCE_PREFIXES = ["file/", "db/", "test/", "service/", "mcp/", "workspace/"];
// Resources a review Peer may hold with write access: shared verification surfaces, never code.
const VERIFICATION_PREFIXES = ["db/", "test/", "service/", "mcp/"];

// Map a reported changed surface to a claim key; a path outside the workspace has no key and is never covered.
function surfaceKey(surface, workspace) {
  let value = String(surface || "").trim();
  if (!value) return null;
  if (RESOURCE_PREFIXES.some((prefix) => value.startsWith(prefix))) return value;
  if (path.isAbsolute(value)) {
    const relative = path.relative(workspace, value);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    value = relative;
  }
  value = value.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!value || value.split("/").includes("..")) return null;
  return `file/${value}`;
}

function claimCovers(claimKey, key) {
  if (claimKey.endsWith("/**")) {
    const prefix = claimKey.slice(0, -3).replace(/\/+$/, "");
    return key === prefix || key.startsWith(`${prefix}/`);
  }
  return key === claimKey || key.startsWith(`${claimKey}/`);
}

// Another task's accepted review covers specific surfaces. When a Peer on a different task may change (claims at
// dispatch) or did change (surfaces outside its claims) an overlapping surface, that review no longer describes the
// workspace: clear it so readiness needs a new independent review.  The review record, completion record, and every
// Peer stay on disk as evidence; only the pointers that grant readiness are cleared.
function invalidateOverlappingReadiness({ roots, byPeer, keys, adapter }) {
  const invalidated = [];
  if (!keys.length) return invalidated;
  const project = core.findProject(roots.foremanHome, byPeer.projectId);
  for (const task of listSlpTasks(roots, byPeer.projectId)) {
    if (task.taskId === byPeer.parentTaskId || !task.latestReviewId || task.reviewStatus !== "accepted") continue;
    if (!["working", "blocked", "waiting-decision", "review-ready"].includes(task.status)) continue;
    const reviewFile = path.join(taskDir(roots.foremanHome, task.taskId), "reviews", `${task.latestReviewId}.json`);
    if (!fs.existsSync(reviewFile)) continue;
    const reviewed = (readJson(reviewFile).changedSurfaces || []).map((surface) => surfaceKey(surface, project.root)).filter(Boolean);
    const touched = keys.filter((key) => key === `workspace/${project.id}` || reviewed.some((item) => claimCovers(key, item) || claimCovers(item, key)));
    if (!touched.length) continue;
    const reason = `readiness invalidated: Peer ${byPeer.taskId} on ${byPeer.parentTaskId} may change ${touched.join(", ")}, which the accepted review of ${task.taskId} covered`;
    const changed = core.withHomeLock(roots.foremanHome, () => {
      const current = readTask(roots.foremanHome, task.taskId);
      if (current.latestReviewId !== task.latestReviewId) return false;
      const { completionReport, completionAt, ...rest } = current;
      writeTaskUnlocked(roots, {
        ...rest,
        latestReviewId: null,
        reviewStatus: null,
        ...(current.status === "review-ready" ? { status: "working", waitingReason: reason } : {}),
        invalidatedEvidence: [...(current.invalidatedEvidence || []), { reviewId: task.latestReviewId, completionReport: completionReport || null, invalidatedBy: byPeer.taskId, surfaces: touched, at: now() }],
      });
      return true;
    });
    if (!changed) continue;
    sendLeadMessage({
      roots,
      projectId: project.id,
      taskId: task.taskId,
      kind: "slp-readiness-invalidated",
      payload: { taskId: task.taskId, reviewId: task.latestReviewId, invalidatedBy: byPeer.taskId, surfaces: touched, reason, next: "Create a new independent review Peer, record the review, and report readiness again." },
      adapter,
      requestId: `invalidate-${task.taskId}-${task.latestReviewId}`,
    });
    invalidated.push({ taskId: task.taskId, reviewId: task.latestReviewId, surfaces: touched });
  }
  return invalidated;
}

// An implementation or correction Peer's reported surfaces must stay within its write claims.
// A report outside them is a blocker: the Peer becomes blocked, so only a correction Peer that resolves it can clear
// review and readiness, exactly like a failed review.
function verifyReportedClaims({ roots, peer, adapter }) {
  if (!["implementation", "correction"].includes(peer.peerRole) || peer.status !== "review-ready" || peer.lastReport?.status !== "done"
    || !peer.lastReport?.file || peer.slpClaimsVerifiedReport === peer.lastReport.file) return peer;
  const report = readReportPayload(peer);
  if (!report) return peer;
  const writes = (peer.resources || []).filter((claim) => claim.mode !== "read").map((claim) => claim.key);
  const exceeded = report.changedSurfaces.filter((surface) => {
    const key = surfaceKey(surface, peer.workspace);
    return !key || !writes.some((claim) => claim === `workspace/${peer.projectId}` || claimCovers(claim, key));
  });
  const next = core.withHomeLock(roots.foremanHome, () => {
    const current = readTask(roots.foremanHome, peer.taskId);
    if (current.lastReport?.file !== peer.lastReport.file || current.endpoint !== peer.endpoint) return current;
    const updated = { ...current, slpClaimsVerifiedReport: peer.lastReport.file, ...(exceeded.length ? { status: "blocked", slpClaimExceeded: exceeded } : {}) };
    core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), updated);
    return updated;
  });
  if (exceeded.length) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.claim-exceeded", endpoint: peer.endpoint, reason: `Reported changed surfaces outside the Peer's write claims: ${exceeded.join(", ")}` });
    invalidateOverlappingReadiness({ roots, byPeer: peer, keys: exceeded.map((surface) => surfaceKey(surface, peer.workspace)).filter(Boolean), adapter });
  }
  return next;
}

function deliverPeerReport({ roots, peer, adapter }) {
  if (!peer.peerRuntimeStopped || peer.peerReportDeliveredAt || !peer.lastReport?.file) return null;
  const report = readReportPayload(peer);
  if (!report) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.report-missing", endpoint: peer.endpoint, reason: "A completed Peer report file is missing" });
    return null;
  }
  const result = sendLeadMessage({
    roots,
    projectId: peer.projectId,
    taskId: peer.parentTaskId,
    kind: "slp-peer-report",
    payload: {
      assignmentId: peer.taskId,
      generation: peer.generation,
      role: peer.peerRole,
      status: report.status,
      summary: boundedSummary(report.summary),
      changedSurfaces: report.changedSurfaces,
      ...(peer.slpClaimExceeded?.length ? { claimExceeded: peer.slpClaimExceeded } : {}),
      openItems: report.openItems,
      reportFile: peer.lastReport.file,
    },
    adapter,
    requestId: `peer-report-${peer.taskId}-g${peer.generation}`,
  });
  if (!result.delivered) recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "peer.report-delivery-pending", endpoint: readLead(roots.foremanHome, peer.projectId)?.endpoint || null, reason: result.reason || "Peer report remains durable until the Lead is available" });
  if (result.delivered) {
    core.withHomeLock(roots.foremanHome, () => {
      const current = readTask(roots.foremanHome, peer.taskId);
      core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), { ...current, peerReportDeliveredAt: now() });
    });
    resolveAnomalies({ roots, projectId: peer.projectId, assignmentId: peer.taskId, types: ["peer.report-delivery-pending"] });
  }
  return result;
}

function dispatchWaitingTask({ roots, projectId, adapter }) {
  const lead = readLead(roots.foremanHome, projectId);
  if (!lead?.endpoint || lead.dispatchPaused) return null;
  if (activeTopLevelTasks(roots, projectId, null).length >= slpCapacity(roots).maxActiveTasksPerProject) return null;
  const queued = listSlpTasks(roots, projectId).find((meta) => meta.status === "queued" && meta.profileConfirmedAt && meta.dispatchProfile);
  if (!queued) return null;
  return dispatchSlpTask({ roots, taskId: queued.taskId, adapter, startCoordinator: false });
}

// One coordinator per home serves both backends; each project is served by the adapter of its bound backend.
function projectBackend(roots, projectId) {
  const lead = readLead(roots.foremanHome, projectId);
  return lead?.backend || listSlpTasks(roots, projectId).find((meta) => meta.backend)?.backend || null;
}

// Retry observations only; mutations require durable reconciliation instead of blind retries.
function observationAdapter(adapter) {
  if (!adapter) return adapter;
  const wrapped = Object.create(adapter);
  for (const method of ["spawn", "send", "stop", "interrupt", "verifyCompatibility", "capabilities"]) {
    if (typeof adapter[method] === "function") wrapped[method] = adapter[method].bind(adapter);
  }
  for (const method of ["inspect", "read", "cursor", "list"]) {
    if (typeof adapter[method] !== "function") continue;
    wrapped[method] = (...args) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { return adapter[method](...args); }
        catch (error) {
          if (attempt === 2) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
        }
      }
    };
  }
  return wrapped;
}

function coordinatorTick({ roots, adapter: defaultAdapter, adapterFor }) {
  const projects = new Set(core.listTasks({ roots }).filter((meta) => ["slp", "slp-peer"].includes(meta.taskModel)).map((meta) => meta.projectId));
  const root = leadsDir(roots.foremanHome);
  if (fs.existsSync(root)) {
    for (const projectId of fs.readdirSync(root)) {
      if (fs.statSync(path.join(root, projectId)).isDirectory()) projects.add(projectId);
    }
  }
  const results = [];
  for (const projectId of projects) {
    const backend = projectBackend(roots, projectId);
    const adapter = observationAdapter(adapterFor ? adapterFor(backend) : defaultAdapter);
    if (!backend) continue;
    if (adapterBackend(adapter) !== backend) {
      recordAnomaly({ roots, projectId, type: "coordinator.adapter-unavailable", reason: `No ${backend || "bound"} runtime adapter is available to the coordinator; project state was left unchanged` });
      continue;
    }
    try { assertSlpBackend(adapter, "coordination"); }
    catch (error) {
      recordAnomaly({ roots, projectId, type: "coordinator.adapter-unavailable", reason: error.message });
      continue;
    }
    resolveAnomalies({ roots, projectId, types: ["coordinator.adapter-unavailable"] });
    const lead = readLead(roots.foremanHome, projectId);
    const pendingLeadMessages = lead?.endpoint ? deliverPendingLeadMessages({ roots, projectId, adapter }) : [];
    const decisions = lead?.endpoint ? reconcileAnsweredDecisions({ roots, projectId, adapter }) : [];
    const peerTasks = core.listTasks({ roots, projectId }).filter((meta) => meta.taskModel === "slp-peer");
    for (const peer of peerTasks) observePeerHealth({ roots, peer, adapter });
    // A stopped Peer retains its report and terminal assignment record until the
    // parent task closes, but it no longer owns a live Paseo timeline.  Re-reading
    // its old cursor would turn retained evidence into a false timeline gap.
    // Herdr Peers push reports through `foreman report`, so only Paseo timelines are collected.
    const ids = !usesTimeline(adapter) ? [] : peerTasks
      .filter((peer) => !peer.peerRuntimeStopped && ["working", "blocked"].includes(peer.status) && peer.endpoint)
      .map((peer) => peer.taskId);
    if (ids.length) {
      try {
        const collection = core.collectPaseoReports({ roots, adapter, taskIds: ids });
        for (const item of collection.tasks.filter((entry) => ["unavailable", "mismatch", "gap", "report-missing", "report-invalid", "waiting-input"].includes(entry.state))) {
          const peer = peerTasks.find((entry) => entry.taskId === item.taskId);
          const detail = item.error || item.issue?.reason || item.issue || item.state;
          recordAnomaly({ roots, projectId, taskId: peer?.parentTaskId || null, assignmentId: item.taskId, type: `peer.${item.state}`, endpoint: peer?.endpoint || null, reason: typeof detail === "string" ? detail : JSON.stringify(detail) });
        }
      }
      catch (error) { recordAnomaly({ roots, projectId, type: "peer.report-collection-failed", reason: error.message }); }
    }
    for (const peer of core.listTasks({ roots, projectId }).filter((meta) => meta.taskModel === "slp-peer" && (["review-ready", "blocked"].includes(meta.status) || (meta.status === "working" && meta.lastReport?.status === "progress")))) {
      const stopped = stopReportedPeer({ roots, peer: verifyReportedClaims({ roots, peer, adapter }), adapter });
      if (stopped.peerRuntimeStopped) deliverPeerReport({ roots, peer: stopped, adapter });
    }
    const resumedWaits = lead?.endpoint ? reevaluateWaitingRequests({ roots, projectId, adapter }) : [];
    const requestResult = lead?.endpoint ? pollLead({ roots, projectId, adapter }) : { state: lead ? "unavailable" : "unbound" };
    let rollover = null;
    const currentLead = readLead(roots.foremanHome, projectId);
    if (currentLead?.endpoint && shouldRolloverLead(currentLead)) {
      try {
        const inspection = adapter.inspect(currentLead.endpoint);
        if (!inspection.activeTurn && ["idle", "finished", "done"].includes(String(inspection.status).toLowerCase())) {
          rollover = replaceProjectLead({ roots, projectId, adapter, startCoordinator: false });
        } else rollover = { state: "waiting-safe-boundary" };
      } catch (error) {
        if (/safe turn boundary|waits for request|waits for message/.test(error.message)) rollover = { state: "waiting-safe-boundary" };
        else recordAnomaly({ roots, projectId, type: "lead.rollover-failed", endpoint: currentLead.endpoint, reason: error.message });
      }
    }
    resolveRecoveredAnomalies({
      roots,
      projectId,
      lead: readLead(roots.foremanHome, projectId),
      peers: core.listTasks({ roots, projectId }).filter((meta) => meta.taskModel === "slp-peer"),
    });
    results.push({ projectId, pendingLeadMessages, decisions, resumedWaits, lead: requestResult, rollover });
    if (lead?.endpoint) dispatchWaitingTask({ roots, projectId, adapter });
    writeProjectState({ roots, projectId });
  }
  return results;
}

function coordinatorHasWork(roots) {
  const tasks = core.listTasks({ roots });
  if (tasks.some((meta) => core.taskModel(meta) === "slp" && (["working", "blocked", "waiting-decision"].includes(meta.status) || (meta.status === "queued" && meta.profileConfirmedAt && meta.dispatchProfile)))) return true;
  if (tasks.some((meta) => meta.taskModel === "slp-peer" && meta.endpoint && !meta.peerRuntimeStopped && ACTIVE_PEER_STATES.has(meta.status))) return true;
  if (tasks.some((meta) => meta.taskModel === "slp-peer" && meta.peerRuntimeStopped && meta.lastReport?.file && !meta.peerReportDeliveredAt)) return true;
  const root = leadsDir(roots.foremanHome);
  if (fs.existsSync(root)) {
    for (const projectId of fs.readdirSync(root)) {
      const lead = readLead(roots.foremanHome, projectId);
      if (!lead) continue;
      if (lead.endpoint && lead.status === "working") return true;
      if (requestsForLead(roots, projectId, lead.generation).some((request) => request.status === "pending" || (request.status === "waiting" && (!request.outcomeDeliveredAt || REEVALUATED_WAITS.has(request.outcome?.waitKind))))) return true;
    }
  }
  return coordination.listMessages({ roots, statuses: ["pending"] }).some((message) => {
    if (!["slp", "slp-peer"].includes(message.payload?.taskModel)) return false;
    const lead = readLead(roots.foremanHome, message.projectId);
    return lead && message.worker === lead.owner && Number(message.generation) === Number(lead.generation);
  });
}

function coordinatorStateFile(home) { return path.join(slpData(home), "coordinator.json"); }

function coordinatorCodeVersion(roots) {
  const files = ["src/slp.js", "src/foreman.js", "src/coordination.js", "bin/foreman-slp-coordinator"].map((file) => path.join(roots.foremanRoot, file));
  return digest(files.map((file) => fs.readFileSync(file)).map((content) => content.toString("base64")));
}

function coordinatorProcessAlive(record, script) {
  if (!Number.isInteger(record?.pid) || record.pid < 2 || record.script !== script) return false;
  try {
    process.kill(record.pid, 0);
    if (process.platform === "linux") {
      const args = fs.readFileSync(`/proc/${record.pid}/cmdline`, "utf8").split("\0");
      return args[0] === process.execPath && args[1] === script && args[2] === "run";
    }
    const result = spawnSync("ps", ["-p", String(record.pid), "-o", "command="], { encoding: "utf8", timeout: 2000 });
    return result.status === 0 && result.stdout.trim() === `${process.execPath} ${script} run`;
  } catch (_) { return false; }
}

function startCoordinatorProcess({ roots, backend = SLP_BACKEND }) {
  if (!SLP_BACKENDS.has(backend)) throw new SlpError(`SLP coordinator is unsupported on ${backend}`);
  const script = path.join(roots.foremanRoot, "bin", "foreman-slp-coordinator");
  const file = coordinatorStateFile(roots.foremanHome);
  return core.withHomeLock(roots.foremanHome, () => {
    const previous = fs.existsSync(file) ? readJson(file) : null;
    const codeVersion = coordinatorCodeVersion(roots);
    if (coordinatorProcessAlive(previous, script)) {
      if (previous.codeVersion === codeVersion) return { started: false, alreadyRunning: true, pid: previous.pid };
      process.kill(previous.pid, "SIGTERM");
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && coordinatorProcessAlive(previous, script)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      if (coordinatorProcessAlive(previous, script)) throw new SlpError(`Stale SLP coordinator ${previous.pid} did not stop within the bounded restart window`);
    }
    const child = spawn(process.execPath, [script, "run"], {
      cwd: roots.foremanRoot,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, FOREMAN_ROOT: roots.foremanRoot, FOREMAN_HOME: roots.foremanHome, FOREMAN_BACKEND: backend },
    });
    child.unref();
    const record = { schemaVersion: 1, backend, pid: child.pid, script, codeVersion, status: "starting", startedAt: now(), heartbeatAt: now() };
    core.atomicJson(file, record);
    return { started: true, pid: child.pid || null };
  });
}

function ensureCoordinatorRunning({ roots, start = startCoordinatorProcess, backend = SLP_BACKEND }) {
  if (!coordinatorHasWork(roots)) return { started: false, reason: "no-work" };
  return start({ roots, backend });
}

function runCoordinator({ roots, adapter, adapterFor, intervalMs = 2000, maxTicks = Infinity, onTick }) {
  const file = coordinatorStateFile(roots.foremanHome);
  const expectedScript = path.join(roots.foremanRoot, "bin", "foreman-slp-coordinator");
  let ticks = 0;
  while (ticks < maxTicks) {
    let record = fs.existsSync(file) ? readJson(file) : null;
    if (!record && ticks === 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      record = fs.existsSync(file) ? readJson(file) : null;
    }
    if (!record || Number(record.pid) !== process.pid || record.script !== expectedScript) return { state: "replaced" };
    record = { ...record, status: "running", heartbeatAt: now() };
    core.withHomeLock(roots.foremanHome, () => core.atomicJson(file, record));
    const result = coordinatorTick({ roots, adapter, adapterFor });
    ticks += 1;
    if (typeof onTick === "function") onTick(result);
    if (!coordinatorHasWork(roots)) {
      core.withHomeLock(roots.foremanHome, () => {
        const current = fs.existsSync(file) ? readJson(file) : null;
        if (Number(current?.pid) === process.pid) fs.rmSync(file, { force: true });
      });
      return { state: "drained", ticks };
    }
    if (ticks < maxTicks) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }
  return { state: "running", ticks };
}

function answerSlpDecision({ roots, taskId, decisionId, response }) {
  if (typeof response !== "string" || !response) throw new SlpError("Human decision must preserve non-empty verbatim text");
  if (!/^D-[a-f0-9]{20}$/.test(String(decisionId || ""))) throw new SlpError("Decision ID is invalid");
  return core.withHomeLock(roots.foremanHome, () => {
    const parent = readTask(roots.foremanHome, taskId);
    if (core.taskModel(parent) !== "slp") throw new SlpError(`Task is not SLP: ${taskId}`);
    const file = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${decisionId}.json`);
    if (!fs.existsSync(file)) throw new SlpError(`Unknown decision: ${decisionId}`);
    const decision = readJson(file);
    if (decision.schemaVersion !== 1 || decision.taskId !== taskId || decision.projectId !== parent.projectId || decision.leadGeneration !== parent.leadGeneration || decision.status !== "pending" || !["working", "blocked", "waiting-decision"].includes(parent.status)) throw new SlpError("Decision is not the active SLP decision for this task");
    const answered = { ...decision, status: "answered", answeredAt: now(), humanResponse: response };
    core.atomicJson(file, answered);
    if (parent.status !== "waiting-decision") writeTaskUnlocked(roots, { ...parent, status: "waiting-decision", waitingReason: `human decision ${decisionId}`, decisionId, blockedAt: parent.blockedAt || now() });
    return answered;
  });
}

function pauseProjectLead({ roots, projectId, paused = true }) {
  return core.withHomeLock(roots.foremanHome, () => {
    const lead = readLead(roots.foremanHome, projectId);
    if (!lead) throw new SlpError(`Project Lead is not bound: ${projectId}`);
    const next = { ...lead, dispatchPaused: Boolean(paused), dispatchPausedAt: paused ? now() : null };
    core.atomicJson(leadFile(roots.foremanHome, projectId), next);
    return next;
  });
}

function deliverDecisionToPeer({ roots, decision, peer, adapter }) {
  if (!peer.endpoint || peer.peerRuntimeStopped || !["working", "blocked"].includes(peer.status)) return { delivered: false, waiting: true, reason: "affected Peer is no longer a live assignment" };
  const expected = { endpoint: peer.endpoint, owner: peer.owner, projectId: peer.projectId, generation: peer.generation, workspace: peer.workspace, workspaceId: peer.workspaceId, paneId: peer.paneId };
  let inspection;
  try { inspection = adapter.inspect(peer.endpoint); }
  catch (error) { recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "decision.peer-inspect-failed", endpoint: peer.endpoint, reason: error.message }); return { delivered: false, waiting: true, reason: error.message }; }
  try { verifyRuntimeIdentity({ adapter, expected, actual: inspection, operation: "human decision delivery to Peer" }); }
  catch (error) { recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "decision.peer-identity-mismatch", endpoint: peer.endpoint, reason: error.message }); return { delivered: false, waiting: true, reason: error.message }; }
  if (inspection.activeTurn || !["idle", "finished", "done"].includes(String(inspection.status).toLowerCase())) return { delivered: false, waiting: true, reason: "affected Peer is processing another turn" };
  const payload = { decisionId: decision.decisionId, taskId: decision.taskId, projectId: decision.projectId, response: decision.humanResponse, backend: adapterBackend(adapter), taskModel: "slp-peer" };
  const messageId = `M-${decision.decisionId}-${peer.taskId}-g${peer.generation}`;
  let message;
  core.withHomeLock(roots.foremanHome, () => {
    message = coordination.createMessageUnlocked({ roots, taskId: peer.taskId, projectId: peer.projectId, worker: peer.owner, generation: peer.generation, endpoint: peer.endpoint, kind: "human-decision", payload, explicitId: messageId });
  });
  if (message.status === "delivered") return { delivered: true, duplicate: true, messageId };
  if (message.status === "failed") return { delivered: false, failed: true, messageId, reason: message.transportEvidence?.reason || "prior Peer decision delivery failed" };
  if (message.deliveryAttemptedAt && !usesTimeline(adapter)) {
    recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "decision.peer-delivery-uncertain", endpoint: peer.endpoint, reason: `Message ${messageId} was attempted but its delivery cannot be verified on Herdr; it will not be sent again` });
    return { delivered: false, waiting: true, uncertain: true, messageId };
  }
  if (message.deliveryAttemptedAt) {
    let timeline;
    try { timeline = adapter.read(peer.endpoint, message.cursorBefore || peer.paseoCursor || null); }
    catch (error) { recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "decision.peer-reconcile-failed", endpoint: peer.endpoint, reason: error.message }); return { delivered: false, waiting: true, uncertain: true, messageId, reason: error.message }; }
    try { verifyRuntimeIdentity({ adapter, expected, actual: timeline, operation: "Peer decision reconciliation" }); }
    catch (error) { return { delivered: false, waiting: true, uncertain: true, messageId, reason: error.message }; }
    if (!(timeline.entries || []).some((entry) => entry.messageId === messageId || entry.item?.messageId === messageId || entry.item?.id === messageId)) {
      recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "decision.peer-delivery-uncertain", endpoint: peer.endpoint, reason: `Message ${messageId} was attempted but cannot be verified; it will not be sent again` });
      return { delivered: false, waiting: true, uncertain: true, messageId };
    }
    core.withHomeLock(roots.foremanHome, () => {
      coordination.markMessageDeliveryUnlocked({ roots, messageId, delivered: true, evidence: { reconciled: true } });
      const current = readTask(roots.foremanHome, peer.taskId);
      writeTaskUnlocked(roots, { ...current, ...(current.status === "blocked" ? { status: "working", blockerReport: null } : {}), paseoCursor: message.cursorBefore || current.paseoCursor || null, lastPromptAt: message.deliveryAttemptedAt });
    });
    return { delivered: true, reconciled: true, messageId };
  }
  let cursor = null;
  try { if (usesTimeline(adapter)) cursor = adapter.cursor(peer.endpoint); }
  catch (error) { return { delivered: false, waiting: true, messageId, reason: error.message }; }
  const attemptedAt = now();
  core.withHomeLock(roots.foremanHome, () => {
    coordination.updateMessageUnlocked({ roots, messageId, mutate: (current) => ({ ...current, deliveryAttemptedAt: attemptedAt, cursorBefore: cursor || null }) });
    const current = readTask(roots.foremanHome, peer.taskId);
    core.atomicJson(taskMetaFile(roots.foremanHome, peer.taskId), { ...current, paseoCursor: cursor || current.paseoCursor || null, lastPromptAt: attemptedAt });
  });
  let result;
  try { result = adapter.send(peer.endpoint, coordination.deliveryPrompt(message), { messageId }); }
  catch (error) { result = { delivered: false, uncertain: true, error: error.message }; }
  const delivered = result !== false && result?.delivered !== false;
  core.withHomeLock(roots.foremanHome, () => {
    if (result?.uncertain) coordination.updateMessageUnlocked({ roots, messageId, mutate: (current) => ({ ...current, transportEvidence: result }) });
    else coordination.markMessageDeliveryUnlocked({ roots, messageId, delivered, evidence: result });
    if (delivered) {
      const current = readTask(roots.foremanHome, peer.taskId);
      writeTaskUnlocked(roots, { ...current, ...(current.status === "blocked" ? { status: "working" } : {}), blockerReport: null, paseoCursor: cursor || current.paseoCursor || null, lastPromptAt: attemptedAt });
    }
  });
  if (result?.uncertain) return { delivered: false, waiting: true, uncertain: true, messageId, reason: result.error };
  if (!delivered) recordAnomaly({ roots, projectId: peer.projectId, taskId: peer.parentTaskId, assignmentId: peer.taskId, type: "decision.peer-delivery-failed", endpoint: peer.endpoint, reason: result?.error || "Peer decision delivery was not confirmed" });
  return { delivered, messageId, ...(delivered ? {} : { reason: result?.error || "delivery was not confirmed" }) };
}

function deliverSlpDecision({ roots, taskId, decisionId, adapter }) {
  assertSlpBackend(adapter, "decision delivery");
  const parent = readTask(roots.foremanHome, taskId);
  if (core.taskModel(parent) !== "slp") throw new SlpError(`Task is not SLP: ${taskId}`);
  const file = path.join(taskDir(roots.foremanHome, taskId), "decisions", `${decisionId}.json`);
  if (!fs.existsSync(file)) throw new SlpError(`Unknown decision: ${decisionId}`);
  const decision = readJson(file);
  if (decision.status === "delivered") {
    completeDecisionRequests({ roots, decision });
    return decision;
  }
  if (decision.status !== "answered" || decision.leadGeneration !== parent.leadGeneration) throw new SlpError("Human decision must be answered for the current Lead generation before delivery");
  const delivered = sendLeadMessage({ roots, projectId: parent.projectId, taskId, kind: "human-decision", payload: { decisionId, taskId, projectId: parent.projectId, response: decision.humanResponse }, adapter, requestId: `decision-${decisionId}` });
  if (!delivered.delivered) throw new SlpError(`Human decision delivery is pending: ${delivered.reason || "Lead unavailable"}`);
  const peerDeliveries = [];
  for (const assignmentId of decision.affectedAssignmentIds || []) {
    const peer = readTask(roots.foremanHome, assignmentId);
    const result = deliverDecisionToPeer({ roots, decision, peer, adapter });
    peerDeliveries.push({ assignmentId, ...result });
    core.withHomeLock(roots.foremanHome, () => {
      const current = readJson(file);
      core.atomicJson(file, { ...current, peerDeliveries: [...(current.peerDeliveries || []).filter((item) => item.assignmentId !== assignmentId), { assignmentId, ...result }] });
    });
    if (!result.delivered) throw new SlpError(`Human decision delivery to Peer ${assignmentId} is pending: ${result.reason || "runtime outcome is uncertain"}`);
  }
  core.withHomeLock(roots.foremanHome, () => {
    const current = readJson(file);
    const task = readTask(roots.foremanHome, taskId);
    core.atomicJson(file, { ...current, status: "delivered", deliveredAt: now(), messageId: delivered.messageId, peerDeliveries });
    writeTaskUnlocked(roots, { ...task, status: "working", decisionId: null, waitingReason: null, decisionDeliveredAt: now() });
  });
  completeDecisionRequests({ roots, decision });
  writeProjectState({ roots, projectId: parent.projectId });
  startCoordinatorProcess({ roots, backend: adapter.backend });
  return { ...decision, status: "delivered", messageId: delivered.messageId };
}

function completeDecisionRequests({ roots, decision }) {
  for (const request of requestsForLead(roots, decision.projectId, decision.leadGeneration).filter((item) => item.taskId === decision.taskId
    && item.action === "report-task" && item.status === "waiting" && item.outcome?.decisionId === decision.decisionId)) {
    updateRequest(roots, request, "completed", { status: "completed", decisionId: decision.decisionId, taskStatus: "working", reason: "human decision was delivered" });
  }
}

function reconcileAnsweredDecisions({ roots, projectId, adapter }) {
  const results = [];
  for (const task of listSlpTasks(roots, projectId).filter((meta) => meta.status === "waiting-decision")) {
    const directory = path.join(taskDir(roots.foremanHome, task.taskId), "decisions");
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter((item) => item.endsWith(".json"))) {
      const decision = readJson(path.join(directory, name));
      if (decision.status !== "answered") continue;
      try { results.push(deliverSlpDecision({ roots, taskId: task.taskId, decisionId: decision.decisionId, adapter })); }
      catch (error) {
        recordAnomaly({ roots, projectId, taskId: task.taskId, type: "decision.delivery-pending", endpoint: readLead(roots.foremanHome, projectId)?.endpoint || null, reason: error.message });
        results.push({ taskId: task.taskId, decisionId: decision.decisionId, state: "pending", reason: error.message });
      }
    }
  }
  return results;
}

function acceptSlpTask({ roots, taskId, adapter, afterPeerCleanup }) {
  assertSlpBackend(adapter, "task acceptance");
  if (!/^T-\d{6,}$/.test(String(taskId || ""))) throw new SlpError("SLP task ID is invalid");
  const closureDir = path.join(slpData(roots.foremanHome), "closures");
  const closureFile = path.join(closureDir, `${taskId}.json`);
  let closure = fs.existsSync(closureFile) ? readJson(closureFile) : null;
  if (!closure) {
    const parent = readTask(roots.foremanHome, taskId);
    if (core.taskModel(parent) !== "slp" || parent.status !== "review-ready" || !parent.completionReport || !fs.existsSync(parent.completionReport)) throw new SlpError("Only a review-ready SLP task can be accepted");
    const acceptedAt = now();
    closure = { schemaVersion: 1, taskId, projectId: parent.projectId, peerTaskIds: listPeerTasks(roots, taskId).map((peer) => peer.taskId), status: "closing", createdAt: now(), acceptedAt, metrics: closureMetrics(taskMetrics({ roots, taskId }), acceptedAt) };
    core.withHomeLock(roots.foremanHome, () => core.atomicJson(closureFile, closure));
  }
  if (closure.schemaVersion !== 1 || closure.taskId !== taskId || !/^[a-z0-9][a-z0-9-]*$/.test(String(closure.projectId || "")) || !Array.isArray(closure.peerTaskIds) || closure.peerTaskIds.some((id) => !/^T-\d{6,}$/.test(id))) throw new SlpError("SLP closure record identity is invalid");
  core.findProject(roots.foremanHome, closure.projectId);
  writeProjectState({ roots, projectId: closure.projectId });
  for (const peerTaskId of closure.peerTaskIds) {
    const file = taskMetaFile(roots.foremanHome, peerTaskId);
    if (!fs.existsSync(file)) continue;
    const peer = readTask(roots.foremanHome, peerTaskId);
    if (peer.taskModel !== "slp-peer" || peer.parentTaskId !== taskId || peer.projectId !== closure.projectId) throw new SlpError(`Closure Peer identity does not match task ${taskId}: ${peerTaskId}`);
    if (peer.endpoint && !peer.peerRuntimeStopped) {
      const current = adapter.inspect(peer.endpoint);
      const expected = { endpoint: peer.endpoint, owner: peer.owner, projectId: peer.projectId, generation: peer.generation, workspace: peer.workspace, workspaceId: peer.workspaceId, paneId: peer.paneId };
      verifyPresentIdentity({ adapter, expected, actual: current, operation: "task acceptance" });
      if (current.activeTurn) throw new SlpError(`Peer ${peer.taskId} is still running; acceptance will not interrupt an active turn`);
      if (!["missing", "stopped"].includes(String(current.status).toLowerCase())) {
        const result = adapter.stop(peer.endpoint);
        if (!result || result.stopped === false) throw new SlpError(`Peer ${peer.taskId} stop was not verified`);
        const after = adapter.inspect(peer.endpoint);
        if (!after || !["missing", "stopped"].includes(String(after.status).toLowerCase())) throw new SlpError(`Peer ${peer.taskId} remains active after stop`);
      }
      core.withHomeLock(roots.foremanHome, () => {
        const latest = readTask(roots.foremanHome, peer.taskId);
        core.atomicJson(file, { ...latest, resourceLease: null, peerRuntimeStopped: true, peerStoppedAt: now() });
      });
    }
    if (!peer.endpoint && peer.resourceLease && !peer.peerRuntimeStopped) throw new SlpError(`Peer ${peer.taskId} has a lease without a verifiable runtime endpoint; acceptance is deferred`);
    core.withHomeLock(roots.foremanHome, () => coordination.purgeTaskRecordsUnlocked({ roots, taskId: peerTaskId }));
    fs.rmSync(taskDir(roots.foremanHome, peerTaskId), { recursive: true, force: true });
    if (typeof afterPeerCleanup === "function") afterPeerCleanup(peerTaskId);
  }
  const parentDir = taskDir(roots.foremanHome, taskId);
  if (fs.existsSync(parentDir)) {
    core.withHomeLock(roots.foremanHome, () => {
      const current = readTask(roots.foremanHome, taskId);
      core.atomicJson(taskMetaFile(roots.foremanHome, taskId), { ...current, status: "accepted", acceptedAt: closure.acceptedAt, resourceLease: null });
      coordination.purgeTaskRecordsUnlocked({ roots, taskId });
    });
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
  closure = { ...closure, status: "complete", completedAt: now() };
  core.withHomeLock(roots.foremanHome, () => core.atomicJson(closureFile, closure));
  writeProjectState({ roots, projectId: closure.projectId });
  return { taskId, accepted: true, closed: true, projectLeadPreserved: true, workspaceRetained: core.findProject(roots.foremanHome, closure.projectId).root, acceptedAt: closure.acceptedAt };
}

// ---- Measurement and compact views -------------------------------------------------------------------------------
// Failures that cost runtime work; waits, decisions, and informational anomalies are not failures.
const FAILURE_ANOMALIES = new Set([
  "peer.missing", "peer.stopped", "peer.runtime-unknown", "peer.stop-unverified", "peer.identity-mismatch", "peer.dispatch-uncertain",
  "peer.inspect-failed", "peer.stuck-turn", "peer.report-collection-failed", "peer.report-invalid", "peer.claim-exceeded",
  "lead.stopped", "lead.missing", "lead.inspect-failed", "lead.identity-mismatch", "lead.stuck-turn", "lead.runtime-unknown",
  "lead.delivery-failed", "lead.message-delivery-uncertain", "lead.request-invalid", "decision.peer-delivery-uncertain", "request.processing-failed",
]);

function readEveryAnomaly(roots, projectId) {
  const dir = path.join(slpData(roots.foremanHome), "anomalies");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name))).filter((item) => !projectId || item.projectId === projectId);
}

function allRequests(roots, projectId) {
  const dir = path.join(leadDir(roots.foremanHome, projectId), "requests");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^g\d+$/.test(name)).flatMap((name) => {
    const generationDir = path.join(dir, name);
    return fs.readdirSync(generationDir).filter((file) => file.endsWith(".json")).map((file) => readJson(path.join(generationDir, file)));
  });
}

function taskDecisions(roots, taskId) {
  const dir = path.join(taskDir(roots.foremanHome, taskId), "decisions");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name)));
}

// Everything is derived from canonical records, so a measurement never diverges from what the lifecycle recorded.
// A closed task's measurement is frozen into its closure record before its records are purged.
function taskMetrics({ roots, taskId }) {
  if (!/^T-\d{6,}$/.test(String(taskId || ""))) throw new SlpError("SLP task ID is invalid");
  const closureFile = path.join(slpData(roots.foremanHome), "closures", `${taskId}.json`);
  if (fs.existsSync(closureFile)) {
    const closure = readJson(closureFile);
    if (closure.schemaVersion !== 1 || closure.taskId !== taskId || !closure.metrics) throw new SlpError("SLP closure metrics identity is invalid");
    return { ...closure.metrics, status: closure.status === "complete" ? "accepted" : "closing", acceptedAt: closure.acceptedAt };
  }
  const parent = readTask(roots.foremanHome, taskId);
  const peers = listPeerTasks(roots, taskId);
  const requests = allRequests(roots, parent.projectId).filter((request) => request.taskId === taskId);
  const at = Date.now();
  const waitedMs = requests.reduce((sum, request) => sum + Number(request.waitedMs || 0) + (request.waitingSince ? Math.max(0, at - Date.parse(request.waitingSince)) : 0), 0);
  const decisions = taskDecisions(roots, taskId).filter((decision) => decision.status !== "pending");
  const followups = coordination.listMessages({ roots }).filter((message) => message.taskId === taskId && message.kind === "slp-human-followup").length;
  const involved = new Set([taskId, ...peers.map((peer) => peer.taskId)]);
  const failures = readEveryAnomaly(roots, parent.projectId).filter((item) => FAILURE_ANOMALIES.has(item.type) && (involved.has(item.taskId) || involved.has(item.assignmentId)));
  const peersByRole = {};
  for (const peer of peers) peersByRole[peer.peerRole] = (peersByRole[peer.peerRole] || 0) + 1;
  const requestsByAction = {};
  for (const request of requests) requestsByAction[request.action] = (requestsByAction[request.action] || 0) + 1;
  const humanDecisions = decisions.length;
  return {
    taskId,
    projectId: parent.projectId,
    backend: parent.backend,
    status: parent.status,
    startedAt: parent.startedAt || null,
    elapsedMs: parent.startedAt ? Math.max(0, (parent.acceptedAt ? Date.parse(parent.acceptedAt) : at) - Date.parse(parent.startedAt)) : null,
    leadRequests: requests.length,
    requestsByAction,
    peerCount: peers.length,
    peersByRole,
    correctionCycles: Math.max(Number(parent.reviewCycles || 0), peersByRole.correction || 0),
    waitedMs,
    waitedRequests: requests.filter((request) => request.waitedMs || request.waitingSince).length,
    humanDecisions,
    humanFollowups: followups,
    acceptances: parent.status === "accepted" ? 1 : 0,
    humanInterventions: humanDecisions + followups + (parent.status === "accepted" ? 1 : 0),
    runtimeFailures: failures.length,
    runtimeFailureTypes: [...new Set(failures.map((item) => item.type))].sort(),
  };
}

// Acceptance is the human step that closes the task; it is counted once, when the measurement is frozen.
function closureMetrics(metrics, acceptedAt) {
  return { ...metrics, status: "accepted", acceptances: 1, humanInterventions: metrics.humanInterventions + 1, closedAt: acceptedAt };
}

function closedTaskMetrics(roots, projectId) {
  const dir = path.join(slpData(roots.foremanHome), "closures");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name)))
    .filter((closure) => closure.metrics && (!projectId || closure.projectId === projectId))
    .map((closure) => ({ ...closure.metrics, status: closure.status === "complete" ? "accepted" : "closing", acceptedAt: closure.acceptedAt }));
}

function fleetMetrics({ roots, projectId } = {}) {
  const projects = core.loadProjects(roots.foremanHome).filter((project) => !projectId || project.id === projectId);
  const live = projects.flatMap((project) => listSlpTasks(roots, project.id).map((meta) => taskMetrics({ roots, taskId: meta.taskId })));
  const liveIds = new Set(live.map((item) => item.taskId));
  const tasks = [...closedTaskMetrics(roots, projectId).filter((item) => !liveIds.has(item.taskId)), ...live];
  const sum = (key) => tasks.reduce((total, item) => total + Number(item[key] || 0), 0);
  return {
    tasks,
    totals: {
      tasks: tasks.length,
      accepted: tasks.filter((item) => item.status === "accepted").length,
      peers: sum("peerCount"),
      leadRequests: sum("leadRequests"),
      correctionCycles: sum("correctionCycles"),
      waitedMs: sum("waitedMs"),
      humanInterventions: sum("humanInterventions"),
      runtimeFailures: sum("runtimeFailures"),
    },
  };
}

const TASK_STATES = ["queued", "working", "blocked", "waiting-decision", "review-ready", "proof-complete"];

// One short record per project: enough to see state at a glance, with the evidence behind it one command away.
function fleetView({ roots }) {
  const capacity = slpCapacity(roots);
  const projects = [];
  for (const project of core.loadProjects(roots.foremanHome)) {
    const lead = fs.existsSync(leadFile(roots.foremanHome, project.id)) ? readLead(roots.foremanHome, project.id) : null;
    const closing = new Set(closedTaskMetrics(roots, project.id).filter((item) => item.status === "closing").map((item) => item.taskId));
    const tasks = listSlpTasks(roots, project.id).filter((meta) => TASK_STATES.includes(meta.status)).map((meta) => closing.has(meta.taskId) ? { ...meta, status: "closing" } : meta);
    if (!lead && !tasks.length) continue;
    const counts = {};
    for (const meta of tasks) counts[meta.status] = (counts[meta.status] || 0) + 1;
    projects.push({
      projectId: project.id,
      backend: lead?.backend || tasks[0]?.backend || null,
      lead: lead ? { generation: lead.generation, status: lead.status, paused: Boolean(lead.dispatchPaused), live: Boolean(lead.endpoint) } : null,
      tasks: counts,
      readyForAcceptance: tasks.filter((meta) => meta.status === "review-ready").map((meta) => meta.taskId),
      livePeers: livePeersForProject(roots, project.id).length,
      waits: outstandingWaits(roots, project.id).length,
      pendingDecisions: tasks.filter((meta) => meta.status === "waiting-decision").length,
      anomalies: readAnomalies(roots, project.id).length,
    });
  }
  return {
    capacity: { ...capacity, endpointsHeld: slpEndpointCount(roots) },
    projects,
    totals: {
      projects: projects.length,
      activeTasks: projects.reduce((total, item) => total + (item.tasks.working || 0) + (item.tasks.blocked || 0) + (item.tasks["waiting-decision"] || 0) + (item.tasks.closing || 0), 0),
      livePeers: projects.reduce((total, item) => total + item.livePeers, 0),
      readyForAcceptance: projects.reduce((total, item) => total + item.readyForAcceptance.length, 0),
      anomalies: projects.reduce((total, item) => total + item.anomalies, 0),
    },
  };
}

function renderFleetView(view) {
  const cap = view.capacity;
  const lines = [`SLP fleet: ${view.totals.projects} project(s), ${view.totals.activeTasks} active task(s), ${view.totals.livePeers} live Peer(s), endpoints ${cap.endpointsHeld}/${cap.maxSlpEndpoints ?? "unbounded"}`];
  for (const item of view.projects) {
    const tasks = Object.entries(item.tasks).map(([state, count]) => `${count} ${state}`).join(", ") || "no tasks";
    const lead = item.lead ? `Lead g${item.lead.generation} ${item.lead.live ? item.lead.status : "not running"}${item.lead.paused ? " (intake paused)" : ""}` : "no Lead";
    lines.push(`- ${item.projectId} [${item.backend || "-"}]: ${lead}; ${tasks}; ${item.livePeers} Peer(s)${item.waits ? `; ${item.waits} waiting` : ""}${item.pendingDecisions ? `; ${item.pendingDecisions} decision(s)` : ""}${item.anomalies ? `; ${item.anomalies} anomaly(ies)` : ""}${item.readyForAcceptance.length ? `; ready: ${item.readyForAcceptance.join(", ")}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

// Detailed, attributable evidence for one top-level task, read on demand from canonical records.
function taskEvidence({ roots, taskId }) {
  const parent = readTask(roots.foremanHome, taskId);
  if (core.taskModel(parent) !== "slp") throw new SlpError(`Task is not an SLP task: ${taskId}`);
  const reviewsDir = path.join(taskDir(roots.foremanHome, taskId), "reviews");
  const involved = new Set([taskId, ...listPeerTasks(roots, taskId).map((peer) => peer.taskId)]);
  return {
    task: { taskId, projectId: parent.projectId, backend: parent.backend, status: parent.status, leadGeneration: parent.leadGeneration, brief: path.join(taskDir(roots.foremanHome, taskId), "brief.md"), completionReport: parent.completionReport || null, latestReviewId: parent.latestReviewId || null, reviewStatus: parent.reviewStatus || null, invalidatedEvidence: parent.invalidatedEvidence || [] },
    peers: listPeerTasks(roots, taskId).map((peer) => ({ assignmentId: peer.taskId, role: peer.peerRole, generation: peer.generation, status: peer.status, endpoint: peer.endpoint || null, stopped: Boolean(peer.peerRuntimeStopped), resources: peer.resources, reportFile: peer.lastReport?.file || null, reviewMilestoneId: peer.reviewMilestoneId || null, claimExceeded: peer.slpClaimExceeded || [] })),
    requests: allRequests(roots, parent.projectId).filter((request) => request.taskId === taskId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((request) => ({ requestId: request.requestId, action: request.action, leadGeneration: request.leadGeneration, status: request.status, reason: request.outcome?.reason || null, waitedMs: request.waitedMs || 0, createdAt: request.createdAt })),
    reviews: fs.existsSync(reviewsDir) ? fs.readdirSync(reviewsDir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(reviewsDir, name))) : [],
    decisions: taskDecisions(roots, taskId).map((decision) => ({ decisionId: decision.decisionId, status: decision.status, finding: decision.finding, humanResponse: decision.humanResponse || null })),
    anomalies: readEveryAnomaly(roots, parent.projectId).filter((item) => involved.has(item.taskId) || involved.has(item.assignmentId)).map((item) => ({ type: item.type, reason: item.reason, resolved: Boolean(item.resolvedAt), createdAt: item.createdAt })),
    metrics: taskMetrics({ roots, taskId }),
  };
}

function projectStatus({ roots, projectId }) {
  const state = buildProjectState({ roots, projectId });
  return {
    projectId,
    lead: readLead(roots.foremanHome, projectId),
    tasks: listSlpTasks(roots, projectId).map((meta) => ({ meta: { ...meta, status: state.activeTasks.find((task) => task.taskId === meta.taskId)?.status || meta.status }, peers: listPeerTasks(roots, meta.taskId) })),
    pendingDecisions: state.pendingDecisions,
    requests: state.requests,
    waits: outstandingWaits(roots, projectId).map((request) => ({ taskId: request.taskId, requestId: request.requestId, kind: request.outcome.waitKind, reason: request.outcome.reason })),
    anomalies: readAnomalies(roots, projectId),
  };
}

function renderProjectStatus(status) {
  const lines = [`SLP project ${status.projectId}`];
  const lead = status.lead;
  if (lead) {
    lines.push(`Lead: generation ${lead.generation}, ${lead.status}${lead.dispatchPaused ? ", intake paused" : ""}, profile ${lead.profileName}, endpoint ${lead.endpoint || "not started"}`);
    if (lead.contextSignal) lines.push(`Lead context: ${lead.contextSignal.usedTokens}/${lead.contextSignal.maxTokens} tokens observed at ${lead.contextSignal.observedAt}`);
  } else lines.push("Lead: not bound");
  for (const { meta, peers } of status.tasks) {
    lines.push(`Task ${meta.taskId}: ${meta.status}${meta.waitingReason ? ` — ${meta.waitingReason}` : ""}`);
    for (const peer of peers) lines.push(`  Peer ${peer.taskId} (${peer.peerRole}): ${peer.peerRuntimeStopped ? "stopped" : peer.status}${peer.endpoint ? ` @ ${peer.endpoint}` : ""}${peer.lastReport?.file ? `; report ${peer.lastReport.file}` : ""}`);
  }
  for (const wait of status.waits || []) lines.push(`Waiting on ${wait.taskId} (${wait.kind}): ${wait.reason}`);
  for (const decision of status.pendingDecisions || []) lines.push(`Decision ${decision.decisionId} on ${decision.taskId}: ${decision.finding}`);
  for (const anomaly of status.anomalies) lines.push(`Anomaly ${anomaly.type}${anomaly.taskId ? ` on ${anomaly.taskId}` : ""}: ${anomaly.reason}`);
  return `${lines.join("\n")}\n`;
}

function sessionContext({ roots }) {
  const lines = [];
  for (const project of core.loadProjects(roots.foremanHome)) {
    for (const meta of listSlpTasks(roots, project.id)) {
      if (meta.status === "review-ready") lines.push(`- SLP task ${meta.taskId} in ${project.id} is ready for human acceptance; evidence: ${meta.completionReport}`);
      else if (meta.status === "waiting-decision") lines.push(`- SLP task ${meta.taskId} in ${project.id} awaits human decision ${meta.decisionId}.`);
      else if (meta.status === "blocked") lines.push(`- SLP task ${meta.taskId} in ${project.id} is blocked: ${meta.waitingReason || "read the project state"}.`);
    }
    for (const wait of outstandingWaits(roots, project.id)) lines.push(`- SLP task ${wait.taskId} in ${project.id} is waiting (${wait.outcome.waitKind}); it resumes automatically: ${wait.outcome.reason}`);
    for (const anomaly of readAnomalies(roots, project.id)) lines.push(`- SLP anomaly in ${project.id}${anomaly.taskId ? ` task ${anomaly.taskId}` : ""}: ${anomaly.type} — ${anomaly.reason}`);
  }
  return lines.length ? `[Foreman SLP inbox from canonical state]\n${lines.join("\n")}\n` : null;
}

module.exports = {
  SlpError,
  SLP_BACKEND,
  SLP_PROTOCOL,
  markValidationTask,
  confirmProjectLeadProfile,
  dispatchSlpTask,
  followupProjectLead,
  replaceProjectLead,
  recoverProjectLead,
  recoverSlpPeer,
  pauseProjectLead,
  recordLeadRequest,
  submitLeadRequest,
  leadForPane,
  processRequest,
  coordinatorTick,
  deliverPendingLeadMessages,
  coordinatorHasWork,
  runCoordinator,
  startCoordinatorProcess,
  ensureCoordinatorRunning,
  answerSlpDecision,
  deliverSlpDecision,
  acceptSlpTask,
  projectStatus,
  taskMetrics,
  fleetMetrics,
  fleetView,
  renderFleetView,
  taskEvidence,
  renderProjectStatus,
  sessionContext,
  writeProjectState,
  buildProjectState,
  listSlpTasks,
  listPeerTasks,
  readLead,
  readTask,
  parseLeadEnvelope,
  readReportPayload,
};
