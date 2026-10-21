import { openExternalUrl, useRpc, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { openDashboardRpc, stopDashboardRpc } from "../shared/foreman";

// One press starts the read-only dashboard on the daemon machine when needed and opens it in the browser;
// the "Tắt" button beside it stops the process the plugin started.
export function ForemanButton({ theme }: PluginSidebarItemProps) {
  const openDashboard = useRpc(openDashboardRpc);
  const stopDashboard = useRpc(stopDashboardRpc);
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const run = async (action: () => Promise<string | null>) => {
    if (state.busy) return;
    setState({ busy: true, note: null });
    try {
      setState({ busy: false, note: await action() });
    } catch (error) {
      setState({ busy: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const open = () => run(async () => { await openExternalUrl((await openDashboard({})).url); return null; });
  const stop = () => run(async () => ((await stopDashboard({})).stopped ? "đã tắt" : "không có dashboard do plugin chạy"));
  const label = state.busy ? "Foreman — đang xử lý…" : state.note ? `Foreman — ${state.note}` : "Foreman dashboard";
  return (
    <SidebarRow
      icon="LayoutDashboard"
      label={label}
      onPress={() => { void open(); }}
      trailing={
        <Pressable accessibilityRole="button" accessibilityLabel="Tắt Foreman dashboard" onPress={() => { void stop(); }} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Tắt</Text>
        </Pressable>
      }
    />
  );
}
