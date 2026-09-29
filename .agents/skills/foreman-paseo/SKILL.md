---
name: foreman-paseo
description: Use the Foreman entrypoint configured for Paseo. Select this skill when the user wants Foreman to use Paseo for worker runtime operations.
---

# Foreman through Paseo

Use this skill as the backend entrypoint for operating Foreman through Paseo.
Read and follow `.agents/skills/foreman-control/SKILL.md` for the shared workflow.

On the first operational request of a session, run `npm install` from the Foreman checkout to install the dependencies in `package.json`, including `@getpaseo/client`, then run `bin/foreman-paseo init`.
For every Foreman CLI command in this workflow, use `bin/foreman-paseo`; it sets `FOREMAN_BACKEND=paseo` for that process.
Do not set a backend value in a shell startup file.

Paseo profiles and routing live in `config/paseo-agent-profiles.json` and `config/paseo-routing.json`.
After changing profiles, run `bin/foreman-paseo profiles sync` to update the selected Paseo home; this preserves profiles created in Paseo and does not run automatically during `init` or task creation.
Use `bin/foreman-paseo task collect` at each supervision turn before `status` so finished-turn reports are read from the agent timeline.
Paseo workers report exactly one JSON object with `status: done|blocked|progress` and a non-empty `summary`; they do not run `foreman report` or use the Herdr stop hook.
Treat idle state, prompt acceptance, permissions, errors, invalid reports, and timeline gaps as insufficient evidence of completion.
For all task operations, keep using this Paseo entrypoint; never retry a Paseo task through Herdr.
