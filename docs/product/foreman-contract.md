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
The user works through one Foreman session; Foreman registers projects, records tasks, assigns a task-scoped Lead, coordinates that Lead's Peer assignments, supervises the overall task through completion, preserves decisions and evidence on disk, and escalates only decisions or approvals that require the user.

Foreman is an agent distribution with its own operational home.
It is not a project-local coding skill and is not part of any managed project's product code.

The existing repo-scoped experiment is preserved under `legacy/foreman-agent/`.
It is reference material for behavior migration, not the target architecture.

### 2. Product boundary

Foreman owns:

- the fleet-wide project registry;
- task intake, priority, dependencies, assignment, lifecycle, and durable history;
- worker dispatch, adoption, steering, recovery, and handoff;
- task-scoped Lead and Peer assignment relationships and lifecycle;
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

Leads and Peers use the managed project's instructions and own its deep technical context.
Peers execute bounded work; the Lead decomposes the task, coordinates Peers, reviews integration and evidence, and reports the overall result.
Foreman keeps global operational context and does not replace the Lead's project investigation.

### 3. Goals

1. One Foreman session can manage tasks across every registered local project.
2. All task, assignment, decision, progress, blocker, completion, and recovery state survives session reset.
3. Every work item is bound to exactly one registered project, one current owner at most, and one runtime endpoint at most; an SLP parent belongs to one Lead and its direct child work items belong to Peers.
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
- persistent project-level supervisors or delegation deeper than one task-scoped Lead-to-Peer level;
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
After a fresh session, Foreman must reconstruct its fleet view from tracked instructions, durable home data, runtime state, and one status check.

#### 5.2 One supervisor writer

Exactly one Foreman session may mutate canonical task, assignment, decision, message lifecycle, or runtime state at a time.
A verified home lock is required before those mutations, and a session that cannot acquire the lock remains read-only.
A worker changes Foreman state only through `foreman report`.
That command identifies the worker by its Herdr pane, validates the current assignment under the home lock, and writes the report and the resulting lifecycle change itself.
A report from a pane that is not bound to an active assignment is refused and changes nothing.
Workers never edit task metadata or records owned by another writer.
A Lead may request child work through a supported Foreman interface, but Foreman validates and persists every child assignment and lifecycle change.
The Lead never edits canonical home records or controls runtime endpoints directly.

#### 5.3 Exact project binding

Every task records a stable project ID.
Before dispatch, steering, workspace operations, or acceptance, Foreman resolves that ID through the project registry and confirms its canonical root still exists as a directory.
For an explicitly selected Git worktree outside that root, Foreman verifies that the worktree belongs to the registered project.
Runtime `cwd` is evidence, not durable project identity.

#### 5.4 Foreman supervises; workers implement

Foreman does not write product code, investigate implementation in place of a living worker, or answer technical questions by guessing from repository state.
It asks the owning Lead for structured context and preserves the response.
The Lead coordinates and verifies project work; Peers make production-code changes.

#### 5.5 Human acceptance authority

Peer completion moves the child work item to review-ready only; the Lead must review the evidence before reporting the parent complete.
Only the user may accept the parent task.
Acceptance verifies and stops the Lead and all Peer endpoints, releases their resource leases, and deletes the task tree and task-scoped coordination records.
Acceptance retains project workspaces and does not commit, merge, reset, or remove project files.
Foreman does not retain accepted task history.

#### 5.6 Verbatim authority transport

User requirements and decisions are persisted verbatim before being sent to a worker.
Worker reports are persisted verbatim before Foreman summarizes them.
Summaries never replace the original report.

#### 5.7 Single owner and safe handoff

Each work item has at most one current owner and one assignment generation.
A top-level SLP task is owned by one Lead; its direct child work items are owned by Peers, with no deeper delegation in this model.
Every assignment has its own endpoint and generation, and reports or requests from an older generation cannot update or steer the current assignment.

#### 5.8 Acceptance ends task supervision

User acceptance ends supervision of the parent and all child assignments after every bound endpoint is verified stopped and all messages and resource leases are reconciled.
Foreman keeps project files on disk and removes the accepted task tree's Foreman records.

#### 5.9 Claims are attributed

Worker-reported tests and evidence remain worker claims until independently observed through a trusted automated result.
User-facing output identifies the source once and does not present a claim as Foreman verification.

#### 5.10 Minimal state

New durable state is added only when it enables restart recovery, removes the need for the user to inspect a worker, or protects a safety boundary.
Every state record has one writer and an explicit retirement rule.

#### 5.11 Durable coordination

