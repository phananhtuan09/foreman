# Foreman core roadmap

Status: Active
Scope: Supervisor–Lead–Peer migration, validation gates, and preserved P0–P3 baseline
Source: Human-confirmed SLP scope in the 2026-10-01 planning discussion; former Draft 0.6 specification, sections 14–16

## Goal

Move Foreman from Supervisor–Worker to Supervisor–Lead–Peer (SLP) while preserving restartability, project isolation, attributed evidence, and human acceptance authority.
Keep the original phased roadmap and proof criteria as historical planning context rather than treating them as a current implementation backlog.

## State

The human confirmed the high-level SLP scope and delegated ordinary architecture choices in the 2026-10-01 planning discussion.
The product contract now records SLP as Active, and the accepted SLP architecture decision narrowly revises conflicting clauses in the Baseline state/runtime contract.
The current code and CLI still implement the prior Supervisor–Worker task model; no SLP runtime milestone is complete, and the historical implementation snapshot is not current verification.
The Foreman-local contract and operator-guidance update is recorded before the cross-repository Lead-skill work.
The S0 current-state inventory, external skill specification, and remaining implementation choices still require completion before S0 passes its gate.

### Confirmed scope

- Foreman remains the user's single point of contact and owns canonical fleet coordination.
- A Lead breaks down an assigned task, coordinates Peers, resolves technical blockers, checks integration, and reports the overall result.
- Peers execute bounded assignments within the original task scope and the managed project's workflow.
- A Lead may organize work without asking the human to approve each technical step, but may not broaden scope or invent material product, security, compatibility, or operational policy.
- Foreman escalates material decisions, blockers, and risks rather than exposing routine coordination to the user.
- Only the human accepts the overall task.
- Commit, merge, deployment, and other publication authority are not added by SLP and require separate explicit authorization.
- Both Herdr and Paseo remain supported, and an assignment never silently changes backend.
- The shared Lead skill is maintained and distributed through `ai-agent-workflow` and installed in each managed project before SLP dispatch.
- The first SLP dispatch path covers `ship`; `scout` tasks retain the current single-worker flow until separately integrated.

### Accepted SLP architecture

#### Roles and task ownership

Use a task-scoped Lead rather than introducing a persistent project-level supervisor.
Each top-level task has at most one current Lead assignment; each child work item has at most one current Peer assignment.
Each assignment has its own generation, endpoint identity, workspace binding, and resource lease.
Parent and child records remain bound to one project, and the child relationship must be acyclic.
The Lead owns decomposition and integration but does not acquire an exclusive project write lease merely to coordinate.
In the initial SLP path, Peers make production changes; the Lead reviews and verifies under appropriate resource claims and delegates implementation corrections to Peers.
Lead verification that mutates shared resources requires explicit claims just like Peer work.
Small tasks may use one Peer, and parallel work is used only when dependencies and resources allow it.
Do not add further levels of delegation in this migration.

#### Workflow and Lead skill

Provide one shared Lead skill maintained in `ai-agent-workflow` for intake, decomposition, Peer requests, blocker handling, integration review, reporting, and handoff.
Distribute it through that repository's existing skill installer and runtime adapters, then install it in each managed project using the paths supported by the selected coding tool.
Keep this capability optional for projects that do not use SLP rather than making ordinary project work depend on it.
Foreman remains the owner of the fleet protocol; the installed Lead skill describes how to use that protocol from the managed project's workspace.
Do not maintain a competing canonical Lead skill in Foreman or rely on a skill in Foreman's checkout being automatically visible in another project.
The managed project's actual `AGENTS.md`, `docs/WORKFLOW.md`, and relevant installed skills govern technical execution for both Lead and Peers.
Do not assume that a project matches the latest upstream `ai-agent-workflow` installation.
Use the existing repository-driven work shapes without imposing a mandatory design/specification/implementation chain.
Projects reuse the installed shared Lead skill; add project-specific guidance only for a demonstrated workflow difference.
Before Lead dispatch, verify that the project has a compatible installed Lead skill and that the selected coding tool can discover it.
The startup brief explicitly directs the Lead to load that local skill and the project's instructions; skill presence alone does not prove it was loaded.
If the skill is missing or incompatible, refuse SLP dispatch with a clear prerequisite rather than silently substituting instructions from Foreman's checkout.
The assignment brief carries verbatim human requirements and decisions, delegated scope, completion criteria, workspace identity, and the reporting contract.
If project instructions conflict with the assignment's authority or fleet safety boundaries, preserve the conflict and escalate through Foreman before dependent actions.
Skill instructions describe the procedure; deterministic core validation enforces authority, identity, resource, and lifecycle boundaries.

