# CLI Quota Provider Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app fetch quota with `agy` first, direct Cloud Code second, and the existing Antigravity language server last.

**Architecture:** Move desktop quota acquisition behind a `quota` module with one normalized `FullStatus` contract. `agy_cli` executes only structured print-mode quota commands; `cloud_code` reads `agy` credentials and calls Google Code Assist directly; `language_server` contains the existing loopback process/CSRF logic. `quota::fetch_full_status()` tries providers in that order and returns the first usable snapshot.

**Tech Stack:** Rust 2021, Tauri 2, Tokio, reqwest/rustls, serde/serde_json, regex, std::process.

**Spec:** `docs/superpowers/specs/2026-09-03-cli-quota-provider-chain-design.md`

## Global Constraints

- Provider priority is exactly `agy CLI -> Cloud Code -> language server`.
- Desktop frontend `FullStatus` / `QuotaData` JSON shape remains unchanged.
- CLI parsing accepts machine-readable JSON only; never scrape human table/ANSI output.
- Never log or expose access tokens, refresh tokens, OAuth client secrets, or raw credential blobs.
- Do not hard-code Google's OAuth client secret.
- Missing quota windows stay disabled/unavailable; never relabel another rolling window as weekly or 5-hour.
- Direct processes use `Command`, not shell interpolation.
- HTTP uses TLS validation and bounded timeouts.

---

### Task 1: Add branch-only Rust verification workflow

**Files:**
- Create temporarily: `.github/workflows/cli-quota-provider-ci.yml`

**Interfaces:**
- Consumes: feature branch `feat/cli-quota-provider-chain`.
- Produces: branch push verification running `cargo test --lib` and `cargo check --lib` on Ubuntu with Tauri Linux dependencies.

- [ ] **Step 1:** Add a push-only workflow scoped to `feat/cli-quota-provider-chain` that installs `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libjavascriptcoregtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, Rust stable, then runs `cargo test --lib` and `cargo check --lib` in `desktop-app/src-tauri`.
- [ ] **Step 2:** Push it and confirm the clean baseline reaches Cargo successfully.
- [ ] **Step 3:** Keep this workflow only while implementing; delete it after final verification.

### Task 2: Define provider errors, normalized usability, and fallback orchestration

**Files:**
- Create: `desktop-app/src-tauri/src/quota/mod.rs`
- Test: inline `#[cfg(test)]` module in `quota/mod.rs`

**Interfaces:**
- Consumes: `crate::FullStatus`.
- Produces: `ProviderError`, `is_usable_status(&FullStatus) -> bool`, and `async fn fetch_full_status() -> Result<FullStatus, String>`.

- [ ] **Step 1: Write failing orchestration tests**

Add tests proving an empty `FullStatus` is not usable and a status with quota or credits is usable. Add a small pure helper test for selecting the first usable provider result in order.

- [ ] **Step 2: Run branch CI and verify RED**

Expected: compile/test failure because the `quota` module/helpers do not exist yet.

- [ ] **Step 3: Implement minimal shared provider layer**

Use:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderErrorKind { Unavailable, Unsupported, Auth, Transient, InvalidData }

#[derive(Debug, Clone)]
pub struct ProviderError {
    pub provider: &'static str,
    pub kind: ProviderErrorKind,
    pub message: String,
}
```

`is_usable_status` returns true when `!status.quotas.is_empty()` or `status.credits.is_some()` or `status.plan_tier.is_some()`.

- [ ] **Step 4: Run CI and verify GREEN**
- [ ] **Step 5: Commit**

### Task 3: Implement primary `agy` CLI structured quota provider

**Files:**
- Create: `desktop-app/src-tauri/src/quota/agy_cli.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Test: inline tests in `agy_cli.rs`

**Interfaces:**
- Produces: `pub async fn fetch() -> Result<FullStatus, ProviderError>` and pure parser `parse_quota_envelope(&str) -> Result<FullStatus, ProviderError>`.
- The provider first tries `agy -p /usage --output-format json`; if that returns a structured-command incompatibility, try `agy -p /quota --output-format json`. Both commands are vendor read-only print-mode commands.

- [ ] **Step 1: Write failing parser tests**

Fixtures must model the vendor envelope shape `command.data.groups`, including group names `Gemini Models` and `Claude and GPT models`. Each fixture contains window records with percent/remaining fraction and reset timestamp. Assert normalization to exactly `Gemini` and `Claude & OpenAI`, with absent windows disabled.

Also test malformed JSON and a JSON envelope without `command.data.groups` returning `InvalidData`.

- [ ] **Step 2: Verify RED in CI**
- [ ] **Step 3: Implement parser**

Accept tolerant field aliases for window name (`name`, `label`, `duration`), utilization (`remainingFraction`, `remaining_fraction`, `percentRemaining`, `percent_remaining`, `remainingPercent`, `remaining_percent`), and reset (`resetTime`, `reset_time`). Convert fractions 0..1 to remaining percent 0..100; convert explicit percent fields directly. Identify 5-hour windows by normalized text containing `5` and `hour`; weekly by `week`. Do not infer missing windows.

- [ ] **Step 4: Implement binary discovery and bounded runner**

Discovery order: `AGY_BIN`, PATH, `%LOCALAPPDATA%/agy/bin/agy.exe`, `~/.local/bin/agy`, `/usr/local/bin/agy`. Spawn directly with stdin null, captured stdout/stderr, and a Tokio timeout. Classify missing binary as `Unavailable`, unknown `--output-format`/command as `Unsupported`, login/auth text as `Auth`, timeout/network as `Transient`.

