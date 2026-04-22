export const CONFIG = {
  EXTENSION_ID: "antigravity-quota",
  SHOW_USAGE_KEY: "showUsageInStatusBar",
};

export const COMMANDS = {
  CHECK_QUOTA: "antigravity-quota.check",
  SET_INTERVAL: "antigravity-quota.setInterval",
  TOGGLE_USAGE: "antigravity-quota.toggleUsage",
};

export const UI_TEXT = {
  SET_INTERVAL_LABEL: "<kbd>$(gear) Set Interval</kbd>",
  SET_INTERVAL_TOOLTIP: "Change refresh rate",
  MINIMIZE_LABEL: "<kbd>Minimize</kbd>",
  MONITORING_LABEL: "<kbd>Monitoring</kbd>",
  TOGGLE_USAGE_TOOLTIP: "Toggle status bar monitoring information",
  QUOTA_HINT: '$(info) <i>Click to refresh & view real-time quotas</i>',
  LOADING_TITLE: "**Your Google AI Usage**",
  ERROR_TITLE: "**Your Google AI Usage**",
  ERROR_MSG: "⚠️ *Language server not reachable.*",
  ERROR_HINT: "$(info) Click to retry fetching real-time quota.",
};
