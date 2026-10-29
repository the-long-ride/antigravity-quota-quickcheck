import * as vscode from "vscode";
import { FullStatus, fetchFullStatus, resolveQuotaModelName } from "../telemetry";
import { buildTooltip } from "./tooltip";
import { formatNumber } from "./helpers";

let cachedLastStatus: FullStatus | null = null;

export function getLastStatus(): FullStatus | null {
  return cachedLastStatus;
}

export function setLastStatus(status: FullStatus | null): void {
  cachedLastStatus = status;
}

export interface DisplayOverrides {
  showUsage?: boolean;
  showCredits?: boolean;
}

export function applyStatusToItem(
  item: vscode.StatusBarItem,
  status: FullStatus | null,
  extensionUri: vscode.Uri,
  overrides?: DisplayOverrides,
): void {
  const creditBalance = status?.credits?.balance ?? null;

  const monitoredModel = vscode.workspace
    .getConfiguration("antigravity-quota")
    .get<string>("monitoredModel");

  const resolvedMonitoredModel = resolveQuotaModelName(monitoredModel);
  let activeQuota = status?.quotas.find((q) => q.model === resolvedMonitoredModel);
  if (!activeQuota && status?.quotas && status.quotas.length > 0) {
    activeQuota = status.quotas[0];
  }
  const recentlyUsedModel = activeQuota?.model ?? "Model";
  if (status) {
    status.recentlyUsedModel = activeQuota?.model ?? null;
  }
  const activePercent = activeQuota
    ? (activeQuota.fiveHourPercent ?? activeQuota.percent)
    : null;

  const showUsage = overrides?.showUsage !== undefined
    ? overrides.showUsage
    : vscode.workspace
        .getConfiguration("antigravity-quota")
        .get<boolean>("showUsageInStatusBar", true);

  const showCredits = overrides?.showCredits !== undefined
    ? overrides.showCredits
    : vscode.workspace
        .getConfiguration("antigravity-quota")
        .get<boolean>("showCreditsInStatusBar", true);

  if (!showUsage) {
    item.text = `$(credit-card) Quotas`;
  } else {
    const creditText =
      creditBalance !== null ? formatNumber(creditBalance) : "—";
    const quotaText = activePercent !== null ? `${activePercent}%` : "—";
    if (showCredits) {
      item.text = `$(credit-card) Credits: ${creditText}${activeQuota ? ` | ${recentlyUsedModel}: ${quotaText}` : ""}`;
    } else {
      item.text = activeQuota
        ? `$(credit-card) ${recentlyUsedModel}: ${quotaText}`
        : `$(credit-card) Quotas`;
    }
  }

  item.tooltip = buildTooltip(status, extensionUri, overrides);
}

export function updateStatusBarSync(
  item: vscode.StatusBarItem,
  extensionUri: vscode.Uri,
  overrides?: DisplayOverrides,
): void {
  applyStatusToItem(item, cachedLastStatus, extensionUri, overrides);
}

export async function refreshStatusBar(
  item: vscode.StatusBarItem,
  extensionUri: vscode.Uri,
  force: boolean = false,
): Promise<void> {
  try {
    const status = await fetchFullStatus(force);
    cachedLastStatus = status;
    applyStatusToItem(item, status, extensionUri);
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
