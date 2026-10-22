import { openExternalUrl, type PluginClientContext } from "@getpaseo/plugin/client";
import { ForemanSettings } from "./client/settings";
import { ForemanButton } from "./client/sidebar";
import { openDashboardRpc, stopDashboardRpc } from "./shared/foreman";
import { isQuietForemanHeartbeat } from "./shared/heartbeat";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSidebarHeaderItem({ id: "foreman", title: "Foreman dashboard", Component: ForemanButton }),
    client.addCommandCenterItem({
      id: "open-foreman",
      title: "Mở Foreman dashboard",
      icon: "LayoutDashboard",
      context: "global",
      onSelect: async ({ rpc }) => { await openExternalUrl((await rpc(openDashboardRpc, {})).url); },
    }),
    client.addCommandCenterItem({
      id: "stop-foreman",
      title: "Tắt Foreman dashboard",
      icon: "Power",
      context: "global",
      onSelect: async ({ rpc }) => { await rpc(stopDashboardRpc, {}); },
    }),
    client.addSettingsScreen({ id: "foreman-settings", title: "Foreman", icon: "LayoutDashboard", Component: ForemanSettings }),
    // Claude Code's notice for a blocked quiet Foreman heartbeat reaches the timeline as an assistant message.
    client.addTimelineTransformer({ id: "quiet-heartbeat", query: { itemType: "assistant_message" }, transform: ({ item }) => isQuietForemanHeartbeat(item.text) ? { items: [] } : undefined }),
  ];
  return () => { for (const remove of removers) remove(); };
}
