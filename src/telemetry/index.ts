import { FullStatus, QuotaData } from './types';
import { locateAntigravityBeacon, detectActivePort } from './process';
import { queryServer } from './client';
import { parseFullStatus } from './parser';

export * from './types';

let cachedPid: number | null = null;
let cachedToken: string | null = null;
let cachedPort: number | null = null;

export async function fetchFullStatus(): Promise<FullStatus> {
    // Try cached connection first to avoid expensive OS shell commands
    if (cachedPid && cachedToken && cachedPort) {
        try {
            const rawData = await queryServer(cachedPort, cachedToken);
            if (rawData) return parseFullStatus(rawData);
        } catch {
            // Connection failed: process might have restarted. Clear cache and fallback to search.
            cachedPid = null;
            cachedToken = null;
            cachedPort = null;
        }
    }

    const processData = await locateAntigravityBeacon();
    if (!processData) {
        throw new Error("Could not locate Antigravity language server process.");
    }

    const { pid, token } = processData;
    const port = await detectActivePort(pid);
    if (!port) {
        throw new Error("Could not detect Antigravity local port.");
    }

    cachedPid = pid;
    cachedToken = token;
    cachedPort = port;

    const rawData = await queryServer(port, token);
    if (!rawData) {
        throw new Error("Failed to fetch data from Antigravity server.");
    }

    return parseFullStatus(rawData);
}

/** @deprecated Use fetchFullStatus() instead */
export async function fetchRealQuota(): Promise<QuotaData[]> {
    const status = await fetchFullStatus();
    return status.quotas;
}
