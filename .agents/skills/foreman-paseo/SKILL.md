---
name: foreman-paseo
description: Use the Foreman entrypoint configured for Paseo. Select this skill when the user wants Foreman to use Paseo for worker runtime operations.
---

# Foreman through Paseo

Use this skill as the backend entrypoint for operating Foreman through Paseo.
Read and follow `.agents/skills/foreman-control/SKILL.md` for the shared workflow.

On the first operational request of a session, run `bin/foreman-paseo init` from the Foreman checkout.
For every Foreman CLI command in this workflow, use `bin/foreman-paseo`; it sets `FOREMAN_BACKEND=paseo` for that process.
Do not set a backend value in a shell startup file.

The Paseo runtime adapter and profile mapping are not implemented yet.
The entrypoint currently fails closed for task routing and runtime operations; do not retry those operations through Herdr.
Tell the user the requested Paseo operation is not available yet and preserve existing task state.
