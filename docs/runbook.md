# Foreman local runbook

Set `FOREMAN_ROOT` to the tracked Foreman checkout and `FOREMAN_HOME` to a private runtime directory.
Register a Git project, create a task, and dispatch through the CLI:

```sh
bin/foreman init
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
