import { openExternalUrl, useRpc, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { openDashboardRpc } from "../shared/foreman";

// One press starts the read-only dashboard on the daemon machine when needed and opens it in the browser.
export function ForemanButton(_props: PluginSidebarItemProps) {
  const openDashboard = useRpc(openDashboardRpc);
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const press = async () => {
    if (state.busy) return;
    setState({ busy: true, error: null });
    try {
      const { url } = await openDashboard({});
      await openExternalUrl(url);
      setState({ busy: false, error: null });
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  return <SidebarRow icon="LayoutDashboard" label={state.busy ? "Foreman — đang mở…" : state.error ? `Foreman — ${state.error}` : "Foreman dashboard"} onPress={() => { void press(); }} />;
}
