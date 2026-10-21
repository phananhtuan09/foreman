import React, { useState, useMemo, Fragment } from '../ds/react.js';
import * as F from '../ds/components.jsx';
import { STATUS, RUNTIME, POINT_KIND, issueOf, dur, ago, clock, dateLabel, cx } from '../ds/vocab.js';
import * as M from './model.js';

// ---------- Peek: the selected task, readable without leaving the board
export function TaskPeek({ t, all, now, onOpenFull, onOpenInbox, onClose, onCopied, compact }) {
  if (!t) return <F.Pane label="Chi tiết task"><F.StateNotice state="empty" small title="Chọn một task" stamp="Trống">Bấm một task để xem nhanh ở đây.</F.StateNotice></F.Pane>;
  const k = M.statusKey(t), act = M.actionsFor(t, now), a = M.anomalyOf(t, now);
  const latestRound = t.rounds[0];
  const rep = latestRound.reports.length ? latestRound.reports[latestRound.reports.length - 1] : (t.rounds.find((r) => r.reports.length) || { reports: [] }).reports.slice(-1)[0];
  const repRound = t.rounds.find((r) => r.reports.indexOf(rep) >= 0);
  const said = t.rounds.find((r) => r.original);
  const pts = t.attention || [];
  const open = pts.filter((p) => p.state === 'open');
  const head = (
    <>
      <div className="l1">
        <span className="tid">{t.taskId}</span><F.TypeTag type={t.type} /><F.StatusLabel status={k} />
        <span className="end">
          <F.Button variant="flat" size="sm" onClick={() => onOpenFull(t.taskId)} aria-label={'Mở trang chi tiết ' + t.taskId}>Mở trang ↗</F.Button>
          {onClose ? <F.Button variant="flat" size="sm" onClick={onClose} aria-label="Đóng">✕</F.Button> : null}
        </span>
      </div>
      <div className="ttl">{t.title}</div>
      <div className="meta"><F.ProjectTag>{t.projectId}</F.ProjectTag>{t.profile ? <span>{t.profile}</span> : null}{t.backend ? <F.BackendTag backend={t.backend[0].toUpperCase() + t.backend.slice(1)} /> : null}{t.runtime !== 'none' ? <F.RuntimeBadge state={t.runtime} /> : null}<span>R{t.round}{t.generation > 1 ? ' · G' + t.generation : ''}</span></div>
    </>
  );
  return (
    <F.Pane label={'Chi tiết ' + t.taskId} head={head}
      foot={<span className="fm-faint">Hoạt động cuối {ago(t.lastActivityAt, now)}</span>}>
      <div className="fm-sec">
        <F.NextBox tone={act.tone} title={act.title} why={act.why} copy={act.text || act.cli ? { text: act.text, cli: act.cli, quiet: act.quiet, onCopied } : null}>{act.what}</F.NextBox>
        {act.alt ? <div style={{ marginTop: 8 }}><F.CopyCommand quiet label="Hoặc" text={act.alt.text} cli={act.alt.cli} onCopied={onCopied} /></div> : null}
        {onOpenInbox && M.groupOf(t, now) === 'you' ? <div style={{ marginTop: 6, textAlign: 'right' }}><F.Button variant="ghost" size="sm" onClick={() => onOpenInbox(t.taskId + ':' + k)}>Mở trong Chờ bạn →</F.Button></div> : null}
      </div>
      {a.issues.length > 1 ? <div className="fm-sec"><F.Callout variant="warn" lead="Còn:">{a.issues.slice(1).map((i) => i.label).join(' · ')}</F.Callout></div> : null}
      {rep ? <F.Section title="Report mới nhất" end={'round ' + repRound.round}><F.Report status={rep.status} when={clock(rep.at) + ' · ' + ago(rep.at, now)} summary={compact ? M.firstLine(rep.summary) : rep.summary} steps={compact ? null : rep.steps} /></F.Section>
        : <F.Section title="Report mới nhất"><p className="fm-faint" style={{ margin: 0, fontSize: 13 }}>Chưa có report.</p></F.Section>}
      {said ? <F.Section title="Yêu cầu của bạn" end={'round ' + said.round}><F.Quote>{said.original}</F.Quote></F.Section> : null}
      <F.Section title="Attention" end={open.length + ' mở · ' + (pts.length - open.length) + ' đã đóng'}><F.PointList points={pts.filter((p) => p.state === 'open' || p.state === 'snoozed').concat(pts.filter((p) => p.state !== 'open' && p.state !== 'snoozed'))} kinds={POINT_KIND} now={now} /></F.Section>
      <F.Section title="Workspace & lease">
        <F.KeyValue items={[
          ['Workspace', t.workspace || 'chưa có', true],
          t.branch ? ['Branch', t.branch, true] : null,
          ['Lease', t.lease.length ? t.lease.map((l) => l.mode + ' ' + l.key).join('\n') : '—', true],
          t.leaseOverlap ? ['Chồng lấn', <span style={{ color: 'var(--mustard-deep)', fontWeight: 600 }}>với {t.leaseOverlap}</span>] : null,
          t.endpoint ? ['Endpoint', t.endpoint + ' · gen ' + t.generation, true] : null,
          (t.dependencies || []).length ? ['Phụ thuộc', t.dependencies.join(', '), true] : null
        ]} />
      </F.Section>
    </F.Pane>
  );
}

