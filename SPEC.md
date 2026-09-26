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
5. Foreman can recover safely after its session or a worker exits.
6. Supervision is event-driven and consumes no model tokens while nothing actionable happens.
7. The user sees conclusions, decisions, approvals, and material anomalies rather than worker transcripts or internal housekeeping.
8. Human intent and worker reports are retained verbatim before Foreman summarizes them.
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

Conversation memory is never authoritative operational state. After a fresh session, Foreman must reconstruct its fleet view from tracked instructions, durable home data, runtime state, and one status check.

### 5.2 One supervisor writer

Exactly one Foreman session may mutate canonical task, assignment, decision, message lifecycle, or runtime state at a time.
A verified home lock is required before those mutations, and a session that cannot acquire the lock remains read-only.
A worker changes Foreman state only through `foreman report`.
That command identifies the worker by its Herdr pane, validates the current assignment under the home lock, and writes the report and the resulting lifecycle change itself.
A report from a pane that is not bound to an active assignment is refused and changes nothing.
Workers never edit task metadata or records owned by another writer.

### 5.3 Exact project binding

Every task records a stable project ID.
Before dispatch, steering, workspace operations, or acceptance, Foreman resolves that ID through the project registry and confirms its canonical root still exists as a directory.
For an explicitly selected Git worktree outside that root, Foreman verifies that the worktree belongs to the registered project.
Runtime `cwd` is evidence, not durable project identity.

### 5.4 Foreman supervises; workers implement

Foreman does not write product code, investigate implementation in place of a living worker, or answer technical questions by guessing from repository state. It asks the owning worker for structured context and preserves the response.

### 5.5 Human acceptance authority

Worker completion moves a task to review-ready only. Only the user may accept a task.
Acceptance verifies and stops its worker, releases its resource lease, and deletes its task records and task-scoped coordination records.
Acceptance retains the project workspace and does not commit, merge, reset, or remove project files.
Foreman does not retain accepted task history.

### 5.6 Verbatim authority transport

User requirements and decisions are persisted verbatim before being sent to a worker.
Worker reports are persisted verbatim before Foreman summarizes them.
Summaries never replace the original report.

### 5.7 Single owner and safe handoff

A task has at most one current worker owner.
Reassignment changes the assignment generation and binds a new worker pane.
Reports from an older generation's pane cannot update the new owner's state.

### 5.8 Acceptance ends task supervision

User acceptance ends task supervision and releases its worker endpoint and resource lease.
Foreman keeps the project workspace on disk and removes the task's Foreman records.

### 5.9 Claims are attributed

Worker-reported tests and evidence remain worker claims until independently observed through a trusted automated result. User-facing output identifies the source once and does not present a claim as Foreman verification.

### 5.10 Minimal state

New durable state is added only when it enables restart recovery, removes the need for the user to inspect a worker, or protects a safety boundary. Every state record has one writer and an explicit retirement rule.

### 5.11 Durable coordination

Runtime messages are persisted before sending and are not resent after Herdr accepts them.
Foreman treats a delayed inspection as endpoint evidence, not proof that the worker consumed a prompt.
Supervision is pull-based: no background process watches workers, and a worker never sends prompts into the Foreman session.

## 6. Repository and home layout

The implementation distinguishes tracked code from private operational state even when both initially live in one checkout.

