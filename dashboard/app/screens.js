import { h, frag, F, Fragment, useState } from './react.js';
import * as M from './model.js';
import { runtimeBadge, ForemanReport } from './board.js';

const { STATUS, POINT_KIND, ago, clock, clockSec, dayLabel, cx, copyText } = F;
const cap = M.cap;

function table(head, rows, { wrap = true, compact = false } = {}) {
  const el = h('table', { className: compact ? 'fm-table compact' : 'fm-table' }, h('thead', null, h('tr', null, head.map((c, i) => h('th', { key: i, className: c.r ? 'r' : undefined }, c.label || c)))), h('tbody', null, rows));
  return wrap ? h('div', { className: 'fm-tablewrap' }, el) : el;
}
const link = (id, onOpen, label) => h('button', { type: 'button', className: 'fm-link', onClick: () => onOpen(id) }, label || id);
const messageTone = (state) => (state === 'failed' ? 'red' : state === 'pending' ? 'mustard' : 'green');
const DECISION_STATE = { pending: 'chờ bạn', answered: 'đã trả lời, chưa gửi', delivered: 'đã gửi agent', superseded: 'bạn đã gửi yêu cầu khác' };

// ================= Task page =================
// Each round shows only the user's own words and Foreman's reports of that round, newest first.
function RoundReports({ t, now }) {
  const reports = t.foremanReports || [];
  return h('ol', { className: 'fm-rounds' }, t.rounds.map((r, i) => {
    const mine = reports.filter((x) => x.round === r.round).reverse();
    return h('li', { key: r.round, className: cx('fm-round', i === 0 && 'current') },
      h('div', { className: 'rh' }, h('b', null, 'Round ' + r.round), h('span', { className: 't' }, (r.at ? clock(r.at) + ' · ' + dayLabel(r.at, now).split(' — ')[0].toLowerCase() : '') + (r.mode ? ' · ' + r.mode : '') + (r.generation ? ' · G' + r.generation : ''))),
      h('div', { className: 'said' }, h('span', { className: 'who' }, 'Bạn yêu cầu'), r.original || h('span', { className: 'fm-faint' }, 'Không có lời gốc của bạn cho round này.')),
      mine.length ? mine.map((x, j) => h('div', { key: j, style: { marginTop: 10 } }, h(ForemanReport, { report: x, now })))
        : h('p', { className: 'fm-faint', style: { margin: '8px 0 0', fontSize: 13 } }, 'Chưa có báo cáo của Foreman.'));
  }));
}

