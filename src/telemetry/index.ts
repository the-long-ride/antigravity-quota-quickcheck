import { FullStatus, QuotaData, ModelUsageEvent } from './types';
import { locateAntigravityBeacon, detectActivePort } from './process';
import { queryServer } from './client';
import { parseFullStatus } from './parser';

export * from './types';

let cachedPid: number | null = null;
let cachedToken: string | null = null;
let cachedPort: number | null = null;

let cachedStatus: FullStatus | null = null;

// Array to hold our rolling log of usage events
let usageHistory: ModelUsageEvent[] = [];
let FIVE_MINUTES_MS = 5 * 60 * 1000; // default 5 minutes

export function setUsageWindowMs(ms: number) {
    FIVE_MINUTES_MS = ms;
    pruneOldData(); // Prune immediately with new window
}

export function getUsageWindowMs(): number {
    return FIVE_MINUTES_MS;
}

// Prune data older than 5 minutes
function pruneOldData() {
    const cutoffTime = Date.now() - FIVE_MINUTES_MS;
    usageHistory = usageHistory.filter(event => event.timestamp > cutoffTime);
}

// Auto-prune memory every minute
setInterval(pruneOldData, 60 * 1000);

export async function fetchFullStatus(force: boolean = false): Promise<FullStatus> {


    let rawData: any;

    // Path A: Try cached connection
    if (cachedPid && cachedToken && cachedPort) {
        try {
            rawData = await queryServer(cachedPort, cachedToken);
        } catch {
            cachedPid = null;
            cachedToken = null;
            cachedPort = null;
        }
    }

    // Path B: Locate and query server if Path A failed
    if (!rawData) {
        const processData = await locateAntigravityBeacon();
        if (!processData) throw new Error("Could not locate Antigravity process.");

        const { pid, token } = processData;
        const port = await detectActivePort(pid);
        if (!port) throw new Error("Could not detect Antigravity port.");

        cachedPid = pid;
        cachedToken = token;
        cachedPort = port;

        rawData = await queryServer(port, token);
        if (!rawData) throw new Error("Failed to fetch data from Antigravity server.");
    }

    const newStatus = parseFullStatus(rawData);
    updateRecentlyUsedModelWithHistory(newStatus);

    cachedStatus = newStatus;
    return newStatus;
}

function updateRecentlyUsedModelWithHistory(newStatus: FullStatus) {
    // 1. Detect usage (quota decrease)
    if (cachedStatus) {
        newStatus.quotas.forEach(newQ => {
            const oldQ = cachedStatus!.quotas.find(q => q.model === newQ.model);
            if (oldQ && newQ.percent < oldQ.percent) {
                // Record the drop as a usage "event"
                const drop = oldQ.percent - newQ.percent;
                usageHistory.push({
                    modelId: newQ.model,
                    timestamp: Date.now(),
                    score: drop
                });
            }
        });
    }

    // 2. Prune old data before calculation
    pruneOldData();

    // 3. Calculate hardest working model (highest total drop score)
    let hardestWorkingModel: string | null = null;
    if (usageHistory.length > 0) {
        const modelScores = new Map<string, number>();
        for (const event of usageHistory) {
            modelScores.set(event.modelId, (modelScores.get(event.modelId) || 0) + event.score);
        }

        let highestScore = -1;
        for (const [modelId, score] of modelScores.entries()) {
            if (score > highestScore) {
                highestScore = score;
                hardestWorkingModel = modelId;
            }
        }
    }

    // 4. Override recentlyUsedModel
    if (hardestWorkingModel) {
        newStatus.recentlyUsedModel = hardestWorkingModel;
    } else if (newStatus.quotas.length > 0) {
        // Fallback to highest quota model if no recent activity
        newStatus.recentlyUsedModel = newStatus.quotas[0].model;
    }
}

