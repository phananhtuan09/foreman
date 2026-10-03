# Foreman product contract

Status: Active
Scope: Local fleet supervision and managed-project task behavior

## Purpose

Preserve the product and safety contract from the former Draft 0.6 specification, with the human-confirmed Supervisor–Lead–Peer (SLP) operating model incorporated as durable product intent.
The numbered sections below retain their original identities for traceability.

## Rules

User-facing communication is Vietnamese; identifiers, paths, commands, and runtime state values remain verbatim.

### 1. Purpose

Foreman is a persistent multi-project software-work supervisor.
The user works through one Foreman session; Foreman registers projects, records tasks, binds one logical Lead to each project, coordinates that Lead's Peer assignments, supervises each task through human acceptance, preserves decisions and evidence on disk, and escalates only decisions or approvals that require the user.

Foreman is an agent distribution with its own operational home.
It is not a project-local coding skill and is not part of any managed project's product code.

The existing repo-scoped experiment is preserved under `legacy/foreman-agent/`.
It is reference material for behavior migration, not the target architecture.

### 2. Product boundary

Foreman owns:

- the fleet-wide project registry;
- task intake, priority, dependencies, assignment, lifecycle, and durable history;
- worker dispatch, adoption, steering, recovery, and handoff;
- project-scoped Lead identities and task-scoped Peer assignment relationships and lifecycle;
- workspace, resource-lease, and runtime-endpoint identity;
- event-driven supervision and restart recovery;
- concise user-facing status, decision, and approval packages;
- runtime adapters for the accepted local Herdr and Paseo backends;
- operational state inside the Foreman home.

Managed projects own:

- their product and architecture authority;
- their repository instructions;
- source code, tests, configuration, and documentation;
- implementation evidence and delivery artifacts.

Leads and Peers use the managed project's instructions and workflow.
The project Lead keeps an overview of active and waiting tasks, dependencies, resource use, and project knowledge; Peers own detailed exploration, audit, implementation, and review context.
The Lead chooses an appropriate flow for each task, coordinates Peers, and reports the reviewed result.
Foreman keeps fleet context and does not replace the Lead's project investigation or technical judgment.

### 3. Goals

1. One Foreman session can manage tasks across every registered local project.
2. All task, assignment, decision, progress, blocker, completion, and recovery state survives session reset.
3. Every work item is bound to exactly one registered project, one current owner at most, and one runtime endpoint at most; a project has at most one current Lead generation and each task's direct child work items belong to Peers.
4. Project mutations happen through workers in a client-prepared workspace, with resource leases allowing safe concurrency.
5. Foreman can recover safely after its session or a worker exits.
6. Supervision is event-driven and consumes no model tokens while nothing actionable happens.
7. The user sees conclusions, decisions, approvals, and material anomalies rather than worker transcripts or internal housekeeping.
8. Human intent and worker reports are retained verbatim before Foreman summarizes them.
9. Foreman never silently broadens authority, merges, discards work, or guesses recovery state.
10. The first production runtime backend is Herdr; the core state model must not depend on Herdr-specific identifiers.

### 4. Initial non-goals

The first production release does not include:

- tmux, Zellij, cmux, Orca, or runtime backends beyond the accepted Herdr and Paseo integrations;
- remote workers or remote Foreman homes;
- supervisory levels beyond Foreman, one project-scoped Lead, and that Lead's direct task-scoped Peers;
- Discord, X, email, voice, or other relay channels;
- automatic PR merge or standing merge authority;
- autonomous product, business, security, compatibility, or architecture decisions;
- a database or continuously running LLM service;
- automatic model or quota optimization before the P3 dispatch-profile phase;
- direct production-code implementation by Foreman.

These capabilities may be designed later only when the core lifecycle and recovery invariants are already proven.

### 5. Core invariants

#### 5.1 Durable restart

Conversation memory is never authoritative operational state.
After a fresh session, Foreman reconstructs its fleet view from tracked instructions, durable home data, runtime state, and one status check.
A replacement Lead reconstructs the project view from canonical home records, the generated project-local state view, and current runtime ownership before coordinating work.

