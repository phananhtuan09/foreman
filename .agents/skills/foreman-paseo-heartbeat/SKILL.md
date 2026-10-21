---
name: foreman-paseo-heartbeat
description: Change, pause, or resume the heartbeat that Foreman manages for recurring Paseo supervision, and explain how it is managed. A heartbeat turn itself follows foreman-supervisor.
---

# Foreman Paseo heartbeat

Foreman uses one native Paseo heartbeat to wake its own Paseo session while Paseo work is watched.
Do not implement recurring checks with repository code, shell polling, operating-system cron, an observer process, or a Paseo schedule that creates a new agent.

## How Foreman manages it

- `bin/foreman-paseo heartbeat sync` creates the heartbeat for the current Foreman agent (`PASEO_AGENT_ID`) when a Paseo task is `working` or a task notice is untold, and deletes it when neither is left.
- It runs by itself: in the session prompt hook, and after `task dispatch`, `schedule`, `continue`, `reassign`, `recover`, `adopt`, `message`, `decision deliver`, `accept`, and `discard` through `bin/foreman-paseo`.
  A `foreman: heartbeat ...` line on standard error reports a create, update, delete, or failure; mention a failure to the user.
- The heartbeat ID is stored in `data/supervision.json`; never guess an ID, and never create a heartbeat yourself with Paseo MCP or CLI.
- Paseo cannot list heartbeats, so `heartbeat sync` re-checks a recorded heartbeat that has not fired recently and recreates it only when Paseo no longer has it.
- A new Foreman session replaces the previous session's heartbeat instead of running a second one.
- Outside a Paseo agent, `heartbeat sync` reports `unavailable` and creates nothing.

## User requests

- Change the cadence: `bin/foreman-paseo heartbeat sync --cron "*/10 * * * *"` (five-field cron; the default is every five minutes).
- Turn recurring checks off: `bin/foreman-paseo heartbeat sync --disable`; back on: `--enable`.
- A question about whether heartbeat supervision exists is not a request to change it.
- A heartbeat the user created that is not Foreman's stays untouched unless the user asks to delete it by its exact ID.

## Heartbeat turn

A heartbeat turn follows "Heartbeat turn (Paseo)" in `.agents/skills/foreman-supervisor/SKILL.md`.

## Paseo limits

- Paseo 0.11 has no silent heartbeat run: every finished heartbeat turn sets the agent's `finished` attention and the daemon sends a push notification when that attention was cleared, even when Foreman writes nothing.
  A blocked quiet heartbeat shows the hook's one-line reason in the timeline and does not remove that attention or push.
- Claude Code asks the agent for a visible reply after a turn that wrote none, so a quiet Claude heartbeat turn that reaches the model ends with `—`.
- A heartbeat that has something to tell is a model turn and costs tokens; a quiet one is blocked by the prompt hook and costs none.

Paseo references: https://paseo.sh/docs/schedules and https://paseo.sh/docs/mcp
