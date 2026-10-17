<!--
Fill every section. Write "N/A — <reason>" instead of deleting a section.
AI reviewers (pr-agent, Greptile, Sourcery, @claude-ci) read this description as the author's intent:
state the expected behavior precisely so they can check the diff against it.
-->

## Summary

<!-- One or two sentences: what changes for the user or operator after this PR merges. -->

## Context

<!-- Why this change is needed: the problem, failing behavior, or request. Link the issue, proposal (docs/proposals/), or prior PR. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor (no behavior change)
- [ ] Documentation or durable knowledge (`docs/`)
- [ ] Instructions or skills (`AGENTS.md`, `.agents/skills/`, `.claude/skills/`)
- [ ] CI, tooling, or dependencies

## Changes

<!-- Group by area and name the files or modules. Describe behavior, not line-by-line edits. -->

- **Core (`src/`, `bin/`)**:
- **Backends (`adapters/herdr/`, `src/herdr.js`, Paseo bridge)**:
- **Hooks (`hooks/`)**:
- **Config (`config/`)**:
- **Dashboard plugin (`paseo-plugins/foreman-dashboard/`)**:
- **Docs and skills**:
- **Tests (`test/`)**:

## Behavior before and after

<!-- For behavior changes: the exact command, state, or scenario, with the result before and after. Include CLI output or state snippets when they clarify. -->

| Scenario | Before | After |
| --- | --- | --- |
|  |  |  |

## Authority and durable knowledge

<!-- Which accepted rules govern this change, and whether they changed. -->

- Governing artifacts: <!-- e.g. docs/product/task-lifecycle.md#discard, docs/decisions/... -->
- [ ] No product rule or decision changes.
- [ ] Updated the owning artifact in `docs/product/` or `docs/decisions/` (list files above).
- [ ] Updated current-state reference (`docs/architecture.md`, `docs/runbook.md`) where it describes changed behavior.
- [ ] Skill name or description changed, and the `.claude/skills/` mirror was updated.

## Foreman invariants

<!-- Check each one this PR preserves; explain any box you leave unchecked. -->

- [ ] Canonical mutations hold the home lock, and active JSON records stay versioned and identity-bound.
- [ ] Task, project, owner, generation, workspace, resource lease, and endpoint binding are respected; stale endpoints cannot update state.
- [ ] User wording, decisions, and worker reports are persisted verbatim and never overwritten.
- [ ] `unknown` runtime evidence is never treated as `dead` or `missing`; no silent dispatch or backend fallback.
- [ ] Assignments stay on their selected backend; Herdr-specific code stays in `adapters/herdr/` and `src/herdr.js`.
- [ ] No deferred feature enters core (remote homes, relay channels, extra backends, PR delivery, merge authority).
- [ ] New durable state has one writer, a stable identity, and a cleanup rule.

## Verification

<!-- Commands actually run and their results. Separate automated evidence from manual checks; do not claim what was not observed. -->

- [ ] `npm test` — result:
- [ ] Dashboard plugin: `npm run typecheck && npm test` in `paseo-plugins/foreman-dashboard/` — result:
- [ ] Regression reproduced before the fix and passing after (bug fixes):

### Backend verification

<!--
A change that affects runtime behavior must be exercised for real on the backend(s) it touches.
Pick Herdr, Paseo, or both based on the code path, and say why the other one is not needed.
Docs-only, instructions-only, or CI-only changes: write "N/A — <reason>".
-->

- Backends affected: <!-- Herdr | Paseo | both | none, and why -->
- **Herdr** (`bin/foreman-herdr`): scenario run, commands, and observed result (task state, report, status output):
- **Paseo** (`bin/foreman-paseo`): scenario run, commands, and observed result (task state, collected report, status output):
- Live suites (`npm run test:live`, `npm run test:paseo:live`) — result or reason skipped:
- Other manual checks:

## Risks and rollback

<!-- What could break, who is affected (running workers, existing home data, migrations), and how to revert safely. -->

## Out of scope

<!-- Related work intentionally not done here, with follow-up links if any. -->

## Reviewer focus

<!-- Where reviewers should look hardest: tricky logic, races, lock windows, migration paths, assumptions to challenge. -->

## Pre-merge checklist

<!--
Required before merge: the `pr-checklist` check fails while any box below is unchecked.
The author or the authoring AI agent ticks a box only when the item is actually done; tick a box that does not apply and append "N/A — <reason>".
-->

- [ ] CI checks pass on the latest commit.
- [ ] Every AI review comment is fixed or answered with a reason, and its conversation is resolved.
- [ ] Runtime behavior changes were verified for real on the affected backend (Herdr, Paseo, or both) as recorded under Backend verification.
- [ ] Changed behavior is reflected in the owning `docs/product/` or `docs/decisions/` artifact, or no durable knowledge changed.
- [ ] The branch is up to date with `main` and contains no changes outside this PR's scope.
- [ ] Skill name or description changes are mirrored in `.claude/skills/`.
