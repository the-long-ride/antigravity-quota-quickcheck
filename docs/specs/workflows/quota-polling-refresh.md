---
schema_version: 1
id: "workflow.quota-polling-refresh"
title: "Quota polling, silent execution, and refresh lifecycle"
kind: "workflow"
status: "verified"
summary: "Lifecycle for background periodic polling, hidden process execution on Windows, and on-demand force refreshes."
tags: ["workflow", "polling", "refresh", "process", "lifecycle"]
source_paths: ["desktop-app/src-tauri/src/lib.rs", "desktop-app/src-tauri/src/quota/process.rs", "src/extension.ts", "src/telemetry/index.ts", "src/telemetry/process.ts"]
related_specs: ["architecture.provider-chain", "feature.desktop-tray-app", "feature.vscode-extension"]
last_doc_update_at: "2026-10-29T23:40:00Z"
last_verified_at: "2026-10-29T23:40:00Z"
last_verified_code_commit: "ff75352"
last_source_change_commit: "ff75352"
last_source_change_at: "2026-10-29T23:36:49+07:00"
source_fingerprint: "sha256:a47d054608f5646c6dbffb33958dd9ff1243f5e898bced1c2d67f236a88eac06"
---

# Quota polling, silent execution, and refresh lifecycle

## Purpose and boundaries
Governs continuous background quota updates and explicit manual refreshes across both the extension and desktop application while ensuring background operations remain completely silent on Windows.

Explicitly prevents console/terminal window flashing during subprocess execution.

## Observable behavior
- **Periodic Interval**: Polling interval defaults to 30 seconds (configurable down to 5 seconds).
- **Silent Windows Execution**: Spawns PowerShell or `agy` CLI using `CREATE_NO_WINDOW` (0x08000000) on Windows so no console windows flash or steal focus.
- **Immediate Feedback**: On force refresh, UI spinning indicators animate immediately and update within milliseconds of provider response.
- **Offline Resiliency**: In the event of temporary network or authentication failures, the last known quota status is retained while displaying offline connectivity guidance.

## Workflow
1. Initial launch initializes timer (`setInterval` in JS, `tokio::spawn` loop in Rust).
2. Interval fires:
   - Check if an update is already in-flight (single-flight deduplication).
   - Execute provider chain fallback.
3. If new data is received:
   - Cache status in memory.
   - Update UI components (VS Code status bar / desktop tray icon + webview).
4. If user clicks "Refresh":
   - Cancel current delay and immediately trigger provider chain fetch.
   - Emit updated payload.

## Code map
- `src/telemetry/index.ts` — TypeScript telemetry service managing polling timer and cached state
- `src/telemetry/process.ts` — Hidden process execution wrapper in Node.js
- `src/extension.ts` — VS Code polling lifecycle and refresh command wiring
- `desktop-app/src-tauri/src/lib.rs` — Desktop polling task (`poll_and_update_tray`) and `force_refresh` command
- `desktop-app/src-tauri/src/quota/process.rs` — Windows `CREATE_NO_WINDOW` process spawner in Rust

## Interfaces and data
- `CREATE_NO_WINDOW`: Win32 process creation flag `0x08000000`
- `pollInterval`: Integer seconds (minimum 5, default 30)

## Verification
- Unit test `test/silent-refresh.test.cjs` confirms PowerShell is launched with hidden parameters and no window.
- `desktop-app/src-tauri/tests/quota_sources.rs` validates `CREATE_NO_WINDOW` flag correctness in Rust.

## Related documentation
- [Three-layer quota provider fallback chain](../architecture/provider-chain.md)
- [Desktop system tray dashboard application](../features/desktop-tray-app.md)
- [VS Code extension presentation and user controls](../features/vscode-extension.md)

## Known limitations and open questions
- Windows anti-virus software occasionally slows process spawning; single-flight deduplication mitigates concurrent process buildup.
