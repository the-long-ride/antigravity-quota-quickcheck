---
schema_version: 1
id: "architecture.data-models"
title: "Canonical model pools and account plan tiers"
kind: "architecture"
status: "verified"
summary: "Canonical three-pool model representation, dynamic Argon deduplication, and account subscription tier normalization."
tags: ["telemetry", "model-pools", "argon", "plan-tier", "credits"]
source_paths: ["desktop-app/src-tauri/src/lib.rs", "src/constants.ts", "src/telemetry/parser.ts", "src/telemetry/types.ts"]
related_specs: ["architecture.provider-chain", "feature.vscode-extension", "feature.desktop-tray-app"]
last_doc_update_at: "2026-10-29T23:40:00Z"
last_verified_at: "2026-10-29T23:40:00Z"
last_verified_code_commit: "ff75352"
last_source_change_commit: "ff75352"
last_source_change_at: "2026-10-29T23:36:49+07:00"
source_fingerprint: "sha256:31102c0b5f6fc45d18dc9443d4aee626c26f099898d954ddbd7ee4e5a59c098b"
---

# Canonical model pools and account plan tiers

## Purpose and boundaries
Normalizes raw telemetry across diverse backend formats into canonical quota model pools, account plan tiers, and AI credit balances.

Explicitly handles differences between Antigravity 1.x models and Antigravity 2.0 multi-provider pools.

## Observable behavior
- **Three Canonical Pools**:
  1. `Gemini` (Tracks 5h and weekly limits for Gemini models)
  2. `Gemini 4 Argon` (Weekly single-lane pool; prioritized above Claude & OpenAI)
  3. `Claude & OpenAI` (Tracks 5h and weekly limits for external shared models)
- **Dynamic Argon Merging**: When `Gemini 4 Argon` shares identical remaining percentage and reset timestamps with `Gemini` (e.g. on certain Ultra accounts), it is merged into the `Gemini` card to avoid redundant duplicate cards.
- **Plan Tier Resolution**: Normalizes raw tier values (`g1-pro-tier`, `Google AI Pro`, `Ultra`, `Antigravity`, etc.) into user-friendly display titles (`Google AI Pro`, `Google AI Ultra`, `Antigravity`).
- **Single-Lane Representation**: Pools with only weekly windows (such as distinct Argon pools) cleanly display single-lane limits without synthetic or empty 5-hour slots.

## Workflow
1. Raw model quota list is received from provider.
2. Models are grouped into buckets (`gemini`, `claude_openai`, `argon`).
3. Remaining percentages and earliest reset dates are computed per window lane.
4. Argon signature check: If Argon's fraction matches Gemini's fraction and reset time, Argon is merged into Gemini.
5. If Argon is distinct, it is emitted as its own quota pool and placed directly above `Claude & OpenAI`.
6. Account plan tier is parsed and normalized.

## Code map
- `src/telemetry/parser.ts` — TypeScript quota grouping, model resolution, Argon deduplication, and tier normalization
- `src/telemetry/types.ts` — TypeScript interfaces for `ProviderQuota`, `QuotaSummary`, and `PlanTier`
- `src/constants.ts` — Canonical model pool names and tier identifiers
- `desktop-app/src-tauri/src/lib.rs` — Rust quota representations (`QuotaData`, `FullStatus`, `CreditInfo`) and tooltip formatting

## Interfaces and data
```ts
interface ProviderQuota {
  model: string;
  percent: number;
  refreshTime: string;
  fiveHourPercent?: number;
  fiveHourReset?: string;
  fiveHourDisabled?: boolean;
  weeklyPercent?: number;
  weeklyReset?: string;
  weeklyDisabled?: boolean;
}
```

## Verification
- `test/parser.test.cjs` verifies 3-pool grouping, Argon deduplication, and single-lane handling.
- `test/tier-sources.test.cjs` verifies plan tier resolution across all backend shapes.
- `desktop-app/src-tauri/tests/quota_sources.rs` validates matching behavior in Rust backend.

## Related documentation
- [Three-layer quota provider fallback chain](provider-chain.md)
- [VS Code extension presentation](../features/vscode-extension.md)
- [Desktop tray application](../features/desktop-tray-app.md)

## Known limitations and open questions
- New experimental models from Google require updating model resolution maps if naming diverges.
