import * as vscode from "vscode";
import { refreshStatusBar, updateStatusBarSync } from "./ui/statusBar";
import { showQuotaPopup } from "./ui/quickPick";

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
  updateStatusBarSync(myStatusBarItem, extensionUri);
  myStatusBarItem.show();

  context.subscriptions.push(myStatusBarItem);

  // Register the click command — opens the live QuickPick popup IMMEDIATELY without awaiting network
  context.subscriptions.push(
    vscode.commands.registerCommand("antigravity-quota.check", () => {
      showQuotaPopup(extensionUri, myStatusBarItem);
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

  // Register toggle usage command — instant UI response
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antigravity-quota.toggleUsage",
      () => {
        const config = vscode.workspace.getConfiguration("antigravity-quota");
        const current = config.get<boolean>("showUsageInStatusBar", true);
        const next = !current;

        // Immediately update status bar & tooltip in memory without waiting
        updateStatusBarSync(myStatusBarItem, extensionUri, { showUsage: next });

        // Persist to configuration in background
        config.update(
          "showUsageInStatusBar",
          next,
          vscode.ConfigurationTarget.Global,
        );
      },
    ),
  );

  // Register toggle credits command — instant UI response
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antigravity-quota.toggleCredits",
      () => {
        const config = vscode.workspace.getConfiguration("antigravity-quota");
        const current = config.get<boolean>("showCreditsInStatusBar", true);
        const next = !current;

        // Immediately update status bar & tooltip in memory without waiting
        updateStatusBarSync(myStatusBarItem, extensionUri, { showCredits: next });

        // Persist to configuration in background
        config.update(
          "showCreditsInStatusBar",
          next,
          vscode.ConfigurationTarget.Global,
        );
      },
    ),
  );

  // Listen for configuration changes — update synchronously from cache without network fetch
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("antigravity-quota.showUsageInStatusBar") ||
        e.affectsConfiguration("antigravity-quota.showCreditsInStatusBar") ||
        e.affectsConfiguration("antigravity-quota.monitoredModel")
      ) {
        updateStatusBarSync(myStatusBarItem, extensionUri);
      }
    }),
  );

  // Initial fetch + start polling in background
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
