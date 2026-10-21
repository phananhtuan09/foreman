import type * as React from 'react';

/** Foreman task status, verbatim from meta.status, plus "choose-model" for needsProfileConfirmation. */
export type StatusKey = 'waiting-decision' | 'blocked' | 'choose-model' | 'review-ready' | 'working' | 'pending' | 'routing' | 'queued';
/** Runtime classification of one status check. */
export type RuntimeKey = 'working' | 'idle' | 'waiting-input' | 'unknown' | 'mismatch' | 'dead' | 'missing' | 'none';
export type Tone = 'red' | 'mustard' | 'blue' | 'green' | 'ink';
export type EventType = 'report' | 'done' | 'blocked' | 'decision' | 'answer' | 'round' | 'dispatch' | 'created' | 'anomaly' | 'accepted';
export type Backend = 'Paseo' | 'Herdr' | null;
type Node = React.ReactNode;

// ---------- Frame
export interface SheetProps { desk?: boolean; grain?: boolean; className?: string; children?: Node }
export declare function Sheet(p: SheetProps): React.ReactElement;
export declare function Perforation(): React.ReactElement;
export interface NavItem { id?: string; label?: string; count?: number; tone?: 'red' | 'mustard'; countLabel?: string; sep?: boolean; key?: string }
export interface TopBarProps { title?: string; subtitle?: string; nav?: NavItem[]; current?: string | null; onNavigate?: (id: string) => void; live?: LiveIndicatorProps; onHome?: () => void; onSearch?: () => void; onHelp?: () => void; theme?: 'light' | 'dark'; onTheme?: (() => void) | null }
export declare function TopBar(p: TopBarProps): React.ReactElement;
export declare function NavTabs(p: { items: NavItem[]; current?: string | null; onNavigate?: (id: string) => void; label?: string }): React.ReactElement;
export interface PageHeaderProps { no?: string; eyebrow?: Node; title: Node; lede?: Node; actions?: Node; id?: string; plain?: boolean }
export declare function PageHeader(p: PageHeaderProps): React.ReactElement;
export interface SectionHeaderProps { title: Node; meta?: Node; hint?: Node; end?: Node; rule?: boolean; as?: 'h2' | 'h3'; id?: string }
export declare function SectionHeader(p: SectionHeaderProps): React.ReactElement;
export interface BannerProps { tone?: 'red' | 'mustard' | 'ink'; lead?: Node; actions?: Node; role?: string; children?: Node }
export declare function Banner(p: BannerProps): React.ReactElement;

// ---------- Status
export declare function StatusLabel(p: { status?: StatusKey; tone?: Tone; size?: 'sm'; children?: Node }): React.ReactElement;
export declare function RuntimeBadge(p: { state: RuntimeKey; title?: string; children?: Node }): React.ReactElement;
export declare function Stamp(p: { tone?: Tone; size?: 'lg' | 'sm'; status?: StatusKey; children?: Node }): React.ReactElement;
export interface LiveIndicatorProps { state?: 'live' | 'stale' | 'reconnecting' | 'offline'; time?: string; compact?: boolean; children?: Node }
export declare function LiveIndicator(p: LiveIndicatorProps): React.ReactElement;
export declare function ProjectTag(p: { children: Node }): React.ReactElement;
export declare function BackendTag(p: { backend: Backend }): React.ReactElement;
export declare function TypeTag(p: { type: 'ship' | 'scout' }): React.ReactElement;
export declare function CountBadge(p: { tone?: 'red' | 'mustard'; label?: string; children: Node }): React.ReactElement;

// ---------- Controls
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'flat' | 'ghost'; size?: 'sm'; kbd?: string }
export declare function Button(p: ButtonProps): React.ReactElement;
/** text = what the user says to the Foreman session; cli = the equivalent command. The dashboard never runs either. */
export interface CopyCommandProps { label?: string; text?: string; cli?: string; quiet?: boolean; onCopied?: (value: string, failed?: boolean) => void }
export declare function CopyCommand(p: CopyCommandProps): React.ReactElement;
export interface Option { value: string; label: Node; count?: number }
export declare function FilterChips(p: { label?: string; value: string | string[]; options: Option[]; onChange?: (v: any) => void; multi?: boolean }): React.ReactElement;
export declare function SearchField(p: { value: string; onChange?: (v: string) => void; placeholder?: string; label?: string; inputRef?: React.Ref<HTMLInputElement>; onKeyDown?: React.KeyboardEventHandler }): React.ReactElement;
export declare function SelectField(p: { label: string; value: string; options: { value: string; label: string }[]; onChange?: (v: string) => void }): React.ReactElement;
export declare function Toggle(p: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; children?: Node }): React.ReactElement;
export declare function Segmented(p: { label: string; value: string; options: { value: string; label: Node }[]; onChange?: (v: string) => void }): React.ReactElement;
export declare function Tabs(p: { tabs: { id: string; label: Node; count?: number; tone?: 'red' }[]; value: string; onChange: (id: string) => void; label?: string }): React.ReactElement;
export interface ToastItem { id: string | number; text: Node; tone?: 'red'; action?: { label: string; run: () => void } }
export declare function Toasts(p: { items: ToastItem[]; onDismiss: (id: ToastItem['id']) => void }): React.ReactElement;

