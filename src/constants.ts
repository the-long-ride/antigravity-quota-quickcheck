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
  SET_INTERVAL_LABEL: "$(gear) Set interval",
  SET_INTERVAL_TOOLTIP:
    "Change how often to refresh the quotas & AI credits balance",
  MINIMIZE_LABEL: "Minimize monitor",
  MONITORING_LABEL: "Display monitor",
  TOGGLE_USAGE_TOOLTIP: "Toggle status bar monitoring information",
  QUOTA_HINT:
    "$(info) <i>Click to refresh, view real-time quotas & choose a model to monitor</i>",
  LOADING_TITLE: "**Your Google AI Usage**",
  ERROR_TITLE: "**Your Google AI Usage**",
  ERROR_MSG: "⚠️ *Language server not reachable.*",
  ERROR_HINT: "$(info) Click to retry fetching real-time quota.",
};
