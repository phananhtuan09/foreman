# Foreman core roadmap

Status: Active
Scope: Project-scoped Supervisor–Lead–Peer migration, incremental delivery gates, and preserved P0–P3 baseline
Source: Human-confirmed SLP scope on 2026-10-01; revised expectations confirmed in the 2026-10-02 interview; former Draft 0.6 specification, sections 14–16

## Goal

Give each managed project one Lead that retains an overview across tasks, chooses the appropriate workflow, and coordinates bounded Peers without requiring the human to manage routine technical steps.
Use the shared project workspace without requiring Git worktrees, and serialize work whenever safe concurrency cannot be established.
Keep detailed exploration, implementation, audit, and review in task-scoped Peers rather than accumulating them in the Lead's conversation.
Deliver a small, complete, safe task flow before adding parallel execution and broader fleet rollout.
Preserve restartability, project isolation, attributed evidence, and human acceptance of each task.
Keep the original P0–P3 roadmap and proof criteria as historical context rather than treating them as a new backlog.

## State

The code and CLI retain the compatible Supervisor–Worker path and include Paseo-backed SLP coordination.
The S0 contract and specification gate is complete, with no runtime behavior changed.
The historical implementation snapshot is not current verification.
The 2026-10-01 product and architecture updates described a task-scoped Lead and coordination only during Foreman turns.
The human revised and accepted that intent on 2026-10-02: one project-scoped Lead, Peer-driven technical work, core coordination outside human turns, and replaceable Lead sessions backed by durable state.
The governing product contract and accepted SLP architecture decision now record that intent.
S0 aligned the baseline state/runtime contract, Foreman operating instructions, and workflow-base skill prerequisite before runtime behavior changes.
The shared `foreman-lead` skill is maintained in `/home/tuanpa/Documents/projects/tuanp-github/ai-agent-workflow` and imported into the selected pilot through the existing installer.
The S1 runtime pilot `T-000017` is accepted, and the remaining live Lead handoff gate has been proven with `T-000021`; S1 is complete.
At the latest Paseo check on 2026-10-02 09:34 UTC, `T-000021`, `T-000025`, `T-000027`, `T-000029`, and internal validation `T-000031` are `proof-complete`; none was accepted.
The S2 live rollover gate passed with the confirmed `opencode-luna` profile: Lead generation 4 preserved the same active Peer assignment, read lease, and report evidence, while core refused old-generation steering.
The internal validation `T-000027` reached `proof-complete` at 2026-10-02 08:35 UTC as an evidence-only record, with blocked Peer `T-000028` as its sole evidence; it was not accepted.
`T-000028`'s stopped runtime, released lease, and delivered blocked report are retained, and the report independently verified none of the requested S2 checks.
The internal validation `T-000029` reached `proof-complete` at 08:43 UTC after Lead generation 6 dispatched Peer `T-000030` sequentially; the Peer report was delivered once, but the Lead omitted the requested pre-dispatch overview, so this run does not pass bounded reconstruction.
Lead generation 5's reported accidental Paseo runtime-control call returned HTTP 500 with an unknown effect; later read-only checks observed the expected bound Lead, and replacement by generation 6 did not erase or resolve that historical anomaly.
The generation-6-to-7 safe-boundary replacement carried queued `T-000031` to Lead generation 7 on `opencode-luna` and preserved existing Peer assignments.
The new Lead first attempted Peer creation before reconstruction; Core durably refused the request without spawning a Peer, then recorded the Lead's bounded project-state, knowledge, and core-state checkpoint before accepting one read-only Peer request.
Peer `T-000032` verified the checkpoint against the state and knowledge cited at submission, returned one report, stopped, released its lease, and delivered that report once to Lead generation 7.
`T-000031` reached `proof-complete` at 09:34 UTC as evidence only and was not accepted.
The initial T-000031 task-brief message waited while generation 7 processed its handoff, then the same durable message was delivered once; its `task.lead-delivery-pending` anomaly remains preserved.
The latest Lead status reports generation 7 on `opencode-luna` as `working` and retains prior `lead.request-invalid`, `peer.report-invalid`, `request.stale-or-mismatched`, `lead.timeline-cursor-stale`, `lead.stopped`, `decision.delivery-pending`, `task.lead-delivery-pending`, `peer.gap`, and `lead.attention-required` anomalies; no `task collect` reports were pending at 09:34 UTC.
The inaccessible resource path and earlier invalid Peer response remain preserved; neither the blocked `T-000028` attempt nor the `T-000030` read-only inspection supplies the missing live evidence for all S2 gates.
The `T-000030` inspection exposed an implementation gap: replacement Leads could create Peers without recording a bounded reconstruction of project state, knowledge, and core state.
The core now requires that checkpoint before processing any other request from a replacement or recovered Lead generation; T-000031/T-000032 provide a live Paseo proof of the gate and bounded reconstruction.

### Confirmed expectations

- Foreman remains the human's single point of contact for fleet intake, decisions, material notifications, and acceptance.
- Each project has at most one current Lead with authority to coordinate its active tasks and Peers.
- The Lead retains project overview, task status, dependencies, resource availability, and references to project knowledge across tasks.
- The Lead delegates detailed exploration, audit, implementation, verification, and review to bounded Peers.
- The Lead chooses the flow appropriate to the task and the project's actual instructions rather than imposing a mandatory explore/audit/implement sequence.
- The Lead may create within-scope follow-up work and run correction/review cycles without human approval for each technical step.
- A technical blocker that cannot be resolved, an incorrect implementation, or high implementation risk stops the affected work and produces an escalation through Foreman.
- Independent tasks continue when another task is blocked.
- Product-behavior choices and material product, security, compatibility, or operational-policy changes remain human decisions.
- Disjoint tasks may run in parallel only after their code, dependencies, and shared resources have been checked for conflicts.
- A conflicting task waits with an attributable reason; the Lead informs Foreman, which informs the human.
- The Lead resumes waiting work when its prerequisites and resources become available without asking for another human instruction.
- Coordination must progress without a new human message or a conversational Foreman turn for every Peer action.
- Each project has a core-maintained state folder that a replacement Lead can read to reconstruct current progress.
- Foreman replaces a Lead session before context exhaustion without restarting its living Peers.
- Foreman reports each task as ready for acceptance only after its review and integration requirements have been met.
- Only the human accepts each top-level task; SLP adds no commit, merge, deployment, or publication authority.
- Herdr and Paseo remain supported, and an assignment never silently changes backend.
- The first SLP execution path covers `ship`; standalone `scout` tasks retain their existing flow until separately integrated.
- An exploration Peer within a `ship` task does not imply automatic promotion of a standalone `scout`.

### Delivery rules

Each phase has a usable outcome, explicit prerequisites, and a proof gate.
A later phase must not supply a safety property required by an earlier phase.
All runtime phases start with identity validation, durable requests and reports, resource checks, bounded capacity, and human acceptance boundaries.
Start with one explicitly selected pilot project and backend rather than implementing two full dispatch paths simultaneously.
The existing Supervisor–Worker path remains usable on both backends, and unsupported SLP paths refuse dispatch without fallback.
Prove the project-scoped SLP flow on both backends before general rollout.
Do not estimate speed or token savings from the architecture alone; record pilot waiting time, human interventions, Peer count, and correction cycles before expanding.
Do not rebuild the historical P0–P3 foundation when an existing path already satisfies the revised requirement.

### Revised architecture to reconcile in S0

#### Roles, ownership, and technical authority

A Lead belongs to a project, while a human task and its Peer work items have separate identities and lifecycles.
Accepting one task does not stop the project Lead or Peers assigned to other tasks.
The Lead owns task planning and technical coordination but does not acquire an exclusive project write lease merely to coordinate.
Peers perform production changes and detailed technical checks.
A separate review Peer evaluates implementation evidence; the Lead records the resulting technical milestone or escalation.
A Peer cannot create another supervisory layer, broaden its assignment, take another Peer's work, or manipulate runtime endpoints directly.
If more scope or resources are required, the Peer reports the need and waits for an updated assignment from the Lead through core.
A Lead's assessment of correctness or risk must cite Peer findings or recorded checks rather than claim an unperformed code review.
Routine repair is allowed within scope, but unresolved blockers, incorrect approaches, high risk, and exhausted retry bounds are surfaced instead of silently looping.
Foreman handles fleet-level authority and lifecycle concerns without replacing the Lead's project-specific technical judgment.

