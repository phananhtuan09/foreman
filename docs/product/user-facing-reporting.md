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

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Supervision and recovery](supervision-and-recovery.md)