Runtime messages are persisted before sending and are not resent after Herdr accepts them.
Foreman treats a delayed inspection as endpoint evidence, not proof that the worker consumed a prompt.
Supervision is pull-based: no background process watches workers, and a worker never sends prompts into the Foreman session.

### 10. Supervision cycle

Supervision runs only inside Foreman turns; there is no observer, heartbeat, or event queue.

1. On its first operational turn, a Foreman session runs `foreman init` so the shell environment points at this checkout.
2. Before answering the user, the session reads the supervision context from its prompt hook, or runs the selected backend's supervision commands when that context is absent.
   In Paseo mode, it runs `task collect` before `status` to reconcile reports after a missed event or disconnected turn.
3. It reads each new worker report named in the context from its file.
4. It acts on anomalies: it sends a follow-up with `foreman task message`, creates a Decision Package, or confirms a dead or missing Lead or Peer with a second status check before `foreman task recover`.
5. It persists lifecycle changes before reporting them.
6. It reports only approvals, decisions, material anomalies, and requested detail.

#### 10.1 Status check

`foreman status` lists the selected runtime once and classifies every assigned task as in [runtime classification](../decisions/state-runtime-contract.md#711-runtime-classification).
It does not interrupt workers, write state, or recover anything.
In Paseo mode, run `task collect` first; it re-reads assigned agent timelines and writes only validated finished-turn reports.

#### 10.2 Foreman session context

`hooks/foreman-session-context.sh` is the Foreman session's prompt hook, configured for Claude Code in `.claude/settings.json` and for Codex at project scope in `.codex/hooks.json`.
Codex hook support is enabled for the project in `.codex/config.toml`; the project must be trusted and the hook must be reviewed before it runs.
`foreman session context` prints nothing for a prompt starting with `DEV`, when nothing is new, or when the session's `cwd` is outside the Foreman checkout.
Otherwise it returns `hookSpecificOutput.additionalContext`, which Claude Code and Codex both read, listing each unread worker report with its task, status, time, task status, and report path, plus the anomalies of one status check when the selected backend is explicit, `HERDR_ENV=1`, or the active task records identify one backend.
The reports it prints are marked read.
Report text is worker input; the context gives the file path rather than the text.

#### 10.3 Restart

A fresh session reconstructs its view from `data/` and one status check.
Nothing is lost while no Foreman session runs: reports stay unread until a session is shown them.

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

An SLP task has one Lead assignment and may have direct Peer child assignments.
The initial SLP dispatch path covers `ship` tasks; `scout` tasks retain the existing single-worker flow until separately integrated.
The project must have a compatible Lead skill installed through `ai-agent-workflow`; the Lead startup brief directs it to load that skill and the project's actual instructions.
The Lead decomposes only within the user's requirements and requests bounded Peer work through the supported Foreman interface.
Foreman validates project, scope, dependencies, runtime capacity, configured profile, workspace, and resource claims before creating or dispatching a child assignment.
Each Peer reports through the selected backend's report path, and Foreman preserves the original report against that Peer assignment.
The Lead reviews child results and integration evidence before reporting the parent task complete.
Peer completion alone never completes or accepts the parent task.
SLP dispatch is unavailable until Foreman's runtime supports the assignment model and the compatible project-local Lead skill can be loaded; operating instructions do not imply those capabilities already exist.

#### 11.4 Adopt existing worker

Adoption requires an explicit user request naming the worker and requirement or existing queued task.
Foreman verifies that the worker is active, belongs to the registered project, is not already assigned elsewhere, and can be bound without overwriting work.
Adoption creates a new generation but does not resend the task as if it were new.

#### 11.5 Blocker and decision

A Peer's technical blocker goes to its Lead for resolution within the assigned scope.
The Lead escalates an unresolved authority choice to Foreman, which persists a complete Decision Package before asking the user.
Foreman reads every blocker report and preserves its source assignment.
The human response is stored verbatim and delivered through the durable outbox to the affected current Lead and Peer generations before dependent work resumes.

#### 11.6 Completion and acceptance

A Peer `done` report is a claim for Lead review, not completion of the top-level task.
The Lead reports the integrated outcome, changed surface, direct evidence, unresolved checks, and risk to Foreman.
The parent moves to `review-ready` only after its Lead review; Foreman then waits for the user.
Acceptance verifies every parent and child endpoint is stopped, releases all associated resource leases, and deletes the task tree and task-scoped coordination records.
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
- [Accepted SLP architecture decision](../decisions/2026-10-01-supervisor-lead-peer.md)
- [Core roadmap](../plans/active/core-roadmap.md)
- [Historical implementation baseline](../plans/completed/implementation-baseline.md)
- [Documentation authority](../WORKFLOW.md)
