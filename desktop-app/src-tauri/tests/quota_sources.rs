pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::agy_cli::parse_quota_envelope;
use quota::cloud_code::normalize_cloud_snapshot;
use quota::credentials::{decode_keyring_secret, extract_oauth_clients, parse_credential_json};
use quota::ProviderErrorKind;

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
    assert_eq!(gemini.five_hour_percent, 82);
    assert_eq!(gemini.weekly_percent, 61);
    assert!(!gemini.five_hour_disabled);
    assert!(!gemini.weekly_disabled);

    let shared = status.quotas.iter().find(|q| q.model == "Claude & OpenAI").unwrap();
    assert_eq!(shared.five_hour_percent, 73);
    assert!(!shared.five_hour_disabled);
    assert!(shared.weekly_disabled);
}

#[test]
fn agy_missing_window_stays_disabled() {
    let input = r#"{"command":{"data":{"groups":[{"name":"Gemini Models","buckets":[{"window":"weekly","remaining_fraction":0.5,"reset_time":"2026-09-08T00:00:00Z"}]}]}}}"#;
    let status = parse_quota_envelope(input).unwrap();
    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert!(gemini.five_hour_disabled);
    assert_eq!(gemini.five_hour_percent, 0);
    assert!(!gemini.weekly_disabled);
    assert_eq!(gemini.weekly_percent, 50);
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
        "paidTier": {"id": "pro", "availableCredits": [{"creditAmount": "12.5"}, {"creditAmount": 2}]}
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
    assert_eq!(status.plan_tier.as_deref(), Some("pro"));
    assert_eq!(status.credits.as_ref().unwrap().balance, 14.5);
    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.percent, 64);
    assert!(gemini.five_hour_disabled);
    assert!(gemini.weekly_disabled);
    let shared = status.quotas.iter().find(|q| q.model == "Claude & OpenAI").unwrap();
    assert_eq!(shared.percent, 42);
    assert!(shared.five_hour_disabled);
    assert!(shared.weekly_disabled);
}
