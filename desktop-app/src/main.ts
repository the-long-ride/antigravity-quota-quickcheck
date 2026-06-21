import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";

// Interfaces matching Rust structs
interface QuotaData {
  model: string;
  percent: number;
  refreshTime: string;
  fiveHourPercent: number;
  fiveHourReset: string;
  fiveHourDisabled: boolean;
  weeklyPercent: number;
  weeklyReset: string;
  weeklyDisabled: boolean;
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

// Apply saved theme immediately on load
applyTheme(getSavedTheme());

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.hasAttribute("data-theme") ? "light" : "dark";
  const next: "dark" | "light" = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});
// ───────────────────────────────────────────────────────────────────────────

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
    return `Resets at: ${timeStr}`;
  } else {
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const month = MONTHS[futureDate.getMonth()];
    const day = futureDate.getDate();
    return `Resets at: ${month} ${day}, ${timeStr}`;
  }
}

function updateUI(status: FullStatus | null) {
  if (!status) {
    // Offline / Error State
    statusIndicator.className = "status-indicator offline";
    statusText.textContent = "Offline";
    planTierValue.textContent = "—";
    creditAmount.textContent = "—";
    quotasList.innerHTML = `
      <div class="error-state">
        <strong>Language server not reachable</strong>
        <p style="margin-top: 4px; font-size: 10.5px; color: var(--text-secondary);">
          Ensure the Antigravity extension or server is running and try again.
        </p>
      </div>
    `;
    return;
  }

  // Online State
  statusIndicator.className = "status-indicator";
  statusText.textContent = "Online";

  // Plan Tier
  planTierValue.textContent = status.planTier || "Gemini AI";


  // Credits Balance
  if (status.credits) {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    });
    creditAmount.textContent = formatter.format(status.credits.balance);
  } else {
    creditAmount.textContent = "—";
  }

  // Quotas List
  if (status.quotas.length === 0) {
    quotasList.innerHTML = `
      <div class="loading-state">
        <span>No active model quotas found.</span>
      </div>
    `;
    return;
  }

  quotasList.innerHTML = "";
  status.quotas.forEach((q) => {
    const isMonitored = q.model === status.recentlyUsedModel;
    const isDisabled = q.weeklyPercent === 0;
    const itemEl = document.createElement("div");
    itemEl.className = `quota-item ${isMonitored ? "monitored" : ""} ${isDisabled ? "disabled-model" : ""}`;
    
    // Add Click listener to monitor this model in system tray
    itemEl.addEventListener("click", async () => {
      if (isDisabled) {
        disabledClickCount++;
        if (disabledClickCount > 3) {
          await showCustomAlert("The model has already been exhausted!");
        }
        return;
      }
      await invoke("set_monitored_model", { model: q.model });
      // Instantly trigger a refresh so tray text updates
      triggerRefresh();
    });

    const fiveHourResetStr = q.fiveHourDisabled ? "Disabled" : (q.fiveHourReset ? formatAbsoluteTime(q.fiveHourReset) : "Ready");
    const weeklyResetStr = q.weeklyDisabled ? "Disabled" : (q.weeklyReset ? formatAbsoluteTime(q.weeklyReset) : "Ready");

    itemEl.innerHTML = `
      <div class="quota-item-header">
        <span class="quota-model-name">${q.model}</span>
      </div>
      
      <div class="quota-limits-container">
        <!-- Five Hour Limit Column -->
        <div class="quota-limit-col">
          <div class="quota-limit-label-container">
            <span class="quota-limit-name">5 hrs limit</span>
            <span class="quota-limit-reset">${fiveHourResetStr}</span>
          </div>
          <div class="quota-limit-bar-container">
            <div class="progress-container">
              <div class="progress-bar" style="width: ${q.fiveHourPercent}%;"></div>
            </div>
            <span class="quota-value">${q.fiveHourPercent}%</span>
          </div>
        </div>
        
        <!-- Weekly Limit Column -->
        <div class="quota-limit-col">
          <div class="quota-limit-label-container">
            <span class="quota-limit-name">Weekly limit</span>
            <span class="quota-limit-reset">${weeklyResetStr}</span>
          </div>
          <div class="quota-limit-bar-container">
            <div class="progress-container">
              <div class="progress-bar" style="width: ${q.weeklyPercent}%;"></div>
            </div>
            <span class="quota-value">${q.weeklyPercent}%</span>
          </div>
        </div>
      </div>
    `;
    quotasList.appendChild(itemEl);
  });
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
    // Keep spin active slightly to feel reactive
    setTimeout(() => {
      refreshBtn.classList.remove("spinning");
    }, 400);
  }
}

