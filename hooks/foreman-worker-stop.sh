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
# omp loads JavaScript extension files through --hook=<file>; this shell script is not an omp
# extension, so omp workers are not covered yet.
#
# Check: in a Herdr pane with no Foreman task, `echo '{}' | /abs/path/to/foreman-worker-stop.sh`
# prints nothing and exits 0.
[ -n "$FOREMAN_ROOT" ] && [ -n "$HERDR_PANE_ID" ] || exit 0
[ -x "$FOREMAN_ROOT/bin/foreman" ] || exit 0
exec "$FOREMAN_ROOT/bin/foreman" worker hook
