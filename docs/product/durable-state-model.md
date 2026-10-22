# Durable state model

Status: Active
Scope: Records under `FOREMAN_HOME/data/`: project registry, task records, assignment generations, and schema migration

## Purpose

All task, assignment, decision, progress, blocker, completion, and recovery state lives on disk so that a fresh Foreman session can reconstruct the fleet without conversation history.
Every record has a stable identity and a single writer so stale or foreign input cannot mutate canonical state.

## Rules

### Project registry

- The canonical registry is `data/projects.json`.
- Each project has `id`, `name`, `root`, `vcs`, `deliveryMode`, and `enabled`, for example:

  ```json
  {
    "id": "ai-agent-workflow",
    "name": "AI Agent Workflow",
    "root": "/absolute/canonical/path/ai-agent-workflow",
    "vcs": "git",
    "deliveryMode": "local-only",
    "enabled": true
  }
  ```

- `id` is stable, unique, lowercase, and path-independent.
- `root` MUST resolve to an existing directory when the project is enabled.
- Registration inside a Git worktree stores the worktree root with `vcs: "git"`; any other directory is stored as given with `vcs: "none"`.
- A record without `vcs` is a Git project.
- Projects have no configured default branch; Git work happens on the branch that is current at dispatch.
- Duplicate IDs and duplicate canonical roots are rejected.
- A project outside the registry cannot receive work.
- Initial delivery mode is `local-only`; adding `pull-request` requires its own accepted design and proof.
- Registry writes are atomic.
- Registration receives an explicit project path or clone request, resolves the canonical root, inspects repository identity, and records project policy and initial delivery mode atomically.
- Registration does not modify the managed project.

### Fleet task list

- There is no separate backlog file; the fleet task list is the set of task metadata records under `data/tasks/`.
- `foreman status` and `foreman task list` render the task list from those records.
- `foreman task list --json --summary` is the read-only view for external tooling: it lists every task except `accepted` and `cleaned` with the fields a board shows and the user's own wording of each round.
- The summary view never initializes the home, migrates a record, or takes the home lock.
- The web dashboard reads the same records, the kept status check, the outbox, and the ended-task history under the same limits.
- A malformed record is skipped and reported instead of failing the list.
- Task IDs are globally unique across projects: `T-` identifies requested change or investigation work, and `B-` identifies an observed defect.
- Task lifecycle is the `status` field of task metadata.
- No separate priority field is introduced initially.

### Task records

- Task records live under `data/tasks/<id>/` until user acceptance or explicit discard, which first append the task's line to `data/task-history.jsonl`:

  ```text
  data/tasks/T-000123/
  ├── brief.md          the round-one instruction sent to the worker
  ├── original.md       the user's own words for round one, when given
  ├── rounds/           append-only records of later rounds (instruction sent, the user's words, mode, resources, image references, status)
  ├── attachments/      images the user sent, named by content digest
  ├── attachments.json  versioned image manifest and round one's image IDs
  ├── notes.md          optional Foreman context for the worker, kept apart from the user's words
  ├── meta.json         creation time, adoption, lifecycle, project, owner, generation, workspace, branch, review base and size, resource lease, endpoint, worker pane, routing, and latest report
  ├── decisions/        versioned Decision Packages and verbatim human responses
  ├── reports/          verbatim worker reports, one file per report
  ├── foreman-reports/  append-only records of Foreman's report of the task as shown to the user, with its round and next-action block
  ├── attention.json    pending points kept across rounds
  └── handoff.json      latest recovery handoff, written only by dead-worker recovery
  ```

- Fleet-wide records live directly under `data/`:

  ```text
  data/
  ├── .lock/            home lock
  ├── projects.json     project registry
  ├── sequence.json     next task ID
  ├── tasks/            task records
  ├── messages/         durable Foreman-to-worker outbox and message lifecycle
  ├── inbox/            images staged from the Foreman session, kept seven days
  ├── sessions/         the Foreman session transcript path recorded by the prompt hook
  ├── supervision.json  the Paseo heartbeat Foreman manages, the Foreman agent that manages it, and the fleet notices already told to the user
  ├── status-check.json the last fleet-wide status check and Paseo collection per backend, kept for the web dashboard
  └── task-history.jsonl
                        one metadata line per accepted or discarded task, kept 365 days by default
  ```

### Assignment generation

- Each ownership change increments `generation` in task metadata and records the runtime endpoint identity.
- Herdr assignments bind `paneId`; Paseo assignments bind `agentId` as the endpoint and also persist `workspaceId`.
- Every prompt and steering message carries task ID, project ID, owner, and generation.
- A worker report is bound to the current endpoint and generation, so a stale pane or Paseo agent cannot update task lifecycle or reports.

### Schemas and migration

- Every JSON record has a schema version, stable identity, owning writer, and explicit retirement or retention rule.
- Foreman validates records before applying them and fails closed when an active record has an unsupported version or invalid identity binding.
- Schema migrations are deterministic, atomic, restart-safe, and preserve the original record until the migrated replacement is durable.
- Invalid external input is refused and cannot mutate canonical state.
- Message, decision, and report records carry correlation fields sufficient to trace the full flow without relying on conversation history.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Task lifecycle](task-lifecycle.md)
- [Worker communication](worker-communication.md)
- [Implementation and state model reference](../architecture.md)