#### 5.2 One supervisor writer

Foreman's deterministic core is the sole canonical writer for fleet and project task state.
Every mutation, including requests made outside a Foreman conversation turn, uses the verified home lock and validates the current record identity.
Foreman provides one request/report protocol for both accepted runtime backends and processes its durable inbox and outbox without a language-model session.
A Lead may request bounded Peer assignments and report reviewed task readiness only through that protocol.
The core authenticates each request against its project, task, Lead generation, endpoint, scope, configured profile, dependencies, resources, and capacity before recording an outcome or dispatching work.
Herdr and Paseo Peer reports are bound to their current assignment endpoint and generation; stale or unbound reports and requests are refused.
Leads and Peers never edit canonical home records or control runtime endpoints directly.
The core maintains a versioned project-local read view from canonical home records; agents may read it but cannot use it to authorize or mutate work.
When the Foreman conversation is inactive, human notifications remain in its durable inbox and are shown on the next Foreman turn; no external notification channel is implied.

#### 5.3 Exact project binding

Every task records a stable project ID.
Before dispatch, steering, workspace operations, or acceptance, Foreman resolves that ID through the project registry and confirms its canonical root still exists as a directory.
For an explicitly selected Git worktree outside that root, Foreman verifies that the worktree belongs to the registered project.
Runtime `cwd` is evidence, not durable project identity.

#### 5.4 Foreman supervises; workers implement

Foreman does not write product code, investigate implementation in place of a living worker, or answer technical questions by guessing from repository state.
It asks the owning Lead for structured context and preserves the response.
The Lead selects the project workflow and evaluates Peer findings; Peers make production-code changes and perform detailed independent review.
Foreman handles fleet-level decisions and does not direct implementation details when the Lead can resolve them within the accepted task scope.

#### 5.5 Human acceptance authority

Peer completion is a claim pending review; it does not establish that the task or integrated feature is ready.
The Lead records review milestones and may report the top-level task ready for acceptance only after the required integration checks pass and unresolved risks are surfaced.
Only the user may accept each top-level task.
Acceptance verifies and stops only that task's bound Peer endpoints, reconciles its messages and execution leases, and deletes its task-scoped coordination records.
The project Lead, other tasks, and their Peer endpoints remain active across acceptance.
Acceptance retains project workspaces and does not commit, merge, reset, or remove project files.
Foreman does not retain accepted task history.

#### 5.6 Verbatim authority transport

User requirements and decisions are persisted verbatim before being sent to a worker.
Worker reports are persisted verbatim before Foreman summarizes them.
Summaries never replace the original report.

#### 5.7 Single owner and safe handoff

Each work item has at most one current owner and one assignment generation.
Each project has at most one logical Lead identity and one current runtime generation for that identity.
A logical project Lead may coordinate several top-level tasks and starts a replacement session by reconstructing their current state when its context reaches the configured rollover point.
Each Peer work item has its own endpoint and assignment generation; reports or requests from an older generation cannot update or steer current work.
Peers cannot create another supervisory level, broaden their assignment, or take another Peer's work.

#### 5.8 Acceptance ends task supervision

User acceptance ends supervision of one top-level task and its Peer assignments after every bound Peer endpoint is verified stopped and task messages and execution leases are reconciled.
Acceptance does not stop or replace the project Lead, stop Peers on other tasks, or delete the current project state view.
Foreman keeps project files on disk and removes only the accepted task's Foreman records and entry in the generated project view.

#### 5.9 Claims are attributed

Worker-reported tests and evidence remain worker claims until independently observed through a trusted automated result.
User-facing output identifies the source once and does not present a claim as Foreman verification.

#### 5.10 Minimal state

New durable state is added only when it enables restart recovery, removes the need for the user to inspect a worker, or protects a safety boundary.
Every state record has one writer and an explicit retirement rule.

#### 5.11 Durable coordination

