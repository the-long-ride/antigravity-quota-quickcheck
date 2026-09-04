const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const main = config.app.windows.find((w) => w.label === 'main');
assert.equal(main.width, 680);
assert.equal(main.height, 380);

const mainTs = fs.readFileSync('src/main.ts', 'utf8');
assert.ok(mainTs.includes('"Sep"'));
assert.ok(!mainTs.includes('"September"'));

const styles = fs.readFileSync('src/styles.css', 'utf8');
assert.match(styles, /\.quotas-section[\s\S]*?flex:\s*0\s+1\s+auto/);
