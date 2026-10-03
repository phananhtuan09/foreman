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

Current status (2026-10-03): all S4 runtime code is implemented and uncommitted.
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

Remaining work:

1. Paseo live proofs still open from S2, S3, and S4, to run in an isolated Paseo daemon and Foreman home by extending `test/paseo-slp-live.integration.test.js`: `peer.claim-exceeded` with a correction Peer, readiness invalidation across two tasks, a blocked task beside a running one, Lead rollover and Peer recovery with several live Peers, the waiting-resource path (a conflicting task waits, then resumes), and the Foreman inbox rendering of waits.
2. Representative small and larger task measurements on Paseo; the recording is implemented, only the data is missing.
3. Herdr live proof (needs `HERDR_ENV=1`); the user deferred it.
4. Decide where the coordinator runs for Herdr, because a coordinator started outside Herdr cannot spawn panes (`HERDR_ENV` is inherited from the process that starts it).
5. Explain the unverified Lead generation 8 stop and generation 9 recovery at 11:03:08 UTC on 2026-10-02 in `foreman-runtime-smoke` before relying on Lead recovery evidence.
6. Commit when the user asks, in `foreman` and in `ai-agent-workflow` (the `foreman-lead` skill).
7. Every statement in the runbook stays `Reference` until live evidence covers it.

### Validation

- `npm test` passes with the existing Paseo SLP suite unchanged in behavior.
- Herdr and cross-project tests cover dispatch, request authentication, refusal of unsupported capabilities, stale generation refusal, and no backend fallback.
- No fleet state is mutated or worker launched for code-only verification.

## References

- [Roadmap S4](core-roadmap.md)
- [Project-scoped SLP decision](../../decisions/2026-10-02-project-scoped-supervisor-lead-peer.md)
- [State and runtime contract](../../decisions/state-runtime-contract.md)
