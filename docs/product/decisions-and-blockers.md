# Decisions and blockers

Status: Active
Scope: Blocked worker reports, Decision Packages, and delivery of human decisions

## Purpose

Only the user may resolve product, architecture, compatibility, security, operational, or acceptance choices.
Blockers and decisions are persisted with the human response verbatim so authority-blocked work resumes only with the user's actual answer.

## Definitions

- Decision Package: a versioned record Foreman creates when it sees a choice that needs human authority.

## Rules

- A `blocked` report stops the task at `blocked`.
- Foreman shows the user what the worker needs and its next steps, and the user's reply becomes the next round, sent with `foreman task continue` once the user confirms it.
- When Foreman itself sees a choice that needs product, architecture, compatibility, security, operational, or acceptance authority, it persists a complete Decision Package before asking the user.
- Decision records live under `data/tasks/<id>/decisions/` and preserve the original Decision Package and the human response verbatim.
- Each Decision Package contains the finding, why human authority is required, concrete options, impact, evidence, and either the worker recommendation or an explicit statement that no recommendation is available.
- Decision lifecycle is `pending`, `answered`, and `delivered`.
- A task holds at most one undelivered decision for its current generation; a new decision is refused until that one is delivered.
- The human response is delivered through the durable outbox to the current generation.
- Foreman does not resume authority-blocked work until the selected runtime accepts delivery to the current assignment generation; that delivery returns the task to `working`.

### Pending points

- A pending point is one obligation of the requested work, one decision waiting for the user, or one check still missing that affects the result.
- Points live in the task's `attention.json`, written only by the Foreman session through `attention` commands under the home lock, and leave with the task at acceptance or discard; no task or subtask is created for them.
- Each point has a stable ID within its task (`P1`, `P2`, ...), an owner (`user` when the user must act, `worker` when the worker must still do or prove it), a kind (`decision`, `obligation`, or `check`), its text and optional action, and its source: the request, the user's words, or one of the task's own report files, with its round and generation.
- Report-backed sources and resolutions retain the report's round and generation even after the worker is replaced.
- A point closes as `answered`, `verified`, `dropped`, or `limit-accepted`, keeping the user's words or the evidence report; a closed point is kept, so adding the same words again is refused, and reopening it records why and keeps the earlier resolution.
- An answer is recorded when the user gives it, independently of delivering it to the worker.
- A point can be snoozed until a time, `tomorrow` meaning the start of the next local day, without being closed.
- A worker report is input to evaluate and never closes or overrides a point by itself; a worker's "Next steps" suggestion becomes a point only when the request or the user requires it.
- `attention list` reviews every task that has not ended on every project and shows at most five open, unsnoozed points in a separate highlight block, user points first, then decisions, obligations, and checks, oldest first, with the count of the rest.
- The block groups the points that need the user apart from those waiting on a worker, and puts each point's project, task, and round on its own line.
- `attention list` reads durable state only and never prompts or interrupts a worker or changes a task.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Worker communication](worker-communication.md)
