# Foreman specification

Status: Draft 0.4 — P0/P1/P2 core paths implemented and regression-covered; P3 capability-gated
Scope: New standalone Foreman repository
Language: User-facing communication is Vietnamese; identifiers, paths, commands, and runtime state values remain verbatim.

## 1. Purpose

Foreman is a persistent multi-project software-work supervisor. The user works through one Foreman session; Foreman registers projects, records tasks, dispatches or adopts worker agents, supervises them through completion, preserves decisions and evidence on disk, and escalates only decisions or approvals that require the user.

Foreman is an agent distribution with its own operational home. It is not a project-local coding skill and is not part of any managed project's product code.

The existing repo-scoped experiment is preserved under `legacy/foreman-agent/`. It is reference material for behavior migration, not the target architecture.

## 2. Product boundary

Foreman owns:

- the fleet-wide project registry;
- task intake, priority, dependencies, assignment, lifecycle, and durable history;
- worker dispatch, adoption, steering, recovery, and handoff;
- workspace, resource-lease, and runtime-endpoint identity;
- event-driven supervision and restart recovery;
- concise user-facing status, decision, and approval packages;
- runtime adapters, initially Herdr only;
- operational state inside the Foreman home.

Managed projects own:

- their product and architecture authority;
- their repository instructions;
- source code, tests, configuration, and documentation;
- implementation evidence and delivery artifacts.

Workers own deep project context. They inspect, implement, reproduce, verify, and report. Foreman keeps global operational context and does not replace a worker's technical investigation.

## 3. Goals

1. One Foreman session can manage tasks across every registered local project.
2. All task, assignment, decision, progress, blocker, completion, and recovery state survives session reset.
3. Every task is bound to exactly one registered project, one current owner at most, and one runtime endpoint at most.
4. Project mutations happen through workers in a client-prepared workspace, with resource leases allowing safe concurrency.
5. Foreman can recover safely after its session, observer, or worker exits.
6. Supervision is event-driven and consumes no model tokens while nothing actionable happens.
7. The user sees conclusions, decisions, approvals, and material anomalies rather than worker transcripts or internal housekeeping.
8. Human intent and worker packages are retained verbatim before Foreman summarizes them.
9. Foreman never silently broadens authority, merges, discards work, or guesses recovery state.
10. The first production runtime backend is Herdr; the core state model must not depend on Herdr-specific identifiers.

## 4. Initial non-goals

The first production release does not include:

- tmux, Zellij, cmux, Orca, or other runtime backends;
- remote workers or remote Foreman homes;
- nested supervisors or secondmates;
- Discord, X, email, voice, or other relay channels;
- automatic PR merge or standing merge authority;
- autonomous product, business, security, compatibility, or architecture decisions;
- a database or continuously running LLM service;
- automatic model or quota optimization before the P3 dispatch-profile phase;
- direct production-code implementation by Foreman.

These capabilities may be designed later only when the core lifecycle and recovery invariants are already proven.

## 5. Core invariants

### 5.1 Durable restart

Conversation memory is never authoritative operational state. After a fresh session, Foreman must reconstruct its fleet view from tracked instructions, durable home data, runtime state, and one runtime reconciliation pass.

### 5.2 One supervisor writer

Exactly one Foreman session may mutate canonical backlog, task, assignment, decision, message lifecycle, or runtime state at a time.
A verified home lock is required before those mutations, and a session that cannot acquire the lock remains read-only.
The deterministic observer creates immutable pending event records in `state/events/worker/`.
A worker does not write that spool directly.
`foreman event emit` validates the current task, project, owner, generation, and endpoint, then creates the pending event itself.
A mismatched emit is quarantined and cannot change task lifecycle.
A worker may directly create only generation-bound inbox or acknowledgement records in its assigned paths.
Observer and worker writers must use atomic exclusive creation and must never edit canonical task state or records owned by another writer.

### 5.3 Exact project binding

Every task records a stable project ID. Before dispatch, steering, workspace operations, delivery, or cleanup, Foreman resolves that ID through the project registry and verifies the canonical project root. Runtime `cwd` is evidence, not durable project identity.

### 5.4 Foreman supervises; workers implement

Foreman does not write product code, investigate implementation in place of a living worker, or answer technical questions by guessing from repository state. It asks the owning worker for structured context and preserves the response.

### 5.5 Human acceptance authority

Worker completion moves a task to review-ready only. Only the user may accept a task. Merge, destructive cleanup, discard, force operations, and security-sensitive operations require explicit authority for the exact operation.

### 5.6 Verbatim authority transport

User requirements and decisions are persisted verbatim before being sent to a worker. Worker decision and completion packages are persisted verbatim before Foreman summarizes them. Summaries never replace the original package.

### 5.7 Single owner and safe handoff

A task has at most one current worker owner. Reassignment changes the assignment generation. Reports and events from an older generation cannot update the new owner's state.

### 5.8 No release of unlanded work

Foreman does not release a task's resource lease or mark its workspace reusable until the configured delivery path proves that all valuable work is landed and the client confirms workspace release, or the user explicitly authorizes discard.

### 5.9 Claims are attributed

Worker-reported tests and evidence remain worker claims until independently observed through a trusted automated result. User-facing output identifies the source once and does not present a claim as Foreman verification.