#### Canonical coordination

Keep Foreman's deterministic core as the sole canonical mutation path under the home lock.
A Lead submits structured requests to create, dispatch, steer, or replace its own child assignments; it does not edit home records or control runtime endpoints directly.
Validate each request against the current Lead endpoint and generation, parent task, project, delegated scope, dependency state, capacity, profile, and resource claims before performing it.
Record requests and their outcomes durably, deduplicate retries, and preserve original Lead and Peer reports before summaries.
Herdr submissions are endpoint-bound commands; Paseo submissions are structured finished-turn output collected and validated by Foreman.
Specify the exact request and response shapes in S0 rather than adding an independent coordinator store to each project.
Reuse the existing outbox, report attribution, reconciliation, and adapter lifecycle paths wherever they satisfy SLP requirements.
No worker prompts the Foreman session, and initial SLP coordination advances only during Foreman turns.
This means a Lead request can wait until the next Foreman turn; immediate background dispatch and continuous supervision are outside this migration.

#### Resources, dependencies, and profiles

Use explicit child dependency records and deterministic satisfaction rules.
A completed child satisfies a dependent work item's prerequisite only after the Lead records review of its completion evidence; this is a technical milestone, not human acceptance of the overall task.
Retain that evidence until the parent task closes so deleting a child record cannot invalidate a dependency or lose the integrated result.
Do not share the Lead's generation or lease across all Peers.
Prevent overlapping automated write or exclusive claims, and count both Lead and Peer endpoints against runtime capacity limits.
Route internal assignments only through configured profiles and preserve routing evidence.
Peer assignments inherit the profile confirmed for the parent task; changing profiles requires the human confirmation required by Foreman's routing policy.
Do not infer authority to overlap conflicting leases from the human's original top-level task request.
Any overlap exception must explicitly identify the conflicting assignment and remain attributable to a human decision.

#### Completion and decisions

A Peer completion report is a claim pending Lead review, not completion of the overall task.
The Lead checks the changed surfaces, cross-Peer integration, required proof, and unresolved risks before reporting the task review-ready through Foreman.
Failed checks cause bounded follow-up work within scope rather than an early completion claim.
Preserve the source of each reported check and distinguish worker claims from independently observed automated results.
Peers escalate technical blockers to the Lead; the Lead escalates unresolved authority choices through Foreman as one complete Decision Package.
User decisions are preserved verbatim and delivered to the affected current assignments before dependent work resumes.
Human acceptance closes the parent and all children only after every bound endpoint is verified stopped and pending messages and leases are reconciled.
Keep closure restartable; do not delete the task tree while any endpoint or resource remains unresolved.
Retain project files and follow the reconciled baseline policy of removing task-scoped records after successful acceptance without introducing accepted-task history.

#### Recovery and compatibility

Preserve explicit recovery during Foreman turns with bounded attempts and two agreeing checks for confirmed dead or missing endpoints.
Do not introduce automatic recovery merely because the preserved P1 roadmap mentions it.
Unknown runtime evidence never triggers replacement or lease release.
If a Peer dies, replace only that Peer with a new generation and preserve its workspace, claims, decisions, and evidence.
If a Lead dies, existing Peers may finish their already-authorized work and their reports remain collectable, but no new child dispatch or Lead-dependent review proceeds until a replacement Lead is bound.
The replacement Lead reconstructs the child graph and reviews actual workspace and runtime state without respawning living Peers.
Reject requests from an old Lead generation independently of the generations of living Peers.
Recovery does not grant broader profile, scope, resource, or publication authority.
Back up original records before schema migration, make interruption recoverable, and refuse unsupported versions without destructive conversion.
Keep existing Supervisor–Worker tasks on their existing path until closure; new SLP tasks use an explicit task-model discriminator.
Do not convert a live assignment in place or allow it to run under both task models.
Rollback disables new SLP dispatch without deleting active SLP state, changing generations, or discarding project work.

