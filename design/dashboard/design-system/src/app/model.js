// Derives everything the screens show from the snapshot. Pure functions; the server could run the same code.
import { STATUS, STATUS_ORDER, issueOf, dur, ago, clock, dayLabel, TIME } from '../ds/vocab.js';

export const THRESHOLDS = { silentMin: 90, overdueHours: 24, cacheCold: 65 };
const BAD_RUNTIME = ['unknown', 'dead', 'missing', 'mismatch', 'waiting-input'];

export function statusKey(t) { return t.needsProfileConfirmation && ['queued', 'pending'].includes(t.status) ? 'choose-model' : t.status; }
export function lastReport(t) { for (const r of t.rounds) for (let i = r.reports.length - 1; i >= 0; i--) return { ...r.reports[i], round: r.round }; return null; }
function latestReport(t) { let best = null; t.rounds.forEach((r) => r.reports.forEach((rep) => { if (!best || rep.at > best.at) best = { ...rep, round: r.round }; })); return best; }
export function firstLine(s) { return String(s || '').split(/\n|(?<=\.)\s/)[0]; }
export function pendingDecision(t) { return (t.decisions || []).find((d) => d.state === 'pending') || null; }
export function openPoints(t) { return (t.attention || []).filter((p) => p.state === 'open'); }

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

