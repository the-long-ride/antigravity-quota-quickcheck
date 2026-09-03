use super::ProviderError;
use crate::{CreditInfo, FullStatus, QuotaData};
use serde_json::Value;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Connection {
    pub pid: u32,
    pub token: String,
    pub port: u16,
}

pub async fn fetch(cached: Option<Connection>) -> Result<(FullStatus, Connection), ProviderError> {
    if let Some(connection) = cached {
        if let Ok(status) = fetch_from_connection(&connection).await {
            return Ok((status, connection));
        }
    }

    let (pid, token) = scan_processes().ok_or_else(|| {
        ProviderError::Unavailable("Antigravity language server process was not found".to_string())
    })?;
    let port = scan_port(pid).ok_or_else(|| {
        ProviderError::Unavailable("Antigravity language server port was not found".to_string())
    })?;
    let connection = Connection { pid, token, port };
    let status = fetch_from_connection(&connection).await?;
    Ok((status, connection))
}

async fn fetch_from_connection(connection: &Connection) -> Result<FullStatus, ProviderError> {
    let raw = query_server(
        connection.port,
        &connection.token,
        "/exa.language_server_pb.LanguageServerService/GetUserStatus",
    )
    .await
    .map_err(|_| {
        ProviderError::Transient("language server user-status query failed".to_string())
    })?;
    let quota_summary = query_server(
        connection.port,
        &connection.token,
        "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary",
    )
    .await
    .unwrap_or(Value::Null);

    parse_full_status(raw, quota_summary)
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

    let json_val: Value = serde_json::from_str(trimmed).ok()?;
    let processes = if let Some(arr) = json_val.as_array() {
        arr.clone()
    } else {
        vec![json_val]
    };

    let token_re = regex::Regex::new(r"--csrf[_-]?token[=\s]+([a-f0-9-]+)").ok()?;
    for process in processes {
        let cmd_line = process
            .get("CommandLine")
            .and_then(Value::as_str)
            .unwrap_or("");
        if let Some(caps) = token_re.captures(cmd_line) {
            let token = caps.get(1)?.as_str().to_string();
            let pid = process
                .get("ProcessId")
                .and_then(Value::as_u64)
                .map(|value| value as u32)?;
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
        if let Some(caps) = token_re.captures(line) {
            let token = caps.get(1)?.as_str().to_string();
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
    let output = Command::new("sh")
        .args(["-c", &command])
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

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn scan_port(pid: u32) -> Option<u16> {
    let command = format!("ss -tlnpH 2>/dev/null | grep -F \"pid={},\"", pid);
    let output = Command::new("sh")
        .args(["-c", &command])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim().lines().next()?;
    let port_re = regex::Regex::new(r"(?:^|:)(\d+)(?:\s|$)").ok()?;
    port_re
        .captures(line)?
        .get(1)?
        .as_str()
        .parse::<u16>()
        .ok()
}

async fn query_server(port: u16, token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}{path}");
    let payload = serde_json::json!({
        "metadata": { "ideName": "antigravity" }
    });

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
            .map_err(|error| error.to_string()),
        Ok(response) => Err(format!("HTTP status: {}", response.status())),
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("http instead of https")
                || message.contains("wrong version number")
                || message.contains("client sent an http request to an https server")
            {
                let https_client = reqwest::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .build()
                    .map_err(|error| error.to_string())?;
                let https_url = format!("https://127.0.0.1:{port}{path}");
                let response = https_client
                    .post(&https_url)
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
                        .map_err(|inner| inner.to_string()),
                    Ok(response) => Err(format!("HTTPS status: {}", response.status())),
                    Err(inner) => Err(inner.to_string()),
                }
            } else {
                Err(error.to_string())
            }
        }
    }
}

