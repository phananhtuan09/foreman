const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { atomicWrite, atomicJson, readJson, taskDir, assertSchemaVersion } = require("./coordination");

class AttachmentError extends Error {}

const IMAGE_LIMITS = { maxBytes: 5 * 1024 * 1024, maxCount: 10 };
const INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
// Worker-visible copies live here, relative to the workspace, and are excluded from Git.
const WORKSPACE_DIR = path.join(".foreman", "attachments");
const STAGED_ID = /^A-[0-9a-f]{12}$/;

function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }

// The image type comes from the bytes, never from a file name or a client's claim.
function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

function imageName(image) { return `${image.id}.${IMAGE_TYPES[image.mimeType]}`; }

/**
 * Reads and validates the images given for one request.
 * A source is `{ path }` or `{ buffer }`, with an optional `source` label; the same bytes given twice count once.
 */
function prepareImages(sources) {
  if (sources === undefined || sources === null) return [];
  if (!Array.isArray(sources)) throw new AttachmentError("Images must be a list");
  const prepared = [];
  for (const item of sources) {
    let buffer;
    if (Buffer.isBuffer(item?.buffer)) buffer = item.buffer;
    else if (typeof item?.path === "string" && item.path) {
      try { buffer = fs.readFileSync(item.path); }
      catch (error) { throw new AttachmentError(`Image cannot be read: ${item.path}: ${error.code || error.message}`); }
    } else throw new AttachmentError("An image needs a file path or its bytes");
    const label = item.path || "pasted image";
    const mimeType = sniffImage(buffer);
    if (!mimeType) throw new AttachmentError(`Not a PNG, JPEG, GIF, or WebP image: ${label}`);
    if (buffer.length > IMAGE_LIMITS.maxBytes) throw new AttachmentError(`Image is larger than ${IMAGE_LIMITS.maxBytes} bytes: ${label}`);
    const digest = sha256(buffer);
    if (prepared.some((image) => image.sha256 === digest)) continue;
    prepared.push({ id: `A-${digest.slice(0, 12)}`, sha256: digest, mimeType, bytes: buffer.length, source: item.source || (item.path ? "file" : "pasted"), buffer });
  }
  if (prepared.length > IMAGE_LIMITS.maxCount) throw new AttachmentError(`At most ${IMAGE_LIMITS.maxCount} images can travel with one request`);
  return prepared;
}

function attachmentsDir(home, taskId) { return path.join(taskDir(home, taskId), "attachments"); }
function manifestFile(home, taskId) { return path.join(taskDir(home, taskId), "attachments.json"); }
function taskImageFile(home, taskId, image) { return path.join(attachmentsDir(home, taskId), imageName(image)); }

function readManifest(home, taskId) {
  const file = manifestFile(home, taskId);
  if (!fs.existsSync(file)) return { schemaVersion: 1, taskId, images: [], brief: [] };
  const manifest = assertSchemaVersion(readJson(file), "Attachment manifest", { field: "taskId", value: taskId });
  if (!Array.isArray(manifest.images) || !Array.isArray(manifest.brief)) throw new AttachmentError(`Attachment manifest is invalid: ${taskId}`);
  return manifest;
}

// The reference that task records and messages carry; the bytes stay in the task directory.
function imageRef(image) { return { id: image.id, sha256: image.sha256, mimeType: image.mimeType, bytes: image.bytes }; }

/** Persists prepared images under the task record and returns their references. */
function storeTaskImagesUnlocked({ roots, taskId, images }) {
  if (!images?.length) return [];
  const manifest = readManifest(roots.foremanHome, taskId);
  for (const image of images) {
    const file = taskImageFile(roots.foremanHome, taskId, image);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== image.sha256) atomicWrite(file, image.buffer);
    if (!manifest.images.some((item) => item.id === image.id)) manifest.images.push({ ...imageRef(image), source: image.source, createdAt: new Date().toISOString() });
  }
  atomicJson(manifestFile(roots.foremanHome, taskId), manifest);
  return images.map(imageRef);
}

// Round one's images; `task create` sets them and `task brief` may replace them.
function setBriefImagesUnlocked({ roots, taskId, refs }) {
  const manifest = readManifest(roots.foremanHome, taskId);
  atomicJson(manifestFile(roots.foremanHome, taskId), { ...manifest, brief: refs.map((ref) => ref.id) });
}

function briefImages(roots, taskId) {
  const manifest = readManifest(roots.foremanHome, taskId);
  return manifest.brief.map((id) => {
    const image = manifest.images.find((item) => item.id === id);
    if (!image) throw new AttachmentError(`Attachment manifest lists an unknown brief image: ${id}`);
    return imageRef(image);
  });
}

