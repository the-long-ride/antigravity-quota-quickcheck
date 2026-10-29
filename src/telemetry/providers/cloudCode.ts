import { CreditInfo, FullStatus, QuotaData } from '../types';
import { extractPlanTier } from '../parser';
import {
  AgyCredential,
  OauthClient,
  loadAgyCredential,
  readOauthClientsFromAgy,
} from './credentials';
import { HttpStatusError, requestJson } from './http';
import { ProviderError, isUsableStatus } from './types';

const PROVIDER = 'Cloud Code';
const CLOUD_CODE_BASE = 'https://cloudcode-pa.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MISSING_COOLDOWN_MS = 60_000;
const TRANSIENT_COOLDOWN_MS = 20_000;
const PLAN_TIER_CACHE_MS = 10 * 60_000;

interface PoolValue {
  percent: number;
  reset: string;
  present: boolean;
}

interface ProviderPool {
  generic: PoolValue;
  fiveHour: PoolValue;
  weekly: PoolValue;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string | null;
}

let missingUntil = 0;
let transientUntil = 0;
let workingClient: OauthClient | null = null;
let rotatedRefreshToken: string | null = null;
let planTierCache: { value: string; expiresAt: number } | null = null;

function emptyPoolValue(): PoolValue {
  return { percent: 0, reset: '', present: false };
}

function emptyProviderPool(): ProviderPool {
  return {
    generic: emptyPoolValue(),
    fiveHour: emptyPoolValue(),
    weekly: emptyPoolValue(),
  };
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function remainingPercent(value: any): number | null {
  for (const key of ['remainingFraction', 'remaining_fraction']) {
    const number = numberValue(value?.[key]);
    if (number !== null) {
      return Math.round(Math.max(0, Math.min(1, number)) * 100);
    }
  }

  for (const key of [
    'remainingPercent',
    'remaining_percent',
    'percentRemaining',
    'percent_remaining',
  ]) {
    const number = numberValue(value?.[key]);
    if (number !== null) {
      return Math.round(Math.max(0, Math.min(100, number)));
    }
  }

  return null;
}

function resetTime(value: any): string {
  const reset = value?.resetTime ?? value?.reset_time;
  return typeof reset === 'string' ? reset : '';
}

function explicitWindow(value: any): '5h' | 'weekly' | null {
  const raw = value?.window ?? value?.windowName ?? value?.window_name;
  if (typeof raw !== 'string') return null;
  const compact = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (compact === '5h' || compact.includes('5hour') || compact.includes('fivehour')) {
    return '5h';
  }
  if (compact.includes('week') || compact === '7d') {
    return 'weekly';
  }
  return null;
}

function mergePool(slot: PoolValue, percent: number, reset: string): void {
  if (
    !slot.present ||
    percent < slot.percent ||
    (percent === slot.percent && reset && (!slot.reset || reset < slot.reset))
  ) {
    slot.percent = percent;
    slot.reset = reset;
    slot.present = true;
  }
}

function isSharedModel(value: string): boolean {
  return value.includes('claude') || value.includes('gpt') || value.includes('openai');
}

function buildCard(model: string, pool: ProviderPool): QuotaData {
  const generic = pool.generic.present
    ? pool.generic
    : pool.fiveHour.present
      ? pool.fiveHour
      : pool.weekly;

  return {
    model,
    percent: generic.percent,
    refreshTime: generic.reset,
    fiveHourPercent: pool.fiveHour.percent,
    fiveHourReset: pool.fiveHour.reset,
    fiveHourDisabled: !pool.fiveHour.present,
    weeklyPercent: pool.weekly.percent,
    weeklyReset: pool.weekly.reset,
    weeklyDisabled: !pool.weekly.present,
  };
}

function sumAvailableCredits(load: any): CreditInfo | null {
  const credits = load?.paidTier?.availableCredits;
  if (!Array.isArray(credits)) return null;

  let total = 0;
  let found = false;
  for (const credit of credits) {
    const amount = numberValue(credit?.creditAmount ?? credit?.credit_amount);
    if (amount !== null && amount >= 0) {
      total += amount;
      found = true;
    }
  }

  return found ? { balance: total, creditType: 'AI' } : null;
}



function isArgonModel(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('argon') ||
    lower.includes('gemini-4') ||
    lower.includes('gemini_4') ||
    lower.includes('gemini 4')
  );
}

