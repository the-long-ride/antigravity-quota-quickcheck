use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::process::Command;

use crate::{FullStatus, QuotaData};

use super::credentials::find_agy_binary;
use super::process::hide_tokio_command;
use super::{is_usable_status, ProviderError, ProviderErrorKind};

const PROVIDER: &str = "agy CLI";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Default)]
struct WindowValue {
    percent: u32,
    reset: String,
    present: bool,
}

#[derive(Default)]
struct ProviderWindows {
    five_hour: WindowValue,
    weekly: WindowValue,
}

pub fn parse_quota_envelope(raw: &str) -> Result<FullStatus, ProviderError> {
    let root: Value = serde_json::from_str(raw)
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "quota output was not valid JSON"))?;
    let data = root
        .pointer("/command/data")
        .or_else(|| root.get("data"))
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "quota JSON did not contain command.data"))?;
    let groups = data
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "quota JSON did not contain command.data.groups"))?;

    let mut gemini = ProviderWindows::default();
    let mut shared = ProviderWindows::default();
    let mut saw_recognized_group = false;

    for group in groups {
        let name = group
            .get("name")
            .or_else(|| group.get("displayName"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();
        let target = if name.contains("gemini") {
            saw_recognized_group = true;
            Some(&mut gemini)
        } else if name.contains("claude") || name.contains("gpt") || name.contains("openai") {
            saw_recognized_group = true;
            Some(&mut shared)
        } else {
            None
        };
        let Some(target) = target else { continue };
        let Some(buckets) = group.get("buckets").and_then(Value::as_array) else { continue };
        for bucket in buckets {
            let window = window_name(bucket);
            let Some(percent) = remaining_percent(bucket) else { continue };
            let reset = reset_time(bucket).unwrap_or_default();
            if is_five_hour_window(&window) {
                assign_window(&mut target.five_hour, percent, reset);
            } else if is_weekly_window(&window) {
                assign_window(&mut target.weekly, percent, reset);
            }
        }
    }

    if !saw_recognized_group {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "quota JSON contained no recognized provider groups"));
    }

    let plan_tier = data
        .get("planTier")
        .or_else(|| data.get("plan_tier"))
        .or_else(|| data.get("tier"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let status = FullStatus {
        credits: None,
        quotas: vec![build_card("Gemini", gemini), build_card("Claude & OpenAI", shared)],
        plan_tier,
        recently_used_model: None,
    };
    Ok(status)
}

fn build_card(model: &str, windows: ProviderWindows) -> QuotaData {
    let (percent, refresh_time) = if windows.five_hour.present {
        (windows.five_hour.percent, windows.five_hour.reset.clone())
    } else if windows.weekly.present {
        (windows.weekly.percent, windows.weekly.reset.clone())
    } else {
        (0, String::new())
    };
    QuotaData {
        model: model.to_string(),
        percent,
        refresh_time,
        five_hour_percent: windows.five_hour.percent,
        five_hour_reset: windows.five_hour.reset,
        five_hour_disabled: !windows.five_hour.present,
        weekly_percent: windows.weekly.percent,
        weekly_reset: windows.weekly.reset,
        weekly_disabled: !windows.weekly.present,
    }
}

fn assign_window(slot: &mut WindowValue, percent: u32, reset: String) {
    if !slot.present || percent < slot.percent {
        slot.percent = percent;
        slot.reset = reset;
        slot.present = true;
    }
}

fn window_name(bucket: &Value) -> String {
    bucket
        .get("window")
        .or_else(|| bucket.get("name"))
        .or_else(|| bucket.get("label"))
        .or_else(|| bucket.get("duration"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_lowercase()
}

fn is_five_hour_window(window: &str) -> bool {
    let compact: String = window.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '_').collect();
    compact == "5h" || compact.contains("5hour") || compact.contains("fivehour")
}

fn is_weekly_window(window: &str) -> bool {
    window.contains("week") || window == "7d"
}

fn remaining_percent(bucket: &Value) -> Option<u32> {
    for key in ["remainingFraction", "remaining_fraction"] {
        if let Some(value) = bucket.get(key).and_then(number_value) {
            return Some((value.clamp(0.0, 1.0) * 100.0).round() as u32);
        }
    }
    for key in ["percentRemaining", "percent_remaining", "remainingPercent", "remaining_percent"] {
        if let Some(value) = bucket.get(key).and_then(number_value) {
            return Some(value.clamp(0.0, 100.0).round() as u32);
        }
    }
    None
}

fn number_value(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse::<f64>().ok())
}

fn reset_time(bucket: &Value) -> Option<String> {
    bucket
        .get("resetTime")
        .or_else(|| bucket.get("reset_time"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub async fn fetch() -> Result<FullStatus, ProviderError> {
    let binary = find_agy_binary()
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "agy executable was not found"))?;

    let mut last_error = None;
    for command in ["/usage", "/quota"] {
        match run_structured_command(&binary, command).await {
            Ok(stdout) => match parse_quota_envelope(&stdout) {
                Ok(status) if is_usable_status(&status) => return Ok(status),
                Ok(_) => {
                    last_error = Some(ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "agy returned an empty quota snapshot"));
                }
                Err(error) => last_error = Some(error),
            },
            Err(error) if error.kind == ProviderErrorKind::Auth || error.kind == ProviderErrorKind::Transient => {
                return Err(error);
            }
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Unsupported, "agy did not expose a structured quota command")))
}

async fn run_structured_command(binary: &std::path::Path, slash_command: &str) -> Result<String, ProviderError> {
    let mut command = Command::new(binary);
    hide_tokio_command(&mut command);
    command
        .args(["-p", slash_command, "--output-format", "json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = tokio::time::timeout(COMMAND_TIMEOUT, command.output())
        .await
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Transient, "agy quota command timed out"))?
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "failed to start agy"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        if stdout.trim().is_empty() {
            return Err(ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "agy returned empty structured output"));
        }
        return Ok(stdout);
    }

    let combined = format!("{} {}", stderr, stdout).to_lowercase();
    let kind = if combined.contains("login")
        || combined.contains("sign in")
        || combined.contains("sign-in")
        || combined.contains("auth")
        || combined.contains("credential")
    {
        ProviderErrorKind::Auth
    } else if combined.contains("unknown command")
        || combined.contains("unexpected arguments")
        || combined.contains("flags provided but not defined")
        || combined.contains("unknown flag")
        || combined.contains("not defined")
    {
        ProviderErrorKind::Unsupported
    } else if combined.contains("timeout")
        || combined.contains("network")
        || combined.contains("connection")
        || combined.contains("temporar")
    {
        ProviderErrorKind::Transient
    } else {
        ProviderErrorKind::Unsupported
    };
    Err(ProviderError::new(PROVIDER, kind, format!("agy could not run structured {slash_command}")))
}
