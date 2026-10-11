import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import type { TaskSummary } from "../shared/foreman";
import { runningWorkers, taskNumber } from "../shared/status";
import { useSnapshot } from "./data";
import { useWorkerLook } from "./board";

export const SCREEN_ID = "foreman";

function Peg({ task, theme }: Pick<PluginSidebarItemProps, "theme"> & { task: TaskSummary }) {
  const { lamp } = useWorkerLook(task, theme);
  const c = theme.colors;
  return (
    <View style={{ width: 44, paddingTop: 4, paddingBottom: 4, borderWidth: 1.5, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.surface0, alignItems: "center" }}>
      <Text style={{ color: c.foreground, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{taskNumber(task.taskId)}</Text>
      <View style={{ height: 3, alignSelf: "stretch", marginTop: 4, marginHorizontal: 6, borderRadius: 2, backgroundColor: lamp }} />
    </View>
  );
}

// Compact always-visible strip: worker count and one peg per running worker; pressing it opens the board.
export function ForemanStrip({ theme, openScreen }: PluginSidebarItemProps) {
  const { snapshot } = useSnapshot(15_000);
  const c = theme.colors;
  const workers = snapshot?.state === "ready" ? runningWorkers(snapshot.tasks) : [];
  const caption = !snapshot ? "" : snapshot.state === "ready" ? `${workers.length} worker` : "chưa sẵn sàng";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Mở Foreman" onPress={() => openScreen({ screenId: SCREEN_ID })} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 6, paddingBottom: workers.length ? 8 : 0 }}>
        <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>Foreman</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{caption}</Text>
      </View>
      {workers.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 6 }}>
          {workers.map((task) => <Peg key={task.taskId} task={task} theme={theme} />)}
        </View>
      ) : null}
    </Pressable>
  );
}
