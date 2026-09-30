# Production skills

`foreman-herdr` and `foreman-paseo` are the repository-local backend entrypoints for operating Foreman.
They select `FOREMAN_BACKEND` for each Foreman CLI process and share the workflow in `foreman-control`.
The Paseo entrypoint supports common setup and reads, but worker runtime operations remain unavailable until its adapter and profile mapping are implemented.
`foreman-control` contains the shared operational workflow and is not a backend selector.
`foreman-supervisor` describes the per-turn check of new worker reports and worker health.
`foreman-recovery` describes confirmed dead or missing worker handoff.
`foreman-paseo-heartbeat` manages Paseo's native recurring prompts for Foreman supervision.

The files under `legacy/` are retained for historical parity work and are not production entry points.