// ---------- Board
export interface Counter { id: string; label: string; tone: Tone; value: number; sub?: Node; hot?: boolean }
export declare function CounterBar(p: { items: Counter[]; value: string | null; onChange?: (id: string | null) => void; label?: string }): React.ReactElement;
export interface WorkerSlotProps { id: string; title: string; profile: string; backend: Backend; runtime: RuntimeKey; quiet: string; quietRatio?: number; quietWarn?: boolean; held?: boolean; tone?: 'mustard' | 'red' | null; selected?: boolean; onSelect?: () => void; badge?: Node; isNew?: boolean }
export declare function WorkerSlot(p: WorkerSlotProps): React.ReactElement;
export declare function HeldChip(p: { id: string; status: StatusKey; wait: string; urgent?: boolean; selected?: boolean; onSelect?: () => void; isNew?: boolean }): React.ReactElement;
export declare function LaneGroup(p: { label: string; count?: number; compact?: boolean; children?: Node }): React.ReactElement;
export interface FleetRow { id: string; type: 'ship' | 'scout'; isNew?: boolean; flash?: boolean; title: string; line?: Node; project: string; profile?: string | null; backend?: Backend; runtime?: RuntimeKey; round?: number; generation?: number; age?: { text: string; tone?: 'you' | 'warn' | ''; sub?: string }; points?: { open: number; user?: number }; status: StatusKey }
export interface FleetGroup { key: string; label: string; tone: Tone; hint?: string; rows: FleetRow[] }
export interface FleetTableProps { groups: FleetGroup[]; selected?: string; onSelect: (id: string) => void; onOpen?: (id: string) => void; dense?: boolean; layout?: 'table' | 'cards'; collapsed?: Record<string, boolean>; onToggle?: (key: string) => void; caption?: string; emptyText?: string }
export declare function FleetTable(p: FleetTableProps): React.ReactElement;
export declare function Pane(p: { head?: Node; foot?: Node; label?: string; className?: string; children?: Node }): React.ReactElement;
export declare function Section(p: { title: Node; end?: Node; children?: Node }): React.ReactElement;
export declare function NextBox(p: { tone?: Tone; title: Node; why?: Node; copy?: CopyCommandProps | null; children?: Node }): React.ReactElement;

// ---------- Task content
export interface ReportView { status: 'done' | 'blocked' | 'progress'; when: string; summary: Node; steps?: Node[]; file?: string }
export declare function Report(p: ReportView): React.ReactElement;
export interface RoundView { round: number; when: string; mode?: 'ship' | 'scout'; generation?: number; original?: string | null; sent?: string | null; reports?: ReportView[] }
export declare function RoundList(p: { rounds: RoundView[]; now?: number }): React.ReactElement;
export interface Point { id: string; owner: 'user' | 'worker'; kind: 'decision' | 'obligation' | 'check'; text: string; state: 'open' | 'snoozed' | 'answered' | 'verified' | 'dropped' | 'limit-accepted'; since?: number | string; until?: number | string; round?: number; closedHow?: string }
export declare function PointList(p: { points: Point[]; kinds?: Record<string, string>; now?: number }): React.ReactElement;
export declare function DecisionOptions(p: { options: { key: string; title: Node; impact?: Node }[]; recommendation?: string; renderAction?: (o: { key: string }) => Node }): React.ReactElement;
export declare function KeyValue(p: { items: ([Node, Node] | [Node, Node, boolean] | null)[]; mono?: boolean }): React.ReactElement;
export declare function Card(p: { title?: Node; end?: Node; flat?: boolean; dashed?: boolean; className?: string; children?: Node }): React.ReactElement;
export declare function Panel(p: { title?: Node; note?: Node; children?: Node }): React.ReactElement;
export declare function Quote(p: { source?: Node; solid?: boolean; children?: Node }): React.ReactElement;
export declare function Callout(p: { variant?: 'warn' | 'note' | 'danger'; lead?: Node; children?: Node }): React.ReactElement;
export interface InboxItem { key: string; id: string; question: Node; age: string; urgent?: boolean; overdue?: boolean; isNew?: boolean; status: StatusKey; project: string }
export declare function InboxList(p: { groups: { key: string; label: string; items: InboxItem[] }[]; current?: string; onPick: (key: string) => void; label?: string }): React.ReactElement;
export declare function Compose(p: { prefix: string; placeholder?: string; onCopied?: (text: string) => void }): React.ReactElement;

