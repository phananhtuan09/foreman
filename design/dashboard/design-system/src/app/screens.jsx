import React, { useState, Fragment } from '../ds/react.js';
import * as F from '../ds/components.jsx';
import { STATUS, RUNTIME, EVENT, POINT_KIND, issueOf, dur, ago, clock, clockSec, dayLabel, dateLabel, cx, copyText } from '../ds/vocab.js';
import * as M from './model.js';
import { PROFILES, PROJECTS, TOKENS } from './data.js';

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

// ================= Task page =================
export function TaskPage({ t, tasks, now, sup, onBack, onOpen, onCopied }) {
  const [tab, setTab] = useState('rounds');
  if (!t) return <div><button type="button" className="fm-back" onClick={onBack}>← Tổng quan</button><div style={{ marginTop: 16 }}><F.StateNotice state="empty" stamp="Không còn" title="Task không còn tồn tại">Task đã được accept hoặc discard. Workspace vẫn còn trên đĩa.</F.StateNotice></div></div>;
  const k = M.statusKey(t), act = M.actionsFor(t, now), a = M.anomalyOf(t, now);
  const dependents = tasks.filter((x) => (x.dependencies || []).indexOf(t.taskId) >= 0);
  const msgs = sup.outbox.filter((m) => m.taskId === t.taskId);
  const pts = t.attention || [];
  const tabs = [
    { id: 'rounds', label: 'Round & report', count: t.rounds.length },
    { id: 'decisions', label: 'Quyết định', count: (t.decisions || []).length, tone: M.pendingDecision(t) ? 'red' : null },
    { id: 'points', label: 'Attention', count: pts.filter((p) => p.state === 'open').length, tone: pts.some((p) => p.state === 'open' && p.owner === 'user') ? 'red' : null },
    { id: 'messages', label: 'Outbox', count: msgs.length }
  ];
  return (
    <div>
      <button type="button" className="fm-back" onClick={onBack}>← Tổng quan</button>
      <F.PageHeader plain eyebrow={<><span className="fm-no">{t.taskId}</span><F.TypeTag type={t.type} /><F.ProjectTag>{t.projectId}</F.ProjectTag><span>tạo {ago(t.createdAt, now)}</span></>} title={t.title} id="page-title"
        actions={<F.Stamp status={k} />} />
      {a.issues.length ? <div style={{ marginBottom: 16 }}>{a.issues.map((i) => <F.Banner key={i.type} tone={i.tone} lead={i.label}>{i.explain} <span className="fm-faint">{i.type} · {clock(i.at || now)}</span></F.Banner>)}</div> : null}
      <div className="fm-only-narrow"><F.NextBox tone={act.tone} title={act.title} why={act.why} copy={act.text || act.cli ? { text: act.text, cli: act.cli, onCopied, quiet: act.quiet } : null}>{act.what}</F.NextBox></div>
      <div className="fm-grid side">
        <div style={{ minWidth: 0 }}>
          <F.Tabs tabs={tabs} value={tab} onChange={setTab} label="Nội dung task" />
          <div className="fm-tabpanel" role="tabpanel">
            {tab === 'rounds' ? <F.RoundList rounds={M.roundsView(t, now)} now={now} /> : null}
            {tab === 'decisions' ? ((t.decisions || []).length ? (t.decisions || []).map((d) => (
              <F.Card key={d.id} title={d.id + ' · ' + (d.state === 'pending' ? 'chờ bạn' : d.state === 'answered' ? 'đã trả lời, chưa gửi' : 'đã gửi agent')} end={'mở ' + clock(d.createdAt) + ' ' + dayLabel(d.createdAt, now).split(' — ')[0].toLowerCase()} className="">
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{d.finding}</p>
                {d.why ? <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-2)' }}>{d.why}</p> : null}
                <F.DecisionOptions options={d.options} recommendation={d.recommendation} />
                {d.answer ? <div style={{ marginTop: 8 }}><F.Quote solid source="bạn trả lời">{d.answer}</F.Quote></div> : null}
              </F.Card>
            )) : <p className="fm-faint">Chưa có quyết định nào.</p>) : null}
            {tab === 'points' ? <F.PointList points={pts} kinds={POINT_KIND} now={now} /> : null}
            {tab === 'messages' ? (msgs.length ? <table className="fm-table"><thead><tr><th>Message</th><th>Loại</th><th>Trạng thái</th><th className="r">Lúc</th></tr></thead><tbody>{msgs.map((m) => <tr key={m.id}><td className="mono">{m.id}</td><td className="mono">{m.kind}</td><td><F.StatusLabel tone={m.state === 'failed' ? 'red' : m.state === 'pending' ? 'mustard' : 'green'} size="sm">{m.state}</F.StatusLabel></td><td className="r mono">{clock(m.at)}</td></tr>)}</tbody></table> : <p className="fm-faint">Outbox trống.</p>) : null}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="fm-only-wide"><F.NextBox tone={act.tone} title={act.title} why={act.why} copy={act.text || act.cli ? { text: act.text, cli: act.cli, onCopied, quiet: act.quiet } : null}>{act.what}</F.NextBox></div>
          {act.alt ? <F.CopyCommand quiet label="Hoặc" text={act.alt.text} cli={act.alt.cli} onCopied={onCopied} /> : null}
          <F.Card title="Trạng thái">
            <F.KeyValue items={[
              ['Task', <><F.StatusLabel status={k} size="sm" /> <span className="fm-faint" style={{ fontSize: 12, marginLeft: 6 }}>từ {clock(t.statusSince)}</span></>],
              ['Runtime', t.runtime === 'none' ? <span className="fm-faint">chưa có agent</span> : <F.RuntimeBadge state={t.runtime} />],
              ['Agent', t.profile ? t.profile + (t.backend ? ' · ' + cap(t.backend) : '') : t.routingProfile ? 'đề xuất ' + t.routingProfile : '—', true],
              t.endpoint ? ['Endpoint', t.endpoint + ' · gen ' + t.generation, true] : null,
              t.owner ? ['Owner', t.owner, true] : null,
              ['Hoạt động cuối', ago(t.lastActivityAt, now)]
            ]} />
          </F.Card>
          <F.Card title="Workspace & lease">
            <F.KeyValue items={[
              ['Workspace', t.workspace || 'chưa có', true],
              ['Branch', t.branch || (t.workspace ? 'không dùng git' : '—'), true],
              ['Lease', t.lease.length ? t.lease.map((l) => l.mode + ' ' + l.key).join('\n') : '—', true],
              t.leaseOverlap ? ['Chồng lấn', <span style={{ color: 'var(--mustard-deep)', fontWeight: 600 }}>với {t.leaseOverlap}</span>] : null
            ]} />
            {t.workspace ? <div style={{ marginTop: 8 }}><F.CopyCommand quiet label="Mở workspace" cli={'cd ' + t.workspace} onCopied={onCopied} /></div> : null}
          </F.Card>
          {(t.dependencies || []).length || dependents.length ? (
            <F.Card title="Phụ thuộc">
              <F.KeyValue items={[
                (t.dependencies || []).length ? ['Chờ task', <>{t.dependencies.map((d) => { const o = tasks.find((x) => x.taskId === d); return <button key={d} type="button" className="fm-link" style={{ marginRight: 8 }} onClick={() => onOpen(d)}>{d}{o ? ' · ' + STATUS[M.statusKey(o)].label.toLowerCase() : ''} →</button>; })}</>] : null,
                dependents.length ? ['Đang chặn', <>{dependents.map((d) => <button key={d.taskId} type="button" className="fm-link" style={{ marginRight: 8 }} onClick={() => onOpen(d.taskId)}>{d.taskId} →</button>)}</>] : null
              ]} />
            </F.Card>
          ) : null}
          {t.handoff ? <F.Card title="Handoff gần nhất"><p style={{ margin: 0, fontSize: 13 }}>{t.handoff}</p></F.Card> : null}
          <F.CopyCommand quiet label="Lịch sử đầy đủ" cli={'foreman task history --task ' + t.taskId} onCopied={onCopied} />
        </div>
      </div>
    </div>
  );
}

