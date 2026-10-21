/* @ds-bundle: {"format": 4, "namespace": "Foreman", "components": [{"name": "Sheet"}, {"name": "TopBar"}, {"name": "PageHeader"}, {"name": "SectionHeader"}, {"name": "Banner"}, {"name": "StatusLabel"}, {"name": "RuntimeBadge"}, {"name": "Stamp"}, {"name": "LiveIndicator"}, {"name": "ProjectTag"}, {"name": "BackendTag"}, {"name": "TypeTag"}, {"name": "Button"}, {"name": "CopyCommand"}, {"name": "FilterChips"}, {"name": "SearchField"}, {"name": "SelectField"}, {"name": "Toggle"}, {"name": "Segmented"}, {"name": "Tabs"}, {"name": "Toasts"}, {"name": "CounterBar"}, {"name": "WorkerSlot"}, {"name": "HeldChip"}, {"name": "FleetTable"}, {"name": "Pane"}, {"name": "NextBox"}, {"name": "RoundList"}, {"name": "Report"}, {"name": "PointList"}, {"name": "DecisionOptions"}, {"name": "KeyValue"}, {"name": "Card"}, {"name": "Callout"}, {"name": "InboxList"}, {"name": "Compose"}, {"name": "EventLog"}, {"name": "ShiftGantt"}, {"name": "CheckList"}, {"name": "KpiStrip"}, {"name": "StatBlock"}, {"name": "Meter"}, {"name": "BarList"}, {"name": "DailyBars"}, {"name": "HitLine"}, {"name": "Panel"}, {"name": "StateNotice"}, {"name": "Skeleton"}, {"name": "Dialog"}, {"name": "Drawer"}, {"name": "CommandPalette"}, {"name": "KeyHelp"}]} */
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // v2/src/ds/components.jsx
  var components_exports = {};
  __export(components_exports, {
    BackendTag: () => BackendTag,
    Banner: () => Banner,
    BarList: () => BarList,
    Button: () => Button,
    Callout: () => Callout,
    Card: () => Card,
    CheckList: () => CheckList,
    CommandPalette: () => CommandPalette,
    Compose: () => Compose,
    CopyCommand: () => CopyCommand,
    CountBadge: () => CountBadge,
    CounterBar: () => CounterBar,
    DailyBars: () => DailyBars,
    DecisionOptions: () => DecisionOptions,
    Dialog: () => Dialog,
    Drawer: () => Drawer,
    EventLog: () => EventLog,
    FilterChips: () => FilterChips,
    FleetTable: () => FleetTable,
    HeldChip: () => HeldChip,
    HitLine: () => HitLine,
    InboxList: () => InboxList,
    KeyHelp: () => KeyHelp,
    KeyValue: () => KeyValue,
    KpiStrip: () => KpiStrip,
    LaneGroup: () => LaneGroup,
    LiveIndicator: () => LiveIndicator,
    Meter: () => Meter,
    NavTabs: () => NavTabs,
    NextBox: () => NextBox,
    PageHeader: () => PageHeader,
    Pane: () => Pane,
    Panel: () => Panel,
    Perforation: () => Perforation,
    PointList: () => PointList,
    ProjectTag: () => ProjectTag,
    Quote: () => Quote,
    Report: () => Report,
    RoundList: () => RoundList,
    RuntimeBadge: () => RuntimeBadge,
    SearchField: () => SearchField,
    Section: () => Section,
    SectionHeader: () => SectionHeader,
    Segmented: () => Segmented,
    SelectField: () => SelectField,
    Sheet: () => Sheet,
    ShiftGantt: () => ShiftGantt,
    Skeleton: () => Skeleton,
    Stamp: () => Stamp,
    StatBlock: () => StatBlock,
    StateNotice: () => StateNotice,
    StatusLabel: () => StatusLabel,
    Tabs: () => Tabs,
    Toasts: () => Toasts,
    Toggle: () => Toggle,
    TopBar: () => TopBar,
    TypeTag: () => TypeTag,
    WorkerSlot: () => WorkerSlot
  });

  // v2/src/ds/react.js
  var React = window.React;
  var react_default = React;
  var { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

  // v2/src/ds/vocab.js
  var vocab_exports = {};
  __export(vocab_exports, {
    EVENT: () => EVENT,
    ISSUE: () => ISSUE,
    POINT_KIND: () => POINT_KIND,
    RUNTIME: () => RUNTIME,
    STATUS: () => STATUS,
    STATUS_ORDER: () => STATUS_ORDER,
    TIME: () => TIME,
    ago: () => ago,
    clock: () => clock,
    clockSec: () => clockSec,
    copyText: () => copyText,
    cx: () => cx,
    dateLabel: () => dateLabel,
    dayLabel: () => dayLabel,
    dur: () => dur,
    durShort: () => durShort,
    issueOf: () => issueOf
  });
  var STATUS = {
    "waiting-decision": { label: "Cần quyết định", tone: "red", group: "you" },
    blocked: { label: "Bị chặn", tone: "red", group: "you" },
    "choose-model": { label: "Chọn model", tone: "red", group: "you" },
    "review-ready": { label: "Chờ duyệt", tone: "green", group: "you" },
    working: { label: "Đang làm", tone: "blue", group: "run" },
    pending: { label: "Đang dispatch", tone: "blue", group: "run" },
    routing: { label: "Đang routing", tone: "ink", group: "queue" },
    queued: { label: "Chờ dispatch", tone: "ink", group: "queue" }
  };
  var STATUS_ORDER = ["waiting-decision", "blocked", "choose-model", "review-ready", "working", "pending", "routing", "queued"];
  var RUNTIME = {
    working: { label: "running", tone: "blue", pulse: true },
    idle: { label: "idle", tone: "ink" },
    "waiting-input": { label: "waiting input", tone: "mustard" },
    unknown: { label: "unknown", tone: "mustard" },
    mismatch: { label: "mismatch", tone: "red" },
    dead: { label: "dead", tone: "red" },
    missing: { label: "missing", tone: "red" },
    none: { label: "chưa có agent", tone: "ink" }
  };
  var ISSUE = {
    "worker.idle-without-report": { label: "Idle, chưa report", tone: "mustard", explain: "Agent đã dừng lượt nhưng chưa gửi report." },
    "worker.waiting-input": { label: "Chờ input", tone: "mustard", explain: "Agent đang chờ nhập, thường là xin quyền chạy lệnh." },
    "worker.timeline-gap": { label: "Timeline bị hở", tone: "mustard", explain: "Paseo timeline hở so với cursor đã lưu, có thể thiếu report." },
    "worker.timeline-incomplete": { label: "Timeline chưa đủ", tone: "mustard", explain: "Lượt cuối chưa kết thúc, chưa thu được report." },
    "worker.report-invalid": { label: "Report sai định dạng", tone: "red", explain: "Report sai JSON hoặc định danh, Foreman không nhận." },
    "worker.report-missing": { label: "Thiếu report", tone: "mustard", explain: "Lượt đã xong nhưng không có report hợp lệ." },
    "task.workspace-missing": { label: "Mất workspace", tone: "red", explain: "Thư mục workspace không còn trên đĩa." },
    "task.branch-mismatch": { label: "Sai branch", tone: "red", explain: "Workspace đang ở branch khác lúc dispatch." },
    "task.endpoint-missing": { label: "Thiếu endpoint", tone: "red", explain: "Task đã dispatch nhưng không có endpoint." },
    "task.runtime-generation-mismatch": { label: "Sai generation", tone: "red", explain: "Agent trên runtime có generation khác bản ghi." },
    "runtime.unknown": { label: "Runtime unknown", tone: "mustard", explain: "Bằng chứng runtime thiếu hoặc mâu thuẫn, chưa đủ để kết luận agent đã chết." }
  };
  function issueOf(type) {
    return ISSUE[type] || { label: type, tone: type && type.indexOf("task.") === 0 ? "red" : "mustard", explain: "Foreman ghi nhận bất thường." };
  }
  var EVENT = {
    report: { label: "Report", tone: "blue" },
    done: { label: "Xong", tone: "green" },
    blocked: { label: "Bị chặn", tone: "red" },
    decision: { label: "Cần quyết định", tone: "red" },
    answer: { label: "Đã trả lời", tone: "ink" },
    round: { label: "Round mới", tone: "ink" },
    dispatch: { label: "Dispatch", tone: "blue" },
    created: { label: "Task mới", tone: "ink" },
    anomaly: { label: "Bất thường", tone: "mustard" },
    accepted: { label: "Đã accept", tone: "green" },
    discarded: { label: "Đã discard", tone: "ink" }
  };
  var POINT_KIND = { decision: "Quyết định", obligation: "Việc phải làm", check: "Kiểm tra" };
  var MIN = 6e4;
  var HOUR = 36e5;
  var DAY = 864e5;
  function dur(ms) {
    if (ms < MIN) return "vừa xong";
    if (ms < HOUR) return Math.floor(ms / MIN) + " phút";
    if (ms < DAY) {
      const h2 = Math.floor(ms / HOUR), m = Math.floor(ms % HOUR / MIN);
      return h2 + " giờ" + (m ? " " + m + " phút" : "");
    }
    const d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / HOUR);
    return d + " ngày" + (h ? " " + h + " giờ" : "");
  }
  function durShort(ms) {
    if (ms < MIN) return "<1p";
    if (ms < HOUR) return Math.floor(ms / MIN) + "p";
    if (ms < DAY) {
      const h = Math.floor(ms / HOUR), m = Math.floor(ms % HOUR / MIN);
      return h + "g" + (m ? String(m).padStart(2, "0") : "");
    }
    return Math.floor(ms / DAY) + "n" + Math.floor(ms % DAY / HOUR) + "g";
  }
  function ago(ts, now) {
    const t = dur(Math.max(0, now - ts));
    return t === "vừa xong" ? t : t + " trước";
  }
  var pad = (n) => String(n).padStart(2, "0");
  function clock(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function clockSec(ts) {
    const d = new Date(ts);
    return clock(ts) + ":" + pad(d.getSeconds());
  }
  var WD = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];
  function dateLabel(ts) {
    const d = new Date(ts);
    return WD[d.getDay()] + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
  }
  function dayLabel(ts, now) {
    const a = new Date(ts), b = new Date(now);
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime(), db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    const diff = Math.round((db - da) / DAY);
    return (diff === 0 ? "Hôm nay" : diff === 1 ? "Hôm qua" : diff + " ngày trước") + " — " + dateLabel(ts);
  }
  var TIME = { MIN, HOUR, DAY };
  function cx() {
    const o = [];
    for (let i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]);
    return o.join(" ");
  }
  function copyText(text) {
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok ? Promise.resolve(text) : Promise.reject(new Error("copy failed"));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => text, fallback);
    return fallback();
  }

  // v2/src/ds/components.jsx
  var uid = 0;
  var useId = (p) => useRef(p + "-" + ++uid).current;
  function Sheet({ grain = true, desk = true, className, children }) {
    const sheet = /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-sheet", grain && "grain", className) }, children);
    return desk ? /* @__PURE__ */ react_default.createElement("div", { className: "fm-desk" }, sheet) : sheet;
  }
  function Perforation() {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-perf", "aria-hidden": "true" });
  }
  function NavTabs({ items, current, onNavigate, label = "Điều hướng chính" }) {
    return /* @__PURE__ */ react_default.createElement("nav", { className: "fm-tabs-nav", "aria-label": label }, items.map((it) => it.sep ? /* @__PURE__ */ react_default.createElement("span", { key: it.key || "sep", className: "fm-navgroup-sep", "aria-hidden": "true" }) : /* @__PURE__ */ react_default.createElement("button", { key: it.id, type: "button", className: "fm-navtab", "aria-current": it.id === current ? "page" : void 0, onClick: () => onNavigate && onNavigate(it.id) }, it.label, it.count ? /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-count", it.tone && "t-" + it.tone), "aria-label": it.countLabel || String(it.count) }, it.count) : null)));
  }
  function TopBar({ title = "Foreman", subtitle = "Agent fleet", nav, current, onNavigate, live, onHome, onSearch, onHelp, theme, onTheme }) {
    return /* @__PURE__ */ react_default.createElement("header", { className: "fm-topbar" }, /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "brand", onClick: onHome, "aria-label": "Về Tổng quan" }, /* @__PURE__ */ react_default.createElement("span", { className: "fm-seal", "aria-hidden": "true" }, "FM"), /* @__PURE__ */ react_default.createElement("span", { className: "word" }, title, /* @__PURE__ */ react_default.createElement("small", null, subtitle))), nav ? /* @__PURE__ */ react_default.createElement(NavTabs, { items: nav, current, onNavigate }) : null, /* @__PURE__ */ react_default.createElement("div", { className: "tools" }, live ? /* @__PURE__ */ react_default.createElement(LiveIndicator, { ...live, compact: true }) : null, onSearch ? /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "fm-iconbtn fm-searchbtn", onClick: onSearch, "aria-label": "Tìm task hoặc màn hình (Ctrl K)" }, /* @__PURE__ */ react_default.createElement("span", null, "⌕", /* @__PURE__ */ react_default.createElement("span", { className: "lbl" }, " Tìm…")), /* @__PURE__ */ react_default.createElement("span", { className: "fm-kbd" }, "Ctrl K")) : null, onTheme ? /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "fm-iconbtn", onClick: onTheme, "aria-label": theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối", title: "Đổi theme" }, theme === "dark" ? "☀" : "☾") : null, onHelp ? /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "fm-iconbtn", onClick: onHelp, "aria-label": "Phím tắt và trợ giúp", title: "Phím tắt (?)" }, "?") : null));
  }
  function PageHeader({ no, eyebrow, title, lede, actions, id, plain }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-pagehead", plain && "plain") }, /* @__PURE__ */ react_default.createElement("div", { className: "titles" }, no || eyebrow ? /* @__PURE__ */ react_default.createElement("div", { className: "eyebrow" }, no ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-no" }, no) : null, eyebrow) : null, /* @__PURE__ */ react_default.createElement("h1", { id }, title), lede ? /* @__PURE__ */ react_default.createElement("div", { className: "lede" }, lede) : null), actions ? /* @__PURE__ */ react_default.createElement("div", { className: "actions" }, actions) : null);
  }
  function SectionHeader({ title, meta, hint, end, rule = true, as = "h2", id }) {
    const H = as;
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-shead" }, /* @__PURE__ */ react_default.createElement(H, { id }, title), meta != null ? /* @__PURE__ */ react_default.createElement("span", { className: "meta" }, meta) : null, rule ? /* @__PURE__ */ react_default.createElement("div", { className: "fm-rule-fill", "aria-hidden": "true" }) : null, hint ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-hint" }, hint) : null, end ? /* @__PURE__ */ react_default.createElement("div", { className: "end" }, end) : null);
  }
  function Banner({ tone = "ink", lead, children, actions, role }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-banner", "t-" + tone), role: role || (tone === "red" ? "alert" : "status") }, lead ? /* @__PURE__ */ react_default.createElement("b", { className: "lead" }, lead) : null, /* @__PURE__ */ react_default.createElement("span", null, children), actions ? /* @__PURE__ */ react_default.createElement("span", { className: "end" }, actions) : null);
  }
  function StatusLabel({ status, tone, size, children }) {
    const s = STATUS[status] || { label: status, tone: "ink" };
    return /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-status", "t-" + (tone || s.tone), size) }, children || s.label);
  }
  function RuntimeBadge({ state, children, title }) {
    const r = RUNTIME[state] || RUNTIME.unknown;
    return /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-rt", "t-" + r.tone, r.pulse && "pulse"), title }, /* @__PURE__ */ react_default.createElement("span", { className: "dot", "aria-hidden": "true" }), children || r.label);
  }
  function Stamp({ tone = "red", size, status, children }) {
    const s = status ? STATUS[status] : null;
    return /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-stamp", size, "t-" + (s ? s.tone : tone)) }, children || s && s.label);
  }
  var LIVE_TEXT = {
    live: (t) => "Live · " + t,
    stale: (t) => "Poll 5 giây · " + t,
    reconnecting: (t) => "Đang kết nối lại · " + t,
    offline: (t) => "Mất kết nối · " + t
  };
  function LiveIndicator({ state = "live", time = "—", compact, children }) {
    return /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-live", state), role: "status", "aria-live": "polite", title: "Dữ liệu cập nhật lúc " + time }, /* @__PURE__ */ react_default.createElement("span", { className: "dot", "aria-hidden": "true" }), /* @__PURE__ */ react_default.createElement("span", { className: "txt" }, children || LIVE_TEXT[state](time)));
  }
  function ProjectTag({ children }) {
    return /* @__PURE__ */ react_default.createElement("span", { className: "fm-ptag" }, children);
  }
  function BackendTag({ backend }) {
    return backend ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-btag" }, backend) : /* @__PURE__ */ react_default.createElement("span", { className: "fm-btag none" }, "Chưa dispatch");
  }
  function TypeTag({ type }) {
    return /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-ttag", type), title: type === "scout" ? "Scout: chỉ điều tra, không sửa code" : "Ship: sửa code, cần bạn duyệt" }, type);
  }
  function CountBadge({ tone, children, label }) {
    return /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-count", tone && "t-" + tone), "aria-label": label }, children);
  }
  function Button({ variant, size, kbd, className, children, ...rest }) {
    return /* @__PURE__ */ react_default.createElement("button", { type: "button", className: cx("fm-btn", variant, size, className), ...rest }, children, kbd ? /* @__PURE__ */ react_default.createElement("span", { className: "k", "aria-hidden": "true" }, kbd) : null);
  }
  function CopyCommand({ label = "Prompt cho Foreman", text, cli, quiet, onCopied }) {
    const [done, setDone] = useState(null);
    function copy(value, which) {
      copyText(value).then(
        () => {
          setDone(which);
          onCopied && onCopied(value);
          setTimeout(() => setDone(null), 1800);
        },
        () => onCopied && onCopied(value, true)
      );
    }
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-copy", quiet && "quiet") }, text ? /* @__PURE__ */ react_default.createElement("div", { className: "row" }, /* @__PURE__ */ react_default.createElement("div", { className: "what" }, /* @__PURE__ */ react_default.createElement("div", { className: "lab" }, label), /* @__PURE__ */ react_default.createElement("div", { className: "txt" }, "“", text, "”")), /* @__PURE__ */ react_default.createElement("button", { type: "button", className: cx("go", done === "text" && "done"), onClick: () => copy(text, "text"), "aria-label": "Copy prompt: " + text }, done === "text" ? "Đã copy ✓" : "Copy")) : null, cli ? text ? /* @__PURE__ */ react_default.createElement("div", { className: "alt" }, /* @__PURE__ */ react_default.createElement("span", { className: "fm-faint" }, "CLI"), /* @__PURE__ */ react_default.createElement("code", { title: cli }, cli), /* @__PURE__ */ react_default.createElement("button", { type: "button", onClick: () => copy(cli, "cli"), "aria-label": "Copy CLI: " + cli }, done === "cli" ? "đã copy" : "copy CLI")) : /* @__PURE__ */ react_default.createElement("div", { className: "row" }, /* @__PURE__ */ react_default.createElement("div", { className: "what" }, /* @__PURE__ */ react_default.createElement("div", { className: "lab" }, label), /* @__PURE__ */ react_default.createElement("div", { className: "txt cmd" }, cli)), /* @__PURE__ */ react_default.createElement("button", { type: "button", className: cx("go", done === "cli" && "done"), onClick: () => copy(cli, "cli"), "aria-label": "Copy CLI: " + cli }, done === "cli" ? "Đã copy ✓" : "Copy")) : null);
  }
  function FilterChips({ label, value, options, onChange, multi }) {
    const id = useId("fl");
    const isOn = (v) => multi ? (value || []).indexOf(v) >= 0 : v === value;
    function toggle(v) {
      if (!multi) return onChange && onChange(v);
      const cur = value || [];
      onChange && onChange(cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]));
    }
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-chipgroup", role: "group", "aria-labelledby": label ? id : void 0 }, label ? /* @__PURE__ */ react_default.createElement("span", { className: "fl", id }, label) : null, options.map((o) => /* @__PURE__ */ react_default.createElement("button", { key: o.value, type: "button", className: "fm-chip", "aria-pressed": isOn(o.value) ? "true" : "false", onClick: () => toggle(o.value) }, o.label, o.count != null ? /* @__PURE__ */ react_default.createElement("span", { className: "n" }, o.count) : null)));
  }
  function SearchField({ value, onChange, placeholder = "Lọc theo ID, tên, profile…", label = "Lọc task", inputRef, onKeyDown }) {
    return /* @__PURE__ */ react_default.createElement("label", { className: "fm-search" }, /* @__PURE__ */ react_default.createElement("span", { className: "ic", "aria-hidden": "true" }, "⌕"), /* @__PURE__ */ react_default.createElement("span", { className: "fm-sr" }, label), /* @__PURE__ */ react_default.createElement("input", { ref: inputRef, type: "search", value, placeholder, onKeyDown, onChange: (e) => onChange && onChange(e.target.value) }), value ? /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "clear", onClick: () => onChange && onChange(""), "aria-label": "Xoá ô lọc" }, "✕") : null);
  }
  function SelectField({ label, value, options, onChange }) {
    const id = useId("sel");
    return /* @__PURE__ */ react_default.createElement("span", { className: "fm-select" }, /* @__PURE__ */ react_default.createElement("label", { htmlFor: id }, label), /* @__PURE__ */ react_default.createElement("select", { id, value, onChange: (e) => onChange && onChange(e.target.value) }, options.map((o) => /* @__PURE__ */ react_default.createElement("option", { key: o.value, value: o.value }, o.label))));
  }
  function Toggle({ checked, onChange, children, disabled }) {
    return /* @__PURE__ */ react_default.createElement("label", { className: "fm-toggle" }, /* @__PURE__ */ react_default.createElement("input", { type: "checkbox", checked: !!checked, disabled, onChange: (e) => onChange && onChange(e.target.checked) }), /* @__PURE__ */ react_default.createElement("span", { className: "track", "aria-hidden": "true" }), /* @__PURE__ */ react_default.createElement("span", null, children));
  }
  function Segmented({ label, value, options, onChange }) {
    return /* @__PURE__ */ react_default.createElement("span", { className: "fm-seg", role: "group", "aria-label": label }, options.map((o) => /* @__PURE__ */ react_default.createElement("button", { key: o.value, type: "button", "aria-pressed": o.value === value ? "true" : "false", onClick: () => onChange && onChange(o.value) }, o.label)));
  }
  function Tabs({ tabs, value, onChange, label }) {
    const ref = useRef(null);
    function onKey(e) {
      const i = tabs.findIndex((t) => t.id === value);
      let n = null;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      if (n == null) return;
      e.preventDefault();
      onChange(tabs[n].id);
      const btns = ref.current && ref.current.querySelectorAll("[role=tab]");
      if (btns && btns[n]) btns[n].focus();
    }
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-tabs", role: "tablist", "aria-label": label, ref, onKeyDown: onKey }, tabs.map((t) => /* @__PURE__ */ react_default.createElement("button", { key: t.id, type: "button", role: "tab", className: "fm-tab", "aria-selected": t.id === value ? "true" : "false", tabIndex: t.id === value ? 0 : -1, onClick: () => onChange(t.id) }, t.label, t.count ? /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-count", t.tone && "t-" + t.tone) }, t.count) : null)));
  }
  function CounterBar({ items, value, onChange, label = "Lọc theo nhóm" }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-counters", style: { "--fm-cols": items.length }, role: "group", "aria-label": label }, items.map((c) => {
      const on = value === c.id;
      return /* @__PURE__ */ react_default.createElement("button", { key: c.id, type: "button", className: cx("fm-counter", "t-" + (c.tone || "ink"), c.hot && !on && "hot", !c.value && "zero"), "aria-pressed": on ? "true" : "false", onClick: () => onChange && onChange(on ? null : c.id) }, /* @__PURE__ */ react_default.createElement("span", { className: "k" }, /* @__PURE__ */ react_default.createElement("span", { className: "sw", "aria-hidden": "true" }), c.label), /* @__PURE__ */ react_default.createElement("span", { className: "v" }, c.value), /* @__PURE__ */ react_default.createElement("span", { className: "s" }, c.sub));
    }));
  }
  function WorkerSlot({ id, title, profile, backend, runtime, quiet, quietRatio = 0, quietWarn, held, tone, selected, onSelect, badge, isNew }) {
    return /* @__PURE__ */ react_default.createElement("button", { type: "button", className: cx("fm-slot", held && "held", tone && "t-" + tone), "aria-pressed": selected ? "true" : "false", onClick: onSelect, "aria-label": id + " — " + title }, /* @__PURE__ */ react_default.createElement("span", { className: "l1" }, /* @__PURE__ */ react_default.createElement("span", { className: "tid" }, id), isNew ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-newdot", title: "Có report mới" }) : null, /* @__PURE__ */ react_default.createElement("span", { className: "end" }, badge, /* @__PURE__ */ react_default.createElement(BackendTag, { backend }))), /* @__PURE__ */ react_default.createElement("span", { className: "ttl" }, title), /* @__PURE__ */ react_default.createElement("span", { className: "prof" }, profile), /* @__PURE__ */ react_default.createElement("span", { className: "l3" }, /* @__PURE__ */ react_default.createElement(RuntimeBadge, { state: runtime }), /* @__PURE__ */ react_default.createElement("span", { className: cx("quiet", quietWarn && "warn") }, quiet)), held ? null : /* @__PURE__ */ react_default.createElement("span", { className: cx("bar", quietWarn && "warn"), "aria-hidden": "true" }, /* @__PURE__ */ react_default.createElement("i", { style: { width: Math.min(100, Math.round(quietRatio * 100)) + "%" } })));
  }
  function HeldChip({ id, status, wait, urgent, backend, selected, onSelect, isNew }) {
    return /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "fm-heldchip", "aria-pressed": selected ? "true" : "false", onClick: onSelect }, /* @__PURE__ */ react_default.createElement("span", { className: "tid" }, id), isNew ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-newdot", title: "Có report mới" }) : null, /* @__PURE__ */ react_default.createElement(StatusLabel, { status, size: "sm" }), /* @__PURE__ */ react_default.createElement("span", { className: cx("w", urgent && "you") }, wait));
  }
  function LaneGroup({ label, count, children, compact }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-lanegroup" }, /* @__PURE__ */ react_default.createElement("div", { className: "lab" }, label, count != null ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-count" }, count) : null), /* @__PURE__ */ react_default.createElement("div", { className: compact ? "fm-heldrow" : "fm-lanes" }, children));
  }
  function FleetTable({ groups, selected, onSelect, onOpen, dense, layout = "table", collapsed = {}, onToggle, caption, emptyText }) {
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    function key(e, r) {
      if (e.key === "Enter") {
        e.preventDefault();
        (e.shiftKey && onOpen ? onOpen : onSelect)(r.id);
      }
      if (e.key === " ") {
        e.preventDefault();
        onSelect(r.id);
      }
    }
    return /* @__PURE__ */ react_default.createElement("table", { className: cx("fm-fleet", dense && "dense", layout === "cards" && "cards") }, caption ? /* @__PURE__ */ react_default.createElement("caption", { className: "fm-sr" }, caption) : null, /* @__PURE__ */ react_default.createElement("colgroup", null, /* @__PURE__ */ react_default.createElement("col", { style: { width: 84 } }), /* @__PURE__ */ react_default.createElement("col", null), /* @__PURE__ */ react_default.createElement("col", { style: { width: 140 } }), /* @__PURE__ */ react_default.createElement("col", { style: { width: 176 } }), /* @__PURE__ */ react_default.createElement("col", { style: { width: 136 } }), /* @__PURE__ */ react_default.createElement("col", { style: { width: 124 } })), /* @__PURE__ */ react_default.createElement("thead", null, /* @__PURE__ */ react_default.createElement("tr", null, /* @__PURE__ */ react_default.createElement("th", { scope: "col" }, "ID"), /* @__PURE__ */ react_default.createElement("th", { scope: "col" }, "Task"), /* @__PURE__ */ react_default.createElement("th", { scope: "col" }, "Dự án"), /* @__PURE__ */ react_default.createElement("th", { scope: "col" }, "Agent"), /* @__PURE__ */ react_default.createElement("th", { scope: "col" }, "Thời gian"), /* @__PURE__ */ react_default.createElement("th", { scope: "col", className: "r" }, "Trạng thái"))), /* @__PURE__ */ react_default.createElement("tbody", null, total === 0 ? /* @__PURE__ */ react_default.createElement("tr", { className: "empty" }, /* @__PURE__ */ react_default.createElement("td", { colSpan: 6 }, emptyText || "Không có task nào khớp bộ lọc.")) : null, total === 0 ? null : groups.map((g) => /* @__PURE__ */ react_default.createElement(Fragment, { key: g.key }, /* @__PURE__ */ react_default.createElement("tr", { className: cx("grp", "t-" + g.tone) }, /* @__PURE__ */ react_default.createElement("td", { colSpan: 6 }, /* @__PURE__ */ react_default.createElement("button", { type: "button", "aria-expanded": collapsed[g.key] ? "false" : "true", onClick: () => onToggle && onToggle(g.key) }, /* @__PURE__ */ react_default.createElement("span", { className: "gsw", "aria-hidden": "true" }), /* @__PURE__ */ react_default.createElement("span", { className: "gname" }, g.label), /* @__PURE__ */ react_default.createElement("span", { className: "fm-count" }, g.rows.length), g.hint ? /* @__PURE__ */ react_default.createElement("span", { className: "ghint" }, g.hint) : null, /* @__PURE__ */ react_default.createElement("span", { className: "chev", "aria-hidden": "true" }, collapsed[g.key] ? "▸" : "▾")))), collapsed[g.key] ? null : g.rows.length === 0 ? /* @__PURE__ */ react_default.createElement("tr", { className: "emptygrp" }, /* @__PURE__ */ react_default.createElement("td", { colSpan: 6 }, "Không có.")) : g.rows.map((r) => /* @__PURE__ */ react_default.createElement(
      "tr",
      {
        key: r.id,
        className: cx("row", r.flash && "flash"),
        "aria-current": selected === r.id ? "true" : void 0,
        tabIndex: 0,
        "data-task": r.id,
        "aria-label": r.id + " — " + r.title + " — " + (STATUS[r.status] ? STATUS[r.status].label : r.status),
        onClick: () => onSelect && onSelect(r.id),
        onDoubleClick: () => onOpen && onOpen(r.id),
        onKeyDown: (e) => key(e, r)
      },
      /* @__PURE__ */ react_default.createElement("td", { className: "c-id" }, /* @__PURE__ */ react_default.createElement("div", { className: "idl" }, /* @__PURE__ */ react_default.createElement("span", { className: "tid" }, r.id), r.isNew ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-newdot", title: "Có report mới chưa xem" }) : null), /* @__PURE__ */ react_default.createElement("div", { className: "sub" }, /* @__PURE__ */ react_default.createElement(TypeTag, { type: r.type }))),
      /* @__PURE__ */ react_default.createElement("td", { className: "c-main" }, /* @__PURE__ */ react_default.createElement("div", { className: "tt", title: r.title }, r.title), r.line ? /* @__PURE__ */ react_default.createElement("div", { className: "tm" }, r.line) : null),
      /* @__PURE__ */ react_default.createElement("td", { className: "c-proj" }, /* @__PURE__ */ react_default.createElement(ProjectTag, null, r.project)),
      /* @__PURE__ */ react_default.createElement("td", { className: "c-who" }, /* @__PURE__ */ react_default.createElement("div", { className: "who" }, r.profile ? /* @__PURE__ */ react_default.createElement("span", { className: "p" }, r.profile) : /* @__PURE__ */ react_default.createElement("span", { className: "fm-faint" }, "—"), r.round ? /* @__PURE__ */ react_default.createElement("span", { className: "rnd" }, " · R", r.round, r.generation > 1 ? "·G" + r.generation : "") : null, /* @__PURE__ */ react_default.createElement("div", { className: "b" }, r.backend ? /* @__PURE__ */ react_default.createElement(BackendTag, { backend: r.backend }) : null, r.runtime && r.runtime !== "none" ? /* @__PURE__ */ react_default.createElement(RuntimeBadge, { state: r.runtime }) : null))),
      /* @__PURE__ */ react_default.createElement("td", { className: "c-age" }, /* @__PURE__ */ react_default.createElement("span", { className: cx("age", r.age && r.age.tone) }, r.age ? r.age.text : "—", r.age && r.age.sub ? /* @__PURE__ */ react_default.createElement("span", { className: "sub" }, r.age.sub) : null)),
      /* @__PURE__ */ react_default.createElement("td", { className: "c-st r" }, /* @__PURE__ */ react_default.createElement(StatusLabel, { status: r.status, size: "sm" }), r.points && r.points.open ? /* @__PURE__ */ react_default.createElement("span", { className: cx("pts", r.points.user && "u"), title: "Attention đang mở" }, r.points.user ? r.points.user + " attention cho bạn" : r.points.open + " attention") : null)
    ))))));
  }
  function Pane({ head, children, foot, className, label }) {
    return /* @__PURE__ */ react_default.createElement("section", { className: cx("fm-peek", className), "aria-label": label }, head ? /* @__PURE__ */ react_default.createElement("div", { className: "head" }, head) : null, /* @__PURE__ */ react_default.createElement("div", { className: "body" }, children), foot ? /* @__PURE__ */ react_default.createElement("div", { className: "foot" }, foot) : null);
  }
  function Section({ title, end, children }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-sec" }, /* @__PURE__ */ react_default.createElement("h4", null, title, end ? /* @__PURE__ */ react_default.createElement("span", { className: "end" }, end) : null), children);
  }
  function Card({ title, end, flat, dashed, children, className }) {
    return /* @__PURE__ */ react_default.createElement("section", { className: cx("fm-card", flat && "flat", dashed && "dashed", className) }, title ? /* @__PURE__ */ react_default.createElement("h4", null, title, end ? /* @__PURE__ */ react_default.createElement("span", { className: "end" }, end) : null) : null, children);
  }
  function Panel({ title, note, children }) {
    return /* @__PURE__ */ react_default.createElement("section", { className: "fm-panel" }, title ? /* @__PURE__ */ react_default.createElement("h4", null, title) : null, children, note ? /* @__PURE__ */ react_default.createElement("p", { className: "pnote" }, note) : null);
  }
  function KeyValue({ items, mono }) {
    return /* @__PURE__ */ react_default.createElement("dl", { className: "fm-kv" }, items.filter(Boolean).map((it, i) => /* @__PURE__ */ react_default.createElement(Fragment, { key: i }, /* @__PURE__ */ react_default.createElement("dt", null, it[0]), /* @__PURE__ */ react_default.createElement("dd", { className: cx((it[2] || mono) && "mono") }, it[1]))));
  }
  function Quote({ children, source, solid }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-quote", solid && "solid") }, children, source ? /* @__PURE__ */ react_default.createElement("span", { className: "src" }, source) : null);
  }
  function Callout({ variant, lead, children }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-callout", variant), role: variant === "warn" || variant === "danger" ? "note" : void 0 }, lead ? /* @__PURE__ */ react_default.createElement("b", { className: "lead" }, lead) : null, children);
  }
  function NextBox({ tone = "ink", title, children, why, copy }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-nextbox", "t-" + tone) }, /* @__PURE__ */ react_default.createElement("div", { className: "hd" }, title), /* @__PURE__ */ react_default.createElement("div", { className: "bd" }, children, why ? /* @__PURE__ */ react_default.createElement("div", { className: "why" }, why) : null), copy ? /* @__PURE__ */ react_default.createElement(CopyCommand, { ...copy }) : null);
  }
  function RoundList({ rounds, now }) {
    return /* @__PURE__ */ react_default.createElement("ol", { className: "fm-rounds" }, rounds.map((r, i) => /* @__PURE__ */ react_default.createElement("li", { key: r.round, className: cx("fm-round", i === 0 && "current") }, /* @__PURE__ */ react_default.createElement("div", { className: "rh" }, /* @__PURE__ */ react_default.createElement("b", null, r.round === 1 ? "Round 1 · brief" : "Round " + r.round), /* @__PURE__ */ react_default.createElement("span", { className: "t" }, r.when, r.mode ? " · " + r.mode : "", r.generation ? " · G" + r.generation : "")), r.original ? /* @__PURE__ */ react_default.createElement("div", { className: "said" }, /* @__PURE__ */ react_default.createElement("span", { className: "who" }, "Bạn yêu cầu"), r.original) : null, r.sent && r.sent !== r.original ? /* @__PURE__ */ react_default.createElement("div", { className: "said" }, /* @__PURE__ */ react_default.createElement("span", { className: "who" }, "Foreman gửi agent"), r.sent) : null, (r.reports || []).map((rep, j) => /* @__PURE__ */ react_default.createElement(Report, { key: j, ...rep })))));
  }
  var REPORT = { done: { label: "Xong", tone: "green" }, blocked: { label: "Bị chặn", tone: "red" }, progress: { label: "Tiến độ", tone: "blue" } };
  function Report({ status, when, summary, steps, file }) {
    const r = REPORT[status] || REPORT.progress;
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-report", "t-" + r.tone) }, /* @__PURE__ */ react_default.createElement("div", { className: "rh2" }, /* @__PURE__ */ react_default.createElement("span", { title: "report --status " + status }, /* @__PURE__ */ react_default.createElement(StatusLabel, { tone: r.tone, size: "sm" }, r.label)), /* @__PURE__ */ react_default.createElement("span", null, when), file ? /* @__PURE__ */ react_default.createElement("span", { className: "end", title: file }, file.split("/").pop()) : null), /* @__PURE__ */ react_default.createElement("div", { className: "rb" }, summary, steps && steps.length ? /* @__PURE__ */ react_default.createElement(react_default.Fragment, null, /* @__PURE__ */ react_default.createElement("div", { className: "fm-h4", style: { marginTop: 12 } }, "Agent gợi ý bước tiếp"), /* @__PURE__ */ react_default.createElement("ol", { className: "fm-steps" }, steps.map((s, i) => /* @__PURE__ */ react_default.createElement("li", { key: i }, s)))) : null));
  }
  var POINT_STATE = { verified: "đã kiểm", "limit-accepted": "chấp nhận giới hạn", resolved: "đã xong", dropped: "đã bỏ" };
  function PointList({ points, kinds, now }) {
    const when = (v) => typeof v === "number" ? now ? ago(v, now) : clock(v) : v;
    if (!points.length) return /* @__PURE__ */ react_default.createElement("p", { className: "fm-faint", style: { margin: 0, fontSize: 13 } }, "Không có attention.");
    return /* @__PURE__ */ react_default.createElement("ul", { className: "fm-points" }, points.map((p) => /* @__PURE__ */ react_default.createElement("li", { key: p.id, className: cx("fm-point", p.owner === "user" && p.state === "open" && "user", p.state !== "open" && p.state !== "snoozed" && "closed", p.state === "snoozed" && "snoozed") }, /* @__PURE__ */ react_default.createElement("span", { className: "pid" }, p.id), /* @__PURE__ */ react_default.createElement("span", { className: "txt" }, p.text), /* @__PURE__ */ react_default.createElement("span", { className: cx("fm-status sm", p.owner === "user" ? "t-red" : "t-ink") }, p.owner === "user" ? "bạn" : "agent"), /* @__PURE__ */ react_default.createElement("span", { className: "meta" }, kinds && kinds[p.kind] || p.kind, " · ", p.state === "open" ? "mở " + when(p.since) : p.state === "snoozed" ? "hoãn đến " + when(p.until) : (POINT_STATE[p.state] || p.state) + (p.closedHow ? " · " + p.closedHow : ""), p.round && !p.closedHow ? " · round " + p.round : ""))));
  }
  function DecisionOptions({ options, recommendation, renderAction }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-options" }, options.map((o) => /* @__PURE__ */ react_default.createElement("div", { key: o.key, className: cx("fm-option", o.key === recommendation && "rec") }, /* @__PURE__ */ react_default.createElement("span", { className: "letter", "aria-hidden": "true" }, o.key), /* @__PURE__ */ react_default.createElement("span", { className: "otitle" }, /* @__PURE__ */ react_default.createElement("span", { className: "fm-sr" }, "Phương án ", o.key, ": "), o.title), o.impact ? /* @__PURE__ */ react_default.createElement("span", { className: "oimpact" }, o.impact) : null, /* @__PURE__ */ react_default.createElement("span", { className: "ofoot" }, o.key === recommendation ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-rectag" }, "Agent đề xuất") : null, renderAction ? renderAction(o) : null))));
  }
  function InboxList({ groups, current, onPick, label = "Việc chờ bạn" }) {
    return /* @__PURE__ */ react_default.createElement("nav", { className: "fm-ilist", "aria-label": label }, groups.map((g) => /* @__PURE__ */ react_default.createElement(Fragment, { key: g.key }, /* @__PURE__ */ react_default.createElement("div", { className: "ig" }, g.label, /* @__PURE__ */ react_default.createElement("span", { className: "fm-count" }, g.items.length)), g.items.map((it) => /* @__PURE__ */ react_default.createElement("button", { key: it.key, type: "button", className: "fm-iitem", "aria-current": current === it.key ? "true" : void 0, onClick: () => onPick(it.key) }, /* @__PURE__ */ react_default.createElement("span", { className: "tid" }, it.id), /* @__PURE__ */ react_default.createElement("span", { className: "q" }, it.question), /* @__PURE__ */ react_default.createElement("span", { className: cx("age", !it.urgent && "ok") }, it.age), /* @__PURE__ */ react_default.createElement("span", { className: "sub" }, it.isNew ? /* @__PURE__ */ react_default.createElement("span", { className: "fm-newdot" }) : null, /* @__PURE__ */ react_default.createElement(StatusLabel, { status: it.status, size: "sm" }), it.project, it.overdue ? /* @__PURE__ */ react_default.createElement("span", { style: { color: "var(--red-deep)", fontWeight: 700 } }, "quá hạn") : null))))));
  }
  function Compose({ prefix, placeholder, onCopied }) {
    const [text, setText] = useState("");
    const id = useId("cmp");
    const full = prefix + (text.trim() || "…");
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-compose" }, /* @__PURE__ */ react_default.createElement("label", { htmlFor: id, className: "fm-h4", style: { display: "flex" } }, "Trả lời khác"), /* @__PURE__ */ react_default.createElement("textarea", { id, value: text, placeholder, onChange: (e) => setText(e.target.value) }), /* @__PURE__ */ react_default.createElement("div", { className: "cf" }, /* @__PURE__ */ react_default.createElement("span", { style: { marginLeft: "auto" } }), /* @__PURE__ */ react_default.createElement(Button, { variant: "primary", disabled: !text.trim(), onClick: () => copyText(full).then(() => onCopied && onCopied(full)) }, "Copy prompt")));
  }
  function EventLog({ events, onOpen, groupByDay = true, label = "Nhật ký" }) {
    const out = [];
    let last = null;
    events.forEach((e) => {
      if (groupByDay && e.day !== last) {
        last = e.day;
        out.push(/* @__PURE__ */ react_default.createElement("div", { className: "fm-daysep", key: "d" + e.key }, /* @__PURE__ */ react_default.createElement("span", { className: "dl" }, e.day), /* @__PURE__ */ react_default.createElement("div", { className: "ln", "aria-hidden": "true" })));
      }
      const ev = EVENT[e.type] || { label: e.type, tone: "ink" };
      const inner = [
        /* @__PURE__ */ react_default.createElement("time", { className: "et", key: "t" }, clock(e.at)),
        /* @__PURE__ */ react_default.createElement("span", { className: cx("etag", "t-" + ev.tone), key: "g" }, ev.label),
        /* @__PURE__ */ react_default.createElement("span", { className: "ex", key: "x" }, /* @__PURE__ */ react_default.createElement("b", null, e.taskId), e.text, e.meta ? /* @__PURE__ */ react_default.createElement("span", { className: "em" }, e.meta) : null)
      ];
      out.push(onOpen ? /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "fm-ev", key: e.key, onClick: () => onOpen(e.taskId) }, inner) : /* @__PURE__ */ react_default.createElement("div", { className: "fm-ev", key: e.key }, inner));
    });
    if (!out.length) out.push(/* @__PURE__ */ react_default.createElement("p", { key: "e", className: "fm-faint", style: { fontFamily: "var(--font-mono)", fontSize: 12 } }, "— Không có sự kiện nào khớp bộ lọc. —"));
    return /* @__PURE__ */ react_default.createElement("section", { "aria-label": label }, out);
  }
  function ShiftGantt({ rows, from, to, now, onOpen, label = "Thời gian theo task" }) {
    const span = to - from, hours = Math.round(span / 36e5);
    const pct = (t) => Math.max(0, Math.min(100, (t - from) / span * 100));
    const ticks = [];
    for (let h = 0; h <= hours; h += hours > 12 ? 2 : 1) ticks.push(from + h * 36e5);
    return /* @__PURE__ */ react_default.createElement("figure", { className: "fm-gantt", style: { margin: 0 }, "aria-label": label }, /* @__PURE__ */ react_default.createElement("div", { className: "gin" }, /* @__PURE__ */ react_default.createElement("div", { className: "axis" }, /* @__PURE__ */ react_default.createElement("span", null), /* @__PURE__ */ react_default.createElement("div", { className: "ticks" }, ticks.map((t) => /* @__PURE__ */ react_default.createElement("span", { key: t, style: { left: pct(t) + "%" } }, clock(t))), now ? /* @__PURE__ */ react_default.createElement("i", { className: "now", style: { left: pct(now) + "%" }, "aria-hidden": "true" }) : null)), rows.map((r) => /* @__PURE__ */ react_default.createElement("div", { className: "grow", key: r.id }, /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "gid", onClick: () => onOpen && onOpen(r.id) }, r.id), /* @__PURE__ */ react_default.createElement("div", { className: "track", style: { "--fm-hours": hours } }, r.segs.map((s, i) => /* @__PURE__ */ react_default.createElement("span", { key: i, className: "seg s-" + s.kind, style: { left: pct(s.from) + "%", width: Math.max(0.6, pct(s.to) - pct(s.from)) + "%" }, title: r.id + " · " + s.label + " · " + clock(s.from) + "–" + clock(s.to) })), now ? /* @__PURE__ */ react_default.createElement("span", { className: "now", style: { left: pct(now) + "%" }, "aria-hidden": "true" }) : null)))), /* @__PURE__ */ react_default.createElement("figcaption", { className: "fm-legend" }, /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("i", { className: "s-run" }), "Agent đang làm"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("i", { className: "s-idle" }), "Chờ round tiếp"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("i", { className: "s-you" }), "Chờ bạn"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("i", { className: "s-review" }), "Chờ duyệt"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("i", { className: "s-warn" }), "Bất thường"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("i", { className: "s-queue" }), "Chờ dispatch")));
  }
  var MARK = { ok: "✓", warn: "!", bad: "✕", off: "–" };
  function CheckList({ items, label }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-checks", role: "list", "aria-label": label }, items.map((c, i) => /* @__PURE__ */ react_default.createElement("div", { key: i, role: "listitem", className: cx("fm-check", c.state) }, /* @__PURE__ */ react_default.createElement("span", { className: "mk", "aria-label": { ok: "ổn", warn: "cảnh báo", bad: "lỗi", off: "tắt" }[c.state] }, MARK[c.state]), /* @__PURE__ */ react_default.createElement("span", { className: "nm" }, c.name), /* @__PURE__ */ react_default.createElement("span", { className: "ds" }, c.desc), /* @__PURE__ */ react_default.createElement("span", { className: "vl" }, c.value))));
  }
  function KpiStrip({ items, label }) {
    return /* @__PURE__ */ react_default.createElement("section", { className: "fm-kpis", style: { "--fm-cols": items.length }, "aria-label": label }, items.map((k, i) => /* @__PURE__ */ react_default.createElement("div", { key: i, className: cx("fm-kpi", k.tone && "t-" + k.tone) }, /* @__PURE__ */ react_default.createElement("div", { className: "k" }, k.label), /* @__PURE__ */ react_default.createElement("div", { className: "v" }, k.value == null ? "—" : k.value, k.value != null && k.unit ? /* @__PURE__ */ react_default.createElement("small", null, k.unit) : null), k.sub ? /* @__PURE__ */ react_default.createElement("div", { className: "s" }, k.sub) : null)));
  }
  function StatBlock({ label, value, unit, sub }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-stat" }, label ? /* @__PURE__ */ react_default.createElement("div", { className: "k" }, label) : null, /* @__PURE__ */ react_default.createElement("div", { className: "v" }, value == null ? "—" : value, value != null && unit ? /* @__PURE__ */ react_default.createElement("small", null, " ", unit) : null), sub ? /* @__PURE__ */ react_default.createElement("div", { className: "s" }, sub) : null);
  }
  function Meter({ value, low, label = "Tỉ lệ" }) {
    const v = Math.max(0, Math.min(100, value || 0));
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-meter", low && "low"), role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": v, "aria-label": label }, /* @__PURE__ */ react_default.createElement("i", { style: { width: v + "%" } }));
  }
  function BarList({ title, rows, max }) {
    const m = max || Math.max.apply(null, rows.map((r) => r.value).concat([1]));
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-bars" }, title ? /* @__PURE__ */ react_default.createElement("h4", null, title) : null, rows.map((r, i) => /* @__PURE__ */ react_default.createElement("div", { className: "fm-brow", key: i }, /* @__PURE__ */ react_default.createElement("span", { className: "bl", title: r.label }, r.label), /* @__PURE__ */ react_default.createElement("div", { className: "track", "aria-hidden": "true" }, /* @__PURE__ */ react_default.createElement("i", { className: r.tone ? "t-" + r.tone : void 0, style: { width: Math.round(r.value / m * 100) + "%" } })), /* @__PURE__ */ react_default.createElement("span", { className: "bv" }, r.display || r.value))));
  }
  function ChartFrame({ svg, legend, table }) {
    const [open, setOpen] = useState(false);
    return /* @__PURE__ */ react_default.createElement("figure", { className: "fm-chart" }, /* @__PURE__ */ react_default.createElement("div", { className: "scroll" }, svg), /* @__PURE__ */ react_default.createElement("figcaption", { className: "legend" }, legend, table ? /* @__PURE__ */ react_default.createElement("span", { className: "push" }, /* @__PURE__ */ react_default.createElement("button", { type: "button", className: "fm-chip", "aria-expanded": open ? "true" : "false", onClick: () => setOpen(!open) }, open ? "Ẩn bảng" : "Xem dạng bảng")) : null), table && open ? table : null);
  }
  function dataTable(caption, heads, rows) {
    return /* @__PURE__ */ react_default.createElement("table", { className: "fm-datatable" }, /* @__PURE__ */ react_default.createElement("caption", { className: "fm-sr" }, caption), /* @__PURE__ */ react_default.createElement("thead", null, /* @__PURE__ */ react_default.createElement("tr", null, heads.map((h, i) => /* @__PURE__ */ react_default.createElement("th", { key: i, scope: "col" }, h)))), /* @__PURE__ */ react_default.createElement("tbody", null, rows.map((r, i) => /* @__PURE__ */ react_default.createElement("tr", { key: i }, r.map((c, j) => /* @__PURE__ */ react_default.createElement("td", { key: j }, c))))));
  }
  function DailyBars({ data, max, unit = "M", ariaLabel, seriesLabel = "Token tiêu thụ (triệu / ngày)" }) {
    const W = 680, H = 232, ml = 44, mr = 12, mt = 26, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
    const top = Math.max.apply(null, data.map((d) => d.value));
    const mx = max || Math.ceil(top);
    const X = (i) => ml + pw * (i + 0.5) / data.length, Y = (v) => mt + ph - v / mx * ph, bw = Math.min(44, pw / data.length - 16);
    const grid = [];
    for (let k = 0; k <= mx; k++) grid.push(/* @__PURE__ */ react_default.createElement("g", { key: k }, /* @__PURE__ */ react_default.createElement("line", { className: "grid", x1: ml, x2: W - mr, y1: Y(k), y2: Y(k) }), /* @__PURE__ */ react_default.createElement("text", { x: ml - 7, y: Y(k) + 4, textAnchor: "end" }, k + unit)));
    const svg = /* @__PURE__ */ react_default.createElement("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": ariaLabel }, grid, data.map((d, i) => {
      const hot = d.value === top, y = Y(d.value);
      return /* @__PURE__ */ react_default.createElement("g", { key: i }, /* @__PURE__ */ react_default.createElement("rect", { className: cx("bar", hot && "hot"), x: X(i) - bw / 2, y, width: bw, height: mt + ph - y }, /* @__PURE__ */ react_default.createElement("title", null, d.label + ": " + d.value.toFixed(1) + unit)), /* @__PURE__ */ react_default.createElement("text", { className: "val", x: X(i), y: y - 6, textAnchor: "middle" }, d.value.toFixed(1)), hot ? /* @__PURE__ */ react_default.createElement("text", { className: "val hot", x: X(i), y: y - 20, textAnchor: "middle" }, "▲") : null, /* @__PURE__ */ react_default.createElement("text", { x: X(i), y: H - 10, textAnchor: "middle" }, d.label));
    }));
    return /* @__PURE__ */ react_default.createElement(ChartFrame, { svg, legend: [/* @__PURE__ */ react_default.createElement("span", { key: "a" }, /* @__PURE__ */ react_default.createElement("i", { className: "sw" }), seriesLabel), /* @__PURE__ */ react_default.createElement("span", { key: "b" }, /* @__PURE__ */ react_default.createElement("i", { className: "sw hot" }), "Ngày cao nhất")], table: dataTable(ariaLabel, ["Ngày", seriesLabel], data.map((d) => [d.label, d.value.toFixed(1) + unit])) });
  }
  function HitLine({ data, min = 50, max = 90, threshold, ariaLabel, seriesLabel = "Cache hit % theo ngày", height = 112 }) {
    const W = 680, H = height, ml = 44, mr = 12, mt = 18, mb = 22, pw = W - ml - mr, ph = H - mt - mb;
    const X = (i) => ml + pw * (i + 0.5) / data.length, Y = (v) => mt + ph - (v - min) / (max - min) * ph;
    const vals = data.map((d) => d.value), hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    const ticks = [min, max].concat(threshold != null ? [threshold] : []);
    const svg = /* @__PURE__ */ react_default.createElement("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": ariaLabel }, ticks.map((v) => /* @__PURE__ */ react_default.createElement("g", { key: v }, /* @__PURE__ */ react_default.createElement("line", { className: v === threshold ? "thrline" : "grid", x1: ml, x2: W - mr, y1: Y(v), y2: Y(v) }), /* @__PURE__ */ react_default.createElement("text", { className: v === threshold ? "thr" : void 0, x: ml - 7, y: Y(v) + 4, textAnchor: "end" }, v, "%"))), /* @__PURE__ */ react_default.createElement("polyline", { className: "line", points: data.map((d, i) => X(i) + "," + Y(d.value)).join(" ") }), data.map((d, i) => /* @__PURE__ */ react_default.createElement("g", { key: i }, /* @__PURE__ */ react_default.createElement("circle", { className: "pt", cx: X(i), cy: Y(d.value), r: 4.5 }, /* @__PURE__ */ react_default.createElement("title", null, d.label + ": " + d.value + "%")), i === 0 || i === data.length - 1 || d.value === hi || d.value === lo ? /* @__PURE__ */ react_default.createElement("text", { className: "line-val", x: X(i), y: Y(d.value) - 9, textAnchor: "middle" }, d.value, "%") : null, /* @__PURE__ */ react_default.createElement("text", { x: X(i), y: H - 4, textAnchor: "middle" }, d.short || d.label))));
    return /* @__PURE__ */ react_default.createElement(ChartFrame, { svg, legend: [/* @__PURE__ */ react_default.createElement("span", { key: "a" }, /* @__PURE__ */ react_default.createElement("i", { className: "sw line" }), seriesLabel), threshold != null ? /* @__PURE__ */ react_default.createElement("span", { key: "b" }, /* @__PURE__ */ react_default.createElement("i", { className: "sw dash" }), "Ngưỡng nguội ", threshold, "%") : null], table: dataTable(ariaLabel, ["Ngày", "Cache hit"], data.map((d) => [d.label, d.value + "%"])) });
  }
  var STATE_COPY = {
    loading: { title: "Đang tải…", tone: null, mark: "◷", stamp: "Đang tải" },
    empty: { title: "Chưa có task", tone: null, mark: "—", stamp: "Trống" },
    unconfigured: { title: "Chưa trỏ tới FOREMAN_HOME", tone: "mustard", mark: "⚙", stamp: "Chưa cấu hình" },
    "missing-home": { title: "Không thấy thư mục home", tone: "mustard", mark: "?", stamp: "Thiếu home" },
    error: { title: "Không đọc được state", tone: "red", mark: "✕", stamp: "Lỗi đọc" }
  };
  function StateNotice({ state, title, stamp, actions, small, children }) {
    const s = STATE_COPY[state] || STATE_COPY.empty;
    return /* @__PURE__ */ react_default.createElement("div", { className: cx("fm-state", s.tone && "t-" + s.tone, small && "sm"), role: state === "error" ? "alert" : "status" }, /* @__PURE__ */ react_default.createElement(Stamp, { tone: s.tone || "ink", size: "sm" }, s.mark + " " + (stamp || s.stamp)), /* @__PURE__ */ react_default.createElement("div", { className: "ttl" }, title || s.title), children ? /* @__PURE__ */ react_default.createElement("div", { className: "msg" }, children) : null, actions ? /* @__PURE__ */ react_default.createElement("div", { className: "acts" }, actions) : null);
  }
  function Skeleton({ lines = 3, block }) {
    if (block) return /* @__PURE__ */ react_default.createElement("div", { className: "fm-skel block", "aria-hidden": "true" });
    const out = [];
    for (let i = 0; i < lines; i++) out.push(/* @__PURE__ */ react_default.createElement("div", { key: i, className: "fm-skel", style: { width: (i === lines - 1 ? 60 : 100) + "%", marginTop: i ? 8 : 0 } }));
    return /* @__PURE__ */ react_default.createElement("div", { "aria-hidden": "true" }, out);
  }
  function Toasts({ items, onDismiss }) {
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-toasts", role: "status", "aria-live": "polite" }, items.map((t) => /* @__PURE__ */ react_default.createElement("div", { key: t.id, className: cx("fm-toast", t.tone && "t-" + t.tone) }, /* @__PURE__ */ react_default.createElement("span", { style: { flex: 1 } }, t.text), t.action ? /* @__PURE__ */ react_default.createElement("button", { type: "button", onClick: () => {
      t.action.run();
      onDismiss(t.id);
    } }, t.action.label) : null, /* @__PURE__ */ react_default.createElement("button", { type: "button", onClick: () => onDismiss(t.id), "aria-label": "Đóng thông báo" }, "✕"))));
  }
  function useTrap(ref, onClose, active = true) {
    useEffect(() => {
      if (!active) return void 0;
      const prev = document.activeElement, prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const f = ref.current && ref.current.querySelector("[data-autofocus], input, button");
      if (f) f.focus();
      function onKey(e) {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose && onClose();
          return;
        }
        if (e.key !== "Tab" || !ref.current) return;
        const els = ref.current.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      document.addEventListener("keydown", onKey, true);
      return () => {
        document.removeEventListener("keydown", onKey, true);
        document.body.style.overflow = prevOverflow;
        if (prev && prev.focus) prev.focus();
      };
    }, [active]);
  }
  function Dialog({ title, onClose, children, label }) {
    const ref = useRef(null);
    useTrap(ref, onClose);
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-overlay", onMouseDown: (e) => {
      if (e.target === e.currentTarget) onClose();
    } }, /* @__PURE__ */ react_default.createElement("div", { className: "fm-dialog", role: "dialog", "aria-modal": "true", "aria-label": label || title, ref }, /* @__PURE__ */ react_default.createElement("div", { className: "dh" }, /* @__PURE__ */ react_default.createElement("h2", null, title), /* @__PURE__ */ react_default.createElement("span", { className: "end" }, /* @__PURE__ */ react_default.createElement(Button, { variant: "flat", size: "sm", onClick: onClose }, "Đóng ✕"))), /* @__PURE__ */ react_default.createElement("div", { className: "db" }, children)));
  }
  function Drawer({ onClose, children, label }) {
    const ref = useRef(null);
    useTrap(ref, onClose);
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-drawer-scrim", onMouseDown: (e) => {
      if (e.target === e.currentTarget) onClose();
    } }, /* @__PURE__ */ react_default.createElement("div", { className: "fm-drawer", role: "dialog", "aria-modal": "true", "aria-label": label, ref }, children));
  }
  function CommandPalette({ items, onClose, placeholder = "Gõ ID, tên task hoặc tên màn hình…" }) {
    const ref = useRef(null);
    const [q, setQ] = useState("");
    const [i, setI] = useState(0);
    useTrap(ref, onClose);
    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
    const list = items.filter((it) => !q || norm(it.kicker + " " + it.title + " " + (it.sub || "")).indexOf(norm(q)) >= 0).slice(0, 12);
    function key(e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setI((i + 1) % Math.max(1, list.length));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setI((i - 1 + list.length) % Math.max(1, list.length));
      }
      if (e.key === "Enter" && list[i]) {
        e.preventDefault();
        list[i].run();
        onClose();
      }
    }
    let lastGroup = null;
    return /* @__PURE__ */ react_default.createElement("div", { className: "fm-overlay", onMouseDown: (e) => {
      if (e.target === e.currentTarget) onClose();
    } }, /* @__PURE__ */ react_default.createElement("div", { className: "fm-dialog fm-palette", role: "dialog", "aria-modal": "true", "aria-label": "Tìm nhanh", ref }, /* @__PURE__ */ react_default.createElement("input", { "data-autofocus": true, value: q, placeholder, onChange: (e) => {
      setQ(e.target.value);
      setI(0);
    }, onKeyDown: key, "aria-label": "Tìm nhanh", role: "combobox", "aria-expanded": "true", "aria-controls": "fm-pal-list" }), /* @__PURE__ */ react_default.createElement("ul", { id: "fm-pal-list", role: "listbox" }, list.length === 0 ? /* @__PURE__ */ react_default.createElement("li", { className: "grp" }, "Không có kết quả") : null, list.map((it, k) => {
      const head = it.group !== lastGroup ? /* @__PURE__ */ react_default.createElement("li", { className: "grp", key: "g" + it.key }, it.group) : null;
      lastGroup = it.group;
      return [head, /* @__PURE__ */ react_default.createElement("li", { key: it.key, role: "none" }, /* @__PURE__ */ react_default.createElement("button", { type: "button", role: "option", "aria-selected": k === i ? "true" : "false", onMouseEnter: () => setI(k), onClick: () => {
        it.run();
        onClose();
      } }, /* @__PURE__ */ react_default.createElement("span", { className: "pk" }, it.kicker), /* @__PURE__ */ react_default.createElement("span", { className: "pt" }, it.title), /* @__PURE__ */ react_default.createElement("span", { className: "ps" }, it.sub)))];
    })), /* @__PURE__ */ react_default.createElement("div", { className: "pfoot" }, /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("span", { className: "fm-kbd" }, "↑↓"), " chọn"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("span", { className: "fm-kbd" }, "Enter"), " mở"), /* @__PURE__ */ react_default.createElement("span", null, /* @__PURE__ */ react_default.createElement("span", { className: "fm-kbd" }, "Esc"), " đóng"))));
  }
  function KeyHelp({ groups }) {
    return groups.map((g) => /* @__PURE__ */ react_default.createElement("div", { key: g.title, style: { marginBottom: 16 } }, /* @__PURE__ */ react_default.createElement("div", { className: "fm-h4" }, g.title), /* @__PURE__ */ react_default.createElement("div", { className: "fm-keys" }, g.keys.map((k) => /* @__PURE__ */ react_default.createElement("div", { key: k[0] }, /* @__PURE__ */ react_default.createElement("span", null, k[1]), /* @__PURE__ */ react_default.createElement("span", null, k[0].split(" ").map((p, i) => /* @__PURE__ */ react_default.createElement("span", { key: i, className: "fm-kbd", style: { marginLeft: 4 } }, p))))))));
  }

  // v2/src/ds/index.js
  window.Foreman = Object.assign(window.Foreman || {}, components_exports, vocab_exports);
})();
