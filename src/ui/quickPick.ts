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
    quickPick.placeholder = "Select a model to monitor in the status bar";

    const separator: vscode.QuickPickItem = {
      label: "",
      kind: vscode.QuickPickItemKind.Separator,
    };

    const creditItem: vscode.QuickPickItem = {
      label: creditLabel,
      alwaysShow: true,
    };

    const monitoredModel = vscode.workspace
      .getConfiguration("antigravity-quota")
      .get<string>("monitoredModel");

    let activeModel = monitoredModel;
    if (quotaData.length > 0 && !quotaData.some((q) => q.model === activeModel)) {
      activeModel = quotaData[0].model;
    }

    interface ModelQuickPickItem extends vscode.QuickPickItem {
      modelName?: string;
    }

    const modelItems: ModelQuickPickItem[] = quotaData.map((item) => {
      const progressBar = buildBar(item.percent, 10);
      const iconUri = getQuotaIconUri(item.percent, extensionUri);
      const isMonitored = item.model === activeModel;

      return {
        label: `${isMonitored ? "$(check) " : "   "}${item.model}`,
        modelName: item.model,
        description: `${progressBar} ${item.percent}%`,
        detail: `$(clock)  Resets in: ${item.refreshTime}`,
        iconPath: iconUri,
        alwaysShow: true,
      };
    });

    quickPick.items = [creditItem, separator, ...modelItems];

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0] as ModelQuickPickItem;
      if (selected && selected.modelName) {
        const config = vscode.workspace.getConfiguration("antigravity-quota");
        await config.update(
          "monitoredModel",
          selected.modelName,
          vscode.ConfigurationTarget.Global,
        );
      }
      quickPick.hide();
    });
    quickPick.show();
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Failed to load Antigravity Quota: ${err.message}`,
    );
  }
}