// ================= Timeline =================
export function Timeline({ tasks, now, sup, onOpen }) {
  const [range, setRange] = useState('today');
  const [types, setTypes] = useState('all');
  const [proj, setProj] = useState('all');
  const [limit, setLimit] = useState(30);
  const day0 = new Date(now); day0.setHours(6, 0, 0, 0);
  const from = range === 'today' ? day0.getTime() : range === '24h' ? now - 24 * 3600000 : now - 72 * 3600000;
  const to = range === 'today' ? Math.max(now + 3600000, day0.getTime() + 6 * 3600000) : now + 3600000;
  const scoped = tasks.filter((t) => proj === 'all' || t.projectId === proj);
  const rows = M.ganttRows(M.GROUPS.reduce((acc, g) => acc.concat(M.sortGroup(g.key, scoped.filter((t) => M.groupOf(t, now) === g.key), now)), []), from, now);
  const TYPE_GROUPS = { all: null, reports: ['report', 'done', 'blocked'], you: ['decision', 'blocked', 'done'], anomaly: ['anomaly'], rounds: ['round', 'created', 'dispatch'], ended: ['accepted', 'discarded'] };
  const events = M.buildEvents(scoped, now, proj === 'all' ? sup.history : sup.history.filter((h) => h.projectId === proj)).filter((e) => !TYPE_GROUPS[types] || TYPE_GROUPS[types].indexOf(e.type) >= 0);
  const youMs = rows.reduce((n, r) => n + r.segs.filter((s) => s.kind === 'you').reduce((m, s) => m + (s.to - s.from), 0), 0);
  const runMs = rows.reduce((n, r) => n + r.segs.filter((s) => s.kind === 'run').reduce((m, s) => m + (s.to - s.from), 0), 0);
  return (
    <div>
      <F.PageHeader no="03" eyebrow="Lịch sử" title="Timeline" id="page-title" />
      <div className="fm-toolbar">
        <F.FilterChips label="Dự án" value={proj} onChange={setProj} options={[{ value: 'all', label: 'Tất cả' }].concat(PROJECTS.map((p) => ({ value: p.id, label: p.id })))} />
      </div>
      <F.SectionHeader title="Thời gian theo task" meta={rows.length + ' task'} end={<F.Segmented label="Khoảng thời gian" value={range} onChange={setRange} options={[{ value: 'today', label: 'Hôm nay' }, { value: '24h', label: '24 giờ' }, { value: '72h', label: '3 ngày' }]} />} />
      <F.KpiStrip label="Tổng hợp khoảng đang xem" items={[
        { label: 'Agent làm', value: (runMs / 3600000).toFixed(1), unit: 'giờ', sub: 'cộng dồn mọi agent' },
        { label: 'Chờ bạn', value: (youMs / 3600000).toFixed(1), unit: 'giờ', sub: 'quyết định, bị chặn, chọn model', tone: youMs > runMs * 0.5 ? 'red' : null },
        { label: 'Tỉ lệ chờ bạn', value: Math.round((youMs / Math.max(1, youMs + runMs)) * 100), unit: '%', sub: 'trên tổng thời gian' }
      ]} />
      <div style={{ height: 12 }} />
      <F.ShiftGantt rows={rows} from={from} to={to} now={now} onOpen={onOpen} />
      <F.SectionHeader title="Nhật ký" meta={events.length + ' sự kiện'} />
      <div className="fm-toolbar"><F.FilterChips label="Loại" value={types} onChange={setTypes} options={[{ value: 'all', label: 'Tất cả' }, { value: 'you', label: 'Chờ bạn' }, { value: 'reports', label: 'Report' }, { value: 'anomaly', label: 'Bất thường' }, { value: 'rounds', label: 'Round & task mới' }, { value: 'ended', label: 'Đã kết thúc' }]} /></div>
      <F.EventLog events={events.slice(0, limit)} onOpen={onOpen} />
      {events.length > limit ? <div style={{ marginTop: 12, textAlign: 'center' }}><F.Button variant="flat" onClick={() => setLimit(limit + 30)}>Xem thêm {Math.min(30, events.length - limit)} sự kiện</F.Button></div> : null}
      <div style={{ marginTop: 16 }}><F.Callout variant="note" lead="Task đã kết thúc">đọc từ <span className="fm-code">data/task-history.jsonl</span> (giữ 365 ngày). File này không lưu nội dung, nên chỉ có tiêu đề nếu dashboard từng thấy task lúc còn mở.</F.Callout></div>
    </div>
  );
}

