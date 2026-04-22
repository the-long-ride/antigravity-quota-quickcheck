import * as vscode from "vscode";
import { CONFIG, COMMANDS, UI_TEXT } from "../constants";
import { FullStatus } from "../telemetry";
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
  md.appendMarkdown(`### Your *${status.planTier}* Usage\n\n`);

  // Remaining AI Credits balance
  const balance = status.credits?.balance ?? null;
  const creditLine =
    balance !== null
      ? `**Remaining AI Credits:** **\`${formatNumber(balance)}\`** *(per subscription)*`
      : "**Remaining AI Credits:** *unavailable*";
  md.appendMarkdown(`${creditLine}\n\n`);

  // Per-model quota table
  if (status.quotas.length > 0) {
    md.appendMarkdown("---\n\n");
    md.appendMarkdown("**Quota per available model:** *(per account)*\n\n");

    // HTML Table
    md.appendMarkdown('<table border="0" cellspacing="0" cellpadding="4">\n');
    md.appendMarkdown(
      "<tr><th>Model</th><th>Remaining</th><th>Resets in</th></tr>\n",
    );

    for (const q of status.quotas) {
      const bar = buildBar(q.percent, 8);
      const iconUri = getQuotaIconUri(q.percent, extensionUri);

      md.appendMarkdown(
        `<tr><td><img src="${iconUri.toString()}" width="14" align="center" /> &nbsp;${q.model}</td><td>${bar} ${q.percent}%</td><td>${q.refreshTime}</td></tr>\n`,
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