### 5.10 Minimal state

New durable state is added only when it enables restart recovery, removes the need for the user to inspect a worker, or protects a safety boundary. Every state record has one writer and an explicit retirement rule.

### 5.11 At-least-once coordination

Runtime delivery and wake-up are at-least-once operations.
Every message and event has a stable identity, retries reuse that identity, and consumers must handle duplicates idempotently.
Foreman never treats transport delivery as worker acknowledgement or wake delivery as event completion.

## 6. Repository and home layout

The implementation distinguishes tracked code from private operational state even when both initially live in one checkout.

```text
foreman/
├── AGENTS.md                  supervisor contract and router
├── SPEC.md                    product and architecture authority
├── docs/                      detailed durable architecture and runbooks
├── skills/                    conditionally loaded supervisor procedures
├── bin/                       deterministic helpers and runtime adapters
├── adapters/
│   └── herdr/                 Herdr-specific mechanics and compatibility checks
├── tests/                     state, recovery, observer, and adapter proof
├── legacy/
│   ├── foreman-agent/         preserved repo-scoped experiment
│   └── tests/                 preserved experiment tests
├── config/                    private operational choices; gitignored
├── data/                      durable private fleet records; gitignored
├── state/                     runtime records, locks, and events; gitignored
└── projects/                  optional client-owned workspace mount; not managed by Foreman
```

Definitions:

- `FOREMAN_ROOT`: tracked source checkout containing instructions, scripts, adapters, tests, and this specification.
- `FOREMAN_HOME`: private operational root containing `config/`, `data/`, and `state/`; client-owned workspaces live outside Foreman home.
- If `FOREMAN_HOME` is unset, it defaults to `FOREMAN_ROOT`.
- Every helper resolves and validates both roots before mutation.

## 7. Durable data model

### 7.1 Project registry

Canonical registry: `data/projects.json`.

Each project has:

```json
{
  "id": "ai-agent-workflow",
  "name": "AI Agent Workflow",
  "root": "/absolute/canonical/path/ai-agent-workflow",
  "defaultBranch": "main",
  "deliveryMode": "local-only",
  "enabled": true
}
```

Rules:

- `id` is stable, unique, lowercase, and path-independent.
- `root` must resolve to an existing Git worktree when the project is enabled.
- Duplicate canonical roots are rejected.
- A project outside the registry cannot receive work.
- Initial delivery mode is `local-only`; adding `pull-request` requires its own accepted design and proof.
- Registry writes are atomic.

### 7.2 Fleet backlog

Canonical backlog: `data/backlog.md`.

Task IDs are globally unique across projects:

- `T-` identifies requested change or investigation work.
- `B-` identifies an observed defect.

Lifecycle remains intentionally small:

- `[ ]`: queued and unassigned;
- `[~]`: owned by a worker;
- `[?]`: waiting for a user decision;
- `[v]`: worker reports completion and waits for user acceptance;
- `[x]`: user accepted; immediately archived out of the active backlog.

Each backlog item records the project ID:

```markdown
- [~] T-000123 [ai-agent-workflow] Add fleet project registry @worker-3 · 2026-09-21 15:20 · gen:2
```

Backlog order is priority. No separate priority field is introduced initially.

### 7.3 Task records

Durable records live under `data/tasks/<id>/`:

```text
data/tasks/T-000123/
├── brief.md          original user requirements and accepted additions
├── decisions/        versioned Decision Packages and verbatim human responses
├── report.md         latest original blocker or completion package
└── history.md        bounded lifecycle transitions and ownership generations
```

Runtime records live under `state/tasks/<id>/`:

```text
state/tasks/T-000123/
├── meta              project, owner, generation, workspace, branch, resources, backend, endpoint
├── progress          latest normalized operational snapshot
├── status            append-only worker/runtime events
└── inbox/            generation-bound worker packages and acknowledgements
```

Fleet-wide coordination records live under `state/`:

```text
state/
├── messages/         durable Foreman-to-worker outbox and message lifecycle
├── events/
│   └── worker/       durable events grouped by task id
│       └── T-000123/
│           └── E-<eventId>.json
├── connections/      derived worker registry and one record per assignment
│   ├── registry.json
│   └── T-000123-<owner>.json
├── wake/
│   └── foreman.json  wake signal for the Foreman session
└── observer/         deterministic observation cursor
```

Events that have no task live under `state/events/worker/_fleet/`.

Durable requirements and decisions live in `data/`. Ephemeral runtime coordination lives in `state/`. Runtime loss must not erase user intent or accepted decisions.

### 7.4 Assignment generation

Each ownership change increments `generation` in task metadata. Every prompt, report path, event, and steering message carries task ID, project ID, owner, and generation. A mismatched generation is quarantined and cannot update lifecycle or progress.

### 7.5 Progress snapshot

`state/tasks/<id>/progress` stores only the latest normalized snapshot:

```text
TASK: T-000123
PROJECT: ai-agent-workflow
AGENT: @worker-3
GENERATION: 2
UPDATED: 2026-09-21 15:20
LAST: reproduced duplicate dispatch
CURRENT: implementing generation guard
NEXT: run focused recovery scenario
BLOCKER: none
PROOF: reproduction observed; post-fix scenario not run
AFFECTED FILES: bin/foreman-dispatch
COMPLETION STATE: working

RAW PACKAGE
<latest original worker package>
```

