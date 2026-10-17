# Paseo runtime backend

Status: Accepted
Date: 2026-09-28
Scope: Runtime backends accepted for Foreman core and how an assignment stays bound to one backend

## Context

Herdr was the first production runtime backend.
Paseo offers a managed local agent runtime with an SDK, and the core state model was already required not to depend on Herdr-specific identifiers.

## Decision

Herdr and Paseo are implemented behind separate entrypoints and adapters, and the task backend is stored with every assignment.

## Constraints

- An assignment stays bound to its selected backend; Foreman never retries a Paseo operation through Herdr.
- Selecting a backend sets `FOREMAN_BACKEND` for one CLI process only and never changes the login shell.
- Runtime backends beyond Herdr and Paseo require their own accepted specification.

## Consequences

- Positive: both backends share one home, one task identity model, and one operational workflow.
- Negative: each backend needs its own report path: pane-bound reports for Herdr, timeline collection for Paseo.

## References

- [Runtime backends and routing](../product/runtime-backends-and-routing.md)
- [Feature admission rule](2026-09-21-feature-admission-rule.md)
