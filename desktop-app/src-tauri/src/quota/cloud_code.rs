use super::credentials::{discover_installed_oauth_clients, load_credential, OAuthClient};
use super::ProviderError;
use crate::{CreditInfo, FullStatus, QuotaData};
use reqwest::{Client, Response, StatusCode};
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_HOST: &str = "cloudcode-pa.googleapis.com";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
pub struct CloudContext {
    pub credits: Option<CreditInfo>,
    pub plan_tier: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct Meter {
    remaining: Option<f64>,
    reset: Option<String>,
}

impl Meter {
    fn update(&mut self, remaining: f64, reset: Option<&str>) {
        let remaining = remaining.clamp(0.0, 1.0);
        self.remaining = Some(match self.remaining {
            Some(current) => current.min(remaining),
            None => remaining,
        });

        if let Some(reset) = reset.map(str::trim).filter(|value| !value.is_empty()) {
            if self.reset.as_deref().map_or(true, |current| reset < current) {
                self.reset = Some(reset.to_string());
            }
        }
    }
}

pub fn parse_load_code_assist(value: &Value) -> CloudContext {
    let paid_tier = value.get("paidTier").filter(|tier| tier.is_object());
    let current_tier = value.get("currentTier").filter(|tier| tier.is_object());
    let plan_tier = paid_tier
        .and_then(tier_label)
        .or_else(|| current_tier.and_then(tier_label));

    let credits_value = paid_tier
        .and_then(|tier| tier.get("availableCredits"))
        .or_else(|| current_tier.and_then(|tier| tier.get("availableCredits")))
        .or_else(|| value.get("availableCredits"));

    let credit_sum = credits_value
        .and_then(Value::as_array)
        .map(|credits| {
            credits
                .iter()
                .filter_map(|credit| credit.get("creditAmount").and_then(parse_amount))
                .sum::<f64>()
        })
        .filter(|sum| sum.is_finite() && *sum > 0.0);

    let project_id = match value.get("cloudaicompanionProject") {
        Some(Value::String(project)) => nonblank(project),
        Some(Value::Object(project)) => project
            .get("id")
            .and_then(Value::as_str)
            .and_then(nonblank),
        _ => None,
    };

    CloudContext {
        credits: credit_sum.map(|balance| CreditInfo {
            balance,
            credit_type: "Google AI Credits".to_string(),
        }),
        plan_tier,
        project_id,
    }
}

pub fn parse_retrieve_user_quota(value: &Value) -> Option<QuotaData> {
    let buckets = value.get("buckets")?.as_array()?;
    let mut short = Meter::default();
    let mut weekly = Meter::default();

    for bucket in buckets {
        let token_type = bucket
            .get("tokenType")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        if token_type != "requests" {
            continue;
        }

        let Some(remaining) = bucket.get("remainingFraction").and_then(Value::as_f64) else {
            continue;
        };
        if !remaining.is_finite() {
            continue;
        }
        let reset = bucket.get("resetTime").and_then(Value::as_str);
        let window = bucket
            .get("window")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();

        if window.contains("week") {
            weekly.update(remaining, reset);
        } else if window.is_empty()
            || window.contains("5h")
            || window.contains("5-hour")
            || window.contains("5 hour")
            || window.contains("short")
            || window.contains("rolling")
        {
            short.update(remaining, reset);
        }
    }

    build_card("Gemini", short, weekly)
}

pub fn parse_available_models(value: &Value) -> (Option<QuotaData>, Option<QuotaData>) {
    let Some(models) = value.get("models").and_then(Value::as_object) else {
        return (None, None);
    };

    let mut gemini = Meter::default();
    let mut shared = Meter::default();

    for (model_id, model) in models {
        let Some(model) = model.as_object() else {
            continue;
        };
        if model.get("isInternal").and_then(Value::as_bool) == Some(true)
            || model_id.to_ascii_lowercase().starts_with("tab_")
            || model_id.to_ascii_lowercase().starts_with("tab-")
        {
            continue;
        }

        let Some(quota) = model.get("quotaInfo").and_then(Value::as_object) else {
            continue;
        };
        let Some(remaining) = quota.get("remainingFraction").and_then(Value::as_f64) else {
            continue;
        };
        if !remaining.is_finite() {
            continue;
        }
        let reset = quota.get("resetTime").and_then(Value::as_str);
        let lower = model_id.to_ascii_lowercase();

        if lower.contains("gemini") {
            gemini.update(remaining, reset);
        } else if lower.contains("claude")
            || lower.contains("anthropic")
            || lower.contains("gpt")
            || lower.contains("openai")
            || lower.contains("oss")
            || starts_with_openai_o_model(&lower)
        {
            shared.update(remaining, reset);
        }
    }

    (
        build_card("Gemini", gemini, Meter::default()),
        build_card("Claude & OpenAI", shared, Meter::default()),
    )
}

pub async fn fetch() -> Result<FullStatus, ProviderError> {
    let credential = load_credential()?;
    let clients = discover_installed_oauth_clients()?;
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| ProviderError::Unavailable("Cloud Code HTTP client could not be created".to_string()))?;
    let access_token = refresh_access_token(&client, &credential.refresh_token, &clients).await?;