#### One control plane and report routing

Foreman's deterministic core remains the sole canonical writer under the operational home lock.
A Lead requests Peer creation, dispatch, steering, dependency review, or resource changes through an identity-bound interface.
Core validates project, current Lead generation, task and assignment identity, delegated scope, profile, prerequisites, resources, and capacity before acting.
Declared scope validation does not prove that an arbitrary natural-language implementation satisfies the human's intent.
Requests and their outcomes are durable and deduplicated across retries, restarts, and uncertain delivery.
Core uses the existing adapters for all endpoints; there is no second worker-spawning system owned by the Lead.

The report flow is `Peer -> core -> Lead`, followed by `Lead -> core -> Foreman` for task readiness, waiting reasons, material risks, and authority decisions.
Core preserves original Peer reports and evidence before delivering compact summaries and artifact references to the Lead.
Review Peers receive the original requirements and detailed evidence needed for their checks.
Routine Peer reports do not require Foreman agent interpretation before the Lead can act.
User decisions are preserved verbatim and delivered to affected current assignments before dependent work resumes.

A supported core-mediated execution and notification path processes requests, collects reports, and wakes the appropriate Lead without requiring a human prompt.
S0 selects one Foreman-home coordinator process started by the first SLP dispatch, polling durable requests and both assignment-bound adapters with bounded read retries.
It reconstructs from canonical records on restart, refuses blind retries of uncertain mutations, and exits after all Lead and Peer endpoints, requests, and durable messages drain.
The next SLP CLI command restarts it after downtime; a durable request or report remains pending through process or machine shutdown.
The revised autonomy requirement requires an explicit change to the current Foreman-turn-only supervision contract.
Workers do not directly prompt the Foreman session; any required Foreman notification is routed through the defined core mechanism.
Routine idle checks do not wake language-model sessions without actionable work.

#### Project workflow and skill prerequisite

Maintain the shared Lead skill in `ai-agent-workflow` and distribute it through that repository's supported installer/runtime paths.
The workflow-base repository to change is `/home/tuanpa/Documents/projects/tuanp-github/ai-agent-workflow`, which supplies the base workflow imported into managed projects.
Do not maintain a competing canonical copy in Foreman or assume an upstream update changes an installed project's instructions.
Before Lead dispatch, verify compatible local installation and discovery by the selected coding tool; missing or incompatible skills refuse dispatch.
The startup brief directs the Lead to load that skill and the project's actual instructions.
Lead and Peer briefs preserve the verbatim human requirements and decisions, delegated scope, completion criteria, workspace identity, and reporting contract.
If project instructions conflict with assignment authority or fleet boundaries, record and escalate the conflict before dependent actions.

#### Durable project state and bounded context

Canonical task, assignment, decision, report, request, and lease records stay under `FOREMAN_HOME`.
The project-local state folder is a versioned, core-generated read view of that canonical state, not a competing task store.
The chosen path is `<registered-project-root>/.foreman/project-state.json`; S0 records its fields and canonical writer.
Neither Leads nor Peers edit canonical state or the generated view directly.
The view contains active and waiting tasks, Peer identities and generations, dependencies, reports and review references, resource claims, pending decisions, pending requests, and next actions.
Core can rebuild the view after an interrupted update; a missing or stale view cannot authorize dispatch or override canonical state.
A replacement Lead reads the view and reconciles it with core's current runtime and ownership evidence before requesting work.

Project architecture and enduring decisions remain in the project's existing knowledge artifacts, updated by assigned Peers under that project's workflow.
Do not turn the generated view into an accepted-task history or a competing project-documentation system.
Persist progress throughout execution rather than relying on a last-minute summary from a Lead whose context is exhausted.
Deliver relevant summaries and references instead of full logs, code diffs, or every historical report into the Lead conversation.
A persistent logical Lead does not require an immortal runtime session.
Core replaces the Lead session using an observable context signal where reliable, with a bounded fallback when the backend does not expose one.
Session rollover fences the old Lead generation, preserves living Peer generations, and transfers unhandled requests and notifications without duplicate dispatch.
Checkpointing and deliberate handoff must work in the first runtime pilot; automatic preventive rollover is completed in S2.

#### Resource lifecycle, dependencies, and readiness

The workspace remains client-prepared; Foreman does not create, switch, merge, or remove worktrees.
Use claims on the actual shared resources: changed code surfaces, database/schema, migration, test environment, or a service accessed through MCP.
Do not lock all MCP use merely because independent operations share a transport.
Normalize shared resource identities so different names for the same database or service cannot accidentally bypass a conflict.
Unknown sharing or insufficient claims cause serialization or a recorded blocker, not guessed parallel safety.
Claims coordinate participating assignments; they do not themselves enforce filesystem permissions or exclude external users.

Implementation completion, endpoint quiescence, lease release, technical review, task readiness, and human acceptance are distinct milestones.
A stopped or verified non-writing Peer can release its execution claims before human acceptance while its report and evidence remain available.
The first implementation uses verified endpoint stop before handing mutation resources to another Peer.
An implement Peer retaining a write lease cannot block the review Peer indefinitely.
Verification that mutates shared resources receives explicit claims of its own.
A child prerequisite is satisfied only by a recorded Lead milestone supported by review evidence, not a raw `done` report.
Prerequisite activation and request effects are deduplicated, and dependency cycles are refused.
A process exit or passing test is evidence, not proof that the human task is complete.
Review must cover the agreed behavior, changed surfaces, applicable checks, integration, and unresolved risks.
Evidence identifies the relevant workspace state; subsequent affected changes require revalidation before readiness or acceptance.
Waiting for human acceptance retains task evidence without unnecessarily holding execution leases.

Accepting a task verifies and stops only its bound Peer endpoints, reconciles messages and leases, and closes only that task's coordination records.
The project Lead, other tasks, shared project state, and project files survive.
Task-scoped records are removed after successful acceptance under the reconciled retention policy.
Partial closure remains restartable and never deletes state while an endpoint or resource is unresolved.

#### Runtime health, recovery, profiles, and compatibility

Runtime observation distinguishes confirmed `dead`/`missing`, idle without a report, permission/input waits, lack of progress, and `unknown`.
A time limit alone does not prove an agent is dead.
Core must observe runtime health independently of the potentially stuck Lead and surface actionable anomalies through the defined notification path.
Keep failure recovery explicit and bounded, with two agreeing checks for confirmed dead or missing endpoints, unless a separate policy revision authorizes automatic failure recovery.
Automatic preventive context rollover is a planned handoff, not permission to infer a dead agent or release an uncertain lease.
Replace only the failed assignment, preserve its workspace and evidence, and reject its old-generation requests and reports.
When a Lead is unavailable, living Peers may finish and report, but new Lead-dependent work waits until a valid Lead is bound.
A replacement Lead reconstructs all active project tasks without respawning living Peers.

Configured profiles and existing human-confirmation rules remain in force.
Peers inherit the confirmed profile for their task; a Lead cannot silently choose a different profile.
S0 defines the project Lead's configured profile binding without treating one task's confirmation as blanket authority to change profiles for other tasks.
Count Lead and Peer endpoints against the applicable runtime limits, including transient handoff endpoints.
Back up original records before schema migration, make interruptions recoverable, and refuse unsupported versions.
Existing assignments remain on their original task model until closure; do not convert a live assignment in place.
Rollback refuses new SLP intake and expansion while preserving active state, evidence, and a supported path to supervision and closure.

### Phased implementation and proof gates

#### Repository ownership

