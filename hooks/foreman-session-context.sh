#!/bin/sh
# UserPromptSubmit hook for the Foreman session. On each prompt it adds unread worker
# reports and the anomalies of one non-interrupting runtime check to the session context,
# as {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":...}}.
# It prints nothing for a prompt starting with DEV, when nothing is new, or when the
# session's cwd is outside this Foreman checkout, so a global install is safe.
# The runtime check runs only when HERDR_ENV=1.
#
# Claude Code: already configured for this repository in .claude/settings.json; approve the
# project's hooks when Claude Code asks. Nothing else to install.
#
# Codex (0.156+, needs `hooks = true` under [features] in ~/.codex/config.toml): add a
# "UserPromptSubmit" entry to ~/.codex/hooks.json next to the existing events:
#   {
#     "hooks": {
#       "UserPromptSubmit": [
#         { "hooks": [{ "type": "command", "command": "sh '/abs/path/to/foreman/hooks/foreman-session-context.sh'", "timeout": 30 }] }
#       ]
#     }
#   }
#   Then open Codex once and approve the new hook; Codex stores its trusted hash under
#   [hooks.state] in config.toml.
#
# FOREMAN_ROOT and FOREMAN_HOME default to this checkout when the shell does not set them.
#
# Check: from the Foreman checkout, `echo '{"prompt":"status","cwd":"'"$PWD"'"}' | hooks/foreman-session-context.sh`
# prints the JSON context, or nothing when there is nothing new.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export FOREMAN_ROOT="${FOREMAN_ROOT:-$root}"
export FOREMAN_HOME="${FOREMAN_HOME:-$FOREMAN_ROOT}"
exec "$root/bin/foreman" session context