export function TaskPage({ t, tasks, now, onBack, onOpen }) {
  const [tab, setTab] = useState('rounds');
  if (!t) return h('div', null, h('button', { type: 'button', className: 'fm-back', onClick: onBack }, '← Task'),
    h('div', { style: { marginTop: 16 } }, h(F.StateNotice, { state: 'empty', stamp: 'Không còn', title: 'Task không còn tồn tại' }, 'Task đã được accept hoặc discard. Workspace vẫn còn trên đĩa.')));
  const k = M.statusKey(t), a = M.anomalyOf(t, now);
  const dependents = tasks.filter((x) => (x.dependencies || []).indexOf(t.taskId) >= 0);
  const msgs = t.messages || [];
  const pts = t.attention || [];
  const handoff = M.handoffText(t.handoff);
  const tabs = [
    { id: 'rounds', label: 'Round & báo cáo', count: t.rounds.length },
    { id: 'decisions', label: 'Quyết định', count: (t.decisions || []).length, tone: M.pendingDecision(t) ? 'red' : null },
    { id: 'points', label: 'Attention', count: pts.filter((p) => p.state === 'open').length, tone: pts.some((p) => p.state === 'open' && p.owner === 'user') ? 'red' : null },
    { id: 'messages', label: 'Outbox', count: msgs.length }
  ];
  return h('div', null,
    h('button', { type: 'button', className: 'fm-back', onClick: onBack }, '← Task'),
    h(F.PageHeader, { plain: true, id: 'page-title', title: t.title, actions: h(F.Stamp, { status: k }),
      eyebrow: frag(h('span', { className: 'fm-no' }, t.taskId), h(F.TypeTag, { type: t.type }), h(F.ProjectTag, null, t.projectId), h('span', null, 'tạo ' + ago(t.createdAt, now))) }),
    a.issues.length ? h('div', { style: { marginBottom: 16 } }, a.issues.map((i) => h(F.Banner, { key: i.type, tone: i.tone, lead: i.label }, i.explain, ' ', h('span', { className: 'fm-faint' }, i.type + ' · ' + clock(i.at || now))))) : null,
    h('div', { className: 'fm-grid side' },
      h('div', { style: { minWidth: 0 } },
        h(F.Tabs, { tabs, value: tab, onChange: setTab, label: 'Nội dung task' }),
        h('div', { className: 'fm-tabpanel', role: 'tabpanel' },
          tab === 'rounds' ? h(RoundReports, { t, now }) : null,
          tab === 'decisions' ? ((t.decisions || []).length ? t.decisions.slice().reverse().map((d) => h(F.Card, { key: d.id, title: d.label + ' · ' + (DECISION_STATE[d.state] || d.state), end: d.createdAt ? 'mở ' + clock(d.createdAt) + ' ' + dayLabel(d.createdAt, now).split(' — ')[0].toLowerCase() : null },
            h('p', { style: { margin: '0 0 8px', fontWeight: 600 } }, d.finding),
            d.why ? h('p', { style: { margin: '0 0 8px', fontSize: 13, color: 'var(--ink-2)' } }, d.why) : null,
            h(F.DecisionOptions, { options: d.options, recommendation: d.recommendation }),
            d.answer ? h('div', { style: { marginTop: 8 } }, h(F.Quote, { solid: true, source: 'bạn trả lời' }, d.answer)) : null,
            h('p', { className: 'fm-faint fm-mono', style: { margin: '8px 0 0', fontSize: 12 } }, d.id)))
            : h('p', { className: 'fm-faint' }, 'Chưa có quyết định nào.')) : null,
          tab === 'points' ? h(F.PointList, { points: pts, kinds: POINT_KIND, now }) : null,
          tab === 'messages' ? (msgs.length ? table(['Message', 'Loại', 'Trạng thái', { label: 'Lúc', r: true }], msgs.map((m) => h('tr', { key: m.id },
            h('td', { className: 'mono' }, m.id, m.note ? h('div', { className: 'fm-faint', style: { fontSize: 12 } }, m.note) : null), h('td', { className: 'mono' }, m.kind),
            h('td', null, h(F.StatusLabel, { tone: messageTone(m.state), size: 'sm' }, m.state)), h('td', { className: 'r mono' }, m.at ? clock(m.at) : '—'))))
            : h('p', { className: 'fm-faint' }, 'Outbox trống.')) : null)),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 } },
        h(F.Card, { title: 'Trạng thái' }, h(F.KeyValue, { items: [
          ['Task', frag(h(F.StatusLabel, { status: k, size: 'sm' }), ' ', h('span', { className: 'fm-faint', style: { fontSize: 12, marginLeft: 6 } }, 'từ ' + clock(t.statusSince)))],
          ['Runtime', runtimeBadge(t) || h('span', { className: 'fm-faint' }, 'chưa có agent')],
          ['Agent', t.profile ? t.profile + (t.backend ? ' · ' + cap(t.backend) : '') : t.routingProfile ? 'đề xuất ' + t.routingProfile : '—', true],
          t.endpoint ? ['Endpoint', t.endpoint + ' · gen ' + t.generation, true] : null,
          t.owner ? ['Owner', t.owner, true] : null,
          t.reviewSize ? ['Cỡ review', t.reviewSize] : null,
          ['Hoạt động cuối', ago(t.lastActivityAt, now)]
        ] })),
        h(F.Card, { title: 'Workspace & lease' },
          h(F.KeyValue, { items: [
            ['Workspace', t.workspace || 'chưa có', true],
            ['Branch', t.branch || (t.vcs === 'none' ? 'không dùng git' : '—'), true],
            ['Lease', t.lease.length ? t.lease.map((l) => l.mode + ' ' + l.key).join('\n') : '—', true],
            t.leaseOverlap ? ['Chồng lấn', h('span', { style: { color: 'var(--mustard-deep)', fontWeight: 600 } }, 'với ' + t.leaseOverlap)] : null
          ] })),
        (t.dependencies || []).length || dependents.length ? h(F.Card, { title: 'Phụ thuộc' }, h(F.KeyValue, { items: [
          (t.dependencies || []).length ? ['Chờ task', frag(t.dependencies.map((d) => { const o = tasks.find((x) => x.taskId === d); return h('button', { key: d, type: 'button', className: 'fm-link', style: { marginRight: 8 }, onClick: () => onOpen(d) }, d + (o ? ' · ' + STATUS[M.statusKey(o)].label.toLowerCase() : ' · đã kết thúc') + ' →'); }))] : null,
          dependents.length ? ['Đang chặn', frag(dependents.map((d) => h('button', { key: d.taskId, type: 'button', className: 'fm-link', style: { marginRight: 8 }, onClick: () => onOpen(d.taskId) }, d.taskId + ' →')))] : null
        ] })) : null,
        handoff ? h(F.Card, { title: 'Handoff gần nhất' }, h('p', { style: { margin: 0, fontSize: 13 } }, handoff)) : null)));
}

