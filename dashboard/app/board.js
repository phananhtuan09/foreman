import { h, frag, F, useState, useMemo } from './react.js';
import * as M from './model.js';
import { Markdown } from './markdown.js';

const { STATUS, POINT_KIND, dur, ago, clock, dateLabel, cx } = F;

export function runtimeBadge(t) {
  if (t.runtime === null || t.runtime === undefined) return t.endpoint ? h('span', { className: 'fm-faint', style: { fontSize: 12 } }, 'chưa có status check') : null;
  return t.runtime === 'none' ? null : h(F.RuntimeBadge, { state: t.runtime });
}

// Foreman's report of the task exactly as the Foreman session showed it: the result, then its next-action block.
export function ForemanReport({ report, now }) {
  if (!report) return h('p', { className: 'fm-faint', style: { margin: 0, fontSize: 13 } }, 'Chưa có báo cáo của Foreman.');
  return h('div', { className: 'fm-freport' }, h(Markdown, { text: report.summary + (report.line ? '\n\n' + report.line : '') }),
    report.at ? h('div', { className: 'when' }, clock(report.at) + ' · ' + ago(report.at, now)) : null);
}

export function latestForemanReport(t) { const list = t.foremanReports || []; return list.length ? list[list.length - 1] : null; }

// ---------- Peek: the selected task, readable without leaving the board
export function TaskPeek({ t, all, now, onOpenFull, onOpenInbox, onClose }) {
  if (!t) return h(F.Pane, { label: 'Chi tiết task' }, h(F.StateNotice, { state: 'empty', small: true, title: 'Chọn một task', stamp: 'Trống' }, 'Bấm một task để xem nhanh ở đây.'));
  const k = M.statusKey(t), a = M.anomalyOf(t, now);
  const fr = latestForemanReport(t);
  const said = t.rounds.find((r) => r.original);
  const pts = t.attention || [];
  const open = pts.filter((p) => p.state === 'open');
  const head = frag(
    h('div', { className: 'l1' },
      h('span', { className: 'tid' }, t.taskId), h(F.TypeTag, { type: t.type }), h(F.StatusLabel, { status: k }),
      h('span', { className: 'end' },
        h(F.Button, { variant: 'flat', size: 'sm', onClick: () => onOpenFull(t.taskId), 'aria-label': 'Mở trang chi tiết ' + t.taskId }, 'Mở trang ↗'),
        onClose ? h(F.Button, { variant: 'flat', size: 'sm', onClick: onClose, 'aria-label': 'Đóng' }, '✕') : null)),
    h('div', { className: 'ttl' }, t.title),
    h('div', { className: 'meta' }, h(F.ProjectTag, null, t.projectId), t.profile ? h('span', null, t.profile) : null, t.backend ? h(F.BackendTag, { backend: M.cap(t.backend) }) : null, runtimeBadge(t), h('span', null, 'R' + t.round + (t.generation > 1 ? ' · G' + t.generation : '')))
  );
  return h(F.Pane, { label: 'Chi tiết ' + t.taskId, head, foot: h('span', { className: 'fm-faint' }, 'Hoạt động cuối ' + ago(t.lastActivityAt, now)) },
    a.issues.length ? h('div', { className: 'fm-sec' }, h(F.Callout, { variant: 'warn', lead: a.issues[0].label + ':' }, a.issues.map((i) => i.explain).join(' '))) : null,
    h(F.Section, { title: 'Báo cáo của Foreman', end: fr ? 'round ' + fr.round : null }, h(ForemanReport, { report: fr, now }),
      onOpenInbox && M.groupOf(t, now) === 'you' ? h('div', { style: { marginTop: 6, textAlign: 'right' } }, h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => onOpenInbox(t.taskId + ':' + k) }, 'Mở trong Chờ bạn →')) : null),
    said ? h(F.Section, { title: 'Yêu cầu của bạn', end: 'round ' + said.round }, h(F.Quote, null, said.original)) : null,
    h(F.Section, { title: 'Attention', end: open.length + ' mở · ' + (pts.length - open.length) + ' đã đóng' },
      h(F.PointList, { points: pts.filter((p) => p.state === 'open' || p.state === 'snoozed').concat(pts.filter((p) => p.state !== 'open' && p.state !== 'snoozed')), kinds: POINT_KIND, now })),
    h(F.Section, { title: 'Workspace & lease' },
      h(F.KeyValue, { items: [
        ['Workspace', t.workspace || 'chưa có', true],
        t.branch ? ['Branch', t.branch, true] : null,
        ['Lease', t.lease.length ? t.lease.map((l) => l.mode + ' ' + l.key).join('\n') : '—', true],
        t.leaseOverlap ? ['Chồng lấn', h('span', { style: { color: 'var(--mustard-deep)', fontWeight: 600 } }, 'với ' + t.leaseOverlap)] : null,
        t.endpoint ? ['Endpoint', t.endpoint + ' · gen ' + t.generation, true] : null,
        (t.dependencies || []).length ? ['Phụ thuộc', t.dependencies.join(', '), true] : null
      ] })));
}

