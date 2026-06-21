use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

// ── Windows: remove DWM 1px border ────────────────────────────────────
#[cfg(target_os = "windows")]
mod dwm_fix {
    // DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xFFFFFFFE
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut std::ffi::c_void,
            dw_attribute: u32,
            pv_attribute: *const std::ffi::c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    pub fn remove_border(hwnd: *mut std::ffi::c_void) {
        let color = DWMWA_COLOR_NONE;
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &color as *const u32 as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}
// ───────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct QuotaData {
    pub model: String,
    pub percent: u32,
    #[serde(rename = "refreshTime")]
    pub refresh_time: String,
    #[serde(rename = "fiveHourPercent")]
    pub five_hour_percent: u32,
    #[serde(rename = "fiveHourReset")]
    pub five_hour_reset: String,
    #[serde(rename = "fiveHourDisabled")]
    pub five_hour_disabled: bool,
    #[serde(rename = "weeklyPercent")]
    pub weekly_percent: u32,
    #[serde(rename = "weeklyReset")]
    pub weekly_reset: String,
    #[serde(rename = "weeklyDisabled")]
    pub weekly_disabled: bool,
}


#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct CreditInfo {
    pub balance: f64,
    #[serde(rename = "creditType")]
    pub credit_type: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct FullStatus {
    pub credits: Option<CreditInfo>,
    pub quotas: Vec<QuotaData>,
    #[serde(rename = "planTier")]
    pub plan_tier: Option<String>,
    #[serde(rename = "recentlyUsedModel")]
    pub recently_used_model: Option<String>,
}

struct AppState {
    cached_pid: Option<u32>,
    cached_token: Option<String>,
    cached_port: Option<u16>,
    last_status: Option<FullStatus>,
    monitored_model: Option<String>,
    poll_interval_secs: u64,
}

static STATE: OnceLock<Mutex<AppState>> = OnceLock::new();

fn get_state() -> &'static Mutex<AppState> {
    STATE.get_or_init(|| {
        Mutex::new(AppState {
            cached_pid: None,
            cached_token: None,
            cached_port: None,
            last_status: None,
            monitored_model: None,
            poll_interval_secs: 30,
        })
    })
}

#[tauri::command]
fn get_quota_status() -> Option<FullStatus> {
    let state = get_state().lock().unwrap();
    state.last_status.clone()
}

#[tauri::command]
async fn force_refresh(app_handle: tauri::AppHandle) -> Option<FullStatus> {
    let _ = poll_and_update_tray(&app_handle).await;
    let state = get_state().lock().unwrap();
    state.last_status.clone()
}

#[tauri::command]
fn set_monitored_model(model: String) {
    let mut state = get_state().lock().unwrap();
    state.monitored_model = Some(model);
}

#[tauri::command]
fn set_poll_interval(seconds: u64) {
    let mut state = get_state().lock().unwrap();
    state.poll_interval_secs = seconds;
}

