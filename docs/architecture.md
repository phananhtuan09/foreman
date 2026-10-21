# Foreman architecture

Foreman keeps global fleet state in a private file home and identifies each registered project by its canonical root path.
An explicitly selected Git worktree is checked against that registered project.
`src/foreman.js` owns task, assignment, decision, resource, acceptance, and scheduler transitions.
`src/coordination.js` owns the durable message outbox, the read-only status check, and handoff snapshots.
`src/next-action.js` builds a task's shown next action and decides whether it still matches the task.
`src/attention.js` owns the pending points of each task in `data/tasks/<taskId>/attention.json` and the read-only review across all live tasks.
`src/history.js` builds each task's timeline and owns the ended-task history in `data/task-history.jsonl`, appended under the home lock before acceptance or discard deletes the task.
`src/review-load.js` records a task's review base at dispatch and measures its review size from Git when it reports `done`.
`src/stats.js` computes the read-only `stats` report from the ended-task history and live task timelines.
`src/supervision.js` owns user notices, their told marks, and the Paseo heartbeat record in `data/supervision.json`.
`src/doctor.js` reads past Foreman session transcripts and Git history, read-only, for the `foreman-doctor` skill.
`src/shell-env.js` writes `FOREMAN_ROOT` and `FOREMAN_HOME` into the login shell's startup file for `foreman init`.
`bin/foreman-herdr` and `bin/foreman-paseo` set a process-scoped `FOREMAN_BACKEND`; the core CLI defaults to Herdr and selects the matching runtime adapter.
All private records live under `FOREMAN_HOME/data/`: each task keeps its brief, the user's original wording, round records, metadata, decisions, reports, and optional handoff in `data/tasks/<taskId>/`, while `data/messages/` holds the fleet-wide outbox.
`src/herdr.js` is the narrow Herdr adapter.
`src/paseo.js` invokes the SDK bridge in `bin/foreman-paseo-bridge.js`; each command opens a short-lived Paseo client and does not add a Foreman observer process.
`config/model-routing.json` is the shared routing source for Herdr and Paseo, while `config/paseo-agent-profiles.json` maps every model profile to Paseo's provider, model, mode, thinking, feature, and notes fields.
`bin/foreman-paseo profiles sync` replaces only Foreman-owned Paseo profile IDs while preserving app-owned profiles.
`hooks/` holds the worker stop hook and the Foreman session prompt hook.
`adapters/herdr/` is the distribution wrapper.

Every task enters a durable `routing` state after its brief and the user's original wording are stored; the router reads the original wording.
The tracked `FOREMAN_ROOT/config/model-routing.json` defines one fixed router, one default worker profile, named task groups with usage criteria and ordered profile lists, and named worker profiles.
Each configured profile belongs to exactly one group; inactive profiles are removed from routing candidates, and groups with no active profiles are omitted from the prompt.
The router may select only a configured profile; failure selects the configured default and records the error.
Task metadata records the selected profile, source, reason, any router error, and timestamp before the task becomes `queued`.
The routed profile is a recommendation; `task confirm` records the human's chosen active profile as the dispatch profile with `profileConfirmedAt`, and assignment refuses a routed task without it.
Herdr profiles support `codex`, `claude`, `omp`, and `opencode` and start the selected tool with its configured command arguments and model.
Paseo profiles materialize a provider, model, mode, thinking option, and features into the SDK agent creation call.
Before spawn, the bridge reads the selected daemon's `agentProfiles`, resolves the exact persisted Paseo profile ID, and compares its launch fields with the confirmed task snapshot.
Missing or mismatched profiles fail dispatch with a sync instruction; Foreman never syncs the daemon implicitly.
After creation, the bridge verifies the agent's provider, model, mode, thinking option, and selected feature values, and archives an agent whose settings do not match.
Paseo stores an `agentId` and `workspaceId`; Herdr stores a pane-bound endpoint.

Canonical writes use the home lock and atomic replacement.
JSON records carry `schemaVersion: 1`; unsupported or malformed active records fail closed.
Worker reports are external input.
Herdr's `foreman report` accepts one only from the bound Herdr pane, while Paseo collection reads the assistant response from the bound agent timeline after confirming assignment identity and turn completion.
Both backends store original report text under the task report directory and bind task-state changes to the current generation.

