# CLI Quota Provider Chain Design

## Goal

Make the desktop app work when the user only runs the Antigravity `agy` CLI, while preserving the existing language-server integration as the final compatibility fallback.

Provider priority:

1. `agy` CLI structured `/usage` output (primary)
2. Direct Google Cloud Code quota APIs using the credentials already owned by `agy` (secondary fallback)
3. Existing Antigravity language-server local API (final fallback)

The desktop frontend must continue receiving the existing `FullStatus` / `QuotaData` shape so this change does not require a dashboard redesign.

## Why this architecture

The current desktop app requires a running `language_server`, extracts its CSRF token, discovers a loopback port, and calls `GetUserStatus` / `RetrieveUserQuotaSummary`. That fails for users who only run `agy` headlessly.

The primary provider should delegate authentication and quota semantics to the official CLI whenever possible. The direct-cloud provider exists for CLI versions where `/usage` is unavailable, not machine-readable, or fails operationally. The language-server path remains for existing IDE users.

## Provider interface

Add a small desktop-only provider layer under `desktop-app/src-tauri/src/quota/`.

```rust
pub trait QuotaProvider {
    fn name(&self) -> &'static str;
    async fn fetch(&self) -> Result<FullStatus, ProviderError>;
}
```

Because stable Rust traits do not provide native async methods without boxing or an async-trait dependency, the concrete implementation may instead expose async functions with a common `ProviderResult` type and an orchestrator that calls them in sequence. Avoid adding a dependency solely for trait syntax.

The orchestrator returns the first successful, usable snapshot:

```text
AgyCliProvider
    success -> return
    unavailable/unsupported/transient failure -> next

CloudCodeProvider
    success -> return
    unavailable/auth failure/transient failure -> next

LanguageServerProvider
    success -> return
    failure -> surface best diagnostic
```

A provider result is only successful when it contains at least one quota group or a valid credits/tier snapshot. Empty placeholders must not stop fallback.

## Phase 1: `agy` CLI provider

### Binary discovery

Resolve `agy` in this order:

1. `AGY_BIN` environment variable
2. `PATH`
3. Windows: `%LOCALAPPDATA%/agy/bin/agy.exe`
4. Unix: `~/.local/bin/agy`
5. Unix: `/usr/local/bin/agy`

Use `std::process::Command` directly; never invoke through a shell with interpolated arguments.

### Command contract

Attempt structured, non-interactive usage output only. The provider may probe supported invocation forms for the installed CLI version, but must never scrape ANSI/human table output into quota values.

Preferred invocation:

```text
agy -p /usage --output-format json
```

If the installed CLI does not support structured output for `/usage`, return `ProviderError::Unsupported` and continue to Cloud Code.

Command requirements:

- bounded timeout
- stdout/stderr captured separately
- no prompt generation other than the CLI-handled `/usage` command
- non-zero exit classified into auth / unsupported / transient failure when possible
- no access tokens or refresh tokens written to logs

### Parsing

Normalize machine-readable CLI fields into the existing `FullStatus` model.

Required output cards remain:

- `Gemini`
- `Claude & OpenAI`

Prefer explicit 5-hour / weekly grouped quota fields if the CLI exposes them. Preserve reset timestamps exactly. Do not infer a weekly quota from a different rolling pool.

If structured CLI output lacks enough information to populate the current two-card contract, treat the provider as unsupported and continue to Cloud Code rather than returning misleading data.

## Phase 2: direct Cloud Code provider

This provider follows the same headless cloud path demonstrated by Cockpit-style authorized quota clients and `agy-quota`: read `agy` credentials, refresh OAuth, then call Google Code Assist quota endpoints directly. It must not require an IDE or local language server.

### Credential sources

Windows:

- read generic Windows Credential Manager entry `gemini:antigravity`
- blob is UTF-8 JSON
- normalize `token.access_token`, `token.refresh_token`, and expiry

Linux/macOS fallback:

- read `~/.gemini/oauth_creds.json`
- require `refresh_token`

Do not copy credentials into application configuration or frontend state. Keep tokens in Rust memory only.

### OAuth client discovery

Do not hard-code Google's OAuth client secret in the repository.

Discover candidate client IDs / secrets at runtime from the installed `agy` binary:

- client id regex: `[0-9]{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com`
- client secret regex: `GOCSPX-[A-Za-z0-9_-]{28}`

Try candidate pairs against `https://oauth2.googleapis.com/token` using the stored refresh token and `grant_type=refresh_token`. Cache only the working client pair in the OS temporary directory; never log the secret.

If Google returns a rotated refresh token, use it for the current process. Persisting it back to the `agy` credential store is optional and must be best-effort; failure to write back must not invalidate the current successful quota fetch.

### Cloud Code endpoints

Base host:

```text
https://cloudcode-pa.googleapis.com
```

Calls:

1. `POST /v1internal:loadCodeAssist`
   - account tier / plan context
   - available AI credits when exposed

2. `POST /v1internal:retrieveUserQuota`
   - authoritative Gemini REQUESTS buckets when available

3. `POST /v1internal:fetchAvailableModels`
   - callable model list
   - `quotaInfo.remainingFraction` / reset data
   - shared Claude/OpenAI pool fallback

All calls use `Authorization: Bearer <access token>` and JSON bodies. `fetchAvailableModels` should include Antigravity-identifying metadata/headers compatible with the installed platform so non-Google providers remain visible.

### Mapping direct-cloud data to current cards

The direct-cloud APIs do not necessarily expose the same weekly/5-hour grouped summary as `RetrieveUserQuotaSummary`. Therefore this provider must distinguish authoritative values from approximations.

