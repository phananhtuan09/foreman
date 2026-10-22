import assert from "node:assert/strict";
import test from "node:test";
import { isQuietForemanHeartbeat } from "../shared/heartbeat";

const blocked = [
  "UserPromptSubmit operation blocked by hook:",
  "Foreman heartbeat: nothing needs the user.",
  "",
  "Original prompt: <paseo-system>",
  'Schedule "foreman-supervision" fired (id=fcc2890f, run=481947e1-941a-45cf-bf62-5d8990024746).',
  "Foreman supervision heartbeat. Follow \"Heartbeat turn (Paseo)\" in .agents/skills/foreman-supervisor/SKILL.md.",
  "</paseo-system>",
].join("\n");

test("only the blocked notice of a quiet Foreman heartbeat is hidden", () => {
  assert.equal(isQuietForemanHeartbeat(blocked), true);
  assert.equal(isQuietForemanHeartbeat(blocked.replace("foreman-supervision", "nightly-report")), false, "another schedule's block stays visible");
  assert.equal(isQuietForemanHeartbeat(blocked.replace("nothing needs the user.", "something else.")), false, "a block for another reason stays visible");
  assert.equal(isQuietForemanHeartbeat("T-000081 (koken, ship) is review-ready. Foreman heartbeat: nothing needs the user."), false, "a normal answer stays visible");
});
