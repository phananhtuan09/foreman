---
name: foreman-supervisor
description: Use within a foreman-control workflow before answering the user, and when it needs fleet or project status, new worker reports, worker anomalies, or follow-up. Foreman-control remains the entrypoint for user requests.
---

# Foreman supervisor procedure

1. Read the `[Foreman supervision context ...]` block that the session prompt hook adds to the user's message.
   When the block is absent because the hook is not installed or failed, run `bin/foreman status --json` instead; that check lists Herdr once and never interrupts a worker.
   No block with a working hook means nothing new.
2. Read every new worker report from the file path the context gives.
   A `done` report makes the task review-ready: summarize the outcome, evidence, and gaps for the user without accepting it.
   A `blocked` report needs Foreman: return a technical blocker with `bin/foreman task message`, or create a Decision Package when only the user has the authority.
   A `progress` report means the worker stopped before finishing: decide whether to send a follow-up.
3. Act on each anomaly:
   - `worker.idle-without-report`: ask the worker with `bin/foreman task message` to continue or to report with `"$FOREMAN_ROOT/bin/foreman" report --status done|blocked|progress`.
   - `worker.waiting-input`: tell the user which worker waits for input.
   - `worker.dead` or `worker.missing`: run `bin/foreman status --json` once more; only when it still shows `dead` or `missing`, read `.agents/skills/foreman-recovery/SKILL.md`.
   - `unknown`, mismatch, workspace, branch, lease, or pane issues: report them as evidence; do not infer liveness or recover.
4. Ask for human authority only through a persisted Decision Package, and deliver the answer with `bin/foreman decision deliver`, which resumes the task.
5. Keep acceptance and cleanup explicit and project-bound; only the user accepts a task.

There is no observer, heartbeat, or event queue: supervision happens only in Foreman turns, from the prompt-hook context or one status check.