    let mut errors = Vec::new();
    let context = match post_cloud_json(
        &client,
        "loadCodeAssist",
        &access_token,
        &json!({"mode": "FULL_ELIGIBILITY_CHECK"}),
    )
    .await
    {
        Ok(value) => parse_load_code_assist(&value),
        Err(error @ ProviderError::Auth(_)) => return Err(error),
        Err(error) => {
            errors.push(error);
            CloudContext::default()
        }
    };

    let retrieved_gemini = match post_cloud_json(
        &client,
        "retrieveUserQuota",
        &access_token,
        &json!({}),
    )
    .await
    {
        Ok(value) => parse_retrieve_user_quota(&value),
        Err(error @ ProviderError::Auth(_)) => return Err(error),
        Err(error) => {
            errors.push(error);
            None
        }
    };

    let models_body = context
        .project_id
        .as_ref()
        .map(|project| json!({"project": project}))
        .unwrap_or_else(|| json!({}));
    let (available_gemini, shared) = match post_cloud_json(
        &client,
        "fetchAvailableModels",
        &access_token,
        &models_body,
    )
    .await
    {
        Ok(value) => parse_available_models(&value),
        Err(error @ ProviderError::Auth(_)) => return Err(error),
        Err(error) => {
            errors.push(error);
            (None, None)
        }
    };

    let mut quotas = Vec::new();
    if let Some(gemini) = merge_quota(retrieved_gemini, available_gemini) {
        quotas.push(gemini);
    }
    if let Some(shared) = shared {
        quotas.push(shared);
    }

    let status = FullStatus {
        credits: context.credits,
        quotas,
        plan_tier: context.plan_tier,
        recently_used_model: None,
    };

    if !status.quotas.is_empty() || status.credits.is_some() || status.plan_tier.is_some() {
        return Ok(status);
    }

    Err(errors
        .into_iter()
        .next()
        .unwrap_or_else(|| ProviderError::InvalidData("Cloud Code returned no usable quota data".to_string())))
}

async fn refresh_access_token(
    client: &Client,
    refresh_token: &str,
    candidates: &[OAuthClient],
) -> Result<String, ProviderError> {
    if candidates.is_empty() {
        return Err(ProviderError::Unavailable(
            "No OAuth client candidates were discovered from agy".to_string(),
        ));
    }

    let mut saw_invalid_grant = false;
    for candidate in candidates {
        let body = form_body(&[
            ("client_id", candidate.client_id.as_str()),
            ("client_secret", candidate.client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ]);
        let response = client
            .post(TOKEN_ENDPOINT)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(classify_reqwest_error)?;
        let status = response.status();
        let body = read_bounded(response).await?;

        if status.is_success() {
            let value: Value = serde_json::from_slice(&body).map_err(|_| {
                ProviderError::InvalidData("OAuth token response was not valid JSON".to_string())
            })?;
            if let Some(token) = value
                .get("access_token")
                .and_then(Value::as_str)
                .and_then(nonblank)
            {
                return Ok(token);
            }
            continue;
        }

        if status == StatusCode::BAD_REQUEST || status == StatusCode::UNAUTHORIZED {
            let lower = String::from_utf8_lossy(&body).to_ascii_lowercase();
            if lower.contains("invalid_grant") {
                saw_invalid_grant = true;
            }
            continue;
        }

        if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            return Err(ProviderError::Transient(
                "OAuth token service was temporarily unavailable".to_string(),
            ));
        }
    }

    if saw_invalid_grant {
        Err(ProviderError::Auth(
            "agy OAuth refresh token was rejected".to_string(),
        ))
    } else {
        Err(ProviderError::Auth(
            "OAuth client candidates were rejected".to_string(),
        ))
    }
}

