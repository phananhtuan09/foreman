import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TaskSummary } from "../shared/foreman";
import { STAMP_LABEL, agentProfile, taskAgentText, taskNumber, taskStamp } from "../shared/status";
import { useAgentView } from "./data";
import { stampColor } from "./theme";

type Theme = PluginHostProps["theme"];
type Request = { round: number; text: string };

const MAX_DOTS = 8;

function Tag({ theme, label, strong }: { theme: Theme; label: string; strong?: boolean }) {
  const c = theme.colors;
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderWidth: 1, borderColor: c.border, borderRadius: 6, backgroundColor: c.surface1 }}>
      <Text style={{ color: strong ? c.foreground : c.foregroundMuted, fontSize: 12, fontWeight: strong ? "700" : "500" }}>{label}</Text>
    </View>
  );
}

function SectionLabel({ theme, children }: { theme: Theme; children: string }) {
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}>{children}</Text>;
}

// One dot per round; the current round is large and solid, past rounds are small and faded.
function RoundDots({ theme, rounds, current, color, onPick }: { theme: Theme; rounds: number[]; current: number; color: string; onPick(round: number): void }) {
  const c = theme.colors;
  const shown = rounds.length > MAX_DOTS ? [rounds[0], ...rounds.slice(-(MAX_DOTS - 1))] : rounds;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {shown.map((round, index) => {
        const isCurrent = round === current;
        const size = isCurrent ? 14 : 8;
        return (
          <View key={round} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {index === 1 && rounds.length > MAX_DOTS ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>…</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Vòng ${round}`} onPress={() => onPick(round)} hitSlop={6}>
              <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: isCurrent ? color : c.border }} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// The current request is the one heavy block of the modal.
function CurrentCard({ theme, color, item, isOnly }: { theme: Theme; color: string; item: Request; isOnly: boolean }) {
  const c = theme.colors;
  return (
    <View style={{ gap: 10, padding: 16, paddingLeft: 18, borderWidth: 1, borderStyle: "dashed", borderColor: c.border, borderLeftWidth: 4, borderLeftColor: color, borderRadius: 10, backgroundColor: c.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <SectionLabel theme={theme}>{isOnly ? "Yêu cầu" : "Yêu cầu hiện tại"}</SectionLabel>
        {isOnly ? null : (
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: color }}>
            <Text style={{ color, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 }}>{`VÒNG ${item.round}`}</Text>
          </View>
        )}
      </View>
      <Text selectable style={{ color: c.foreground, fontSize: 16, lineHeight: 24 }}>{item.text}</Text>
    </View>
  );
}

// A timeline node: a collapsed one-line summary that opens to the full wording.
function TimelineRow({ theme, item, label, original, open, last, onToggle }: { theme: Theme; item: Request; label: string; original?: boolean; open: boolean; last: boolean; onToggle(): void }) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 16, alignItems: "center" }}>
        <View style={{ marginTop: 9, width: original ? 12 : 9, height: original ? 12 : 9, borderRadius: 6, backgroundColor: original ? c.foreground : "transparent", borderWidth: 2, borderColor: original ? c.foreground : c.foregroundMuted }} />
        {last ? null : <View style={{ flex: 1, width: 2, marginTop: 2, backgroundColor: c.border }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 6 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <Text style={{ width: 64, color: original ? c.foreground : c.foregroundMuted, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{label}</Text>
          {open ? <View style={{ flex: 1 }} /> : <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 14 }}>{item.text}</Text>}
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{open ? "▾" : "▸"}</Text>
        </Pressable>
        {open ? (
          <View style={{ marginBottom: 6, padding: 12, borderRadius: 8, backgroundColor: c.surface1 }}>
            <Text selectable style={{ color: c.foreground, fontSize: 15, lineHeight: 22 }}>{item.text}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function TextButton({ theme, label, onPress }: { theme: Theme; label: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

// Click-to-open detail of one task: status and owner on top, the current request as the main card,
// then the earlier rounds collapsed on a timeline that ends at the original request.
export function TaskDetail({ task, theme, onClose }: { task: TaskSummary; theme: Theme; onClose(): void }) {
  const c = theme.colors;
  const agent = useAgentView(task);
  const stamp = taskStamp(task);
  const color = stampColor(theme, stamp);
  const profile = agentProfile(task, agent) ?? taskAgentText(task).text;
  const original: Request = { round: 1, text: task.brief.trim() };
  const later: Request[] = task.rounds.map((item) => ({ round: item.round, text: item.text.trim() }));
  const current = later.length > 0 ? later[later.length - 1] : original;
  const history = later.slice(0, -1).reverse();
  const hasHistory = history.length > 0;
  const hasOriginalRow = later.length > 0;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = (round: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(round)) next.add(round);
    return next;
  });
  const rows: Array<{ item: Request; label: string; original?: boolean }> = [
    ...history.map((item) => ({ item, label: `Vòng ${item.round}` })),
    ...(hasOriginalRow ? [{ item: original, label: "Ban đầu", original: true }] : []),
  ];
  const allOpen = rows.length > 0 && rows.every((row) => expanded.has(row.item.round));
  const roundNumbers = [1, ...later.map((item) => item.round)];
  const metaTags = [task.projectId, task.type, `${profile}${task.backend === "herdr" ? " (Herdr)" : ""}`];
  return (
    <Modal title={`T-${taskNumber(task.taskId)}`} open onOpenChange={(open) => { if (!open) onClose(); }}>
      <View style={{ height: 4, backgroundColor: color }} />
      <Modal.Content contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderWidth: 2, borderColor: color, borderRadius: 6 }}>
              <Text style={{ color, fontSize: 15, fontWeight: "800" }}>{STAMP_LABEL[stamp]}</Text>
            </View>
            {task.round > 1 ? <Text style={{ color: c.foregroundMuted, fontSize: 13, fontVariant: ["tabular-nums"] }}>vòng {task.round}</Text> : null}
          </View>
          {task.title ? <Text selectable style={{ color: c.foregroundMuted, fontSize: 14 }}>{task.title}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {metaTags.map((label, index) => <Tag key={`${index}-${label}`} theme={theme} label={label} strong={index === 0} />)}
          </View>
          {roundNumbers.length > 1 ? <RoundDots theme={theme} rounds={roundNumbers} current={current.round} color={color} onPick={toggle} /> : null}
        </View>
        <CurrentCard theme={theme} color={color} item={current} isOnly={later.length === 0} />
        {rows.length > 0 ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <SectionLabel theme={theme}>{hasHistory ? `Lịch sử các vòng (${history.length + 1})` : "Yêu cầu ban đầu"}</SectionLabel>
              <TextButton theme={theme} label={allOpen ? "Thu gọn tất cả" : "Mở tất cả"} onPress={() => setExpanded(allOpen ? new Set() : new Set(rows.map((row) => row.item.round)))} />
            </View>
            {rows.map((row, index) => (
              <TimelineRow key={row.item.round} theme={theme} item={row.item} label={row.label} original={row.original} open={expanded.has(row.item.round)} last={index === rows.length - 1} onToggle={() => toggle(row.item.round)} />
            ))}
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
