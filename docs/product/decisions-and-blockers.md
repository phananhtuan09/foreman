# Decisions and blockers

Status: Active
Scope: Blocked worker reports, Decision Packages, and delivery of human decisions

## Purpose

Only the user may resolve product, architecture, compatibility, security, operational, or acceptance choices.
Blockers and decisions are persisted with the human response verbatim so authority-blocked work resumes only with the user's actual answer.

## Definitions

- Decision Package: a versioned record Foreman creates when it sees a choice that needs human authority.

## Rules

- A `blocked` report stops the task at `blocked`.
- Foreman shows the user what the worker needs and its next steps, and the user's reply becomes the next round, sent with `foreman task continue` once the user confirms it.
- When Foreman itself sees a choice that needs product, architecture, compatibility, security, operational, or acceptance authority, it persists a complete Decision Package before asking the user.
- Decision records live under `data/tasks/<id>/decisions/` and preserve the original Decision Package and the human response verbatim.
- Each Decision Package contains the finding, why human authority is required, concrete options, impact, evidence, and either the worker recommendation or an explicit statement that no recommendation is available.
- Decision lifecycle is `pending`, `answered`, and `delivered`.
- A task holds at most one undelivered decision for its current generation; a new decision is refused until that one is delivered.
- The human response is delivered through the durable outbox to the current generation.
- Foreman does not resume authority-blocked work until the selected runtime accepts delivery to the current assignment generation; that delivery returns the task to `working`.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Worker communication](worker-communication.md)