| Target repository | Planned changes |
| --- | --- |
| Foreman: `/home/tuanpa/Documents/projects/tuanp-github/foreman` | Product and architecture contracts, Lead/Peer identities, request validation, runtime lifecycle, report routing, canonical state and project read views, resources, recovery, and acceptance. |
| Workflow base: `/home/tuanpa/Documents/projects/tuanp-github/ai-agent-workflow` | Shared Lead skill, supporting Peer instructions/report templates where needed, and integration with the existing workflow installer and coding-tool adapters so projects can import the capability. |
| Selected managed pilot project | Install the compatible workflow-base revision through the supported import/install path, preserve project-specific instructions, and verify local skill discovery and loading. |

Read each target repository's own instructions and inspect its existing skill and installer layout before changing it.
Foreman owns the fleet protocol and runtime implementation; the workflow base teaches Lead and Peers how to use that protocol within the managed project's workflow.
Updating the workflow base is a separate delivery step from importing its changes into pilot projects.

#### S0 migration map

- Dispatch and durable delivery: `src/foreman.js::assignTask`, `src/coordination.js`, and `bin/foreman` already validate the project/workspace/profile, acquire the home lock and resource lease, persist the task brief, and spawn, inspect, and message through the selected adapter.
  SLP reuses those safeguards but adds project Lead identity, Peer child assignment identity, and identity-bound Lead requests.
  `bin/foreman task dispatch` explicitly allows resource conflicts for human dispatch, so the SLP Lead request path must never inherit that override.
- Reports and collection: `recordReport` accepts Herdr reports from the bound pane, while `collectPaseoReports` reads finished turns from each assigned Paseo timeline using its saved cursor and `recordPaseoReport` preserves validated output.
  SLP reuses these backend-specific ingress paths and adds child report attribution, core-to-Lead delivery, and a separate Lead review report for the parent task.
- Resource leases: the current lease belongs to the task's single assignment and remains held through task acceptance unless dispatch fails or the task is reassigned.
  SLP assigns leases to Peer generations and permits release only after a verified stop; task evidence remains until human acceptance.
- Dependencies: `acceptTask` currently detaches satisfied dependencies when the human accepts a task.
  SLP Peer prerequisites instead require a Lead-recorded review milestone, while top-level task acceptance remains a separate human action.
- Recovery and acceptance: the current recovery and `acceptTask` paths operate on one task endpoint, and acceptance verifies its stop before releasing its lease and removing its records.
  SLP adds separate Lead and Peer generations, preserves living Peers during Lead rollover, and limits each acceptance to that task's Peers and coordination records.
  Unknown runtime evidence keeps the assignment and lease unresolved and never authorizes replacement or cleanup.

#### S0: align contracts and define the smallest executable protocol

Status: Complete — contract and specification gate only; no runtime SLP capability is implemented.

Outcome: one coherent architecture and a bounded pilot specification before runtime changes.

1. Record the accepted project-scoped Lead model in the product contract and new accepted SLP decision; mark the earlier task-scoped decision superseded.
   Reconcile relevant Baseline state/runtime clauses and Foreman operator instructions for the new model.
   This Foreman documentation alignment is now recorded.
2. Map existing dispatch, outbox, reporting, collection, lease, recovery, and acceptance paths to reusable behavior and required changes.
   Include the current human-dispatch conflict override, acceptance-based dependency satisfaction, and assumptions that reports belong to a single task owner.
   The migration map below records the current code paths and SLP replacements.
3. Specify identity-bound Lead requests, responses, Peer reports, review milestones, event delivery, project read-view schema, record ownership, and retirement rules.
   Define the project's initial Lead profile binding and per-task profile inheritance.
   The accepted request/report envelope and core-owned report routing are now recorded.
4. Select the core-mediated execution/observation mechanism and bounded retry behavior for both backends.
   Document reliable context/health signals, the required bounded rollover fallback, and explicit failure-recovery behavior.
   Record that blocker and decision notifications use Foreman's durable inbox and appear on the next Foreman turn; no external notification channel is included.
5. Define the shared optional `foreman-lead` skill and installation path in the named `ai-agent-workflow` repository.
   Use its existing `skills/` source and explicit `--skill foreman-lead` installer path; specify protocol compatibility and coding-tool discovery checks.
   This cross-repository source and distribution decision is now recorded.
6. Define pilot selection criteria and the representative task's review evidence.
   Choose a registered project with current instructions, available checks, and a reversible task that exercises Lead triage, implementation, and independent review without requiring a product-policy decision.
   Choose one backend and a human-confirmed profile whose runtime supports the required identity, reporting, inspection, and bounded context signals.
   Select the exact registered project, backend, workspace, and task at S1 entry after verifying their current runtime and project instructions.
   Capture the existing-flow baseline and compare actual waiting time, human interventions, Peer count, and correction cycles rather than assuming a speedup.

Gate: every SLP action has a canonical writer, authority boundary, identity check, durable outcome, and failure behavior.
Product, architecture, and operating instructions agree on the revised model, request/report protocol, workflow-base skill ownership, and durable next-turn Foreman inbox.
The core execution and restart mechanism is specified for both backends; autonomous runtime behavior remains an S1 proof gate.
Pilot selection is an explicit S1 entry condition.

Deferred: production dispatch, parallel work, automatic context rollover, and fleet rollout.

#### S1: complete one task safely with a project Lead and serial Peers

Status: Complete — pilot `T-000017` was human-accepted and closed, and the live Lead handoff and post-handoff Peer report routing were observed in the bounded `T-000021` proof.

Outcome: a useful end-to-end flow on the selected pilot backend, with one active Peer at a time.

1. Add versioned project Lead, task, and Peer assignment identities and a task-model discriminator while preserving existing assignments.
   Create the project-local read view from canonical records and record progress after each meaningful transition.
   Back up original records and prove that an interrupted pilot schema migration resumes without losing them.
2. Implement the shared Lead skill and required installer/coding-tool integration in the workflow-base repository identified under Repository ownership.
   Import/install a compatible revision from that repository into the pilot project using its supported workflow distribution path.
   Verify discovery before dispatch and demonstrate loading the skill and the project's actual instructions.
3. Add the authenticated Lead request interface using existing core dispatch and adapter lifecycle paths.
   Enforce duplicate handling, project and generation binding, confirmed profiles, capacity, and conservative resource claims from the first dispatch.
4. Process requests and route Peer reports to the Lead through the S0 execution mechanism without conversational Foreman intervention.
   Record runtime failures, missing reports, and delivery failures even when the Lead is unavailable.
5. Let the Lead select the task flow, using an exploration or audit Peer only when needed.
   Run implementation and a separate review Peer sequentially, with verified stop and lease handoff between them.
6. Support bounded correction/review cycles and blocked/risky/incorrect-work escalation through Foreman.
   Implement the readiness gate and verbatim human-decision delivery before resuming dependent actions.
7. Implement restartable human acceptance of one task without stopping the project Lead or deleting project work.
   Reuse that Lead for a second task and preserve other waiting tasks.
8. Demonstrate core restart, duplicate delivery, stale-request refusal, and deliberate Lead handoff from durable state.
   Reject unsupported SLP backends explicitly while keeping their legacy flow operable.
   Verify interrupted task closure and pilot rollback before expanding beyond the serial flow.

Gate: a real task moves from intake through implementation, independent review, correction if needed, readiness notification, and human acceptance.
After initial intake, the workflow advances to readiness or an actionable blocker without another human message.
A false `done` or failed review cannot make the task ready.
The review Peer can acquire resources before human acceptance, and task acceptance leaves the Lead available for the next task.
Core restart and deliberate Lead replacement neither lose reports nor create duplicate Peers.
Missing or incompatible local skills fail before Lead dispatch, and interrupted migration or closure preserves resumability.

S1 pilot evidence as of 2026-10-02:

- Pilot selected after checking the registered runtime and repository instructions: project `foreman-runtime-smoke`, Paseo backend, workspace `/home/tuanpa/Documents/projects/tuanp-github/foreman`, profile `claude-sonnet`, and task `T-000017`.
  The project had no active task or worker before binding, the selected Paseo profile passed runtime validation, and the pilot loaded the repository's `AGENTS.md` and installed Lead skill.
- The compatible `foreman-lead` skill was installed from the workflow-base repository with `node /home/tuanpa/Documents/projects/tuanp-github/ai-agent-workflow/cli.js --kit coding-standard --tool claude --skill foreman-lead`.
  Its source and installed copies passed the skill validator, and dispatch verified local discovery before creating the Lead.
- Real Paseo runtime evidence is preserved under `data/tasks/T-000017/` and `data/slp/`.
  Implementation Peer `T-000018` completed and was verified stopped before independent review Peer `T-000019` was dispatched.
  The first review had only informational notes in `openItems`, so core correctly refused its accepted-review request; after that Peer stopped, Lead dispatched review Peer `T-000020` serially.
  The second review passed with no open items, core recorded the accepted review milestone, and task `T-000017` reached `review-ready` with `reviewStatus: accepted` and completion evidence at `data/tasks/T-000017/completion.json`.
- The project state projection, task migration/restart, duplicate and stale request handling, safe Lead handoff with a living Peer, correction limits, human-decision delivery, and task-scoped acceptance behavior are covered by the SLP tests.
  Full Foreman verification passed with 90 tests: 87 passed, 3 skipped, and 0 failed.
  Both focused runs of `node --test test/slp-project-state-projection.test.js` passed in the pilot workspace.
- The live project Lead reported bounded context usage of 82,613 / 1,000,000 tokens at 2026-10-02 04:58 UTC.
  The runtime pilot advanced from intake to review readiness without a new human message.
- The pilot produced seven transient runtime anomalies while invalid turns and delayed report delivery recovered.
  A later `bin/foreman-paseo task collect` restarted the drained coordinator, which reconciled them from the valid later requests, delivered Peer reports, current Lead health, and bounded context signal.
  The following production status showed all three Peers stopped with reports delivered, the Lead idle, and no open anomalies.
- The user accepted `T-000017` with `bin/foreman-paseo task accept --task T-000017` at 2026-10-02 05:01 UTC.
  The command confirmed the task closed and the project Lead was preserved.
  A subsequent `task collect` and Paseo status check at 05:01 UTC showed the Lead idle, zero open tasks, and zero anomalies.
- An earlier live Lead replacement was refused at an unsafe turn boundary, and the accepted `T-000017` pilot left no active SLP task to carry reconstruction state.
  A separate bounded gate task was therefore opened and kept distinct from the accepted implementation pilot.
- For the live handoff gate, the user selected `opencode-luna` for task `T-000021` after the original Lead endpoint stopped.
  Two runtime observations confirmed that the prior Claude-backed Lead endpoint was stopped before the explicit `project lead recover --profile opencode-luna` operation.
  Paseo then bound Lead generation 2 to endpoint `affe17e2-503e-48ee-a74e-e16548fb5745` with provider `opencode` and model `openai/gpt-6-luna`; task `T-000021` remained bound to that generation.
  This is confirmed Lead recovery, not a safe-boundary live handoff.
- At 2026-10-02 06:19 UTC, Lead generation 2 reported that task `T-000021` had no Peer assignment and opened decision `D-c0170c42f3373ef383c0`.
  At that point the task was `waiting-decision`, project state showed `peerAssignments: []`, and no Peer was active during a Lead replacement.
  The user later answered this and a second retry decision with the original-continuity option, allowing Foreman to run the proof again before handoff.
  The user has directed Foreman to use OpenCode or Codex profiles and not spawn another Claude profile.
- The user selected the original handoff-continuity criterion after `T-000021` opened two decisions about earlier attempts that had no living Peer at handoff.
  At 2026-10-02 06:33 UTC, the safe-boundary replacement completed from Lead generation 2 endpoint `affe17e2-503e-48ee-a74e-e16548fb5745` to Lead generation 3 endpoint `8f209621-6390-4e1c-8bc1-2e251c52d80a`.
  The replacement used the already confirmed `opencode-luna` profile, rebound active task `T-000021` to generation 3, and delivered reconstruction message `M-SLP-02b8cbd2b0b457330f29b77c1998`.
  Read-only Peer assignment `T-000024` generation 1 remained on endpoint `80726397-a0a2-4dbb-9f5b-0d5915c12f5d` with status `working` and its read lease held after the handoff.
  After the replacement Lead messaged that same Peer, its `done` report was saved at `data/tasks/T-000024/reports/generation-1-001-done.md` and delivered once to generation 3 endpoint `8f209621-6390-4e1c-8bc1-2e251c52d80a` as message `M-SLP-e7481ba3dff8de13f0f4ed377683` at 2026-10-02 06:36:05 UTC.
  The peer assignment remained attributable to `T-000024` generation 1 through the handoff, then its endpoint was verified stopped and its read lease released after the final report.
  Earlier gate attempts `T-000022` and `T-000023` ended with progress reports and stale-cursor anomalies; they are preserved as failed attempts and were not counted as handoff evidence.
  Task `T-000021` remains unaccepted under the human acceptance rule.
  The Lead had created four duplicate readiness decisions because `T-000021` has no implementation or independent-review Peer.
  Foreman answered them with the user's original read-only gate scope; the Lead recorded the verified proof as progress, created no more Peers, and left the task unaccepted.
  The latest `task collect` still reports stale-cursor gaps for failed attempts `T-000022` and `T-000023`.
  The later valid `T-000024` report is preserved and delivered, while its earlier no-report observation and the failed-attempt gaps remain visible rather than being cleared to make the gate pass.
  The latest runtime status shows the generation-3 Lead active and `T-000024` stopped; it also shows the original brief for `T-000024` awaiting human approval.

Workflow-base's repository-wide `npm test` and `npm run check-skills` remain blocked by the pre-existing missing `skills/runtime-e2e-test-plan` and `skills/verify-workflow` entries.
The new `foreman-lead` source validates and the existing installer successfully imports it into the pilot.

Deferred from S1: concurrent mutation, generalized dependency scheduling, and general rollout.
Automatic preventive rollover is implemented under S2; its runtime gate passed on 2026-10-02.

#### S2: bounded Lead context and reliable unattended coordination

Status: S2 implementation and focused code proofs pass, including the enforced replacement-Lead reconstruction checkpoint now verified on Paseo; the forced-rollover runtime gate passed with `T-000025` on 2026-10-02.
By the 2026-10-02 human decision, the S2 gate is the four conditions in its Gate paragraph, with criteria 3–5 accepted on focused code proofs.
The live coordinator-outage replay for criterion 2 passed with `T-000033` / `T-000034` on 2026-10-02, so S2 is complete under that decision.
Live health classification, Peer recovery, and retry-exhaustion proof move to S4; S3 still requires its own explicit start.
Do not proceed to S3 concurrency or S4 rollout under this handoff.
Focused S2 verification was rerun after the Paseo workspace-path failure and exposed two lifecycle/collection defects, which are recorded below with their tests.
Do not approve or accept `T-000021` or `T-000024`, or mark S2 complete without gate evidence.

Outcome: the project coordinator survives multiple tasks, growing conversation history, and runtime interruptions.

1. Keep Lead inputs limited to actionable summaries and artifact references; keep technical detail in Peer artifacts.
   Rebuild a fresh Lead's overview from the project read view, project knowledge, and current core state.
2. Implement automatic preventive session rollover with validated context signals and the documented bounded fallback.
   Fence the old generation, transfer pending work, and preserve living Peers and their reports.
3. Complete bounded runtime observation and event replay across Lead/Core downtime without waking idle language-model sessions unnecessarily.
   Classify stuck/no-report, permission waits, dead/missing, and unknown evidence separately.
4. Exercise explicit recovery of a failed Peer and Lead, preserving workspace, claims, scope, reports, and retry bounds.
   Test context handoff interrupted before and after the new Lead is bound.