function storedImage(roots, taskId, ref) {
  const file = taskImageFile(roots.foremanHome, taskId, ref);
  if (!fs.existsSync(file)) throw new AttachmentError(`Task image is missing: ${ref.id}`);
  const buffer = fs.readFileSync(file);
  if (sha256(buffer) !== ref.sha256) throw new AttachmentError(`Task image does not match its digest: ${ref.id}`);
  return { file, buffer };
}

// One local exclude line keeps worker-visible copies out of commits without touching tracked files.
function ensureGitExclude(workspace) {
  let top;
  let exclude;
  try {
    top = execFileSync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    exclude = execFileSync("git", ["-C", workspace, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) { throw new AttachmentError(`Workspace Git exclude cannot be resolved: ${error.message}`); }
  if (!path.isAbsolute(exclude)) exclude = path.resolve(workspace, exclude);
  const relative = path.relative(fs.realpathSync(top), fs.realpathSync(workspace)).split(path.sep).join("/");
  const line = `/${relative ? `${relative}/` : ""}.foreman/`;
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  if (current.split(/\r?\n/).includes(line)) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.writeFileSync(exclude, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`);
}

function workspaceImageDir(workspace, taskId) { return path.join(workspace, WORKSPACE_DIR, taskId); }

/**
 * Copies task images into the worker's workspace and returns references with their workspace path.
 * The workspace is the one place both Herdr and Paseo workers can read without touching Foreman's data.
 */
function materializeImagesUnlocked({ roots, taskId, workspace, vcs = "git", refs }) {
  if (!refs?.length) return [];
  if (!workspace) throw new AttachmentError("Images need an assigned workspace");
  if (vcs === "git") ensureGitExclude(workspace);
  const dir = workspaceImageDir(workspace, taskId);
  fs.mkdirSync(dir, { recursive: true });
  return refs.map((ref) => {
    const { buffer } = storedImage(roots, taskId, ref);
    const target = path.join(dir, imageName(ref));
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== ref.sha256) atomicWrite(target, buffer, { mode: 0o644 });
    return { ...imageRef(ref), path: target };
  });
}

// What a runtime that accepts inline images needs: the stored file and the digest to verify it against.
function transportImages(roots, taskId, refs) {
  return (refs || []).map((ref) => ({ id: ref.id, sha256: ref.sha256, mimeType: ref.mimeType, file: taskImageFile(roots.foremanHome, taskId, ref) }));
}

/** Removes the worker-visible copies of a task; failures are returned, never thrown. */
function removeWorkspaceImages({ workspace, taskId }) {
  if (!workspace) return null;
  try {
    fs.rmSync(workspaceImageDir(workspace, taskId), { recursive: true, force: true });
    for (const dir of [path.join(workspace, WORKSPACE_DIR), path.join(workspace, ".foreman")]) {
      if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
    }
    return null;
  } catch (error) { return error.message; }
}

function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(value || ""));
  return match ? Buffer.from(match[2], "base64") : null;
}

function readTranscriptLines(transcriptPath) {
  let text;
  try { text = fs.readFileSync(transcriptPath, "utf8"); }
  catch (error) { throw new AttachmentError(`Session transcript cannot be read: ${transcriptPath}: ${error.code || error.message}`); }
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { lines.push(JSON.parse(line)); } catch (_) {}
  }
  return lines;
}

function claudeImages(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "image" && block.source?.type === "base64" && block.source.data)
    .map((block) => ({ buffer: Buffer.from(block.source.data, "base64"), source: "pasted" }));
}

// Claude Code: a human prompt is a `user` entry without a tool result; one prompt may span entries that share its promptId.
function claudePromptImages(lines) {
  const entries = lines.filter((line) => line?.type === "user" && line.message?.role === "user" && !line.toolUseResult && !line.isMeta && !line.isSidechain
    && !(Array.isArray(line.message.content) && line.message.content.length && line.message.content.every((block) => block?.type === "tool_result")));
  if (!entries.length) return null;
  const human = entries.filter((line) => line.origin?.kind === "human");
  // Without origin fields, the interruption notice Claude Code writes as a user entry is not a prompt.
  const firstText = (content) => (typeof content === "string" ? content : (Array.isArray(content) ? content.find((block) => block?.type === "text")?.text : "") || "");
  const latest = (human.length ? human : entries.filter((line) => !/^\[Request interrupted/.test(firstText(line.message.content)))).at(-1);
  if (!latest) return null;
  const prompt = latest.promptId ? entries.filter((line) => line.promptId === latest.promptId) : [latest];
  return { at: latest.timestamp || null, images: prompt.flatMap((line) => claudeImages(line.message.content)) };
}

// Codex: the user's own input is the `user_message` event; older rollouts only have the user `message` item.
function codexPromptImages(lines) {
  const items = lines.map((line) => (line?.payload && typeof line.payload === "object" ? { ...line.payload, at: line.timestamp } : line));
  const event = items.filter((item) => item?.type === "user_message").at(-1);
  if (event) {
    const images = [];
    for (const url of event.images || []) {
      const buffer = decodeDataUrl(url);
      if (buffer) images.push({ buffer, source: "pasted" });
    }
    for (const file of event.local_images || []) images.push({ path: String(typeof file === "object" ? file.path : file), source: "pasted" });
    return { at: event.at || null, images };
  }
  const message = items.filter((item) => item?.type === "message" && item.role === "user" && Array.isArray(item.content)
    && !item.content.some((part) => typeof part?.text === "string" && /^\s*<(environment_context|user_instructions)>/.test(part.text))).at(-1);
  if (!message) return null;
  return { at: message.at || null, images: message.content.filter((part) => part?.type === "input_image").map((part) => ({ buffer: decodeDataUrl(part.image_url), source: "pasted" })).filter((image) => image.buffer) };
}

/** The images of the user's latest prompt in a Claude Code or Codex session transcript. */
function readTranscriptImages(transcriptPath) {
  const lines = readTranscriptLines(transcriptPath);
  const prompt = claudePromptImages(lines) || codexPromptImages(lines);
  if (!prompt) throw new AttachmentError(`No user prompt found in the session transcript: ${transcriptPath}`);
  if (!prompt.images.length) throw new AttachmentError("The user's latest message has no image");
  return prompt;
}

function inboxDir(home) { return path.join(home, "data", "inbox"); }
function sessionFile(home) { return path.join(home, "data", "sessions", "current.json"); }

// The prompt hook records where the Foreman session keeps its transcript, so `image stage` can find pasted images.
function recordSession({ roots, sessionId, transcriptPath, cwd }) {
  if (!transcriptPath) return null;
  const record = { schemaVersion: 1, sessionId: sessionId || null, transcriptPath: String(transcriptPath), cwd: cwd || null, at: new Date().toISOString() };
  atomicJson(sessionFile(roots.foremanHome), record);
  return record;
}

function pruneInbox(home) {
  const dir = inboxDir(home);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try { if (Date.now() - fs.statSync(file).mtimeMs > INBOX_RETENTION_MS) fs.unlinkSync(file); } catch (_) {}
  }
}

/**
 * Copies the images of the user's latest prompt into the Foreman inbox and returns their IDs.
 * It runs in the turn the user pasted them, before the user confirms the request that carries them.
 */
function stageImages({ roots, transcriptPath }) {
  let transcript = transcriptPath;
  if (!transcript) {
    const file = sessionFile(roots.foremanHome);
    if (!fs.existsSync(file)) throw new AttachmentError("No Foreman session transcript is recorded; the session prompt hook has not run, so pass --transcript or --image PATH");
    transcript = assertSchemaVersion(readJson(file), "Session record").transcriptPath;
  }
  const prompt = readTranscriptImages(transcript);
  const images = prepareImages(prompt.images);
  pruneInbox(roots.foremanHome);
  for (const image of images) {
    const file = path.join(inboxDir(roots.foremanHome), imageName(image));
    if (!fs.existsSync(file)) atomicWrite(file, image.buffer);
  }
  return { transcript, promptAt: prompt.at, images: images.map(imageRef) };
}

/** Turns `--image` values into image sources: a staged ID from the inbox, or a file path. */
function resolveImageArgs({ roots, values, cwd = process.cwd() }) {
  return (values || []).map((value) => {
    if (STAGED_ID.test(value)) {
      const dir = inboxDir(roots.foremanHome);
      const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((item) => item.startsWith(`${value}.`)) : null;
      if (!name) throw new AttachmentError(`Staged image not found: ${value}; stage it again with image stage`);
      return { path: path.join(dir, name), source: "pasted" };
    }
    return { path: path.resolve(cwd, value), source: "file" };
  });
}

module.exports = {
  AttachmentError, IMAGE_LIMITS, WORKSPACE_DIR,
  sniffImage, prepareImages, storeTaskImagesUnlocked, setBriefImagesUnlocked, briefImages, readManifest, taskImageFile,
  materializeImagesUnlocked, transportImages, removeWorkspaceImages, ensureGitExclude,
  readTranscriptImages, recordSession, stageImages, resolveImageArgs,
};
