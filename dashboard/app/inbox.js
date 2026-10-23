import { h, frag, F, Fragment, useState, useEffect, useRef } from './react.js';
import * as M from './model.js';
import { ForemanReport, latestForemanReport } from './board.js';

const { POINT_KIND, dur, ago } = F;

const KINDS = [
  { key: 'waiting-decision', label: 'Quyết định' },
  { key: 'blocked', label: 'Bị chặn' },
  { key: 'choose-model', label: 'Chọn model' },
  { key: 'review-ready', label: 'Chờ duyệt' }
];

const ORDERS = [{ value: 'age', label: 'Lâu nhất' }, { value: 'quick', label: 'Nhanh trước' }, { value: 'risk', label: 'Rủi ro trước' }];

// Plain weights meant to be tuned with use: quick favours small first-round work with nothing open,
// risk favours shipped code, wide writes, lease overlaps, and rework. An unmeasured size counts as a medium review.
function weigh(t, order) {
  const c = t.reviewChange, size = c ? c.files + c.lines / 50 : 5, rework = Math.max(0, t.round - 1), points = M.openPoints(t).length;
  if (order === 'quick') return size + 2 * rework + 3 * points;
  return (t.type === 'ship' ? 3 : 0) + size + t.lease.filter((l) => l.mode === 'write').length + (t.leaseOverlap ? 5 : 0) + 2 * rework + 2 * points;
}
// What the order was based on, shown under the item so the position can be checked at a glance.
export function reason(t, order) {
  const c = t.reviewChange, points = M.openPoints(t).length, writes = t.lease.filter((l) => l.mode === 'write').length;
  return [order === 'risk' ? t.type : null, c ? c.files + ' file · ' + c.lines + ' dòng' : 'chưa đo cỡ, tính như review vừa', order === 'risk' && writes ? writes + ' lease ghi' : null,
    order === 'risk' && t.leaseOverlap ? 'lease chồng ' + t.leaseOverlap : null, t.round > 1 ? 'R' + t.round : null, points ? points + ' attention' : null].filter(Boolean).join(' · ');
}
export function byOrder(order) {
  if (order === 'age') return (a, b) => b.ms - a.ms;
  const sign = order === 'quick' ? 1 : -1;
  return (a, b) => sign * (weigh(a.task, order) - weigh(b.task, order)) || b.ms - a.ms;
}

// The order Chờ bạn lists items in: by kind, then by `order` within each kind.
const GROUPS = KINDS.concat([{ key: 'point', label: 'Attention' }]);
export const listOrder = (items, order) => GROUPS.reduce((out, g) => out.concat(items.filter((i) => i.kind === g.key).sort(byOrder(order))), []);

export function inboxItems(tasks, now, isNew) {
  const items = [];
  tasks.forEach((t) => {
    const k = M.statusKey(t);
    if (!KINDS.find((x) => x.key === k)) return;
    const d = M.pendingDecision(t), s = M.summaryLine(t);
    const q = k === 'waiting-decision' ? (d ? d.finding : 'Đã trả lời, chờ Foreman gửi agent') : k === 'blocked' ? (s ? s.text : 'Agent bị chặn') : k === 'choose-model' ? 'Chọn profile cho “' + t.title + '”' : (t.type === 'scout' ? 'Scout xong: ' : 'Xong: ') + t.title;
    const ms = now - t.statusSince;
    items.push({ key: t.taskId + ':' + k, id: t.taskId, kind: k, status: k, question: q, project: t.projectId, ms, age: dur(ms), urgent: k !== 'review-ready', isNew: isNew(t), task: t });
  });
  // User-owned open points on tasks that are not already in the inbox for their status.
  tasks.forEach((t) => {
    if (KINDS.find((x) => x.key === M.statusKey(t))) return;
    M.openPoints(t).filter((p) => p.owner === 'user').forEach((p) => items.push({ key: t.taskId + ':' + p.id, id: t.taskId, kind: 'point', status: M.statusKey(t), question: p.text, project: t.projectId, ms: now - p.since, age: dur(now - p.since), urgent: true, task: t, point: p }));
  });
  return items;
}

