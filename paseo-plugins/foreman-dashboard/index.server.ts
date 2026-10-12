import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SnapshotStore, runSummaryCommand } from "./server/snapshot";
import { foremanSettings, snapshotRpc } from "./shared/foreman";

// The runtime exposes no plugin path, so an unset foremanRoot falls back to the checkout this plugin was installed from,
// read from the daemon config (<foreman>/paseo-plugins/foreman-dashboard).
function defaultForemanRoot(): string {
  try {
    const home = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
    const config = JSON.parse(readFileSync(path.join(home, "config.json"), "utf8"));
    const installed = config?.plugins?.["foreman-dashboard"]?.path;
    if (typeof installed !== "string") return "";
    const root = path.resolve(installed, "..", "..");
    return existsSync(path.join(root, "bin", "foreman")) ? root : "";
  } catch {
    return "";
  }
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(foremanSettings);
  const store = new SnapshotStore({
    async readConfig() {
      const state = await settings.read();
      return state.status === "ready" ? { foremanRoot: state.values.foremanRoot.trim() || defaultForemanRoot(), foremanHome: state.values.foremanHome.trim() } : null;
    },
    runSummary: runSummaryCommand,
    now: () => Date.now(),
    minIntervalMs: 3000,
  });
  server.handle(snapshotRpc, () => store.get());
  // The hook only sets a flag; it never blocks or touches a worker.
  const stopTurnEnded = server.on("agent.turn_ended", () => { store.markDirty(); });
  const stopSettings = settings.subscribe(() => { store.markDirty(); });
  return () => { stopTurnEnded(); stopSettings(); };
}
