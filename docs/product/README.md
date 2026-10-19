# Product Knowledge

Store durable product behavior, business rules, domain language, and externally observable requirements here.
This location answers what the system should do.
Add only accepted repository-specific truth that should outlive one implementation task.
Do not invent examples or policies merely to populate this directory.

## Admission

Create or update a product artifact only when the knowledge is accepted intent, not merely behavior inferred from code or tests.
Update an existing topic before creating a competing document.
Use a lowercase kebab-case topic filename, such as `account-recovery.md`.
`README.md` defines this namespace and is not a product artifact.

## Document format

Use this structure:

```md
# <Product rule or domain topic>

Status: Active | Superseded
Scope: <affected users, systems, or domain boundary>
Superseded by: <relative link; include only when applicable>

## Purpose

<Why this behavior or domain rule exists and what outcome it protects.>

## Definitions

<Define repository-specific terms needed to interpret the rules. Omit when unnecessary.>

## Rules

- <One externally observable rule per bullet.>

## Examples

<Concrete examples that clarify boundaries without creating new rules. Omit when unnecessary.>

## Exceptions

<Accepted exceptions and their exact boundaries. Omit when none exist.>

## References

- <Related decision, schema, contract, or other durable artifact. Omit when none exist.>
```

`Purpose` and `Rules` are required.
All other sections are conditional, but the `Status` and `Scope` fields are required.

## Writing rules

Write behavior from the consumer or domain perspective rather than describing implementation.
Use normative terms such as MUST, MUST NOT, SHOULD, and MAY only when the strength is intentional.
Make boundaries, precedence, failure behavior, and exceptions explicit when they affect observable behavior.
Keep one rule per bullet so later changes can update a rule without rewriting unrelated content.
Link to decisions for rationale and constraints instead of duplicating them.
Do not include task history, implementation plans, speculative behavior, source-code walkthroughs, or unaccepted proposals.
