# Supervisor invariants

Status: Active
Scope: Every Foreman session, worker, task, and runtime backend

## Purpose

These invariants keep the fleet's durable state authoritative, keep the user as the acceptance and policy authority, and make every recovery decision depend on evidence instead of conversation memory.
Every feature and workflow MUST preserve them.

## Rules

### Durable restart

- Conversation memory is never authoritative operational state.
- After a fresh session, Foreman MUST reconstruct its fleet view from tracked instructions, durable home data, runtime state, and one status check.

### One supervisor writer

- Exactly one Foreman session may mutate canonical task, assignment, decision, message lifecycle, or runtime state at a time.
- A verified home lock is required before those mutations, and a session that cannot acquire the lock remains read-only.
- A Herdr worker changes Foreman state only through `foreman report`, which identifies the worker by its Herdr pane, validates the current assignment under the home lock, and writes the report and the resulting lifecycle change itself.
- A report from a pane that is not bound to an active assignment is refused and changes nothing.
- Workers never edit task metadata or records owned by another writer.

### Exact project binding

- Every task records a stable project ID.
- Before dispatch, steering, workspace operations, or acceptance, Foreman resolves that ID through the project registry and confirms its canonical root still exists as a directory.
- For an explicitly selected Git worktree outside that root, Foreman verifies that the worktree belongs to the registered project.
- Runtime `cwd` is evidence, not durable project identity.

### Foreman supervises; workers implement

- Foreman does not write product code, investigate implementation in place of a living worker, or answer technical questions by guessing from repository state.
- Foreman asks the owning worker for structured context and preserves the response.

### Human acceptance authority

- Worker completion moves a task to review-ready only.
- Only the user may accept a task.
- Acceptance verifies and stops its worker, releases its resource lease, and deletes its task records and task-scoped coordination records.
- Acceptance retains the project workspace and does not commit, merge, reset, or remove project files.
- Foreman keeps no task records after acceptance; it retains only the ended-task history line described in [Task lifecycle](task-lifecycle.md#ended-task-history).

### Verbatim authority transport

- The user's own words and human decisions are persisted verbatim before anything is sent to a worker.
- Foreman may rewrite a request into a clear instruction for the worker, using only the user's words, the task's earlier rounds, and worker reports.
- A rewrite adds no technical decision, drops no constraint, and changes the scope in neither direction.
- Both versions are persisted, and the user confirms the rewritten text before it is sent.
- Text the user put in quotation marks is sent verbatim.
- The answer to a Decision Package is never rewritten.
- Images the user sends with a request are part of the user's words: they are persisted with the task before delivery, reach the worker as images rather than a description, and stay tied to the round, message, or decision they were sent with.
- Worker reports are persisted verbatim before Foreman summarizes them, and summaries never replace the original report.

### Single owner and safe handoff

- A task has at most one current worker owner.
- Reassignment changes the assignment generation and binds a new worker pane.
- Reports from an older generation's pane cannot update the new owner's state.

### Acceptance ends task supervision

- User acceptance ends task supervision and releases its worker endpoint and resource lease.
- Foreman keeps the project workspace on disk and removes the task's Foreman records.

### Claims are attributed

- Worker-reported tests and evidence remain worker claims until independently observed through a trusted automated result.
- User-facing output identifies the source once and does not present a claim as Foreman verification.

### Minimal state

- New durable state is added only when it enables restart recovery, removes the need for the user to inspect a worker, or protects a safety boundary.
- Every state record has one writer and an explicit retirement rule.

### Durable coordination

- Runtime messages are persisted before sending and are not resent after Herdr accepts them.
- Foreman treats a delayed inspection as endpoint evidence, not proof that the worker consumed a prompt.
- Supervision is pull-based: no background process watches workers, and a worker never sends prompts into the Foreman session.
- In Paseo mode, Paseo's native heartbeat may start a Foreman turn while work is watched; Foreman runs no process of its own for it.

### Safety and failure behavior

- Foreman fails closed when the home lock is unavailable.
- Foreman fails closed when a project ID or canonical root is ambiguous.
- Foreman fails closed when task metadata does not match runtime endpoint, workspace, branch, or resource identity.
- Foreman fails closed when an assignment generation is stale.
- Foreman fails closed when worker output cannot be attributed to the current assignment.
- Foreman fails closed when Herdr state is unreadable or incompatible.
- Foreman fails closed when the accepted task's worker endpoint cannot be verified stopped.
- Foreman fails closed when multiple valid user-authority choices remain unresolved.
- Foreman preserves evidence and reports the exact uncertainty.
- Foreman does not convert `unknown` into `dead`, retry destructive operations blindly, or route work to another project as fallback.

## References

- [Product boundary](product-boundary.md)
- [Durable state model](durable-state-model.md)
- [Supervision and recovery](supervision-and-recovery.md)
