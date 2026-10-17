# Standalone local Foreman architecture

Status: Accepted
Date: 2026-09-21
Scope: Foreman's repository model, deployment, state store, delivery mode, and authority boundaries

## Context

Foreman began as a repo-scoped experiment inside a managed project.
A fleet supervisor needs its own operational home, durable state that survives session reset, and authority boundaries that keep the user in control of acceptance and merges.

## Decision

- Repository model: Foreman is a standalone agent distribution with its own operational home, not a project-local coding skill.
- Deployment: local machine only.
- State store: files with atomic writes and explicit locks; no database.
- Delivery mode: `local-only` first.
- Acceptance: user only.
- Merge authority: none in the initial release.
- Project mutation: workers only, in client-prepared shared workspaces; resource leases guard concurrent mutation.

## Constraints

- Tracked code under `FOREMAN_ROOT` stays distinct from private operational state under `FOREMAN_HOME/data/`.
- Pull-request delivery requires its own accepted authority, evidence, polling, and cleanup contract after `local-only` delivery is proven.
- Remote homes, relay channels, richer notifications, or autonomous reversible actions require separate accepted specifications and do not enter core by analogy with another supervisor product.

## Consequences

- Positive: a fresh session can reconstruct the fleet from files and one runtime listing without a running service.
- Positive: the user remains the only acceptance and merge authority.
- Negative: remote workers, remote homes, and PR delivery are unavailable until separately specified.

## References

- [Product boundary](../product/product-boundary.md)
- [Feature admission rule](2026-09-21-feature-admission-rule.md)
- The repo-scoped experiment was preserved under `legacy/` until parity was proven; it was removed from the repository on 2026-10-17 at the user's request and remains available in Git history.
