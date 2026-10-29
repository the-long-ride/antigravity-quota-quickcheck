pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::agy_cli::parse_quota_envelope;
use quota::cloud_code::normalize_cloud_snapshot;
use quota::credentials::{decode_keyring_secret, extract_oauth_clients, parse_credential_json};
use quota::ProviderErrorKind;

#[test]
fn create_no_window_flag_is_correct() {
    assert_eq!(tauri_app_lib::quota::process::CREATE_NO_WINDOW_FLAG, 0x0800_0000);
}

#[test]
fn parses_agy_grouped_quota_windows() {
    let input = r#"{
      "command": {"data": {"groups": [
        {"name": "Gemini Models", "buckets": [
          {"window": "5h", "remaining_fraction": 0.82, "reset_time": "2026-09-04T05:00:00Z"},
          {"window": "weekly", "remaining_fraction": 0.61, "reset_time": "2026-09-08T00:00:00Z"}
        ]},
        {"name": "Claude and GPT models", "buckets": [
          {"window": "5h", "remaining_fraction": 0.73, "reset_time": "2026-09-04T04:00:00Z"}
        ]}
      ]}}
    }"#;

    let status = parse_quota_envelope(input).expect("valid quota envelope");
    assert_eq!(status.quotas.len(), 2);
    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.five_hour_percent, Some(82));
    assert_eq!(gemini.weekly_percent, Some(61));
    assert_eq!(gemini.five_hour_disabled, Some(false));
    assert_eq!(gemini.weekly_disabled, Some(false));

    let shared = status.quotas.iter().find(|q| q.model == "Claude & OpenAI").unwrap();
    assert_eq!(shared.five_hour_percent, Some(73));
    assert_eq!(shared.five_hour_disabled, Some(false));
    assert_eq!(shared.weekly_disabled, Some(true));
}

#[test]
fn agy_missing_window_stays_disabled() {
    let input = r#"{"command":{"data":{"groups":[{"name":"Gemini Models","buckets":[{"window":"weekly","remaining_fraction":0.5,"reset_time":"2026-09-08T00:00:00Z"}]}]}}}"#;
    let status = parse_quota_envelope(input).unwrap();
    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.five_hour_disabled, Some(true));
    assert_eq!(gemini.five_hour_percent, Some(0));
    assert_eq!(gemini.weekly_disabled, Some(false));
    assert_eq!(gemini.weekly_percent, Some(50));
}

#[test]
fn agy_rejects_human_or_wrong_json() {
    let err = parse_quota_envelope("Gemini Models 82% remaining").unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::InvalidData);
    let err = parse_quota_envelope(r#"{"command":{"data":{}}}"#).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::InvalidData);
}

