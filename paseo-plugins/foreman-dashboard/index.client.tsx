import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ForemanScreen } from "./client/screen";
import { ForemanSettings } from "./client/settings";
import { ForemanStrip, SCREEN_ID } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Foreman", Component: ForemanScreen }),
    client.addSidebarHeaderItem({ id: "foreman", title: "Foreman", Component: ForemanStrip }),
    client.addCommandCenterItem({ id: "open-foreman", title: "Mở Foreman", icon: "ClipboardList", context: "global", onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN_ID }) }),
    client.addSettingsScreen({ id: "foreman-settings", title: "Foreman", icon: "ClipboardList", Component: ForemanSettings }),
  ];
  return () => { for (const remove of removers) remove(); };
}
