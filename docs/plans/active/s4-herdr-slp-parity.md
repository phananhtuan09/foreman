# S4: Herdr SLP parity, fleet rollout runtime, and measurement

Status: Active
Scope: Roadmap S4 — Herdr parity (item 1) and the runtime for items 2–5: rollback and interrupted-closure proof, multi-project boundaries, compact views and measurements, and rollout procedures
Source: User start of S4 item 1 on 2026-10-02, then the user's `/goal` to implement and test the runtime for the full S4 flow on the proposed design; read-only seam survey of `src/slp.js`, `src/coordination.js`, `src/foreman.js`, `src/herdr.js`, `bin/`, and tests on 2026-10-02

## Goal

Make SLP dispatch work on Herdr with the same request, report, notification, resource, and acceptance contracts as Paseo.
Refuse a Herdr profile or runtime capability that SLP cannot support, without falling back to another backend.
Keep Paseo behavior unchanged.

## State

Code and focused tests for Herdr SLP parity were implemented on 2026-10-02 and are uncommitted; nothing has run live on Herdr.
The user approved these choices: a `foreman lead request` command for Herdr Leads, uncertain-and-never-resent for unprovable Herdr prompt delivery, and accepting Herdr profiles whose model and mode cannot be read back after spawn.
The accepted SLP decision records them in its "Amendment: Herdr transport" section.

Implemented:

- A backend capability gate replaces the Paseo-only gate; an adapter without list, send, and stop support, or any other backend, is refused without fallback.
- Identity checks use the Herdr name, pane, workspace, and cwd; Herdr Lead and recovered Peer names are valid 32-character names, hashing long project IDs.
- `foreman lead request` records a request from the bound Lead pane; the coordinator processes it and sends the outcome.
- `foreman report` validates the normalized report object for SLP Peers on Herdr and requires its status to equal `--status`.
- Herdr Peers stop only when idle, Herdr `blocked` is reported as a wait, and the idle-without-request anomaly replaces the timeline-based one.
- One coordinator selects the adapter per project backend; `project lead bind` and the CLI help no longer restrict SLP to Paseo.
- The Lead skill was updated in this repository and in `ai-agent-workflow` (both uncommitted).
- Defect found by the new tests and fixed: Herdr Peers were named from the project ID and task ID, which exceeds the Herdr name limit for long project IDs.

Herdr verification (2026-10-02, fake Herdr adapter only): `test/slp-herdr.test.js` covers dispatch, request authentication, replaced-Lead refusal, report validation, idle-gated stop, uncertain delivery, blocked status, no-request anomaly, missing adapter, Lead and Peer recovery, and message-peer on a Herdr-shaped fake.
The CLI success path of `lead request` is not tested because it starts the coordinator process.

Items 2–5 runtime (2026-10-02, uncommitted):

- Resource boundaries: `file/` keys conflict only within one project, `workspace/<project>` covers that project's `file/` paths, and `db/`, `service/`, `mcp/`, and `test/` keys conflict fleet-wide.
  Defects fixed: an unknown-surface `workspace/<project>` claim previously ran beside a known writer in the same project, and the same project-relative path in two projects falsely serialized.
  A mutation check restored the old rule and both new tests failed.
- A `missing` runtime no longer fails identity verification in Lead observation, Peer health, Peer stop, and acceptance, so a vanished Herdr pane is classified as missing instead of an identity mismatch.
- Requests record their waiting time; `taskMetrics` and `fleetMetrics` derive Lead requests, Peer count by role, correction cycles, waiting time, human decisions, follow-ups, acceptance, and runtime failures; acceptance freezes them into the closure record.
- `slp fleet`, `slp metrics`, and `slp evidence --task` provide the compact view, measurements, and attributable evidence on demand.
- The rollout, measurement, and rollback procedure is in `docs/runbooks/slp-rollout-and-rollback.md` as a `Reference` with its verification status disclosed.
- No step was removed from the small-task flow: the current gates are pinned by a test (4 Lead requests, 2 Peers, one human step) because no live measurements exist to justify removing one.

