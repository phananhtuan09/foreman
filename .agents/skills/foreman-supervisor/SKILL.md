---
name: foreman-supervisor
description: Use within a foreman-control workflow before answering the user, and when it needs fleet or project status, new worker reports, worker anomalies, heartbeat turns, or follow-up. Foreman-control remains the entrypoint for user requests.
---

# Foreman supervisor procedure

Use the active backend wrapper (`bin/foreman-herdr` or `bin/foreman-paseo`) for every Foreman CLI command below.

1. Read the `[Foreman supervision context ...]` block that the session prompt hook adds to the user's message.
   When the block is absent because the hook is not installed or failed, run the active backend wrapper's status command instead.
   In Paseo mode the hook already runs `task collect` and one status check on every prompt, so a working hook needs no extra commands; run `bin/foreman-paseo supervise` (collection, then one status check) only when the block is absent because the hook is missing or failed.
   No block with a working hook means nothing new; when the user asks for status anyway, run the active wrapper's `status` once.
2. Read each new worker report from the text the context prints under its entry; open the file only when the text says it was truncated.
   A `done` report makes the task review-ready: summarize the outcome, evidence, and gaps for the user without accepting it, and give the review size the context prints with it.
   A `blocked` report needs the user: show what the worker needs and its "Next steps", then answer with a new round through `bin/foreman task continue` once the user replies and agrees.
   Create a Decision Package only when you yourself see a choice that needs the user's authority.
   A `progress` report means the worker stopped before finishing: decide whether to send a follow-up.
   Present each new report as "Presenting a report" below describes.
3. Act on each anomaly:
   - `worker.idle-without-report`: in Herdr mode, ask the worker with `bin/foreman-herdr task message` to continue or report with the Herdr report command; in Paseo mode, ask it to return the required JSON report in its next turn.
   - `worker.waiting-input`: tell the user which worker waits for input.
   - `worker.dead` or `worker.missing`: run the active wrapper's `status --json` once more; only when it still confirms `dead` or `missing`, read `.agents/skills/foreman-recovery/SKILL.md`.
   - `unknown`, mismatch, workspace, branch, lease, or pane issues: report them as evidence; do not infer liveness or recover.
4. The `Not yet told to the user` list names each review-ready result, blocker, waiting decision, anomaly, or failed check the user has not been told, by a key bound to its task, event, assignment, and round.
   Tell each once in your answer, then record it with the active wrapper's `notice ack --key KEY` (several `--key` at once); a told notice is not repeated, and one you did not tell stays listed.
   Reading a report is not telling the user, and a Decision Package you create is recorded as told because you ask it in the same answer.
   `next propose` records the review-ready or blocked notice of the task it proposes for, so do not ack that key again.
5. Ask for human authority only through a persisted Decision Package, and deliver the answer with `bin/foreman decision deliver`, which resumes the task.
6. Keep acceptance and cleanup explicit and project-bound; only the user accepts a task.

There is no observer or event queue: supervision happens only in Foreman turns, from the prompt-hook context or one status check.

## Presenting a report

Everything needed to present a new report is here; read `.agents/skills/foreman-next-action/SKILL.md` only for a case these steps do not settle.

1. Run `task history --task ID` once: the user's words, every delivered round, recent reports, decisions, pending points, and any earlier next action.
   From them, state for yourself the current goal and the limits still in force.
2. Keep the task's pending points current, before choosing the next action, because changing them makes an earlier proposal stale.
   A point is one obligation of the requested work, one decision waiting for the user, or one missing check that affects the result; a worker's "Next steps" suggestion is not one.
   - Add: `attention add --task ID --owner user|worker --kind decision|obligation|check --text TEXT [--action TEXT] [--report FILE|--user]`.
   - Close: `attention resolve --task ID --point P1 --how answered|verified|dropped|limit-accepted --text TEXT [--report FILE|--user]`; `verified` names the report with the evidence, and the other kinds quote the user's words with `--user`.
   - Most reports need no change; do not show the points unless the user asks.
     For snoozing, reopening, or an answer that could close several points, read `.agents/skills/foreman-attention/SKILL.md`.
3. Choose one next action that completes the request or removes a blocker:
   - candidates are the worker's "Next steps" and requirements of earlier rounds still unfinished; drop what is done, declined, accepted as a limit, or against a limit in force;
   - a worker's optional refactor is input, not an obligation;
   - `round` when the worker can do it, `accept` when the goal is reached and nothing is pending, `clarify` when a report contradicts an earlier result or facts are missing, and `decision` when only the user's choice can unblock it.
4. Record and show it: `next propose --task ID --kind round|decision|accept|clarify --text LINE --summary-file FILE [--instruction TEXT] [--type ship|scout]`.
   `FILE` holds your report of this task's result as the user should read it, in Markdown; it is kept verbatim for the dashboard.
   For `round`, `--instruction` is the worker's instruction, written by the rewriting rules of `foreman-control`.
   Show the printed output exactly, the report then its block, as this task's part of the answer; add no reason paragraph, no instruction text, and no option list.
   Write "chốt task" or "accept task" for acceptance, never "merge".

When the user asks to check a task that is `review-ready` or `blocked` and `next show --task ID` shows no `current` next action, run these steps for its last report before answering, even though the report is no longer new; the dashboard shows Foreman's report only after `next propose`.

When the user answers a shown block, follow "Approving a shown next action" in `foreman-control`.

## Heartbeat turn (Paseo)

A heartbeat prompt arrives as a `<paseo-system>` message naming the schedule and ID, and the context says this turn is the Foreman heartbeat; its collection and status check already ran.
A quiet heartbeat is blocked by the prompt hook before you run, so a heartbeat that reaches you has something to tell, unless the context says nothing needs the user.

- Tell only the `Not yet told to the user` notices, merged into one short message, and present new reports as above; then ack the notices `next propose` did not record.
- When nothing needs the user, end the turn without text, or with only `—` when the client insists; never write "checked", "still running", or a reminder of something already told.
- A heartbeat turn never prompts, interrupts, restarts, or recovers a worker, accepts, discards, or closes anything, and makes no decision for the user.
  An anomaly is told as evidence; dead or missing workers wait for a user turn, where step 3 confirms them.
- An idle, finished, or prompt-accepted worker is not a completed task; only a valid report is.

To change, pause, or resume the heartbeat itself, read `.agents/skills/foreman-paseo-heartbeat/SKILL.md`.
