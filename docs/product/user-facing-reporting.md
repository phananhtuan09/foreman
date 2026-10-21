# User-facing reporting

Status: Active
Scope: What the Foreman session shows the user about fleet status, approvals, decisions, and anomalies

## Purpose

The user sees conclusions, decisions, approvals, and material anomalies rather than worker transcripts or internal housekeeping.

## Rules

- User-facing communication is Vietnamese; identifiers, paths, commands, and runtime state values remain verbatim.
- Default output is short and grouped only when non-empty under `Cần bạn duyệt`, `Cần bạn quyết` (decisions and `blocked` reports), and `Bất thường`.
- A final count reports running and queued work.
- Each task appears once per response.
- Passed checks are counted; gaps, risks, and user actions are stated.
- Detailed worker reports are shown only when requested or required for a decision.
- Fleet status may be filtered by project, task, worker, lifecycle, or anomaly.
- A request for full status actively refreshes every running assignment before reporting.
- Default `status` and `task list` render the grouped Vietnamese report, and `--json` keeps the machine-readable record.
- A review-ready task under `Cần bạn duyệt` shows its review size, such as `chờ duyệt (12 file, +340/−120)`.

### Fleet statistics

- `stats` reports, only when the user asks, for a window that defaults to the last seven days: tasks accepted and discarded, the user's average response time and count for decisions, `blocked` reports, and reviews, and the share of task time spent waiting on the user versus the worker.
- A decision response runs from its creation to its answer; a `blocked` response from the report to the next round; a review response from a `done` report to the next round or acceptance.
- A task waits on the worker from each dispatch, adoption, round, or answered decision until its next report, and on the user from each `done` or `blocked` report or new decision until the user's next answer, round, or acceptance; time before the first dispatch is not counted.
- It reads the ended-task history and the live task records, takes no lock, writes nothing, and states how many ended and live tasks it used and which unreadable lines or tasks it skipped.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Supervision and recovery](supervision-and-recovery.md)
