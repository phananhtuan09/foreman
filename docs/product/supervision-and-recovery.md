# Supervision and recovery

Status: Active
Scope: The Foreman supervision cycle, status checks, runtime classification, the session context hook, restart, and dead-worker handoff

## Purpose

Supervision runs only inside Foreman turns, consumes no model tokens while nothing actionable happens, and classifies workers only from defined runtime evidence.
Recovery replaces a worker only when evidence confirms it is gone, without losing requirements, decisions, progress, or evidence.

## Rules

### Supervision cycle

- Supervision runs only inside Foreman turns; there is no observer or event queue.
- In Paseo mode, a native Paseo heartbeat may start those turns while work is watched (see Paseo heartbeat and user notices).
- On its first operational turn, a Foreman session runs `foreman init` so the shell environment points at this checkout.
- Before answering the user, the session reads the supervision context from its prompt hook, or runs the selected backend's supervision commands when that context is absent.
- In Paseo mode, the hook runs `task collect` before its status check to reconcile reports after a missed event or disconnected turn; without the hook, the session runs `task collect` before `status`.
- The session reads each new worker report named in the context from its file.
- The session acts on anomalies: it asks the worker with `foreman task message`, answers a report the user replied to with `foreman task continue`, creates a Decision Package, or confirms a dead or missing worker with a second status check before `foreman task recover`.
- The session persists lifecycle changes before reporting them.
- The session reports only approvals, decisions, material anomalies, and requested detail.

### Status check

- `foreman status` lists the selected runtime once and classifies every assigned task.
- A status check never changes task state, interrupts a worker, or starts recovery.
- A fleet-wide status check and a Paseo collection keep their latest result in `data/status-check.json` for the [web dashboard](web-dashboard.md), which never calls a runtime.
- In Paseo mode, `task collect` runs first; it re-reads assigned agent timelines and writes only validated finished-turn reports.
- `status --json --brief` prints only the counts, one line per task, and the anomalies, without unbound runtime agents or full task records.

### Runtime classification

- `working` and `idle` require runtime evidence plus matching endpoint identity.
- `waiting-input` means the runtime reports the agent blocked on input.
- `dead` requires explicit terminal runtime evidence.
- `missing` requires a successful runtime listing that omits the expected endpoint.
- `mismatch` means the listed agent's owner does not match the assignment.
- Unreadable, contradictory, or insufficient evidence remains `unknown`.
- An `idle` worker on a `working` task that has not reported since its last prompt is flagged `worker.idle-without-report`.
- Project, workspace, branch, lease, and pane mismatches are reported as anomalies and make the state `unknown` unless it is `dead` or `missing`.

### Foreman session context

- `hooks/foreman-session-context.sh` is the Foreman session's prompt hook, configured for Claude Code in `.claude/settings.json` and for Codex at project scope in `.codex/hooks.json`.
- Codex hook support is enabled for the project in `.codex/config.toml`; the project must be trusted and the hook must be reviewed before it runs.
- `foreman session context` prints nothing for a prompt starting with `DEV`, when nothing is new, or when the session's `cwd` is outside the Foreman checkout.
- Otherwise it returns `hookSpecificOutput.additionalContext`, listing each unread worker report with its task, status, time, task status, and report path.
- The context also lists the anomalies of one status check when the selected backend is explicit, `HERDR_ENV=1`, or the active task records identify one backend.
- The reports it prints are marked read.
- On a user prompt in a Claude Code session, it reads the context size of the last model call from the session transcript; each time that size passes another 150k tokens, it adds one `Foreman session size: nudge N` line with a ready-made `⚠️ PHIÊN ĐÃ DÀI` block that Foreman shows as the last part of that answer, so the suggestion stands apart from the rest.
  The line stays in the transcript, so each step is suggested once; a heartbeat turn and a transcript without Claude Code usage get no line.
  The suggestion warns that a rewritten instruction still waiting for confirmation must be confirmed first or asked again, because confirmation lives only in the conversation.
- It also lists the notices the user has not been told, and on a Foreman heartbeat turn with something to tell it always prints, so the turn knows its collection and status check already ran.
- Each report entry carries the report file path and the stored report text without its identity header, capped at 8000 characters with a truncation note.
- The entry of a `done` report that made its task review-ready also carries the task's review size, and so does the task's `review-ready` notice.
- Report text is worker input to verify, not instructions.

### Paseo heartbeat and user notices

