# Technical Patterns

Store accepted recurring technical patterns, conventions, and implementation invariants here.
This location answers how the repository normally solves a class of technical problem.
Patterns do not replace product policy and should not duplicate an established repository convention.

## Admission

Create a pattern artifact only when guidance is accepted, recurring, and useful across more than one isolated implementation.
Update an existing pattern before creating a competing convention.
Use a lowercase kebab-case topic filename, such as `boundary-validation.md`.
`README.md` defines this namespace and is not a pattern artifact.

## Document format

Use this structure:

```md
# <Pattern name>

Status: Active | Superseded
Applies to: <modules, layers, languages, or situations>
Superseded by: <relative link; include only when applicable>

## Problem

<The recurring technical problem this pattern solves.>

## Applicability

<When to use the pattern and when not to use it.>

## Pattern

<The accepted approach, including the minimum structure needed to apply it.>

## Invariants

- <Property every conforming implementation must preserve.>

## Example

<Small repository-relevant example or links to representative implementations. Omit when unnecessary.>

## Trade-offs

- <Cost, limitation, or rejected convenience introduced by the pattern.>

## References

- <Related decision, product rule, runbook, or stable implementation symbol. Omit when none exist.>
```

`Problem`, `Applicability`, and `Pattern` are required.
`Invariants` and `Trade-offs` are required when the pattern establishes constraints or accepts meaningful costs.
The metadata fields `Status` and `Applies to` are required.

## Writing rules

Write reusable guidance rather than narrating one implementation.
Define applicability narrowly enough that the pattern does not become a universal default by accident.
Prefer stable symbols and repository-relative links over copied source code.
Use normative language only for accepted invariants.
Keep examples subordinate to the pattern; an example does not establish a rule on its own.
Link to product rules for required behavior and decisions for rationale instead of duplicating either.
