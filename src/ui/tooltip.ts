import * as vscode from 'vscode';
import { FullStatus } from '../telemetry';
import { buildBar, getQuotaIconUri, formatNumber } from './helpers';

export function buildTooltip(status: FullStatus | null, extensionUri: vscode.Uri): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    if (!status) {
        md.appendMarkdown('**Your Google AI Usage**\n\n');
        md.appendMarkdown('*Loading...*\n\n');
        md.appendMarkdown('---\n\n');
        const settingsBtn = '[$(gear) Set Interval](command:antigravity-quota.setInterval "Change refresh rate")';
        const quotaHint = '$(info) *Click to view real-time quotas*';
        md.appendMarkdown(`${settingsBtn} ${quotaHint}`);
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

        for (const q of status.quotas) {
            const bar = buildBar(q.percent, 8);
            const iconUri = getQuotaIconUri(q.percent, extensionUri);
            md.appendMarkdown(`| ![](${iconUri.toString()})  ${q.model} | ${bar} ${q.percent}% | ${q.refreshTime} |\n`);
        }

        md.appendMarkdown('\n');
    }

    // Hint footer
    md.appendMarkdown('---\n\n');
    const settingsBtn = '[$(gear) Set Interval](command:antigravity-quota.setInterval "Change refresh rate")';
    const quotaHint = '$(info) *Click to view real-time quotas*';
    md.appendMarkdown(`${settingsBtn} ${quotaHint}`);

    return md;
}
