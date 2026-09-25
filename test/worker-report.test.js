const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  resolveRoots, initHome, registerProject, createTask, assignTask, acceptTask,
  recordReport, workerStopHook, sessionContext, sendWorkerMessage, fleetStatus,
  createDecision, answerDecision, deliverDecision, ValidationError, HerdrAdapter,
} = require("../src/foreman");
const { detectShellStartupFile, installShellEnv, ShellEnvError } = require("../src/shell-env");

const repo = path.join(__dirname, "..");
const bin = path.join(repo, "bin", "foreman");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-report-"));
  const project = path.join(base, "project");
  fs.mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-b", "main", project], { stdio: "pipe" });
  execFileSync("git", ["-C", project, "config", "user.email", "report@example.invalid"]);
  execFileSync("git", ["-C", project, "config", "user.name", "Foreman Report"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", ["-C", project, "commit", "-m", "fixture"], { stdio: "pipe" });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  initHome(roots);
  registerProject({ roots, id: "app", root: project });
  const workers = new Map();
  const sent = [];
  let lists = 0;
  let spawned = 0;
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, model: false, reasoningEffort: false }),
    spawn(request) {
      spawned += 1;
      const endpoint = `worker-${spawned}`;
      workers.set(endpoint, { ...request, endpoint, paneId: `w1:p${spawned}`, status: "working" });
      return { endpoint, paneId: `w1:p${spawned}` };
    },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { lists += 1; return [...workers.values()]; },
    send(endpoint, text) { sent.push({ endpoint, text }); return workers.has(endpoint) ? { delivered: true } : { delivered: false }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  return {
    base, project, roots, workers, sent, adapter: new HerdrAdapter({ transport }),
    get lists() { return lists; },
    meta(taskId) { return JSON.parse(fs.readFileSync(path.join(roots.foremanHome, "data", "tasks", taskId, "meta.json"), "utf8")); },
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function dispatch(f, brief = "build it", options = {}) {
  const task = createTask({ roots: f.roots, projectId: "app", brief, ...options });
  const assignment = assignTask({ roots: f.roots, taskId: task.id, owner: "worker", adapter: f.adapter, resources: [{ key: `file/${task.id}`, mode: options.type === "scout" ? "read" : "write" }] });
  return { task, assignment };
}

test("shell startup file follows the login shell of the machine", () => {
  const home = "/home/u";
  assert.equal(detectShellStartupFile({ env: { SHELL: "/bin/zsh" }, home }).file, "/home/u/.zshrc");
  assert.equal(detectShellStartupFile({ env: { SHELL: "/usr/bin/zsh", ZDOTDIR: "/home/u/.config/zsh" }, home }).file, "/home/u/.config/zsh/.zshrc");
  assert.equal(detectShellStartupFile({ env: { SHELL: "/bin/bash" }, platform: "linux", home }).file, "/home/u/.bashrc");
  assert.equal(detectShellStartupFile({ env: { SHELL: "/bin/bash" }, platform: "darwin", home }).file, "/home/u/.bash_profile");
  const fish = detectShellStartupFile({ env: { SHELL: "/usr/bin/fish" }, home });
  assert.deepEqual([fish.file, fish.syntax], ["/home/u/.config/fish/conf.d/foreman.fish", "fish"]);
  assert.equal(detectShellStartupFile({ env: { SHELL: "/bin/dash" }, home }).file, "/home/u/.profile");
  assert.equal(detectShellStartupFile({ env: { SHELL: "/usr/bin/nu" }, home }), null);
});

test("init writes one Foreman block, refreshes a changed root, and leaves other lines alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-rc-"));
  try {
    const rc = path.join(dir, ".zshrc");
    fs.writeFileSync(rc, "alias ll='ls -l'\n");
    const env = { SHELL: "/bin/zsh" };
    const first = installShellEnv({ vars: { FOREMAN_ROOT: "/opt/foreman", FOREMAN_HOME: "/opt/foreman" }, env, home: dir });
    assert.equal(first.changed, true);
    assert.equal(fs.readFileSync(rc, "utf8"), "alias ll='ls -l'\n\n# >>> foreman >>>\nexport FOREMAN_ROOT='/opt/foreman'\nexport FOREMAN_HOME='/opt/foreman'\n# <<< foreman <<<\n");
    assert.equal(installShellEnv({ vars: { FOREMAN_ROOT: "/opt/foreman", FOREMAN_HOME: "/opt/foreman" }, env, home: dir }).changed, false);
    installShellEnv({ vars: { FOREMAN_ROOT: "/srv/it's here", FOREMAN_HOME: "/srv/it's here" }, env, home: dir });
    const text = fs.readFileSync(rc, "utf8");
    assert.equal(text.match(/# >>> foreman >>>/g).length, 1);
    assert.match(text, /^alias ll='ls -l'$/m);
    assert.equal(execFileSync("/bin/sh", ["-c", `. ${JSON.stringify(rc)} 2>/dev/null; printf %s "$FOREMAN_ROOT"`], { encoding: "utf8" }), "/srv/it's here");
    installShellEnv({ vars: { FOREMAN_ROOT: "/opt/f" }, env: { SHELL: "/usr/bin/fish" }, home: dir });
    assert.equal(fs.readFileSync(path.join(dir, ".config", "fish", "conf.d", "foreman.fish"), "utf8"), "# >>> foreman >>>\nset -gx FOREMAN_ROOT '/opt/f'\n# <<< foreman <<<\n");
    assert.throws(() => installShellEnv({ vars: { FOREMAN_ROOT: "/opt/f" }, env: { SHELL: "/usr/bin/nu" }, home: dir }), (error) => error instanceof ShellEnvError && /export FOREMAN_ROOT='\/opt\/f'/.test(error.message));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("init records the calling Foreman checkout in the shell startup file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-init-"));
  try {
    const rc = path.join(dir, "rc");
    const home = path.join(dir, "home");
    const out = JSON.parse(execFileSync(process.execPath, [bin, "init", "--home", home], { cwd: repo, env: { ...process.env, FOREMAN_SHELL_RC: rc, FOREMAN_ROOT: "/elsewhere" }, encoding: "utf8" }));
    assert.equal(out.shellEnv.file, rc);
    assert.match(fs.readFileSync(rc, "utf8"), new RegExp(`export FOREMAN_ROOT='${fs.realpathSync(repo)}'`));
    assert.match(fs.readFileSync(rc, "utf8"), new RegExp(`export FOREMAN_HOME='${fs.realpathSync(home)}'`));
    const refused = spawnSync(process.execPath, [bin, "init"], { cwd: dir, env: { ...process.env, FOREMAN_SHELL_RC: rc }, encoding: "utf8" });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /Foreman checkout/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the stop hook asks only the current worker of a working task to report, once per turn", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    assert.equal(assignment.paneId, "w1:p1");
    assert.equal(workerStopHook({ roots: f.roots, paneId: "w9:p9" }), null);
    assert.equal(workerStopHook({ roots: f.roots, paneId: undefined }), null);
    assert.equal(workerStopHook({ roots: f.roots, paneId: "w1:p1", payload: { stop_hook_active: true } }), null);
    const decision = workerStopHook({ roots: f.roots, paneId: "w1:p1", payload: {} });
    assert.equal(decision.decision, "block");
    assert.match(decision.reason, new RegExp(`task ${task.id} \\(project app, generation 1\\)`));
    assert.match(decision.reason, /"\$FOREMAN_ROOT\/bin\/foreman" report --status <done\|blocked\|progress>/);
    recordReport({ roots: f.roots, paneId: "w1:p1", status: "progress", summary: "half done" });
    assert.equal(workerStopHook({ roots: f.roots, paneId: "w1:p1" }), null, "a report since the last prompt satisfies the hook");
    sendWorkerMessage({ roots: f.roots, taskId: task.id, payload: { request: "continue" }, adapter: f.adapter });
    assert.equal(workerStopHook({ roots: f.roots, paneId: "w1:p1" }).decision, "block", "a new Foreman prompt expects a new report");
    recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "finished" });
    assert.equal(workerStopHook({ roots: f.roots, paneId: "w1:p1" }), null, "a review-ready task is not asked again");
  } finally { f.cleanup(); }
});

