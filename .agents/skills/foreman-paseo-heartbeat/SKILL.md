---
name: foreman-paseo-heartbeat
description: Create, change, or delete Paseo native heartbeats used for recurring Foreman supervision.
---

# Foreman Paseo heartbeat

Use Paseo's built-in heartbeat for recurring prompts to the current Foreman agent.
Do not implement heartbeat polling with repository code, shell scripts, operating-system cron, or a Paseo schedule.

## Paseo behavior

- A heartbeat prompts the current agent on a cron cadence; it does not create a new worker.
- Prefer the Paseo MCP tools create_heartbeat and delete_heartbeat.
- The Paseo CLI supports heartbeat create, update, and delete. Update changes only the cron cadence and timezone.
- Paseo does not expose heartbeat listing or inspection in the available MCP or CLI surface. Use an exact heartbeat ID from this conversation or from the user; never guess an ID from a name.
- Heartbeats are separate from schedules. Do not use create_schedule or schedule update for this task.

## Create

When the user explicitly asks to create a heartbeat, use the cadence and prompt they gave.
For “every five minutes,” use the five-field cron expression */5 * * * *.
Use the current session timezone when a timezone is needed and the user has not specified one.

For a Foreman status monitor, the recurring prompt should run bin/foreman-paseo task collect first, then exactly one bin/foreman-paseo status --json check. It should read new report files, summarize new task status changes and anomalies, and follow the foreman-supervisor procedure. It must not accept, discard, or close tasks.

Create the heartbeat through create_heartbeat, supplying the requested prompt and cron and any requested name, timezone, expiry, or run limit. Report the returned heartbeat ID, cadence, and any expiry/run limit.

## Change

First identify the exact heartbeat ID from this conversation or the user.

- For a cadence or timezone change only, use the native CLI command paseo heartbeat update with that ID. This updates the existing heartbeat in place.
- Paseo cannot edit a heartbeat prompt, name, expiry, or run limit in place. For those changes, create a replacement with the requested settings, confirm creation succeeded, then delete the old heartbeat by its exact ID. If creation fails, keep the old heartbeat and report the failure. If deletion fails, report both IDs and that both may remain active.
- Never substitute a new-agent schedule for an existing heartbeat.

## Delete

Delete only the exact heartbeat the user identified, using delete_heartbeat or paseo heartbeat delete.
If the ID is not available in the conversation and cannot be supplied by the user, ask for the ID or the original creation result instead of guessing.
Report the deleted ID and the Paseo result.

## Foreman boundaries

Use bin/foreman-paseo for every Foreman CLI command.
Heartbeat administration uses Paseo's native MCP or Paseo CLI and must not change Foreman source code or task records.
Creating, changing, or deleting a heartbeat requires an explicit user request; a question about whether the feature is available is not a request to activate it.

Paseo references: https://paseo.sh/docs/schedules and https://paseo.sh/docs/mcp
