// The one next action Foreman showed the user for a task, kept in `meta.nextAction` with the task state it was
// based on, so "send that step" can be matched to exactly what was shown and refused once it is out of date.
// A stored proposal is not permission to act: sending it still needs the user's agreement in that turn.

const KINDS = ["round", "decision", "accept", "clarify"];
const { digest } = require("./coordination");

class NextActionError extends Error {}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new NextActionError(`${label} must not be empty`);
  return value.trim();
}

// The state a proposal is based on: the report it answers, the round, the assignment, the lifecycle, and any decision.
function proposalBasis(meta, points = []) {
  return {
    report: meta.lastReport?.file || null,
    reportAt: meta.lastReport?.at || null,
    round: meta.round || 1,
    generation: meta.generation,
    status: meta.status,
    decisionId: meta.decisionId || null,
    taskType: meta.type,
    attentionDigest: digest(points),
  };
}

function buildProposal({ meta, kind, text, instruction, type, at, points }) {
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
    basis: proposalBasis(meta, points),
    proposedAt: at,
  };
}

// Every way the task moved on since the proposal was shown; an empty list means it still applies.
function staleReasons(proposal, meta, points) {
  if (!proposal) return ["no next action was proposed"];
  const now = proposalBasis(meta, points);
  const reasons = [];
  if (now.generation !== proposal.basis.generation) reasons.push(`the task moved to worker generation ${now.generation}`);
  if (now.round !== proposal.basis.round) reasons.push(`round ${now.round} started after the proposal`);
  if (now.report !== proposal.basis.report) reasons.push("a newer worker report arrived");
  if (now.status !== proposal.basis.status) reasons.push(`the task is now ${now.status}, not ${proposal.basis.status}`);
  if (now.decisionId !== proposal.basis.decisionId) reasons.push("the task's decision changed");
  if (now.taskType !== proposal.basis.taskType) reasons.push(`the task mode changed to ${now.taskType}`);
  if (now.attentionDigest !== proposal.basis.attentionDigest) reasons.push("the task's pending points changed or were not recorded with the proposal");
  return reasons;
}

function describe(meta, points) {
  const proposal = meta.nextAction || null;
  if (!proposal) return null;
  const stale = staleReasons(proposal, meta, points);
  return { taskId: meta.taskId, projectId: meta.projectId, ...proposal, current: stale.length === 0, stale };
}

// The highlight block the user sees at the end of the answer that presents the report; `line` keeps it in the proposal output.
// A round that switches the task's mode says so, because approving the block approves that change too.
const HEADINGS = { round: "▶ BƯỚC TIẾP", decision: "❓ CẦN BẠN QUYẾT", accept: "✅ CÓ THỂ CHỐT TASK", clarify: "🔎 CẦN LÀM RÕ" };
const REPLIES = {
  round: '👉 Trả lời **"gửi"** để giao worker · **"bỏ"** để bỏ qua',
  decision: "👉 Trả lời lựa chọn của bạn",
  accept: '👉 Trả lời **"chốt"** để accept task · **"bỏ"** để bỏ qua',
  clarify: "👉 Trả lời câu hỏi trên",
};

function renderLine(taskId, proposal) {
  const lines = [`> ### ${HEADINGS[proposal.kind]} · ${taskId}`, ">", `> **${proposal.text.replace(/[.。]$/u, "")}**`];
  if (proposal.type && proposal.type !== proposal.basis.taskType) {
    lines.push(">", `> ⚠️ Đổi sang chế độ ${proposal.type}: ${proposal.type === "ship" ? "worker được ghi vào workspace" : "worker chỉ đọc"}`);
  }
  lines.push(">", `> ${REPLIES[proposal.kind]}`);
  return lines.join("\n");
}

module.exports = { KINDS, NextActionError, proposalBasis, buildProposal, staleReasons, describe, renderLine };
