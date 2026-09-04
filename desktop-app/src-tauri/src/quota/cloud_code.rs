use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use reqwest::Client;
use serde_json::{json, Value};

use crate::{CreditInfo, FullStatus, QuotaData};

use super::credentials::{find_agy_binary, load_credential, read_oauth_clients_from_binary};
use super::{is_usable_status, ProviderError, ProviderErrorKind};

const PROVIDER: &str = "Cloud Code";
const CLOUD_CODE_BASE: &str = "https://cloudcode-pa.googleapis.com";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const HTTP_TIMEOUT: Duration = Duration::from_secs(12);
const PLAN_TIER_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

static PLAN_TIER_CACHE: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();

#[derive(Default, Clone)]
struct PoolValue {
    percent: u32,
    reset: String,
    present: bool,
}

#[derive(Default)]
struct ProviderPool {
    generic: PoolValue,
    five_hour: PoolValue,
    weekly: PoolValue,
}

fn plan_tier_cache() -> &'static Mutex<Option<(String, Instant)>> {
    PLAN_TIER_CACHE.get_or_init(|| Mutex::new(None))
}

fn extract_plan_tier(load: &Value) -> Option<String> {
    load.pointer("/paidTier/name")
        .or_else(|| load.pointer("/currentTier/name"))
        .or_else(|| load.pointer("/paidTier/id"))
        .or_else(|| load.pointer("/currentTier/id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn cache_plan_tier(plan_tier: &str) {
    if let Ok(mut cache) = plan_tier_cache().lock() {
        *cache = Some((plan_tier.to_string(), Instant::now() + PLAN_TIER_CACHE_TTL));
    }
}

fn cached_plan_tier() -> Option<String> {
    let cache = plan_tier_cache().lock().ok()?;
    let (value, expires_at) = cache.as_ref()?;
    (Instant::now() < *expires_at).then(|| value.clone())
}

pub fn normalize_cloud_snapshot(
    load_code_assist: &Value,
    user_quota: &Value,
    available_models: &Value,
) -> Result<FullStatus, ProviderError> {
    let plan_tier = extract_plan_tier(load_code_assist);

    let credits = sum_available_credits(load_code_assist).map(|balance| CreditInfo {
        balance,
        credit_type: "AI".to_string(),
    });

    let mut gemini = ProviderPool::default();
    let mut shared = ProviderPool::default();

    if let Some(buckets) = user_quota.get("buckets").and_then(Value::as_array) {
        for bucket in buckets {
            let model = bucket
                .get("modelId")
                .or_else(|| bucket.get("model_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            let token_type = bucket
                .get("tokenType")
                .or_else(|| bucket.get("token_type"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            let target = if model.contains("gemini") || token_type == "requests" {
                Some(&mut gemini)
            } else if is_shared_model(&model) {
                Some(&mut shared)
            } else {
                None
            };
            let Some(target) = target else { continue };
            let Some(percent) = remaining_percent(bucket) else { continue };
            let reset = reset_time(bucket).unwrap_or_default();
            merge_pool(&mut target.generic, percent, reset.clone());
            match explicit_window(bucket).as_str() {
                "5h" => merge_pool(&mut target.five_hour, percent, reset),
                "weekly" => merge_pool(&mut target.weekly, percent, reset),
                _ => {}
            }
        }
    }

    if let Some(models) = available_models.get("models").and_then(Value::as_object) {
        for (id, entry) in models {
            let identity = format!(
                "{} {} {}",
                id,
                entry.get("model").and_then(Value::as_str).unwrap_or(""),
                entry.get("displayName").and_then(Value::as_str).unwrap_or("")
            )
            .to_lowercase();
            let target = if identity.contains("gemini") {
                Some(&mut gemini)
            } else if is_shared_model(&identity) {
                Some(&mut shared)
            } else {
                None
            };
            let Some(target) = target else { continue };
            let quota_info = entry.get("quotaInfo").or_else(|| entry.get("quota_info")).unwrap_or(entry);
            let Some(percent) = remaining_percent(quota_info) else { continue };
            let reset = reset_time(quota_info).unwrap_or_default();
            merge_pool(&mut target.generic, percent, reset.clone());
            match explicit_window(quota_info).as_str() {
                "5h" => merge_pool(&mut target.five_hour, percent, reset),
                "weekly" => merge_pool(&mut target.weekly, percent, reset),
                _ => {}
            }
        }
    }

    let has_pool_data = gemini.generic.present
        || gemini.five_hour.present
        || gemini.weekly.present
        || shared.generic.present
        || shared.five_hour.present
        || shared.weekly.present;
    let quotas = if has_pool_data {
        vec![build_card("Gemini", gemini), build_card("Claude & OpenAI", shared)]
    } else {
        Vec::new()
    };

    let status = FullStatus {
        credits,
        quotas,
        plan_tier,
        recently_used_model: None,
    };
    if !is_usable_status(&status) {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "Cloud Code returned no usable quota, credits, or tier data"));
    }
    Ok(status)
}

fn sum_available_credits(load: &Value) -> Option<f64> {
    let credits = load.pointer("/paidTier/availableCredits")?.as_array()?;
    let mut total = 0.0;
    let mut found = false;
    for credit in credits {
        let value = credit.get("creditAmount").or_else(|| credit.get("credit_amount"));
        let Some(amount) = value.and_then(number_value) else { continue };
        if amount.is_finite() && amount >= 0.0 {
            total += amount;
            found = true;
        }
    }
    found.then_some(total)
}

fn is_shared_model(value: &str) -> bool {
    value.contains("claude") || value.contains("gpt") || value.contains("openai")
}

fn remaining_percent(value: &Value) -> Option<u32> {
    for key in ["remainingFraction", "remaining_fraction"] {
        if let Some(number) = value.get(key).and_then(number_value) {
            return Some((number.clamp(0.0, 1.0) * 100.0).round() as u32);
        }
    }
    for key in ["remainingPercent", "remaining_percent", "percentRemaining", "percent_remaining"] {
        if let Some(number) = value.get(key).and_then(number_value) {
            return Some(number.clamp(0.0, 100.0).round() as u32);
        }
    }
    None
}

fn number_value(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.replace(',', "").parse::<f64>().ok())
}

fn reset_time(value: &Value) -> Option<String> {
    value
        .get("resetTime")
        .or_else(|| value.get("reset_time"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn explicit_window(value: &Value) -> String {
    let text = value
        .get("window")
        .or_else(|| value.get("windowName"))
        .or_else(|| value.get("window_name"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let compact: String = text.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '_').collect();
    if compact == "5h" || compact.contains("5hour") || compact.contains("fivehour") {
        "5h".to_string()
    } else if compact.contains("week") || compact == "7d" {
        "weekly".to_string()
    } else {
        String::new()
    }
}

fn merge_pool(slot: &mut PoolValue, percent: u32, reset: String) {
    if !slot.present || percent < slot.percent || (percent == slot.percent && !reset.is_empty() && (slot.reset.is_empty() || reset < slot.reset)) {
        slot.percent = percent;
        slot.reset = reset;
        slot.present = true;
    }
}

fn build_card(model: &str, pool: ProviderPool) -> QuotaData {
    let generic = if pool.generic.present {
        pool.generic.clone()
    } else if pool.five_hour.present {
        pool.five_hour.clone()
    } else {
        pool.weekly.clone()
    };
    QuotaData {
        model: model.to_string(),
        percent: generic.percent,
        refresh_time: generic.reset,
        five_hour_percent: pool.five_hour.percent,
        five_hour_reset: pool.five_hour.reset,
        five_hour_disabled: !pool.five_hour.present,
        weekly_percent: pool.weekly.percent,
        weekly_reset: pool.weekly.reset,
        weekly_disabled: !pool.weekly.present,
    }
}

async fn build_authenticated_client() -> Result<(Client, String), ProviderError> {
    let credential = load_credential().await?;
    let agy = find_agy_binary()
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "agy executable was not found for OAuth client discovery"))?;
    let candidates = read_oauth_clients_from_binary(&agy)?;
    let client = Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Transient, "could not initialize HTTPS client"))?;
    let access_token = refresh_access_token(&client, &credential.refresh_token, &candidates).await?;
    Ok((client, access_token))
}

pub async fn fetch_plan_tier() -> Result<Option<String>, ProviderError> {
    if let Some(plan_tier) = cached_plan_tier() {
        return Ok(Some(plan_tier));
    }

    let (client, access_token) = build_authenticated_client().await?;
    let load = post_cloud_json(
        &client,
        "loadCodeAssist",
        &access_token,
        json!({
            "metadata": cloud_metadata(),
            "mode": "FULL_ELIGIBILITY_CHECK"
        }),
        false,
    )
    .await?;

    let plan_tier = extract_plan_tier(&load);
    if let Some(value) = plan_tier.as_deref() {
        cache_plan_tier(value);
    }
    Ok(plan_tier)
}

pub async fn fetch() -> Result<FullStatus, ProviderError> {
    let (client, access_token) = build_authenticated_client().await?;

    let load = post_cloud_json(
        &client,
        "loadCodeAssist",
        &access_token,
        json!({
            "metadata": cloud_metadata(),
            "mode": "FULL_ELIGIBILITY_CHECK"
        }),
        false,
    )
    .await
    .unwrap_or(Value::Null);

    if let Some(plan_tier) = extract_plan_tier(&load) {
        cache_plan_tier(&plan_tier);
    }

    let user_quota = post_cloud_json(&client, "retrieveUserQuota", &access_token, json!({}), false)
        .await
        .unwrap_or(Value::Null);

    let project = extract_project_id(&load);
    let models_body = project.map(|project| json!({"project": project})).unwrap_or_else(|| json!({}));
    let models = post_cloud_json(&client, "fetchAvailableModels", &access_token, models_body, true)
        .await
        .unwrap_or(Value::Null);

    normalize_cloud_snapshot(&load, &user_quota, &models)
}

async fn refresh_access_token(
    client: &Client,
    refresh_token: &str,
    candidates: &[(String, String)],
) -> Result<String, ProviderError> {
    for (client_id, client_secret) in candidates {
        let response = client
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await;
        let Ok(response) = response else { continue };
        if !response.status().is_success() {
            continue;
        }
        let Ok(value) = response.json::<Value>().await else { continue };
        if let Some(token) = value.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            return Ok(token.to_string());
        }
    }
    Err(ProviderError::new(PROVIDER, ProviderErrorKind::Auth, "could not refresh agy OAuth access token"))
}

async fn post_cloud_json(
    client: &Client,
    endpoint: &str,
    access_token: &str,
    body: Value,
    antigravity_headers: bool,
) -> Result<Value, ProviderError> {
    let url = format!("{CLOUD_CODE_BASE}/v1internal:{endpoint}");
    let mut request = client
        .post(url)
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .json(&body);
    if antigravity_headers {
        request = request
            .header("User-Agent", "antigravity-quota-quickcheck/1.2.3")
            .header("X-Goog-Api-Client", "google-cloud-sdk vscode_cloudshelleditor/0.1")
            .header("Client-Metadata", serde_json::to_string(&cloud_metadata()).unwrap_or_default());
    }
    let response = request
        .send()
        .await
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Transient, format!("{endpoint} request failed")))?;
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::Auth, format!("{endpoint} rejected agy credentials")));
    }
    if !response.status().is_success() {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::Transient, format!("{endpoint} returned HTTP {}", response.status().as_u16())));
    }
    response
        .json::<Value>()
        .await
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, format!("{endpoint} returned invalid JSON")))
}

fn cloud_metadata() -> Value {
    let platform = if cfg!(target_os = "windows") {
        "WINDOWS"
    } else if cfg!(target_os = "macos") {
        "DARWIN"
    } else {
        "LINUX"
    };
    json!({
        "ideName": "antigravity",
        "ideType": "ANTIGRAVITY",
        "platform": platform,
        "pluginType": "GEMINI",
        "updateChannel": "stable"
    })
}

fn extract_project_id(load: &Value) -> Option<String> {
    let value = load.get("cloudaicompanionProject")?;
    if let Some(text) = value.as_str().filter(|s| !s.is_empty()) {
        return Some(text.to_string());
    }
    for key in ["projectId", "project_id", "id", "name"] {
        if let Some(text) = value.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
            return Some(text.to_string());
        }
    }
    None
}
