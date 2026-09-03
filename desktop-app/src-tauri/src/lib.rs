use std::sync::{Mutex, OnceLock};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

mod quota;

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

async fn fetch_full_status_internal() -> Result<FullStatus, String> {
    let (cached_connection, monitored_model) = {
        let state = get_state().lock().unwrap();
        let cached_connection = match (
            state.cached_pid,
            state.cached_token.clone(),
            state.cached_port,
        ) {
            (Some(pid), Some(token), Some(port)) => {
                Some(quota::language_server::Connection { pid, token, port })
            }
            _ => None,
        };
        (cached_connection, state.monitored_model.clone())
    };

    let language_server = async move {
        let (status, connection) = quota::language_server::fetch(cached_connection).await?;
        {
            let mut state = get_state().lock().unwrap();
            state.cached_pid = Some(connection.pid);
            state.cached_token = Some(connection.token);
            state.cached_port = Some(connection.port);
        }
        Ok(status)
    };

    let providers: Vec<(quota::ProviderKind, quota::ProviderFuture<'_>)> = vec![
        (quota::ProviderKind::AgyCli, Box::pin(quota::agy_cli::fetch())),
        (
            quota::ProviderKind::CloudCode,
            Box::pin(quota::cloud_code::fetch()),
        ),
        (
            quota::ProviderKind::LanguageServer,
            Box::pin(language_server),
        ),
    ];

    let mut status = quota::run_provider_chain(providers)
        .await
        .map_err(|error| error.to_string())?;

    if let Some(model) = monitored_model {
        if status.quotas.iter().any(|quota| quota.model == model) {
            status.recently_used_model = Some(model);
        }
    }

    Ok(status)
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
                    "Antigravity Quota Quickcheck: offline\n⚠️ No quota provider is reachable."
                        .to_string(),
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
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
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
