import * as vscode from "vscode";
import { CONFIG, COMMANDS, UI_TEXT } from "../constants";
import { FullStatus, formatAbsoluteTime } from "../telemetry";
import { buildBar, getQuotaIconUri, formatNumber } from "./helpers";

export function buildTooltip(
  status: FullStatus | null,
  extensionUri: vscode.Uri,
  overrides?: { showUsage?: boolean; showCredits?: boolean },
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.supportHtml = true; // Enable HTML support

  if (!status) {
    md.appendMarkdown(`${UI_TEXT.LOADING_TITLE}\n\n`);
    md.appendMarkdown("*Loading...*\n\n");
    md.appendMarkdown("---\n\n");
    const settingsBtn = `<a href="command:${COMMANDS.SET_INTERVAL}" title="${UI_TEXT.SET_INTERVAL_TOOLTIP}">${UI_TEXT.SET_INTERVAL_LABEL}</a>`;

    const showCredits = overrides?.showCredits !== undefined
      ? overrides.showCredits
      : vscode.workspace
          .getConfiguration(CONFIG.EXTENSION_ID)
          .get<boolean>(CONFIG.SHOW_CREDITS_KEY, true);
    const creditsLabel = showCredits
      ? UI_TEXT.HIDE_CREDITS_LABEL
      : UI_TEXT.SHOW_CREDITS_LABEL;
    const toggleCreditsBtn = `<a href="command:${COMMANDS.TOGGLE_CREDITS}" title="${UI_TEXT.TOGGLE_CREDITS_TOOLTIP}">${creditsLabel}</a>`;

    const showUsage = overrides?.showUsage !== undefined
      ? overrides.showUsage
      : vscode.workspace
          .getConfiguration(CONFIG.EXTENSION_ID)
          .get<boolean>(CONFIG.SHOW_USAGE_KEY, true);
    const toggleLabel = showUsage
      ? UI_TEXT.MINIMIZE_LABEL
      : UI_TEXT.MONITORING_LABEL;
    const toggleBtn = `<a href="command:${COMMANDS.TOGGLE_USAGE}" title="${UI_TEXT.TOGGLE_USAGE_TOOLTIP}">$(eye) ${toggleLabel}</a>`;

    md.appendMarkdown(
      `<div align="right"><br/>${settingsBtn} &nbsp; ${toggleCreditsBtn} &nbsp; ${toggleBtn}<br>${UI_TEXT.QUOTA_HINT}</div>`,
    );
    return md;
  }

  // Header
  md.appendMarkdown(
    `### Your *${status.planTier || "Gemini AI"}* Subscription Usage\n\n`,
  );

  // Remaining AI Credits balance
  const balance = status.credits?.balance ?? null;
  const creditLine =
    balance !== null
      ? `**Remaining AI Credits:** **\`${formatNumber(balance)}\`**`
      : "**Remaining AI Credits:** —";
  md.appendMarkdown(`${creditLine}`);
  md.appendMarkdown("<br/>");

  // Per-model quota table
  if (status.quotas.length > 0) {
    // Keep this table just narrower than the one-line footer hint so the hint
    // determines the tooltip's minimum useful width instead of the quota grid.
    md.appendMarkdown('<table border="0" cellspacing="0" cellpadding="2">\n');
    md.appendMarkdown(
      "<tr><th>Model pools</th><th>Limits &amp; Remaining</th><th>Resets at</th></tr>\n",
    );

    for (const q of status.quotas) {
      const fiveHourBar = buildBar(q.fiveHourPercent, 5);
      const weeklyBar = buildBar(q.weeklyPercent, 5);
      const iconUri = getQuotaIconUri(q.fiveHourPercent ?? q.percent, extensionUri);
      const isRecentlyUsed = q.model === status.recentlyUsedModel;
      const modelLabel = isRecentlyUsed
        ? `<strong>$(pulse) ${q.model}</strong>`
        : q.model;

      const fiveHourPercentStr = q.fiveHourPercent !== undefined ? `${q.fiveHourPercent}%` : "—";
      const fiveHourResetStr = q.fiveHourPercent !== undefined
        ? (q.fiveHourDisabled ? "Disabled" : (q.fiveHourReset ? formatAbsoluteTime(q.fiveHourReset) : "Ready"))
        : "—";
      const weeklyPercentStr = q.weeklyPercent !== undefined ? `${q.weeklyPercent}%` : "—";
      const weeklyResetStr = q.weeklyDisabled ? "Disabled" : (q.weeklyReset ? formatAbsoluteTime(q.weeklyReset) : "Ready");

      const hasFiveHour = q.fiveHourPercent !== undefined;
      const limitsTable = hasFiveHour
        ? `<table border="0" cellspacing="0" cellpadding="0">` +
            `<tr>` +
              `<td>5h:&nbsp;</td>` +
              `<td>${fiveHourBar}&nbsp;</td>` +
              `<td align="right">${fiveHourPercentStr}</td>` +
            `</tr>` +
            `<tr>` +
              `<td>7d:&nbsp;</td>` +
              `<td>${weeklyBar}&nbsp;</td>` +
              `<td align="right">${weeklyPercentStr}</td>` +
            `</tr>` +
          `</table>`
        : `<table border="0" cellspacing="0" cellpadding="0">` +
            `<tr>` +
              `<td>7d:&nbsp;</td>` +
              `<td>${weeklyBar}&nbsp;</td>` +
              `<td align="right">${weeklyPercentStr}</td>` +
            `</tr>` +
          `</table>`;

      const resetCell = hasFiveHour
        ? `${fiveHourResetStr}<br/>${weeklyResetStr}`
        : `${weeklyResetStr}`;

      md.appendMarkdown(
        `<tr>` +
          `<td valign="middle"><img src="${iconUri.toString()}" width="14" align="center" />&nbsp;${modelLabel}</td>` +
          `<td>${limitsTable}</td>` +
          `<td>${resetCell}</td>` +
        `</tr>\n`,
      );
    }

    md.appendMarkdown("</table>\n\n");
    md.appendMarkdown("---\n\n");
    md.appendMarkdown(
      "**Tip:** Welcome to use **[Desktop App](https://github.com/the-long-ride/antigravity-quota-quickcheck/releases/latest)** & **[QuotaShift](https://github.com/the-long-ride/QuotaShift/releases/latest)** on desktop!\n\n",
    );
    md.appendMarkdown("---\n");
  }

  // Hint footer
  const settingsBtn = `<a href="command:${COMMANDS.SET_INTERVAL}" title="${UI_TEXT.SET_INTERVAL_TOOLTIP}">${UI_TEXT.SET_INTERVAL_LABEL}</a>`;

  const showCredits = overrides?.showCredits !== undefined
    ? overrides.showCredits
    : vscode.workspace
        .getConfiguration(CONFIG.EXTENSION_ID)
        .get<boolean>(CONFIG.SHOW_CREDITS_KEY, true);
  const creditsLabel = showCredits
    ? UI_TEXT.HIDE_CREDITS_LABEL
    : UI_TEXT.SHOW_CREDITS_LABEL;
  const toggleCreditsBtn = `<a href="command:${COMMANDS.TOGGLE_CREDITS}" title="${UI_TEXT.TOGGLE_CREDITS_TOOLTIP}">${creditsLabel}</a>`;

  const showUsage = overrides?.showUsage !== undefined
    ? overrides.showUsage
    : vscode.workspace
        .getConfiguration(CONFIG.EXTENSION_ID)
        .get<boolean>(CONFIG.SHOW_USAGE_KEY, true);
  const toggleLabel = showUsage
    ? UI_TEXT.MINIMIZE_LABEL
    : UI_TEXT.MONITORING_LABEL;
  const toggleBtn = `<a href="command:${COMMANDS.TOGGLE_USAGE}" title="${UI_TEXT.TOGGLE_USAGE_TOOLTIP}">$(eye) ${toggleLabel}</a>`;

  md.appendMarkdown(
    `<div align="right"><br/>${settingsBtn} &nbsp; ${toggleCreditsBtn} &nbsp; ${toggleBtn}<br>${UI_TEXT.QUOTA_HINT}</div>`,
  );

  return md;
}
