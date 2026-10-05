# Project-scoped Supervisor–Lead–Peer task architecture

Status: Accepted
Date: 2026-10-02
Scope: Project Lead identity, task-scoped Peer work, coordination protocol, state, review, and lifecycle boundaries

## Context

The [2026-10-01 SLP decision](2026-10-01-supervisor-lead-peer.md) introduced a task-scoped Lead and direct Peer assignments while Foreman's runtime still implemented Supervisor–Worker tasks.
In the 2026-10-02 planning discussion, the human clarified the intended responsibility: one Lead should retain an overview of each project, assess incoming work, coordinate all project Peers, select an appropriate workflow, and continue across tasks.
The human accepted Peer-led exploration, implementation, and independent review to keep task detail out of the Lead context.
The human also accepted that task conflicts wait on resource availability, the Lead resumes eligible work, blocked work is reported through Foreman, and only the human accepts each task.
This decision supersedes the task-scoped Lead choice while retaining its compatible constraints.

## Decision

1. Bind at most one logical Lead identity to each registered project.
   The project Lead coordinates multiple top-level tasks and their direct Peer assignments; it does not supervise another Lead.
   Each runtime session has a Lead generation and endpoint.
   A session replacement increments the generation, fences the prior session, and does not restart living Peers.
2. A top-level task has its own identity, original human brief, accepted decisions, status, evidence, and human acceptance lifecycle.
   The current project Lead coordinates its scope.
   Each direct child work item has one Peer assignment, its own generation, endpoint, workspace binding, and resource lease.
   The child graph is acyclic and contains one Peer delegation level.
3. The Lead keeps project overview, active and waiting task state, dependencies, resource availability, and references to project knowledge.
   The Lead chooses the flow appropriate to each task.
   Peers perform detailed exploration, auditing, implementation, verification, and independent review.
   Project knowledge that should outlive tasks remains in the managed project's normal documentation, not in accepted-task history.
4. Only Peers make production-code changes.
   The Lead coordinates, evaluates attributed Peer evidence, records technical review milestones, and reports task readiness.
   A Peer cannot widen its delegated scope, take another Peer's assignment, access another project, or create a supervisory child.
   Foreman handles fleet coordination and human authority; it does not replace the Lead's project-level technical judgment.
5. Foreman's deterministic core is the sole canonical writer under the `FOREMAN_HOME` lock.
   Lead requests and Peer reports enter through one backend-neutral core protocol.
   Core authenticates the source project, task, current assignment, runtime endpoint, and generation; validates scope, profile, dependencies, capacity, and resource claims; persists the request and outcome; and performs every runtime operation through the assignment's bound Herdr or Paseo adapter.
   There is no second worker-spawning or state store controlled by the Lead.
6. A project Lead request uses the following logical envelope, independent of its transport:

   ```json
   {
     "schemaVersion": 1,
     "requestId": "R-unique",
     "projectId": "project-id",
     "leadGeneration": 3,
     "taskId": "T-000123",
     "action": "create-peer",
     "payload": {
       "brief": "bounded work derived from the original task",
       "dependsOn": [],
       "resources": [{ "key": "db/schema", "mode": "write" }]
     }
   }
   ```

   The initial actions are `create-peer`, `message-peer`, `record-review`, and `report-task`.
   The runtime supplies authenticated source endpoint and generation evidence; fields in worker-controlled JSON cannot establish identity or authority.
   A repeated `requestId` with the same payload returns the recorded outcome without repeating its effect; reuse with a different payload is refused.
   Core records outcomes as dispatched, waiting with reasons, or refused with reasons before replying to the Lead.
   A resource or dependency wait is durably reevaluated when relevant state changes.
   Lead requests cannot accept a task, change a confirmed profile, override a conflicting lease, stop an endpoint, or initiate recovery.
7. A Peer report uses one normalized logical envelope for both backends:

   ```json
   {
     "schemaVersion": 1,
     "assignmentId": "peer-assignment-id",
     "generation": 1,
     "status": "done",
     "summary": "bounded outcome",
     "changedSurfaces": ["src/auth"],
     "checks": [{ "name": "tests", "result": "passed", "source": "worker-claim", "evidence": "test-output.txt" }],
     "openItems": []
   }
   ```

   Herdr reports are submitted by the bound endpoint through the Foreman command interface.
   Paseo reports are structured finished-turn output collected from the bound agent timeline.
   Core derives project, task, backend, endpoint, and generation identity from its canonical assignment and runtime evidence, then preserves the original report verbatim.
   `done` is a Peer claim for review, not proof of feature readiness.
   Worker-reported checks remain worker claims unless a trusted automated result is separately observed.
