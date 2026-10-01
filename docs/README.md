# Foreman documentation

Read [WORKFLOW.md](WORKFLOW.md) for authority, migration status, and documentation rules.
This index replaces the monolithic specification entry point.

| Namespace | Contract | Topic owner |
| --- | --- | --- |
| Product behavior | [product/README.md](product/README.md) | [Foreman contract](product/foreman-contract.md): purpose, boundaries, invariants, supervision, lifecycle, safety, and feature admission |
| Architecture and state | [decisions/README.md](decisions/README.md) | [State and runtime contract](decisions/state-runtime-contract.md): home layout, records, reports, adapters, workspaces, and concurrency; [accepted SLP decision](decisions/2026-10-01-supervisor-lead-peer.md) |
| Work memory and history | [plans/README.md](plans/README.md) | [Roadmap](plans/active/core-roadmap.md); [historical implementation baseline](plans/completed/implementation-baseline.md) |
| Operational procedures | [runbooks/README.md](runbooks/README.md) | [Local operations](runbooks/local-operations.md) |

`product/`, `decisions/`, and `runbooks/` are durable repository knowledge managed through the project-knowledge skill.
`plans/` explicitly opts into that skill for preservation and human-requested maintenance of work memory, not as accepted intent.
No empty patterns, proposals, testing, evaluation, or learning namespace is installed.

## Migration map

The original section numbers remain as stable migration anchors, not as a required reading order.

| Former specification sections | New location |
| --- | --- |
| 1–5, 10–13, 18 | [Product contract](product/foreman-contract.md) |
| 6–9, 17 | [State and runtime contract](decisions/state-runtime-contract.md) |
| 14–16 | [Roadmap and acceptance criteria](plans/active/core-roadmap.md) |
| 19–20 | [Historical baseline and implementation evidence](plans/completed/implementation-baseline.md) |

The former architecture reference is preserved in the historical baseline.
The former local runbook is preserved in the runbooks namespace as `Reference`, not newly verified.

## Preserved discrepancies

The migration does not silently reconcile these existing differences:

- The architecture contract's section 7.5 says scouts are not fingerprinted; product section 11.9 describes a non-Git mutation hash guard; the historical implementation snapshot says no file scanning is performed.
- The roadmap requests bounded automatic recovery, while the baseline product supervision contract and implementation snapshot describe explicit recovery during Foreman turns.
- The implementation snapshot is dated 2026-09-28; moving it does not make its test results or implementation claims current verification.
- The old runbook claims shared Claude/Codex stop-hook support, while the historical snapshot qualifies verified support as Claude Code only.

Resolve these through a separately authorized investigation or contract revision, not by treating this migration as approval.

## Accepted changes since migration

The Active product contract and accepted SLP architecture decision revise the Baseline contract only for task-scoped Lead-to-Peer delegation and overall task ownership.
The runtime and CLI still implement the prior Supervisor–Worker task model; SLP dispatch must not be treated as available until that implementation and the project-local Lead skill exist.
