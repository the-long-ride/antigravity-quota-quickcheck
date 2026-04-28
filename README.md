# 💳 Google AI Quota Quickcheck

[![Open VSX](https://img.shields.io/open-vsx/v/the-long-ride/antigravity-quota-quickcheck?color=blue&logo=open-vsx)](https://open-vsx.org/extension/the-long-ride/antigravity-quota-quickcheck)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **One click. Zero distraction. Full control.**

Monitor your Google AI model quotas, credit balance and most recent used model directly from your VS Code status bar. No more switching tabs to check if you're hitting limits.

---

### ⚡ At a Glance
- **Real-time Tracking**: Live updates for Gemini and other Google AI models.
- **Visual Indicators**: Color-coded battery icons showing remaining capacity.
- **Seamless UI**: Built natively for VS Code—no distraction, just information.

### 📸 Preview
| Hover for Detail | Click to view all Quotas & manual refresh usage |
| :---: | :---: |
| ![Hover Preview](assets/demo-pics/hover-on-status-bar-item.png) | ![Click Preview](assets/demo-pics/click-on-status-bar-item.png) |

### 🚀 Key Features
- **Hardest Working Model Tracking**: Automatically detects your most heavily used model (with a **pulse icon $(pulse)$** for highlighting) by monitoring usage volume (quota drops) within a sliding window (**default 5 minutes, user-adjustable**), ensuring the status bar always shows what's relevant.
- **Rich Hover Tooltip**: Hover for a detailed, stroke-less breakdown of your plan tier, remaining AI credits, and model reset times. The active model is highlighted with a pulse icon **$(pulse)$**.
- **Clean Workspace**: Use the "Minimize monitor" feature in the tooltip to hide the quota text and keep only the icon visible in the status bar.
- **Customizable Intervals**: Adjust the quota refresh rate on-the-fly directly from the tooltip.
- **One-Click QuickPick**: Click the status bar item for instant access to all model stats in a clean, searchable list.

### 📦 Installation
- **Marketplace**: Install via [Open VSX Registry](https://open-vsx.org/extension/the-long-ride/antigravity-quota-quickcheck)
- **Manual**: Download the `.vsix` from releases, then `Extensions: Install from VSIX...` in VS Code.

---

#### 🙏 Credits
Special thanks to [llegomark](https://github.com/llegomark) for the `ag-telemetry` foundation.

---
[Open VSX](https://open-vsx.org/extension/the-long-ride/antigravity-quota-quickcheck) | [GitHub](https://github.com/the-long-ride/antigravity-quota-quickcheck) | [Changelog](CHANGELOG.md) | [MIT License](LICENSE)
