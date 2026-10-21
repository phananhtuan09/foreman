import React, { useState, useEffect, useRef, useMemo, useCallback } from '../ds/react.js';
import * as F from '../ds/components.jsx';
import { STATUS, clockSec, cx, copyText } from '../ds/vocab.js';
import * as M from './model.js';
import { NOW, TASKS, SUPERVISION } from './data.js';
import { Board, TaskPeek } from './board.jsx';
import { Inbox, inboxItems } from './inbox.jsx';
import { TaskPage, Timeline, Health, Projects, Tokens, Settings, KEYS } from './screens.jsx';
import { DesignNotes } from './notes.jsx';

const store = {
  get(k, d) { try { const v = localStorage.getItem('fm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('fm.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};
const TITLES = { board: 'Tổng quan', inbox: 'Chờ bạn', task: 'Task', timeline: 'Timeline', health: 'Health', projects: 'Dự án & lease', tokens: 'Token & cache', settings: 'Cài đặt' };

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '').split('/');
  const view = TITLES[h[0]] ? h[0] : 'board';
  return { view, arg: h[1] ? decodeURIComponent(h[1]) : null };
}
function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q), f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

export function App() {
  const [route, setRoute] = useState(parseHash);
  const [tasks, setTasks] = useState(TASKS);
  const [sup, setSup] = useState(SUPERVISION);
  const [conn, setConn] = useState('live');
  const [dataState, setDataState] = useState('ready');
  const [lastUpdate, setLastUpdate] = useState(NOW);
  const [now, setNow] = useState(NOW);
  const [selected, setSelected] = useState(() => store.get('selected', 'T-42'));
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [notes, setNotes] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [prefs, setPrefsState] = useState(() => ({ density: 'comfortable', showLanes: true, markNew: true, titleCount: true, notify: false, ...store.get('prefs', {}) }));
  const [themePref, setThemePrefState] = useState(() => store.get('theme', 'system'));
  const sysDark = useMedia('(prefers-color-scheme: dark)');
  const wide = useMedia('(min-width: 1280px)');
  const narrow = useMedia('(max-width: 900px)');
  const embedded = !!window.__FM_EMBED;
  const theme = embedded ? (document.documentElement.getAttribute('data-theme') || 'light') : themePref === 'system' ? (sysDark ? 'dark' : 'light') : themePref;
  const notifyState = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const t0 = useRef(Date.now());

  const setPrefs = (p) => setPrefsState((cur) => { const n = { ...cur, ...p }; store.set('prefs', n); return n; });
  const setThemePref = (v) => { setThemePrefState(v); store.set('theme', v); };
  useEffect(() => { if (!embedded) document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Clock: sample "now" advances in real time so ages tick.
  useEffect(() => { const i = setInterval(() => { const n = NOW + (Date.now() - t0.current); setNow(n); if (conn === 'live') setLastUpdate(n); }, 15000); return () => clearInterval(i); }, [conn]);
  useEffect(() => { const f = () => setRoute(parseHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = useCallback((view, arg) => { const h = '#/' + view + (arg ? '/' + encodeURIComponent(arg) : ''); if (location.hash !== h) location.hash = h; else setRoute(parseHash()); window.scrollTo(0, 0); setDrawer(false); }, []);

  const toast = useCallback((text, opts = {}) => { const id = Math.random().toString(36).slice(2); setToasts((l) => l.concat([{ id, text, ...opts }]).slice(-3)); setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), opts.ms || 3200); }, []);
  const onCopied = useCallback((text, failed) => toast(failed ? 'Không copy được, hãy copy tay: ' + text : 'Đã copy: ' + text, { tone: failed ? 'red' : null }), [toast]);

  const select = (id) => {
    setSelected(id); store.set('selected', id);
    setTasks((l) => l.map((t) => t.taskId === id && t.unread ? { ...t, unread: false } : t));
    if (!wide && route.view === 'board') setDrawer(true);
  };

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
      if (palette || help || notes) return;
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
      if (e.key === 'c' && selected) {
        const t = tasks.find((x) => x.taskId === selected); const a = t && M.actionsFor(t, now);
        if (a && (a.text || a.cli)) copyText(a.text || a.cli).then(() => onCopied(a.text || a.cli));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, selected, tasks, palette, help, notes, now, wide]);

  // ---------- Simulation (design file only)
  const demo = {
    report() {
      const id = 'T-40', at = now;
      setTasks((l) => l.map((t) => t.taskId !== id ? t : { ...t, status: 'review-ready', statusSince: at, lastActivityAt: at, runtime: 'idle', unread: true, rounds: [{ ...t.rounds[0], reports: t.rounds[0].reports.concat([{ status: 'done', at, summary: 'Kết quả: skill triage hoàn chỉnh với 5 trạng thái và template hỏi reporter.\nThay đổi: 6 file trong skills/triage.\nBằng chứng: 22/22 test pass; chạy thử trên 10 issue thật.\nChưa kiểm: PR từ fork.\nRủi ro: thấp.', steps: ['Accept task.', 'Thử với PR từ fork.'] }]) }].concat(t.rounds.slice(1)) }));
      setFlashId(id); setTimeout(() => setFlashId(null), 2600);
      toast('T-40 xong, chờ bạn duyệt.', { action: { label: 'Xem', run: () => { go('inbox', 'T-40:review-ready'); } }, ms: 6000 });
      if (prefs.notify && notifyState === 'granted') { try { new Notification('Foreman: T-40 chờ bạn duyệt', { body: 'Skill triage: phân loại issues/PRs' }); } catch (e) { /* ignore */ } }
    },
    anomaly() {
      const id = 'T-36', at = now;
      setTasks((l) => l.map((t) => t.taskId !== id ? t : { ...t, runtime: 'missing', issues: [{ type: 'task.endpoint-missing', at }] }));
      setFlashId(id); setTimeout(() => setFlashId(null), 2600);
      toast('T-36: agent missing trên runtime.', { ms: 6000 });
    },
    offline() { setConn('offline'); toast('Mất kết nối với dashboard server.', { tone: 'red' }); },
    reconnect() { setConn('reconnecting'); setTimeout(() => { setConn('live'); setLastUpdate(NOW + (Date.now() - t0.current)); toast('Đã kết nối lại.'); }, 1800); },
    stale() { setConn('stale'); },
    reset() { setTasks(TASKS); setSup(SUPERVISION); setConn('live'); setDataState('ready'); }
  };

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
    const ts = M.GROUPS.reduce((acc, g) => acc.concat(M.sortGroup(g.key, tasks.filter((t) => M.groupOf(t, now) === g.key), now)), []).map((t) => ({ key: 't-' + t.taskId, group: 'Task', kicker: t.taskId, title: t.title, sub: STATUS[M.statusKey(t)].label + ' · ' + t.projectId, run: () => go('task', t.taskId) }));
    return ts.concat(screens);
  }, [tasks, now, youCount]);

  const live = { state: conn, time: clockSec(lastUpdate) };
  const view = route.view;
  const selTask = tasks.find((t) => t.taskId === selected);

  let content;
  if (dataState !== 'ready') {
    content = <SystemState state={dataState} />;
  } else if (view === 'board') content = <Board tasks={tasks} now={now} sup={sup} selected={selected} onSelect={select} onOpenFull={(id) => go('task', id)} onOpenInbox={(k) => go('inbox', k)} onCopied={onCopied} prefs={{ ...prefs, cards: narrow }} setPrefs={setPrefs} wide={wide} flashId={flashId} />;
  else if (view === 'inbox') content = <Inbox tasks={tasks} now={now} current={route.arg} onPick={(k) => { go('inbox', k); const id = k.split(':')[0]; setTasks((l) => l.map((t) => t.taskId === id && t.unread ? { ...t, unread: false } : t)); }} onOpenFull={(id) => go('task', id)} onCopied={onCopied} />;
  else if (view === 'task') content = <TaskPage t={tasks.find((t) => t.taskId === route.arg)} tasks={tasks} now={now} sup={sup} onBack={() => go('board')} onOpen={(id) => go('task', id)} onCopied={onCopied} />;
  else if (view === 'timeline') content = <Timeline tasks={tasks} now={now} sup={sup} onOpen={(id) => go('task', id)} />;
  else if (view === 'health') content = <Health tasks={tasks} now={now} sup={sup} conn={conn} onOpen={(id) => go('task', id)} onCopied={onCopied} />;
  else if (view === 'projects') content = <Projects tasks={tasks} now={now} onOpen={(id) => go('task', id)} />;
  else if (view === 'tokens') content = <Tokens />;
  else content = <Settings tasks={tasks} sup={sup} prefs={prefs} setPrefs={setPrefs} theme={theme} themePref={themePref} setThemePref={setThemePref} notifyState={notifyState}
    onNotify={(v) => { if (!v) return setPrefs({ notify: false }); if (typeof Notification === 'undefined') return; Notification.requestPermission().then((p) => { setPrefs({ notify: p === 'granted' }); if (p !== 'granted') toast('Trình duyệt không cho phép thông báo.', { tone: 'red' }); }); }} />;

  return (
    <F.Sheet>
      <F.TopBar nav={nav} current={view === 'task' ? null : view} onNavigate={(id) => go(id)} live={live} onHome={() => go('board')} onSearch={() => setPalette(true)} onHelp={() => setHelp(true)} theme={theme} onTheme={embedded ? null : () => setThemePref(theme === 'dark' ? 'light' : 'dark')} />
      <F.Perforation />
      <main className="fm-main" aria-labelledby="page-title">
        {conn === 'offline' ? <div style={{ marginBottom: 16 }}><F.Banner tone="red" lead="Mất kết nối" actions={<F.Button variant="flat" size="sm" onClick={demo.reconnect}>Thử lại</F.Button>}>Dữ liệu dừng lúc {clockSec(lastUpdate)}. Đang tự kết nối lại mỗi 5 giây.</F.Banner></div> : null}
        {conn === 'reconnecting' ? <div style={{ marginBottom: 16 }}><F.Banner tone="mustard" lead="Đang kết nối lại">Dữ liệu lúc {clockSec(lastUpdate)}.</F.Banner></div> : null}
        {conn === 'stale' ? <div style={{ marginBottom: 16 }}><F.Banner tone="ink" lead="Poll 5 giây">SSE không mở được, đang cập nhật mỗi 5 giây.</F.Banner></div> : null}
        {content}
      </main>
      <footer className="fm-footer">
        <span>Chỉ đọc · FOREMAN_HOME={sup.server.home}</span><span>{tasks.length} task chưa accept</span><span>Status check {clockSec(sup.lastCheckAt)}</span>
        <span className="end">Nhấn <span className="fm-kbd">?</span> xem phím tắt</span>
      </footer>
      {drawer && !wide && view === 'board' && selTask ? <F.Drawer onClose={() => setDrawer(false)} label={'Chi tiết ' + selected}><TaskPeek t={selTask} all={tasks} now={now} onOpenFull={(id) => go('task', id)} onOpenInbox={(k) => go('inbox', k)} onClose={() => setDrawer(false)} onCopied={onCopied} /></F.Drawer> : null}
      {palette ? <F.CommandPalette items={paletteItems} onClose={() => setPalette(false)} /> : null}
      {help ? <F.Dialog title="Phím tắt" onClose={() => setHelp(false)}><F.KeyHelp groups={KEYS} /><F.Callout variant="note" lead="Chỉ đọc.">Các nút Copy chỉ copy prompt hoặc CLI, dashboard không gửi gì.</F.Callout></F.Dialog> : null}
      <F.Toasts items={toasts} onDismiss={(id) => setToasts((l) => l.filter((x) => x.id !== id))} />
      {notes ? <F.Dialog title="Ghi chú thiết kế" onClose={() => setNotes(false)}><DesignNotes /></F.Dialog> : null}
      <DemoPanel demo={demo} dataState={dataState} setDataState={setDataState} conn={conn} onNotes={() => setNotes(true)} />
    </F.Sheet>
  );
}

