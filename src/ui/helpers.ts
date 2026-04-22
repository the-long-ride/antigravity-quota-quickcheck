import * as vscode from 'vscode';

export function buildBar(percent: number, total: number = 8): string {
    const filled = Math.round((percent / 100) * total);
    return '█'.repeat(filled).padEnd(total, '░');
}

export function getQuotaIconUri(percent: number, extensionUri: vscode.Uri): vscode.Uri {
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

export function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}
