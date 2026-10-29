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
    super::extract_plan_tier(load)
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

fn merge_window(target: &mut ProviderPool, percent: u32, reset: String, window: &str, is_argon: bool) {
    merge_pool(&mut target.generic, percent, reset.clone());
    match window {
        "5h" => merge_pool(&mut target.five_hour, percent, reset),
        "weekly" => merge_pool(&mut target.weekly, percent, reset),
        _ if is_argon => merge_pool(&mut target.weekly, percent, reset),
        _ => {}
    }
}

pub fn normalize_cloud_snapshot(
    load_code_assist: &Value,
    user_quota: &Value,
    available_models: &Value,
) -> Result<FullStatus, ProviderError> {
    let plan_tier = extract_plan_tier(load_code_assist)
        .or_else(|| extract_plan_tier(available_models))
        .or_else(|| extract_plan_tier(user_quota));

    let credits = sum_available_credits(load_code_assist).map(|balance| CreditInfo {
        balance,
        credit_type: "AI".to_string(),
    });

    let mut gemini = ProviderPool::default();
    let mut shared = ProviderPool::default();
    let mut argon = ProviderPool::default();
    let mut has_user_argon = false;

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
            let is_argon = is_argon_model(&model);
            let target = if is_argon {
                has_user_argon = true;
                Some(&mut argon)
            } else if model.contains("gemini") || token_type == "requests" {
                Some(&mut gemini)
            } else if is_shared_model(&model) {
                Some(&mut shared)
            } else {
                None
            };
            let Some(target) = target else { continue };
            let Some(percent) = remaining_percent(bucket) else { continue };
            let reset = reset_time(bucket).unwrap_or_default();
            merge_window(target, percent, reset, &explicit_window(bucket), is_argon);
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
            let is_argon = is_argon_model(&identity);
            let target = if is_argon {
                Some(&mut argon)
            } else if identity.contains("gemini") {
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
            merge_window(target, percent, reset, &explicit_window(quota_info), is_argon);
        }
    }

    if !argon.weekly.present && argon.generic.present {
        argon.weekly = argon.generic.clone();
    }

    let argon_present = argon.generic.present || argon.weekly.present;
    let mut merge_argon_into_gemini = false;
    let gemini_sig_pct = if gemini.weekly.present {
        gemini.weekly.percent
    } else {
        gemini.generic.percent
    };
    let gemini_sig_reset = if gemini.weekly.present {
        &gemini.weekly.reset
    } else {
        &gemini.generic.reset
    };
    let shares_gemini_signature = (gemini.generic.present || gemini.weekly.present)
        && argon.weekly.percent == gemini_sig_pct
        && argon.weekly.reset == *gemini_sig_reset;

    let has_distinct_user_argon = has_user_argon && !shares_gemini_signature;
    if argon_present && !has_distinct_user_argon && shares_gemini_signature {
        merge_argon_into_gemini = true;
    }

    if merge_argon_into_gemini {
        merge_pool(&mut gemini.generic, argon.generic.percent, argon.generic.reset.clone());
        merge_pool(&mut gemini.weekly, argon.weekly.percent, argon.weekly.reset.clone());
    }

    let has_pool_data = gemini.generic.present
        || gemini.five_hour.present
        || gemini.weekly.present
        || shared.generic.present
        || shared.five_hour.present
        || shared.weekly.present
        || argon_present;
    let mut quotas = Vec::new();
    if has_pool_data {
        quotas.push(build_card("Gemini", gemini));
        if !merge_argon_into_gemini && argon_present {
            quotas.push(QuotaData {
                model: "Gemini 4 Argon".to_string(),
                percent: argon.weekly.percent,
                refresh_time: if argon.weekly.reset.is_empty() {
                    "Ready".to_string()
                } else {
                    argon.weekly.reset.clone()
                },
                five_hour_percent: None,
                five_hour_reset: None,
                five_hour_disabled: None,
                weekly_percent: Some(argon.weekly.percent),
                weekly_reset: if argon.weekly.reset.is_empty() {
                    None
                } else {
                    Some(argon.weekly.reset)
                },
                weekly_disabled: Some(false),
            });
        }
        quotas.push(build_card("Claude & OpenAI", shared));
    }

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

fn is_argon_model(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("argon") || lower.contains("gemini-4") || lower.contains("gemini_4") || lower.contains("gemini 4")
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
        five_hour_percent: Some(pool.five_hour.percent),
        five_hour_reset: Some(pool.five_hour.reset),
        five_hour_disabled: Some(!pool.five_hour.present),
        weekly_percent: Some(pool.weekly.percent),
        weekly_reset: Some(pool.weekly.reset),
        weekly_disabled: Some(!pool.weekly.present),
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

    let mut plan_tier = extract_plan_tier(&load);
    if plan_tier.is_none() {
        let project = extract_project_id(&load);
        let models_body = project.map(|p| json!({"project": p})).unwrap_or_else(|| json!({}));
        if let Ok(models) = post_cloud_json(&client, "fetchAvailableModels", &access_token, models_body, true).await {
            plan_tier = extract_plan_tier(&models);
        }
    }

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

    let status = normalize_cloud_snapshot(&load, &user_quota, &models)?;
    if let Some(ref plan_tier) = status.plan_tier {
        cache_plan_tier(plan_tier);
    }
    Ok(status)
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
    _antigravity_headers: bool,
) -> Result<Value, ProviderError> {
    let url = format!("{CLOUD_CODE_BASE}/v1internal:{endpoint}");
    let client_metadata = serde_json::to_string(&cloud_metadata()).unwrap_or_default();
    let request = client
        .post(url)
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .header("User-Agent", "antigravity-quota-quickcheck-desktop")
        .header("X-Goog-Api-Client", "google-cloud-sdk vscode_cloudshelleditor/0.1")
        .header("Client-Metadata", client_metadata)
        .json(&body);
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
    let platform = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => 1,
        ("macos", "aarch64") => 2,
        ("linux", "x86_64") => 3,
        ("linux", "aarch64") => 4,
        ("windows", "x86_64") => 5,
        _ => 0,
    };
    json!({
        "ideType": 9,
        "platform": platform,
        "pluginType": 2
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
