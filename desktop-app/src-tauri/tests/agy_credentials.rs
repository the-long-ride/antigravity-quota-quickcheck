pub use tauri_app_lib::{CreditInfo, FullStatus, QuotaData};

#[path = "../src/quota/mod.rs"]
mod quota;

use quota::credentials::{
    extract_oauth_clients, parse_credential_json, CredentialSource,
};
use quota::ProviderError;

#[test]
fn normalizes_nested_windows_credential_blob() {
    let raw = r#"{
      "token": {
        "access_token": "access-value",
        "refresh_token": "refresh-value",
        "expiry": "2026-09-04T00:00:00Z"
      },
      "auth_method": "consumer"
    }"#;

    let credential =
        parse_credential_json(raw, CredentialSource::WindowsCredentialManager).unwrap();
    assert_eq!(credential.access_token.as_deref(), Some("access-value"));
    assert_eq!(credential.refresh_token, "refresh-value");
    assert_eq!(credential.source, CredentialSource::WindowsCredentialManager);
}

#[test]
fn normalizes_flat_oauth_file_blob() {
    let raw = r#"{
      "access_token": "access-value",
      "refresh_token": "refresh-value",
      "expiry_date": 1788480000000
    }"#;

    let credential = parse_credential_json(raw, CredentialSource::OAuthFile).unwrap();
    assert_eq!(credential.access_token.as_deref(), Some("access-value"));
    assert_eq!(credential.refresh_token, "refresh-value");
    assert_eq!(credential.source, CredentialSource::OAuthFile);
}

#[test]
fn rejects_credential_without_refresh_token() {
    let error = parse_credential_json(
        r#"{"token":{"access_token":"access-value"}}"#,
        CredentialSource::WindowsCredentialManager,
    )
    .unwrap_err();
    assert!(matches!(error, ProviderError::Auth(_)));
    assert!(!error.to_string().contains("access-value"));
}

#[test]
fn extracts_oauth_client_candidates_from_binary_bytes() {
    let client_id = [
        "123456789012-",
        "abcdefghijklmnop",
        ".apps.googleusercontent.com",
    ]
    .concat();
    let client_secret = ["GOC", "SPX-", "abcdefghijklmnopqrstuvwxyz12"].concat();
    let bytes = format!("prefix {client_id} middle {client_secret} suffix").into_bytes();

    let clients = extract_oauth_clients(&bytes).unwrap();
    assert_eq!(clients.len(), 1);
    assert_eq!(clients[0].client_id, client_id);
    assert_eq!(clients[0].client_secret, client_secret);
}

#[test]
fn de_duplicates_discovered_oauth_pairs() {
    let client_id = [
        "123456789012-",
        "abcdefghijklmnop",
        ".apps.googleusercontent.com",
    ]
    .concat();
    let client_secret = ["GOC", "SPX-", "abcdefghijklmnopqrstuvwxyz12"].concat();
    let bytes = format!(
        "{client_id} {client_secret} duplicate {client_id} {client_secret}"
    )
    .into_bytes();

    let clients = extract_oauth_clients(&bytes).unwrap();
    assert_eq!(clients.len(), 1);
}

#[test]
fn rejects_binary_without_oauth_candidates() {
    let error = extract_oauth_clients(b"no oauth material here").unwrap_err();
    assert!(matches!(error, ProviderError::Unavailable(_)));
}
