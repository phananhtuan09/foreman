import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SnapshotSchema, type Snapshot } from "../shared/foreman";

export interface Config { foremanRoot: string; foremanHome: string }

export interface SnapshotDeps {
  readConfig(): Promise<Config | null>;
  // Runs the read-only summary command and returns its stdout.
  runSummary(config: Config): Promise<string>;
  now(): number;
  minIntervalMs: number;
}

const SETUP_MESSAGE = "Chưa cấu hình Foreman. Mở cài đặt plugin foreman-dashboard và nhập foremanRoot (và foremanHome nếu khác).";

export function runSummaryCommand(config: Config): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("node", [path.join(config.foremanRoot, "bin", "foreman"), "task", "list", "--json", "--summary"], {
      env: { ...process.env, FOREMAN_ROOT: config.foremanRoot, FOREMAN_HOME: config.foremanHome },
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// A few stat calls: the directory and meta.json mtimes change on every atomic Foreman write.
export function fingerprint(home: string): string {
  const tasksRoot = path.join(home, "data", "tasks");
  const parts: string[] = [String(fs.statSync(tasksRoot).mtimeMs)];
  for (const id of fs.readdirSync(tasksRoot).sort()) {
    const dir = path.join(tasksRoot, id);
    const stamp = (file: string) => { try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; } };
    parts.push(`${id}:${stamp(path.join(dir, "meta.json"))}:${stamp(path.join(dir, "rounds"))}`);
  }
  return parts.join("|");
}

function empty(state: Snapshot["state"], message: string, now: number): Snapshot {
  return { state, message, tasks: [], skipped: [], updatedAt: now };
}

/**
 * Holds the task snapshot in memory. A fetch never spawns a process by itself:
 * the summary command runs only when the throttled stat check sees Foreman state change.
 */
export class SnapshotStore {
  private cached: Snapshot | null = null;
  private lastFingerprint: string | null = null;
  private lastConfigKey: string | null = null;
  private lastCheck = Number.NEGATIVE_INFINITY;
  private dirty = false;
  private inflight: Promise<Snapshot> | null = null;

  constructor(private readonly deps: SnapshotDeps) {}

  // Only sets a flag so the next fetch re-checks immediately; safe to call from an event hook.
  markDirty(): void { this.dirty = true; }

  get(): Promise<Snapshot> {
    if (this.inflight) return this.inflight;
    const now = this.deps.now();
    if (this.cached && !this.dirty && now - this.lastCheck < this.deps.minIntervalMs) return Promise.resolve(this.cached);
    this.inflight = this.refresh(now).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(now: number): Promise<Snapshot> {
    this.lastCheck = now;
    this.dirty = false;
    const config = await this.deps.readConfig();
    if (!config || !config.foremanRoot) return this.remember(empty("unconfigured", SETUP_MESSAGE, now), null, null);
    const home = config.foremanHome || config.foremanRoot;
    const configKey = `${config.foremanRoot}\n${home}`;
    let print: string;
    try { print = fingerprint(home); }
    catch { return this.remember(empty("missing-home", `Không tìm thấy dữ liệu Foreman tại ${path.join(home, "data", "tasks")}.`, now), null, configKey); }
    if (this.cached && this.lastFingerprint !== null && print === this.lastFingerprint && configKey === this.lastConfigKey) return this.cached;
    try {
      const parsed = JSON.parse(await this.deps.runSummary({ foremanRoot: config.foremanRoot, foremanHome: home }));
      return this.remember(SnapshotSchema.parse({ state: "ready", message: null, tasks: parsed.tasks, skipped: parsed.skipped, updatedAt: now }), print, configKey);
    } catch (error) {
      return this.remember(empty("error", `Không đọc được trạng thái Foreman: ${(error as Error).message}`, now), print, configKey);
    }
  }

  private remember(snapshot: Snapshot, print: string | null, configKey: string | null): Snapshot {
    this.cached = snapshot;
    this.lastFingerprint = print;
    this.lastConfigKey = configKey;
    return snapshot;
  }
}