// What the user says to the Foreman session (primary), and the CLI it maps to (secondary).
export function actionsFor(t, now) {
  const id = t.taskId, k = statusKey(t), a = anomalyOf(t, now);
  const d = pendingDecision(t);
  if (k === 'waiting-decision' && d) {
    const rec = d.options.find((o) => o.key === d.recommendation);
    return { tone: 'red', title: 'Cần bạn quyết định', what: d.finding, why: rec ? 'Agent đề xuất ' + rec.key + ': ' + rec.title + '.' : null, text: id + ': chọn phương án ' + (rec ? rec.key : 'A') + ' cho ' + d.id + '.', cli: 'foreman decision answer --task ' + id + ' --decision ' + d.id + " --response '" + (rec ? rec.key : 'A') + "'" };
  }
  if (k === 'blocked') {
    const r = latestReport(t);
    return { tone: 'red', title: 'Agent bị chặn, cần bạn trả lời', what: firstLine(r && r.summary), why: r && r.steps ? 'Agent gợi ý ' + r.steps.length + ' hướng.' : null, text: id + ': làm theo hướng 1.', cli: 'foreman task continue --task ' + id + " --text '…' --original '…'" };
  }
  if (k === 'choose-model') return { tone: 'red', title: 'Xác nhận profile', what: 'Router đề xuất ' + t.routingProfile + '.', why: t.routingNote, text: id + ': dùng ' + t.routingProfile + '.', cli: 'foreman task confirm --task ' + id + ' --profile ' + t.routingProfile };
  if (k === 'review-ready' && t.type === 'scout') return { tone: 'green', title: 'Scout xong, đọc report rồi accept', what: firstLine(latestReport(t).summary), why: 'Accept sẽ xoá report. Muốn sửa theo kết quả thì promote trước.', text: 'Accept ' + id + '.', cli: 'foreman task accept --task ' + id, alt: { text: id + ': promote thành ship để sửa theo report.', cli: 'foreman task promote --task ' + id } };
  if (k === 'review-ready') return { tone: 'green', title: 'Xong, chờ bạn duyệt', what: firstLine(latestReport(t).summary), why: 'Accept sẽ dừng agent, trả lease và xoá task. Workspace giữ nguyên.', text: 'Accept ' + id + '.', cli: 'foreman task accept --task ' + id };
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
  const k = statusKey(t), a = anomalyOf(t, now), d = pendingDecision(t), r = latestReport(t);
  if (k === 'waiting-decision' && d) return { kind: 'q', lead: 'Cần quyết định: ', text: d.finding };
  if (k === 'blocked') return { kind: 'q', lead: 'Agent cần: ', text: firstLine(r && r.summary) };
  if (k === 'choose-model') return { kind: 'q', lead: 'Chọn model: ', text: 'router đề xuất ' + t.routingProfile };
  if (k === 'review-ready') return { kind: 'b', lead: t.type === 'scout' ? 'Scout xong: ' : 'Xong: ', text: firstLine(r && r.summary) };
  if (a.issues.length) return { kind: 'w', lead: a.issues[0].label + ' · ', text: r ? firstLine(r.summary) : 'chưa có report' };
  if (a.silent) return { kind: 'w', lead: 'Không hoạt động ' + dur(now - t.lastActivityAt) + ' · ', text: r ? firstLine(r.summary) : 'chưa có report' };
  if (k === 'working') return { kind: '', lead: '', text: r ? firstLine(r.summary) : 'Chưa có report round này.' };
  if (k === 'pending') return { kind: '', lead: '', text: 'Đang dispatch cho ' + t.profile + ', chờ endpoint.' };
  if (k === 'routing') return { kind: '', lead: '', text: 'Đang chọn profile…' };
  if ((t.dependencies || []).length) {
    const dep = t.dependencies.map((x) => { const o = all.find((y) => y.taskId === x); return x + (o ? ' (' + STATUS[statusKey(o)].label.toLowerCase() + ')' : ''); }).join(', ');
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

export function sortGroup(key, list, now) {
  if (key === 'you') return list.slice().sort((a, b) => a.statusSince - b.statusSince);
  if (key === 'queue') return list.slice().sort((a, b) => STATUS_ORDER.indexOf(statusKey(a)) - STATUS_ORDER.indexOf(statusKey(b)) || a.createdAt - b.createdAt);
  return list.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function counts(tasks, now) {
  const by = { you: [], anomaly: [], run: [], queue: [] };
  tasks.forEach((t) => by[groupOf(t, now)].push(t));
  const kinds = (list, fn) => { const m = {}; list.forEach((t) => { const k = fn(t); m[k] = (m[k] || 0) + 1; }); return m; };
  return { by, kinds };
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

// Events, newest first, rebuilt from rounds, reports, decisions and issues.
export function buildEvents(tasks, now, history = []) {
  const ev = [];
  tasks.forEach((t) => {
    const meta = (t.profile || t.routingProfile || 'chưa dispatch') + (t.backend ? ' · ' + t.backend[0].toUpperCase() + t.backend.slice(1) : '');
    ev.push({ type: 'created', at: t.createdAt, taskId: t.taskId, text: t.title, meta: t.projectId });
    t.rounds.forEach((r) => {
      if (r.round > 1) ev.push({ type: 'round', at: r.at, taskId: t.taskId, text: 'Round ' + r.round + ': ' + (r.original || r.sent), meta });
      r.reports.forEach((rep) => ev.push({ type: rep.status === 'done' ? 'done' : rep.status === 'blocked' ? 'blocked' : 'report', at: rep.at, taskId: t.taskId, text: firstLine(rep.summary), meta: meta + ' · round ' + r.round }));
    });
    (t.decisions || []).forEach((d) => { ev.push({ type: 'decision', at: d.createdAt, taskId: t.taskId, text: d.finding, meta: d.id + ' · ' + d.options.length + ' phương án' }); });
    (t.issues || []).forEach((i) => ev.push({ type: 'anomaly', at: i.at, taskId: t.taskId, text: issueOf(i.type).label, meta: i.type }));
  });
  history.forEach((h) => ev.push({ type: h.outcome === 'discarded' ? 'discarded' : 'accepted', at: h.endedAt, taskId: h.taskId, text: h.title || 'Không lưu tiêu đề', meta: [h.projectId, h.type, h.backend[0].toUpperCase() + h.backend.slice(1), h.round + ' round'].join(' · ') }));
  return ev.filter((e) => e.at <= now).sort((a, b) => b.at - a.at).map((e, i) => ({ ...e, key: e.taskId + '-' + e.type + '-' + e.at + '-' + i, day: dayLabel(e.at, now) }));
}

// Approximate state history per task for the shift chart, rebuilt from timestamps Foreman keeps.
// A Paseo turn ends with its report, so a progress report means the worker sits idle until the next round;
// a Herdr worker may report progress mid-turn and keep going.
export function ganttRows(tasks, from, now) {
  return tasks.map((t) => {
    const dispatched = t.generation > 0 && t.status !== 'pending';
    const changes = [{ at: t.createdAt, kind: 'queue', label: 'chờ dispatch' }];
    const rounds = t.rounds.slice().sort((a, b) => a.at - b.at);
    if (dispatched) {
      rounds.forEach((r) => {
        changes.push({ at: r.at, kind: 'run', label: 'round ' + r.round });
        r.reports.forEach((rep) => {
          if (rep.status === 'blocked') changes.push({ at: rep.at, kind: 'you', label: 'bị chặn, chờ bạn' });
          else if (rep.status === 'done') changes.push({ at: rep.at, kind: 'review', label: 'chờ duyệt' });
          else if (t.backend === 'paseo') changes.push({ at: rep.at, kind: 'idle', label: 'chờ round tiếp' });
        });
      });
    }
    (t.decisions || []).forEach((d) => { changes.push({ at: d.createdAt, kind: 'you', label: 'chờ quyết định ' + d.id }); });
    if (statusKey(t) === 'choose-model') changes.push({ at: t.statusSince, kind: 'you', label: 'chờ chọn model' });
    if (t.status === 'pending') changes.push({ at: t.statusSince, kind: 'queue', label: 'đang dispatch' });
    (t.issues || []).forEach((i) => changes.push({ at: i.at, kind: 'warn', label: issueOf(i.type).label }));
    changes.sort((a, b) => a.at - b.at);
    const segs = [];
    changes.forEach((c, i) => {
      const end = i + 1 < changes.length ? changes[i + 1].at : now;
      if (end <= from || end <= c.at) return;
      segs.push({ from: Math.max(c.at, from), to: end, kind: c.kind, label: c.label });
    });
    return { id: t.taskId, segs };
  }).filter((r) => r.segs.length);
}

export function roundsView(t, now) {
  return t.rounds.map((r) => ({
    round: r.round, generation: r.generation, mode: r.mode, when: clock(r.at) + ' · ' + dayLabel(r.at, now).split(' — ')[0].toLowerCase(),
    original: r.original, sent: r.sent,
    reports: r.reports.slice().reverse().map((rep) => ({ status: rep.status, when: clock(rep.at) + ' · ' + ago(rep.at, now), summary: rep.summary, steps: rep.steps }))
  }));
}
