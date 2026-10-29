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
  assert.match(tooltip, /<th>Model pools<\/th>/);
  assert.match(tooltip, /buildBar\(q\.fiveHourPercent, 5\)/);
  assert.match(tooltip, /buildBar\(q\.weeklyPercent, 5\)/);
  assert.ok(tooltip.includes(DESKTOP_RELEASE));
  assert.ok(tooltip.includes(QUOTASHIFT_RELEASE));
  assert.match(tooltip, /Welcome to use/);
  assert.match(tooltip, /Desktop App/);
  assert.match(tooltip, /QuotaShift/);
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

test('release manifests and changelog identify v1.3.2', () => {
  const pkg = JSON.parse(read('package.json'));
  const pkgLock = JSON.parse(read('package-lock.json'));
  const desktopPkg = JSON.parse(read('desktop-app/package.json'));
  const tauri = JSON.parse(read('desktop-app/src-tauri/tauri.conf.json'));
  const cargo = read('desktop-app/src-tauri/Cargo.toml');
  const changelog = read('CHANGELOG.md');

  assert.equal(pkg.version, '1.3.2');
  assert.equal(pkgLock.version, '1.3.2');
  assert.equal(pkgLock.packages[''].version, '1.3.2');
  assert.equal(desktopPkg.version, '1.3.2');
  assert.equal(tauri.version, '1.3.2');
  assert.match(cargo, /^version = "1\.3\.2"$/m);
  assert.match(changelog, /^## \[1\.3\.2\] - 2026-10-29$/m);
  assert.match(changelog, /### VS Code Extension/);
  assert.match(changelog, /### Desktop App/);
});

test('desktop app header displays gray version hyperlink opening changelog', () => {
  const indexHtml = read('desktop-app/index.html');
  const mainTs = read('desktop-app/src/main.ts');
  const stylesCss = read('desktop-app/src/styles.css');
  const libRs = read('desktop-app/src-tauri/src/lib.rs');
  const tauri = JSON.parse(read('desktop-app/src-tauri/tauri.conf.json'));
  const mainWindow = tauri.app.windows.find((w) => w.label === 'main');

  assert.equal(mainWindow.width, 598);
  assert.equal(mainWindow.height, 470);
  assert.match(indexHtml, /class="app-version-link"/);
  assert.match(indexHtml, /id="app-version-link"/);
  assert.match(indexHtml, /<h3 class="section-title">Quotas <span class="subtitle">- Periods & reset time<\/span><\/h3>/);
  assert.doesNotMatch(mainTs, /Resets at:/);
  assert.match(stylesCss, /\.app-version-link\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(stylesCss, /\.app-version-link:hover\s*\{[\s\S]*?text-decoration:\s*underline/);
  assert.doesNotMatch(stylesCss, /\.app-version-link:hover\s*\{[^}]*?border-color/);
  assert.match(mainTs, /app-version-link/);
  assert.match(mainTs, /CHANGELOG\.md/);
  assert.match(libRs, /fn get_app_version\(\)/);
  assert.match(libRs, /get_app_version/);
  assert.match(libRs, /598\.0\s*\*\s*scale_factor/);
});

test('desktop app buttons and hyperlinks use floating tooltips with edge clamping', () => {
  const indexHtml = read('desktop-app/index.html');
  const mainTs = read('desktop-app/src/main.ts');
  const tooltipTs = read('desktop-app/src/tooltip.ts');
  const stylesCss = read('desktop-app/src/styles.css');

  // No title attributes on buttons or links in HTML
  assert.doesNotMatch(indexHtml, /<(button|a)[^>]*?\btitle=/i);

  // data-tooltip present on controls and footer links
  assert.match(indexHtml, /id="refresh-btn"[^>]*?data-tooltip="Force Refresh"/);
  assert.match(indexHtml, /id="theme-toggle"[^>]*?data-tooltip="Toggle dark\/light mode"/);
  assert.match(indexHtml, /id="app-version-link"[^>]*?data-tooltip="View Changelog on GitHub"/);
  assert.match(indexHtml, /id="quotashift-link"[^>]*?data-tooltip="QuotaShift/);

  // main.ts initializes floating tooltips and avoids .title
  assert.match(mainTs, /initFloatingTooltips\(\)/);
  assert.doesNotMatch(mainTs, /updateBtn\.title\s*=/);

  // Tooltip CSS requirements
  assert.match(stylesCss, /\.floating-tooltip\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(stylesCss, /\.floating-tooltip\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(stylesCss, /\.floating-tooltip\s*\{[\s\S]*?z-index:\s*10000/);

  // Test edge clamping via VM
  const vm = require('node:vm');
  const sandbox = { Math };
  vm.createContext(sandbox);

  const rawFn = tooltipTs.match(/export function calculateTooltipPosition[\s\S]*?return \{\s*left:\s*Math\.round\(left\),\s*top:\s*Math\.round\(top\),\s*placement,\s*\};\n\}/)[0];
  const jsFn = rawFn
    .replace('export ', '')
    .replace(/targetRect:\s*RectLike/, 'targetRect')
    .replace(/tooltipRect:\s*\{[^}]*\}/, 'tooltipRect')
    .replace(/viewport:\s*\{[^}]*\}/, 'viewport')
    .replace(/:\s*TooltipPosition/, '')
    .replace(/:\s*"top"\s*\|\s*"bottom"/, '')
    .replace(/:\s*number/g, '');
  vm.runInContext(jsFn, sandbox);
  const calc = sandbox.calculateTooltipPosition;

  // Header button near top and right edge
  const headerBtn = calc(
    { left: 510, top: 8, right: 532, bottom: 30, width: 22, height: 22 },
    { width: 120, height: 26 },
    { width: 598, height: 470 }
  );
  assert.equal(headerBtn.placement, 'bottom');
  assert.ok(headerBtn.top >= 8, 'top must be clamped within viewport');
  assert.ok(headerBtn.top + 26 <= 470 - 8, 'bottom must not exceed viewport');
  assert.ok(headerBtn.left >= 8, 'left must be clamped within viewport');
  assert.ok(headerBtn.left + 120 <= 598 - 8, 'right edge must not be covered by panel');

  // Footer link near bottom edge
  const footerLink = calc(
    { left: 350, top: 445, right: 410, bottom: 460, width: 60, height: 15 },
    { width: 140, height: 26 },
    { width: 598, height: 470 }
  );
  assert.equal(footerLink.placement, 'top');
  assert.ok(footerLink.top >= 8, 'top must be clamped within viewport');
  assert.ok(footerLink.top + 26 <= 470 - 8, 'bottom must not exceed viewport');
  assert.ok(footerLink.left >= 8, 'left must be clamped within viewport');
  assert.ok(footerLink.left + 140 <= 598 - 8, 'right edge must not be covered by panel');

  // Far left edge element
  const leftItem = calc(
    { left: 2, top: 120, right: 22, bottom: 140, width: 20, height: 20 },
    { width: 100, height: 26 },
    { width: 598, height: 470 }
  );
  assert.equal(leftItem.left, 8, 'left edge must clamp to margin');
});

test('status bar, quick pick, and helpers support single-lane pools', () => {
  const statusBar = read('src/ui/statusBar.ts');
  const quickPick = read('src/ui/quickPick.ts');
  const helpers = read('src/ui/helpers.ts');
  const tooltip = read('src/ui/tooltip.ts');

  assert.match(helpers, /export function buildBar\(percent: number \| undefined/);
  assert.match(statusBar, /activeQuota\.(fiveHourPercent \?\? activeQuota\.percent|percent)/);
  assert.match(quickPick, /fiveHourPercent === undefined/);
  assert.match(tooltip, /fiveHourPercent !== undefined/);
});

test('status bar and tooltip support toggling credits display, and quickpick promotes QuotaShift', () => {
  const statusBar = read('src/ui/statusBar.ts');
  const quickPick = read('src/ui/quickPick.ts');
  const tooltip = read('src/ui/tooltip.ts');
  const constants = read('src/constants.ts');
  const pkg = JSON.parse(read('package.json'));

  assert.match(statusBar, /showCreditsInStatusBar/);
  assert.match(tooltip, /TOGGLE_CREDITS/);
  assert.match(constants, /showCreditsInStatusBar/);
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'antigravity-quota.toggleCredits'));
  assert.ok(pkg.contributes.configuration.properties['antigravity-quota.showCreditsInStatusBar']);

  assert.ok(quickPick.includes(QUOTASHIFT_RELEASE));
  assert.match(quickPick, /Get QuotaShift/);
});
test('quickpick desktop app option uses local desktop SVG icons for light and dark themes', () => {
  const quickPick = read('src/ui/quickPick.ts');
  assert.match(quickPick, /desktop-light\.svg/);
  assert.match(quickPick, /desktop-dark\.svg/);
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/desktop.svg')));
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/desktop-light.svg')));
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/desktop-dark.svg')));
});

test('desktop app dynamically resizes panel height according to available quota pools without vertical scrolling', () => {
  const mainTs = read('desktop-app/src/main.ts');
  const libRs = read('desktop-app/src-tauri/src/lib.rs');

  // Verify Rust Tauri command and handler registration
  assert.match(libRs, /fn set_window_height\(window: tauri::WebviewWindow, height: u32\)/);
  assert.match(libRs, /set_window_height/);
  assert.match(libRs, /current_height:\s*Option<u32>/);

  // Verify TypeScript export and calculation helper
  assert.match(mainTs, /export function calculateWindowHeight\(quotaCount: number, isGeminiOnly: boolean\): number/);
  assert.match(mainTs, /export function adjustWindowHeight\(quotaCount: number, isGeminiOnly: boolean\)/);
  assert.match(mainTs, /invoke\("set_window_height"/);

  // Verify non-blank model display name fallback
  assert.match(mainTs, /modelDisplayName = \(q\.model && q\.model\.trim\(\)\) \? q\.model : "Gemini"/);

  // Run calculation logic across pool counts
  // 0 pools (loading/offline): compact height <= 220px
  // 1 pool: compact height ~224px
  // 2 pools: fits in ~310px
  // 3 pools: fits in ~386px
  const vm = require('node:vm');
  const sandbox = { Math };
  vm.createContext(sandbox);
  const rawFn = mainTs.match(/function calculateWindowHeight[\s\S]*?return Math\.max\(216, Math\.min\(650, baseHeight \+ cardsTotal \+ 15\)\);\n\}/)[0];
  const jsFn = rawFn.replace(/:\s*[a-zA-Z]+/g, '');
  vm.runInContext(jsFn, sandbox);
  const calc = sandbox.calculateWindowHeight;

  assert.equal(calc(0, false), 216);
  assert.equal(calc(1, true), 224);
  assert.equal(calc(1, false), 292);
  assert.equal(calc(2, false), 381);
  assert.equal(calc(3, false), 470);
  assert.equal(calc(4, false), 559);
  assert.ok(calc(3, false) <= 480, '3 pools must fit comfortably within standard desktop height without scrolling');
});

test('credits display shows fullwidth dash when unavailable and quickpick shows usage percentage in 2nd row only', () => {
  const tooltip = read('src/ui/tooltip.ts');
  const quickPick = read('src/ui/quickPick.ts');

  // Verify fullwidth dash instead of unavailable
  assert.match(tooltip, /\*\*Remaining AI Credits:\*\* —/);
  assert.doesNotMatch(tooltip, /\*\*Remaining AI Credits:\*\* \*unavailable\*/);
  assert.match(quickPick, /\$\(credit-card\)\s+Remaining AI Credits: —/);
  assert.doesNotMatch(quickPick, /\$\(credit-card\)\s+Remaining AI Credits: unavailable/);

  // Verify 2nd row formatting in QuickPick
  assert.doesNotMatch(quickPick, /description:\s*description/);
  assert.match(quickPick, /\$\(clock\)\s+\$\{detailText\}/);
  assert.match(quickPick, /\$\{fiveHourPart\}\s*\/\/\s*\$\{weeklyPart\}/);
  assert.match(quickPick, /5h \$\{item\.fiveHourDisabled \? "—" : `\$\{item\.fiveHourPercent\}%`\} - \$\{fiveHourResetStr\}/);
  assert.match(quickPick, /7d \$\{item\.weeklyDisabled \? "—" : `\$\{item\.weeklyPercent\}%`\} - \$\{weeklyResetStr\}/);
});

test('desktop app colors usage bar and value dark orange for 11-20% and dark red for <=10%, and tray tooltip uses 7d label', () => {
  const mainTs = read('desktop-app/src/main.ts');
  const stylesCss = read('desktop-app/src/styles.css');
  const libRs = read('desktop-app/src-tauri/src/lib.rs');

  // Verify tray tooltip uses 7d label instead of wk
  assert.match(libRs, /format_window\("7d",\s*wk/);
  assert.doesNotMatch(libRs, /format_window\("wk",\s*wk/);

  // Verify CSS variables and level classes
  assert.match(stylesCss, /--quota-warning:\s*#ea580c/);
  assert.match(stylesCss, /--quota-danger:\s*#dc2626/);
  assert.match(stylesCss, /\.progress-bar\.quota-level--warning\s*\{[\s\S]*?background:\s*var\(--quota-warning\)/);
  assert.match(stylesCss, /\.progress-bar\.quota-level--danger\s*\{[\s\S]*?background:\s*var\(--quota-danger\)/);
  assert.match(stylesCss, /\.quota-value\.quota-level--warning\s*\{[\s\S]*?color:\s*var\(--quota-warning\)/);
  assert.match(stylesCss, /\.quota-value\.quota-level--danger\s*\{[\s\S]*?color:\s*var\(--quota-danger\)/);

  // Verify getQuotaUsageTier logic via vm
  const vm = require('node:vm');
  const sandbox = {};
  vm.createContext(sandbox);

  const rawFn = mainTs.match(/export function getQuotaUsageTier[\s\S]*?return "normal";\n\}/)[0];
  const jsFn = rawFn
    .replace('export ', '')
    .replace(/:\s*number\s*\|\s*undefined/, '')
    .replace(/\?:\s*boolean/, '')
    .replace(/:\s*"normal"\s*\|\s*"warning"\s*\|\s*"danger"/, '');
  vm.runInContext(jsFn, sandbox);
  const getTier = sandbox.getQuotaUsageTier;

  // Usage > 20% -> normal
  assert.equal(getTier(85, false), 'normal');
  assert.equal(getTier(21, false), 'normal');

  // Usage <= 20% and > 10% -> warning (dark orange)
  assert.equal(getTier(20, false), 'warning');
  assert.equal(getTier(15, false), 'warning');
  assert.equal(getTier(11, false), 'warning');

  // Usage <= 10% -> danger (dark red)
  assert.equal(getTier(10, false), 'danger');
  assert.equal(getTier(8, false), 'danger');
  assert.equal(getTier(1, false), 'danger');
  assert.equal(getTier(0, false), 'danger');

  // Disabled / unavailable -> normal
  assert.equal(getTier(undefined, false), 'normal');
  assert.equal(getTier(5, true), 'normal');
});
