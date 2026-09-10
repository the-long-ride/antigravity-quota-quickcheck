const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = process.env.CONTRACT_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const QUOTASHIFT_RELEASE = 'https://github.com/the-long-ride/QuotaShift/releases/latest';
const DESKTOP_RELEASE = 'https://github.com/the-long-ride/antigravity-quota-quickcheck/releases/latest';

test('hover tooltip stays compact and promotes Desktop App plus QuotaShift', () => {
  const tooltip = read('src/ui/tooltip.ts');
  assert.match(tooltip, /<table border="0" cellspacing="0" cellpadding="2">/);
  assert.match(tooltip, /buildBar\(q\.fiveHourPercent, 5\)/);
  assert.match(tooltip, /buildBar\(q\.weeklyPercent, 5\)/);
  assert.ok(tooltip.includes(DESKTOP_RELEASE));
  assert.ok(tooltip.includes(QUOTASHIFT_RELEASE));
  assert.ok(tooltip.includes('Antigravity 2.0'));
  assert.ok(tooltip.includes('Antigravity, Codex & Claude'));
});

test('desktop app exposes QuotaShift with external opener behavior', () => {
  const html = read('desktop-app/index.html');
  const main = read('desktop-app/src/main.ts');
  assert.match(html, /id="quotashift-link"/);
  assert.ok(html.includes('QuotaShift'));
  assert.ok(html.includes('multiple-account switching and monitoring'));
  assert.match(main, /document\.getElementById\("quotashift-link"\)!\.addEventListener/);
  assert.ok(main.includes(QUOTASHIFT_RELEASE));
});

test('documentation explains when to use QuotaShift', () => {
  const readme = read('README.md');
  const desktopReadme = read('desktop-app/README.md');
  for (const doc of [readme, desktopReadme]) {
    assert.ok(doc.includes(QUOTASHIFT_RELEASE));
    assert.match(doc, /multiple[- ]account/i);
    assert.match(doc, /Antigravity.*Codex.*Claude/i);
  }
});

test('release manifests and changelog identify v1.3.1', () => {
  const pkg = JSON.parse(read('package.json'));
  const pkgLock = JSON.parse(read('package-lock.json'));
  const desktopPkg = JSON.parse(read('desktop-app/package.json'));
  const tauri = JSON.parse(read('desktop-app/src-tauri/tauri.conf.json'));
  const cargo = read('desktop-app/src-tauri/Cargo.toml');
  const changelog = read('CHANGELOG.md');

  assert.equal(pkg.version, '1.3.1');
  assert.equal(pkgLock.version, '1.3.1');
  assert.equal(pkgLock.packages[''].version, '1.3.1');
  assert.equal(desktopPkg.version, '1.3.1');
  assert.equal(tauri.version, '1.3.1');
  assert.match(cargo, /^version = "1\.3\.1"$/m);
  assert.match(changelog, /^## \[1\.3\.1\] - 2026-09-10$/m);
});