async fn post_cloud_json(
    client: &Client,
    endpoint: &str,
    access_token: &str,
    body: &Value,
) -> Result<Value, ProviderError> {
    let url = format!("https://{DEFAULT_HOST}/v1internal:{endpoint}");
    let platform = if cfg!(target_os = "windows") {
        "WINDOWS"
    } else if cfg!(target_os = "macos") {
        "MACOS"
    } else {
        "LINUX"
    };
    let metadata = format!(
        "{{\"ideType\":\"ANTIGRAVITY\",\"platform\":\"{platform}\",\"pluginType\":\"GEMINI\"}}"
    );

    let response = client
        .post(url)
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .header("User-Agent", "Antigravity/1.0 antigravity-quota-quickcheck")
        .header("X-Goog-Api-Client", "google-cloud-sdk vscode_cloudshelleditor/0.1")
        .header("Client-Metadata", metadata)
        .json(body)
        .send()
        .await
        .map_err(classify_reqwest_error)?;

    let status = response.status();
    let bytes = read_bounded(response).await?;
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(ProviderError::Auth(
            "Cloud Code rejected the agy OAuth credential".to_string(),
        ));
    }
    if status == StatusCode::NOT_FOUND {
        return Err(ProviderError::Unsupported(format!(
            "Cloud Code endpoint {endpoint} was not available"
        )));
    }
    if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        return Err(ProviderError::Transient(format!(
            "Cloud Code endpoint {endpoint} was temporarily unavailable"
        )));
    }
    if !status.is_success() {
        return Err(ProviderError::InvalidData(format!(
            "Cloud Code endpoint {endpoint} returned HTTP {}",
            status.as_u16()
        )));
    }

    serde_json::from_slice(&bytes).map_err(|_| {
        ProviderError::InvalidData(format!(
            "Cloud Code endpoint {endpoint} returned invalid JSON"
        ))
    })
}

async fn read_bounded(mut response: Response) -> Result<Vec<u8>, ProviderError> {
    if response.content_length().is_some_and(|length| length > MAX_BODY_BYTES as u64) {
        return Err(ProviderError::InvalidData(
            "Cloud Code response exceeded the size limit".to_string(),
        ));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(classify_reqwest_error)? {
        if body.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err(ProviderError::InvalidData(
                "Cloud Code response exceeded the size limit".to_string(),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn classify_reqwest_error(error: reqwest::Error) -> ProviderError {
    if error.is_timeout() {
        ProviderError::Transient("Cloud Code request timed out".to_string())
    } else {
        ProviderError::Transient("Cloud Code request failed".to_string())
    }
}

fn build_card(model: &str, short: Meter, weekly: Meter) -> Option<QuotaData> {
    if short.remaining.is_none() && weekly.remaining.is_none() {
        return None;
    }

    let five_hour_percent = short.remaining.map(percent).unwrap_or(0);
    let weekly_percent = weekly.remaining.map(percent).unwrap_or(0);
    let five_hour_reset = short.reset.unwrap_or_default();
    let weekly_reset = weekly.reset.unwrap_or_default();
    let five_hour_disabled = short.remaining.is_none();
    let weekly_disabled = weekly.remaining.is_none();
    let (percent_value, refresh_time) = if !five_hour_disabled {
        (five_hour_percent, five_hour_reset.clone())
    } else {
        (weekly_percent, weekly_reset.clone())
    };

    Some(QuotaData {
        model: model.to_string(),
        percent: percent_value,
        refresh_time,
        five_hour_percent,
        five_hour_reset,
        five_hour_disabled,
        weekly_percent,
        weekly_reset,
        weekly_disabled,
    })
}

fn merge_quota(primary: Option<QuotaData>, fallback: Option<QuotaData>) -> Option<QuotaData> {
    match (primary, fallback) {
        (Some(mut primary), Some(fallback)) => {
            if primary.five_hour_disabled && !fallback.five_hour_disabled {
                primary.five_hour_percent = fallback.five_hour_percent;
                primary.five_hour_reset = fallback.five_hour_reset;
                primary.five_hour_disabled = false;
            }
            if primary.weekly_disabled && !fallback.weekly_disabled {
                primary.weekly_percent = fallback.weekly_percent;
                primary.weekly_reset = fallback.weekly_reset;
                primary.weekly_disabled = false;
            }
            if !primary.five_hour_disabled {
                primary.percent = primary.five_hour_percent;
                primary.refresh_time = primary.five_hour_reset.clone();
            } else if !primary.weekly_disabled {
                primary.percent = primary.weekly_percent;
                primary.refresh_time = primary.weekly_reset.clone();
            }
            Some(primary)
        }
        (Some(primary), None) => Some(primary),
        (None, Some(fallback)) => Some(fallback),
        (None, None) => None,
    }
}

fn tier_label(value: &Value) -> Option<String> {
    value
        .get("name")
        .and_then(Value::as_str)
        .and_then(nonblank)
        .or_else(|| value.get("id").and_then(Value::as_str).and_then(nonblank))
}

fn parse_amount(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        Value::String(text) => text
            .replace(',', "")
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite()),
        _ => None,
    }
}

fn percent(value: f64) -> u32 {
    (value.clamp(0.0, 1.0) * 100.0).round() as u32
}

fn nonblank(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn starts_with_openai_o_model(model: &str) -> bool {
    let mut chars = model.chars();
    matches!(chars.next(), Some('o')) && matches!(chars.next(), Some('0'..='9'))
}

fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", form_encode(key), form_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn form_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char)
            }
            b' ' => encoded.push('+'),
            _ => {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                encoded.push('%');
                encoded.push(HEX[(byte >> 4) as usize] as char);
                encoded.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    encoded
}
