import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { DashboardLauncher, probeDashboard, startDashboardProcess } from "./server/launcher";
import { foremanSettings, openDashboardRpc, stopDashboardRpc } from "./shared/foreman";

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
  const launcher = new DashboardLauncher({
    async readConfig() {
      const state = await settings.read();
      if (state.status !== "ready") return null;
      const foremanRoot = state.values.foremanRoot.trim() || defaultForemanRoot();
      return foremanRoot ? { foremanRoot, foremanHome: state.values.foremanHome.trim(), port: state.values.port } : null;
    },
    probe: probeDashboard,
    start: startDashboardProcess,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  server.handle(openDashboardRpc, async () => ({ url: await launcher.open() }));
  server.handle(stopDashboardRpc, async () => ({ stopped: launcher.stop() }));
  return () => { launcher.stop(); };
}