// ================= Task list =================
// Every unaccepted task in one table; ended tasks keep no content, so they are listed without a link.
export function TaskList({ tasks, now, snap, onOpen }) {
  const [proj, setProj] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(20);
  const search = q.trim().toLowerCase();
  const matches = (x) => (proj === 'all' || x.projectId === proj) && (!search || (x.taskId + ' ' + (x.title || '') + ' ' + (x.profile || '') + ' ' + x.projectId).toLowerCase().indexOf(search) >= 0);
  const scoped = M.ordered(tasks, now).filter(matches);
  const rows = scoped.filter((t) => status === 'all' || M.statusKey(t) === status);
  const ended = (snap.history || []).filter(matches).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  const projects = Array.from(new Set((snap.projects || []).map((p) => p.id).concat(tasks.map((t) => t.projectId))));
  // A chosen status stays listed (and the chips visible) even when the project or search leaves no task in it, so it can be cleared.
  const keys = Array.from(new Set(scoped.map(M.statusKey).concat(status === 'all' ? [] : [status])));
  return h('div', null,
    h(F.PageHeader, { no: '03', eyebrow: 'Danh sách', title: 'Task', id: 'page-title', lede: tasks.length + ' task chưa accept · ' + (snap.history || []).length + ' task đã kết thúc.' }),
    h('div', { className: 'fm-toolbar' },
      h(F.FilterChips, { label: 'Dự án', value: proj, onChange: setProj, options: [{ value: 'all', label: 'Tất cả' }].concat(projects.map((p) => ({ value: p, label: p }))) }),
      h('span', { className: 'end' }, h(F.SearchField, { value: q, onChange: setQ, inputRef: null }))),
    h(F.SectionHeader, { title: 'Đang mở', meta: rows.length < tasks.length ? rows.length + ' / ' + tasks.length : tasks.length }),
    keys.length > 1 || status !== 'all' ? h('div', { className: 'fm-toolbar' }, h(F.FilterChips, { label: 'Trạng thái', value: status, onChange: setStatus, options: [{ value: 'all', label: 'Tất cả', count: scoped.length }].concat(keys.map((k) => ({ value: k, label: STATUS[k].label, count: scoped.filter((t) => M.statusKey(t) === k).length }))) })) : null,
    rows.length ? table(['Task', 'Trạng thái', 'Dự án', 'Agent', { label: 'Round', r: true }, { label: 'Hoạt động cuối', r: true }], rows.map((t) => h('tr', { key: t.taskId, className: cx('fm-rowlink', M.anomalyOf(t, now).any && 'warn'), onClick: () => onOpen(t.taskId) },
      h('td', null, link(t.taskId, onOpen), h('div', { style: { fontSize: 13 } }, t.title)),
      h('td', null, h(F.StatusLabel, { status: M.statusKey(t), size: 'sm' })),
      h('td', { className: 'mono' }, t.projectId),
      h('td', { className: 'mono' }, t.profile ? t.profile + (t.backend ? ' · ' + cap(t.backend) : '') : '—'),
      h('td', { className: 'r mono' }, t.round),
      h('td', { className: 'r' }, ago(t.lastActivityAt, now)))))
      : h('p', { className: 'fm-faint', style: { fontSize: 13 } }, !tasks.length ? 'Không có task. Giao việc trong phiên Foreman, task sẽ hiện ở đây.' : 'Không có task nào khớp bộ lọc.'),
    h(F.SectionHeader, { title: 'Đã kết thúc', meta: ended.length, hint: 'chỉ còn bản ghi lịch sử, không còn nội dung task' }),
    ended.length ? frag(
      table(['Task', 'Kết quả', 'Dự án', { label: 'Round', r: true }, { label: 'Kết thúc', r: true }], ended.slice(0, limit).map((x) => h('tr', { key: x.taskId },
        h('td', null, h('b', { className: 'fm-mono' }, x.taskId), h('div', { className: x.title ? null : 'fm-faint', style: { fontSize: 13 } }, x.title || 'Không lưu tiêu đề')),
        h('td', null, h(F.StatusLabel, { tone: x.outcome === 'discarded' ? 'ink' : 'green', size: 'sm' }, x.outcome === 'discarded' ? 'discard' : 'accept')),
        h('td', { className: 'mono' }, x.projectId),
        h('td', { className: 'r mono' }, x.round),
        h('td', { className: 'r' }, x.endedAt ? ago(x.endedAt, now) : '—')))),
      ended.length > limit ? h('div', { style: { marginTop: 8 } }, h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => setLimit(limit + 20) }, 'Xem thêm ' + Math.min(20, ended.length - limit))) : null)
      : h('p', { className: 'fm-faint', style: { fontSize: 13 } }, 'Chưa có task nào kết thúc.'));
}

