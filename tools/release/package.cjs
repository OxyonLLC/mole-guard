'use strict';
// Local release artifacts only. No upload, process startup, cleanup or credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../..');
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--integration')) throw new Error('Usage: node tools/release/package.cjs [--integration]');
const integration = process.argv[2] === '--integration';
const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.test-tmp/completion-checkpoint-spUAJa/manifest.json')));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [relative, expected] of Object.entries(checkpoint.historical)) {
  if (hash(path.join(repo, relative)) !== expected) throw new Error('Historical evidence integrity discrepancy');
}
const destination = fs.mkdtempSync(path.join(repo, '.test-tmp/winlew3-rc-'));
const manifest = { createdAt: new Date().toISOString(), baselineHead: checkpoint.head,
  checkpoint: '.test-tmp/completion-checkpoint-spUAJa', publicFiles: {}, backendFiles: {}, excluded: [],
  historicalFilesUnchanged: Object.keys(checkpoint.historical).length,
  releaseStatus: 'LOCAL REVIEW ONLY; production gates pending' };
manifest.runtime = require('./runtime.cjs')(repo, destination);
const sensitive = /^(?:api-proxy-secret|api-proxy-upstream)\.php$|\.(?:bak|before|patch|log)$/i;
function copyTree(directory, relative = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if ((entry.name.startsWith('.') && entry.name !== '.htaccess') || entry.name === 'log' || sensitive.test(entry.name)) {
      manifest.excluded.push(rel); continue;
    }
    if (entry.isSymbolicLink()) throw new Error('Release source link requires review');
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) { copyTree(source, rel); continue; }
    if (!entry.isFile()) throw new Error('Unexpected release source entry');
    // Never print matches. Refuse obvious embedded private keys / literal
    // credential assignments rather than copy them into the review artifact.
    if (/\.(?:php|js|json|html|txt)$/i.test(entry.name) && fs.statSync(source).size < 2000000) {
      const text = fs.readFileSync(source, 'utf8');
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
        || /(?:DISCORD_TOKEN|CLIENT_SECRET|API_KEY|PROXY_SECRET)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{20,}["']/.test(text)) throw new Error(`Credential category requires review: ${rel}`);
    }
    const target = path.join(destination, 'public', rel);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
    manifest.publicFiles[rel] = { bytes: fs.statSync(source).size, sha256: hash(source) };
  }
}
copyTree(path.join(repo, 'src/public'));
const android = JSON.parse(fs.readFileSync(path.join(repo, 'src/public/jdid93hf8dh/latest.json'), 'utf8'));
if (android.url !== '/jdid93hf8dh/winlew-beta-0.2.1.apk'
  || manifest.publicFiles[android.url.slice(1)]?.sha256 !== android.sha256) {
  throw new Error('Existing Android package integrity discrepancy');
}
manifest.android = { version: android.version, build: android.build, url: android.url, sha256: android.sha256,
  status: 'Existing beta preserved unchanged; not a new APK build' };
