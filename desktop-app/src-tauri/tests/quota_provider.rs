pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::{is_usable_status, select_first_usable, ProviderError, ProviderErrorKind};

fn empty_status() -> FullStatus {
    FullStatus {
        credits: None,
        quotas: vec![],
        plan_tier: None,
        recently_used_model: None,
    }
}

fn status_for(model: &str, percent: u32) -> FullStatus {
    FullStatus {
        credits: None,
        quotas: vec![QuotaData {
            model: model.into(),
            percent,
            refresh_time: "2026-09-04T05:00:00Z".into(),
            five_hour_percent: percent,
            five_hour_reset: "2026-09-04T05:00:00Z".into(),
            five_hour_disabled: false,
            weekly_percent: percent,
            weekly_reset: "2026-09-08T00:00:00Z".into(),
            weekly_disabled: false,
        }],
        plan_tier: None,
        recently_used_model: Some(model.into()),
    }
}

#[test]
fn empty_status_is_not_usable() {
    assert!(!is_usable_status(&empty_status()));
}

#[test]
fn quota_status_is_usable() {
    assert!(is_usable_status(&status_for("Gemini", 80)));
}

#[test]
fn credits_only_status_is_usable() {
    let mut status = empty_status();
    status.credits = Some(CreditInfo {
        balance: 42.0,
        credit_type: "AI".into(),
    });
    assert!(is_usable_status(&status));
}

#[test]
fn provider_error_kinds_cover_fallback_classes() {
    let kinds = [
        ProviderErrorKind::Unavailable,
        ProviderErrorKind::Unsupported,
        ProviderErrorKind::Auth,
        ProviderErrorKind::Transient,
        ProviderErrorKind::InvalidData,
    ];
    assert_eq!(kinds.len(), 5);
}

#[test]
fn first_usable_provider_wins() {
    let cli = status_for("Gemini", 80);
    let cloud = status_for("Gemini", 60);
    let selected = select_first_usable(vec![Ok(cli), Ok(cloud)]).unwrap();
    assert_eq!(selected.quotas[0].percent, 80);
}

#[test]
fn provider_errors_fall_through_in_order() {
    let cloud = status_for("Claude & OpenAI", 55);
    let selected = select_first_usable(vec![
        Err(ProviderError::new("agy CLI", ProviderErrorKind::Unavailable, "missing")),
        Ok(cloud),
        Ok(status_for("Gemini", 25)),
    ])
    .unwrap();
    assert_eq!(selected.quotas[0].model, "Claude & OpenAI");
    assert_eq!(selected.quotas[0].percent, 55);
}