### SLP implementation sequence and proof gates

Each stage depends on the preceding gate and reuses already-proven baseline behavior rather than rebuilding the historical P0–P3 list.

#### S0: Foreman contract, guidance, and current-state inventory

1. Update Foreman's product contract, accepted architecture decision, documentation index, and operating instructions before changing the shared workflow base.
   This Foreman-local documentation step is recorded; it does not implement or enable SLP dispatch.
2. Map existing assignment, outbox, collection, recovery, scheduling, and acceptance behavior to retained requirements, actual gaps, and conflicts with the accepted SLP decision.
3. Complete the Lead request and Peer report contract, dependency review, project-local skill prerequisite, inherited profile rule, record ownership, and retirement rules.
4. Resolve explicit versus automatic recovery in favor of the explicit policy above for this migration.
5. Specify the shared Lead skill in `ai-agent-workflow`, its installer/runtime integration, protocol compatibility checks, and the project-workflow loading contract.

Gate: every SLP action has an authority boundary, canonical writer, identity check, durable outcome, and failure behavior; the architecture and operating instructions agree.

#### S1: shared Lead skill, task tree, and dispatch

1. Add versioned task-model and parent/child records with atomic migration and a compatible Supervisor–Worker path.
2. Implement and validate the shared Lead skill in `ai-agent-workflow`, distribute it through its existing installer/runtime adapters, and install a compatible revision in the pilot projects while preserving their existing instructions.
   This is a cross-repository prerequisite to Lead dispatch, not an assumption that updating upstream also updates installed projects.
   Foreman checks the local installation and directs Lead startup to load it while retaining each project's actual workflow.
3. Implement validated Lead requests, duplicate handling, durable dispatch, and independent Peer generations through existing core and adapters.
4. Support one top-level ship task with one Lead and two disjoint Peers on each existing backend.

Gate: a Lead spawned in the managed project's workspace demonstrably loads the installed Lead skill and project workflow through the selected coding tool, and missing or incompatible installations fail before dispatch.
Both Herdr and Paseo can dispatch the task tree, preserve original requirements, refuse cross-project and stale-generation requests, and prevent duplicate child creation or dispatch after restart.

#### S2: review, integration, and acceptance

1. Collect and retain Peer reports, record Lead review, and unlock dependent work exactly once.
2. Implement integration proof, within-scope follow-up, and authority escalation with verbatim decision delivery.
3. Aggregate review-ready state without hiding failed checks or confusing child review with human acceptance.
4. Implement restartable closure of all assignments, leases, messages, and task-scoped records.

Gate: a failed Peer check prevents parent completion, a reviewed child enables its dependent, the Lead proves the integrated result, and only human acceptance closes the task tree without altering project files.

#### S3: recovery and interruption proof

1. Recover a dead Peer independently and reject its old-generation reports.
2. Recover a dead Lead while retaining living Peers and their collectible reports.
3. Exercise Foreman restart, uncertain delivery, duplicate requests, interrupted migration, and partially completed acceptance.
4. Verify unknown runtime evidence, missing workspaces, and invalid leases produce recorded anomalies rather than guessed recovery.

Gate: the fleet reconstructs parent/child state from durable records and runtime evidence, no living Peer is duplicated, stale Leads cannot steer children, and recovery bounds remain effective on both backends.

#### S4: fleet scheduling and rollout

1. Apply dependency, workspace, lease, and fleet/per-project capacity checks across all Lead and Peer assignments.
2. Add aggregate task views with attributable child evidence and material anomalies available on demand.
3. Demonstrate concurrent task trees in at least two projects and safe endpoint reuse after closure.
4. Document rollout and rollback using verified migration and recovery procedures.

