# Pull-based supervision

Status: Accepted
Date: 2026-09-25
Scope: How Foreman learns about worker progress for every runtime backend

## Context

Supervision must consume no model tokens while nothing actionable happens and must not depend on a background process that can drift from durable state.

## Decision

Supervision runs only during Foreman turns: Herdr workers report through pane-bound `foreman report` prompted by a stop hook, Paseo turn reports are collected from the bound agent timeline, and the session prompt hook surfaces unread reports and anomalies.
There is no background observer.
The observer, worker heartbeat, event spool, wake queue, worker registry, inbox packages, acknowledgements, quarantine, message retry, automatic follow-up, automatic blocker triage, and automatic recovery were removed on 2026-09-25.

## Constraints

- No background process watches workers.
- A worker never sends prompts into the Foreman session.
- Messages are never resent automatically, and recovery starts only explicitly after confirmed `dead` or `missing` evidence.

## Consequences

- Positive: nothing runs and no tokens are spent while no Foreman turn runs, and reports survive Foreman downtime.
- Negative: Foreman notices a report or a dead worker only at its next turn.

## References

- [Supervision and recovery](../product/supervision-and-recovery.md)
- [Worker communication](../product/worker-communication.md)