Unknown values are `-`; Foreman never fills gaps by inference.

### 7.6 State schemas and migration

Every JSON record has a schema version, stable identity, owning writer, and explicit retirement or retention rule.
Foreman validates records before applying them and fails closed when an active record has an unsupported version or invalid identity binding.
Schema migrations are deterministic, atomic, restart-safe, and preserve the original record until the migrated replacement is durable.
Invalid external records are quarantined with their original contents and cannot mutate canonical state.

Message, acknowledgement, event, decision, and worker-package records carry correlation fields sufficient to trace the full flow without relying on conversation history.

### 7.7 Durable message outbox

Every Foreman-to-worker message is persisted before runtime delivery.
The same outbox is used for task briefs, steering, follow-up requests, human decisions, and recovery instructions.
Runtime delivery wraps the original payload in an envelope containing the message and assignment identity, payload digest, and generation-bound acknowledgement path, so the worker can acknowledge without reading private outbox state.

Each message records at least:

- message ID;
- message kind;
- task ID and project ID;
- worker, assignment generation, and endpoint binding;
- creation timestamp;
- original payload and payload digest;
- delivery attempts and latest transport evidence;
- lifecycle state.

Message lifecycle is `pending`, `delivered`, `acknowledged`, or `failed`.
`delivered` means only that the runtime accepted the send operation.
Only a valid generation-bound worker acknowledgement moves a message to `acknowledged`.

Unacknowledged messages are retried with the same message ID and bounded backoff.
A configured attempt or age limit moves a message to `failed` and emits an actionable event instead of retrying forever.
Foreman restart reloads every non-terminal message and reconciles it before issuing a retry.

Workers write acknowledgements to their generation-bound inbox.
An acknowledgement includes message ID, task ID, project ID, worker, generation, timestamp, and payload digest.
An acknowledgement with mismatched identity or digest is quarantined and cannot resume task execution.

### 7.8 Durable wake queue

The event spool is `state/events/worker/<taskId>/<eventId>.json`.
The file name is the stable event ID, so two observations of different evidence do not overwrite each other.
Each event record keeps its own lifecycle: `pending`, `processing`, or `handled`.

Each event records at least:

- event ID;
- deduplication key;
- task ID and project ID when applicable;
- worker, generation, and endpoint when applicable;
- event type and observation timestamp;
- normalized evidence and its source;
- lifecycle timestamps and handling result.

The observer persists an event before attempting to wake Foreman.
Foreman claims a pending event by exclusively creating the sibling claim file `<eventId>.json.claim`, then marking the record `processing`, while holding the home lock.
It applies the event idempotently, marks it `handled`, and removes the claim.
An expired processing claim returns the record to `pending` during restart reconciliation.
A stale claim left on a still-pending record is removed during the same recovery.
Handled events are retained for a bounded audit period and are then removed.

Wake delivery writes `state/wake/foreman.json` after the event is durable.
That file is a signal, not the queue.
It records whether any event is pending, the pending count, and the latest event identity.
A failed or overwritten wake signal does not change or delete the pending event.
Foreman restart drains the event records even when the wake file was lost.

Deduplication uses stable task, generation, event type, and evidence identity rather than event text alone.
A duplicate wake may occur, but applying the same event more than once must not repeat a lifecycle transition or runtime action.

Workers request an event through `foreman event emit <taskId> <type> --project <projectId> --worker <owner> --generation <generation> --endpoint <endpoint>`.
All assignment identity fields are mandatory; Foreman never fills omitted worker identity from current task state.
A type without a dot is stored as `worker.<type>`.
Workers cannot emit `message.*` or `task.*` supervisor events.
The same payload for the same assignment is stored once.
`blocked` and `done` still require a valid structured package before task lifecycle advances.
An emitted event alone does not apply that transition.

Legacy files under `state/events/pending`, `state/events/processing`, and `state/events/handled` are moved into the task spool on startup.
They are not a second queue.

### 7.9 Decision records

Decision records live under `data/tasks/<id>/decisions/` and preserve the original Decision Package and the human response verbatim.
Each Decision Package contains the finding, why human authority is required, concrete options, impact, evidence, and either the worker recommendation or an explicit statement that no recommendation is available.

Decision lifecycle is `pending`, `answered`, `delivered`, `acknowledged`, and `applied`.
Foreman does not resume authority-blocked work until the decision message is acknowledged by the current assignment generation.

### 7.10 Task types and dependencies

Every task has one immutable type:

- `ship` changes managed-project state and requires the delivery, acceptance, landing, and cleanup lifecycle;
- `scout` investigates, audits, diagnoses, or researches and produces a report without modifying production code.

Promoting a scout result creates a new linked ship task after user approval instead of changing the original task type.
A scout may use read-only resource claims and must not receive write or exclusive project leases.

A task may declare dependencies by stable task ID.
A task with unsatisfied dependencies remains queued and cannot be dispatched.
By default, a ship dependency is satisfied only when it is landed, while a scout dependency is satisfied when its report is accepted.
Dependency cycles and cross-project dependency references to missing tasks are rejected.
When a dependency reaches its required terminal state, the scheduler reevaluates each dependent task and unlocks it exactly once when every dependency is satisfied.

