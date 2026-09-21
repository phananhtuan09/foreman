#!/usr/bin/env bash

set -u

usage() {
  printf '%s\n' "Usage: observe.sh start|run|scan|status <repo-root> <foreman-agent>"
}

if [ "$#" -ne 3 ]; then
  usage >&2
  exit 2
fi

command_name=$1
repo_root=$(cd "$2" && pwd -P)
foreman_agent=${3#@}
foreman_dir="$repo_root/.foreman"
backlog_path="$foreman_dir/backlog.md"
events_dir="$foreman_dir/events"
inbox_dir="$foreman_dir/inbox"
runtime_dir="$foreman_dir/runtime"
lock_dir="$runtime_dir/observer.lock"
pid_path="$runtime_dir/observer.pid"
wake_path="$runtime_dir/wake-sent"
foreman_target_path="$runtime_dir/foreman-agent"
interval_seconds=${FOREMAN_OBSERVER_INTERVAL_SECONDS:-2}

mkdir -p "$events_dir" "$inbox_dir" "$runtime_dir"

sanitize() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

checksum() {
  cksum | awk '{print $1}'
}

json_field() {
  local field=$1
  sed -n "s/.*\"$field\":\"\([^\"]*\)\".*/\1/p"
}

json_number() {
  local field=$1
  sed -n "s/.*\"$field\":\([0-9][0-9]*\).*/\1/p"
}

emit_event() {
  local task=$1
  local agent=$2
  local event=$3
  local evidence=$4
  local fingerprint=$5
  local safe_agent
  local event_path
  local temporary_path

  safe_agent=$(sanitize "$agent")
  event_path="$events_dir/${task}--${safe_agent}--${event}--${fingerprint}.md"
  [ -e "$event_path" ] && return 0

  temporary_path="$event_path.tmp.$$"
  {
    printf 'TASK: %s\n' "$task"
    printf 'AGENT: @%s\n' "$agent"
    printf 'EVENT: %s\n' "$event"
    printf 'OBSERVED: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'EVIDENCE: %s\n' "$evidence"
  } > "$temporary_path"
  mv "$temporary_path" "$event_path"
}

first_event() {
  local event_path
  for event_path in "$events_dir"/*.md; do
    [ -e "$event_path" ] || continue
    printf '%s\n' "$event_path"
    return 0
  done
}

event_fingerprint() {
  local event_path
  for event_path in "$events_dir"/*.md; do
    [ -e "$event_path" ] || continue
    printf '%s\n' "${event_path##*/}"
  done | LC_ALL=C sort | checksum
}

wake_foreman_if_needed() {
  local queued
  local fingerprint
  local sent_fingerprint
  local foreman_json
  local foreman_status
  local foreman_cwd

  queued=$(first_event)
  if [ -z "$queued" ]; then
    rm -f "$wake_path"
    return 0
  fi

  fingerprint=$(event_fingerprint)
  sent_fingerprint=
  [ -f "$wake_path" ] && sent_fingerprint=$(sed -n '1p' "$wake_path")
  [ "$fingerprint" = "$sent_fingerprint" ] && return 0

  if ! foreman_json=$(herdr agent get "$foreman_agent" 2>/dev/null); then
    return 0
  fi
  foreman_status=$(printf '%s' "$foreman_json" | json_field agent_status)
  foreman_cwd=$(printf '%s' "$foreman_json" | json_field cwd)
  case "$foreman_cwd/" in
    "$repo_root/"*) ;;
    *) return 0 ;;
  esac
  case "$foreman_status" in
    idle|done)
      if herdr agent prompt "$foreman_agent" \
        "FOREMAN_WAKE: reconcile queued events in .foreman/events/ for the current repository." \
        >/dev/null 2>&1; then
        printf '%s\n' "$fingerprint" > "$wake_path"
      fi
      ;;
  esac
}

