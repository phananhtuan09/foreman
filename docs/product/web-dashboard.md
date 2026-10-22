# Web dashboard

Status: Active
Scope: `foreman dashboard serve`, the read-only local web view of one Foreman home, and the status check result it reads

## Purpose

The user checks fleet status in a browser without opening Paseo or asking the Foreman session, while every instruction still goes through the Foreman session.
The dashboard answers, in order: what waits for the user, which agents run and whether they look healthy, and what just happened.

## Definitions

- Snapshot: everything the dashboard shows, built from `FOREMAN_HOME/data/` and `FOREMAN_ROOT/config/model-routing.json` in one read.
- Kept status check: the result of the last fleet-wide status check and Paseo collection per backend, in `data/status-check.json`.

## Rules

### Serving

- `foreman dashboard serve [--port 18789] [--open]` runs in the foreground until Ctrl C; it starts no background process and stopping it loses nothing.
- It binds `127.0.0.1` only and answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`.
- It answers only `GET` and `HEAD`, serves only the dashboard page, the design system bundle, the self-hosted fonts, and the snapshot.
- It works without a network: fonts and scripts come from the checkout.
- It adds no runtime dependency and spends no model tokens.

### Read-only

- The dashboard MUST NOT send anything to a worker or the Foreman session, write the home, take the home lock, initialize a missing home, or migrate a record.
- It MUST NOT call a runtime; runtime state and anomalies come only from the kept status check.
- A malformed task record is skipped and listed on the Health screen; the rest still shows.
- A missing home shows a notice telling the user to run `foreman init` or set `FOREMAN_HOME`.
- Tổng quan, Chờ bạn, and the task page offer no copy action, prompt for the Foreman session, or CLI command; they only show state.
- Display preferences, the selected task, and which reports were seen are kept per browser and never in the home.

### Live updates

- While a browser holds the event stream, the server checks a fingerprint of the files the snapshot reads about once a second and pushes a new snapshot over Server-Sent Events when it changes.
- With no browser connected the server does no periodic work.
- When the event stream is down the page polls the snapshot every 5 seconds and says so; when the server is unreachable it says when its data stopped.

### Kept status check

- A fleet-wide `foreman status`, including the prompt hook's check, replaces its backend's kept result: check time, runtime agent count, and each observed task's generation, endpoint, runtime state, and issues.
- A failed fleet-wide check keeps the last good result and records the failure time and error beside it.
- A project-scoped status check keeps nothing.
- A Paseo collection replaces the kept collection time and each collected task's state and issue.
- Acceptance and discard remove the task from the kept result.
- Keeping the result never fails the check; the record is evidence only, so a damaged one is replaced by the next check.
- The dashboard uses a kept result for a task only while its generation and endpoint still match the task.
- A task with no matching kept result shows no runtime state; `unknown` is never shown as `dead`.

### Screens

- The top bar holds Tổng quan, Chờ bạn, Task, Timeline, then Health, Dự án & lease, Token & cache, Cài đặt; each task has its own page at `#/task/<id>`.
- Task at `#/task` lists every unaccepted task with its status, project, agent, round, and last activity, filterable by project, status, and search, and each row opens its task page.
  Ended tasks from `data/task-history.jsonl` are listed below with their outcome and no link, because their content is gone.
- Tổng quan's Agent section shows every task with an endpoint, or still dispatching, exactly once on a kanban board by runtime state: Đang chạy (running or dispatching), Idle, Chờ input, and Không rõ / mất (unknown, mismatch, dead, missing).
- Tổng quan shows a one-line summary, the Agent section, and every live task exactly once on a kanban board with four flow columns: Hàng chờ (routing, queued), Đang làm (pending, working), Cần bạn (waiting decision, blocked, model choice), and Chờ duyệt (review-ready).
- In Đang làm, a task with an issue, a bad runtime state, or no activity for 90 minutes is marked as an anomaly and listed first.
- Task status labels are Vietnamese; runtime states keep Foreman's values.
- Chờ bạn lists decisions, blocked reports, model choices, reviews, and the user's open attention points, longest waiting first.
- Tổng quan, Chờ bạn, and the task page show Foreman's reports of a task, rendered from their Markdown exactly as the Foreman session showed them with their next-action block, instead of worker reports; a task without one says so.
- The task page lists each round with only the user's own words and Foreman's reports of that round, not the instruction Foreman sent the worker.
- A task card's one-line summary and a blocked item's title in Chờ bạn come from the first sentence of Foreman's latest report; while a newer worker report has not been presented yet, or no Foreman report exists, they come from the worker report.
- Timeline shows time per task and an event log; ended tasks come from `data/task-history.jsonl` and show a title only when the server saw the task while it was open.
- Health shows the dashboard connection, each backend's kept status check and Paseo collection, the Paseo heartbeat, skipped records, anomalies with whether the user was told, untold notices, and the outbox.
- Dự án & lease shows registered projects, held resource claims with the live tasks whose claims overlap them in a conflicting mode, and dependencies.
- Token & cache shows “—” for every number until Foreman records worker token usage; it never shows an estimate.

## References

- [Product boundary](product-boundary.md)
- [Supervision and recovery](supervision-and-recovery.md)
- [Durable state model](durable-state-model.md)
- Design: `design/dashboard/` (Manifest / Paper Tag)
