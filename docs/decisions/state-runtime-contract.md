# Foreman state and runtime contract

Status: Baseline
Scope: Operational home, records, runtime adapters, assignments, workspaces, and concurrency
Migrated on: 2026-10-01
Source status: Draft 0.6

## Context

Foreman maintains restartable local fleet coordination separately from managed-project code.
This baseline preserves the existing architecture contract without inventing a new approval date.
Where this Supervisor–Worker baseline conflicts with the accepted [project-scoped SLP decision](2026-10-02-project-scoped-supervisor-lead-peer.md), the accepted decision governs new SLP work; this file remains the operating baseline for compatible legacy assignments.

## Decision

### 6. Repository and home layout

The implementation distinguishes tracked code from private operational state even when both initially live in one checkout.

```text
foreman/
├── AGENTS.md                  supervisor contract and router
├── docs/                      product, architecture, work memory, and runbooks
├── .agents/skills/            conditionally loaded Foreman workflows for Codex
├── config/model-routing.json  routing groups, router, and worker profiles for both backends
├── config/paseo-agent-profiles.json  repo-owned Paseo agent runtime profile mappings
├── bin/                       deterministic helpers and runtime adapters
├── hooks/                     coding-agent hook scripts for worker reports and the Foreman session
├── adapters/
│   └── herdr/                 Herdr-specific mechanics and compatibility checks
├── test/                      state, recovery, report, and adapter proof
├── legacy/
│   ├── foreman-agent/         preserved repo-scoped experiment
│   └── tests/                 preserved experiment tests
├── data/                      private fleet records, coordination, and lock; gitignored
└── projects/                  optional client-owned workspace mount; not managed by Foreman
```

Definitions:

- `FOREMAN_ROOT`: tracked source checkout containing instructions, scripts, adapters, tests, and this specification.
- `FOREMAN_HOME`: private operational root containing `data/`; client-owned workspaces live outside Foreman home.
- Both backends route from `FOREMAN_ROOT/config/model-routing.json`.
- Paseo maps every model-routing profile to the corresponding `foreman-<profile>` entry in `FOREMAN_ROOT/config/paseo-agent-profiles.json`; `isActive` only controls whether Foreman may recommend or select that profile.
- Paseo's installed profile list changes only through explicit profile sync; sync preserves profiles that Foreman does not own.
- If `FOREMAN_HOME` is unset, it defaults to `FOREMAN_ROOT`.
- Every helper resolves and validates both roots before mutation.
- `foreman init` run in the Foreman checkout records that checkout as `FOREMAN_ROOT` and `FOREMAN_HOME` (or `--home`) in the startup file of the machine's login shell: `$ZDOTDIR/.zshrc` or `~/.zshrc` for zsh, `~/.bashrc` for bash (`~/.bash_profile` on macOS), `~/.config/fish/conf.d/foreman.fish` for fish, and `~/.profile` for `sh`, `dash`, `ksh`, or `mksh`.
- `bin/foreman-herdr` and `bin/foreman-paseo` set `FOREMAN_BACKEND` for one Foreman CLI process; `foreman init` never writes the backend choice to a shell startup file.
- `FOREMAN_BACKEND` accepts `herdr` or `paseo`, defaults to `herdr` for existing callers, and rejects any other value.
- It rewrites only its own marked block, leaves the rest of the file unchanged, and refuses an unrecognized shell by printing the lines to add manually.
- Herdr worker panes opened after `init` inherit both variables, which the worker stop hook and `foreman report` rely on.

### 7. Durable data model

#### 7.1 Project registry

Canonical registry: `data/projects.json`.

Each project has:

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

Rules:

- `id` is stable, unique, lowercase, and path-independent.
- `root` must resolve to an existing directory when the project is enabled.
- Registration inside a Git worktree stores the worktree root with `vcs: "git"`; any other directory is stored as given with `vcs: "none"`.
- A record without `vcs` is a Git project.
- Projects have no configured default branch; Git work happens on the branch that is current at dispatch.
- Duplicate canonical roots are rejected.
- A project outside the registry cannot receive work.
- Initial delivery mode is `local-only`; adding `pull-request` requires its own accepted design and proof.
- Registry writes are atomic.

#### 7.2 Fleet task list

There is no separate backlog file.
The fleet task list is the set of task metadata records under `data/tasks/`.
`foreman status` and `foreman task list` render it from those records.

Task IDs are globally unique across projects:

- `T-` identifies requested change or investigation work.
- `B-` identifies an observed defect.

