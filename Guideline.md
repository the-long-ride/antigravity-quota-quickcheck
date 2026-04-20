# Developer Guidelines

This document contains instructions for developing, modifying, and publishing the Antigravity Quota Quickcheck extension.

## 🚀 Local Development

If you want to edit the code and test your changes:

1. Open this project folder in VS Code.
2. Press `F5` on your keyboard to start debugging.
3. A new "Extension Development Host" window will open with the extension pre-loaded.
4. Look at the bottom right status bar to see the `Antigravity Quota` icon. Click it to view the real-time quota!
5. To make changes, edit `src/extension.ts`, save the file, and press `Ctrl+R` (or `Cmd+R` on Mac) in the Development Host window to reload.

## 🛠 How to Modify

- **Change the UI/Text**: Open `src/extension.ts` and modify the `updateStatusBarItem()` function.

## 🌍 How to Publish

Before you publish or share your extension, you need to package it into a `.vsix` file.

### 📦 Packaging (For Local Distribution)
If you want to create a file that you can send to someone to install manually:

1. **Update Version**: Open `package.json` and increase the `"version"` (e.g., from `1.0.0` to `1.0.1`).
2. **Compile and Package**: Run the following command in your terminal:
   ```powershell
   vsce package
   ```
   > [!NOTE]
   > You do **not** need to run `npm run compile` manually before this. The `vsce package` command automatically triggers the `vscode:prepublish` script which compiles your TypeScript into JavaScript for you!
3. **Install**: This will generate an `antigravity-quota-quickcheck-X.X.X.vsix` file. You can install it in VS Code by going to the Extensions view, clicking the `...` menu, and choosing "Install from VSIX...".

### 🚀 Publishing to the VS Code Marketplace
To make it publicly available so users can search for it directly inside VS Code:

1. **Preparation**:
   - Create a [Microsoft account](https://signup.live.com/) and an [Azure DevOps organization](https://dev.azure.com/).
   - Create a **Personal Access Token (PAT)** in Azure DevOps with `Marketplace (Publish)` scope.
2. **Management Page**: Create a publisher on the [VS Code Marketplace Management page](https://marketplace.visualstudio.com/manage).
3. **Link Publisher**: Ensure the `"publisher"` field in `package.json` matches your publisher ID (currently set to `the-long-ride`).
4. **Login**:
   ```powershell
   vsce login <your-publisher-id>
   ```
   (It will prompt you for your PAT).
5. **Publish**:
   ```powershell
   vsce publish
   ```
   > [!TIP]
   > Similar to packaging, `vsce publish` will automatically compile your code before uploading it to the Marketplace.
