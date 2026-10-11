import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const TaskSummarySchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  type: z.string(),
  round: z.number(),
  status: z.string(),
  backend: z.string(),
  endpoint: z.string().nullable(),
  profile: z.string().nullable(),
  routingProfile: z.string().nullable(),
  needsProfileConfirmation: z.boolean(),
  title: z.string(),
  brief: z.string(),
  rounds: z.array(z.object({ round: z.number(), text: z.string() })),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const SnapshotSchema = z.object({
  // `ready` carries tasks; every other state carries a setup or failure message.
  state: z.enum(["ready", "unconfigured", "missing-home", "error"]),
  message: z.string().nullable(),
  tasks: z.array(TaskSummarySchema),
  skipped: z.array(z.object({ taskId: z.string(), reason: z.string() })),
  updatedAt: z.number(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const snapshotRpc = defineRpc({
  name: "foreman.snapshot",
  input: z.object({}),
  output: SnapshotSchema,
});

export const foremanSettings = defineSettings({
  id: "foreman",
  scope: "host",
  version: 1,
  schema: z.object({
    foremanRoot: z.string().default(""),
    foremanHome: z.string().default(""),
  }),
});
