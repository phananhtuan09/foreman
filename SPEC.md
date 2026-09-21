# Foreman specification

Status: Draft 0.1  
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
- worktree and runtime-endpoint identity;
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
4. Project mutations happen through workers, normally in isolated worktrees.
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
- model/quota optimization;
- direct production-code implementation by Foreman.

These capabilities may be designed later only when the core lifecycle and recovery invariants are already proven.

## 5. Core invariants

### 5.1 Durable restart

Conversation memory is never authoritative operational state. After a fresh session, Foreman must reconstruct its fleet view from tracked instructions, durable home data, runtime state, and one runtime reconciliation pass.

### 5.2 One supervisor writer

Exactly one Foreman session may mutate a Foreman home at a time. A verified home lock is required before backlog, task, assignment, event, or runtime state mutation. A session that cannot acquire the lock remains read-only.

### 5.3 Exact project binding

Every task records a stable project ID. Before dispatch, steering, worktree operations, delivery, or cleanup, Foreman resolves that ID through the project registry and verifies the canonical project root. Runtime `cwd` is evidence, not durable project identity.

### 5.4 Foreman supervises; workers implement

Foreman does not write product code, investigate implementation in place of a living worker, or answer technical questions by guessing from repository state. It asks the owning worker for structured context and preserves the response.

### 5.5 Human acceptance authority

Worker completion moves a task to review-ready only. Only the user may accept a task. Merge, destructive cleanup, discard, force operations, and security-sensitive operations require explicit authority for the exact operation.

### 5.6 Verbatim authority transport

User requirements and decisions are persisted verbatim before being sent to a worker. Worker decision and completion packages are persisted verbatim before Foreman summarizes them. Summaries never replace the original package.

### 5.7 Single owner and safe handoff

A task has at most one current worker owner. Reassignment changes the assignment generation. Reports and events from an older generation cannot update the new owner's state.

### 5.8 No teardown of unlanded work

Foreman does not remove a worktree, branch, endpoint, or task record until the configured delivery path proves that all valuable work is landed or the user explicitly authorizes discard.

### 5.9 Claims are attributed

Worker-reported tests and evidence remain worker claims until independently observed through a trusted automated result. User-facing output identifies the source once and does not present a claim as Foreman verification.

### 5.10 Minimal state

New durable state is added only when it enables restart recovery, removes the need for the user to inspect a worker, or protects a safety boundary. Every state record has one writer and an explicit retirement rule.

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
└── projects/                  optional managed clones/worktrees; gitignored
```

Definitions:

- `FOREMAN_ROOT`: tracked source checkout containing instructions, scripts, adapters, tests, and this specification.
- `FOREMAN_HOME`: private operational root containing `config/`, `data/`, `state/`, and optionally `projects/`.
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
├── decisions.md      verbatim user decisions and their worker delivery receipts
├── report.md         latest original blocker or completion package
└── history.md        bounded lifecycle transitions and ownership generations
```

Runtime records live under `state/tasks/<id>/`:

```text
state/tasks/T-000123/
├── meta              project, owner, generation, worktree, backend, endpoint
├── progress          latest normalized operational snapshot
├── status            append-only worker/runtime events
├── inbox/            generation-bound worker packages and steering receipts
└── events/           observer events waiting for reconciliation
```

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

## 8. Runtime abstraction

Core supervision uses a narrow runtime adapter contract:

- list agents and stable endpoints;
- inspect agent state;
- spawn a worker at a validated worktree;
- send a prompt or steering message;
- read bounded worker output;
- verify delivery of a message;
- capture diagnostic output;
- stop an endpoint only after cleanup authority is proven.

The first adapter is Herdr. Herdr identifiers are stored as opaque backend metadata and do not replace task, project, owner, or generation identity.

Foreman must version-gate against the installed Herdr protocol it relies on and fail closed when required semantics cannot be verified. It must not guess CLI syntax.

## 9. Worker and worktree model

### 9.1 Dispatch

For mutation work, Foreman creates or validates an isolated worktree before spawning a worker. The worktree is bound to the task and project in task metadata.

For read-only investigation, a project checkout may be used only when the worker cannot mutate it and the selected workflow explicitly permits that mode.

### 9.2 Worker brief

The dispatched brief includes:

- task ID, project ID, assignment generation, and report path;
- user requirements verbatim;
- accepted follow-up decisions verbatim;
- canonical worktree and project boundary;
- required deliverable and evidence contract;
- prohibition on expanding scope, changing lifecycle, or addressing the user directly;
- permission to write only the exact generation-bound Foreman report/inbox path outside the worktree.

