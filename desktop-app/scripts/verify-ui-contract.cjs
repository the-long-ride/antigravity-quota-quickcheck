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
assert.match(styles, /\.quotas-section[\s\S]*?flex:\s*0\s+1\s+auto/);

const hooks = fs.readFileSync('src-tauri/installer-hooks.nsh', 'utf8');
assert.doesNotMatch(hooks, /Function \.onGUIInit/);
assert.match(hooks, /Function \.onVerifyInstDir/);
assert.match(hooks, /StrCpy \$0 \$INSTDIR 1 0/);
assert.match(hooks, /StrCpy \$1 \$INSTDIR 1 -1/);
assert.match(hooks, /\$0 == '\"'[\s\S]*?\$1 == '\"'[\s\S]*?StrCpy \$INSTDIR \$INSTDIR -1 1/);
assert.match(hooks, /WriteRegStr SHCTX "\$\{UNINSTKEY\}" "InstallLocation" "\$INSTDIR"/);
