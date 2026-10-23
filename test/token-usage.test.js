const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createTask, confirmTaskProfile, assignTask, collectPaseoReports, reconstructTask, acceptTask } = require("../src/foreman");
const history = require("../src/history");
const dashboard = require("../src/dashboard");
const { tokenUsage } = require("../src/token-usage");
const { fixture } = require("./support/paseo-fixture");

const HOUR = 60 * 60 * 1000;

// One assistant response as Claude Code writes it: one line per content block, each repeating the response's usage.
function response(id, at, usage, blocks = 1) {
  const message = { id, model: "claude-sonnet-5-5", usage: { input_tokens: usage[0], cache_creation_input_tokens: usage[1], cache_read_input_tokens: usage[2], output_tokens: usage[3] } };
  return Array.from({ length: blocks }, () => JSON.stringify({ type: "assistant", timestamp: new Date(at).toISOString(), message }));
}

function writeTranscript(claudeHome, project, file, lines) {
  const target = path.join(claudeHome, "projects", project, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${lines.flat().join("\n")}\n`);
}

test("token usage counts each model call once per day, finds resends and subagents, and says which sessions it could not read", () => {
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-claude-"));
  try {
    const now = new Date(2026, 9, 23, 15, 0).getTime();
    const yesterday = new Date(2026, 9, 22, 10, 0).getTime();
    writeTranscript(claudeHome, "-work-app", "s-1.jsonl", [
      JSON.stringify({ type: "user", timestamp: new Date(yesterday).toISOString(), message: { content: "brief" } }),
      response("m-1", yesterday, [10, 1000, 0, 50], 3),
      response("m-2", yesterday + HOUR, [2, 100, 1000, 20], 2),
      // A cache that expired writes the whole context again.
      response("m-3", now - HOUR, [1, 1200, 0, 30]),
      JSON.stringify({ type: "assistant", timestamp: new Date(now).toISOString(), message: { id: "x", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } }),
      JSON.stringify({ type: "assistant", timestamp: new Date(now).toISOString(), message: { model: "claude-sonnet-5-5", usage: { input_tokens: 7, output_tokens: 7 } } }),
    ]);
    writeTranscript(claudeHome, "-work-app", "s-1/subagents/agent-a.jsonl", [response("sub-1", now - 2 * HOUR, [5, 300, 0, 5])]);
    // The window starts at local midnight six days before today.
    writeTranscript(claudeHome, "-work-app", "s-1/subagents/agent-c.jsonl", [
      response("m-edge-out", new Date(2026, 9, 16, 23, 59).getTime(), [1, 0, 1, 1]),
      response("m-edge-in", new Date(2026, 9, 17, 0, 0).getTime(), [1, 0, 2, 1]),
    ]);
    writeTranscript(claudeHome, "-work-app", "s-1/subagents/agent-b.jsonl", [response("m-old", now - 10 * 24 * HOUR, [100, 0, 0, 100])]);
    const usage = tokenUsage({
      now,
      env: { CLAUDE_CONFIG_DIR: claudeHome },
      sessions: [
        { taskId: "T-1", projectId: "app", profile: "claude-sonnet", provider: "claude", sessionId: "s-1" },
        { taskId: "T-1", projectId: "app", profile: "claude-sonnet", provider: "claude", sessionId: "s-1" },
        { taskId: "T-2", projectId: "app", profile: "claude-sonnet", provider: "claude", sessionId: "gone" },
        { taskId: "T-3", projectId: "app", profile: "codex-luna", provider: "codex", sessionId: "c-1" },
        { taskId: "T-4", projectId: "app", profile: "claude-sonnet", provider: "claude", sessionId: "../s-1" },
      ],
    });
    assert.equal(usage.calls, 5, "a response without an ID and a call before the window are not counted");
    assert.deepEqual(usage.coverage, { recorded: 5, counted: 1, missing: 2, otherProvider: 1 });
    assert.deepEqual(usage.total, { tokens: 1060 + 1122 + 1231 + 310 + 4, input: 19, cacheWrite: 2600, cacheRead: 1002, output: 106, hit: 27.7 });
    assert.equal(usage.days.length, 7);
    assert.deepEqual(usage.days.slice(-2).map((day) => day.tokens), [1060 + 1122, 1231 + 310]);
    assert.deepEqual([usage.days[0].tokens, usage.days[0].hit], [4, 66.7]);
    assert.equal(usage.days[1].hit, null);
    assert.deepEqual(usage.resends.map((resend) => [resend.taskId, resend.tokens]), [["T-1", 1200]], "a session's first call and a subagent's first call are not resends");
    assert.deepEqual(usage.byTask, [{ taskId: "T-1", projectId: "app", tokens: usage.total.tokens }]);
    assert.deepEqual(usage.byProfile, [{ profile: "claude-sonnet", tokens: usage.total.tokens }]);
  } finally { fs.rmSync(claudeHome, { recursive: true, force: true }); }
});

test("Foreman records a Claude worker's session once when it collects it, keeps it in the history line, and the dashboard counts it", () => {
  const f = fixture();
  const claudeHome = path.join(f.base, "claude");
  try {
    const task = createTask({ roots: f.roots, projectId: "fixture", brief: "Inspect README.md.", type: "scout", backend: "paseo", routingRunner: () => ({ profile: "claude-sonnet", reason: "Use Claude." }) });
    confirmTaskProfile({ roots: f.roots, taskId: task.id, profile: "claude-sonnet" });
    const assignment = assignTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    f.adapter.agents.get(assignment.endpoint).providerSessionId = "sess-1";
    const now = Date.now();
    writeTranscript(claudeHome, "-fixture", "sess-1.jsonl", [response("m-1", now - HOUR, [3, 500, 0, 40])]);

    collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    f.adapter.finish(assignment.endpoint, JSON.stringify({ status: "done", summary: "Read README.md." }));
    collectPaseoReports({ roots: f.roots, adapter: f.adapter });
    const meta = reconstructTask({ roots: f.roots, taskId: task.id }).meta;
    assert.equal(meta.status, "review-ready");
    assert.deepEqual(meta.workerSessions.map(({ recordedAt, ...session }) => session), [{ generation: assignment.generation, endpoint: assignment.endpoint, provider: "claude", profile: "claude-sonnet", sessionId: "sess-1" }]);

    const live = dashboard.buildSnapshot({ roots: f.roots, now, env: { CLAUDE_CONFIG_DIR: claudeHome } });
    assert.equal(live.tokens.total.tokens, 543);
    assert.deepEqual(live.tokens.byTask, [{ taskId: task.id, projectId: "fixture", tokens: 543 }]);

    acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(history.readHistory(f.roots.foremanHome).records[0].workerSessions[0].sessionId, "sess-1");
    const ended = dashboard.buildSnapshot({ roots: f.roots, now, env: { CLAUDE_CONFIG_DIR: claudeHome } });
    assert.equal(ended.tasks.length, 0);
    assert.equal(ended.tokens.total.tokens, 543, "an accepted task still counts from its history line");
  } finally { f.cleanup(); }
});
