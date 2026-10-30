---
schema_version: 1
id: "feature.vscode-extension"
title: "VS Code extension presentation and user controls"
kind: "feature"
status: "verified"
summary: "Status bar item, compact markdown hover panel, QuickPick action menu, and external tool integration in VS Code."
tags: ["ui", "vscode", "status-bar", "tooltip", "quickpick"]
source_paths: ["package.json", "src/extension.ts", "src/ui/helpers.ts", "src/ui/quickPick.ts", "src/ui/statusBar.ts", "src/ui/tooltip.ts"]
related_specs: ["architecture.data-models", "workflow.quota-polling-refresh", "feature.desktop-tray-app"]
last_doc_update_at: "2026-10-29T23:40:00Z"
last_verified_at: "2026-10-29T23:40:00Z"
last_verified_code_commit: "ff75352"
last_source_change_commit: "ff75352"
last_source_change_at: "2026-10-29T23:36:49+07:00"
source_fingerprint: "sha256:ddd8f2270b1fa50152d35dcf97c891951fbf4432dbf1f1160f737d4f6c3933ef"
---

# VS Code extension presentation and user controls

## Purpose and boundaries
Provides non-intrusive in-editor monitoring and control of Antigravity model quotas directly within the VS Code status bar.

Explicitly avoids cluttering editor views or interrupting coding workflows.

## Observable behavior
- **Status Bar Item**:
  - Displays currently selected model name and lowest remaining quota percent (e.g., `$(battery-charging) Gemini: 88%`).
  - Optionally displays credit balance when toggled via settings or command.
  - Clicking status bar opens QuickPick menu; hovering displays markdown tooltip table.
- **Hover Tooltip**:
  - Compact Markdown table rendering all canonical model pools (`Gemini`, `Gemini 4 Argon`, `Claude & OpenAI`).
  - Displays remaining percentages, visual progress bars (`████░░░░`), and reset timestamps.
  - Displays plan tier and remaining AI credits (or `—` when unavailable).
  - Includes action buttons for force refresh and QuotaShift external discovery.
- **QuickPick Menu**:
  - Lists available model pools with 2-row formatting: Model title in row 1, `5h {pct}% - {time} (fullwidth) 7d {pct}% - {time}` in row 2.
  - Action items: Force refresh, toggle credits in status bar, open QuotaShift, and open Desktop App with theme-aware SVG icons (`desktop-light.svg` / `desktop-dark.svg`).

## Workflow
1. User hovers over status bar item -> `tooltip.ts` renders markdown table on demand.
2. User clicks status bar item -> `quickPick.ts` displays interactive menu.
3. User selects a model -> extension updates `antigravity-quota.monitoredModel` setting and updates status bar display immediately.
4. User selects "Force Refresh" -> executes provider chain refresh.

## Code map
- `src/extension.ts` — Extension activation, command registration, and event wiring
- `src/ui/statusBar.ts` — Status bar item rendering and formatting
- `src/ui/tooltip.ts` — Hover panel markdown table generator
- `src/ui/quickPick.ts` — Interactive QuickPick menu controller
- `src/ui/helpers.ts` — Bar building and reset time formatting helpers
- `package.json` — VS Code commands, configuration schemas, and activation events

## Interfaces and data
- Commands: `antigravity-quota.refresh`, `antigravity-quota.selectModel`, `antigravity-quota.toggleCredits`
- Configuration: `antigravity-quota.showCreditsInStatusBar`, `antigravity-quota.monitoredModel`, `antigravity-quota.pollInterval`

## Verification
- `test/presentation-contract.test.cjs` validates status bar formats, tooltip table rendering, QuickPick 2nd-row formats, fullwidth dash for credits, and theme SVG icon paths.

## Related documentation
- [Canonical model pools and account plan tiers](../architecture/data-models.md)
- [Quota polling and refresh workflow](../workflows/quota-polling-refresh.md)
- [Desktop tray application](desktop-tray-app.md)

## Known limitations and open questions
- VS Code markdown tooltips are sandboxed and do not support dynamic animations or embedded HTML scripts.
