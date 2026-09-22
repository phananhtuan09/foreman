# Foreman architecture

Foreman keeps global fleet state in a private file home and treats each registered Git project as an exact identity.
`src/foreman.js` owns task, assignment, decision, resource, cleanup, and scheduler transitions.
`src/coordination.js` owns the durable message outbox, generation-bound inbox reconciliation, observer event spool, restart reconciliation, and handoff snapshots.
`src/herdr.js` is the narrow Herdr adapter.
`adapters/herdr/` is the distribution wrapper.

Canonical writes use the home lock and atomic replacement.
JSON records carry `schemaVersion: 1`; unsupported or malformed active records fail closed.
Worker files are external input: valid current-generation packages are applied idempotently, while invalid packages and acknowledgements are copied byte-for-byte to the task quarantine.

The supervision cycle applies inbox records and recovers event claims before one runtime listing.
It then compares project, owner, generation, endpoint, workspace, branch, lease, message, and package evidence and persists actionable observer events.
Runtime delivery and worker acknowledgement are separate states.
Retries use the same message ID with bounded backoff, age, and attempts; a terminal failure produces one deduplicated actionable event.

Task ownership changes create a new generation.
A confirmed dead or missing worker is replaced only through a durable handoff containing the original brief, decisions, progress, report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
Landing, acceptance, and cleanup remain explicit user-authorized steps.