5. Bound task repair loops and repeated dispatch/notification failures so the system reports a blocker instead of running indefinitely.
   Prevent duplicated effects when a completed request or report is replayed.

Gate: forced Lead rollover during an active Peer assignment reconstructs progress, retains the original Peer, and rejects old-Lead steering.
The coordinator handles a sequence of tasks without requiring their detailed histories in its conversation.
A lost/stuck agent produces an attributable anomaly without a new human prompt, and `unknown` never releases resources or causes replacement.
Reports submitted during Lead downtime are delivered once the current Lead is available.

Deferred: parallel write execution, broad dependency graphs, second-backend rollout, and automatic failure recovery.
Live Paseo proof of complete runtime classification, Peer recovery, and retry exhaustion is carried to the S4 gate rather than required here.

S2 implementation notes as of 2026-10-02:

- Paseo Lead context usage is validated against integer bounds and rolls over at 80% of the reported window.
  If no valid signal is available, the configured fallback is 32 actionable Lead turns, as selected by the user.
- The coordinator checks rollover only at a confirmed idle turn boundary and uses the existing generation-fenced Lead handoff path.
  Active tasks are rebound to the replacement generation while living Peer endpoints, assignments, leases, and reports are preserved.
- Lead inputs now receive bounded report summaries and artifact references instead of full Peer report bodies.
  Runtime observation records permission waits, idle no-report cases, stuck turns when context usage stops advancing, unavailable endpoints, and unknown states without treating uncertainty as death.
- The coordinator does not recover failed assignments automatically.
  Explicit Lead recovery remains gated on two agreeing missing or stopped observations, and unknown evidence does not release a Peer lease.
- `task recover --task ID` now accepts an SLP Peer only after two matching missing or stopped observations, retains its workspace, scope, profile, resource claims, report references, and prior generation evidence, and caps recovery at three attempts.
  Active-turn no-progress observation uses a 15-minute unchanged context-usage bound; this reports an anomaly and does not release a lease or trigger recovery.
- Focused SLP verification passed with `node --test test/slp.test.js test/slp-project-state-projection.test.js` (17 tests, 0 failures).
  The focused proof includes delayed Peer-report delivery across explicit Lead recovery exactly once, `unknown` with lease retention and no replacement, permission/no-report/stuck observations, bounded Peer recovery, confirmed-queued Lead recovery and safe-boundary handoff, both interrupted handoff points, blocked validation evidence, and SLP Peer prompt path semantics.
  The full `npm test` run passed with 100 tests, 97 passing, 0 failures, and 3 environment-gated skips.
  The replacement-Lead test confirms an early Peer request is refused, an incomplete reconstruction is refused, a complete progress checkpoint is persisted into the current project view, and subsequent Peer coordination is allowed.
  Final `node --check` checks passed for `src/slp.js`, `src/foreman.js`, `src/coordination.js`, `bin/foreman`, and `bin/foreman-slp-coordinator`, and `git diff --check` passed.
- A read-only Paseo status check at 2026-10-02 07:14 UTC observed Lead generation 3 on `opencode-luna` with a valid 120420/400000-token context signal and an active turn.
  Peer assignments T-000022, T-000023, and T-000024 were stopped; T-000024's report was routed, and no Peer endpoint was active.
  Four decisions on T-000021 remain pending: D-090c99b09ae1fdb8c406, D-2af352f41f38c01801e4, D-35d88f9436902fcd349a, and D-c4d64c94d7c814da58fc.
  Existing stale-cursor, invalid-request, missing-report, and stopped-Lead anomalies remain recorded.
- The accepted validation lifecycle adds `purpose: validation`, an evidence-backed terminal `proof-complete` status, and an explicit `task purpose --task ID --purpose validation` transition for eligible in-flight or queued SLP tasks.
  Proof completion requires every child to be an exploration or audit Peer, each preserved report to have been delivered to the Lead, every runtime to be stopped with its lease released, and no unreconciled human decision.
  Delivery tasks still require implementation and independent review before `review-ready`, and only the human accepts delivery tasks.
  Validation tasks cannot report `ready` or use human acceptance.
- The prior long-running coordinator had loaded SLP code from before the new lifecycle and refused its first `proof-complete` report with the old accepted-status list.
  Coordinator startup now detects a stale SLP code fingerprint, stops that coordinator process within a bounded wait, and starts the current code; the retried Lead report placed `T-000021` in `proof-complete` with evidence for T-000022, T-000023, and T-000024.
- The forced-rollover runtime gate passed with task `T-000025` and Peer `T-000026`.
  Before replacement, the project Lead was generation 3 at endpoint `8f209621-6390-4e1c-8bc1-2e251c52d80a` and `T-000026` was the sole Peer assignment, generation 1 at endpoint `efdb86af-7124-43f8-8599-a7a887ff57ef`, holding read lease `L-687c3dfb605dbc6e31623073` on `workspace/foreman-runtime-smoke`.
  The safe-boundary `project lead replace` operation bound Lead generation 4 at endpoint `2f49e97d-54d2-429a-8852-41ae515b661c` and returned `peerAssignmentsPreserved: true`.
  A post-handoff status confirmed that Peer ID, generation, endpoint, read claim, and lease ID were unchanged while T-000025 was rebound to Lead generation 4.
  A stale generation-3 `message-peer` probe (`R-T-000025-stale-after-rollover-g3-1`) was durably refused with reason `request source is not the current project Lead generation`; no runtime message was created.
  After a corrected Paseo progress report, core stopped the Peer, released its lease, preserved the report, and delivered it exactly once to Lead generation 4 in message `M-SLP-d72450abd4dc4f5e740d9d48d0bd` at 2026-10-02 07:54:02 UTC.
  Lead generation 4 inspected the preserved report and recorded `T-000025` as `proof-complete` without acceptance.
  The Peer report states that its permitted project resource path was unavailable, so it did not inspect implementation, tests, roadmap, or runtime; Foreman independently captured the handoff and stale-generation evidence above.
  The earlier invalid Peer response, the corrected report's open items, stale-cursor gaps on `T-000022` and `T-000023`, and other existing anomalies remain recorded and were not cleared to make the gate pass.
- Coordinator and core Paseo report collection exclude already verified-stopped SLP Peers, so retained terminal assignments are not reread as live Paseo timelines.
  Pending core-to-Lead messages are transferred with their prior-delivery evidence to a fenced replacement generation, and a transferred Peer-report message records `peerReportDeliveredAt` only after the current Lead actually receives it.
  Both deliberate Lead replacement and explicit recovery accept a confirmed queued SLP task as the durable reconstruction carrier, update its Lead generation during reconstruction, and allow its later dispatch through the new Lead.
  SLP Peer prompts distinguish logical resource lease keys from filesystem paths while preserving the legacy Supervisor–Worker prompt layout.
  Validation `proof-complete` now records any preserved, delivered, stopped exploration/audit Peer report, including a blocked report; it remains an evidence-only terminal state and does not resolve blockers or pass an S2 gate.
- A replacement or recovered Lead generation must submit one `report-task` progress checkpoint with bounded `projectState`, `knowledge`, and `coreState` summaries before Core processes its other requests.
  Core stores the checkpoint with the canonical Lead record and exposes the current-generation result in the generated project view; focused tests and live T-000031/T-000032 evidence prove refusal before the checkpoint and sequential coordination after it.
  Independent Peer verification found the checkpoint matched the cited state at submission; its inspected project view predated newer progress timestamps, while the canonical task and lease state matched and the later generated view showed T-000031 proof-complete and T-000032 stopped with its report.
- `buildProjectState` now projects only unresolved `pending` and `waiting` Lead requests, with compact outcomes, rather than every completed, refused, and dispatched request from all Lead generations.
  The current Paseo view shrank from 95,396 bytes with 148 resolved request summaries to 11,595 bytes with zero unresolved requests; the 148 canonical request records remain intact under Foreman home.
  Focused projection tests verify that pending requests remain visible while terminal history is omitted from the current view.