### 7.11 Worker registry

`state/connections/registry.json` is derived state.
Foreman is its only writer, and it writes the file under the home lock.
Each current assignment also has `state/connections/<taskId>-<owner>.json`.
The registry key is the runtime endpoint.
Each entry records the task ID, status, last heartbeat, pid, generation, last acknowledgement, and adapter.
`totalActive` counts entries whose status is `active`.

Assignment registers the worker as `active`.
A valid acknowledgement updates `lastAck`.
Reconciliation refreshes status from runtime classification.
Runtime state `working` is stored as `active`.
Endpoint release or replacement retires the previous record and removes it from `registry.json`.
A retired per-worker file remains on disk until a later assignment reuses the same task and owner.

`dead` requires explicit terminal runtime evidence.
`missing` requires a successful runtime listing that omits the expected endpoint after the configured confirmation window.
`foreman worker heartbeat` updates `lastHeartbeat` and `pid` for the current assignment only.
A heartbeat does not change runtime classification.
A stale or fresh heartbeat does not convert `unknown` to `dead` and does not override terminal runtime evidence.
Unreadable, contradictory, or insufficient evidence stays `unknown`.

## 8. Runtime abstraction

Core supervision uses a narrow runtime adapter contract:

- list agents and stable endpoints;
- inspect agent state;
- spawn a worker at a validated client-prepared workspace;
- send a prompt or steering message;
- read bounded worker output;
- interrupt current worker execution without destroying the endpoint;
- verify delivery of a message;
- capture diagnostic output;
- stop an endpoint only after cleanup authority is proven.

Every lifecycle action must return evidence that Foreman verifies through a subsequent inspection or other trusted runtime result.
Lifecycle commands are separate from normal worker messages and cannot be represented as chat instructions.
Relaunch is a Foreman recovery workflow composed from inspected stop or missing evidence, a new assignment generation, spawn, identity verification, and durable message delivery; it is not a runtime adapter primitive.

The first adapter is Herdr. Herdr identifiers are stored as opaque backend metadata and do not replace task, project, owner, or generation identity.

Foreman must version-gate against the installed Herdr protocol it relies on and fail closed when required semantics cannot be verified. It must not guess CLI syntax.

An adapter may expose optional dispatch capabilities such as agent harness, model, and reasoning effort.
Foreman validates a selected dispatch profile against those capabilities before assignment and falls back only to an explicitly configured compatible profile.

## 9. Worker, workspace, and resource model

### 9.1 Dispatch

For mutation work, the client prepares a workspace on the current branch. Foreman validates the workspace and binds it to the task and project in task metadata; Foreman never creates, switches, merges, or removes worktrees.

Multiple workers may share a workspace when their declared resource leases do not conflict. An undeclared mutation defaults to an exclusive project workspace lease.

Resource keys are opaque hierarchical identifiers such as `file/src/auth/**`, `db/users/record/123`, `mcp/chrome/profile/default`, or `service/port/3000`. Read/read claims may coexist; write or exclusive claims conflict on overlapping keys. Leases have an owner, generation, expiry, and heartbeat renewal.

A preflight worker may return the structured resource claims and dependency hints. Foreman treats that result as scheduling input, normalizes the claims, and defaults to an exclusive project-workspace lease when no plan is supplied.

### 9.2 Worker brief

The dispatched brief includes:

- task ID, project ID, assignment generation, and report path;
- user requirements verbatim;
- accepted follow-up decisions verbatim;
- canonical workspace, current branch, and project boundary;
- resource lease IDs and the declared resource claims;
- required deliverable and evidence contract;
- prohibition on expanding scope, changing lifecycle, or addressing the user directly;
- permission to write only the leased project resources and the exact generation-bound Foreman report/inbox path outside the workspace;
- prohibition on `git switch`, `git reset`, `git clean`, `git merge`, and `git commit`; Git lifecycle remains client-owned.

### 9.3 Worker communication

Routine progress responses are returned through the runtime output and normalized by Foreman.
Terminal blocker and completion packages are also written to the assigned generation-bound inbox path so they survive a missing Foreman session.
Foreman-to-worker communication always uses the durable message outbox and acknowledgement contract in section 7.7.

Workers never edit the fleet backlog, project registry, task metadata, or another assignment's inbox.

### 9.4 Scheduling and concurrency

The scheduler dispatches only tasks whose dependencies are satisfied and whose required workspace, runtime lane, and resource leases are available.
Fleet and per-project concurrency limits are explicit configuration, not hard-coded single-worker behavior.
The scheduler respects machine capacity, project limits, dependency state, workspace availability, and resource conflicts.

Tasks in the same project may run concurrently when their resource claims do not conflict.
They are not serialized only because they share a repository.
When isolated workspaces are required, the client must prepare and identify them before dispatch because Foreman does not create or switch worktrees.

An idle endpoint may receive another task only after its prior assignment is terminal, its messages and packages are reconciled, its resource lease is released safely, and a new assignment generation is bound and verified.

## 10. Supervision cycle

Every Foreman session starts with one bounded pass:

