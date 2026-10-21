import React, { useState, useEffect, useRef, Fragment } from '../ds/react.js';
import * as F from '../ds/components.jsx';
import { POINT_KIND, dur, ago, clock, copyText } from '../ds/vocab.js';
import * as M from './model.js';
import { PROFILES } from './data.js';

const KINDS = [
  { key: 'waiting-decision', label: 'Quyết định' },
  { key: 'blocked', label: 'Bị chặn' },
  { key: 'choose-model', label: 'Chọn model' },
  { key: 'review-ready', label: 'Chờ duyệt' }
];

export function inboxItems(tasks, now) {
  const items = [];
  tasks.forEach((t) => {
    const k = M.statusKey(t);
    if (!KINDS.find((x) => x.key === k)) return;
    const d = M.pendingDecision(t), r = M.lastReport(t);
    const q = k === 'waiting-decision' && d ? d.finding : k === 'blocked' ? M.firstLine(r && r.summary) : k === 'choose-model' ? 'Chọn profile cho “' + t.title + '”' : (t.type === 'scout' ? 'Scout xong: ' : 'Xong: ') + t.title;
    const ms = now - t.statusSince;
    items.push({ key: t.taskId + ':' + k, id: t.taskId, kind: k, status: k, question: q, project: t.projectId, ms, age: dur(ms), urgent: k !== 'review-ready', overdue: ms > M.THRESHOLDS.overdueHours * 3600000, isNew: t.unread, task: t });
  });
  // User-owned open points on tasks that are not already in the inbox for their status.
  tasks.forEach((t) => {
    if (KINDS.find((x) => x.key === M.statusKey(t))) return;
    M.openPoints(t).filter((p) => p.owner === 'user').forEach((p) => items.push({ key: t.taskId + ':' + p.id, id: t.taskId, kind: 'point', status: M.statusKey(t), question: p.text, project: t.projectId, ms: now - p.since, age: dur(now - p.since), urgent: true, task: t, point: p }));
  });
  return items;
}

