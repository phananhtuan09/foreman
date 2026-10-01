# Supervisor–Lead–Peer task architecture

Status: Accepted
Date: 2026-10-01
Scope: Task-scoped Lead and Peer assignments, coordination, project workflow, and lifecycle boundaries

## Context

Foreman's migrated state/runtime contract describes a Supervisor–Worker model and excludes nested supervisors in the initial release.
The human confirmed moving Foreman to Supervisor–Lead–Peer, with Foreman as the user's single point of contact, Lead coordination governed by each managed project's workflow, and human-only acceptance.
The detailed architecture is delegated to Foreman.

## Decision

1. A top-level task has one task-scoped Lead assignment.
   The Lead decomposes work within the user's requirements, coordinates direct Peer child assignments, reviews integration and evidence, and reports the overall result; Peers perform production-code changes.
2. A child work item has one Peer assignment.
   This model has one delegation level: Foreman → Lead → Peer; Peers cannot create further supervisory levels.
   The initial SLP dispatch path covers `ship` tasks; `scout` tasks retain the existing single-worker flow until separately integrated.
3. Each assignment has its own task identity, owner, generation, runtime endpoint, workspace binding, and resource lease.
   The parent and all children remain bound to one registered project, and the child graph is acyclic.
4. Foreman remains the canonical writer under the operational home lock.
   A Lead may request child work only through a supported Foreman interface; Foreman validates and durably records requests and outcomes before dispatch.
   Leads and Peers cannot edit Foreman-owned records or control runtime endpoints directly.
5. The Lead and Peers follow the managed project's actual instructions and workflow.
   The shared Lead skill is distributed through `ai-agent-workflow` and installed in each managed project; the Lead loads that skill and the project instructions at startup.
   Foreman does not keep a competing copy of the Lead skill.
6. Automated assignments use configured profiles, explicit dependencies, and independent resource claims.
   Peer assignments inherit the profile confirmed for the parent task; a Lead cannot change that profile without the human confirmation required by Foreman's routing policy.
   A Lead does not hold an exclusive project write lease merely to coordinate, and any verification that mutates shared resources requires its own explicit claims.
   Conflicting automated write or exclusive claims block dispatch; the user's top-level request does not silently authorize overlap.
7. A Peer report is attributed to its own assignment and is retained verbatim.
   Peer completion is a claim until reviewed by the Lead; only the Lead can report the parent task ready for human acceptance.
8. Only the human accepts the parent task.
   Acceptance stops and reconciles every bound endpoint, message, and lease before deleting task-scoped records; it never commits, merges, deploys, or removes project files.
9. Recovery remains explicit, bounded, and driven by Foreman turns.
   Only two agreeing status checks confirming `dead` or `missing` permit replacement; `unknown` never triggers recovery or lease release.
10. A dead Peer is replaced independently.
    If a Lead is dead, already-authorized Peers may finish and report, but new child work waits for a replacement Lead; that Lead reconstructs and reviews the child assignments without respawning living Peers.
11. Existing Supervisor–Worker assignments remain on their current model until closure.
    New SLP assignments require an explicit model identity; live assignments are not converted in place.
12. Herdr and Paseo remain the supported backends.
    Supervision and coordination continue during Foreman turns without a background observer.

## Constraints

This decision revises the migrated `state-runtime-contract.md` only where its initial-release rules exclude task-scoped Lead-to-Peer delegation or assume a single worker owner for the whole task.
All other baseline identity, project isolation, home lock, report attribution, adapter, workspace, and safety constraints remain in force.
SLP dispatch is not available until Foreman implements the task model and the compatible project-local Lead skill can be loaded.
The decision grants no additional product-policy, security, compatibility, commit, merge, or deployment authority to a Lead.

## Consequences

Foreman needs durable parent/child assignments, independent assignment generations and leases, validated Lead requests, aggregate task reporting, and restartable tree recovery and acceptance.
The runtime, CLI, and `ai-agent-workflow` integration are not implemented by this decision record.
The Lead skill must be updated in `ai-agent-workflow` before any project can satisfy the SLP dispatch prerequisite.

## References

- [Foreman product contract](../product/foreman-contract.md)
- [Baseline state and runtime contract](state-runtime-contract.md)
- [SLP implementation roadmap](../plans/active/core-roadmap.md)
- [AI Agent Workflow base](https://github.com/phananhtuan09/ai-agent-workflow)