Verification: `npm test` ran 142 tests with 138 passing, 0 failing, and 4 environment-gated skips (the live tests).
`test/slp-s4.test.js` covers, on both backends where marked, pause and resume with supervision, recovery, and closure of active work; an interrupted acceptance; unprovable prompt delivery; two projects on different backends with shared and project-local resources; cross-project refusal; fleet endpoint capacity; the measurements; the compact views; and the CLI commands.
Interrupted schema migration is covered by the existing byte-preserving-backup test, which is backend-independent.
All of this used fake Herdr and Paseo adapters.

Live Paseo evidence (2026-10-02, opt-in `RUN_PASEO_SLP_LIVE=1 node --test test/paseo-slp-live.integration.test.js`, isolated Paseo daemon and Foreman home, profile `opencode-luna`, capacity 2/2/6; the user's fleet was not touched and nothing in it was accepted):

- Two projects (`live-alpha`, `live-beta`) with real Leads and real Peers claimed the same project-relative path `file/docs/live.txt` at the same time; the implementation Peers' windows overlapped and no request waited.
- Both tasks reached `review-ready` through implementation, independent review, a recorded milestone, and a ready report in about 290 seconds each (2 Peers; 4 and 5 Lead requests; no runtime failures; no human step before acceptance).
- Pause on a live Lead refused a new dispatch and left the queued task queued; both tasks were then accepted by the test home, their measurements were frozen with one human step each, and both Leads survived acceptance.
- The first two runs found two defects, both fixed and covered by focused tests: the Lead skill did not name the `record-review` payload fields (two real Leads were refused 4 times each while guessing), and a Peer report with a string `schemaVersion` passed collection but stranded a stopped Peer at delivery with a misleading "report file is missing".
- Not exercised live: Herdr, a Lead rollover or Peer recovery on Paseo in this run, `peer.claim-exceeded`, and the waiting-resource path (covered by focused tests only).

Historical checkpoint before Paseo completion (2026-10-03): all S4 runtime code was implemented and uncommitted.
`npm test` runs 142 tests with 138 passing, 0 failing, and 4 skips (the opt-in live tests, which are gated by `RUN_PASEO_LIVE=1`, `RUN_PASEO_SLP_LIVE=1`, and `RUN_HERDR_LIVE=1`).
The user decided on 2026-10-02 that Herdr runtime checks are not needed for now and that nothing in the operational fleet (T-000035, T-000036) is to be accepted by Foreman; T-000035 and T-000036 remain `review-ready` in `foreman-runtime-smoke` and still hold its two task slots.
No change is committed in `foreman` or `ai-agent-workflow`.

Live Paseo attempt for the remaining proofs (2026-10-03):

`test/paseo-slp-live.integration.test.js` now has a shared isolated-environment helper and four new opt-in scenarios behind `RUN_PASEO_SLP_LIVE=1`.
They cover a claim-exceeded Peer with a correction Peer (also the larger-task measurement), a resource wait that resumes without a Lead resend with its inbox rendering and cross-task readiness invalidation, a blocked task beside a running one, and a Lead rollover plus Peer recovery with two live Peers.
Select one with `--test-name-pattern`; every scenario prints its `taskMetrics` to stderr.
The scenarios were written and syntax-checked but have not passed live: the claim and blocked scenarios ran in isolated daemons and both Leads failed on their first turn with "Your authentication token has been invalidated. Please try signing in again."
`opencode run -m openai/gpt-6-luna` fails the same way outside Foreman, so the cause is the stored OpenAI login used by `opencode-luna`, not Foreman.
No Lead request was recorded in either run, so no Foreman behavior was exercised and no defect was found.
The two runs were started in parallel and may have raced on the shared token refresh; the cause is unconfirmed.
The isolated daemons, homes, and fixtures were removed; nothing in the real fleet was touched.
A first-turn credential failure currently surfaces only as `lead.attention-required: error` with an empty request list and no clearer reason; that diagnostic gap is unchanged.

### Paseo completion work on 2026-10-03

The earlier "uncommitted" statements describe their original checks; the runtime snapshot was subsequently committed in Foreman as `50e3fc9` on 2026-10-03.
The user authorized completing every remaining Paseo implementation and test item autonomously, while leaving Herdr pending.
The local routing default now names active `codex-luna`, preserving the existing profile activation choices.
Fake SLP fixtures activate their own copied profiles so local profile choices no longer change their behavior.
Current `npm test` verification passes 156 tests: 146 passing, 0 failing, and 10 opt-in live skips.

New fixes and focused proof:

- Coordinator ownership is checked on macOS as well as Linux; a real process test verifies reuse, stale-code replacement, and refusal to kill an unrelated PID.
  The code fingerprint includes coordination and core lifecycle code as well as the coordinator entrypoint.
- Coordinator observations retry at most three times with capped backoff; mutations retain durable reconciliation rather than blind retries.
- The retained project Lead keeps coordinator supervision active after task closure.
- A Paseo `waiting` acknowledgement is consumed once without a corrective model turn.
- Projected timeline separators are normalized through the existing Paseo response parser for Lead requests and Peer reports, while original report text stays preserved.
  The isolated Codex run reproduced both the needless protocol corrections and stranded valid review reports before this fix.
- Uncertain Lead and human-decision sends remain pending for timeline reconciliation.
- Peer steering has a request-bound message ID and is deduplicated even when its request outcome is lost.
  An unavailable reconciliation read retains the pending request and lease, and a later verified timeline reconciles delivery without resending.
- A correction that exceeds its own claims, retains open items, or reports a failed check cannot resolve an earlier blocker.
  Pre-review correction attempts are bounded too, and measurements include those corrections.
- Runtime attention anomalies retain the provider's error detail; stale `finished` attention during a new turn does not create a spurious attention notification.
- The core-runtime cleanup race was reproduced and fixed by waiting for the fixture's child workers before removing their workspace.
- A live concurrency gate exposed that a new Lead prompt could advance the timeline cursor past an idle but uncollected request.
  Delivery now waits for core to collect the response, and multiple completed responses retain their per-entry order and cursor positions.
  The focused regression reproduces the race, and the focused test and isolated live rerun verify the fix.
- Interrupted acceptance now exposes `closing` consistently in fleet metrics, fleet status, project status, and the generated project view, with `resume-acceptance` as its next action.
  The frozen measurement survives partial Peer cleanup and completed acceptance.
  The live two-project and coordinator-restart runs reproduced the fleet-metrics defect before the fix; the project-view defect was then reproduced by focused tests on both adapter shapes and fixed.
  The two-project and coordinator-restart live reruns both passed.

Live verification used explicitly selected `codex-luna`, isolated Paseo daemons and Foreman homes, and the actual Foreman adapters.
The test fixtures install the compatible Lead skill in both Claude/OpenCode and Codex discovery paths.
The suite now includes interrupted closure and resumed intake, coordinator outage replay and uncertain delivery, health observations with disclosed fault injection, and three actual Peer recovery attempts followed by refusal at exhaustion.
The health test injects permission, missing/unknown observations, read failures, and a stale-clock snapshot against a real bound runtime; it does not claim those are naturally occurring provider outages or a real 16-minute stall.
The prior failed attempts remain distinct from successful proof.

The two-project live rerun passed on 2026-10-03 using `codex-luna`.
Both tasks reached `review-ready` in approximately 252 and 237 seconds, with two Peers and four Lead requests each, no resource wait, no correction, and no runtime failure.
Interrupted acceptance resumed without touching the other project, frozen metrics retained both Peers, and each accepted task recorded exactly one human intervention.
Both project Leads survived acceptance; queued validation stayed queued while paused and started automatically after resume.
The isolated suite recorded two accepted tasks and four Peers; the operational fleet was not involved.

The coordinator-restart live rerun also passed on 2026-10-03.
The coordinator PID was reused on a second start, stopped during an active Peer turn, then restarted with a new PID after the Peer finished.
The report collected during downtime was delivered once, the deliberately lost send acknowledgement reconciled to one timeline message without a resend, and interrupted acceptance resumed idempotently.
The project's other validation task and Lead remained bound throughout.

The conflict and readiness-invalidation live gate passed on 2026-10-03.
Task 2 waited on task 1's actual `file/docs/shared.txt` lease for 138,777 ms and resumed with one Peer after the lease was released, without a Lead resend; the Foreman inbox rendered the resource owner and automatic-resume reason.
A later task 2 edit invalidated task 1's earlier review, preserved it as evidence, and task 1 returned to `review-ready` after a second review.
Task 1 used three Peers and seven Lead requests; task 2 used two Peers and four Lead requests, one resource wait, and one human follow-up.

The first live run of that gate exposed a dropped uncollected Lead response when another prompt advanced the Paseo cursor.
Core now holds new prompt delivery until it collects earlier responses, and advances through multiple timeline responses by their individual sequence positions.
The focused regression and the rerun of the live gate both pass with this fix.

The Lead rollover and Peer recovery live gate passed on 2026-10-03.
The replacement Lead recorded its reconstruction while two implementation Peers were still running; recovery replaced only one Peer, preserving its workspace, resources, and profile while the other Peer's endpoint and lease stayed intact.
The replacement Lead completed a separate review and returned the task to `review-ready` with three Peers, seven Lead requests, and no runtime failures.

The live runtime health and recovery gate passed on 2026-10-03.
Fault-injected permission, missing, unknown, transient-read, exhausted-read, idle/no-report, and stale-turn observations left the real bound Peer identity and lease intact unless an explicit recovery was requested.
The isolated run verified three actual Peer recoveries, then refused another at the configured limit; the test separately measured three attempts each for health inspection and report reading.
This is fault-injection evidence for classification and retry limits, not a claim that these provider failures occurred naturally.

The blocked-task concurrency gate passed on 2026-10-03.
Task A remained `waiting-decision` with no Peer while task B ran implementation and review to `review-ready`; the Foreman inbox rendered the decision.
Task B used two Peers and four Lead requests with no runtime failures.

The historical generation-8 stop and generation-9 recovery cannot be explained from this checkout's operational home, which has no SLP records for that project.
It remains an unverified historical anomaly; new isolated recovery evidence must be used independently rather than treating that event as proof.
No operational fleet task has been accepted or modified by this completion work.

Remaining work:

1. Herdr live proof remains deferred by the user; it is outside the authorized Paseo completion scope.
2. Herdr coordinator placement still needs a decision because its runtime requires `HERDR_ENV=1` in the coordinator's environment.
3. The historical generation-8 stop and generation-9 recovery at 11:03:08 UTC on 2026-10-02 remains unexplained because this checkout's operational home has no SLP record for that project.
   No current Paseo proof relies on that historical event.
4. The rollout procedure stays `Reference` until its Herdr steps have live evidence; Paseo proof alone does not verify every backend instruction.
5. The user authorized committing and pushing all current Foreman changes on 2026-10-03.
   Changes in the separate `ai-agent-workflow` repository remain outside this Foreman delivery.

### Validation

- `npm test` passes 156 tests: 146 passed, 0 failed, and 10 opt-in live skips.
  The read-only completion check reran this suite successfully on the current checkout on 2026-10-03; it did not rerun the live scenarios.
- All seven scenarios in `test/paseo-slp-live.integration.test.js` passed live with isolated Paseo daemons and homes on 2026-10-03.
- The legacy Paseo supervisor-worker live integration test passed separately on 2026-10-03.
- Herdr and cross-project tests cover dispatch, request authentication, refusal of unsupported capabilities, stale generation refusal, and no backend fallback.
- No fleet state is mutated or worker launched for code-only verification.

## References

- [Roadmap S4](core-roadmap.md)
- [Project-scoped SLP decision](../../decisions/2026-10-02-project-scoped-supervisor-lead-peer.md)
- [State and runtime contract](../../decisions/state-runtime-contract.md)
