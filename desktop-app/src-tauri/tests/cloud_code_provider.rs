pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::cloud_code::{
    parse_available_models, parse_load_code_assist, parse_retrieve_user_quota,
};
use serde_json::json;

#[test]
fn load_code_assist_extracts_paid_tier_credits_plan_and_project() {
    let value = json!({
        "currentTier": {"id": "free-tier", "name": "Free"},
        "paidTier": {
            "id": "pro-tier",
            "name": "Google AI Pro",
            "availableCredits": [
                {"creditAmount": "12.5"},
                {"creditAmount": 7.5},
                {"creditAmount": "1,000"}
            ]
        },
        "cloudaicompanionProject": {"id": "projects/example-project"}
    });

    let context = parse_load_code_assist(&value);
    assert_eq!(context.credits.unwrap().balance, 1020.0);
    assert_eq!(context.plan_tier.as_deref(), Some("Google AI Pro"));
    assert_eq!(context.project_id.as_deref(), Some("projects/example-project"));
}

#[test]
fn load_code_assist_falls_back_to_current_tier_and_string_project() {
    let value = json!({
        "currentTier": {"id": "standard-tier"},
        "cloudaicompanionProject": "projects/string-project"
    });

    let context = parse_load_code_assist(&value);
    assert_eq!(context.plan_tier.as_deref(), Some("standard-tier"));
    assert_eq!(context.project_id.as_deref(), Some("projects/string-project"));
    assert!(context.credits.is_none());
}

#[test]
fn retrieve_user_quota_uses_worst_requests_fraction_and_earliest_reset() {
    let value = json!({
        "buckets": [
            {
                "modelId": "gemini-3-pro",
                "tokenType": "REQUESTS",
                "remainingFraction": 0.72,
                "resetTime": "2026-09-05T02:00:00Z"
            },
            {
                "modelId": "gemini-3-flash",
                "tokenType": "REQUESTS",
                "remainingFraction": 0.44,
                "resetTime": "2026-09-05T01:00:00Z"
            },
            {
                "modelId": "gemini-3-flash",
                "tokenType": "TOKENS",
                "remainingFraction": 0.01,
                "resetTime": "2026-09-04T00:00:00Z"
            }
        ]
    });

    let quota = parse_retrieve_user_quota(&value).unwrap();
    assert_eq!(quota.model, "Gemini");
    assert_eq!(quota.five_hour_percent, 44);
    assert_eq!(quota.five_hour_reset, "2026-09-05T01:00:00Z");
    assert!(!quota.five_hour_disabled);
    assert_eq!(quota.weekly_percent, 0);
    assert!(quota.weekly_disabled);
    assert!(quota.weekly_reset.is_empty());
}

#[test]
fn retrieve_user_quota_honors_explicit_weekly_window_without_copying_it() {
    let value = json!({
        "buckets": [
            {
                "modelId": "gemini-3-pro",
                "tokenType": "REQUESTS",
                "window": "weekly",
                "remainingFraction": 0.31,
                "resetTime": "2026-09-10T00:00:00Z"
            }
        ]
    });

    let quota = parse_retrieve_user_quota(&value).unwrap();
    assert_eq!(quota.five_hour_percent, 0);
    assert!(quota.five_hour_disabled);
    assert_eq!(quota.weekly_percent, 31);
    assert!(!quota.weekly_disabled);
}

#[test]
fn available_models_builds_gemini_and_shared_vertex_pools() {
    let value = json!({
        "models": {
            "gemini-3-pro": {
                "quotaInfo": {"remainingFraction": 0.83, "resetTime": "2026-09-04T04:00:00Z"}
            },
            "gemini-3-flash": {
                "quotaInfo": {"remainingFraction": 0.77, "resetTime": "2026-09-04T03:00:00Z"}
            },
            "claude-sonnet-4": {
                "quotaInfo": {"remainingFraction": 0.64, "resetTime": "2026-09-04T05:00:00Z"}
            },
            "gpt-oss-120b": {
                "quotaInfo": {"remainingFraction": 0.61, "resetTime": "2026-09-04T02:00:00Z"}
            },
            "tab_internal": {
                "isInternal": true,
                "quotaInfo": {"remainingFraction": 0.01, "resetTime": "2026-09-04T01:00:00Z"}
            }
        }
    });

    let (gemini, shared) = parse_available_models(&value);

    let gemini = gemini.unwrap();
    assert_eq!(gemini.model, "Gemini");
    assert_eq!(gemini.five_hour_percent, 77);
    assert_eq!(gemini.five_hour_reset, "2026-09-04T03:00:00Z");
    assert!(gemini.weekly_disabled);

    let shared = shared.unwrap();
    assert_eq!(shared.model, "Claude & OpenAI");
    assert_eq!(shared.five_hour_percent, 61);
    assert_eq!(shared.five_hour_reset, "2026-09-04T02:00:00Z");
    assert!(shared.weekly_disabled);
}

#[test]
fn available_models_ignores_missing_and_invalid_quota_info_without_panicking() {
    let value = json!({
        "models": {
            "claude-sonnet-4": {},
            "gpt-oss-120b": {"quotaInfo": {"remainingFraction": "unknown"}},
            "other-model": null
        }
    });

    let (gemini, shared) = parse_available_models(&value);
    assert!(gemini.is_none());
    assert!(shared.is_none());
}
