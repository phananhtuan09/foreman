const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { sessionContext, sessionSizeNudge } = require("../src/foreman");
const { HEARTBEAT_NAME, HEARTBEAT_PROMPT } = require("../src/supervision");
const { fixture, routeAndAssign } = require("./support/paseo-fixture");

// One Claude Code transcript line of a model call whose context held `tokens` tokens.
function call(tokens) {
  return JSON.stringify({ type: "assistant", message: { id: `msg-${tokens}`, usage: { input_tokens: 10, cache_creation_input_tokens: 990, cache_read_input_tokens: tokens - 1000, output_tokens: 50 } } });
}

// The prompt hook's added context as Claude Code stores it in the transcript.
function hookContext(text) {
  return JSON.stringify({ type: "attachment", attachment: { type: "hook_additional_context", content: [text] } });
}

function transcript(f, lines) {
  const file = path.join(f.base, "session.jsonl");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

test("a large Foreman session is suggested a new session once per size step, only in a user turn", () => {
  const f = fixture();
  try {
    routeAndAssign(f);
    const ask = (file, prompt = "còn gì không?") => sessionContext({ roots: f.roots, adapter: f.adapter, prompt, cwd: f.projectRoot, transcriptPath: file });
    sessionContext({ roots: f.roots, adapter: f.adapter, prompt: "status", cwd: f.projectRoot });

    assert.equal(ask(transcript(f, [call(40000), call(149000)])), null, "a small session adds nothing");

    const lines = [call(40000), call(162000)];
    const first = ask(transcript(f, lines));
    assert.match(first, /Foreman session size: nudge 1\. This session holds about 162k tokens/);
    assert.match(first, /a new Foreman session would be much cheaper/);
    assert.match(first, /^> ⚠️ \*\*Phiên đã dài \(~162k token\)\*\* · /m, "the suggestion comes as a quoted line that stands apart from the answer");
    assert.match(first, /still waiting for the user's confirmation/);

    // Claude Code keeps the added context in the transcript, so the same step is not suggested again.
    lines.push(hookContext(first), call(190000));
    assert.equal(ask(transcript(f, lines)), null, "the same step is suggested once");
    lines.push(call(305000));
    assert.match(ask(transcript(f, lines)), /nudge 2\. This session holds about 305k tokens/, "the next step is suggested again");

    const heartbeat = `<paseo-system>\nSchedule "${HEARTBEAT_NAME}" fired (id=hb1, run=r1).\n${HEARTBEAT_PROMPT}\n</paseo-system>`;
    assert.doesNotMatch(ask(transcript(f, lines), heartbeat), /Foreman session size/, "a heartbeat turn has no reader for the suggestion");
    assert.equal(ask(path.join(f.base, "missing.jsonl")), null, "an unreadable transcript adds nothing");
    assert.equal(sessionSizeNudge(transcript(f, ["{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\"}}", "not json"])), null, "another transcript format adds nothing");
  } finally { f.cleanup(); }
});

test("init warns when the session inherited another checkout or home", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-init-")));
  try {
    const root = path.join(__dirname, "..");
    const run = (env) => JSON.parse(execFileSync(process.execPath, [path.join(root, "bin", "foreman"), "init", "--home", path.join(base, "home")], { cwd: root, encoding: "utf8", env: { ...process.env, FOREMAN_BACKEND: "paseo", FOREMAN_SHELL_RC: path.join(base, "rc"), ...env } }));
    const inherited = run({ FOREMAN_ROOT: path.join(base, "other"), FOREMAN_HOME: path.join(base, "other") });
    assert.match(inherited.warning, /inherited FOREMAN_ROOT=.*other and FOREMAN_HOME=.*other/);
    assert.match(fs.readFileSync(path.join(base, "rc"), "utf8"), new RegExp(`FOREMAN_HOME='${path.join(base, "home")}'`), "the startup file still points at the new home");
    assert.equal(run({ FOREMAN_ROOT: path.resolve(root), FOREMAN_HOME: path.join(base, "home") }).warning, undefined, "matching values need no warning");
    fs.symlinkSync(path.join(base, "home"), path.join(base, "link"));
    assert.equal(run({ FOREMAN_ROOT: path.resolve(root), FOREMAN_HOME: path.join(base, "link") }).warning, undefined, "a symlink to the same home needs no warning");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
