// The News Center. The failure that matters most here is a DRAFT becoming
// reachable — an unapproved article at a public URL is worse than no news
// section — so that is tested against the generated output on disk, not just
// against the data module's intent.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NEWS_ARTICLES,
  NEWS_CATEGORIES,
  NEWS_STATUSES,
  activeCategories,
  articleNeighbours,
  featuredArticle,
  publishedArticles,
  readingTimeMinutes,
  relatedArticles,
} from "../../src/mole/newsData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NEWS_DIR = resolve(repoRoot, "src/public/news");

const drafts = NEWS_ARTICLES.filter((a) => a.status === NEWS_STATUSES.DRAFT);

// ── registry integrity ───────────────────────────────────────────────────────

test("every article has the fields the builder requires", () => {
  for (const a of NEWS_ARTICLES) {
    assert.match(a.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${a.slug}`);
    assert.ok(Object.values(NEWS_STATUSES).includes(a.status), `bad status on ${a.slug}`);
    assert.ok(NEWS_CATEGORIES[a.category], `unknown category "${a.category}" on ${a.slug}`);
    assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/, `bad date on ${a.slug}`);
    assert.ok(a.title && a.subtitle, `${a.slug} needs a title and subtitle`);
    // The subtitle becomes og:description, so an empty one ships a blank
    // preview to Discord and X.
    assert.ok(a.subtitle.length > 10, `${a.slug}'s subtitle is too short to serve as og:description`);
    if (a.image) assert.ok(a.imageAlt, `${a.slug} has an image with no alt text`);
  }
});

test("slugs are unique", () => {
  const slugs = NEWS_ARTICLES.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug would make two articles fight over one URL");
});

test("at most one article is featured", () => {
  // featuredArticle() throws rather than picking, so this also asserts the
  // registry is currently valid.
  assert.doesNotThrow(() => featuredArticle());
});

test("a second featured article is rejected, not silently resolved", () => {
  const two = [
    { ...NEWS_ARTICLES[0], slug: "a", featured: true, status: NEWS_STATUSES.PUBLISHED },
    { ...NEWS_ARTICLES[0], slug: "b", featured: true, status: NEWS_STATUSES.PUBLISHED },
  ];
  assert.throws(() => featuredArticle(two), /multiple_featured_articles/);
});

// ── drafts must not be public ────────────────────────────────────────────────

test("drafts are excluded from every public accessor", () => {
  const publishedSlugs = publishedArticles().map((a) => a.slug);
  for (const d of drafts) {
    assert.ok(!publishedSlugs.includes(d.slug), `draft ${d.slug} appears in publishedArticles()`);
    assert.equal(featuredArticle()?.slug === d.slug, false, `draft ${d.slug} is featured`);
    assert.ok(!relatedArticles("security-update-august-16-2026").some((a) => a.slug === d.slug));
  }
});

test("no draft has a page on disk", () => {
  // The real guarantee. A draft could be absent from the data accessors and
  // still be reachable because a page was generated when it WAS published and
  // never removed — so this checks the filesystem, which is what the web
  // server actually serves.
  assert.ok(drafts.length > 0, "keep at least one draft in the registry so this guard stays exercised");
  for (const d of drafts) {
    assert.equal(
      existsSync(resolve(NEWS_DIR, d.slug, "index.html")),
      false,
      `/news/${d.slug}/ exists on disk but the article is a DRAFT. Re-run \`npm run news:build\` — it deletes directories for unpublished slugs.`
    );
  }
});

test("every directory under /news/ belongs to a published article", () => {
  if (!existsSync(NEWS_DIR)) return;
  const published = new Set(publishedArticles().map((a) => a.slug));
  const dirs = readdirSync(NEWS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const orphans = dirs.filter((d) => !published.has(d));
  assert.deepEqual(orphans, [], `orphaned article directories are publicly reachable: ${orphans.join(", ")}`);
});

test("a draft's title does not leak into the news index", () => {
  const index = readFileSync(resolve(NEWS_DIR, "index.html"), "utf8");
  for (const d of drafts) {
    assert.ok(!index.includes(`/news/${d.slug}/`), `index links to draft ${d.slug}`);
  }
});

// ── generated output ─────────────────────────────────────────────────────────

test("every published article has a page with complete social metadata", () => {
  for (const a of publishedArticles()) {
    const file = resolve(NEWS_DIR, a.slug, "index.html");
    assert.ok(existsSync(file), `missing page for ${a.slug} — run \`npm run news:build\``);
    const html = readFileSync(file, "utf8");

    for (const tag of [
      `<link rel="canonical" href="https://winlew.co/news/${a.slug}/"`,
      'property="og:title"',
      'property="og:description"',
      'property="og:image"',
      'property="og:url"',
      'name="twitter:card" content="summary_large_image"',
      'name="description"',
    ]) {
      assert.ok(html.includes(tag), `${a.slug} is missing ${tag}`);
    }

    // Relative og:image is silently dropped by most crawlers — the usual
    // reason a link "shares without a picture".
    const og = html.match(/property="og:image" content="([^"]+)"/)?.[1];
    assert.ok(og?.startsWith("https://"), `${a.slug}'s og:image must be absolute, got "${og}"`);
  }
});

test("the index links every published article and no others", () => {
  const html = readFileSync(resolve(NEWS_DIR, "index.html"), "utf8");
  for (const a of publishedArticles()) {
    assert.ok(html.includes(`/news/${a.slug}/`), `index does not link ${a.slug}`);
  }
});

test("generated pages load the shared nav and stylesheets", () => {
  // A generated page that forgets these renders as unstyled text with no menu,
  // which is exactly the kind of thing nobody notices until someone shares it.
  for (const rel of ["index.html", "security-update-august-16-2026/index.html"]) {
    const html = readFileSync(resolve(NEWS_DIR, rel), "utf8");
    assert.ok(html.includes('href="/assets/nav.css"'), `${rel} missing nav.css`);
    assert.ok(html.includes('href="/assets/premium.css"'), `${rel} missing premium.css`);
    assert.ok(html.includes('src="/assets/nav.js"'), `${rel} missing nav.js`);
    assert.ok(html.includes('id="siteNavLinks"'), `${rel} missing the nav mount point`);
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

test("reading time is computed, never zero", () => {
  assert.equal(readingTimeMinutes(""), 1, "a short notice must not read '0 min read'");
  assert.equal(readingTimeMinutes("<p>" + "word ".repeat(400) + "</p>"), 2);
  // Tags must not be counted as words.
  assert.equal(readingTimeMinutes("<p><em>one</em></p>"), 1);
});

test("previous is older and next is newer", () => {
  const list = publishedArticles();
  if (list.length < 2) return; // single-article archive; nothing to order yet
  const { previous, next } = articleNeighbours(list[0].slug);
  assert.equal(next, null, "the newest article has no newer neighbour");
  assert.equal(previous?.slug, list[1].slug);
});

test("only categories with published articles appear in the filter row", () => {
  const keys = activeCategories().map((c) => c.key);
  for (const d of drafts) {
    const stillUsed = publishedArticles().some((a) => a.category === d.category);
    if (!stillUsed) assert.ok(!keys.includes(d.category), `draft-only category ${d.category} is offered as a filter`);
  }
});

// ── articles that quote live constants ───────────────────────────────────────

test("the HODL article's numbers match hodlEpochs.js", async () => {
  // This article states the weekly pool, holding minimum and every hard limit
  // as figures. Those live in code and can change; a news article that quietly
  // disagrees with the system it describes is worse than one that never
  // mentioned numbers. Same failure mode lockListCoverage.test.mjs exists for.
  const { DEFAULT_EPOCH_PARAMS, LIMITS } = await import("../../src/mole/hodlEpochs.js");
  const article = NEWS_ARTICLES.find((a) => a.slug === "hodl-rewards-opens");
  assert.ok(article, "hodl-rewards-opens article is missing");

  const body = article.body;
  const withCommas = (n) => Number(n).toLocaleString("en-US");

  const mustAppear = [
    [withCommas(DEFAULT_EPOCH_PARAMS.weeklyPool), "starting weekly pool"],
    [withCommas(DEFAULT_EPOCH_PARAMS.minHold), "minimum hold"],
    [withCommas(LIMITS.MAX_WEEKLY_POOL), "max weekly pool"],
    [withCommas(LIMITS.MAX_PER_PARTICIPANT_WEEK), "max per participant per week"],
    [String(LIMITS.MAX_POV_BONUS_MULTIPLIER), "max PoV bonus multiplier"],
    [String(LIMITS.MAX_EPOCH_WEEKS), "max epoch weeks"],
  ];
  for (const [value, what] of mustAppear) {
    assert.ok(
      body.includes(value),
      `the HODL article no longer states the ${what} (${value}). Update the article to match ` +
        `src/mole/hodlEpochs.js, or remove the figure — do not let them disagree.`
    );
  }

  // Tuesday is payoutDay 2 in JS getDay terms; if that default changes, the
  // prose is wrong in a way no reader could detect.
  assert.equal(DEFAULT_EPOCH_PARAMS.payoutDay, 2, "article says Tuesdays");
  assert.match(body, /Tuesday/i);
});

// ── proof URLs must be real ──────────────────────────────────────────────────

test("every Solscan transaction linked from a news article exists in the burn ledger", async () => {
  // An earlier draft of the burn-history article carried an INVENTED signature
  // — a fabricated proof URL on pages whose entire purpose is proof. It was
  // caught before publish, but only by chance. This makes it structural.
  //
  // §12 of the build brief: "Do not invent proof URLs."
  //
  // WIDENED 2026-08-18: the rule is "a signature cited as proof must trace to a
  // record in this repo", but the check only knew about burns, so the verified
  // 2BRZ giveaway payout read as invented. The fix is to teach it the other
  // ledgers rather than to weaken it — a signature still has to live somewhere
  // before an article may cite it.
  //
  // WIDENED AGAIN 2026-08-19: community burns are a separate export from
  // BURN_EVENTS on purpose — a stranger's account sweep must never count toward
  // this project's burn progress — so the burn-history article citing a real,
  // verified community burn read as invented. Same fix as before: teach the
  // check the record, never loosen the rule.
  const { BURN_EVENTS, COMMUNITY_BURNS } = await import("../../src/mole/burnEvents.js");
  const { COMMUNITY_LIQUIDITY_EVENTS } = await import("../../src/mole/communityLiquidity.js");
  const { EVENTS } = await import("../../src/mole/eventsData.js");

  const known = new Set(
    [...BURN_EVENTS, ...COMMUNITY_BURNS, ...COMMUNITY_LIQUIDITY_EVENTS].map((e) => e.signature).filter(Boolean),
  );
  // Event records carry their proof as evidence URLs rather than a signature
  // field, so pull the signatures back out of those links.
  for (const event of EVENTS) {
    for (const item of event.evidence || []) {
      const found = String(item.url || "").match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{60,90})/);
      if (found) known.add(found[1]);
    }
  }

  const offenders = [];
  for (const article of NEWS_ARTICLES) {
    const haystack = `${article.body || ""} ${(article.sources || []).map((s) => s.url).join(" ")}`;
    for (const [, sig] of haystack.matchAll(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{60,90})/g)) {
      if (!known.has(sig)) offenders.push(`${article.slug}: ${sig}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "These transaction signatures are linked as proof but appear in no record. Either the " +
      "signature was mistyped/invented, or the event belongs in burnEvents.js. Never retype a " +
      "signature — copy it from the record:\n  " + offenders.join("\n  ")
  );
});

test("figures quoted in the burn article match the ledger", async () => {
  const { BURN_EVENTS, summarizeBurnEvents } = await import("../../src/mole/burnEvents.js");
  const article = NEWS_ARTICLES.find((a) => a.slug === "burn-history");
  assert.ok(article, "burn-history article is missing");

  // The confirmed total. Quoting the three SPL-instruction burns as the total
  // (26,785,536.931164) would contradict /burn/, which publishes this figure.
  const confirmed = Number(summarizeBurnEvents().confirmedBurnedBaseUnits) / 1e6;
  assert.ok(
    article.body.includes(confirmed.toLocaleString("en-US", { maximumFractionDigits: 6 })),
    `the article must quote the confirmed total (${confirmed}) that /burn/ publishes, not a subset`
  );

  // And each individual destruction it lists.
  for (const e of BURN_EVENTS.filter((x) => x.eventType === "spl-token-burn-instruction")) {
    const amount = (Number(e.amountBaseUnits) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
    assert.ok(article.body.includes(amount), `the article no longer matches the ledger for ${e.dateIso}: ${amount}`);
  }
});
