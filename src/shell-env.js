const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BEGIN = "# >>> foreman >>>";
const END = "# <<< foreman <<<";

class ShellEnvError extends Error {}

function loginShell(env) {
  if (env.SHELL) return env.SHELL;
  try { return os.userInfo().shell || ""; } catch (_) { return ""; }
}

/** The startup file a new interactive shell of this machine reads, or null when the shell is unrecognized. */
function detectShellStartupFile({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.FOREMAN_SHELL_RC) {
    const file = path.resolve(env.FOREMAN_SHELL_RC);
    return { shell: "override", file, syntax: file.endsWith(".fish") ? "fish" : "posix" };
  }
  const shell = path.basename(loginShell(env));
  if (shell === "zsh") return { shell, file: path.join(env.ZDOTDIR || home, ".zshrc"), syntax: "posix" };
  // macOS terminals start bash as a login shell, which reads .bash_profile instead of .bashrc.
  if (shell === "bash") return { shell, file: path.join(home, platform === "darwin" ? ".bash_profile" : ".bashrc"), syntax: "posix" };
  if (shell === "fish") return { shell, file: path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "fish", "conf.d", "foreman.fish"), syntax: "fish" };
  if (["sh", "dash", "ksh", "mksh"].includes(shell)) return { shell, file: path.join(home, ".profile"), syntax: "posix" };
  return null;
}

function quote(value) { return `'${String(value).replace(/'/g, "'\\''")}'`; }

function envBlock(vars, syntax) {
  const lines = Object.entries(vars).map(([key, value]) => syntax === "fish" ? `set -gx ${key} ${quote(value)}` : `export ${key}=${quote(value)}`);
  return [BEGIN, ...lines, END].join("\n");
}

/**
 * Adds or refreshes the Foreman block in the shell startup file.
 * The file is rewritten in place so symlinked dotfiles keep their link.
 */
function installShellEnv({ vars, env = process.env, platform = process.platform, home = os.homedir() }) {
  const target = detectShellStartupFile({ env, platform, home });
  if (!target) {
    const manual = Object.entries(vars).map(([key, value]) => `export ${key}=${quote(value)}`).join("\n");
    throw new ShellEnvError(`Cannot identify the login shell (${loginShell(env) || "unset"}); add these lines to your shell startup file:\n${manual}`);
  }
  const block = envBlock(vars, target.syntax);
  const current = fs.existsSync(target.file) ? fs.readFileSync(target.file, "utf8") : "";
  const pattern = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  let next;
  if (pattern.test(current)) next = current.replace(pattern, block);
  else next = `${current}${current && !current.endsWith("\n") ? "\n" : ""}${current ? "\n" : ""}${block}\n`;
  if (next === current) return { ...target, changed: false, vars };
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, next);
  return { ...target, changed: true, vars };
}

module.exports = { ShellEnvError, detectShellStartupFile, installShellEnv };