function SystemState({ state }) {
  if (state === 'loading') return <div><F.PageHeader title="Tổng quan" /><F.Skeleton block /><div style={{ height: 12 }} /><F.Skeleton lines={6} /></div>;
  if (state === 'unconfigured') return <F.StateNotice state="unconfigured" actions={<F.CopyCommand quiet label="Chạy từ checkout Foreman" cli="FOREMAN_HOME=~/.foreman-home bin/foreman dashboard serve" />}>Chưa có <code>FOREMAN_HOME</code>. Chạy lệnh dưới từ thư mục Foreman.</F.StateNotice>;
  if (state === 'missing-home') return <F.StateNotice state="missing-home">Không có <code>~/.foreman-home/data</code>. Nhờ Foreman chạy <code>foreman init</code> trước.</F.StateNotice>;
  if (state === 'error') return <F.StateNotice state="error" actions={<F.CopyCommand quiet label="Kiểm tra trong terminal" cli="foreman task list --json --summary" />}>Đọc <code>data/tasks</code> thất bại: <code>EACCES: permission denied</code>. Sẽ tự thử lại.</F.StateNotice>;
  return <F.StateNotice state="empty" title="Chưa có task">Giao việc trong phiên Foreman, task sẽ hiện ở đây.</F.StateNotice>;
}