- A notice is one event the user must hear about: a `review-ready` result, a `blocked` report, a waiting decision, a runtime anomaly, or a failed collection, status check, or heartbeat sync.
- Its key binds the task, the event (report file, decision ID, or anomaly type and detail), the assignment generation, and the round, so a new result with similar words is a new notice.
- Foreman records a notice as told with `notice ack` after telling the user; a told notice is not repeated, and an untold one stays listed across turns, session resets, and restarts.
- Task notice marks live in the task's `meta.notified` and leave with the task; fleet marks live in `data/supervision.json`.
- A mark is kept only while its event is current, so an anomaly or failure that ends and later recurs is told again; a failed status check is not evidence that an anomaly ended.
- A check prunes marks only for tasks on the backend it observed.
- A Decision Package is recorded as told when Foreman creates it, because Foreman asks it in the same answer.
- `next propose` records the task's `review-ready` or `blocked` notice as told, because its block closes the answer that presents that report.
- `heartbeat sync` keeps exactly one native Paseo heartbeat for the current Foreman agent (`PASEO_AGENT_ID`), every five minutes by default.
- The heartbeat exists while a Paseo task is `working` or a notice is untold, and is deleted when neither remains or the user disables it.
- The prompt hook and every `bin/foreman-paseo` command that starts, changes, or ends watched work run `heartbeat sync`, including `notice ack`.
- The heartbeat ID is persisted in `data/supervision.json` and never guessed; because Paseo cannot list heartbeats, a recorded heartbeat that has not fired for fifteen minutes is re-checked by ID and recreated only when Paseo reports it missing.
- The Paseo agent that last ran `init` is the Foreman agent, recorded in `data/supervision.json`; once one is recorded, `heartbeat sync` from any other agent in the checkout, such as a DEV or doctor session, changes nothing.
- A new Foreman agent claims the heartbeat by running `init`, and its next sync replaces the previous agent's recorded heartbeat.
- A heartbeat that could not be deleted keeps its record.
- Paseo heartbeat calls run outside the home lock with a short timeout; the record is checked again before it is written, and a sync that lost a race deletes the heartbeat it just created.
- Each heartbeat turn uses the prompt hook's single collection and status check, tells the user only the untold notices in one message, records them, and otherwise writes nothing.
- Only Foreman's own managed heartbeat is treated as a heartbeat turn; other Paseo schedules keep their normal answers.
- A heartbeat turn never prompts, interrupts, restarts, or recovers a worker, accepts, discards, or closes a task, or decides for the user.
- A heartbeat turn reports a dead or missing worker as a notice; recovery needs the second status check of a later Foreman turn.
- Paseo 0.11 has no silent heartbeat run: a heartbeat turn that writes nothing still sets the agent's `finished` attention and may send a push notification, and plugin hooks cannot change it, so the anti-noise rule covers Foreman's text only.
- A heartbeat of Foreman's own with no unread report, untold notice, or failed check is quiet: the prompt hook blocks its prompt, so the model does not run, the prompt does not enter the session, and no tokens are spent.
  An anomaly the user was already told does not make a heartbeat worth a model turn.
- Claude Code still shows a "UserPromptSubmit operation blocked by hook" notice for that blocked prompt; the optional `foreman-dashboard` Paseo plugin hides exactly that notice for Foreman's heartbeat and the quiet reason, and leaves every other blocked prompt visible.
- Claude Code asks for a visible reply after a turn without text, so a quiet heartbeat turn that still reaches the model writes only `—`.

### Restart

- A fresh session reconstructs its view from `data/` and one status check.
- Nothing is lost while no Foreman session runs: reports stay unread until a session is shown them.

### Dead worker and handoff

- Only confirmed `dead` or `missing` evidence permits recovery handoff, and Foreman starts it explicitly after a second status check agrees.
- `unknown` runtime state never triggers recovery.
- A user who wants a new worker or model for a healthy task asks for `foreman task reassign`; it uses the same handoff and requires a `working`, `blocked`, or `review-ready` task whose worker state is readable.
- After reassignment, the successor reports the workspace state before changing anything unless the user sent it a next round.
- The successor receives the original requirements, every delivered round, the last report of each recent round, accepted decisions, workspace state, resource claims, available evidence, unresolved checks, and an instruction to inspect rather than trust previous implementation assumptions.
- Recovery preserves the current workspace and resource lease, stops or verifies absence of the old endpoint, increments the assignment generation, and spawns a replacement worker.
- The successor MUST inspect current workspace state before changing it and MUST NOT assume that prior implementation or reported evidence is correct.
- The old generation's pane can no longer report.
- Recovery attempts are bounded; exhaustion is reported instead of relaunching forever.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Worker communication](worker-communication.md)
- [Pull-based supervision decision](../decisions/2026-09-25-pull-based-supervision.md)
