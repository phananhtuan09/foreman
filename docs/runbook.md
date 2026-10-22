# Foreman local runbook

## Setup

For Herdr mode, run `bin/foreman-herdr init` from the Foreman checkout.
For Paseo mode, run `bin/foreman-paseo init` from the same checkout.
It records the checkout as `FOREMAN_ROOT` and `FOREMAN_HOME` (or `--home PATH`) in the startup file of your login shell, creates `data/`, and validates the routing configuration for the selected backend.
The startup file is `$ZDOTDIR/.zshrc` or `~/.zshrc` for zsh, `~/.bashrc` for bash (`~/.bash_profile` on macOS), `~/.config/fish/conf.d/foreman.fish` for fish, and `~/.profile` for `sh`, `dash`, `ksh`, or `mksh`.
Only the block between `# >>> foreman >>>` and `# <<< foreman <<<` is written; running `init` again from another checkout replaces that block.
For an unrecognized shell, `init` fails and prints the `export` lines to add yourself.
Shells and worker panes opened after `init` see the variables; restart older coding agents if they should report to Foreman.
When the running session inherited other values, `init` prints a `warning`; start a new terminal or agent session before running Foreman commands.
The backend wrappers set `FOREMAN_BACKEND` only for their own CLI process and do not write it to the shell startup file.

## Hooks

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

## Commands

Use the selected backend wrapper for each Foreman command:

