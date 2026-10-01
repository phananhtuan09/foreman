# Foreman local operations

Status: Reference
Applies to: Local Herdr and Paseo installations
Verification status: Preserved procedure; complete execution verification was not established during migration

## Outcome

Configure the selected local backend and operate project-bound tasks through dispatch, reporting, supervision, recovery, and acceptance.

## Preconditions

- Review the selected backend's operational skill and ensure its runtime is available.
- Use the Foreman checkout and the correct operational home; project workspaces remain client-owned.
- Command examples contain illustrative paths, profiles, IDs, and optional-argument notation; substitute validated values rather than executing the examples blindly.

## Safety

Initialization edits shell startup files; profile synchronization changes the selected Paseo home's profiles.
Acceptance and discard delete task records after endpoint and lease checks, but leave project files intact.
Do not run these mutations merely to verify documentation or against an unknown home.
Never delete active fleet state or infer a dead worker from unknown evidence.

## Procedure

### Setup

For Herdr mode, run `bin/foreman-herdr init` from the Foreman checkout.
For Paseo mode, run `bin/foreman-paseo init` from the same checkout.
It records the checkout as `FOREMAN_ROOT` and `FOREMAN_HOME` (or `--home PATH`) in the startup file of your login shell, creates `data/`, and validates the routing configuration for the selected backend.
The startup file is `$ZDOTDIR/.zshrc` or `~/.zshrc` for zsh, `~/.bashrc` for bash (`~/.bash_profile` on macOS), `~/.config/fish/conf.d/foreman.fish` for fish, and `~/.profile` for `sh`, `dash`, `ksh`, or `mksh`.
Only the block between `# >>> foreman >>>` and `# <<< foreman <<<` is written; running `init` again from another checkout replaces that block.
For an unrecognized shell, `init` fails and prints the `export` lines to add yourself.
Shells and worker panes opened after `init` see the variables; restart older coding agents if they should report to Foreman.
The backend wrappers set `FOREMAN_BACKEND` only for their own CLI process and do not write it to the shell startup file.

### Hooks

Herdr workers report through a stop hook that you install in each coding agent, globally if you like.
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

### Commands

Use the selected backend wrapper for each Foreman command:

```sh
bin/foreman-herdr init
bin/foreman-herdr routing show
bin/foreman-herdr project register --id app --root /path/to/app
bin/foreman-herdr task create --project app --brief-file brief.md [--notes-file notes.md]
bin/foreman-herdr task confirm --task T-000001 --profile claude-sonnet
bin/foreman-herdr task dispatch --task T-000001
bin/foreman-herdr task message --task T-000001 --text "Please add tests."
bin/foreman-herdr task adopt --worker worker --task T-000001
bin/foreman-herdr task promote --task T-000001
bin/foreman-herdr task recover --task T-000001
bin/foreman-herdr task accept --task T-000001
bin/foreman-herdr task discard --task T-000001
bin/foreman-herdr status
```

For Paseo, sync repo-managed agent profiles when their source files change, then use the Paseo wrapper for the full task flow:

```sh
bin/foreman-paseo profiles sync
bin/foreman-paseo routing show
bin/foreman-paseo project register --id app --root /path/to/app
bin/foreman-paseo task create --project app --type scout --brief "Inspect the API and report risks."
bin/foreman-paseo task confirm --task T-000001 --profile codex-luna
bin/foreman-paseo task dispatch --task T-000001
bin/foreman-paseo task collect
bin/foreman-paseo status --json
bin/foreman-paseo task promote --task T-000001
bin/foreman-paseo task accept --task T-000001
```

`profiles sync` writes only when explicitly called.
It replaces IDs beginning with `foreman-`, preserves other Paseo profiles and their order, verifies the selected Paseo home, and reads the installed profile list back after writing.
Use `profiles sync --dry-run` to inspect the planned result without changing Paseo configuration.

`task create` routes the task and prints `routing.profileOptions`: option 1 is the router's recommended profile, followed by every other active profile in config order.
The recommendation is not a dispatch decision.
`task confirm` records the human's chosen active profile, recommended or not, and `task dispatch` and `task schedule` refuse or skip a routed task until it is confirmed.
Confirmation is allowed only while the task is unassigned; `status` lists unconfirmed tasks under `Cần bạn chọn model`.