- At 2026-10-02 08:06 UTC, read-only Paseo inspection confirmed generation 4 endpoint `2f49e97d-54d2-429a-8852-41ae515b661c` was stopped.
  `project lead recover --project foreman-runtime-smoke --profile opencode-luna` performed two matching stopped observations and bound generation 5 endpoint `a6341ebf-15d3-4fbf-bb81-a6ad9ff521be` with a delivered reconstruction message.
  The confirmed queued validation `T-000027` then dispatched through that replacement Lead, which created the one permitted read-only exploration Peer `T-000028` sequentially.
  `T-000028` stopped, released its lease, and its blocked report was delivered once to generation 5 at 2026-10-02 08:09:03 UTC.
  The report preserved the exact blocker: `/home/tuanpa/Documents/projects/tuanp-github/foreman/workspace/foreman-runtime-smoke` did not exist for the Peer, so it independently verified none of the requested S2 evidence and made no file or runtime changes.
  No decision was opened.
  After the validation proof lifecycle was aligned with the accepted contract, `T-000027` recorded this blocked attempt as `proof-complete`; its summary states that the requested checks were not run and makes no S2 pass claim.
- The task brief and dispatch record show that `T-000028` received the actual workspace `/home/tuanpa/Documents/projects/tuanp-github/foreman` and the logical read-lease key `workspace/foreman-runtime-smoke`.
  Its prompt did not explain that the key was not a directory, and the report confirms it checked the nonexistent `<workspace>/workspace/foreman-runtime-smoke` path without inspecting the project.
  The SLP Peer prompt now explicitly labels resource claims as logical lease keys and directs file inspection to the `Workspace` path.
- Read-only Paseo `task collect` runs at 2026-10-02 08:28, 08:30, 08:32, and 08:34 UTC returned no report tasks after the stopped-Peer collection filter was added.
  The earlier stale-cursor `peer.gap` records for T-000021, T-000025, and retained Peer assignments remain unresolved and were not removed or rewritten.
- At 2026-10-02 08:17 UTC, Lead generation 5 reported that it accidentally invoked a Paseo runtime-control tool and received HTTP 500, so its effect was uncertain.
  At 08:32 and 08:34 UTC, read-only fleet status still observed the bound Lead endpoint `a6341ebf-15d3-4fbf-bb81-a6ad9ff521be` running with the expected project, generation 5, workspace, and `opencode-luna` profile; this does not resolve the earlier call's effect.
  The same Lead later reported an empty/out-of-scope patch attempt rejected without file changes; both reports remain in canonical request outcomes.
- A second safe-boundary replacement carried confirmed queued validation `T-000029` from Lead generation 5 to generation 6 on `opencode-luna` at 08:38 UTC.
  Lead generation 6 bound endpoint `6e312352-e9da-47c8-8583-d1ec7aa6665a` and received the durable reconstruction message `M-SLP-35e95c597a450c825d3ec775412d` before dispatching the task.
  It created exactly one sequential read-only exploration Peer, `T-000030` generation 1 at endpoint `1d0c86c7-779a-465f-a5a6-0cabdae3e4ba`, on workspace `/home/tuanpa/Documents/projects/tuanp-github/foreman` with read lease `L-3c35983a1f70575eb4f4c7e2`.
  The corrected SLP Peer prompt distinguished that actual checkout from the logical claim key `workspace/foreman-runtime-smoke`; `T-000030` completed without changes, its lease was released, and its report was delivered once to generation 6 at 08:42:36 UTC.
  The Lead did not record the requested overview summary before creating `T-000030`; its first recorded task summary arrived after the Peer report, so this run does not pass the bounded-reconstruction criterion.
  `T-000029` reached `proof-complete` at 08:43 UTC as an evidence-only record whose summary explicitly leaves the overall S2 gate open; it was not accepted.
- The `T-000030` report independently inspected code, tests, project state, and roadmap without reading detailed runtime timelines or controlling endpoints.
  It supports code/test coverage for request replay and deduplication, runtime classification, explicit recovery and generation fencing, and retry caps, but reports no new live Core-downtime replay, live Peer recovery, complete live health classification, or retry-exhaustion proof.
  Its inspection found that the generated view contained 148 completed/dispatched/refused request summaries at 95,396 bytes; Foreman confirmed the source behavior and changed the projection without deleting any canonical request evidence.
- S2 evidence assessment: criterion 1 passes for bounded Lead reconstruction: the generation-6-to-7 safe-boundary replacement recorded a checkpoint from current project state, accepted knowledge, and canonical core state before a Peer could be dispatched, and `T-000032` independently verified it without detailed runtime timelines.
  The earlier generation-5-to-6 `T-000029` run remains a failed live attempt under the prior prompt-only implementation; the later enforced gate rejected that ordering and preserved its refusal evidence.
  `T-000032` noted its project-view snapshot predated newer progress timestamps; the checkpoint itself matched state at submission, and the subsequent generated view showed the stopped Peer report and proof-complete parent.
  Criterion 2 is code-proven by the focused exactly-once outage/recovery test and has live once-only report delivery after Lead replacements in `T-000025`, `T-000029`, and `T-000032`; no report/request was observed arriving during an actual Core or Lead outage and replaying afterward.
  Criterion 3 is code-proven for permission wait, idle/no-report, stuck, unavailable, and unknown-without-release; its complete classification has not been independently exercised on Paseo.
  Criterion 4 is code-proven for bounded Peer and Lead recovery and interruption before and after binding, while Paseo directly proves Lead generations 3-to-4, 4-to-5 recovery, and safe-boundary replacements from generation 5 to 6 and 6 to 7.
  A live Peer recovery remains unproven because the supported Foreman interface has no safe way to induce a confirmed Peer stop for a validation assignment without adding an unsupported runtime-control operation.
  Criterion 5 is code-proven for three-attempt Peer recovery exhaustion and exactly-once notification transfer, with pending delivery observed and later delivered during the generation-5 handoff; broader live retry exhaustion remains unproven.
  Criterion 6 remains passed by the preserved `T-000025` / `T-000026` forced-rollover evidence.
  Therefore S2 is not complete, and S3, rollout, concurrency, and a second backend remain deferred.

S2 proof map after the focused verification delta:

- Criterion 1 (bounded reconstruction over sequential tasks): pass.
  Replacement/recovered Lead generations now require a structured progress checkpoint covering the current project view, applicable knowledge, and core state before any other request can execute.
  Focused tests and live generation-6-to-7 evidence verify that premature Peer requests are refused, an incomplete checkpoint cannot pass, and a complete checkpoint is persisted before sequential Peer dispatch.
  T-000032 verified the submitted summary against its cited project knowledge and state without detailed runtime timelines; the view's later progress-timestamp lag is retained as a freshness caveat, not misreported as a reconstruction pass failure.
- Criterion 2 (Core/Lead downtime replay and exactly-once delivery): pass for a coordinator outage; Lead-endpoint downtime replay remains code-proven only.
  Focused tests exercise durable outbox transfer and exactly-once Peer report delivery through explicit Lead recovery, and `T-000025` and `T-000029` prove one live report delivery after their respective Lead replacements.
  `T-000032` adds one live report delivery to generation 7 after a Lead turn was busy.
  The live outage run used validation `T-000033` and Peer `T-000034` on `opencode-luna` under Lead generation 7.
  At 10:14:36 UTC, with `T-000034` running, Foreman sent SIGTERM to the SLP coordinator process (pid 3767567); `coordinator.json` kept its last `running` record with a stale heartbeat.
  The Peer finished at 10:15:16 UTC while the coordinator was down, and the report was recorded as `review-ready` with its runtime not yet stopped, no lease release, and no delivery to the Lead.
  The recording came from the Foreman session-context collection, not the coordinator; the coordinator did not restart by itself.
  `task collect` at 10:15:28 UTC started a new coordinator (pid 3777518), which stopped the Peer runtime by 10:15:37 UTC and delivered exactly one `slp-peer-report` message to Lead generation 7 at 10:15:39 UTC.
  Lead generation 7 recorded `T-000033` as `proof-complete` at 10:16:01 UTC, without acceptance; its summary correctly limits the claim to test-name coverage and does not itself claim the outage replay, which is Foreman's independent capture.
  Follow-up fix: the Foreman session-context hook, which runs on each non-`DEV` prompt, now starts the coordinator whenever SLP work needs it and no live matching process exists; `bin/foreman` with a throwaway home restarted a killed coordinator on the next hook run, and a focused test covers the no-work and work cases.
  The restart is still triggered by a Foreman command or prompt; with none, an idle coordinator stays down until the next one, and a supervisor-level service is not part of S2.
  The Lead endpoint stayed up during this run, so Lead-endpoint downtime replay is covered by the focused outage/recovery test and by the generation hand-offs only.
