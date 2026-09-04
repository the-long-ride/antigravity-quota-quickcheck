use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use base64::Engine;
use regex::Regex;
use serde_json::Value;
use tokio::process::Command;

use super::process::hide_tokio_command;
use super::{ProviderError, ProviderErrorKind};

const PROVIDER: &str = "agy credentials";
const KEYRING_SERVICE: &str = "gemini";
const KEYRING_ACCOUNT: &str = "antigravity";
const KEYRING_TARGET_WINDOWS: &str = "gemini:antigravity";
const KEYRING_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct AgyCredential {
    pub access_token: Option<String>,
    pub refresh_token: String,
    pub expiry_ms: Option<i64>,
}

pub fn find_agy_binary() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("AGY_BIN") {
        let path = PathBuf::from(override_path);
        if path.is_file() {
            return Some(path);
        }
    }

    let exe = if cfg!(target_os = "windows") { "agy.exe" } else { "agy" };
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let path = dir.join(exe);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let path = PathBuf::from(local).join("agy").join("bin").join("agy.exe");
        if path.is_file() {
            return Some(path);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = home_dir() {
            let path = home.join(".local").join("bin").join("agy");
            if path.is_file() {
                return Some(path);
            }
        }
        let path = PathBuf::from("/usr/local/bin/agy");
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

pub fn extract_oauth_clients(bytes: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(bytes);
    let id_re = Regex::new(r"[0-9]{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com")
        .expect("valid client id regex");
    let secret_re = Regex::new(r"GOCSPX-[A-Za-z0-9_-]{28}").expect("valid client secret regex");

    let ids: Vec<String> = id_re.find_iter(&text).map(|m| m.as_str().to_string()).collect();
    let secrets: Vec<String> = secret_re.find_iter(&text).map(|m| m.as_str().to_string()).collect();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        for secret in &secrets {
            let key = format!("{id}\0{secret}");
            if seen.insert(key) {
                out.push((id.clone(), secret.clone()));
            }
        }
    }
    out
}

pub fn decode_keyring_secret(raw: &str) -> Result<String, ProviderError> {
    let trimmed = raw.trim();
    if let Some(encoded) = trimmed.strip_prefix("go-keyring-base64:") {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "keyring credential is not valid base64"))?;
        return String::from_utf8(decoded)
            .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "keyring credential is not UTF-8"));
    }
    Ok(trimmed.to_string())
}

pub fn parse_credential_json(raw: &str) -> Result<AgyCredential, ProviderError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "credential payload is not valid JSON"))?;
    let token = value.get("token").filter(|v| v.is_object()).unwrap_or(&value);

    let refresh_token = token
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Auth, "agy credential has no refresh token"))?
        .to_string();
    let access_token = token
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let expiry_ms = token
        .get("expiry")
        .or_else(|| token.get("expiry_date"))
        .and_then(parse_expiry_ms);

    Ok(AgyCredential {
        access_token,
        refresh_token,
        expiry_ms,
    })
}

fn parse_expiry_ms(value: &Value) -> Option<i64> {
    let n = value.as_i64()?;
    if n < 10_000_000_000 {
        Some(n.saturating_mul(1000))
    } else {
        Some(n)
    }
}

pub async fn load_credential() -> Result<AgyCredential, ProviderError> {
    if let Ok(secret) = read_native_keyring().await {
        let decoded = decode_keyring_secret(&secret)?;
        return parse_credential_json(&decoded);
    }

    let path = home_dir()
        .map(|home| home.join(".gemini").join("oauth_creds.json"))
        .filter(|path| path.is_file())
        .ok_or_else(|| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "agy keyring credential was not found"))?;
    let raw = tokio::fs::read_to_string(path)
        .await
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "could not read agy credential fallback file"))?;
    parse_credential_json(&raw)
}

async fn read_native_keyring() -> Result<String, ProviderError> {
    #[cfg(target_os = "windows")]
    {
        let script = windows_credential_script();
        let mut utf16 = Vec::with_capacity(script.len() * 2);
        for unit in script.encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
        return run_keyring_command("powershell", &["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return run_keyring_command(
            "security",
            &["find-generic-password", "-s", KEYRING_SERVICE, "-a", KEYRING_ACCOUNT, "-w"],
        )
        .await;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return run_keyring_command(
            "secret-tool",
            &["lookup", "service", KEYRING_SERVICE, "username", KEYRING_ACCOUNT],
        )
        .await;
    }

    #[allow(unreachable_code)]
    Err(ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "native keyring is unsupported on this platform"))
}

async fn run_keyring_command(program: &str, args: &[&str]) -> Result<String, ProviderError> {
    let mut command = Command::new(program);
    hide_tokio_command(&mut command);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(KEYRING_TIMEOUT, command.output())
        .await
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Transient, "native keyring lookup timed out"))?
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "native keyring helper is unavailable"))?;
    if !output.status.success() {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "native keyring credential was not found"));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::InvalidData, "native keyring credential is not UTF-8"))?;
    if text.trim().is_empty() {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "native keyring credential was empty"));
    }
    Ok(text)
}

#[cfg(target_os = "windows")]
fn windows_credential_script() -> String {
    format!(r#"
$ErrorActionPreference='Stop'
$src=@'
using System;
using System.Runtime.InteropServices;
public static class AgyCred {{
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL {{ public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }}
  public static byte[] Read(string target) {{
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {{ var c=(CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL)); var b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,b.Length); return b; }} finally {{ CredFree(ptr); }}
  }}
}}
'@
Add-Type -TypeDefinition $src | Out-Null
$b=[AgyCred]::Read('{target}')
if ($null -eq $b) {{ exit 3 }}
[Console]::OutputEncoding=[Text.Encoding]::UTF8
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))
"#, target = KEYRING_TARGET_WINDOWS)
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

pub fn read_oauth_clients_from_binary(path: &Path) -> Result<Vec<(String, String)>, ProviderError> {
    let bytes = std::fs::read(path)
        .map_err(|_| ProviderError::new(PROVIDER, ProviderErrorKind::Unavailable, "could not read agy executable"))?;
    let candidates = extract_oauth_clients(&bytes);
    if candidates.is_empty() {
        return Err(ProviderError::new(PROVIDER, ProviderErrorKind::Unsupported, "agy executable did not contain discoverable OAuth client credentials"));
    }
    Ok(candidates)
}
