// The floor is the oldest daemon Foreman supports; newer releases pass, and the SDK calls fail closed if one is incompatible.
function isSupportedDaemonVersion(version) {
  const match = /^(\d+)\.(\d+)\./.exec(String(version || ""));
  return Boolean(match) && (Number(match[1]) > 0 || Number(match[2]) >= 10);
}

module.exports = { isSupportedDaemonVersion };
