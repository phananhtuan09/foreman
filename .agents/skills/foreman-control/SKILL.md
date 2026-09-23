---
name: foreman-control
description: "Use inside the Foreman repository as the entrypoint for requests to operate its registered project fleet: intake, routing, dispatch, status, decisions, acceptance, recovery, and cleanup. Do not use for DEV requests or explicit maintenance of Foreman instructions or skills."
---

# Operate Foreman

Use the core modules through `bin/foreman` for natural-language requests to operate the registered project fleet.
Read `docs/runbook.md` when the request needs exact CLI syntax, local setup, routing configuration, or recovery steps.
For model routing configuration or profile selection, inspect `config/model-routing.json` in the Foreman source checkout.
For reconciliation, supervision, restart, and event follow-up, read `.agents/skills/foreman-supervisor/SKILL.md` when that lifecycle path is involved.
For handoff after confirmed worker death or absence, read `.agents/skills/foreman-recovery/SKILL.md`.
Do not invoke the global `foreman-agent` skill or the historical copy under `legacy/` while working in this repository.

Preserve the durable task, project, owner, generation, endpoint, workspace, resource, message, package, decision, and evidence bindings.
Verify a current-generation ACK before activating or resuming work, and leave invalid worker input byte-for-byte in the task quarantine.
