---
name: foreman-paseo-heartbeat
description: Handle a Foreman Paseo heartbeat turn, and change, pause, or resume the heartbeat that Foreman manages for recurring Paseo supervision.
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

A heartbeat prompt arrives as a `<paseo-system>` message naming the schedule and ID, and the prompt hook adds a supervision context that says this turn is the Foreman heartbeat.

1. Use that context: its Paseo collection and status check already ran in this turn.
   Run `bin/foreman-paseo supervise` once only when the context is missing because the hook failed.
2. Read the reports and the `Not yet told to the user` list.
3. Tell the user only those notices, merged into one short message:
   - `review-ready`: the outcome, the evidence (as worker claims), and what the user must review;
   - `blocked` or a decision: what the user must do;
   - an anomaly or a failed check: what is new and what it does not prove.
4. After telling them, record each told notice with `bin/foreman-paseo notice ack --key KEY` (several `--key` at once).
5. When the context says nothing needs the user, end the turn without writing any text.
   Claude Code insists on a visible reply after a turn without text; then write only `—`, never a status sentence or a reminder of something already told.

| Situation | Behavior |
| --- | --- |
| Worker still running | Silent. |
| Progress report that needs nothing from the user | Silent; it is stored. |
| New review-ready result | Tell once with outcome, evidence, and what to review. |
| New blocker, decision, or permission request | Tell once with what the user must do. |
| The same blocker or decision still waiting | Not repeated; it is already acked. |
| New or materially changed anomaly | Tell what is new. |
| Nothing worth telling | No text at all, or only `—` when the client insists: no "checked", "still running", or "nothing new". |

A heartbeat turn never sends a prompt to a worker, interrupts, restarts, recovers, accepts, discards, or closes anything, makes no decision for the user, and does not widen the task.
An idle, finished, or prompt-accepted worker is not a completed task; only a valid report is.
A failed collection or status check is not evidence that workers are fine, dead, or done.
Dead or missing workers are told as anomalies; recovery waits for a user turn, where the supervisor procedure confirms them with a second status check.

## Paseo limits

- Paseo 0.11 has no silent heartbeat run: every finished heartbeat turn sets the agent's `finished` attention and the daemon sends a push notification when that attention was cleared, even when Foreman writes nothing.
  Ending the turn without text keeps the timeline quiet but does not remove that attention or push.
- Claude Code asks the agent for a visible reply after a turn that wrote none, so a quiet Claude heartbeat turn ends with `—`.
- Every heartbeat turn is a model turn and costs tokens, which is why the heartbeat runs only while work is watched.

Paseo references: https://paseo.sh/docs/schedules and https://paseo.sh/docs/mcp
