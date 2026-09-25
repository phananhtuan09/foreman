# Production skills

`foreman-control` is the repository-local entrypoint for natural-language requests to operate Foreman.
`foreman-supervisor` describes the per-turn check of new worker reports and worker health.
`foreman-recovery` describes confirmed dead or missing worker handoff.

The files under `legacy/` are retained for historical parity work and are not production entry points.
