#!/usr/bin/env bash

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "[no jq] install jq to enable statusline"
  exit 0
fi

model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir // ""')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // ""')
limit_5h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // ""')
weekly_limit=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // ""')

# Normalize Windows backslashes to forward slashes
current_dir="${current_dir//\\//}"

if [ -n "$current_dir" ]; then
  folder=$(basename "$current_dir")
else
  folder=$(basename "$PWD")
fi

branch=""
if [ -n "$current_dir" ] && ([ -d "$current_dir/.git" ] || git -C "$current_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  branch=$(git -C "$current_dir" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
fi

# Row 1: branch | folder | model
row1_parts=()
[ -n "$branch" ] && row1_parts+=("🌿 $branch")
row1_parts+=("📁 $folder")
row1_parts+=("🤖 $model")

row1=$(IFS=" | "; echo "${row1_parts[*]}")

# Row 2: context % | 5h limit | weekly limit
row2_parts=()

if [ -n "$used_pct" ]; then
  printf_pct=$(printf "%.0f" "$used_pct" 2>/dev/null || echo "$used_pct")
  row2_parts+=("📊 ctx ${printf_pct}%")
fi

if [ -n "$limit_5h" ]; then
  printf_5h=$(printf "%.0f" "$limit_5h" 2>/dev/null || echo "$limit_5h")
  row2_parts+=("⏱ 5h: ${printf_5h}%")
fi
if [ -n "$weekly_limit" ]; then
  printf_7d=$(printf "%.0f" "$weekly_limit" 2>/dev/null || echo "$weekly_limit")
  row2_parts+=("📅 7d: ${printf_7d}%")
fi

echo "$row1"
if [ ${#row2_parts[@]} -gt 0 ]; then
  row2=$(IFS=" | "; echo "${row2_parts[*]}")
  echo "$row2"
fi
