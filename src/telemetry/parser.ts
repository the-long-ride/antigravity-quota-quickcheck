import { CreditInfo, FullStatus, QuotaData } from "./types";

export function parseFullStatus(raw: any, quotaSummary?: any): FullStatus {
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
  const quotas = parseQuotaData(configs, quotaSummary);

  // -- User's plan tier name
  const planTier = raw?.userStatus?.userTier?.name;

  return { credits, quotas, recentlyUsedModel, planTier };
}

export function parseQuotaData(configs: any[], quotaSummary?: any): QuotaData[] {
  const results: QuotaData[] = [];
  const groups: any[] = quotaSummary?.response?.groups || [];

  for (const config of configs) {
    if (!config.label) continue;

    const label = config.label;
    const lowerLabel = label.toLowerCase();

    // Match group
    const matchedGroup = groups.find(g => {
      const groupLowerName = g.displayName.toLowerCase();
      if (lowerLabel.includes("gemini")) {
        return groupLowerName.includes("gemini");
      }
      if (lowerLabel.includes("claude") || lowerLabel.includes("gpt")) {
        return groupLowerName.includes("claude") || groupLowerName.includes("gpt");
      }
      return g.description.toLowerCase().includes(lowerLabel) || groupLowerName.includes(lowerLabel);
    });

    let fiveHourPercent = 100;
    let fiveHourReset = "";
    let fiveHourDisabled = false;
    let weeklyPercent = 100;
    let weeklyReset = "";
    let weeklyDisabled = false;

    if (matchedGroup) {
      for (const b of matchedGroup.buckets) {
        const fraction = b.remainingFraction;
        const pct = typeof fraction === "number" ? Math.round(Math.max(0, Math.min(1, fraction)) * 100) : 100;
        if (b.window === "5h") {
          fiveHourPercent = pct;
          fiveHourReset = b.resetTime || "";
          fiveHourDisabled = !!b.disabled;
        } else if (b.window === "weekly") {
          weeklyPercent = pct;
          weeklyReset = b.resetTime || "";
          weeklyDisabled = !!b.disabled;
        }
      }
    } else {
      // Fallback
      if (config.quotaInfo) {
        const fraction = config.quotaInfo.remainingFraction;
        const pct = typeof fraction === "number" ? Math.round(Math.max(0, Math.min(1, fraction)) * 100) : 0;
        fiveHourPercent = pct;
        weeklyPercent = pct;
        if (config.quotaInfo.resetTime) {
          fiveHourReset = config.quotaInfo.resetTime;
          weeklyReset = config.quotaInfo.resetTime;
        }
      }
    }

    if (weeklyPercent === 0) {
      fiveHourPercent = 0;
    }

    // Set legacy fields for fallback compatibility
    const percent = fiveHourPercent;
    const refreshTime = fiveHourReset ? formatAbsoluteTime(fiveHourReset) : "Exhausted";

    results.push({
      model: label,
      percent,
      refreshTime,
      fiveHourPercent,
      fiveHourReset,
      fiveHourDisabled,
      weeklyPercent,
      weeklyReset,
      weeklyDisabled
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
    return `${timeStr}`;
  } else {
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const month = MONTHS[futureDate.getMonth()];
    const day = futureDate.getDate();
    return `${month} ${day}, ${timeStr}`;
  }
}

