use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;

use crate::{CreditInfo, FullStatus, QuotaData};

use super::{ProviderError, ProviderErrorKind};

const PROVIDER: &str = "language server";

#[derive(Default)]
struct Cache {
    pid: Option<u32>,
    token: Option<String>,
    port: Option<u16>,
}

static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

fn cache() -> &'static Mutex<Cache> {
    CACHE.get_or_init(|| Mutex::new(Cache::default()))
}

#[cfg(target_os = "windows")]
fn scan_processes() -> Option<(u32, String)> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Where-Object {$_.Name -like '*language_server*'} | Select-Object ProcessId,CommandLine | ConvertTo-Json",
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    let processes = value.as_array().cloned().unwrap_or_else(|| vec![value]);
    let token_re = regex::Regex::new(r"--csrf[_-]?token[=\s]+([a-f0-9-]+)").ok()?;
    for process in processes {
        let command_line = process.get("CommandLine").and_then(Value::as_str).unwrap_or("");
        if let Some(captures) = token_re.captures(command_line) {
            let token = captures.get(1)?.as_str().to_string();
            let pid = process.get("ProcessId").and_then(Value::as_u64)? as u32;
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
    let token_re = regex::Regex::new(r"--csrf[_-]?token[=\s]+([a-f0-9-]+)").ok()?;
    for line in stdout.trim().lines() {
        if let Some(captures) = token_re.captures(line) {
            let token = captures.get(1)?.as_str().to_string();
            let pid = line.trim().split_whitespace().next()?.parse::<u32>().ok()?;
            return Some((pid, token));
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn scan_port(pid: u32) -> Option<u16> {
    let command = format!(
        "Get-NetTCPConnection -OwningProcess {} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort",
        pid
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()?
        .trim()
        .parse::<u16>()
        .ok()
}

#[cfg(target_os = "macos")]
fn scan_port(pid: u32) -> Option<u16> {
    let command = format!(
        "lsof -iTCP -sTCP:LISTEN -a -p {} -Fn 2>/dev/null | grep '^n' | sed 's/n\\*://'",
        pid
    );
    let output = Command::new("sh").args(["-c", &command]).output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()?
        .trim()
        .parse::<u16>()
        .ok()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn scan_port(pid: u32) -> Option<u16> {
    let command = format!("ss -tlnpH 2>/dev/null | grep -F \"pid={},\"", pid);
    let output = Command::new("sh").args(["-c", &command]).output().ok()?;
    let line = String::from_utf8_lossy(&output.stdout).trim().lines().next()?.to_string();
    let port_re = regex::Regex::new(r"(?:^|:)(\d+)(?:\s|$)").ok()?;
    port_re.captures(&line)?.get(1)?.as_str().parse::<u16>().ok()
}

async fn query_server(port: u16, token: &str, path: &str) -> Result<Value, ProviderError> {
    let payload = serde_json::json!({"metadata": {"ideName": "antigravity"}});
    let url = format!("http://127.0.0.1:{port}{path}");
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Connect-Protocol-Version", "1")
        .header("X-Codeium-Csrf-Token", token)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "language server returned invalid JSON")),
        Ok(response) => Err(ProviderError::new(
            PROVIDER,
            ProviderErrorKind::Transient,
            format!("language server returned HTTP {}", response.status().as_u16()),
        )),
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("http instead of https")
                || message.contains("wrong version number")
                || message.contains("client sent an http request to an https server")
            {
                let https_client = reqwest::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .build()
                    .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Transient, "could not initialize loopback HTTPS client"))?;
                let https_url = format!("https://127.0.0.1:{port}{path}");
                let response = https_client
                    .post(https_url)
                    .header("Content-Type", "application/json")
                    .header("Connect-Protocol-Version", "1")
                    .header("X-Codeium-Csrf-Token", token)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Transient, "language server HTTPS request failed"))?;
                if !response.status().is_success() {
                    return Err(ProviderError::new(
                        PROVIDER,
                        ProviderErrorKind::Transient,
                        format!("language server HTTPS returned HTTP {}", response.status().as_u16()),
                    ));
                }
                response
                    .json::<Value>()
                    .await
                    .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "language server returned invalid JSON"))
            } else {
                Err(ProviderError::new(PROVIDER, ProviderErrorKind::Transient, "language server request failed"))
            }
        }
    }
}

pub async fn fetch() -> Result<FullStatus, ProviderError> {
    let (cached_token, cached_port) = {
        let state = cache().lock().unwrap();
        (state.token.clone(), state.port)
    };

    if let (Some(token), Some(port)) = (cached_token, cached_port) {
        if let Ok(raw) = query_server(port, &token, "/exa.language_server_pb.LanguageServerService/GetUserStatus").await {
            let summary = query_server(
                port,
                &token,
                "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary",
            )
            .await
            .unwrap_or(Value::Null);
            return parse_full_status(raw, summary);
        }
    }

    let (pid, token) = scan_processes()
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "language server process was not found"))?;
    let port = scan_port(pid)
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "language server listening port was not found"))?;
    let raw = query_server(port, &token, "/exa.language_server_pb.LanguageServerService/GetUserStatus").await?;
    let summary = query_server(
        port,
        &token,
        "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary",
    )
    .await
    .unwrap_or(Value::Null);
    {
        let mut state = cache().lock().unwrap();
        state.pid = Some(pid);
        state.token = Some(token);
        state.port = Some(port);
    }
    parse_full_status(raw, summary)
}

