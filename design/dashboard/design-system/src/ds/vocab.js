// One vocabulary for every screen. Keys are Foreman's own values, verbatim, so the dashboard server can pass records through.

// Task lifecycle: meta.status, plus "choose-model" for a routed task that waits for `task confirm` (needsProfileConfirmation).
// group: you = waits on the user · run = a worker holds it · queue = not dispatched yet.
export const STATUS = {
  'waiting-decision': { label: 'Cần quyết định', tone: 'red', group: 'you' },
  blocked: { label: 'Bị chặn', tone: 'red', group: 'you' },
  'choose-model': { label: 'Chọn model', tone: 'red', group: 'you' },
  'review-ready': { label: 'Chờ duyệt', tone: 'green', group: 'you' },
  working: { label: 'Đang làm', tone: 'blue', group: 'run' },
  pending: { label: 'Đang dispatch', tone: 'blue', group: 'run' },
  routing: { label: 'Đang routing', tone: 'ink', group: 'queue' },
  queued: { label: 'Chờ dispatch', tone: 'ink', group: 'queue' }
};
export const STATUS_ORDER = ['waiting-decision', 'blocked', 'choose-model', 'review-ready', 'working', 'pending', 'routing', 'queued'];

// Runtime classification from one status check (docs/product/supervision-and-recovery.md).
export const RUNTIME = {
  working: { label: 'running', tone: 'blue', pulse: true },
  idle: { label: 'idle', tone: 'ink' },
  'waiting-input': { label: 'waiting input', tone: 'mustard' },
  unknown: { label: 'unknown', tone: 'mustard' },
  mismatch: { label: 'mismatch', tone: 'red' },
  dead: { label: 'dead', tone: 'red' },
  missing: { label: 'missing', tone: 'red' },
  none: { label: 'chưa có agent', tone: 'ink' }
};

// Anomaly issue types emitted by `foreman status` / `task collect`, with what they mean for the person watching.
export const ISSUE = {
  'worker.idle-without-report': { label: 'Idle, chưa report', tone: 'mustard', explain: 'Agent đã dừng lượt nhưng chưa gửi report.' },
  'worker.waiting-input': { label: 'Chờ input', tone: 'mustard', explain: 'Agent đang chờ nhập, thường là xin quyền chạy lệnh.' },
  'worker.timeline-gap': { label: 'Timeline bị hở', tone: 'mustard', explain: 'Paseo timeline hở so với cursor đã lưu, có thể thiếu report.' },
  'worker.timeline-incomplete': { label: 'Timeline chưa đủ', tone: 'mustard', explain: 'Lượt cuối chưa kết thúc, chưa thu được report.' },
  'worker.report-invalid': { label: 'Report sai định dạng', tone: 'red', explain: 'Report sai JSON hoặc định danh, Foreman không nhận.' },
  'worker.report-missing': { label: 'Thiếu report', tone: 'mustard', explain: 'Lượt đã xong nhưng không có report hợp lệ.' },
  'task.workspace-missing': { label: 'Mất workspace', tone: 'red', explain: 'Thư mục workspace không còn trên đĩa.' },
  'task.branch-mismatch': { label: 'Sai branch', tone: 'red', explain: 'Workspace đang ở branch khác lúc dispatch.' },
  'task.endpoint-missing': { label: 'Thiếu endpoint', tone: 'red', explain: 'Task đã dispatch nhưng không có endpoint.' },
  'task.runtime-generation-mismatch': { label: 'Sai generation', tone: 'red', explain: 'Agent trên runtime có generation khác bản ghi.' },
  'runtime.unknown': { label: 'Runtime unknown', tone: 'mustard', explain: 'Bằng chứng runtime thiếu hoặc mâu thuẫn, chưa đủ để kết luận agent đã chết.' }
};
export function issueOf(type) {
  return ISSUE[type] || { label: type, tone: type && type.indexOf('task.') === 0 ? 'red' : 'mustard', explain: 'Foreman ghi nhận bất thường.' };
}

export const EVENT = {
  report: { label: 'Report', tone: 'blue' },
  done: { label: 'Xong', tone: 'green' },
  blocked: { label: 'Bị chặn', tone: 'red' },
  decision: { label: 'Cần quyết định', tone: 'red' },
  answer: { label: 'Đã trả lời', tone: 'ink' },
  round: { label: 'Round mới', tone: 'ink' },
  dispatch: { label: 'Dispatch', tone: 'blue' },
  created: { label: 'Task mới', tone: 'ink' },
  anomaly: { label: 'Bất thường', tone: 'mustard' },
  accepted: { label: 'Đã accept', tone: 'green' },
  discarded: { label: 'Đã discard', tone: 'ink' }
};

export const POINT_KIND = { decision: 'Quyết định', obligation: 'Việc phải làm', check: 'Kiểm tra' };

// ---------- Time, Vietnamese
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export function dur(ms) {
  if (ms < MIN) return 'vừa xong';
  if (ms < HOUR) return Math.floor(ms / MIN) + ' phút';
  if (ms < DAY) { const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / MIN); return h + ' giờ' + (m ? ' ' + m + ' phút' : ''); }
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR);
  return d + ' ngày' + (h ? ' ' + h + ' giờ' : '');
}
export function durShort(ms) {
  if (ms < MIN) return '<1p';
  if (ms < HOUR) return Math.floor(ms / MIN) + 'p';
  if (ms < DAY) { const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / MIN); return h + 'g' + (m ? String(m).padStart(2, '0') : ''); }
  return Math.floor(ms / DAY) + 'n' + Math.floor((ms % DAY) / HOUR) + 'g';
}
export function ago(ts, now) { const t = dur(Math.max(0, now - ts)); return t === 'vừa xong' ? t : t + ' trước'; }
const pad = (n) => String(n).padStart(2, '0');
export function clock(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
export function clockSec(ts) { const d = new Date(ts); return clock(ts) + ':' + pad(d.getSeconds()); }
const WD = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
export function dateLabel(ts) { const d = new Date(ts); return WD[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
export function dayLabel(ts, now) {
  const a = new Date(ts), b = new Date(now);
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime(), db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  const diff = Math.round((db - da) / DAY);
  return (diff === 0 ? 'Hôm nay' : diff === 1 ? 'Hôm qua' : diff + ' ngày trước') + ' — ' + dateLabel(ts);
}
export const TIME = { MIN, HOUR, DAY };

export function cx() { const o = []; for (let i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }

// Copy text; the dashboard never runs a command.
export function copyText(text) {
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok ? Promise.resolve(text) : Promise.reject(new Error('copy failed'));
  }
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => text, fallback);
  return fallback();
}
