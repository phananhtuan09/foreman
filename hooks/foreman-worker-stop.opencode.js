import path from "node:path";
import { spawnSync } from "node:child_process";

const injectedSessions = new Set();

async function onExecutionSucceeded(ctx, event) {
  const sessionID = event?.data?.sessionID;
  const foremanRoot = process.env.FOREMAN_ROOT;
  if (event?.type !== "session.execution.succeeded" || !sessionID || !foremanRoot || !process.env.HERDR_PANE_ID) return;

  const session = await ctx.session.get({ sessionID });
  if (session?.parentID) return;
  if (injectedSessions.has(sessionID)) {
    injectedSessions.delete(sessionID);
    return;
  }

  const hook = path.join(foremanRoot, "hooks", "foreman-worker-stop.sh");
  const result = spawnSync("sh", [hook], {
    encoding: "utf8",
    input: JSON.stringify({ stop_hook_active: false }),
    timeout: 30000,
    env: process.env,
  });
  if (result.error || result.status !== 0 || !result.stdout?.trim()) return;

  let decision;
  try {
    decision = JSON.parse(result.stdout);
  } catch {
    return;
  }
  if (decision?.decision !== "block" || typeof decision.reason !== "string") return;

  injectedSessions.add(sessionID);
  try {
    await ctx.session.prompt({ sessionID, text: decision.reason });
  } catch {
    injectedSessions.delete(sessionID);
  }
}

export default {
  id: "foreman.worker-stop",
  setup(ctx) {
    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          await onExecutionSucceeded(ctx, event);
        } catch (error) {
          console.error("Foreman worker stop event:", error);
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.error("Foreman worker stop:", error);
    });
    return () => controller.abort();
  },
};