export function Inbox({ tasks, now, current, onPick, onOpenFull, onCopied }) {
  const [kind, setKind] = useState('all');
  const items = inboxItems(tasks, now);
  const groups = KINDS.concat([{ key: 'point', label: 'Attention' }]).map((g) => ({ ...g, items: items.filter((i) => i.kind === g.key && (kind === 'all' || kind === g.key)).sort((a, b) => b.ms - a.ms) })).filter((g) => g.items.length);
  const flat = groups.reduce((a, g) => a.concat(g.items), []);
  const cur = flat.find((i) => i.key === current) || flat[0];
  const oldest = items.slice().sort((a, b) => b.ms - a.ms)[0];
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } if (window.innerWidth < 900) { const el = document.querySelector('.fm-reader'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, [current]);
  return (
    <div>
      <F.PageHeader no="02" eyebrow="Inbox" title="Chờ bạn" id="page-title"
        lede={items.length ? items.length + ' việc, lâu nhất ' + oldest.age + ' (' + oldest.id + ').' : 'Không có việc chờ bạn.'} />
      {items.length === 0 ? <F.StateNotice state="empty" stamp="Trống" title="Không có việc chờ bạn">Các agent đang tự chạy.</F.StateNotice> : (
        <>
          <div className="fm-toolbar"><F.FilterChips label="Loại" value={kind} onChange={setKind} options={[{ value: 'all', label: 'Tất cả', count: items.length }].concat(KINDS.concat([{ key: 'point', label: 'Attention' }]).map((k) => ({ value: k.key, label: k.label, count: items.filter((i) => i.kind === k.key).length })).filter((o) => o.count))} /></div>
          <div className="fm-inbox">
            <F.InboxList groups={groups} current={cur && cur.key} onPick={onPick} />
            {cur ? <Reader item={cur} tasks={tasks} now={now} onOpenFull={onOpenFull} onCopied={onCopied} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function Reader({ item, tasks, now, onOpenFull, onCopied }) {
  const t = item.task, k = item.kind;
  const head = (
    <div className="rhd">
      <div className="l1"><F.StatusLabel status={item.status} /><b className="fm-mono" style={{ color: 'var(--ink)' }}>{t.taskId}</b><F.TypeTag type={t.type} /><F.ProjectTag>{t.projectId}</F.ProjectTag><span>chờ bạn {item.age}</span>{item.overdue ? <F.StatusLabel tone="red" size="sm">quá hạn</F.StatusLabel> : null}<span style={{ marginLeft: 'auto' }}><F.Button variant="flat" size="sm" onClick={() => onOpenFull(t.taskId)}>Mở task ↗</F.Button></span></div>
      <h2>{item.question}</h2>
    </div>
  );
  return <article className="fm-reader" aria-label={'Chi tiết ' + t.taskId}>{head}<div className="rbd">{body()}</div></article>;

  function context() {
    const said = t.rounds.find((r) => r.original);
    return (
      <F.Card flat title="Task" end={t.title}>
        <F.KeyValue items={[
          ['Yêu cầu', said ? '“' + said.original + '”' : '—'],
          ['Agent', (t.profile || '—') + (t.backend ? ' · ' + t.backend : '') + (t.endpoint ? ' · ' + t.endpoint : ''), true],
          ['Round', t.round + ' · gen ' + t.generation, true],
          ['Workspace', t.workspace || '—', true]
        ]} />
      </F.Card>
    );
  }
  function body() {
    if (k === 'waiting-decision') {
      const d = M.pendingDecision(t);
      return (
        <>
          <F.Section title="Vì sao cần bạn"><p style={{ margin: 0, fontSize: 14 }}>{d.why}</p></F.Section>
          <div className="fm-sec"><h4 className="fm-h4">Phương án <span className="end">{d.id} · mở {ago(d.createdAt, now)}</span></h4>
            <F.DecisionOptions options={d.options} recommendation={d.recommendation} renderAction={(o) => <F.Button variant={o.key === d.recommendation ? 'primary' : 'flat'} size="sm" onClick={() => copyText(t.taskId + ': chọn phương án ' + o.key + ' cho ' + d.id + '.').then(() => onCopied(t.taskId + ': chọn phương án ' + o.key + ' cho ' + d.id + '.'))}>Copy “chọn {o.key}”</F.Button>} />
          </div>
          {d.evidence ? <F.Section title="Bằng chứng"><F.Quote>{d.evidence}</F.Quote></F.Section> : null}
          <F.Compose prefix={t.taskId + ' / ' + d.id + ': '} placeholder="Ví dụ: chọn A nhưng giữ agent cũ nếu còn dưới 10 phút…" onCopied={onCopied} />
          <F.CopyCommand quiet label="CLI" cli={'foreman decision answer --task ' + t.taskId + ' --decision ' + d.id + " --response '…'"} onCopied={onCopied} />
          {context()}
        </>
      );
    }
    if (k === 'blocked') {
      const r = M.lastReport(t);
      return (
        <>
          <F.Section title="Report" end={'round ' + r.round + ' · ' + ago(r.at, now)}><F.Report status="blocked" when={clock(r.at)} summary={r.summary} /></F.Section>
          {r.steps ? <div className="fm-sec"><h4 className="fm-h4">Agent gợi ý</h4>
            <div className="fm-options">{r.steps.map((s, i) => (
              <div key={i} className="fm-option"><span className="letter">{i + 1}</span><span className="otitle">{s}</span><span className="ofoot"><F.Button variant="flat" size="sm" onClick={() => copyText(t.taskId + ': làm theo hướng ' + (i + 1) + '.').then(() => onCopied(t.taskId + ': làm theo hướng ' + (i + 1) + '.'))}>Copy “làm theo hướng {i + 1}”</F.Button></span></div>
            ))}</div></div> : null}
          <F.Compose prefix={t.taskId + ': '} placeholder="Trả lời agent…" onCopied={onCopied} />
          {context()}
        </>
      );
    }
    if (k === 'choose-model') {
      return (
        <>
          <F.NextBox tone="red" title="Router đề xuất" why={t.routingNote} copy={{ text: t.taskId + ': dùng ' + t.routingProfile + '.', cli: 'foreman task confirm --task ' + t.taskId + ' --profile ' + t.routingProfile, onCopied }}><b className="fm-mono">{t.routingProfile}</b> — {PROFILES.find((p) => p.name === t.routingProfile)?.model}</F.NextBox>
          <F.Section title="Profile đang bật">
            <table className="fm-table"><thead><tr><th>Profile</th><th>Group</th><th>Tool · model</th><th className="r">Task</th><th /></tr></thead>
              <tbody>{PROFILES.filter((p) => p.active).map((p) => {
                const busy = tasks.filter((x) => x.profile === p.name && x.endpoint).length;
                const say = t.taskId + ': dùng ' + p.name + '.';
                return <tr key={p.name}><td className="mono"><b>{p.name}</b>{p.name === t.routingProfile ? ' ★' : ''}</td><td>{p.group}</td><td className="mono">{p.tool} · {p.model}{p.effort ? ' · ' + p.effort : ''}</td><td className="r mono">{busy}</td><td className="r"><F.Button variant="flat" size="sm" onClick={() => copyText(say).then(() => onCopied(say))}>Copy</F.Button></td></tr>;
              })}</tbody></table>
          </F.Section>
          {context()}
        </>
      );
    }
    if (k === 'review-ready') {
      const r = M.lastReport(t), act = M.actionsFor(t, now);
      return (
        <>
          <F.Section title="Report" end={'round ' + r.round + ' · ' + ago(r.at, now)}><F.Report status="done" when={clock(r.at)} summary={r.summary} steps={r.steps} /></F.Section>
          <F.Section title="Attention"><F.PointList points={t.attention || []} kinds={POINT_KIND} now={now} /></F.Section>
          <F.NextBox tone="green" title="Accept" copy={{ text: act.text, cli: act.cli, onCopied }}>{act.why}</F.NextBox>
          {act.alt ? <F.CopyCommand quiet label="Hoặc promote trước" text={act.alt.text} cli={act.alt.cli} onCopied={onCopied} /> : null}
          <F.CopyCommand quiet label="Xem diff trong workspace" cli={'cd ' + t.workspace + (t.branch ? ' && git diff --stat' : '')} onCopied={onCopied} />
          <F.Compose prefix={t.taskId + ': '} placeholder="Chưa accept? Gõ yêu cầu cho round tiếp…" onCopied={onCopied} />
        </>
      );
    }
    return (
      <>
        <F.Section title="Attention"><F.PointList points={[item.point]} kinds={POINT_KIND} now={now} /></F.Section>
        <F.Compose prefix={t.taskId + ' / ' + item.point.id + ': '} placeholder="Trả lời…" onCopied={onCopied} />
        <F.CopyCommand quiet label="Hoãn đến mai" text={t.taskId + ': hoãn ' + item.point.id + ' đến mai.'} cli={'foreman attention snooze --task ' + t.taskId + ' --point ' + item.point.id + ' --until tomorrow'} onCopied={onCopied} />
        {context()}
      </>
    );
  }
}
