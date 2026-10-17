# OpenCode V2 as a coding tool within Herdr

Status: Accepted
Date: 2026-09-26
Scope: The `opencode` worker profile and its Herdr dispatch

## Context

OpenCode V2 dispatch was added to Foreman, and the feature admission rule forbids adding a runtime backend without demonstrated need.

## Decision

OpenCode V2 is added as a coding tool, not a new runtime backend.
Herdr remains the only transport and owns the workspace, pane, prompt delivery, inspection, and stop lifecycle.

## Constraints

- The existing pane-bound report validation, supervision, recovery, and human acceptance rules are unchanged.
- No new runtime backend, service lifecycle authority, or implicit profile fallback is added.
- The router retains its existing explicit-default policy.
- Herdr's agent-state integration supplies pane liveness.

## Consequences

- Positive: OpenCode workers use the same identity, report, and recovery model as other Herdr workers.
- Negative: OpenCode needs a pane-local standalone server and a separately installed global worker-stop plugin.

## References

- [Runtime backends and routing](../product/runtime-backends-and-routing.md)
- [Feature admission rule](2026-09-21-feature-admission-rule.md)
