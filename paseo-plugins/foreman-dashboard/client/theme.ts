import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { StampKey, WorkerStatus } from "../shared/status";

type Theme = PluginHostProps["theme"];

// The single highlight for "needs you" has no theme token; it stays readable on light and dark surfaces.
export const NEEDS_FILL = "#f2c94c";
export const ON_NEEDS_FILL = "#18232c";

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return 0;
  const value = parseInt(match[1], 16);
  return (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
}

export function onColor(background: string): string {
  return luminance(background) > 0.55 ? ON_NEEDS_FILL : "#ffffff";
}

export function lampColor(theme: Theme, status: WorkerStatus): string {
  const c = theme.colors;
  switch (status) {
    case "blocked": return c.statusDanger;
    case "decide": return c.statusWarning;
    case "review": return c.statusSuccess;
    case "working": return c.accent;
    case "herdr": return c.accent;
    default: return c.foregroundMuted;
  }
}

export function stampColor(theme: Theme, stamp: StampKey): string {
  const c = theme.colors;
  switch (stamp) {
    case "blocked": return c.statusDanger;
    case "decide": case "choose-model": return c.statusWarning;
    case "review": return c.statusSuccess;
    case "working": return c.accent;
    default: return c.foregroundMuted;
  }
}