- Criterion 3 (runtime classification and unknown safety): accepted on code/test proof; full live classification carried to S4.
  Focused tests cover idle/no-report, stuck/no-progress, permission wait, unavailable endpoints, and unknown without releasing a lease or replacing a Peer.
  Live Paseo already produced attributable `lead.stopped`, `lead.timeline-cursor-stale`, and `peer.gap` anomalies without a human prompt and without releasing or replacing living Peers.
  The complete classification set was not safely exercised on Paseo.
- Criterion 4 (explicit Peer/Lead recovery, identity preservation, fences, bounded attempts, interrupted handoff): accepted on code/test proof plus live Lead recovery; live Peer recovery carried to S4.
  Focused fake-Paseo tests cover bounded Peer recovery, workspace/scope/profile/claims/history preservation, stale-generation fencing, Lead recovery, and interruptions before and after bind; live Paseo proves Lead recovery from generation 4 to 5 plus safe-boundary replacements from generation 3 to 4, 5 to 6, and 6 to 7.
  A live Peer recovery was not attempted because the current supported Foreman interface has no safe way to induce a confirmed Peer stop for a validation assignment without adding a separate runtime-control operation.
- Criterion 5 (bounded repair, dispatch, and notification retries): accepted on code/test proof; live exhaustion carried to S4.
  Focused tests verify the two-cycle correction cap, three-attempt Peer recovery cap, and no blind duplicate delivery after uncertain attempts.
  No safe Paseo scenario exhausted those retry limits.
- Criterion 6 (forced rollover preserves living Peer and rejects old-Lead steering): pass.
  The `T-000025` / `T-000026` evidence above confirms unchanged Peer identity, generation, endpoint, read lease, reconstructed state, stale-generation refusal, and one report delivery to generation 4.

The S2 gate is met under the 2026-10-02 decision: criteria 1, 2 (coordinator outage), and 6 have live proof, and criteria 3–5 are accepted on focused code proof with live proof carried to S4.
No S3, concurrency, second-backend work, or rollout is authorized by this roadmap entry.

#### S3: safe shared-workspace concurrency and dependencies

Status: Closed on 2026-10-02 by the user's decision on the recorded evidence: live Paseo proof for disjoint concurrency, automatic resumption of a conflicting wait, and a once-only reviewed prerequisite; focused code proof for the remaining gate items, whose live proof carries to S4.
The user will accept `T-000035` and `T-000036` themselves; this entry does not record that acceptance.
Nothing from S3 is committed.
The user started S3 on 2026-10-02 and chose local capacity configuration (2 active tasks, 2 live Peers per project, 6 SLP endpoints fleet-wide), lightweight prerequisite milestones for exploration/audit Peers, scratch-file live proof, and the `opencode-luna` profile.
S4, broad rollout, and a second backend remain deferred.

Outcome: independent tasks run together, conflicting tasks wait, and eligible waiting work resumes automatically.

1. Extend conservative workspace claims to verified code-surface and shared-service claims, including database, migration, test, and MCP-accessed resource identities.
   Keep conflicting or uncertain work serialized and check capacity at every automated dispatch.
2. Let the Lead use an exploration Peer to assess a new task against existing work and propose claims.
   Do not give an exploration Peer mutation authority merely to discover a conflict.
3. Add explicit Peer dependencies and Lead-recorded reviewed milestones, refusing cycles and duplicate activation.
   Preserve evidence until task closure even after a prerequisite Peer releases its execution claims.
4. Permit disjoint task execution and route technical blockers back to the Lead.
   A conflicting task records its waiting reason for Foreman and resumes automatically when its claims and prerequisites become available.
5. Verify integration after parallel changes with a separate Peer and explicit verification claims.
   Invalidate affected prior evidence when shared-workspace changes make it stale.
6. Exercise independent Peer replacement and Lead rollover with multiple live Peers.
   Prove accepting one task cannot stop another task's Peer or delete its evidence.

Gate: task B starts alongside task A when their verified claims are disjoint.
A database/migration or code-surface conflict blocks B, produces a human-visible waiting reason through Foreman, and later resumes B without another human instruction.
A reviewed prerequisite unlocks dependent work once; a raw completion claim does not.
A cross-Peer integration defect triggers correction and prevents readiness.
A blocked task leaves independent tasks running.

S3 implementation notes as of 2026-10-02:

- Capacity comes from the local, gitignored `config/slp-capacity.json` (`schemaVersion`, `maxActiveTasksPerProject`, `maxLivePeersPerProject`, optional `maxSlpEndpoints`).
  Without the file the pilot stays serial at 1 task and 1 Peer per project with no fleet cap; an invalid file refuses SLP dispatch instead of widening capacity.
  Task dispatch, `create-peer`, Peer recovery, and new Lead sessions check these limits every time; the fleet count is bound Lead endpoints plus Peer endpoints not verified stopped.
  The pilot file is 2/2/6.
- A `dependsOn` prerequisite is satisfied only by a verified stop and a Lead-recorded review milestone.
  Implementation and correction prerequisites use the accepted independent review milestone; exploration and audit prerequisites use `record-review` with `kind: "prerequisite"`, which records the Lead's review of a delivered report and does not change task readiness.
  The independent review Peer may depend on the implementation it reviews once that Peer has stopped, because it produces that milestone.
- Core reevaluates waiting `create-peer` requests (`resource`, `capacity`, `prerequisite`) in request order on every coordinator tick, persists an outcome only when it changes, and tells the Lead once when the request is dispatched or refused.
  Waits appear in the project view, project status, and the Foreman inbox with their reason and holder.
  A Lead handoff or recovery no longer waits for these requests: it refuses them as superseded, preserving the original wait, and lists them in the handoff message so the new Lead resubmits them with the same request ID and payload, which reuses the pending Peer assignment.
- The Lead brief no longer claims `workspace/<project>`; Lead protocol corrections and no-report anomalies go to the task the Lead was most recently prompted for instead of the first active task.
- An implementation or correction Peer report whose changed surfaces fall outside its write claims makes the Peer blocked, records `peer.claim-exceeded`, and tells the Lead which surfaces exceeded; only a correction Peer that resolves it clears review and readiness.
  Review Peers may hold write claims only on `db/`, `test/`, `service/`, and `mcp/` resources; code surfaces stay read-only.
- When a Peer on one task may change (at dispatch, by write claims) or did change (outside its claims) a surface that another task's accepted review covered, core clears that task's review pointers, returns a `review-ready` task to `working`, notifies its Lead, and keeps the review and completion records as evidence.
  Accepting one task stops and removes only its Peers and records.
- Focused verification: `npm test` ran 113 tests with 110 passing, 0 failing, and 3 environment-gated skips; the new tests cover capacity, milestones, automatic resumption, rollover with waits, multi-task routing, claim verification, cross-task invalidation, acceptance isolation, and a blocked task not stopping an independent task.
  An integration defect across Peers is proven only by the claim-exceeded and invalidation tests; it is not exercised live.
