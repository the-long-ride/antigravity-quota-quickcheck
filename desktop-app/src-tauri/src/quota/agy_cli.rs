use super::ProviderError;
use crate::{FullStatus, QuotaData};
use serde_json::Value;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(12);

pub fn parse_quota_envelope(raw: &str) -> Result<FullStatus, ProviderError> {
    let parsed: Value = serde_json::from_str(raw)
        .map_err(|_| ProviderError::InvalidData("agy returned invalid JSON".to_string()))?;

    let data = parsed
        .pointer("/command/data")
        .and_then(Value::as_object)
        .ok_or_else(|| ProviderError::InvalidData("agy quota envelope had no command.data".to_string()))?;
    let groups = data
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| ProviderError::InvalidData("agy quota envelope had no groups".to_string()))?;

    let mut gemini = None;
    let mut shared = None;

    for group in groups {
        let name = group
            .get("name")
            .or_else(|| group.get("displayName"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let lower = name.to_ascii_lowercase();
        let model_name = if lower.contains("gemini") {
            "Gemini"
        } else if lower.contains("claude") || lower.contains("gpt") || lower.contains("openai") {
            "Claude & OpenAI"
        } else {
            continue;
        };

        let quota = parse_group(model_name, group);
        if model_name == "Gemini" && gemini.is_none() {
            gemini = Some(quota);
        } else if model_name == "Claude & OpenAI" && shared.is_none() {
            shared = Some(quota);
        }
    }

    let mut quotas = Vec::with_capacity(2);
    if let Some(quota) = gemini {
        quotas.push(quota);
    }
    if let Some(quota) = shared {
        quotas.push(quota);
    }

    if quotas.is_empty() {
        return Err(ProviderError::InvalidData(
            "agy quota envelope contained no supported quota groups".to_string(),
        ));
    }

    let credits = extract_number(
        data.get("availableAICredits")
            .or_else(|| data.get("available_ai_credits")),
    )
    .map(|balance| crate::CreditInfo {
        balance,
        credit_type: "AI_CREDITS".to_string(),
    });

    let plan_tier = data
        .get("planTier")
        .or_else(|| data.get("plan_tier"))
        .or_else(|| data.get("tier"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let recently_used_model = quotas.first().map(|quota| quota.model.clone());
    Ok(FullStatus {
        credits,
        quotas,
        plan_tier,
        recently_used_model,
    })
}

fn parse_group(model: &str, group: &Value) -> QuotaData {
    let mut five_hour_percent = 0;
    let mut five_hour_reset = String::new();
    let mut five_hour_disabled = true;
    let mut weekly_percent = 0;
    let mut weekly_reset = String::new();
    let mut weekly_disabled = true;

    if let Some(buckets) = group.get("buckets").and_then(Value::as_array) {
        for bucket in buckets {
            let window = bucket
                .get("window")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            let fraction = extract_number(
                bucket
                    .get("remaining_fraction")
                    .or_else(|| bucket.get("remainingFraction")),
            );
            let reset = bucket
                .get("reset_time")
                .or_else(|| bucket.get("resetTime"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let disabled = bucket
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            let percent = fraction
                .map(|value| (value.clamp(0.0, 1.0) * 100.0).round() as u32)
                .unwrap_or(0);

            match window.as_str() {
                "5h" => {
                    five_hour_percent = percent;
                    five_hour_reset = reset;
                    five_hour_disabled = disabled || fraction.is_none();
                }
                "weekly" => {
                    weekly_percent = percent;
                    weekly_reset = reset;
                    weekly_disabled = disabled || fraction.is_none();
                }
                _ => {}
            }
        }
    }

    let (percent, refresh_time) = if !five_hour_disabled {
        (
            five_hour_percent,
            if five_hour_reset.is_empty() {
                "Unavailable".to_string()
            } else {
                five_hour_reset.clone()
            },
        )
    } else if !weekly_disabled {
        (
            weekly_percent,
            if weekly_reset.is_empty() {
                "Unavailable".to_string()
            } else {
                weekly_reset.clone()
            },
        )
    } else {
        (0, "Unavailable".to_string())
    };

    QuotaData {
        model: model.to_string(),
        percent,
        refresh_time,
        five_hour_percent,
        five_hour_reset,
        five_hour_disabled,
        weekly_percent,
        weekly_reset,
        weekly_disabled,
    }
}

fn extract_number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.replace(',', "").parse::<f64>().ok(),
        _ => None,
    }
}

pub fn find_agy_binary() -> Result<PathBuf, ProviderError> {
    if let Some(path) = env::var_os("AGY_BIN") {
        let candidate = PathBuf::from(path);
        if is_file(&candidate) {
            return Ok(candidate);
        }
    }

    let executable = if cfg!(windows) { "agy.exe" } else { "agy" };
    if let Some(path_value) = env::var_os("PATH") {
        for directory in env::split_paths(&path_value) {
            let candidate = directory.join(executable);
            if is_file(&candidate) {
                return Ok(candidate);
            }
        }
    }

    if cfg!(windows) {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let candidate = PathBuf::from(local_app_data)
                .join("agy")
                .join("bin")
                .join("agy.exe");
            if is_file(&candidate) {
                return Ok(candidate);
            }
        }
    } else {
        if let Some(home) = env::var_os("HOME") {
            let candidate = PathBuf::from(home).join(".local").join("bin").join("agy");
            if is_file(&candidate) {
                return Ok(candidate);
            }
        }
        let candidate = PathBuf::from("/usr/local/bin/agy");
        if is_file(&candidate) {
            return Ok(candidate);
        }
    }

    Err(ProviderError::Unavailable(
        "agy executable was not found".to_string(),
    ))
}

fn is_file(path: &Path) -> bool {
    path.metadata().map(|metadata| metadata.is_file()).unwrap_or(false)
}

pub async fn fetch() -> Result<FullStatus, ProviderError> {
    let binary = find_agy_binary()?;
    let commands = ["/usage", "/quota"];
    let mut last_error = ProviderError::Unsupported(
        "agy did not provide structured quota output".to_string(),
    );

    for command in commands {
        match run_structured_command(&binary, command).await {
            Ok(status) => return Ok(status),
            Err(error @ ProviderError::Auth(_)) => return Err(error),
            Err(error @ ProviderError::Transient(_)) => return Err(error),
            Err(error) => last_error = error,
        }
    }

    Err(last_error)
}

async fn run_structured_command(binary: &Path, slash_command: &str) -> Result<FullStatus, ProviderError> {
    let mut command = Command::new(binary);
    command
        .arg("-p")
        .arg(slash_command)
        .arg("--output-format")
        .arg("json")
        .kill_on_drop(true);

    let output = timeout(COMMAND_TIMEOUT, command.output())
        .await
        .map_err(|_| ProviderError::Transient("agy quota command timed out".to_string()))?
        .map_err(|error| ProviderError::Unavailable(format!("failed to execute agy: {error}")))?;

    if output.stdout.len() > MAX_OUTPUT_BYTES || output.stderr.len() > MAX_OUTPUT_BYTES {
        return Err(ProviderError::InvalidData(
            "agy quota output exceeded the size limit".to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(classify_command_failure(&stdout, &stderr));
    }

    parse_quota_envelope(stdout.trim())
}

fn classify_command_failure(stdout: &str, stderr: &str) -> ProviderError {
    let diagnostic = format!("{stderr}\n{stdout}");
    let lower = diagnostic.to_ascii_lowercase();

    if [
        "sign in",
        "sign-in",
        "login required",
        "not authenticated",
        "unauthenticated",
        "authentication required",
        "credential not found",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return ProviderError::Auth("agy login is required".to_string());
    }

    if [
        "flags provided but not defined",
        "unknown flag",
        "unrecognized option",
        "unexpected arguments",
        "unknown command",
        "unsupported command",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return ProviderError::Unsupported(
            "installed agy does not support structured quota output".to_string(),
        );
    }

    ProviderError::Transient(format!(
        "agy quota command exited unsuccessfully{}",
        output_code_hint(&diagnostic)
    ))
}

fn output_code_hint(_diagnostic: &str) -> &'static str {
    ""
}
