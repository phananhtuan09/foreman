import { h, frag, F, useState, useEffect, useRef } from './react.js';
import * as M from './model.js';

const { POINT_KIND, dur, ago, clock, copyText } = F;

const KINDS = [
  { key: 'waiting-decision', label: 'Quyết định' },
  { key: 'blocked', label: 'Bị chặn' },
  { key: 'choose-model', label: 'Chọn model' },
  { key: 'review-ready', label: 'Chờ duyệt' }
];

export function inboxItems(tasks, now, isNew) {
  const items = [];
  tasks.forEach((t) => {
    const k = M.statusKey(t);
    if (!KINDS.find((x) => x.key === k)) return;
    const d = M.pendingDecision(t), r = M.lastReport(t);
    const q = k === 'waiting-decision' ? (d ? d.finding : 'Đã trả lời, chờ Foreman gửi agent') : k === 'blocked' ? M.firstLine(r && r.summary) : k === 'choose-model' ? 'Chọn profile cho “' + t.title + '”' : (t.type === 'scout' ? 'Scout xong: ' : 'Xong: ') + t.title;
    const ms = now - t.statusSince;
    items.push({ key: t.taskId + ':' + k, id: t.taskId, kind: k, status: k, question: q, project: t.projectId, ms, age: dur(ms), urgent: k !== 'review-ready', overdue: ms > M.THRESHOLDS.overdueHours * 3600000, isNew: isNew(t), task: t });
  });
  // User-owned open points on tasks that are not already in the inbox for their status.
  tasks.forEach((t) => {
    if (KINDS.find((x) => x.key === M.statusKey(t))) return;
    M.openPoints(t).filter((p) => p.owner === 'user').forEach((p) => items.push({ key: t.taskId + ':' + p.id, id: t.taskId, kind: 'point', status: M.statusKey(t), question: p.text, project: t.projectId, ms: now - p.since, age: dur(now - p.since), urgent: true, task: t, point: p }));
  });
  return items;
}

export function Inbox({ tasks, now, profiles, current, onPick, onOpenFull, onCopied, isNew }) {
  const [kind, setKind] = useState('all');
  const items = inboxItems(tasks, now, isNew);
  const groups = KINDS.concat([{ key: 'point', label: 'Attention' }]).map((g) => ({ ...g, items: items.filter((i) => i.kind === g.key && (kind === 'all' || kind === g.key)).sort((a, b) => b.ms - a.ms) })).filter((g) => g.items.length);
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
      h('div', { className: 'fm-toolbar' }, h(F.FilterChips, { label: 'Loại', value: kind, onChange: setKind, options: [{ value: 'all', label: 'Tất cả', count: items.length }].concat(KINDS.concat([{ key: 'point', label: 'Attention' }]).map((k) => ({ value: k.key, label: k.label, count: items.filter((i) => i.kind === k.key).length })).filter((o) => o.count)) })),
      h('div', { className: 'fm-inbox' },
        h(F.InboxList, { groups, current: cur && cur.key, onPick }),
        cur ? h(Reader, { key: cur.key, item: cur, tasks, now, profiles, onOpenFull, onCopied }) : null)));
}

function copyButton(text, label, onCopied, variant = 'flat') {
  return h(F.Button, { variant, size: 'sm', onClick: () => copyText(text).then(() => onCopied(text), () => onCopied(text, true)) }, label);
}

