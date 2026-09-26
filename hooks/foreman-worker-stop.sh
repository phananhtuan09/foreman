#!/bin/sh
# Stop hook for coding agents, safe to install globally.
# It stays silent unless this agent runs in the Herdr pane of a working Foreman task that
# has not reported since its last prompt; then it blocks the stop once and tells the agent
# how to report with "$FOREMAN_ROOT/bin/foreman" report.
#
# Prerequisite: run `bin/foreman init` in the Foreman checkout once, so new shells export
# FOREMAN_ROOT and FOREMAN_HOME. Agents started before that do not see them and are skipped.
#
# Install: use this script's absolute path, not "$FOREMAN_ROOT/...", so the hook command
# still resolves in shells where FOREMAN_ROOT is unset.
#
# Claude Code: add to ~/.claude/settings.json (merge with any existing "hooks" key):
#   {
#     "hooks": {
#       "Stop": [
#         { "hooks": [{ "type": "command", "command": "/abs/path/to/foreman/hooks/foreman-worker-stop.sh", "timeout": 30 }] }
#       ]
#     }
#   }
#
# Codex (0.156+, needs `hooks = true` under [features] in ~/.codex/config.toml): add a
# "Stop" entry to ~/.codex/hooks.json next to the existing events:
#   {
#     "hooks": {
#       "Stop": [
#         { "hooks": [{ "type": "command", "command": "sh '/abs/path/to/foreman/hooks/foreman-worker-stop.sh'", "timeout": 30 }] }
#       ]
#     }
#   }
#   Codex stores a trusted hash for each hook under [hooks.state] in config.toml; open Codex
#   once interactively after adding the hook and approve it, so Foreman-spawned workers do not
#   stop at an approval screen.
#
# OpenCode V2 (global plugin for Herdr workers): OpenCode does not load this shell file as a
# native Stop hook. Install the companion adapter in this checkout by merging its absolute path
# into the `plugins` array of ~/.config/opencode/opencode.jsonc (or opencode.json):
#   {
#     "$schema": "https://opencode.ai/config.json",
#     "plugins": ["/absolute/path/to/foreman/hooks/foreman-worker-stop.opencode.js"]
#   }
# Preserve existing config and plugin entries; use the absolute path to this checkout on each
# machine. Keep only one installation of plugin ID `foreman.worker-stop`: remove/disable an older
# copy (for example ~/.config/opencode/plugins/foreman-worker-stop.js) before adding this entry,
# and do not also copy this adapter into ~/.config/opencode/plugins/.
# Then run `bin/foreman init` in that checkout and start Herdr workers with
# `opencode --auto mini --standalone`. The pane-local server must inherit FOREMAN_ROOT, FOREMAN_HOME,
# and HERDR_PANE_ID; a shared OpenCode service can carry a different pane identity. The adapter
# gets FOREMAN_ROOT from the worker environment to find this script, listens for the root
# session's V2 `session.execution.succeeded` event, and injects the report reminder when this
# script says a working task has not reported. Check installation with `opencode plugin list`.
# This is a V2 event adapter, not a native OpenCode shell Stop hook; it does not infer task done
# or blocked status—those are recorded only by `foreman report --status done|blocked`.
#
# omp loads JavaScript extension files through --hook=<file>; this shell script is not an omp
# extension, so omp workers are not covered yet.
#
# Check: in a Herdr pane with no Foreman task, `echo '{}' | /abs/path/to/foreman-worker-stop.sh`
# prints nothing and exits 0.
[ -n "$FOREMAN_ROOT" ] && [ -n "$HERDR_PANE_ID" ] || exit 0
[ -x "$FOREMAN_ROOT/bin/foreman" ] || exit 0
exec "$FOREMAN_ROOT/bin/foreman" worker hook
