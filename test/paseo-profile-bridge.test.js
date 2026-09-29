const assert = require("node:assert/strict");
const test = require("node:test");
const {
  profileDifferences,
  resolveDaemonProfile,
  verifyAgentLaunchSettings,
} = require("../bin/foreman-paseo-bridge");

const profile = {
  paseoProfileId: "foreman-claude-sonnet",
  provider: "claude",
  model: "claude-sonnet-5-5",
  modeId: "bypassPermissions",
  thinkingOptionId: "high",
  featureValues: { fast_mode: true },
};

function fakeClient(profiles) {
  return { config: { get: async () => ({ config: { agentProfiles: profiles } }) } };
}

test("Paseo bridge accepts a daemon profile that matches the confirmed snapshot", async () => {
  const installed = { id: profile.paseoProfileId, name: "Claude", ...profile };
  assert.deepEqual(await resolveDaemonProfile(fakeClient([installed]), profile), installed);
});

test("Paseo bridge refuses a missing or out-of-sync daemon profile", async () => {
  await assert.rejects(() => resolveDaemonProfile(fakeClient([]), profile), /not installed.*profiles sync/);
  await assert.rejects(() => resolveDaemonProfile(fakeClient([{ id: profile.paseoProfileId, provider: "claude", model: "claude-opus-5-5" }]), profile), /out of sync.*model.*profiles sync/);
});

test("Paseo bridge verifies settings returned by the created agent", () => {
  verifyAgentLaunchSettings({
    provider: "claude",
    model: "claude-sonnet-5-5",
    currentModeId: "bypassPermissions",
    thinkingOptionId: "high",
    features: [{ id: "fast_mode", type: "toggle", value: true }],
  }, profile);
  assert.throws(() => verifyAgentLaunchSettings({
    provider: "claude",
    model: "claude-sonnet-5-5",
    currentModeId: "default",
    thinkingOptionId: "high",
    features: [{ id: "fast_mode", type: "toggle", value: true }],
  }, profile), /launch settings verification failed.*modeId/);
});

test("Paseo bridge reports missing profile identity instead of deriving one", async () => {
  await assert.rejects(() => resolveDaemonProfile(fakeClient([]), { provider: "claude", model: "claude-sonnet-5-5" }), /missing paseoProfileId.*confirm/);
  assert.deepEqual(profileDifferences(profile, { ...profile, name: "renamed" }), []);
});