`task dispatch` names the worker `<project>-<task>` in lowercase, such as `app-t-000001`, and uses that name as the Herdr workspace label; pass `--owner` only to override it.
Without `--resources`, a ship task claims the project workspace exclusively.
When the claim overlaps a lease another task holds, `task dispatch`, `task adopt`, and `task recover` still assign the task, print a `foreman: warning:` line per overlap, and record the overlaps under `resourceLease.conflicts`.
`task schedule` does not make that choice for the human: it leaves an overlapping task `pending`.
`--brief` holds the user's request verbatim; `--notes` holds optional Foreman context, such as related report paths, and reaches the worker as a separate `Foreman notes` section.
Foreman adds the resources and backend-specific report instructions to every worker prompt, so a brief does not repeat them; the prompt has no separate rules section.

A Herdr worker reports from its own pane:

```sh
"$FOREMAN_ROOT/bin/foreman" report --status done <<'REPORT'
outcome, changed files, verification evidence, unresolved checks, risks
REPORT
```

`--status` is `done`, `blocked`, or `progress`, and the summary comes from `--summary`, `--summary-file`, or standard input.
The report is bound to the assignment through `HERDR_PANE_ID`, so it only works in the pane Foreman spawned or adopted for that task.
`done` makes the task `review-ready`, `blocked` makes it `blocked`, and `progress` leaves it `working`.
Every report is kept under `data/tasks/<id>/reports/`.

A Paseo worker reports by returning one JSON object at the end of each turn:

```json
{"status":"done","summary":"Outcome, changed files, verification evidence, unresolved checks, and risks."}
```

The `status` must be `done`, `blocked`, or `progress`, and `summary` must be non-empty.
Foreman collects finished responses with `bin/foreman-paseo task collect`, verifies the Paseo agent, workspace, assignment generation, and turn, then stores the original response verbatim under the task reports directory.
Paseo workers do not invoke `foreman report` or rely on the Herdr stop hook.

`task message` sends a free-form request to the worker; a `blocked` or `review-ready` task returns to `working`.
`decision deliver` sends the answered decision to the worker and returns the task to `working`.

`task accept` is the final task action.
It stops the Herdr pane or archives the Paseo agent, verifies endpoint closure, releases the resource lease, removes task-scoped coordination records, and deletes the task from `data/tasks/`.
The project workspace stays on disk.

`task discard` removes a queued task that was never assigned, or an assigned task whose worker `status` confirms `dead` or `missing`; it refuses live or `unknown` workers and tasks that others depend on.
For a confirmed dead Herdr worker it stops the pane before cleanup; a missing endpoint is already absent.
It releases the lease and deletes the task's records, reports, and decisions; the project workspace stays on disk.
Use it to drop work that should not continue; use `task recover` instead to hand it to a new worker.

### Routing

For Herdr, edit `FOREMAN_ROOT/config/model-routing.json` to change the router, named worker profiles, or the `default` profile.
For Codex, Claude, and OMP, set `effort` to `low`, `medium`, `high`, `xhigh`, or `max`; Codex also supports `none` for the configured GPT-6 models.
For OpenCode V2, `effort` names a model-specific variant and the selected model must provide that variant.
Leave it `null` to use the tool's default.
OpenCode V2 profiles use `command: ["opencode", "mini", "--standalone"]` and a `provider/model` model ID.
Foreman encodes a non-null `effort` as the model variant suffix `#<effort>` on `--model`, for example `openai/model#high`.
OpenCode resolves whether the selected variant exists for that model; an unknown variant fails model resolution.
OpenCode V2's `mini` interface does not accept `--auto`, so Foreman rejects profiles that include it.
The pane-local server is required so the global worker-stop plugin inherits the worker's `HERDR_PANE_ID`; a shared service may have another pane's ID.
Install the global OpenCode V2 Foreman worker-stop plugin before dispatch by adding the absolute directory `FOREMAN_ROOT/hooks/foreman-worker-stop-opencode` to `plugins` in `~/.config/opencode/opencode.jsonc` (preserving other entries).
Check that `opencode plugin list` shows `foreman.worker-stop`; a loaded plugin alone is not proof that a worker reported.
For V2, the plugin reads `event.data.sessionID` from `session.execution.succeeded` (not V1 `session.idle`/`event.properties`) and prompts the root session with `ctx.session.prompt({ sessionID, text: reason })` only when the worker hook returns `decision: block`.
Set a profile's `isActive` to `false` to hide it from the router; omitted means `true`.
The `default` profile must stay active, and tasks routed before a profile was disabled keep the profile they were given.
Foreman passes Codex effort through `--config model_reasoning_effort=...`, Claude effort through `--effort`, and OMP effort through `--thinking`.
`init`, `routing init`, and `routing show` validate and read that file; they do not create or modify it.
An older `FOREMAN_HOME/config/model-routing.json` is ignored, so copy any custom settings into the tracked file before using them.