// ================= Timeline =================
export function Timeline({ tasks, now, snap, onOpen }) {
  const [range, setRange] = useState('today');
  const [types, setTypes] = useState('all');
  const [proj, setProj] = useState('all');
  const [limit, setLimit] = useState(30);
  const day0 = new Date(now); day0.setHours(6, 0, 0, 0);
  const from = range === 'today' ? Math.min(day0.getTime(), now - 3600000) : range === '24h' ? now - 24 * 3600000 : now - 72 * 3600000;
  const to = range === 'today' ? Math.max(now + 3600000, day0.getTime() + 6 * 3600000) : now + 3600000;
  const scoped = tasks.filter((t) => proj === 'all' || t.projectId === proj);
  const historyScoped = (snap.history || []).filter((x) => proj === 'all' || x.projectId === proj);
  const rows = M.ganttRows(M.ordered(scoped, now), from, now);
  const TYPE_GROUPS = { all: null, reports: ['report', 'done', 'blocked'], you: ['decision', 'answer', 'blocked', 'done'], anomaly: ['anomaly'], rounds: ['round', 'created'], ended: ['accepted', 'discarded'] };
  const events = M.buildEvents(scoped, now, historyScoped).filter((e) => !TYPE_GROUPS[types] || TYPE_GROUPS[types].indexOf(e.type) >= 0);
  const sum = (kind) => rows.reduce((n, r) => n + r.segs.filter((s) => s.kind === kind).reduce((m, s) => m + (s.to - s.from), 0), 0);
  const youMs = sum('you'), runMs = sum('run');
  const projects = Array.from(new Set((snap.projects || []).map((p) => p.id).concat(tasks.map((t) => t.projectId))));
  return h('div', null,
    h(F.PageHeader, { no: '04', eyebrow: 'Lịch sử', title: 'Timeline', id: 'page-title' }),
    h('div', { className: 'fm-toolbar' }, h(F.FilterChips, { label: 'Dự án', value: proj, onChange: setProj, options: [{ value: 'all', label: 'Tất cả' }].concat(projects.map((p) => ({ value: p, label: p }))) })),
    h(F.SectionHeader, { title: 'Thời gian theo task', meta: rows.length + ' task', end: h(F.Segmented, { label: 'Khoảng thời gian', value: range, onChange: setRange, options: [{ value: 'today', label: 'Hôm nay' }, { value: '24h', label: '24 giờ' }, { value: '72h', label: '3 ngày' }] }) }),
    h(F.KpiStrip, { label: 'Tổng hợp khoảng đang xem', items: [
      { label: 'Agent làm', value: (runMs / 3600000).toFixed(1), unit: 'giờ', sub: 'cộng dồn mọi agent' },
      { label: 'Chờ bạn', value: (youMs / 3600000).toFixed(1), unit: 'giờ', sub: 'quyết định, bị chặn, chọn model', tone: youMs > runMs * 0.5 && youMs > 0 ? 'red' : null },
      { label: 'Tỉ lệ chờ bạn', value: youMs + runMs ? String(Math.round((youMs / (youMs + runMs)) * 100)) : null, unit: '%', sub: youMs + runMs ? 'trên tổng thời gian' : 'chưa có thời gian để tính' }
    ] }),
    h('div', { style: { height: 12 } }),
    rows.length ? h(F.ShiftGantt, { rows, from, to, now, onOpen }) : h('p', { className: 'fm-faint' }, 'Không có task nào hoạt động trong khoảng này.'),
    h(F.SectionHeader, { title: 'Nhật ký', meta: events.length + ' sự kiện' }),
    h('div', { className: 'fm-toolbar' }, h(F.FilterChips, { label: 'Loại', value: types, onChange: setTypes, options: [{ value: 'all', label: 'Tất cả' }, { value: 'you', label: 'Chờ bạn' }, { value: 'reports', label: 'Report' }, { value: 'anomaly', label: 'Bất thường' }, { value: 'rounds', label: 'Round & task mới' }, { value: 'ended', label: 'Đã kết thúc' }] })),
    h(F.EventLog, { events: events.slice(0, limit), onOpen: (id) => (tasks.find((t) => t.taskId === id) ? onOpen(id) : null) }),
    events.length > limit ? h('div', { style: { marginTop: 12, textAlign: 'center' } }, h(F.Button, { variant: 'flat', onClick: () => setLimit(limit + 30) }, 'Xem thêm ' + Math.min(30, events.length - limit) + ' sự kiện')) : null,
    h('div', { style: { marginTop: 16 } }, h(F.Callout, { variant: 'note', lead: 'Task đã kết thúc' }, 'đọc từ ', h('span', { className: 'fm-code' }, 'data/task-history.jsonl'), '. File này không lưu nội dung, nên chỉ có tiêu đề nếu dashboard từng thấy task lúc còn mở.')));
}