```sh
bin/foreman-herdr init
bin/foreman-herdr routing show
bin/foreman-herdr project register --id app --root /path/to/app
bin/foreman-herdr project remove --id app
bin/foreman-herdr image stage
bin/foreman-herdr task create --project app --brief-file brief.md --original "the user's own words" [--notes-file notes.md] [--image A-3f9c2e1a7b04]
bin/foreman-herdr task brief --task T-000001 --text "Corrected instruction"
bin/foreman-herdr task confirm --task T-000001 --profile claude-sonnet
bin/foreman-herdr task dispatch --task T-000001
bin/foreman-herdr task continue --task T-000001 --text "Add tests for step 1." --original "làm 1, thêm test"
bin/foreman-herdr task reassign --task T-000001 --profile claude-opus
bin/foreman-herdr task message --task T-000001 --text "Please report your status."
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
bin/foreman-paseo project remove --id app
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
When the claim overlaps a lease another task holds, `task dispatch`, `task adopt`, `task recover`, `task reassign`, and a `task continue` round that changes the lease still assign the task, print a `foreman: warning:` line per overlap, and record the overlaps under `resourceLease.conflicts`.
`task schedule` does not make that choice for the human: it leaves an overlapping task `pending`.
`--brief` holds the instruction for the worker, which Foreman may rewrite from the user's words and the task's reports; `--original` holds the user's own words verbatim and is what the router reads.
`task brief` replaces the brief of a task that has no worker yet, or the request of a pending handoff until its successor receives it; `--original` appends the user's words to that pending round; `--notes` holds optional Foreman context, such as related report paths, and reaches the worker as a separate `Foreman notes` section.
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

A task is a series of rounds with the same worker.
`task continue --task ID --text TEXT --original TEXT` answers a report with the next round: it needs the instruction and the user's words, requires a task in `review-ready`, `blocked`, or `waiting-decision` (or `working` once the worker has reported).
On a task waiting for a decision, the delivered round marks that decision `superseded` (`supersededAt`, `supersededByRound`) instead of answering it; answer the decision itself with `decision answer` and `decision deliver`.
A worker that is still running is refused unless `--interrupt` is given; an unreadable (`unknown`) state is always refused.
`--interrupt` sends Ctrl-C only to a worker that is running, and the new round records which round it replaces.
`--type ship|scout` switches mode at the round boundary: switching to ship claims the project workspace exclusively unless `--resources` is given, and a task that has ever shipped keeps its write lease for later investigating rounds.
`--with-original` also shows the worker the user's words for reference; by default it receives only the instruction.
If the worker does not accept the prompt, the round is recorded as failed and the mode and lease are restored.
Each round is stored under `data/tasks/<id>/rounds/round-NNN.json` and reports from round two on carry a `ROUND:` header.
`task reassign --task ID [--profile NAME] [--text TEXT --original TEXT] [--type ship|scout]` moves a `working`, `blocked`, or `review-ready` task to a new worker at the user's request; without `--text` the successor reads every round and report, checks the workspace, and reports before doing anything.
It is not counted against the recovery attempt limit and refuses a task waiting for a decision or a worker whose state cannot be read.
`task message` sends a free-form question from Foreman to the worker; a `blocked` or `review-ready` task returns to `working`.

### Images

`image stage [--transcript FILE]` reads the user's latest message from the Foreman session transcript and copies its images into `data/inbox/`, printing one ID per image (`A-` and 12 hex digits).
The session prompt hook records the transcript path in `data/sessions/current.json` on every non-`DEV` prompt, so `image stage` needs no argument inside a Claude Code or Codex Foreman session; `--transcript` reads another file.
Run it in the turn the user pastes the images, because a later "ok" becomes the latest message.
`--image ID|FILE`, repeatable, attaches images to `task create`, `task brief` (replacing round one's images), `task continue`, `task reassign` with `--text`, `task message`, and `decision answer`.
Only PNG, JPEG, GIF, and WebP are accepted, checked from the bytes, at most 5 MB each and 10 per request; the same image given twice counts once.
Foreman stores the images under `data/tasks/<id>/attachments/` with `attachments.json` before anything is sent, and the round, message, or decision records only their IDs and digests.
Before sending, Foreman copies them to `<workspace>/.foreman/attachments/<taskId>/` and adds `/.foreman/` to the repository's local `info/exclude`, so they are never committed; the prompt gains an `Images` section with their paths.
Paseo workers also receive the images of the current message inline through the SDK; Herdr workers open the files.
A replacement worker's handoff lists the image paths of every earlier round and decision.
Acceptance and discard remove the task's workspace copies and report `imageCleanupError` if that fails.
To check a delivery, open the paths listed in the message under `data/messages/` and confirm `git status` in the workspace shows nothing under `.foreman/`.
`decision deliver` sends the answered decision to the worker and returns the task to `working`.

`task accept` is the final task action.
It stops the Herdr pane or archives the Paseo agent, verifies endpoint closure, releases the resource lease, appends one metadata line for the task to `data/task-history.jsonl`, removes task-scoped coordination records, and deletes the task from `data/tasks/`.
The project workspace stays on disk.

`task discard` removes a queued task that was never assigned, an assigned task whose worker `status` confirms `dead` or `missing`, or a pending task whose dispatch stopped before any endpoint or prompt was recorded while no runtime worker carries its owner; it refuses live or `unknown` workers and tasks that others depend on.
For a confirmed dead Herdr worker it stops the pane before cleanup; a missing endpoint is already absent.
It releases the lease, appends the task's `discarded` line to `data/task-history.jsonl`, and deletes the task's records, reports, and decisions; the project workspace stays on disk.
Use it to drop work that should not continue; use `task recover` instead to hand it to a new worker.

## Routing

For Herdr, edit `FOREMAN_ROOT/config/model-routing.json` to change the router, named worker profiles, or the `default` profile.
For Codex, Claude, and OMP, set `effort` to `low`, `medium`, `high`, `xhigh`, or `max`; Codex also supports `none` for the configured GPT-6 models.
For OpenCode V2, `effort` names a model-specific variant and the selected model must provide that variant.
Leave it `null` to use the tool's default.
OpenCode V2 profiles use `command: ["opencode", "mini", "--standalone"]` and a `provider/model` model ID.
Foreman encodes a non-null `effort` as the model variant suffix `#<effort>` on `--model`, for example `openai/model#high`.
OpenCode resolves whether the selected variant exists for that model; an unknown variant fails model resolution.
OpenCode V2's `mini` interface does not accept `--auto`, so Foreman rejects profiles that include it.
The pane-local server is required so the global worker-stop plugin inherits the worker's `HERDR_PANE_ID`; a shared service may have another pane's ID.
Install the global OpenCode V2 Foreman worker-stop plugin before dispatch by adding the absolute directory `FOREMAN_ROOT/hooks/foreman-worker-stop-opencode` to `plugins` in `~/.config/opencode/opencode.jsonc` (preserving other entries). Check that `opencode plugin list` shows `foreman.worker-stop`; a loaded plugin alone is not proof that a worker reported.
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
An Antigravity profile sets `tool: "antigravity"`, no `command`, and `effort: null`; pick the variant through the model ID such as `gemini-3.8-flash-high`, and leave `thinkingOptionId` unset because Antigravity models have none.
Antigravity profiles run only on Paseo: Herdr hides them from its router and refuses to select them.
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

