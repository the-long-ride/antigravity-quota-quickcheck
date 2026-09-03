use super::agy_cli::find_agy_binary;
use super::ProviderError;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;

const MAX_CREDENTIAL_BYTES: u64 = 1024 * 1024;
const MAX_AGY_BINARY_BYTES: u64 = 256 * 1024 * 1024;
const WINDOWS_CREDENTIAL_TARGET: &str = "gemini:antigravity";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialSource {
    WindowsCredentialManager,
    OAuthFile,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgyCredential {
    pub access_token: Option<String>,
    pub refresh_token: String,
    pub source: CredentialSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

pub fn parse_credential_json(
    raw: &str,
    source: CredentialSource,
) -> Result<AgyCredential, ProviderError> {
    let parsed: Value = serde_json::from_str(raw)
        .map_err(|_| ProviderError::InvalidData("agy credential was not valid JSON".to_string()))?;

    let token = parsed
        .get("token")
        .filter(|value| value.is_object())
        .unwrap_or(&parsed);

    let access_token = token
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let refresh_token = token
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ProviderError::Auth("agy credential has no refresh token".to_string()))?
        .to_string();

    Ok(AgyCredential {
        access_token,
        refresh_token,
        source,
    })
}

pub fn extract_oauth_clients(bytes: &[u8]) -> Result<Vec<OAuthClient>, ProviderError> {
    let text = String::from_utf8_lossy(bytes);
    let id_re = Regex::new(r"[0-9]{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com")
        .map_err(|_| ProviderError::InvalidData("OAuth client matcher could not be initialized".to_string()))?;
    let secret_prefix = ["GOC", "SPX-"].concat();
    let secret_pattern = format!(r"{}[A-Za-z0-9_-]{{28}}", regex::escape(&secret_prefix));
    let secret_re = Regex::new(&secret_pattern)
        .map_err(|_| ProviderError::InvalidData("OAuth client matcher could not be initialized".to_string()))?;

    let ids: Vec<String> = id_re
        .find_iter(&text)
        .map(|match_| match_.as_str().to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let secrets: Vec<String> = secret_re
        .find_iter(&text)
        .map(|match_| match_.as_str().to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    if ids.is_empty() || secrets.is_empty() {
        return Err(ProviderError::Unavailable(
            "OAuth client material was not found in the agy binary".to_string(),
        ));
    }

    let mut seen = HashSet::new();
    let mut clients = Vec::new();
    for client_id in ids {
        for client_secret in &secrets {
            let key = (client_id.clone(), client_secret.clone());
            if seen.insert(key.clone()) {
                clients.push(OAuthClient {
                    client_id: key.0,
                    client_secret: key.1,
                });
            }
        }
    }

    Ok(clients)
}

pub fn discover_oauth_clients(path: &Path) -> Result<Vec<OAuthClient>, ProviderError> {
    let metadata = fs::metadata(path)
        .map_err(|_| ProviderError::Unavailable("agy binary could not be read".to_string()))?;
    if !metadata.is_file() {
        return Err(ProviderError::Unavailable(
            "agy binary path is not a file".to_string(),
        ));
    }
    if metadata.len() > MAX_AGY_BINARY_BYTES {
        return Err(ProviderError::InvalidData(
            "agy binary exceeded the scan size limit".to_string(),
        ));
    }

    let bytes = fs::read(path)
        .map_err(|_| ProviderError::Unavailable("agy binary could not be read".to_string()))?;
    extract_oauth_clients(&bytes)
}

pub fn discover_installed_oauth_clients() -> Result<Vec<OAuthClient>, ProviderError> {
    let path = find_agy_binary()?;
    discover_oauth_clients(&path)
}

pub fn load_credential() -> Result<AgyCredential, ProviderError> {
    #[cfg(target_os = "windows")]
    {
        load_windows_credential()
    }

    #[cfg(not(target_os = "windows"))]
    {
        load_oauth_file()
    }
}

#[cfg(target_os = "windows")]
fn load_windows_credential() -> Result<AgyCredential, ProviderError> {
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class AgyCredentialReader {
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll", SetLastError=false)]
    public static extern void CredFree(IntPtr credential);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }
    public static byte[] Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return null;
        try {
            var credential = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, credential.CredentialBlobSize);
            return bytes;
        } finally {
            CredFree(ptr);
        }
    }
}
'@
Add-Type -TypeDefinition $signature | Out-Null
$bytes = [AgyCredentialReader]::Read('gemini:antigravity')
if ($null -eq $bytes) {
    [Console]::Error.Write('CRED_NOT_FOUND')
    exit 3
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
"#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .output()
        .map_err(|_| {
            ProviderError::Unavailable("Windows Credential Manager could not be queried".to_string())
        })?;

    if output.stdout.len() as u64 > MAX_CREDENTIAL_BYTES
        || output.stderr.len() as u64 > MAX_CREDENTIAL_BYTES
    {
        return Err(ProviderError::InvalidData(
            "agy credential output exceeded the size limit".to_string(),
        ));
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("CRED_NOT_FOUND") {
            return Err(ProviderError::Unavailable(format!(
                "agy credential {WINDOWS_CREDENTIAL_TARGET} was not found in Windows Credential Manager"
            )));
        }
        return Err(ProviderError::Unavailable(
            "Windows Credential Manager could not return the agy credential".to_string(),
        ));
    }

    let raw = String::from_utf8(output.stdout)
        .map_err(|_| ProviderError::InvalidData("agy credential was not UTF-8".to_string()))?;
    let json_start = raw.find('{').unwrap_or(0);
    parse_credential_json(
        raw.get(json_start..).unwrap_or(""),
        CredentialSource::WindowsCredentialManager,
    )
}

#[cfg(not(target_os = "windows"))]
fn load_oauth_file() -> Result<AgyCredential, ProviderError> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| ProviderError::Unavailable("HOME is not available".to_string()))?;
    let path = home.join(".gemini").join("oauth_creds.json");
    read_credential_file(&path)
}

#[cfg(not(target_os = "windows"))]
fn read_credential_file(path: &Path) -> Result<AgyCredential, ProviderError> {
    let metadata = fs::metadata(path).map_err(|_| {
        ProviderError::Unavailable("agy OAuth credential file was not found".to_string())
    })?;
    if !metadata.is_file() {
        return Err(ProviderError::Unavailable(
            "agy OAuth credential path is not a file".to_string(),
        ));
    }
    if metadata.len() > MAX_CREDENTIAL_BYTES {
        return Err(ProviderError::InvalidData(
            "agy credential file exceeded the size limit".to_string(),
        ));
    }

    let raw = fs::read_to_string(path)
        .map_err(|_| ProviderError::Unavailable("agy OAuth credential file could not be read".to_string()))?;
    parse_credential_json(&raw, CredentialSource::OAuthFile)
}