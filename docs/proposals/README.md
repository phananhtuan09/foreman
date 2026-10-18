# Proposals

Store optional, human-requested feature and product proposals here before implementation planning.
A proposal helps a human decide whether to pursue an idea and which high-level direction to take.
This namespace is proposal working material, not accepted product or architecture authority.
Ordinary bounded work does not require a proposal.

## Admission and location

Create a proposal when the human requests one or invokes the proposal capability for a decision that needs product framing or feasibility research.
Use `docs/proposals/<lowercase-kebab-topic>/proposal.md`.
Update the existing topic proposal instead of creating a competing file.
Keep one proposal file per topic; do not add separate review, research, decision, or task files.

## Document contract

Begin with a descriptive title and `Status: Draft | Ready for Approval | Approved`.
Use `Draft` while material decisions or evidence remain open.
Use `Ready for Approval` only when the current version is coherent, its material choices are resolved into a recommendation, and no blocking question remains.
Use `Approved` only after explicit human approval of the current version; record the approval decision and date in the proposal.
Return an Approved proposal to Draft when its substantive recommendation or behavior changes.

Cover these topics at the level the decision requires:

- The goal, user problem, users, and main use cases.
- Scope, main behavior or flow, and consequential exclusions.
- Recommended high-level approach and meaningful alternatives with trade-offs.
- Feasibility, relevant architecture or stack constraints, existing solutions, and third-party dependencies when applicable.
- Material risks, assumptions, unresolved decisions, and evidence sources.

Omit sections that add no decision value.
Separate verified facts, inferences, and proposed behavior.
Link consequential external claims to sources and note version or date when facts may change.
Do not include implementation tasks, API or schema design, class or file layout, or code.
Keep each complete sentence on its own line when substantially editing Markdown.

## Authority and handoff

An unapproved proposal does not override `docs/product/`, `docs/decisions/`, or the current human request.
An approved proposal records the human's direction for its initiative, but durable accepted product rules and architecture decisions belong in their existing namespaces when they should outlive the task.
Do not infer approval from a reviewer finding or from work proceeding in code.
Review findings are advisory and may be incorporated into the same proposal; the reviewer does not approve it.
Planning and implementation follow the normal repository-driven workflow after the human's decision.