test("reports map status, keep every report verbatim, and bind to the worker pane", () => {
  const f = fixture();
  try {
    const { task } = dispatch(f);
    assert.throws(() => recordReport({ roots: f.roots, paneId: "w1:p1", status: "finished", summary: "x" }), /done, blocked, progress/);
    assert.throws(() => recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "  " }), /must not be empty/);
    assert.throws(() => recordReport({ roots: f.roots, paneId: "w7:p7", status: "done", summary: "foreign" }), /not bound to an active Foreman task/);
    const progress = recordReport({ roots: f.roots, paneId: "w1:p1", status: "progress", summary: "step 1" });
    assert.equal(progress.taskStatus, "working");
    const blocked = recordReport({ roots: f.roots, paneId: "w1:p1", status: "blocked", summary: "need a choice" });
    assert.equal(blocked.taskStatus, "blocked");
    assert.equal(f.meta(task.id).blockerReport, blocked.file);
    const done = recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "outcome: shipped\n" });
    assert.equal(done.taskStatus, "review-ready");
    assert.throws(() => recordReport({ roots: f.roots, paneId: "w1:p1", status: "progress", summary: "late" }), /is review-ready/);
    const reports = fs.readdirSync(path.join(f.roots.foremanHome, "data", "tasks", task.id, "reports"));
    assert.deepEqual(reports, ["generation-1-001-progress.md", "generation-1-002-blocked.md", "generation-1-003-done.md"]);
    assert.match(fs.readFileSync(done.file, "utf8"), new RegExp(`^TASK: ${task.id}\\nPROJECT: app\\nAGENT: worker\\nGENERATION: 1\\nSTATUS: done\\nREPORTED_AT: .+\\n\\noutcome: shipped\\n$`));
    assert.equal(acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter }).deleted, true);
  } finally { f.cleanup(); }
});

