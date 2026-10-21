import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsGroup, SettingsInput, SettingsRow } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { foremanSettings } from "../shared/foreman";

// An unusable port keeps the saved one; the settings schema rejects anything outside 1024-65535.
function parsePort(input: string | null, saved: number): number {
  const value = Number(input);
  return input !== null && Number.isInteger(value) ? value : saved;
}

export function ForemanSettings(_props: PluginSurfaceProps) {
  const state = useSettings(foremanSettings);
  const [root, setRoot] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [port, setPort] = useState<string | null>(null);
  if (state.status === "loading") return <Text>Đang tải…</Text>;
  if (state.status !== "ready") return <Text>{state.error}</Text>;
  const values = state.values;
  return (
    <SettingsGroup title="Foreman">
      <SettingsCard>
        <SettingsInput label="foremanRoot" hint="Thư mục checkout của Foreman (có bin/foreman)." initialValue={values.foremanRoot} onChangeText={setRoot} placeholder="/đường/dẫn/foreman" />
        <SettingsInput label="foremanHome" hint="Để trống nếu trùng foremanRoot." initialValue={values.foremanHome} onChangeText={setHome} placeholder="(mặc định: foremanRoot)" />
        <SettingsInput label="port" hint="Cổng của dashboard trên 127.0.0.1 (mặc định 18789)." initialValue={String(values.port)} onChangeText={setPort} placeholder="18789" />
        <SettingsAction label="Lưu" actionLabel="Lưu" disabled={state.saving} onPress={() => { void state.save({ foremanRoot: root ?? values.foremanRoot, foremanHome: home ?? values.foremanHome, port: parsePort(port, values.port) }, state.revision); }} error={state.saveError} />
      </SettingsCard>
    </SettingsGroup>
  );
}
