# Repository-driven Agent Protocol

## Operating model

- Start from the requested outcome, then inspect the repository authority and implementation needed to deliver it.
- Read `docs/WORKFLOW.md` for the detailed authority, work-shape, durable-memory, and proof rules.
- Use the least complex work shape that remains correct, safe, maintainable, and recoverable.
- Treat specialized skills as optional capabilities. Load one only when it materially improves the work; they never form a required execution chain.

## Authority

- Intent authority defines intended behavior.
- The current explicit human request is immediate intent authority for the requested delta when it clearly authorizes a behavior change.
- Approved product and domain rules define durable intended externally observable behavior.
- Approved architecture, security, and compatibility decisions constrain implementation choices.
- Code, tests, schemas, configuration, and runtime evidence are current-state evidence.
- Current-state evidence describes what exists now and disagreements between those sources normally require investigation before deciding what to change.
- Active plans record work state but do not override product or architecture authority.
- Evaluation and learning capabilities use their canonical namespaces under `docs/evaluation/` and `docs/learning/`.
- When durable intent becomes stale because of an accepted current request, update durable knowledge only when the new behavior should outlive the current task.
- When multiple intended-behavior sources conflict and the current request does not resolve the conflict, stop before behavior-changing mutation and request the smallest necessary decision.
- Never invent material product, security, compatibility, or operational policy.

## Work shaping

- For read-only work, inspect the smallest relevant surface and answer with evidence without creating a workflow artifact.
- For a bounded change, inspect affected authority and behavior, implement the smallest coherent change, prove it, and report it directly without creating feature artifacts, a durable plan, or coordinator state.
- Create or resume `docs/plans/active/<plan>.md` only when work must survive sessions, contributors need shared state, dependencies are meaningful, or recovery context cannot be reconstructed safely from the repository.
- Ask for human direction only when materially different externally observable choices remain unresolved.

## Execution

- Inspect only relevant files and reuse existing repository patterns before introducing new structure.
- Preserve unrelated work and never overwrite, revert, or reformat changes outside the requested scope.
- Keep durable repository knowledge only when it will outlive the current task.
- Load a specialized skill only when it materially improves correctness or proof.
- Use direct repository-driven execution; do not create or depend on a legacy coordinator state.

## Proof and completion

- Select the cheapest reliable proof for the changed behavior, such as a focused test, integration check, runtime observation, browser check, or measurement.
- Reproduce a reported bug before changing code when the repository and environment make reproduction feasible.
- Do not claim completion until the requested behavior is implemented end to end and relevant proof has passed.
- Report changed behavior, checks actually run, unresolved failures, and remaining material risk without fabricating evidence.
