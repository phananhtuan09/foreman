#!/bin/sh
# UserPromptSubmit hook for the Foreman session. On each prompt it adds unread worker
# reports and the anomalies of one non-interrupting runtime check to the session context,
# as {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":...}}.
# It prints nothing for a prompt starting with DEV, when nothing is new, or when the
# session's cwd is outside this Foreman checkout.
# The runtime check runs only when HERDR_ENV=1.
#
# Claude Code: already configured for this repository in .claude/settings.json; approve the
# project's hooks when Claude Code asks. Nothing else to install.
#
# Codex (0.156+): configured for this repository in .codex/hooks.json, with hooks enabled
# in .codex/config.toml. The project must be trusted; review and trust the hook in /hooks.
# Its command resolves this script from the Git root, including when Codex starts in a
# subdirectory.
#
# FOREMAN_ROOT and FOREMAN_HOME default to this checkout when the shell does not set them.
#
# Check: from the Foreman checkout, `echo '{"prompt":"status","cwd":"'"$PWD"'"}' | hooks/foreman-session-context.sh`
# prints the JSON context, or nothing when there is nothing new.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export FOREMAN_ROOT="${FOREMAN_ROOT:-$root}"
export FOREMAN_HOME="${FOREMAN_HOME:-$FOREMAN_ROOT}"
exec "$root/bin/foreman" session context
