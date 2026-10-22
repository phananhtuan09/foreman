import { h, F, Fragment } from './react.js';
import { inboxItems, weigh } from './inbox.js';
import { minutes } from './model.js';

// The user's load: what is waiting on them now, and whether today's remaining work time covers it.
// Every number is a browser preference; only values the user changed are stored, so later default changes still apply to the rest.
export const LOAD_DEFAULTS = {
  enabled: true,
  maxItems: 5,
  waitStuckMin: 60, waitModelMin: 60, waitReviewMin: 240,
  dayStart: '09:00', dayEnd: '18:00', warnBeforeMin: 120, warnPct: 70,
  estDecisionMin: 5, estModelMin: 2, estBlockedMin: 10, estReviewMin: 5, estReviewPerFileMin: 1, estReviewMaxMin: 45
};
export const loadSettings = (stored) => ({ ...LOAD_DEFAULTS, ...(stored || {}) });

// A blocked task or an open decision keeps its agent idle; a model choice keeps the task from starting; a review or an attention point only piles up.
function waitLimitMin(item, cfg) {
  if (item.kind === 'blocked' || item.kind === 'waiting-decision') return cfg.waitStuckMin;
  if (item.kind === 'choose-model') return cfg.waitModelMin;
  return cfg.waitReviewMin;
}
// A review without a measured size counts as five files.
export function estimateMin(item, cfg) {
  if (item.kind === 'waiting-decision' || item.kind === 'point') return cfg.estDecisionMin;
  if (item.kind === 'blocked') return cfg.estBlockedMin;
  if (item.kind === 'choose-model') return cfg.estModelMin;
  const files = item.task.reviewChange ? item.task.reviewChange.files : 5;
  return Math.min(cfg.estReviewMaxMin, cfg.estReviewMin + cfg.estReviewPerFileMin * files);
}
function atTime(now, hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

export function loadState(tasks, now, cfg) {
  const items = inboxItems(tasks, now, () => false);
  const overdue = items.map((i) => ({ ...i, limit: waitLimitMin(i, cfg) })).filter((i) => i.ms >= i.limit * 60000).sort((a, b) => b.ms / b.limit - a.ms / a.limit);
  const stuck = overdue.filter((i) => i.kind === 'blocked' || i.kind === 'waiting-decision');
  const tooMany = items.length >= cfg.maxItems;
  const nowAlert = overdue.length || tooMany ? { tone: stuck.length ? 'red' : 'mustard', count: items.length, tooMany, overdue } : null;

  const start = atTime(now, cfg.dayStart), end = atTime(now, cfg.dayEnd);
  let day = null;
  if (start != null && end != null && end > start && now >= start && items.length) {
    const total = items.reduce((n, i) => n + estimateMin(i, cfg), 0);
    if (now >= end) day = { phase: 'after', total, items };
    else {
      const left = (end - now) / 60000;
      const tone = total > left ? 'red' : left <= cfg.warnBeforeMin && total >= (cfg.warnPct / 100) * left ? 'mustard' : null;
      if (tone) {
        // Fill the time left with the quickest work first; what does not fit can wait for tomorrow.
        const quick = items.slice().sort((a, b) => weigh(a.task, 'quick') - weigh(b.task, 'quick') || b.ms - a.ms);
        let used = 0;
        const fit = [], later = [];
        quick.forEach((i) => { const e = estimateMin(i, cfg); if (used + e <= left) { used += e; fit.push(i); } else later.push(i); });
        day = { phase: 'during', tone, total, left, fit, fitMin: used, later };
      }
    }
  }
  // Per item: whether it is over the wait limit of its kind, its estimate, and whether today's forecast leaves it for tomorrow.
  // After the work hours every item is left for tomorrow, so only the forecast during the day marks items.
  const later = new Set(day && day.phase === 'during' ? day.later.map((i) => i.key) : []);
  const marks = Object.fromEntries(items.map((i) => [i.key, { over: i.ms >= waitLimitMin(i, cfg) * 60000, limitMin: waitLimitMin(i, cfg), est: estimateMin(i, cfg), later: later.has(i.key) }]));
  return { nowAlert, day, marks };
}

// A task ID in a warning opens that item in Chờ bạn.
function idLinks(list, onPick, n = 3) {
  const shown = list.slice(0, n).map((i, k) => h(Fragment, { key: i.key }, k ? ', ' : '', h('button', { type: 'button', className: 'fm-link', onClick: () => onPick(i.key) }, i.id)));
  return h(Fragment, null, shown, list.length > n ? ' +' + (list.length - n) : '');
}
const KIND_WAIT = { blocked: 'bị chặn', 'waiting-decision': 'chờ quyết định', 'choose-model': 'chờ chọn model', point: 'có attention chờ bạn', 'review-ready': 'chờ duyệt' };

export function LoadBanners({ state, cfg, onOpenOverdue, onOpenQuick, onOpenInbox, onPick }) {
  const button = (label, onClick) => h(F.Button, { variant: 'flat', size: 'sm', onClick }, label);
  const out = [];
  const a = state.nowAlert;
  if (a) {
    const first = a.overdue[0];
    out.push(h(F.Banner, { key: 'now', tone: a.tone, lead: 'Đang dồn việc', actions: button(a.overdue.length ? 'Xem việc quá hạn' : 'Mở Chờ bạn', a.overdue.length ? onOpenOverdue : onOpenInbox) },
      first ? h(Fragment, null, idLinks([first], onPick), ' ' + KIND_WAIT[first.kind] + ' ' + minutes(first.ms / 60000) + (first.kind === 'blocked' || first.kind === 'waiting-decision' ? ', agent đang đứng chờ' : ''),
        a.overdue.length > 1 ? h(Fragment, null, ' · cũng quá hạn: ', idLinks(a.overdue.slice(1), onPick)) : null, ' · ') : null,
      a.count + ' việc chờ bạn' + (a.tooMany ? ' (ngưỡng ' + cfg.maxItems + ')' : '') + '.'));
  }
  const d = state.day;
  if (d && d.phase === 'during') {
    const laterMin = d.later.reduce((n, i) => n + estimateMin(i, cfg), 0);
    const advice = !d.fit.length ? 'Không việc nào kịp trong thời gian còn lại; chọn việc quan trọng nhất trước.'
      : d.later.length ? h(Fragment, null, 'Dọn ' + d.fit.length + ' việc nhanh (~' + minutes(d.fitMin) + ') trước; để mai: ', idLinks(d.later, onPick), ' (~' + minutes(laterMin) + ').')
      : 'Vẫn kịp nếu bắt đầu ngay, dọn việc nhanh trước.';
    out.push(h(F.Banner, { key: 'day', tone: d.tone, lead: 'Còn ' + minutes(d.left) + ' tới ' + cfg.dayEnd, actions: button('Xem theo thứ tự nhanh', onOpenQuick) }, 'Việc tồn ước tính ~' + minutes(d.total) + '. ', advice));
  }
  if (d && d.phase === 'after') out.push(h(F.Banner, { key: 'day', tone: 'ink', lead: 'Để lại cho mai', actions: button('Mở Chờ bạn', onOpenInbox) }, d.items.length + ' việc (~' + minutes(d.total) + '): ', idLinks(d.items, onPick, 6), '.'));
  return out.length ? h('div', { className: 'fm-loadbanners' }, out) : null;
}