pub fn parse_full_status(raw: Value, quota_summary: Value) -> Result<FullStatus, ProviderError> {
    let mut credits = None;
    let credit_info_raw = raw.pointer("/userStatus/userInfo/creditInfo");
    let alt_credit_info_raw = raw.pointer("/userStatus/userTier/availableCredits/0");
    if let Some(source) = credit_info_raw.or(alt_credit_info_raw) {
        let balance = source
            .get("currentBalance")
            .or(source.get("balance"))
            .or(source.get("creditAmount"))
            .and_then(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
                    .or_else(|| value.as_i64().map(|number| number as f64))
            })
            .unwrap_or(0.0);
        let credit_type = source
            .get("creditType")
            .or(source.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN")
            .to_string();
        credits = Some(CreditInfo {
            balance,
            credit_type,
        });
    }

    let plan_tier = raw
        .pointer("/userStatus/userTier/name")
        .and_then(Value::as_str)
        .map(str::to_string);

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
    if let Some(group_values) = quota_summary
        .pointer("/response/groups")
        .and_then(Value::as_array)
    {
        for group in group_values {
            let display_name = group
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let description = group
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut buckets = Vec::new();
            if let Some(bucket_values) = group.get("buckets").and_then(Value::as_array) {
                for bucket in bucket_values {
                    buckets.push(ParsedBucket {
                        window: bucket
                            .get("window")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        remaining_fraction: bucket
                            .get("remainingFraction")
                            .and_then(Value::as_f64)
                            .unwrap_or(1.0),
                        reset_time: bucket
                            .get("resetTime")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        disabled: bucket
                            .get("disabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    });
                }
            }
            groups.push(ParsedGroup {
                display_name,
                description,
                buckets,
            });
        }
    }

    let mut quotas = Vec::new();
    if let Some(configs) = raw
        .pointer("/userStatus/cascadeModelConfigData/clientModelConfigs")
        .and_then(Value::as_array)
    {
        for config in configs {
            let Some(label) = config.get("label").and_then(Value::as_str) else {
                continue;
            };
            let label = label.to_string();
            let mut five_hour_percent = 100;
            let mut five_hour_reset = String::new();
            let mut five_hour_disabled = false;
            let mut weekly_percent = 100;
            let mut weekly_reset = String::new();
            let mut weekly_disabled = false;

            let model_lower = label.to_lowercase();
            let matched_group = groups.iter().find(|group| {
                let display = group.display_name.to_lowercase();
                if model_lower.contains("gemini") {
                    display.contains("gemini")
                } else if model_lower.contains("claude")
                    || model_lower.contains("gpt")
                    || model_lower.contains("openai")
                {
                    display.contains("claude")
                        || display.contains("gpt")
                        || display.contains("openai")
                } else {
                    group.description.to_lowercase().contains(&model_lower)
                        || display.contains(&model_lower)
                }
            });

            if let Some(group) = matched_group {
                for bucket in &group.buckets {
                    let percent =
                        (bucket.remaining_fraction.clamp(0.0, 1.0) * 100.0).round() as u32;
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
                if let Some(fraction) = quota_info
                    .get("remainingFraction")
                    .and_then(Value::as_f64)
                {
                    let percent = (fraction.clamp(0.0, 1.0) * 100.0).round() as u32;
                    five_hour_percent = percent;
                    weekly_percent = percent;
                }
                if let Some(reset_time) = quota_info.get("resetTime").and_then(Value::as_str) {
                    five_hour_reset = reset_time.to_string();
                    weekly_reset = reset_time.to_string();
                }
            }

            if weekly_percent == 0 {
                five_hour_percent = 0;
            }

            let refresh_time = if five_hour_reset.is_empty() {
                "Exhausted".to_string()
            } else {
                five_hour_reset.clone()
            };
            quotas.push(QuotaData {
                model: label,
                percent: five_hour_percent,
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

    let mut grouped_quotas = Vec::new();
    if let Some(quota) = quotas
        .iter()
        .find(|quota| quota.model.to_lowercase().contains("gemini"))
    {
        let mut grouped = quota.clone();
        grouped.model = "Gemini".to_string();
        grouped_quotas.push(grouped);
    }
    if let Some(quota) = quotas.iter().find(|quota| {
        let model = quota.model.to_lowercase();
        model.contains("claude") || model.contains("gpt") || model.contains("openai")
    }) {
        let mut grouped = quota.clone();
        grouped.model = "Claude & OpenAI".to_string();
        grouped_quotas.push(grouped);
    }

    let recently_used_model = grouped_quotas.first().map(|quota| quota.model.clone());
    Ok(FullStatus {
        credits,
        quotas: grouped_quotas,
        plan_tier,
        recently_used_model,
    })
}