export function parseCloudCodeStatus(
  loadCodeAssist: any,
  userQuota: any,
  availableModels: any,
): FullStatus {
  const planTier =
    extractPlanTier(loadCodeAssist) ||
    extractPlanTier(availableModels) ||
    extractPlanTier(userQuota);
  const credits = sumAvailableCredits(loadCodeAssist);

  const gemini = emptyProviderPool();
  const shared = emptyProviderPool();
  const argon = emptyProviderPool();
  let hasUserArgon = false;

  if (Array.isArray(userQuota?.buckets)) {
    for (const bucket of userQuota.buckets) {
      const model = String(bucket?.modelId ?? bucket?.model_id ?? '').toLowerCase();
      const tokenType = String(bucket?.tokenType ?? bucket?.token_type ?? '').toLowerCase();
      const isArgon = isArgonModel(model);
      const target = isArgon
        ? argon
        : model.includes('gemini') || tokenType === 'requests'
          ? gemini
          : isSharedModel(model)
            ? shared
            : null;
      if (!target) continue;
      if (isArgon) hasUserArgon = true;

      const percent = remainingPercent(bucket);
      if (percent === null) continue;
      const reset = resetTime(bucket);
      mergePool(target.generic, percent, reset);
      const window = explicitWindow(bucket);
      if (window === '5h') mergePool(target.fiveHour, percent, reset);
      if (window === 'weekly' || (isArgon && !window)) mergePool(target.weekly, percent, reset);
    }
  }

  if (availableModels?.models && typeof availableModels.models === 'object') {
    for (const [id, entryValue] of Object.entries(availableModels.models)) {
      const entry: any = entryValue;
      const identity = [id, entry?.model ?? '', entry?.displayName ?? '']
        .join(' ')
        .toLowerCase();
      const isArgon = isArgonModel(identity);
      const target = isArgon
        ? argon
        : identity.includes('gemini')
          ? gemini
          : isSharedModel(identity)
            ? shared
            : null;
      if (!target) continue;

      const quotaInfo = entry?.quotaInfo ?? entry?.quota_info ?? entry;
      const percent = remainingPercent(quotaInfo);
      if (percent === null) continue;
      const reset = resetTime(quotaInfo);
      mergePool(target.generic, percent, reset);
      const window = explicitWindow(quotaInfo);
      if (window === '5h') mergePool(target.fiveHour, percent, reset);
      if (window === 'weekly' || (isArgon && !window)) mergePool(target.weekly, percent, reset);
    }
  }

  if (!argon.weekly.present && argon.generic.present) {
    argon.weekly = { ...argon.generic };
  }

  const argonPresent = argon.generic.present || argon.weekly.present;
  let mergeArgonIntoGemini = false;
  const geminiSigPct = gemini.weekly.present ? gemini.weekly.percent : gemini.generic.percent;
  const geminiSigReset = gemini.weekly.present ? gemini.weekly.reset : gemini.generic.reset;
  const sharesGeminiSignature =
    (gemini.generic.present || gemini.weekly.present) &&
    argon.weekly.percent === geminiSigPct &&
    argon.weekly.reset === geminiSigReset;

  const hasDistinctUserArgon = hasUserArgon && !sharesGeminiSignature;
  if (argonPresent && !hasDistinctUserArgon && sharesGeminiSignature) {
    mergeArgonIntoGemini = true;
  }

  if (mergeArgonIntoGemini) {
    mergePool(gemini.generic, argon.generic.percent, argon.generic.reset);
    mergePool(gemini.weekly, argon.weekly.percent, argon.weekly.reset);
  }

  const hasPoolData = [
    gemini.generic,
    gemini.fiveHour,
    gemini.weekly,
    shared.generic,
    shared.fiveHour,
    shared.weekly,
  ].some((value) => value.present) || argonPresent;

  const quotas: QuotaData[] = [];
  if (hasPoolData) {
    quotas.push(buildCard('Gemini', gemini));
    if (!mergeArgonIntoGemini && argonPresent) {
      quotas.push({
        model: 'Gemini 4 Argon',
        percent: argon.weekly.percent,
        refreshTime: argon.weekly.reset || 'Ready',
        fiveHourPercent: undefined,
        fiveHourReset: undefined,
        fiveHourDisabled: undefined,
        weeklyPercent: argon.weekly.percent,
        weeklyReset: argon.weekly.reset || undefined,
        weeklyDisabled: false,
      });
    }
    quotas.push(buildCard('Claude & OpenAI', shared));
  }

  const status: FullStatus = {
    credits,
    quotas,
    recentlyUsedModel: null,
    planTier,
  };

  if (!isUsableStatus(status)) {
    throw new ProviderError(
      PROVIDER,
      'invalid-data',
      'Cloud Code returned no usable quota, credits, or tier data',
    );
  }

  return status;
}

