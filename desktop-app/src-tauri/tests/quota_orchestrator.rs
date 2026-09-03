use std::pin::Pin;
use std::sync::{Arc, Mutex};

pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::{run_provider_chain, ProviderError, ProviderFuture, ProviderKind};

fn status_with_model(model: &str) -> FullStatus {
    FullStatus {
        credits: None,
        quotas: vec![QuotaData {
            model: model.to_string(),
            percent: 75,
            refresh_time: String::new(),
            five_hour_percent: 75,
            five_hour_reset: String::new(),
            five_hour_disabled: false,
            weekly_percent: 50,
            weekly_reset: String::new(),
            weekly_disabled: false,
        }],
        plan_tier: None,
        recently_used_model: Some(model.to_string()),
    }
}

fn empty_status() -> FullStatus {
    FullStatus {
        credits: None,
        quotas: Vec::new(),
        plan_tier: None,
        recently_used_model: None,
    }
}

fn attempt(
    name: &'static str,
    calls: Arc<Mutex<Vec<&'static str>>>,
    result: Result<FullStatus, ProviderError>,
) -> ProviderFuture<'static> {
    Box::pin(async move {
        calls.lock().unwrap().push(name);
        result
    }) as Pin<Box<_>>
}

#[test]
fn cli_success_stops_fallback_chain() {
    tauri::async_runtime::block_on(async {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = run_provider_chain(vec![
            (
                ProviderKind::AgyCli,
                attempt("cli", calls.clone(), Ok(status_with_model("Gemini"))),
            ),
            (
                ProviderKind::CloudCode,
                attempt(
                    "cloud",
                    calls.clone(),
                    Err(ProviderError::Unavailable("unused".into())),
                ),
            ),
            (
                ProviderKind::LanguageServer,
                attempt(
                    "language_server",
                    calls.clone(),
                    Err(ProviderError::Unavailable("unused".into())),
                ),
            ),
        ])
        .await
        .unwrap();

        assert_eq!(result.quotas[0].model, "Gemini");
        assert_eq!(*calls.lock().unwrap(), vec!["cli"]);
    });
}

#[test]
fn unsupported_cli_falls_back_to_cloud() {
    tauri::async_runtime::block_on(async {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = run_provider_chain(vec![
            (
                ProviderKind::AgyCli,
                attempt(
                    "cli",
                    calls.clone(),
                    Err(ProviderError::Unsupported("structured output unavailable".into())),
                ),
            ),
            (
                ProviderKind::CloudCode,
                attempt(
                    "cloud",
                    calls.clone(),
                    Ok(status_with_model("Claude & OpenAI")),
                ),
            ),
            (
                ProviderKind::LanguageServer,
                attempt(
                    "language_server",
                    calls.clone(),
                    Err(ProviderError::Unavailable("unused".into())),
                ),
            ),
        ])
        .await
        .unwrap();

        assert_eq!(result.quotas[0].model, "Claude & OpenAI");
        assert_eq!(*calls.lock().unwrap(), vec!["cli", "cloud"]);
    });
}

#[test]
fn cli_and_cloud_failure_fall_back_to_language_server() {
    tauri::async_runtime::block_on(async {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = run_provider_chain(vec![
            (
                ProviderKind::AgyCli,
                attempt(
                    "cli",
                    calls.clone(),
                    Err(ProviderError::Unavailable("agy missing".into())),
                ),
            ),
            (
                ProviderKind::CloudCode,
                attempt(
                    "cloud",
                    calls.clone(),
                    Err(ProviderError::Auth("login required".into())),
                ),
            ),
            (
                ProviderKind::LanguageServer,
                attempt(
                    "language_server",
                    calls.clone(),
                    Ok(status_with_model("Gemini")),
                ),
            ),
        ])
        .await
        .unwrap();

        assert_eq!(result.quotas[0].model, "Gemini");
        assert_eq!(
            *calls.lock().unwrap(),
            vec!["cli", "cloud", "language_server"]
        );
    });
}

#[test]
fn empty_snapshot_does_not_stop_fallback() {
    tauri::async_runtime::block_on(async {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = run_provider_chain(vec![
            (
                ProviderKind::AgyCli,
                attempt("cli", calls.clone(), Ok(empty_status())),
            ),
            (
                ProviderKind::CloudCode,
                attempt("cloud", calls.clone(), Ok(status_with_model("Gemini"))),
            ),
        ])
        .await
        .unwrap();

        assert_eq!(result.quotas[0].model, "Gemini");
        assert_eq!(*calls.lock().unwrap(), vec!["cli", "cloud"]);
    });
}

#[test]
fn all_failures_are_sanitized_and_combined() {
    tauri::async_runtime::block_on(async {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let err = run_provider_chain(vec![
            (
                ProviderKind::AgyCli,
                attempt(
                    "cli",
                    calls.clone(),
                    Err(ProviderError::Unavailable("agy missing".into())),
                ),
            ),
            (
                ProviderKind::CloudCode,
                attempt(
                    "cloud",
                    calls.clone(),
                    Err(ProviderError::Auth("agy login required".into())),
                ),
            ),
            (
                ProviderKind::LanguageServer,
                attempt(
                    "language_server",
                    calls.clone(),
                    Err(ProviderError::Unavailable("language server missing".into())),
                ),
            ),
        ])
        .await
        .unwrap_err();

        let text = err.to_string();
        assert!(text.contains("agy CLI"));
        assert!(text.contains("Cloud Code"));
        assert!(text.contains("language server"));
        assert!(!text.to_lowercase().contains("token"));
    });
}