### 9.3 Worker communication

Routine progress responses are returned through the runtime output and normalized by Foreman. Terminal blocker and completion packages are also written to the assigned generation-bound inbox path so they survive a missing Foreman session.

Workers never edit the fleet backlog, project registry, task metadata, or another assignment's inbox.

## 10. Supervision cycle

Every Foreman session starts with one bounded pass:

1. resolve `FOREMAN_ROOT` and `FOREMAN_HOME`;
2. acquire and verify the exclusive home lock;
3. read the project registry and active backlog;
4. apply valid generation-bound inbox packages;
5. drain durable observer events;
6. list Herdr runtime state once;
7. reconcile every assigned task against project, owner, generation, endpoint, and worktree identity;
8. perform mandatory blocker, idle, dead-worker, or completion follow-up;
9. persist lifecycle and progress changes before reporting them;
10. ensure the observer is active while supervised work remains;
11. report only approvals, decisions, material anomalies, and requested detail.

Foreman does not continuously poll with an LLM after a turn. A deterministic observer writes durable events and wakes Foreman only for actionable changes.

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
3. Create or validate the task worktree.
4. Persist the brief and pending assignment before runtime delivery.
5. Spawn the worker through the Herdr adapter.
6. Verify delivery and stable endpoint identity.
7. Only then mark the task `[~]` and arm supervision.
8. Failed delivery rolls back or records an explicit recoverable pending state; it never fabricates a live owner.

### 11.4 Adopt existing worker

Adoption requires an explicit user request naming the worker and requirement or existing queued task. Foreman verifies that the worker is active, belongs to the registered project, is not already assigned elsewhere, and can be bound without overwriting work. Adoption creates a new generation but does not resend the task as if it were new.

### 11.5 Blocker and decision

Technical blockers inside task scope return to the worker for further investigation. Foreman asks the user only when multiple materially valid outcomes require product, architecture, compatibility, security, operational, or acceptance authority. A complete Decision Package is persisted before the question is summarized.

### 11.6 Completion and acceptance

Worker completion produces a Completion Package containing outcome, changed surface, direct evidence, unresolved checks, risk, and delivery state. Foreman moves the task to `[v]`, never `[x]`. User acceptance archives the task and permits the configured landing and cleanup path.

### 11.7 Dead worker and handoff

Foreman distinguishes `working`, `blocked`, `idle`, `done`, `unknown`, `dead`, and `missing` using adapter evidence. Only recovery-grade `dead` or `missing` permits automatic handoff. The successor receives original requirements, accepted decisions, latest snapshot, prior report, worktree state, and an instruction to inspect rather than trust previous implementation assumptions.

### 11.8 Cleanup

Cleanup verifies delivery, Git state, worktree identity, task generation, and endpoint binding. Uncommitted, unpushed, unmerged, or otherwise unlanded work blocks teardown unless the user explicitly authorizes discard for that exact task.

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
- task metadata does not match runtime endpoint or worktree identity;
- an assignment generation is stale;
- worker output cannot be attributed to the current assignment;
- Herdr state is unreadable or incompatible;
- cleanup cannot prove work is landed;
- multiple valid user-authority choices remain unresolved.

Foreman preserves evidence and reports the exact uncertainty. It does not convert `unknown` into `dead`, retry destructive operations blindly, or route work to another project as fallback.

## 14. Migration from the legacy experiment

The legacy copy remains unchanged until equivalent behavior is proven in the new architecture.

### Phase A: standalone single-project parity

- Establish `FOREMAN_ROOT`, `FOREMAN_HOME`, home lock, and private directories.
- Port lifecycle, progress snapshots, inbox packages, reporting, and observer behavior.
- Register one project and operate through the central home.
- Prove assignment, adoption, status refresh, blocker, decision, completion, dead worker, and restart scenarios.

### Phase B: multi-project registry

- Add project registration and canonical root validation.
- Bind every task and runtime operation to a project ID.
- Prove two projects can run concurrently without state, worker, event, or worktree crossover.
- Add fleet and per-project reporting.

### Phase C: worktree and worker lifecycle

- Add safe worktree creation, spawn, handoff, and cleanup.
- Prove interrupted spawn recovery and stale-generation rejection.
- Prove unlanded work prevents teardown.

### Phase D: delivery

- Complete the `local-only` delivery path first.
- Add pull-request delivery only after its authority, evidence, polling, and cleanup contracts are specified and tested.

