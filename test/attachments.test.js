const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const core = require("../src/foreman");
const coordination = require("../src/coordination");
const attachments = require("../src/attachments");

const {
  resolveRoots, initHome, registerProject, createTask, assignTask, recordReport, continueTask, reassignWorker, replaceTaskBrief,
  sendWorkerMessage, createDecision, answerDecision, deliverDecision, acceptTask, discardTask, recoverDeadWorker, sessionContext, HerdrAdapter,
} = core;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (label) => Buffer.concat([PNG, Buffer.from(String(label))]);
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(String(label))]);
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function gitRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-b", "main", dir], { stdio: "pipe" });
  execFileSync("git", ["-C", dir, "config", "user.email", "images@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Foreman Images"]);
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["-C", dir, "add", "README.md"]);
  execFileSync("git", ["-C", dir, "commit", "-m", "fixture"], { stdio: "pipe" });
}

function fixture({ git = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-images-"));
  const project = path.join(base, "project");
  if (git) gitRepo(project);
  else fs.mkdirSync(project, { recursive: true });
  const roots = resolveRoots({ foremanRoot: project, foremanHome: path.join(base, "home") });
  initHome(roots);
  registerProject({ roots, id: "app", root: project });
  const workers = new Map();
  const sent = [];
  const state = { spawned: 0, failSend: false };
  const transport = {
    verifyCompatibility: () => ({ compatible: true, protocol: 22, endpointProtocolGeneration: 1 }),
    capabilities: () => ({ agentKind: true, tool: true, command: true, model: true, reasoningEffort: true }),
    spawn(request) {
      state.spawned += 1;
      const endpoint = `worker-${state.spawned}`;
      workers.set(endpoint, { ...request, endpoint, paneId: `w1:p${state.spawned}`, status: "working" });
      return { endpoint, paneId: `w1:p${state.spawned}` };
    },
    inspect(endpoint) { return workers.get(endpoint) || { endpoint, status: "missing" }; },
    list() { return [...workers.values()]; },
    // Herdr delivery is text only; the transport sees nothing but the prompt.
    send(...callArgs) {
      if (state.failSend) return { delivered: false };
      sent.push({ endpoint: callArgs[0], text: callArgs[1], argCount: callArgs.length });
      return workers.has(callArgs[0]) ? { delivered: true } : { delivered: false };
    },
    interrupt(endpoint) { const worker = workers.get(endpoint); if (worker) worker.status = "idle"; return { interrupted: true }; },
    stop(endpoint) { workers.delete(endpoint); return { stopped: true }; },
  };
  const writeImage = (name, buffer) => { const file = path.join(base, name); fs.writeFileSync(file, buffer); return file; };
  return {
    base, project, roots, workers, sent, state, writeImage, adapter: new HerdrAdapter({ transport }),
    meta(taskId) { return JSON.parse(fs.readFileSync(path.join(roots.foremanHome, "data", "tasks", taskId, "meta.json"), "utf8")); },
    taskFile(taskId, ...parts) { return path.join(roots.foremanHome, "data", "tasks", taskId, ...parts); },
    workspaceImages(taskId) { return path.join(project, ".foreman", "attachments", taskId); },
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function dispatch(f, options = {}) {
  const { brief = "build it", owner = "worker", ...rest } = options;
  const task = createTask({ roots: f.roots, projectId: "app", brief, ...rest });
  const assignment = assignTask({ roots: f.roots, taskId: task.id, owner, adapter: f.adapter });
  return { task, assignment };
}

// The worker reports and its turn ends, as a real Herdr worker would.
function report(f, assignment, status, summary) {
  const recorded = recordReport({ roots: f.roots, paneId: assignment.paneId, status, summary });
  const worker = f.workers.get(assignment.endpoint);
  if (worker) worker.status = "idle";
  return recorded;
}

test("images are validated by their bytes, limited, and deduplicated", () => {
  const f = fixture();
  try {
    assert.equal(attachments.sniffImage(png(1)), "image/png");
    assert.equal(attachments.sniffImage(jpeg(1)), "image/jpeg");
    assert.equal(attachments.sniffImage(Buffer.from("GIF89a....")), "image/gif");
    assert.equal(attachments.sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
    assert.equal(attachments.sniffImage(Buffer.from("%PDF-1.7")), null);
    const renamed = f.writeImage("looks-like.png", Buffer.from("%PDF-1.7 not an image"));
    assert.throws(() => createTask({ roots: f.roots, projectId: "app", brief: "x", images: [{ path: renamed }] }), (error) => error instanceof core.ValidationError && /Not a PNG/.test(error.message));
    const large = Buffer.concat([PNG, Buffer.alloc(attachments.IMAGE_LIMITS.maxBytes)]);
    assert.throws(() => createTask({ roots: f.roots, projectId: "app", brief: "x", images: [{ buffer: large }] }), /larger than/);
    const many = Array.from({ length: attachments.IMAGE_LIMITS.maxCount + 1 }, (_, index) => ({ buffer: png(index) }));
    assert.throws(() => createTask({ roots: f.roots, projectId: "app", brief: "x", images: many }), /At most/);
    assert.throws(() => createTask({ roots: f.roots, projectId: "app", brief: "x", images: [{ path: path.join(f.base, "missing.png") }] }), /cannot be read/);
    // A rejected image stores no task.
    assert.deepEqual(fs.readdirSync(path.join(f.roots.foremanHome, "data", "tasks")), []);
    const task = createTask({ roots: f.roots, projectId: "app", brief: "x", images: [{ buffer: png("a") }, { buffer: png("a") }, { path: f.writeImage("b.jpg", jpeg("b")) }] });
    assert.equal(task.attachments.length, 2);
    const manifest = JSON.parse(fs.readFileSync(f.taskFile(task.id, "attachments.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(manifest.brief, task.attachments.map((image) => image.id));
    assert.deepEqual(manifest.images.map((image) => image.source), ["pasted", "file"]);
    for (const image of task.attachments) {
      assert.match(image.id, /^A-[0-9a-f]{12}$/);
      assert.equal(sha(fs.readFileSync(attachments.taskImageFile(f.roots.foremanHome, task.id, image))), image.sha256);
    }
  } finally { f.cleanup(); }
});

test("round-one images reach a Herdr worker as workspace files that Git ignores", () => {
  const f = fixture();
  try {
    const { task } = dispatch(f, { images: [{ buffer: png("mockup") }] });
    const [image] = task.attachments;
    const copy = path.join(f.workspaceImages(task.id), `${image.id}.png`);
    assert.equal(sha(fs.readFileSync(copy)), image.sha256);
    const exclude = fs.readFileSync(path.join(f.project, ".git", "info", "exclude"), "utf8");
    assert.match(exclude, /^\/\.foreman\/$/m);
    assert.equal(execFileSync("git", ["-C", f.project, "status", "--porcelain"], { encoding: "utf8" }), "");
    const [prompt] = f.sent;
    assert.equal(prompt.argCount, 2);
    assert.match(prompt.text, /## User request\nbuild it\n\n## Images for this request\nOpen each image before you act on this; the user sent them with it\.\n- .*\.foreman\/attachments\/T-\d+\/A-[0-9a-f]{12}\.png\n/);
    assert.ok(prompt.text.includes(copy));
    const message = coordination.listMessages({ roots: f.roots }).find((item) => item.kind === "task-brief");
    assert.deepEqual(message.payload.images, [{ ...image, path: copy }]);
    // A second dispatch adds the exclude line once.
    report(f, f.meta(task.id), "done", "built");
    acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    dispatch(f, { owner: "second", images: [{ buffer: png("other") }] });
    assert.equal(fs.readFileSync(path.join(f.project, ".git", "info", "exclude"), "utf8").match(/^\/\.foreman\/$/gm).length, 1);
  } finally { f.cleanup(); }
});

test("a message without images keeps the prompt and payload it had before", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    assert.doesNotMatch(f.sent[0].text, /Images/);
    assert.equal(fs.existsSync(f.taskFile(task.id, "attachments.json")), false);
    assert.equal(fs.existsSync(path.join(f.project, ".foreman")), false);
    report(f, assignment, "done", "built");
    const continued = continueTask({ roots: f.roots, taskId: task.id, text: "add tests", original: "thêm test", adapter: f.adapter });
    assert.equal("images" in continued.round, false);
    assert.equal("images" in continued.message.payload, false);
    assert.doesNotMatch(f.sent.at(-1).text, /Images/);
    const messaged = sendWorkerMessage({ roots: f.roots, taskId: task.id, payload: { request: "status?" }, adapter: f.adapter });
    assert.equal("attachments" in messaged, false);
    assert.equal(f.sent.at(-1).text, coordination.deliveryPrompt({ ...messaged.message, payload: { request: "status?", backend: "herdr" } }));
  } finally { f.cleanup(); }
});

test("later rounds, messages, and decision answers carry their own images", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "built");
    const continued = continueTask({ roots: f.roots, taskId: task.id, text: "match this layout", original: "giống ảnh này", images: [{ buffer: png("layout") }], adapter: f.adapter });
    const roundImage = continued.round.images[0];
    const roundFile = JSON.parse(fs.readFileSync(coordination.roundFile(f.roots.foremanHome, task.id, 2), "utf8"));
    assert.deepEqual(roundFile.images, [roundImage]);
    assert.match(f.sent.at(-1).text, /## User request \(round 2\)\nmatch this layout\n\n## Images for this request \(round 2\)\n/);
    assert.ok(f.sent.at(-1).text.includes(path.join(f.workspaceImages(task.id), `${roundImage.id}.png`)));

    const messaged = sendWorkerMessage({ roots: f.roots, taskId: task.id, payload: { request: "also this error" }, images: [{ buffer: png("error") }], adapter: f.adapter });
    assert.equal(messaged.attachments.length, 1);
    assert.match(f.sent.at(-1).text, /also this error\n\n## Images\n/);

    const decision = createDecision({ roots: f.roots, taskId: task.id, finding: "two layouts", why: "user taste", options: ["A", "B"] });
    const answered = answerDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, response: "like this one", images: [{ buffer: png("choice") }] });
    assert.equal(answered.images.length, 1);
    deliverDecision({ roots: f.roots, taskId: task.id, decisionId: decision.decisionId, adapter: f.adapter });
    assert.match(f.sent.at(-1).text, /like this one\n\n## Images\n/);
    assert.ok(fs.existsSync(path.join(f.workspaceImages(task.id), `${answered.images[0].id}.png`)));
  } finally { f.cleanup(); }
});

test("a round that fails to deliver keeps its images as evidence", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f);
    report(f, assignment, "done", "built");
    f.state.failSend = true;
    assert.throws(() => continueTask({ roots: f.roots, taskId: task.id, text: "fix the header", original: "sửa header", images: [{ buffer: png("header") }], adapter: f.adapter }), /delivery failed/);
    const record = JSON.parse(fs.readFileSync(coordination.roundFile(f.roots.foremanHome, task.id, 2), "utf8"));
    assert.equal(record.status, "failed");
    assert.equal(record.images.length, 1);
    assert.ok(fs.existsSync(attachments.taskImageFile(f.roots.foremanHome, task.id, record.images[0])));
    const failed = coordination.listMessages({ roots: f.roots }).find((message) => message.kind === "task-update");
    assert.equal(failed.status, "failed");
    assert.equal(failed.payload.images.length, 1);
  } finally { f.cleanup(); }
});

test("a replacement worker sees the images of every earlier round", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { images: [{ buffer: png("round-1") }] });
    report(f, assignment, "done", "built");
    const continued = continueTask({ roots: f.roots, taskId: task.id, text: "round two", original: "vòng hai", images: [{ buffer: png("round-2") }], adapter: f.adapter });
    report(f, assignment, "done", "round two done");
    const reassigned = reassignWorker({ roots: f.roots, taskId: task.id, adapter: f.adapter, owner: "successor", text: "round three", original: "vòng ba", images: [{ buffer: png("round-3") }] });
    assert.equal(reassigned.roundRecord.images.length, 1);
    const prompt = f.sent.at(-1).text;
    const dir = f.workspaceImages(task.id);
    assert.match(prompt, /## User request\nbuild it\n\n## Images for this request\n/);
    assert.ok(prompt.includes(path.join(dir, `${task.attachments[0].id}.png`)));
    assert.match(prompt, /images: \n\s+- .*\.png/);
    assert.ok(prompt.includes(path.join(dir, `${continued.round.images[0].id}.png`)));
    assert.match(prompt, /## User request \(round 3\)\nround three\n\n## Images for this request \(round 3\)\n/);
    assert.ok(prompt.includes(path.join(dir, `${reassigned.roundRecord.images[0].id}.png`)));
    // The stored handoff keeps references; only the delivered prompt names files.
    const stored = JSON.parse(fs.readFileSync(f.taskFile(task.id, "handoff.json"), "utf8"));
    assert.equal(stored.rounds[0].images[0].sha256, continued.round.images[0].sha256);
    assert.equal(stored.nextRequest.images[0].id, reassigned.roundRecord.images[0].id);
    assert.throws(() => reassignWorker({ roots: f.roots, taskId: task.id, adapter: f.adapter, images: [{ buffer: png("x") }] }), /pass --text/);
  } finally { f.cleanup(); }
});

