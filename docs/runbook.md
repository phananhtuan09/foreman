# Foreman local runbook

Set `FOREMAN_ROOT` to the tracked Foreman checkout and `FOREMAN_HOME` to a private runtime directory.
Register a Git project, create a task, and dispatch through the CLI:

```sh
bin/foreman init
bin/foreman project register --id app --root /path/to/app
bin/foreman task create --project app --brief-file brief.md
bin/foreman reconcile
bin/foreman status
```

`reconcile` applies valid generation-bound inbox packages and acknowledgements, retries non-terminal messages within their bounds, recovers stale event claims, and performs one runtime listing.
`status --project <id>` filters the same reconciled snapshot.

If a worker is missing, wait for the configured confirmation window and inspect the pending `worker.missing` event and `handoff.json`.
Recovery is bounded and preserves the workspace; it does not guess that an `unknown` endpoint is dead.
Quarantined files are kept verbatim under `state/tasks/<id>/inbox/quarantine/` for inspection.

Do not delete `data/` or `state/` while work is active.
Pull-request delivery, remote homes, relay channels, additional runtime backends, and merge authority are deferred.
