import * as vscode from 'vscode';
import { fetchRealQuota } from './telemetry';

export function activate(context: vscode.ExtensionContext) {
    // Create a new status bar item (Right side, priority 100)
    const myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = 'antigravity-quota.check';
    myStatusBarItem.text = `$(credit-card) Antigravity Quota`;
    myStatusBarItem.tooltip = "Click to view real-time Antigravity quota (~1s fetch period)";

    context.subscriptions.push(myStatusBarItem);
    myStatusBarItem.show();

    // Register a command that is invoked when the status bar item is clicked
    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quota.check', () => {
        showQuotaPopup();
    }));
}

async function showQuotaPopup() {
    try {
        const quotaData = await fetchRealQuota();
        
        if (quotaData.length === 0) {
            vscode.window.showInformationMessage("No models or quota data found.");
            return;
        }

        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'Antigravity Quota Remaining (Live)';
        quickPick.placeholder = 'Current real-time model quotas';
        
        // Format the items to display the columns nicely in a QuickPick
        const items: vscode.QuickPickItem[] = quotaData.map(item => {
            // Create a text-based progress bar (e.g. ████████░░)
            const totalBlocks = 10;
            const filledBlocks = Math.round((item.percent / 100) * totalBlocks);
            const emptyBlocks = totalBlocks - filledBlocks;
            const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

            return {
                label: `$(server-environment) ${item.model}`,
                description: `${progressBar} ${item.percent}%`,
                detail: `$(clock) Refreshes in: ${item.refreshTime}`,
                alwaysShow: true // Ensures items are always visible even if the user types
            };
        });

        quickPick.items = items;
        
        // Hide the popup when the user selects an item
        quickPick.onDidAccept(() => {
            quickPick.hide();
        });

        quickPick.show();
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load Antigravity Quota: ${err.message}`);
    }
}
