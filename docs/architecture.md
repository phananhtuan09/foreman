# Foreman architecture

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