Under SLP, one registered project also has one logical project Lead identity with its own runtime generation.
Each human task remains a separate top-level task coordinated by that Lead, with direct Peer work items stored and reported as independent assignments.
Task and assignment records in this home are canonical; `.foreman/project-state.json` inside the project is a rebuildable, read-only current-state view.

Task lifecycle is the `status` field of task metadata.
SLP tasks also record `purpose: delivery|validation`; only validation tasks may use the terminal `proof-complete` state, which retains a proof record without entering delivery acceptance.
Acceptance deletes the task directory instead of archiving it.
No separate priority field is introduced initially.

#### 7.3 Task records

Task records live under `data/tasks/<id>/` until user acceptance or explicit discard:

```text
data/tasks/T-000123/
├── brief.md          original user requirements and accepted additions
├── notes.md          optional Foreman context for the worker, kept apart from the user's words
├── meta.json         lifecycle, project, owner, generation, workspace, branch, resource lease, endpoint, worker pane, routing, and latest report
├── decisions/        versioned Decision Packages and verbatim human responses
├── reports/          verbatim worker reports, one file per report
└── handoff.json      latest recovery handoff, written only by dead-worker recovery
```

Fleet-wide records live directly under `data/`:

```text
data/
├── .lock/            home lock
├── projects.json     project registry
├── sequence.json     next task ID
├── tasks/            task records
└── messages/         durable Foreman-to-worker outbox and message lifecycle
```

Acceptance removes the task directory and its task messages.
The project workspace stays on disk.
`foreman task discard --task ID` removes a queued task with no owner, endpoint, workspace, resource lease, report, or handoff, or an assigned task whose worker a runtime status check confirms `dead` or `missing`; it refuses `unknown` or live workers and any task another task depends on.
Discard runs under the home lock, refuses if the assignment generation or endpoint changed since the status check, stops a `dead` worker's endpoint, releases the resource lease, and removes the task directory and its task-scoped messages, decisions, and reports without archiving them.
The project workspace stays on disk.

#### 7.4 Assignment generation

Each ownership change increments `generation` in task metadata and records the runtime endpoint identity.
Herdr assignments bind `paneId`; Paseo assignments bind `agentId` as the endpoint and also persist `workspaceId`.
Every prompt and steering message carries task ID, project ID, owner, and generation.
A worker report is bound to the current endpoint and generation, so a stale pane or Paseo agent cannot update task lifecycle or reports.
For SLP, the project Lead has a separate generation from every task and Peer assignment generation.
A Lead rollover fences only the prior Lead generation; it does not increment or replace living Peer generations.

#### 7.5 Worker reports

Herdr workers report with `foreman report --status done|blocked|progress`, giving the summary as `--summary`, `--summary-file`, or standard input.
Paseo workers return one JSON object with `status` and a non-empty `summary` at the end of each turn; Foreman tolerates a leading Markdown horizontal rule emitted by the Paseo timeline and preserves the full original response.
Paseo workers do not invoke `foreman report` or depend on a stop hook.
`done` means the task is complete, `blocked` means only the user can unblock it, and `progress` means the worker stopped before finishing for another reason.
Each accepted report is stored verbatim under the task reports directory after an identity header of task, project, agent, generation, status, and report time.
Earlier reports are never overwritten.

A report is accepted only while the task is `working` or `blocked`.
`done` moves the task to `review-ready` and records the report as `completionReport`.
`blocked` moves the task to `blocked` and records the report as `blockerReport`.
`progress` leaves the task `working`.
Every report becomes `lastReport` in task metadata with `readAt` unset until the Foreman session has been shown it.
A scout's `done` report follows the same report lifecycle as other tasks.
Foreman does not scan or fingerprint project files; scout read-only scope is communicated only through the read-only resource lease shown in its brief.
For SLP, each Peer report remains bound to its child assignment and is delivered to the current project Lead, not interpreted as top-level task completion.
The normalized report includes status, concise summary, changed surfaces, checks with their evidence source, and open items; the original backend output remains verbatim evidence.
The Lead records child review milestones and separately reports whether the top-level task is ready, blocked, or in progress.
Only a Lead readiness report followed by human acceptance closes the top-level task.

#### 7.6 State schemas and migration

Every JSON record has a schema version, stable identity, owning writer, and explicit retirement or retention rule.
Foreman validates records before applying them and fails closed when an active record has an unsupported version or invalid identity binding.
Schema migrations are deterministic, atomic, restart-safe, and preserve the original record until the migrated replacement is durable.
Invalid external input is refused and cannot mutate canonical state.

Message, decision, and report records carry correlation fields sufficient to trace the full flow without relying on conversation history.
Core also regenerates the project-local current-state view from those canonical records; edits to the view never change task state.

