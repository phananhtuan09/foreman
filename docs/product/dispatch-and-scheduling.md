# Dispatch and scheduling

Status: Active
Scope: Worker dispatch, adoption, workspaces, resource leases, and concurrent scheduling across registered projects

## Purpose

Workers mutate projects only in validated client-prepared workspaces, and resource leases let non-conflicting work run concurrently without serializing a whole repository.
Dispatch binds every assignment to a verified endpoint before Foreman treats it as running.

## Definitions

- Resource key: an opaque hierarchical identifier such as `file/src/auth/**`, `db/users/record/123`, `mcp/chrome/profile/default`, or `service/port/3000`.
- Resource lease: the set of resource claims held by one task owner and generation.

## Rules

### Workspaces

- For mutation work, the client prepares a workspace on the current branch.
- Foreman validates the workspace and binds it to the task and project in task metadata.
- Foreman never creates, switches, merges, or removes worktrees.
- For a task using the registered project root, Foreman confirms that the canonical path exists as a directory and records no branch.
- An explicitly selected Git worktree is checked against the registered project and its current branch.
- A project without Git uses its canonical root path and has no branch.

### Resource leases

- Multiple workers may share a workspace when their declared resource leases do not conflict.
- An undeclared mutation defaults to an exclusive project workspace lease.
- Read/read claims may coexist; write or exclusive claims conflict on overlapping keys.
- A conflict is a warning, not a refusal, when the human requests the assignment: an explicit dispatch, adoption, recovery, reassignment, or a round that changes the lease proceeds and records the overlapping leases in its own lease as evidence.
- Leases have an owner and generation and are held until acceptance, reassignment, or a failed dispatch releases them.
- Leases do not expire, because no heartbeat renews them and a worker may run for a long time without reporting.
- A round that changes the mode or resources claims a new lease in place.
- A preflight worker may return structured resource claims and dependency hints; Foreman treats that result as scheduling input, normalizes the claims, and defaults to an exclusive project-workspace lease when no plan is supplied.

### Dispatch

- Dispatch validates project, task, authority, dependency, and home lock.
- Dispatch creates a new assignment generation.
- Dispatch receives and validates the client-prepared workspace and resource claims.
- Dispatch persists the brief, pending assignment, and task-brief outbox message before runtime delivery.
- In a Git project, the first dispatch into a workspace records its review base: the `HEAD` commit and the paths already dirty; recovery and reassignment into the same workspace keep it.
- A review base that cannot be read is recorded with its error and never blocks dispatch.
- Dispatch spawns the worker through the selected runtime adapter, verifies stable endpoint identity, and delivers the persisted task-brief message.
- After the selected runtime accepts the text prompt, Foreman marks the task `working` and records the endpoint identity; Paseo also records the workspace ID and timeline cursor.
- If submission is uncertain, Foreman preserves the endpoint and records the uncertainty without resending or interrupting it.

### Adoption

- Adoption requires an explicit user request naming the worker and requirement or existing queued task.
- Foreman verifies that the worker is active, belongs to the registered project, is not already assigned elsewhere, and can be bound without overwriting work.
- Adoption creates a new generation but does not resend the task as if it were new.

### Scheduling and concurrency

- The scheduler dispatches only tasks whose dependencies are satisfied and whose required workspace, runtime lane, and resource leases are available.
- The scheduler leaves a conflicting task pending because no human chose to overlap it.
- Fleet and per-project concurrency limits are explicit configuration, not hard-coded single-worker behavior.
- The scheduler respects machine capacity, project limits, dependency state, workspace availability, and resource conflicts.
- Tasks in the same project may run concurrently when their resource claims do not conflict; they are not serialized only because they share a repository.
- When isolated workspaces are required, the client MUST prepare and identify them before dispatch because Foreman does not create or switch worktrees.
- An idle endpoint may receive another task only after its prior assignment is terminal, no message to it is pending, its resource lease is released safely, and a new assignment generation is bound and verified.

## References

- [Durable state model](durable-state-model.md)
- [Task lifecycle](task-lifecycle.md)
- [Runtime backends and routing](runtime-backends-and-routing.md)