1. resolve `FOREMAN_ROOT` and `FOREMAN_HOME`;
2. acquire and verify the exclusive home lock;
3. read the project registry and active backlog;
4. apply valid generation-bound inbox packages;
5. drain durable observer events;
6. list Herdr runtime state once;
7. reconcile every assigned task against project, owner, generation, endpoint, workspace, branch, and resource-lease identity;
8. perform mandatory blocker, idle, dead-worker, or completion follow-up;
9. persist lifecycle and progress changes before reporting them;
10. ensure the observer is active while supervised work remains;
11. report only approvals, decisions, material anomalies, and requested detail.

Foreman does not continuously poll with an LLM after a turn. A deterministic observer writes durable events and wakes Foreman only for actionable changes.

### 10.1 Deterministic observer

The observer contains no LLM call and performs no task, decision, or backlog mutation.
It observes runtime endpoints and generation-bound worker files, compares them with its last durable observation, and emits an event only for a state change, mismatch, elapsed threshold, or other actionable condition.
No model tokens are consumed while no actionable event exists.

The observer distinguishes `working`, `idle`, `blocked`, `done`, `dead`, `missing`, and `unknown` only from defined evidence:

- `working` and `idle` require runtime evidence plus matching endpoint identity;
- `blocked` and `done` require a valid structured worker package for the current generation;
- `dead` requires explicit terminal runtime evidence;
- `missing` requires a successful runtime listing that omits the expected endpoint after the configured confirmation window;
- unreadable, contradictory, or insufficient evidence remains `unknown`.

The observer never converts `unknown` to `dead` and never initiates recovery itself.
A worker heartbeat is registry evidence.
It does not by itself satisfy `dead` or `missing`.
Endpoint, owner, project, workspace, or generation mismatch produces an anomaly event and prevents automatic task-state advancement.

### 10.2 Wake behavior

After persisting an actionable event, the observer writes `state/wake/foreman.json` and attempts a bounded wake through the configured local wake mechanism.
`WakeManager` watches the wake directory and invokes the Foreman session when the signal reports a pending event.
The Foreman session does not poll for work.
Wake failure does not change or delete the pending event.
Repeated observations of the same evidence reuse the event deduplication identity and do not create an unbounded queue.

### 10.3 Restart and fleet reconciliation

Startup reconciliation is deterministic and independent of conversation history.
It acquires the home lock, validates schemas, loads the project registry and active backlog, reconstructs active tasks, applies valid worker inbox and acknowledgement records, recovers expired processing events, drains the wake queue, and lists runtime workers once.

For each active task it reconciles project, owner, generation, endpoint, workspace, branch, resource lease, pending messages, disk state, and runtime state.
It reports or emits actionable state for a missing worker, endpoint mismatch, stale generation, missing workspace, invalid lease, or orphan runtime worker.
An orphan worker is reported but is not adopted, stopped, or sent work without explicit authority and verified project identity.

The reconciliation logic is shared by startup, event handling, and explicit full-status refresh so those paths cannot apply different identity rules.

## 11. Main workflows

### 11.1 Register project

1. Receive an explicit project path or clone request.
2. Resolve the canonical root and inspect repository identity.
3. Refuse duplicate IDs or roots.
4. Record project policy and initial delivery mode atomically.
5. Do not modify the managed project during registration.

### 11.2 Intake task

1. Persist the user's wording under a new global task ID.
2. Bind the task to one registered project.
3. Add it to the backlog in requested order.
4. Record dependencies without assigning work prematurely.
5. Dispatch only when the task is unblocked and a suitable runtime lane exists.

### 11.3 Dispatch task

1. Validate project, task, authority, dependency, and home lock.
2. Create a new assignment generation.
3. Receive and validate the client-prepared workspace and resource claims.
4. Persist the brief, pending assignment, and task-brief outbox message before runtime delivery.
5. Spawn the worker through the Herdr adapter.
6. Verify stable endpoint identity and deliver the persisted task-brief message.
7. Only after the current worker acknowledges the task brief does Foreman mark the task `[~]` and arm supervision.
8. Failed or unacknowledged delivery records an explicit recoverable pending state and follows the bounded retry contract; it never fabricates a working owner.

### 11.4 Adopt existing worker

Adoption requires an explicit user request naming the worker and requirement or existing queued task. Foreman verifies that the worker is active, belongs to the registered project, is not already assigned elsewhere, and can be bound without overwriting work. Adoption creates a new generation but does not resend the task as if it were new.

### 11.5 Blocker and decision

Worker-reported blockers first enter triage instead of being sent directly to the user.
Foreman requests a structured root cause, evidence, proposed next action, unresolved checks, and whether the worker can proceed within existing authority.
Technical blockers inside task scope return to the worker for further investigation through a durable follow-up message.
Triage retries are bounded so an unproductive worker cannot create an infinite message loop.

Foreman asks the user only when multiple materially valid outcomes require product, architecture, compatibility, security, operational, or acceptance authority.
A complete Decision Package is persisted before the question is summarized.
The human response is stored verbatim, delivered through the durable outbox to the current generation, and acknowledged before work resumes.

### 11.6 Completion and acceptance

Worker completion produces a Completion Package containing outcome, changed surface, direct evidence, unresolved checks, risk, and delivery state. Foreman moves the task to `[v]`, never `[x]`. User acceptance archives the task and permits the configured landing and cleanup path.

