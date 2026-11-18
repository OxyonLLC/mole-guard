// Publishes the built release APK to the unlisted beta page.
//
// Doing this by hand means three things must agree: the copied file, the
// SHA-256 printed on the download page, and the version in latest.json that
// the app compares itself against. They drifted twice while this was manual,
// and a wrong checksum is worse than none — it teaches testers to ignore the
// check that protects them from a substituted APK.
//
//   npm run mobile:publish
//
// Writes nothing outside src/public/jdid93hf8dh/ and never touches the
// keystore. The .apk itself stays gitignored; upload it with the page.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APK_SRC = path.join(ROOT, 'mobile/android/app/build/outputs/apk/release/app-release.apk');
const OUT_DIR = path.join(ROOT, 'src/public/jdid93hf8dh');
const PAGE = path.join(OUT_DIR, 'index.html');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mobile/package.json'), 'utf8'));
const version = String(pkg.version);
const [maj, min, pat] = version.split('.').map(Number);
if (![maj, min, pat].every(Number.isFinite)) {
  throw new Error(`mobile/package.json version "${version}" is not MAJOR.MINOR.PATCH`);
}
// Same formula as mobile/android/app/build.gradle, so the number the app
// reports at runtime and the number published here cannot disagree.
const build = maj * 10000 + min * 100 + pat;

if (!fs.existsSync(APK_SRC)) {
  console.error(`No release APK at ${path.relative(ROOT, APK_SRC)}`);
  console.error('Build one first:  cd mobile/android && ./gradlew assembleRelease');
  process.exit(1);
}

const apk = fs.readFileSync(APK_SRC);
const sha256 = crypto.createHash('sha256').update(apk).digest('hex');
const fileName = `winlew-beta-${version}.apk`;
const sizeMb = Math.round(apk.length / (1024 * 1024));

fs.mkdirSync(OUT_DIR, { recursive: true });

// Drop older betas so the directory never serves two "current" builds.
for (const stale of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.apk') && f !== fileName)) {
  fs.rmSync(path.join(OUT_DIR, stale));
  console.log(`removed stale ${stale}`);
}
fs.writeFileSync(path.join(OUT_DIR, fileName), apk);

fs.writeFileSync(
  path.join(OUT_DIR, 'latest.json'),
  `${JSON.stringify({ version, build, url: `/jdid93hf8dh/${fileName}`, sha256, sizeMb }, null, 2)}\n`,
);

// Keep the human-readable page honest about the same numbers.
if (fs.existsSync(PAGE)) {
  let page = fs.readFileSync(PAGE, 'utf8');
  page = page.replace(/(<dt>SHA-256<\/dt><dd>)[a-f0-9]{64}(<\/dd>)/, `$1${sha256}$2`);
  page = page.replace(/(<dt>Version<\/dt><dd>)[^<]*(<\/dd>)/, `$1${version} (build ${build})$2`);
  page = page.replace(/(href="\/jdid93hf8dh\/)[^"]+\.apk(")/, `$1${fileName}$2`);
  page = page.replace(/(⬇ Download APK · )\d+( MB)/, `$1${sizeMb}$2`);
  fs.writeFileSync(PAGE, page);
}

console.log(`published ${fileName}  ${sizeMb} MB  build ${build}`);
console.log(`sha256   ${sha256}`);
console.log('\nUpload BOTH to the host:');
console.log('  src/public/jdid93hf8dh/index.html + latest.json');
console.log(`  src/public/jdid93hf8dh/${fileName}   (gitignored — upload by hand)`);