const implementation = [
  '.gitignore', 'src/mole/web.js', 'src/mole/publicFiles.js',
  'src/public/.htaccess', 'src/public/_redirects', 'src/public/404.html',
  'src/public/index.html', 'src/public/app/index.html',
  ...['play', 'earn', 'community-hub', 'token', 'proof', 'build'].map(route => `src/public/${route}/index.html`),
  ...['experience.css', 'homepage.css', 'homepage.js', 'homepage-data.js', 'journeys.css', 'nav.css', 'nav.js'].map(file => `src/public/assets/${file}`),
  'src/public/mole-hub/index.html', 'src/public/sitemap.xml', 'src/scripts/build-sitemap.mjs',
  'test/mole/publicFiles.test.mjs', 'test/mole/completionSecurity.test.mjs',
  'test/ui/homepageData.test.mjs', 'test/ui/androidCompatibility.test.mjs', 'test/ui/winlew3Journeys.test.mjs',
  'tools/test-audit/policy.cjs', 'tools/test-audit/run.cjs', 'tools/test-audit/browsers.cjs',
  'tools/release/checkpoint.cjs', 'tools/release/package.cjs',
  'docs/winlew-3-completion-progress.md', 'docs/winlew-3-completion-report.md',
  'src/public/verify/profile.js', 'src/public/faucet/index.html', 'src/public/quiz/index.html',
  'test/ui/profileCacheBoundary.test.mjs', 'test/ui/audioCompatibility.test.mjs', 'test/ui/phase5Acceptance.test.mjs', 'test/mole/phase5Release.test.mjs',
  'src/public/mole-hub/js/app.js',
  'src/public/transparency/js/app.js',
  'test/mole/runtimeAssembly.test.mjs',
  ...['chrome', 'edge', 'firefox', 'webkit'].map(name => `test/ui/matrix/${name}.test.mjs`),
  'tools/release/phase5-checkpoint.cjs', 'tools/release/runtime.cjs', 'docs/phase5-release-readiness.md',
];
if (integration) {
  const localFiles = [
    'src/mole/rewardHistory.js', 'src/public/verify/api-proxy.php', 'src/public/xl1/verify/api-proxy.php',
    'src/public/faucet/js/app.js', 'src/public/verify/profile.html',
    'test/support/localStaging.mjs', 'test/mole/syntheticRewardIntegration.test.mjs',
    'test/support/browserSettlement.mjs', 'test/ui/moleIceWinning.test.mjs', 'test/ui/pacMoleWinning.test.mjs',
    'test/ui/blasterWinning.test.mjs', 'test/ui/stagingAccountJourney.test.mjs',
    'test/mole/stagingConfiguration.test.mjs', 'test/ui/practiceLifecycle.test.mjs', 'test/ui/practiceFailureRecovery.test.mjs',
    'mobile/staging-config.cjs', 'tools/release/integration-checkpoint.cjs', 'tools/release/game-checkpoint.cjs',
    'tools/release/staging.cjs', 'tools/release/verify-integration.cjs',
    'tools/release/runtime.cjs', 'test/mole/runtimeAssembly.test.mjs',
    'docs/winlew-3-integration-progress.md', 'docs/winlew-3-game-staging-report.md',
    ...['README.md', 'run.cjs', 'server.mjs', 'gateway.mjs', 'candidate.cjs', 'environment.cjs', 'integrity.cjs', 'php-smoke.cjs',
      'php-fixtures/run.php', 'php-fixtures/router.php', 'php-fixtures/upstream.php'].map(file => `tools/staging/${file}`),
  ];
  implementation.push(...localFiles);
  manifest.integration = { checkpoint: '.test-tmp/integration-checkpoint-QYm3QZ',
    continuationCheckpoints:['.test-tmp/game-checkpoint-NM7zm5','.test-tmp/game-checkpoint-oThDmB','.test-tmp/game-checkpoint-JvTbgQ','.test-tmp/game-checkpoint-fxlflu','.test-tmp/game-checkpoint-xQMQvL'],
    report: 'docs/winlew-3-game-staging-report.md', mode: 'local tooling references; never a production entry point' };
  manifest.localToolingFiles = {};
  for (const relative of localFiles) {
    const source = path.join(repo, relative), target = path.join(destination, 'local-tooling', relative);
    if (fs.lstatSync(source).isSymbolicLink() || !fs.statSync(source).isFile()) throw new Error('Local tooling source requires review');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
    manifest.localToolingFiles[relative] = { bytes: fs.statSync(source).size, sha256: hash(target) };
  }
  manifest.staging=require('./staging.cjs')(repo,destination,manifest);
}
manifest.implementationFiles = Object.fromEntries(implementation.map(relative => [relative, { sha256: hash(path.join(repo, relative)) }]));
for (const relative of ['src/mole/web.js', 'src/mole/publicFiles.js']) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, relative), target);
  manifest.backendFiles[relative] = { sha256: hash(target) };
}
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(destination, 'README.txt'), [
  'WinLEW 3.0 local review artifact; not deployed.',
  'Public assets are frozen copies of the local candidate. All historical audit',
  'material, log directories and credential include files are excluded.',
  'runtime/ contains the statically resolved src/index.js source closure and lockfile.',
  'It does not contain credentials, node_modules or persistent data and was never started.',
  'Computed imports and runtime resources require the existing reviewed owner environment.',
  'The two top-level backend files remain implementation references.',
  'Use the guarded repository supervisor for tests; never start production here.',
  'Hosting credentials/upstream configuration must be installed separately by',
  'the owner outside the document root before any separately approved release.',
  'See docs/phase5-release-readiness.md in the repository for release gates.',
  ...(integration ? ['local-tooling/ contains frozen integration reference sources, not a standalone runnable staging project.',
    'staging/ contains a frozen runnable source bundle without credentials or data.',
    'Run node tools/staging/run.cjs --candidate from the ORIGINAL reviewed repository.',
    'Its original guard protects real data; do not start the staging entry directly.',
    'See docs/winlew-3-integration-progress.md for targeted evidence and remaining coverage.'] : []),
].join('\n'));
const pointer = path.join(repo, integration ? '.test-tmp/integration-final-artifact.json' : '.test-tmp/phase5-final-artifact.json');
if (fs.existsSync(pointer) && JSON.parse(fs.readFileSync(pointer, 'utf8')).generator !== 'tools/release/package.cjs') {
  throw new Error('Unowned artifact pointer: refuse overwrite');
}
fs.writeFileSync(pointer, JSON.stringify({ generator: 'tools/release/package.cjs',
  candidate: path.relative(repo, destination).replaceAll('\\', '/'),
  manifestSha256: hash(path.join(destination, 'manifest.json')), status: manifest.releaseStatus }, null, 2));
console.log(JSON.stringify({ candidate: path.relative(repo, destination), publicFiles: Object.keys(manifest.publicFiles).length,
  historicalFilesUnchanged: manifest.historicalFilesUnchanged, excluded: manifest.excluded }));
