---
name: foreman-next-action
description: Detailed rules for choosing and showing a Foreman next action, for cases the "Presenting a report" steps of foreman-supervisor do not settle. Not a user-invoked skill.
---

# Foreman next action

The common path is in the "Presenting a report" steps of `.agents/skills/foreman-supervisor/SKILL.md`; this skill holds the full rules behind them.

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
| The user asked to verify something, and the result rests only on reading code or records while the behavior can be run | Verify it at runtime first (`round`), and say which limits apply, such as writes to a database; ask for a choice only after that evidence. |

Prefer a step the worker can do; ask the user only for a decision, permission, or information that is really missing.

## Showing it

Record it before showing it:
`next propose --task ID --kind round|decision|accept|clarify --text LINE [--instruction TEXT] [--type ship|scout]`.
For `round`, `--instruction` is the worker's instruction for that step, written by the rewriting rules of `foreman-control`: only the user's words, the task's rounds, and the reports; it carries the limits still in force and adds no technical decision or scope.
The command prints the highlight block by default; use `--json` only when the full saved proposal is needed.
Show that block exactly as printed at the end of the answer, after the result; for a round it reads:

```markdown
> ▶ **Bước tiếp · T-42** · Kiểm chứng migration còn thiếu
>
> 👉 Trả lời **"gửi"** để giao worker · **"bỏ"** để bỏ qua
```

Show no reason paragraph, no instruction block, and no list of three options by default.
Add one short sentence only when missing information would make the user approve the wrong scope, risk, or trade-off.
Write "chốt task" or "accept task" for acceptance, never "merge".

## When the user answers

Follow "Approving a shown next action" in `.agents/skills/foreman-control/SKILL.md`.

Proposing never sends a prompt, opens a round, interrupts a worker, creates or accepts a task, or changes anything outside Foreman.
An optional next action is not a pending point of `foreman-attention`.
