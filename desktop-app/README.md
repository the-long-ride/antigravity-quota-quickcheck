# 🖥️ Antigravity Quota Quickcheck — Desktop App

A Tauri-powered standalone tray application that monitors your Google AI model quotas and credit balances in real-time. It runs quietly in your system tray and lets you keep track of your quotas even when VS Code is closed.

## 📸 Preview

![Desktop App Tray Click Preview](../assets/demo-pics/Desktop-app-tray-click.png)

## 🚀 Key Features

- **System Tray Tooltip**: Quietly displays your active model name along with 5-hour and Weekly limits (`5h` and `wk`) in a highly optimized format to avoid OS-level tooltip truncation.
- **Double-Limit Monitoring**: Real-time tracking of both the **5-Hour Limit** and **Weekly Limit** concurrently.
- **Limit Interdependence Logic**: If a model's weekly limit is `0%` (fully exhausted), its 5-hour limit is automatically forced to `0%` to keep information aligned.
- **Absolute Reset Timestamps**: Displays localized, absolute reset times (e.g. `5:41 AM` or `June 28, 7:41 PM`) instead of relative countdowns.
- **Modern Double-Column Layout**: Cards display limits side-by-side as two vertical columns in a single row below the model's title for high information density.
- **Intelligent Tray Centering**: Automatically scrolls the monitored model to the center of the list when opening or focusing the dashboard.
- **Single-Instance Enforcement**: Only runs one tray app process at a time. Launching a new instance automatically focuses and opens the existing one.
- **Custom Dialogs**: Clean, monochromatic modal overlays used instead of native alert/confirm popups.
- **Exhaustion Visuals**: Exhausted/disabled models are dimmed with a dashed border, and selecting them is blocked.

## 🛠️ Development

### Setup

Install the frontend dependencies:
```bash
npm install
```

### Dev Server

Run the Tauri dev server to compile and run the application:
```bash
npm run tauri dev
```

### Build

To compile a production release:
```bash
npm run build:release
```
The output installers and portable executables will be copied to `desktop-app/release/`.