8. A Lead review records the child assignments reviewed, evidence references, changed surfaces, checks and their source, integration result, and unresolved risks.
   Only a current project Lead generation may report its top-level task `ready`, `blocked`, or `progress`.
   Core marks the task ready for human acceptance only after the Lead's review report passes deterministic lifecycle checks and contains no failed required check or unresolved blocker.
   A later change to an affected shared surface invalidates the readiness evidence and requires re-review.
   Only the human accepts each top-level task.
   A human may explicitly designate a top-level SLP task as `validation` before it is completed.
   A validation task may reach `proof-complete` only when every child is an exploration or audit Peer with a preserved report delivered to the Lead, a stopped runtime, and no resource lease, and when no human decision remains unreconciled.
   Its proof record references every child report; it is terminal for scheduling and is not product readiness or human acceptance.
   Delivery tasks cannot use `proof-complete`, and validation tasks cannot report `ready`.
9. Keep canonical fleet, project Lead, task, assignment, request, report, and resource records under `FOREMAN_HOME`.
   Generate the current project view at `<registered-project-root>/.foreman/project-state.json` from canonical records.
   The project view contains only the current Lead generation, active and waiting tasks, Peer identities and generations, dependencies, resource claims, concise report/review summaries, pending decisions, and next actions.
   It is an atomic, rebuildable read view; stale or missing content never authorizes dispatch.
   It contains no accepted-task history and is removed or updated when a task is accepted.
   For Git projects, the generated `.foreman/` directory is excluded through repository-local Git metadata rather than committed as project source.
   Agents may read the view but never write it.
10. Run one deterministic local coordinator process per `FOREMAN_HOME` while SLP work is active.
    The first SLP dispatch starts it from the Foreman CLI; it acquires a per-home coordinator lock, reloads canonical records, reconciles current runtime ownership, and then processes pending work.
    It constructs the existing Herdr and Paseo adapters and selects the adapter from each canonical assignment, so one home can supervise both backends without changing an assignment's backend.
    It polls durable Lead requests, Herdr reports submitted by the bound command, Paseo timelines from their saved cursors, and runtime health through the bound adapters.
    It polls at a bounded interval and sleeps when there is no actionable work; it does not start a model turn or wake a Lead without an actionable request or report.
    Every state change still uses the canonical home lock, and all sends and requests retain stable IDs for deduplication.
    Transient read or inspect failures receive at most three attempts in one reconciliation cycle with capped backoff; exhaustion preserves the current state and records an anomaly for a later retry.
    Spawn, send, stop, and lease-release outcomes are never repeated blindly: the coordinator reconciles the request ID, message ID, and endpoint state first, and keeps the lease when the result remains uncertain.
    It exits after reconciling shutdown when no active project Lead or Peer endpoint, pending request, or undelivered core message remains; the next SLP command starts it again.
    A process or machine shutdown does not discard durable requests, reports, cursors, or leases; the next Foreman CLI turn first reconciles them and restarts the coordinator when work remains.
    A material blocker or user decision enters the durable Foreman inbox and is shown on the next Foreman turn; this decision adds no external notification channel.
11. Execute work in the client-prepared project workspace without requiring Git worktrees.
    A write or exclusive resource claim conflicts with overlapping automated claims; unknown or incomplete resource descriptions serialize the affected work instead of assuming it is safe to overlap.
    Resource identities describe the actual database, migration, test environment, code surface, or service accessed through MCP; sharing a transport alone does not imply one shared resource.
    Claims coordinate participating assignments but do not enforce filesystem permissions or exclude external actors.
    A stopped and verified non-writing Peer can release execution claims before human acceptance while its report evidence remains available.
    The review Peer obtains its own required claims.
12. A child prerequisite is satisfied only by a recorded Lead review milestone backed by its evidence, not by a raw `done` report.
    Core refuses cyclic dependencies and deduplicates activation.
    Top-level tasks retain their own human acceptance; accepting one task does not complete another task's prerequisite unless that prerequisite's declared rule is met.
13. Distinguish runtime health from recovery.
    The coordinator detects dead, missing, idle without report, waiting for input, lack of progress, and unknown evidence and preserves material anomalies for Foreman.
    A time limit alone is not proof of death.
    Failure recovery remains explicit and bounded: only two agreeing checks confirming `dead` or `missing` permit replacement; `unknown` never triggers replacement or lease release.
    Automatic context rollover is a planned generation handoff at a safe boundary, not failure recovery.
    When a Lead is unavailable, living Peers may finish and report, but new Lead-dependent work waits for a replacement generation.
14. Core initiates Lead session rollover before a configured context bound using runtime-reported usage where available.
    Every supported profile must also have a bounded actionable-turn fallback validated for its runtime before SLP dispatch is enabled.
    The core hands off only at a safe request boundary, fencing the old Lead generation without stopping living Peers.
    Refuse SLP dispatch when the selected runtime has neither a reliable context signal nor a validated bound.
