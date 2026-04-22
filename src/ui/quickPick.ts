import * as vscode from "vscode";
import { fetchFullStatus } from "../telemetry";
import { buildBar, getQuotaIconUri, formatNumber } from "./helpers";

export async function showQuotaPopup(extensionUri: vscode.Uri): Promise<void> {
  try {
    const status = await fetchFullStatus();
    const quotaData = status.quotas;

    if (quotaData.length === 0) {
      vscode.window.showInformationMessage("No models or quota data found.");
      return;
    }

    const creditBalance = status.credits?.balance ?? null;
    const creditLabel =
      creditBalance !== null
        ? `$(credit-card)  Remaining AI Credits: ${formatNumber(creditBalance)}`
        : `$(credit-card)  Remaining AI Credits: unavailable`;

    const quickPick = vscode.window.createQuickPick();
    quickPick.title = "Antigravity Quota — Live";
    quickPick.placeholder = "Real-time model quotas";

    const separator: vscode.QuickPickItem = {
      label: "",
      kind: vscode.QuickPickItemKind.Separator,
    };

    const creditItem: vscode.QuickPickItem = {
      label: creditLabel,
      alwaysShow: true,
    };

    const modelItems: vscode.QuickPickItem[] = quotaData.map((item) => {
      const progressBar = buildBar(item.percent, 10);
      const iconUri = getQuotaIconUri(item.percent, extensionUri);

      return {
        label: ` ${item.model}`,
        description: `${progressBar} ${item.percent}%`,
        detail: `$(clock)  Resets in: ${item.refreshTime}`,
        iconPath: iconUri,
        alwaysShow: true,
      };
    });

    quickPick.items = [creditItem, separator, ...modelItems];

    quickPick.onDidAccept(() => quickPick.hide());
    quickPick.show();
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Failed to load Antigravity Quota: ${err.message}`,
    );
  }
}