## Status and recovery

`status` lists the selected runtime once and prints the grouped Vietnamese report; `status --json` and `task list --json` keep the machine-readable record.
`status --project <id>` filters the same snapshot.
A review-ready task shows its review size, such as `chờ duyệt (12 file, +340/−120)`; the size counts changes since the task's first dispatch, leaves out paths dirty before it, and is marked approximate when another live task shares the workspace.
`stats [--since 7d|24h|DATE] [--json]` prints, read-only, the tasks accepted and discarded in the window, the user's average response time for decisions, `blocked` reports, and reviews, and the share of task time spent waiting on the user versus the worker.
It never interrupts a worker or starts recovery.
For read-only tooling, `task list --json --summary` prints the non-accepted tasks without initializing the home, migrating records, or taking the lock.
Paseo report collection is an explicit durable write; the session prompt hook runs it before its status check, and without the hook run `task collect` before status during Paseo supervision.
`status --json --brief` prints a compact status without unbound runtime agents or full task records.
It flags `worker.idle-without-report`, `worker.waiting-input`, `worker.dead`, `worker.missing`, `worker.mismatch`, and workspace, branch, lease, or pane mismatches.
No background process runs; supervision happens only when Foreman handles a prompt.
Commands wait up to 5 seconds for the home lock before failing.
A lock left by a process that died on this host is removed automatically; a lock from another host or a live process is never broken.

### Next action

`next propose --task ID --kind round|decision|accept|clarify --text LINE [--instruction TEXT|--instruction-file FILE] [--type ship|scout] [--json]` records the one next step Foreman shows after a report and prints its highlight block by default: a heading by kind, the step, any mode change, and the reply that approves it.
It also records the task's review-ready or blocked notice as told, so that key needs no `notice ack`.
Use `--json` to print the full proposal object, including its instruction, basis, and `line`.
`next show [--task ID]` lists shown next actions with `current` and the reasons one is out of date; `next clear --task ID` drops one the user declined or postponed.
If a task's pending points cannot be read, `next show` marks its proposal `current: false` with the read error and still lists the other tasks; the unreadable state is never rewritten or treated as permission to send.
`task continue --task ID --next --original "gửi bước này"` sends the stored instruction of a current round proposal and refuses after a newer report, round, generation, status, decision, or changed pending points.
It refuses a different `--type` or an explicit `--resources`; proposals saved without a pending-point digest must be proposed and approved again.
`task history --task ID` prints, read-only, the user's words, every delivered round, recent reports, decisions, pending points, and the shown next action.

### Pending points

`attention list` reviews every unfinished task on every project and prints a highlight block of at most five open points, grouped into points that need the user and points waiting on a worker, with the count of the rest; `--limit N`, `--json`, and `--task ID` show more.
`attention add --task ID --owner user|worker --kind decision|obligation|check --text TEXT [--action TEXT] [--report FILE|--user]` records a point; the same words as an existing point are refused.
`attention resolve --task ID --point P1 --how answered|verified|dropped|limit-accepted --text TEXT [--report FILE|--user]` closes it, `attention snooze --task ID --point P1 --until tomorrow|TIME` hides it until then, and `attention reopen --task ID --point P1 --why TEXT` reopens a closed point.
Points live in `data/tasks/<id>/attention.json` and are deleted with the task at acceptance or discard.

### Notices and the Paseo heartbeat