// ================= Health =================
export function Health({ tasks, now, sup, conn, onOpen, onCopied }) {
  const anomalies = tasks.filter((t) => M.anomalyOf(t, now).any && M.groupOf(t, now) === 'anomaly');
  const hbAge = now - sup.heartbeat.lastFiredAt;
  const checks = [
    { state: conn === 'live' ? 'ok' : conn === 'offline' ? 'bad' : 'warn', name: 'Dashboard server', desc: <>SSE {conn === 'live' ? 'đang mở' : conn === 'stale' ? 'rớt — đang poll 5 giây' : 'mất kết nối'} · <code>{sup.server.bind}:{sup.server.port}</code> · {sup.server.clients} trình duyệt</>, value: conn },
    { state: now - sup.lastCheckAt < 10 * 60000 ? 'ok' : 'warn', name: 'Status check', desc: 'Lần kiểm tra runtime gần nhất.', value: clockSec(sup.lastCheckAt) + ' · ' + ago(sup.lastCheckAt, now) },
    { state: 'ok', name: 'Task collect (Paseo)', desc: 'Thu report từ Paseo timeline.', value: clockSec(sup.lastCollectAt) },
    { state: hbAge < 15 * 60000 ? 'ok' : 'warn', name: 'Heartbeat Paseo', desc: <><code>{sup.heartbeat.id}</code> · <code>{sup.heartbeat.cron}</code> · agent <code>{sup.heartbeat.agent}</code></>, value: 'lần cuối ' + clock(sup.heartbeat.lastFiredAt) },
    ...sup.backends.map((b) => ({ state: b.state, name: 'Runtime ' + cap(b.id), desc: b.detail, value: 'check ' + clock(b.checkedAt) })),
    { state: sup.skipped.length ? 'bad' : 'ok', name: 'Bản ghi task', desc: sup.skipped.length ? sup.skipped.length + ' bản ghi sai schema: ' + sup.skipped.map((s) => s.taskId).join(', ') : 'Mọi meta.json hợp lệ.', value: tasks.length + ' task' }
  ];
  const bad = checks.filter((c) => c.state !== 'ok').length + anomalies.length;
  return (
    <div>
      <F.PageHeader no="04" eyebrow="Hệ thống" title="Health" id="page-title" actions={<F.Stamp tone={bad ? 'mustard' : 'green'}>{bad ? bad + ' mục cần xem' : 'Ổn định'}</F.Stamp>} />
      <F.SectionHeader title="Giám sát & runtime" />
      <F.CheckList items={checks} label="Kiểm tra hệ thống" />
      <F.SectionHeader title="Bất thường" meta={anomalies.length} />
      {anomalies.length ? <div className="fm-tablewrap"><table className="fm-table"><thead><tr><th>Task</th><th>Loại</th><th>Ý nghĩa</th><th>Từ lúc</th><th>Đã báo</th><th /></tr></thead>
        <tbody>{anomalies.map((t) => { const a = M.anomalyOf(t, now), i = a.issues[0] || { label: 'Không hoạt động lâu', explain: 'Không có hoạt động quá ' + M.THRESHOLDS.silentMin + ' phút.', type: 'dashboard.silent' }, act = M.actionsFor(t, now), told = !sup.untold.find((u) => u.taskId === t.taskId); return (
          <tr key={t.taskId}><td><button type="button" className="fm-link" onClick={() => onOpen(t.taskId)}>{t.taskId}</button><div className="fm-faint" style={{ fontSize: 12 }}>{t.profile} · {cap(t.backend)}</div></td><td><F.StatusLabel tone={i.tone || 'mustard'} size="sm">{i.label}</F.StatusLabel><div className="fm-mono fm-faint" style={{ fontSize: 12, marginTop: 2 }}>{i.type}</div></td><td>{i.explain}</td><td>{clock(i.at || t.lastActivityAt)}<div className="fm-faint">{ago(i.at || t.lastActivityAt, now)}</div></td><td>{told ? 'rồi' : <F.StatusLabel tone="mustard" size="sm">chưa</F.StatusLabel>}</td><td className="r"><F.Button variant="flat" size="sm" onClick={() => copyText(act.text).then(() => onCopied(act.text))}>Copy prompt</F.Button></td></tr>); })}</tbody></table></div>
        : <F.StateNotice small state="empty" stamp="Ổn" title="Không có bất thường">Runtime của mọi agent khớp bản ghi.</F.StateNotice>}
      <div className="fm-grid c2" style={{ marginTop: 24 }}>
        <div>
          <F.SectionHeader title="Notice chưa báo" meta={sup.untold.length} />
          {sup.untold.length ? <table className="fm-table"><thead><tr><th>Task</th><th>Sự kiện</th><th className="r">Lúc</th></tr></thead><tbody>{sup.untold.map((u) => <tr key={u.key}><td><button type="button" className="fm-link" onClick={() => onOpen(u.taskId)}>{u.taskId}</button></td><td className="mono">{u.kind}<div className="fm-faint" style={{ fontSize: 12 }}>{u.key}</div></td><td className="r mono">{clock(u.at)}</td></tr>)}</tbody></table> : <p className="fm-faint">Không có.</p>}
        </div>
        <div>
          <F.SectionHeader title="Outbox" meta={sup.outbox.length} />
          <table className="fm-table"><thead><tr><th>Message</th><th>Trạng thái</th><th className="r">Lúc</th></tr></thead><tbody>{sup.outbox.map((m) => <tr key={m.id} className={m.state === 'pending' ? 'warn' : ''}><td className="mono">{m.id}<div className="fm-faint" style={{ fontSize: 12 }}>{m.kind}{m.note ? ' · ' + m.note : ''}</div></td><td><F.StatusLabel tone={m.state === 'failed' ? 'red' : m.state === 'pending' ? 'mustard' : 'green'} size="sm">{m.state}</F.StatusLabel></td><td className="r mono">{clock(m.at)}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}

// ================= Projects & leases =================
export function Projects({ tasks, now, onOpen }) {
  const leases = [];
  tasks.forEach((t) => t.lease.forEach((l) => leases.push({ ...l, task: t })));
  // Keys are hierarchical; a project/ key covers the whole project, a wildcard covers everything below its literal prefix.
  const prefix = (k) => k.indexOf('project/') === 0 ? '' : k.split('*')[0];
  const touches = (a, b) => { const pa = prefix(a.key), pb = prefix(b.key); return a.key === b.key || (a.key.indexOf('*') >= 0 || !pa ? pb.indexOf(pa) === 0 : false) || (b.key.indexOf('*') >= 0 || !pb ? pa.indexOf(pb) === 0 : false); };
  const overlap = (a, b) => a.task.projectId === b.task.projectId && a.task !== b.task && (a.mode !== 'read' || b.mode !== 'read') && touches(a, b);
  const deps = tasks.filter((t) => (t.dependencies || []).length);
  return (
    <div>
      <F.PageHeader no="05" eyebrow="Hệ thống" title="Dự án & lease" id="page-title" />
      <div className="fm-grid c3">
        {PROJECTS.map((p) => {
          const mine = tasks.filter((t) => t.projectId === p.id);
          const by = M.counts(mine, now).by;
          const live = mine.filter((t) => t.endpoint).length;
          return (
            <F.Card key={p.id} title={p.name} end={p.enabled ? 'đang bật' : 'tắt'}>
              <F.KeyValue items={[['ID', p.id, true], ['Root', p.root, true], ['VCS', p.vcs === 'git' ? 'git · ' + p.branch : 'không dùng git'], ['Slot', live + ' / ' + p.limit + ' agent']]} />
              <div style={{ marginTop: 10 }}><F.Meter value={(live / p.limit) * 100} low={live >= p.limit} label={'Slot đã dùng của ' + p.id} /></div>
              <div className="fm-chipgroup" style={{ marginTop: 10 }}>
                {M.GROUPS.map((g) => by[g.key].length ? <F.StatusLabel key={g.key} tone={g.tone} size="sm">{by[g.key].length} {g.label.toLowerCase()}</F.StatusLabel> : null)}
              </div>
            </F.Card>
          );
        })}
      </div>
      <F.SectionHeader title="Lease" meta={leases.length + ' claim'} hint="vàng = ghi chồng nhau" />
      <div className="fm-tablewrap"><table className="fm-table">
        <thead><tr><th>Tài nguyên</th><th>Quyền</th><th>Task</th><th>Trạng thái</th><th>Chồng lấn</th></tr></thead>
        <tbody>{leases.sort((a, b) => a.task.projectId.localeCompare(b.task.projectId) || a.key.localeCompare(b.key)).map((l, i) => {
          const hard = Array.from(new Set(leases.filter((o) => overlap(l, o) && l.mode !== 'read' && o.mode !== 'read').map((o) => o.task.taskId)));
          const soft = Array.from(new Set(leases.filter((o) => overlap(l, o) && (l.mode === 'read' || o.mode === 'read')).map((o) => o.task.taskId))).filter((x) => hard.indexOf(x) < 0);
          return <tr key={i} className={hard.length ? 'warn' : ''}><td className="mono">{l.key}<div className="fm-faint" style={{ fontSize: 12 }}>{l.task.projectId}</div></td><td><span className={cx('fm-ttag', l.mode === 'read' && 'scout')}>{l.mode}</span></td><td><button type="button" className="fm-link" onClick={() => onOpen(l.task.taskId)}>{l.task.taskId}</button></td><td><F.StatusLabel status={M.statusKey(l.task)} size="sm" /></td><td>{hard.length ? <span style={{ color: 'var(--mustard-deep)', fontWeight: 700 }}>ghi chồng {hard.join(', ')}</span> : null}{soft.length ? <div className="fm-faint">đọc–ghi {soft.join(', ')}</div> : null}{!hard.length && !soft.length ? <span className="fm-faint">—</span> : null}</td></tr>;
        })}</tbody></table></div>
      <F.SectionHeader title="Phụ thuộc" meta={deps.length} />
      {deps.length ? <div className="fm-grid c2">{deps.map((t) => (
        <F.Card key={t.taskId} flat>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="fm-link" onClick={() => onOpen(t.taskId)}>{t.taskId}</button><F.StatusLabel status={M.statusKey(t)} size="sm" />
            <span className="fm-faint">chờ</span>
            {t.dependencies.map((d) => { const o = tasks.find((x) => x.taskId === d); return <Fragment key={d}><button type="button" className="fm-link" onClick={() => onOpen(d)}>{d}</button>{o ? <F.StatusLabel status={M.statusKey(o)} size="sm" /> : <span className="fm-faint">đã accept</span>}</Fragment>; })}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>{t.title}</p>
        </F.Card>
      ))}</div> : <p className="fm-faint">Không có task nào đang chờ task khác.</p>}
    </div>
  );
}

// ================= Token & cache =================
export function Tokens() {
  return (
    <div>
      <F.PageHeader no="06" eyebrow="Chi phí" title="Token & cache" id="page-title" />
      <F.Banner tone="mustard" lead="Số liệu mẫu">Foreman chưa có nguồn token thật (chờ T-43 / #28). Khi chưa có nguồn, màn này hiện “—”.</F.Banner>
      <div style={{ height: 16 }} />
      <F.KpiStrip label="Tuần 14/10 – 20/10" items={[
        { label: 'Token tuần này', value: '18.7', unit: 'M', sub: '14/10 – 20/10' },
        { label: 'Cache hit (trọng số)', value: '73', unit: '%', sub: 'đọc từ cache ~51M token' },
        { label: 'Resend full context', value: '3', unit: 'lần', sub: '~1.08M token có thể tiết kiệm', tone: 'mustard' },
        { label: 'Task tốn nhất', value: '2.1', unit: 'M', sub: 'T-38 · diagnosing-bugs' }
      ]} />
      <div className="fm-grid c2" style={{ marginTop: 24 }}>
        <div><F.SectionHeader title="Token theo ngày" /><F.DailyBars data={TOKENS.days} max={4} ariaLabel="Token theo ngày, tuần 14/10 – 20/10. Cao nhất thứ Bảy 17/10: 3.4 triệu." /></div>
        <div><F.SectionHeader title="Cache hit theo ngày" hint={'dưới ' + M.THRESHOLDS.cacheCold + '% là nguội'} /><F.HitLine height={232} data={TOKENS.days.map((d) => ({ label: d.label, short: d.short, value: d.hit }))} threshold={M.THRESHOLDS.cacheCold} ariaLabel="Cache hit theo ngày, 68–78%, luôn trên ngưỡng 65%." /></div>
      </div>
      <F.SectionHeader title="Phân bổ" />
      <div className="fm-grid c3">
        <F.Panel title="Theo profile"><F.BarList rows={TOKENS.byProfile.map((r) => ({ ...r, display: r.value + 'M' }))} /></F.Panel>
        <F.Panel title="Theo dự án"><F.BarList rows={TOKENS.byProject.map((r) => ({ ...r, display: r.value + 'M' }))} /></F.Panel>
        <F.Panel title="Task tốn nhất"><F.BarList rows={TOKENS.topTasks.map((r) => ({ ...r, display: r.value + 'M' }))} /></F.Panel>
      </div>
      <F.SectionHeader title="Resend full context" meta={TOKENS.resends.length} />
      <table className="fm-table"><thead><tr><th>Task</th><th>Lúc</th><th>Token</th><th>Lý do</th></tr></thead><tbody>{TOKENS.resends.map((r, i) => <tr key={i}><td className="mono"><b>{r.taskId}</b></td><td className="mono">{r.at}</td><td className="mono">{r.tokens}</td><td>{r.why}</td></tr>)}</tbody></table>
    </div>
  );
}

// ================= Settings =================
export function Settings({ tasks, sup, prefs, setPrefs, theme, setThemePref, themePref, notifyState, onNotify }) {
  return (
    <div>
      <F.PageHeader no="07" eyebrow="Hệ thống" title="Cài đặt" id="page-title" />
      <div className="fm-grid c2">
        <F.Card title="Hiển thị" end="lưu ở trình duyệt">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><span className="fm-h4" style={{ border: 0, margin: 0, padding: 0, minWidth: 120 }}>Theme</span><F.Segmented label="Theme" value={themePref} onChange={setThemePref} options={[{ value: 'system', label: 'Theo máy' }, { value: 'light', label: 'Sáng' }, { value: 'dark', label: 'Tối' }]} /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><span className="fm-h4" style={{ border: 0, margin: 0, padding: 0, minWidth: 120 }}>Mật độ bảng</span><F.Segmented label="Mật độ" value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: 'comfortable', label: 'Thoáng' }, { value: 'compact', label: 'Gọn' }]} /></div>
            <F.Toggle checked={prefs.showLanes} onChange={(v) => setPrefs({ showLanes: v })}>Hiện agent trên Tổng quan</F.Toggle>
            <F.Toggle checked={prefs.markNew} onChange={(v) => setPrefs({ markNew: v })}>Chấm xanh cho report mới chưa xem</F.Toggle>
            <F.Toggle checked={prefs.titleCount} onChange={(v) => setPrefs({ titleCount: v })}>Số việc chờ bạn trên tiêu đề tab</F.Toggle>
            <div>
              <F.Toggle checked={prefs.notify && notifyState === 'granted'} disabled={notifyState === 'unsupported' || notifyState === 'denied'} onChange={(v) => onNotify(v)}>Thông báo trình duyệt khi có việc mới chờ bạn</F.Toggle>
              <p className="fm-faint" style={{ fontSize: 12, margin: '4px 0 0 48px' }}>{notifyState === 'denied' ? 'Trình duyệt đang chặn thông báo cho trang này.' : notifyState === 'unsupported' ? 'Trình duyệt này không hỗ trợ thông báo.' : 'Chỉ báo việc chờ bạn và bất thường mới.'}</p>
            </div>
          </div>
        </F.Card>
        <F.Card title="Nguồn dữ liệu" end="chỉ đọc">
          <F.KeyValue items={[
            ['FOREMAN_HOME', sup.server.home, true],
            ['Server', 'foreman dashboard serve · ' + sup.server.bind + ':' + sup.server.port, true],
            ['Cập nhật', 'SSE · fallback poll 5 giây'],
            ['Quyền', 'Chỉ đọc'],
            ['Ngưỡng không hoạt động', M.THRESHOLDS.silentMin + ' phút'],
            ['Quá hạn', 'chờ bạn quá ' + M.THRESHOLDS.overdueHours + ' giờ'],
            ['Cache nguội', 'dưới ' + M.THRESHOLDS.cacheCold + '%']
          ]} />
        </F.Card>
      </div>
      <F.SectionHeader title="Routing profile" meta={PROFILES.filter((p) => p.active).length + ' đang bật'} hint="config/model-routing.json" />
      <div className="fm-tablewrap"><table className="fm-table">
        <thead><tr><th>Profile</th><th>Group</th><th>Tool</th><th>Model</th><th>Effort</th><th className="r">Task</th><th>Ghi chú</th></tr></thead>
        <tbody>{PROFILES.map((p) => <tr key={p.name} className={p.active ? '' : 'off'}><td className="mono"><b>{p.name}</b>{p.isDefault ? <span className="fm-ttag" style={{ marginLeft: 6 }}>default</span> : null}</td><td>{p.group}</td><td className="mono">{p.tool}</td><td className="mono">{p.model}</td><td className="mono">{p.effort || '—'}</td><td className="r mono">{tasks.filter((t) => t.profile === p.name && t.endpoint).length}</td><td>{p.note}</td></tr>)}</tbody>
      </table></div>
      <F.SectionHeader title="Phím tắt" />
      <F.Card><F.KeyHelp groups={KEYS} /></F.Card>
    </div>
  );
}

export const KEYS = [
  { title: 'Chung', keys: [['Ctrl K', 'Tìm task hoặc màn hình'], ['/', 'Tìm nhanh'], ['?', 'Bảng phím tắt'], ['Esc', 'Đóng lớp phủ']] },
  { title: 'Đi tới', keys: [['G B', 'Tổng quan'], ['G I', 'Chờ bạn'], ['G T', 'Timeline'], ['G H', 'Health'], ['G P', 'Dự án & lease'], ['G K', 'Token & cache'], ['G S', 'Cài đặt']] },
  { title: 'Tổng quan', keys: [['J', 'Task kế tiếp'], ['K', 'Task trước'], ['Enter', 'Xem nhanh task'], ['Shift Enter', 'Mở trang task'], ['C', 'Copy prompt đề xuất']] }
];
