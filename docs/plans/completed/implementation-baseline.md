# Historical implementation baseline

Status: Historical
Scope: Initial milestone, implementation snapshot, and former architecture reference
Source: Former Draft 0.6 specification, sections 19–20, and the existing architecture reference

## Goal

Preserve historical implementation and verification evidence without treating it as current product authority.

## State

The implementation snapshot records behavior and test claims dated 2026-09-28.
The architecture reference below was undated and is preserved as an implementation description, not new verification.
No runtime checks were performed as part of moving this historical material.
The original initial-milestone instructions apply to that historical milestone only.

### 19. First implementation milestone (historical baseline)

The first implementation milestone is a SPEC-first, single-project vertical slice.
The implementation worker must persist this section before running milestone tests.

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

The worker must add focused automated scenarios for home locking, atomic persistence, project-boundary validation, generation rejection, restart reconstruction, and acceptance cleanup.
Tests are run only after this section is persisted.
Observer, automatic handoff, multi-project concurrency, pull-request delivery, and additional runtime backends are outside this milestone.

Milestone implementation contract correction: the Herdr step is implemented behind a narrow, version-gated adapter seam.
Deterministic milestone tests may inject a fake Herdr transport that returns the same delivery and endpoint identity evidence; the real adapter must fail closed when the installed Herdr protocol or required command semantics cannot be verified.
This seam does not add another runtime backend or change Herdr ownership of dispatch.

### 20. Current implementation status

This section records the behavior present in the repository on 2026-09-28.
The [core roadmap](../active/core-roadmap.md) preserves sections 14–16 and their acceptance criteria; this section records which paths are implemented and which limitations are explicit.

#### 20.1 Implemented paths

- P0 durable coordination is implemented with schema-v1 validation at active-record load boundaries, an atomic migration seam that preserves the source record, durable outbox persistence before send, message IDs, task/project/worker/generation/endpoint bindings, payload digests, and delivery tracking.
- `foreman init` records `FOREMAN_ROOT` and `FOREMAN_HOME` in the login shell's startup file as described in the [home layout contract](../../decisions/state-runtime-contract.md#6-repository-and-home-layout).
- Herdr workers report through `foreman report`, bound to the assignment by `HERDR_PANE_ID`; `hooks/foreman-worker-stop.sh` prompts the report at the end of a turn.
- Paseo workers return one JSON report object per finished turn; Foreman validates the bound agent, workspace, generation, and timeline cursor before recording it.
- `hooks/foreman-session-context.sh`, configured in `.claude/settings.json` and `.codex/hooks.json`, gives the Foreman session unread reports and status anomalies on each non-`DEV` prompt.
- `foreman status` performs one read-only listing of the selected backend, flags dead, missing, mismatched, input-blocked, and idle-without-report workers without interrupting them, and shows assignments on the other backend as unobserved.
- The observer, worker heartbeat, event spool, wake queue, worker registry, inbox packages, acknowledgements, quarantine, message retry, automatic follow-up, automatic blocker triage, and automatic recovery were removed on 2026-09-25.
- P1 lifecycle control is implemented through the Herdr adapter and the Paseo SDK bridge for spawn, inspect, send, read, interrupt, and stop/archive.
- The compatibility gate checks the agent, workspace, and pane verbs used for dispatch.
- Interrupt returns success only after a later inspection shows the endpoint still exists and is no longer working.
- Recovery composes a status check that confirms `dead` or `missing`, stop or confirmed absence, a new generation, spawn, and a brief carrying the durable handoff.
- The handoff contains the brief, decisions, latest report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
- Decision Packages, verbatim human responses, decision delivery that resumes the task, `task message`, and scout-to-ship promotion are implemented.
- Adoption is an explicit request.
- It verifies an active runtime worker, project and cwd identity, and that the worker is not already assigned, then binds a new generation and the backend-specific endpoint; Paseo adoption sends the persisted brief before reports can be collected.
- A scout receives read-only resource claims; its brief has no separate instruction not to modify production files.
- Foreman does not scan or fingerprint project files to verify scout behavior; Herdr does not sandbox the worker.
- P2 multi-project binding, ship/scout task types, dependency validation and gating, resource-aware scheduling, per-project limits, fleet/per-project status views, and concurrent non-conflicting dispatch are implemented.
- P3 static dispatch-profile validation is implemented against runtime capabilities.
- Both Herdr and Paseo task routing are implemented through `FOREMAN_ROOT/config/model-routing.json`; Paseo dispatch maps its selected profile to `config/paseo-agent-profiles.json`.
- `bin/foreman-paseo profiles sync [--dry-run]` updates only Foreman-owned Paseo profile IDs, preserves Paseo-created profiles and their order, checks the selected daemon home, and verifies the written profile list.
- Paseo routing persists the selected profile snapshot on each task; profile edits do not alter existing assignments.
- Before Paseo spawn, the SDK bridge reads the selected daemon's installed agent profiles and requires the exact `paseoProfileId` and launch fields to match the confirmed task snapshot.
- A missing or mismatched daemon profile fails dispatch without implicit sync, records a reviewable dispatch error, and leaves the task queued for human remediation.
- After creation, the bridge verifies the returned agent launch settings and archives the endpoint if they differ from the confirmed snapshot.
- Routing supports the `codex`, `claude`, `omp`, and `opencode` tools, persists the brief and config digests with its selection, and forwards configured command arguments and model through Herdr.
- Invalid router output or a router process failure selects only the configured default profile and preserves the error in the routing record.
- A compatible Herdr dispatch fallback is accepted only when explicitly configured and is forwarded unchanged.
- Paseo dispatch creates an agent in the verified Foreman workspace, persists its agent and workspace IDs, and does not bind a terminal pane.
- Paseo report collection runs explicitly through `task collect` and during Paseo supervision turns; it uses the durable timeline cursor to recover missed finish events and does not treat idle or prompt acceptance as completion.
- Permission requests, worker errors, cancellations, timeline gaps, and missing or malformed reports remain visible for review; Foreman does not synthesize a successful report.
- Paseo agent acceptance archives the bound endpoint and releases resources only after endpoint closure is verified.
- `bin/foreman` is a thin wrapper over the core modules.
- Default `status` and `task list` render the grouped Vietnamese report.
- `--json` keeps the machine-readable record.
- Production distribution artifacts are present under `AGENTS.md`, `.agents/skills/`, `docs/`, `bin/`, `hooks/`, and `adapters/herdr/`.
- `legacy/` remains preserved but is not a production entry point.

