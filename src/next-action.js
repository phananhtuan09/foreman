// The one next action Foreman showed the user for a task, kept in `meta.nextAction` with the task state it was
// based on, so "send that step" can be matched to exactly what was shown and refused once it is out of date.
// A stored proposal is not permission to act: sending it still needs the user's agreement in that turn.

const KINDS = ["round", "decision", "accept", "clarify"];

class NextActionError extends Error {}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new NextActionError(`${label} must not be empty`);
  return value.trim();
}

// The state a proposal is based on: the report it answers, the round, the assignment, the lifecycle, and any decision.
function proposalBasis(meta) {
  return {
    report: meta.lastReport?.file || null,
    reportAt: meta.lastReport?.at || null,
    round: meta.round || 1,
    generation: meta.generation,
    status: meta.status,
    decisionId: meta.decisionId || null,
    taskType: meta.type,
  };
}

function buildProposal({ meta, kind, text, instruction, type, at }) {
  if (!KINDS.includes(kind)) throw new NextActionError(`Next action kind must be one of: ${KINDS.join(", ")}`);
  if (["accepted", "cleaned"].includes(meta.status)) throw new NextActionError(`Task ${meta.taskId} has ended`);
  if (kind === "accept" && meta.status !== "review-ready") throw new NextActionError(`Only a review-ready task can be proposed for acceptance; ${meta.taskId} is ${meta.status}`);
  if (kind === "round" && !meta.endpoint) throw new NextActionError(`Task ${meta.taskId} has no worker to receive a round`);
  if (kind !== "round" && (instruction !== undefined || type !== undefined)) throw new NextActionError("Only a round proposal carries a worker instruction or mode");
  if (type !== undefined && !["ship", "scout"].includes(type)) throw new NextActionError("Next action mode must be ship or scout");
  return {
    kind,
    text: requireText(text, "Next action text"),
    instruction: kind === "round" ? requireText(instruction, "A round proposal's worker instruction") : null,
    type: type || null,
    basis: proposalBasis(meta),
    proposedAt: at,
  };
}

// Every way the task moved on since the proposal was shown; an empty list means it still applies.
function staleReasons(proposal, meta) {
  if (!proposal) return ["no next action was proposed"];
  const now = proposalBasis(meta);
  const reasons = [];
  if (now.generation !== proposal.basis.generation) reasons.push(`the task moved to worker generation ${now.generation}`);
  if (now.round !== proposal.basis.round) reasons.push(`round ${now.round} started after the proposal`);
  if (now.report !== proposal.basis.report) reasons.push("a newer worker report arrived");
  if (now.status !== proposal.basis.status) reasons.push(`the task is now ${now.status}, not ${proposal.basis.status}`);
  if (now.decisionId !== proposal.basis.decisionId) reasons.push("the task's decision changed");
  if (now.taskType !== proposal.basis.taskType) reasons.push(`the task mode changed to ${now.taskType}`);
  return reasons;
}

function describe(meta) {
  const proposal = meta.nextAction || null;
  if (!proposal) return null;
  const stale = staleReasons(proposal, meta);
  return { taskId: meta.taskId, projectId: meta.projectId, ...proposal, current: stale.length === 0, stale };
}

// The one line the user sees right after the report.
// A round that switches the task's mode says so, because approving the line approves that change too.
function renderLine(taskId, proposal) {
  const mode = proposal.type && proposal.type !== proposal.basis.taskType
    ? ` (đổi sang chế độ ${proposal.type}${proposal.type === "ship" ? ": worker được ghi vào workspace" : ": worker chỉ đọc"})`
    : "";
  return `> **▶ ${taskId} · Đề xuất: ${proposal.text.replace(/[.。]$/u, "")}${mode}.**`;
}

module.exports = { KINDS, NextActionError, proposalBasis, buildProposal, staleReasons, describe, renderLine };
