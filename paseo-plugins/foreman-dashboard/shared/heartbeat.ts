// A quiet Foreman heartbeat is blocked by the prompt hook before the model runs, and Claude Code then shows
// "UserPromptSubmit operation blocked by hook" with the hook's reason and the original prompt.
// The reason must match the one `sessionHookOutput` returns in src/foreman.js.
const QUIET_REASON = "Foreman heartbeat: nothing needs the user.";
const HEARTBEAT_FIRED = 'Schedule "foreman-supervision" fired';

export function isQuietForemanHeartbeat(text: string): boolean {
  return text.includes("UserPromptSubmit operation blocked by hook") && text.includes(QUIET_REASON) && text.includes(HEARTBEAT_FIRED);
}
