import { CreditInfo, FullStatus, QuotaData } from "./types";

export function parseFullStatus(raw: any, quotaSummary?: any): FullStatus {
  let credits: CreditInfo | null = null;
  const creditInfoRaw = raw?.userStatus?.userInfo?.creditInfo;
  const altCreditInfoRaw =
    raw?.userStatus?.userTier?.availableCredits?.[0] ?? null;
  const src = creditInfoRaw ?? altCreditInfoRaw;

  if (src) {
    const balance = Number(
      src.currentBalance ?? src.balance ?? src.creditAmount ?? 0,
    );
    const creditType: string = src.creditType ?? src.type ?? "UNKNOWN";
    credits = { balance, creditType };
  }

  const configs = raw?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
  let recentlyUsedModel: string | null = null;
  const quotas = parseQuotaData(configs, quotaSummary);
  const planTier = extractPlanTier(raw) || extractPlanTier(quotaSummary);

  return { credits, quotas, recentlyUsedModel, planTier };
}


export function normalizePlanTier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  switch (lower) {
    case 'free-tier':
    case 'free':
    case 'free tier':
      return 'Free';
    case 'standard-tier':
    case 'standard':
    case 'standard tier':
    case 'paid':
    case 'paid-tier':
    case 'paid tier':
      return 'Paid';
    case 'legacy-tier':
    case 'legacy':
    case 'legacy tier':
      return 'Legacy';
    case 'advanced-tier':
    case 'advanced':
    case 'advanced tier':
    case 'google_ai_pro':
    case 'google-ai-pro':
    case 'google ai pro':
    case 'ai-pro':
    case 'ai pro':
    case 'g1-pro-tier':
    case 'g1-pro':
    case 'pro-tier':
    case 'pro':
      return 'Google AI Pro';
    case 'ultra-tier':
    case 'ultra':
    case 'ultra tier':
    case 'google_ai_ultra':
    case 'google-ai-ultra':
    case 'google ai ultra':
    case 'ai-ultra':
    case 'ai ultra':
    case 'g1-ultra-tier':
    case 'g1-ultra':
      return 'Google AI Ultra';
    default:
      return trimmed;
  }
}

export function extractPlanTier(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidates = [
    raw?.planInfo?.planType,
    raw?.userStatus?.planInfo?.planType,
    raw?.paidTier?.name,
    raw?.userStatus?.paidTier?.name,
    raw?.paidTier?.id,
    raw?.userStatus?.paidTier?.id,
    typeof raw?.paidTier === 'string' ? raw.paidTier : undefined,
    typeof raw?.userStatus?.paidTier === 'string' ? raw.userStatus.paidTier : undefined,
    raw?.currentTier?.name,
    raw?.userStatus?.currentTier?.name,
    raw?.currentTier?.id,
    raw?.userStatus?.currentTier?.id,
    typeof raw?.currentTier === 'string' ? raw.currentTier : undefined,
    typeof raw?.userStatus?.currentTier === 'string' ? raw.userStatus.currentTier : undefined,
    raw?.userTier?.name,
    raw?.userStatus?.userTier?.name,
    raw?.userTier?.id,
    raw?.userStatus?.userTier?.id,
    typeof raw?.userTier === 'string' ? raw.userTier : undefined,
    typeof raw?.userStatus?.userTier === 'string' ? raw.userStatus.userTier : undefined,
    raw?.response?.planInfo?.planType,
    raw?.response?.paidTier?.name,
    raw?.response?.paidTier?.id,
    raw?.response?.currentTier?.name,
    raw?.response?.currentTier?.id,
    raw?.response?.userTier?.name,
    raw?.response?.userTier?.id,
    raw?.response?.planTier,
    raw?.response?.plan_tier,
    raw?.response?.tier,
    raw?.data?.planTier,
    raw?.data?.plan_tier,
    raw?.data?.planInfo?.planType,
    raw?.data?.paidTier?.name,
    raw?.data?.paidTier?.id,
    raw?.data?.currentTier?.name,
    raw?.data?.currentTier?.id,
    raw?.data?.tier,
    raw?.planTier,
    raw?.plan_tier,
    raw?.tier,
    raw?.subscription?.tier,
    raw?.subscription?.plan,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed || trimmed.toLowerCase() === 'antigravity') {
        continue;
      }
      const normalized = normalizePlanTier(trimmed);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

export function isArgonPoolModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return (
    lower.includes("argon") ||
    lower.includes("gemini-4") ||
    lower.includes("gemini_4") ||
    lower.includes("gemini 4")
  );
}

