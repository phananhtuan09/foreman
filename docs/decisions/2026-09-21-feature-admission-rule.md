# Feature admission rule

Status: Accepted
Date: 2026-09-21
Scope: Any new feature proposed for Foreman core

## Context

A supervisor accumulates features easily, and each new feature can add durable state, authority, or runtime coupling that weakens restart recovery and the user's control.

## Decision

A new feature belongs in Foreman core only if it passes every check in the constraints below.

## Constraints

- Its necessary state survives a cleared session.
- It preserves Foreman's global-context and worker deep-context boundary.
- It preserves user wording on disk, decisions, and original worker reports.
- It keeps the user as acceptance and material-policy authority.
- It materially reduces user coordination or protects fleet correctness.
- Any new state has one writer, a stable identity, and a cleanup lifecycle.
- It respects exact project, task, owner, generation, workspace, resource lease, and endpoint binding.
- It can be proven through focused state, runtime, or recovery scenarios.
- It does not add another backend beyond the accepted Herdr and Paseo integrations without demonstrated need.
- It does not copy a FirstMate feature merely because FirstMate has it.

## Consequences

- Positive: core stays small and every feature keeps the restart and authority invariants.
- Negative: useful features that cannot meet every check stay out of core until redesigned.

## References

- [Supervisor invariants](../product/supervisor-invariants.md)
- [Standalone local architecture](2026-09-21-standalone-local-architecture.md)
