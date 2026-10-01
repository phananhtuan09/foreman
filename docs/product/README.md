# Product contracts

## Admission and authority

Store durable intended product behavior, domain terminology, externally observable rules, boundaries, and safety invariants.
Use lowercase kebab-case topic filenames and update the existing topic owner first.
Do not derive approved intent solely from code or tests.
`Baseline` is reserved for the migrated Draft 0.6 contract; it preserves prior authority without inventing approval.
Use `Active` only for explicitly accepted durable intent and `Superseded` when a linked replacement takes over.

## Document contract

Required metadata: `Status: Baseline | Active | Superseded` and `Scope`.
Required sections: `Purpose`, `Rules`, and `References`.
Optional sections: `Definitions`, `Examples`, and `Exceptions` when supported.
Add `Superseded by` only when applicable.
Within `Rules`, organize topics under descriptive headings and state one rule per paragraph or bullet.
Migrated numbered headings and ordered workflows may be retained for traceability.
Link architectural constraints and work-memory evidence rather than duplicating their ownership.
Never promote a brainstorm or unresolved policy choice into active product behavior.