test("recovery restores the images in the workspace for the successor", () => {
  const f = fixture();
  try {
    const { task, assignment } = dispatch(f, { images: [{ buffer: png("first") }] });
    fs.rmSync(path.join(f.project, ".foreman"), { recursive: true, force: true });
    f.workers.delete(assignment.endpoint);
    recoverDeadWorker({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.ok(fs.existsSync(path.join(f.workspaceImages(task.id), `${task.attachments[0].id}.png`)));
    assert.match(f.sent.at(-1).text, /## Images for this request\n/);
  } finally { f.cleanup(); }
});

test("task brief can replace round-one images before dispatch", () => {
  const f = fixture();
  try {
    const task = createTask({ roots: f.roots, projectId: "app", brief: "first", images: [{ buffer: png("old") }] });
    replaceTaskBrief({ roots: f.roots, taskId: task.id, text: "second" });
    assert.deepEqual(attachments.briefImages(f.roots, task.id), task.attachments);
    const replaced = replaceTaskBrief({ roots: f.roots, taskId: task.id, text: "third", images: [{ buffer: png("new") }] });
    assert.deepEqual(attachments.briefImages(f.roots, task.id), replaced.attachments);
    assert.notEqual(replaced.attachments[0].id, task.attachments[0].id);
  } finally { f.cleanup(); }
});

test("acceptance and discard remove the workspace copies of a task", () => {
  const f = fixture();
  try {
    // Two read-only tasks share the workspace, so each must remove only its own images.
    const kept = dispatch(f, { owner: "kept", type: "scout", images: [{ buffer: png("kept") }] });
    const { task, assignment } = dispatch(f, { type: "scout", images: [{ buffer: png("shown") }] });
    report(f, assignment, "done", "done");
    const accepted = acceptTask({ roots: f.roots, taskId: task.id, adapter: f.adapter });
    assert.equal(accepted.imageCleanupError, undefined);
    assert.equal(fs.existsSync(f.workspaceImages(task.id)), false);
    assert.ok(fs.existsSync(f.workspaceImages(kept.task.id)));
    f.workers.delete(kept.assignment.endpoint);
    discardTask({ roots: f.roots, taskId: kept.task.id, adapter: f.adapter });
    assert.equal(fs.existsSync(path.join(f.project, ".foreman")), false);
    assert.equal(execFileSync("git", ["-C", f.project, "status", "--porcelain"], { encoding: "utf8" }), "");
  } finally { f.cleanup(); }
});

test("a project without Git gets the images and no exclude file", () => {
  const f = fixture({ git: false });
  try {
    const { task } = dispatch(f, { images: [{ buffer: png("plain") }] });
    assert.ok(fs.existsSync(path.join(f.workspaceImages(task.id), `${task.attachments[0].id}.png`)));
    assert.equal(fs.existsSync(path.join(f.project, ".git")), false);
  } finally { f.cleanup(); }
});

test("the exclude line follows a workspace inside a Git worktree", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-images-worktree-"));
  try {
    const repo = path.join(base, "repo");
    gitRepo(repo);
    const worktree = path.join(base, "tree");
    execFileSync("git", ["-C", repo, "worktree", "add", "-b", "feature", worktree], { stdio: "pipe" });
    attachments.ensureGitExclude(worktree);
    const exclude = execFileSync("git", ["-C", worktree, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
    assert.match(fs.readFileSync(path.resolve(worktree, exclude), "utf8"), /^\/\.foreman\/$/m);
    fs.mkdirSync(path.join(worktree, ".foreman", "attachments"), { recursive: true });
    fs.writeFileSync(path.join(worktree, ".foreman", "attachments", "x.png"), png("x"));
    assert.equal(execFileSync("git", ["-C", worktree, "status", "--porcelain"], { encoding: "utf8" }), "");
    const nested = path.join(repo, "packages", "web");
    fs.mkdirSync(nested, { recursive: true });
    attachments.ensureGitExclude(nested);
    assert.match(fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8"), /^\/packages\/web\/\.foreman\/$/m);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

function claudeTranscript(file, entries) {
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return file;
}

const claudeImage = (buffer, mediaType = "image/png") => ({ type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } });

test("pasted images are read from the latest prompt of a Claude Code transcript", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-transcript-"));
  try {
    const old = png("old");
    const fresh = png("fresh");
    const second = jpeg("second");
    const file = claudeTranscript(path.join(base, "claude.jsonl"), [
      { type: "user", promptId: "p1", origin: { kind: "human" }, timestamp: "2026-10-09T01:00:00Z", message: { role: "user", content: [{ type: "text", text: "old" }, claudeImage(old)] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      { type: "user", promptId: "p2", origin: { kind: "human" }, timestamp: "2026-10-09T02:00:00Z", message: { role: "user", content: [{ type: "text", text: "match this" }, claudeImage(fresh)] } },
      { type: "user", promptId: "p2", message: { role: "user", content: [claudeImage(second, "image/jpeg")] } },
      // Tool results, including an image a tool read, are not the user's prompt.
      { type: "user", promptId: "p2", toolUseResult: {}, message: { role: "user", content: [{ type: "tool_result", content: [claudeImage(png("tool"))] }] } },
      { type: "user", isMeta: true, message: { role: "user", content: [claudeImage(png("meta"))] } },
    ]);
    const prompt = attachments.readTranscriptImages(file);
    assert.equal(prompt.at, "2026-10-09T02:00:00Z");
    assert.deepEqual(prompt.images.map((image) => sha(image.buffer)), [sha(fresh), sha(second)]);
    const noImage = claudeTranscript(path.join(base, "plain.jsonl"), [
      { type: "user", promptId: "p1", origin: { kind: "human" }, message: { role: "user", content: [claudeImage(old)] } },
      { type: "user", promptId: "p2", origin: { kind: "human" }, message: { role: "user", content: "ok send it" } },
    ]);
    assert.throws(() => attachments.readTranscriptImages(noImage), /latest message has no image/);
    // Without origin fields, an interruption notice is not the latest prompt.
    const legacy = claudeTranscript(path.join(base, "legacy.jsonl"), [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "see" }, claudeImage(fresh)] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
    ]);
    assert.deepEqual(attachments.readTranscriptImages(legacy).images.map((image) => sha(image.buffer)), [sha(fresh)]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("pasted images are read from the latest prompt of a Codex rollout", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-rollout-"));
  try {
    const pasted = png("codex");
    const local = path.join(base, "local.png");
    fs.writeFileSync(local, png("local"));
    const dataUrl = `data:image/png;base64,${pasted.toString("base64")}`;
    const rollout = claudeTranscript(path.join(base, "rollout.jsonl"), [
      { timestamp: "t0", type: "session_meta", payload: { id: "s1" } },
      { timestamp: "t1", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
      { timestamp: "t2", type: "event_msg", payload: { type: "user_message", message: "old", images: [] } },
      { timestamp: "t3", type: "event_msg", payload: { type: "user_message", message: "this one", images: [dataUrl], local_images: [local] } },
    ]);
    const prompt = attachments.readTranscriptImages(rollout);
    assert.equal(prompt.at, "t3");
    assert.deepEqual(attachments.prepareImages(prompt.images).map((image) => image.sha256), [sha(pasted), sha(png("local"))]);
    const legacy = claudeTranscript(path.join(base, "legacy.jsonl"), [
      { type: "message", role: "user", content: [{ type: "input_text", text: "look" }, { type: "input_image", image_url: dataUrl }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "<user_instructions>x</user_instructions>" }] },
    ]);
    assert.deepEqual(attachments.readTranscriptImages(legacy).images.map((image) => sha(image.buffer)), [sha(pasted)]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("the prompt hook records the transcript and image stage turns pasted images into IDs", () => {
  const f = fixture();
  try {
    const pasted = png("pasted");
    const transcript = claudeTranscript(path.join(f.base, "session.jsonl"), [
      { type: "user", promptId: "p1", origin: { kind: "human" }, timestamp: "now", message: { role: "user", content: [{ type: "text", text: "fix this" }, claudeImage(pasted)] } },
    ]);
    sessionContext({ roots: f.roots, prompt: "fix this", cwd: f.project, transcriptPath: transcript, sessionId: "s-1" });
    const recorded = JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "sessions", "current.json"), "utf8"));
    assert.equal(recorded.transcriptPath, transcript);
    assert.equal(recorded.sessionId, "s-1");
    sessionContext({ roots: f.roots, prompt: "DEV change foreman", cwd: f.project, transcriptPath: "/elsewhere.jsonl" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.roots.foremanHome, "data", "sessions", "current.json"), "utf8")).transcriptPath, transcript);

    const staged = core.stageImages({ roots: f.roots });
    assert.equal(staged.images.length, 1);
    assert.equal(staged.images[0].sha256, sha(pasted));
    const sources = core.resolveImageArgs({ roots: f.roots, values: [staged.images[0].id, "relative.png"], cwd: f.base });
    assert.deepEqual(sources[1], { path: path.join(f.base, "relative.png"), source: "file" });
    const task = createTask({ roots: f.roots, projectId: "app", brief: "fix", images: [sources[0]] });
    assert.equal(task.attachments[0].sha256, sha(pasted));
    assert.throws(() => core.resolveImageArgs({ roots: f.roots, values: ["A-000000000000"] }), /Staged image not found/);
  } finally { f.cleanup(); }
});

test("the CLI stages images and attaches them to a task", () => {
  const f = fixture();
  try {
    const bin = path.join(__dirname, "..", "bin", "foreman");
    fs.mkdirSync(path.join(f.project, "config"), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "../config/model-routing.json"), path.join(f.project, "config", "model-routing.json"));
    const env = { ...process.env, FOREMAN_ROOT: f.roots.foremanRoot, FOREMAN_HOME: f.roots.foremanHome, FOREMAN_BACKEND: "herdr" };
    const transcript = claudeTranscript(path.join(f.base, "cli.jsonl"), [
      { type: "user", promptId: "p1", origin: { kind: "human" }, message: { role: "user", content: [claudeImage(png("cli"))] } },
    ]);
    const staged = JSON.parse(execFileSync(process.execPath, [bin, "image", "stage", "--transcript", transcript], { env, encoding: "utf8" }));
    const file = f.writeImage("drop.jpg", jpeg("drop"));
    const created = JSON.parse(execFileSync(process.execPath, [bin, "task", "create", "--project", "app", "--brief", "fix", "--image", staged.images[0].id, "--image", file], { env, encoding: "utf8" }));
    assert.deepEqual(created.attachments.map((image) => image.mimeType), ["image/png", "image/jpeg"]);
    assert.match(execFileSync(process.execPath, [bin, "help"], { encoding: "utf8" }), /image stage/);
  } finally { f.cleanup(); }
});
