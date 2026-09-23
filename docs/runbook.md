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
bin/foreman task mark-landed --task T-000001 --commit SHA
bin/foreman task release-endpoint --task T-000001
bin/foreman task cleanup --task T-000001 --workspace-released
bin/foreman observer once
bin/foreman reconcile
bin/foreman status
```

`task mark-landed` requires a commit reachable from the branch recorded at dispatch.
Projects without Git skip it because `task accept` marks their ship work landed.

Edit the tracked `FOREMAN_ROOT/config/model-routing.json` to change the router, the named worker profiles, or the `default` profile.
Set a profile's `effort` to `low`, `medium`, `high`, `xhigh`, or `max`; Codex also supports `none` for the configured GPT-6 models.
Leave it `null` to use the tool's default.
Set a profile's `isActive` to `false` to hide it from the router; omitted means `true`.
The `default` profile must stay active, and tasks routed before a profile was disabled keep the profile they were given.
Foreman passes Codex effort through `--config model_reasoning_effort=...` and Claude effort through `--effort`; `omp` profiles do not support this field.
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
`observer run` is the foreground loop used by `observer start`.

If a worker is missing, wait for the configured confirmation window and inspect the pending `worker.missing` event and `handoff.json`.
Recovery is bounded and preserves the workspace; it does not guess that an `unknown` endpoint is dead.
Quarantined files are kept verbatim under `state/tasks/<id>/inbox/quarantine/` for inspection.

Do not delete `data/` or `state/` while work is active.
Pull-request delivery, remote homes, relay channels, additional runtime backends, and merge authority are deferred.
