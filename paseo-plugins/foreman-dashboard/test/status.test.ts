import assert from "node:assert/strict";
import test from "node:test";
import type { TaskSummary } from "../shared/foreman";
import { agentProfile, orderTasks, runningWorkers, taskAgentText, taskNumber, taskStamp, workerStatus, type AgentView } from "../shared/status";

const task = (over: Partial<TaskSummary>): TaskSummary => ({
  taskId: "T-000001", projectId: "app", type: "ship", round: 1, status: "working", backend: "paseo", endpoint: "agent-1",
  profile: "codex-luna", routingProfile: "codex-luna", needsProfileConfirmation: false, title: "x", brief: "x", rounds: [], ...over,
});
const agent = (over: Partial<AgentView>): AgentView => ({ status: "running", attentionReason: null, paseoProfileName: null, routingProfile: null, ...over });

test("task number drops the prefix and zero padding", () => {
  assert.equal(taskNumber("T-000040"), "40");
});

test("worker status: task states that need the user win over the runtime state", () => {
  const permission = agent({ attentionReason: "permission" });
  assert.equal(workerStatus(task({ status: "blocked" }), permission), "blocked");
  assert.equal(workerStatus(task({ status: "waiting-decision" }), agent({ status: "error" })), "decide");
  assert.equal(workerStatus(task({ status: "review-ready" }), agent({ status: "running" })), "review");
});

test("worker status: runtime states of a Paseo agent", () => {
  assert.equal(workerStatus(task({}), agent({ attentionReason: "permission" })), "input");
  assert.equal(workerStatus(task({}), agent({ status: "error" })), "error");
  assert.equal(workerStatus(task({}), agent({ attentionReason: "error" })), "error");
  assert.equal(workerStatus(task({}), agent({ status: "running" })), "working");
  assert.equal(workerStatus(task({}), agent({ status: "idle" })), "idle");
  assert.equal(workerStatus(task({}), null), "missing");
  assert.equal(workerStatus(task({ status: "blocked" }), null), "blocked");
});

test("worker status: a Herdr task is marked as reported by Foreman", () => {
  assert.equal(workerStatus(task({ backend: "herdr" }), null), "herdr");
});

test("agent profile prefers the Paseo label, then the routing label, then the Foreman record", () => {
  assert.equal(agentProfile(task({}), agent({ paseoProfileName: "P", routingProfile: "R" })), "P");
  assert.equal(agentProfile(task({}), agent({ routingProfile: "R" })), "R");
  assert.equal(agentProfile(task({ profile: "D" }), null), "D");
});

test("running workers need an endpoint and an active status", () => {
  const list = [task({ taskId: "T-000002" }), task({ taskId: "T-000001", status: "review-ready" }), task({ taskId: "T-000003", status: "queued" }), task({ taskId: "T-000004", endpoint: null })];
  assert.deepEqual(runningWorkers(list).map((item) => item.taskId), ["T-000001", "T-000002"]);
});

test("task stamps and ordering: needs-user first, then working, then waiting", () => {
  const list = [
    task({ taskId: "T-000045", status: "routing", endpoint: null }),
    task({ taskId: "T-000043", status: "working" }),
    task({ taskId: "T-000044", status: "queued", endpoint: null, needsProfileConfirmation: true, routingProfile: "codex-luna", profile: "codex-luna" }),
    task({ taskId: "T-000041", status: "review-ready" }),
    task({ taskId: "T-000042", status: "waiting-decision" }),
    task({ taskId: "T-000040", status: "blocked" }),
    task({ taskId: "T-000046", status: "pending", endpoint: null }),
  ];
  assert.deepEqual(orderTasks(list).map((item) => taskStamp(item)), ["blocked", "decide", "review", "choose-model", "working", "routing", "waiting"]);
});

test("task agent text: assigned profile, recommendation, or unassigned", () => {
  assert.deepEqual(taskAgentText(task({ backend: "herdr", profile: "claude-opus" })), { text: "claude-opus (Herdr)", assigned: true });
  assert.deepEqual(taskAgentText(task({ profile: null, needsProfileConfirmation: true, routingProfile: "codex-luna" })), { text: "đề xuất codex-luna, chưa chọn", assigned: false });
  assert.deepEqual(taskAgentText(task({ profile: null })), { text: "chưa giao", assigned: false });
});
