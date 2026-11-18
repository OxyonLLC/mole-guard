// Is what winlew.co serves the same as what's in this repo?
//
//   npm run site:check            # files changed since the last tag
//   npm run site:check HEAD~5     # ...since any ref
//   npm run site:check --all      # every asset + page under src/public
//
// The site is uploaded to shared hosting by hand, separately from the git push
// and separately from the bot machine. So "pushed" and "live" are different
// facts, and today they disagreed three times — most importantly on
// verify/link.js, where a stale copy would have made a fixed bug look unfixed
// during a device test.
//
// Compares Content-Length rather than downloading bodies: enough to catch a
// file that was never uploaded, and one HEAD request each.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'src', 'public');
const BASE = process.env.SITE_CHECK_BASE || 'https://winlew.co';

const arg = process.argv[2];

function changedFiles(since) {
  const out = execSync(`git diff --name-only ${since}..HEAD -- src/public`, { cwd: ROOT }).toString();
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function allFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allFiles(p, acc);
    else if (/\.(html|js|css|json)$/.test(e.name)) acc.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  return acc;
}

let files;
if (arg === '--all') {
  files = allFiles(PUBLIC);
} else {
  let since = arg;
  if (!since) {
    try { since = execSync('git describe --tags --abbrev=0', { cwd: ROOT }).toString().trim(); }
    catch { since = 'HEAD~20'; }
  }
  files = changedFiles(since);
  console.log(`Comparing files changed since ${since} (${files.length} file(s))\n`);
}

if (!files.length) {
  console.log('Nothing to check — no site files changed in that range.');
  process.exit(0);
}

/** True/false if the bodies match ignoring line endings; null if unfetchable. */
async function sameIgnoringLineEndings(url, absPath) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'Accept-Encoding': 'identity' } });
    if (!res.ok) return null;
    const live = (await res.text()).replace(/\r\n/g, '\n');
    const local = fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
    return live === local;
  } catch {
    return null;
  }
}

// A page's URL is its path minus src/public, with index.html implied.
function urlFor(repoPath) {
  let rel = repoPath.replace(/^src\/public\//, '');
  if (rel.endsWith('/index.html')) rel = rel.slice(0, -'index.html'.length);
  return `${BASE}/${rel}`;
}

let stale = 0;
let missing = 0;
let unreadable = 0;

for (const f of files) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue; // deleted locally; nothing to compare
  const localSize = fs.statSync(abs).size;
  const url = urlFor(f);

  let liveSize = null;
  let status = 0;
  try {
    // Identity encoding on purpose. Node's fetch advertises gzip by default and
    // then strips content-length after decoding, so every comparison came back
    // "cannot compare" — asking for the uncompressed body gives a length that
    // matches the file on disk.
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'Accept-Encoding': 'identity' },
    });
    status = res.status;
    const len = res.headers.get('content-length');
    liveSize = len === null ? null : Number(len);
  } catch {
    unreadable += 1;
    console.log(`  ?  ${f}  (could not reach ${url})`);
    continue;
  }

  if (status === 404) {
    missing += 1;
    console.log(`  ✗  ${f}  NOT ON THE SITE  -> upload to ${url}`);
  } else if (liveSize === null) {
    // Some hosts omit content-length on compressed responses; not a failure,
    // just not comparable this way.
    console.log(`  ?  ${f}  (no content-length; cannot compare)`);
  } else if (liveSize !== localSize) {
    // A size mismatch is a SUSPICION, not a verdict. Uploads commonly rewrite
    // CRLF to LF, which shrinks a file by exactly its line count while leaving
    // the content identical — that produced a false "stale" on verify/link.js
    // and nearly sent someone to re-upload a correct file. Settle it by
    // fetching the body and comparing line-ending-normalised content. Only
    // mismatches pay for the GET.
    const same = await sameIgnoringLineEndings(url, abs);
    if (same === true) {
      console.log(`  ✓  ${f}  (live is LF-normalised; content identical)`);
    } else if (same === null) {
      console.log(`  ?  ${f}  size differs and body could not be fetched to confirm`);
    } else {
      stale += 1;
      console.log(`  ✗  ${f}  STALE  live=${liveSize} repo=${localSize}  -> re-upload`);
    }
  } else {
    console.log(`  ✓  ${f}`);
  }
}

console.log(`\n${files.length} checked · ${stale} stale · ${missing} missing · ${unreadable} unreachable`);
if (stale || missing) {
  console.log('\nThe site is uploaded separately from the git push — anything above needs');
  console.log('copying to the host before it takes effect for users or the mobile app.');
  process.exit(1);
}