// ================= Health =================
function backendChecks(snap, now) {
  const backends = snap.backends || {};
  const used = new Set((snap.tasks || []).map((t) => t.backend));
  const names = Array.from(new Set(Object.keys(backends).concat(Array.from(used))));
  if (!names.length) return [{ state: 'off', name: 'Status check', desc: 'Chưa có status check nào được lưu. Foreman lưu kết quả mỗi lần chạy status trong phiên.', value: '—' }];
  const checks = [];
  names.sort().forEach((b) => {
    const e = backends[b] || {};
    const failed = e.error && (e.failedAt || 0) > (e.checkedAt || 0);
    checks.push({
      state: failed ? 'bad' : !e.checkedAt ? 'off' : now - e.checkedAt < 10 * 60000 ? 'ok' : 'warn',
      name: 'Status check ' + cap(b),
      desc: failed ? 'Lần gần nhất lỗi: ' + e.error : e.checkedAt ? 'Lần kiểm tra runtime gần nhất' + (e.workers != null ? ' · ' + e.workers + ' agent trên runtime' : '') + '.' : 'Chưa có status check nào cho backend này.',
      value: e.checkedAt ? clockSec(e.checkedAt) + ' · ' + ago(e.checkedAt, now) : '—'
    });
    if (b === 'paseo') checks.push({ state: e.collectedAt ? (now - e.collectedAt < 15 * 60000 ? 'ok' : 'warn') : 'off', name: 'Task collect (Paseo)', desc: 'Thu report từ Paseo timeline.', value: e.collectedAt ? clockSec(e.collectedAt) + ' · ' + ago(e.collectedAt, now) : '—' });
  });
  return checks;
}

