# Foreman local runbook

## Setup

Run `bin/foreman init` from the Foreman checkout.
It records the checkout as `FOREMAN_ROOT` and `FOREMAN_HOME` (or `--home PATH`) in the startup file of your login shell, creates `data/`, and validates the routing config.
The startup file is `$ZDOTDIR/.zshrc` or `~/.zshrc` for zsh, `~/.bashrc` for bash (`~/.bash_profile` on macOS), `~/.config/fish/conf.d/foreman.fish` for fish, and `~/.profile` for `sh`, `dash`, `ksh`, or `mksh`.
Only the block between `# >>> foreman >>>` and `# <<< foreman <<<` is written; running `init` again from another checkout replaces that block.
For an unrecognized shell, `init` fails and prints the `export` lines to add yourself.
Shells and worker panes opened after `init` see the variables; restart older coding agents if they should report to Foreman.

## Hooks

Workers report through a stop hook that you install in each coding agent, globally if you like.
Point the agent's stop hook at the absolute path of `hooks/foreman-worker-stop.sh`.
For Claude Code, add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "/path/to/foreman/hooks/foreman-worker-stop.sh" }] }
    ]
  }
}
```

The script exits silently unless the agent runs in the Herdr pane of a working Foreman task that has not reported since its last prompt.
Then it blocks the stop once with instructions to run `"$FOREMAN_ROOT/bin/foreman" report`.
It speaks the stop-hook contract that Claude Code and Codex 0.156+ share (`stop_hook_active` in, `{"decision":"block","reason":...}` out).
The script's header comment has the exact Claude Code and Codex configuration; Codex also needs the new hook approved once in an interactive session.
omp uses JavaScript extensions through `--hook`, so omp workers are not covered yet.

The Foreman session's prompt hook is configured for Claude Code in `.claude/settings.json` and for Codex at project scope in `.codex/hooks.json`.
Codex hook support is enabled for this project in `.codex/config.toml`; the project must be trusted, and the hook must be reviewed in `/hooks` before it runs.
The hook runs `hooks/foreman-session-context.sh`, which adds unread worker reports and status anomalies to prompts that do not start with `DEV`.

## Commands

```sh
bin/foreman init
bin/foreman routing show
bin/foreman project register --id app --root /path/to/app
bin/foreman task create --project app --brief-file brief.md
bin/foreman task dispatch --task T-000001 --owner worker
bin/foreman task message --task T-000001 --text "Please add tests."
bin/foreman task adopt --worker worker --task T-000001
bin/foreman task recover --task T-000001
bin/foreman task accept --task T-000001
bin/foreman status
```

A worker reports from its own pane:

```sh
"$FOREMAN_ROOT/bin/foreman" report --status done <<'REPORT'
outcome, changed files, verification evidence, unresolved checks, risks
REPORT
```

`--status` is `done`, `blocked`, or `progress`, and the summary comes from `--summary`, `--summary-file`, or standard input.
The report is bound to the assignment through `HERDR_PANE_ID`, so it only works in the pane Foreman spawned or adopted for that task.
`done` makes the task `review-ready`, `blocked` makes it `blocked`, and `progress` leaves it `working`.
Every report is kept under `data/tasks/<id>/reports/`.

`task message` sends a free-form request to the worker; a `blocked` or `review-ready` task returns to `working`.
`decision deliver` sends the answered decision to the worker and returns the task to `working`.

`task accept` is the final task action.
It stops the worker endpoint, releases the resource lease, removes task-scoped coordination records, and deletes the task from `data/tasks/`.
The project workspace stays on disk, and accepted tasks are not archived.

## Routing

Edit the tracked `FOREMAN_ROOT/config/model-routing.json` to change the router, the named worker profiles, or the `default` profile.
Set a profile's `effort` to `low`, `medium`, `high`, `xhigh`, or `max`; Codex also supports `none` for the configured GPT-6 models.
Leave it `null` to use the tool's default.
Set a profile's `isActive` to `false` to hide it from the router; omitted means `true`.
The `default` profile must stay active, and tasks routed before a profile was disabled keep the profile they were given.
Foreman passes Codex effort through `--config model_reasoning_effort=...`, Claude effort through `--effort`, and OMP effort through `--thinking`.
`init`, `routing init`, and `routing show` validate and read that file; they do not create or modify it.
An older `FOREMAN_HOME/config/model-routing.json` is ignored, so copy any custom settings into the tracked file before using them.

`command` accepts either an argument array or a shell-like string, but Foreman always executes it without a shell.
The command executable must match `tool`, and model flags belong in `model` rather than `command`.
Every task is routed during creation, and the decision is stored in `data/tasks/<taskId>/meta.json` before scheduling.
If the router fails or returns an unknown profile, Foreman uses only the configured `default` and records the failure.
Use `routing route --task <id>` to resume a task left in `routing` after an interrupted process.

## Status and recovery

`status` lists Herdr once and prints the grouped Vietnamese report; `status --json` and `task list --json` keep the machine-readable record.
`status --project <id>` filters the same snapshot.
It never interrupts a worker, writes state, or starts recovery.
It flags `worker.idle-without-report`, `worker.waiting-input`, `worker.dead`, `worker.missing`, `worker.mismatch`, and workspace, branch, lease, or pane mismatches.
No background process runs; supervision happens only when Foreman handles a prompt.
Commands wait up to 5 seconds for the home lock before failing.
A lock left by a process that died on this host is removed automatically; a lock from another host or a live process is never broken.

If a worker is dead or missing, run `status` again to confirm, then `task recover`.
Recovery is bounded, preserves the workspace, and writes `data/tasks/<id>/handoff.json`; it does not guess that an `unknown` endpoint is dead.

Do not delete `data/` while work is active.
Pull-request delivery, remote homes, relay channels, additional runtime backends, and merge authority are deferred.