export function resolveQuotaModelName(modelName: string | null | undefined): string | null {
  if (!modelName) return null;
  if (isArgonPoolModel(modelName)) return "Gemini 4 Argon";
  const lower = modelName.toLowerCase();
  if (lower.includes("gemini")) return "Gemini";
  if (
    lower.includes("claude") ||
    lower.includes("gpt") ||
    lower.includes("openai") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("o4")
  ) {
    return "Claude & OpenAI";
  }
  return modelName;
}

export type PoolKey = "gemini" | "claude_gpt" | "argon";

export interface LaneState {
  percent?: number;
  reset?: string;
  contributors: number;
  allDisabled: boolean;
}

export interface PoolState {
  seen: boolean;
  fiveHour: LaneState;
  weekly: LaneState;
}

export const createLane = (): LaneState => ({ contributors: 0, allDisabled: true });
export const createPool = (): PoolState => ({
  seen: false,
  fiveHour: createLane(),
  weekly: createLane(),
});

export function classifyPool(item: any): PoolKey | null {
  if (!item) return null;
  const text = (
    typeof item === "string"
      ? item
      : typeof item.model === "string"
        ? item.model
        : `${item.label ?? ""} ${item.modelId ?? ""} ${item.displayName ?? ""} ${item.description ?? ""} ${item.family ?? ""}`
  ).toLowerCase();

  if (isArgonPoolModel(text) || (typeof item === "object" && item.family === "argon")) {
    return "argon";
  }
  if (text.includes("gemini") || text.includes("imagen")) {
    return "gemini";
  }
  if (
    text.includes("claude") ||
    text.includes("gpt") ||
    text.includes("openai") ||
    text.includes("o1") ||
    text.includes("o3") ||
    text.includes("o4") ||
    (typeof item === "object" && (item.family === "claude" || item.family === "open_ai"))
  ) {
    return "claude_gpt";
  }
  return null;
}

export function isEarlierReset(candidate?: string | null, existing?: string): boolean {
  if (!candidate) return false;
  if (!existing) return true;
  const candidateTime = Date.parse(candidate);
  const existingTime = Date.parse(existing);
  if (Number.isFinite(candidateTime) && Number.isFinite(existingTime)) {
    return candidateTime < existingTime;
  }
  return candidate < existing;
}

export function considerLane(
  lane: LaneState,
  percent: number | null | undefined,
  reset: string | null | undefined,
  disabled: boolean | null | undefined,
): void {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return;
  const normalized = Math.min(100, Math.max(0, Math.round(percent)));
  lane.contributors += 1;
  lane.allDisabled =
    lane.contributors === 1 ? disabled === true : lane.allDisabled && disabled === true;

  const shouldReplace =
    lane.percent === undefined ||
    normalized < lane.percent ||
    (normalized === lane.percent && isEarlierReset(reset, lane.reset));
  if (shouldReplace) {
    lane.percent = normalized;
    lane.reset = reset || undefined;
  }
}

export function isBackendPool(quota: any): boolean {
  if (typeof quota !== "object" || !quota) return false;
  if ("model" in quota) return true;
  if (quota.isBackendPool === true) return true;
  const id = (quota.modelId ?? "").toLowerCase();
  return id.endsWith("_pool");
}

export function rawQuotaSignature(quota: any): string {
  const pct =
    quota.fiveHourPercent ??
    quota.weeklyPercent ??
    quota.remainingPercent ??
    quota.percent;
  const reset =
    quota.fiveHourReset ??
    quota.weeklyReset ??
    quota.resetAt ??
    quota.refreshTime ??
    "";
  return `${pct ?? "null"}|${reset}`;
}

