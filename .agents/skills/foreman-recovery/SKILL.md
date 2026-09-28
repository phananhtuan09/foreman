---
name: foreman-recovery
description: Use within a foreman-control or foreman-supervisor workflow when Foreman evidence confirms a worker is dead or missing and its assignment needs a bounded handoff. Do not trigger for unknown or unconfirmed liveness.
---

# Recovery procedure

Use the active backend wrapper for each Foreman CLI command.

Confirm `dead` or `missing` with two status checks from the selected runtime; never recover from `unknown`.
For Paseo, a finished or idle agent is not dead; recover only after Paseo confirms the assigned agent is missing.
Run the active backend wrapper's `task recover --task <id>`, which checks the runtime state again before acting.
Read `data/tasks/<task>/handoff.json` after recovery and tell the user what the successor received.
The successor must inspect the bound workspace, branch, lease, latest report, evidence, unresolved checks, and accepted decisions before changing files.
A recovery increments generation and binds a new runtime endpoint; Herdr uses a pane ID and Paseo uses an agent ID plus workspace ID.
Stop after the persisted recovery attempt bound and report the exhausted recovery to the user.