- The `foreman-lead` skill was updated in `ai-agent-workflow` (concurrent work, waits, prerequisite milestones, claim conventions, and the validation lines that had drifted in the installed copy) and re-imported through the supported installer output; `quick_validate.py` passes on both copies.
  `npm run check-skills` in that repository still fails on the pre-existing missing `skills/verify-workflow` entry.

S3 live evidence as of 2026-10-02 (UTC, project `foreman-runtime-smoke`, backend Paseo, profile `opencode-luna`, capacity 2/2/6):

- The scratch tasks `T-000035` (A) and `T-000036` (B) wrote only new files under the locally excluded `tmp/s3-gate/`; their briefs fixed the exact resource claims and a `sleep 150` so the claims overlapped in time.
  Both reached `review-ready` (B at about 11:22, A at about 11:30) and neither was accepted; they hold the project's two task slots until the user accepts them.
- Disjoint claims ran together: A's Peer `T-000037` (`file/tmp/s3-gate/a.txt` write, `db/s3-gate` write, running 11:05:20–11:08:27) and B's Peer `T-000038` (`file/tmp/s3-gate/b.txt` write, 11:05:47–11:06:26) held leases at the same time.
- A conflict waited and resumed without a human instruction: B's second request `R-T000036-G9-b-db-impl-1` (created 11:06:03) first waited on `project Peer capacity (2) is held by T-000037, T-000038`, then, once `T-000038` stopped, on `requested resources are held by T-000037 on db/s3-gate`.
  After `T-000037` stopped at 11:08:27, core dispatched `T-000039` at 11:08:39 from the same request; the Lead sent no second request, exactly one Peer exists, and the Lead received one `waiting` (11:06:04) and one `dispatched` (11:08:40) outcome message.
  The reason was recorded in the request outcome and the generated project view while waiting; the Foreman inbox rendering of waits is proven only by a focused test, not captured live.
- A reviewed prerequisite unlocked a dependent once: exploration Peer `T-000040` stopped at 11:09:43 and its report was delivered at 11:10:52.
  The dependent request `R-T000035-G9-a2-impl-1` (created 11:23:21, `dependsOn` `T-000040`) waited with `Peer prerequisites require a verified stop and a Lead-recorded review milestone` although the exploration report was already `done`.
  After the Lead recorded prerequisite milestone `RV-753673d4dd30ffb99d14` at 11:23:45, core dispatched `T-000044` once at 11:24:00.
- Both tasks went through independent review: B's first review (`T-000041`) requested changes because the reports did not establish the `db/s3-gate` claim, correction `T-000042` and review `T-000043` followed, and the second review was accepted; A's review `T-000045` was accepted.
- The Lead enforced reconstruction on generation 8: requests sent before the checkpoint were refused (10:55–10:58) and the checkpoint was accepted at 10:59:30.
  The generation-8 endpoint then stopped and generation 9 was bound at 11:03:08 by a Lead recovery that was not run in this session; no Peer was live at that point, and the cause of the stop and who ran the recovery are unverified.
  All earlier anomalies, plus the new `task.lead-delivery-pending` entries for `T-000035`/`T-000036` and resolved `peer.report-delivery-pending` entries, are preserved.
- Not exercised live: a cross-Peer integration defect or `peer.claim-exceeded`, cross-task readiness invalidation, a blocked task beside a running one, and Lead rollover or Peer replacement with multiple live Peers.
  These are covered only by the focused tests above.

Deferred: broad fleet rollout, additional resource automation beyond demonstrated needs, and dispatch optimization.

#### S4: backend parity, fleet rollout, and measured simplification

Outcome: the proven project flow operates on both supported backends and more than one project.
Status: Runtime and focused tests for items 1–5 exist as of 2026-10-02; Paseo ran live with two projects in an isolated home (the user deferred Herdr live proof), so the S4 gate is not met and the rollout procedure stays a `Reference`; see [the S4 plan](s4-herdr-slp-parity.md).

1. Implement and verify the remaining backend against the same request, report, notification, context-handoff, resource, and acceptance contracts.
   Preserve backend identity and refuse unsupported profiles or runtime capabilities without fallback.
2. Complete interrupted schema migration, partial acceptance, event-delivery uncertainty, and rollback proof on both backends.
   Disabling new SLP work preserves supervision, recovery, and closure of active SLP tasks.
3. Demonstrate concurrent work in at least two registered projects with fleet/project capacity and canonical resource boundaries.
   Check per-project Lead views against Foreman's fleet view and prevent cross-project mutations.
4. Provide compact fleet/project views with detailed attributable evidence available on demand.
   Record waiting time, human interventions, runtime failures, Peer count, and correction cycles for representative small and larger tasks.
5. Keep small-task flows short and remove demonstrated unnecessary steps without weakening review or acceptance gates.
   Publish rollout and rollback procedures only with disclosed verification evidence.

Carried from S2: exercise live on Paseo the complete runtime health classification, explicit Peer recovery, and retry exhaustion, which S2 accepted on focused code proofs.

Carried from S3: exercise live a cross-Peer integration defect with `peer.claim-exceeded`, cross-task readiness invalidation, a blocked task beside a running one, Lead rollover and Peer replacement with multiple live Peers, and the Foreman inbox rendering of waits, which S3 accepted on focused code proofs.
Also explain the unverified generation-8 Lead stop and generation-9 recovery at 11:03:08 UTC before relying on Lead recovery evidence.

Gate: both backends pass the serial, rollover, conflict/dependency, and interrupted-closure scenarios.
Fleet and project views agree, cross-project effects are refused, and endpoint reuse occurs only after reconciliation.
Existing Supervisor–Worker assignments remain operable through closure.
Pilot evidence shows whether the additional coordination is worthwhile before extending rollout.

Deferred: SLP integration of standalone scouts, new backend types, worktree orchestration, model-routing optimization, accepted-task history, and publication automation.

### Rollout boundaries and remaining choices

S0 contract and specification work is complete; the selected S1 pilot is recorded above with its runtime and repository-instruction evidence.
Runtime milestone completion must cite actual checks and outcomes rather than skill presence, prompt delivery, process exit, or worker claims alone.
The Paseo S1 pilot implements the project state folder, request/report protocol, and coordinator lifecycle described above.
S2 source changes implement preventive rollover, a 32-actionable-turn fallback, explicit Peer recovery, and bounded runtime observation.
The `T-000025` forced-rollover runtime gate is proven; the live coordinator-outage replay also passed, so the S2 gate is met, and no broad rollout has occurred.
Changes in `ai-agent-workflow` and installed pilot-project skills are separate cross-repository work and must preserve those repositories' actual instructions.
No phase enables automatic recovery of an uncertain endpoint, conflicting automated writes, broader product scope, or publication authority.
Stop rollout on missing evidence, incompatible skills, uncertain resource ownership, or irreconcilable runtime identity.
Preserve active records and workspaces for inspection and recovery rather than deleting them to make a gate pass.

### Historical P0–P3 roadmap

The following sections preserve the former Draft 0.6 roadmap and proof criteria.
They are not a current completion assessment or authorization to repeat implemented work.
Before retiring a preserved implementation, identify the exact legacy paths and the equivalent behavior proven by the replacement; the historical wording alone does not define a deletion scope.
The automatic-recovery item is retained as historical wording; the current SLP migration instead follows the explicit recovery policy above.
The historical P0 criterion requiring no background process applies to the legacy Supervisor–Worker path; accepted SLP coordination supersedes it only for enabled SLP assignments.

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
- [Accepted project-scoped SLP decision](../../decisions/2026-10-02-project-scoped-supervisor-lead-peer.md)
- [Historical implementation baseline](../completed/implementation-baseline.md)
- [Repository documentation authority](../../WORKFLOW.md)
- [Workflow-base Lead skill installation decision](../../../../ai-agent-workflow/docs/decisions/2026-10-02-foreman-lead-skill-installation.md)
- [AI Agent Workflow base](https://github.com/phananhtuan09/ai-agent-workflow), inspected on 2026-10-01; installed project instructions remain the execution source of truth.