export function Health({ tasks, now, snap, conn, onOpen, onCopied }) {
  const anomalies = tasks.filter((t) => M.groupOf(t, now) === 'anomaly');
  const sup = snap.supervision;
  const hb = sup && sup.heartbeat;
  const hbAt = hb ? hb.lastFiredAt || hb.confirmedAt || hb.createdAt : null;
  const server = snap.server || {};
  const untold = snap.untold || [];
  const outbox = snap.outbox || [];
  const checks = [
    { state: conn === 'live' ? 'ok' : conn === 'offline' ? 'bad' : 'warn', name: 'Dashboard server', desc: frag('SSE ' + (conn === 'live' ? 'đang mở' : conn === 'stale' ? 'rớt — đang poll 5 giây' : conn === 'offline' ? 'mất kết nối' : 'đang kết nối lại') + ' · ', h('code', null, (server.bind || '127.0.0.1') + ':' + (server.port || '—')), ' · ' + (server.clients || 0) + ' trình duyệt' + (server.fingerprintMs != null ? ' · fingerprint ' + server.fingerprintMs + ' ms' : '')), value: conn },
    ...backendChecks(snap, now),
    (tasks.some((t) => t.backend === 'paseo') || hb) ? { state: !hb ? 'off' : hbAt && now - hbAt < 15 * 60000 ? 'ok' : 'warn', name: 'Heartbeat Paseo', desc: hb ? frag(h('code', null, hb.id), ' · ', h('code', null, hb.cron || sup.cron), ' · agent ', h('code', null, hb.agent)) : sup && sup.enabled === false ? 'Đã tắt.' : 'Chưa có heartbeat.', value: hbAt ? 'lần cuối ' + clock(hbAt) : '—' } : null,
    { state: (snap.skipped || []).length ? 'bad' : 'ok', name: 'Bản ghi task', desc: (snap.skipped || []).length ? snap.skipped.length + ' bản ghi sai schema: ' + snap.skipped.map((s) => s.taskId).join(', ') : 'Mọi meta.json hợp lệ.', value: tasks.length + ' task' },
    snap.historySkipped ? { state: 'warn', name: 'Lịch sử task', desc: snap.historySkipped + ' dòng trong task-history.jsonl không đọc được.', value: (snap.history || []).length + ' dòng' } : null
  ].filter(Boolean);
  const bad = checks.filter((c) => c.state === 'bad' || c.state === 'warn').length + anomalies.length;
  return h('div', null,
    h(F.PageHeader, { no: '05', eyebrow: 'Hệ thống', title: 'Health', id: 'page-title', actions: h(F.Stamp, { tone: bad ? 'mustard' : 'green' }, bad ? bad + ' mục cần xem' : 'Ổn định') }),
    h(F.SectionHeader, { title: 'Giám sát & runtime' }),
    h(F.CheckList, { items: checks, label: 'Kiểm tra hệ thống' }),
    (snap.skipped || []).length ? h('div', { style: { marginTop: 12 } }, h(F.Callout, { variant: 'danger', lead: 'Bỏ qua:' }, snap.skipped.map((s) => s.taskId + ' — ' + s.reason).join(' · '))) : null,
    h(F.SectionHeader, { title: 'Bất thường', meta: anomalies.length }),
    anomalies.length ? table(['Task', 'Loại', 'Ý nghĩa', 'Từ lúc', 'Đã báo', ''], anomalies.map((t) => {
      const a = M.anomalyOf(t, now);
      const i = a.issues[0] || { label: 'Không hoạt động lâu', explain: 'Không có hoạt động quá ' + M.THRESHOLDS.silentMin + ' phút.', type: 'dashboard.silent' };
      const act = M.actionsFor(t, now);
      const told = !untold.find((u) => u.taskId === t.taskId && u.kind === 'anomaly');
      return h('tr', { key: t.taskId },
        h('td', null, link(t.taskId, onOpen), h('div', { className: 'fm-faint', style: { fontSize: 12 } }, (t.profile || '—') + ' · ' + cap(t.backend))),
        h('td', null, h(F.StatusLabel, { tone: i.tone || 'mustard', size: 'sm' }, i.label), h('div', { className: 'fm-mono fm-faint', style: { fontSize: 12, marginTop: 2 } }, i.type)),
        h('td', null, i.explain), h('td', null, clock(i.at || t.lastActivityAt), h('div', { className: 'fm-faint' }, ago(i.at || t.lastActivityAt, now))),
        h('td', null, told ? 'rồi' : h(F.StatusLabel, { tone: 'mustard', size: 'sm' }, 'chưa')),
        h('td', { className: 'r' }, act.text ? h(F.Button, { variant: 'flat', size: 'sm', onClick: () => copyText(act.text).then(() => onCopied(act.text), () => onCopied(act.text, true)) }, 'Copy prompt') : null));
    })) : h(F.StateNotice, { small: true, state: 'empty', stamp: 'Ổn', title: 'Không có bất thường' }, 'Runtime của mọi agent khớp bản ghi ở lần status check gần nhất.'),
    h('div', { className: 'fm-grid c2', style: { marginTop: 24 } },
      h('div', null,
        h(F.SectionHeader, { title: 'Notice chưa báo', meta: untold.length }),
        untold.length ? table(['Task', 'Sự kiện'], untold.map((u) => h('tr', { key: u.key },
          h('td', null, u.taskId ? link(u.taskId, onOpen) : '—'), h('td', { className: 'mono' }, u.kind + (u.type ? ' · ' + u.type : ''), h('div', { className: 'fm-faint', style: { fontSize: 12 } }, u.key)))), { compact: true }) : h('p', { className: 'fm-faint' }, 'Không có.')),
      h('div', null,
        h(F.SectionHeader, { title: 'Outbox', meta: outbox.length }),
        outbox.length ? table(['Message', 'Trạng thái', { label: 'Lúc', r: true }], outbox.map((m) => h('tr', { key: m.id, className: m.state === 'pending' ? 'warn' : '' },
          h('td', { className: 'mono' }, m.id, h('div', { className: 'fm-faint', style: { fontSize: 12 } }, m.kind + (m.note ? ' · ' + m.note : ''))),
          h('td', null, h(F.StatusLabel, { tone: messageTone(m.state), size: 'sm' }, m.state)), h('td', { className: 'r mono' }, m.at ? clock(m.at) : '—'))), { compact: true }) : h('p', { className: 'fm-faint' }, 'Outbox trống.'))));
}