// ---------- Board
// Kanban columns follow a task's flow; a running task with an anomaly stays in its column with a mustard card.
const COLUMNS = [
  { key: 'queue', label: 'Hàng chờ', tone: 'ink', statuses: ['routing', 'queued'] },
  { key: 'run', label: 'Đang làm', tone: 'blue', statuses: ['pending', 'working'] },
  { key: 'you', label: 'Cần bạn', tone: 'red', statuses: ['waiting-decision', 'blocked', 'choose-model'] },
  { key: 'review', label: 'Chờ duyệt', tone: 'green', statuses: ['review-ready'] }
];

function columnTasks(col, list, now) {
  const mine = list.filter((t) => col.statuses.includes(M.statusKey(t)));
  if (col.key === 'run') return M.sortGroup('anomaly', mine.filter((t) => M.anomalyOf(t, now).any)).concat(M.sortGroup('run', mine.filter((t) => !M.anomalyOf(t, now).any)));
  return M.sortGroup(col.key === 'queue' ? 'queue' : 'you', mine);
}

function TaskCard({ t, now, all, selected, onSelect, onOpen, isNew, flash, dense }) {
  const line = M.rowLine(t, now, all), age = M.ageOf(t, now), open = M.openPoints(t), user = open.filter((p) => p.owner === 'user').length;
  const profile = t.profile || (t.routingProfile ? t.routingProfile + '?' : null);
  const key = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey ? onOpen : onSelect)(t.taskId); }
    if (e.key === ' ') { e.preventDefault(); onSelect(t.taskId); }
  };
  return h('li', { className: cx('fm-kcard', M.groupOf(t, now) === 'anomaly' && 'warn', flash && 'flash', dense && 'dense'), tabIndex: 0, 'data-task': t.taskId,
    'aria-current': selected ? 'true' : undefined, 'aria-label': t.taskId + ' — ' + t.title + ' — ' + STATUS[M.statusKey(t)].label,
    onClick: () => onSelect(t.taskId), onDoubleClick: () => onOpen(t.taskId), onKeyDown: key },
    h('div', { className: 'top' }, h('span', { className: 'tid' }, t.taskId), isNew ? h('span', { className: 'fm-newdot', title: 'Có report mới chưa xem' }) : null, h(F.TypeTag, { type: t.type })),
    h('div', { className: 'tt', title: t.title }, t.title),
    line.text || line.lead ? h('div', { className: 'tm' }, line.lead ? h('span', { className: line.kind }, line.lead) : null, line.text) : null,
    h('div', { className: 'meta' }, h(F.StatusLabel, { status: M.statusKey(t), size: 'sm' }), h(F.ProjectTag, null, t.projectId), profile ? h('span', null, profile + ' · R' + t.round + (t.generation > 1 ? '·G' + t.generation : '')) : null,
      t.backend ? h(F.BackendTag, { backend: M.cap(t.backend) }) : null, t.runtime && t.runtime !== 'none' ? h(F.RuntimeBadge, { state: t.runtime }) : null),
    h('div', { className: 'foot' }, h('span', { className: cx('age', age.tone) }, age.text),
      open.length ? h('span', { className: cx('pts', user && 'u'), title: 'Attention đang mở' }, user ? user + ' attention cho bạn' : open.length + ' attention') : null));
}

const AGENT_COLUMNS = [
  { key: 'running', label: 'Đang chạy', tone: 'blue', states: ['working', 'none'] },
  { key: 'idle', label: 'Idle', tone: 'ink', states: ['idle'] },
  { key: 'input', label: 'Chờ input', tone: 'mustard', states: ['waiting-input'] },
  { key: 'unclear', label: 'Không rõ / mất', tone: 'mustard', states: ['unknown', 'mismatch', 'dead', 'missing'] }
];

function Kanban({ label, columns }) {
  return h('div', { className: 'fm-kanwrap' }, h('div', { className: 'fm-kanban', role: 'region', 'aria-label': label },
    columns.map((col) => h('section', { key: col.key, className: cx('fm-kcol', 't-' + col.tone), 'aria-label': col.label },
      h('h3', null, h('span', { className: 'gsw', 'aria-hidden': 'true' }), h('span', { className: 'gname' }, col.label), h('span', { className: 'fm-count' }, col.items.length)),
      col.items.length ? h('ul', null, col.items) : h('p', { className: 'empty' }, 'Không có.')))));
}

