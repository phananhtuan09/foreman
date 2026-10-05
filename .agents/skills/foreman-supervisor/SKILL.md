---
name: foreman-supervisor
description: Use within a foreman-control workflow before answering the user, and when it needs fleet or project status, new worker reports, worker anomalies, or follow-up. Foreman-control remains the entrypoint for user requests.
---

# Foreman supervisor procedure

Use the active backend wrapper (`bin/foreman-herdr` or `bin/foreman-paseo`) for every Foreman CLI command below.

1. Read the `[Foreman supervision context ...]` block that the session prompt hook adds to the user's message.
   When the block is absent because the hook is not installed or failed, run the active backend wrapper's status command instead.
   On Paseo, run `task collect` and then `status --json` to reconcile completed turns.
   No actionable inbox item with a working hook means routine worker reports have already been handled or there is nothing new.
2. For existing single-worker tasks, read a new report from its file and route a technical blocker with the active backend wrapper's task message command, or prepare a Decision Package when only the user has authority.
   For SLP tasks, read the compact core-generated inbox and surface human decisions, task readiness, and material anomalies; the core already routes routine Peer reports to the current project Lead.
3. Act on each anomaly:
   - `worker.idle-without-report`: for a single-worker task, ask the worker to continue or report; for SLP, let the coordinator route this anomaly to the current Lead and surface it to the user only when it needs human action.
   - `worker.waiting-input`: tell the user which worker waits for input.
   - `worker.dead` or `worker.missing`: run the active wrapper's `status --json` once more; only when it still confirms `dead` or `missing`, read `.agents/skills/foreman-recovery/SKILL.md`.
   - `unknown`, mismatch, workspace, branch, lease, or pane issues: report them as evidence; do not infer liveness or recover.
4. Ask for human authority only through a persisted Decision Package, and deliver the answer with `bin/foreman decision deliver`, which resumes the task.
5. Keep acceptance and cleanup explicit and project-bound; only the user accepts a task.

A single-worker task is reconciled during Foreman turns; the deterministic core coordinator reconciles active SLP assignments outside those turns without model calls while idle, and worker reports still never prompt the Foreman session.

Inspect Peer reports under their child assignments and the Lead's integrated report under each task coordinated by the project Lead.
A Peer `done` report is not parent completion; review-ready status requires the Lead's evidence-backed review, and acceptance still requires the user.
If the Lead is confirmed dead or missing after two status checks, keep living Peer assignments intact and use the bounded handoff procedure to replace only that project's Lead generation.
Do not recover on `unknown` evidence or let an old Lead generation steer current child assignments.