function Reader({ item, tasks, now, profiles, onOpenFull, onCopied }) {
  const t = item.task, k = item.kind;
  const head = h('div', { className: 'rhd' },
    h('div', { className: 'l1' }, h(F.StatusLabel, { status: item.status }), h('b', { className: 'fm-mono', style: { color: 'var(--ink)' } }, t.taskId), h(F.TypeTag, { type: t.type }), h(F.ProjectTag, null, t.projectId), h('span', null, 'chờ bạn ' + item.age),
      item.overdue ? h(F.StatusLabel, { tone: 'red', size: 'sm' }, 'quá hạn') : null,
      h('span', { style: { marginLeft: 'auto' } }, h(F.Button, { variant: 'flat', size: 'sm', onClick: () => onOpenFull(t.taskId) }, 'Mở task ↗'))),
    h('h2', null, item.question));

  function context() {
    const said = t.rounds.find((r) => r.original);
    return h(F.Card, { flat: true, title: 'Task', end: t.title },
      h(F.KeyValue, { items: [
        ['Yêu cầu', said ? '“' + said.original + '”' : '—'],
        ['Agent', (t.profile || '—') + (t.backend ? ' · ' + t.backend : '') + (t.endpoint ? ' · ' + t.endpoint : ''), true],
        ['Round', t.round + ' · gen ' + t.generation, true],
        ['Workspace', t.workspace || '—', true]
      ] }));
  }
  function body() {
    if (k === 'waiting-decision') {
      const d = M.pendingDecision(t);
      if (!d) {
        const act = M.actionsFor(t, now);
        return frag(h(F.NextBox, { tone: act.tone, title: act.title, copy: { text: act.text, cli: act.cli, onCopied } }, act.what), context());
      }
      return frag(
        d.why ? h(F.Section, { title: 'Vì sao cần bạn' }, h('p', { style: { margin: 0, fontSize: 14 } }, d.why)) : null,
        h('div', { className: 'fm-sec' }, h('h4', { className: 'fm-h4' }, 'Phương án ', h('span', { className: 'end' }, d.label + ' · mở ' + ago(d.createdAt, now))),
          h(F.DecisionOptions, { options: d.options, recommendation: d.recommendation, renderAction: (o) => copyButton(t.taskId + ': chọn phương án ' + o.key + '.', 'Copy “chọn ' + o.key + '”', onCopied, o.key === d.recommendation ? 'primary' : 'flat') })),
        d.recommendationText && !d.recommendation ? h(F.Callout, { variant: 'note', lead: 'Đề xuất:' }, d.recommendationText) : null,
        d.impact ? h(F.Section, { title: 'Ảnh hưởng' }, h('p', { style: { margin: 0, fontSize: 14 } }, d.impact)) : null,
        d.evidence ? h(F.Section, { title: 'Bằng chứng' }, h(F.Quote, null, d.evidence)) : null,
        h(F.Compose, { prefix: t.taskId + ': ', placeholder: 'Ví dụ: chọn A nhưng giữ agent cũ nếu còn dưới 10 phút…', onCopied }),
        h(F.CopyCommand, { quiet: true, label: 'CLI', cli: 'foreman decision answer --task ' + t.taskId + ' --decision ' + d.id + " --response '…'", onCopied }),
        context());
    }
    if (k === 'blocked') {
      const r = M.lastReport(t);
      return frag(
        r ? h(F.Section, { title: 'Report', end: 'round ' + r.round + ' · ' + ago(r.at, now) }, h(F.Report, { status: 'blocked', when: clock(r.at), summary: r.summary })) : null,
        r && r.steps ? h('div', { className: 'fm-sec' }, h('h4', { className: 'fm-h4' }, 'Agent gợi ý'),
          h('div', { className: 'fm-options' }, r.steps.map((s, i) => h('div', { key: i, className: 'fm-option' }, h('span', { className: 'letter' }, i + 1), h('span', { className: 'otitle' }, s),
            h('span', { className: 'ofoot' }, copyButton(t.taskId + ': làm theo hướng ' + (i + 1) + '.', 'Copy “làm theo hướng ' + (i + 1) + '”', onCopied)))))) : null,
        h(F.Compose, { prefix: t.taskId + ': ', placeholder: 'Trả lời agent…', onCopied }),
        context());
    }
    if (k === 'choose-model') {
      const routed = profiles.find((p) => p.name === t.routingProfile);
      return frag(
        h(F.NextBox, { tone: 'red', title: 'Router đề xuất', why: t.routingNote, copy: { text: t.taskId + ': dùng ' + t.routingProfile + '.', cli: 'foreman task confirm --task ' + t.taskId + ' --profile ' + t.routingProfile, onCopied } },
          h('b', { className: 'fm-mono' }, t.routingProfile), routed && routed.model ? ' — ' + routed.model : null),
        h(F.Section, { title: 'Profile đang bật' },
          h('div', { className: 'fm-tablewrap' }, h('table', { className: 'fm-table' },
            h('thead', null, h('tr', null, h('th', null, 'Profile'), h('th', null, 'Group'), h('th', null, 'Tool · model'), h('th', { className: 'r' }, 'Task'), h('th', null))),
            h('tbody', null, profiles.filter((p) => p.active).map((p) => {
              const busy = tasks.filter((x) => x.profile === p.name && x.endpoint).length;
              return h('tr', { key: p.name }, h('td', { className: 'mono' }, h('b', null, p.name), p.name === t.routingProfile ? ' ★' : ''), h('td', null, p.group || '—'),
                h('td', { className: 'mono' }, p.tool + ' · ' + (p.model || '—') + (p.effort ? ' · ' + p.effort : '')), h('td', { className: 'r mono' }, busy),
                h('td', { className: 'r' }, copyButton(t.taskId + ': dùng ' + p.name + '.', 'Copy', onCopied)));
            }))))),
        context());
    }
    if (k === 'review-ready') {
      const r = M.lastReport(t), act = M.actionsFor(t, now);
      return frag(
        r ? h(F.Section, { title: 'Report', end: 'round ' + r.round + ' · ' + ago(r.at, now) }, h(F.Report, { status: 'done', when: clock(r.at), summary: r.summary, steps: r.steps })) : null,
        h(F.Section, { title: 'Attention' }, h(F.PointList, { points: t.attention || [], kinds: POINT_KIND, now })),
        h(F.NextBox, { tone: 'green', title: 'Accept', copy: { text: act.text, cli: act.cli, onCopied } }, act.why),
        act.alt ? h(F.CopyCommand, { quiet: true, label: 'Hoặc promote trước', text: act.alt.text, cli: act.alt.cli, onCopied }) : null,
        t.workspace ? h(F.CopyCommand, { quiet: true, label: 'Xem diff trong workspace', cli: 'cd ' + M.quote(t.workspace) + (t.branch ? ' && git diff --stat' : ''), onCopied }) : null,
        h(F.Compose, { prefix: t.taskId + ': ', placeholder: 'Chưa accept? Gõ yêu cầu cho round tiếp…', onCopied }));
    }
    return frag(
      h(F.Section, { title: 'Attention' }, h(F.PointList, { points: [item.point], kinds: POINT_KIND, now })),
      h(F.Compose, { prefix: t.taskId + ' / ' + item.point.id + ': ', placeholder: 'Trả lời…', onCopied }),
      h(F.CopyCommand, { quiet: true, label: 'Hoãn đến mai', text: t.taskId + ': hoãn ' + item.point.id + ' đến mai.', cli: 'foreman attention snooze --task ' + t.taskId + ' --point ' + item.point.id + ' --until tomorrow', onCopied }),
      context());
  }
  return h('article', { className: 'fm-reader', 'aria-label': 'Chi tiết ' + t.taskId }, head, h('div', { className: 'rbd' }, body()));
}
