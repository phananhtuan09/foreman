// Everything the screens show, derived from the snapshot `foreman dashboard serve` builds. Pure functions.
import { F } from './react.js';

const { STATUS, STATUS_ORDER, issueOf, dur, ago, clock, dayLabel, TIME } = F;

export const THRESHOLDS = { silentMin: 90, overdueHours: 24 };
const BAD_RUNTIME = ['unknown', 'dead', 'missing', 'mismatch', 'waiting-input'];
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function statusKey(t) { return t.needsProfileConfirmation && ['queued', 'pending'].includes(t.status) ? 'choose-model' : t.status; }
// The latest report of the newest round that has one; rounds are newest first.
export function lastReport(t) {
  for (const r of t.rounds) if (r.reports.length) return { ...r.reports[r.reports.length - 1], round: r.round };
  return null;
}
export function firstLine(s) { return String(s || '').split(/\n|(?<=\.)\s/)[0]; }
// The first sentence of a Markdown report as plain text: the first content line, a heading only when nothing else has text, without block markers, emphasis, or link targets.
export function plainLine(md) {
  const lines = String(md || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(```|~~~|[-*_]{3,}$|\|?\s*:?-{3,})/.test(l));
  const line = lines.find((l) => !/^#{1,6}\s/.test(l)) || lines[0] || '';
  return firstLine(line.replace(/^(>\s*)+/, '').replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
}
// The one-line summary of a task: Foreman's latest report is what the user reads in the session, so it wins unless a newer worker report has not been presented yet.
export function summaryLine(t) {
  const r = lastReport(t), list = t.foremanReports || [], f = list[list.length - 1];
  if (f && (!r || (f.at || 0) >= (r.at || 0))) return { text: plainLine(f.summary), round: f.round };
  return r ? { text: firstLine(r.summary), round: r.round } : null;
}
export function pendingDecision(t) { return (t.decisions || []).find((d) => d.state === 'pending') || null; }
export function answeredDecision(t) { return (t.decisions || []).find((d) => d.state === 'answered') || null; }
export function openPoints(t) { return (t.attention || []).filter((p) => p.state === 'open'); }
export function lastReportAt(t) { const r = lastReport(t); return r ? r.at : null; }

export function anomalyOf(t, now) {
  const issues = (t.issues || []).map((i) => ({ ...i, ...issueOf(i.type) }));
  if (t.runtime === 'unknown' && !issues.length) issues.push({ type: 'runtime.unknown', ...issueOf('runtime.unknown') });
  const silent = t.status === 'working' && now - t.lastActivityAt > THRESHOLDS.silentMin * TIME.MIN;
  return { issues, silent, any: issues.length > 0 || silent || BAD_RUNTIME.includes(t.runtime) };
}

export function groupOf(t, now) {
  const s = STATUS[statusKey(t)];
  if (s.group === 'you') return 'you';
  if (s.group === 'run' && anomalyOf(t, now).any) return 'anomaly';
  return s.group;
}

export const GROUPS = [
  { key: 'you', label: 'Chờ bạn', tone: 'red' },
  { key: 'anomaly', label: 'Bất thường', tone: 'mustard' },
  { key: 'run', label: 'Đang chạy', tone: 'blue' },
  { key: 'queue', label: 'Hàng chờ', tone: 'ink' }
];

export const quote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// What the user says to the Foreman session (primary), and the CLI it maps to (secondary).
export function actionsFor(t, now) {
  const id = t.taskId, k = statusKey(t), a = anomalyOf(t, now);
  const d = pendingDecision(t);
  const proposal = t.nextAction && t.nextAction.fresh ? 'Foreman đã đề xuất: “' + t.nextAction.text + '”' : null;
  if (k === 'waiting-decision' && d) {
    const rec = d.options.find((o) => o.key === d.recommendation);
    const pick = rec ? rec.key : (d.options[0] || { key: 'A' }).key;
    return { tone: 'red', title: 'Cần bạn quyết định', what: d.finding, why: proposal || (rec ? 'Đề xuất ' + rec.key + ': ' + rec.title + '.' : d.recommendationText ? 'Đề xuất: ' + d.recommendationText : null), text: id + ': chọn phương án ' + pick + '.', cli: 'foreman decision answer --task ' + id + ' --decision ' + d.id + ' --response ' + quote(pick) };
  }
  if (k === 'waiting-decision' && answeredDecision(t)) {
    const ans = answeredDecision(t);
    return { tone: 'ink', title: 'Đã trả lời, chờ Foreman gửi agent', what: '“' + ans.answer + '”', text: id + ': gửi câu trả lời cho agent.', cli: 'foreman decision deliver --task ' + id + ' --decision ' + ans.id, quiet: true };
  }
  if (k === 'blocked') {
    const r = lastReport(t);
    return { tone: 'red', title: 'Agent bị chặn, cần bạn trả lời', what: firstLine(r && r.summary), why: proposal || (r && r.steps ? 'Agent gợi ý ' + r.steps.length + ' hướng.' : null), text: id + (r && r.steps ? ': làm theo hướng 1.' : ': …'), cli: 'foreman task continue --task ' + id + " --text '…' --original '…'" };
  }
  if (k === 'choose-model') return { tone: 'red', title: 'Xác nhận profile', what: 'Router đề xuất ' + t.routingProfile + '.', why: t.routingNote, text: id + ': dùng ' + t.routingProfile + '.', cli: 'foreman task confirm --task ' + id + ' --profile ' + t.routingProfile };
  if (k === 'review-ready') {
    const r = lastReport(t);
    const size = t.reviewSize ? 'Cỡ review: ' + t.reviewSize + '. ' : '';
    if (t.type === 'scout') return { tone: 'green', title: 'Scout xong, đọc report rồi accept', what: firstLine(r && r.summary), why: proposal || 'Accept sẽ xoá report. Muốn sửa theo kết quả thì promote trước.', text: 'Accept ' + id + '.', cli: 'foreman task accept --task ' + id, alt: { text: id + ': promote thành ship để sửa theo report.', cli: 'foreman task promote --task ' + id } };
    return { tone: 'green', title: 'Xong, chờ bạn duyệt', what: firstLine(r && r.summary), why: proposal || size + 'Accept sẽ dừng agent, trả lease và xoá task. Workspace giữ nguyên.', text: 'Accept ' + id + '.', cli: 'foreman task accept --task ' + id };
  }
  if (a.issues.length) {
    const i = a.issues[0];
    const say = i.type === 'worker.waiting-input' ? id + ': agent đang chờ input, xem giúp.' : i.type === 'worker.idle-without-report' ? id + ': hỏi agent vì sao dừng mà chưa report.' : id + ': kiểm tra lại runtime của agent.';
    return { tone: 'mustard', title: i.label, what: i.explain, text: say, cli: i.type === 'worker.idle-without-report' ? 'foreman task message --task ' + id + " --text '…'" : 'foreman status' };
  }
  if (a.silent) return { tone: 'mustard', title: 'Không hoạt động quá ' + THRESHOLDS.silentMin + ' phút', what: 'Không có report hay hoạt động mới từ ' + clock(t.lastActivityAt) + '.', text: id + ': tình hình sao rồi?', cli: 'foreman task history --task ' + id };
  if (k === 'working') return { tone: 'ink', title: 'Không cần bạn làm gì', what: 'Agent đang làm round ' + t.round + '.', text: id + ': tình hình sao rồi?', cli: 'foreman task history --task ' + id, quiet: true };
  if (k === 'pending') return { tone: 'ink', title: 'Đang dispatch', what: 'Chờ runtime tạo endpoint.', quiet: true };
  if (k === 'routing') return { tone: 'ink', title: 'Đang routing', what: 'Routing xong sẽ cần bạn xác nhận profile.', quiet: true };
  if ((t.dependencies || []).length) return { tone: 'ink', title: 'Chờ task phụ thuộc', what: 'Dispatch sau khi ' + t.dependencies.join(', ') + ' được accept.', quiet: true };
  return { tone: 'ink', title: 'Chờ dispatch', what: 'Chờ slot trống và lease không xung đột.', text: 'Dispatch ' + id + ' ngay.', cli: 'foreman task dispatch --task ' + id, quiet: true };
}

export function rowLine(t, now, all) {
  const k = statusKey(t), a = anomalyOf(t, now), d = pendingDecision(t), s = summaryLine(t);
  if (k === 'waiting-decision' && d) return { kind: 'q', lead: 'Cần quyết định: ', text: d.finding };
  if (k === 'waiting-decision') return { kind: '', lead: 'Đã trả lời: ', text: 'chờ Foreman gửi agent.' };
  if (k === 'blocked') return { kind: 'q', lead: 'Agent cần: ', text: s ? s.text : '' };
  if (k === 'choose-model') return { kind: 'q', lead: 'Chọn model: ', text: 'router đề xuất ' + t.routingProfile };
  if (k === 'review-ready') return { kind: 'b', lead: t.type === 'scout' ? 'Scout xong: ' : 'Xong: ', text: (s ? s.text : '') + (t.reviewSize ? ' (' + t.reviewSize + ')' : '') };
  if (a.issues.length) return { kind: 'w', lead: a.issues[0].label + ' · ', text: s ? s.text : 'chưa có report' };
  if (a.silent) return { kind: 'w', lead: 'Không hoạt động ' + dur(now - t.lastActivityAt) + ' · ', text: s ? s.text : 'chưa có report' };
  if (k === 'working') return { kind: '', lead: '', text: s && s.round === t.round ? s.text : 'Chưa có report round này.' };
  if (k === 'pending') return { kind: '', lead: '', text: 'Đang dispatch cho ' + (t.profile || t.routingProfile || 'agent') + ', chờ endpoint.' };
  if (k === 'routing') return { kind: '', lead: '', text: 'Đang chọn profile…' };
  if ((t.dependencies || []).length) {
    const dep = t.dependencies.map((x) => { const o = all.find((y) => y.taskId === x); return x + (o ? ' (' + STATUS[statusKey(o)].label.toLowerCase() + ')' : ' (đã kết thúc)'); }).join(', ');
    return { kind: '', lead: 'Chờ ', text: dep + '.' };
  }
  return { kind: '', lead: '', text: 'Chờ dispatch.' };
}

export function ageOf(t, now) {
  const g = groupOf(t, now);
  if (g === 'you') {
    const ms = now - t.statusSince;
    return { text: 'chờ bạn ' + dur(ms), tone: STATUS[statusKey(t)].tone === 'red' || ms > THRESHOLDS.overdueHours * TIME.HOUR ? 'you' : '', sub: 'từ ' + clock(t.statusSince), ms, overdue: ms > THRESHOLDS.overdueHours * TIME.HOUR };
  }
  if (g === 'queue') return { text: 'tạo ' + ago(t.createdAt, now), tone: '', ms: now - t.createdAt };
  const ms = now - t.lastActivityAt;
  return { text: ago(t.lastActivityAt, now), tone: g === 'anomaly' ? 'warn' : '', sub: 'hoạt động cuối', ms };
}

export function sortGroup(key, list) {
  if (key === 'you') return list.slice().sort((a, b) => a.statusSince - b.statusSince);
  if (key === 'queue') return list.slice().sort((a, b) => STATUS_ORDER.indexOf(statusKey(a)) - STATUS_ORDER.indexOf(statusKey(b)) || a.createdAt - b.createdAt);
  return list.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function counts(tasks, now) {
  const by = { you: [], anomaly: [], run: [], queue: [] };
  tasks.forEach((t) => by[groupOf(t, now)].push(t));
  return { by };
}

export function ordered(tasks, now) {
  const { by } = counts(tasks, now);
  return GROUPS.reduce((acc, g) => acc.concat(sortGroup(g.key, by[g.key])), []);
}

export function youSummary(list) {
  const c = { 'waiting-decision': 0, blocked: 0, 'choose-model': 0, 'review-ready': 0 };
  list.forEach((t) => { c[statusKey(t)] = (c[statusKey(t)] || 0) + 1; });
  const parts = [];
  if (c['waiting-decision']) parts.push(c['waiting-decision'] + ' quyết định');
  if (c.blocked) parts.push(c.blocked + ' bị chặn');
  if (c['choose-model']) parts.push(c['choose-model'] + ' chọn model');
  if (c['review-ready']) parts.push(c['review-ready'] + ' chờ duyệt');
  return parts.join(' · ') || 'không có';
}

// Events, newest first, rebuilt from rounds, reports, decisions, kept anomalies, and the ended-task history.
export function buildEvents(tasks, now, history = []) {
  const ev = [];
  tasks.forEach((t) => {
    const meta = (t.profile || t.routingProfile || 'chưa dispatch') + (t.backend ? ' · ' + cap(t.backend) : '');
    if (t.createdAt) ev.push({ type: 'created', at: t.createdAt, taskId: t.taskId, text: t.title, meta: t.projectId });
    t.rounds.forEach((r) => {
      if (r.round > 1 && r.at) ev.push({ type: 'round', at: r.at, taskId: t.taskId, text: 'Round ' + r.round + ': ' + firstLine(r.original || r.sent), meta });
      r.reports.forEach((rep) => ev.push({ type: rep.status === 'done' ? 'done' : rep.status === 'blocked' ? 'blocked' : 'report', at: rep.at, taskId: t.taskId, text: firstLine(rep.summary), meta: meta + ' · round ' + r.round }));
    });
    (t.decisions || []).forEach((d) => {
      if (d.createdAt) ev.push({ type: 'decision', at: d.createdAt, taskId: t.taskId, text: d.finding, meta: d.label + ' · ' + d.options.length + ' phương án' });
      if (d.answeredAt) ev.push({ type: 'answer', at: d.answeredAt, taskId: t.taskId, text: d.answer || '', meta: d.label });
    });
    (t.issues || []).forEach((i) => { if (i.at) ev.push({ type: 'anomaly', at: i.at, taskId: t.taskId, text: issueOf(i.type).label, meta: i.type }); });
  });
  history.forEach((x) => { if (x.endedAt) ev.push({ type: x.outcome === 'discarded' ? 'discarded' : 'accepted', at: x.endedAt, taskId: x.taskId, text: x.title || 'Không lưu tiêu đề', meta: [x.projectId, x.type, cap(x.backend), x.round + ' round'].join(' · ') }); });
  return ev.filter((e) => e.at <= now).sort((a, b) => b.at - a.at).map((e, i) => ({ ...e, key: e.taskId + '-' + e.type + '-' + e.at + '-' + i, day: dayLabel(e.at, now) }));
}

// Approximate state history per task for the shift chart, rebuilt from the timestamps Foreman keeps.
// A Paseo turn ends with its report, so a progress report means the worker sits idle until the next round;
// a Herdr worker may report progress mid-turn and keep going.
export function ganttRows(tasks, from, now) {
  return tasks.map((t) => {
    const dispatched = t.generation > 0 && t.status !== 'pending';
    const changes = [{ at: t.createdAt, kind: 'queue', label: 'chờ dispatch' }];
    if (dispatched) {
      t.rounds.slice().sort((a, b) => a.round - b.round).forEach((r) => {
        const start = r.round === 1 ? t.dispatchedAt || r.at : r.at;
        if (start) changes.push({ at: start, kind: 'run', label: 'round ' + r.round });
        r.reports.forEach((rep) => {
          if (rep.status === 'blocked') changes.push({ at: rep.at, kind: 'you', label: 'bị chặn, chờ bạn' });
          else if (rep.status === 'done') changes.push({ at: rep.at, kind: 'review', label: 'chờ duyệt' });
          else if (t.backend === 'paseo') changes.push({ at: rep.at, kind: 'idle', label: 'chờ round tiếp' });
        });
      });
    }
    (t.decisions || []).forEach((d) => {
      if (d.createdAt) changes.push({ at: d.createdAt, kind: 'you', label: 'chờ quyết định ' + d.label });
      if (d.answeredAt) changes.push({ at: d.answeredAt, kind: 'run', label: 'đã trả lời ' + d.label });
    });
    if (statusKey(t) === 'choose-model') changes.push({ at: t.statusSince, kind: 'you', label: 'chờ chọn model' });
    if (t.status === 'pending') changes.push({ at: t.statusSince, kind: 'queue', label: 'đang dispatch' });
    (t.issues || []).forEach((i) => { if (i.at) changes.push({ at: i.at, kind: 'warn', label: issueOf(i.type).label }); });
    const sorted = changes.filter((c) => c.at).sort((a, b) => a.at - b.at);
    const segs = [];
    sorted.forEach((c, i) => {
      const end = i + 1 < sorted.length ? sorted[i + 1].at : now;
      if (end <= from || end <= c.at) return;
      segs.push({ from: Math.max(c.at, from), to: end, kind: c.kind, label: c.label });
    });
    return { id: t.taskId, segs };
  }).filter((r) => r.segs.length);
}

// What Foreman recorded about the replacement of the previous worker.
export function handoffText(x) {
  if (!x) return null;
  const why = { dead: 'agent cũ đã chết', missing: 'agent cũ mất tích', 'human-reassign': 'bạn yêu cầu giao lại', recovery: 'khôi phục' }[x.reason] || x.reason || 'giao lại';
  return 'Generation ' + ((x.previousGeneration || 0) + 1) + ' thay ' + (x.previousOwner || 'agent cũ') + (x.previousEndpoint ? ' (' + x.previousEndpoint + ')' : '') + ' vì ' + why + (x.createdAt ? ', lúc ' + clock(x.createdAt) + '.' : '.');
}

// Runtime of a task from the last kept status check; null when no check saw it since dispatch.
export function runtimeOf(t) { return t.runtime === null || t.runtime === undefined ? (t.endpoint ? 'unknown' : 'none') : t.runtime; }