// `marks` comes from the load warning: an item over the wait limit of its kind is overdue, and one today's forecast leaves for tomorrow says so.
export function Inbox({ tasks, now, profiles, current, onPick, onOpenFull, isNew, order, onOrder, kind, setKind, marks }) {
  const items = inboxItems(tasks, now, isNew).map((i) => ({ ...i, late: Boolean(marks[i.key] && marks[i.key].over) }));
  const overdueCount = items.filter((i) => i.late).length;
  // The list's own overdue text is left off; badges pinned on the item's top edge carry overdue and tomorrow instead, clear of its text.
  const shown = (i) => { const r = order === 'age' ? '' : reason(i.task, order), m = marks[i.key] || {};
    const badges = m.over || m.later ? h('span', { className: 'fm-ibadges' }, m.over ? h('span', { className: 'fm-ibadge t-red' }, 'Quá hạn') : null, m.later ? h('span', { className: 'fm-ibadge t-blue' }, 'Để mai') : null) : null;
    return { ...i, project: h(Fragment, null, r ? i.project + ' · ' + r : i.project, badges) }; };
  const picked = (i, g) => i.kind === g.key && (kind === 'all' || kind === g.key || (kind === 'overdue' && i.late));
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((i) => picked(i, g)).sort(byOrder(order)).map(shown) })).filter((g) => g.items.length);
  const flat = groups.reduce((a, g) => a.concat(g.items), []);
  const cur = flat.find((i) => i.key === current) || flat[0];
  const oldest = items.slice().sort((a, b) => b.ms - a.ms)[0];
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (window.innerWidth < 900) { const el = document.querySelector('.fm-reader'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }, [current]);
  return h('div', null,
    h(F.PageHeader, { no: '02', eyebrow: 'Inbox', title: 'Chờ bạn', id: 'page-title', lede: items.length ? items.length + ' việc, lâu nhất ' + oldest.age + ' (' + oldest.id + ').' : 'Không có việc chờ bạn.' }),
    items.length === 0 ? h(F.StateNotice, { state: 'empty', stamp: 'Trống', title: 'Không có việc chờ bạn' }, 'Các agent đang tự chạy.') : frag(
      h('div', { className: 'fm-toolbar' }, h(F.FilterChips, { label: 'Loại', value: kind, onChange: setKind, options: [{ value: 'all', label: 'Tất cả', count: items.length }].concat(overdueCount || kind === 'overdue' ? [{ value: 'overdue', label: 'Quá hạn', count: overdueCount }] : []).concat(GROUPS.map((k) => ({ value: k.key, label: k.label, count: items.filter((i) => i.kind === k.key).length })).filter((o) => o.count)) }),
        h('span', { className: 'end' }, h(F.Segmented, { label: 'Thứ tự trong mỗi nhóm', value: order, onChange: onOrder, options: ORDERS }))),
      h('div', { className: 'fm-inbox' },
        h(F.InboxList, { groups, current: cur && cur.key, onPick }),
        cur ? h(Reader, { key: cur.key, item: cur, tasks, now, profiles, onOpenFull, marks }) : null)));
}

