# Worker communication

Status: Active
Scope: Worker briefs, the durable message outbox, worker reports, and the worker stop hook for Herdr and Paseo workers

## Purpose

Every Foreman-to-worker message is durable before delivery and every worker report is preserved verbatim, so supervision can resume after any restart and no report is lost or attributed to the wrong assignment.

## Rules

### Worker brief

- The dispatched brief includes the task ID, project ID, and workspace.
- The brief includes the user's request as the instruction for the current round, rewritten only as the verbatim authority transport invariant allows.
- Foreman notes, kept separate from the user's words, may add supporting context such as related report paths but MUST NOT reinterpret the request or add requirements, limits, or rules.
- The brief includes accepted follow-up decisions verbatim.
- The brief includes the images sent with the current request, and the image paths of earlier rounds and decisions for a replacement worker.
- The brief includes the earlier rounds and the last report of each recent round, for a replacement worker.
- The brief includes the canonical workspace, current branch, and project boundary.
- The brief includes resource lease IDs and the declared resource claims.
- The brief includes the required deliverable and evidence contract, given as the backend's report command or JSON response shape.
- The brief does not list worker rules such as scope, Git, or lease prohibitions; Git lifecycle remains client-owned.

### Durable message outbox

- Every Foreman-to-worker message is persisted before runtime delivery.
- The same outbox is used for task briefs, round updates, steering, follow-up requests, human decisions, and recovery instructions.
- The worker receives a concise text prompt containing the task brief and only the operational details needed to work within its lease.
- Every worker prompt is rendered by one fixed template.
- A task brief has a header line with task, project, type, and generation, then workspace, branch, and allowed resources, followed by the sections `User request`, optional `Foreman notes`, optional `Previous work and handoff`, and `Report`.
- When a message carries images, an `Images` section with their workspace paths follows the request it belongs to; a message without images has no such section.
- The payload records image references and workspace paths, never image bytes, so the payload digest covers the images.
- The prompt carries no rules section; Git and resource limits are not restated to the worker.
- A follow-up message or human decision has a header line naming its kind, task, and project, then the verbatim text and the same `Report` section.
- A round update (`task-update`) has a header line with task, project, mode, round, and generation, then the allowed resources (marking a change), a note when it replaces an interrupted round, the instruction for that round, optionally the user's original words for reference, and the `Report` section.
- The `Report` section uses the Herdr report command and stop-hook guidance for Herdr assignments, and the required JSON response shape for Paseo assignments.
- The outbox retains the full message identity, payload, and delivery evidence privately.
- Each message records at least its message ID, message kind, task ID and project ID, worker, assignment generation and endpoint binding, creation timestamp, original payload and payload digest, latest transport evidence, and lifecycle state.
- Message lifecycle is `pending`, `delivered`, or `failed`.
- `delivered` means the selected runtime accepted prompt submission; Foreman records the returned delivery evidence without interrupting the worker.
- Messages are never resent automatically.
- An uncertain task-brief submission is recorded for follow-up without stopping the worker or sending the same prompt again.
- Workers do not acknowledge prompts; a new report or the runtime status is the evidence that work continues.

### Foreman-to-worker commands

- `foreman task message` sends a free-form question from Foreman, and a request to a `blocked` or `review-ready` task returns it to `working`.
- `foreman task continue` answers a report with the next round to the same worker, storing the instruction and the user's words, and optionally switching mode, resources, or interrupting a running round.
- `foreman task reassign` moves the task to a new worker, with a new profile if the user names one, and is not limited by the recovery attempt bound.
- `foreman task brief` replaces the brief of a task that has no worker yet, and the request of a pending handoff until its successor receives it.
- `foreman task brief --original` appends the user's words to that pending round.
- `foreman task continue --next` sends the round of the task's shown next action instead of new text.
- Workers never edit the project registry or task metadata.

### Next action

- When Foreman presents a new worker report, it may show one next action for that task in a single highlight line: a round the worker can do, a decision for the user, a clarification, or accepting the task.
- `next propose` records it in task metadata as `nextAction` with its kind, the line shown, the worker instruction of a round (rewritten as the user-confirmation rule for rewritten instructions allows, keeping the limits still in force), and the state it was based on: last report, round, generation, lifecycle status, decision, and a digest of the task's pending points.
- A stored next action is not permission to act.
- When the user approves the shown step, `task continue --next` sends exactly its stored instruction together with the user's words, and refuses once the task has moved on: a newer report, another round or generation, a different status, a changed decision, or changed pending points.
- `task continue --next` refuses a different `--type` or an explicit `--resources`; a mode or resource change requires a newly approved instruction.
- Proposals saved before pending-point digests were recorded must be proposed and approved again before sending.
- The shown line stands for its instruction, so the user's approval of a current next action is the confirmation a rewritten instruction requires.
- Any delivered round clears the next action, `next clear` drops a declined or postponed one without dropping the request, and it leaves with the task at acceptance.
- Proposing never prompts, interrupts, or accepts anything, and an accept proposal is allowed only for a `review-ready` task.
- `task history` is the read-only view a next action is chosen from: the user's words, rounds, recent reports, decisions, pending points, and the shown next action.

### Worker reports

- Herdr workers report through `"$FOREMAN_ROOT/bin/foreman" report --status done|blocked|progress`, giving the summary as `--summary`, `--summary-file`, or standard input; every Herdr worker prompt states this command.
- Paseo workers return one JSON object with `status` and a non-empty `summary` at the end of each turn.
- Foreman tolerates a leading Markdown horizontal rule emitted by the Paseo timeline and preserves the full original response.
- Paseo workers do not invoke `foreman report` or depend on a stop hook.
- Foreman collects Paseo reports using the persisted timeline cursor and current endpoint, workspace, generation, and turn evidence.
- `done` means the task is complete, `blocked` means only the user can unblock it, and `progress` means the worker stopped before finishing for another reason.
- A worker report in a done or blocked state ends with one numbered `Next steps` list that a short reply can point at.
- Each accepted report is stored verbatim under the task reports directory after an identity header of task, project, agent, generation, status, and report time.
- A report written in round two or later also names its round, and a report without a round belongs to round one.
- Earlier reports are never overwritten.
- A report is accepted only while the task is `working` or `blocked`.
- `done` moves the task to `review-ready` and records the report as `completionReport`.
- `blocked` moves the task to `blocked` and records the report as `blockerReport`.
- `progress` leaves the task `working`.
- Every report becomes `lastReport` in task metadata with `readAt` unset until the Foreman session has been shown it.
- Being shown a report is not telling the user; `meta.notified` records that separately.

### Worker stop hook

- `hooks/foreman-worker-stop.sh` is a stop hook for coding agents and may be installed globally; the user installs it.
- The hook runs `foreman worker hook`, which reads the hook payload from standard input and never fails the agent.
- The hook stays silent unless `FOREMAN_ROOT` and `HERDR_PANE_ID` are set, the pane is bound to a `working` task, the worker has not reported since Foreman last prompted it, and the payload does not mark the stop as already continued by a stop hook.
- Otherwise the hook returns a block decision whose reason names the task and tells the agent to run `"$FOREMAN_ROOT/bin/foreman" report` with one of the three statuses before ending its turn.
- The hook is a safety net: every worker prompt already carries the same report command.
- The hook asks at most once per turn, so an agent that ignores it still stops.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Decisions and blockers](decisions-and-blockers.md)
- [Supervision and recovery](supervision-and-recovery.md)
