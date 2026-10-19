# Foreman core roadmap and implementation status

This completed plan preserves the roadmap, acceptance criteria, first milestone, and implementation status recorded in the former `SPEC.md` (Draft 0.6) before it was split into `docs/product/` and `docs/decisions/` on 2026-10-17.
It is historical context, not product authority; accepted behavior lives in `docs/product/` and accepted decisions in `docs/decisions/`.
Section numbers below are the original `SPEC.md` numbers, kept because older proposals cite them.
The former sections 17 and 18 now live in `docs/decisions/`, and the OpenCode V2 section lives in `docs/product/runtime-backends-and-routing.md` and its decision record.
The `legacy/` copy mentioned below was removed on 2026-10-17 and remains available in Git history.

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
   The routed profile is a recommendation: the user confirms it or chooses another active profile before the task can dispatch.
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
5. A `blocked` report leads to a user-confirmed next round, or one complete Decision Package when Foreman sees an authority choice.
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
10. Disjoint resource leases may run concurrently; overlapping write or exclusive leases block scheduled dispatch and produce a recorded warning on a human-requested assignment.
11. A reused idle endpoint cannot receive a new task until its prior assignment and resources are safely reconciled and released.

### 16.2 P3 dispatch profiles

P3 is complete only when every new task produces a durable routing record, the router can select only a configured profile, a supported tool command and model reach the runtime unchanged, an unsupported profile fails before dispatch, and fallback occurs only through the explicitly configured default profile.

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

This section records the behavior present in the repository on 2026-09-28.
Sections 14–16 remain the normative roadmap and acceptance contract; this section records which paths are implemented and which limitations are explicit.

### 20.1 Implemented paths

- P0 durable coordination is implemented with schema-v1 validation at active-record load boundaries, an atomic migration seam that preserves the source record, durable outbox persistence before send, message IDs, task/project/worker/generation/endpoint bindings, payload digests, and delivery tracking.
- `foreman init` records `FOREMAN_ROOT` and `FOREMAN_HOME` in the login shell's startup file as described in section 6.
- Herdr workers report through `foreman report`, bound to the assignment by `HERDR_PANE_ID`; `hooks/foreman-worker-stop.sh` prompts the report at the end of a turn.
- Paseo workers return one JSON report object per finished turn; Foreman validates the bound agent, workspace, generation, and timeline cursor before recording it.
- `hooks/foreman-session-context.sh`, configured in `.claude/settings.json` and `.codex/hooks.json`, gives the Foreman session unread reports and status anomalies on each non-`DEV` prompt.
- `foreman status` performs one read-only listing of the selected backend, flags dead, missing, mismatched, input-blocked, and idle-without-report workers without interrupting them, and shows assignments on the other backend as unobserved.
- The observer, worker heartbeat, event spool, wake queue, worker registry, inbox packages, acknowledgements, quarantine, message retry, automatic follow-up, automatic blocker triage, and automatic recovery were removed on 2026-09-25.
- P1 lifecycle control is implemented through the Herdr adapter and the Paseo SDK bridge for spawn, inspect, send, read, interrupt, and stop/archive.
- The compatibility gate checks the agent, workspace, and pane verbs used for dispatch.
- Interrupt returns success only after a later inspection shows the endpoint still exists and is no longer working.
- Recovery composes a status check that confirms `dead` or `missing`, stop or confirmed absence, a new generation, spawn, and a brief carrying the durable handoff.
- The handoff contains the user's original wording, every delivered round, the last report of each recent round, decisions, latest report, evidence, unresolved checks, workspace, resources, and inspect-first instructions; the brief itself reaches the successor as its request.
- Decision Packages, verbatim human responses, decision delivery that resumes the task, `task message`, and scout-to-ship promotion are implemented.
- Task rounds are implemented: `task continue`, `task reassign`, and `task brief`, with the instruction and the user's words stored per round, mode and lease changes at round boundaries, and per-round handoff.
- Image attachments are implemented for both backends: `image stage` reads pasted images from the Claude Code or Codex session transcript, `--image` attaches staged IDs or files to task creation, rounds, messages, and decision answers, Herdr and Paseo workers read copies in the workspace, and Paseo also receives the current images inline.
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

