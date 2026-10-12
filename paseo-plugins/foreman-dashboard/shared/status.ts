import type { TaskSummary } from "./foreman";

// What the plugin needs from a Paseo agent; a subset of the app's cached agent snapshot.
export interface AgentView {
  status: "initializing" | "idle" | "running" | "error" | "closed";
  attentionReason: "finished" | "error" | "permission" | null;
  paseoProfileName: string | null;
  routingProfile: string | null;
}

export type WorkerStatus = "blocked" | "decide" | "review" | "working" | "herdr";
export type StampKey = "blocked" | "decide" | "review" | "choose-model" | "working" | "routing" | "waiting";

const ACTIVE_WORKER_STATUSES = ["working", "blocked", "waiting-decision", "review-ready"];

export function taskNumber(taskId: string): string {
  const digits = taskId.replace(/^\D+/, "");
  return String(Number(digits));
}

export function isRunningWorker(task: TaskSummary): boolean {
  return Boolean(task.endpoint) && ACTIVE_WORKER_STATUSES.includes(task.status);
}

// A worker's status is the Foreman task state; the Paseo agent cache is not reliable enough to infer idle or gone.
export function workerStatus(task: TaskSummary): WorkerStatus {
  if (task.status === "blocked") return "blocked";
  if (task.status === "waiting-decision") return "decide";
  if (task.status === "review-ready") return "review";
  return task.backend === "paseo" ? "working" : "herdr";
}

export const WORKER_STATUS_LABEL: Record<Exclude<WorkerStatus, "herdr">, string> = {
  blocked: "Chờ bạn: bị chặn",
  decide: "Chờ bạn: cần quyết",
  review: "Xong, chờ duyệt",
  working: "Đang làm",
};

export function herdrStatusLabel(task: TaskSummary): string {
  return `Herdr, theo Foreman: ${task.status === "working" ? "đang làm" : "đang chạy"}`;
}

// The profile that runs the worker: the Paseo profile label wins, then the routing label, then the Foreman record.
export function agentProfile(task: TaskSummary, agent: AgentView | null): string | null {
  return agent?.paseoProfileName || agent?.routingProfile || task.profile || task.routingProfile || null;
}

// Mirrors the grouping of renderUserReport.
export function taskStamp(task: TaskSummary): StampKey {
  if (task.status === "blocked") return "blocked";
  if (task.status === "waiting-decision") return "decide";
  if (task.status === "review-ready") return "review";
  if (task.needsProfileConfirmation && ["queued", "pending"].includes(task.status)) return "choose-model";
  if (task.status === "working") return "working";
  if (task.status === "routing") return "routing";
  return "waiting";
}

export const STAMP_LABEL: Record<StampKey, string> = {
  blocked: "Bị chặn",
  decide: "Cần quyết",
  review: "Chờ duyệt",
  "choose-model": "Chọn model",
  working: "Đang làm",
  routing: "Đang route",
  waiting: "Chờ giao",
};

const STAMP_ORDER: StampKey[] = ["blocked", "decide", "review", "choose-model", "working", "routing", "waiting"];

// Tasks that need the user first, then working, then waiting to be dispatched.
export function orderTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((a, b) => STAMP_ORDER.indexOf(taskStamp(a)) - STAMP_ORDER.indexOf(taskStamp(b)) || a.taskId.localeCompare(b.taskId));
}

export function runningWorkers(tasks: TaskSummary[]): TaskSummary[] {
  return tasks.filter(isRunningWorker).sort((a, b) => a.taskId.localeCompare(b.taskId));
}

// The agent label line of a task row.
export function taskAgentText(task: TaskSummary): { text: string; assigned: boolean } {
  if (task.profile) return { text: `${task.profile}${task.backend === "herdr" ? " (Herdr)" : ""}`, assigned: true };
  if (task.needsProfileConfirmation) return { text: `đề xuất ${task.routingProfile}, chưa chọn`, assigned: false };
  return { text: "chưa giao", assigned: false };
}
