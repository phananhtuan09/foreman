---
name: foreman-attention
description: Review the pending points of every unfinished Foreman task on every project when the user invokes foreman-attention or asks what they may have missed ("còn gì tôi bỏ sót?"), and for the full rules of keeping those points current that the foreman-supervisor summary does not cover, such as snoozing, reopening, or an answer that could close several points.
---

# Foreman attention review

Use the active backend wrapper (`bin/foreman-herdr` or `bin/foreman-paseo`) for every Foreman CLI command below.

A pending point is one obligation of the requested work, one decision still waiting for the user, or one check still missing that affects the result.
Points belong to their task across rounds in `data/tasks/<id>/attention.json` and leave with it at acceptance or discard.
They are not tasks or subtasks, and the user never manages them as a checklist.

## Review on request

1. Run `attention list` once; it reads every task that has not ended on every project, so never ask the user to pick a project or task.
2. Show its output as printed: a separate block between horizontal rules, at most five points grouped into those that need the user and those waiting on a worker, with the count of the rest and of snoozed points.
   Show nothing else from the review unless the user asks for more; `attention list --limit N` or `--json` gives the rest, and `attention list --task ID` gives one task's points with their sources and history.
3. If the user asks for fresher worker status, run the active wrapper's `status` once; it never interrupts a worker.

The review never prompts, interrupts, or reassigns a worker, starts or reopens a round, sends an instruction, or accepts a task.
Do not add the block to other answers, and do not remind the user of points on your own.

## Keeping points current

Update points when you read a worker report or receive the user's answer; do it with the command, not by re-deriving a list from the conversation.

- Add a point only for what the user's request, a round, or a decision obliges, or for a question only the user can answer:
  `attention add --task ID --owner user|worker --kind decision|obligation|check --text TEXT [--action TEXT] [--report FILE|--user]`.
  `--owner user` means the user must act; `--owner worker` means the worker still has to do or prove it.
  Name the report the point comes from with `--report`; use `--user` when it comes from the user's words.
- A worker's "Next steps" suggestion is not an obligation; add it only when the request or the user requires it.
- A report that repeats a closed point does not raise it again: `attention add` refuses the same words of a closed point.
  Reopen with `attention reopen --task ID --point P1 --why TEXT` only when new evidence or a new request changes it, and tell the user what is new and why.
- Close a point with `attention resolve --task ID --point P1 --how answered|verified|dropped|limit-accepted --text TEXT`:
  - `answered`: the user's words, verbatim, with `--user`; record it when the user answers, even if delivering the answer to the worker fails later;
  - `verified`: the report with the evidence, with `--report`; worker evidence stays a worker claim;
  - `dropped` or `limit-accepted`: the user's words when they drop a check or accept a specific limit.
- "để mai nhắc" snoozes exactly that point: `attention snooze --task ID --point P1 --until tomorrow`; it is not resolved.
- Reading the block, or talking about something else, closes nothing.
- An answer that could close several points, such as "ok" while two options wait, closes nothing: ask which point it answers.
  A clear answer closes its point at once, without a confirmation turn.
- Answering one point never closes the others, and a round ending does not end the task; a `done` report makes the task review-ready, and only acceptance ends it.