// ---------- History & system
export interface FleetEvent { key: string | number; at: number; day: string; type: EventType; taskId: string; text: Node; meta?: Node }
export declare function EventLog(p: { events: FleetEvent[]; onOpen?: (taskId: string) => void; groupByDay?: boolean; label?: string }): React.ReactElement;
export interface GanttRow { id: string; segs: { from: number; to: number; kind: 'run' | 'idle' | 'you' | 'review' | 'warn' | 'queue'; label: string }[] }
export declare function ShiftGantt(p: { rows: GanttRow[]; from: number; to: number; now?: number; onOpen?: (id: string) => void; label?: string }): React.ReactElement;
export declare function CheckList(p: { items: { state: 'ok' | 'warn' | 'bad' | 'off'; name: Node; desc: Node; value?: Node }[]; label?: string }): React.ReactElement;

// ---------- Numbers
export declare function KpiStrip(p: { items: { label: string; value: string | null; unit?: string; sub?: Node; tone?: 'red' | 'mustard' }[]; label?: string }): React.ReactElement;
export declare function StatBlock(p: { label?: string; value: string | null; unit?: string; sub?: Node }): React.ReactElement;
export declare function Meter(p: { value: number; low?: boolean; label?: string }): React.ReactElement;
export declare function BarList(p: { title?: string; rows: { label: string; value: number; display?: string; tone?: 'red' }[]; max?: number }): React.ReactElement;
export declare function DailyBars(p: { data: { label: string; value: number }[]; max?: number; unit?: string; ariaLabel: string; seriesLabel?: string }): React.ReactElement;
export declare function HitLine(p: { data: { label: string; short?: string; value: number }[]; min?: number; max?: number; threshold?: number; ariaLabel: string; seriesLabel?: string; height?: number }): React.ReactElement;

// ---------- Overlays & states
export declare function StateNotice(p: { state: 'loading' | 'empty' | 'unconfigured' | 'missing-home' | 'error'; title?: Node; stamp?: string; actions?: Node; small?: boolean; children?: Node }): React.ReactElement;
export declare function Skeleton(p: { lines?: number; block?: boolean }): React.ReactElement;
export declare function Dialog(p: { title: Node; onClose: () => void; label?: string; children?: Node }): React.ReactElement;
export declare function Drawer(p: { onClose: () => void; label?: string; children?: Node }): React.ReactElement;
export declare function CommandPalette(p: { items: { key: string; group: string; kicker: Node; title: string; sub?: string; run: () => void }[]; onClose: () => void; placeholder?: string }): React.ReactElement;
export declare function KeyHelp(p: { groups: { title: string; keys: [string, string][] }[] }): React.ReactElement;

declare global {
  interface Window {
    /** Components above plus the shared vocabulary and helpers. */
    Foreman: typeof import('./index') & {
      STATUS: Record<StatusKey, { label: string; tone: Tone; group: 'you' | 'run' | 'queue' }>;
      STATUS_ORDER: StatusKey[];
      RUNTIME: Record<RuntimeKey, { label: string; tone: Tone; pulse?: boolean }>;
      ISSUE: Record<string, { label: string; tone: Tone; explain: string }>;
      issueOf(type: string): { label: string; tone: Tone; explain: string };
      EVENT: Record<EventType, { label: string; tone: Tone }>;
      POINT_KIND: Record<'decision' | 'obligation' | 'check', string>;
      dur(ms: number): string; durShort(ms: number): string; ago(ts: number, now: number): string;
      clock(ts: number): string; clockSec(ts: number): string; dateLabel(ts: number): string; dayLabel(ts: number, now: number): string;
      copyText(text: string): Promise<string>; cx(...c: unknown[]): string;
    };
  }
}
