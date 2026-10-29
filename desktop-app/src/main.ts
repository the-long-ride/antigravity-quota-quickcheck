import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { initFloatingTooltips } from "./tooltip";

// Interfaces matching Rust structs
export interface QuotaData {
  model: string;
  percent: number;
  refreshTime: string;
  fiveHourPercent?: number;
  fiveHourReset?: string;
  fiveHourDisabled?: boolean;
  weeklyPercent?: number;
  weeklyReset?: string;
  weeklyDisabled?: boolean;
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

export function isGeminiOnlyPool(quotas: { model: string }[]): boolean {
  return (
    quotas.length === 1 &&
    /gemini/i.test(quotas[0].model) &&
    !isArgonPoolModel(quotas[0].model)
  );
}

export function getQuotaUsageTier(
  percent: number | undefined,
  disabled?: boolean
): "normal" | "warning" | "danger" {
  if (disabled || percent === undefined) {
    return "normal";
  }
  if (percent <= 10) {
    return "danger";
  }
  if (percent <= 20) {
    return "warning";
  }
  return "normal";
}

export function getQuotaLevelClass(
  percent: number | undefined,
  disabled?: boolean
): string {
  const tier = getQuotaUsageTier(percent, disabled);
  if (tier === "warning") {
    return "quota-level--warning";
  }
  if (tier === "danger") {
    return "quota-level--danger";
  }
  return "";
}

export function calculateWindowHeight(quotaCount: number, isGeminiOnly: boolean): number {
  if (quotaCount <= 0) {
    return 216;
  }
  if (quotaCount === 1 && isGeminiOnly) {
    return 224;
  }
  const baseHeight = 192;
  const cardsTotal = quotaCount * 85 + Math.max(0, quotaCount - 1) * 4;
  return Math.max(216, Math.min(650, baseHeight + cardsTotal + 15));
}

let lastRequestedHeight = 0;

export function adjustWindowHeight(quotaCount: number, isGeminiOnly: boolean) {
  const target = calculateWindowHeight(quotaCount, isGeminiOnly);
  if (target === lastRequestedHeight) {
    return;
  }
  lastRequestedHeight = target;
  invoke("set_window_height", { height: target }).catch(() => {});
}

interface CreditInfo {
  balance: number;
  creditType: string;
}

interface FullStatus {
  credits: CreditInfo | null;
  quotas: QuotaData[];
  planTier: string | null;
  recentlyUsedModel: string | null;
}

let disabledClickCount = 0;

// Global UI Elements
const statusIndicator = document.getElementById("status-indicator")!;
const statusText = document.getElementById("status-text")!;
const planTierValue = document.getElementById("plan-tier-value")!;
const creditAmount = document.getElementById("credit-amount")!;
const quotasList = document.getElementById("quotas-list")!;
const updateBtn = document.getElementById("update-btn")!;
const refreshBtn = document.getElementById("refresh-btn")!;
const pollIntervalInput = document.getElementById("poll-interval") as HTMLInputElement;
const themeToggleBtn = document.getElementById("theme-toggle")!;

function showCustomAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-dialog-overlay")!;
    const msgEl = overlay.querySelector(".dialog-message")!;
    const okBtn = document.getElementById("dialog-ok-btn")!;
    const cancelBtn = document.getElementById("dialog-cancel-btn") as HTMLButtonElement;

    msgEl.textContent = message;
    if (cancelBtn) cancelBtn.style.display = "none";
    overlay.style.display = "flex";

    const onOk = () => {
      overlay.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      resolve();
    };
    okBtn.addEventListener("click", onOk);
  });
}

function showCustomConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-dialog-overlay")!;
    const msgEl = overlay.querySelector(".dialog-message")!;
    const okBtn = document.getElementById("dialog-ok-btn")!;
    const cancelBtn = document.getElementById("dialog-cancel-btn") as HTMLButtonElement;

    msgEl.textContent = message;
    if (cancelBtn) cancelBtn.style.display = "inline-block";
    overlay.style.display = "flex";

    const cleanUp = () => {
      overlay.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
    };

    const onOk = () => {
      cleanUp();
      resolve(true);
    };

    const onCancel = () => {
      cleanUp();
      resolve(false);
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ── Theme (persisted via localStorage) ─────────────────────────────────────
const THEME_KEY = "antigravity-theme";

function applyTheme(theme: "dark" | "light") {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function getSavedTheme(): "dark" | "light" {
  return (localStorage.getItem(THEME_KEY) as "dark" | "light") ?? "dark";
}

applyTheme(getSavedTheme());

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.hasAttribute("data-theme") ? "light" : "dark";
  const next: "dark" | "light" = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

function formatAbsoluteTime(isoDate: string): string {
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

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const month = MONTHS[futureDate.getMonth()];
  const day = futureDate.getDate();
  return `${month} ${day}, ${timeStr}`;
}

function updateUI(status: FullStatus | null) {
  if (!status) {
    statusIndicator.className = "status-indicator offline";
    statusText.textContent = "Offline";
    planTierValue.textContent = "—";
    creditAmount.textContent = "—";
    quotasList.innerHTML = `
      <div class="error-state">
        <strong>No quota source available</strong>
        <p style="margin-top: 4px; font-size: 10.5px; color: var(--text-secondary);">
          Sign in with agy, or start Antigravity IDE to use the language-server fallback.
        </p>
      </div>
    `;
    adjustWindowHeight(0, false);
    return;
  }

  statusIndicator.className = "status-indicator";
  statusText.textContent = "Online";
  planTierValue.textContent = status.planTier || "Gemini AI";

  if (status.credits) {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    });
    creditAmount.textContent = formatter.format(status.credits.balance);
  } else {
    creditAmount.textContent = "—";
  }
  const validQuotas = (status.quotas || []).filter(
    (q): q is QuotaData => Boolean(q && typeof q === "object")
  );

  if (validQuotas.length === 0) {
    quotasList.innerHTML = `
      <div class="loading-state">
        <span>No active model quotas found.</span>
      </div>
    `;
    adjustWindowHeight(0, false);
    return;
  }

  const isGeminiOnly = isGeminiOnlyPool(validQuotas);

  quotasList.innerHTML = "";
  validQuotas.forEach((q) => {
    const isMonitored = q.model === status.recentlyUsedModel;
    const isArgon = isArgonPoolModel(q.model);

    const fiveHourDisabled = Boolean(q.fiveHourDisabled);
    const weeklyDisabled = Boolean(q.weeklyDisabled);

    const availablePercents = isArgon
      ? (weeklyDisabled || q.weeklyPercent === undefined ? [] : [q.weeklyPercent])
      : [
          fiveHourDisabled || q.fiveHourPercent === undefined ? null : q.fiveHourPercent,
          weeklyDisabled || q.weeklyPercent === undefined ? null : q.weeklyPercent,
        ].filter((value): value is number => value !== null);

    const isDisabled = isArgon
      ? weeklyDisabled || (q.weeklyPercent !== undefined && q.weeklyPercent === 0)
      : (q.fiveHourPercent !== undefined ? fiveHourDisabled || q.fiveHourPercent === 0 : false) ||
        (availablePercents.length > 0 && availablePercents.every((value) => value === 0));

    const itemClasses = [
      "quota-item",
      isArgon ? "quota-item--argon" : "",
      isGeminiOnly ? "quota-item--gemini-only" : "",
      isMonitored ? "monitored" : "",
      isDisabled ? "disabled-model" : "",
    ].filter(Boolean).join(" ");

    const modelDisplayName = (q.model && q.model.trim()) ? q.model : "Gemini";

    const itemEl = document.createElement("div");
    itemEl.className = itemClasses;
    itemEl.setAttribute("data-model", modelDisplayName);
    if (isGeminiOnly) {
      itemEl.setAttribute("data-tooltip", modelDisplayName);
    }

    itemEl.addEventListener("click", async () => {
      if (isDisabled) {
        disabledClickCount++;
        if (disabledClickCount > 3) {
          await showCustomAlert("The model has already been exhausted!");
        }
        return;
      }
      await invoke("set_monitored_model", { model: modelDisplayName });
      triggerRefresh();
    });

    const fiveHourResetStr = fiveHourDisabled
      ? "Unavailable"
      : (q.fiveHourReset ? formatAbsoluteTime(q.fiveHourReset) : "Ready");
    const weeklyResetStr = weeklyDisabled
      ? "Unavailable"
      : (q.weeklyReset ? formatAbsoluteTime(q.weeklyReset) : "Ready");

    const fiveHourValue = (fiveHourDisabled || q.fiveHourPercent === undefined)
      ? "—"
      : `${q.fiveHourPercent}%`;
    const weeklyValue = (weeklyDisabled || q.weeklyPercent === undefined)
      ? "—"
      : `${q.weeklyPercent}%`;

    const fiveHourWidth = (fiveHourDisabled || q.fiveHourPercent === undefined)
      ? 0
      : Math.min(100, Math.max(0, q.fiveHourPercent));
    const weeklyWidth = (weeklyDisabled || q.weeklyPercent === undefined)
      ? 0
      : Math.min(100, Math.max(0, q.weeklyPercent));

    const fiveHourLevelClass = getQuotaLevelClass(q.fiveHourPercent, fiveHourDisabled);
    const weeklyLevelClass = getQuotaLevelClass(q.weeklyPercent, weeklyDisabled);

    const fiveHourBarClass = ["progress-bar", fiveHourLevelClass].filter(Boolean).join(" ");
    const fiveHourValueClass = ["quota-value", fiveHourLevelClass].filter(Boolean).join(" ");
    const weeklyBarClass = ["progress-bar", weeklyLevelClass].filter(Boolean).join(" ");
    const weeklyValueClass = ["quota-value", weeklyLevelClass].filter(Boolean).join(" ");

    const headerHtml = isGeminiOnly
      ? ""
      : `
      <div class="quota-item-header">
        <span class="quota-model-name">${modelDisplayName}</span>
      </div>
    `;

    const limitsHtml = isArgon
      ? `
      <div class="quota-limits-container">
        <div class="quota-limit-col">
          <div class="quota-limit-label-container">
            <span class="quota-limit-name">Weekly limit</span>
            <span class="quota-limit-reset">${weeklyResetStr}</span>
          </div>
          <div class="quota-limit-bar-container">
            <div class="progress-container">
              <div class="${weeklyBarClass}" style="width: ${weeklyWidth}%;"></div>
            </div>
            <span class="${weeklyValueClass}">${weeklyValue}</span>
          </div>
        </div>
      </div>
    `
      : `
      <div class="quota-limits-container">
        <div class="quota-limit-col">
          <div class="quota-limit-label-container">
            <span class="quota-limit-name">5 hrs limit</span>
            <span class="quota-limit-reset">${fiveHourResetStr}</span>
          </div>
          <div class="quota-limit-bar-container">
            <div class="progress-container">
              <div class="${fiveHourBarClass}" style="width: ${fiveHourWidth}%;"></div>
            </div>
            <span class="${fiveHourValueClass}">${fiveHourValue}</span>
          </div>
        </div>

        <div class="quota-limit-col">
          <div class="quota-limit-label-container">
            <span class="quota-limit-name">Weekly limit</span>
            <span class="quota-limit-reset">${weeklyResetStr}</span>
          </div>
          <div class="quota-limit-bar-container">
            <div class="progress-container">
              <div class="${weeklyBarClass}" style="width: ${weeklyWidth}%;"></div>
            </div>
            <span class="${weeklyValueClass}">${weeklyValue}</span>
          </div>
        </div>
      </div>
    `;

    itemEl.innerHTML = `
      ${headerHtml}
      ${limitsHtml}
    `;
    quotasList.appendChild(itemEl);
  });
  adjustWindowHeight(validQuotas.length, isGeminiOnly);
}

