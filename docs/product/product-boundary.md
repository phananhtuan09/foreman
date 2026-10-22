# Foreman product boundary

Status: Active
Scope: Foreman as a standalone multi-project supervisor and the projects, workers, and users it serves

## Purpose

Foreman is a persistent multi-project software-work supervisor.
The user works through one Foreman session; Foreman registers projects, records tasks, dispatches or adopts worker agents, supervises them through completion, preserves decisions and evidence on disk, and escalates only decisions or approvals that require the user.
This boundary keeps Foreman's global operational context separate from each managed project's own authority and each worker's deep project context.

## Definitions

- Foreman: an agent distribution with its own operational home; it is not a project-local coding skill and is not part of any managed project's product code.
- Managed project: a registered local project that receives work through Foreman.
- Worker: a coding agent assigned to one task that inspects, implements, reproduces, verifies, and reports.

## Rules

### Ownership

- Foreman owns the fleet-wide project registry.
- Foreman owns task intake, priority, dependencies, assignment, lifecycle, and durable history.
- Foreman owns worker dispatch, adoption, steering, recovery, and handoff.
- Foreman owns workspace, resource-lease, and runtime-endpoint identity.
- Foreman owns event-driven supervision and restart recovery.
- Foreman owns concise user-facing status, decision, and approval packages.
- Foreman owns runtime adapters for the accepted local Herdr and Paseo backends.
- Foreman owns operational state inside the Foreman home.
- Managed projects own their product and architecture authority, repository instructions, source code, tests, configuration, documentation, implementation evidence, and delivery artifacts.
- Workers own deep project context; Foreman keeps global operational context and does not replace a worker's technical investigation.

### Goals

- One Foreman session can manage tasks across every registered local project.
- All task, assignment, decision, progress, blocker, completion, and recovery state survives session reset.
- Every task is bound to exactly one registered project, one current owner at most, and one runtime endpoint at most.
- Project mutations happen through workers in a client-prepared workspace, with resource leases allowing safe concurrency.
- Foreman can recover safely after its session or a worker exits.
- Supervision is event-driven and consumes no model tokens while nothing actionable happens; in Paseo mode a native heartbeat spends one Foreman turn per beat only while work is watched.
- The user sees conclusions, decisions, approvals, and material anomalies rather than worker transcripts or internal housekeeping.
- Human wording and worker reports are retained verbatim before Foreman summarizes them, and the user confirms any rewritten instruction before a worker receives it.
- Foreman never silently broadens authority, merges, discards work, or guesses recovery state.
- The first production runtime backend is Herdr; the core state model MUST NOT depend on Herdr-specific identifiers.

### Non-goals of the first production release

- Runtime backends beyond the accepted Herdr and Paseo integrations, including tmux, Zellij, cmux, and Orca, are out of scope.
- Remote workers and remote Foreman homes are out of scope.
- Nested supervisors and secondmates are out of scope.
- Discord, X, email, voice, and other relay channels are out of scope.
- Automatic PR merge and standing merge authority are out of scope.
- Autonomous product, business, security, compatibility, or architecture decisions are out of scope.
- A database or continuously running LLM service is out of scope.
- Automatic model or quota optimization before the P3 dispatch-profile phase is out of scope.
- Direct production-code implementation by Foreman is out of scope.
- These capabilities MAY be designed later only when the core lifecycle and recovery invariants are already proven.

## Exceptions

- The optional `paseo-plugins/foreman-dashboard/` plugin is local tooling that only starts and opens the web dashboard below, and hides the blocked-prompt notice of a quiet Foreman heartbeat from Paseo timelines.
  It is not a relay channel or a runtime backend, and it never sends to a worker, mutates Foreman state, or takes the home lock.
- The [web dashboard](web-dashboard.md) served by `foreman dashboard serve` is local tooling under the same limits: it binds `127.0.0.1`, only reads durable state, and offers only copyable prompts and commands.

## References

- [Supervisor invariants](supervisor-invariants.md)
- [Standalone local architecture decision](../decisions/2026-09-21-standalone-local-architecture.md)
- [Feature admission rule](../decisions/2026-09-21-feature-admission-rule.md)