Gate: fleet and project views agree, conflicting automated work cannot dispatch, existing Supervisor–Worker tasks remain operable through closure, and disabling new SLP dispatch preserves resumability of active SLP tasks.

### Historical P0–P3 roadmap

The following sections preserve the former Draft 0.6 roadmap and proof criteria.
They are not a current completion assessment or authorization to repeat implemented work.
Before retiring a preserved implementation, identify the exact legacy paths and the equivalent behavior proven by the replacement; the historical wording alone does not define a deletion scope.
The automatic-recovery item is retained as historical wording; the current SLP migration instead follows the explicit recovery policy above.

### 14. Core implementation roadmap

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
   The routed profile is a recommendation: the user confirms it or chooses another active profile before the task can dispatch.
3. Validate profiles against runtime adapter capabilities and use only the explicitly configured default when routing fails.

### Deferred expansion

Pull-request delivery requires its own accepted authority, evidence, polling, and cleanup contract after `local-only` delivery is proven.
Additional backends, remote homes, relay channels, richer notifications, or autonomous reversible actions require separate accepted specifications.
They do not enter core by analogy with another supervisor product.

### 15. Roadmap acceptance criteria

#### 15.1 P0 reliability foundation

P0 is complete only when all of the following are directly demonstrated:

1. Every active record is schema-validated, and an interrupted migration can restart without losing the original record.
2. Every worker message is durable before send, survives restart, and stays bound to its task, worker, generation, and endpoint.
3. Delivered prompts are not resent, and delayed endpoint inspection records runtime status without interrupting work.
4. No background process runs, and no model tokens are consumed while no Foreman turn runs.
5. A worker report survives Foreman downtime and stays unread until a Foreman session is shown it.
6. A clean Foreman session reconstructs active state and classifies all assignments from one runtime listing without conversation history.
7. A status check detects missing or dead workers, workers idle without a report, endpoint or pane mismatch, missing workspace, and invalid resource leases without guessing recovery state.
8. A second Foreman session cannot mutate canonical state, and workers change state only through pane-bound reports.

#### 15.2 P1 supervisor autonomy

P1 is complete only when all of the following are directly demonstrated:

1. Spawn, inspect, send, read, interrupt, and stop actions have verified outcomes and lifecycle control is not encoded as normal chat.
2. A confirmed dead or missing worker is replaced with a new generation without losing the workspace, requirements, human decisions, progress, evidence, or unresolved checks.
3. `unknown` runtime state never triggers automatic recovery.
4. The replacement worker inspects existing state, and the prior generation's pane cannot update the new assignment.
5. A `blocked` report leads to either a Foreman follow-up for a technical blocker or one complete Decision Package for an authority blocker.
6. A human decision is preserved verbatim and delivered to the correct generation before work resumes.
7. A scout cannot modify production code, completes through report review, and can produce a ship task from its report only through explicit user-approved promotion before acceptance.

### 16. Scale and optimization acceptance criteria

#### 16.1 P2 scheduling and fleet scale

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
10. Disjoint resource leases may run concurrently; overlapping write or exclusive leases block scheduled dispatch and produce a recorded warning on a human-requested assignment.
11. A reused idle endpoint cannot receive a new task until its prior assignment and resources are safely reconciled and released.

#### 16.2 P3 dispatch profiles

P3 is complete only when every new task produces a durable routing record, the router can select only a configured profile, a supported tool command and model reach the runtime unchanged, an unsupported profile fails before dispatch, and fallback occurs only through the explicitly configured default profile.

## References

- [Product contract](../../product/foreman-contract.md)
- [State and runtime contract](../../decisions/state-runtime-contract.md)
- [Historical implementation baseline](../completed/implementation-baseline.md)
- [Repository documentation authority](../../WORKFLOW.md)
- [AI Agent Workflow base](https://github.com/phananhtuan09/ai-agent-workflow), inspected on 2026-10-01; installed project instructions remain the execution source of truth.
