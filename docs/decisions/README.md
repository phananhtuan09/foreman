# Decisions

Store durable architecture, security, compatibility, operational, or product decisions here.
Record the chosen direction, constraints, and rationale that future work must respect.
Do not create a decision record for routine implementation choices.

## Admission

Create a decision artifact only for an accepted choice whose rationale or constraints future work must preserve.
Update the original record to mark it superseded; do not rewrite history to make an old decision appear current.
Use a filename in the form `YYYY-MM-DD-<lowercase-kebab-topic>.md`.
`README.md` defines this namespace and is not a decision record.

## Document format

Use this structure:

```md
# <Decision title>

Status: Accepted | Superseded
Date: YYYY-MM-DD
Scope: <affected systems or boundary>
Superseded by: <relative link; include only when applicable>

## Context

<The problem, forces, and constraints that made a decision necessary.>

## Decision

<The accepted direction stated precisely.>

## Constraints

- <Invariant or boundary future work must respect.>

## Consequences

- Positive: <benefit or capability gained.>
- Negative: <cost, limitation, or operational burden accepted.>

## Alternatives considered

- <Alternative and the material reason it was not selected. Omit when not known.>

## References

- <Related product rule, pattern, runbook, code boundary, or external source. Omit when none exist.>
```

`Context`, `Decision`, and `Consequences` are required.
`Constraints` is required when the decision imposes ongoing boundaries.
The metadata fields `Status`, `Date`, and `Scope` are required.

## Writing rules

Describe the decision and its rationale, not the implementation work used to apply it.
State only rationale and alternatives supported by the accepted decision or available evidence.
Separate facts, constraints, and consequences; do not present inference as historical intent.
Record meaningful drawbacks as well as benefits.
When replacing a decision, create the new record, mark the old record `Superseded`, and link both directions.
Do not use a decision record as a task log, design brainstorm, or substitute for product behavior documentation.
