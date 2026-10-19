# Runbooks

Store verified operational procedures for the real system here.
Suitable topics include local startup, migrations, releases, runtime diagnosis, recovery, and cleanup.
Record only commands, prerequisites, ownership, and safety steps that have been verified for this repository.
Do not invent credentials or procedures.

## Admission

Create a runbook only for a procedure that has trustworthy execution evidence or can be safely verified while documenting it.
Update the existing procedure instead of creating a competing sequence.
Use a lowercase kebab-case operation filename, such as `restore-database-backup.md`.
`README.md` defines this namespace and is not a runbook.

## Document format

Use this structure:

```md
# <Operational procedure>

Status: Verified | Deprecated
Applies to: <environment, service, or component>
Last verified: YYYY-MM-DD

## Outcome

<The observable state produced by successful completion.>

## Preconditions

- <Required access, tools, state, backups, and inputs.>

## Safety

- <Destructive effects, stop conditions, credential handling, and rollback prerequisites.>

## Procedure

1. <One action per step, with exact commands in fenced code blocks.>

## Verification

1. <How to prove the intended outcome and detect partial failure.>

## Recovery

1. <How to stop, roll back, or restore a safe state after failure.>

## Troubleshooting

### <Observed symptom>

<Verified cause and corrective action. Omit this section when none are known.>

## References

- <Related decision, system documentation, dashboard, or script. Omit when none exist.>
```

`Outcome`, `Preconditions`, `Procedure`, and `Verification` are required.
`Safety` is required when an action can create material risk, and `Recovery` is required when the procedure changes state or can fail partially; omit either section when it is genuinely inapplicable.
The metadata fields `Status`, `Applies to`, and `Last verified` are required.

## Writing rules

Use numbered steps in execution order and keep one action per step.
Show exact commands and identify every variable, environment, and expected result.
Place warnings and stop conditions before the action that creates risk.
Never expose secrets or present placeholders as runnable values.
Do not claim a command or recovery path is verified without execution evidence.
If safe verification is unavailable, leave the runbook uncreated or unchanged and report the missing evidence.
Update `Last verified` only when the documented procedure itself has been exercised successfully.
