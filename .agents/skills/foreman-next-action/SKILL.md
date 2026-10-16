---
name: foreman-next-action
description: Use within foreman-supervisor whenever Foreman presents a new worker report, to choose the one most useful next step for that task, show it as one highlight line, and send it when the user agrees. Not a user-invoked skill.
---

# Foreman next action

Use the active backend wrapper (`bin/foreman-herdr` or `bin/foreman-paseo`) for every Foreman CLI command below.

## When

Propose a next action once, in the answer that presents a new worker report of a task.
Do not repeat it in later answers that are about something else, and do not ask a running worker anything just to propose one.

## Choosing the step

1. Read `task history --task ID`: the user's original words, every delivered round, recent reports, decisions, pending points, and any earlier next action.
   From them, state for yourself the current goal and the limits still in force, such as "do not change the PR description".
2. Compare the new report with that goal: what it achieved, what the request still requires, blockers, and what is unverified (a worker's passing test is a worker claim).
3. Collect candidates from the worker's "Next steps" and from requirements of earlier rounds that are still unfinished, even when the new report does not mention them.
4. Drop candidates that are done, declined, accepted as a limit, in progress, or against a limit in force.
   A worker's "Recommended" or optional refactor is input, not an instruction, and never becomes a requirement for closing the task.
5. Choose one step that completes the request or removes a blocker.

There is no fixed proposal → implement → test sequence: when the user asked only for a proposal, a finished proposal may complete the task.

| Situation | Next action |
| --- | --- |
| Proposal done and the user wants it implemented after review | Implement the proposal within the agreed limits (`round`). |
| Implemented, but verification the user asked for is missing | Do exactly the missing verification (`round`). |
| Worker offers A/B and the user already chose A | Continue with A; never ask A/B again. |
| Worker suggests an out-of-scope refactor | Not the next action and not an obligation. |
| The report contradicts an earlier result or decision | Name the contradiction and what must be clarified (`clarify`); do not silently follow the newest report. |
| Goal reached and nothing pending | Suggest accepting the task (`accept`); never accept it yourself. |
| Facts missing to choose a safe step | Name exactly what must be clarified (`clarify`); do not guess a technical solution. |
| Only the user's choice, permission, or information can unblock it | A short question with clear options (`decision`). |

Prefer a step the worker can do; ask the user only for a decision, permission, or information that is really missing.

## Showing it

Record it before showing it:
`next propose --task ID --kind round|decision|accept|clarify --text LINE [--instruction TEXT] [--type ship|scout]`.
For `round`, `--instruction` is the worker's instruction for that step, written by the rewriting rules of `foreman-control`: only the user's words, the task's rounds, and the reports; it carries the limits still in force and adds no technical decision or scope.
Show the returned `line` on its own right after the result, for example `> **▶ T-42 · Đề xuất: Kiểm chứng migration còn thiếu.**`.
Show no reason paragraph, no instruction block, and no list of three options by default.
Add one short sentence only when missing information would make the user approve the wrong scope, risk, or trade-off.
Write "chốt task" or "accept task" for acceptance, never "merge".

## When the user answers

- "gửi bước này", "ok làm đi", or similar approves exactly the shown step.
  Run `next show --task ID`; if it is still `current`, send it with `task continue --task ID --next --original "<the user's words>"`.
  The shown line stands for its stored instruction, so this approval is the confirmation `foreman-control` requires; show the instruction only when the user asks for it.
- If the user edits the step, rewrite the instruction, record it again with `next propose`, and ask before sending.
- If `next show` reports the step out of date, or the task moved on, re-check the history and propose again; when the step changed materially, show the new line and ask again.
- When several tasks have current next actions and the reference is vague, ask which task in one short question.
- A declined or postponed step is cleared with `next clear --task ID`; that does not drop the request it came from.

Proposing never sends a prompt, opens a round, interrupts a worker, creates or accepts a task, or changes anything outside Foreman.
An optional next action is not a pending point of `foreman-attention`.
