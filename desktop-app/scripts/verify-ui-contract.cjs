const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const main = config.app.windows.find((w) => w.label === 'main');
assert.equal(main.width, 680);
assert.equal(main.height, 420);
assert.equal(config.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh');

const mainTs = fs.readFileSync('src/main.ts', 'utf8');
assert.ok(mainTs.includes('"Sep"'));
assert.ok(!mainTs.includes('"September"'));

const styles = fs.readFileSync('src/styles.css', 'utf8');
assert.match(styles, /\.app-content[\s\S]*?padding:\s*10px/);

const indexHtml = fs.readFileSync('index.html', 'utf8');
assert.match(indexHtml, /<link rel="stylesheet" href="\/src\/layout-fixes\.css" \/>/);
const layoutFixes = fs.readFileSync('src/layout-fixes.css', 'utf8');
assert.match(layoutFixes, /\.quotas-section[\s\S]*?flex:\s*1\s+1\s+auto/);
assert.match(layoutFixes, /\.quotas-list[\s\S]*?flex:\s*1\s+1\s+auto/);
assert.match(layoutFixes, /\.quota-item[\s\S]*?flex:\s*1\s+0\s+auto/);

const hooks = fs.readFileSync('src-tauri/installer-hooks.nsh', 'utf8');
assert.doesNotMatch(hooks, /Function \.onGUIInit/);
assert.doesNotMatch(hooks, /Function \.onVerifyInstDir/);
assert.match(hooks, /!define MUI_CUSTOMFUNCTION_GUIINIT NormalizeInstallDir/);
assert.match(hooks, /Function NormalizeInstallDir[\s\S]*?StrCpy \$0 \$INSTDIR 1[\s\S]*?StrCmp \$0 `"` 0 \+2[\s\S]*?StrCpy \$INSTDIR \$INSTDIR "" 1[\s\S]*?StrCpy \$0 \$INSTDIR 1 -1[\s\S]*?StrCmp \$0 `"` 0 \+2[\s\S]*?StrCpy \$INSTDIR \$INSTDIR -1[\s\S]*?FunctionEnd/);
assert.match(hooks, /WriteRegStr SHCTX "\$\{UNINSTKEY\}" "InstallLocation" "\$INSTDIR"/);