async function triggerRefresh() {
  refreshBtn.classList.add("spinning");
  try {
    const status = await invoke<FullStatus | null>("force_refresh");
    updateUI(status);
  } catch (err) {
    console.error("Refresh error:", err);
    updateUI(null);
  } finally {
    setTimeout(() => {
      refreshBtn.classList.remove("spinning");
    }, 400);
  }
}

pollIntervalInput.addEventListener("change", async () => {
  let val = parseInt(pollIntervalInput.value);
  if (isNaN(val) || val < 5) {
    val = 5;
    pollIntervalInput.value = "5";
  }
  await invoke("set_poll_interval", { seconds: BigInt(val) });
});

refreshBtn.addEventListener("click", triggerRefresh);

document.getElementById("author-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride");
});
document.getElementById("github-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride/antigravity-quota-quickcheck");
});
document.getElementById("quotashift-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride/QuotaShift/releases/latest");
});
document.getElementById("report-issue-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride/antigravity-quota-quickcheck/issues/new");
});

const appVersionLink = document.getElementById("app-version-link");
if (appVersionLink) {
  appVersionLink.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/the-long-ride/antigravity-quota-quickcheck/blob/main/CHANGELOG.md");
  });
}

async function initAppVersion() {
  const versionEl = document.getElementById("app-version-link");
  if (!versionEl) return;
  try {
    const ver = await invoke<string>("get_app_version").catch(() => getVersion());
    if (ver) {
      versionEl.textContent = ver.startsWith("v") ? ver : `v${ver}`;
    }
  } catch (err) {
    console.debug("Failed to get version dynamically, using fallback:", err);
  }
}