fn parse_full_status(raw: Value, quota_summary: Value) -> Result<FullStatus, ProviderError> {
    let credits = raw
        .pointer("/userStatus/userInfo/creditInfo")
        .or_else(|| raw.pointer("/userStatus/userTier/availableCredits/0"))
        .map(|source| {
            let balance = source
                .get("currentBalance")
                .or_else(|| source.get("balance"))
                .or_else(|| source.get("creditAmount"))
                .and_then(number_value)
                .unwrap_or(0.0);
            let credit_type = source
                .get("creditType")
                .or_else(|| source.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("UNKNOWN")
                .to_string();
            CreditInfo { balance, credit_type }
        });

    let plan_tier = raw
        .pointer("/userStatus/userTier/name")
        .and_then(Value::as_str)
        .map(str::to_string);

    #[derive(Clone)]
    struct Bucket {
        window: String,
        remaining_fraction: f64,
        reset_time: String,
        disabled: bool,
    }
    #[derive(Clone)]
    struct Group {
        display_name: String,
        description: String,
        buckets: Vec<Bucket>,
    }

    let groups: Vec<Group> = quota_summary
        .pointer("/response/groups")
        .and_then(Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .map(|group| Group {
                    display_name: group.get("displayName").and_then(Value::as_str).unwrap_or("").to_string(),
                    description: group.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
                    buckets: group
                        .get("buckets")
                        .and_then(Value::as_array)
                        .map(|buckets| {
                            buckets
                                .iter()
                                .map(|bucket| Bucket {
                                    window: bucket.get("window").and_then(Value::as_str).unwrap_or("").to_string(),
                                    remaining_fraction: bucket.get("remainingFraction").and_then(Value::as_f64).unwrap_or(1.0),
                                    reset_time: bucket.get("resetTime").and_then(Value::as_str).unwrap_or("").to_string(),
                                    disabled: bucket.get("disabled").and_then(Value::as_bool).unwrap_or(false),
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();

    let mut quotas = Vec::new();
    if let Some(configs) = raw
        .pointer("/userStatus/cascadeModelConfigData/clientModelConfigs")
        .and_then(Value::as_array)
    {
        for config in configs {
            let Some(label) = config.get("label").and_then(Value::as_str) else { continue };
            let lower = label.to_lowercase();
            let matched_group = groups.iter().find(|group| {
                let group_name = group.display_name.to_lowercase();
                if lower.contains("gemini") {
                    group_name.contains("gemini")
                } else if lower.contains("claude") || lower.contains("gpt") || lower.contains("openai") {
                    group_name.contains("claude") || group_name.contains("gpt") || group_name.contains("openai")
                } else {
                    group.description.to_lowercase().contains(&lower) || group_name.contains(&lower)
                }
            });

            let mut five_hour_percent = 100;
            let mut five_hour_reset = String::new();
            let mut five_hour_disabled = false;
            let mut weekly_percent = 100;
            let mut weekly_reset = String::new();
            let mut weekly_disabled = false;

            if let Some(group) = matched_group {
                for bucket in &group.buckets {
                    let percent = (bucket.remaining_fraction.clamp(0.0, 1.0) * 100.0).round() as u32;
                    if bucket.window == "5h" {
                        five_hour_percent = percent;
                        five_hour_reset = bucket.reset_time.clone();
                        five_hour_disabled = bucket.disabled;
                    } else if bucket.window == "weekly" {
                        weekly_percent = percent;
                        weekly_reset = bucket.reset_time.clone();
                        weekly_disabled = bucket.disabled;
                    }
                }
            } else if let Some(quota_info) = config.get("quotaInfo") {
                if let Some(fraction) = quota_info.get("remainingFraction").and_then(Value::as_f64) {
                    let percent = (fraction.clamp(0.0, 1.0) * 100.0).round() as u32;
                    five_hour_percent = percent;
                    weekly_percent = percent;
                }
                if let Some(reset) = quota_info.get("resetTime").and_then(Value::as_str) {
                    five_hour_reset = reset.to_string();
                    weekly_reset = reset.to_string();
                }
            }

            if weekly_percent == 0 {
                five_hour_percent = 0;
            }
            quotas.push(QuotaData {
                model: label.to_string(),
                percent: five_hour_percent,
                refresh_time: if five_hour_reset.is_empty() { "Exhausted".to_string() } else { five_hour_reset.clone() },
                five_hour_percent,
                five_hour_reset,
                five_hour_disabled,
                weekly_percent,
                weekly_reset,
                weekly_disabled,
            });
        }
    }

    let mut grouped = Vec::new();
    if let Some(quota) = quotas.iter().find(|quota| quota.model.to_lowercase().contains("gemini")) {
        let mut quota = quota.clone();
        quota.model = "Gemini".to_string();
        grouped.push(quota);
    }
    if let Some(quota) = quotas.iter().find(|quota| {
        let model = quota.model.to_lowercase();
        model.contains("claude") || model.contains("gpt") || model.contains("openai")
    }) {
        let mut quota = quota.clone();
        quota.model = "Claude & OpenAI".to_string();
        grouped.push(quota);
    }

    let recently_used_model = grouped.first().map(|quota| quota.model.clone());
    Ok(FullStatus {
        credits,
        quotas: grouped,
        plan_tier,
        recently_used_model,
    })
}

fn number_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|number| number as f64))
        .or_else(|| value.as_str()?.parse::<f64>().ok())
}
