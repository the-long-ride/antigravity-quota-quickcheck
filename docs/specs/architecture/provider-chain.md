---
schema_version: 1
id: "architecture.provider-chain"
title: "Three-layer quota provider fallback chain"
kind: "architecture"
status: "verified"
summary: "Hierarchical fallback chain across agy CLI, direct Cloud Code REST, and local Antigravity Language Server with single-flight deduplication."
tags: ["telemetry", "quota", "provider", "cloud-code", "agy-cli", "language-server"]
source_paths: ["desktop-app/src-tauri/src/quota/agy_cli.rs", "desktop-app/src-tauri/src/quota/cloud_code.rs", "desktop-app/src-tauri/src/quota/credentials.rs", "desktop-app/src-tauri/src/quota/language_server.rs", "desktop-app/src-tauri/src/quota/mod.rs", "src/telemetry/providers/agyCli.ts", "src/telemetry/providers/cloudCode.ts", "src/telemetry/providers/credentials.ts", "src/telemetry/providers/http.ts", "src/telemetry/providers/index.ts", "src/telemetry/providers/languageServer.ts"]
related_specs: ["architecture.data-models", "workflow.quota-polling-refresh"]
last_doc_update_at: "2026-10-29T23:40:00Z"
last_verified_at: "2026-10-29T23:40:00Z"
last_verified_code_commit: "ff75352"
last_source_change_commit: "ff75352"
last_source_change_at: "2026-10-29T23:36:49+07:00"
source_fingerprint: "sha256:0c3afbac8d0135f52ed794f8415ded51b7f933372cd8256f4f80c18ff68bf106"
---

# Three-layer quota provider fallback chain

## Purpose and boundaries
Provides robust, multi-source telemetry acquisition for Antigravity AI model quotas, plan subscription tiers, and credits across both the VS Code extension and the standalone Tauri desktop application.

Explicitly out of scope: modifying remote server quota allocations or managing user authentication directly.

## Observable behavior
The provider chain attempts to fetch quota and account status in strict priority order:
1. **Layer 1 (`agy CLI`)**: Invokes `agy status --json` or `agy usage --json` via hidden background process. If successful, enriches subscription info and returns structured telemetry.
2. **Layer 2 (`Cloud Code REST`)**: If CLI is absent or fails, reads existing OAuth credentials from `~/.config/antigravity/` (or OS keyring) and queries Cloud Code endpoints (`loadCodeAssist`, `retrieveUserQuota`, `availableModels`).
3. **Layer 3 (`Language Server`)**: If Cloud Code fails or credentials cannot be decoded, queries the running local Antigravity Language Server on its discovered port with CSRF handshake token.

If all three layers fail, the system emits a source-neutral error guidance state ("offline: Check agy login or start Antigravity IDE").

## Workflow
1. Request arrives (via periodic background timer or manual refresh).
2. Deduplication check: In-flight requests share a single execution promise (`singleFlight`).
3. Iterate providers:
   - Run `AgyCliProvider`: On success, return status immediately.
   - On `ProviderUnavailable` or `ProviderFailed`, fall through to `CloudCodeProvider`.
   - On Cloud Code failure, fall through to `LanguageServerProvider`.
4. If a valid status with quotas is resolved, cache status and emit update to UI and tray.
5. If all fail, emit offline status.

## Code map
- `src/telemetry/providers/index.ts` — TypeScript fallback chain orchestrator and single-flight gate
- `src/telemetry/providers/agyCli.ts` — Layer 1 TypeScript implementation executing `agy usage`
- `src/telemetry/providers/cloudCode.ts` — Layer 2 TypeScript implementation for Cloud Code REST APIs
- `src/telemetry/providers/languageServer.ts` — Layer 3 TypeScript implementation querying local language server
- `src/telemetry/providers/credentials.ts` — OAuth token extraction and go-keyring base64 secret decoding
- `desktop-app/src-tauri/src/quota/mod.rs` — Rust provider chain coordinator and fallback loop
- `desktop-app/src-tauri/src/quota/agy_cli.rs` — Rust Layer 1 CLI parser
- `desktop-app/src-tauri/src/quota/cloud_code.rs` — Rust Layer 2 Cloud Code client
- `desktop-app/src-tauri/src/quota/language_server.rs` — Rust Layer 3 language server client
- `desktop-app/src-tauri/src/quota/credentials.rs` — Rust credential file and keyring reader

## Interfaces and data
- `ProviderResult`: `{ quotas: QuotaData[], planTier: string | null, credits: CreditInfo | null }`
- `ProviderError`: Standardized error categories (`Unavailable`, `Failed`, `InvalidData`)

## Verification
- Unit & integration tests in `test/provider-chain.test.cjs` verify priority ordering, fallback on failure, and single-flight execution.
- Rust unit tests in `desktop-app/src-tauri/tests/quota_provider.rs` confirm fallback rules and usable status criteria.

## Related documentation
- [Data models and model pools](data-models.md)
- [Quota polling and refresh workflow](../workflows/quota-polling-refresh.md)

## Known limitations and open questions
- Language server discovery requires an actively running Antigravity IDE process.
- Cloud Code tokens expire and rely on `agy` or Antigravity IDE background refresh to obtain new OAuth tokens.