function DemoPanel({ demo, dataState, setDataState, conn, onNotes }) {
  const [open, setOpen] = useState(false);
  const style = { position: 'fixed', right: 12, bottom: 12, zIndex: 55, maxWidth: 'calc(100vw - 24px)' };
  if (!open) return <div style={style}><F.Button size="sm" onClick={() => setOpen(true)} aria-label="Mở bảng mô phỏng (chỉ có trong bản thiết kế)">▶ Bản thiết kế</F.Button></div>;
  return (
    <div style={style}>
      <div className="fm-card" style={{ width: 300, boxShadow: 'var(--raise-modal)' }} role="region" aria-label="Bảng mô phỏng">
        <h4>Bản thiết kế<span className="end"><button type="button" className="fm-back" onClick={() => setOpen(false)}>đóng ✕</button></span></h4>
        <p className="fm-faint" style={{ fontSize: 12, margin: '0 0 8px' }}>Chỉ có trong file thiết kế. Dữ liệu là mẫu; các nút dưới đây giả lập sự kiện để xem mọi trạng thái.</p>
        <div style={{ marginBottom: 8 }}><F.Button size="sm" variant="primary" onClick={onNotes}>Đọc ghi chú thiết kế</F.Button></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <F.Button size="sm" variant="flat" onClick={demo.report}>Report mới (T-40 xong)</F.Button>
          <F.Button size="sm" variant="flat" onClick={demo.anomaly}>Agent missing</F.Button>
          <F.Button size="sm" variant="flat" onClick={conn === 'offline' ? demo.reconnect : demo.offline}>{conn === 'offline' ? 'Kết nối lại' : 'Mất kết nối'}</F.Button>
          <F.Button size="sm" variant="flat" onClick={demo.stale}>SSE rớt (poll)</F.Button>
          <F.Button size="sm" variant="ghost" onClick={demo.reset}>Đặt lại dữ liệu</F.Button>
        </div>
        <div style={{ marginTop: 10 }}><F.SelectField label="Trạng thái dữ liệu" value={dataState} onChange={setDataState} options={[{ value: 'ready', label: 'Bình thường' }, { value: 'loading', label: 'Đang tải' }, { value: 'empty', label: 'Chưa có task' }, { value: 'unconfigured', label: 'Chưa cấu hình' }, { value: 'missing-home', label: 'Thiếu home' }, { value: 'error', label: 'Lỗi đọc' }]} /></div>
      </div>
    </div>
  );
}

export function mount(el) { window.ReactDOM.createRoot(el).render(<App />); }