```text
foreman/
├── AGENTS.md                  supervisor contract and router
├── SPEC.md                    product and architecture authority
├── docs/                      detailed durable architecture and runbooks
├── .agents/skills/            conditionally loaded Foreman workflows for Codex
├── config/model-routing.json  tracked model routing configuration
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
- Model routing reads the tracked `FOREMAN_ROOT/config/model-routing.json`; it does not read a same-named file in `FOREMAN_HOME`.
- If `FOREMAN_HOME` is unset, it defaults to `FOREMAN_ROOT`.
- Every helper resolves and validates both roots before mutation.
- `foreman init` run in the Foreman checkout records that checkout as `FOREMAN_ROOT` and `FOREMAN_HOME` (or `--home`) in the startup file of the machine's login shell: `$ZDOTDIR/.zshrc` or `~/.zshrc` for zsh, `~/.bashrc` for bash (`~/.bash_profile` on macOS), `~/.config/fish/conf.d/foreman.fish` for fish, and `~/.profile` for `sh`, `dash`, `ksh`, or `mksh`.
- It rewrites only its own marked block, leaves the rest of the file unchanged, and refuses an unrecognized shell by printing the lines to add manually.
- Worker panes opened after `init` inherit both variables, which the worker stop hook and `foreman report` rely on.

## 7. Durable data model

### 7.1 Project registry

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

### 7.2 Fleet task list

There is no separate backlog file.
The fleet task list is the set of task metadata records under `data/tasks/`.
`foreman status` and `foreman task list` render it from those records.

Task IDs are globally unique across projects:

- `T-` identifies requested change or investigation work.
- `B-` identifies an observed defect.

Task lifecycle is the `status` field of task metadata.
Acceptance deletes the task directory instead of archiving it.
No separate priority field is introduced initially.

### 7.3 Task records

Task records live under `data/tasks/<id>/` until user acceptance or explicit discard of an untouched queued task:

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
`foreman task discard --task ID` removes only a queued task with no owner, endpoint, workspace, resource lease, report, or handoff, and refuses while another task depends on it. Discard also removes its task-scoped messages and runs under the home lock; it never stops a worker because no worker may be bound.

### 7.4 Assignment generation

Each ownership change increments `generation` in task metadata and records the new worker's Herdr pane as `paneId`.
Every prompt and steering message carries task ID, project ID, owner, and generation.
A worker report is bound to the assignment through its pane, so a pane from an older generation cannot update lifecycle or reports.

### 7.5 Worker reports

A worker reports with `foreman report --status done|blocked|progress`, giving the summary as `--summary`, `--summary-file`, or standard input.
`done` means the task is complete, `blocked` means only the user can unblock it, and `progress` means the worker stopped before finishing for another reason.
Each report is stored verbatim as `reports/generation-<n>-<seq>-<status>.md` after an identity header of task, project, agent, generation, status, and report time.
Earlier reports are never overwritten.

A report is accepted only while the task is `working` or `blocked`.
`done` moves the task to `review-ready` and records the report as `completionReport`.
`blocked` moves the task to `blocked` and records the report as `blockerReport`.
`progress` leaves the task `working`.
Every report becomes `lastReport` in task metadata with `readAt` unset until the Foreman session has been shown it.
A scout's `done` report follows the same report lifecycle as other tasks.
Foreman does not scan or fingerprint project files; scout read-only scope is communicated through its brief and read-only resource lease.

### 7.6 State schemas and migration

Every JSON record has a schema version, stable identity, owning writer, and explicit retirement or retention rule.
Foreman validates records before applying them and fails closed when an active record has an unsupported version or invalid identity binding.
Schema migrations are deterministic, atomic, restart-safe, and preserve the original record until the migrated replacement is durable.
Invalid external input is refused and cannot mutate canonical state.

Message, decision, and report records carry correlation fields sufficient to trace the full flow without relying on conversation history.

### 7.7 Durable message outbox

Every Foreman-to-worker message is persisted before runtime delivery.
The same outbox is used for task briefs, steering, follow-up requests, human decisions, and recovery instructions.
The worker receives a concise text prompt containing the task brief and only the operational details needed to work within its lease.
Every worker prompt is rendered by one fixed template.
A task brief has a header line with task, project, type, and generation, then workspace, branch, and allowed resources, followed by the sections `User request`, optional `Foreman notes`, optional `Previous work and handoff`, `Rules`, and `Report`.
A follow-up message or human decision has a header line naming its kind, task, and project, then the verbatim text and the same `Report` section.
The `Report` section carries the same report command and status guidance as the worker stop hook.
The outbox retains the full message identity, payload, and delivery evidence privately.

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
`delivered` means that Herdr accepted prompt submission.
Foreman inspects the endpoint after a short delay and records the observed status without interrupting it.

Messages are never resent automatically.
An uncertain task-brief submission is recorded for follow-up without stopping the worker or sending the same prompt again.
Workers do not acknowledge prompts; a new report or the runtime status is the evidence that work continues.

### 7.8 Worker stop hook

`hooks/foreman-worker-stop.sh` is a stop hook for coding agents and may be installed globally; the user installs it.
It runs `foreman worker hook`, which reads the hook payload from standard input and never fails the agent.
It stays silent unless `FOREMAN_ROOT` and `HERDR_PANE_ID` are set, the pane is bound to a `working` task, the worker has not reported since Foreman last prompted it, and the payload does not mark the stop as already continued by a stop hook.
Otherwise it returns a block decision whose reason names the task and tells the agent to run `"$FOREMAN_ROOT/bin/foreman" report` with one of the three statuses before ending its turn.
The hook is a safety net: every worker prompt already carries the same report command.
It asks at most once per turn, so an agent that ignores it still stops.

### 7.9 Decision records

Decision records live under `data/tasks/<id>/decisions/` and preserve the original Decision Package and the human response verbatim.
Each Decision Package contains the finding, why human authority is required, concrete options, impact, evidence, and either the worker recommendation or an explicit statement that no recommendation is available.

Decision lifecycle is `pending`, `answered`, and `delivered`.
Foreman does not resume authority-blocked work until Herdr accepts delivery to the current assignment generation; that delivery returns the task to `working`.

### 7.10 Task types and dependencies

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

### 7.11 Runtime classification

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
- stop an endpoint after the user accepts its task.

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

For a task using the registered project root, Foreman confirms that the canonical path exists as a directory and records no branch.
An explicitly selected Git worktree is checked against the registered project and its current branch.
A project without Git uses its canonical root path and has no branch.

Multiple workers may share a workspace when their declared resource leases do not conflict. An undeclared mutation defaults to an exclusive project workspace lease.

Resource keys are opaque hierarchical identifiers such as `file/src/auth/**`, `db/users/record/123`, `mcp/chrome/profile/default`, or `service/port/3000`. Read/read claims may coexist; write or exclusive claims conflict on overlapping keys. Leases have an owner and generation and are held until acceptance, reassignment, or a failed dispatch releases them; they do not expire, because no heartbeat renews them and a worker may run for a long time without reporting.

A preflight worker may return the structured resource claims and dependency hints. Foreman treats that result as scheduling input, normalizes the claims, and defaults to an exclusive project-workspace lease when no plan is supplied.

### 9.2 Worker brief

The dispatched brief includes:

- task ID, project ID, and workspace;
- user requirements verbatim;
- Foreman notes, kept separate from the user's words, when Foreman adds context such as related report paths;
- accepted follow-up decisions verbatim;
- canonical workspace, current branch, and project boundary;
- resource lease IDs and the declared resource claims;
- required deliverable and evidence contract, given as the report command and status guidance;
- prohibition on expanding scope, changing lifecycle, or addressing the user directly;
- permission to write only the leased project resources;
- prohibition on `git switch`, `git reset`, `git clean`, `git merge`, and `git commit`; Git lifecycle remains client-owned.

### 9.3 Worker communication

Workers report only through `"$FOREMAN_ROOT/bin/foreman" report`, which every worker prompt states and the stop hook in section 7.8 repeats when a worker stops without reporting.
Foreman-to-worker communication uses the durable message outbox and text prompts in section 7.7; `foreman task message` sends a free-form request, and a request to a `blocked` or `review-ready` task returns it to `working`.
Workers never edit the project registry or task metadata.

### 9.4 Scheduling and concurrency

The scheduler dispatches only tasks whose dependencies are satisfied and whose required workspace, runtime lane, and resource leases are available.
Fleet and per-project concurrency limits are explicit configuration, not hard-coded single-worker behavior.
The scheduler respects machine capacity, project limits, dependency state, workspace availability, and resource conflicts.

Tasks in the same project may run concurrently when their resource claims do not conflict.
They are not serialized only because they share a repository.
When isolated workspaces are required, the client must prepare and identify them before dispatch because Foreman does not create or switch worktrees.

An idle endpoint may receive another task only after its prior assignment is terminal, no message to it is pending, its resource lease is released safely, and a new assignment generation is bound and verified.

## 10. Supervision cycle

Supervision runs only inside Foreman turns; there is no observer, heartbeat, or event queue.

1. On its first operational turn, a Foreman session runs `foreman init` so the shell environment points at this checkout.
2. Before answering the user, the session reads the supervision context from its prompt hook, or runs `foreman status` when that context is absent.
3. It reads each new worker report named in the context from its file.
4. It acts on anomalies: it sends a follow-up with `foreman task message`, creates a Decision Package, or confirms a dead or missing worker with a second status check before `foreman task recover`.
5. It persists lifecycle changes before reporting them.
6. It reports only approvals, decisions, material anomalies, and requested detail.

### 10.1 Status check

`foreman status` lists Herdr runtime state once and classifies every assigned task as in section 7.11.
It does not interrupt workers, write state, or recover anything.

### 10.2 Foreman session context

`hooks/foreman-session-context.sh` is the Foreman session's prompt hook, configured for Claude Code in `.claude/settings.json` and for Codex at project scope in `.codex/hooks.json`.
Codex hook support is enabled for the project in `.codex/config.toml`; the project must be trusted and the hook must be reviewed before it runs.
`foreman session context` prints nothing for a prompt starting with `DEV`, when nothing is new, or when the session's `cwd` is outside the Foreman checkout.
Otherwise it returns `hookSpecificOutput.additionalContext`, which Claude Code and Codex both read, listing each unread worker report with its task, status, time, task status, and report path, plus the anomalies of one status check when `HERDR_ENV=1`.
The reports it prints are marked read.
Report text is worker input; the context gives the file path rather than the text.

### 10.3 Restart

A fresh session reconstructs its view from `data/` and one status check.
Nothing is lost while no Foreman session runs: reports stay unread until a session is shown them.

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
3. Record its task metadata.
4. Record dependencies without assigning work prematurely.
5. Dispatch only when the task is unblocked and a suitable runtime lane exists.

### 11.3 Dispatch task

1. Validate project, task, authority, dependency, and home lock.
2. Create a new assignment generation.
3. Receive and validate the client-prepared workspace and resource claims.
4. Persist the brief, pending assignment, and task-brief outbox message before runtime delivery.
5. Spawn the worker through the Herdr adapter.
6. Verify stable endpoint identity and deliver the persisted task-brief message.
7. After Herdr accepts the text prompt, Foreman marks the task `working` and records the worker pane.
8. A delayed, passive endpoint inspection records the worker state. If submission is uncertain, Foreman preserves the endpoint and records the uncertainty without resending or interrupting it.

### 11.4 Adopt existing worker

Adoption requires an explicit user request naming the worker and requirement or existing queued task. Foreman verifies that the worker is active, belongs to the registered project, is not already assigned elsewhere, and can be bound without overwriting work. Adoption creates a new generation but does not resend the task as if it were new.

### 11.5 Blocker and decision

A `blocked` report stops the task at `blocked`.
Foreman reads the report and either returns a technical blocker to the worker with `foreman task message` or, when the choice needs product, architecture, compatibility, security, operational, or acceptance authority, persists a complete Decision Package before asking the user.
The human response is stored verbatim and delivered through the durable outbox to the current generation, which resumes the task.

### 11.6 Completion and acceptance

A `done` report covers outcome, changed surface, direct evidence, unresolved checks, and risk.
It moves the task to `review-ready`, and Foreman waits for the user.
Acceptance verifies the worker endpoint is stopped, releases the resource lease, and deletes the task records and task-scoped coordination records.
The project workspace remains on disk, and no accepted task history is kept.

### 11.7 Dead worker and handoff

Only confirmed `dead` or `missing` evidence permits handoff, and Foreman starts it explicitly after a second status check agrees.
The successor receives original requirements, accepted decisions, the latest report, workspace state, resource claims, and an instruction to inspect rather than trust previous implementation assumptions.

Recovery preserves the current workspace and resource lease, stops or verifies absence of the old endpoint, increments the assignment generation, and spawns a replacement worker.
The handoff package also includes available evidence and unresolved checks.
The successor must inspect current workspace state before changing it and must not assume that prior implementation or reported evidence is correct.
The old generation's pane can no longer report.
Recovery attempts are bounded; exhaustion is reported instead of relaunching forever.

### 11.8 Workspace handling

Acceptance does not commit, merge, reset, or remove project files.
The client controls any Git operation and can inspect the retained workspace after the task record is gone.

### 11.9 Scout completion and promotion

A scout completes with an evidence-backed report and enters review-ready without a landing requirement.
In a project without Git, the scout mutation guard hashes every file except those under `node_modules`, `.git`, `dist`, and `build`.
Promote a review-ready scout before accepting it if its report implies implementation work.
Acceptance closes the scout, releases its read-only runtime resources, and deletes its report and task records.

## 12. User-facing reporting

Default output is short and grouped only when non-empty:

- `Cần bạn duyệt`
- `Cần bạn quyết` (decisions and `blocked` reports)
- `Bất thường`

A final count reports running and queued work. Each task appears once per response. Passed checks are counted; gaps, risks, and user actions are stated. Detailed worker reports are shown only when requested or required for a decision.

Fleet status may be filtered by project, task, worker, lifecycle, or anomaly. A request for full status actively refreshes every running assignment before reporting.

## 13. Safety and failure behavior

Foreman fails closed when:

- the home lock is unavailable;
- a project ID or canonical root is ambiguous;
- task metadata does not match runtime endpoint, workspace, branch, or resource identity;
- an assignment generation is stale;
- worker output cannot be attributed to the current assignment;
- Herdr state is unreadable or incompatible;
- the accepted task's worker endpoint cannot be verified stopped;
- multiple valid user-authority choices remain unresolved.

Foreman preserves evidence and reports the exact uncertainty. It does not convert `unknown` into `dead`, retry destructive operations blindly, or route work to another project as fallback.

## 14. Core implementation roadmap

The legacy copy remains unchanged until equivalent behavior is proven in the new architecture.
Each phase must preserve the core invariants and add focused recovery and failure-path proof before the next phase depends on it.

### Phase P0: reliability foundation

1. Define versioned durable schemas, writer ownership, atomic migrations, refusal of invalid input, and retention rules.
2. Add the durable message outbox and restart recovery.
3. Extract one read-only status check shared by status, the session context, and recovery.
4. Add pane-bound worker reports prompted by a coding-agent stop hook.
5. Add the Foreman session prompt hook that surfaces unread reports and anomalies.

### Phase P1: supervisor autonomy

1. Complete verified runtime lifecycle control with a distinct interrupt operation.
2. Add structured handoff and bounded automatic recovery for confirmed dead or missing workers.
3. Add the durable decision lifecycle and human-decision delivery.
4. Let Foreman separate technical blockers from authority blockers when it reads a `blocked` report.
5. Add ship and scout task semantics before scheduler behavior depends on them.

### Phase P2: scheduling and fleet scale

1. Remove the single-project registration limit while preserving canonical project isolation.
2. Add task dependencies and deterministic dependency satisfaction rules.
3. Add scheduler-owned fleet and per-project concurrency limits.
4. Schedule concurrent work from dependency, workspace, runtime capacity, and resource-lease evidence.
5. Add fleet-wide and per-project status views backed by the same reconciliation state.

### Phase P3: dispatch optimization

1. Configure a default router and named worker profiles with a coding tool, command, model, and natural-language usage policy.
2. Route every newly created task before it becomes scheduler-eligible, and persist the selected profile and evidence.
3. Validate profiles against runtime adapter capabilities and use only the explicitly configured default when routing fails.

### Deferred expansion

Pull-request delivery requires its own accepted authority, evidence, polling, and cleanup contract after `local-only` delivery is proven.
Additional backends, remote homes, relay channels, richer notifications, or autonomous reversible actions require separate accepted specifications.
They do not enter core by analogy with another supervisor product.

## 15. Roadmap acceptance criteria

### 15.1 P0 reliability foundation

P0 is complete only when all of the following are directly demonstrated:

1. Every active record is schema-validated, and an interrupted migration can restart without losing the original record.
2. Every worker message is durable before send, survives restart, and stays bound to its task, worker, generation, and endpoint.
3. Delivered prompts are not resent, and delayed endpoint inspection records runtime status without interrupting work.
4. No background process runs, and no model tokens are consumed while no Foreman turn runs.
5. A worker report survives Foreman downtime and stays unread until a Foreman session is shown it.
6. A clean Foreman session reconstructs active state and classifies all assignments from one runtime listing without conversation history.
7. A status check detects missing or dead workers, workers idle without a report, endpoint or pane mismatch, missing workspace, and invalid resource leases without guessing recovery state.
8. A second Foreman session cannot mutate canonical state, and workers change state only through pane-bound reports.

### 15.2 P1 supervisor autonomy

P1 is complete only when all of the following are directly demonstrated:

1. Spawn, inspect, send, read, interrupt, and stop actions have verified outcomes and lifecycle control is not encoded as normal chat.
2. A confirmed dead or missing worker is replaced with a new generation without losing the workspace, requirements, human decisions, progress, evidence, or unresolved checks.
3. `unknown` runtime state never triggers automatic recovery.
4. The replacement worker inspects existing state, and the prior generation's pane cannot update the new assignment.
5. A `blocked` report leads to either a Foreman follow-up for a technical blocker or one complete Decision Package for an authority blocker.
6. A human decision is preserved verbatim and delivered to the correct generation before work resumes.
7. A scout cannot modify production code, completes through report review, and can produce a ship task from its report only through explicit user-approved promotion before acceptance.

## 16. Scale and optimization acceptance criteria

### 16.1 P2 scheduling and fleet scale

Multi-project support is complete only when:

1. At least two registered projects run assignments concurrently.
2. Project IDs and canonical roots cannot collide.
3. A worker report from project A cannot mutate task state for project B.
4. Fleet restart reconstructs both projects from disk and one runtime listing.
5. Per-project status and fleet status agree on lifecycle and ownership.
6. Dispatch refuses an unregistered, disabled, missing, or relocated project until the registry is explicitly reconciled.
7. Acceptance in one project cannot address task records, leases, or endpoints belonging to another project.
8. A task with an unsatisfied or cyclic dependency cannot dispatch, and satisfying a valid dependency unlocks it exactly once.
9. Fleet and per-project concurrency limits prevent excess dispatch without serializing non-conflicting work unnecessarily.
10. Disjoint resource leases may run concurrently, while overlapping write or exclusive leases block dispatch.
11. A reused idle endpoint cannot receive a new task until its prior assignment and resources are safely reconciled and released.

### 16.2 P3 dispatch profiles

P3 is complete only when every new task produces a durable routing record, the router can select only a configured profile, a supported tool command and model reach the runtime unchanged, an unsupported profile fails before dispatch, and fallback occurs only through the explicitly configured default profile.

## 17. Deliberate initial decisions

- Repository model: standalone agent distribution.
- Runtime backend: Herdr only.
- Deployment: local machine only.
- State store: files with atomic writes and explicit locks; no database.
- Delivery mode: `local-only` first.
- Acceptance: user only.
- Merge authority: none in the initial release.
- Supervision: worker stop-hook reports plus on-demand Foreman turns; no background observer.
- Project mutation: workers only, in client-prepared shared workspaces; resource leases guard concurrent mutation.
- Legacy code: preserved under `legacy/` until parity and cutover are proven.

## 18. Feature admission rule

A new feature belongs in Foreman core only if it passes every check:

1. Its necessary state survives a cleared session.
2. It preserves Foreman's global-context and worker deep-context boundary.
3. It preserves user wording, decisions, and original worker reports.
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
10. move completion to review-ready, require explicit user acceptance, and then release the worker and lease and delete the task records.

The worker must add focused automated scenarios for home locking, atomic persistence, project-boundary validation, generation rejection, restart reconstruction, and acceptance cleanup. Tests are run only after this section is persisted. Observer, automatic handoff, multi-project concurrency, pull-request delivery, and additional runtime backends are outside this milestone.

Milestone implementation contract correction: the Herdr step is implemented behind a narrow, version-gated adapter seam. Deterministic milestone tests may inject a fake Herdr transport that returns the same delivery and endpoint identity evidence; the real adapter must fail closed when the installed Herdr protocol or required command semantics cannot be verified. This seam does not add another runtime backend or change Herdr ownership of dispatch.

## 20. Current implementation status

This section records the behavior present in the repository on 2026-09-25.
Sections 14–16 remain the normative roadmap and acceptance contract; this section records which paths are implemented and which limitations are explicit.

### 20.1 Implemented paths

- P0 durable coordination is implemented with schema-v1 validation at active-record load boundaries, an atomic migration seam that preserves the source record, durable outbox persistence before send, message IDs, task/project/worker/generation/endpoint bindings, payload digests, and delivery tracking.
- `foreman init` records `FOREMAN_ROOT` and `FOREMAN_HOME` in the login shell's startup file as described in section 6.
- Workers report through `foreman report`, bound to the assignment by `HERDR_PANE_ID`; `hooks/foreman-worker-stop.sh` prompts the report at the end of a turn.
- `hooks/foreman-session-context.sh`, configured in `.claude/settings.json` and `.codex/hooks.json`, gives the Foreman session unread reports and status anomalies on each non-`DEV` prompt.
- `foreman status` performs one read-only runtime listing and flags dead, missing, mismatched, input-blocked, and idle-without-report workers without interrupting them.
- The observer, worker heartbeat, event spool, wake queue, worker registry, inbox packages, acknowledgements, quarantine, message retry, automatic follow-up, automatic blocker triage, and automatic recovery were removed on 2026-09-25.
- P1 lifecycle control is implemented through the Herdr adapter for spawn, inspect, send, read, interrupt, and stop.
- The compatibility gate checks the agent, workspace, and pane verbs used for dispatch.
- Interrupt returns success only after a later inspection shows the endpoint still exists and is no longer working.
- Recovery composes a status check that confirms `dead` or `missing`, stop or confirmed absence, a new generation, spawn, and a brief carrying the durable handoff.
- The handoff contains the brief, decisions, latest report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
- Decision Packages, verbatim human responses, decision delivery that resumes the task, `task message`, and scout-to-ship promotion are implemented.
- Adoption is an explicit request.
- It verifies an active runtime worker, project and cwd identity, and that the worker is not already assigned, then binds a new generation and its pane without sending the task again.
- A scout receives read-only resource claims and an instruction not to modify production files.
- Foreman does not scan or fingerprint project files to verify scout behavior; Herdr does not sandbox the worker.
- P2 multi-project binding, ship/scout task types, dependency validation and gating, resource-aware scheduling, per-project limits, fleet/per-project status views, and concurrent non-conflicting dispatch are implemented.
- P3 static dispatch-profile validation is implemented against runtime capabilities.
- Mandatory task-intake routing is implemented through the tracked `FOREMAN_ROOT/config/model-routing.json` with a fixed router, an explicit default, and named worker profiles.
- Routing supports the `codex`, `claude`, `omp`, and `opencode` tools, persists the brief and config digests with its selection, and forwards configured command arguments and model through Herdr.
- Invalid router output or a router process failure selects only the configured default profile and preserves the error in the routing record.
- A compatible dispatch fallback is accepted only when explicitly configured and is forwarded unchanged.
- `bin/foreman` is a thin wrapper over the core modules.
- Default `status` and `task list` render the grouped Vietnamese report.
- `--json` keeps the machine-readable record.
- Production distribution artifacts are present under `AGENTS.md`, `.agents/skills/`, `docs/`, `bin/`, `hooks/`, and `adapters/herdr/`.
- `legacy/` remains preserved but is not a production entry point.

### 20.2 Runtime proof

- On 2026-09-25, `npm test` ran 59 tests: 52 passed, 2 live cases were skipped, and 5 failed.
- The 5 failures predate the report change: four Herdr adapter tests use a transport mock without the `pane list` verb and `workspace create` response, and one routing test expects the committed `config/model-routing.json`.
- `npm run test:live` spawned real Codex workers through Herdr 0.9.1, and both cases passed: each worker received its brief, reported through its pane, and its task became `review-ready`.
- Before the folder-trust fix, the ship case in an untrusted temporary folder failed because the brief's Enter answered Codex's trust screen and the brief was lost.

### 20.3 Explicit compatibility limits and deferrals

- Task briefs are sent as text prompts to workers in separate Herdr workspaces.
- Brief delivery requires no worker acknowledgement, and delivered prompts are not automatically resent.
- Herdr reports an agent showing a startup screen as idle, so spawn confirms Codex and Claude folder-trust screens with Enter before it treats the agent as ready; the workspace is a registered project that the user dispatched work into.
- A startup screen that Foreman does not recognize can still consume the brief; `foreman status` then shows the worker idle without a report.
- Resource leases have no expiry; a task that is never accepted keeps its lease until it is reassigned.
- Stop-hook support is verified for Claude Code's `decision: block` and `stop_hook_active` contract; other coding agents may use a different hook payload or output.
- Model names are passed to the selected coding tool and are not independently enumerated by Herdr; an invalid model therefore fails during tool startup.
- A routing profile may set `effort` for Codex, Claude, or OMP through the tool's native command flag; the adapter-level `reasoningEffort` capability remains unsupported.
- No implicit profile or model fallback is performed beyond the `default` profile named in `model-routing.json`.
- A worker profile with `isActive: false` is excluded from routing; `isActive` defaults to `true`, the `default` profile must be active, and existing task routing records keep their selected profile.
- Scout read-only behavior relies on the worker instruction and resource lease; the runtime does not sandbox project files.
- Pull-request delivery, additional runtime backends, remote homes, relay channels, automatic model optimization, and autonomous merge authority remain deferred according to sections 4, 14, and 17.

### OpenCode V2 tool dispatch within Herdr

This adds a coding **tool**, not a new runtime backend: Herdr remains the only transport and owns the workspace, pane, prompt delivery, inspection, and stop lifecycle. An explicit `opencode` worker profile uses OpenCode V2's interactive `mini` interface with `command: ["opencode", "--auto", "mini", "--standalone"]` and a `provider/model` model ID. `--auto` is a global CLI option placed before `mini`; it auto-approves permissions not explicitly denied, and does not override explicit deny rules. The pane-local server must inherit `HERDR_PANE_ID`, `FOREMAN_ROOT`, and `FOREMAN_HOME`; a shared OpenCode service may inherit another pane's identity and cannot run the worker stop hook safely. The command and model are forwarded as argument arrays without a shell; the router retains its existing explicit-default policy. Fail before dispatch for a non-interactive or non-standalone OpenCode command or a non-null `effort`, since OpenCode mini has no supported effort flag. Do not silently substitute another coding tool.

The global OpenCode V2 worker-stop plugin is an installation prerequisite, not part of Foreman's project state. It listens for the root worker session becoming idle and, when the bound task has no report since the last prompt, asks that session to run `foreman report`. Herdr's agent-state integration supplies pane liveness; neither prompt delivery nor plugin activation counts as a report. The existing pane-bound report validation, supervision, recovery, and human acceptance rules are unchanged. No new runtime backend, service lifecycle authority, or implicit profile fallback is added.