function Reader({ item, tasks, now, profiles, onOpenFull, marks }) {
  const t = item.task, k = item.kind;
  const fr = latestForemanReport(t);
  const head = h('div', { className: 'rhd' },
    h('div', { className: 'l1' }, h(F.StatusLabel, { status: item.status }), h('b', { className: 'fm-mono', style: { color: 'var(--ink)' } }, t.taskId), h(F.TypeTag, { type: t.type }), h(F.ProjectTag, null, t.projectId), h('span', null, 'chờ bạn ' + item.age),
      item.late ? h('span', { className: 'fm-ibadge t-red' }, 'Quá hạn ' + M.minutes(marks[item.key].limitMin)) : null,
      marks[item.key] && marks[item.key].later ? h('span', { className: 'fm-ibadge t-blue' }, 'Để mai') : null,
      h('span', { style: { marginLeft: 'auto' } }, h(F.Button, { variant: 'flat', size: 'sm', onClick: () => onOpenFull(t.taskId) }, 'Mở task ↗'))),
    h('h2', null, item.question));
  const report = h(F.Section, { title: 'Báo cáo của Foreman', end: fr ? 'round ' + fr.round : null }, h(ForemanReport, { report: fr, now }));

  function context() {
    const said = t.rounds.find((r) => r.original);
    return h(F.Card, { flat: true, title: 'Task', end: t.title },
      h(F.KeyValue, { items: [
        ['Yêu cầu', said ? '“' + said.original + '”' : '—'],
        ['Agent', (t.profile || '—') + (t.backend ? ' · ' + t.backend : '') + (t.endpoint ? ' · ' + t.endpoint : ''), true],
        ['Round', t.round + ' · gen ' + t.generation, true],
        t.reviewSize ? ['Cỡ review', t.reviewSize] : null,
        ['Workspace', t.workspace || '—', true]
      ] }));
  }
  function body() {
    if (k === 'waiting-decision') {
      const d = M.pendingDecision(t);
      if (!d) return frag(report, context());
      return frag(
        d.why ? h(F.Section, { title: 'Vì sao cần bạn' }, h('p', { style: { margin: 0, fontSize: 14 } }, d.why)) : null,
        h('div', { className: 'fm-sec' }, h('h4', { className: 'fm-h4' }, 'Phương án ', h('span', { className: 'end' }, d.label + ' · mở ' + ago(d.createdAt, now))),
          h(F.DecisionOptions, { options: d.options, recommendation: d.recommendation })),
        d.recommendationText && !d.recommendation ? h(F.Callout, { variant: 'note', lead: 'Đề xuất:' }, d.recommendationText) : null,
        d.impact ? h(F.Section, { title: 'Ảnh hưởng' }, h('p', { style: { margin: 0, fontSize: 14 } }, d.impact)) : null,
        d.evidence ? h(F.Section, { title: 'Bằng chứng' }, h(F.Quote, null, d.evidence)) : null,
        report,
        context());
    }
    if (k === 'choose-model') {
      const routed = profiles.find((p) => p.name === t.routingProfile);
      return frag(
        h(F.NextBox, { tone: 'red', title: 'Router đề xuất', why: t.routingNote },
          h('b', { className: 'fm-mono' }, t.routingProfile), routed && routed.model ? ' — ' + routed.model : null),
        h(F.Section, { title: 'Profile đang bật' },
          h('div', { className: 'fm-tablewrap' }, h('table', { className: 'fm-table' },
            h('thead', null, h('tr', null, h('th', null, 'Profile'), h('th', null, 'Group'), h('th', null, 'Tool · model'), h('th', { className: 'r' }, 'Task'))),
            h('tbody', null, profiles.filter((p) => p.active).map((p) => {
              const busy = tasks.filter((x) => x.profile === p.name && x.endpoint).length;
              return h('tr', { key: p.name }, h('td', { className: 'mono' }, h('b', null, p.name), p.name === t.routingProfile ? ' ★' : ''), h('td', null, p.group || '—'),
                h('td', { className: 'mono' }, p.tool + ' · ' + (p.model || '—') + (p.effort ? ' · ' + p.effort : '')), h('td', { className: 'r mono' }, busy));
            }))))),
        context());
    }
    if (k === 'blocked' || k === 'review-ready') {
      return frag(report,
        k === 'review-ready' ? h(F.Section, { title: 'Attention' }, h(F.PointList, { points: t.attention || [], kinds: POINT_KIND, now })) : null,
        context());
    }
    return frag(
      h(F.Section, { title: 'Attention' }, h(F.PointList, { points: [item.point], kinds: POINT_KIND, now })),
      report,
      context());
  }
  return h('article', { className: 'fm-reader', 'aria-label': 'Chi tiết ' + t.taskId }, head, h('div', { className: 'rbd' }, body()));
}
