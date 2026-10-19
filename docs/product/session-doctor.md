# Session doctor

Status: Active
Scope: The read-only review of past Foreman sessions through the `foreman-doctor` skill and the `foreman doctor` commands

## Purpose

The user can ask Foreman to re-read its own past sessions and learn which mistakes it made and what could improve, with evidence instead of impressions.

## Rules

- On request, the `foreman-doctor` skill re-reads past Foreman sessions and reports evidence-backed mistakes and improvement opportunities.
- `foreman doctor sessions` lists only sessions whose own cwd is the Foreman checkout, from Claude Code session files and Codex rollouts, newest activity first.
- Sessions where every prompt starts with DEV are excluded unless asked, and worker sessions never match.
- `foreman doctor session` prints one session as numbered events with evidence references and its coverage: unparsable lines, tool calls without a result, compactions, truncated events, and subagent entries not shown.
- It also names the committed rules in force: the last Foreman commit before the session started and the rule commits made while it ran.
- Both commands only read transcripts and Git history; they never run a recorded command, touch the Foreman home, or change task state.
- A mistake is reported only with the rule or request in force then, the actual behavior, and a contradiction that survives a rebuttal pass.
- Missing data yields "not enough data", and improvement opportunities and rebutted suspicions are not counted as mistakes.
- No session history or rule versions are stored for the doctor; uncommitted rule edits of the time cannot be known.

## References

- [User-facing reporting](user-facing-reporting.md)