15. The project Lead uses a project-bound, human-confirmed configured profile.
    `leadProfile` in `config/model-routing.json` selects the default for an explicit `project lead bind`; `--profile` overrides that choice.
    If neither is set, binding is refused; a configured `leadProfile` must name an active profile supported by the selected backend.
    Binding persists the selected runtime profile; later config changes do not change existing Leads, including replacement and recovery sessions, unless the human explicitly requests a profile change.
    Each task's Peer assignments inherit that task's human-confirmed profile.
    Neither Lead requests nor worker reports can silently change profiles.
16. Keep existing Supervisor–Worker assignments on their current model until closure.
    New SLP tasks require an explicit model identity; never convert a live task in place.
    Both Herdr and Paseo remain supported.
    If a backend lacks a required SLP capability, refuse new SLP dispatch rather than changing backend.

## Amendment: Herdr transport (2026-10-02)

The human approved these Herdr transport choices for roadmap S4 item 1; they refine items 5–7, 10, and 16 without changing the logical envelopes.

1. A Herdr project Lead submits each request envelope with `foreman lead request`, run from its bound pane.
   Core authenticates the pane against the current Lead generation's recorded endpoint, workspace, and pane, derives the source identity from that record, and only records the request.
   The coordinator processes recorded requests and returns each outcome to the Lead as a later message.
   A pane that is not the current Lead's, or a replaced generation's pane, is refused.
2. A Herdr SLP Peer submits the normalized report object as the summary of `foreman report`.
   Core refuses a report whose object does not match the assignment, generation, and report schema, or whose `status` differs from the command's `--status`.
3. Herdr prompts carry no message ID or timeline.
   An attempted delivery that cannot be proven is recorded as uncertain and is never sent again.
4. A Herdr Peer is stopped only after its pane reports idle, so the turn that submitted the report has ended.
5. Herdr does not report context usage, active turns, or the spawned model and mode.
   Rollover uses the actionable-turn bound, and a Herdr profile is checked only against its configured tool and command.
6. The coordinator selects the Herdr or Paseo adapter from each project's bound backend; a project whose adapter is unavailable is left unchanged and recorded as an anomaly.

## Amendment: resource boundaries and measurement (2026-10-02)

The human asked for the full S4 runtime on the proposed design; these refine items 9 and 11 without adding authority.

1. `file/` resource keys name project-relative paths and conflict only within one project.
   `workspace/<project>` stands for every `file/` path of that project, so work with an unknown write surface waits for known writers in its own project and does not wait for another project's.
2. `db/`, `service/`, `mcp/`, and `test/` keys name shared services or environments and conflict across projects when equal.
3. Core records each request's time in `waiting` on the request.
   It derives per-task measurements from canonical records: Lead requests, Peer count by role, correction cycles, waiting time, human decisions, follow-ups, acceptance, and runtime failures attributed to the task.
   Acceptance freezes the task's measurements in its closure record before the task's other records are purged.
4. The compact fleet view, the per-task evidence view, and the measurements are read-only projections of canonical records and never authorize dispatch.

## Constraints

- User requirements and decisions stay verbatim in canonical records and are included with the delegated scope in task briefs.
- Parent tasks and child Peer assignments stay bound to one registered project and the task's confirmed backend and profile.
- Lead and Peer generations, endpoints, workspaces, requests, reports, and resource leases are independently attributable.
- A human task's acceptance stops and reconciles only its Peer assignments; it does not stop the project Lead or assignments for other tasks.
- The project view cannot override canonical home records.
- Neither Lead nor Peer receives product-policy, security, compatibility, commit, merge, deployment, or publication authority from this decision.
- Missing, incompatible, or undiscoverable project-local Lead skill blocks SLP dispatch.
- This accepted architecture describes intended behavior; runtime, protocol transport, state projection, and shared skill are not available until their roadmap gates pass.

## Consequences

Foreman gains a project-level technical coordinator who can assess work, resolve routine blockers through Peers, and keep the human out of routine dispatch.
The core must maintain a second durable identity level for project Leads, authenticate and deduplicate structured requests, route reports to the current Lead, generate a project-local read view, release Peer resource leases independently of human acceptance, and observe both adapters outside conversational turns.
The shared skill is an optional capability in the workflow-base repository and must be deliberately imported into each managed project.
The coordinator adds one local process per Foreman home to supervise and a durable inbox for human decisions and blockers; user-facing notifications wait for the next Foreman turn.
Parallel execution remains conservative because resource claims cannot control undeclared writes or actors outside the Foreman fleet.

## References

- [Foreman product contract](../product/foreman-contract.md)
- [Baseline state and runtime contract](state-runtime-contract.md)
- [SLP implementation roadmap](../plans/active/core-roadmap.md)
- [AI Agent Workflow canonical skill source](../../../ai-agent-workflow/docs/decisions/2026-09-19-canonical-skill-source.md)
- [Superseded task-scoped SLP decision](2026-10-01-supervisor-lead-peer.md)
