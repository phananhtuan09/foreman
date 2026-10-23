# Web dashboard

Status: Active
Scope: `foreman dashboard serve`, the read-only local web view of one Foreman home, and the status check result it reads

## Purpose

The user checks fleet status in a browser without opening Paseo or asking the Foreman session, while every instruction still goes through the Foreman session.
The dashboard answers, in order: what waits for the user, which agents run and whether they look healthy, and what just happened.

## Definitions

- Snapshot: everything the dashboard shows, built from `FOREMAN_HOME/data/`, `FOREMAN_ROOT/config/model-routing.json`, and the transcripts of recorded worker sessions in one read.
- Worker session: the provider session of a Paseo worker that Foreman recorded for a task's generation when it collected that worker's timeline.
- Model call: one assistant response in a worker session transcript; its token usage is counted once even when the transcript repeats it.
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
- It reads only the Claude Code transcripts of recorded worker sessions, read-only, under `CLAUDE_CONFIG_DIR` or `~/.claude`; it never reads the Foreman session's or any other transcript.
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
- Tổng quan warns about the user's load above the boards, from the same items as Chờ bạn, and only while the warning applies.
  - Now: the number of items reaches a limit, or one item has waited longer than the limit of its kind: blocked or decision, model choice, or review and attention point.
    The warning is red when a blocked task or decision is over its limit, because its agent is idle; otherwise mustard.
  - End of day: within the user's work hours, the estimated time to handle every item is compared with the time left.
    It is red when the estimate exceeds the time left, and mustard within a set time before the end when the estimate reaches a set share of the time left.
    The warning names the quick items that fit, by Chờ bạn's quick-first order, and the rest that can wait for tomorrow.
    After the end of the work hours it lists what is left for tomorrow.
  - Each estimate is a set number of minutes per kind; a review adds minutes per changed file up to a cap and counts an unmeasured size as five files.
  - Every limit, the work hours, and every estimate are browser settings on Cài đặt with defaults, stored in the browser only where they differ from the default, and one action restores all defaults.
    The warning can be turned off there; it never changes what Foreman does.
  - A task ID in a warning opens that item in Chờ bạn.
    The now warning opens Chờ bạn filtered to overdue items, and the end-of-day warning opens it in quick-first order.
  - In Chờ bạn an item over the wait limit of its kind is marked overdue, with a filter for overdue items, and during the work hours an item today's forecast leaves for tomorrow is marked so.
- In Đang làm, a task with an issue, a bad runtime state, or no activity for 90 minutes is marked as an anomaly and listed first.
- Task status labels are Vietnamese; runtime states keep Foreman's values.
- Chờ bạn lists decisions, blocked reports, model choices, reviews, and the user's open attention points, grouped by kind and longest waiting first.
- The user can instead order each group quick first or risk first; the choice is kept in the browser.
  Quick first favours a small measured change, the first round, and no open attention point; risk first favours ship work, a large change, many write leases, a lease overlap, rework rounds, and open points.
  A review without a measured size counts as medium, ties keep the longest waiting first, and each item shows the facts its position came from.
- Tổng quan, Chờ bạn, and the task page show Foreman's reports of a task, rendered from their Markdown exactly as the Foreman session showed them with their next-action block, instead of worker reports; a task without one says so.
- The task page lists each round with only the user's own words and Foreman's reports of that round, not the instruction Foreman sent the worker.
- A task card's one-line summary and a blocked item's title in Chờ bạn come from the first sentence of Foreman's latest report; while a newer worker report has not been presented yet, or no Foreman report exists, they come from the worker report.
- Timeline shows time per task and an event log; ended tasks come from `data/task-history.jsonl` and show a title only when the server saw the task while it was open.
- Health shows the dashboard connection, each backend's kept status check and Paseo collection, the Paseo heartbeat, skipped records, anomalies with whether the user was told, untold notices, and the outbox.
- Dự án & lease shows registered projects, held resource claims with the live tasks whose claims overlap them in a conflicting mode, and dependencies.
- Token & cache counts the token usage of Paseo workers running the Claude provider, from the transcripts of their recorded worker sessions, over the last 7 local days including today.
  - Tokens are input, cache write, cache read, and output, as the transcript reports them; nothing is estimated or priced.
  - The total includes cache reads and says how many of its tokens were read from the cache.
  - The figures are the total, cache hit (cache read over all input-side tokens), the number of full-context resends, and the task with the most tokens.
  - A full-context resend is a model call, after the first of its transcript, that writes more tokens to the cache than it reads from it; a subagent's transcript starts cold like its session's.
  - It also shows tokens and cache hit per day, tokens per task, project, and profile, and each resend with its task, time, and tokens written.
  - A day under 65% cache hit is marked cold.
  - Usage counts up to the latest snapshot; a model call made after it appears with the next one.
  - The page says that Herdr workers, Paseo workers on other or unknown providers, and the Foreman session are not counted, and how many recorded worker sessions have no readable transcript.
  - With no counted model call in the window every figure shows “—”.

## References

- [Product boundary](product-boundary.md)
- [Supervision and recovery](supervision-and-recovery.md)
- [Durable state model](durable-state-model.md)
- Design: `design/dashboard/` (Manifest / Paper Tag)