// Listen to interval change
pollIntervalInput.addEventListener("change", async () => {
  let val = parseInt(pollIntervalInput.value);
  if (isNaN(val) || val < 5) {
    val = 5;
    pollIntervalInput.value = "5";
  }
  await invoke("set_poll_interval", { seconds: BigInt(val) });
});

// Manual refresh button click
refreshBtn.addEventListener("click", triggerRefresh);


// Footer links — open in system browser via Tauri opener
document.getElementById("author-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride");
});
document.getElementById("github-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride/antigravity-quota-quickcheck");
});
document.getElementById("report-issue-link")!.addEventListener("click", (e) => {
  e.preventDefault();
  openUrl("https://github.com/the-long-ride/antigravity-quota-quickcheck/issues/new");
});

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
        // Look for NSIS installer *.exe
        const asset = assets.find((a: any) => a.name.endsWith(".exe") && !a.name.includes("portable"));
        if (asset) downloadUrl = asset.browser_download_url;
      } else if (isLinux) {
        // Look for *.deb package
        const asset = assets.find((a: any) => a.name.endsWith(".deb"));
        if (asset) downloadUrl = asset.browser_download_url;
      }

      if (downloadUrl) {
        updateBtn.style.display = "flex";
        updateBtn.title = `New version ${latestTag} is available. Click to update.`;
        
        updateBtn.addEventListener("click", async () => {
          const confirmUpdate = await showCustomConfirm(`A new version (${latestTag}) of Antigravity Quota Quickcheck is available. Do you want to download and install it now?`);
          if (confirmUpdate) {
            updateBtn.classList.add("downloading");
            updateBtn.title = "Downloading update...";
            invoke("execute_update", { url: downloadUrl }).catch(async (err) => {
              updateBtn.classList.remove("downloading");
              updateBtn.title = `Update failed: ${err}`;
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


// Setup listeners when DOM loaded
window.addEventListener("DOMContentLoaded", async () => {
  // If not debug build, disable context menu and development/search keyboard shortcuts
  try {
    const isDebug = await invoke<boolean>("is_debug");
    if (!isDebug) {
      document.addEventListener("contextmenu", (e) => e.preventDefault());
      document.addEventListener("keydown", (e) => {
        // Ctrl+F
        if (e.ctrlKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
        }
        // F12 or Ctrl+Shift+I (devtools)
        if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
          e.preventDefault();
        }
        // Ctrl+R or F5 (refresh page)
        if ((e.ctrlKey && e.key.toLowerCase() === "r") || e.key === "F5") {
          e.preventDefault();
        }
      });
    }
  } catch (err) {
    console.error("Failed to check debug mode:", err);
  }

  // Function to scroll active/monitored model to center
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

  // Listen for backend updates pushed to frontend
  listen<FullStatus | null>("status-updated", (event) => {
    updateUI(event.payload);
  });

  // Listen for window-shown custom event from Tauri
  listen("window-shown", () => {
    scrollToActiveModel();
  });

  // Listen for standard web window focus event
  window.addEventListener("focus", () => {
    scrollToActiveModel();
  });

  // Get initial status
  try {
    const initialStatus = await invoke<FullStatus | null>("get_quota_status");
    updateUI(initialStatus);
    scrollToActiveModel();
  } catch (err) {
    updateUI(null);
  }

  // Check for updates
  checkForUpdates();
});