#[tauri::command]
fn is_debug() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
async fn execute_update(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("User-Agent", "antigravity-quota-quickcheck")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Failed to download update: status {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    let file_name = if cfg!(target_os = "windows") {
        "update_setup.exe"
    } else {
        "update.deb"
    };

    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join(file_name);

    std::fs::write(&temp_file_path, bytes).map_err(|e| e.to_string())?;

    // Execute the installer
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&temp_file_path)
            .arg("/UPDATE")
            .spawn()
            .map_err(|e| e.to_string())?;

        // Exit the app so the installer can overwrite it
        app_handle.exit(0);
    }

    #[cfg(target_os = "linux")]
    {
        // Try opening with xdg-open so the system package manager handles it
        std::process::Command::new("xdg-open")
            .arg(&temp_file_path)
            .spawn()
            .map_err(|e| e.to_string())?;

        app_handle.exit(0);
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = app_handle;
        return Err("Unsupported OS for auto update".to_string());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn scan_processes() -> Option<(u32, String)> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Where-Object {$_.Name -like '*language_server*'} | Select-Object ProcessId,CommandLine | ConvertTo-Json"
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }

    let json_val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let processes = if let Some(arr) = json_val.as_array() {
        arr.clone()
    } else {
        vec![json_val]
    };

    let token_re = regex::Regex::new(r"--csrf[_-]?token[=\s]+([a-f0-9-]+)").ok()?;
    for proc in processes {
        let cmd_line = proc.get("CommandLine").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(caps) = token_re.captures(cmd_line) {
            let token = caps.get(1)?.as_str().to_string();
            let pid = proc.get("ProcessId").and_then(|v| v.as_u64()).map(|v| v as u32)?;
            return Some((pid, token));
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn scan_processes() -> Option<(u32, String)> {
    let output = Command::new("sh")
        .args(["-c", "ps -axo pid,args | grep -i language_server | grep -v grep"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines = stdout.trim().lines();
    let token_re = regex::Regex::new(r"--csrf[_-]?token[=\s]+([a-f0-9-]+)").ok()?;
    for line in lines {
        if let Some(caps) = token_re.captures(line) {
            let token = caps.get(1)?.as_str().to_string();
            let pid_str = line.trim().split_whitespace().next()?;
            let pid = pid_str.parse::<u32>().ok()?;
            return Some((pid, token));
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn scan_port(pid: u32) -> Option<u16> {
    let cmd = format!(
        "Get-NetTCPConnection -OwningProcess {} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort",
        pid
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &cmd])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let port_str = stdout.trim().lines().next()?.trim();
    port_str.parse::<u16>().ok()
}

#[cfg(target_os = "macos")]
fn scan_port(pid: u32) -> Option<u16> {
    let cmd = format!(
        "lsof -iTCP -sTCP:LISTEN -a -p {} -Fn 2>/dev/null | grep '^n' | sed 's/n\\*://'",
        pid
    );
    let output = Command::new("sh")
        .args(["-c", &cmd])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let port_str = stdout.trim().lines().next()?.trim();
    port_str.parse::<u16>().ok()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn scan_port(pid: u32) -> Option<u16> {
    let cmd = format!("ss -tlnpH 2>/dev/null | grep -F \"pid={},\"", pid);
    let output = Command::new("sh")
        .args(["-c", &cmd])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim().lines().next()?;
    let port_re = regex::Regex::new(r"(?:^|:)(\d+)(?:\s|$)").ok()?;
    let caps = port_re.captures(line)?;
    caps.get(1)?.as_str().parse::<u16>().ok()
}

async fn query_server(port: u16, token: &str, path: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "http://127.0.0.1:{}{}",
        port, path
    );
    let payload = serde_json::json!({
        "metadata": { "ideName": "antigravity" }
    });

    let res = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Connect-Protocol-Version", "1")
        .header("X-Codeium-Csrf-Token", token)
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(r) => {
            if r.status().is_success() {
                r.json::<serde_json::Value>()
                    .await
                    .map_err(|e| e.to_string())
            } else {
                Err(format!("HTTP status: {}", r.status()))
            }
        }
        Err(e) => {
            let err_msg = e.to_string().to_lowercase();
            if err_msg.contains("http instead of https")
                || err_msg.contains("wrong version number")
                || err_msg.contains("client sent an http request to an https server")
            {
                let https_client = reqwest::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .build()
                    .map_err(|e| e.to_string())?;

                let https_url = format!(
                    "https://127.0.0.1:{}{}",
                    port, path
                );
                let https_res = https_client
                    .post(&https_url)
                    .header("Content-Type", "application/json")
                    .header("Connect-Protocol-Version", "1")
                    .header("X-Codeium-Csrf-Token", token)
                    .json(&payload)
                    .send()
                    .await;

                match https_res {
                    Ok(r) => {
                        if r.status().is_success() {
                            r.json::<serde_json::Value>()
                                .await
                                .map_err(|inner| inner.to_string())
                        } else {
                            Err(format!("HTTPS status: {}", r.status()))
                        }
                    }
                    Err(inner) => Err(inner.to_string()),
                }
            } else {
                Err(e.to_string())
            }
        }
    }
}

async fn fetch_full_status_internal() -> Result<FullStatus, String> {
    let (mut pid, mut token, mut port) = {
        let state = get_state().lock().unwrap();
        (
            state.cached_pid,
            state.cached_token.clone(),
            state.cached_port,
        )
    };

    let mut raw_data = None;
    let mut raw_quota_summary = None;

    if let (Some(_p), Some(t), Some(po)) = (pid, &token, port) {
        if let Ok(data) = query_server(po, t, "/exa.language_server_pb.LanguageServerService/GetUserStatus").await {
            raw_data = Some(data);
            raw_quota_summary = query_server(po, t, "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary").await.ok();
        }
    }

    if raw_data.is_none() {
        if let Some((p, t)) = scan_processes() {
            if let Some(po) = scan_port(p) {
                if let Ok(data) = query_server(po, &t, "/exa.language_server_pb.LanguageServerService/GetUserStatus").await {
                    pid = Some(p);
                    token = Some(t);
                    port = Some(po);

                    {
                        let mut state = get_state().lock().unwrap();
                        state.cached_pid = pid;
                        state.cached_token = token.clone();
                        state.cached_port = port;
                    }

                    raw_data = Some(data);
                    raw_quota_summary = query_server(po, token.as_deref().unwrap(), "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary").await.ok();
                }
            }
        }
    }

    let raw = raw_data.ok_or_else(|| "Could not fetch data from server".to_string())?;
    let mut new_status = parse_full_status(raw, raw_quota_summary.unwrap_or(serde_json::Value::Null))?;

    // Sync recently_used_model with the user's chosen monitored model
    let chosen_model = {
        let state = get_state().lock().unwrap();
        state.monitored_model.clone()
    };

    if let Some(ref model) = chosen_model {
        if new_status.quotas.iter().any(|q| &q.model == model) {
            new_status.recently_used_model = Some(model.clone());
        }
    }

    Ok(new_status)
}

fn parse_full_status(raw: serde_json::Value, quota_summary: serde_json::Value) -> Result<FullStatus, String> {
    let mut credits = None;
    let credit_info_raw = raw.pointer("/userStatus/userInfo/creditInfo");
    let alt_credit_info_raw = raw.pointer("/userStatus/userTier/availableCredits/0");
    let src = credit_info_raw.or(alt_credit_info_raw);

    if let Some(s) = src {
        let balance = s
            .get("currentBalance")
            .or(s.get("balance"))
            .or(s.get("creditAmount"))
            .and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_str().and_then(|st| st.parse::<f64>().ok()))
                    .or_else(|| v.as_i64().map(|i| i as f64))
            })
            .unwrap_or(0.0);
        let credit_type = s
            .get("creditType")
            .or(s.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN")
            .to_string();
        credits = Some(CreditInfo {
            balance,
            credit_type,
        });
    }

    let plan_tier = raw
        .pointer("/userStatus/userTier/name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Helper structure to keep track of parsed groups/buckets
    #[derive(Debug, Clone)]
    struct ParsedBucket {
        window: String,
        remaining_fraction: f64,
        reset_time: String,
        disabled: bool,
    }

    #[derive(Debug, Clone)]
    struct ParsedGroup {
        display_name: String,
        description: String,
        buckets: Vec<ParsedBucket>,
    }

    let mut groups = Vec::new();
    if let Some(groups_arr) = quota_summary.pointer("/response/groups").and_then(|v| v.as_array()) {
        for g in groups_arr {
            let group_name = g.get("displayName").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let desc = g.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut buckets = Vec::new();
            if let Some(buckets_arr) = g.get("buckets").and_then(|v| v.as_array()) {
                for b in buckets_arr {
                    let win = b.get("window").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let remaining = b.get("remainingFraction").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let reset = b.get("resetTime").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let disabled = b.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    buckets.push(ParsedBucket {
                        window: win,
                        remaining_fraction: remaining,
                        reset_time: reset,
                        disabled,
                    });
                }
            }
            groups.push(ParsedGroup {
                display_name: group_name,
                description: desc,
                buckets,
            });
        }
    }

    let mut quotas = Vec::new();
    if let Some(configs) = raw
        .pointer("/userStatus/cascadeModelConfigData/clientModelConfigs")
        .and_then(|v| v.as_array())
    {
        for config in configs {
            let label = match config.get("label").and_then(|v| v.as_str()) {
                Some(l) => l.to_string(),
                None => continue,
            };

            let mut five_hour_percent = 100;
            let mut five_hour_reset = "".to_string();
            let mut five_hour_disabled = false;
            let mut weekly_percent = 100;
            let mut weekly_reset = "".to_string();
            let mut weekly_disabled = false;

            let model_lower = label.to_lowercase();
            let matched_group = groups.iter().find(|g| {
                if model_lower.contains("gemini") {
                    g.display_name.to_lowercase().contains("gemini")
                } else if model_lower.contains("claude") || model_lower.contains("gpt") {
                    g.display_name.to_lowercase().contains("claude") || g.display_name.to_lowercase().contains("gpt")
                } else {
                    g.description.to_lowercase().contains(&model_lower) || g.display_name.to_lowercase().contains(&model_lower)
                }
            });

            if let Some(g) = matched_group {
                for b in &g.buckets {
                    let pct = (b.remaining_fraction.clamp(0.0, 1.0) * 100.0).round() as u32;
                    if b.window == "5h" {
                        five_hour_percent = pct;
                        five_hour_reset = b.reset_time.clone();
                        five_hour_disabled = b.disabled;
                    } else if b.window == "weekly" {
                        weekly_percent = pct;
                        weekly_reset = b.reset_time.clone();
                        weekly_disabled = b.disabled;
                    }
                }
            } else {
                // Fallback
                if let Some(quota_info) = config.get("quotaInfo") {
                    if let Some(fraction) = quota_info.get("remainingFraction").and_then(|v| v.as_f64()) {
                        let pct = (fraction.clamp(0.0, 1.0) * 100.0).round() as u32;
                        five_hour_percent = pct;
                        weekly_percent = pct;
                    }
                    if let Some(reset_time) = quota_info.get("resetTime").and_then(|v| v.as_str()) {
                        five_hour_reset = reset_time.to_string();
                        weekly_reset = reset_time.to_string();
                    }
                }
            }

            if weekly_percent == 0 {
                five_hour_percent = 0;
            }

            let percent = five_hour_percent;
            let refresh_time = if five_hour_reset.is_empty() {
                "Exhausted".to_string()
            } else {
                five_hour_reset.clone()
            };

            quotas.push(QuotaData {
                model: label,
                percent,
                refresh_time,
                five_hour_percent,
                five_hour_reset,
                five_hour_disabled,
                weekly_percent,
                weekly_reset,
                weekly_disabled,
            });
        }
    }

    // Sort descending by percentage, with alphabetical model name as stable tie-breaker
    quotas.sort_by(|a, b| {
        let cmp = b.percent.cmp(&a.percent);
        if cmp == std::cmp::Ordering::Equal {
            a.model.cmp(&b.model)
        } else {
            cmp
        }
    });

    let recently_used_model = quotas.first().map(|q| q.model.clone());

    Ok(FullStatus {
        credits,
        quotas,
        plan_tier,
        recently_used_model,
    })
}

fn build_bar(percent: u32, total: usize) -> String {
    let filled = ((percent as f32 / 100.0) * total as f32).round() as usize;
    let filled_str = "█".repeat(filled);
    let empty_str = "░".repeat(total - filled);
    format!("{}{}", filled_str, empty_str)
}

fn format_tooltip(status: &FullStatus) -> String {
    let active_model = {
        let state = get_state().lock().unwrap();
        state.monitored_model.clone()
    };

    let active_quota = if let Some(model_name) = &active_model {
        status.quotas.iter().find(|q| q.model == *model_name)
    } else {
        status.quotas.first()
    };

    match active_quota {
        Some(q) => {
            let five_hour_bar = build_bar(q.five_hour_percent, 4);
            let weekly_bar = build_bar(q.weekly_percent, 4);
            format!(
                "{}\n5h: {} {}%\nwk: {} {}%",
                q.model,
                five_hour_bar,
                q.five_hour_percent,
                weekly_bar,
                q.weekly_percent
            )
        }
        None => "Antigravity Quota Quickcheck".to_string(),
    }
}

async fn poll_and_update_tray(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let res = fetch_full_status_internal().await;
    match res {
        Ok(status) => {
            {
                let mut state = get_state().lock().unwrap();
                state.last_status = Some(status.clone());
            }
            let _ = app_handle.emit("status-updated", &status);
            let tooltip = format_tooltip(&status);
            if let Some(tray) = app_handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(tooltip));
            }
            Ok(())
        }
        Err(_) => {
            let _ = app_handle.emit("status-updated", serde_json::Value::Null);
            if let Some(tray) = app_handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(
                    "Antigravity Quota Quickcheck: offline\n⚠️ Language server not reachable.".to_string(),
                ));
            }
            Err("Offline".to_string())
        }
    }
}