#[test]
fn parses_nested_and_flat_credential_json() {
    let nested = parse_credential_json(r#"{"token":{"access_token":"a","refresh_token":"r","expiry":"2026-09-04T01:00:00Z"}}"#).unwrap();
    assert_eq!(nested.access_token.as_deref(), Some("a"));
    assert_eq!(nested.refresh_token, "r");

    let flat = parse_credential_json(r#"{"access_token":"b","refresh_token":"s","expiry_date":1234567890}"#).unwrap();
    assert_eq!(flat.access_token.as_deref(), Some("b"));
    assert_eq!(flat.refresh_token, "s");
}

#[test]
fn decodes_go_keyring_base64_secret() {
    let encoded = "go-keyring-base64:eyJ0b2tlbiI6eyJyZWZyZXNoX3Rva2VuIjoiciJ9fQ==";
    assert_eq!(decode_keyring_secret(encoded).unwrap(), r#"{"token":{"refresh_token":"r"}}"#);
}

#[test]
fn extracts_and_deduplicates_oauth_client_pairs() {
    let client_id = format!("{}{}", "123456789012-", "abcdefghijklmnop.apps.googleusercontent.com");
    let client_secret = format!("{}{}", "GOCSP", "X-abcdefghijklmnopqrstuvwxyzAB");
    let sample = format!("{client_id} xx {client_secret} {client_id} {client_secret}");
    let pairs = extract_oauth_clients(sample.as_bytes());
    assert_eq!(pairs.len(), 1);
    assert_eq!(pairs[0].0, client_id);
    assert_eq!(pairs[0].1, client_secret);
}

#[test]
fn cloud_snapshot_groups_provider_pools_without_inventing_windows() {
    let load = serde_json::json!({
        "currentTier": {"id": "free-tier", "name": "Antigravity"},
        "paidTier": {
            "id": "g1-pro-tier",
            "name": "Google AI Pro",
            "availableCredits": [
                {"creditType": "GOOGLE_ONE_AI", "creditAmount": "12.5"},
                {"creditType": "GOOGLE_ONE_AI", "creditAmount": 2}
            ]
        }
    });
    let quota = serde_json::json!({
        "buckets": [
            {"modelId": "gemini-3-pro", "tokenType": "REQUESTS", "remainingFraction": 0.67, "resetTime": "2026-09-04T03:00:00Z"}
        ]
    });
    let models = serde_json::json!({
        "models": {
            "gemini-3-pro": {"quotaInfo": {"remainingFraction": 0.64, "resetTime": "2026-09-04T02:00:00Z"}},
            "claude-sonnet-4": {"quotaInfo": {"remainingFraction": 0.42, "resetTime": "2026-09-04T01:00:00Z"}},
            "gpt-oss-120b": {"quotaInfo": {"remainingFraction": 0.42, "resetTime": "2026-09-04T01:00:00Z"}}
        }
    });

    let status = normalize_cloud_snapshot(&load, &quota, &models).unwrap();
    assert_eq!(status.plan_tier.as_deref(), Some("Google AI Pro"));
    assert_eq!(status.credits.as_ref().unwrap().balance, 14.5);
    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.percent, 64);
    assert_eq!(gemini.five_hour_disabled, Some(true));
    assert_eq!(gemini.weekly_disabled, Some(true));
    let shared = status.quotas.iter().find(|q| q.model == "Claude & OpenAI").unwrap();
    assert_eq!(shared.percent, 42);
    assert_eq!(shared.five_hour_disabled, Some(true));
    assert_eq!(shared.weekly_disabled, Some(true));
}

#[test]
fn cloud_snapshot_normalizes_g1_pro_tier_id() {
    let load = serde_json::json!({"paidTier": {"id": "g1-pro-tier"}});
    let status = normalize_cloud_snapshot(&load, &serde_json::json!({}), &serde_json::json!({})).unwrap();
    assert_eq!(status.plan_tier.as_deref(), Some("Google AI Pro"));
}

#[test]
fn cloud_snapshot_falls_back_to_unknown_tier_id_when_unmapped() {
    let load = serde_json::json!({"paidTier": {"id": "custom-tier"}});
    let status = normalize_cloud_snapshot(&load, &serde_json::json!({}), &serde_json::json!({})).unwrap();
    assert_eq!(status.plan_tier.as_deref(), Some("custom-tier"));
}

#[test]
fn parses_agy_with_argon_group() {
    let input = r#"{
      "command": {"data": {"groups": [
        {"name": "Gemini Models", "buckets": [
          {"window": "5h", "remaining_fraction": 0.85, "reset_time": "2026-09-04T05:00:00Z"},
          {"window": "weekly", "remaining_fraction": 0.70, "reset_time": "2026-09-08T00:00:00Z"}
        ]},
        {"name": "Claude and GPT models", "buckets": [
          {"window": "5h", "remaining_fraction": 0.90, "reset_time": "2026-09-04T04:00:00Z"}
        ]},
        {"name": "Gemini 4 Argon", "buckets": [
          {"window": "weekly", "remaining_fraction": 0.95, "reset_time": "2026-09-11T00:00:00Z"}
        ]}
      ]}}
    }"#;

    let status = parse_quota_envelope(input).expect("valid quota envelope with argon");
    assert_eq!(status.quotas.len(), 3);
    assert_eq!(status.quotas[0].model, "Gemini");
    assert_eq!(status.quotas[1].model, "Gemini 4 Argon");
    assert_eq!(status.quotas[2].model, "Claude & OpenAI");

    let argon = status.quotas.iter().find(|q| q.model == "Gemini 4 Argon").unwrap();
    assert_eq!(argon.percent, 95);
    assert_eq!(argon.refresh_time, "2026-09-11T00:00:00Z");
    assert_eq!(argon.five_hour_percent, None);
    assert_eq!(argon.five_hour_reset, None);
    assert_eq!(argon.five_hour_disabled, None);
    assert_eq!(argon.weekly_percent, Some(95));
    assert_eq!(argon.weekly_reset.as_deref(), Some("2026-09-11T00:00:00Z"));
    assert_eq!(argon.weekly_disabled, Some(false));
}

#[test]
fn cloud_snapshot_with_distinct_argon_emits_3_cards() {
    let load = serde_json::json!({
        "paidTier": {"name": "Google AI Pro"}
    });
    let quota = serde_json::json!({
        "buckets": [
            {"modelId": "gemini-3-pro", "tokenType": "REQUESTS", "remainingFraction": 0.80, "resetTime": "2026-09-04T03:00:00Z"},
            {"modelId": "gemini-4-argon", "tokenType": "REQUESTS", "remainingFraction": 0.45, "resetTime": "2026-09-11T00:00:00Z"}
        ]
    });
    let models = serde_json::json!({
        "models": {
            "gemini-3-pro": {"quotaInfo": {"remainingFraction": 0.80, "resetTime": "2026-09-04T03:00:00Z"}},
            "claude-sonnet-4": {"quotaInfo": {"remainingFraction": 0.60, "resetTime": "2026-09-04T01:00:00Z"}},
            "gemini-4-argon": {"quotaInfo": {"remainingFraction": 0.45, "resetTime": "2026-09-11T00:00:00Z"}}
        }
    });

    let status = normalize_cloud_snapshot(&load, &quota, &models).unwrap();
    assert_eq!(status.quotas.len(), 3);

    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.percent, 80);

    let shared = status.quotas.iter().find(|q| q.model == "Claude & OpenAI").unwrap();
    assert_eq!(shared.percent, 60);

    let argon = status.quotas.iter().find(|q| q.model == "Gemini 4 Argon").unwrap();
    assert_eq!(argon.percent, 45);
    assert_eq!(argon.refresh_time, "2026-09-11T00:00:00Z");
    assert_eq!(argon.five_hour_percent, None);
    assert_eq!(argon.five_hour_reset, None);
    assert_eq!(argon.five_hour_disabled, None);
    assert_eq!(argon.weekly_percent, Some(45));
    assert_eq!(argon.weekly_reset.as_deref(), Some("2026-09-11T00:00:00Z"));
    assert_eq!(argon.weekly_disabled, Some(false));
}