#### 7.7 Durable message outbox

Every Foreman-to-worker message is persisted before runtime delivery.
The same outbox is used for task briefs, steering, follow-up requests, human decisions, and recovery instructions.
The worker receives a concise text prompt containing the task brief and only the operational details needed to work within its lease.
Every worker prompt is rendered by one fixed template.
A task brief has a header line with task, project, type, and generation, then workspace, branch, and allowed resources, followed by the sections `User request`, optional `Foreman notes`, optional `Previous work and handoff`, and `Report`.
The prompt carries no rules section; Git and resource limits are not restated to the worker.
A follow-up message or human decision has a header line naming its kind, task, and project, then the verbatim text and the same `Report` section.
The `Report` section uses the Herdr report command and stop-hook guidance for Herdr assignments, and the required JSON response shape for Paseo assignments.
The outbox retains the full message identity, payload, and delivery evidence privately.
For SLP, the outbox carries core-validated Lead-to-Peer instructions and routes normalized Peer reports and Foreman decisions to the current generation.
Lead requests have a separate durable identity and outcome so uncertain retries cannot create duplicate child work.

Each message records at least:

- message ID;
- message kind;
- task ID and project ID;
- worker, assignment generation, and endpoint binding;
- creation timestamp;
- original payload and payload digest;
- latest transport evidence;
- lifecycle state.

Message lifecycle is `pending`, `delivered`, or `failed`.
`delivered` means the selected runtime accepted prompt submission.
Foreman records the returned delivery evidence without interrupting the worker.

Messages are never resent automatically.
An uncertain task-brief submission is recorded for follow-up without stopping the worker or sending the same prompt again.
Workers do not acknowledge prompts; a new report or the runtime status is the evidence that work continues.

#### 7.8 Worker stop hook

`hooks/foreman-worker-stop.sh` is a stop hook for coding agents and may be installed globally; the user installs it.
It runs `foreman worker hook`, which reads the hook payload from standard input and never fails the agent.
It stays silent unless `FOREMAN_ROOT` and `HERDR_PANE_ID` are set, the pane is bound to a `working` task, the worker has not reported since Foreman last prompted it, and the payload does not mark the stop as already continued by a stop hook.
Otherwise it returns a block decision whose reason names the task and tells the agent to run `"$FOREMAN_ROOT/bin/foreman" report` with one of the three statuses before ending its turn.
The hook is a safety net: every worker prompt already carries the same report command.
It asks at most once per turn, so an agent that ignores it still stops.

#### 7.9 Decision records

Decision records live under `data/tasks/<id>/decisions/` and preserve the original Decision Package and the human response verbatim.
Each Decision Package contains the finding, why human authority is required, concrete options, impact, evidence, and either the worker recommendation or an explicit statement that no recommendation is available.

Decision lifecycle is `pending`, `answered`, and `delivered`.
Foreman does not resume authority-blocked work until the selected runtime accepts delivery to the current assignment generation; that delivery returns the task to `working`.

#### 7.10 Task types and dependencies

Every task has one immutable type:

- `ship` changes managed-project state and requires completion followed by user acceptance;
- `scout` investigates, audits, diagnoses, or researches and produces a report without modifying production code.

Promoting a scout result creates a new ship task from its report while the scout is review-ready; do this before accepting the scout because acceptance deletes its report.
A scout may use read-only resource claims and must not receive write or exclusive project leases.

A task may declare dependencies by stable task ID.
A task with unsatisfied dependencies remains queued and cannot be dispatched.
An accepted dependency is satisfied for any task type.
Acceptance removes that dependency ID from remaining tasks before deleting the completed task record.
Dependency cycles and cross-project dependency references to missing tasks are rejected.
When a dependency reaches its required terminal state, the scheduler reevaluates each dependent task and unlocks it exactly once when every dependency is satisfied.
For SLP child work, a prerequisite is satisfied only after the current Lead records review of the Peer completion evidence; this technical milestone is separate from human acceptance of the top-level task.
Reports and review evidence remain available until the top-level task closes even after a completed Peer releases its execution lease.

#### 7.11 Runtime classification

A status check compares each assigned task with one runtime listing and classifies the worker only from defined evidence:

- `working` and `idle` require runtime evidence plus matching endpoint identity;
- `waiting-input` means the runtime reports the agent blocked on input;
- `dead` requires explicit terminal runtime evidence;
- `missing` requires a successful runtime listing that omits the expected endpoint;
- `mismatch` means the listed agent's owner does not match the assignment;
- unreadable, contradictory, or insufficient evidence remains `unknown`.