### Phase E: optional expansion

Additional backends, remote homes, away mode, richer notifications, or autonomous reversible actions require separate accepted specifications. They do not enter core by analogy with FirstMate.

## 15. Acceptance criteria for the first milestone

The first milestone is complete only when all of the following are directly demonstrated:

1. A clean Foreman session registers one local project without modifying it.
2. A task is persisted before dispatch and can be reconstructed after clearing the session.
3. A Herdr worker is bound to the correct project, worktree, task, owner, and generation.
4. Progress, blocker, decision, completion, and acceptance transitions preserve their original packages.
5. A stale worker package cannot update a reassigned task.
6. A dead worker can be handed off without losing user requirements or accepted decisions.
7. Observer events survive Foreman downtime and reconcile once after restart.
8. A second Foreman session cannot mutate the same home.
9. Foreman does not write production code in the managed project.
10. Cleanup refuses unlanded work.
11. Default reporting contains no duplicate task and no empty status group.
12. Focused automated scenarios cover state transitions, generation guards, observer deduplication, lock refusal, restart recovery, project-boundary rejection, and cleanup refusal.

## 16. Multi-project acceptance criteria

Multi-project support is complete only when:

1. At least two registered projects run assignments concurrently.
2. Project IDs and canonical roots cannot collide.
3. A worker or event from project A cannot mutate task state for project B.
4. Fleet restart reconstructs both projects from disk and one runtime listing.
5. Per-project status and fleet status agree on lifecycle and ownership.
6. Dispatch refuses an unregistered, disabled, missing, or relocated project until the registry is explicitly reconciled.
7. Worktree cleanup in one project cannot address paths or endpoints belonging to another project.

## 17. Deliberate initial decisions

- Repository model: standalone agent distribution.
- Runtime backend: Herdr only.
- Deployment: local machine only.
- State store: files with atomic writes and explicit locks; no database.
- Delivery mode: `local-only` first.
- Acceptance: user only.
- Merge authority: none in the initial release.
- Supervision: deterministic event observer plus on-demand Foreman turns.
- Project mutation: workers only, in isolated worktrees for mutation tasks.
- Legacy code: preserved under `legacy/` until parity and cutover are proven.

## 18. Feature admission rule

A new feature belongs in Foreman core only if it passes every check:

1. Its necessary state survives a cleared session.
2. It preserves Foreman's global-context and worker deep-context boundary.
3. It preserves user wording, decisions, and original worker packages.
4. It keeps the user as acceptance and material-policy authority.
5. It materially reduces user coordination or protects fleet correctness.
6. Any new state has one writer, a stable identity, and a cleanup lifecycle.
7. It respects exact project, task, owner, generation, worktree, and endpoint binding.
8. It can be proven through focused state, runtime, or recovery scenarios.
9. It does not add another backend or distribution mechanism without demonstrated need.
10. It does not copy a FirstMate feature merely because FirstMate has it.
 
## 19. First implementation milestone

The first implementation milestone is a SPEC-first, single-project vertical slice. The implementation worker must persist this section before running milestone tests.

The milestone includes:

1. resolve and validate `FOREMAN_ROOT` and `FOREMAN_HOME`;
2. create the private home layout, atomic file primitives, and an exclusive home lock;
3. register exactly one local Git project without modifying that project;
4. allocate a global task ID and persist the user's requirements before dispatch;
5. persist assignment metadata with one owner and a generation;
6. create or validate an isolated worktree bound to the task and project;
7. dispatch one worker through the Herdr adapter and verify delivery and endpoint identity;
8. persist generation-bound progress and completion packages without replacing their original wording;
9. reconstruct the task and assignment after clearing the Foreman session;
10. move completion to review-ready, require explicit user acceptance, and refuse cleanup while work is unlanded.

The worker must add focused automated scenarios for home locking, atomic persistence, project-boundary validation, generation rejection, restart reconstruction, and cleanup refusal. Tests are run only after this section is persisted. Observer, automatic handoff, multi-project concurrency, pull-request delivery, and additional runtime backends are outside this milestone.

Milestone implementation contract correction: the Herdr step is implemented behind a narrow, version-gated adapter seam. Deterministic milestone tests may inject a fake Herdr transport that returns the same delivery and endpoint identity evidence; the real adapter must fail closed when the installed Herdr protocol or required command semantics cannot be verified. This seam does not add another runtime backend or change Herdr ownership of dispatch.