// ---------- Board
export function Board({ tasks, now, sup, selected, onSelect, onOpenFull, onOpenInbox, onCopied, prefs, setPrefs, wide, flashId }) {
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
    { id: 'run', label: 'Đang chạy', tone: 'blue', value: all.run.length, sub: ['paseo', 'herdr'].map((b) => [all.run.filter((t) => t.backend === b).length, b]).filter((x) => x[0]).map((x) => x[0] + ' ' + x[1][0].toUpperCase() + x[1].slice(1)).join(' · ') || 'không có' },
    { id: 'queue', label: 'Hàng chờ', tone: 'ink', value: all.queue.length, sub: [[all.queue.filter((t) => (t.dependencies || []).length).length, 'chờ phụ thuộc'], [all.queue.filter((t) => t.status === 'routing').length, 'đang routing'], [all.queue.filter((t) => t.status === 'queued' && !(t.dependencies || []).length).length, 'chờ slot']].filter((x) => x[0]).map((x) => x[0] + ' ' + x[1]).join(' · ') || 'trống' }
  ];
  const groups = M.GROUPS.filter((g) => !filter || g.key === filter).map((g) => ({
    ...g,
    rows: M.sortGroup(g.key, by[g.key], now).map((t) => {
      const line = M.rowLine(t, now, tasks);
      const open = M.openPoints(t);
      return {
        id: t.taskId, type: t.type, isNew: prefs.markNew && t.unread, flash: flashId === t.taskId, title: t.title,
        line: <>{line.lead ? <span className={line.kind}>{line.lead}</span> : null}{line.text}</>,
        project: t.projectId, profile: t.profile || (t.routingProfile ? t.routingProfile + '?' : null), backend: t.backend ? t.backend[0].toUpperCase() + t.backend.slice(1) : null,
        runtime: t.runtime, round: t.round, generation: t.generation, age: M.ageOf(t, now),
        points: { open: open.length, user: open.filter((p) => p.owner === 'user').length }, status: M.statusKey(t)
      };
    })
  }));
  const withEndpoint = tasks.filter((t) => t.endpoint || t.status === 'pending');
  const working = withEndpoint.filter((t) => ['run', 'anomaly'].includes(M.groupOf(t, now))).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const held = withEndpoint.filter((t) => M.groupOf(t, now) === 'you').sort((a, b) => a.statusSince - b.statusSince);
  const slot = (t, isHeld) => {
    const a = M.anomalyOf(t, now), ms = now - t.lastActivityAt;
    return <F.WorkerSlot key={t.taskId} id={t.taskId} title={t.title} profile={(t.profile || '—') + ' · R' + t.round} backend={t.backend ? t.backend[0].toUpperCase() + t.backend.slice(1) : null}
      runtime={t.status === 'pending' ? 'none' : t.runtime} held={isHeld} tone={isHeld ? null : a.any ? 'mustard' : null}
      quiet={isHeld ? 'chờ bạn ' + dur(now - t.statusSince) : t.status === 'pending' ? 'đang dispatch' : ago(t.lastActivityAt, now)} quietRatio={ms / (M.THRESHOLDS.silentMin * 60000)} quietWarn={!isHeld && (a.silent || a.issues.length > 0)}
      selected={selected === t.taskId} onSelect={() => onSelect(t.taskId)} isNew={prefs.markNew && t.unread}
      badge={isHeld ? <F.StatusLabel status={M.statusKey(t)} size="sm" /> : null} />;
  };
  const projects = Array.from(new Set(tasks.map((t) => t.projectId)));
  return (
    <div className={cx(wide && 'fm-board')}>
      <div style={{ minWidth: 0 }}>
        <F.PageHeader no="01" eyebrow={dateLabel(now) + ' · ' + clock(now)} title="Tổng quan" id="page-title"
          lede={(all.you.length ? all.you.length + ' việc chờ bạn, lâu nhất ' + M.ageOf(M.sortGroup('you', all.you, now)[0], now).text.replace('chờ bạn ', '') : 'Không có việc chờ bạn') + ' · ' + (all.anomaly.length ? all.anomaly.length + ' bất thường' : 'không có bất thường') + ' · ' + all.run.length + ' agent đang chạy.'} />
        <F.CounterBar items={counters} value={filter} onChange={setFilter} />
        {prefs.showLanes ? (
          <>
            <F.SectionHeader title="Agent" meta={working.length + held.length + ' endpoint'} end={<F.Button variant="ghost" size="sm" onClick={() => setPrefs({ showLanes: false })}>Thu gọn</F.Button>} />
            <F.LaneGroup label="Đang làm" count={working.length}>{working.map((t) => slot(t, false))}</F.LaneGroup>
            {held.length ? <F.LaneGroup compact label="Đang chờ bạn" count={held.length}>{held.map((t) => <F.HeldChip key={t.taskId} id={t.taskId} status={M.statusKey(t)} wait={dur(now - t.statusSince)} urgent={STATUS[M.statusKey(t)].tone === 'red'} selected={selected === t.taskId} onSelect={() => onSelect(t.taskId)} isNew={prefs.markNew && t.unread} />)}</F.LaneGroup> : null}
          </>
        ) : null}
        <F.SectionHeader title="Task" meta={visible.length < tasks.length ? visible.length + ' / ' + tasks.length : tasks.length} end={prefs.showLanes ? null : <F.Button variant="ghost" size="sm" onClick={() => setPrefs({ showLanes: true })}>Hiện agent</F.Button>} />
        <div className="fm-toolbar">
          <F.FilterChips label="Dự án" value={proj} onChange={setProj} options={[{ value: 'all', label: 'Tất cả' }].concat(projects.map((p) => ({ value: p, label: p, count: tasks.filter((t) => t.projectId === p).length })))} />
          <span className="end">
            <F.SearchField value={q} onChange={setQ} inputRef={null} />
            <F.Segmented label="Mật độ bảng" value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: 'comfortable', label: 'Thoáng' }, { value: 'compact', label: 'Gọn' }]} />
          </span>
        </div>
        {filter ? <div style={{ marginBottom: 8 }}><F.Banner tone="ink" lead="Đang lọc:" actions={<F.Button variant="flat" size="sm" onClick={() => setFilter(null)}>Bỏ lọc ✕</F.Button>}>nhóm “{M.GROUPS.find((g) => g.key === filter).label}”.</F.Banner></div> : null}
        <F.FleetTable groups={groups} selected={selected} onSelect={onSelect} onOpen={onOpenFull} dense={prefs.density === 'compact'} layout={prefs.cards ? 'cards' : 'table'}
          collapsed={collapsed} onToggle={(k) => setCollapsed({ ...collapsed, [k]: !collapsed[k] })} caption="Tất cả task chưa accept, nhóm theo việc cần làm"
          emptyText={q ? 'Không có task nào khớp “' + q + '”.' : 'Không có task.'} />
        <p className="fm-faint" style={{ fontSize: 12, margin: '8px 0 0' }}><span className="fm-newdot" style={{ marginRight: 4 }} /> report mới chưa xem</p>
      </div>
      {wide ? <aside className="side" aria-label="Task đang chọn"><TaskPeek t={tasks.find((t) => t.taskId === selected)} all={tasks} now={now} onOpenFull={onOpenFull} onOpenInbox={onOpenInbox} onCopied={onCopied} /></aside> : null}
    </div>
  );
}
