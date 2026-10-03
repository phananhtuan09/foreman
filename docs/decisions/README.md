# Architecture and decisions

## Admission and authority

Store durable architecture, state, security, compatibility, and operational choices that future work must respect.
Do not use this namespace for source walkthroughs, execution logs, or unapproved design proposals.
The migrated `state-runtime-contract.md` is a baseline contract, not a newly approved ADR.
The accepted [project-scoped Supervisor–Lead–Peer architecture](2026-10-02-project-scoped-supervisor-lead-peer.md) governs SLP work and supersedes the earlier [task-scoped SLP decision](2026-10-01-supervisor-lead-peer.md).
It also supersedes the Baseline state/runtime contract only where its initial-release wording excludes this accepted model.
Future accepted decisions use `YYYY-MM-DD-<lowercase-kebab-topic>.md`; the date must be the supported decision date, not an invented historical date.
Update the existing topic before creating a competing record.

## Document contract

Required metadata: `Status: Baseline | Accepted | Superseded` and `Scope`.
Baseline records require `Migrated on` and `Source status` instead of an unsupported approval date.
Accepted decision records require `Date`.
Required sections: `Context`, `Decision`, `Constraints`, `Consequences`, and `References`.
Optional section: `Alternatives considered`, only when supported.
Add `Superseded by` when a replacement is accepted and link both directions.
Baseline `Decision` may contain preserved numbered contract sections.
Describe supported choices and constraints without inventing historical rationale, alternatives, or verification.