The session context and `supervise` list `Not yet told to the user` notices: a review-ready result, a blocker, a waiting decision, an anomaly, or a failed check, each with a key such as `T-000001/review-ready/generation-1-001-done.md`.
After telling the user, record them with `notice ack --key KEY [--key KEY]...`; a told notice is not listed again, and an untold one stays listed after a reset or restart.
`supervise [--json]` runs Paseo collection, one status check, and prints the same context for a turn without the prompt hook.
In a Claude Code session, a user prompt's context adds a `Foreman session size: nudge N` line once each time the session's context passes another 150k tokens, and Foreman then suggests a new session.

In a Foreman session that runs inside Paseo, `bin/foreman-paseo heartbeat sync` keeps one native Paseo heartbeat for that agent while a Paseo task is `working` or a notice is untold, and deletes it otherwise.
The prompt hook and the Paseo task commands that start or end watched work run it, so it needs no manual step; it prints `foreman: heartbeat ...` on standard error when it changes something.
`heartbeat sync --cron "*/10 * * * *"` changes the cadence (default every five minutes), and `--disable` or `--enable` turns recurring checks off or on.
Its ID is stored in `data/supervision.json`; Paseo cannot list heartbeats, so a recorded heartbeat that has not fired for fifteen minutes is re-checked by ID and recreated only if Paseo no longer has it.
Each heartbeat turn arrives as `<paseo-system>Schedule "foreman-supervision" fired (id=...)`; the prompt hook already ran collection and one status check for it.
When nothing needs the user, the hook blocks the heartbeat prompt (`{"decision":"block"}`), so the model never runs and the prompt does not enter the session.
Paseo 0.11 still marks the agent `finished`, shows the hook's one-line reason, and may send a push notification after that turn.

If a worker is dead or missing, run the selected wrapper's `status` again to confirm, then `task recover`.
Recovery is bounded, preserves the workspace, and writes `data/tasks/<id>/handoff.json`; it does not guess that an `unknown` endpoint is dead.

Do not delete `data/` while work is active.
Pull-request delivery, remote homes, relay channels, additional runtime backends, and merge authority are deferred.

## Session doctor

`doctor sessions [--limit N] [--since TIME] [--include-dev] [--json]` lists past Foreman sessions of this checkout, newest first, from `~/.claude/projects/<checkout>` and Codex rollouts whose cwd is the checkout (`CODEX_HOME` or `~/.codex`).
`doctor session --session ID|FILE|--current [--from N] [--max-events N] [--json]` prints one session as numbered events with coverage and the committed rules in force; `--current` reads the transcript the prompt hook recorded last.
An ID is looked up only among Foreman sessions, while a FILE path is read as given, without that filter.
Both are read-only and never touch `data/`; the `foreman-doctor` skill analyzes their output.

## Web dashboard

Run `bin/foreman dashboard serve` (add `--open` to open the browser, `--port N` when 18789 is taken) with the same `FOREMAN_HOME` as the Foreman session, then open `http://127.0.0.1:18789/`.
It runs in the foreground until Ctrl C, reads `data/` without the lock, and pushes changes to the page about a second after Foreman writes them.
Runtime state on the page is the last status check the Foreman session ran; a task dispatched after that check shows no runtime state until the next one.
To reach it from another machine, forward the port over SSH (`ssh -L 18789:127.0.0.1:18789 host`); the server refuses requests addressed to any other host name.

## Paseo dashboard plugin

`paseo-plugins/foreman-dashboard/` is an optional Paseo plugin that adds a "Foreman dashboard" button to the Paseo sidebar and a Command Center item.
Pressing either starts `foreman dashboard serve` on the daemon machine when no dashboard answers on the plugin's port (default 18789), then opens it in the browser.
Install it once per Paseo daemon with `paseo plugin install <abs path>`; set `foremanRoot`, `foremanHome` and `port` in its settings when the defaults do not fit.
The dashboard it starts is read-only, so the plugin never initializes, migrates, locks, or marks anything in the home, and the process stops when you press "Tắt" (or "Tắt Foreman dashboard" in the Command Center) or when the plugin stops or reloads; one started from a terminal is never stopped.
The plugin has its own tests: `npm test` inside the plugin folder; the root `npm test` does not run them.