async function checkForUpdates() {
  try {
    const currentVersion = await getVersion();
    const res = await fetch("https://api.github.com/repos/the-long-ride/antigravity-quota-quickcheck/releases/latest");
    if (!res.ok) {
      console.warn("GitHub API request failed, status:", res.status);
      return;
    }
    const releaseData = await res.json();
    const latestTag = releaseData.tag_name;
    if (!latestTag) return;

    const currentClean = currentVersion.replace(/^v/, "");
    const latestClean = latestTag.replace(/^v/, "");

    if (isNewerVersion(currentClean, latestClean)) {
      const assets = releaseData.assets || [];
      let downloadUrl = "";
      const isWindows = navigator.userAgent.toLowerCase().includes("windows");
      const isLinux = navigator.userAgent.toLowerCase().includes("linux");

      if (isWindows) {
        const asset = assets.find((a: any) => a.name.endsWith(".exe") && !a.name.includes("portable"));
        if (asset) downloadUrl = asset.browser_download_url;
      } else if (isLinux) {
        const asset = assets.find((a: any) => a.name.endsWith(".deb"));
        if (asset) downloadUrl = asset.browser_download_url;
      }

      if (downloadUrl) {
        updateBtn.style.display = "flex";
        updateBtn.setAttribute("data-tooltip", `New version ${latestTag} is available. Click to update.`);
        updateBtn.removeAttribute("title");

        updateBtn.addEventListener("click", async () => {
          const confirmUpdate = await showCustomConfirm(`A new version (${latestTag}) of Antigravity Quota Quickcheck is available. Do you want to download and install it now?`);
          if (confirmUpdate) {
            updateBtn.classList.add("downloading");
            updateBtn.setAttribute("data-tooltip", "Downloading update...");
            updateBtn.removeAttribute("title");
            invoke("execute_update", { url: downloadUrl }).catch(async (err) => {
              updateBtn.classList.remove("downloading");
              updateBtn.setAttribute("data-tooltip", `Update failed: ${err}`);
              updateBtn.removeAttribute("title");
              await showCustomAlert(`Update failed: ${err}`);
            });
          }
        });
      }
    }
  } catch (err) {
    console.error("Check for updates failed:", err);
  }
}

function isNewerVersion(current: string, latest: string): boolean {
  const cParts = current.split(".").map(Number);
  const lParts = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const cPart = cParts[i] || 0;
    const lPart = lParts[i] || 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const isDebug = await invoke<boolean>("is_debug");
    if (!isDebug) {
      document.addEventListener("contextmenu", (e) => e.preventDefault());
      document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
        }
        if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
          e.preventDefault();
        }
        if ((e.ctrlKey && e.key.toLowerCase() === "r") || e.key === "F5") {
          e.preventDefault();
        }
      });
    }
  } catch (err) {
    console.error("Failed to check debug mode:", err);
  }

  function scrollToActiveModel() {
    setTimeout(() => {
      const activeEl = document.querySelector(".quota-item.monitored") as HTMLElement;
      const parent = document.getElementById("quotas-list");
      if (!activeEl || !parent) return;

      const parentRect = parent.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const relativeTop = activeRect.top - parentRect.top;
      const targetScrollTop = parent.scrollTop + relativeTop - (parentRect.height / 2) + (activeRect.height / 2);

      parent.scrollTo({
        top: targetScrollTop,
        behavior: "smooth"
      });
    }, 100);
  }

  listen<FullStatus | null>("status-updated", (event) => {
    updateUI(event.payload);
  });

  listen("window-shown", () => {
    scrollToActiveModel();
  });

  window.addEventListener("focus", () => {
    scrollToActiveModel();
  });

  adjustWindowHeight(0, false);
  initAppVersion();
  initFloatingTooltips();

  try {
    const initialStatus = await invoke<FullStatus | null>("get_quota_status");
    updateUI(initialStatus);
    scrollToActiveModel();
  } catch (err) {
    updateUI(null);
  }

  checkForUpdates();
});
