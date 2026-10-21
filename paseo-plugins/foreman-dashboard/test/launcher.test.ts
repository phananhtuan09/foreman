import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DashboardLauncher, type LauncherConfig } from "../server/launcher";

const config: LauncherConfig = { foremanRoot: "/foreman", foremanHome: "", port: 18789 };

function fakeChild() {
  const child: any = new EventEmitter();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit("close"); };
  return child;
}

function launcher(overrides: Partial<ConstructorParameters<typeof DashboardLauncher>[0]> = {}) {
  const started: any[] = [];
  const instance = new DashboardLauncher({
    readConfig: async () => config,
    probe: async () => false,
    start: () => { const child = fakeChild(); started.push(child); return child; },
    sleep: async () => {},
    ...overrides,
  });
  return { instance, started };
}

test("an already running dashboard is reused without starting another process", async () => {
  const { instance, started } = launcher({ probe: async () => true });
  assert.equal(await instance.open(), "http://127.0.0.1:18789/");
  assert.equal(started.length, 0);
});

test("a missing dashboard is started once and its address returned when it answers", async () => {
  let probes = 0;
  const { instance, started } = launcher({ probe: async () => ++probes > 3 });
  const [first, second] = await Promise.all([instance.open(), instance.open()]);
  assert.equal(first, "http://127.0.0.1:18789/");
  assert.equal(second, first);
  assert.equal(started.length, 1, "concurrent presses share one start");
  instance.stop();
  assert.equal(started[0].killed, true, "stopping the plugin stops the dashboard");
});

test("a dashboard that exits reports its error instead of waiting for the timeout", async () => {
  const { instance } = launcher({
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    start: () => {
      const child = fakeChild();
      setImmediate(() => { child.stderr.write("Port in use"); setImmediate(() => child.emit("close")); });
      return child;
    },
  });
  await assert.rejects(instance.open(), /cổng 18789.*Port in use/);
});

test("an unconfigured plugin asks for foremanRoot and starts nothing", async () => {
  const { instance, started } = launcher({ readConfig: async () => null });
  await assert.rejects(instance.open(), /foremanRoot/);
  assert.equal(started.length, 0);
});

test("a dashboard that never answers is stopped and reported", async () => {
  const { instance, started } = launcher();
  await assert.rejects(instance.open(), /Không mở được dashboard/);
  assert.equal(started[0].killed, true);
});
