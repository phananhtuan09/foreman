# Foreman documentation workflow

## Authority

`AGENTS.md` defines Foreman's identity, request routing, and supervisor boundaries.
This workflow governs documentation organization; it does not replace Foreman's operational skills or introduce a mandatory coding phase chain.
An explicit human request authorizes only its stated change.
Product contracts live in `docs/product/`; architecture and state contracts live in `docs/decisions/`.
Code, tests, configuration, and runtime observations are evidence of current behavior, not automatic approval of intended behavior.
Plans and implementation snapshots are working memory or historical evidence, not product authority.
Runbooks describe operations and must disclose their verification status.

## Documentation migration baseline

The documentation migration preserves the existing Draft 0.6 contract and its historical evidence without approving new product behavior.
Documents marked `Baseline` retain the former contract's authority and draft status until explicitly revised or superseded.
Their migration date is not a newly inferred approval date.

## Discovery and editing

Read `docs/README.md`, then the selected namespace's complete `README.md` and the smallest relevant artifacts.
Use `.agents/skills/manage-project-knowledge/SKILL.md` for finding, explaining, or maintaining durable knowledge.
The skill edits artifacts only; namespace contracts and workflow policy require an explicit maintenance request such as this migration.
Update the artifact that owns the topic before creating another.
Preserve original claims, evidence dates, uncertainty, and supersession relationships.
Do not mark migrated drafts as accepted or migrated procedures as verified merely because they were moved.
Write each complete sentence on its own line, preserving code blocks, tables, and normal Markdown structure.

## Conflicts and proof

If intended-behavior sources conflict and the current request does not resolve them, preserve the disputed wording and surface the conflict before changing behavior.
If code or runtime differs from intent, record the discrepancy without silently rewriting authority to match implementation.
Read-only explanations do not require new files.
Bounded changes do not require a plan; create durable work memory only when sessions, contributors, dependencies, or recovery require it.
Verify local links, namespace contracts, topic ownership, and consequential claims after documentation edits.
For documentation-only moves, content-preservation and reference checks are sufficient; do not mutate fleet state or launch workers just to verify documentation.
