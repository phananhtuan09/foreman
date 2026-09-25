---
name: foreman-recovery
description: Use within a foreman-control or foreman-supervisor workflow when Foreman evidence confirms a worker is dead or missing and its assignment needs a bounded handoff. Do not trigger for unknown or unconfirmed liveness.
---

# Recovery procedure

Confirm `dead` or the configured missing confirmation window from a runtime listing.
Read `data/tasks/<task>/handoff.json` before dispatching the successor.
The successor must inspect the bound workspace, branch, lease, progress, report, evidence, unresolved checks, and accepted decisions before changing files.
A recovery increments generation; old packages and ACKs are stale and are quarantined.
Stop after the persisted recovery attempt bound and leave an actionable anomaly event when the bound is exhausted.
