import * as vscode from 'vscode';
import { fetchFullStatus, FullStatus } from './telemetry';

// Polling interval for status bar refresh (30 seconds)
const POLL_INTERVAL_MS = 30_000;

let extensionUri: vscode.Uri;

export function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    // Create a new status bar item (Right side, priority 100)
    const myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = 'antigravity-quota.check';
    myStatusBarItem.text = `$(credit-card) Credits: ...`;
    myStatusBarItem.tooltip = buildTooltip(null);
    myStatusBarItem.show();

    context.subscriptions.push(myStatusBarItem);

    // Register the click command — shows the live QuickPick popup
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-quota.check', () => {
            showQuotaPopup();
        })
    );

    // Initial fetch + start polling
    refreshStatusBar(myStatusBarItem);
    const timer = setInterval(() => refreshStatusBar(myStatusBarItem), POLL_INTERVAL_MS);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

// ---------------------------------------------------------------------------
// Status bar refresh
// ---------------------------------------------------------------------------

async function refreshStatusBar(item: vscode.StatusBarItem): Promise<void> {
    try {
        const status = await fetchFullStatus();
        const creditBalance = status.credits?.balance ?? null;
        const activeModel = status.activeModel ?? 'Model';

        // Find quota for the active model
        const activeQuota = status.quotas.find(q => q.model === activeModel);
        const activePercent = activeQuota?.percent ?? null;

        // Status bar text:  $(credit-card) Credits: 1,000 | Gemini 3 Flash: 100%
        const creditText = creditBalance !== null ? formatNumber(creditBalance) : '—';
        const quotaText = activePercent !== null ? `${activePercent}%` : '—';
        item.text = `$(credit-card) Credits: ${creditText}${activeQuota ? ` | ${activeModel}: ${quotaText}` : ''}`;

        // Rich tooltip (MarkdownString for hover panel)
        item.tooltip = buildTooltip(status);
    } catch {
        // Keep last good value; just update the tooltip with a note
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.appendMarkdown('**Your Google AI Usage**\n\n');
        md.appendMarkdown('⚠️ *Language server not reachable.*\n\n');
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('$(info) Click to retry fetching real-time quota.');
        item.tooltip = md;
    }
}

// ---------------------------------------------------------------------------
// Tooltip builder
// ---------------------------------------------------------------------------

function buildTooltip(status: FullStatus | null): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    if (!status) {
        md.appendMarkdown('**Your Google AI Usage**\n\n');
        md.appendMarkdown('*Loading...*\n\n');
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('$(info) *Click to view real-time Antigravity Quota (~1s period)*');
        return md;
    }

    // Header
    md.appendMarkdown('### Your Google AI Usage\n\n');

    // Remaining Google AI Credits balance
    const balance = status.credits?.balance ?? null;
    const creditLine = balance !== null
        ? `**Remaining Google AI Credits:** **\`${formatNumber(balance)}\`** *(per subscription)*`
        : '**Remaining Google AI Credits:** *unavailable*';
    md.appendMarkdown(`${creditLine}\n\n`);

    // Per-model quota table
    if (status.quotas.length > 0) {
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('**Quota per available model:** *(per account)*\n\n');
        md.appendMarkdown('| Model | Remaining | Resets in |\n');
        md.appendMarkdown('|---|---|---|\n');

        for (const q of [...status.quotas].sort((a, b) => b.percent - a.percent)) {
            const bar = buildBar(q.percent);
            const iconUri = getQuotaIconUri(q.percent);
            md.appendMarkdown(`| ![](${iconUri.toString()})  ${q.model} | ${bar} ${q.percent}% | ${q.refreshTime} |\n`);
        }

        md.appendMarkdown('\n');
    }

    // Hint footer
    md.appendMarkdown('---\n\n');
    md.appendMarkdown('$(info) *Click to view all quotas (real-time ~1s period)*');

    return md;
}

// ---------------------------------------------------------------------------
// QuickPick popup (on click)
// ---------------------------------------------------------------------------

async function showQuotaPopup(): Promise<void> {
    try {
        const status = await fetchFullStatus();
        const quotaData = status.quotas;

        if (quotaData.length === 0) {
            vscode.window.showInformationMessage("No models or quota data found.");
            return;
        }

        const creditBalance = status.credits?.balance ?? null;
        const creditLabel = creditBalance !== null
            ? `$(credit-card)  Remaining Google AI Credits: ${formatNumber(creditBalance)}`
            : `$(credit-card)  Remaining Google AI Credits: unavailable`;

        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'Antigravity Quota — Live';
        quickPick.placeholder = 'Real-time model quotas';

        const separator: vscode.QuickPickItem = { label: '', kind: vscode.QuickPickItemKind.Separator };

        const creditItem: vscode.QuickPickItem = {
            label: creditLabel,
            alwaysShow: true
        };

        const modelItems: vscode.QuickPickItem[] = quotaData
            .sort((a, b) => b.percent - a.percent)
            .map(item => {
                const totalBlocks = 10;
                const filledBlocks = Math.round((item.percent / 100) * totalBlocks);
                const emptyBlocks = totalBlocks - filledBlocks;
                const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
                const iconUri = getQuotaIconUri(item.percent);

                return {
                    label: ` ${item.model}`,
                    description: `${progressBar} ${item.percent}%`,
                    detail: `$(clock)  Resets in: ${item.refreshTime}`,
                    iconPath: iconUri,
                    alwaysShow: true
                };
            });

        quickPick.items = [creditItem, separator, ...modelItems];

        quickPick.onDidAccept(() => quickPick.hide());
        quickPick.show();
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load Antigravity Quota: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBar(percent: number): string {
    const total = 8;
    const filled = Math.round((percent / 100) * total);
    return '█'.repeat(filled) + '░'.repeat(total - filled);
}

function getQuotaIconUri(percent: number): vscode.Uri {
    let iconName: string;

    if (percent > 60) {
        iconName = 'battery-charge-level-100-percent-black-icon.svg';
    } else if (percent > 40) {
        iconName = 'battery-charge-level-75-percent-black-icon.svg';
    } else if (percent > 20) {
        iconName = 'battery-charge-level-50-percent-black-icon.svg';
    } else if (percent > 0) {
        iconName = 'battery-charge-level-25-percent-black-icon.svg';
    } else {
        iconName = 'battery-slash-icon.svg';
    }

    return vscode.Uri.joinPath(extensionUri, 'assets', 'icons', 'quota-icons', iconName);
}

function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}
