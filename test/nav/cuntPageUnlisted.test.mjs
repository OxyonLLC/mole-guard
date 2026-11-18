// The $CUNT teaser page is deliberately "live but unlisted": reachable at
// /cunt/future/ if you know the path, invisible otherwise. The token is months
// out and the owner does not want it shown off before it is finished.
//
// That posture is held up by four independent things, and three of them are
// silent when broken — nothing errors, nothing 404s, the page just quietly
// becomes discoverable. In particular, a single href from any indexed page
// undoes all the rest of it, and that is the sort of edit someone makes while
// doing something else entirely.
//
// The path is obscurity, not security. Nothing on the page would matter if it
// were found; this test protects the *timing*, not a secret.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = resolve(repoRoot, "src/public");

const guard = readFileSync(resolve(publicDir, "cunt/index.html"), "utf8");
const page = readFileSync(resolve(publicDir, "cunt/future/index.html"), "utf8");

test("/cunt/ is a guard stub, not the page", () => {
  // Someone who guesses /cunt/ must land on the deterrent page and get no hint
  // that anything lives deeper.
  assert.match(guard, /noindex/i, "the /cunt/ guard stub must be noindex");
  assert.match(
    guard,
    /\/no-thank-you\//,
    "the /cunt/ guard must redirect to /no-thank-you/, matching the other directory guards"
  );
  assert.ok(
    !/future/i.test(guard),
    "the /cunt/ guard must not mention the real path — that defeats the point of the stub"
  );
});

test("the page itself is noindex, nofollow", () => {
  assert.match(
    page,
    /<meta\s+name="robots"\s+content="noindex,\s*nofollow"/i,
    "/cunt/future/ must carry noindex, nofollow until launch"
  );
});

test("nothing anywhere on the site links to the page", () => {
  // The one that breaks first. Walk every served .html and .js outside the
  // /cunt/ tree and assert none of them reference the path.
  const offenders = [];
  const skipDirs = new Set([".tmp-shots", ".tmp-audit", "log", "node_modules"]);

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (skipDirs.has(entry)) continue;
        // The page is allowed to reference itself.
        if (resolve(full) === resolve(publicDir, "cunt")) continue;
        walk(full);
        continue;
      }
      if (!/\.(html|js)$/i.test(entry)) continue;
      const body = readFileSync(full, "utf8");
      if (/["'(\s]\/cunt(\/|["'\s)])/.test(body)) {
        offenders.push(relative(repoRoot, full));
      }
    }
  };
  walk(publicDir);

  assert.deepEqual(
    offenders,
    [],
    `These served files link to /cunt/, which makes the unlisted teaser page discoverable ` +
      `and crawlable via the linking page: ${offenders.join(", ")}. Remove the link, or if ` +
      `the token has actually launched, delete this test rather than weakening it.`
  );
});

test("the page is absent from the nav registry", () => {
  const nav = readFileSync(resolve(publicDir, "assets/nav.js"), "utf8");
  assert.ok(
    !/cunt/i.test(nav),
    "nav.js mentions the teaser page. It must have no nav entry and no PAGE_CONFIGS row."
  );
});

test("robots.txt does not advertise the path", () => {
  // Counter-intuitive but important: a `Disallow: /cunt/future/` line would
  // publish the exact path to anyone who reads robots.txt — the file is public
  // by definition. noindex is the mechanism here; robots.txt would be an own
  // goal. This test fails if someone "helpfully" adds one.
  const robots = resolve(publicDir, "robots.txt");
  if (!existsSync(robots)) return;
  assert.ok(
    !/cunt/i.test(readFileSync(robots, "utf8")),
    "robots.txt names the teaser path. robots.txt is world-readable, so a Disallow line " +
      "advertises the URL instead of hiding it. Remove it and rely on the page's noindex."
  );
});

test("the build notes are not served from the web root", () => {
  // They were, at src/public/cunt/README.md — which made the staging posture
  // and the unfinished-claims checklist downloadable by anyone who guessed it.
  assert.ok(
    !existsSync(resolve(publicDir, "cunt/README.md")) &&
      !existsSync(resolve(publicDir, "cunt/future/README.md")),
    "The $CUNT build notes are back under src/public/. They belong at src/cunt/PAGE-NOTES.md — " +
      "anything under src/public/ is downloadable, including internal checklists."
  );
});