An `idle` worker on a `working` task that has not reported since its last prompt is flagged `worker.idle-without-report`.
Project, workspace, branch, lease, and pane mismatches are reported as anomalies and make the state `unknown` unless it is `dead` or `missing`.
A status check never writes state, interrupts a worker, or starts recovery.

### 8. Runtime abstraction

Core supervision uses a narrow runtime adapter contract:

- list agents and stable endpoints;
- inspect agent state;
- spawn a worker at a validated client-prepared workspace;
- send a prompt or steering message;
- read bounded worker output;
- interrupt current worker execution without destroying the endpoint;
- verify delivery of a message;
- capture diagnostic output;
- stop an endpoint after the user accepts its task.

Every lifecycle action must return evidence that Foreman verifies through a subsequent inspection or other trusted runtime result.
Lifecycle commands are separate from normal worker messages and cannot be represented as chat instructions.
Relaunch is a Foreman recovery workflow composed from inspected stop or missing evidence, a new assignment generation, spawn, identity verification, and durable message delivery; it is not a runtime adapter primitive.

Herdr and Paseo are the implemented local adapters and follow the same backend-neutral task identity model.
Herdr pane IDs and Paseo agent IDs are stored as opaque backend metadata and do not replace task, project, owner, or generation identity.

Herdr must version-gate against the installed Herdr protocol it relies on and fail closed when required semantics cannot be verified.
Paseo uses the supported `@getpaseo/client` SDK surface, checks the selected daemon home and compatible daemon version, and fails closed when provider, model, workspace, endpoint, or timeline evidence cannot be verified.

An adapter may expose optional dispatch capabilities such as agent harness, model, and reasoning effort.
Foreman validates a selected dispatch profile against those capabilities before assignment and falls back only to an explicitly configured compatible profile.

#### 8.1 Backend entrypoints and implementation state

`foreman-herdr` and `foreman-paseo` are the backend-specific skill entrypoints.
Both use the same Foreman home and shared operational workflow.
Their CLI wrappers set `FOREMAN_BACKEND` only for the child process, so selecting a backend does not mutate the login shell or affect another Foreman session.
The Herdr entrypoint supports Herdr-backed task routing, dispatch, reports, supervision, recovery, and acceptance.
The Paseo entrypoint supports Paseo-backed task routing, dispatch, report collection, supervision, recovery, and acceptance.
Paseo routing uses `config/model-routing.json`; `config/paseo-agent-profiles.json` supplies the provider, model, mode, thinking, feature, and notes fields that the Paseo daemon needs.
`bin/foreman-paseo profiles sync` replaces repo-owned `foreman-*` profiles in the selected Paseo home, preserves other profiles and their order, and verifies the readback.
Profile sync is explicit and never runs during `init` or task creation.
Paseo agents use the `@getpaseo/client` SDK bridge, and their provider/model/mode/thinking/features are materialized from the profile selected and confirmed by the human.
Paseo task collection uses a persisted timeline cursor and turn completion evidence; idle state or prompt acceptance alone never marks a task complete.
Foreman never retries a Paseo operation through Herdr.

### 9. Worker, workspace, and resource model

#### 9.1 Dispatch

For mutation work, the client prepares a workspace on the current branch.
Foreman validates the workspace and binds it to the task and project in task metadata; Foreman never creates, switches, merges, or removes worktrees.

For a task using the registered project root, Foreman confirms that the canonical path exists as a directory and records no branch.
An explicitly selected Git worktree is checked against the registered project and its current branch.
A project without Git uses its canonical root path and has no branch.

Multiple workers may share a workspace when their declared resource leases do not conflict.
An undeclared mutation defaults to an exclusive project workspace lease.
A conflict is a warning, not a refusal, when the human requests the assignment: an explicit dispatch, adoption, or recovery proceeds and records the overlapping leases in its own lease as evidence.
This override applies to a legacy explicit human dispatch only; a Lead's automated SLP request never overrides a conflicting resource claim.

Resource keys are opaque hierarchical identifiers such as `file/src/auth/**`, `db/users/record/123`, `mcp/chrome/profile/default`, or `service/port/3000`.
Read/read claims may coexist; write or exclusive claims conflict on overlapping keys.
Leases have an owner and generation and are held until acceptance, reassignment, or a failed dispatch releases them; they do not expire, because no heartbeat renews them and a worker may run for a long time without reporting.
For SLP, a verified-stopped Peer may release its execution lease before human acceptance so a separate review Peer or non-conflicting task can proceed.
Its report and review evidence remain under the parent task until that task is accepted.

A preflight worker may return the structured resource claims and dependency hints.
Foreman treats that result as scheduling input, normalizes the claims, and defaults to an exclusive project-workspace lease when no plan is supplied.

