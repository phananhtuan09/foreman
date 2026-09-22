---
name: foreman-agent
description: Production Foreman supervisor routing for assignment, reconciliation, recovery, and acceptance.
---

# Production Foreman agent

Use the core modules through `bin/foreman` and the procedures in `skills/foreman-supervisor` and `skills/foreman-recovery`.
This directory is the production replacement for the historical `legacy/foreman-agent` skill; do not load the legacy copy for new work.

Preserve the durable task, project, owner, generation, endpoint, workspace, resource, message, package, decision, and evidence bindings.
Verify a current-generation ACK before activating or resuming work, and leave invalid worker input byte-for-byte in the task quarantine.
