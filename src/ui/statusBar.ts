import * as vscode from 'vscode';
import { fetchFullStatus } from '../telemetry';
import { buildTooltip } from './tooltip';
import { formatNumber } from './helpers';

export async function refreshStatusBar(item: vscode.StatusBarItem, extensionUri: vscode.Uri, force: boolean = false): Promise<void> {
    try {
        const status = await fetchFullStatus(force);
        const creditBalance = status.credits?.balance ?? null;
        const activeModel = status.activeModel ?? 'Model';

        // Find quota for the active model
        const activeQuota = status.quotas.find(q => q.model === activeModel);
        const activePercent = activeQuota?.percent ?? null;

        const showUsage = vscode.workspace.getConfiguration('antigravity-quota').get<boolean>('showUsageInStatusBar', true);

        if (!showUsage) {
            item.text = `$(credit-card) Quotas`;
        } else {
            // Status bar text:  $(credit-card) Credits: 1,000 | Gemini 3 Flash: 100%
            const creditText = creditBalance !== null ? formatNumber(creditBalance) : '—';
            const quotaText = activePercent !== null ? `${activePercent}%` : '—';
            item.text = `$(credit-card) Credits: ${creditText}${activeQuota ? ` | ${activeModel}: ${quotaText}` : ''}`;
        }

        // Rich tooltip (MarkdownString for hover panel)
        item.tooltip = buildTooltip(status, extensionUri);
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