test("a scout report does not scan project files", () => {
  const f = fixture();
  try {
    const { task } = dispatch(f, "read only", { type: "scout" });
    fs.writeFileSync(path.join(f.project, "sneak.txt"), "x\n");
    assert.equal(recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "no edits" }).taskStatus, "review-ready");
    const meta = f.meta(task.id);
    assert.equal(meta.status, "review-ready");
    assert.equal(meta.scoutViolation, undefined);
    assert.equal(meta.lastReport.status, "done");
  } finally { f.cleanup(); }
});

test("status finds a worker that stopped without reporting and a missing worker without interrupting them", () => {
  const f = fixture();
  try {
    const one = dispatch(f, "one");
    const two = dispatch(f, "two");
    f.workers.get(one.assignment.endpoint).status = "idle";
    f.workers.delete(two.assignment.endpoint);
    const sentBefore = f.sent.length;
    const status = fleetStatus({ roots: f.roots, adapter: f.adapter });
    assert.equal(f.lists, 1);
    assert.equal(f.sent.length, sentBefore);
    assert.deepEqual(status.anomalies.map((issue) => [issue.taskId, issue.type]), [[one.task.id, "worker.idle-without-report"], [two.task.id, "worker.missing"]]);
    recordReport({ roots: f.roots, paneId: "w1:p1", status: "progress", summary: "waiting" });
    assert.equal(fleetStatus({ roots: f.roots, adapter: f.adapter }).anomalies.some((issue) => issue.taskId === one.task.id), false);
    assert.equal(fs.existsSync(path.join(f.roots.foremanHome, "data", "events")), false);
  } finally { f.cleanup(); }
});

test("session context lists unread reports once, adds anomalies, and ignores DEV prompts", () => {
  const f = fixture();
  try {
    assert.equal(sessionContext({ roots: f.roots, adapter: f.adapter }), null);
    const { task } = dispatch(f);
    recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "done" });
    assert.equal(sessionContext({ roots: f.roots, adapter: f.adapter, prompt: "DEV fix something" }), null);
    assert.equal(sessionContext({ roots: f.roots, adapter: f.adapter, prompt: "status?", cwd: f.base }), null, "a session outside the Foreman checkout gets nothing");
    assert.equal(sessionContext({ roots: f.roots, adapter: f.adapter, prompt: "status?", cwd: path.join(f.base, "gone") }), null);
    const context = sessionContext({ roots: f.roots, adapter: f.adapter, prompt: "tình hình sao rồi?", cwd: f.project });
    assert.match(context, new RegExp(`${task.id} project app @worker generation 1: done at .+; task is review-ready; report: .+generation-1-001-done\\.md`));
    assert.ok(f.meta(task.id).lastReport.readAt);
    assert.equal(sessionContext({ roots: f.roots, adapter: f.adapter }), null);
    const other = dispatch(f, "other");
    f.workers.get(other.assignment.endpoint).status = "idle";
    assert.match(sessionContext({ roots: f.roots, adapter: f.adapter }), new RegExp(`${other.task.id} project app @worker: worker.idle-without-report`));
    assert.match(sessionContext({ roots: f.roots, adapter: { list() { throw new Error("herdr down"); } } }), /Runtime check unavailable: herdr down/);
  } finally { f.cleanup(); }
});

