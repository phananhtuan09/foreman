import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsGroup, SettingsInput, SettingsRow } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { foremanSettings } from "../shared/foreman";

export function ForemanSettings(_props: PluginSurfaceProps) {
  const state = useSettings(foremanSettings);
  const [root, setRoot] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  if (state.status === "loading") return <Text>Đang tải…</Text>;
  if (state.status !== "ready") return <Text>{state.error}</Text>;
  const values = state.values;
  return (
    <SettingsGroup title="Foreman">
      <SettingsCard>
        <SettingsInput label="foremanRoot" hint="Thư mục checkout của Foreman (có bin/foreman)." initialValue={values.foremanRoot} onChangeText={setRoot} placeholder="/đường/dẫn/foreman" />
        <SettingsInput label="foremanHome" hint="Để trống nếu trùng foremanRoot." initialValue={values.foremanHome} onChangeText={setHome} placeholder="(mặc định: foremanRoot)" />
        <SettingsAction label="Lưu" actionLabel="Lưu" disabled={state.saving} onPress={() => { void state.save({ foremanRoot: root ?? values.foremanRoot, foremanHome: home ?? values.foremanHome }, state.revision); }} error={state.saveError} />
      </SettingsCard>
    </SettingsGroup>
  );
}
