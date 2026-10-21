import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Starts `foreman dashboard serve` on the daemon machine when it is not running and returns the address to open.
export const openDashboardRpc = defineRpc({
  name: "foreman.dashboard.open",
  input: z.object({}),
  output: z.object({ url: z.string() }),
});

export const foremanSettings = defineSettings({
  id: "foreman",
  scope: "host",
  version: 1,
  schema: z.object({
    foremanRoot: z.string().default(""),
    foremanHome: z.string().default(""),
    port: z.number().int().min(1024).max(65535).default(18789),
  }),
});
