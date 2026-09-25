# Foreman architecture

Foreman keeps global fleet state in a private file home and treats each registered project as an exact identity: the Git common directory for Git projects and the canonical root path for projects without Git.
`src/foreman.js` owns task, assignment, decision, resource, acceptance, and scheduler transitions.
`src/coordination.js` owns the durable message outbox, generation-bound inbox reconciliation, worker event spool, worker registry, restart reconciliation, and handoff snapshots.
All private records live under `FOREMAN_HOME/data/`: each task keeps its brief, metadata, decisions, inbox, and optional handoff in `data/tasks/<taskId>/`, while `data/messages/` and `data/events/` hold fleet-wide coordination.
`src/herdr.js` is the narrow Herdr adapter.
`adapters/herdr/` is the distribution wrapper.

Every task enters a durable `routing` state after its verbatim brief is stored.
The tracked `FOREMAN_ROOT/config/model-routing.json` defines one fixed router, one default worker profile, named task groups with usage criteria and ordered profile lists, and named worker profiles.
Each configured profile belongs to exactly one group; inactive profiles are removed from routing candidates, and groups with no active profiles are omitted from the prompt.
The router may select only a configured profile; failure selects the configured default and records the error.
Task metadata records the selected profile, source, reason, any router error, and timestamp before the task becomes `queued`.
Worker profiles support `codex`, `claude`, and `omp`; Herdr starts the selected tool with the configured command arguments and model.

Canonical writes use the home lock and atomic replacement.
JSON records carry `schemaVersion: 1`; unsupported or malformed active records fail closed.
Worker files are external input: valid current-generation packages are applied idempotently, while invalid packages and acknowledgements are copied byte-for-byte to the task quarantine.

The supervision cycle applies inbox records and recovers event claims before one runtime listing.
Events stay pending unless a handler actually applies them.
Restart then performs the required dead, missing, idle, blocked, or completion follow-up.
Recovery composes inspect, stop, and spawn.
Reconciliation compares project, owner, generation, endpoint, workspace, branch, lease, message, and package evidence and persists actionable events under `data/events/<taskId>/`.
It stores its latest observation and the worker connection status in task metadata, and the worker registry is derived from those connection records on read.
The resource lease also lives in task metadata, so lease conflicts are checked against the leases of existing tasks.
The observer loop runs the event handlers after any pass that leaves pending events.
Runtime classification still decides `dead`, `missing`, and `unknown`.
Herdr creates a separate workspace for each new worker and receives a concise text prompt.
The private outbox retains message identity and payload; delivered prompts are not resent for a missing worker acknowledgement.
After submission, Foreman inspects the endpoint without interrupting the worker and records the result as runtime evidence.
Failed delivery produces an actionable event, while an uncertain task-brief submission keeps the endpoint for inspection.

Task ownership changes create a new generation.
A confirmed dead or missing worker is replaced only through a durable handoff containing the original brief, decisions, progress, report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
Acceptance is the terminal user action.
It stops and verifies the worker endpoint, releases the resource lease, and deletes task-specific Foreman records and coordination state.
The project workspace remains on disk; Foreman does not commit, merge, or remove its files.
