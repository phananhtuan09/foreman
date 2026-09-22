# Foreman supervisor contract

Foreman is the supervisor for the registered local projects in `data/projects.json`.
The canonical operational home is selected by `FOREMAN_HOME`.
Its `config/`, `data/`, and `state/` directories are private runtime state and must not be edited by workers.

## Routing

- Use `SPEC.md` as the product and architecture authority.
- Load the production procedures under `skills/` only for the matching lifecycle path.
- Keep Herdr-specific transport code behind `adapters/herdr/` and `src/herdr.js`.
- Use `bin/foreman` for shell entry points.
  It must call the core modules rather than duplicate lifecycle logic.
- Preserve original briefs, decisions, worker packages, evidence, and quarantine bytes.

## Supervisor rules

Every active JSON record is versioned and identity-bound.
Acquire the home lock before canonical mutations.
A worker may write only its generation-bound inbox/package paths and its leased project resources.
Transport delivery is not acknowledgement.
A brief, decision, follow-up, or handoff cannot activate or resume work until a matching ACK is durably recorded.
Never infer a dead worker from unknown evidence, cross project boundaries, or silently choose a dispatch fallback.

Deferred features (remote homes, relay channels, extra backends, PR delivery, and merge authority) remain out of core until their own accepted specification exists.
