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
    // Hide the "blocked by hook" notice of a quiet Foreman heartbeat, whichever item type the provider maps it to.
    client.addTimelineTransformer({ id: "quiet-heartbeat-message", query: { itemType: "assistant_message" }, transform: ({ item }) => isQuietForemanHeartbeat(item.text) ? { items: [] } : undefined }),
    client.addTimelineTransformer({ id: "quiet-heartbeat-notification", query: { itemType: "notification" }, transform: ({ item }) => isQuietForemanHeartbeat(item.message) ? { items: [] } : undefined }),
    client.addTimelineTransformer({ id: "quiet-heartbeat-error", query: { itemType: "error" }, transform: ({ item }) => isQuietForemanHeartbeat(item.message) ? { items: [] } : undefined }),
  ];
  return () => { for (const remove of removers) remove(); };
}
