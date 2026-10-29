pub mod agy_cli;
pub mod cloud_code;
pub mod credentials;
pub mod language_server;
pub mod process;

use crate::FullStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderErrorKind {
    Unavailable,
    Unsupported,
    Auth,
    Transient,
    InvalidData,
}

#[derive(Debug, Clone)]
pub struct ProviderError {
    pub provider: &'static str,
    pub kind: ProviderErrorKind,
    pub message: String,
}

impl ProviderError {
    pub fn new(provider: &'static str, kind: ProviderErrorKind, message: impl Into<String>) -> Self {
        Self {
            provider,
            kind,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.provider, self.message)
    }
}

impl std::error::Error for ProviderError {}


pub fn normalize_plan_tier(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match trimmed.to_lowercase().as_str() {
        "free-tier" | "free" | "free tier" => "Free".to_string(),
        "standard-tier" | "standard" | "standard tier" | "paid" | "paid-tier" | "paid tier" => {
            "Paid".to_string()
        }
        "legacy-tier" | "legacy" | "legacy tier" => "Legacy".to_string(),
        "advanced-tier" | "advanced" | "advanced tier" | "google_ai_pro" | "google-ai-pro"
        | "google ai pro" | "ai-pro" | "ai pro" | "g1-pro-tier" | "g1-pro" | "pro-tier" | "pro" => {
            "Google AI Pro".to_string()
        }
        "ultra-tier" | "ultra" | "ultra tier" | "google_ai_ultra" | "google-ai-ultra"
        | "google ai ultra" | "ai-ultra" | "ai ultra" | "g1-ultra-tier" | "g1-ultra" => {
            "Google AI Ultra".to_string()
        }
        _ => trimmed.to_string(),
    }
}

pub fn extract_plan_tier(value: &serde_json::Value) -> Option<String> {
    const CANDIDATE_POINTERS: &[&str] = &[
        "/planInfo/planType",
        "/userStatus/planInfo/planType",
        "/paidTier/name",
        "/userStatus/paidTier/name",
        "/paidTier/id",
        "/userStatus/paidTier/id",
        "/paidTier",
        "/userStatus/paidTier",
        "/currentTier/name",
        "/userStatus/currentTier/name",
        "/currentTier/id",
        "/userStatus/currentTier/id",
        "/currentTier",
        "/userStatus/currentTier",
        "/userTier/name",
        "/userStatus/userTier/name",
        "/userTier/id",
        "/userStatus/userTier/id",
        "/userTier",
        "/userStatus/userTier",
        "/response/planInfo/planType",
        "/response/paidTier/name",
        "/response/paidTier/id",
        "/response/paidTier",
        "/response/currentTier/name",
        "/response/currentTier/id",
        "/response/currentTier",
        "/response/userTier/name",
        "/response/userTier/id",
        "/response/userTier",
        "/response/planTier",
        "/response/plan_tier",
        "/response/tier",
        "/data/planTier",
        "/data/plan_tier",
        "/data/planInfo/planType",
        "/data/paidTier/name",
        "/data/paidTier/id",
        "/data/paidTier",
        "/data/currentTier/name",
        "/data/currentTier/id",
        "/data/currentTier",
        "/data/tier",
        "/planTier",
        "/plan_tier",
        "/tier",
    ];

    for pointer in CANDIDATE_POINTERS {
        if let Some(candidate) = value.pointer(pointer).and_then(serde_json::Value::as_str) {
            let trimmed = candidate.trim();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("antigravity") {
                continue;
            }
            let normalized = normalize_plan_tier(trimmed);
            if !normalized.is_empty() {
                return Some(normalized);
            }
        }
    }
    None
}

pub fn is_usable_status(status: &FullStatus) -> bool {
    !status.quotas.is_empty() || status.credits.is_some() || status.plan_tier.is_some()
}

pub fn select_first_usable(
    results: impl IntoIterator<Item = Result<FullStatus, ProviderError>>,
) -> Result<FullStatus, String> {
    let mut errors = Vec::new();
    for result in results {
        match result {
            Ok(status) if is_usable_status(&status) => return Ok(status),
            Ok(_) => errors.push("provider returned an empty snapshot".to_string()),
            Err(error) => errors.push(error.to_string()),
        }
    }
    Err(errors.join("; "))
}

pub async fn fetch_full_status() -> Result<FullStatus, String> {
    let mut errors = Vec::new();

    match agy_cli::fetch().await {
        Ok(mut status) if is_usable_status(&status) => {
            if status.plan_tier.is_none() {
                if let Ok(Some(plan_tier)) = cloud_code::fetch_plan_tier().await {
                    status.plan_tier = Some(plan_tier);
                } else if let Ok(ls_status) = language_server::fetch().await {
                    if let Some(plan_tier) = ls_status.plan_tier {
                        status.plan_tier = Some(plan_tier);
                    }
                }
            }
            return Ok(status);
        }
        Ok(_) => errors.push("agy CLI: empty quota snapshot".to_string()),
        Err(error) => errors.push(error.to_string()),
    }

    match cloud_code::fetch().await {
        Ok(status) if is_usable_status(&status) => return Ok(status),
        Ok(_) => errors.push("Cloud Code: empty quota snapshot".to_string()),
        Err(error) => errors.push(error.to_string()),
    }

    match language_server::fetch().await {
        Ok(status) if is_usable_status(&status) => return Ok(status),
        Ok(_) => errors.push("language server: empty quota snapshot".to_string()),
        Err(error) => errors.push(error.to_string()),
    }

    Err(errors.join("; "))
}