export function Board({ tasks, now, selected, onSelect, onOpenFull, onOpenInbox, prefs, setPrefs, wide, flashId, isNew, banners }) {
  const [proj, setProj] = useState('all');
  const [q, setQ] = useState('');
  const search = useMemo(() => q.trim().toLowerCase(), [q]);
  const visible = tasks.filter((t) => (proj === 'all' || t.projectId === proj) && (!search || (t.taskId + ' ' + t.title + ' ' + (t.profile || '') + ' ' + t.projectId).toLowerCase().indexOf(search) >= 0));
  const all = M.counts(tasks, now).by;
  const agents = tasks.filter((t) => t.endpoint || t.status === 'pending').sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const slot = (t) => {
    const a = M.anomalyOf(t, now), ms = now - t.lastActivityAt, held = M.groupOf(t, now) === 'you';
    return h('li', { key: t.taskId }, h(F.WorkerSlot, { id: t.taskId, title: t.title, profile: (t.profile || '—') + ' · R' + t.round, backend: t.backend ? M.cap(t.backend) : null,
      runtime: t.status === 'pending' ? 'none' : M.runtimeOf(t), tone: a.any ? 'mustard' : null, held,
      quiet: t.status === 'pending' ? 'đang dispatch' : held ? STATUS[M.statusKey(t)].label.toLowerCase() + ' · ' + dur(now - t.statusSince) : ago(t.lastActivityAt, now),
      quietRatio: ms / (M.THRESHOLDS.silentMin * 60000), quietWarn: a.silent || a.issues.length > 0,
      selected: selected === t.taskId, onSelect: () => onSelect(t.taskId), isNew: prefs.markNew && isNew(t) }));
  };
  const agentColumns = AGENT_COLUMNS.map((col) => ({ ...col, items: agents.filter((t) => col.states.includes(t.status === 'pending' ? 'none' : M.runtimeOf(t))).map(slot) }));
  const projects = Array.from(new Set(tasks.map((t) => t.projectId)));
  const oldest = all.you.length ? M.ageOf(M.sortGroup('you', all.you)[0], now).text.replace('chờ bạn ', '') : null;
  return h('div', { className: cx(wide && 'fm-board') },
    h('div', { style: { minWidth: 0 } },
      h(F.PageHeader, { no: '01', eyebrow: dateLabel(now) + ' · ' + clock(now), title: 'Tổng quan', id: 'page-title',
        lede: (all.you.length ? all.you.length + ' việc chờ bạn, lâu nhất ' + oldest : 'Không có việc chờ bạn') + ' · ' + (all.anomaly.length ? all.anomaly.length + ' bất thường' : 'không có bất thường') + ' · ' + all.run.length + ' agent đang chạy.' }),
      banners,
      prefs.showLanes ? frag(
        h(F.SectionHeader, { title: 'Agent', meta: agents.length + ' endpoint', end: h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => setPrefs({ showLanes: false }) }, 'Thu gọn') }),
        h(Kanban, { label: 'Agent theo runtime state', columns: agentColumns })
      ) : null,
      h(F.SectionHeader, { title: 'Task', meta: visible.length < tasks.length ? visible.length + ' / ' + tasks.length : tasks.length, end: prefs.showLanes ? null : h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => setPrefs({ showLanes: true }) }, 'Hiện agent') }),
      h('div', { className: 'fm-toolbar' },
        h(F.FilterChips, { label: 'Dự án', value: proj, onChange: setProj, options: [{ value: 'all', label: 'Tất cả' }].concat(projects.map((p) => ({ value: p, label: p, count: tasks.filter((t) => t.projectId === p).length }))) }),
        h('span', { className: 'end' },
          h(F.SearchField, { value: q, onChange: setQ, inputRef: null }),
          h(F.Segmented, { label: 'Mật độ thẻ', value: prefs.density, onChange: (v) => setPrefs({ density: v }), options: [{ value: 'comfortable', label: 'Thoáng' }, { value: 'compact', label: 'Gọn' }] }))),
      !tasks.length || (q && !visible.length) ? h('p', { className: 'fm-faint', style: { fontSize: 13 } }, q ? 'Không có task nào khớp “' + q + '”.' : 'Không có task. Giao việc trong phiên Foreman, task sẽ hiện ở đây.') : null,
      h(Kanban, { label: 'Task chưa accept, chia cột theo trạng thái', columns: COLUMNS.map((col) => ({ ...col, items: columnTasks(col, visible, now).map((t) => h(TaskCard, { key: t.taskId, t, now, all: tasks,
        selected: selected === t.taskId, onSelect, onOpen: onOpenFull, isNew: prefs.markNew && isNew(t), flash: flashId === t.taskId, dense: prefs.density === 'compact' })) })) }),
      h('p', { className: 'fm-faint', style: { fontSize: 12, margin: '8px 0 0' } }, h('span', { className: 'fm-newdot', style: { marginRight: 4 } }), ' report mới chưa xem')),
    wide ? h('aside', { className: 'side', 'aria-label': 'Task đang chọn' }, h(TaskPeek, { t: tasks.find((t) => t.taskId === selected), all: tasks, now, onOpenFull, onOpenInbox })) : null);
}