Runtime requests and messages are persisted before processing or sending and are idempotent across restart and uncertain delivery.
Foreman treats a delayed inspection as endpoint evidence, not proof that an agent consumed a prompt.
A deterministic local coordinator observes and routes actionable events for active work without running a model while idle.
Agents submit through the core protocol and never prompt or control the Foreman conversation directly.
The first SLP dispatch starts one coordinator process for the Foreman home.
It reloads canonical state, uses the adapter bound to each assignment, and reconciles durable requests, reports, runtime health, and messages while SLP work is active.
It sleeps between bounded polling cycles and exits after reconciliation when no active project Lead or Peer endpoint, pending request, or undelivered core message remains.
The next SLP command restarts it from canonical state.
If the process or machine stops unexpectedly, durable work remains pending and the next Foreman CLI turn reconciles runtime ownership before restarting coordination.
Read and inspect failures use bounded retries with capped backoff; uncertain spawn, send, stop, and lease-release outcomes are reconciled by identity before any retry, and unresolved uncertainty retains its resource lease.

### 10. Supervision cycle

The accepted SLP runtime supervises active assignments outside conversational Foreman turns through the bounded local coordinator and the assignment-bound runtime adapters.
The coordinator consumes no model tokens while idle, processes durable requests and reports, and records material human notifications in the Foreman inbox.
The current Supervisor–Worker runtime remains turn-based until its roadmap gates pass.

1. On its first operational turn, a Foreman session runs `foreman init` so the shell environment points at this checkout.
2. Before answering the user, the session reads the durable Foreman inbox and any reconciliation anomalies from its prompt hook, or runs the selected backend's status/reconciliation commands when that context is absent.
3. It reads reports only when needed to explain a material result, decision, or risk; the core and current Lead already process routine reports.
4. It acts on anomalies that require fleet authority: it delivers a user's decision or verifies dead/missing runtime evidence before bounded recovery.
5. It persists lifecycle changes before reporting them.
6. It reports only approvals, decisions, material anomalies, and requested detail.

#### 10.1 Status check

