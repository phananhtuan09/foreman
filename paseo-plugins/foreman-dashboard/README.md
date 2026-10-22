# Foreman dashboard (Paseo plugin)

A sidebar button and a Command Center item ("Mở Foreman dashboard") that open the read-only Foreman web dashboard, and a "Tắt" button beside it (Command Center: "Tắt Foreman dashboard") that stops it.
The plugin shows no board of its own; the board is `foreman dashboard serve` (see `docs/product/web-dashboard.md`).
It also hides, in every agent timeline, the "UserPromptSubmit operation blocked by hook" notice that Claude Code shows when the Foreman prompt hook blocks a quiet `foreman-supervision` heartbeat; a block for any other schedule or reason stays visible.

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

4. Optionally open the plugin's settings screen and set `foremanRoot`, `foremanHome` and `port`.
   An empty `foremanRoot` falls back to the checkout the plugin was installed from (read from the daemon `config.json`); `foremanHome` defaults to `foremanRoot`; `port` defaults to 18789.
   If no `foremanRoot` resolves, pressing the button shows a setup message and starts nothing.

After editing the source, run `npm run typecheck` and `paseo plugin reload foreman-dashboard`.
The daemon needs `node` on its `PATH` to run `bin/foreman`.

## What a press does

1. If a Foreman dashboard already answers on `127.0.0.1:<port>`, it is reused.
2. Otherwise the daemon side runs `node <foremanRoot>/bin/foreman dashboard serve --port <port>` without a shell and waits up to 5 s for it to answer.
3. The app opens the address with the platform's external link opener (the system browser on desktop).

The process the plugin starts stops when you press "Tắt" or when the plugin is stopped, reloaded or removed.
A dashboard you started yourself is never stopped; pressing "Tắt" then reports that the plugin has none.
A failure (no `foremanRoot`, port taken by something else, `bin/foreman` missing) shows as the button label.

## Tests

```bash
npm test
```

Covers hiding only the quiet Foreman heartbeat notice, reuse of a running dashboard, a single shared start for concurrent presses, stopping on request and with the plugin, never stopping a dashboard it did not start, a process that exits early, a missing setup, and a dashboard that never answers.
The root `npm test` runs only `test/*.test.js` and does not pick these up.
