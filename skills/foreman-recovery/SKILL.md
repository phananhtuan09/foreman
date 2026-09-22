---
name: foreman-recovery
description: Recover a confirmed dead or missing worker with a durable generation-bound handoff.
---

# Recovery procedure

Confirm `dead` or the configured missing confirmation window from a runtime listing.
Read `state/tasks/<task>/handoff.json` before dispatching the successor.
The successor must inspect the bound workspace, branch, lease, progress, report, evidence, unresolved checks, and accepted decisions before changing files.
A recovery increments generation; old packages and ACKs are stale and are quarantined.
Stop after the persisted recovery attempt bound and leave an actionable anomaly event when the bound is exhausted.
