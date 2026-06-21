import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";

// Interfaces matching Rust structs
interface QuotaData {
  model: string;
  percent: number;
  refreshTime: string;
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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getRelativeTime(isoDate: string): { duration: string; absolute: string } {
  if (!isoDate || isoDate === "Exhausted") return { duration: "Exhausted", absolute: "" };
  
  const futureDate = new Date(isoDate);
  const now = new Date();
  const diffMs = futureDate.getTime() - now.getTime();

  if (diffMs <= 0) return { duration: "Ready", absolute: "" };

  const totalMinutes = Math.floor(diffMs / 60000);
  const remainingMinutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingHours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  let durationStr = "";
  if (days > 0) {
    const dayWord = days === 1 ? "day" : "days";
    durationStr = `${days} ${dayWord}, ${remainingHours} hr`;
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

  const isCurrentDay =
    futureDate.getDate() === now.getDate() &&
    futureDate.getMonth() === now.getMonth() &&
    futureDate.getFullYear() === now.getFullYear();

  if (isCurrentDay) {
    return { duration: durationStr, absolute: timeStr };
  } else {
    const month = MONTHS[futureDate.getMonth()];
    const day = futureDate.getDate();
    return { duration: durationStr, absolute: `${month} ${day}, ${timeStr}` };
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
    const itemEl = document.createElement("div");
    itemEl.className = `quota-item ${isMonitored ? "monitored" : ""}`;
    
    // Add Click listener to monitor this model in system tray
    itemEl.addEventListener("click", async () => {
      await invoke("set_monitored_model", { model: q.model });
      // Instantly trigger a refresh so tray text updates
      triggerRefresh();
    });

    const resetInfo = getRelativeTime(q.refreshTime);
    const absoluteHtml = resetInfo.absolute
      ? `<div class="quota-reset-absolute">${resetInfo.absolute}</div>`
      : "";

    itemEl.innerHTML = `
      <div class="quota-item-header">
        <span class="quota-model-name">${q.model}</span>
        <span class="quota-value">${q.percent}%</span>
      </div>
      <div class="progress-container">
        <div class="progress-bar" style="width: ${q.percent}%;"></div>
      </div>
      <div class="quota-item-footer">
        <div class="quota-reset-duration">Resets in: ${resetInfo.duration}</div>
        ${absoluteHtml}
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
        
        updateBtn.addEventListener("click", () => {
          const confirmUpdate = confirm(`A new version (${latestTag}) of Antigravity Quota is available. Do you want to download and install it now?`);
          if (confirmUpdate) {
            updateBtn.classList.add("downloading");
            updateBtn.title = "Downloading update...";
            invoke("execute_update", { url: downloadUrl }).catch((err) => {
              updateBtn.classList.remove("downloading");
              updateBtn.title = `Update failed: ${err}`;
              alert(`Update failed: ${err}`);
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

  // Listen for backend updates pushed to frontend
  listen<FullStatus | null>("status-updated", (event) => {
    updateUI(event.payload);
  });

  // Get initial status
  try {
    const initialStatus = await invoke<FullStatus | null>("get_quota_status");
    updateUI(initialStatus);
  } catch (err) {
    updateUI(null);
  }

  // Check for updates
  checkForUpdates();
});
