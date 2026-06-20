import { CreditInfo, FullStatus, QuotaData } from "./types";

export function parseFullStatus(raw: any): FullStatus {
  // --- Credits ---
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

  // --- Active model (Handled by client-side usage tracker in index.ts) ---
  let recentlyUsedModel: string | null = null;

  // --- Quotas ---
  const quotas = parseQuotaData(configs);

  // -- User's plan tier name
  const planTier = raw?.userStatus?.userTier?.name;

  return { credits, quotas, recentlyUsedModel, planTier };
}

export function parseQuotaData(configs: any[]): QuotaData[] {
  const results: QuotaData[] = [];

  for (const config of configs) {
    if (!config.label) continue;

    let percent = 0;
    let refreshTime = "Exhausted";

    if (config.quotaInfo) {
      const fraction = config.quotaInfo.remainingFraction;
      if (typeof fraction === "number") {
        percent = Math.max(0, Math.min(1, fraction)) * 100;
      }
      if (config.quotaInfo.resetTime) {
        refreshTime = getRelativeTime(config.quotaInfo.resetTime);
      }
    }

    results.push({
      model: config.label,
      percent: Math.round(percent),
      refreshTime,
    });
  }

  // Sort descending (highest percent first)
  return results.sort((a, b) => b.percent - a.percent);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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

  // Format absolute time part: hh:mm AM/PM
  const ampm = futureDate.getHours() >= 12 ? "PM" : "AM";
  let hour12 = futureDate.getHours() % 12;
  hour12 = hour12 ? hour12 : 12;
  const minStr = String(futureDate.getMinutes()).padStart(2, "0");
  const timeStr = `${hour12}:${minStr} ${ampm}`;

  // Determine if it falls on the current day
  const isCurrentDay =
    futureDate.getDate() === now.getDate() &&
    futureDate.getMonth() === now.getMonth() &&
    futureDate.getFullYear() === now.getFullYear();

  if (isCurrentDay) {
    return `${durationStr} | ${timeStr}`;
  } else {
    const month = MONTHS[futureDate.getMonth()];
    const day = futureDate.getDate();
    return `${durationStr} | ${month} ${day}, ${timeStr}`;
  }
}
