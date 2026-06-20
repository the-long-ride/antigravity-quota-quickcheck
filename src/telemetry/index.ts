import { FullStatus, QuotaData } from "./types";
import { locateAntigravityBeacon, detectActivePort } from "./process";
import { queryServer } from "./client";
import { parseFullStatus } from "./parser";

export * from "./types";

let cachedPid: number | null = null;
let cachedToken: string | null = null;
let cachedPort: number | null = null;

let cachedStatus: FullStatus | null = null;

export async function fetchFullStatus(
  force: boolean = false,
): Promise<FullStatus> {
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
    if (!rawData)
      throw new Error("Failed to fetch data from Antigravity server.");
  }

  const newStatus = parseFullStatus(rawData);

  // Fallback to highest quota model if none is set
  if (newStatus.quotas.length > 0) {
    newStatus.recentlyUsedModel = newStatus.quotas[0].model;
  }

  cachedStatus = newStatus;
  return newStatus;
}

