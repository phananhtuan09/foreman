---
name: foreman-herdr
description: Use the Foreman fleet through its Herdr runtime. Select this skill for Herdr-backed task intake, dispatch, supervision, decisions, recovery, and acceptance.
---

# Foreman through Herdr

Use this skill as the backend entrypoint for operating Foreman through Herdr.
Read and follow `.agents/skills/foreman-control/SKILL.md` for the shared workflow.

On the first operational request of a session, run `bin/foreman-herdr init` from the Foreman checkout.
For every Foreman CLI command in this workflow, use `bin/foreman-herdr`; it sets `FOREMAN_BACKEND=herdr` for that process.
Do not set a backend value in a shell startup file.

The Herdr adapter is the currently implemented worker runtime.
Follow the shared Foreman intake, routing, dispatch, supervision, recovery, and acceptance rules.