#### 20.2 Runtime proof

- On 2026-09-28, the Paseo focused suite ran 6 tests and all passed.
- On 2026-09-28, `npm run test:paseo:live` started an isolated Paseo daemon, synced profiles, dispatched a real read-only scout, collected its report, checked status, accepted the task, and passed.
- The complete suite passed serially with `node --test --test-concurrency=1 test/*.test.js`: 71 passed and 3 live tests were skipped.
- The default parallel `npm test` invocation passed 70 tests and skipped 3, but twice hit the same `ENOTEMPTY` cleanup failure in `core-runtime.test.js`; running that file alone and the complete suite serially passed.
- `npm run test:live` spawned real Codex workers through Herdr 0.9.1, and both cases passed: each worker received its brief, reported through its pane, and its task became `review-ready`.
- Before the folder-trust fix, the ship case in an untrusted temporary folder failed because the brief's Enter answered Codex's trust screen and the brief was lost.

#### 20.3 Explicit compatibility limits and deferrals

- Task briefs are sent as text prompts to workers in Herdr workspaces or Paseo-managed workspaces verified against their Foreman assignment.
- Brief delivery requires no worker acknowledgement, and delivered prompts are not automatically resent.
- Herdr reports an agent showing a startup screen as idle, so spawn confirms Codex and Claude folder-trust screens with Enter before it treats the agent as ready; the workspace is a registered project that the user dispatched work into.
- A startup screen that Foreman does not recognize can still consume the brief; `foreman status` then shows the worker idle without a report.
- Resource leases have no expiry; a task that is never accepted keeps its lease until it is reassigned.
- Stop-hook support is verified for Claude Code's `decision: block` and `stop_hook_active` contract; other coding agents may use a different hook payload or output.
- Model names and OpenCode variants are passed to the selected coding tool and are not independently enumerated by Herdr; the coding tool reports unsupported models or variants.
- A routing profile may set `effort` for Codex, Claude, or OMP through the tool's native command flag; OpenCode V2 maps `effort` to its `provider/model#variant` reference.
  The adapter-level `reasoningEffort` capability remains unsupported.