scan_once() {
  local line
  local task
  local agent
  local assignment_fingerprint
  local inbox_path
  local agent_json
  local agent_status
  local agent_cwd
  local state_sequence

  ACTIVE_ASSIGNMENTS=0
  [ -f "$backlog_path" ] || {
    wake_foreman_if_needed
    return 0
  }
  if ! herdr agent list >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r line; do
    task=$(printf '%s\n' "$line" | sed -nE 's/^- \[~\] ((T|B)-[0-9]+).*/\1/p')
    agent=$(printf '%s\n' "$line" | sed -nE 's/.* @([^ ]+) · .*/\1/p')
    [ -n "$task" ] && [ -n "$agent" ] || continue

    ACTIVE_ASSIGNMENTS=$((ACTIVE_ASSIGNMENTS + 1))
    assignment_fingerprint=$(printf '%s' "$line" | checksum)
    inbox_path="$inbox_dir/${task}--${agent}.md"
    if [ -f "$inbox_path" ]; then
      emit_event "$task" "$agent" inbox-ready \
        "worker report exists at .foreman/inbox/${task}--${agent}.md" \
        "$assignment_fingerprint"
    fi

    if ! agent_json=$(herdr agent get "$agent" 2>/dev/null); then
      emit_event "$task" "$agent" agent-missing \
        "assigned agent is absent from the Herdr runtime" \
        "$assignment_fingerprint"
      continue
    fi

    agent_status=$(printf '%s' "$agent_json" | json_field agent_status)
    agent_cwd=$(printf '%s' "$agent_json" | json_field cwd)
    case "$agent_cwd/" in
      "$repo_root/"*) ;;
      *)
        emit_event "$task" "$agent" agent-outside-repo \
          "assigned agent cwd is outside the managed repository" \
          "$assignment_fingerprint"
        continue
        ;;
    esac
    state_sequence=$(printf '%s' "$agent_json" | json_number state_change_seq)
    [ -n "$state_sequence" ] || state_sequence=$assignment_fingerprint

    case "$agent_status" in
      working)
        ;;
      blocked|done|idle|unknown)
        emit_event "$task" "$agent" "runtime-$agent_status" \
          "Herdr reports agent_status=$agent_status" \
          "$state_sequence"
        ;;
      *)
        emit_event "$task" "$agent" runtime-unclassified \
          "Herdr returned no recognized agent status" \
          "$state_sequence"
        ;;
    esac
  done < <(sed -n '/^- \[~\] /p' "$backlog_path")

  wake_foreman_if_needed
}

run_loop() {
  local empty_cycles=0
  local queued

  if ! mkdir "$lock_dir" 2>/dev/null; then
    exit 0
  fi
  trap 'rm -f "$pid_path"; rmdir "$lock_dir" 2>/dev/null || true' EXIT INT TERM
  printf '%s\n' "$$" > "$pid_path"

  while :; do
    scan_once
    queued=$(first_event)
    if [ "$ACTIVE_ASSIGNMENTS" -eq 0 ] && [ -z "$queued" ]; then
      empty_cycles=$((empty_cycles + 1))
      [ "$empty_cycles" -ge 2 ] && exit 0
    else
      empty_cycles=0
    fi
    sleep "$interval_seconds"
  done
}

start_observer() {
  local existing_pid=
  if [ -f "$pid_path" ]; then
    existing_pid=$(sed -n '1p' "$pid_path")
  fi
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    exit 0
  fi
  if [ -d "$lock_dir" ]; then
    rmdir "$lock_dir" 2>/dev/null || exit 0
  fi
  rm -f "$pid_path"
  printf '%s\n' "$foreman_agent" > "$foreman_target_path"
  nohup bash "$0" run "$repo_root" "$foreman_agent" </dev/null >/dev/null 2>&1 &
}

observer_status() {
  local existing_pid=
  if [ -f "$pid_path" ]; then
    existing_pid=$(sed -n '1p' "$pid_path")
  fi
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    printf 'running pid=%s\n' "$existing_pid"
  else
    printf 'stopped\n'
  fi
}

case "$command_name" in
  start)
    start_observer
    ;;
  run)
    run_loop
    ;;
  scan)
    scan_once
    ;;
  status)
    observer_status
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