export function toQuotaData(key: PoolKey, pool: PoolState): QuotaData {
  const model =
    key === "gemini"
      ? "Gemini"
      : key === "claude_gpt"
        ? "Claude & OpenAI"
        : "Gemini 4 Argon";

  const fallbackPercent = pool.fiveHour.percent ?? pool.weekly.percent ?? 0;
  const refreshTime =
    key === "argon"
      ? pool.weekly.allDisabled && pool.weekly.contributors > 0
        ? "Disabled"
        : pool.weekly.reset || "Ready"
      : pool.fiveHour.allDisabled && pool.fiveHour.contributors > 0
        ? "Disabled"
        : pool.fiveHour.reset || "Ready";

  return {
    model,
    percent: fallbackPercent,
    refreshTime,
    fiveHourPercent: key === "argon" ? undefined : pool.fiveHour.percent,
    fiveHourReset: key === "argon" ? undefined : pool.fiveHour.reset,
    fiveHourDisabled:
      key !== "argon" && pool.fiveHour.contributors > 0 ? pool.fiveHour.allDisabled : undefined,
    weeklyPercent: pool.weekly.percent,
    weeklyReset: pool.weekly.reset,
    weeklyDisabled: pool.weekly.contributors > 0 ? pool.weekly.allDisabled : undefined,
  };
}

export function aggregateQuotasIntoPools(quotas: readonly any[]): QuotaData[] {
  const pools: Record<PoolKey, PoolState> = {
    gemini: createPool(),
    claude_gpt: createPool(),
    argon: createPool(),
  };

  const hasDedicatedArgonPool = quotas.some(
    (q) => classifyPool(q) === "argon" && (isBackendPool(q) || q.weeklyPercent !== undefined),
  );
  const geminiSignatures = new Set(
    quotas.filter((q) => classifyPool(q) === "gemini").map(rawQuotaSignature),
  );
  const rawArgonQuotas = quotas.filter((q) => classifyPool(q) === "argon");
  const mergeArgonIntoGemini =
    !hasDedicatedArgonPool &&
    rawArgonQuotas.length > 0 &&
    geminiSignatures.size > 0 &&
    rawArgonQuotas.every((q) => geminiSignatures.has(rawQuotaSignature(q)));

  for (const quota of quotas) {
    const rawKey = classifyPool(quota);
    if (!rawKey) continue;
    const key: PoolKey = rawKey === "argon" && mergeArgonIntoGemini ? "gemini" : rawKey;
    const pool = pools[key];
    pool.seen = true;

    const pooled = isBackendPool(quota);
    if (key === "argon") {
      const weeklyPercent =
        quota.weeklyPercent ??
        (!pooled && "remainingPercent" in quota ? quota.remainingPercent : undefined);
      const weeklyReset =
        quota.weeklyReset ?? (!pooled && "resetAt" in quota ? quota.resetAt : undefined);
      considerLane(pool.weekly, weeklyPercent, weeklyReset, quota.weeklyDisabled);
      continue;
    }

    const fiveHourPercent = pooled
      ? quota.fiveHourPercent
      : (quota.fiveHourPercent ??
        ("remainingPercent" in quota ? quota.remainingPercent : undefined));
    const fiveHourReset = pooled
      ? quota.fiveHourReset
      : (quota.fiveHourReset ?? ("resetAt" in quota ? quota.resetAt : undefined));

    considerLane(pool.fiveHour, fiveHourPercent, fiveHourReset, quota.fiveHourDisabled);
    considerLane(pool.weekly, quota.weeklyPercent, quota.weeklyReset, quota.weeklyDisabled);
  }

  return (["gemini", "argon", "claude_gpt"] as const)
    .filter((key) => (key === "argon" ? pools.argon.weekly.contributors > 0 : pools[key].seen))
    .map((key) => toQuotaData(key, pools[key]));
}

interface ExtractedLanes {
  fiveHourPercent?: number;
  fiveHourReset?: string;
  fiveHourDisabled?: boolean;
  weeklyPercent?: number;
  weeklyReset?: string;
  weeklyDisabled?: boolean;
}

function extractLanesFromBuckets(buckets: any[]): ExtractedLanes {
  let fiveHourPercent: number | undefined;
  let fiveHourReset: string | undefined;
  let fiveHourDisabled: boolean | undefined;
  let weeklyPercent: number | undefined;
  let weeklyReset: string | undefined;
  let weeklyDisabled: boolean | undefined;

  for (const b of (buckets || [])) {
    const fraction = b.remainingFraction ?? b.remaining_fraction;
    const pct =
      typeof fraction === "number"
        ? Math.round(Math.max(0, Math.min(1, fraction)) * 100)
        : b.disabled
          ? 0
          : undefined;
    const reset = b.resetTime || b.reset_time || "";
    const disabled = !!b.disabled;
    if (b.window === "5h") {
      fiveHourPercent = pct;
      fiveHourReset = reset;
      fiveHourDisabled = disabled;
    } else if (b.window === "weekly") {
      weeklyPercent = pct;
      weeklyReset = reset;
      weeklyDisabled = disabled;
    }
  }

  return {
    fiveHourPercent,
    fiveHourReset,
    fiveHourDisabled,
    weeklyPercent,
    weeklyReset,
    weeklyDisabled,
  };
}

