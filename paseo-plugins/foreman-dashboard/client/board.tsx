import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { Snapshot, TaskSummary } from "../shared/foreman";
import {
  STAMP_LABEL, WORKER_STATUS_LABEL, agentProfile, herdrStatusLabel, orderTasks, runningWorkers, taskAgentText, taskNumber, taskStamp, workerStatus,
  type WorkerStatus,
} from "../shared/status";
import { TaskDetail } from "./detail";
import { useAgentView } from "./data";
import { NEEDS_FILL, ON_NEEDS_FILL, lampColor, onColor, stampColor } from "./theme";

type Props = Pick<PluginHostProps, "theme" | "layout">;
const NUMERAL: TextStyle = { fontWeight: "800", fontVariant: ["tabular-nums"] };

export function useWorkerLook(task: TaskSummary, theme: Props["theme"]) {
  const agent = useAgentView(task);
  const status = workerStatus(task, agent);
  return { status, agent, lamp: lampColor(theme, status) };
}

function Lamp({ color, hollow, ring }: { color: string; hollow?: boolean; ring?: boolean }) {
  const base: ViewStyle = { width: 10, height: 10, borderRadius: 5 };
  if (ring) return <View style={{ ...base, borderWidth: 3, borderColor: color }} />;
  if (hollow) return <View style={{ ...base, borderWidth: 2, borderColor: color }} />;
  return <View style={{ ...base, backgroundColor: color }} />;
}