`Gemini`:

- prefer explicit grouped windows if available in API responses
- otherwise use authoritative `retrieveUserQuota` REQUESTS data only for the window semantics it actually represents
- do not label a daily REQUESTS bucket as weekly

`Claude & OpenAI`:

- use the shared pool from `fetchAvailableModels` when that is the only available meter
- Claude and GPT/OpenAI entries should be treated as one shared pool when their quota fractions/reset times match
- do not present this as precise per-model quota

If the direct-cloud path cannot populate both the 5-hour and weekly fields truthfully, preserve unknown fields as disabled/unavailable rather than inventing percentages. The UI can display the available window and mark the missing one unavailable.

### Credits and tier

Use `loadCodeAssist` to populate:

- plan/tier label
- available AI credits when present

Credits parsing must accept numeric and numeric-string amounts and sum available credit entries when required.

## Phase 3: language-server fallback

Move the existing process scan, port discovery, CSRF extraction, `GetUserStatus`, and `RetrieveUserQuotaSummary` logic behind `LanguageServerProvider` with behavior unchanged.

This remains the final fallback because it can expose the exact two-group 5-hour/weekly summary for IDE users.

## Error and fallback semantics

Provider failures should be classified:

- `Unavailable`: binary/process/credential source not present
- `Unsupported`: installed CLI does not offer the required structured contract
- `Auth`: login expired/missing or token refresh rejected
- `Transient`: timeout/network/server failure
- `InvalidData`: response exists but cannot be safely normalized

The orchestrator should preserve diagnostics from all attempted providers and surface a concise final message only if every provider fails.

Examples:

- CLI missing + Cloud Code credential missing + language server missing -> `Antigravity not available. Install/login to agy or start the Antigravity IDE.`
- CLI unsupported + Cloud Code auth expired -> `agy login required.`
- Cloud Code network failure but language server succeeds -> no user-facing error; return language-server data.

## Caching and polling

- retain existing desktop polling interval
- allow only one quota refresh at a time
- cache the discovered `agy` path
- cache the working OAuth client pair in temp storage
- cache the last successful `FullStatus`
- transient provider failures must not erase the last good tray/dashboard state until the full provider chain fails

Do not invoke `agy` more frequently than the configured quota refresh interval.

## Security constraints

- never log access tokens, refresh tokens, OAuth client secrets, or raw credential blobs
- never expose credentials over Tauri events
- use direct process execution, not shell interpolation
- bound subprocess output size and execution time
- bound HTTP response size/time
- use TLS certificate validation for Google endpoints
- Windows credential access is read-only by default; token write-back, if implemented, is isolated and best-effort
- do not persist refresh tokens in the app's own files

## File structure

Proposed desktop backend structure:

```text
desktop-app/src-tauri/src/
  lib.rs                         Tauri wiring, polling, UI/tray state
  quota/
    mod.rs                       provider orchestrator + shared errors
    types.rs                     FullStatus / QuotaData / credit types (moved or re-exported)
    agy_cli.rs                   binary discovery, command execution, structured parser
    cloud_code.rs                OAuth refresh + Code Assist HTTP calls + mapping
    credentials.rs               agy credential loading and OAuth-client discovery
    language_server.rs           existing local process/port/CSRF provider
```

The implementation may keep shared data structs in `lib.rs` initially if moving them causes unnecessary churn, but provider-specific logic must leave `lib.rs`.

## Tests

Unit tests must cover provider behavior without using live credentials.

### `agy_cli`

Fixture tests:

- valid structured output -> two normalized cards
- malformed JSON -> `InvalidData`
- unsupported CLI flag/output -> `Unsupported`
- timeout/non-zero exit classification
- no human-output scraping

### `cloud_code`

Fixture tests:

- credential normalization from Windows/file shapes
- OAuth client-id/secret extraction from binary bytes
- token refresh response including refresh-token rotation
- `loadCodeAssist` credits/tier parsing
- Gemini quota mapping
- shared Claude/OpenAI pool mapping
- missing weekly/5h window stays unavailable rather than fabricated

HTTP behavior should be tested by separating response parsing from network transport so unit tests do not call Google.

### orchestrator

- CLI succeeds -> Cloud Code and language server not used
- CLI unsupported -> Cloud Code used
- CLI fails + Cloud Code fails -> language server used
- all fail -> useful combined diagnostic
- empty/invalid provider result does not stop fallback

### regression

Existing grouped-card behavior remains exactly two provider cards when the source supplies both groups.

## Acceptance criteria

1. Desktop app displays quota with only a logged-in `agy` CLI installed and no language server running.
2. Primary path is structured `agy /usage` output.
3. Direct Cloud Code is automatically attempted when the CLI path cannot provide a usable snapshot.
4. Existing language-server behavior remains as final fallback.
5. The desktop UI contract remains compatible with the current dashboard/tray.
6. No secrets are logged or sent to the frontend.
7. Windows and Linux builds pass in GitHub Actions.
8. Provider/parser tests pass without live Google credentials.

## References used for design

- Cockpit authorized quota implementation: OAuth Bearer requests to Cloud Code `loadCodeAssist` / `fetchAvailableModels`, independent of the local language server.
- `agy-quota`: `agy` credential source (`gemini:antigravity` on Windows; `~/.gemini/oauth_creds.json` fallback), runtime OAuth client discovery from the `agy` binary, OAuth refresh, and direct `retrieveUserQuota` / `loadCodeAssist` / `fetchAvailableModels` requests.
- Existing desktop backend: current language-server process/CSRF/port discovery remains the final fallback.
