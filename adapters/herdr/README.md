# Herdr adapter

The production runtime backend is Herdr.
The adapter is version and command-surface gated before spawn, inspect, send, read, interrupt, stop, or list.
Keep transport details here or in `src/herdr.js`; task state remains keyed by task, project, owner, generation, and endpoint evidence rather than Herdr identifiers.
