# Foreman dashboard (Paseo plugin)

A read-only board in the Paseo sidebar: running Foreman workers and open tasks.
It sends nothing to workers or the Foreman session and spawns no process unless Foreman state changed.
The UI copy is Vietnamese, like `renderUserReport`.

## Install

1. Turn on **Enable plugins** under Settings → Plugins on the target daemon.
2. Install dependencies and typecheck:

   ```bash
   cd paseo-plugins/foreman-dashboard
   npm install
   npm run typecheck
   ```

3. Install once per daemon, then check that it is `running`:

   ```bash
   paseo plugin install /absolute/path/to/foreman/paseo-plugins/foreman-dashboard
   paseo plugin ls
   ```

4. Optionally open the plugin's settings screen and set `foremanRoot` and `foremanHome`.
   An empty `foremanRoot` falls back to the checkout the plugin was installed from (read from the daemon `config.json`); `foremanHome` defaults to `foremanRoot`.
   If neither resolves, the board shows a setup message and creates nothing on disk.

After editing the source, run `npm run typecheck` and `paseo plugin reload foreman-dashboard`.
The daemon needs `node` on its `PATH` to run `bin/foreman`.

## What it shows

- **Sidebar header item**: worker count and one peg per running worker (task number, status-colored bar).
  Pressing it opens the screen; "Mở Foreman" in the Command Center does the same.
- **Screen**: the workers board and the task list, ordered with tasks that need you first.
  Clicking a task row opens a detail modal: a status-colored strip, the status stamp and current round, project and agent profile tags, the current request as the main card, and the earlier rounds collapsed on a timeline that ends at the original request.

Agent profile labels come from the Paseo app's cached agent state through `useAgent`, so it costs no RPC or polling.
Task data comes from one daemon-side RPC that returns an in-memory snapshot.
The server rebuilds it only when a throttled `stat` of `data/tasks/` shows a change, by running `node <foremanRoot>/bin/foreman task list --json --summary` once.
Clients read the snapshot every ~5 s on the screen and ~15 s in the sidebar; a fetch never spawns a process.

## Worker agents

Workers are the tasks that have an `endpoint` and are `working`, `blocked`, `waiting-decision`, or `review-ready`.
Paseo workers are matched to their agent by that endpoint, which is the Paseo agent ID.
A worker's status comes only from the Foreman task state (blocked, needs decision, review-ready, otherwise working), because the app's agent cache cannot tell an idle agent from an unloaded one.
Herdr workers are shown as reported by Foreman.

## Simplified from the mockup

- Barlow Condensed → system font, weight 800, tabular numerals.
- Tag and stamp rotation → none.
- Dashed perforation lines → solid hairlines (dashed borders are kept for the idle tag and quiet stamps).
- Punched hole on tags → omitted.
- Inset double outline on "Chờ input" tags → a single thick outline.
- The "needs you" fill is a fixed yellow because no theme token fits; all other colors come from `theme.colors`.

## Tests

```bash
npm test
```

Covers the status mapping, ordering, snapshot invalidation, parity of the stamps with `renderUserReport`, and a scan that the server module uses no worker, timeline, or lock APIs.
The root `npm test` runs only `test/*.test.js` and does not pick these up.
