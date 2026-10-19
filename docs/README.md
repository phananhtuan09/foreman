# Repository Knowledge

This tree stores durable repository knowledge for Foreman development.
Read only the locations relevant to the requested outcome.

- `WORKFLOW.md` defines authority, work shapes, durable-memory thresholds, proof selection, and completion.
- `product/` stores accepted product and domain behavior.
- `decisions/` stores durable architecture, security, compatibility, operational, or product decisions.
- `plans/active/` stores resumable working memory for complex ongoing work.
- `plans/completed/` stores useful execution history for completed complex work.
- `patterns/` stores accepted recurring technical patterns and invariants.
- `runbooks/` stores verified operational procedures.
- `proposals/` stores optional proposal drafts and human approval records; proposals do not replace accepted product or decision authority.

The following reference documents describe current implementation and operator usage.
They are current-state reference, not product or decision authority:

- `architecture.md` describes Foreman's implementation and state model.
- `runbook.md` is the operator guide for the Foreman CLI.

New repository knowledge uses the locations above.

Each durable artifact namespace governed by this protocol owns its admission criteria, filename convention, document structure, and writing rules in its local `README.md`.
Capabilities managing durable repository knowledge must discover eligible namespaces through this index and follow the target namespace's current `README.md` instead of embedding type-specific templates.
Resolve conflicts using the precedence and ambiguity rules in `WORKFLOW.md`.
