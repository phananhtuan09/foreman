# Foreman local runbook

Set `FOREMAN_ROOT` to the tracked Foreman checkout and `FOREMAN_HOME` to a private runtime directory.
Register a Git project, create a task, and dispatch through the CLI:

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

`init` creates `FOREMAN_HOME/config/model-routing.json` if it does not exist and never overwrites an existing file.
The file has one fixed `router`, one `default` profile name, and named worker `profiles`:

```json
{
  "schemaVersion": 1,
  "router": {
    "tool": "codex",
    "command": ["codex", "exec", "--sandbox", "read-only", "--ephemeral"],
    "model": "default",
    "whenToUse": "Classify every new Foreman task."
  },
  "default": "codex-default",
  "profiles": {
    "codex-default": {
      "tool": "codex",
      "command": ["codex"],
      "model": "default",
      "whenToUse": "General coding and debugging."
    },
    "claude-deep": {
      "tool": "claude",
      "command": ["claude", "--dangerously-skip-permissions"],
      "model": "claude-opus",
      "whenToUse": "Large architecture and difficult reasoning."
    },
    "omp-fast": {
      "tool": "omp",
      "command": ["omp", "--auto-approve"],
      "model": "fast-model",
      "whenToUse": "Small isolated changes."
    }
  }
}
```

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