### 11.7 Dead worker and handoff

Foreman distinguishes `working`, `blocked`, `idle`, `done`, `unknown`, `dead`, and `missing` using adapter evidence. Only recovery-grade `dead` or `missing` permits automatic handoff. The successor receives original requirements, accepted decisions, latest snapshot, prior report, workspace state, resource claims, and an instruction to inspect rather than trust previous implementation assumptions.

Automatic recovery preserves the current workspace and resource lease, stops or verifies absence of the old endpoint, increments the assignment generation, and spawns a replacement worker.
The handoff package also includes affected files, available evidence, and unresolved checks.
The successor must inspect current workspace state before changing it and must not assume that prior implementation or reported evidence is correct.
Messages and packages from the old generation are quarantined and cannot mutate the replacement assignment.
Recovery attempts are bounded; exhaustion produces an actionable anomaly instead of an infinite relaunch loop.

### 11.8 Cleanup

Cleanup verifies delivery, workspace identity, resource lease, task generation, and endpoint binding. The client performs commit, merge, branch switching, reset, and workspace recycling. Unlanded work blocks lease release unless the user explicitly authorizes discard for that exact task.

### 11.9 Scout completion and promotion

A scout completes with an evidence-backed report and enters review-ready without a landing requirement.
User acceptance closes the scout and permits release of its read-only runtime resources.
If the report implies implementation work, Foreman creates a new ship task only after explicit user approval and links it to the source scout and accepted report.

## 12. User-facing reporting

Default output is short and grouped only when non-empty:

- `Cần bạn duyệt`
- `Cần bạn quyết`
- `Đang tự xử lý`
- `Bất thường`

A final count reports running and queued work. Each task appears once per response. Passed checks are counted; gaps, risks, and user actions are stated. Detailed worker packages are shown only when requested or required for a decision.

Fleet status may be filtered by project, task, worker, lifecycle, or anomaly. A request for full status actively refreshes every running assignment before reporting.

## 13. Safety and failure behavior

Foreman fails closed when:

- the home lock is unavailable;
- a project ID or canonical root is ambiguous;
- task metadata does not match runtime endpoint, workspace, branch, or resource identity;
- an assignment generation is stale;
- worker output cannot be attributed to the current assignment;
- Herdr state is unreadable or incompatible;
- cleanup cannot prove work is landed or the client has released the workspace;
- multiple valid user-authority choices remain unresolved.

Foreman preserves evidence and reports the exact uncertainty. It does not convert `unknown` into `dead`, retry destructive operations blindly, or route work to another project as fallback.

## 14. Core implementation roadmap

The legacy copy remains unchanged until equivalent behavior is proven in the new architecture.
Each phase must preserve the core invariants and add focused recovery and failure-path proof before the next phase depends on it.

### Phase P0: reliability foundation

1. Define versioned durable schemas, writer ownership, atomic migrations, quarantine behavior, and retention rules.
2. Add the durable message outbox, generation-bound acknowledgements, bounded retry, and restart recovery.
3. Extract one deterministic reconciliation engine for startup, event handling, and explicit refresh.
4. Add the durable wake queue with claim recovery, deduplication, and idempotent handling.
5. Add the deterministic observer and bounded local wake mechanism.
6. Integrate full startup reconciliation across projects, tasks, inbox packages, messages, events, resource leases, and one runtime listing.

### Phase P1: supervisor autonomy

1. Complete verified runtime lifecycle control with a distinct interrupt operation.
2. Add structured handoff and bounded automatic recovery for confirmed dead or missing workers.
3. Add the durable decision lifecycle and acknowledged human-decision delivery.
4. Add bounded blocker triage that separates technical blockers from authority blockers.
5. Add ship and scout task semantics before scheduler behavior depends on them.

### Phase P2: scheduling and fleet scale

1. Remove the single-project registration limit while preserving canonical project isolation.
2. Add task dependencies and deterministic dependency satisfaction rules.
3. Add scheduler-owned fleet and per-project concurrency limits.
4. Schedule concurrent work from dependency, workspace, runtime capacity, and resource-lease evidence.
5. Add fleet-wide and per-project status views backed by the same reconciliation state.

### Phase P3: dispatch optimization

1. Add explicit static dispatch profiles for agent harness, model, and reasoning effort.
2. Validate profiles against runtime adapter capabilities and provide an explicit compatible fallback.
3. Add policy-based selection only after real task evidence demonstrates that static profiles are insufficient.

### Deferred expansion

Pull-request delivery requires its own accepted authority, evidence, polling, and cleanup contract after `local-only` delivery is proven.
Additional backends, remote homes, relay channels, richer notifications, or autonomous reversible actions require separate accepted specifications.
They do not enter core by analogy with another supervisor product.

## 15. Roadmap acceptance criteria

### 15.1 P0 reliability foundation

P0 is complete only when all of the following are directly demonstrated:

1. Every active record is schema-validated, and an interrupted migration can restart without losing the original record.
2. Every worker message is durable before send, survives restart, retries with the same message ID, and cannot be acknowledged by the wrong task, worker, generation, or payload digest.
3. Transport delivery and worker acknowledgement remain distinct observable states.
4. Failed or expired message delivery emits one actionable event instead of retrying forever.
5. The deterministic observer consumes no model tokens while no actionable event exists.
6. An observer event survives Foreman downtime, duplicate observations do not produce duplicate effects, and an interrupted processing claim is recovered after restart.
7. A clean Foreman session reconstructs active state, applies valid inbox records, drains pending events, and reconciles all assignments from one runtime listing without conversation history.
8. Reconciliation detects missing workers, endpoint mismatch, stale generation, missing workspace, invalid resource leases, and orphan workers without guessing recovery state.
9. A second Foreman session cannot mutate canonical state, while the observer and workers remain limited to their explicitly owned write paths.

### 15.2 P1 supervisor autonomy

P1 is complete only when all of the following are directly demonstrated:

1. Spawn, inspect, send, read, interrupt, and stop actions have verified outcomes and lifecycle control is not encoded as normal chat.
2. A confirmed dead or missing worker is replaced with a new generation without losing the workspace, requirements, human decisions, progress, evidence, or unresolved checks.
3. `unknown` runtime state never triggers automatic recovery.
4. The replacement worker inspects existing state, and stale messages or packages from the prior generation cannot update the new assignment.
5. A technical blocker receives bounded worker follow-up, while an authority blocker produces one complete Decision Package for the user.
6. A human decision is preserved verbatim, delivered to the correct generation, and acknowledged before work resumes.
7. A scout cannot modify production code, completes through report acceptance, and can produce a linked ship task only after user approval.

## 16. Scale and optimization acceptance criteria

### 16.1 P2 scheduling and fleet scale

Multi-project support is complete only when:

1. At least two registered projects run assignments concurrently.
2. Project IDs and canonical roots cannot collide.
3. A worker or event from project A cannot mutate task state for project B.
4. Fleet restart reconstructs both projects from disk and one runtime listing.
5. Per-project status and fleet status agree on lifecycle and ownership.
6. Dispatch refuses an unregistered, disabled, missing, or relocated project until the registry is explicitly reconciled.
7. Workspace/resource cleanup in one project cannot address paths or endpoints belonging to another project.
8. A task with an unsatisfied or cyclic dependency cannot dispatch, and satisfying a valid dependency unlocks it exactly once.
9. Fleet and per-project concurrency limits prevent excess dispatch without serializing non-conflicting work unnecessarily.
10. Disjoint resource leases may run concurrently, while overlapping write or exclusive leases block dispatch.
11. A reused idle endpoint cannot receive a new task until its prior assignment and resources are safely reconciled and released.

### 16.2 P3 dispatch profiles

P3 is complete only when a supported static profile reaches the runtime unchanged, an unsupported profile fails before dispatch, and fallback occurs only through an explicitly configured compatible profile.

## 17. Deliberate initial decisions

- Repository model: standalone agent distribution.
- Runtime backend: Herdr only.
- Deployment: local machine only.
- State store: files with atomic writes and explicit locks; no database.
- Delivery mode: `local-only` first.
- Acceptance: user only.
- Merge authority: none in the initial release.
- Supervision: deterministic event observer plus on-demand Foreman turns.
- Project mutation: workers only, in client-prepared shared workspaces; resource leases guard concurrent mutation.
- Legacy code: preserved under `legacy/` until parity and cutover are proven.

## 18. Feature admission rule

A new feature belongs in Foreman core only if it passes every check:

1. Its necessary state survives a cleared session.
2. It preserves Foreman's global-context and worker deep-context boundary.
3. It preserves user wording, decisions, and original worker packages.
4. It keeps the user as acceptance and material-policy authority.
5. It materially reduces user coordination or protects fleet correctness.
6. Any new state has one writer, a stable identity, and a cleanup lifecycle.
7. It respects exact project, task, owner, generation, workspace, resource lease, and endpoint binding.
8. It can be proven through focused state, runtime, or recovery scenarios.
9. It does not add another backend or distribution mechanism without demonstrated need.
10. It does not copy a FirstMate feature merely because FirstMate has it.
 
## 19. First implementation milestone (historical baseline)

The first implementation milestone is a SPEC-first, single-project vertical slice. The implementation worker must persist this section before running milestone tests.

The milestone includes:

1. resolve and validate `FOREMAN_ROOT` and `FOREMAN_HOME`;
2. create the private home layout, atomic file primitives, and an exclusive home lock;
3. register exactly one local Git project without modifying that project;
4. allocate a global task ID and persist the user's requirements before dispatch;
5. persist assignment metadata with one owner and a generation;
6. validate a client-prepared workspace and resource lease bound to the task and project;
7. dispatch one worker through the Herdr adapter and verify delivery and endpoint identity;
8. persist generation-bound progress and completion packages without replacing their original wording;
9. reconstruct the task and assignment after clearing the Foreman session;
10. move completion to review-ready, require explicit user acceptance, and refuse cleanup while work is unlanded.

The worker must add focused automated scenarios for home locking, atomic persistence, project-boundary validation, generation rejection, restart reconstruction, and cleanup refusal. Tests are run only after this section is persisted. Observer, automatic handoff, multi-project concurrency, pull-request delivery, and additional runtime backends are outside this milestone.

