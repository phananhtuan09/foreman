import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SnapshotStore, runSummaryCommand } from "./server/snapshot";
import { foremanSettings, snapshotRpc } from "./shared/foreman";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(foremanSettings);
  const store = new SnapshotStore({
    async readConfig() {
      const state = await settings.read();
      return state.status === "ready" ? { foremanRoot: state.values.foremanRoot.trim(), foremanHome: state.values.foremanHome.trim() } : null;
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
