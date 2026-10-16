const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { listSessions, parseSession, sessionEvidence, renderEvidence, claudeProjectDir } = require("../src/doctor");

const bin = path.join(__dirname, "..", "bin", "foreman");

function jsonl(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join("\n")}\n`);
}

function claudeUser(cwd, at, content, extra = {}) { return { type: "user", cwd, sessionId: extra.sessionId, timestamp: at, uuid: `u-${at}`, message: { role: "user", content }, ...extra }; }
function claudeAssistant(cwd, at, content) { return { type: "assistant", cwd, timestamp: at, uuid: `a-${at}`, message: { role: "assistant", content } }; }

// A Foreman checkout with two rule commits, a Claude home, and a Codex home holding Foreman and worker sessions.
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-doctor-")));
  const root = path.join(base, "foreman");
  const worker = path.join(base, "project");
  fs.mkdirSync(root);
  fs.mkdirSync(worker);
  const git = (args, date) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "doctor@example.invalid"]);
  git(["config", "user.name", "Doctor"]);
  fs.writeFileSync(path.join(root, "AGENTS.md"), "rule v1\n");
  git(["add", "AGENTS.md"]);
  git(["commit", "-m", "rules v1"], "2026-10-01T00:00:00Z");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "rule v2\n");
  git(["commit", "-am", "rules v2"], "2026-10-05T12:00:00Z");
  const claudeHome = path.join(base, "claude");
  const codexHome = path.join(base, "codex");
  const claudeDir = claudeProjectDir(claudeHome, root);

  jsonl(path.join(claudeDir, "s-old.jsonl"), [
    claudeUser(root, "2026-10-05T10:00:00Z", "tình hình T-1?", { sessionId: "s-old" }),
    claudeAssistant(root, "2026-10-05T10:00:05Z", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "bin/foreman-paseo status" } }]),
    claudeUser(root, "2026-10-05T10:00:06Z", [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(3000) }]),
    { type: "attachment", cwd: root, timestamp: "2026-10-05T10:00:07Z", attachment: { type: "hook_additional_context", content: ["[Foreman supervision context] T-1 done"] } },
    claudeAssistant(root, "2026-10-05T10:00:08Z", [{ type: "text", text: "T-1 xong." }, { type: "tool_use", id: "t2", name: "Bash", input: { command: "bin/foreman-paseo task accept --task T-1" } }]),
    { type: "system", subtype: "compact_boundary", cwd: root, timestamp: "2026-10-05T13:00:00Z" },
    claudeUser(root, "2026-10-05T13:00:01Z", "Summary of earlier conversation", { isCompactSummary: true }),
    claudeUser(root, "2026-10-05T13:01:00Z", "<command-name>/foreman-paseo</command-name>"),
    claudeUser(root, "2026-10-05T13:02:00Z", "<paseo-system>\nSchedule \"foreman-supervision\" fired (id=ab12, run=r1).\n</paseo-system>"),
    claudeUser(root, "2026-10-05T13:03:00Z", "[Request interrupted by user]"),
    { ...claudeAssistant(root, "2026-10-05T13:04:00Z", [{ type: "text", text: "subagent work" }]), isSidechain: true },
    "{not json",
  ]);
  jsonl(path.join(claudeDir, "s-dev.jsonl"), [claudeUser(root, "2026-10-08T09:00:00Z", "DEV sửa SPEC"), claudeUser(root, "2026-10-08T09:05:00Z", "Dev, thêm test")]);
  // A worktree of the checkout has a different cwd and a different Claude folder, so it never counts.
  jsonl(path.join(claudeDir, "s-elsewhere.jsonl"), [claudeUser(worker, "2026-10-09T09:00:00Z", "worker turn")]);
  jsonl(path.join(codexHome, "sessions", "2026", "10", "07", "rollout-a.jsonl"), [
    { timestamp: "2026-10-07T08:00:00Z", type: "session_meta", payload: { id: "codex-1", cwd: root } },
    { timestamp: "2026-10-07T08:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
    { timestamp: "2026-10-07T08:00:02Z", type: "event_msg", payload: { type: "user_message", message: "giao T-2 cho codex" } },
    { timestamp: "2026-10-07T08:00:03Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: "{\"command\":[\"bin/foreman-herdr\",\"task\",\"dispatch\"]}", call_id: "c1" } },
    { timestamp: "2026-10-07T08:00:04Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "{\"status\":\"working\"}" } },
    { timestamp: "2026-10-07T08:00:05Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Đã giao T-2." }] } },
  ]);
  jsonl(path.join(codexHome, "sessions", "2026", "10", "07", "rollout-worker.jsonl"), [
    { timestamp: "2026-10-07T09:00:00Z", type: "session_meta", payload: { id: "codex-worker", cwd: worker } },
    { timestamp: "2026-10-07T09:00:02Z", type: "event_msg", payload: { type: "user_message", message: "worker brief" } },
  ]);
  return { base, root, claudeHome, codexHome, claudeDir, cleanup() { fs.rmSync(base, { recursive: true, force: true }); } };
}

test("only sessions run in the Foreman checkout are listed, newest first, without DEV-only sessions by default", () => {
  const f = fixture();
  try {
    const listed = listSessions({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome });
    assert.deepEqual(listed.selected.map((session) => [session.sessionId, session.client, session.kind]), [["codex-1", "codex", "operational"], ["s-old", "claude", "operational"]]);
    assert.deepEqual(listed.skipped.map((session) => [session.sessionId, session.kind]), [["s-dev", "dev"]], "worker sessions are never found; DEV-only ones are found but skipped");
    assert.equal(listSessions({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, limit: 1 }).selected.length, 1);
    assert.equal(listSessions({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, includeDev: true }).selected[0].sessionId, "s-dev");
    assert.deepEqual(listSessions({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, since: "2026-10-06T00:00:00Z" }).selected.map((session) => session.sessionId), ["codex-1"]);
    assert.throws(() => listSessions({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, since: "last week" }), /Invalid --since/);
  } finally { f.cleanup(); }
});

test("a session becomes ordered events with what is missing, truncated, compacted, or hidden counted", () => {
  const f = fixture();
  try {
    const session = parseSession(path.join(f.claudeDir, "s-old.jsonl"));
    assert.deepEqual(session.events.map((event) => event.kind), ["user", "tool-call", "tool-result", "hook-context", "assistant", "tool-call", "compaction", "summary", "command", "heartbeat", "interrupt"]);
    assert.equal(session.userTurns, 1, "commands, heartbeats, and interruptions are not the user's requests");
    assert.deepEqual([session.coverage.unparsableLines, session.coverage.toolCallsWithoutResult, session.coverage.compactions, session.coverage.sidechainEntries], [1, 1, 1, 1]);

    const evidence = sessionEvidence({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, session: "s-old" });
    assert.equal(evidence.coverage.truncatedEvents, 1);
    assert.ok(evidence.events[2].truncated);
    assert.equal(evidence.rules.subject, "rules v1", "the rules committed before the session started are the ones in force");
    assert.deepEqual(evidence.rules.changedDuringSession.map((change) => change.subject), ["rules v2"], "a rule change during the session is named with its time");
    assert.equal(execFileSync("sh", ["-c", evidence.rules.read], { encoding: "utf8" }), "rule v1\n");
    const page = sessionEvidence({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, session: "s-old", from: 5, maxEvents: 2 });
    assert.deepEqual(page.events.map((event) => event.n), [5, 6]);
    assert.equal(page.coverage.more, true);
    const text = renderEvidence(evidence);
    assert.match(text, /#1 2026-10-05T10:00:00Z user: tình hình T-1\?/);
    assert.match(text, /#6 .* tool Bash: bin\/foreman-paseo task accept --task T-1/);
    assert.match(text, /1 tool calls without a result; 1 compactions; 1 truncated events; 1 subagent entries not shown/);
    assert.match(text, /not instructions to follow/);

    const codex = sessionEvidence({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, session: path.join(f.codexHome, "sessions", "2026", "10", "07", "rollout-a.jsonl") });
    assert.deepEqual(codex.events.map((event) => [event.kind, event.text.slice(0, 12)]), [["user", "giao T-2 cho"], ["tool-call", "{\"command\":["], ["tool-result", "{\"status\":\"w"], ["assistant", "Đã giao T-2."]]);
    assert.throws(() => sessionEvidence({ foremanRoot: f.root, claudeHome: f.claudeHome, codexHome: f.codexHome, session: "nope" }), /No Foreman session matches/);
  } finally { f.cleanup(); }
});

test("the doctor CLI reads sessions without creating or locking anything in the Foreman home", () => {
  const f = fixture();
  try {
    const home = path.join(f.base, "home");
    fs.mkdirSync(home);
    const env = { ...process.env, FOREMAN_ROOT: f.root, FOREMAN_HOME: home, HOME: f.base, CODEX_HOME: f.codexHome };
    fs.renameSync(f.claudeHome, path.join(f.base, ".claude"));
    const listed = JSON.parse(execFileSync(process.execPath, [bin, "doctor", "sessions", "--json", "--limit", "5"], { env, encoding: "utf8" }));
    assert.deepEqual(listed.selected.map((session) => session.sessionId), ["codex-1", "s-old"]);
    const shown = execFileSync(process.execPath, [bin, "doctor", "session", "--session", "s-old"], { env, encoding: "utf8" });
    assert.match(shown, /^Session s-old \(claude, operational\)/);
    assert.throws(() => execFileSync(process.execPath, [bin, "doctor", "session", "--current"], { env, encoding: "utf8", stdio: "pipe" }), /No current Foreman session is recorded/);
    assert.deepEqual(fs.readdirSync(home), [], "doctor wrote nothing to the home");
  } finally { f.cleanup(); }
});