// ================= Projects & leases =================
export function Projects({ tasks, now, snap, onOpen }) {
  const leases = [];
  tasks.forEach((t) => t.lease.forEach((l) => leases.push({ ...l, task: t })));
  const deps = tasks.filter((t) => (t.dependencies || []).length);
  const projects = (snap.projects || []).slice();
  tasks.forEach((t) => { if (!projects.find((p) => p.id === t.projectId)) projects.push({ id: t.projectId, name: t.projectId, root: '—', vcs: 'git', enabled: true }); });
  return h('div', null,
    h(F.PageHeader, { no: '06', eyebrow: 'Hệ thống', title: 'Dự án & lease', id: 'page-title' }),
    projects.length ? h('div', { className: 'fm-grid c3' }, projects.map((p) => {
      const mine = tasks.filter((t) => t.projectId === p.id);
      const by = M.counts(mine, now).by;
      const live = mine.filter((t) => t.endpoint).length;
      return h(F.Card, { key: p.id, title: p.name, end: p.enabled ? 'đang bật' : 'tắt' },
        h(F.KeyValue, { items: [['ID', p.id, true], ['Root', p.root, true], ['VCS', p.vcs === 'git' ? 'git' : 'không dùng git'], ['Agent', live + ' đang giữ task']] }),
        h('div', { className: 'fm-chipgroup', style: { marginTop: 10 } }, M.GROUPS.map((g) => (by[g.key].length ? h(F.StatusLabel, { key: g.key, tone: g.tone, size: 'sm' }, by[g.key].length + ' ' + g.label.toLowerCase()) : null)),
          mine.length ? null : h('span', { className: 'fm-faint', style: { fontSize: 12 } }, 'Không có task.')));
    })) : h('p', { className: 'fm-faint' }, 'Chưa có dự án nào được đăng ký.'),
    h(F.SectionHeader, { title: 'Lease', meta: leases.length + ' claim', hint: 'vàng = chồng lấn với task khác' }),
    leases.length ? table(['Tài nguyên', 'Quyền', 'Task', 'Trạng thái', 'Chồng lấn'], leases.sort((a, b) => a.task.projectId.localeCompare(b.task.projectId) || a.key.localeCompare(b.key)).map((l, i) => {
      const overlaps = l.overlaps || [];
      return h('tr', { key: i, className: overlaps.length ? 'warn' : '' },
        h('td', { className: 'mono' }, l.key, h('div', { className: 'fm-faint', style: { fontSize: 12 } }, l.task.projectId)),
        h('td', null, h('span', { className: cx('fm-ttag', l.mode === 'read' && 'scout') }, l.mode)),
        h('td', null, link(l.task.taskId, onOpen)),
        h('td', null, h(F.StatusLabel, { status: M.statusKey(l.task), size: 'sm' })),
        h('td', null, overlaps.length ? h('span', { style: { color: 'var(--mustard-deep)', fontWeight: 700 } }, 'chồng ' + overlaps.join(', ')) : h('span', { className: 'fm-faint' }, '—')));
    })) : h('p', { className: 'fm-faint' }, 'Không có lease nào đang giữ.'),
    h(F.SectionHeader, { title: 'Phụ thuộc', meta: deps.length }),
    deps.length ? h('div', { className: 'fm-grid c2' }, deps.map((t) => h(F.Card, { key: t.taskId, flat: true },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        link(t.taskId, onOpen), h(F.StatusLabel, { status: M.statusKey(t), size: 'sm' }), h('span', { className: 'fm-faint' }, 'chờ'),
        t.dependencies.map((d) => { const o = tasks.find((x) => x.taskId === d); return h(Fragment, { key: d }, o ? link(d, onOpen) : h('b', { className: 'fm-mono' }, d), o ? h(F.StatusLabel, { status: M.statusKey(o), size: 'sm' }) : h('span', { className: 'fm-faint' }, 'đã kết thúc')); })),
      h('p', { style: { margin: '6px 0 0', fontSize: 13 } }, t.title)))) : h('p', { className: 'fm-faint' }, 'Không có task nào đang chờ task khác.'));
}

// ================= Token & cache =================
// Foreman has no source of worker token usage yet (#28), so nothing here is a number until one exists.
export function Tokens() {
  return h('div', null,
    h(F.PageHeader, { no: '07', eyebrow: 'Chi phí', title: 'Token & cache', id: 'page-title' }),
    h(F.Banner, { tone: 'mustard', lead: 'Chưa có nguồn số liệu' }, 'Foreman chưa ghi token usage của worker (#28), nên mọi số liệu ở đây hiện “—” thay vì số đoán.'),
    h('div', { style: { height: 16 } }),
    h(F.KpiStrip, { label: 'Tuần này', items: [
      { label: 'Token tuần này', value: null, sub: 'chưa có nguồn' },
      { label: 'Cache hit', value: null, sub: 'chưa có nguồn' },
      { label: 'Resend full context', value: null, sub: 'chưa có nguồn' },
      { label: 'Task tốn nhất', value: null, sub: 'chưa có nguồn' }
    ] }),
    h('div', { className: 'fm-grid c2', style: { marginTop: 24 } },
      h('div', null, h(F.SectionHeader, { title: 'Token theo ngày' }), h(F.StateNotice, { small: true, state: 'empty', stamp: '—', title: 'Chưa có số liệu' }, 'Sẽ hiện khi Foreman có nguồn token usage.')),
      h('div', null, h(F.SectionHeader, { title: 'Cache hit theo ngày' }), h(F.StateNotice, { small: true, state: 'empty', stamp: '—', title: 'Chưa có số liệu' }, 'Sẽ hiện khi Foreman có nguồn token usage.'))));
}