- [ ] **Step 5: Verify GREEN in CI**
- [ ] **Step 6: Commit**

### Task 4: Implement `agy` credential loading and OAuth client discovery

**Files:**
- Create: `desktop-app/src-tauri/src/quota/credentials.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Test: inline tests in `credentials.rs`

**Interfaces:**
- Produces normalized `AgyCredential { access_token: Option<String>, refresh_token: String, expiry_ms: Option<i64> }`.
- Produces `find_agy_binary() -> Option<PathBuf>` shared with CLI provider.
- Produces `extract_oauth_clients(&[u8]) -> Vec<(String, String)>` without logging values.

- [ ] **Step 1: Write failing pure tests**

Test credential JSON normalization for nested `{ "token": ... }` and flat token JSON. Test binary scanning returns only valid client-id/client-secret pairs and de-duplicates them.

- [ ] **Step 2: Verify RED in CI**
- [ ] **Step 3: Implement non-secret helpers**

Use regexes from the spec for Google installed-app client IDs and `GOCSPX-` secrets. Keep extracted pairs only in memory.

- [ ] **Step 4: Implement OS credential readers**

Windows: invoke a fixed `powershell -NoProfile -NonInteractive -EncodedCommand ...` script that calls `CredReadW` for generic credential `gemini:antigravity`; the target name is constant and no user data is interpolated. Linux/macOS fallback: read `~/.gemini/oauth_creds.json`. Missing credentials => `Unavailable`; missing refresh token => `Auth`.

- [ ] **Step 5: Verify GREEN in CI**
- [ ] **Step 6: Commit**

### Task 5: Implement direct Cloud Code fallback

**Files:**
- Create: `desktop-app/src-tauri/src/quota/cloud_code.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Test: inline tests in `cloud_code.rs`

**Interfaces:**
- Consumes: `credentials::load_credential`, `credentials::extract_oauth_clients`, `credentials::find_agy_binary`.
- Produces: `pub async fn fetch() -> Result<FullStatus, ProviderError>` plus pure mapping helpers for `loadCodeAssist`, `retrieveUserQuota`, `fetchAvailableModels` JSON.

- [ ] **Step 1: Write failing mapping tests**

Cover: numeric/string AI credit summing; plan tier extraction; Gemini request-window normalization without inventing weekly/5-hour labels; Claude/GPT shared pool grouping when quota fraction/reset are identical; missing windows disabled.

- [ ] **Step 2: Verify RED in CI**
- [ ] **Step 3: Implement OAuth refresh**

POST form to `https://oauth2.googleapis.com/token` with candidate client pairs and stored refresh token. Cache only the winning client pair in process memory. Do not persist a client secret to repository/app config. If a rotated refresh token is returned, use it for the current fetch; do not write it back in the first implementation.

- [ ] **Step 4: Implement Cloud Code calls**

Use `https://cloudcode-pa.googleapis.com` and Bearer auth. Call `loadCodeAssist`, `retrieveUserQuota`, and `fetchAvailableModels`. Set Antigravity metadata headers for `fetchAvailableModels` including `Client-Metadata` with `ideType=ANTIGRAVITY` and current platform. Apply request timeouts.

- [ ] **Step 5: Implement truthful normalization**

Return cards `Gemini` and `Claude & OpenAI`; only populate 5-hour/weekly fields when the source clearly identifies those window semantics. Otherwise set the unavailable window's disabled flag and leave its percent/reset neutral.

- [ ] **Step 6: Verify GREEN in CI**
- [ ] **Step 7: Commit**

### Task 6: Extract the existing language-server path and wire provider order

**Files:**
- Create: `desktop-app/src-tauri/src/quota/language_server.rs`
- Modify: `desktop-app/src-tauri/src/lib.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Test: existing parser behavior plus orchestration tests in `quota/mod.rs`

**Interfaces:**
- `language_server::fetch() -> Result<FullStatus, ProviderError>` retains current scan/process/port/CSRF/query behavior.
- `quota::fetch_full_status()` calls `agy_cli::fetch()`, then `cloud_code::fetch()`, then `language_server::fetch()`.

- [ ] **Step 1: Write failing provider-order test around a pure result-selection helper**

Assert that a successful CLI result prevents later results from winning; CLI error + Cloud success selects Cloud; CLI + Cloud error selects language server; unusable status behaves like failure.

- [ ] **Step 2: Verify RED in CI**
- [ ] **Step 3: Move existing language-server acquisition code without semantic changes**

Keep `parse_full_status` behavior and the exact current local endpoints `GetUserStatus` and `RetrieveUserQuotaSummary`.

- [ ] **Step 4: Replace `fetch_full_status_internal()` acquisition with the orchestrator**

Keep monitored-model override and tray/UI state handling in `lib.rs`. Preserve last successful status caching.

- [ ] **Step 5: Verify GREEN in CI**
- [ ] **Step 6: Commit**

### Task 7: Final verification and cleanup

**Files:**
- Delete: `.github/workflows/cli-quota-provider-ci.yml`
- Review all feature files and docs.

- [ ] **Step 1:** Run branch CI one final time before deleting the temporary workflow; require `cargo test --lib` and `cargo check --lib` success.
- [ ] **Step 2:** Inspect the branch diff against `main` and confirm only intended provider/docs changes remain.
- [ ] **Step 3:** Delete the temporary branch-only workflow and commit cleanup.
- [ ] **Step 4:** Verify the final branch file tree remotely and report any limitation: tests cover parsing/orchestration with fixtures; live Cloud Code cannot be exercised without the user's credentials.
