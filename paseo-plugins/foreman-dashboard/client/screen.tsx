import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Board } from "./board";
import { useSnapshot } from "./data";

export function ForemanScreen({ theme, layout }: PluginScreenProps) {
  const { snapshot, error } = useSnapshot(5_000);
  return <Board snapshot={snapshot} error={error} theme={theme} layout={layout} />;
}
