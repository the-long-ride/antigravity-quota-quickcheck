import * as vscode from "vscode";
import { FullStatus, fetchFullStatus, formatAbsoluteTime, resolveQuotaModelName } from "../telemetry";
import { buildBar, getQuotaIconUri, formatNumber } from "./helpers";
import { getLastStatus, setLastStatus, applyStatusToItem, updateStatusBarSync } from "./statusBar";

export interface ModelQuickPickItem extends vscode.QuickPickItem {
  modelName?: string;
}

export function buildQuickPickItems(
  status: FullStatus,
  extensionUri: vscode.Uri,
): ModelQuickPickItem[] {
  const quotaData = status.quotas;
  const creditBalance = status.credits?.balance ?? null;
  const creditLabel =
    creditBalance !== null
      ? `$(credit-card)  Remaining AI Credits: ${formatNumber(creditBalance)}`
      : `$(credit-card)  Remaining AI Credits: —`;

  const separator: ModelQuickPickItem = {
    label: "",
    kind: vscode.QuickPickItemKind.Separator,
  };

  const creditItem: ModelQuickPickItem = {
    label: creditLabel,
    alwaysShow: true,
  };

  const monitoredModel = vscode.workspace
    .getConfiguration("antigravity-quota")
    .get<string>("monitoredModel");

  let activeModel = resolveQuotaModelName(monitoredModel);
  if (quotaData.length > 0 && !quotaData.some((q) => q.model === activeModel)) {
    activeModel = quotaData[0].model;
  }

  const modelItems: ModelQuickPickItem[] = quotaData.map((item) => {
    const isMonitored = item.model === activeModel;
    const fiveHourResetStr = item.fiveHourPercent === undefined ? "" : (item.fiveHourDisabled ? "Disabled" : (item.fiveHourReset ? formatAbsoluteTime(item.fiveHourReset) : "Ready"));
    const weeklyResetStr = item.weeklyDisabled ? "Disabled" : (item.weeklyReset ? formatAbsoluteTime(item.weeklyReset) : "Ready");

    const fiveHourPart =
      item.fiveHourPercent === undefined
        ? null
        : `5h ${item.fiveHourDisabled ? "—" : `${item.fiveHourPercent}%`} - ${fiveHourResetStr}`;

    const weeklyPart =
      item.weeklyPercent === undefined
        ? null
        : `7d ${item.weeklyDisabled ? "—" : `${item.weeklyPercent}%`} - ${weeklyResetStr}`;

    const detailText =
      fiveHourPart && weeklyPart
        ? `${fiveHourPart} // ${weeklyPart}`
        : (fiveHourPart || weeklyPart || `Quota ${item.percent}% - ${item.refreshTime}`);

    const detail = `$(clock) ${detailText}`;

    return {
      label: `${isMonitored ? "$(check) $(pulse) " : "   "}${item.model}`,
      modelName: item.model,
      detail,
      iconPath: getQuotaIconUri(item.fiveHourPercent ?? item.percent, extensionUri),
      alwaysShow: true,
    };
  });

  const desktopSeparator: ModelQuickPickItem = {
    label: "",
    kind: vscode.QuickPickItemKind.Separator,
  };

  const desktopAppItem: ModelQuickPickItem = {
    label: "Get Desktop App",
    description: "Track your quota anytime on desktop (especially when using Antigravity 2.0)",
    iconPath: {
      light: vscode.Uri.joinPath(extensionUri, "assets", "icons", "desktop-light.svg"),
      dark: vscode.Uri.joinPath(extensionUri, "assets", "icons", "desktop-dark.svg"),
    },
    alwaysShow: true,
  };

  const quotaShiftItem: ModelQuickPickItem = {
    label: "Get QuotaShift",
    description: "Lightweight desktop app for multiple-account switching, monitoring & pooling",
    iconPath: new vscode.ThemeIcon("organization"),
    alwaysShow: true,
  };

  return [creditItem, separator, ...modelItems, desktopSeparator, desktopAppItem, quotaShiftItem];
}

export function showQuotaPopup(
  extensionUri: vscode.Uri,
  statusBarItem?: vscode.StatusBarItem,
): void {
  const quickPick = vscode.window.createQuickPick<ModelQuickPickItem>();
  quickPick.title = "Antigravity Quota — Live";
  quickPick.placeholder = "Select a model to monitor in the status bar";

  const cachedStatus = getLastStatus();
  if (cachedStatus && cachedStatus.quotas.length > 0) {
    quickPick.items = buildQuickPickItems(cachedStatus, extensionUri);
  } else {
    quickPick.items = [
      {
        label: "$(sync~spin)  Refreshing real-time quotas...",
        alwaysShow: true,
      },
    ];
  }

  quickPick.busy = true;
  quickPick.show();

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (selected) {
      if (selected.label.includes("Get Desktop App")) {
        vscode.env.openExternal(vscode.Uri.parse("https://github.com/the-long-ride/antigravity-quota-quickcheck/releases/latest"));
      } else if (selected.label.includes("QuotaShift")) {
        vscode.env.openExternal(vscode.Uri.parse("https://github.com/the-long-ride/QuotaShift/releases/latest"));
      } else if (selected.modelName) {
        const config = vscode.workspace.getConfiguration("antigravity-quota");
        await config.update(
          "monitoredModel",
          selected.modelName,
          vscode.ConfigurationTarget.Global,
        );
        if (statusBarItem) {
          updateStatusBarSync(statusBarItem, extensionUri);
        }
      }
    }
    quickPick.hide();
  });

  // Background refresh: immediately updates QuickPick and status bar when fetch completes
  fetchFullStatus(true)
    .then((freshStatus) => {
      setLastStatus(freshStatus);
      if (statusBarItem) {
        applyStatusToItem(statusBarItem, freshStatus, extensionUri);
      }
      quickPick.items = buildQuickPickItems(freshStatus, extensionUri);
      quickPick.busy = false;
    })
    .catch((err) => {
      quickPick.busy = false;
      if (!cachedStatus || cachedStatus.quotas.length === 0) {
        quickPick.items = [
          {
            label: `$(error) Failed to refresh quota: ${err?.message || "Unavailable"}`,
            alwaysShow: true,
          },
        ];
      }
    });
}
