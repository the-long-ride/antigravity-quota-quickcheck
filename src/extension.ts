import * as vscode from "vscode";
import { refreshStatusBar } from "./ui/statusBar";
import { showQuotaPopup } from "./ui/quickPick";
import { buildTooltip } from "./ui/tooltip";

// Polling interval for status bar refresh (default 30 seconds)
let pollIntervalMs = 30_000;
let timer: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
  const extensionUri = context.extensionUri;

  // Create the main status bar item (Right side, priority 100)
  const myStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  myStatusBarItem.command = "antigravity-quota.check";
  const showUsage = vscode.workspace
    .getConfiguration("antigravity-quota")
    .get<boolean>("showUsageInStatusBar", true);
  myStatusBarItem.text = showUsage
    ? `$(credit-card) Credits: ...`
    : `$(credit-card) Quota`;
  myStatusBarItem.tooltip = buildTooltip(null, extensionUri);
  myStatusBarItem.show();



  context.subscriptions.push(myStatusBarItem);

  // Register the click command — shows the live QuickPick popup
  context.subscriptions.push(
    vscode.commands.registerCommand("antigravity-quota.check", async () => {
      // Force refresh status bar and cache immediately
      await refreshStatusBar(myStatusBarItem, extensionUri, true);
      showQuotaPopup(extensionUri);
    }),
  );

  // Register the interval change command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antigravity-quota.setInterval",
      async () => {
        const input = await vscode.window.showInputBox({
          prompt: "Enter polling interval in seconds (e.g. 10, 30, 60)",
          value: (pollIntervalMs / 1000).toString(),
          validateInput: (text) => {
            const val = Number(text);
            if (isNaN(val) || val < 1) {
              return "Please enter a valid number of seconds (minimum 1).";
            }
            return null;
          },
        });

        if (input !== undefined) {
          const newSeconds = Number(input);
          pollIntervalMs = newSeconds * 1000;

          // Restart timer
          if (timer) clearInterval(timer);
          timer = setInterval(
            () => refreshStatusBar(myStatusBarItem, extensionUri),
            pollIntervalMs,
          );

          vscode.window.showInformationMessage(
            `Antigravity Quota refresh interval set to ${newSeconds} seconds.`,
          );
        }
      },
    ),
  );

  // Register toggle usage command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antigravity-quota.toggleUsage",
      async () => {
        const config = vscode.workspace.getConfiguration("antigravity-quota");
        const current = config.get<boolean>("showUsageInStatusBar", true);
        await config.update(
          "showUsageInStatusBar",
          !current,
          vscode.ConfigurationTarget.Global,
        );

        // Force the tooltip to refresh by momentarily hiding/showing the item
        myStatusBarItem.hide();
        myStatusBarItem.show();
      },
    ),
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("antigravity-quota.showUsageInStatusBar")) {
        refreshStatusBar(myStatusBarItem, extensionUri);
      }
    }),
  );

  // Initial fetch + start polling
  refreshStatusBar(myStatusBarItem, extensionUri);
  timer = setInterval(
    () => refreshStatusBar(myStatusBarItem, extensionUri),
    pollIntervalMs,
  );

  context.subscriptions.push({
    dispose: () => {
      if (timer) clearInterval(timer);
    },
  });
}
