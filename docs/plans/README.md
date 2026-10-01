# Work memory and historical evidence

## Admission and authority

Use `active/` for resumable work with meaningful dependencies, multiple sessions or contributors, or recovery needs.
Use `completed/` for useful completed-work evidence and explicitly labeled historical snapshots.
These records never override product or architecture contracts and are not canonical fleet task state.
This namespace opts into the project-knowledge skill for explicit human-requested maintenance.
Do not create task trackers merely to record ordinary work.

## Document contract

Use lowercase kebab-case filenames.
Required metadata: `Status: Active | Completed | Historical`, `Scope`, and `Source`.
Required sections: `Goal`, `State`, and `References`.
Active records must include supported remaining work, dependencies, and validation criteria under `State` when known.
Historical snapshots must state the original evidence date and distinguish reported verification from checks performed now.
Migrated headings may be retained under `State`.
Move active work to completed only when completion is supported; moving files alone does not prove roadmap completion.
Preserve historical claims without silently updating their dates or converting them into intended behavior.