Both backends use `FOREMAN_ROOT/config/model-routing.json` for the router, groups, profile names, models, tools, and usage policy.
For Paseo, add or edit the matching `foreman-<profile>` entry in `FOREMAN_ROOT/config/paseo-agent-profiles.json` for its provider, model, mode, thinking, feature, and notes fields.
Every model-routing profile must have a matching Paseo entry, including profiles with `isActive: false`; inactive profiles remain installed but cannot be recommended or selected by Foreman.
OpenCode profiles keep their model ID and omit Herdr's unsupported effort setting.
The router recommends a profile, but the user still confirms the profile before dispatch.
After profile edits, run `bin/foreman-paseo profiles sync`; task creation and `init` never change Paseo's installed profiles.
The selected profile settings are copied into the task when the user confirms, so later profile edits do not alter the stored assignment.
Before Paseo spawn, Foreman resolves the exact `paseoProfileId` from the selected daemon and compares its launch settings with that stored snapshot.
If the profile is missing or differs, dispatch remains queued with a reviewable error; run `bin/foreman-paseo profiles sync` and retry after confirming the profile again when necessary.

`command` accepts either an argument array or a shell-like string, but Foreman always executes it without a shell.
The command executable must match `tool`, and model flags belong in `model` rather than `command`.
Every task is routed during creation, and the decision is stored in `data/tasks/<taskId>/meta.json` before scheduling.
If the router fails or returns an unknown profile, Foreman uses only the configured `default` and records the failure.
Use `routing route --task <id>` to resume a task left in `routing` after an interrupted process.

### Status and recovery

`status` lists the selected runtime once and prints the grouped Vietnamese report; `status --json` and `task list --json` keep the machine-readable record.
`status --project <id>` filters the same snapshot.
It never interrupts a worker or starts recovery.
Paseo report collection is an explicit durable write, so run `task collect` before status during Paseo supervision.
It flags `worker.idle-without-report`, `worker.waiting-input`, `worker.dead`, `worker.missing`, `worker.mismatch`, and workspace, branch, lease, or pane mismatches.
No background process runs; supervision happens only when Foreman handles a prompt.
Commands wait up to 5 seconds for the home lock before failing.
A lock left by a process that died on this host is removed automatically; a lock from another host or a live process is never broken.

If a worker is dead or missing, run the selected wrapper's `status` again to confirm, then `task recover`.
Recovery is bounded, preserves the workspace, and writes `data/tasks/<id>/handoff.json`; it does not guess that an `unknown` endpoint is dead.

Do not delete `data/` while work is active.
Pull-request delivery, remote homes, relay channels, additional runtime backends, and merge authority are deferred.

## Verification

The historical implementation snapshot reports focused tests and live backend flows on 2026-09-28.
Those claims do not establish that every command, hook configuration, or troubleshooting path documented here has been exercised.
Before operational use, validate the selected backend, home, task identity, current assignment, and command syntax through the relevant operational skill and read-only CLI output.
No complete setup-to-recovery procedure was re-executed for this migration; do not label this artifact Verified without supporting evidence.

## Recovery

Preserve the current workspace and records when an operation fails or its delivery is uncertain.
Follow the documented Status and recovery procedure only after two checks confirm a dead or missing endpoint.
Unknown, contradictory, or live evidence does not authorize recovery or discard.

## References

- [Product contract](../product/foreman-contract.md)
- [State and runtime contract](../decisions/state-runtime-contract.md)
- [Historical implementation baseline](../plans/completed/implementation-baseline.md)
