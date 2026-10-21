# Foreman home and environment

Status: Active
Scope: The tracked Foreman checkout, the private operational home, and the shell environment that workers and hooks inherit

## Purpose

Foreman distinguishes tracked code from private operational state even when both live in one checkout.
Every helper, hook, and worker must resolve the same roots so that state mutations stay inside the selected home.

## Definitions

- `FOREMAN_ROOT`: the tracked source checkout containing instructions, scripts, adapters, tests, and durable documentation.
- `FOREMAN_HOME`: the private operational root containing `data/`; client-owned workspaces live outside Foreman home.
- `FOREMAN_BACKEND`: the runtime backend selected for one Foreman CLI process.

## Rules

### Repository layout

- The tracked checkout uses this layout:

  ```text
  foreman/
  ├── AGENTS.md                  supervisor contract and router
  ├── docs/                      durable product, decision, and reference documentation
  ├── .agents/skills/            conditionally loaded Foreman workflows for Codex
  ├── config/model-routing.json  routing groups, router, and worker profiles for both backends
  ├── config/paseo-agent-profiles.json  repo-owned Paseo agent runtime profile mappings
  ├── bin/                       deterministic helpers and runtime adapters
  ├── hooks/                     coding-agent hook scripts for worker reports and the Foreman session
  ├── dashboard/                 static page, app scripts, and self-hosted fonts of `foreman dashboard serve`
  ├── design/dashboard/          agreed dashboard design and its design system bundle, also served by the dashboard
  ├── paseo-plugins/
  │   └── foreman-dashboard/     optional Paseo plugin: sidebar button that opens the web dashboard
  ├── adapters/
  │   └── herdr/                 Herdr-specific mechanics and compatibility checks
  ├── test/                      state, recovery, report, and adapter proof
  ├── data/                      private fleet records, coordination, and lock; gitignored
  └── projects/                  optional client-owned workspace mount; not managed by Foreman
  ```

### Roots

- If `FOREMAN_HOME` is unset, it defaults to `FOREMAN_ROOT`.
- Every helper resolves and validates both roots before mutation.
- The `data/` directory of `FOREMAN_HOME` is private runtime state and MUST NOT be edited by workers.

### Initialization

- `foreman init` run in the Foreman checkout records that checkout as `FOREMAN_ROOT` and `FOREMAN_HOME` (or `--home`) in the startup file of the machine's login shell.
- The startup file is `$ZDOTDIR/.zshrc` or `~/.zshrc` for zsh, `~/.bashrc` for bash (`~/.bash_profile` on macOS), `~/.config/fish/conf.d/foreman.fish` for fish, and `~/.profile` for `sh`, `dash`, `ksh`, or `mksh`.
- `foreman init` rewrites only its own marked block and leaves the rest of the file unchanged.
- `foreman init` refuses an unrecognized shell by printing the lines to add manually.
- `foreman init` never writes the backend choice to a shell startup file.
- `foreman init` cannot change the environment of the session that runs it; when that session inherited a different `FOREMAN_ROOT` or `FOREMAN_HOME`, its output carries a `warning`, and Foreman runs no other command in that session.
- Herdr worker panes opened after `init` inherit both root variables, which the worker stop hook and `foreman report` rely on.

### Backend selection

- `bin/foreman-herdr` and `bin/foreman-paseo` set `FOREMAN_BACKEND` for one Foreman CLI process.
- `FOREMAN_BACKEND` accepts `herdr` or `paseo`, defaults to `herdr` for existing callers, and rejects any other value.

### Routing configuration

- Both backends route from `FOREMAN_ROOT/config/model-routing.json`.
- Paseo maps every model-routing profile to the corresponding `foreman-<profile>` entry in `FOREMAN_ROOT/config/paseo-agent-profiles.json`; `isActive` only controls whether Foreman may recommend or select that profile.
- Paseo's installed profile list changes only through explicit profile sync, and sync preserves profiles that Foreman does not own.

## References

- [Runtime backends and routing](runtime-backends-and-routing.md)
- [Durable state model](durable-state-model.md)