- No implicit profile or model fallback is performed beyond the `default` profile named in `model-routing.json`.
- The router's selection is a recommendation shown as option 1 before every other active profile; `foreman task confirm --task ID --profile NAME` records the human's choice, and dispatch and scheduling refuse a routed, unassigned task until it is confirmed.
  Recovery keeps the confirmed profile of the assignment it replaces.
- Herdr profiles with `isActive: false` are excluded from routing; `isActive` defaults to `true`, the `default` profile must be active, and existing task routing records keep their selected profile.
- Paseo maps every shared routing profile to a repo-owned provider profile; `isActive` only controls Foreman's selection; profile synchronization is explicit and is never triggered by initialization or task creation.
- Scout read-only behavior relies only on the read-only resource lease shown in the brief; the runtime does not sandbox project files.
- Pull-request delivery, remote homes, relay channels, automatic model optimization, Paseo-managed worker subagent import, and autonomous merge authority remain deferred according to the [non-goals](../../product/foreman-contract.md#4-initial-non-goals), [roadmap](../active/core-roadmap.md), and [initial decisions](../../decisions/state-runtime-contract.md#17-deliberate-initial-decisions).

### OpenCode V2 tool dispatch within Herdr

This adds a coding **tool**, not a new runtime backend: Herdr remains the only transport and owns the workspace, pane, prompt delivery, inspection, and stop lifecycle.
An explicit `opencode` worker profile uses OpenCode V2's interactive `mini` interface with `command: ["opencode", "mini", "--standalone"]` and a `provider/model` model ID.
When `effort` is set, Herdr receives the model as `provider/model#<effort>` through `--model`; if the profile model already contains a variant, configuration validation refuses the duplicate.
OpenCode resolves whether that variant exists for the selected model; an unknown variant fails model resolution.
OpenCode V2's `mini` interface does not accept `--auto`; routing validation rejects that flag before dispatch.
The pane-local server must inherit `HERDR_PANE_ID`, `FOREMAN_ROOT`, and `FOREMAN_HOME`; a shared OpenCode service may inherit another pane's identity and cannot run the worker stop hook safely.
The command and model are forwarded as argument arrays without a shell; the router retains its existing explicit-default policy.
Fail before dispatch for a non-interactive or non-standalone OpenCode command.
Do not silently substitute another coding tool.

The global OpenCode V2 worker-stop plugin is an installation prerequisite, not part of Foreman's project state.
It listens for the root worker session becoming idle and, when the bound task has no report since the last prompt, asks that session to run `foreman report`.
Herdr's agent-state integration supplies pane liveness; neither prompt delivery nor plugin activation counts as a report.
The existing pane-bound report validation, supervision, recovery, and human acceptance rules are unchanged.
No new runtime backend, service lifecycle authority, or implicit profile fallback is added.

## Preserved implementation architecture reference

Foreman keeps global fleet state in a private file home and identifies each registered project by its canonical root path.
An explicitly selected Git worktree is checked against that registered project.
`src/foreman.js` owns task, assignment, decision, resource, acceptance, and scheduler transitions.
`src/coordination.js` owns the durable message outbox, the read-only status check, and handoff snapshots.
`src/shell-env.js` writes `FOREMAN_ROOT` and `FOREMAN_HOME` into the login shell's startup file for `foreman init`.
`bin/foreman-herdr` and `bin/foreman-paseo` set a process-scoped `FOREMAN_BACKEND`; the core CLI defaults to Herdr and selects the matching runtime adapter.
All private records live under `FOREMAN_HOME/data/`: each task keeps its brief, metadata, decisions, reports, and optional handoff in `data/tasks/<taskId>/`, while `data/messages/` holds the fleet-wide outbox.
`src/herdr.js` is the narrow Herdr adapter.
`src/paseo.js` invokes the SDK bridge in `bin/foreman-paseo-bridge.js`; each command opens a short-lived Paseo client and does not add a Foreman observer process.
`config/model-routing.json` is the shared routing source for Herdr and Paseo, while `config/paseo-agent-profiles.json` maps every model profile to Paseo's provider, model, mode, thinking, feature, and notes fields.
`bin/foreman-paseo profiles sync` replaces only Foreman-owned Paseo profile IDs while preserving app-owned profiles.
`hooks/` holds the worker stop hook and the Foreman session prompt hook.
`adapters/herdr/` is the distribution wrapper.

Every task enters a durable `routing` state after its verbatim brief is stored.
The tracked `FOREMAN_ROOT/config/model-routing.json` defines one fixed router, one default worker profile, named task groups with usage criteria and ordered profile lists, and named worker profiles.
Each configured profile belongs to exactly one group; inactive profiles are removed from routing candidates, and groups with no active profiles are omitted from the prompt.
The router may select only a configured profile; failure selects the configured default and records the error.
Task metadata records the selected profile, source, reason, any router error, and timestamp before the task becomes `queued`.
The routed profile is a recommendation; `task confirm` records the human's chosen active profile as the dispatch profile with `profileConfirmedAt`, and assignment refuses a routed task without it.
Herdr profiles support `codex`, `claude`, `omp`, and `opencode` and start the selected tool with its configured command arguments and model.
Paseo profiles materialize a provider, model, mode, thinking option, and features into the SDK agent creation call.
Before spawn, the bridge reads the selected daemon's `agentProfiles`, resolves the exact persisted Paseo profile ID, and compares its launch fields with the confirmed task snapshot.
Missing or mismatched profiles fail dispatch with a sync instruction; Foreman never syncs the daemon implicitly.
After creation, the bridge verifies the agent's provider, model, mode, thinking option, and selected feature values, and archives an agent whose settings do not match.
Paseo stores an `agentId` and `workspaceId`; Herdr stores a pane-bound endpoint.

Canonical writes use the home lock and atomic replacement.
JSON records carry `schemaVersion: 1`; unsupported or malformed active records fail closed.
Worker reports are external input.
Herdr's `foreman report` accepts one only from the bound Herdr pane, while Paseo collection reads the assistant response from the bound agent timeline after confirming assignment identity and turn completion.
Both backends store original report text under the task report directory and bind task-state changes to the current generation.

Supervision is pull-based and runs only in Foreman turns.
A Herdr worker's stop hook asks it to run `foreman report` when it ends a turn without having reported since Foreman last prompted it.
Paseo workers return a JSON report object at the end of each turn; Foreman collects new turns through an explicit command and re-reads timeline state during Paseo supervision turns.
The session prompt hook runs that Paseo collection before its single status check when the active backend is Paseo.
The report records `lastReport` in task metadata and moves a `done` task to `review-ready` or a `blocked` task to `blocked`.
The Foreman session's prompt hook prints unread reports and the anomalies of one status check, then marks those reports read.
The status check lists only the selected backend once, classifies its assignments as `working`, `idle`, `waiting-input`, `dead`, `missing`, `mismatch`, or `unknown`, and marks tasks on the other backend `unobserved`.
It never writes state or interrupts a worker.
Recovery is started explicitly by Foreman after the status check confirms `dead` or `missing`, and composes inspect, stop, and spawn.
Herdr creates a separate workspace for each new worker and receives a concise text prompt.
Paseo creates an agent in a verified Foreman workspace, receives the durable prompt through the SDK, and exposes turn status and timeline data for report collection.
The private outbox retains message identity and payload; delivered prompts are not resent.
After submission, Foreman inspects the endpoint without interrupting the worker and records the result as runtime evidence.
An uncertain task-brief submission keeps the endpoint for inspection.

Task ownership changes create a new generation.
A confirmed dead or missing worker is replaced only through a durable handoff containing the original brief, decisions, latest report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
Acceptance is the terminal user action.
It stops and verifies the worker endpoint, releases the resource lease, and deletes task-specific Foreman records and coordination state.
The project workspace remains on disk; Foreman does not commit, merge, or remove its files.
An explicit discard may remove, under the home lock, a task with no dependants that is either untouched and unassigned, or assigned to a worker a status check confirms dead or missing.

## References

- [Product contract](../../product/foreman-contract.md)
- [State and runtime contract](../../decisions/state-runtime-contract.md)
- [Core roadmap](../active/core-roadmap.md)
