#!/usr/bin/env node
// Is the repo's copy of each hand-uploaded winlew.co file the one that is live?
//
//   node src/scripts/check-live-manifest.mjs            check every entry (exit 1 on drift)
//   node src/scripts/check-live-manifest.mjs <file>     check one file you are about to upload
//
// Why: on 2026-11-12 the live relay (R2) differed from main, so the next upload
// from main would have silently reverted a production fix. deploy/winlew-co-live.json
// records what is live; a file that changes must change its entry in the same PR,
// and an upload is only allowed when the package bytes equal the entry.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** sha256 of the bytes as uploaded: LF line endings, whatever the checkout uses. */
export function liveSha256(buf) {
  return createHash("sha256").update(Buffer.from(buf.toString("latin1").replace(/\r\n/g, "\n"), "latin1")).digest("hex");
}

export function loadManifest(root = repoRoot) {
  return JSON.parse(readFileSync(resolve(root, "deploy/winlew-co-live.json"), "utf8"));
}

/** Pure: compare one file's bytes with its manifest entry. */
export function checkEntry(path, entry, bytes) {
  const actual = liveSha256(bytes);
  if (actual === entry.sha256) return { path, ok: true, actual };
  const why = entry.superseded?.[actual];
  return {
    path, ok: false, actual, expected: entry.sha256,
    reason: why
      ? `is a SUPERSEDED version (${why}); uploading it would revert ${entry.release}`
      : `differs from what is live (${entry.release}); update deploy/winlew-co-live.json in the same PR, or do not upload it`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = loadManifest();
  const only = process.argv[2] ? resolve(process.argv[2]) : null;
  let entries = Object.entries(manifest.files);
  if (only) {
    // A package file outside the repo (e.g. handoff/…/api-proxy.php) is matched by basename + htdocs path.
    const rel = relative(repoRoot, only).replace(/\\/g, "/");
    const hit = entries.filter(([p, e]) => p === rel || e.htdocs.endsWith("/" + rel.split("/").pop()));
    if (hit.length !== 1) { console.error(`no single manifest entry for ${process.argv[2]}`); process.exit(2); }
    entries = hit.map(([p, e]) => [p, e, only]);
  }
  let bad = 0;
  for (const [path, entry, file] of entries.map((x) => (x.length === 3 ? x : [...x, resolve(repoRoot, x[0])]))) {
    const r = checkEntry(path, entry, readFileSync(file));
    if (r.ok) console.log(`ok    ${entry.htdocs}  ${r.actual.slice(0, 12)}  (${entry.release})`);
    else { bad++; console.log(`DRIFT ${entry.htdocs}  ${r.actual.slice(0, 12)} ${r.reason}`); }
  }
  process.exit(bad ? 1 : 0);
}
