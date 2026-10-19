# Production skills

`foreman-herdr` and `foreman-paseo` are the repository-local backend entrypoints for operating Foreman.
They select `FOREMAN_BACKEND` for each Foreman CLI process and share the workflow in `foreman-control`.
The Paseo entrypoint supports common setup and reads, but worker runtime operations remain unavailable until its adapter and profile mapping are implemented.
`foreman-control` contains the shared operational workflow and is not a backend selector.
`foreman-supervisor` describes the per-turn check of new worker reports and worker health.
`foreman-recovery` describes confirmed dead or missing worker handoff.
`foreman-next-action` chooses and shows the one next step after a new worker report and sends it once the user agrees.
`foreman-attention` reviews the pending points of every unfinished task on request and describes how Foreman keeps them current.
`foreman-doctor` analyzes past Foreman sessions on request for evidence-backed mistakes and improvement opportunities.
`foreman-paseo-heartbeat` describes the Paseo heartbeat Foreman manages for its own session and each heartbeat supervision turn.

`manage-project-knowledge` is a development skill for finding, explaining, and updating durable knowledge under `docs/`; it is not an operational entrypoint.
