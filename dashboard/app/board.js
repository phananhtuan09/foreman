import { h, frag, F, useState, useMemo } from './react.js';
import * as M from './model.js';

const { STATUS, POINT_KIND, dur, ago, clock, dateLabel, cx } = F;

export function runtimeBadge(t) {
  if (t.runtime === null || t.runtime === undefined) return t.endpoint ? h('span', { className: 'fm-faint', style: { fontSize: 12 } }, 'chưa có status check') : null;
  return t.runtime === 'none' ? null : h(F.RuntimeBadge, { state: t.runtime });
}

// ---------- Peek: the selected task, readable without leaving the board
export function TaskPeek({ t, all, now, onOpenFull, onOpenInbox, onClose, onCopied }) {
  if (!t) return h(F.Pane, { label: 'Chi tiết task' }, h(F.StateNotice, { state: 'empty', small: true, title: 'Chọn một task', stamp: 'Trống' }, 'Bấm một task để xem nhanh ở đây.'));
  const k = M.statusKey(t), act = M.actionsFor(t, now), a = M.anomalyOf(t, now);
  const rep = M.lastReport(t);
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
    h('div', { className: 'fm-sec' },
      h(F.NextBox, { tone: act.tone, title: act.title, why: act.why, copy: act.text || act.cli ? { text: act.text, cli: act.cli, quiet: act.quiet, onCopied } : null }, act.what),
      act.alt ? h('div', { style: { marginTop: 8 } }, h(F.CopyCommand, { quiet: true, label: 'Hoặc', text: act.alt.text, cli: act.alt.cli, onCopied })) : null,
      onOpenInbox && M.groupOf(t, now) === 'you' ? h('div', { style: { marginTop: 6, textAlign: 'right' } }, h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => onOpenInbox(t.taskId + ':' + k) }, 'Mở trong Chờ bạn →')) : null),
    a.issues.length > 1 ? h('div', { className: 'fm-sec' }, h(F.Callout, { variant: 'warn', lead: 'Còn:' }, a.issues.slice(1).map((i) => i.label).join(' · '))) : null,
    rep ? h(F.Section, { title: 'Report mới nhất', end: 'round ' + rep.round }, h(F.Report, { status: rep.status, when: clock(rep.at) + ' · ' + ago(rep.at, now), summary: rep.summary, steps: rep.steps }))
      : h(F.Section, { title: 'Report mới nhất' }, h('p', { className: 'fm-faint', style: { margin: 0, fontSize: 13 } }, 'Chưa có report.')),
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
export function Board({ tasks, now, selected, onSelect, onOpenFull, onOpenInbox, onCopied, prefs, setPrefs, wide, flashId, isNew }) {
  const [filter, setFilter] = useState(null);
  const [proj, setProj] = useState('all');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const search = useMemo(() => q.trim().toLowerCase(), [q]);
  const visible = tasks.filter((t) => (proj === 'all' || t.projectId === proj) && (!search || (t.taskId + ' ' + t.title + ' ' + (t.profile || '') + ' ' + t.projectId).toLowerCase().indexOf(search) >= 0));
  const { by } = M.counts(visible, now);
  const all = M.counts(tasks, now).by;
  const youOverdue = all.you.some((t) => now - t.statusSince > M.THRESHOLDS.overdueHours * 3600000);
  const anomalyTypes = all.anomaly.map((t) => { const a = M.anomalyOf(t, now); return a.issues.length ? a.issues[0].label.toLowerCase() : 'không hoạt động lâu'; });
  const counters = [
    { id: 'you', label: 'Chờ bạn', tone: 'red', value: all.you.length, sub: M.youSummary(all.you), hot: youOverdue },
    { id: 'anomaly', label: 'Bất thường', tone: 'mustard', value: all.anomaly.length, sub: anomalyTypes.join(' · ') || 'không có' },
    { id: 'run', label: 'Đang chạy', tone: 'blue', value: all.run.length, sub: ['paseo', 'herdr'].map((b) => [all.run.filter((t) => t.backend === b).length, b]).filter((x) => x[0]).map((x) => x[0] + ' ' + M.cap(x[1])).join(' · ') || 'không có' },
    { id: 'queue', label: 'Hàng chờ', tone: 'ink', value: all.queue.length, sub: [[all.queue.filter((t) => (t.dependencies || []).length).length, 'chờ phụ thuộc'], [all.queue.filter((t) => t.status === 'routing').length, 'đang routing'], [all.queue.filter((t) => t.status === 'queued' && !(t.dependencies || []).length).length, 'chờ slot']].filter((x) => x[0]).map((x) => x[0] + ' ' + x[1]).join(' · ') || 'trống' }
  ];
  const groups = M.GROUPS.filter((g) => !filter || g.key === filter).map((g) => ({
    ...g,
    rows: M.sortGroup(g.key, by[g.key]).map((t) => {
      const line = M.rowLine(t, now, tasks);
      const open = M.openPoints(t);
      return {
        id: t.taskId, type: t.type, isNew: prefs.markNew && isNew(t), flash: flashId === t.taskId, title: t.title,
        line: frag(line.lead ? h('span', { className: line.kind }, line.lead) : null, line.text),
        project: t.projectId, profile: t.profile || (t.routingProfile ? t.routingProfile + '?' : null), backend: t.backend ? M.cap(t.backend) : null,
        runtime: t.runtime, round: t.round, generation: t.generation, age: M.ageOf(t, now),
        points: { open: open.length, user: open.filter((p) => p.owner === 'user').length }, status: M.statusKey(t)
      };
    })
  }));
  const withEndpoint = tasks.filter((t) => t.endpoint || t.status === 'pending');
  const working = withEndpoint.filter((t) => ['run', 'anomaly'].includes(M.groupOf(t, now))).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const held = withEndpoint.filter((t) => M.groupOf(t, now) === 'you').sort((a, b) => a.statusSince - b.statusSince);
  const slot = (t) => {
    const a = M.anomalyOf(t, now), ms = now - t.lastActivityAt;
    return h(F.WorkerSlot, { key: t.taskId, id: t.taskId, title: t.title, profile: (t.profile || '—') + ' · R' + t.round, backend: t.backend ? M.cap(t.backend) : null,
      runtime: t.status === 'pending' ? 'none' : M.runtimeOf(t), tone: a.any ? 'mustard' : null,
      quiet: t.status === 'pending' ? 'đang dispatch' : ago(t.lastActivityAt, now), quietRatio: ms / (M.THRESHOLDS.silentMin * 60000), quietWarn: a.silent || a.issues.length > 0,
      selected: selected === t.taskId, onSelect: () => onSelect(t.taskId), isNew: prefs.markNew && isNew(t) });
  };
  const projects = Array.from(new Set(tasks.map((t) => t.projectId)));
  const oldest = all.you.length ? M.ageOf(M.sortGroup('you', all.you)[0], now).text.replace('chờ bạn ', '') : null;
  return h('div', { className: cx(wide && 'fm-board') },
    h('div', { style: { minWidth: 0 } },
      h(F.PageHeader, { no: '01', eyebrow: dateLabel(now) + ' · ' + clock(now), title: 'Tổng quan', id: 'page-title',
        lede: (all.you.length ? all.you.length + ' việc chờ bạn, lâu nhất ' + oldest : 'Không có việc chờ bạn') + ' · ' + (all.anomaly.length ? all.anomaly.length + ' bất thường' : 'không có bất thường') + ' · ' + all.run.length + ' agent đang chạy.' }),
      h(F.CounterBar, { items: counters, value: filter, onChange: setFilter }),
      prefs.showLanes ? frag(
        h(F.SectionHeader, { title: 'Agent', meta: working.length + held.length + ' endpoint', end: h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => setPrefs({ showLanes: false }) }, 'Thu gọn') }),
        h(F.LaneGroup, { label: 'Đang làm', count: working.length }, working.length ? working.map(slot) : h('p', { className: 'fm-faint', style: { margin: 0, fontSize: 13 } }, 'Không có agent đang làm.')),
        held.length ? h(F.LaneGroup, { compact: true, label: 'Đang chờ bạn', count: held.length }, held.map((t) => h(F.HeldChip, { key: t.taskId, id: t.taskId, status: M.statusKey(t), wait: dur(now - t.statusSince), urgent: STATUS[M.statusKey(t)].tone === 'red', selected: selected === t.taskId, onSelect: () => onSelect(t.taskId), isNew: prefs.markNew && isNew(t) }))) : null
      ) : null,
      h(F.SectionHeader, { title: 'Task', meta: visible.length < tasks.length ? visible.length + ' / ' + tasks.length : tasks.length, end: prefs.showLanes ? null : h(F.Button, { variant: 'ghost', size: 'sm', onClick: () => setPrefs({ showLanes: true }) }, 'Hiện agent') }),
      h('div', { className: 'fm-toolbar' },
        h(F.FilterChips, { label: 'Dự án', value: proj, onChange: setProj, options: [{ value: 'all', label: 'Tất cả' }].concat(projects.map((p) => ({ value: p, label: p, count: tasks.filter((t) => t.projectId === p).length }))) }),
        h('span', { className: 'end' },
          h(F.SearchField, { value: q, onChange: setQ, inputRef: null }),
          h(F.Segmented, { label: 'Mật độ bảng', value: prefs.density, onChange: (v) => setPrefs({ density: v }), options: [{ value: 'comfortable', label: 'Thoáng' }, { value: 'compact', label: 'Gọn' }] }))),
      filter ? h('div', { style: { marginBottom: 8 } }, h(F.Banner, { tone: 'ink', lead: 'Đang lọc:', actions: h(F.Button, { variant: 'flat', size: 'sm', onClick: () => setFilter(null) }, 'Bỏ lọc ✕') }, 'nhóm “' + M.GROUPS.find((g) => g.key === filter).label + '”.')) : null,
      h(F.FleetTable, { groups, selected, onSelect, onOpen: onOpenFull, dense: prefs.density === 'compact', layout: prefs.cards ? 'cards' : 'table',
        collapsed, onToggle: (k) => setCollapsed({ ...collapsed, [k]: !collapsed[k] }), caption: 'Tất cả task chưa accept, nhóm theo việc cần làm',
        emptyText: q ? 'Không có task nào khớp “' + q + '”.' : 'Không có task. Giao việc trong phiên Foreman, task sẽ hiện ở đây.' }),
      h('p', { className: 'fm-faint', style: { fontSize: 12, margin: '8px 0 0' } }, h('span', { className: 'fm-newdot', style: { marginRight: 4 } }), ' report mới chưa xem')),
    wide ? h('aside', { className: 'side', 'aria-label': 'Task đang chọn' }, h(TaskPeek, { t: tasks.find((t) => t.taskId === selected), all: tasks, now, onOpenFull, onOpenInbox, onCopied })) : null);
}