// One worker agent, hung on the rail. Each status has its own treatment built from borders, fills and opacity.
export function WorkerTag({ task, theme, layout }: Props & { task: TaskSummary }) {
  const c = theme.colors;
  const { status, agent, lamp } = useWorkerLook(task, theme);
  const box: ViewStyle = { width: layout.compact ? "47%" : 158, flexGrow: layout.compact ? 1 : 0, padding: 12, paddingTop: 10, borderWidth: 2, borderColor: c.foreground, borderRadius: 6, backgroundColor: c.surface1 };
  let numberColor = c.foreground;
  let textColor = c.foregroundMuted;
  let faded = false;
  let italic = false;
  let hollow = false;
  let ring = false;
  switch (status) {
    case "blocked": case "decide":
      Object.assign(box, { backgroundColor: NEEDS_FILL, borderColor: ON_NEEDS_FILL });
      if (status === "blocked") Object.assign(box, { borderBottomWidth: 8, borderBottomColor: c.statusDanger });
      numberColor = ON_NEEDS_FILL; textColor = ON_NEEDS_FILL; break;
    case "review": {
      const on = onColor(c.statusSuccess);
      Object.assign(box, { backgroundColor: c.statusSuccess, borderColor: c.statusSuccess });
      numberColor = on; textColor = on; break;
    }
    case "input": Object.assign(box, { borderWidth: 3, borderColor: c.statusWarning }); textColor = c.foreground; ring = true; break;
    case "error": Object.assign(box, { borderColor: c.statusDanger, borderLeftWidth: 8 }); numberColor = c.statusDanger; textColor = c.statusDanger; break;
    case "working": Object.assign(box, { borderTopWidth: 7, borderTopColor: c.accent }); textColor = c.accent; break;
    case "idle": Object.assign(box, { borderStyle: "dashed", borderColor: c.foregroundMuted, backgroundColor: "transparent" }); faded = true; hollow = true; break;
    case "herdr": Object.assign(box, { backgroundColor: "transparent" }); italic = true; hollow = true; break;
  }
  const lampColorFinal = status === "review" ? onColor(c.statusSuccess) : status === "blocked" ? c.statusDanger : status === "decide" ? c.statusWarning : lamp;
  const label = status === "herdr" ? herdrStatusLabel(task) : WORKER_STATUS_LABEL[status as Exclude<WorkerStatus, "herdr">];
  const profile = agentProfile(task, agent);
  return (
    <View style={box} accessibilityLabel={`${task.taskId} ${label}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", opacity: faded ? 0.55 : 1 }}>
        <Text style={{ color: status === "review" || status === "blocked" || status === "decide" ? textColor : c.foregroundMuted, fontSize: 15, fontWeight: "600", marginRight: 2 }}>T</Text>
        <Text style={{ ...NUMERAL, color: numberColor, fontSize: 48, lineHeight: 50 }}>{taskNumber(task.taskId)}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: numberColor, fontWeight: "600", fontSize: 13, marginTop: 6, opacity: faded ? 0.55 : 1 }}>{profile ?? "—"}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: status === "review" ? textColor : c.border }}>
        <Lamp color={lampColorFinal} hollow={hollow} ring={ring} />
        <Text style={{ flex: 1, color: textColor, fontSize: 12, fontWeight: italic || faded ? "400" : "600", fontStyle: italic ? "italic" : "normal" }}>{label}</Text>
      </View>
    </View>
  );
}

export function Section({ title, count, theme, children }: Props & { title: string; count: number; children: ReactNode }) {
  return (
    <View style={{ marginTop: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{title}</Text>
        <Text style={{ ...NUMERAL, color: theme.colors.foregroundMuted, fontSize: 22 }}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function TaskRow({ task, theme, layout, onOpen }: Props & { task: TaskSummary; onOpen(task: TaskSummary): void }) {
  const c = theme.colors;
  const stamp = taskStamp(task);
  const color = stampColor(theme, stamp);
  const agent = taskAgentText(task);
  const quiet = stamp === "working" || stamp === "routing" || stamp === "waiting";
  return (
    <Pressable onPress={() => onOpen(task)} accessibilityRole="button" accessibilityLabel={`Chi tiết ${task.taskId}`} style={{ flexDirection: "row", alignItems: "center", gap: layout.compact ? 12 : 18, paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Text style={{ ...NUMERAL, width: layout.compact ? 44 : 64, textAlign: "right", color: c.foreground, fontSize: layout.compact ? 30 : 38 }}>{taskNumber(task.taskId)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={layout.compact ? 2 : 1} style={{ color: c.foreground, fontSize: 15, fontWeight: "500" }}>{task.title}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 4 }}>
          <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "700", borderWidth: 1.5, borderColor: c.foreground, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 1 }}>{task.projectId}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{task.type}{task.round > 1 ? `, vòng ${task.round}` : ""}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, ...(agent.assigned ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: c.foregroundMuted }) }} />
            <Text style={{ color: agent.assigned ? c.foreground : c.foregroundMuted, fontSize: 12, fontWeight: agent.assigned ? "600" : "400" }}>{agent.text}</Text>
          </View>
        </View>
      </View>
      <View style={{ minWidth: layout.compact ? 0 : 96, paddingHorizontal: 10, paddingVertical: 4, borderWidth: quiet ? 1.5 : 2.5, borderStyle: quiet ? "dashed" : "solid", borderColor: color, borderRadius: 4 }}>
        <Text style={{ ...NUMERAL, color, textAlign: "center", fontSize: layout.compact ? 14 : 16 }}>{STAMP_LABEL[stamp]}</Text>
      </View>
    </Pressable>
  );
}

function time(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function Board({ snapshot, error, theme, layout }: Props & { snapshot: Snapshot | null; error: string | null }) {
  const c = theme.colors;
  const [openTask, setOpenTask] = useState<TaskSummary | null>(null);
  const workers = snapshot?.state === "ready" ? runningWorkers(snapshot.tasks) : [];
  const tasks = snapshot?.state === "ready" ? orderTasks(snapshot.tasks) : [];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 32, maxWidth: 980 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, borderBottomWidth: 3, borderBottomColor: c.foreground, paddingBottom: 10 }}>
        <Text style={{ ...NUMERAL, color: c.foreground, fontSize: 34 }}>Foreman</Text>
        {snapshot ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Cập nhật lúc {time(snapshot.updatedAt)}</Text> : null}
      </View>
      {error ? <Text style={{ color: c.statusDanger, marginTop: 16 }}>Không lấy được dữ liệu từ plugin: {error}</Text> : null}
      {!snapshot && !error ? <Text style={{ color: c.foregroundMuted, marginTop: 16 }}>Đang tải…</Text> : null}
      {snapshot && snapshot.state !== "ready" ? <Text style={{ color: c.foregroundMuted, marginTop: 16 }}>{snapshot.message}</Text> : null}
      {snapshot?.state === "ready" ? (
        <>
          <Section title="Worker đang chạy" count={workers.length} theme={theme} layout={layout}>
            {workers.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, paddingTop: 10, borderTopWidth: 2, borderTopColor: c.border }}>
                {workers.map((task) => <WorkerTag key={task.taskId} task={task} theme={theme} layout={layout} />)}
              </View>
            ) : <Text style={{ color: c.foregroundMuted }}>Không có worker nào đang chạy.</Text>}
          </Section>
          <Section title="Task" count={tasks.length} theme={theme} layout={layout}>
            {tasks.length ? (
              <View style={{ borderTopWidth: 2, borderTopColor: c.foreground }}>
                {tasks.map((task) => <TaskRow key={task.taskId} task={task} theme={theme} layout={layout} onOpen={setOpenTask} />)}
              </View>
            ) : <Text style={{ color: c.foregroundMuted }}>Không có task nào đang mở.</Text>}
          </Section>
          {snapshot.skipped.length ? <Text style={{ color: c.statusWarning, marginTop: 16, fontSize: 12 }}>Bỏ qua {snapshot.skipped.length} task lỗi dữ liệu: {snapshot.skipped.map((item) => item.taskId).join(", ")}</Text> : null}
        </>
      ) : null}
      {openTask ? <TaskDetail task={snapshot?.tasks.find((item) => item.taskId === openTask.taskId) ?? openTask} theme={theme} onClose={() => setOpenTask(null)} /> : null}
    </ScrollView>
  );
}