function platformMetadata(): number {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') return arch === 'arm64' ? 2 : 1;
  if (platform === 'linux') return arch === 'arm64' ? 4 : 3;
  if (platform === 'win32') return 5;
  return 0;
}

function cloudMetadata(): Record<string, unknown> {
  return {
    ideType: 9,
    platform: platformMetadata(),
    pluginType: 2,
  };
}

function classifyTransportError(endpoint: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof HttpStatusError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new ProviderError(PROVIDER, 'auth', `${endpoint} rejected agy credentials`);
    }
    return new ProviderError(
      PROVIDER,
      'transient',
      `${endpoint} returned HTTP ${error.statusCode}`,
    );
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const kind = message.includes('valid json') ? 'invalid-data' : 'transient';
  return new ProviderError(PROVIDER, kind, `${endpoint} request failed`);
}

async function refreshWithClients(
  refreshToken: string,
  clients: OauthClient[],
): Promise<RefreshResult> {
  let sawTransient = false;

  for (const candidate of clients) {
    const form = new URLSearchParams({
      client_id: candidate.clientId,
      client_secret: candidate.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    try {
      const value = await requestJson(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const accessToken = typeof value?.access_token === 'string'
        ? value.access_token
        : '';
      if (!accessToken) continue;

      workingClient = candidate;
      return {
        accessToken,
        refreshToken: typeof value?.refresh_token === 'string' && value.refresh_token
          ? value.refresh_token
          : null,
      };
    } catch (error) {
      if (error instanceof HttpStatusError) {
        if (error.statusCode >= 500 || error.statusCode === 429) {
          sawTransient = true;
        }
        continue;
      }
      sawTransient = true;
    }
  }

  throw new ProviderError(
    PROVIDER,
    sawTransient ? 'transient' : 'auth',
    sawTransient
      ? 'OAuth refresh request failed'
      : 'could not refresh agy OAuth access token',
  );
}

async function refreshAccessToken(
  credential: AgyCredential,
): Promise<string> {
  let candidates: OauthClient[];
  if (workingClient) {
    candidates = [workingClient];
  } else {
    candidates = await readOauthClientsFromAgy();
  }

  const preferredRefreshToken = rotatedRefreshToken ?? credential.refreshToken;
  try {
    const result = await refreshWithClients(preferredRefreshToken, candidates);
    if (result.refreshToken) rotatedRefreshToken = result.refreshToken;
    return result.accessToken;
  } catch (error) {
    if (workingClient) {
      workingClient = null;
      candidates = await readOauthClientsFromAgy();
      const result = await refreshWithClients(credential.refreshToken, candidates);
      if (result.refreshToken) rotatedRefreshToken = result.refreshToken;
      return result.accessToken;
    }
    if (rotatedRefreshToken && preferredRefreshToken !== credential.refreshToken) {
      rotatedRefreshToken = null;
      const result = await refreshWithClients(credential.refreshToken, candidates);
      if (result.refreshToken) rotatedRefreshToken = result.refreshToken;
      return result.accessToken;
    }
    throw error;
  }
}

async function postCloudJson(
  endpoint: string,
  accessToken: string,
  body: unknown,
): Promise<any> {
  const metadata = cloudMetadata();
  try {
    return await requestJson(`${CLOUD_CODE_BASE}/v1internal:${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity-quota-quickcheck-vscode',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': JSON.stringify(metadata),
      },
      body,
    });
  } catch (error) {
    throw classifyTransportError(endpoint, error);
  }
}

function extractProjectId(load: any): string | null {
  const value = load?.cloudaicompanionProject;
  if (typeof value === 'string' && value) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['projectId', 'project_id', 'id', 'name']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}

async function optionalCloudCall(
  endpoint: string,
  accessToken: string,
  body: unknown,
): Promise<any> {
  try {
    return await postCloudJson(endpoint, accessToken, body);
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'auth') throw error;
    return null;
  }
}

export async function fetchCloudCodePlanTier(force: boolean = false): Promise<string | null> {
  const now = Date.now();
  if (!force && planTierCache && now < planTierCache.expiresAt) {
    return planTierCache.value;
  }

  const credential = await loadAgyCredential();
  const accessToken = await refreshAccessToken(credential);
  const load = await postCloudJson('loadCodeAssist', accessToken, {
    metadata: cloudMetadata(),
    mode: 'FULL_ELIGIBILITY_CHECK',
  });
  let planTier = extractPlanTier(load);
  if (!planTier) {
    const project = extractProjectId(load);
    const models = await optionalCloudCall(
      'fetchAvailableModels',
      accessToken,
      project ? { project } : {},
    );
    planTier = extractPlanTier(models);
  }
  if (planTier) {
    planTierCache = {
      value: planTier,
      expiresAt: Date.now() + PLAN_TIER_CACHE_MS,
    };
  }
  return planTier;
}

export async function fetchCloudCode(force: boolean): Promise<FullStatus> {
  const now = Date.now();
  if (now < missingUntil) {
    throw new ProviderError(PROVIDER, 'unavailable', 'agy credentials are temporarily unavailable');
  }
  if (!force && now < transientUntil) {
    throw new ProviderError(PROVIDER, 'transient', 'Cloud Code is cooling down after a transient failure');
  }

  try {
    let credential: AgyCredential;
    try {
      credential = await loadAgyCredential();
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'unavailable' || error.kind === 'unsupported')) {
        missingUntil = Date.now() + MISSING_COOLDOWN_MS;
      }
      throw error;
    }

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(credential);
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'unavailable' || error.kind === 'unsupported')) {
        missingUntil = Date.now() + MISSING_COOLDOWN_MS;
      }
      throw error;
    }

    const metadata = cloudMetadata();
    const [load, quota] = await Promise.all([
      optionalCloudCall('loadCodeAssist', accessToken, {
        metadata,
        mode: 'FULL_ELIGIBILITY_CHECK',
      }),
      optionalCloudCall('retrieveUserQuota', accessToken, {}),
    ]);

    const project = extractProjectId(load);
    const models = await optionalCloudCall(
      'fetchAvailableModels',
      accessToken,
      project ? { project } : {},
    );

    const planTier =
      extractPlanTier(load) ||
      extractPlanTier(models) ||
      extractPlanTier(quota);
    if (planTier) {
      planTierCache = { value: planTier, expiresAt: Date.now() + PLAN_TIER_CACHE_MS };
    }

    return parseCloudCodeStatus(load, quota, models);
  } catch (error) {
    const providerError = error instanceof ProviderError
      ? error
      : new ProviderError(PROVIDER, 'transient', 'Cloud Code provider failed');
    if (providerError.kind === 'transient') {
      transientUntil = Date.now() + TRANSIENT_COOLDOWN_MS;
    }
    throw providerError;
  }
}
