import { h, F, useState, useEffect, useRef, useMemo, useCallback } from './react.js';
import * as M from './model.js';
import { useLiveSnapshot } from './live.js';
import { Board, TaskPeek } from './board.js';
import { Inbox } from './inbox.js';
import { TaskPage, Timeline, Health, Projects, Tokens, Settings, KEYS } from './screens.js';

const { STATUS, clockSec, copyText } = F;

// Per-browser conveniences only: display preferences, the selected task, and which reports this browser has seen.
const store = {
  get(k, d) { try { const v = localStorage.getItem('fm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('fm.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};
const TITLES = { board: 'Tổng quan', inbox: 'Chờ bạn', task: 'Task', timeline: 'Timeline', health: 'Health', projects: 'Dự án & lease', tokens: 'Token & cache', settings: 'Cài đặt' };

function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/');
  return { view: TITLES[parts[0]] ? parts[0] : 'board', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}
function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q), f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

// A report is new to this browser until its task is selected; reports from before the first visit count as seen.
function useSeen() {
  const [seen, setSeen] = useState(() => store.get('seen', null) || { since: Date.now(), tasks: {} });
  useEffect(() => { store.set('seen', seen); }, [seen]);
  const isNew = useCallback((t) => { const at = M.lastReportAt(t); return at != null && at > Math.max(seen.since, seen.tasks[t.taskId] || 0); }, [seen]);
  const markSeen = useCallback((t) => { const at = M.lastReportAt(t); if (at != null) setSeen((s) => (s.tasks[t.taskId] >= at ? s : { ...s, tasks: { ...s.tasks, [t.taskId]: at } })); }, []);
  return { isNew, markSeen };
}

function App() {
  const { snapshot, conn, lastUpdate, reconnect } = useLiveSnapshot();
  const [route, setRoute] = useState(parseHash);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(() => store.get('selected', null));
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [prefs, setPrefsState] = useState(() => ({ density: 'comfortable', showLanes: true, markNew: true, titleCount: true, notify: false, ...store.get('prefs', {}) }));
  const [themePref, setThemePrefState] = useState(() => store.get('theme', 'system'));
  const sysDark = useMedia('(prefers-color-scheme: dark)');
  const wide = useMedia('(min-width: 1280px)');
  const narrow = useMedia('(max-width: 900px)');
  const theme = themePref === 'system' ? (sysDark ? 'dark' : 'light') : themePref;
  const notifyState = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const { isNew, markSeen } = useSeen();
  const snap = snapshot && snapshot.state === 'ready' ? snapshot : null;
  const tasks = useMemo(() => (snap ? snap.tasks : []), [snap]);

  const setPrefs = (p) => setPrefsState((cur) => { const n = { ...cur, ...p }; store.set('prefs', n); return n; });
  const setThemePref = (v) => { setThemePrefState(v); store.set('theme', v); };
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Ages tick without new data.
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(i); }, []);
  useEffect(() => { setNow(Date.now()); }, [snapshot]);
  useEffect(() => { const f = () => setRoute(parseHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = useCallback((view, arg) => { const hash = '#/' + view + (arg ? '/' + encodeURIComponent(arg) : ''); if (location.hash !== hash) location.hash = hash; else setRoute(parseHash()); window.scrollTo(0, 0); setDrawer(false); }, []);

  const toast = useCallback((text, opts = {}) => { const id = Math.random().toString(36).slice(2); setToasts((l) => l.concat([{ id, text, ...opts }]).slice(-3)); setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), opts.ms || 3200); }, []);
  const onCopied = useCallback((text, failed) => toast(failed ? 'Không copy được, hãy copy tay: ' + text : 'Đã copy: ' + text, { tone: failed ? 'red' : null }), [toast]);

  const select = (id) => {
    setSelected(id); store.set('selected', id);
    const t = tasks.find((x) => x.taskId === id); if (t) markSeen(t);
    if (!wide && route.view === 'board') setDrawer(true);
  };
  useEffect(() => { if (tasks.length && !tasks.find((t) => t.taskId === selected)) setSelected(M.ordered(tasks, now)[0].taskId); }, [tasks]);

  // A task that newly needs the user or turns anomalous is announced once, in the page and optionally by the browser.
  const groupsBefore = useRef(null);
  useEffect(() => {
    if (!snap) return;
    const current = new Map(tasks.map((t) => [t.taskId, M.groupOf(t, Date.now()) + ':' + M.statusKey(t)]));
    const before = groupsBefore.current;
    groupsBefore.current = current;
    if (!before) return;
    tasks.forEach((t) => {
      const key = current.get(t.taskId);
      if (before.get(t.taskId) === key) return;
      const group = key.split(':')[0];
      if (group !== 'you' && group !== 'anomaly') return;
      const text = t.taskId + ': ' + (group === 'you' ? STATUS[M.statusKey(t)].label.toLowerCase() : 'bất thường') + '.';
      setFlashId(t.taskId); setTimeout(() => setFlashId(null), 2600);
      toast(text, { action: { label: 'Xem', run: () => go('task', t.taskId) }, ms: 6000 });
      if (prefs.notify && notifyState === 'granted') { try { new Notification('Foreman — ' + text, { body: t.title }); } catch (e) { /* not allowed here */ } }
    });
  }, [snap]);

  const youCount = tasks.filter((t) => M.groupOf(t, now) === 'you').length;
  const anomalyCount = tasks.filter((t) => M.groupOf(t, now) === 'anomaly').length;
  useEffect(() => {
    const base = (route.view === 'task' && route.arg ? route.arg + ' · ' : '') + TITLES[route.view] + ' — Foreman';
    document.title = (prefs.titleCount && youCount ? '(' + youCount + ') ' : '') + base;
  }, [route, youCount, prefs.titleCount]);

  // ---------- Keyboard
  const gPending = useRef(false);
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (palette || help) return;
      if (gPending.current) {
        gPending.current = false;
        const map = { b: 'board', i: 'inbox', t: 'timeline', h: 'health', p: 'projects', k: 'tokens', s: 'settings' };
        if (map[e.key.toLowerCase()]) { e.preventDefault(); go(map[e.key.toLowerCase()]); }
        return;
      }
      if (e.key === 'g') { gPending.current = true; setTimeout(() => { gPending.current = false; }, 1200); return; }
      if (e.key === '/') { e.preventDefault(); setPalette(true); return; }
      if (e.key === '?') { e.preventDefault(); setHelp(true); return; }
      if (route.view === 'board' && (e.key === 'j' || e.key === 'k')) {
        const rows = Array.from(document.querySelectorAll('.fm-fleet tr.row')).map((r) => r.getAttribute('data-task'));
        if (!rows.length) return;
        const i = rows.indexOf(selected), n = e.key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
        select(rows[n < 0 ? 0 : n]);
        const el = document.querySelector('.fm-fleet tr.row[data-task="' + rows[n < 0 ? 0 : n] + '"]'); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
        e.preventDefault();
      }
      const target = route.view === 'task' ? route.arg : route.view === 'board' ? selected : null;
      if (e.key === 'c' && target) {
        const t = tasks.find((x) => x.taskId === target); const a = t && M.actionsFor(t, now);
        if (a && (a.text || a.cli)) copyText(a.text || a.cli).then(() => onCopied(a.text || a.cli), () => onCopied(a.text || a.cli, true));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, selected, tasks, palette, help, now, wide]);

  const nav = [
    { id: 'board', label: 'Tổng quan' },
    { id: 'inbox', label: 'Chờ bạn', count: youCount, tone: 'red', countLabel: youCount + ' việc chờ bạn' },
    { id: 'timeline', label: 'Timeline' },
    { sep: true, key: 's1' },
    { id: 'health', label: 'Health', count: anomalyCount, tone: 'mustard', countLabel: anomalyCount + ' bất thường' },
    { id: 'projects', label: 'Dự án & lease' },
    { id: 'tokens', label: 'Token & cache' },
    { id: 'settings', label: 'Cài đặt' }
  ];
  const paletteItems = useMemo(() => {
    const screens = nav.filter((n) => n.id).map((n) => ({ key: 'v-' + n.id, group: 'Màn hình', kicker: '→', title: n.label, sub: '', run: () => go(n.id) }));
    const ts = M.ordered(tasks, now).map((t) => ({ key: 't-' + t.taskId, group: 'Task', kicker: t.taskId, title: t.title, sub: STATUS[M.statusKey(t)].label + ' · ' + t.projectId, run: () => go('task', t.taskId) }));
    return ts.concat(screens);
  }, [tasks, now, youCount]);

  const live = { state: conn, time: lastUpdate ? clockSec(lastUpdate) : '—' };
  const view = route.view;
  const selTask = tasks.find((t) => t.taskId === selected);
  const lastCheck = snap ? Object.values(snap.backends || {}).map((b) => b.checkedAt).filter(Boolean).sort().pop() : null;

  let content;
  if (!snapshot) content = h('div', null, h(F.PageHeader, { title: TITLES[view] }), h(F.Skeleton, { block: true }), h('div', { style: { height: 12 } }), h(F.Skeleton, { lines: 6 }));
  else if (snapshot.state === 'missing-home') content = h(F.StateNotice, { state: 'missing-home', actions: h(F.CopyCommand, { quiet: true, label: 'Chạy từ checkout Foreman', cli: 'bin/foreman init', onCopied }) }, 'Không có ', h('code', null, snapshot.home + '/data'), '. Nhờ Foreman chạy ', h('code', null, 'foreman init'), ' trước, hoặc đặt ', h('code', null, 'FOREMAN_HOME'), ' đúng home rồi chạy lại dashboard.');
  else if (snapshot.state !== 'ready') content = h(F.StateNotice, { state: 'error', actions: h(F.CopyCommand, { quiet: true, label: 'Kiểm tra trong terminal', cli: 'foreman task list --json --summary', onCopied }) }, 'Đọc ', h('code', null, 'data/'), ' thất bại: ', h('code', null, snapshot.error || 'không rõ lỗi'), '. Sẽ tự thử lại.');
  else if (view === 'board') content = h(Board, { tasks, now, selected, onSelect: select, onOpenFull: (id) => go('task', id), onOpenInbox: (k) => go('inbox', k), onCopied, prefs: { ...prefs, cards: narrow }, setPrefs, wide, flashId, isNew });
  else if (view === 'inbox') content = h(Inbox, { tasks, now, profiles: snap.profiles || [], current: route.arg, isNew, onPick: (k) => { go('inbox', k); const t = tasks.find((x) => x.taskId === k.split(':')[0]); if (t) markSeen(t); }, onOpenFull: (id) => go('task', id), onCopied });
  else if (view === 'task') content = h(TaskPage, { t: tasks.find((t) => t.taskId === route.arg), tasks, now, onBack: () => go('board'), onOpen: (id) => go('task', id), onCopied });
  else if (view === 'timeline') content = h(Timeline, { tasks, now, snap, onOpen: (id) => go('task', id) });
  else if (view === 'health') content = h(Health, { tasks, now, snap, conn, onOpen: (id) => go('task', id), onCopied });
  else if (view === 'projects') content = h(Projects, { tasks, now, snap, onOpen: (id) => go('task', id) });
  else if (view === 'tokens') content = h(Tokens);
  else content = h(Settings, { tasks, snap, prefs, setPrefs, themePref, setThemePref, notifyState,
    onNotify: (v) => { if (!v) return setPrefs({ notify: false }); if (typeof Notification === 'undefined') return; Notification.requestPermission().then((p) => { setPrefs({ notify: p === 'granted' }); if (p !== 'granted') toast('Trình duyệt không cho phép thông báo.', { tone: 'red' }); }); } });
  useEffect(() => { if (view === 'task' && route.arg) { const t = tasks.find((x) => x.taskId === route.arg); if (t) markSeen(t); } }, [view, route.arg, tasks]);

  const since = lastUpdate ? clockSec(lastUpdate) : '—';
  return h(F.Sheet, null,
    h(F.TopBar, { nav, current: view === 'task' ? null : view, onNavigate: (id) => go(id), live, onHome: () => go('board'), onSearch: () => setPalette(true), onHelp: () => setHelp(true), theme, onTheme: () => setThemePref(theme === 'dark' ? 'light' : 'dark') }),
    h(F.Perforation),
    h('main', { className: 'fm-main', 'aria-labelledby': 'page-title' },
      conn === 'offline' ? h('div', { style: { marginBottom: 16 } }, h(F.Banner, { tone: 'red', lead: 'Mất kết nối', actions: h(F.Button, { variant: 'flat', size: 'sm', onClick: reconnect }, 'Thử lại') }, 'Dữ liệu dừng lúc ' + since + '. Đang tự kết nối lại mỗi 5 giây.')) : null,
      conn === 'reconnecting' && snapshot ? h('div', { style: { marginBottom: 16 } }, h(F.Banner, { tone: 'mustard', lead: 'Đang kết nối lại' }, 'Dữ liệu lúc ' + since + '.')) : null,
      conn === 'stale' ? h('div', { style: { marginBottom: 16 } }, h(F.Banner, { tone: 'ink', lead: 'Poll 5 giây' }, 'SSE không mở được, đang cập nhật mỗi 5 giây.')) : null,
      content),
    h('footer', { className: 'fm-footer' },
      h('span', null, 'Chỉ đọc · FOREMAN_HOME=' + (snapshot ? snapshot.home : '—')),
      h('span', null, tasks.length + ' task chưa accept'),
      h('span', null, 'Status check ' + (lastCheck ? clockSec(lastCheck) : '—')),
      h('span', { className: 'end' }, 'Nhấn ', h('span', { className: 'fm-kbd' }, '?'), ' xem phím tắt')),
    drawer && !wide && view === 'board' && selTask ? h(F.Drawer, { onClose: () => setDrawer(false), label: 'Chi tiết ' + selected }, h(TaskPeek, { t: selTask, all: tasks, now, onOpenFull: (id) => go('task', id), onOpenInbox: (k) => go('inbox', k), onClose: () => setDrawer(false), onCopied })) : null,
    palette ? h(F.CommandPalette, { items: paletteItems, onClose: () => setPalette(false) }) : null,
    help ? h(F.Dialog, { title: 'Phím tắt', onClose: () => setHelp(false) }, h(F.KeyHelp, { groups: KEYS }), h(F.Callout, { variant: 'note', lead: 'Chỉ đọc.' }, 'Các nút Copy chỉ copy prompt hoặc CLI, dashboard không gửi gì.')) : null,
    h(F.Toasts, { items: toasts, onDismiss: (id) => setToasts((l) => l.filter((x) => x.id !== id)) }));
}

window.ReactDOM.createRoot(document.getElementById('root')).render(h(App));
