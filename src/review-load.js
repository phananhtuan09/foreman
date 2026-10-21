const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// How much a task changed in its workspace, so the user can plan the review before reading it.
// Dispatch records the base commit and the paths already dirty; a `done` report measures the change since then.
// Only Git metadata is read for tracked files; an untracked new file has its lines counted.

const GIT_TIMEOUT_MS = 10000;
const UNTRACKED_COUNT_LIMIT = 2 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
}

function nulFields(output) { return output.split("\0").filter(Boolean); }

// `status --porcelain -z` lists one path per entry; a rename or copy carries its source as the next field.
function dirtyPaths(workspace) {
  const fields = nulFields(git(workspace, ["status", "--porcelain=v1", "-z"]));
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    paths.push(entry.slice(3));
    if (/^[RC]/.test(entry)) index += 1;
  }
  return paths;
}

/** The workspace state a task starts from; a failure is recorded instead of blocking dispatch. */
function captureReviewBase(workspace, at) {
  try {
    return { workspace, commit: git(workspace, ["rev-parse", "HEAD"]).trim(), dirty: dirtyPaths(workspace), at };
  } catch (error) {
    return { workspace, commit: null, dirty: [], at, error: String(error.stderr || error.message).trim().split("\n")[0] };
  }
}

function excludedBy(dirty, file) {
  return dirty.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

function untrackedLines(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > UNTRACKED_COUNT_LIMIT) return null;
  const content = fs.readFileSync(file);
  if (content.subarray(0, 8000).includes(0)) return null;
  if (!content.length) return 0;
  const newlines = content.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 0);
  return newlines + (content[content.length - 1] === 10 ? 0 : 1);
}

/**
 * Files and lines changed in the workspace since the base: commits, staged and unstaged edits, and untracked new files.
 * Paths that were already dirty at dispatch are left out and counted; `sharedWith` names live tasks in the same workspace.
 */
function measureReviewLoad({ base, sharedWith = [], at }) {
  if (!base?.commit) return { error: base?.error || "no base commit was recorded at dispatch", at };
  try {
    const workspace = base.workspace;
    const dirty = base.dirty || [];
    let files = 0;
    let insertions = 0;
    let deletions = 0;
    let binary = 0;
    let excluded = 0;
    const tracked = nulFields(git(workspace, ["diff", "--numstat", "--no-renames", "-z", base.commit, "--"]));
    for (const entry of tracked) {
      const [added, removed, file] = entry.split("\t");
      if (excludedBy(dirty, file)) { excluded += 1; continue; }
      files += 1;
      if (added === "-") { binary += 1; continue; }
      insertions += Number(added);
      deletions += Number(removed);
    }
    for (const file of nulFields(git(workspace, ["ls-files", "--others", "--exclude-standard", "-z"]))) {
      if (excludedBy(dirty, file)) { excluded += 1; continue; }
      files += 1;
      const lines = untrackedLines(path.join(workspace, file));
      if (lines === null) binary += 1;
      else insertions += lines;
    }
    return { files, insertions, deletions, binary, excluded, sharedWith, approximate: sharedWith.length > 0, at };
  } catch (error) {
    return { error: String(error.stderr || error.message).trim().split("\n")[0], at };
  }
}

const TEXT = {
  en: { files: (n) => `${n} file${n === 1 ? "" : "s"}`, binary: (n) => `${n} binary`, excluded: (n) => `${n} file${n === 1 ? "" : "s"} already changed before dispatch not counted`, shared: (ids) => `approximate: workspace shared with ${ids}`, error: (reason) => `review size unavailable: ${reason}` },
  vi: { files: (n) => `${n} file`, binary: (n) => `${n} file nhị phân`, excluded: (n) => `không tính ${n} file đã sửa sẵn trước khi giao`, shared: (ids) => `gần đúng: workspace dùng chung với ${ids}`, error: (reason) => `không đo được cỡ thay đổi: ${reason}` },
};

function formatReviewLoad(load, language = "en") {
  if (!load) return null;
  const text = TEXT[language];
  if (load.error) return text.error(load.error);
  const notes = [
    load.binary ? text.binary(load.binary) : null,
    load.excluded ? text.excluded(load.excluded) : null,
    load.sharedWith?.length ? text.shared(load.sharedWith.join(", ")) : null,
  ].filter(Boolean);
  const size = `${text.files(load.files)}, +${load.insertions}/−${load.deletions}`;
  if (!notes.length) return size;
  // Vietnamese status lines already wrap the size in parentheses, so its notes follow a separator instead.
  return language === "vi" ? `${size} · ${notes.join(" · ")}` : `${size} (${notes.join("; ")})`;
}

module.exports = { captureReviewBase, measureReviewLoad, formatReviewLoad };
