import * as vscode from 'vscode';
import { refreshStatusBar } from './ui/statusBar';
import { showQuotaPopup } from './ui/quickPick';
import { buildTooltip } from './ui/tooltip';

// Polling interval for status bar refresh (default 30 seconds)
let pollIntervalMs = 30_000;
let timer: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
    const extensionUri = context.extensionUri;

    // Create the main status bar item (Right side, priority 100)
    const myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = 'antigravity-quota.check';
    myStatusBarItem.text = `$(credit-card) Credits: ...`;
    myStatusBarItem.tooltip = buildTooltip(null, extensionUri);
    myStatusBarItem.show();

    // Create the interval status bar item (Left side, priority 0)
    const intervalStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    intervalStatusBarItem.command = 'antigravity-quota.setInterval';
    intervalStatusBarItem.text = `$(clock) 30s`;
    intervalStatusBarItem.tooltip = 'Change Antigravity Quota Refresh Interval';
    intervalStatusBarItem.show();

    context.subscriptions.push(myStatusBarItem, intervalStatusBarItem);

    // Register the click command — shows the live QuickPick popup
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-quota.check', () => {
            showQuotaPopup(extensionUri);
        })
    );

    // Register the interval change command
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-quota.setInterval', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter polling interval in seconds (e.g. 10, 30, 60)',
                value: (pollIntervalMs / 1000).toString(),
                validateInput: text => {
                    const val = Number(text);
                    if (isNaN(val) || val < 1) {
                        return 'Please enter a valid number of seconds (minimum 1).';
                    }
                    return null;
                }
            });

            if (input !== undefined) {
                const newSeconds = Number(input);
                pollIntervalMs = newSeconds * 1000;
                intervalStatusBarItem.text = `$(clock) ${newSeconds}s`;

                // Restart timer
                if (timer) clearInterval(timer);
                timer = setInterval(() => refreshStatusBar(myStatusBarItem, extensionUri), pollIntervalMs);
                
                vscode.window.showInformationMessage(`Antigravity Quota refresh interval set to ${newSeconds} seconds.`);
            }
        })
    );

    // Initial fetch + start polling
    refreshStatusBar(myStatusBarItem, extensionUri);
    timer = setInterval(() => refreshStatusBar(myStatusBarItem, extensionUri), pollIntervalMs);

    context.subscriptions.push({ dispose: () => { if (timer) clearInterval(timer); } });
}