Supervision is pull-based and runs only in Foreman turns.
A Herdr worker's stop hook asks it to run `foreman report` when it ends a turn without having reported since Foreman last prompted it.
Paseo workers return a JSON report object at the end of each turn; Foreman collects new turns through an explicit command and re-reads timeline state during Paseo supervision turns.
The session prompt hook runs that Paseo collection before its single status check when the active backend is Paseo.
The report records `lastReport` in task metadata and moves a `done` task to `review-ready` or a `blocked` task to `blocked`.
The Foreman session's prompt hook prints unread reports and the anomalies of one status check, then marks those reports read.
On a user prompt it also reads the last model call's context size from the Claude Code transcript and adds a one-time nudge for each 150k-token step; the nudge line it left in the transcript is its only record.
The status check lists only the selected backend once, classifies its assignments as `working`, `idle`, `waiting-input`, `dead`, `missing`, `mismatch`, or `unknown`, and marks tasks on the other backend `unobserved`.
It never writes state or interrupts a worker.
The prompt hook also derives notices from task state and that status check, and lists those not yet marked told; `notice ack` writes the mark after Foreman tells the user.
In Paseo mode, `heartbeat sync` creates or deletes the Foreman agent's one Paseo heartbeat through the Paseo CLI as watched work starts and ends, and the hook recognizes its `<paseo-system>` prompt and blocks it before the model runs when nothing needs the user.
Recovery is started explicitly by Foreman after the status check confirms `dead` or `missing`, and composes inspect, stop, and spawn.
Herdr creates a separate workspace for each new worker and receives a concise text prompt.
Paseo creates an agent in a verified Foreman workspace, receives the durable prompt through the SDK, and exposes turn status and timeline data for report collection.
The private outbox retains message identity and payload; delivered prompts are not resent.
After submission, Foreman inspects the endpoint without interrupting the worker and records the result as runtime evidence.
An uncertain task-brief submission keeps the endpoint for inspection.

Images the user pastes travel as part of the user's words.
`src/attachments.js` validates them from their bytes, stores them under `data/tasks/<taskId>/attachments/` with a versioned `attachments.json`, and gives task records and messages only references (ID, digest, type, size).
`image stage` reads them from the Foreman session transcript recorded by the prompt hook into `data/inbox/`.
Before a message that carries images is created, Foreman copies them into `<workspace>/.foreman/attachments/<taskId>/`, excluded through the repository's local `info/exclude`, so workers on both backends read them inside their lease without touching `data/`; the message payload records the workspace paths.
The Paseo bridge additionally sends the images of the current message inline after checking each digest.
A task runs as rounds with one worker: `task continue` appends a round record, may switch the mode and claim a new lease in place, and sends a `task-update` message to the same endpoint and generation; a failed send restores the mode and lease.
Task ownership changes create a new generation.
A confirmed dead or missing worker is replaced through `task recover`, and a healthy one at the user's request through `task reassign`, both with a durable handoff containing the original wording, every delivered round, the last report of each recent round, decisions, latest report, evidence, unresolved checks, workspace, resources, and inspect-first instructions.
Only recovery counts against the attempt limit.
Acceptance is the terminal user action.
It stops and verifies the worker endpoint, releases the resource lease, appends the task's metadata line to `data/task-history.jsonl`, deletes task-specific Foreman records and coordination state, and removes the task's image copies from the workspace.
The project workspace remains on disk; Foreman does not commit, merge, or remove its files.
An explicit discard may remove, under the home lock, a task with no dependants that is either untouched and unassigned, a pending task whose dispatch never recorded an endpoint or sent a prompt while no runtime worker carries its owner, or assigned to a worker a status check confirms dead or missing.

## Read-only task summary and the Paseo dashboard

`taskSummaries({ roots })` in `src/foreman.js` is the only read path built for external viewers, exposed as `foreman task list --json --summary`.
Unlike `listTasks`, it never calls `initHome`, never migrates a record through `ensureVersionedRecord`, and never takes the home lock.
A record without a schema version is validated as version 1 in memory and left untouched; a malformed record is skipped and listed under `skipped`.
It returns `{ tasks, skipped }` for every task except `accepted` and `cleaned`, with only the fields a board shows: ID, project, type, round, status, backend, endpoint, dispatch and routing profile, `needsProfileConfirmation`, a one-line title by the `taskBriefLine` rule, and the user's own wording of the task: `original.md` (else `brief.md`) plus the `original` of each delivered round.
A missing home yields an empty result and creates nothing.

`paseo-plugins/foreman-dashboard/` is an optional Paseo plugin that renders this summary and the app's cached agent state.
Its daemon side keeps one in-memory snapshot, rebuilt only when a throttled `stat` of `data/tasks/` shows a change, and runs the summary command without a shell.
It is local tooling over durable state, not a relay channel or a runtime backend, and it sends nothing to workers or the Foreman session.
