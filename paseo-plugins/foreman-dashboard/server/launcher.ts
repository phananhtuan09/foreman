import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export interface LauncherConfig { foremanRoot: string; foremanHome: string; port: number }

export interface LauncherDeps {
  readConfig(): Promise<LauncherConfig | null>;
  // True when a Foreman dashboard already answers on the port.
  probe(port: number): Promise<boolean>;
  start(config: LauncherConfig): ChildProcess;
  sleep(ms: number): Promise<void>;
}

const SETUP_MESSAGE = "Chưa cấu hình Foreman. Mở cài đặt plugin foreman-dashboard và nhập foremanRoot.";
const WAIT_STEP_MS = 200;
const WAIT_STEPS = 25;

export async function probeDashboard(port: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/snapshot`, { signal: abort.signal });
    return response.ok && typeof (await response.json()).schemaVersion === "number";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function startDashboardProcess(config: LauncherConfig): ChildProcess {
  return spawn("node", [path.join(config.foremanRoot, "bin", "foreman"), "dashboard", "serve", "--port", String(config.port)], {
    env: { ...process.env, FOREMAN_ROOT: config.foremanRoot, ...(config.foremanHome ? { FOREMAN_HOME: config.foremanHome } : {}) },
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
  });
}

// Keeps at most one dashboard process, owned by this plugin: it stops with the plugin and is reused by later calls.
export class DashboardLauncher {
  private child: ChildProcess | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly deps: LauncherDeps) {}

  open(): Promise<string> {
    this.pending ??= this.ensure().finally(() => { this.pending = null; });
    return this.pending;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  private async ensure(): Promise<string> {
    const config = await this.deps.readConfig();
    if (!config) throw new Error(SETUP_MESSAGE);
    const url = `http://127.0.0.1:${config.port}/`;
    if (await this.deps.probe(config.port)) return url;
    this.stop();
    const child = this.deps.start(config);
    this.child = child;
    let exited = false;
    let errors = "";
    child.stderr?.on("data", (chunk) => { errors = (errors + String(chunk)).slice(-500); });
    // "close" comes after stderr is drained, so the failure text is complete.
    child.once("close", () => { exited = true; if (this.child === child) this.child = null; });
    child.once("error", (error) => { exited = true; errors = error.message; });
    for (let step = 0; step < WAIT_STEPS; step += 1) {
      if (exited) break;
      if (await this.deps.probe(config.port)) return url;
      await this.deps.sleep(WAIT_STEP_MS);
    }
    this.stop();
    throw new Error(`Không mở được dashboard trên cổng ${config.port}.${errors.trim() ? ` ${errors.trim()}` : ""}`);
  }
}
