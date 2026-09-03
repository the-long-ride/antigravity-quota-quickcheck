pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::language_server::parse_full_status;
use serde_json::json;

#[test]
fn parser_preserves_grouped_cards_weekly_exhaustion_credits_and_plan() {
    let raw = json!({
        "userStatus": {
            "userInfo": {
                "creditInfo": {
                    "currentBalance": "12.5",
                    "creditType": "MONTHLY"
                }
            },
            "userTier": {"name": "Google AI Pro"},
            "cascadeModelConfigData": {
                "clientModelConfigs": [
                    {"label": "Gemini 3 Pro"},
                    {"label": "OpenAI o3"}
                ]
            }
        }
    });
    let quota_summary = json!({
        "response": {
            "groups": [
                {
                    "displayName": "Gemini Models",
                    "description": "Gemini shared quota",
                    "buckets": [
                        {"window": "5h", "remainingFraction": 0.82, "resetTime": "2026-09-04T05:00:00Z"},
                        {"window": "weekly", "remainingFraction": 0.0, "resetTime": "2026-09-08T00:00:00Z"}
                    ]
                },
                {
                    "displayName": "Claude and GPT models",
                    "description": "Claude and OpenAI shared quota",
                    "buckets": [
                        {"window": "5h", "remainingFraction": 0.61, "resetTime": "2026-09-04T04:00:00Z"},
                        {"window": "weekly", "remainingFraction": 0.37, "resetTime": "2026-09-09T00:00:00Z"}
                    ]
                }
            ]
        }
    });

    let status = parse_full_status(raw, quota_summary).unwrap();

    assert_eq!(status.plan_tier.as_deref(), Some("Google AI Pro"));
    let credits = status.credits.unwrap();
    assert_eq!(credits.balance, 12.5);
    assert_eq!(credits.credit_type, "MONTHLY");
    assert_eq!(status.quotas.len(), 2);

    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.weekly_percent, 0);
    assert_eq!(gemini.five_hour_percent, 0, "existing semantics force 5h to zero when weekly is exhausted");
    assert_eq!(gemini.weekly_reset, "2026-09-08T00:00:00Z");

    let shared = status
        .quotas
        .iter()
        .find(|q| q.model == "Claude & OpenAI")
        .unwrap();
    assert_eq!(shared.five_hour_percent, 61);
    assert_eq!(shared.weekly_percent, 37);
    assert_eq!(shared.five_hour_reset, "2026-09-04T04:00:00Z");
}

#[test]
fn parser_keeps_existing_per_model_quota_fallback_before_grouping() {
    let raw = json!({
        "userStatus": {
            "cascadeModelConfigData": {
                "clientModelConfigs": [
                    {
                        "label": "Gemini 3 Flash",
                        "quotaInfo": {
                            "remainingFraction": 0.55,
                            "resetTime": "2026-09-04T03:00:00Z"
                        }
                    },
                    {
                        "label": "Claude Sonnet 4",
                        "quotaInfo": {
                            "remainingFraction": 0.42,
                            "resetTime": "2026-09-04T02:00:00Z"
                        }
                    }
                ]
            }
        }
    });

    let status = parse_full_status(raw, serde_json::Value::Null).unwrap();
    assert_eq!(status.quotas.len(), 2);

    let gemini = status.quotas.iter().find(|q| q.model == "Gemini").unwrap();
    assert_eq!(gemini.five_hour_percent, 55);
    assert_eq!(gemini.weekly_percent, 55);

    let shared = status
        .quotas
        .iter()
        .find(|q| q.model == "Claude & OpenAI")
        .unwrap();
    assert_eq!(shared.five_hour_percent, 42);
    assert_eq!(shared.weekly_percent, 42);
}