#### 9.2 Worker brief

The dispatched brief includes:

- task ID, project ID, and workspace;
- user requirements verbatim;
- Foreman notes, kept separate from the user's words, may add supporting context such as related report paths but must not reinterpret the request or add requirements, limits, or rules;
- accepted follow-up decisions verbatim;
- canonical workspace, current branch, and project boundary;
- resource lease IDs and the declared resource claims;
- required deliverable and evidence contract, given as the backend's report command or JSON response shape.

The brief does not list worker rules such as scope, Git, or lease prohibitions; Git lifecycle remains client-owned.

#### 9.3 Worker communication

Herdr workers report through `"$FOREMAN_ROOT/bin/foreman" report`, which every Herdr worker prompt states and the stop hook in section 7.8 repeats when a worker stops without reporting.
Paseo workers return the required `status` and non-empty `summary` JSON object at the end of each turn.
Foreman collects Paseo reports using the persisted timeline cursor and current endpoint, workspace, generation, and turn evidence.
Foreman-to-worker communication uses the durable message outbox and text prompts in section 7.7; `foreman task message` sends a free-form request, and a request to a `blocked` or `review-ready` task returns it to `working`.
Workers never edit the project registry or task metadata.
For SLP, the current project Lead submits an identity-bound structured request through the same core; Herdr commands and Paseo finished-turn output map to one normalized request and report contract.
Lead request outcomes and Peer reports are routed back to the current Lead generation without requiring a conversational Foreman turn.

#### 9.4 Scheduling and concurrency

The scheduler dispatches only tasks whose dependencies are satisfied and whose required workspace, runtime lane, and resource leases are available; it leaves a conflicting task pending because no human chose to overlap it.
Fleet and per-project concurrency limits are explicit configuration, not hard-coded single-worker behavior.
The scheduler respects machine capacity, project limits, dependency state, workspace availability, and resource conflicts.

Tasks in the same project may run concurrently when their resource claims do not conflict.
They are not serialized only because they share a repository.
When isolated workspaces are required, the client must prepare and identify them before dispatch because Foreman does not create or switch worktrees.

An idle endpoint may receive another task only after its prior assignment is terminal, no message to it is pending, its resource lease is released safely, and a new assignment generation is bound and verified.
For SLP delivery tasks, accepting a task reconciles and removes only that task's Peer assignments and task-scoped records; the project Lead and other active or waiting tasks remain bound and supervised.
An SLP validation task that reaches `proof-complete` remains recorded as validation evidence and is not accepted or removed by the delivery acceptance command.

### 17. Deliberate initial decisions

- Repository model: standalone agent distribution.
- Runtime backends: Herdr and Paseo are implemented behind separate entrypoints and adapters; the task backend is stored with every assignment.
- Deployment: local machine only.
- State store: files with atomic writes and explicit locks; no database.
- Delivery mode: `local-only` first.
- Acceptance: user only.
- Merge authority: none in the initial release.
- Baseline supervision: Herdr stop-hook reports and Paseo turn-report collection during Foreman turns; no background observer.
- Project mutation: workers only, in client-prepared shared workspaces; resource leases guard concurrent mutation.
- Legacy code: preserved under `legacy/` until parity and cutover are proven.

## Constraints

The numbered sections above own the state, identity, transport, and concurrency boundaries.
Product behavior and safety invariants remain owned by the linked product contract.
The accepted project-scoped SLP decision amends this baseline only for project Lead identity and lifetime, core-mediated Lead requests, report routing, generated project state views, SLP resource and dependency milestones, event-driven observation, and per-task human acceptance.
Its coordinator lifecycle is one local process per `FOREMAN_HOME`, started by an SLP command, reconciled from canonical records after restart, and stopped only after active project Lead and Peer endpoints and durable messages drain.
The coordinator polls both existing adapters by assignment identity, retries read/inspect failures within a bounded cycle, and never blindly repeats an uncertain mutating operation.
All other compatible schema, identity, home-lock, backend, workspace, and safety constraints remain in force.

## Consequences

- Positive: Atomic file records and explicit identity bindings support durable restart without a database.
- Negative: Local-only operation, client-owned workspaces, non-expiring leases, and explicit supervision constrain automation.

## References

- [Product contract](../product/foreman-contract.md)
- [Accepted project-scoped Supervisor–Lead–Peer architecture decision](2026-10-02-project-scoped-supervisor-lead-peer.md)
- [Historical implementation baseline](../plans/completed/implementation-baseline.md)
- [Local operations](../runbooks/local-operations.md)