#[test]
fn cloud_snapshot_merges_argon_into_gemini_when_signatures_match() {
    let load = serde_json::json!({
        "paidTier": {"name": "Google AI Pro"}
    });
    // No dedicated argon in user_quota buckets
    let quota = serde_json::json!({
        "buckets": [
            {"modelId": "gemini-3-pro", "tokenType": "REQUESTS", "remainingFraction": 0.80, "resetTime": "2026-09-04T03:00:00Z"}
        ]
    });
    // available_models has argon with exact matching signature to gemini
    let models = serde_json::json!({
        "models": {
            "gemini-3-pro": {"quotaInfo": {"remainingFraction": 0.80, "resetTime": "2026-09-04T03:00:00Z"}},
            "claude-sonnet-4": {"quotaInfo": {"remainingFraction": 0.60, "resetTime": "2026-09-04T01:00:00Z"}},
            "gemini-4-argon": {"quotaInfo": {"remainingFraction": 0.80, "resetTime": "2026-09-04T03:00:00Z"}}
        }
    });

    let status = normalize_cloud_snapshot(&load, &quota, &models).unwrap();
    // Argon merged into Gemini -> only Gemini and Claude & OpenAI
    assert_eq!(status.quotas.len(), 2);
    assert!(status.quotas.iter().any(|q| q.model == "Gemini"));
    assert!(status.quotas.iter().any(|q| q.model == "Claude & OpenAI"));
    assert!(!status.quotas.iter().any(|q| q.model == "Gemini 4 Argon"));
}

#[test]
fn normalizes_plan_tier_variations() {
    assert_eq!(quota::normalize_plan_tier("free-tier"), "Free");
    assert_eq!(quota::normalize_plan_tier("free"), "Free");
    assert_eq!(quota::normalize_plan_tier("standard-tier"), "Paid");
    assert_eq!(quota::normalize_plan_tier("standard"), "Paid");
    assert_eq!(quota::normalize_plan_tier("legacy-tier"), "Legacy");
    assert_eq!(quota::normalize_plan_tier("advanced-tier"), "Google AI Pro");
    assert_eq!(quota::normalize_plan_tier("google_ai_pro"), "Google AI Pro");
    assert_eq!(quota::normalize_plan_tier("ultra-tier"), "Google AI Ultra");
    assert_eq!(quota::normalize_plan_tier("google_ai_ultra"), "Google AI Ultra");
    assert_eq!(quota::normalize_plan_tier("g1-pro-tier"), "Google AI Pro");
    assert_eq!(quota::normalize_plan_tier("g1-ultra-tier"), "Google AI Ultra");
    assert_eq!(quota::normalize_plan_tier("custom-plan"), "custom-plan");
    assert_eq!(quota::normalize_plan_tier(""), "");
}

#[test]
fn extracts_plan_tier_from_complex_structures() {
    let payload1 = serde_json::json!({
        "planInfo": {"planType": "advanced-tier"}
    });
    assert_eq!(quota::extract_plan_tier(&payload1).as_deref(), Some("Google AI Pro"));

    let payload2 = serde_json::json!({
        "userStatus": {
            "planInfo": {"planType": "ultra-tier"}
        }
    });
    assert_eq!(quota::extract_plan_tier(&payload2).as_deref(), Some("Google AI Ultra"));

    let payload3 = serde_json::json!({
        "currentTier": {"id": "free-tier", "name": "Antigravity"}
    });
    assert_eq!(quota::extract_plan_tier(&payload3).as_deref(), Some("Free"));

    let payload4 = serde_json::json!({
        "planTier": "google_ai_pro"
    });
    assert_eq!(quota::extract_plan_tier(&payload4).as_deref(), Some("Google AI Pro"));
}
