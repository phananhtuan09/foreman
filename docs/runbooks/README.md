# Operational procedures

## Admission and authority

Store supported setup, dispatch, diagnosis, recovery, and cleanup procedures.
Use lowercase kebab-case filenames and update the existing procedure first.
`Verified` requires trustworthy execution evidence for the documented procedure.
`Reference` preserves an existing procedure when complete verification evidence is unavailable; it is not proof of successful execution.
Use `Deprecated` only when the procedure has an explicitly supported retirement or replacement.

## Document contract

Required metadata: `Status: Reference | Verified | Deprecated` and `Applies to`.
Verified procedures require `Last verified: YYYY-MM-DD`; reference procedures require `Verification status` instead.
Required sections: `Outcome`, `Preconditions`, `Procedure`, `Verification`, and `References`.
Include `Safety` and `Recovery` for mutations, partial failure, or destructive effects.
Keep commands, variables, order, warnings, stop conditions, and backend boundaries intact.
Migrated procedures may retain their original topic headings under `Procedure`.
Never run setup, profile sync, acceptance, discard, or recovery against live state solely to fill verification metadata.