In the current Supervisor–Worker implementation, `foreman status` lists the selected runtime once and classifies every assigned task as in [runtime classification](../decisions/state-runtime-contract.md#711-runtime-classification).
It does not interrupt workers, write state, or recover anything.
In current Paseo mode, run `task collect` first; it re-reads assigned agent timelines and writes only validated finished-turn reports.
With SLP enabled, the coordinator performs that collection and classification for active assignments; the Foreman turn reads its durable inbox and may request a fresh status reconciliation.

#### 10.2 Foreman session context

`hooks/foreman-session-context.sh` is the Foreman session's prompt hook, configured for Claude Code in `.claude/settings.json` and for Codex at project scope in `.codex/hooks.json`.
Codex hook support is enabled for the project in `.codex/config.toml`; the project must be trusted and the hook must be reviewed before it runs.
`foreman session context` prints nothing for a prompt starting with `DEV`, when no human action or notification is new, or when the session's `cwd` is outside the Foreman checkout.
Otherwise it returns a compact inbox of tasks ready for human acceptance, decisions awaiting the user, blockers that cannot be resolved within scope, and material anomalies.
Routine Peer reports are routed to the current project Lead by the core and do not fill the Foreman conversation context.
Original report paths remain available for attribution and requested detail.

#### 10.3 Restart

A fresh session reconstructs its fleet view from `data/`, durable inbox entries, and one status check.
Project state views are regenerated from canonical records and current runtime evidence; reports and requests received while no Foreman session runs remain durable.
The CLI reconciles any coordinator downtime before it starts a replacement coordinator, and it never releases a lease from process absence alone.

### 11. Main workflows

#### 11.1 Register project

1. Receive an explicit project path or clone request.
2. Resolve the canonical root and inspect repository identity.
3. Refuse duplicate IDs or roots.
4. Record project policy and initial delivery mode atomically.
5. Do not modify the managed project during registration.

#### 11.2 Intake task

1. Persist the user's wording under a new global task ID.
2. Bind the task to one registered project.
3. Record its task metadata.
4. Record dependencies without assigning work prematurely.
5. Dispatch only when the task is unblocked and a suitable runtime lane exists.

#### 11.3 Dispatch task

1. Validate project, task, authority, dependency, and home lock.
2. Create a new assignment generation.
3. Receive and validate the client-prepared workspace and resource claims.
4. Persist the brief, pending assignment, and task-brief outbox message before runtime delivery.
5. Spawn the worker through the selected runtime adapter.
6. Verify stable endpoint identity and deliver the persisted task-brief message.
7. After the selected runtime accepts the text prompt, Foreman marks the task `working` and records the endpoint identity; Paseo also records the workspace ID and timeline cursor.
8. If submission is uncertain, Foreman preserves the endpoint and records the uncertainty without resending or interrupting it.

#### 11.3.1 Supervisor–Lead–Peer assignment

Each SLP project has at most one current logical Lead generation that coordinates multiple top-level `ship` tasks.
Standalone `scout` tasks retain their existing single-worker flow until separately integrated.
The project must have a compatible optional `foreman-lead` skill installed from the canonical `ai-agent-workflow` skill source; the startup brief directs the Lead to load it and the project's actual instructions.
The Lead chooses the flow within the user's requirements and submits structured Peer requests through the one supported Foreman core interface.
The core durably records each request and outcome, authenticates the project Lead generation, validates task scope, profile, dependency, capacity, workspace, and resource claims, and performs every runtime operation through the assignment's selected backend.
Peer reports remain verbatim and attributable to their own assignments; the core routes compact reports and evidence references to the current project Lead.
The Lead records Peer review milestones, resolves routine technical blockers through bounded follow-up, and reports task readiness to Foreman.
The core keeps current project task state in `FOREMAN_HOME` and generates the project's active-state view at `.foreman/project-state.json`; the view is read-only, rebuildable, and contains no accepted-task history.
When a Lead session approaches its configured context bound, Foreman fences that generation and starts a replacement from the durable project state without restarting living Peers.
If work must wait or requires human authority, Foreman records an inbox notification for the next Foreman turn; no external push channel is assumed.
These rules describe accepted behavior, not currently implemented support; dispatch remains unavailable until every required phase gate and the compatible skill prerequisite pass.

#### 11.4 Adopt existing worker

Adoption requires an explicit user request naming the worker and requirement or existing queued task.
Foreman verifies that the worker is active, belongs to the registered project, is not already assigned elsewhere, and can be bound without overwriting work.
Adoption creates a new generation but does not resend the task as if it were new.

#### 11.5 Blocker and decision

A Peer's technical blocker goes to its project Lead for resolution within the assigned scope.
The Lead stops the affected work and escalates an unresolved blocker, an incorrect implementation, high risk, or a product/authority choice through Foreman.
The core preserves the complete Decision Package and original reports and records a notification in the Foreman inbox for the next user turn.
The human response is stored verbatim and delivered through the durable outbox to the affected current Lead and Peer generations before dependent work resumes.
Independent tasks continue while an unrelated task is blocked.

#### 11.6 Completion and acceptance

A Peer `done` report is a claim for review, not proof that the requested behavior is ready.
The Lead selects an independent Peer to review implementation evidence and the integrated result; failed or risky checks stop the affected work and may trigger bounded correction within scope.
The Lead reports the changed surface, observed checks and their source, evidence references, and unresolved risks to Foreman.
The core marks the task ready for acceptance only after the Lead's evidence-backed readiness report.
Foreman then notifies the human and waits for that task's explicit acceptance.
An explicitly designated SLP validation task may instead report `proof-complete` after every child Peer is stopped, has released its lease, and has a preserved report delivered to the Lead.
The proof record references every child Peer report and does not mark the task ready for acceptance or accept it on the human's behalf.
The proof-complete path is unavailable to delivery tasks, and validation tasks cannot use the product readiness path.
Acceptance verifies every Peer endpoint bound to that task is stopped, reconciles messages, releases its execution claims, and deletes only that task's coordination records.
The project Lead and its generated state view remain available for other tasks.
Project files remain on disk, and no accepted task history is kept.

#### 11.7 Dead worker and handoff

Only confirmed `dead` or `missing` evidence permits handoff, and Foreman starts it explicitly after a second status check agrees.
A dead Peer is replaced independently while preserving its child assignment state.
When a Lead is dead, living Peers may finish their already-authorized assignments and report, but no new child work or Lead-dependent review proceeds until a replacement Lead is bound.
The successor Lead reconstructs the child assignments and inspects current project and runtime state without respawning living Peers.
Every successor receives original requirements, accepted decisions, the latest report, workspace state, resource claims, and an instruction to inspect rather than trust previous implementation assumptions.

Recovery preserves the affected workspace and resource lease, stops or verifies absence of the old endpoint, increments that assignment's generation, and spawns a replacement Lead or Peer.
The handoff package also includes available evidence and unresolved checks.
The successor must inspect current workspace state before changing it and must not assume that prior implementation or reported evidence is correct.
The old generation's pane can no longer report.
Recovery attempts are bounded; exhaustion is reported instead of relaunching forever.

#### 11.8 Workspace handling

Acceptance does not commit, merge, reset, or remove project files.
The client controls any Git operation and can inspect the retained workspace after the task record is gone.

#### 11.9 Scout completion and promotion

A scout completes with an evidence-backed report and enters review-ready without a landing requirement.
In a project without Git, the scout mutation guard hashes every file except those under `node_modules`, `.git`, `dist`, and `build`.
Promote a review-ready scout before accepting it if its report implies implementation work.
Acceptance closes the scout, releases its read-only runtime resources, and deletes its report and task records.

### 12. User-facing reporting

Default output is short and grouped only when non-empty:

- `Cần bạn duyệt`
- `Cần bạn quyết` (decisions and `blocked` reports)
- `Bất thường`

A final count reports running and queued work.
Each task appears once per response.
Passed checks are counted; gaps, risks, and user actions are stated.
Detailed worker reports are shown only when requested or required for a decision.

Fleet status may be filtered by project, task, worker, lifecycle, or anomaly.
A request for full status actively refreshes every running assignment before reporting.

### 13. Safety and failure behavior

Foreman fails closed when:

- the home lock is unavailable;
- a project ID or canonical root is ambiguous;
- task metadata does not match runtime endpoint, workspace, branch, or resource identity;
- an assignment generation is stale;
- worker output cannot be attributed to the current assignment;
- Herdr state is unreadable or incompatible;
- the accepted task's worker endpoint cannot be verified stopped;
- multiple valid user-authority choices remain unresolved.

Foreman preserves evidence and reports the exact uncertainty.
It does not convert `unknown` into `dead`, retry destructive operations blindly, or route work to another project as fallback.

### 18. Feature admission rule

A new feature belongs in Foreman core only if it passes every check:

1. Its necessary state survives a cleared session.
2. It preserves Foreman's global-context and worker deep-context boundary.
3. It preserves user wording, decisions, and original worker reports.
4. It keeps the user as acceptance and material-policy authority.
5. It materially reduces user coordination or protects fleet correctness.
6. Any new state has one writer, a stable identity, and a cleanup lifecycle.
7. It respects exact project, task, owner, generation, workspace, resource lease, and endpoint binding.
8. It can be proven through focused state, runtime, or recovery scenarios.
9. It does not add another backend beyond the accepted Herdr and Paseo integrations without demonstrated need.
10. It does not copy a FirstMate feature merely because FirstMate has it.
11. It supports a bounded Lead-to-Peer task hierarchy without transferring user acceptance or publication authority to the Lead.

## References

- [State and runtime contract](../decisions/state-runtime-contract.md)
- [Accepted project-scoped SLP architecture decision](../decisions/2026-10-02-project-scoped-supervisor-lead-peer.md)
- [Core roadmap](../plans/active/core-roadmap.md)
- [Historical implementation baseline](../plans/completed/implementation-baseline.md)
- [Documentation authority](../WORKFLOW.md)
