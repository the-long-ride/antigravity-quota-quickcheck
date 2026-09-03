# CLI Quota Provider Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app fetch Antigravity quota without requiring a language server, using `agy` structured quota output first, direct Cloud Code second, and the existing language-server path last.

**Architecture:** Add a focused Rust provider layer under `desktop-app/src-tauri/src/quota/`. Keep `FullStatus`, `QuotaData`, and `CreditInfo` compatible with the current Tauri frontend. The orchestrator tries providers in strict order and returns the first usable snapshot; existing language-server parsing moves behind a provider module without changing its semantics.

**Tech Stack:** Rust 2021, Tauri 2, Tokio, Reqwest 0.12, Serde/serde_json, Regex, GitHub Actions on Windows and Ubuntu.

**Spec:** `docs/superpowers/specs/2026-09-03-cli-quota-provider-chain-design.md`

## Global Constraints

- Provider order is exactly: `agy` CLI -> direct Cloud Code -> language server.
- Phase 1 consumes structured JSON only; never scrape human/ANSI quota output.
- Primary CLI invocation is `agy -p /usage --output-format json`, with `/quota` as a structured compatibility probe when needed.
- Desktop UI continues consuming the existing `FullStatus` / `QuotaData` contract.
- Required cards remain `Gemini` and `Claude & OpenAI`.
- Unknown 5-hour/weekly windows remain disabled/unavailable; never invent percentages.
- Never log or emit access tokens, refresh tokens, OAuth client secrets, or raw credential blobs.
- Do not hard-code Google's OAuth client secret; discover candidates from the installed `agy` binary.
- Windows credential source is generic Credential Manager entry `gemini:antigravity`; non-Windows fallback is `~/.gemini/oauth_creds.json`.
- Final verification requires Rust tests plus Windows and Linux desktop builds in GitHub Actions.

---

### Task 1: Provider Errors, Usability, and Orchestrator

**Files:**
- Create: `desktop-app/src-tauri/src/quota/mod.rs`
- Modify: `desktop-app/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `ProviderError`, `ProviderKind`, `is_usable_status(&FullStatus) -> bool`, and the provider-chain orchestrator.
- Consumes: existing `FullStatus`, `QuotaData`, `CreditInfo` from crate root.

- [ ] **Step 1: Write failing orchestrator tests**

Tests must prove:
- CLI success stops the chain after one provider.
- CLI `Unsupported` falls through to Cloud Code.
- CLI + Cloud Code failure falls through to language server.
- An empty `FullStatus` does not stop fallback.
- All-provider failure produces a concise combined diagnostic without raw payloads.

- [ ] **Step 2: Run `cargo test quota::tests -- --nocapture` and verify RED**

Expected failure: provider interfaces do not exist yet.

- [ ] **Step 3: Implement the minimal error/usability/orchestration primitives**

Use:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    Unavailable(String),
    Unsupported(String),
    Auth(String),
    Transient(String),
    InvalidData(String),
}
```

A snapshot is usable only when it has quotas, credits, or a plan tier.

- [ ] **Step 4: Re-run Task 1 tests and verify GREEN**

- [ ] **Step 5: Commit `feat(desktop): add quota provider orchestration`**

---

### Task 2: `agy` Structured CLI Provider

**Files:**
- Create: `desktop-app/src-tauri/src/quota/agy_cli.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Modify: `desktop-app/src-tauri/Cargo.toml` only if Tokio process features are required.

**Interfaces:**
- `pub async fn fetch() -> Result<FullStatus, ProviderError>`
- `parse_quota_envelope(&str) -> Result<FullStatus, ProviderError>`
- `find_agy_binary() -> Result<PathBuf, ProviderError>` for credential discovery reuse.

- [ ] **Step 1: Write failing fixture tests**

Use structured JSON with `command.data.groups[]`. Each group has `name` and `buckets[]`; buckets have `window`, `remaining_fraction`, and `reset_time`.

Tests must assert:
- `Gemini Models` with 5h=0.72 and weekly=0.44 becomes `Gemini` 72% / 44%.
- `Claude and GPT models` with 5h=0.61 and weekly=0.33 becomes `Claude & OpenAI` 61% / 33%.
- reset timestamps are preserved.
- malformed JSON -> `InvalidData`.
- missing `command.data.groups` -> `InvalidData`.
- human table text -> `InvalidData`, proving no scraping.
- missing weekly bucket leaves weekly disabled rather than copying 5h.

- [ ] **Step 2: Run `cargo test quota::agy_cli::tests -- --nocapture` and verify RED**

- [ ] **Step 3: Implement the pure parser**

Group matching is case-insensitive:
- name containing `gemini` -> `Gemini`
- name containing `claude`, `gpt`, or `openai` -> `Claude & OpenAI`

Clamp fractions to 0..1 and convert to integer percentages. Missing windows use percentage 0, empty reset, and `disabled = true`.

- [ ] **Step 4: Implement binary discovery and bounded structured execution**

Discovery order:
1. `AGY_BIN`
2. `PATH`
3. `%LOCALAPPDATA%/agy/bin/agy.exe`
4. `$HOME/.local/bin/agy`
5. `/usr/local/bin/agy`

Try:

```text
agy -p /usage --output-format json
agy -p /quota --output-format json
```

Use direct process execution, a 12-second timeout, separate stdout/stderr, and reject captured output above 1 MiB. Classify missing executable, unsupported flag/command, auth/login errors, timeout, and invalid JSON into the provider error enum.

- [ ] **Step 5: Re-run Task 2 tests and verify GREEN**

- [ ] **Step 6: Commit `feat(desktop): read quota from agy CLI`**

---

### Task 3: `agy` Credential Resolution and OAuth Client Discovery

**Files:**
- Create: `desktop-app/src-tauri/src/quota/credentials.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`

**Interfaces:**
- `AgyCredential { access_token: Option<String>, refresh_token: String, source: CredentialSource }`
- `load_credential() -> Result<AgyCredential, ProviderError>`
- `discover_oauth_clients(&Path) -> Result<Vec<OAuthClient>, ProviderError>`

- [ ] **Step 1: Write failing pure tests**

Tests must cover:
- nested Windows credential JSON (`token.access_token` / `token.refresh_token`).
- flat `oauth_creds.json` JSON.
- missing refresh token rejected.
- binary-byte extraction finds one client ID and one client secret when test bytes are assembled from fragments at runtime rather than containing secret-shaped literals in source.
- duplicate discovered pairs are removed.

- [ ] **Step 2: Run `cargo test quota::credentials::tests -- --nocapture` and verify RED**

- [ ] **Step 3: Implement JSON normalization and runtime regex extraction**

Use the approved spec regexes. Never include matches in errors/logging.

- [ ] **Step 4: Implement platform readers**

Windows uses a fixed PowerShell P/Invoke script calling `CredReadW` for `gemini:antigravity`. Non-Windows reads `$HOME/.gemini/oauth_creds.json`. Tokens remain in Rust memory.

- [ ] **Step 5: Re-run tests and verify GREEN**

- [ ] **Step 6: Commit `feat(desktop): resolve agy OAuth credentials`**

---

### Task 4: Direct Cloud Code Provider

**Files:**
- Create: `desktop-app/src-tauri/src/quota/cloud_code.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Modify: `desktop-app/src-tauri/Cargo.toml`