export function parseQuotaData(
  configs: any[],
  quotaSummary?: any,
  availableModels?: any,
): QuotaData[] {
  const groups: any[] = quotaSummary?.response?.groups || quotaSummary?.groups || [];

  let modelEntries: any[] = Array.isArray(configs) ? [...configs] : [];
  if (modelEntries.length === 0 && availableModels) {
    const models = availableModels?.models || availableModels?.response?.models || availableModels;
    if (models && typeof models === "object" && !Array.isArray(models)) {
      modelEntries = Object.entries(models)
        .filter(([_, m]: [string, any]) => !m?.isInternal)
        .map(([id, m]: [string, any]) => ({
          label: m?.displayName || m?.display_name || m?.label || id,
          modelId: id,
          family: m?.family,
          quotaInfo: m?.quotaInfo ?? m?.quota_info ?? m,
        }));
    } else if (Array.isArray(models)) {
      modelEntries = [...models];
    }
  }

  if (modelEntries.length === 0 && groups.length > 0) {
    const groupQuotas = groups.map((g: any) => ({
      displayName: g.displayName,
      description: g.description,
      isBackendPool: true,
      ...extractLanesFromBuckets(g.buckets),
    }));
    return aggregateQuotasIntoPools(groupQuotas);
  }

  const intermediateQuotas: any[] = [];

  for (const config of modelEntries) {
    if (!config) continue;
    const label = config.label || config.displayName || config.model || config.modelId;
    if (!label) continue;

    const lowerLabel = label.toLowerCase();
    const isArgon = isArgonPoolModel(label) || config.family === "argon";

    const matchedGroup =
      groups.find((g: any) => {
        const gName = (g.displayName || "").toLowerCase();
        const gDesc = (g.description || "").toLowerCase();
        if (isArgon) {
          return (
            isArgonPoolModel(gName) ||
            isArgonPoolModel(gDesc) ||
            gName.includes("argon") ||
            gDesc.includes("argon")
          );
        }
        if (lowerLabel.includes("gemini")) {
          return !isArgonPoolModel(gName) && (gName.includes("gemini") || gDesc.includes("gemini"));
        }
        if (
          lowerLabel.includes("claude") ||
          lowerLabel.includes("gpt") ||
          lowerLabel.includes("openai") ||
          lowerLabel.includes("o1") ||
          lowerLabel.includes("o3") ||
          lowerLabel.includes("o4")
        ) {
          return (
            gName.includes("claude") ||
            gName.includes("gpt") ||
            gName.includes("openai") ||
            gDesc.includes("claude") ||
            gDesc.includes("gpt") ||
            gDesc.includes("openai")
          );
        }
        return gDesc.includes(lowerLabel) || gName.includes(lowerLabel);
      }) ||
      (isArgon
        ? groups.find((g: any) => {
            const gName = (g.displayName || "").toLowerCase();
            const gDesc = (g.description || "").toLowerCase();
            return gName.includes("gemini") || gDesc.includes("gemini");
          })
        : undefined);

    let lanes: ExtractedLanes = {};
    let hasDedicatedGroup = false;

    if (matchedGroup) {
      const gName = (matchedGroup.displayName || "").toLowerCase();
      const gDesc = (matchedGroup.description || "").toLowerCase();
      hasDedicatedGroup =
        isArgon &&
        (isArgonPoolModel(gName) || isArgonPoolModel(gDesc) || gName.includes("argon"));
      lanes = extractLanesFromBuckets(matchedGroup.buckets);
    } else if (config.quotaInfo || config.quota_info) {
      const quotaInfo = config.quotaInfo ?? config.quota_info;
      const fraction = quotaInfo.remainingFraction ?? quotaInfo.remaining_fraction;
      const pct =
        typeof fraction === "number"
          ? Math.round(Math.max(0, Math.min(1, fraction)) * 100)
          : quotaInfo.disabled
            ? 0
            : 0;
      const reset = quotaInfo.resetTime || quotaInfo.reset_time || "";
      const disabled = !!quotaInfo.disabled;
      if (isArgon) {
        intermediateQuotas.push({
          modelId: config.modelId,
          displayName: label,
          family: config.family ?? "argon",
          remainingPercent: pct,
          resetAt: reset,
          disabled,
        });
        continue;
      } else {
        lanes = {
          fiveHourPercent: pct,
          fiveHourReset: reset,
          fiveHourDisabled: disabled,
          weeklyPercent: pct,
          weeklyReset: reset,
          weeklyDisabled: disabled,
        };
      }
    } else if (
      typeof config.fiveHourPercent === "number" ||
      typeof config.weeklyPercent === "number"
    ) {
      lanes = {
        fiveHourPercent: config.fiveHourPercent,
        fiveHourReset: config.fiveHourReset,
        fiveHourDisabled: config.fiveHourDisabled,
        weeklyPercent: config.weeklyPercent,
        weeklyReset: config.weeklyReset,
        weeklyDisabled: config.weeklyDisabled,
      };
    }

    if (isArgon && hasDedicatedGroup) {
      intermediateQuotas.push({
        modelId: config.modelId,
        displayName: label,
        family: config.family ?? "argon",
        isBackendPool: true,
        weeklyPercent: lanes.weeklyPercent,
        weeklyReset: lanes.weeklyReset,
        weeklyDisabled: lanes.weeklyDisabled,
      });
    } else if (isArgon) {
      intermediateQuotas.push({
        modelId: config.modelId,
        displayName: label,
        family: config.family ?? "argon",
        remainingPercent: lanes.fiveHourPercent ?? lanes.weeklyPercent,
        resetAt: lanes.fiveHourReset || lanes.weeklyReset,
        disabled: lanes.fiveHourDisabled ?? lanes.weeklyDisabled ?? false,
      });
    } else {
      intermediateQuotas.push({
        modelId: config.modelId,
        displayName: label,
        family: config.family,
        ...lanes,
      });
    }
  }

  return aggregateQuotasIntoPools(intermediateQuotas);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function getRelativeTime(isoDate: string): string {
  const futureDate = new Date(isoDate);
  const now = new Date();
  const diffMs = futureDate.getTime() - now.getTime();

  if (diffMs <= 0) return "Ready";

  const totalMinutes = Math.floor(diffMs / 60000);
  const remainingMinutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingHours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  let durationStr = "";
  if (days > 0) {
    const dayWord = days === 1 ? "day" : "days";
    durationStr = `${days} ${dayWord}, ${remainingHours} hr, ${remainingMinutes} mins`;
  } else if (totalHours > 0) {
    durationStr = `${totalHours} hr, ${remainingMinutes} mins`;
  } else {
    durationStr = `${remainingMinutes} mins`;
  }

  const ampm = futureDate.getHours() >= 12 ? "PM" : "AM";
  let hour12 = futureDate.getHours() % 12;
  hour12 = hour12 ? hour12 : 12;
  const minStr = String(futureDate.getMinutes()).padStart(2, "0");
  const timeStr = `${hour12}:${minStr} ${ampm}`;

  const isCurrentDay =
    futureDate.getDate() === now.getDate() &&
    futureDate.getMonth() === now.getMonth() &&
    futureDate.getFullYear() === now.getFullYear();

  if (isCurrentDay) {
    return `${durationStr} | ${timeStr}`;
  }

  const month = MONTHS[futureDate.getMonth()];
  const day = futureDate.getDate();
  return `${durationStr} | ${month} ${day}, ${timeStr}`;
}

export function formatAbsoluteTime(isoDate: string): string {
  if (!isoDate || isoDate === "Exhausted" || isoDate === "Ready") return isoDate || "—";
  const futureDate = new Date(isoDate);
  if (isNaN(futureDate.getTime())) return "—";

  const ampm = futureDate.getHours() >= 12 ? "PM" : "AM";
  let hour12 = futureDate.getHours() % 12;
  hour12 = hour12 ? hour12 : 12;
  const minStr = String(futureDate.getMinutes()).padStart(2, "0");
  const timeStr = `${hour12}:${minStr} ${ampm}`;

  const now = new Date();
  const isCurrentDay =
    futureDate.getDate() === now.getDate() &&
    futureDate.getMonth() === now.getMonth() &&
    futureDate.getFullYear() === now.getFullYear();

  if (isCurrentDay) {
    return timeStr;
  }

  const month = MONTHS[futureDate.getMonth()];
  const day = futureDate.getDate();
  return `${month} ${day}, ${timeStr}`;
}