fn position_window(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let monitor_size = monitor.size();
        let monitor_pos = monitor.position();
        let scale_factor = monitor.scale_factor();

        let win_w = (680.0 * scale_factor) as i32;
        let win_h = (650.0 * scale_factor) as i32;
        let padding = (12.0 * scale_factor) as i32;
        let taskbar_h = (48.0 * scale_factor) as i32;

        let x = monitor_pos.x + monitor_size.width as i32 - win_w - padding;
        let y = monitor_pos.y + monitor_size.height as i32 - win_h - taskbar_h - padding;

        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let show = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon_bytes = include_bytes!("../icons/32x32.png");
    let tray_icon = tauri::image::Image::from_bytes(icon_bytes).expect("Failed to load tray icon");

    let _tray = TrayIconBuilder::with_id("main")
        .tooltip("Antigravity Quota Quickcheck")
        .icon(tray_icon)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    position_window(&window);
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("window-shown", true);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, .. } = event {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = window.hide();
                        } else {
                            position_window(&window);
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("window-shown", true);
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                position_window(&window);
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("window-shown", true);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_quota_status,
            force_refresh,
            set_monitored_model,
            set_poll_interval,
            is_debug,
            execute_update
        ])
        .setup(|app| {
            let _ = setup_tray(app.handle());

            // Start background polling thread
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let _ = poll_and_update_tray(&app_handle).await;
                    let interval = {
                        let state = get_state().lock().unwrap();
                        state.poll_interval_secs
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
                }
            });

            // Hide window on blur (focus loss) so it acts like a true popup panel
            let main_window = app.get_webview_window("main").unwrap();
            
            // Set window icon explicitly to bypass cache / packaging issues
            let win_icon_bytes = include_bytes!("../icons/128x128.png");
            if let Ok(win_icon) = tauri::image::Image::from_bytes(win_icon_bytes) {
                let _ = main_window.set_icon(win_icon);
            }

            let w_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = w_clone.hide();
                }
            });

            // Remove Windows DWM 1px system border (Win32 DwmSetWindowAttribute)
            #[cfg(target_os = "windows")]
            {
                use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                let border_window = app.get_webview_window("main").unwrap();
                if let Ok(handle) = border_window.window_handle() {
                    if let RawWindowHandle::Win32(h) = handle.as_raw() {
                        dwm_fix::remove_border(h.hwnd.get() as *mut std::ffi::c_void);
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
