pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::agy_cli::parse_quota_envelope;
use quota::ProviderError;

fn grouped_fixture() -> &'static str {
    r#"{
      "command": {
        "data": {
          "groups": [
            {
              "name": "Gemini Models",
              "buckets": [
                {"window":"5h","remaining_fraction":0.72,"reset_time":"2026-09-04T01:00:00Z"},
                {"window":"weekly","remaining_fraction":0.44,"reset_time":"2026-09-08T00:00:00Z"}
              ]
            },
            {
              "name": "Claude and GPT models",
              "buckets": [
                {"window":"5h","remaining_fraction":0.61,"reset_time":"2026-09-04T02:00:00Z"},
                {"window":"weekly","remaining_fraction":0.33,"reset_time":"2026-09-09T00:00:00Z"}
              ]
            }
          ]
        }
      }
    }"#
}

#[test]
fn parses_two_provider_cards_from_structured_envelope() {
    let status = parse_quota_envelope(grouped_fixture()).unwrap();
    assert_eq!(status.quotas.len(), 2);

    let gemini = &status.quotas[0];
    assert_eq!(gemini.model, "Gemini");
    assert_eq!(gemini.five_hour_percent, 72);
    assert_eq!(gemini.weekly_percent, 44);
    assert_eq!(gemini.five_hour_reset, "2026-09-04T01:00:00Z");
    assert_eq!(gemini.weekly_reset, "2026-09-08T00:00:00Z");
    assert!(!gemini.five_hour_disabled);
    assert!(!gemini.weekly_disabled);

    let shared = &status.quotas[1];
    assert_eq!(shared.model, "Claude & OpenAI");
    assert_eq!(shared.five_hour_percent, 61);
    assert_eq!(shared.weekly_percent, 33);
    assert_eq!(shared.five_hour_reset, "2026-09-04T02:00:00Z");
    assert_eq!(shared.weekly_reset, "2026-09-09T00:00:00Z");
}

#[test]
fn accepts_camel_case_bucket_fields() {
    let input = r#"{
      "command": {"data": {"groups": [{
        "name": "Gemini Models",
        "buckets": [
          {"window":"5h","remainingFraction":0.25,"resetTime":"2026-09-04T03:00:00Z"},
          {"window":"weekly","remainingFraction":0.5,"resetTime":"2026-09-10T00:00:00Z"}
        ]
      }]}}
    }"#;

    let status = parse_quota_envelope(input).unwrap();
    assert_eq!(status.quotas[0].five_hour_percent, 25);
    assert_eq!(status.quotas[0].weekly_percent, 50);
}

#[test]
fn missing_weekly_bucket_stays_disabled() {
    let input = r#"{
      "command": {"data": {"groups": [{
        "name": "Gemini Models",
        "buckets": [
          {"window":"5h","remaining_fraction":0.8,"reset_time":"2026-09-04T03:00:00Z"}
        ]
      }]}}
    }"#;

    let status = parse_quota_envelope(input).unwrap();
    let quota = &status.quotas[0];
    assert_eq!(quota.five_hour_percent, 80);
    assert_eq!(quota.weekly_percent, 0);
    assert!(quota.weekly_disabled);
    assert!(quota.weekly_reset.is_empty());
}

#[test]
fn clamps_out_of_range_fractions() {
    let input = r#"{
      "command": {"data": {"groups": [{
        "name": "Gemini Models",
        "buckets": [
          {"window":"5h","remaining_fraction":1.8},
          {"window":"weekly","remaining_fraction":-0.4}
        ]
      }]}}
    }"#;

    let status = parse_quota_envelope(input).unwrap();
    assert_eq!(status.quotas[0].five_hour_percent, 100);
    assert_eq!(status.quotas[0].weekly_percent, 0);
}

#[test]
fn rejects_malformed_or_human_formatted_output() {
    for input in ["{not-json", "Gemini 5h 72% | weekly 44%"] {
        let error = parse_quota_envelope(input).unwrap_err();
        assert!(matches!(error, ProviderError::InvalidData(_)));
    }
}

#[test]
fn rejects_json_without_group_contract() {
    let error = parse_quota_envelope(r#"{"command":{"data":{}}}"#).unwrap_err();
    assert!(matches!(error, ProviderError::InvalidData(_)));
}

#[test]
fn skips_unrelated_groups_and_requires_quota_data() {
    let input = r#"{
      "command": {"data": {"groups": [
        {"name":"Image credits","buckets":[{"window":"5h","remaining_fraction":0.4}]}
      ]}}
    }"#;
    let error = parse_quota_envelope(input).unwrap_err();
    assert!(matches!(error, ProviderError::InvalidData(_)));
}