test("Foreman messages and delivered decisions reopen the task for the next report", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "first try" });
    sendWorkerMessage({ roots: f.roots, taskId: task.id, payload: { request: "Please add tests." }, adapter: f.adapter });
    assert.equal(f.meta(task.id).status, "working");
    assert.equal(f.meta(task.id).completionReport, null);
    assert.match(f.sent.at(-1).text, /Please add tests\./);
    assert.equal(f.sent.at(-1).endpoint, assignment.endpoint);
    recordReport({ roots: f.roots, paneId: "w1:p1", status: "blocked", summary: "A or B?" });
    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "choice", why: "product", options: ["A", "B"] });
    answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "A" });
    assert.equal(deliverDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, adapter: f.adapter }).status, "delivered");
    assert.equal(f.meta(task.id).status, "working");
    assert.equal(workerStopHook({ roots: f.roots, paneId: "w1:p1" }).decision, "block");
  } finally { f.cleanup(); }
});

test("hook, report, and session-context CLIs work end to end from environment variables", () => {
  const f = fixture();
  try {
    const { task } = dispatch(f);
    const env = { ...process.env, FOREMAN_ROOT: repo, FOREMAN_HOME: f.roots.foremanHome, HERDR_PANE_ID: "w1:p1" };
    delete env.HERDR_ENV;
    const hookScript = path.join(repo, "hooks", "foreman-worker-stop.sh");
    const blocked = JSON.parse(execFileSync(hookScript, { env, input: "{\"stop_hook_active\":false}", encoding: "utf8" }));
    assert.equal(blocked.decision, "block");
    assert.equal(execFileSync(hookScript, { env, input: "{\"stop_hook_active\":true}", encoding: "utf8" }), "");
    assert.equal(execFileSync(hookScript, { env: { ...env, HERDR_PANE_ID: "w5:p5" }, input: "{}", encoding: "utf8" }), "");
    assert.equal(execFileSync(hookScript, { env: { ...env, FOREMAN_ROOT: "" }, input: "{}", encoding: "utf8" }), "");
    assert.equal(execFileSync(hookScript, { env: { ...env, FOREMAN_HOME: path.join(f.base, "nowhere") }, input: "not json", encoding: "utf8" }), "");
    assert.equal(fs.existsSync(path.join(f.base, "nowhere")), false, "the hook leaves no trace for a home that does not exist");
    const reported = JSON.parse(execFileSync("/bin/sh", ["-c", "\"$FOREMAN_ROOT/bin/foreman\" report --status done <<'REPORT'\noutcome: it's done\nREPORT"], { env, encoding: "utf8" }));
    assert.equal(reported.taskStatus, "review-ready");
    assert.match(fs.readFileSync(reported.file, "utf8"), /\n\noutcome: it's done\n$/);
    const sessionHook = path.join(repo, "hooks", "foreman-session-context.sh");
    assert.equal(execFileSync(sessionHook, { env, input: JSON.stringify({ prompt: "status?", cwd: f.base }), encoding: "utf8" }), "");
    const context = JSON.parse(execFileSync(sessionHook, { env, input: JSON.stringify({ prompt: "status?", cwd: repo }), encoding: "utf8" }));
    assert.equal(context.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(context.hookSpecificOutput.additionalContext, new RegExp(`${task.id} .+: done at`));
    const noPane = spawnSync(bin, ["report", "--status", "done", "--summary", "x"], { env: { ...env, HERDR_PANE_ID: "" }, encoding: "utf8" });
    assert.equal(noPane.status, 2);
    assert.match(noPane.stderr, /only a Foreman worker pane can report/);
  } finally { f.cleanup(); }
});

test("reports from a replaced generation's pane are refused", () => {
  const f = fixture();
  try {
    const { task } = dispatch(f);
    assignTask({ roots: f.roots, taskId: task.id, owner: "worker-2", adapter: f.adapter });
    assert.equal(f.meta(task.id).paneId, "w1:p2");
    assert.throws(() => recordReport({ roots: f.roots, paneId: "w1:p1", status: "done", summary: "stale" }), ValidationError);
    assert.equal(recordReport({ roots: f.roots, paneId: "w1:p2", status: "done", summary: "fresh" }).generation, 2);
  } finally { f.cleanup(); }
});
