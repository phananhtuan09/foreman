const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

test("OpenCode worker-stop plugin is a loadable directory with a V2 entrypoint", async () => {
  const directory = path.join(__dirname, "..", "hooks", "foreman-worker-stop-opencode");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.main, "./index.js");

  const { default: plugin } = await import(pathToFileURL(path.join(directory, manifest.main)).href);
  assert.equal(plugin.id, "foreman.worker-stop");
  assert.equal(typeof plugin.setup, "function");
});
