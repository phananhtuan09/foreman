# Foreman architecture

Foreman keeps global fleet state in a private file home and treats each registered project as an exact identity: the Git common directory for Git projects and the canonical root path for projects without Git.
`src/foreman.js` owns task, assignment, decision, resource, acceptance, and scheduler transitions.
`src/coordination.js` owns the durable message outbox, the read-only status check, and handoff snapshots.
`src/shell-env.js` writes `FOREMAN_ROOT` and `FOREMAN_HOME` into the login shell's startup file for `foreman init`.
All private records live under `FOREMAN_HOME/data/`: each task keeps its brief, metadata, decisions, reports, and optional handoff in `data/tasks/<taskId>/`, while `data/messages/` holds the fleet-wide outbox.
`src/herdr.js` is the narrow Herdr adapter.
`hooks/` holds the worker stop hook and the Foreman session prompt hook.
`adapters/herdr/` is the distribution wrapper.

Every task enters a durable `routing` state after its verbatim brief is stored.
The tracked `FOREMAN_ROOT/config/model-routing.json` defines one fixed router, one default worker profile, named task groups with usage criteria and ordered profile lists, and named worker profiles.
Each configured profile belongs to exactly one group; inactive profiles are removed from routing candidates, and groups with no active profiles are omitted from the prompt.
The router may select only a configured profile; failure selects the configured default and records the error.
Task metadata records the selected profile, source, reason, any router error, and timestamp before the task becomes `queued`.
Worker profiles support `codex`, `claude`, and `omp`; Herdr starts the selected tool with the configured command arguments and model.

Canonical writes use the home lock and atomic replacement.
JSON records carry `schemaVersion: 1`; unsupported or malformed active records fail closed.
Worker reports are external input: `foreman report` accepts one only from the Herdr pane bound to a working or blocked assignment and stores it verbatim as a new file.

Supervision is pull-based and runs only in Foreman turns.
A worker's stop hook asks it to run `foreman report` when it ends a turn without having reported since Foreman last prompted it.
The report records `lastReport` in task metadata and moves a `done` task to `review-ready` or a `blocked` task to `blocked`.
The Foreman session's prompt hook prints unread reports and the anomalies of one status check, then marks those reports read.
The status check lists Herdr once, classifies each assignment as `working`, `idle`, `waiting-input`, `dead`, `missing`, `mismatch`, or `unknown`, and flags an idle worker that has not reported; it never writes state or interrupts a worker.
Recovery is started explicitly by Foreman after the status check confirms `dead` or `missing`, and composes inspect, stop, and spawn.
Herdr creates a separate workspace for each new worker and receives a concise text prompt.
The private outbox retains message identity and payload; delivered prompts are not resent.
After submission, Foreman inspects the endpoint without interrupting the worker and records the result as runtime evidence.
An uncertain task-brief submission keeps the endpoint for inspection.

Task ownership changes create a new generation.
A confirmed dead or missing worker is replaced only through a durable handoff containing the original brief, decisions, latest report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
Acceptance is the terminal user action.
It stops and verifies the worker endpoint, releases the resource lease, and deletes task-specific Foreman records and coordination state.
The project workspace remains on disk; Foreman does not commit, merge, or remove its files.
