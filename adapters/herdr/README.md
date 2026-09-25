# Herdr adapter

The production runtime backend is Herdr.
The adapter is version and command-surface gated before spawn, inspect, send, read, interrupt, stop, or list.
The gate checks the agent and pane verbs those calls actually use, including `agent send-keys` for interrupt.
Interrupt succeeds only after a later inspection shows the endpoint still exists and is no longer working.
Spawn confirms Codex and Claude folder-trust screens before treating the agent as ready, because Herdr reports such a screen as idle and the brief's Enter would otherwise answer it.
Recovery stays in Foreman and composes inspect, stop, and spawn.
Keep transport details here or in `src/herdr.js`; task state remains keyed by task, project, owner, generation, and endpoint evidence rather than Herdr identifiers.
Spawn returns the worker's pane ID, which Foreman stores so that `foreman report` can bind a report from `HERDR_PANE_ID` to its assignment.
