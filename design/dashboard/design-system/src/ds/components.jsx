import React, { useState, useEffect, useRef, Fragment } from './react.js';
import { STATUS, RUNTIME, EVENT, cx, copyText, clock, ago } from './vocab.js';

let uid = 0;
const useId = (p) => useRef(p + '-' + (++uid)).current;

// ================= Frame =================
export function Sheet({ grain = true, desk = true, className, children }) {
  const sheet = <div className={cx('fm-sheet', grain && 'grain', className)}>{children}</div>;
  return desk ? <div className="fm-desk">{sheet}</div> : sheet;
}
export function Perforation() { return <div className="fm-perf" aria-hidden="true" />; }

export function NavTabs({ items, current, onNavigate, label = 'Điều hướng chính' }) {
  return (
    <nav className="fm-tabs-nav" aria-label={label}>
      {items.map((it) => it.sep ? <span key={it.key || 'sep'} className="fm-navgroup-sep" aria-hidden="true" /> : (
        <button key={it.id} type="button" className="fm-navtab" aria-current={it.id === current ? 'page' : undefined} onClick={() => onNavigate && onNavigate(it.id)}>
          {it.label}
          {it.count ? <span className={cx('fm-count', it.tone && 't-' + it.tone)} aria-label={it.countLabel || String(it.count)}>{it.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

export function TopBar({ title = 'Foreman', subtitle = 'Agent fleet', nav, current, onNavigate, live, onHome, onSearch, onHelp, theme, onTheme }) {
  return (
    <header className="fm-topbar">
      <button type="button" className="brand" onClick={onHome} aria-label="Về Tổng quan">
        <span className="fm-seal" aria-hidden="true">FM</span>
        <span className="word">{title}<small>{subtitle}</small></span>
      </button>
      {nav ? <NavTabs items={nav} current={current} onNavigate={onNavigate} /> : null}
      <div className="tools">
        {live ? <LiveIndicator {...live} compact /> : null}
        {onSearch ? <button type="button" className="fm-iconbtn fm-searchbtn" onClick={onSearch} aria-label="Tìm task hoặc màn hình (Ctrl K)"><span>⌕<span className="lbl"> Tìm…</span></span><span className="fm-kbd">Ctrl K</span></button> : null}
        {onTheme ? <button type="button" className="fm-iconbtn" onClick={onTheme} aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title="Đổi theme">{theme === 'dark' ? '☀' : '☾'}</button> : null}
        {onHelp ? <button type="button" className="fm-iconbtn" onClick={onHelp} aria-label="Phím tắt và trợ giúp" title="Phím tắt (?)">?</button> : null}
      </div>
    </header>
  );
}

export function PageHeader({ no, eyebrow, title, lede, actions, id, plain }) {
  return (
    <div className={cx('fm-pagehead', plain && 'plain')}>
      <div className="titles">
        {(no || eyebrow) ? <div className="eyebrow">{no ? <span className="fm-no">{no}</span> : null}{eyebrow}</div> : null}
        <h1 id={id}>{title}</h1>
        {lede ? <div className="lede">{lede}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, meta, hint, end, rule = true, as = 'h2', id }) {
  const H = as;
  return (
    <div className="fm-shead">
      <H id={id}>{title}</H>
      {meta != null ? <span className="meta">{meta}</span> : null}
      {rule ? <div className="fm-rule-fill" aria-hidden="true" /> : null}
      {hint ? <span className="fm-hint">{hint}</span> : null}
      {end ? <div className="end">{end}</div> : null}
    </div>
  );
}

export function Banner({ tone = 'ink', lead, children, actions, role }) {
  return (
    <div className={cx('fm-banner', 't-' + tone)} role={role || (tone === 'red' ? 'alert' : 'status')}>
      {lead ? <b className="lead">{lead}</b> : null}
      <span>{children}</span>
      {actions ? <span className="end">{actions}</span> : null}
    </div>
  );
}

// ================= Status vocabulary =================
export function StatusLabel({ status, tone, size, children }) {
  const s = STATUS[status] || { label: status, tone: 'ink' };
  return <span className={cx('fm-status', 't-' + (tone || s.tone), size)}>{children || s.label}</span>;
}
export function RuntimeBadge({ state, children, title }) {
  const r = RUNTIME[state] || RUNTIME.unknown;
  return <span className={cx('fm-rt', 't-' + r.tone, r.pulse && 'pulse')} title={title}><span className="dot" aria-hidden="true" />{children || r.label}</span>;
}
export function Stamp({ tone = 'red', size, status, children }) {
  const s = status ? STATUS[status] : null;
  return <span className={cx('fm-stamp', size, 't-' + (s ? s.tone : tone))}>{children || (s && s.label)}</span>;
}
const LIVE_TEXT = {
  live: (t) => 'Live · ' + t,
  stale: (t) => 'Poll 5 giây · ' + t,
  reconnecting: (t) => 'Đang kết nối lại · ' + t,
  offline: (t) => 'Mất kết nối · ' + t
};
export function LiveIndicator({ state = 'live', time = '—', compact, children }) {
  return (
    <span className={cx('fm-live', state)} role="status" aria-live="polite" title={'Dữ liệu cập nhật lúc ' + time}>
      <span className="dot" aria-hidden="true" />
      <span className="txt">{children || LIVE_TEXT[state](time)}</span>
    </span>
  );
}
export function ProjectTag({ children }) { return <span className="fm-ptag">{children}</span>; }
export function BackendTag({ backend }) {
  return backend ? <span className="fm-btag">{backend}</span> : <span className="fm-btag none">Chưa dispatch</span>;
}
export function TypeTag({ type }) { return <span className={cx('fm-ttag', type)} title={type === 'scout' ? 'Scout: chỉ điều tra, không sửa code' : 'Ship: sửa code, cần bạn duyệt'}>{type}</span>; }
export function CountBadge({ tone, children, label }) { return <span className={cx('fm-count', tone && 't-' + tone)} aria-label={label}>{children}</span>; }

// ================= Controls =================
export function Button({ variant, size, kbd, className, children, ...rest }) {
  return (
    <button type="button" className={cx('fm-btn', variant, size, className)} {...rest}>
      {children}{kbd ? <span className="k" aria-hidden="true">{kbd}</span> : null}
    </button>
  );
}

// A message for the Foreman agent (what the user actually does) with the raw CLI as the secondary option.
export function CopyCommand({ label = 'Prompt cho Foreman', text, cli, quiet, onCopied }) {
  const [done, setDone] = useState(null);
  function copy(value, which) {
    copyText(value).then(() => { setDone(which); onCopied && onCopied(value); setTimeout(() => setDone(null), 1800); },
      () => onCopied && onCopied(value, true));
  }
  return (
    <div className={cx('fm-copy', quiet && 'quiet')}>
      {text ? (
        <div className="row">
          <div className="what"><div className="lab">{label}</div><div className="txt">“{text}”</div></div>
          <button type="button" className={cx('go', done === 'text' && 'done')} onClick={() => copy(text, 'text')} aria-label={'Copy prompt: ' + text}>{done === 'text' ? 'Đã copy ✓' : 'Copy'}</button>
        </div>
      ) : null}
      {cli ? (
        text ? (
          <div className="alt"><span className="fm-faint">CLI</span><code title={cli}>{cli}</code><button type="button" onClick={() => copy(cli, 'cli')} aria-label={'Copy CLI: ' + cli}>{done === 'cli' ? 'đã copy' : 'copy CLI'}</button></div>
        ) : (
          <div className="row">
            <div className="what"><div className="lab">{label}</div><div className="txt cmd">{cli}</div></div>
            <button type="button" className={cx('go', done === 'cli' && 'done')} onClick={() => copy(cli, 'cli')} aria-label={'Copy CLI: ' + cli}>{done === 'cli' ? 'Đã copy ✓' : 'Copy'}</button>
          </div>
        )
      ) : null}
    </div>
  );
}

export function FilterChips({ label, value, options, onChange, multi }) {
  const id = useId('fl');
  const isOn = (v) => multi ? (value || []).indexOf(v) >= 0 : v === value;
  function toggle(v) {
    if (!multi) return onChange && onChange(v);
    const cur = value || [];
    onChange && onChange(cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]));
  }
  return (
    <div className="fm-chipgroup" role="group" aria-labelledby={label ? id : undefined}>
      {label ? <span className="fl" id={id}>{label}</span> : null}
      {options.map((o) => (
        <button key={o.value} type="button" className="fm-chip" aria-pressed={isOn(o.value) ? 'true' : 'false'} onClick={() => toggle(o.value)}>
          {o.label}{o.count != null ? <span className="n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
export function SearchField({ value, onChange, placeholder = 'Lọc theo ID, tên, profile…', label = 'Lọc task', inputRef, onKeyDown }) {
  return (
    <label className="fm-search">
      <span className="ic" aria-hidden="true">⌕</span>
      <span className="fm-sr">{label}</span>
      <input ref={inputRef} type="search" value={value} placeholder={placeholder} onKeyDown={onKeyDown} onChange={(e) => onChange && onChange(e.target.value)} />
      {value ? <button type="button" className="clear" onClick={() => onChange && onChange('')} aria-label="Xoá ô lọc">✕</button> : null}
    </label>
  );
}
export function SelectField({ label, value, options, onChange }) {
  const id = useId('sel');
  return (
    <span className="fm-select">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange && onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}
export function Toggle({ checked, onChange, children, disabled }) {
  return (
    <label className="fm-toggle">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange && onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}
export function Segmented({ label, value, options, onChange }) {
  return (
    <span className="fm-seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value ? 'true' : 'false'} onClick={() => onChange && onChange(o.value)}>{o.label}</button>)}
    </span>
  );
}
export function Tabs({ tabs, value, onChange, label }) {
  const ref = useRef(null);
  function onKey(e) {
    const i = tabs.findIndex((t) => t.id === value);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (n == null) return;
    e.preventDefault(); onChange(tabs[n].id);
    const btns = ref.current && ref.current.querySelectorAll('[role=tab]'); if (btns && btns[n]) btns[n].focus();
  }
  return (
    <div className="fm-tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="fm-tab" aria-selected={t.id === value ? 'true' : 'false'} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <span className={cx('fm-count', t.tone && 't-' + t.tone)}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ================= Board =================
export function CounterBar({ items, value, onChange, label = 'Lọc theo nhóm' }) {
  return (
    <div className="fm-counters" style={{ '--fm-cols': items.length }} role="group" aria-label={label}>
      {items.map((c) => {
        const on = value === c.id;
        return (
          <button key={c.id} type="button" className={cx('fm-counter', 't-' + (c.tone || 'ink'), c.hot && !on && 'hot', !c.value && 'zero')} aria-pressed={on ? 'true' : 'false'} onClick={() => onChange && onChange(on ? null : c.id)}>
            <span className="k"><span className="sw" aria-hidden="true" />{c.label}</span>
            <span className="v">{c.value}</span>
            <span className="s">{c.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

// One live endpoint. quietRatio = silence / threshold, drives the bar.
export function WorkerSlot({ id, title, profile, backend, runtime, quiet, quietRatio = 0, quietWarn, held, tone, selected, onSelect, badge, isNew }) {
  return (
    <button type="button" className={cx('fm-slot', held && 'held', tone && 't-' + tone)} aria-pressed={selected ? 'true' : 'false'} onClick={onSelect} aria-label={id + ' — ' + title}>
      <span className="l1"><span className="tid">{id}</span>{isNew ? <span className="fm-newdot" title="Có report mới" /> : null}<span className="end">{badge}<BackendTag backend={backend} /></span></span>
      <span className="ttl">{title}</span>
      <span className="prof">{profile}</span>
      <span className="l3"><RuntimeBadge state={runtime} /><span className={cx('quiet', quietWarn && 'warn')}>{quiet}</span></span>
      {held ? null : <span className={cx('bar', quietWarn && 'warn')} aria-hidden="true"><i style={{ width: Math.min(100, Math.round(quietRatio * 100)) + '%' }} /></span>}
    </button>
  );
}
export function HeldChip({ id, status, wait, urgent, backend, selected, onSelect, isNew }) {
  return (
    <button type="button" className="fm-heldchip" aria-pressed={selected ? 'true' : 'false'} onClick={onSelect}>
      <span className="tid">{id}</span>{isNew ? <span className="fm-newdot" title="Có report mới" /> : null}<StatusLabel status={status} size="sm" /><span className={cx('w', urgent && 'you')}>{wait}</span>
    </button>
  );
}
export function LaneGroup({ label, count, children, compact }) {
  return <div className="fm-lanegroup"><div className="lab">{label}{count != null ? <span className="fm-count">{count}</span> : null}</div><div className={compact ? 'fm-heldrow' : 'fm-lanes'}>{children}</div></div>;
}

// groups: [{key,label,tone,hint,rows:[row]}]; row: {id,type,isNew,title,line,project,profile,backend,runtime,round,age:{text,tone,sub},points:{user,open},status}
export function FleetTable({ groups, selected, onSelect, onOpen, dense, layout = 'table', collapsed = {}, onToggle, caption, emptyText }) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  function key(e, r) {
    if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey && onOpen ? onOpen : onSelect)(r.id); }
    if (e.key === ' ') { e.preventDefault(); onSelect(r.id); }
  }
  return (
    <table className={cx('fm-fleet', dense && 'dense', layout === 'cards' && 'cards')}>
      {caption ? <caption className="fm-sr">{caption}</caption> : null}
      <colgroup><col style={{ width: 84 }} /><col /><col style={{ width: 140 }} /><col style={{ width: 176 }} /><col style={{ width: 136 }} /><col style={{ width: 124 }} /></colgroup>
      <thead><tr><th scope="col">ID</th><th scope="col">Task</th><th scope="col">Dự án</th><th scope="col">Agent</th><th scope="col">Thời gian</th><th scope="col" className="r">Trạng thái</th></tr></thead>
      <tbody>
        {total === 0 ? <tr className="empty"><td colSpan={6}>{emptyText || 'Không có task nào khớp bộ lọc.'}</td></tr> : null}
        {total === 0 ? null : groups.map((g) => (
          <Fragment key={g.key}>
            <tr className={cx('grp', 't-' + g.tone)}>
              <td colSpan={6}>
                <button type="button" aria-expanded={collapsed[g.key] ? 'false' : 'true'} onClick={() => onToggle && onToggle(g.key)}>
                  <span className="gsw" aria-hidden="true" /><span className="gname">{g.label}</span><span className="fm-count">{g.rows.length}</span>
                  {g.hint ? <span className="ghint">{g.hint}</span> : null}
                  <span className="chev" aria-hidden="true">{collapsed[g.key] ? '▸' : '▾'}</span>
                </button>
              </td>
            </tr>
            {collapsed[g.key] ? null : g.rows.length === 0 ? <tr className="emptygrp"><td colSpan={6}>Không có.</td></tr> : g.rows.map((r) => (
              <tr key={r.id} className={cx('row', r.flash && 'flash')} aria-current={selected === r.id ? 'true' : undefined} tabIndex={0} data-task={r.id} aria-label={r.id + ' — ' + r.title + ' — ' + (STATUS[r.status] ? STATUS[r.status].label : r.status)}
                onClick={() => onSelect && onSelect(r.id)} onDoubleClick={() => onOpen && onOpen(r.id)} onKeyDown={(e) => key(e, r)}>
                <td className="c-id"><div className="idl"><span className="tid">{r.id}</span>{r.isNew ? <span className="fm-newdot" title="Có report mới chưa xem" /> : null}</div><div className="sub"><TypeTag type={r.type} /></div></td>
                <td className="c-main"><div className="tt" title={r.title}>{r.title}</div>{r.line ? <div className="tm">{r.line}</div> : null}</td>
                <td className="c-proj"><ProjectTag>{r.project}</ProjectTag></td>
                <td className="c-who"><div className="who">{r.profile ? <span className="p">{r.profile}</span> : <span className="fm-faint">—</span>}{r.round ? <span className="rnd"> · R{r.round}{r.generation > 1 ? '·G' + r.generation : ''}</span> : null}<div className="b">{r.backend ? <BackendTag backend={r.backend} /> : null}{r.runtime && r.runtime !== 'none' ? <RuntimeBadge state={r.runtime} /> : null}</div></div></td>
                <td className="c-age"><span className={cx('age', r.age && r.age.tone)}>{r.age ? r.age.text : '—'}{r.age && r.age.sub ? <span className="sub">{r.age.sub}</span> : null}</span></td>
                <td className="c-st r"><StatusLabel status={r.status} size="sm" />{r.points && r.points.open ? <span className={cx('pts', r.points.user && 'u')} title="Attention đang mở">{r.points.user ? r.points.user + ' attention cho bạn' : r.points.open + ' attention'}</span> : null}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ================= Pane, cards, text =================
export function Pane({ head, children, foot, className, label }) {
  return (
    <section className={cx('fm-peek', className)} aria-label={label}>
      {head ? <div className="head">{head}</div> : null}
      <div className="body">{children}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </section>
  );
}
export function Section({ title, end, children }) {
  return <div className="fm-sec"><h4>{title}{end ? <span className="end">{end}</span> : null}</h4>{children}</div>;
}
export function Card({ title, end, flat, dashed, children, className }) {
  return <section className={cx('fm-card', flat && 'flat', dashed && 'dashed', className)}>{title ? <h4>{title}{end ? <span className="end">{end}</span> : null}</h4> : null}{children}</section>;
}
export function Panel({ title, note, children }) {
  return <section className="fm-panel">{title ? <h4>{title}</h4> : null}{children}{note ? <p className="pnote">{note}</p> : null}</section>;
}
export function KeyValue({ items, mono }) {
  return <dl className="fm-kv">{items.filter(Boolean).map((it, i) => <Fragment key={i}><dt>{it[0]}</dt><dd className={cx((it[2] || mono) && 'mono')}>{it[1]}</dd></Fragment>)}</dl>;
}
export function Quote({ children, source, solid }) {
  return <div className={cx('fm-quote', solid && 'solid')}>{children}{source ? <span className="src">{source}</span> : null}</div>;
}
export function Callout({ variant, lead, children }) {
  return <div className={cx('fm-callout', variant)} role={variant === 'warn' || variant === 'danger' ? 'note' : undefined}>{lead ? <b className="lead">{lead}</b> : null}{children}</div>;
}
export function NextBox({ tone = 'ink', title, children, why, copy }) {
  return (
    <div className={cx('fm-nextbox', 't-' + tone)}>
      <div className="hd">{title}</div>
      <div className="bd">{children}{why ? <div className="why">{why}</div> : null}</div>
      {copy ? <CopyCommand {...copy} /> : null}
    </div>
  );
}

// ================= Rounds, reports, points, decisions =================
// rounds newest first: {round, at, sent, original, mode, reports:[{status, at, summary, steps}]}
export function RoundList({ rounds, now }) {
  return (
    <ol className="fm-rounds">
      {rounds.map((r, i) => (
        <li key={r.round} className={cx('fm-round', i === 0 && 'current')}>
          <div className="rh"><b>{r.round === 1 ? 'Round 1 · brief' : 'Round ' + r.round}</b><span className="t">{r.when}{r.mode ? ' · ' + r.mode : ''}{r.generation ? ' · G' + r.generation : ''}</span></div>
          {r.original ? <div className="said"><span className="who">Bạn yêu cầu</span>{r.original}</div> : null}
          {r.sent && r.sent !== r.original ? <div className="said"><span className="who">Foreman gửi agent</span>{r.sent}</div> : null}
          {(r.reports || []).map((rep, j) => <Report key={j} {...rep} />)}
        </li>
      ))}
    </ol>
  );
}
const REPORT = { done: { label: 'Xong', tone: 'green' }, blocked: { label: 'Bị chặn', tone: 'red' }, progress: { label: 'Tiến độ', tone: 'blue' } };
export function Report({ status, when, summary, steps, file }) {
  const r = REPORT[status] || REPORT.progress;
  return (
    <div className={cx('fm-report', 't-' + r.tone)}>
      <div className="rh2"><span title={'report --status ' + status}><StatusLabel tone={r.tone} size="sm">{r.label}</StatusLabel></span><span>{when}</span>{file ? <span className="end" title={file}>{file.split('/').pop()}</span> : null}</div>
      <div className="rb">{summary}{steps && steps.length ? <><div className="fm-h4" style={{ marginTop: 12 }}>Agent gợi ý bước tiếp</div><ol className="fm-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol></> : null}</div>
    </div>
  );
}
// points: {id, owner, kind, text, state, since, round, closedHow}
const POINT_STATE = { verified: 'đã kiểm', 'limit-accepted': 'chấp nhận giới hạn', resolved: 'đã xong', dropped: 'đã bỏ' };
export function PointList({ points, kinds, now }) {
  const when = (v) => typeof v === 'number' ? (now ? ago(v, now) : clock(v)) : v;
  if (!points.length) return <p className="fm-faint" style={{ margin: 0, fontSize: 13 }}>Không có attention.</p>;
  return (
    <ul className="fm-points">
      {points.map((p) => (
        <li key={p.id} className={cx('fm-point', p.owner === 'user' && p.state === 'open' && 'user', p.state !== 'open' && p.state !== 'snoozed' && 'closed', p.state === 'snoozed' && 'snoozed')}>
          <span className="pid">{p.id}</span>
          <span className="txt">{p.text}</span>
          <span className={cx('fm-status sm', p.owner === 'user' ? 't-red' : 't-ink')}>{p.owner === 'user' ? 'bạn' : 'agent'}</span>
          <span className="meta">{(kinds && kinds[p.kind]) || p.kind} · {p.state === 'open' ? 'mở ' + when(p.since) : p.state === 'snoozed' ? 'hoãn đến ' + when(p.until) : (POINT_STATE[p.state] || p.state) + (p.closedHow ? ' · ' + p.closedHow : '')}{p.round && !p.closedHow ? ' · round ' + p.round : ''}</span>
        </li>
      ))}
    </ul>
  );
}
// options: [{key:'A', title, impact}]; recommendation: key
export function DecisionOptions({ options, recommendation, renderAction }) {
  return (
    <div className="fm-options">
      {options.map((o) => (
        <div key={o.key} className={cx('fm-option', o.key === recommendation && 'rec')}>
          <span className="letter" aria-hidden="true">{o.key}</span>
          <span className="otitle"><span className="fm-sr">Phương án {o.key}: </span>{o.title}</span>
          {o.impact ? <span className="oimpact">{o.impact}</span> : null}
          <span className="ofoot">{o.key === recommendation ? <span className="fm-rectag">Agent đề xuất</span> : null}{renderAction ? renderAction(o) : null}</span>
        </div>
      ))}
    </div>
  );
}

// ================= Inbox =================
export function InboxList({ groups, current, onPick, label = 'Việc chờ bạn' }) {
  return (
    <nav className="fm-ilist" aria-label={label}>
      {groups.map((g) => (
        <Fragment key={g.key}>
          <div className="ig">{g.label}<span className="fm-count">{g.items.length}</span></div>
          {g.items.map((it) => (
            <button key={it.key} type="button" className="fm-iitem" aria-current={current === it.key ? 'true' : undefined} onClick={() => onPick(it.key)}>
              <span className="tid">{it.id}</span>
              <span className="q">{it.question}</span>
              <span className={cx('age', !it.urgent && 'ok')}>{it.age}</span>
              <span className="sub">{it.isNew ? <span className="fm-newdot" /> : null}<StatusLabel status={it.status} size="sm" />{it.project}{it.overdue ? <span style={{ color: 'var(--red-deep)', fontWeight: 700 }}>quá hạn</span> : null}</span>
            </button>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
export function Compose({ prefix, placeholder, onCopied }) {
  const [text, setText] = useState('');
  const id = useId('cmp');
  const full = prefix + (text.trim() || '…');
  return (
    <div className="fm-compose">
      <label htmlFor={id} className="fm-h4" style={{ display: 'flex' }}>Trả lời khác</label>
      <textarea id={id} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      <div className="cf">
        <span style={{ marginLeft: 'auto' }} />
        <Button variant="primary" disabled={!text.trim()} onClick={() => copyText(full).then(() => onCopied && onCopied(full))}>Copy prompt</Button>
      </div>
    </div>
  );
}

// ================= Timeline =================
// events newest first: {key, at, day, type, taskId, text, meta}
export function EventLog({ events, onOpen, groupByDay = true, label = 'Nhật ký' }) {
  const out = []; let last = null;
  events.forEach((e) => {
    if (groupByDay && e.day !== last) { last = e.day; out.push(<div className="fm-daysep" key={'d' + e.key}><span className="dl">{e.day}</span><div className="ln" aria-hidden="true" /></div>); }
    const ev = EVENT[e.type] || { label: e.type, tone: 'ink' };
    const inner = [
      <time className="et" key="t">{clock(e.at)}</time>,
      <span className={cx('etag', 't-' + ev.tone)} key="g">{ev.label}</span>,
      <span className="ex" key="x"><b>{e.taskId}</b>{e.text}{e.meta ? <span className="em">{e.meta}</span> : null}</span>
    ];
    out.push(onOpen ? <button type="button" className="fm-ev" key={e.key} onClick={() => onOpen(e.taskId)}>{inner}</button> : <div className="fm-ev" key={e.key}>{inner}</div>);
  });
  if (!out.length) out.push(<p key="e" className="fm-faint" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>— Không có sự kiện nào khớp bộ lọc. —</p>);
  return <section aria-label={label}>{out}</section>;
}
// rows: [{id, segs:[{from,to,kind,label}]}]; kinds: run you queue warn review
export function ShiftGantt({ rows, from, to, now, onOpen, label = 'Thời gian theo task' }) {
  const span = to - from, hours = Math.round(span / 3600000);
  const pct = (t) => Math.max(0, Math.min(100, ((t - from) / span) * 100));
  const ticks = []; for (let h = 0; h <= hours; h += hours > 12 ? 2 : 1) ticks.push(from + h * 3600000);
  return (
    <figure className="fm-gantt" style={{ margin: 0 }} aria-label={label}>
      <div className="gin">
        <div className="axis"><span /><div className="ticks">{ticks.map((t) => <span key={t} style={{ left: pct(t) + '%' }}>{clock(t)}</span>)}{now ? <i className="now" style={{ left: pct(now) + '%' }} aria-hidden="true" /> : null}</div></div>
        {rows.map((r) => (
          <div className="grow" key={r.id}>
            <button type="button" className="gid" onClick={() => onOpen && onOpen(r.id)}>{r.id}</button>
            <div className="track" style={{ '--fm-hours': hours }}>
              {r.segs.map((s, i) => <span key={i} className={'seg s-' + s.kind} style={{ left: pct(s.from) + '%', width: Math.max(0.6, pct(s.to) - pct(s.from)) + '%' }} title={r.id + ' · ' + s.label + ' · ' + clock(s.from) + '–' + clock(s.to)} />)}
              {now ? <span className="now" style={{ left: pct(now) + '%' }} aria-hidden="true" /> : null}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="fm-legend">
        <span><i className="s-run" />Agent đang làm</span><span><i className="s-idle" />Chờ round tiếp</span><span><i className="s-you" />Chờ bạn</span><span><i className="s-review" />Chờ duyệt</span><span><i className="s-warn" />Bất thường</span><span><i className="s-queue" />Chờ dispatch</span>
      </figcaption>
    </figure>
  );
}

// ================= Health =================
// items: {state:'ok'|'warn'|'bad'|'off', name, desc, value}
const MARK = { ok: '✓', warn: '!', bad: '✕', off: '–' };
export function CheckList({ items, label }) {
  return (
    <div className="fm-checks" role="list" aria-label={label}>
      {items.map((c, i) => (
        <div key={i} role="listitem" className={cx('fm-check', c.state)}>
          <span className="mk" aria-label={{ ok: 'ổn', warn: 'cảnh báo', bad: 'lỗi', off: 'tắt' }[c.state]}>{MARK[c.state]}</span>
          <span className="nm">{c.name}</span>
          <span className="ds">{c.desc}</span>
          <span className="vl">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ================= Numbers & charts =================
export function KpiStrip({ items, label }) {
  return (
    <section className="fm-kpis" style={{ '--fm-cols': items.length }} aria-label={label}>
      {items.map((k, i) => <div key={i} className={cx('fm-kpi', k.tone && 't-' + k.tone)}><div className="k">{k.label}</div><div className="v">{k.value == null ? '—' : k.value}{k.value != null && k.unit ? <small>{k.unit}</small> : null}</div>{k.sub ? <div className="s">{k.sub}</div> : null}</div>)}
    </section>
  );
}
export function StatBlock({ label, value, unit, sub }) {
  return <div className="fm-stat">{label ? <div className="k">{label}</div> : null}<div className="v">{value == null ? '—' : value}{value != null && unit ? <small> {unit}</small> : null}</div>{sub ? <div className="s">{sub}</div> : null}</div>;
}
export function Meter({ value, low, label = 'Tỉ lệ' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return <div className={cx('fm-meter', low && 'low')} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}><i style={{ width: v + '%' }} /></div>;
}
export function BarList({ title, rows, max }) {
  const m = max || Math.max.apply(null, rows.map((r) => r.value).concat([1]));
  return (
    <div className="fm-bars">
      {title ? <h4>{title}</h4> : null}
      {rows.map((r, i) => <div className="fm-brow" key={i}><span className="bl" title={r.label}>{r.label}</span><div className="track" aria-hidden="true"><i className={r.tone ? 't-' + r.tone : undefined} style={{ width: Math.round((r.value / m) * 100) + '%' }} /></div><span className="bv">{r.display || r.value}</span></div>)}
    </div>
  );
}
function ChartFrame({ svg, legend, table }) {
  const [open, setOpen] = useState(false);
  return (
    <figure className="fm-chart">
      <div className="scroll">{svg}</div>
      <figcaption className="legend">{legend}{table ? <span className="push"><button type="button" className="fm-chip" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)}>{open ? 'Ẩn bảng' : 'Xem dạng bảng'}</button></span> : null}</figcaption>
      {table && open ? table : null}
    </figure>
  );
}
function dataTable(caption, heads, rows) {
  return <table className="fm-datatable"><caption className="fm-sr">{caption}</caption><thead><tr>{heads.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>;
}
export function DailyBars({ data, max, unit = 'M', ariaLabel, seriesLabel = 'Token tiêu thụ (triệu / ngày)' }) {
  const W = 680, H = 232, ml = 44, mr = 12, mt = 26, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
  const top = Math.max.apply(null, data.map((d) => d.value));
  const mx = max || Math.ceil(top);
  const X = (i) => ml + pw * (i + 0.5) / data.length, Y = (v) => mt + ph - (v / mx) * ph, bw = Math.min(44, pw / data.length - 16);
  const grid = []; for (let k = 0; k <= mx; k++) grid.push(<g key={k}><line className="grid" x1={ml} x2={W - mr} y1={Y(k)} y2={Y(k)} /><text x={ml - 7} y={Y(k) + 4} textAnchor="end">{k + unit}</text></g>);
  const svg = (
    <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" role="img" aria-label={ariaLabel}>
      {grid}
      {data.map((d, i) => { const hot = d.value === top, y = Y(d.value); return <g key={i}><rect className={cx('bar', hot && 'hot')} x={X(i) - bw / 2} y={y} width={bw} height={mt + ph - y}><title>{d.label + ': ' + d.value.toFixed(1) + unit}</title></rect><text className="val" x={X(i)} y={y - 6} textAnchor="middle">{d.value.toFixed(1)}</text>{hot ? <text className="val hot" x={X(i)} y={y - 20} textAnchor="middle">▲</text> : null}<text x={X(i)} y={H - 10} textAnchor="middle">{d.label}</text></g>; })}
    </svg>
  );
  return <ChartFrame svg={svg} legend={[<span key="a"><i className="sw" />{seriesLabel}</span>, <span key="b"><i className="sw hot" />Ngày cao nhất</span>]} table={dataTable(ariaLabel, ['Ngày', seriesLabel], data.map((d) => [d.label, d.value.toFixed(1) + unit]))} />;
}
export function HitLine({ data, min = 50, max = 90, threshold, ariaLabel, seriesLabel = 'Cache hit % theo ngày', height = 112 }) {
  const W = 680, H = height, ml = 44, mr = 12, mt = 18, mb = 22, pw = W - ml - mr, ph = H - mt - mb;
  const X = (i) => ml + pw * (i + 0.5) / data.length, Y = (v) => mt + ph - ((v - min) / (max - min)) * ph;
  const vals = data.map((d) => d.value), hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
  const ticks = [min, max].concat(threshold != null ? [threshold] : []);
  const svg = (
    <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" role="img" aria-label={ariaLabel}>
      {ticks.map((v) => <g key={v}><line className={v === threshold ? 'thrline' : 'grid'} x1={ml} x2={W - mr} y1={Y(v)} y2={Y(v)} /><text className={v === threshold ? 'thr' : undefined} x={ml - 7} y={Y(v) + 4} textAnchor="end">{v}%</text></g>)}
      <polyline className="line" points={data.map((d, i) => X(i) + ',' + Y(d.value)).join(' ')} />
      {data.map((d, i) => <g key={i}><circle className="pt" cx={X(i)} cy={Y(d.value)} r={4.5}><title>{d.label + ': ' + d.value + '%'}</title></circle>{(i === 0 || i === data.length - 1 || d.value === hi || d.value === lo) ? <text className="line-val" x={X(i)} y={Y(d.value) - 9} textAnchor="middle">{d.value}%</text> : null}<text x={X(i)} y={H - 4} textAnchor="middle">{d.short || d.label}</text></g>)}
    </svg>
  );
  return <ChartFrame svg={svg} legend={[<span key="a"><i className="sw line" />{seriesLabel}</span>, threshold != null ? <span key="b"><i className="sw dash" />Ngưỡng nguội {threshold}%</span> : null]} table={dataTable(ariaLabel, ['Ngày', 'Cache hit'], data.map((d) => [d.label, d.value + '%']))} />;
}

// ================= States =================
const STATE_COPY = {
  loading: { title: 'Đang tải…', tone: null, mark: '◷', stamp: 'Đang tải' },
  empty: { title: 'Chưa có task', tone: null, mark: '—', stamp: 'Trống' },
  unconfigured: { title: 'Chưa trỏ tới FOREMAN_HOME', tone: 'mustard', mark: '⚙', stamp: 'Chưa cấu hình' },
  'missing-home': { title: 'Không thấy thư mục home', tone: 'mustard', mark: '?', stamp: 'Thiếu home' },
  error: { title: 'Không đọc được state', tone: 'red', mark: '✕', stamp: 'Lỗi đọc' }
};
export function StateNotice({ state, title, stamp, actions, small, children }) {
  const s = STATE_COPY[state] || STATE_COPY.empty;
  return (
    <div className={cx('fm-state', s.tone && 't-' + s.tone, small && 'sm')} role={state === 'error' ? 'alert' : 'status'}>
      <Stamp tone={s.tone || 'ink'} size="sm">{s.mark + ' ' + (stamp || s.stamp)}</Stamp>
      <div className="ttl">{title || s.title}</div>
      {children ? <div className="msg">{children}</div> : null}
      {actions ? <div className="acts">{actions}</div> : null}
    </div>
  );
}
export function Skeleton({ lines = 3, block }) {
  if (block) return <div className="fm-skel block" aria-hidden="true" />;
  const out = []; for (let i = 0; i < lines; i++) out.push(<div key={i} className="fm-skel" style={{ width: (i === lines - 1 ? 60 : 100) + '%', marginTop: i ? 8 : 0 }} />);
  return <div aria-hidden="true">{out}</div>;
}
export function Toasts({ items, onDismiss }) {
  return (
    <div className="fm-toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={cx('fm-toast', t.tone && 't-' + t.tone)}><span style={{ flex: 1 }}>{t.text}</span>{t.action ? <button type="button" onClick={() => { t.action.run(); onDismiss(t.id); }}>{t.action.label}</button> : null}<button type="button" onClick={() => onDismiss(t.id)} aria-label="Đóng thông báo">✕</button></div>)}
    </div>
  );
}

// ================= Overlays =================
function useTrap(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const prev = document.activeElement, prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const f = ref.current && ref.current.querySelector('[data-autofocus], input, button');
    if (f) f.focus();
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = ref.current.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = prevOverflow; if (prev && prev.focus) prev.focus(); };
  }, [active]);
}
export function Dialog({ title, onClose, children, label }) {
  const ref = useRef(null);
  useTrap(ref, onClose);
  return (
    <div className="fm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-dialog" role="dialog" aria-modal="true" aria-label={label || title} ref={ref}>
        <div className="dh"><h2>{title}</h2><span className="end"><Button variant="flat" size="sm" onClick={onClose}>Đóng ✕</Button></span></div>
        <div className="db">{children}</div>
      </div>
    </div>
  );
}
export function Drawer({ onClose, children, label }) {
  const ref = useRef(null);
  useTrap(ref, onClose);
  return (
    <div className="fm-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-drawer" role="dialog" aria-modal="true" aria-label={label} ref={ref}>{children}</div>
    </div>
  );
}
// items: [{key, group, kicker, title, sub, run}]
export function CommandPalette({ items, onClose, placeholder = 'Gõ ID, tên task hoặc tên màn hình…' }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  useTrap(ref, onClose);
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const list = items.filter((it) => !q || norm(it.kicker + ' ' + it.title + ' ' + (it.sub || '')).indexOf(norm(q)) >= 0).slice(0, 12);
  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((i + 1) % Math.max(1, list.length)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI((i - 1 + list.length) % Math.max(1, list.length)); }
    if (e.key === 'Enter' && list[i]) { e.preventDefault(); list[i].run(); onClose(); }
  }
  let lastGroup = null;
  return (
    <div className="fm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fm-dialog fm-palette" role="dialog" aria-modal="true" aria-label="Tìm nhanh" ref={ref}>
        <input data-autofocus value={q} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={key} aria-label="Tìm nhanh" role="combobox" aria-expanded="true" aria-controls="fm-pal-list" />
        <ul id="fm-pal-list" role="listbox">
          {list.length === 0 ? <li className="grp">Không có kết quả</li> : null}
          {list.map((it, k) => {
            const head = it.group !== lastGroup ? <li className="grp" key={'g' + it.key}>{it.group}</li> : null; lastGroup = it.group;
            return [head, <li key={it.key} role="none"><button type="button" role="option" aria-selected={k === i ? 'true' : 'false'} onMouseEnter={() => setI(k)} onClick={() => { it.run(); onClose(); }}><span className="pk">{it.kicker}</span><span className="pt">{it.title}</span><span className="ps">{it.sub}</span></button></li>];
          })}
        </ul>
        <div className="pfoot"><span><span className="fm-kbd">↑↓</span> chọn</span><span><span className="fm-kbd">Enter</span> mở</span><span><span className="fm-kbd">Esc</span> đóng</span></div>
      </div>
    </div>
  );
}
export function KeyHelp({ groups }) {
  return groups.map((g) => (
    <div key={g.title} style={{ marginBottom: 16 }}>
      <div className="fm-h4">{g.title}</div>
      <div className="fm-keys">{g.keys.map((k) => <div key={k[0]}><span>{k[1]}</span><span>{k[0].split(' ').map((p, i) => <span key={i} className="fm-kbd" style={{ marginLeft: 4 }}>{p}</span>)}</span></div>)}</div>
    </div>
  ));
}
