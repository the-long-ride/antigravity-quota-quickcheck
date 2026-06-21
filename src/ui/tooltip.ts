import * as vscode from "vscode";
import { CONFIG, COMMANDS, UI_TEXT } from "../constants";
import { FullStatus, formatAbsoluteTime } from "../telemetry";
import { buildBar, getQuotaIconUri, formatNumber } from "./helpers";

export function buildTooltip(
  status: FullStatus | null,
  extensionUri: vscode.Uri,
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

    const showUsage = vscode.workspace
      .getConfiguration(CONFIG.EXTENSION_ID)
      .get<boolean>(CONFIG.SHOW_USAGE_KEY, true);
    const toggleLabel = showUsage
      ? UI_TEXT.MINIMIZE_LABEL
      : UI_TEXT.MONITORING_LABEL;
    const toggleBtn = `<a href="command:${COMMANDS.TOGGLE_USAGE}" title="${UI_TEXT.TOGGLE_USAGE_TOOLTIP}">$(eye) ${toggleLabel}</a>`;

    md.appendMarkdown(
      `<div align="right">${settingsBtn} &nbsp; ${toggleBtn}<br>${UI_TEXT.QUOTA_HINT}</div>`,
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
      : "**Remaining AI Credits:** *unavailable*";
  md.appendMarkdown(`${creditLine}`);
  md.appendMarkdown("<br/>");

  // Per-model quota table
  if (status.quotas.length > 0) {
    // HTML Table
    md.appendMarkdown('<table border="0" cellspacing="0" cellpadding="4">\n');
    md.appendMarkdown(
      "<tr><th>Model</th><th>Limits &amp; Remaining</th><th>Resets at</th></tr>\n",
    );

    for (const q of status.quotas) {
      const fiveHourBar = buildBar(q.fiveHourPercent, 6);
      const weeklyBar = buildBar(q.weeklyPercent, 6);
      const iconUri = getQuotaIconUri(q.fiveHourPercent, extensionUri);
      const isRecentlyUsed = q.model === status.recentlyUsedModel;
      const modelLabel = isRecentlyUsed
        ? `<strong>$(pulse) ${q.model}</strong>`
        : q.model;

      const fiveHourResetStr = q.fiveHourDisabled ? "Disabled" : (q.fiveHourReset ? formatAbsoluteTime(q.fiveHourReset) : "Ready");
      const weeklyResetStr = q.weeklyDisabled ? "Disabled" : (q.weeklyReset ? formatAbsoluteTime(q.weeklyReset) : "Ready");

      md.appendMarkdown(
        `<tr>` +
          `<td valign="middle"><img src="${iconUri.toString()}" width="14" align="center" /> &nbsp;${modelLabel}</td>` +
          `<td>` +
            `<table border="0" cellspacing="0" cellpadding="0">` +
              `<tr>` +
                `<td>5 hrs limit:&nbsp;</td>` +
                `<td>${fiveHourBar}&nbsp;</td>` +
                `<td align="right">${q.fiveHourPercent}%</td>` +
              `</tr>` +
              `<tr>` +
                `<td>Weekly limit:&nbsp;</td>` +
                `<td>${weeklyBar}&nbsp;</td>` +
                `<td align="right">${q.weeklyPercent}%</td>` +
              `</tr>` +
            `</table>` +
          `</td>` +
          `<td>` +
            `${fiveHourResetStr}<br/>` +
            `${weeklyResetStr}` +
          `</td>` +
        `</tr>\n`,
      );
    }

    md.appendMarkdown("</table>\n\n");
    md.appendMarkdown("---\n");
  }


  // Hint footer
  const settingsBtn = `<a href="command:${COMMANDS.SET_INTERVAL}" title="${UI_TEXT.SET_INTERVAL_TOOLTIP}">${UI_TEXT.SET_INTERVAL_LABEL}</a>`;

  const showUsage = vscode.workspace
    .getConfiguration(CONFIG.EXTENSION_ID)
    .get<boolean>(CONFIG.SHOW_USAGE_KEY, true);
  const toggleLabel = showUsage
    ? UI_TEXT.MINIMIZE_LABEL
    : UI_TEXT.MONITORING_LABEL;
  const toggleBtn = `<a href="command:${COMMANDS.TOGGLE_USAGE}" title="${UI_TEXT.TOGGLE_USAGE_TOOLTIP}">$(eye) ${toggleLabel}</a>`;

  md.appendMarkdown(
    `<div align="right">${settingsBtn} &nbsp; ${toggleBtn}<br>${UI_TEXT.QUOTA_HINT}</div>`,
  );

  return md;
}
