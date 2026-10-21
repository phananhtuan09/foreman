# Task lifecycle

Status: Active
Scope: Task intake, types, dependencies, completion, acceptance, discard, and workspace retention

## Purpose

A task moves from the user's wording to review-ready work that only the user can accept.
Its types, dependencies, and terminal actions are defined so that Foreman never merges, discards, or deletes work without explicit user authority.

## Definitions

- `ship`: a task that changes managed-project state and requires completion followed by user acceptance.
- `scout`: a task that investigates, audits, diagnoses, or researches and produces a report without modifying production code.
- Round: one instruction to the task's worker; the first round is the brief, and later rounds are added with `task continue`.

## Rules

### Intake

- Intake persists the user's wording under a new global task ID before anything else.
- Intake binds the task to one registered project and records its task metadata.
- Intake records dependencies without assigning work prematurely.
- A task is dispatched only when it is unblocked and a suitable runtime lane exists.

### Task types

- Every task has a type that is the mode of its current round, changed only by a round the user directs.
- A scout may use read-only resource claims and MUST NOT receive write or exclusive project leases.
- `task continue --type` switches a task between scout and ship at a round boundary.
- Switching to ship raises the lease to an exclusive project workspace claim unless the user gives resources.
- A task that has ever been a ship keeps its write lease until acceptance, even for a later investigating round.

### Scout completion and promotion

- A scout completes with an evidence-backed report and enters review-ready without a landing requirement.
- A scout's `done` report follows the same report lifecycle as other tasks.
- Foreman does not scan or fingerprint project files; scout read-only scope is communicated only through the read-only resource lease shown in its brief.
- In a project without Git, the scout mutation guard hashes every file except those under `node_modules`, `.git`, `dist`, and `build`.
- If a scout report implies implementation work, the user may continue the same task as a ship with `task continue --type ship`, or promote a review-ready scout before accepting it.
- Promoting a scout result creates a new ship task from its report while the scout is review-ready; promotion MUST happen before accepting the scout because acceptance deletes its report.
- The promoted brief is the user's new wording when given, otherwise the scout's original brief verbatim; the scout report travels verbatim in the new task's Foreman notes.
- Promotion remains available but is optional, because a scout can continue as a ship with the same worker.

### Dependencies

- A task may declare dependencies by stable task ID.
- A task with unsatisfied dependencies remains queued and cannot be dispatched.
- An accepted dependency is satisfied for any task type.
- Acceptance removes that dependency ID from remaining tasks before deleting the completed task record.
- Dependency cycles and cross-project dependency references to missing tasks are rejected.
- When a dependency reaches its required terminal state, the scheduler reevaluates each dependent task and unlocks it exactly once when every dependency is satisfied.

### Completion and acceptance

- A `done` report covers outcome, changed surface, direct evidence, unresolved checks, and risk.
- A `done` report moves the task to `review-ready`, and Foreman waits for the user.
- A `done` report on a task with a review base records its review size: files changed and lines added and removed since the base, counting commits, staged and unstaged edits, and untracked new files.
- Tracked files are measured from Git's line counts only; an untracked text file up to 2 MB has its lines counted, and a larger or binary file is counted as a binary file.
- An untracked symbolic link counts as one line, as Git stores it, and its target is not read.
- Paths already dirty at dispatch, including both sides of a staged rename, are left out and their count is shown; when another live task is bound to the same workspace, the size is marked approximate and names those tasks.
- A read-only scout and a project without Git get no review size; a size that cannot be measured is recorded with its reason and never blocks the report.
- Acceptance verifies the worker endpoint is stopped, releases the resource lease, and deletes the task records and task-scoped coordination records.
- Acceptance removes the task directory, its task messages, and the task's image copies in the workspace instead of archiving them.
- Acceptance closes a scout, releases its read-only runtime resources, and deletes its report and task records.
- Apart from the ended-task history line, no accepted task history is kept.

### Discard

- `foreman task discard --task ID` removes a queued task with no owner, endpoint, workspace, resource lease, report, or handoff.
- Discard also removes an assigned task whose worker a runtime status check confirms `dead` or `missing`.
- Discard also removes a pending task whose dispatch never recorded an endpoint or sent a prompt, when no runtime worker carries its owner.
- Discard refuses `unknown` or live workers and any task another task depends on.
- Discard runs under the home lock and refuses if the assignment generation or endpoint changed since the status check.
- Discard stops a `dead` worker's endpoint, releases the resource lease, and removes the task directory and its task-scoped messages, decisions, and reports without archiving them.

### Ended-task history

- Before acceptance or discard deletes a task's records, Foreman appends one line for the task to `data/task-history.jsonl`.
- The line holds the task's identity, project, type, backend, outcome (`accepted` or `discarded`), creation and end times, final round and generation, recovery attempts, user-requested reassignments, its last review size, and a timeline of its dispatches, adoption, later rounds, reports, and decisions with their times.
- Each dispatch names its generation, worker, and profile, and for a replacement why the previous worker was replaced; each report its status, round, and generation; each decision when it was created, answered, and delivered.
- An adoption names the adopted worker and its generation, also after a later worker replaced it.
- The line holds no brief, user wording, report text, decision text, or human response.
- If the line cannot be written, the task records are not deleted, and a retried acceptance or discard writes the line once.
- Lines whose task ended more than `FOREMAN_HISTORY_RETENTION_DAYS` days (a whole number of at least 1; default 365) before the newest line are dropped when that line is written.
- An unreadable line is skipped when the history is read and kept when it is rewritten.

### Workspace retention

- The project workspace stays on disk after acceptance or discard.
- Acceptance does not commit, merge, reset, or remove project files.
- The client controls any Git operation and can inspect the retained workspace after the task record is gone.
- The only files Foreman writes in a workspace are image copies under `.foreman/attachments/<taskId>/`, which Foreman keeps out of Git through the repository's local `info/exclude` and removes at acceptance or discard.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Durable state model](durable-state-model.md)
- [Dispatch and scheduling](dispatch-and-scheduling.md)
- [Worker communication](worker-communication.md)
