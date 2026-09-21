const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const observer = path.join(root, "global-skills/foreman-agent/scripts/observe.sh");

function writeAgentState(stateDir, name, status, sequence, cwd) {
  fs.writeFileSync(
    path.join(stateDir, `${name}.json`),
    JSON.stringify({
      id: `fake:${name}`,
      result: {
        agent: name,
        agent_status: status,
        cwd,
        state_change_seq: sequence,
      },
    })
  );
}

function runScan(fixture) {
  const result = spawnSync(
    "bash",
    [observer, "scan", fixture.repo, "foreman-test"],
    {
      env: {
        ...process.env,
        PATH: `${fixture.binDir}:${process.env.PATH}`,
        FAKE_HERDR_STATE: fixture.stateDir,
        FAKE_HERDR_PROMPTS: fixture.promptLog,
      },
      encoding: "utf8",
    }
  );
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

function eventNames(fixture) {
  return fs.readdirSync(path.join(fixture.repo, ".foreman/events")).sort();
}

function promptCount(fixture) {
  if (!fs.existsSync(fixture.promptLog)) return 0;
  return fs.readFileSync(fixture.promptLog, "utf8").trim().split("\n").filter(Boolean).length;
}

function waitFor(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  assert.fail(message);
}

function createFixture() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-observer-"));
  const repo = path.join(temporaryRoot, "repo");
  const binDir = path.join(temporaryRoot, "bin");
  const stateDir = path.join(temporaryRoot, "state");
  const promptLog = path.join(temporaryRoot, "prompts.log");
  fs.mkdirSync(path.join(repo, ".foreman/inbox"), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".foreman/backlog.md"),
    [
      "<!-- next: T-02 B-01 -->",
      "",
      "## Tasks",
      "- [~] T-01 Implement proactive supervision @worker-1 · 2026-09-21 15:00",
      "",
      "## Issues",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(binDir, "herdr"),
    `#!/usr/bin/env bash
set -u
if [ "$1" = agent ] && [ "$2" = get ]; then
  state_path="$FAKE_HERDR_STATE/$3.json"
  [ -f "$state_path" ] || exit 1
  cat "$state_path"
  exit 0
fi
if [ "$1" = agent ] && [ "$2" = list ]; then
  printf '{"result":{"agents":[]}}\\n'
  exit 0
fi
if [ "$1" = agent ] && [ "$2" = prompt ]; then
  printf '%s|%s\\n' "$3" "$4" >> "$FAKE_HERDR_PROMPTS"
  exit 0
fi
exit 2
`
  );
  fs.chmodSync(path.join(binDir, "herdr"), 0o755);
  writeAgentState(stateDir, "foreman-test", "idle", 1, repo);
  writeAgentState(stateDir, "worker-1", "working", 10, repo);
  return {
    temporaryRoot,
    repo,
    binDir,
    stateDir,
    promptLog,
    cleanup() {
      const pidPath = path.join(repo, ".foreman/runtime/observer.pid");
      if (fs.existsSync(pidPath)) {
        const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, "SIGTERM");
          } catch (_) {
            // The observer already stopped.
          }
        }
      }
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    },
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("foreman observer ignores a worker that is still working", () => {
  const fixture = createFixture();
  try {
    runScan(fixture);
    assert.deepStrictEqual(eventNames(fixture), []);
    assert.strictEqual(promptCount(fixture), 0);
  } finally {
    fixture.cleanup();
  }
});

test("foreman observer persists and wakes once for each runtime transition", () => {
  const fixture = createFixture();
  try {
    writeAgentState(fixture.stateDir, "worker-1", "done", 11, fixture.repo);
    runScan(fixture);
    assert.ok(eventNames(fixture).some((name) => name.includes("runtime-done--11")));
    assert.strictEqual(promptCount(fixture), 1);

    runScan(fixture);
    assert.strictEqual(promptCount(fixture), 1, "same event must not wake Foreman twice");

    writeAgentState(fixture.stateDir, "worker-1", "blocked", 12, fixture.repo);
    runScan(fixture);
    assert.ok(eventNames(fixture).some((name) => name.includes("runtime-blocked--12")));
    assert.strictEqual(promptCount(fixture), 2);
  } finally {
    fixture.cleanup();
  }
});

test("foreman observer wakes for a durable worker report", () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.repo, ".foreman/inbox/T-01--worker-1.md"),
      "TASK: T-01\nAGENT: @worker-1\nTYPE: done\n"
    );
    runScan(fixture);
    assert.ok(eventNames(fixture).some((name) => name.includes("inbox-ready")));
    assert.strictEqual(promptCount(fixture), 1);
  } finally {
    fixture.cleanup();
  }
});

test("foreman observer reports a missing assigned worker", () => {
  const fixture = createFixture();
  try {
    fs.rmSync(path.join(fixture.stateDir, "worker-1.json"));
    runScan(fixture);
    assert.ok(eventNames(fixture).some((name) => name.includes("agent-missing")));
    assert.strictEqual(promptCount(fixture), 1);
  } finally {
    fixture.cleanup();
  }
});

test("foreman observer runs only while assigned work or queued events remain", () => {
  const fixture = createFixture();
  try {
    const result = spawnSync(
      "bash",
      [observer, "start", fixture.repo, "foreman-test"],
      {
        env: {
          ...process.env,
          PATH: `${fixture.binDir}:${process.env.PATH}`,
          FAKE_HERDR_STATE: fixture.stateDir,
          FAKE_HERDR_PROMPTS: fixture.promptLog,
          FOREMAN_OBSERVER_INTERVAL_SECONDS: "0.05",
        },
        encoding: "utf8",
      }
    );
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const pidPath = path.join(fixture.repo, ".foreman/runtime/observer.pid");
    waitFor(() => fs.existsSync(pidPath), "observer did not start");

    writeAgentState(fixture.stateDir, "worker-1", "done", 13, fixture.repo);
    waitFor(() => promptCount(fixture) === 1, "observer did not wake Foreman");

    fs.writeFileSync(
      path.join(fixture.repo, ".foreman/backlog.md"),
      "<!-- next: T-02 B-01 -->\n\n## Tasks\n- [v] T-01 Implement proactive supervision @worker-1 · 2026-09-21 15:00\n"
    );
    fs.rmSync(path.join(fixture.repo, ".foreman/events"), { recursive: true, force: true });
    fs.mkdirSync(path.join(fixture.repo, ".foreman/events"), { recursive: true });

    waitFor(() => !fs.existsSync(pidPath), "observer did not stop after work settled");
  } finally {
    fixture.cleanup();
  }
});
