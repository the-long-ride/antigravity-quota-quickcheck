pub mod agy_cli;
pub mod cloud_code;
pub mod credentials;

use crate::FullStatus;
use std::fmt;
use std::future::Future;
use std::pin::Pin;

pub type ProviderFuture<'a> =
    Pin<Box<dyn Future<Output = Result<FullStatus, ProviderError>> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    AgyCli,
    CloudCode,
    LanguageServer,
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderKind::AgyCli => f.write_str("agy CLI"),
            ProviderKind::CloudCode => f.write_str("Cloud Code"),
            ProviderKind::LanguageServer => f.write_str("language server"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    Unavailable(String),
    Unsupported(String),
    Auth(String),
    Transient(String),
    InvalidData(String),
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (label, detail) = match self {
            ProviderError::Unavailable(detail) => ("unavailable", detail),
            ProviderError::Unsupported(detail) => ("unsupported", detail),
            ProviderError::Auth(detail) => ("authentication", detail),
            ProviderError::Transient(detail) => ("temporary failure", detail),
            ProviderError::InvalidData(detail) => ("invalid data", detail),
        };
        write!(f, "{label}: {}", sanitize_detail(detail))
    }
}

impl std::error::Error for ProviderError {}

#[derive(Debug)]
pub struct ProviderChainError {
    attempts: Vec<(ProviderKind, ProviderError)>,
}

impl fmt::Display for ProviderChainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("No quota provider succeeded: ")?;
        for (index, (kind, error)) in self.attempts.iter().enumerate() {
            if index > 0 {
                f.write_str("; ")?;
            }
            write!(f, "{kind} ({error})")?;
        }
        Ok(())
    }
}

impl std::error::Error for ProviderChainError {}

pub fn is_usable_status(status: &FullStatus) -> bool {
    !status.quotas.is_empty() || status.credits.is_some() || status.plan_tier.is_some()
}

fn sanitize_detail(detail: &str) -> String {
    let one_line = detail.lines().next().unwrap_or("").trim();
    let lower = one_line.to_ascii_lowercase();
    if lower.contains("bearer ")
        || lower.contains("refresh_token")
        || lower.contains("access_token")
        || lower.contains("client_secret")
    {
        return "provider reported a sensitive error".to_string();
    }
    one_line.chars().take(160).collect()
}

pub async fn run_provider_chain<'a>(
    providers: Vec<(ProviderKind, ProviderFuture<'a>)>,
) -> Result<FullStatus, ProviderChainError> {
    let mut attempts = Vec::new();

    for (kind, future) in providers {
        match future.await {
            Ok(status) if is_usable_status(&status) => return Ok(status),
            Ok(_) => attempts.push((
                kind,
                ProviderError::InvalidData("empty quota snapshot".to_string()),
            )),
            Err(error) => attempts.push((kind, error)),
        }
    }

    Err(ProviderChainError { attempts })
}
