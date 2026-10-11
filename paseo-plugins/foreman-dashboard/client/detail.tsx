import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { TaskSummary } from "../shared/foreman";
import { STAMP_LABEL, agentProfile, taskAgentText, taskNumber, taskStamp } from "../shared/status";
import { useAgentView } from "./data";
import { stampColor } from "./theme";

type Theme = PluginHostProps["theme"];

function Chip({ theme, label, value, strong }: { theme: Theme; label: string; value: string; strong?: boolean }) {
  const c = theme.colors;
  return (
    <View style={{ gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface1 }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</Text>
      <Text selectable style={{ color: c.foreground, fontSize: 14, fontWeight: strong ? "700" : "500" }}>{value}</Text>
    </View>
  );
}

// One request of the user: round one is the original ask, later rounds are follow-ups.
function Request({ theme, round, text }: { theme: Theme; round: number; text: string }) {
  const c = theme.colors;
  return (
    <View style={{ gap: 6, paddingLeft: 14, borderLeftWidth: 3, borderLeftColor: round === 1 ? c.foreground : c.border }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}>{round === 1 ? "Yêu cầu ban đầu" : `Cập nhật · vòng ${round}`}</Text>
      <Text selectable style={{ color: c.foreground, fontSize: 15, lineHeight: 22 }}>{text}</Text>
    </View>
  );
}

// Click-to-open detail of one task: status and owner at the top, then the user's wording of every round.
export function TaskDetail({ task, theme, onClose }: { task: TaskSummary; theme: Theme; onClose(): void }) {
  const c = theme.colors;
  const agent = useAgentView(task);
  const stamp = taskStamp(task);
  const color = stampColor(theme, stamp);
  const profile = agentProfile(task, agent) ?? taskAgentText(task).text;
  const requests = [{ round: 1, text: task.brief.trim() }, ...task.rounds.map((item) => ({ round: item.round, text: item.text.trim() }))];
  return (
    <Modal title={`T-${taskNumber(task.taskId)}`} open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderWidth: 2, borderColor: color, borderRadius: 6 }}>
            <Text style={{ color, fontSize: 15, fontWeight: "800" }}>{STAMP_LABEL[stamp]}</Text>
          </View>
          {task.round > 1 ? <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>vòng {task.round}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Chip theme={theme} label="Project" value={task.projectId} strong />
          <Chip theme={theme} label="Loại" value={task.type} />
          <Chip theme={theme} label="Agent profile" value={`${profile}${task.backend === "herdr" ? " (Herdr)" : ""}`} />
        </View>
        <View style={{ height: 1, backgroundColor: c.border }} />
        <View style={{ gap: 18 }}>
          {requests.map((item) => <Request key={item.round} theme={theme} round={item.round} text={item.text} />)}
        </View>
      </Modal.Content>
    </Modal>
  );
}