### 20.2 Runtime proof

- On 2026-09-28, the Paseo focused suite ran 6 tests and all passed.
- On 2026-09-28, `npm run test:paseo:live` started an isolated Paseo daemon, synced profiles, dispatched a real read-only scout, collected its report, checked status, accepted the task, and passed.
- The complete suite passed serially with `node --test --test-concurrency=1 test/*.test.js`: 71 passed and 3 live tests were skipped.
- The default parallel `npm test` invocation passed 70 tests and skipped 3, but twice hit the same `ENOTEMPTY` cleanup failure in `core-runtime.test.js`; running that file alone and the complete suite serially passed.
- `npm run test:live` spawned real Codex workers through Herdr 0.9.1, and both cases passed: each worker received its brief, reported through its pane, and its task became `review-ready`.
- Before the folder-trust fix, the ship case in an untrusted temporary folder failed because the brief's Enter answered Codex's trust screen and the brief was lost.

### 20.3 Explicit compatibility limits and deferrals

- Task briefs are sent as text prompts to workers in Herdr workspaces or Paseo-managed workspaces verified against their Foreman assignment.
- Brief delivery requires no worker acknowledgement, and delivered prompts are not automatically resent.
- Herdr reports an agent showing a startup screen as idle, so spawn confirms Codex and Claude folder-trust screens with Enter before it treats the agent as ready; the workspace is a registered project that the user dispatched work into.
- A startup screen that Foreman does not recognize can still consume the brief; `foreman status` then shows the worker idle without a report.
- Resource leases have no expiry; a task that is never accepted keeps its lease until it is reassigned, and a round that changes the mode or resources claims a new lease in place.
- Stop-hook support is verified for Claude Code's `decision: block` and `stop_hook_active` contract; other coding agents may use a different hook payload or output.
- Model names and OpenCode variants are passed to the selected coding tool and are not independently enumerated by Herdr; the coding tool reports unsupported models or variants.
- A routing profile may set `effort` for Codex, Claude, or OMP through the tool's native command flag; OpenCode V2 maps `effort` to its `provider/model#variant` reference. The adapter-level `reasoningEffort` capability remains unsupported.
- No implicit profile or model fallback is performed beyond the `default` profile named in `model-routing.json`.
- The router's selection is a recommendation shown as option 1 before every other active profile; `foreman task confirm --task ID --profile NAME` records the human's choice, and dispatch and scheduling refuse a routed, unassigned task until it is confirmed. Recovery keeps the confirmed profile of the assignment it replaces.
- Herdr profiles with `isActive: false` are excluded from routing; `isActive` defaults to `true`, the `default` profile must be active, and existing task routing records keep their selected profile.
- Paseo maps every shared routing profile to a repo-owned provider profile; `isActive` only controls Foreman's selection; profile synchronization is explicit and is never triggered by initialization or task creation.
- Scout read-only behavior relies only on the read-only resource lease shown in the brief; the runtime does not sandbox project files.
- `image stage` reads Claude Code session JSONL and Codex rollout files, which are not public APIs; the parser is covered by fixtures, not by a live capture, and `--image FILE` remains the fallback when a client stores pasted images elsewhere.
- A worker whose model cannot read images still receives the image paths; Foreman does not route by vision support.
- The session doctor of `docs/product/session-doctor.md` is implemented; on 2026-10-16 a real Claude agent running `foreman-doctor` through Paseo classified 3 synthetic labeled tuning sessions and 4 held-out ones correctly, with no false positive and no missed mistake; a set the user labels from real sessions is still needed before any quality threshold is set.
- Pull-request delivery, remote homes, relay channels, automatic model optimization, Paseo-managed worker subagent import, and autonomous merge authority remain deferred according to sections 4, 14, and 17.