Milestone implementation contract correction: the Herdr step is implemented behind a narrow, version-gated adapter seam. Deterministic milestone tests may inject a fake Herdr transport that returns the same delivery and endpoint identity evidence; the real adapter must fail closed when the installed Herdr protocol or required command semantics cannot be verified. This seam does not add another runtime backend or change Herdr ownership of dispatch.

## 20. Current implementation status

This section records the behavior present in the repository on 2026-09-22.
Sections 14–16 remain the normative roadmap and acceptance contract; this section records which paths are implemented and which limitations are explicit.

### 20.1 Implemented paths

- P0 durable coordination is implemented with schema-v1 validation at active-record load boundaries, an atomic migration seam that preserves the source record, durable outbox persistence before send, message IDs, task/project/worker/generation/endpoint bindings, payload digests, delivery and acknowledgement tracking, bounded backoff/age/attempt retries, durable pending/processing/handled wake queues, event deduplication, processing-claim recovery, and one-pass fleet reconciliation.
- A pending event is marked `handled` only when its handler returns `handled: true`.
- A missing handler, a rejected handler, or a handler that does not apply the event leaves that event `pending`.
- Production restart drains events before and after its single runtime listing.
- It applies dead or missing recovery, idle or completion follow-up, and blocker triage when the evidence is sufficient.
- It reports orphan, unknown, mismatch, and message anomalies without adopting an orphan or recovering from `unknown`.
- The deterministic observer compares runtime, project, workspace, branch, lease, message, inbox, endpoint, owner, and generation evidence.
- It emits actionable transitions and bounded wakes without model calls and never converts `unknown` into `dead`.
- `observer once`, `observer start`, `observer stop`, and `observer run` are production entry points.
- The start/stop loop stays up only while supervised work remains and wakes the same reconcile path.
- Restart reconciliation applies valid generation-bound inbox packages and acknowledgements before retrying messages and performing one runtime listing.
- Invalid external records are quarantined byte-for-byte.
- P1 lifecycle control is implemented through the Herdr adapter for spawn, inspect, send, read, interrupt, and stop.
- The compatibility gate checks the agent and pane verbs those calls use, including `agent send-keys`.
- Interrupt returns success only after a later inspection shows the endpoint still exists and is no longer working.
- Recovery composes inspect, stop or confirmed absence, a new generation, spawn, and durable handoff delivery.
- Confirmed `dead` or `missing` workers can be recovered with a bounded durable handoff message containing the brief, decisions, progress, report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
- The successor receives a new generation and stale records remain rejected.
- Blocker triage, bounded persisted technical follow-up, authority Decision Packages, verbatim human responses, acknowledged decision delivery, strict decision application, and scout-to-ship promotion are implemented.
- Adoption is an explicit request.
- It verifies an active runtime worker, project and cwd identity, and that the worker is not already assigned, then binds a new generation without sending the task again.
- A scout stores a workspace fingerprint at assignment.
- Completion, acceptance, and restart compare that fingerprint.
- Herdr does not sandbox the worker, so a detected production-file change is quarantined, reported, and refused.
- P2 multi-project binding, ship/scout task types, dependency validation and gating, resource-aware scheduling, per-project limits, fleet/per-project status views, and concurrent non-conflicting dispatch are implemented.
- The same proof covers concurrent assignments in two projects, cross-project package refusal, one restart listing, fleet and project status agreement, disabled or missing or relocated projects, cleanup that cannot address the other project, and idle-endpoint reuse only after the prior assignment is terminal and its messages and lease are released.
- P3 static dispatch-profile validation is implemented against runtime capabilities.
- A compatible fallback is accepted only when explicitly configured and is forwarded unchanged.
- `bin/foreman` is a thin wrapper over the core modules for dispatch, schedule, adopt, recover, decision lifecycle, accept, mark-landed, endpoint release, lease release, cleanup, reconcile, observer, and wake-driven follow-up.
- Default `status` and `task list` render the grouped Vietnamese report.
- `--json` keeps the machine-readable record.
- Production distribution artifacts are present under `AGENTS.md`, `skills/`, `docs/`, `bin/`, and `adapters/herdr/`.
- `legacy/` remains preserved but is not a production entry point.

### 20.2 Runtime proof

- On 2026-09-22, `npm test` ran 36 tests: 34 passed and 2 were skipped.
- The skipped tests are the live Herdr cases, and they stay skipped unless `RUN_HERDR_LIVE=1`.
- `npm run test:live` was not run for this status update.
- The installed runtime is Herdr 0.9.1 and `HERDR_ENV=1`, but the session already has active user agents, so spawning the live workers was not treated as a safe proof.

### 20.3 Explicit compatibility limits and deferrals

- Task briefs are strictly ACK-gated: an assignment remains `pending-ack` and stays `[ ]` until a current-generation ACK is verified.
- Disabling brief ACK-gating is rejected rather than treated as a valid dispatch mode.
- The current Herdr runtime exposes `agentKind` but not model or reasoning-effort capabilities, so those dispatch-profile fields fail closed until a compatible runtime is configured.
- No implicit model fallback is performed.
- Scout isolation is a before/after workspace fingerprint, not a runtime sandbox.
- Pull-request delivery, additional runtime backends, remote homes, relay channels, automatic model optimization, and autonomous merge authority remain deferred according to sections 4, 14, and 17.
