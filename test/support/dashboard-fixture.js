const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const core = require("../../src/foreman");

// A Foreman home built through the real lifecycle API with a simulated Herdr runtime, so dashboard tests read the records
// Foreman itself writes: every task status the board groups, rounds, reports, a decision, pending points, and ended tasks.

class SimulatedHerdrTransport {
  constructor() { this.next = 1; this.workers = new Map(); }
  verifyCompatibility() { return { compatible: true, protocol: 1, endpointProtocolGeneration: 1 }; }
  capabilities() { return { agentKind: true, tool: true, command: true, model: true, reasoningEffort: true }; }
  spawn(request) {
    const endpoint = `sim-${this.next++}`;
    this.workers.set(endpoint, { ...request, endpoint, pane_id: `pane-${endpoint}`, status: "working" });
    return { endpoint, paneId: `pane-${endpoint}` };
  }
  inspect(endpoint) { return this.workers.get(endpoint) || { endpoint, status: "missing" }; }
  send(endpoint) { return this.workers.has(endpoint) ? { delivered: true } : { delivered: false }; }
  list() { return [...this.workers.values()].filter((worker) => worker.status !== "missing"); }
  stop(endpoint) { const worker = this.workers.get(endpoint); if (worker) worker.status = "missing"; return { stopped: true }; }
}

function gitProject(base, name) {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  execFileSync("git", ["init", "-b", "main", root], { stdio: "pipe" });
  git("config", "user.email", "dashboard@example.invalid");
  git("config", "user.name", "Foreman Dashboard");
  fs.writeFileSync(path.join(root, "README.md"), `${name}\n`);
  git("add", "README.md");
  git("commit", "-m", "fixture");
  return root;
}

function buildDashboardHome({ base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foreman-dashboard-"))) } = {}) {
  const app = gitProject(base, "app");
  const docs = gitProject(base, "docs");
  const roots = core.resolveRoots({ foremanRoot: path.resolve(__dirname, "../.."), foremanHome: path.join(base, "home") });
  core.initHome(roots);
  core.registerProject({ roots, id: "app", root: app, name: "App" });
  core.registerProject({ roots, id: "docs", root: docs, name: "Docs" });
  const transport = new SimulatedHerdrTransport();
  const adapter = new core.HerdrAdapter({ transport });
  const create = (projectId, brief, { original, profile = "claude-sonnet", reason = "Test selection.", confirm = true, ...rest } = {}) => {
    const task = core.createTask({ roots, projectId, brief, original, routingRunner: () => ({ profile, reason }), ...rest });
    if (confirm) core.confirmTaskProfile({ roots, taskId: task.id, profile });
    return task.id;
  };
  const dispatch = (taskId, owner, key, mode = "write") => core.assignTask({ roots, taskId, owner, adapter, resources: [{ key, mode }], allowResourceConflicts: true });
  const report = (endpoint, status, summary) => core.recordReport({ roots, paneId: `pane-${endpoint}`, status, summary });

  const done = create("app", "Add the login form\nwith validation", { original: "Làm form đăng nhập có kiểm tra dữ liệu." });
  const doneWorker = dispatch(done, "w-login", "file/src/login");
  report(doneWorker.endpoint, "done", "Kết quả: form đăng nhập có kiểm tra dữ liệu.\nBằng chứng: 12/12 test pass.\n\nNext steps:\n1. Accept task. (recommended)\n2. Thêm test cho màn hình nhỏ.");

  const blocked = create("app", "Pick the cache source for the watchdog", { original: "Đọc SDK xem có lấy được usage không rồi làm." });
  const blockedWorker = dispatch(blocked, "w-cache", "file/src/cache");
  report(blockedWorker.endpoint, "blocked", "Cần bạn chọn nguồn số liệu cache.\nSDK không có API usage công khai.\n\nNext steps:\n1. Dùng heuristic TTL 5 phút.\n2. Chờ API usage.");

  const deciding = create("app", "Rotate the cache before it expires", { original: "Khi cache hết thì đừng resend full context." });
  const decidingWorker = dispatch(deciding, "w-rotate", "file/src/rotate");
  report(decidingWorker.endpoint, "progress", "Đã có watchdog đo TTL; còn bước thay agent.");
  const decision = core.createDecision({ roots, taskId: deciding, finding: "Cần chọn cách nối tiếp khi cache hết hạn.", why: "Ảnh hưởng chi phí của mọi task.", options: ["A: Tạo agent mới với handoff gọn", "B: Giữ agent cũ, resend context đã nén"], recommendation: "A" });

  const working = create("docs", "Rewrite the quick start page", { original: "Viết lại trang quick start cho người mới." });
  const workingWorker = dispatch(working, "w-docs", "file/content/start");
  report(workingWorker.endpoint, "progress", "Đã viết xong phần cài đặt.");
  transport.workers.get(workingWorker.endpoint).status = "idle";
  core.continueTask({ roots, taskId: working, text: "Add a troubleshooting section.", original: "Thêm phần xử lý sự cố.", adapter });
  transport.workers.get(workingWorker.endpoint).status = "working";
  core.addAttentionPoint({ roots, taskId: working, owner: "user", kind: "decision", text: "Có giữ ảnh chụp màn hình cũ không?", user: true });
  core.addAttentionPoint({ roots, taskId: working, owner: "worker", kind: "check", text: "Kiểm tra mọi link trong trang.", user: true });

  const silent = create("docs", "Fix broken links in the guide");
  // Its read claim on the whole content tree overlaps the quick-start rewrite above.
  const silentWorker = dispatch(silent, "w-links", "file/content", "read");
  transport.workers.get(silentWorker.endpoint).status = "idle";

  const choose = create("app", "Add a dark theme", { profile: "codex-luna", reason: "Ordinary UI work.", confirm: false });
  const waiting = create("app", "Show the cache warning in status", { dependencies: [done] });

  const accepted = create("docs", "Fix the typo in the header");
  const acceptedWorker = dispatch(accepted, "w-typo", "file/content/header");
  report(acceptedWorker.endpoint, "done", "Đã sửa lỗi chính tả.");
  core.acceptTask({ roots, taskId: accepted, adapter });
  const discarded = create("docs", "Old idea that is no longer needed");
  core.discardTask({ roots, taskId: discarded, adapter });

  core.fleetStatus({ roots, adapter });
  return {
    base, roots, adapter, transport,
    ids: { done, blocked, deciding, working, silent, choose, waiting, accepted, discarded },
    decisionId: decision.decisionId,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

module.exports = { buildDashboardHome, SimulatedHerdrTransport };
