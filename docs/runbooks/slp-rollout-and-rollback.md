# SLP rollout, measurement, and rollback

Status: Reference
Applies to: Foreman homes running project-scoped Supervisor–Lead–Peer work on Herdr, Paseo, or both
Verification status: Exercised by focused tests with fake Herdr and Paseo adapters and by one live Paseo run of two projects in an isolated daemon and Foreman home on 2026-10-02 (`test/paseo-slp-live.integration.test.js`); no step was executed against the operational fleet, Herdr live, or more than two projects

## Outcome

Enable SLP for one more project at a time, observe it with compact views and recorded measurements, and disable new SLP intake without losing supervision, recovery, or closure of active work.

## Preconditions

- The project is registered and the compatible `foreman-lead` skill is installed where the project's Lead tool discovers it.
- `config/slp-capacity.json` exists with the intended task, Peer, and endpoint limits; without it the project runs one task and one Peer at a time.
- The human confirms the Lead profile with `project lead bind` and each task's Peer profile with `task confirm`; no step here selects a profile.
- For Herdr, run from a session where `HERDR_ENV=1`, because a coordinator inherits that variable from the process that starts it.

## Safety

`project lead pause` and `project lead resume` change only whether new SLP tasks may start for that project.
Acceptance, discard, and recovery mutate canonical state; do not run them to test this procedure.
Never infer a dead Lead or Peer from unknown evidence; recovery requires two matching `missing` or `stopped` checks.

## Procedure

### Roll out one project

1. Bind the Lead profile: `bin/foreman-<backend> project lead bind --project ID --profile NAME`.
2. Create and confirm one small task: `task create --model slp`, then `task confirm --task ID --profile NAME`, then `task dispatch --task ID`.
3. Watch it with `bin/foreman slp fleet` (one line per project) and `bin/foreman project lead status --project ID`.
4. Read attributable detail only when needed with `bin/foreman slp evidence --task ID`.
5. Accept the task yourself with `task accept`; the single acceptance is the only human step a small task needs.
6. Compare `bin/foreman slp metrics` for the new project against earlier tasks before raising capacity or adding another project.

### Interpret the measurements

`slp metrics` lists, for each task: Lead requests, Peer count by role, correction cycles, time spent waiting on resources or capacity, human decisions, follow-ups and acceptance, and runtime failures by anomaly type.
Open waits count up to the current time and stop accumulating when the request is dispatched or refused.
The measurement of an accepted task is frozen in its closure record, so it survives the purge of the task's other records.
A runtime failure is attributed to the task whose assignment or message it affected; Lead failures that name no task are visible in `slp fleet` and `project lead status`.
Do not remove a step from the small-task flow on the strength of these numbers alone; the review and acceptance gates are not removed.

### Disable new SLP work (rollback)

1. Run `bin/foreman project lead pause --project ID` for every project that should stop starting SLP tasks.
2. Confirm with `bin/foreman slp fleet` that each project shows `intake paused`.
3. Let active tasks finish: reports, Peer stops, recovery, and human acceptance continue to work while intake is paused.
4. Queued tasks stay queued; new dispatch is refused with a message naming the pause.
5. To resume, run `bin/foreman project lead resume --project ID`; queued tasks start on the next coordinator tick.

## Verification

Run `npm test` and confirm `test/slp-s4.test.js` and `test/slp-herdr.test.js` pass.
They cover pause and resume on both backends, an interrupted acceptance, unprovable prompt delivery, two projects on different backends with shared and project-local resources, cross-project refusal, fleet endpoint capacity, measurements, and the compact views.
The live Paseo test covers two projects, concurrent claims of the same project-relative path, measurement, pause with a refused dispatch, and acceptance in an isolated home; set `RUN_PASEO_SLP_LIVE=1` to run it, which spends real model turns.
Live Herdr behavior and rollback of a running operational fleet have not been verified.

## Recovery

If acceptance is interrupted, run `task accept` again; it resumes from the closure record.
If a Lead or Peer is missing, use `project lead recover` or `task recover` only after two matching checks.
If an adapter is unavailable, the coordinator leaves that project unchanged and records `coordinator.adapter-unavailable`; restore the runtime and the next tick resumes.

## References

- [Project-scoped SLP decision](../decisions/2026-10-02-project-scoped-supervisor-lead-peer.md)
- [Roadmap S4](../plans/active/core-roadmap.md)
- [Local operations](local-operations.md)
