// Sample snapshot in the shape the dashboard server would build from FOREMAN_HOME/data (read-only, no lock).
// Profiles are the real ones from config/model-routing.json; projects and tasks are illustrative.

export const NOW = new Date(2026, 9, 21, 10, 40, 0).getTime();
const at = (h, m, day = 0) => new Date(2026, 9, 21 + day, h, m, 0).getTime();
const Y = -1; // yesterday

export const PROFILES = [
  { name: 'codex-luna', group: 'ordinary', tool: 'codex', model: 'gpt-6-luna', effort: 'high', active: true, note: 'Ưu tiên trong nhóm ordinary.' },
  { name: 'opencode-luna', group: 'ordinary', tool: 'opencode', model: 'openai/gpt-6-luna', effort: 'high', active: true, note: 'Herdr · OpenCode V2 mini --standalone.' },
  { name: 'claude-sonnet', group: 'ordinary', tool: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', active: true, isDefault: true, note: 'Profile default khi routing lỗi.' },
  { name: 'claude-opus', group: 'deep', tool: 'claude', model: 'claude-opus-5-5', effort: 'medium', active: true, note: 'Kiến trúc, data model, concurrency, bảo mật.' },
  { name: 'codex-sol', group: 'deep', tool: 'codex', model: 'gpt-6.1-sol', effort: 'medium', active: false, note: 'Đang tắt.' },
  { name: 'opencode-sol', group: 'ordinary', tool: 'opencode', model: 'openai/gpt-6.1-sol', effort: 'medium', active: false, note: 'Đang tắt.' }
];

export const PROJECTS = [
  { id: 'foreman', name: 'Foreman', root: '~/code/foreman', vcs: 'git', branch: 'main', enabled: true, limit: 4 },
  { id: 'ai-agent-workflow', name: 'AI Agent Workflow', root: '~/code/ai-agent-workflow', vcs: 'git', branch: 'main', enabled: true, limit: 4 },
  { id: 'docs-site', name: 'Docs site', root: '~/code/docs-site', vcs: 'none', branch: null, enabled: true, limit: 3 }
];

export const TASKS = [
  {
    taskId: 'T-42', projectId: 'foreman', type: 'ship', status: 'waiting-decision', round: 2, generation: 1, backend: 'paseo', endpoint: 'agt_7f3a91', owner: 'paseo:claude-opus',
    profile: 'claude-opus', routingProfile: 'claude-opus', needsProfileConfirmation: false,
    title: 'Cache rotation + handoff prompt khi prompt-cache hết hạn', createdAt: at(8, 12, Y), statusSince: at(8, 40, Y), lastActivityAt: at(8, 40, Y),
    runtime: 'idle', workspace: '~/code/foreman', branch: 'main', lease: [{ key: 'file/src/paseo*.js', mode: 'write' }, { key: 'file/src/supervision.js', mode: 'read' }],
    rounds: [
      { round: 2, at: at(19, 2, -2), original: 'Làm tiếp phần rotation, nhưng hỏi tôi trước khi chọn cách tạo agent mới.', sent: 'Triển khai rotation theo thiết kế round 1; dừng lại và đưa Decision Package trước khi chọn cơ chế thay agent.', mode: 'ship', reports: [{ status: 'progress', at: at(8, 38, Y), summary: 'Đã có watchdog đo TTL; còn bước thay agent. Có hai cách, cần người quyết.' }] },
      { round: 1, at: at(14, 5, -2), original: 'Khi cache hết thì đừng resend full context nữa, tốn token quá.', sent: null, mode: 'ship', reports: [{ status: 'progress', at: at(18, 50, -2), summary: 'Thiết kế 3 chặng: watchdog → warm-up → rotation. Đề xuất bắt đầu từ watchdog.' }] }
    ],
    decisions: [{
      id: 'D-1', state: 'pending', createdAt: at(8, 40, Y),
      finding: 'Khi cache hết hạn giữa chừng, cần chọn cách nối tiếp công việc.',
      why: 'Ảnh hưởng chi phí và tính liên tục của mọi task Paseo — là quyết định vận hành.',
      options: [
        { key: 'A', title: 'Tạo agent Paseo mới, gửi handoff prompt gọn (tóm tắt + quyết định + diff)', impact: 'Rẻ nhất về token; agent mới phải đọc lại workspace (~3–5 phút).' },
        { key: 'B', title: 'Giữ agent cũ, resend context đã nén', impact: 'Không đổi generation; tốn ~40% token so với resend full.' },
        { key: 'C', title: 'Không tự xoay — chỉ báo cho bạn khi cache sắp hết', impact: 'Không đổi code ngoài watchdog; bạn quyết từng lần.' }
      ],
      recommendation: 'A', evidence: 'reports/2026-10-20T08-38-r2.md · đo trên 6 task: resend full trung bình 410K token/lần.'
    }],
    attention: [
      { id: 'P1', owner: 'user', kind: 'decision', text: 'Chọn cơ chế thay agent khi cache hết (D-1).', state: 'open', since: at(8, 40, Y), round: 2 },
      { id: 'P2', owner: 'worker', kind: 'check', text: 'Chứng minh watchdog không đánh thức worker đang idle.', state: 'open', since: at(19, 2, -2), round: 2 }
    ],
    unread: false
  },
  {
    taskId: 'T-41', projectId: 'foreman', type: 'ship', status: 'blocked', round: 2, generation: 1, backend: 'paseo', endpoint: 'agt_2c81d0', owner: 'paseo:codex-luna',
    profile: 'codex-luna', routingProfile: 'codex-luna', needsProfileConfirmation: false,
    title: 'Cache watchdog cho worker session', createdAt: at(18, 30, Y), statusSince: at(9, 52), lastActivityAt: at(9, 52),
    runtime: 'idle', workspace: '~/code/foreman', branch: 'main', lease: [{ key: 'file/src/supervision.js', mode: 'write' }],
    rounds: [
      { round: 2, at: at(19, 2, Y), original: 'Đọc Paseo SDK xem có lấy được usage không rồi làm.', sent: 'Spike Paseo SDK timeline để lấy usage/cache; dùng số đó cho watchdog.', mode: 'ship', reports: [{ status: 'blocked', at: at(9, 52), summary: 'Cần bạn chọn nguồn số liệu cache cho watchdog.\n@getpaseo/client không có API usage/quota công khai — chỉ có timeline text, nên không đo được cache hit chính xác. Spike SDK đã xong ~70%.', steps: ['Dùng heuristic TTL 5 phút + thời gian idle để ước lượng cache còn ấm.', 'Chờ Paseo thêm API usage rồi mới làm watchdog.', 'Đọc usage từ log JSONL của tool (chỉ được với claude/codex).'] }] },
      { round: 1, at: at(18, 30, Y), original: 'Cần biết khi nào cache worker sắp nguội.', sent: null, mode: 'ship', reports: [{ status: 'progress', at: at(19, 0, Y), summary: 'Đã đọc supervision.js; watchdog nên chạy trong heartbeat turn, không tạo process nền.' }] }
    ],
    decisions: [],
    attention: [{ id: 'P1', owner: 'user', kind: 'decision', text: 'Chọn nguồn số liệu cache: heuristic, chờ API, hay log JSONL.', state: 'open', since: at(9, 52), round: 2 }],
    unread: true
  },
  {
    taskId: 'T-38', projectId: 'ai-agent-workflow', type: 'ship', status: 'review-ready', round: 4, generation: 1, backend: 'herdr', endpoint: 'pane:w2.3', owner: 'herdr:w2.3',
    profile: 'opencode-luna', routingProfile: 'opencode-luna', needsProfileConfirmation: false,
    title: 'Skill diagnosing-bugs: reproduce-first', createdAt: at(19, 5, -2), statusSince: at(9, 47), lastActivityAt: at(9, 47),
    runtime: 'idle', workspace: '~/code/ai-agent-workflow', branch: 'main', lease: [{ key: 'file/skills/diagnosing-bugs/**', mode: 'write' }, { key: 'file/skills/_shared/**', mode: 'write' }],
    rounds: [
      { round: 4, at: at(9, 12), original: 'Ok, chốt acceptance criteria rồi báo xong.', sent: null, mode: 'ship', reports: [{ status: 'done', at: at(9, 47), summary: 'Kết quả: skill ép reproduce-first; vòng reproduce được giữ làm regression test.\nThay đổi: 12 file, +340/−120 trong skills/diagnosing-bugs và skills/_shared/checklists.md.\nBằng chứng: 48/48 test skill pass; chạy thử trên 3 bug mẫu, cả 3 đều có vòng đỏ→xanh.\nChưa kiểm: chưa thử với repo không có test runner.\nRủi ro: thấp — chỉ đổi nội dung skill.', steps: ['Accept task.', 'Mở task mới thử skill trên repo không có test runner.'] }] },
      { round: 3, at: at(21, 5, Y), original: 'Giữ vòng reproduce làm regression test luôn.', sent: null, mode: 'ship', reports: [{ status: 'progress', at: at(22, 40, Y), summary: 'Đã thêm bước giữ test reproduce.' }] },
      { round: 2, at: at(20, 30, Y), original: null, sent: 'Hoàn thiện core loop reproduce → hypothesize → verify.', mode: 'ship', reports: [] },
      { round: 1, at: at(19, 10, -2), original: 'Agent debug bug khó hay đoán mò, ép nó reproduce trước.', sent: null, mode: 'ship', reports: [] }
    ],
    decisions: [{ id: 'D-1', state: 'delivered', createdAt: at(20, 0, Y), finding: 'Output skill bằng tiếng Việt hay tiếng Anh?', options: [{ key: 'A', title: 'Tiếng Việt' }, { key: 'B', title: 'Tiếng Anh' }], recommendation: 'A', answer: 'Tiếng Việt.', why: '', impact: '' }],
    attention: [
      { id: 'P1', owner: 'worker', kind: 'check', text: '48/48 test skill pass.', state: 'verified', closedHow: 'report round 4', since: at(9, 12), round: 4 },
      { id: 'P2', owner: 'user', kind: 'check', text: 'Chưa thử trên repo không có test runner.', state: 'limit-accepted', closedHow: 'bạn: để task sau', since: at(9, 47), round: 4 }
    ],
    unread: false
  },
  {
    taskId: 'T-37', projectId: 'docs-site', type: 'scout', status: 'review-ready', round: 1, generation: 1, backend: 'paseo', endpoint: 'agt_91be07', owner: 'paseo:claude-sonnet',
    profile: 'claude-sonnet', routingProfile: 'claude-sonnet', needsProfileConfirmation: false,
    title: 'Audit link gãy và trang mồ côi trong docs-site', createdAt: at(7, 50), statusSince: at(8, 31), lastActivityAt: at(8, 31),
    runtime: 'idle', workspace: '~/code/docs-site', branch: null, lease: [{ key: 'project/docs-site', mode: 'read' }],
    rounds: [{ round: 1, at: at(7, 52), original: 'Xem docs-site có link chết với trang không ai trỏ tới không.', sent: null, mode: 'scout', reports: [{ status: 'done', at: at(8, 31), summary: 'Tìm thấy 23 link gãy (17 nội bộ, 6 ngoài) và 9 trang mồ côi. Danh sách kèm file:dòng trong report. Không sửa file nào.', steps: ['Promote thành ship để sửa 17 link nội bộ.', 'Accept nếu chỉ cần báo cáo.'] }] }],
    decisions: [], attention: [], unread: true
  },
  {
    taskId: 'T-44', projectId: 'ai-agent-workflow', type: 'ship', status: 'queued', round: 1, generation: 0, backend: null, endpoint: null, owner: null,
    profile: null, routingProfile: 'codex-luna', needsProfileConfirmation: true, routingNote: 'ordinary — sửa trong thiết kế có sẵn, không cần deep.',
    title: 'Thêm plan-axis review vào skill review-pr', createdAt: at(10, 24), statusSince: at(10, 25), lastActivityAt: at(10, 25),
    runtime: 'none', workspace: null, branch: null, lease: [],
    rounds: [{ round: 1, at: at(10, 24), original: 'Bổ sung plan-axis review vào review-pr, bỏ spec axis.', sent: null, mode: 'ship', reports: [] }],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-40', projectId: 'ai-agent-workflow', type: 'ship', status: 'working', round: 3, generation: 1, backend: 'herdr', endpoint: 'pane:w2.1', owner: 'herdr:w2.1',
    profile: 'claude-sonnet', routingProfile: 'claude-sonnet', needsProfileConfirmation: false,
    title: 'Skill triage: phân loại issues/PRs', createdAt: at(20, 10, Y), statusSince: at(10, 5), lastActivityAt: at(10, 28),
    runtime: 'working', workspace: '~/code/ai-agent-workflow', branch: 'main', lease: [{ key: 'file/skills/triage/**', mode: 'write' }],
    rounds: [
      { round: 3, at: at(10, 5), original: 'Thêm acceptance criteria và template hỏi reporter.', sent: null, mode: 'ship', reports: [{ status: 'progress', at: at(10, 28), summary: 'State machine needs-triage → needs-info / ready-for-agent / ready-for-human / wontfix xong. Đang viết template hỏi reporter.' }] },
      { round: 2, at: at(21, 50, Y), original: null, sent: 'Làm rõ input contract trước khi code.', mode: 'ship', reports: [{ status: 'progress', at: at(21, 57, Y), summary: 'Input contract đã chốt theo docs/proposals.' }] },
      { round: 1, at: at(20, 15, Y), original: 'Cần khâu triage đầu vào cho issues/PRs.', sent: null, mode: 'ship', reports: [] }
    ],
    decisions: [], attention: [{ id: 'P1', owner: 'worker', kind: 'obligation', text: 'Template hỏi reporter cho nhánh needs-info.', state: 'open', since: at(10, 5), round: 3 }], unread: true
  },
  {
    taskId: 'T-36', projectId: 'ai-agent-workflow', type: 'ship', status: 'working', round: 5, generation: 2, backend: 'herdr', endpoint: 'pane:w2.4', owner: 'herdr:w2.4',
    profile: 'codex-luna', routingProfile: 'codex-luna', needsProfileConfirmation: false,
    title: 'Chuẩn hoá frontmatter cho toàn bộ skills', createdAt: at(9, 0, Y), statusSince: at(10, 12), lastActivityAt: at(10, 37),
    runtime: 'working', workspace: '~/code/ai-agent-workflow', branch: 'main', lease: [{ key: 'file/skills/*/SKILL.md', mode: 'write' }], leaseOverlap: 'T-38, T-40',
    handoff: 'Generation 2 sau khi pane cũ w2.2 mất tích lúc 07:58 (hai lần status check đều missing). Handoff gửi kèm round 1–4, report cuối và trạng thái workspace.',
    rounds: [
      { round: 5, at: at(10, 12), original: 'Làm nốt 6 skill còn lại.', sent: null, mode: 'ship', generation: 2, reports: [{ status: 'progress', at: at(10, 37), summary: '31/37 skill đã chuẩn hoá. Còn 6.' }] },
      { round: 4, at: at(16, 0, Y), original: null, sent: 'Tiếp tục theo checklist.', mode: 'ship', reports: [] },
      { round: 1, at: at(9, 2, Y), original: 'Frontmatter mỗi skill một kiểu, chuẩn hoá giúp tôi.', sent: null, mode: 'ship', reports: [] }
    ],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-39', projectId: 'foreman', type: 'ship', status: 'working', round: 2, generation: 1, backend: 'herdr', endpoint: 'pane:w1.2', owner: 'herdr:w1.2',
    profile: 'codex-luna', routingProfile: 'codex-luna', needsProfileConfirmation: false,
    title: 'Đồng bộ Paseo agent profiles khi model-routing đổi', createdAt: at(7, 40), statusSince: at(8, 25), lastActivityAt: at(8, 25),
    runtime: 'idle', issues: [{ type: 'worker.idle-without-report', at: at(8, 52) }], workspace: '~/code/foreman', branch: 'main', lease: [{ key: 'file/src/paseo-routing.js', mode: 'write' }, { key: 'file/config/paseo-agent-profiles.json', mode: 'write' }],
    rounds: [
      { round: 2, at: at(8, 25), original: 'Kiểm tra cả nhánh profile bị inactive.', sent: null, mode: 'ship', reports: [] },
      { round: 1, at: at(7, 50), original: 'Sửa model-routing xong thì profiles lệch, sync cho đúng.', sent: null, mode: 'ship', reports: [{ status: 'progress', at: at(8, 20), summary: 'Đã map profile ID của 2 daemon.' }] }
    ],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-43', projectId: 'foreman', type: 'scout', status: 'working', round: 1, generation: 1, backend: 'paseo', endpoint: 'agt_e91f3c', owner: 'paseo:claude-opus',
    profile: 'claude-opus', routingProfile: 'claude-opus', needsProfileConfirmation: false,
    title: 'Điều tra token usage của flow nhiều vòng (#28)', createdAt: at(9, 30), statusSince: at(9, 34), lastActivityAt: at(10, 5),
    runtime: 'unknown', issues: [{ type: 'worker.timeline-gap', at: at(10, 39) }], workspace: '~/code/foreman', branch: 'main', lease: [{ key: 'project/foreman', mode: 'read' }],
    rounds: [{ round: 1, at: at(9, 34), original: 'Điều tra vì sao flow nhiều vòng tốn token, đo bằng số.', sent: null, mode: 'scout', reports: [{ status: 'progress', at: at(10, 5), summary: 'Đã thu log JSONL 12 phiên; đang tách prompt-cache read/write.' }] }],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-45', projectId: 'docs-site', type: 'ship', status: 'working', round: 1, generation: 1, backend: 'herdr', endpoint: 'pane:w3.1', owner: 'herdr:w3.1',
    profile: 'opencode-luna', routingProfile: 'opencode-luna', needsProfileConfirmation: false,
    title: 'Viết lại trang Bắt đầu nhanh', createdAt: at(9, 55), statusSince: at(10, 2), lastActivityAt: at(10, 34),
    runtime: 'waiting-input', issues: [{ type: 'worker.waiting-input', at: at(10, 34) }], workspace: '~/code/docs-site', branch: null, lease: [{ key: 'file/content/getting-started/**', mode: 'write' }],
    rounds: [{ round: 1, at: at(10, 2), original: 'Viết lại trang quick start cho người mới, ngắn thôi.', sent: null, mode: 'ship', reports: [] }],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-48', projectId: 'docs-site', type: 'ship', status: 'pending', round: 1, generation: 1, backend: 'paseo', endpoint: null, owner: 'paseo:claude-sonnet',
    profile: 'claude-sonnet', routingProfile: 'claude-sonnet', needsProfileConfirmation: false,
    title: 'Sửa 17 link nội bộ từ audit T-37', createdAt: at(10, 36), statusSince: at(10, 39), lastActivityAt: at(10, 39),
    runtime: 'none', workspace: '~/code/docs-site', branch: null, lease: [{ key: 'file/content/**', mode: 'write' }], leaseOverlap: 'T-45',
    rounds: [{ round: 1, at: at(10, 36), original: 'Sửa luôn 17 link nội bộ nó tìm được.', sent: null, mode: 'ship', reports: [] }],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-46', projectId: 'foreman', type: 'ship', status: 'queued', round: 1, generation: 0, backend: null, endpoint: null, owner: null,
    profile: 'claude-sonnet', routingProfile: 'claude-sonnet', needsProfileConfirmation: false, dependencies: ['T-41'],
    title: 'Hiển thị cảnh báo cache nguội trong status', createdAt: at(9, 20), statusSince: at(9, 21), lastActivityAt: at(9, 21),
    runtime: 'none', workspace: null, branch: null, lease: [],
    rounds: [{ round: 1, at: at(9, 20), original: 'Khi watchdog xong thì cho status hiện cảnh báo cache nguội.', sent: null, mode: 'ship', reports: [] }],
    decisions: [], attention: [], unread: false
  },
  {
    taskId: 'T-47', projectId: 'ai-agent-workflow', type: 'ship', status: 'routing', round: 1, generation: 0, backend: null, endpoint: null, owner: null,
    profile: null, routingProfile: null, needsProfileConfirmation: false,
    title: 'Gom checklist chung của các skill review', createdAt: at(10, 38), statusSince: at(10, 38), lastActivityAt: at(10, 38),
    runtime: 'none', workspace: null, branch: null, lease: [],
    rounds: [{ round: 1, at: at(10, 38), original: 'Các skill review lặp checklist, gom về một chỗ.', sent: null, mode: 'ship', reports: [] }],
    decisions: [], attention: [], unread: false
  }
];

export const SUPERVISION = {
  lastCheckAt: at(10, 39, 0) + 12000, lastCollectAt: at(10, 39, 0) + 10000,
  heartbeat: { id: 'hb_4e1c', cron: '*/5 * * * *', lastFiredAt: at(10, 35), agent: 'agt_f0reman' },
  backends: [
    { id: 'paseo', state: 'ok', detail: 'daemon 0.11.2 · home ~/.paseo · 4 agent của Foreman', checkedAt: at(10, 39) },
    { id: 'herdr', state: 'ok', detail: 'protocol 3 · 5 pane được gán', checkedAt: at(10, 39) }
  ],
  outbox: [
    { id: 'M-T-48-1-brief', taskId: 'T-48', kind: 'task-brief', state: 'pending', at: at(10, 39), note: 'đang chờ Paseo xác nhận endpoint' },
    { id: 'M-T-40-1-3', taskId: 'T-40', kind: 'task-update', state: 'delivered', at: at(10, 5) },
    { id: 'M-T-41-D', taskId: 'T-41', kind: 'task-update', state: 'delivered', at: at(19, 2, Y) }
  ],
  untold: [
    { key: 'T-39/worker.idle-without-report/g1/r2', taskId: 'T-39', kind: 'anomaly', at: at(8, 52) },
    { key: 'T-45/worker.waiting-input/g1/r1', taskId: 'T-45', kind: 'anomaly', at: at(10, 34) },
    { key: 'T-37/report/r1', taskId: 'T-37', kind: 'review-ready', at: at(8, 31) }
  ],
  skipped: [],
  server: { port: 18789, bind: '127.0.0.1', clients: 1, fingerprintMs: 0.43, rebuildMs: 34, home: '~/.foreman-home' },
  history: [
    // data/task-history.jsonl: identity, outcome and times only. `title` is what the dashboard remembered while the task was open.
    { taskId: 'T-35', projectId: 'ai-agent-workflow', type: 'ship', backend: 'herdr', outcome: 'accepted', createdAt: at(9, 0, -2), endedAt: at(11, 5, Y), round: 3, generation: 1, title: 'Planner mode thay coder skill' },
    { taskId: 'T-34', projectId: 'foreman', type: 'scout', backend: 'paseo', outcome: 'discarded', createdAt: at(15, 0, -2), endedAt: at(17, 40, -2), round: 1, generation: 1 },
    { taskId: 'T-33', projectId: 'ai-agent-workflow', type: 'ship', backend: 'paseo', outcome: 'accepted', createdAt: at(10, 0, -3), endedAt: at(16, 20, -2), round: 2, generation: 1, title: 'Cập nhật README theo planner mode' }
  ]
};

export const TOKENS = {
  days: [{ label: 'T4 14/10', short: 'T4', value: 2.3, hit: 68 }, { label: 'T5 15/10', short: 'T5', value: 3.1, hit: 72 }, { label: 'T6 16/10', short: 'T6', value: 2.6, hit: 70 }, { label: 'T7 17/10', short: 'T7', value: 3.4, hit: 76 }, { label: 'CN 18/10', short: 'CN', value: 1.2, hit: 71 }, { label: 'T2 19/10', short: 'T2', value: 2.9, hit: 78 }, { label: 'T3 20/10', short: 'T3', value: 3.2, hit: 74 }],
  byProfile: [{ label: 'claude-opus', value: 6.1 }, { label: 'codex-luna', value: 5.4 }, { label: 'claude-sonnet', value: 4.2 }, { label: 'opencode-luna', value: 3.0 }],
  byProject: [{ label: 'foreman', value: 9.8 }, { label: 'ai-agent-workflow', value: 7.1 }, { label: 'docs-site', value: 1.8 }],
  topTasks: [{ label: 'T-38 · diagnosing-bugs', value: 2.1 }, { label: 'T-42 · cache rotation', value: 1.9 }, { label: 'T-40 · skill triage', value: 1.24 }, { label: 'T-36 · frontmatter', value: 1.1 }, { label: 'T-41 · cache watchdog', value: 0.86 }],
  resends: [{ taskId: 'T-42', at: '20/10 08:31', tokens: '410K', why: 'cache hết sau 7 phút idle' }, { taskId: 'T-38', at: '20/10 21:05', tokens: '380K', why: 'round mới sau 42 phút' }, { taskId: 'T-36', at: '21/10 10:12', tokens: '290K', why: 'generation 2 — handoff' }]
};
