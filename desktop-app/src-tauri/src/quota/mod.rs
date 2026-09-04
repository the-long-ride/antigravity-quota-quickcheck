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
            if let Ok(Some(plan_tier)) = cloud_code::fetch_plan_tier().await {
                status.plan_tier = Some(plan_tier);
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
