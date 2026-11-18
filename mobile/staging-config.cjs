'use strict';
// Separate disposable debug project only. Never edits production config/APK.
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..');
function createStagingConfig(port, mode = 'usb') {
  if (!/^\d+$/.test(String(port)) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Explicit local staging port required');
  if (!['usb', 'emulator'].includes(mode)) throw new Error('Only usb or emulator local transport supported');
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'capacitor.config.json'), 'utf8'));
  const host = mode === 'usb' ? '127.0.0.1' : '10.0.2.2';
  return { ...source, appId: 'co.winlew.app.staging', appName: 'WinLEW Isolated Staging',
    server: { url: `http://${host}:${port}/__staging/`, cleartext: true, androidScheme: 'http', allowNavigation: [host] },
    android: { ...source.android, allowMixedContent: false } };
}
module.exports = { createStagingConfig };
if (require.main === module) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node mobile/staging-config.cjs <port> [usb|emulator]');
  const config = createStagingConfig(process.argv[2], process.argv[3]);
  const root = fs.mkdtempSync(path.join(repo, '.test-tmp/android-staging-')); fs.mkdirSync(path.join(root, 'www'));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...pkg, name: 'winlew-isolated-staging', version: '0.0.0', scripts: { sync: 'cap sync android', 'add:android': 'cap add android' } }, null, 2));
  fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(root, 'www/index.html'), '<!doctype html><title>WinLEW isolated staging</title><p>Start the isolated local staging supervisor before opening this debug project.</p>');
  fs.writeFileSync(path.join(root, 'README.txt'), 'Separate DEBUG project. No production APK, signing key or wallet storage copied.\nInstall tooling here, then cap add android and cap sync android.\nUSB: adb reverse tcp:PORT tcp:PORT. Emulator: 10.0.2.2 maps the host loopback.\nOpen /__staging/ and select a synthetic persona. Never connect a funded wallet.\nPhysical device and emulator execution have not been claimed by generation.\n');
  console.log(JSON.stringify({ project: path.relative(repo, root), appId: config.appId, url: config.server.url, existingApkModified: false }));
}
