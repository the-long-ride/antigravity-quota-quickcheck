import { CreditInfo, FullStatus, QuotaData } from './types';

export function parseFullStatus(raw: any): FullStatus {
    // --- Credits ---
    let credits: CreditInfo | null = null;
    const creditInfoRaw = raw?.userStatus?.userInfo?.creditInfo;
    const altCreditInfoRaw = raw?.userStatus?.userTier?.availableCredits?.[0] ?? null;
    const src = creditInfoRaw ?? altCreditInfoRaw;

    if (src) {
        const balance = Number(src.currentBalance ?? src.balance ?? src.creditAmount ?? 0);
        const creditType: string = src.creditType ?? src.type ?? 'UNKNOWN';
        credits = { balance, creditType };
    }

    // --- Active model (first non-exhausted model, or first model overall) ---
    const configs = raw?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
    let activeModel: string | null = null;
    if (configs.length > 0) {
        // Prefer the model with the highest remaining fraction
        const sorted = [...configs].sort((a: any, b: any) => {
            const fa = a.quotaInfo?.remainingFraction ?? 0;
            const fb = b.quotaInfo?.remainingFraction ?? 0;
            return fb - fa;
        });
        activeModel = sorted[0]?.label ?? null;
    }

    // --- Quotas ---
    const quotas = parseQuotaData(configs);

    return { credits, quotas, activeModel };
}

export function parseQuotaData(configs: any[]): QuotaData[] {
    const results: QuotaData[] = [];

    for (const config of configs) {
        if (!config.label) continue;

        let percent = 0;
        let refreshTime = 'Exhausted';

        if (config.quotaInfo) {
            const fraction = config.quotaInfo.remainingFraction;
            if (typeof fraction === 'number') {
                percent = Math.max(0, Math.min(1, fraction)) * 100;
            }
            if (config.quotaInfo.resetTime) {
                refreshTime = getRelativeTime(config.quotaInfo.resetTime);
            }
        }

        results.push({
            model: config.label,
            percent: Math.round(percent),
            refreshTime
        });
    }

    // Sort descending (highest percent first)
    return results.sort((a, b) => b.percent - a.percent);
}

function getRelativeTime(isoDate: string): string {
    const future = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = future - now;

    if (diffMs <= 0) return 'Ready';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `${minutes} minutes`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return `${hours} hr, ${remainingMinutes} min`;

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days} day${days > 1 ? 's' : ''}, ${remainingHours} hr`;
}
