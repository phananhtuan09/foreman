# Runtime backends and routing

Status: Active
Scope: The runtime adapter contract, the Herdr and Paseo backends, coding tools, and dispatch-profile routing

## Purpose

Core supervision depends on a narrow backend-neutral adapter contract so that Herdr and Paseo follow the same task identity model.
Routing recommends a worker profile, but the user confirms it and no implicit fallback changes the selected tool or model.

## Definitions

- Dispatch profile: a named worker profile in `config/model-routing.json` with a coding tool, command, model, and usage policy.
- Coding tool: the agent CLI a profile launches, such as `codex`, `claude`, `omp`, or `opencode`; a coding tool is not a runtime backend.

## Rules

### Adapter contract

- The runtime adapter lists agents and stable endpoints, inspects agent state, spawns a worker at a validated client-prepared workspace, sends a prompt or steering message, reads bounded worker output, interrupts current worker execution without destroying the endpoint, verifies delivery of a message, captures diagnostic output, and stops an endpoint after the user accepts its task.
- Every lifecycle action MUST return evidence that Foreman verifies through a subsequent inspection or other trusted runtime result.
- Lifecycle commands are separate from normal worker messages and cannot be represented as chat instructions.
- Relaunch is a Foreman recovery workflow composed from inspected stop or missing evidence, a new assignment generation, spawn, identity verification, and durable message delivery; it is not a runtime adapter primitive.
- Herdr pane IDs and Paseo agent IDs are stored as opaque backend metadata and do not replace task, project, owner, or generation identity.
- Herdr MUST version-gate against the installed Herdr protocol it relies on and fail closed when required semantics cannot be verified.
- Paseo uses the supported `@getpaseo/client` SDK surface, checks the selected daemon home and compatible daemon version, and fails closed when provider, model, workspace, endpoint, or timeline evidence cannot be verified.
- An adapter may expose optional dispatch capabilities such as agent harness, model, and reasoning effort.

### Backend entrypoints

- `foreman-herdr` and `foreman-paseo` are the backend-specific skill entrypoints; both use the same Foreman home and shared operational workflow.
- Their CLI wrappers set `FOREMAN_BACKEND` only for the child process, so selecting a backend does not mutate the login shell or affect another Foreman session.
- The Herdr entrypoint supports Herdr-backed task routing, dispatch, reports, supervision, recovery, and acceptance.
- The Paseo entrypoint supports Paseo-backed task routing, dispatch, report collection, supervision, recovery, and acceptance.
- Foreman never retries a Paseo operation through Herdr.

### Paseo profiles and collection

- Paseo routing uses `config/model-routing.json`; `config/paseo-agent-profiles.json` supplies the provider, model, mode, thinking, feature, and notes fields that the Paseo daemon needs.
- `bin/foreman-paseo profiles sync` replaces repo-owned `foreman-*` profiles in the selected Paseo home, preserves other profiles and their order, and verifies the readback.
- Profile sync is explicit and never runs during `init` or task creation.
- Paseo agents use the `@getpaseo/client` SDK bridge, and their provider, model, mode, thinking, and features are materialized from the profile selected and confirmed by the human.
- Paseo task collection uses a persisted timeline cursor and turn completion evidence; idle state or prompt acceptance alone never marks a task complete.

### Routing

- Every newly created task is routed before it becomes scheduler-eligible, and the selected profile and evidence are persisted.
- The routed profile is a recommendation shown as option 1 before every other active profile.
- `foreman task confirm --task ID --profile NAME` records the human's choice, and dispatch and scheduling refuse a routed, unassigned task until it is confirmed.
- Recovery keeps the confirmed profile of the assignment it replaces.
- Foreman validates a selected dispatch profile against adapter capabilities before assignment and falls back only to an explicitly configured compatible profile.
- When routing fails, only the explicitly configured `default` profile is used.
- No implicit profile or model fallback is performed beyond the `default` profile named in `model-routing.json`.
- Profiles with `isActive: false` are excluded from routing; `isActive` defaults to `true`, the `default` profile MUST be active, and existing task routing records keep their selected profile.
- A routing profile may set `effort` for Codex, Claude, or OMP through the tool's native command flag.
- An `antigravity` or `grok` profile runs only on Paseo through its provider: it sets no `command` or `effort`, its model ID carries any variant, and it cannot be the router.
- Herdr omits Paseo-only profiles from routing candidates and refuses to confirm, reassign, or dispatch them; the Herdr `default` profile MUST NOT be Paseo-only.

### OpenCode V2 within Herdr

- An explicit `opencode` worker profile uses OpenCode V2's interactive `mini` interface with `command: ["opencode", "mini", "--standalone"]` and a `provider/model` model ID.
- When `effort` is set, Herdr receives the model as `provider/model#<effort>` through `--model`; if the profile model already contains a variant, configuration validation refuses the duplicate.
- OpenCode resolves whether that variant exists for the selected model; an unknown variant fails model resolution.
- OpenCode V2's `mini` interface does not accept `--auto`; routing validation rejects that flag before dispatch.
- The pane-local server MUST inherit `HERDR_PANE_ID`, `FOREMAN_ROOT`, and `FOREMAN_HOME`; a shared OpenCode service may inherit another pane's identity and cannot run the worker stop hook safely.
- The command and model are forwarded as argument arrays without a shell.
- Dispatch fails for a non-interactive or non-standalone OpenCode command.
- Foreman does not silently substitute another coding tool.
- The global OpenCode V2 worker-stop plugin is an installation prerequisite, not part of Foreman's project state; it listens for the root worker session becoming idle and, when the bound task has no report since the last prompt, asks that session to run `foreman report`.
- Neither prompt delivery nor plugin activation counts as a report.

## References

- [Paseo runtime backend decision](../decisions/2026-09-28-paseo-runtime-backend.md)
- [OpenCode V2 tool decision](../decisions/2026-09-26-opencode-v2-tool-within-herdr.md)
- [Home and environment](home-and-environment.md)
