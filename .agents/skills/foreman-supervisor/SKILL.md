---
name: foreman-supervisor
description: Use within a foreman-control workflow before answering the user, and when it needs fleet or project status, new worker reports, worker anomalies, or follow-up. Foreman-control remains the entrypoint for user requests.
---

# Foreman supervisor procedure

Use the active backend wrapper (`bin/foreman-herdr` or `bin/foreman-paseo`) for every Foreman CLI command below.

1. Read the `[Foreman supervision context ...]` block that the session prompt hook adds to the user's message.
   When the block is absent because the hook is not installed or failed, run the active backend wrapper's status command instead.
   In Paseo mode the hook already runs `task collect` and one status check on every prompt, so a working hook needs no extra commands; run `task collect` and then `status --json --brief` with `bin/foreman-paseo` only when the block is absent because the hook is missing or failed.
   No block with a working hook means nothing new; when the user asks for status anyway, run the active wrapper's `status` once.
2. Read each new worker report from the text the context prints under its entry; open the file only when the text says it was truncated.
   A `done` report makes the task review-ready: summarize the outcome, evidence, and gaps for the user without accepting it.
   A `blocked` report needs the user: show what the worker needs and its "Next steps", then answer with a new round through `bin/foreman task continue` once the user replies and agrees.
   Create a Decision Package only when you yourself see a choice that needs the user's authority.
   A `progress` report means the worker stopped before finishing: decide whether to send a follow-up.
3. Act on each anomaly:
   - `worker.idle-without-report`: in Herdr mode, ask the worker with `bin/foreman-herdr task message` to continue or report with the Herdr report command; in Paseo mode, ask it to return the required JSON report in its next turn.
   - `worker.waiting-input`: tell the user which worker waits for input.
   - `worker.dead` or `worker.missing`: run the active wrapper's `status --json` once more; only when it still confirms `dead` or `missing`, read `.agents/skills/foreman-recovery/SKILL.md`.
   - `unknown`, mismatch, workspace, branch, lease, or pane issues: report them as evidence; do not infer liveness or recover.
4. Ask for human authority only through a persisted Decision Package, and deliver the answer with `bin/foreman decision deliver`, which resumes the task.
5. Keep acceptance and cleanup explicit and project-bound; only the user accepts a task.

There is no observer, heartbeat, or event queue: supervision happens only in Foreman turns, from the prompt-hook context or one status check.
