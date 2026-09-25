# Foreman local runbook

Set `FOREMAN_ROOT` to the tracked Foreman checkout and `FOREMAN_HOME` to a private runtime directory.
Register a project, with or without Git, create a task, and dispatch through the CLI:

```sh
bin/foreman init
bin/foreman routing show
bin/foreman project register --id app --root /path/to/app
bin/foreman task create --project app --brief-file brief.md
bin/foreman task dispatch --task T-000001 --owner worker
bin/foreman task adopt --worker worker --task T-000001
bin/foreman task recover --task T-000001
bin/foreman task accept --task T-000001
bin/foreman observer once
bin/foreman reconcile
bin/foreman status
```

`task accept` is the final task action.
It stops the worker endpoint, releases the resource lease, removes task-scoped coordination records, and deletes the task from `data/tasks/` and `state/tasks/`.
The project workspace stays on disk, and accepted tasks are not archived.

Edit the tracked `FOREMAN_ROOT/config/model-routing.json` to change the router, the named worker profiles, or the `default` profile.
Set a profile's `effort` to `low`, `medium`, `high`, `xhigh`, or `max`; Codex also supports `none` for the configured GPT-6 models.
Leave it `null` to use the tool's default.
Set a profile's `isActive` to `false` to hide it from the router; omitted means `true`.
The `default` profile must stay active, and tasks routed before a profile was disabled keep the profile they were given.
Foreman passes Codex effort through `--config model_reasoning_effort=...`, Claude effort through `--effort`, and OMP effort through `--thinking`.
`init`, `routing init`, and `routing show` validate and read that file; they do not create or modify it.
An older `FOREMAN_HOME/config/model-routing.json` is ignored, so copy any custom settings into the tracked file before using them.

`command` accepts either an argument array or a shell-like string, but Foreman always executes it without a shell.
The command executable must match `tool`, and model flags belong in `model` rather than `command`.
Every task is routed during creation, and the decision is stored at `state/tasks/<taskId>/routing.json` before scheduling.
If the router fails or returns an unknown profile, Foreman uses only the configured `default` and records the failure.
Use `routing route --task <id>` to resume a task left in `routing` after an interrupted process.

`status` prints the grouped Vietnamese report.
`status --json` and `task list --json` keep the machine-readable record.
`reconcile` applies valid generation-bound inbox packages and acknowledgements, retries non-terminal messages within their bounds, recovers stale event claims, and performs one runtime listing.
An event with no handler, or a handler that does not apply it, stays `pending`.
`status --project <id>` filters the same reconciled snapshot.
`observer start` and `observer stop` run the deterministic watcher only while supervised work remains.
Each observer pass applies new worker acknowledgements from the task inbox and skips the pass while another command holds the home lock.
`status`, `reconcile`, and dispatch commands restart the observer when it has stopped while supervised work remains.
Commands wait up to 5 seconds for the home lock before failing.
A lock left by a process that died on this host is removed automatically; a lock from another host or a live process is never broken.
The task brief tells the worker how to acknowledge, where to write its completion or blocker package, and the exact `event emit` command that wakes Foreman afterwards.
A delivered but unacknowledged message is redelivered only after a 5-minute acknowledgement timeout that doubles per attempt, and it fails at its attempt limit.
`observer run` is the foreground loop used by `observer start`.

If a worker is missing, wait for the configured confirmation window and inspect the pending `worker.missing` event and `handoff.json`.
Recovery is bounded and preserves the workspace; it does not guess that an `unknown` endpoint is dead.
Quarantined files are kept verbatim under `state/tasks/<id>/inbox/quarantine/` for inspection.

Do not delete `data/` or `state/` while work is active.
Pull-request delivery, remote homes, relay channels, additional runtime backends, and merge authority are deferred.
