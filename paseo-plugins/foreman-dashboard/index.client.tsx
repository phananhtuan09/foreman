import { openExternalUrl, type PluginClientContext } from "@getpaseo/plugin/client";
import { ForemanSettings } from "./client/settings";
import { ForemanButton } from "./client/sidebar";
import { openDashboardRpc } from "./shared/foreman";

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
    client.addSettingsScreen({ id: "foreman-settings", title: "Foreman", icon: "LayoutDashboard", Component: ForemanSettings }),
  ];
  return () => { for (const remove of removers) remove(); };
}
