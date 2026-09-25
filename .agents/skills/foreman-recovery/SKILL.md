---
name: foreman-recovery
description: Use within a foreman-control or foreman-supervisor workflow when Foreman evidence confirms a worker is dead or missing and its assignment needs a bounded handoff. Do not trigger for unknown or unconfirmed liveness.
---

# Recovery procedure

Confirm `dead` or `missing` with two status checks from Herdr runtime listings; never recover from `unknown`.
Run `bin/foreman task recover --task <id>`, which checks the runtime state again before acting.
Read `data/tasks/<task>/handoff.json` after recovery and tell the user what the successor received.
The successor must inspect the bound workspace, branch, lease, latest report, evidence, unresolved checks, and accepted decisions before changing files.
A recovery increments generation and binds a new worker pane; the old pane can no longer report.
Stop after the persisted recovery attempt bound and report the exhausted recovery to the user.
