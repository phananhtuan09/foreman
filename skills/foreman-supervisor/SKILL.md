---
name: foreman-supervisor
description: Run one bounded Foreman supervision/restart pass over the local fleet.
---

# Foreman supervisor procedure

1. Resolve `FOREMAN_ROOT` and `FOREMAN_HOME`, then use `bin/foreman reconcile` for a
   deterministic restart pass.
2. Read the returned fleet and project status from the same reconciliation snapshot.
3. Treat `pending-ack`, `unknown`, mismatch, quarantine, and delivery-failed events as
   actionable evidence; do not promote them by inference.
4. For a confirmed dead or missing assignment, inspect the durable handoff and invoke
   the recovery path only within its bounded attempt budget.
5. Ask for human authority only for a persisted Decision Package.  Apply a decision only
   after the current assignment has acknowledged its decision message.
6. Keep cleanup and landing evidence explicit and project-bound.

The procedure is deliberately deterministic after the single runtime listing.
It does not poll with a model and it does not use the legacy skill as a production entry point.
