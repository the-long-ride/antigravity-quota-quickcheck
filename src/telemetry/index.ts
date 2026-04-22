import { FullStatus, QuotaData } from './types';
import { locateAntigravityBeacon, detectActivePort } from './process';
import { queryServer } from './client';
import { parseFullStatus } from './parser';

export * from './types';

let cachedPid: number | null = null;
let cachedToken: string | null = null;
let cachedPort: number | null = null;

let cachedStatus: FullStatus | null = null;

// Track the last time each model's quota decreased
const modelUsageHistory = new Map<string, number>();
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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
    updateActiveModelWithHistory(newStatus);

    cachedStatus = newStatus;
    return newStatus;
}

function updateActiveModelWithHistory(newStatus: FullStatus) {
    // 1. Detect usage (quota decrease)
    if (cachedStatus) {
        newStatus.quotas.forEach(newQ => {
            const oldQ = cachedStatus!.quotas.find(q => q.model === newQ.model);
            if (oldQ && newQ.percent < oldQ.percent) {
                modelUsageHistory.set(newQ.model, Date.now());
            }
        });
    }

    // 2. Find most recent within 5-minute window
    let recentlyUsedModel: string | null = null;
    let maxTime = 0;
    const now = Date.now();
    for (const [model, time] of modelUsageHistory.entries()) {
        if (now - time < ACTIVE_WINDOW_MS) {
            if (time > maxTime) {
                maxTime = time;
                recentlyUsedModel = model;
            }
        } else {
            modelUsageHistory.delete(model);
        }
    }

    // 3. Override activeModel if usage detected
    if (recentlyUsedModel) {
        newStatus.activeModel = recentlyUsedModel;
    } else if (newStatus.quotas.length > 0) {
        newStatus.activeModel = newStatus.quotas[0].model;
    }
}