// ================= Settings =================
export function Settings({ tasks, snap, prefs, setPrefs, themePref, setThemePref, notifyState, onNotify }) {
  const server = snap.server || {};
  const profiles = snap.profiles || [];
  const row = (label, control) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, h('span', { className: 'fm-h4', style: { border: 0, margin: 0, padding: 0, minWidth: 120 } }, label), control);
  return h('div', null,
    h(F.PageHeader, { no: '08', eyebrow: 'Hệ thống', title: 'Cài đặt', id: 'page-title' }),
    h('div', { className: 'fm-grid c2' },
      h(F.Card, { title: 'Hiển thị', end: 'lưu ở trình duyệt' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          row('Theme', h(F.Segmented, { label: 'Theme', value: themePref, onChange: setThemePref, options: [{ value: 'system', label: 'Theo máy' }, { value: 'light', label: 'Sáng' }, { value: 'dark', label: 'Tối' }] })),
          row('Mật độ thẻ', h(F.Segmented, { label: 'Mật độ', value: prefs.density, onChange: (v) => setPrefs({ density: v }), options: [{ value: 'comfortable', label: 'Thoáng' }, { value: 'compact', label: 'Gọn' }] })),
          h(F.Toggle, { checked: prefs.showLanes, onChange: (v) => setPrefs({ showLanes: v }) }, 'Hiện agent trên Tổng quan'),
          h(F.Toggle, { checked: prefs.markNew, onChange: (v) => setPrefs({ markNew: v }) }, 'Chấm xanh cho report mới chưa xem'),
          h(F.Toggle, { checked: prefs.titleCount, onChange: (v) => setPrefs({ titleCount: v }) }, 'Số việc chờ bạn trên tiêu đề tab'),
          h('div', null,
            h(F.Toggle, { checked: prefs.notify && notifyState === 'granted', disabled: notifyState === 'unsupported' || notifyState === 'denied', onChange: (v) => onNotify(v) }, 'Thông báo trình duyệt khi có việc mới chờ bạn'),
            h('p', { className: 'fm-faint', style: { fontSize: 12, margin: '4px 0 0 48px' } }, notifyState === 'denied' ? 'Trình duyệt đang chặn thông báo cho trang này.' : notifyState === 'unsupported' ? 'Trình duyệt này không hỗ trợ thông báo.' : 'Chỉ báo việc chờ bạn và bất thường mới.')))),
      h(F.Card, { title: 'Nguồn dữ liệu', end: 'chỉ đọc' }, h(F.KeyValue, { items: [
        ['FOREMAN_HOME', snap.home, true],
        ['Server', 'foreman dashboard serve · ' + (server.bind || '127.0.0.1') + ':' + (server.port || '—'), true],
        ['Cập nhật', 'SSE · fallback poll 5 giây'],
        ['Quyền', 'Chỉ đọc'],
        ['Ngưỡng không hoạt động', M.THRESHOLDS.silentMin + ' phút'],
        ['Quá hạn', 'chờ bạn quá ' + M.THRESHOLDS.overdueHours + ' giờ'],
        snap.router ? ['Router', snap.router.tool + (snap.router.model ? ' · ' + snap.router.model : ''), true] : null
      ] }))),
    h(F.SectionHeader, { title: 'Routing profile', meta: profiles.filter((p) => p.active).length + ' đang bật', hint: 'config/model-routing.json' }),
    profiles.length ? table(['Profile', 'Group', 'Tool', 'Model', 'Effort', { label: 'Task', r: true }, 'Ghi chú'], profiles.map((p) => h('tr', { key: p.name, className: p.active ? '' : 'off' },
      h('td', { className: 'mono' }, h('b', null, p.name), p.isDefault ? h('span', { className: 'fm-ttag', style: { marginLeft: 6 } }, 'default') : null),
      h('td', null, p.group || '—'), h('td', { className: 'mono' }, p.tool), h('td', { className: 'mono' }, p.model || '—'), h('td', { className: 'mono' }, p.effort || '—'),
      h('td', { className: 'r mono' }, tasks.filter((t) => t.profile === p.name && t.endpoint).length), h('td', null, p.active ? p.note : 'Đang tắt.')))) : h('p', { className: 'fm-faint' }, 'Không đọc được config/model-routing.json.'),
    h(F.SectionHeader, { title: 'Phím tắt' }),
    h(F.Card, null, h(F.KeyHelp, { groups: KEYS })));
}

export const KEYS = [
  { title: 'Chung', keys: [['Ctrl K', 'Tìm task hoặc màn hình'], ['/', 'Tìm nhanh'], ['?', 'Bảng phím tắt'], ['Esc', 'Đóng lớp phủ']] },
  { title: 'Đi tới', keys: [['G B', 'Tổng quan'], ['G I', 'Chờ bạn'], ['G A', 'Task'], ['G T', 'Timeline'], ['G H', 'Health'], ['G P', 'Dự án & lease'], ['G K', 'Token & cache'], ['G S', 'Cài đặt']] },
  { title: 'Tổng quan', keys: [['J', 'Task kế tiếp'], ['K', 'Task trước'], ['Enter', 'Xem nhanh task'], ['Shift Enter', 'Mở trang task']] }
];
