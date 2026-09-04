import * as vscode from "vscode";
import { fetchFullStatus, resolveQuotaModelName } from "../telemetry";
import { buildTooltip } from "./tooltip";
import { formatNumber } from "./helpers";

export async function refreshStatusBar(
  item: vscode.StatusBarItem,
  extensionUri: vscode.Uri,
  force: boolean = false,
): Promise<void> {
  try {
    const status = await fetchFullStatus(force);
    const creditBalance = status.credits?.balance ?? null;

    const monitoredModel = vscode.workspace
      .getConfiguration("antigravity-quota")
      .get<string>("monitoredModel");

    const resolvedMonitoredModel = resolveQuotaModelName(monitoredModel);
    let activeQuota = status.quotas.find((q) => q.model === resolvedMonitoredModel);
    if (!activeQuota && status.quotas.length > 0) {
      activeQuota = status.quotas[0];
    }
    const recentlyUsedModel = activeQuota?.model ?? "Model";
    status.recentlyUsedModel = activeQuota?.model ?? null;
    const activePercent = activeQuota?.percent ?? null;

    const showUsage = vscode.workspace
      .getConfiguration("antigravity-quota")
      .get<boolean>("showUsageInStatusBar", true);

    if (!showUsage) {
      item.text = `$(credit-card) Quotas`;
    } else {
      const creditText =
        creditBalance !== null ? formatNumber(creditBalance) : "—";
      const quotaText = activePercent !== null ? `${activePercent}%` : "—";
      item.text = `$(credit-card) Credits: ${creditText}${activeQuota ? ` | ${recentlyUsedModel}: ${quotaText}` : ""}`;
    }

    item.tooltip = buildTooltip(status, extensionUri);
  } catch {
    // Keep last good status-bar value; update only the tooltip.
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.appendMarkdown("**Your Google AI Usage**\n\n");
    md.appendMarkdown("⚠️ *Antigravity quota unavailable. Click to retry.*\n\n");
    md.appendMarkdown("---\n\n");
    md.appendMarkdown("$(info) Click to retry fetching real-time quota.");
    item.tooltip = md;
  }
}
