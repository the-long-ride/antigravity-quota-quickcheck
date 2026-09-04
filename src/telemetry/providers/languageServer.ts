import { FullStatus } from '../types';
import { locateAntigravityBeacon, detectActivePort } from '../process';
import { queryServer } from '../client';
import { parseFullStatus } from '../parser';
import { ProviderError } from './types';

const PROVIDER = 'language server';
const GET_USER_STATUS = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const GET_QUOTA_SUMMARY = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

let cachedPid: number | null = null;
let cachedToken: string | null = null;
let cachedPort: number | null = null;

async function queryStatus(port: number, token: string): Promise<[any, any]> {
  const rawData = await queryServer(port, token, GET_USER_STATUS);
  const rawQuotaSummary = await queryServer(port, token, GET_QUOTA_SUMMARY)
    .catch(() => null);
  return [rawData, rawQuotaSummary];
}

export async function fetchLanguageServer(_force: boolean): Promise<FullStatus> {
  let rawData: any = null;
  let rawQuotaSummary: any = null;

  if (cachedPid && cachedToken && cachedPort) {
    try {
      [rawData, rawQuotaSummary] = await queryStatus(cachedPort, cachedToken);
    } catch {
      cachedPid = null;
      cachedToken = null;
      cachedPort = null;
    }
  }

  if (!rawData) {
    const processData = await locateAntigravityBeacon();
    if (!processData) {
      throw new ProviderError(
        PROVIDER,
        'unavailable',
        'Antigravity language server process was not found',
      );
    }

    const { pid, token } = processData;
    const port = await detectActivePort(pid);
    if (!port) {
      throw new ProviderError(
        PROVIDER,
        'unavailable',
        'Antigravity language server listening port was not found',
      );
    }

    try {
      [rawData, rawQuotaSummary] = await queryStatus(port, token);
    } catch {
      throw new ProviderError(
        PROVIDER,
        'transient',
        'Antigravity language server request failed',
      );
    }

    cachedPid = pid;
    cachedToken = token;
    cachedPort = port;
  }

  const status = parseFullStatus(rawData, rawQuotaSummary);
  if (status.quotas.length > 0) {
    status.recentlyUsedModel = status.quotas[0].model;
  }
  return status;
}
