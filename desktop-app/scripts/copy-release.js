import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const tauriReleaseDir = path.join(rootDir, 'src-tauri', 'target', 'release');
const outputDir = path.join(rootDir, 'release');

console.log('Packaging release versions...');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 1. Copy the portable standalone binary
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'Antigravity Quota Quickcheck.exe' : 'Antigravity Quota Quickcheck';
const srcBinary = path.join(tauriReleaseDir, binaryName);
const destBinaryName = isWindows ? 'Antigravity Quota Quickcheck-portable.exe' : 'Antigravity Quota Quickcheck-portable';
const destBinary = path.join(outputDir, destBinaryName);

if (fs.existsSync(srcBinary)) {
  fs.copyFileSync(srcBinary, destBinary);
  console.log(`✓ Copied portable version to: ${destBinary}`);
} else {
  console.warn(`⚠️ Could not find portable binary at: ${srcBinary}`);
}

// 2. Find and copy the installer package
const bundleDir = path.join(tauriReleaseDir, 'bundle');
if (fs.existsSync(bundleDir)) {
  const formats = ['nsis', 'deb', 'appimage'];
  for (const format of formats) {
    const formatDir = path.join(bundleDir, format);
    if (fs.existsSync(formatDir)) {
      try {
        const files = fs.readdirSync(formatDir);
        for (const file of files) {
          const fullPath = path.join(formatDir, file);
          if (fs.statSync(fullPath).isFile()) {
            const destFile = path.join(outputDir, file);
            fs.copyFileSync(fullPath, destFile);
            console.log(`✓ Copied installer/package to: ${destFile}`);
          }
        }
      } catch (err) {
        console.error(`Error reading ${format} directory:`, err);
      }
    }
  }
}

console.log('Release packaging completed.');