**Interfaces:**
- `pub async fn fetch() -> Result<FullStatus, ProviderError>`
- pure response parsers for `loadCodeAssist`, `retrieveUserQuota`, and `fetchAvailableModels`.

- [ ] **Step 1: Write failing parser tests**

Tests must cover:
- numeric and numeric-string available credits are summed.
- plan prefers paid tier then current tier.
- Gemini REQUESTS data maps only an actually known meter/window.
- Claude/OpenAI pool uses the minimum matching fraction and earliest reset.
- missing weekly/5h remains disabled and is never copied.
- malformed responses never panic.

- [ ] **Step 2: Run `cargo test quota::cloud_code::tests -- --nocapture` and verify RED**

- [ ] **Step 3: Implement OAuth refresh**

Enable Reqwest form support and try discovered OAuth client pairs against `https://oauth2.googleapis.com/token`. Return the first access token. A rotated refresh token is used in memory only for this implementation.

- [ ] **Step 4: Implement bounded Cloud Code calls**

Use one Reqwest client with 12-second timeout and TLS validation. Call:
- `/v1internal:loadCodeAssist`
- `/v1internal:retrieveUserQuota`
- `/v1internal:fetchAvailableModels`

Attach bearer auth plus Antigravity-identifying metadata/headers. `loadCodeAssist` sends `mode: FULL_ELIGIBILITY_CHECK`; pass its project to `fetchAvailableModels` when available. Reject bodies above 2 MiB.

- [ ] **Step 5: Implement truth-preserving normalization**

Build at most two cards. Never label a daily/request bucket as weekly. When direct-cloud only exposes a pooled meter, place it in the available short-window slot and keep the unknown weekly slot disabled.

- [ ] **Step 6: Re-run tests and verify GREEN**

- [ ] **Step 7: Commit `feat(desktop): add Cloud Code quota fallback`**

---

### Task 5: Extract Existing Language Server Provider and Wire Strict Order

**Files:**
- Create: `desktop-app/src-tauri/src/quota/language_server.rs`
- Modify: `desktop-app/src-tauri/src/lib.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`

**Interfaces:**
- language-server provider reuses the existing PID/token/port cache and returns `Result<FullStatus, ProviderError>`.
- `fetch_full_status_internal()` delegates to the provider chain.

- [ ] **Step 1: Write failing regression tests for extracted language-server parsing**

Tests must preserve:
- Gemini grouped card.
- Claude/GPT/OpenAI grouped card.
- weekly 0 forces 5h 0 as current behavior.
- credits and plan tier parsing.

- [ ] **Step 2: Run `cargo test quota::language_server::tests -- --nocapture` and verify RED**

- [ ] **Step 3: Move process scan, port scan, CSRF extraction, local HTTP query, and `parse_full_status` into the provider module without changing semantics**

- [ ] **Step 4: Wire provider order `agy_cli -> cloud_code -> language_server` and selected-model synchronization**

All-provider failure must emit only concise sanitized diagnostics.

- [ ] **Step 5: Run `cargo test quota -- --nocapture` and verify GREEN**

- [ ] **Step 6: Commit `feat(desktop): use CLI cloud and language-server fallbacks`**

---

### Task 6: Full GitHub Actions Verification

**Files:**
- Temporarily modify then restore `.github/workflows/manual-build.yml`, or add/delete a branch-only verification workflow.

- [ ] **Step 1: Run `cargo test` plus release builds on `windows-latest` and `ubuntu-22.04` for the implementation branch**

- [ ] **Step 2: Fetch failing job logs and fix actual failures; do not infer success from partial jobs**

- [ ] **Step 3: Compare implementation branch against base and verify changed-file scope**

Expected persistent changes: approved spec/plan docs, desktop quota Rust modules, necessary Cargo metadata/lock updates, and `lib.rs` integration. Any temporary CI trigger must be removed.

- [ ] **Step 4: Verify final manual workflow remains `workflow_dispatch`-only**

- [ ] **Step 5: Commit cleanup if needed with `chore: finalize CLI quota provider verification`**
