#!/usr/bin/env node
// Generates the WinLEW News Center from src/mole/newsData.js.
//
//   src/public/news/index.html          the News Center
//   src/public/news/<slug>/index.html   one per PUBLISHED article
//   src/public/index.html               the "Latest from WinLEW" strip, between markers
//
// Same shape as build-roadmap.mjs and build-sitemap.mjs: one data source,
// committed static output. See the header of newsData.js for why News in
// particular cannot be client-rendered — og: tags are read out of raw HTML by
// Discord and X, which do not run JavaScript.
//
// SAFETY: reads the registry, writes only under src/public/news/ plus the
// marked region of src/public/index.html. No network, no credentials.
//
// Run: npm run news:build

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  NEWS_ARTICLES,
  NEWS_CATEGORIES,
  NEWS_HERO_RATIO,
  activeCategories,
  articleNeighbours,
  featuredArticle,
  formatArticleDate,
  publishedArticles,
  readingTimeMinutes,
  relatedArticles,
} from "../mole/newsData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const NEWS_DIR = resolve(repoRoot, "src/public/news");
export const LANDING_PATH = resolve(repoRoot, "src/public/index.html");
const SITE = "https://winlew.co";

/** Escape for HTML text/attribute context. Article bodies are trusted authored
 *  HTML and are NOT escaped; everything interpolated from a field is. */
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function categoryOf(article) {
  const meta = NEWS_CATEGORIES[article.category];
  if (!meta) throw new Error(`unknown_category:${article.category} on "${article.slug}"`);
  return meta;
}

// ── shared shell ─────────────────────────────────────────────────────────────

/**
 * Every generated page carries full per-page metadata. og:image is absolute —
 * a relative one is silently dropped by most crawlers, which is the usual
 * reason a link "shares without a picture".
 */
function head({ title, description, url, image, imageAlt, type = "website", published, jsonLd = null }) {
  const abs = image ? (image.startsWith("http") ? image : SITE + image) : `${SITE}/images/Landing-Page.png`;
  // Structured data is emitted from the SAME fields the visible page and the
  // og: tags use — never a second, hand-written copy that can drift from the
  // article. JSON.stringify handles escaping; the only sequence that can break
  // out of a <script> block is "</" inside a string, so it is neutralised.
  const ld = jsonLd
    ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/<\//g, "<\\/")}</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en" data-api-base="/verify/api-proxy.php">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0,viewport-fit=cover" />
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(abs)}" />
  <meta property="og:site_name" content="WinLEW" />
  ${imageAlt ? `<meta property="og:image:alt" content="${esc(imageAlt)}" />` : ""}
  ${published ? `<meta property="article:published_time" content="${esc(published)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(abs)}" />
  <link rel="icon" type="image/x-icon" href="/images/favicon.ico" />
  <link rel="stylesheet" href="/assets/nav.css" />
  <link rel="stylesheet" href="/assets/premium.css" />${ld}
  <style>
    html { overflow-x: hidden; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(circle at top, #20120c, #130b08 70%);
      color: #f6efe8; margin: 0; padding: 0; line-height: 1.7;
    }
    .wlPageShell { max-width: 1000px; margin: 0 auto; padding: 32px; }
    h1, h2, h3 { color: #e7c18f; margin-bottom: 8px; }
    h1 { font-size: clamp(28px, 5vw, 42px); margin-top: 0; line-height: 1.15; }
    h2 { font-size: clamp(19px, 2.6vw, 24px); margin-top: 28px; }
    a { color: #d6a866; }
    a:hover { text-decoration: underline; }
    .muted { color: rgba(246,239,232,.82); }
    .card {
      background: linear-gradient(180deg, rgba(27,18,14,.94), rgba(19,12,9,.98));
      border: 1px solid #4e3624; border-radius: 20px; padding: 22px; margin: 16px 0;
      box-shadow: 0 18px 54px rgba(0,0,0,.32);
    }
    .newsMeta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12.5px; color: rgba(246,239,232,.75); }
    .catChip {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
      background: rgba(214,168,102,.13); border: 1px solid rgba(214,168,102,.3);
      color: #f0c989; font-size: 12px; font-weight: 800; text-decoration: none;
      text-transform: uppercase; letter-spacing: .04em;
    }
    /* Fixed ratio + object-fit stops the layout shifting as heroes load, and
       stops a tall image being letterboxed into a strip. */
    .heroWrap { border-radius: 16px; overflow: hidden; border: 1px solid #4e3624; background: rgba(255,255,255,.03); }
    .heroWrap img { display: block; width: 100%; aspect-ratio: ${NEWS_HERO_RATIO}; object-fit: cover; }
    .newsGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .newsCard { display: flex; flex-direction: column; gap: 10px; text-decoration: none; color: inherit; }
    .newsCard h3 { margin: 0; font-size: 18px; }
    .newsCard p { margin: 0; font-size: 14px; color: rgba(246,239,232,.8); }
    .readMore { color: #d6a866; font-weight: 800; font-size: 14px; }
    .featured { display: grid; grid-template-columns: 1.15fr .85fr; gap: 22px; align-items: center; }
    @media (max-width: 820px) { .featured { grid-template-columns: 1fr; } }
    .btn {
      display: inline-flex; align-items: center; gap: 8px; padding: 10px 15px; border-radius: 14px;
      background: linear-gradient(90deg, rgba(214,168,102,.20), rgba(125,88,55,.22));
      border: 1px solid #4e3624; font-weight: 850; text-decoration: none; color: inherit; font-size: 14px;
    }
    .btn:hover { text-decoration: none; filter: brightness(1.08); }
    .filterRow { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 18px; }
    .filterChip {
      cursor: pointer; padding: 7px 13px; border-radius: 999px; font-size: 13px;
      background: rgba(255,255,255,.04); border: 1px solid #4e3624; color: #f6efe8;
      font-family: inherit;
    }
    .filterChip.active { background: linear-gradient(90deg, rgba(214,168,102,.22), rgba(125,88,55,.20)); border-color: rgba(214,168,102,.34); }
    .filterChip:focus-visible { outline: 2px solid #d6a866; outline-offset: 2px; }
    /* 68ch keeps article lines in the comfortable reading range instead of
       running the full 1000px shell. */
    .articleBody { max-width: 68ch; }
    .articleBody p, .articleBody li { font-size: 16.5px; }
    .articleBody h2 { margin-top: 30px; }
    .articleBody ul { padding-left: 20px; }
    .articleBody li { margin-bottom: 6px; }
    /* "At a glance" summary block. Its job is to be readable in five seconds
       and to make the CONDITIONAL parts impossible to skim past as committed —
       a reward pool someone believes is guaranteed when it is not is the single
       worst way this page could mislead. Hence .cond, which is styled as a
       caveat rather than as emphasis. */
    .articleBody .glance {
      border: 1px solid rgba(214,168,102,.42);
      background: linear-gradient(180deg, rgba(214,168,102,.10), rgba(125,88,55,.06));
      border-radius: 16px; padding: 18px 20px; margin: 20px 0 26px;
    }
    .articleBody .glanceTitle {
      margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase;
      color: #f0c989;
    }
    .articleBody .glanceList { margin: 0; padding-left: 20px; }
    .articleBody .glanceList li { margin-bottom: 7px; font-size: 15.5px; }
    .articleBody .glanceFoot {
      margin: 12px 0 0; font-size: 13.5px; color: rgba(246,239,232,.72);
      border-top: 1px solid rgba(214,168,102,.22); padding-top: 10px;
    }
    .articleBody .cond { color: #f0b37e; font-style: normal; font-weight: 700; }
    /* ══ MILESTONE ARTICLE COMPONENTS ═════════════════════════════════════
       Built for the GeoWallet × WinLEW record, and reusable: a numbered flow,
       a result readout, a status-keyed grid, a pull quote, a figure with a
       caption, and a code block. All of it plain CSS on top of the existing
       palette — nothing here loads a library or an extra asset. */

    /* Figures: art that carries a caption, not decoration. */
    .articleBody .figure { margin: 22px 0; }
    .articleBody .figure img {
      display: block; width: 100%; height: auto; border-radius: 16px;
      border: 1px solid #4e3624; background: rgba(255,255,255,.03);
    }
    .articleBody .figure figcaption {
      margin-top: 8px; font-size: 13px; color: rgba(246,239,232,.72); line-height: 1.55;
    }

    .articleBody .pullQuote {
      margin: 22px 0; padding: 16px 20px; border-left: 3px solid rgba(214,168,102,.6);
      background: rgba(214,168,102,.07); border-radius: 0 14px 14px 0;
      font-size: clamp(17px, 2.4vw, 21px); font-weight: 700; color: #f0c989; font-style: normal;
    }

    /* The numbered flow. Grid rather than a list so the number column stays
       aligned when a step runs to several lines. */
    .articleBody .flow { margin: 20px 0; display: grid; gap: 10px; }
    .articleBody .flowStep {
      display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start;
      padding: 14px 16px; border-radius: 14px;
      background: linear-gradient(180deg, rgba(27,18,14,.92), rgba(19,12,9,.96));
      border: 1px solid #4e3624;
    }
    .articleBody .flowNum {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 50%; font-size: 13px; font-weight: 900;
      background: rgba(214,168,102,.16); border: 1px solid rgba(214,168,102,.42); color: #f0c989;
    }
    .articleBody .flowStep div { font-size: 15px; }

    .articleBody .codeBlock {
      margin: 16px 0; padding: 16px 18px; border-radius: 14px; overflow-x: auto;
      background: rgba(0,0,0,.34); border: 1px solid #4e3624;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13.5px; line-height: 1.7; color: #f6efe8; white-space: pre;
    }

    /* The verified result, styled as a readout rather than prose. */
    .articleBody .resultCard {
      margin: 20px 0; padding: 18px 20px; border-radius: 16px;
      background: linear-gradient(180deg, rgba(20,44,32,.5), rgba(19,12,9,.96));
      border: 1px solid rgba(85,240,165,.32);
    }
    .articleBody .resultRow {
      display: flex; gap: 10px; align-items: baseline; padding: 5px 0; font-size: 15.5px;
    }
    .articleBody .resultTick { flex: 0 0 auto; }

    /* LIVE vs BUILT vs DIRECTION. Colour is never the only signal — every tile
       carries the word too, which is also what keeps it honest. */
    .articleBody .pieceGrid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px; margin: 20px 0;
    }
    .articleBody .piece {
      display: flex; flex-direction: column; gap: 6px; padding: 15px 16px;
      border-radius: 14px; border: 1px solid #4e3624;
      background: linear-gradient(180deg, rgba(27,18,14,.92), rgba(19,12,9,.96));
      font-size: 14px;
    }
    .articleBody .piece strong { font-size: 15px; color: #e7c18f; }
    .articleBody .piece span:last-child { color: rgba(246,239,232,.78); font-size: 13.5px; line-height: 1.55; }
    .articleBody .pieceBadge {
      align-self: flex-start; font-size: 10.5px; font-weight: 900; letter-spacing: .07em;
      text-transform: uppercase; padding: 3px 9px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.05);
    }
    .articleBody .piece.live { border-color: rgba(85,240,165,.32); }
    .articleBody .piece.live .pieceBadge { color: #8fe3b0; border-color: rgba(85,240,165,.34); background: rgba(61,220,132,.10); }
    .articleBody .piece.built { border-color: rgba(240,179,126,.34); }
    .articleBody .piece.built .pieceBadge { color: #f0b37e; border-color: rgba(240,179,126,.36); background: rgba(240,179,126,.10); }
    .articleBody .piece.future .pieceBadge { color: #86b8ff; border-color: rgba(85,150,240,.34); background: rgba(85,150,240,.10); }

    /* An update note is a correction sitting inside an already-published
       article, and it has to LOOK like one — a reader skimming should be able
       to see that a figure moved after publication rather than discover it
       mid-sentence. Green rather than the page's gold, because this is the
       ledger correcting itself, which is the system working. */
    .articleBody .updateNote {
      border-left: 3px solid rgba(61,220,132,.5);
      background: rgba(61,220,132,.06);
      padding: 12px 14px; border-radius: 0 12px 12px 0; margin: 18px 0;
      font-size: 15.5px;
    }
    .sources { border-left: 3px solid rgba(214,168,102,.5); padding-left: 14px; }
    .sources li { margin-bottom: 8px; }
    /* Long URLs must wrap on a phone rather than push the page sideways. */
    /* Long URLs must wrap on a phone rather than push the page sideways — and
       so must a bare 44-character Solana address in a <code>. That exact case
       has already bitten this project once: an unbreakable token rendered
       451px wide inside a 326px card on /events/ and was CLIPPED, not wrapped
       (2026-08-16). The campaign article prints both the mint and the pool id,
       so the same guard is needed here. */
    .sources a, .articleBody a, .articleBody code { overflow-wrap: anywhere; }
    .prevNext { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
    .prevNext a { max-width: 46%; }
    @media (max-width: 620px) { .prevNext a { max-width: 100%; } }
    .officialBadge {
      display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 800;
      letter-spacing: .05em; text-transform: uppercase; color: #8fe3b0;
      background: rgba(61,220,132,.10); border: 1px solid rgba(61,220,132,.28);
      padding: 5px 11px; border-radius: 999px;
    }
    footer { margin-top: 44px; font-size: 12px; opacity: .75; text-align: center; }
  </style>
</head>
<body>
<div class="nav">
  <div class="navInner">
    <a class="navBrand" href="/">WinLEW</a>
    <div class="navLinks" id="siteNavLinks">
      <!-- Rebuilt by nav.js from NAV_GROUPS on every page. The element must
           stay even though it is empty; nav.js bails out entirely without it. -->
    </div>
    <div class="navRight">
      <a class="pill navProfile" href="/verify/profile.html">📊 Dashboard</a>
      <div class="navBalanceChip" aria-label="Your WinLEW balance"><span class="navBalanceIcon">◎</span><span id="navWalletAmount">—</span><span class="navBalanceTicker">LEW</span></div>
      <button id="navWalletConnect" class="pill" type="button" title="Connect your wallet">Connect wallet</button>
      <button class="navToggle" type="button" aria-expanded="false" aria-controls="siteNavLinks" aria-label="Toggle navigation">☰</button>
    </div>
  </div>
</div>
<div class="wlPageShell">`;
}

const FOOT = `
  <footer>
    <a href="/news/">News</a> · <a href="/">Home</a> · <a href="/home/">Ecosystem Hub</a> · <a href="/transparency/">Transparency</a> · <a href="/policies/">Policies</a>
    <p style="margin-top:10px;">$WinLEW • Utility over hype. Participation becomes proof.</p>
  </footer>
</div>
<script src="/assets/wallet-auth.js"></script>
<script defer src="/assets/nav.js"></script>
</body>
</html>
`;

// ── pieces ───────────────────────────────────────────────────────────────────

function chip(article) {
  const c = categoryOf(article);
  return `<span class="catChip"><span aria-hidden="true">${c.emoji}</span>${esc(c.label)}</span>`;
}

function metaLine(article) {
  const mins = readingTimeMinutes(article.body);
  return `<div class="newsMeta">${chip(article)}<time datetime="${esc(article.date)}">${esc(formatArticleDate(article.date))}</time><span aria-hidden="true">·</span><span>${mins} min read</span></div>`;
}

function hero(article) {
  if (!article.image) return "";
  if (!article.imageAlt) throw new Error(`missing_imageAlt:${article.slug} — an image without alt text fails accessibility`);
  return `<div class="heroWrap"><img src="${esc(article.image)}" alt="${esc(article.imageAlt)}" loading="lazy" /></div>`;
}

function card(article) {
  return `<a class="card newsCard wlLift" href="/news/${esc(article.slug)}/" data-category="${esc(article.category)}">
    ${article.image ? `<div class="heroWrap"><img src="${esc(article.image)}" alt="${esc(article.imageAlt)}" loading="lazy" /></div>` : ""}
    ${metaLine(article)}
    <h3>${esc(article.title)}</h3>
    <p>${esc(article.subtitle)}</p>
    <span class="readMore">Read More →</span>
  </a>`;
}

// ── the index ────────────────────────────────────────────────────────────────

function buildIndex() {
  const published = publishedArticles();
  const feat = featuredArticle();
  // The grid lists EVERY published article, featured one included. This is the
  // archive (brief section 14), and an archive with a hole in it where the
  // current headline used to be is not an archive. It also stops the grid
  // rendering empty while the only published story is the featured one, and
  // keeps the category filter honest — filtering to "Security" should not hide
  // the Security article merely because it happens to be featured today.
  const rest = published;
  const cats = activeCategories();

  const featuredBlock = feat
    ? `<div class="card wlGlow" style="margin-top:18px;">
    <div class="featured">
      <div>
        ${metaLine(feat)}
        <h2 style="margin-top:10px;font-size:clamp(22px,3.4vw,32px);color:#e7c18f;">${esc(feat.title)}</h2>
        <p class="muted">${esc(feat.subtitle)}</p>
        <p><a class="btn" href="/news/${esc(feat.slug)}/">Read Full Story →</a></p>
      </div>
      ${hero(feat)}
    </div>
  </div>`
    : `<div class="card"><p class="muted">No featured story right now.</p></div>`;

  return `${head({
    title: "WinLEW News",
    description:
      "Official updates, releases, security notices, governance results, ecosystem developments and community milestones from WinLEW.",
    url: `${SITE}/news/`,
    image: feat?.image,
    imageAlt: feat?.imageAlt,
  })}
  <span class="officialBadge"><span aria-hidden="true">✅</span>Official WinLEW source</span>
  <h1 style="margin-top:12px;">WinLEW News</h1>
  <p class="muted" style="font-size:18px;max-width:60ch;">What's happening above and below the surface.</p>
  <p class="muted" style="max-width:70ch;">Official updates, releases, security notices, governance results, ecosystem developments and community milestones from WinLEW.</p>
  <p class="muted" style="max-width:70ch;"><em>Social moves fast. The record shouldn't.</em></p>

  ${featuredBlock}

  <h2 id="all-stories">All stories</h2>
  <div class="filterRow" role="group" aria-label="Filter stories by category">
    <button class="filterChip active" type="button" data-filter="all">All</button>
    ${cats.map((c) => `<button class="filterChip" type="button" data-filter="${esc(c.key)}"><span aria-hidden="true">${c.emoji}</span> ${esc(c.label)}</button>`).join("\n    ")}
  </div>
  <div class="newsGrid" id="newsGrid">
    ${rest.length ? rest.map(card).join("\n    ") : '<p class="muted">More stories are on the way.</p>'}
  </div>
  <p class="muted" id="newsEmpty" hidden>No stories in that category yet.</p>
${FOOT.replace(
  "<script defer",
  `<script>
  // Filtering is progressive enhancement: every card is already in the HTML
  // and linked, so the page works with JavaScript off and a crawler sees the
  // whole archive.
  (function () {
    const grid = document.getElementById('newsGrid');
    const empty = document.getElementById('newsEmpty');
    if (!grid) return;
    document.querySelectorAll('.filterChip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const want = btn.dataset.filter;
        document.querySelectorAll('.filterChip').forEach((b) => b.classList.toggle('active', b === btn));
        let shown = 0;
        grid.querySelectorAll('[data-category]').forEach((cardEl) => {
          const show = want === 'all' || cardEl.dataset.category === want;
          cardEl.hidden = !show;
          if (show) shown += 1;
        });
        if (empty) empty.hidden = shown !== 0;
      });
    });
  })();
</script>
<script defer`
)}`;
}

// ── one article ──────────────────────────────────────────────────────────────

function buildArticle(article) {
  const { previous, next } = articleNeighbours(article.slug);
  const related = relatedArticles(article.slug);
  const url = `${SITE}/news/${article.slug}/`;

  const sources = article.sources?.length
    ? `<div class="card">
    <h2 style="margin-top:0;">Verify / Sources</h2>
    <p class="muted" style="font-size:14px;">WinLEW asks people to check its claims rather than trust them. Here is where to check this one.</p>
    <ul class="sources">
      ${article.sources
        .map(
          (s) =>
            `<li><a href="${esc(s.url)}"${s.url.startsWith("http") ? ' target="_blank" rel="noreferrer noopener"' : ""}>${esc(s.label)}${s.url.startsWith("http") ? " ↗" : ""}</a></li>`
        )
        .join("\n      ")}
    </ul>
  </div>`
    : "";

  const relatedPages = article.related?.length
    ? `<div class="card">
    <h2 style="margin-top:0;">Related on WinLEW</h2>
    <ul>${article.related.map((r) => `<li><a href="${esc(r.path)}">${esc(r.label)}</a></li>`).join("")}</ul>
  </div>`
    : "";

  const relatedNews = related.length
    ? `<h2>Related news</h2>
  <div class="newsGrid">
    ${related.map(card).join("\n    ")}
  </div>`
    : "";

  const shareText = encodeURIComponent(`${article.title} — ${article.subtitle}`);
  const shareUrl = encodeURIComponent(url);

  const heroAbs = article.image
    ? (article.image.startsWith("http") ? article.image : SITE + article.image)
    : `${SITE}/images/Landing-Page.png`;

  return `${head({
    title: `${article.title} — WinLEW News`,
    description: article.subtitle,
    url,
    image: article.image,
    imageAlt: article.imageAlt,
    type: "article",
    published: `${article.date}T00:00:00Z`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: article.title,
      description: article.subtitle,
      datePublished: `${article.date}T00:00:00Z`,
      image: [heroAbs],
      articleSection: categoryOf(article).label,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      author: { "@type": "Organization", name: "WinLEW", url: SITE },
      publisher: { "@type": "Organization", name: "WinLEW", url: SITE },
    },
  })}
  <p><a href="/news/">← Back to News</a></p>
  <article>
    ${metaLine(article)}
    <h1 style="margin-top:12px;">${esc(article.title)}</h1>
    <p class="muted" style="font-size:18px;max-width:62ch;">${esc(article.subtitle)}</p>
    ${hero(article)}
    <div class="articleBody">
${article.body.trim()}
    </div>
  </article>

  ${sources}
  ${relatedPages}

  <div class="card">
    <h2 style="margin-top:0;">Share</h2>
    <p>
      <a class="btn" href="https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}" target="_blank" rel="noreferrer noopener">Share on X ↗</a>
      <a class="btn" href="/community/">Discuss on Discord</a>
    </p>
  </div>

  <div class="prevNext">
    ${previous ? `<a class="card" href="/news/${esc(previous.slug)}/" style="flex:1;"><span class="muted" style="font-size:12px;">← Previous</span><br /><strong>${esc(previous.title)}</strong></a>` : "<span></span>"}
    ${next ? `<a class="card" href="/news/${esc(next.slug)}/" style="flex:1;text-align:right;"><span class="muted" style="font-size:12px;">Next →</span><br /><strong>${esc(next.title)}</strong></a>` : "<span></span>"}
  </div>

  ${relatedNews}
  <p style="margin-top:22px;"><a class="btn" href="/news/">← Back to News</a></p>
${FOOT}`;
}

// ── landing-page strip ───────────────────────────────────────────────────────

const LANDING_START = "<!-- NEWS:LATEST:START -->";
const LANDING_END = "<!-- NEWS:LATEST:END -->";

function landingStrip() {
  const latest = publishedArticles().slice(0, 3);
  if (!latest.length) return "";
  return `
  <div class="box wlGlow wlIn" style="margin-top:28px;">
    <h2 style="margin-top:0;">Latest from WinLEW</h2>
    <p class="muted" style="font-size:13px;margin-top:0;">Official updates, kept as a permanent record rather than scrolling away.</p>
    ${latest
      .map((a) => {
        const c = categoryOf(a);
        return `<p style="margin:12px 0;">
      <span class="wlChip" style="font-size:11px;"><span aria-hidden="true">${c.emoji}</span> ${esc(c.label)}</span><br />
      <a href="/news/${esc(a.slug)}/" style="font-weight:800;">${esc(a.title)}</a>
      <span class="muted" style="font-size:12px;"> — ${esc(formatArticleDate(a.date))}</span>
    </p>`;
      })
      .join("\n    ")}
    <p style="margin-bottom:0;"><a class="btn" href="/news/">View All News →</a></p>
  </div>`;
}

function updateLanding() {
  const src = readFileSync(LANDING_PATH, "utf8");
  const startAt = src.indexOf(LANDING_START);
  const endAt = src.indexOf(LANDING_END);
  if (startAt === -1 || endAt === -1) {
    throw new Error(
      `src/public/index.html is missing the ${LANDING_START} / ${LANDING_END} markers. ` +
        "They delimit the generated Latest News strip; without them this script would have to guess where to write."
    );
  }
  if (endAt < startAt) throw new Error("landing news end marker precedes its start marker");
  const next = src.slice(0, startAt + LANDING_START.length) + "\n" + landingStrip() + "\n  " + src.slice(endAt);
  writeFileSync(LANDING_PATH, next);
}

// ── run ──────────────────────────────────────────────────────────────────────

export function buildNews({ write = true } = {}) {
  featuredArticle(); // throws on >1 featured before anything is written

  const published = publishedArticles();
  const publishedSlugs = new Set(published.map((a) => a.slug));

  const drafts = NEWS_ARTICLES.filter((a) => !publishedSlugs.has(a.slug));
  for (const d of drafts) {
    if (publishedSlugs.has(d.slug)) throw new Error(`slug_collision:${d.slug}`);
  }

  const files = [{ path: resolve(NEWS_DIR, "index.html"), html: buildIndex() }];
  for (const a of published) {
    files.push({ path: resolve(NEWS_DIR, a.slug, "index.html"), html: buildArticle(a) });
  }

  if (!write) return files;

  // A slug that leaves the registry (or is set back to draft) must lose its
  // page too — otherwise an unpublished article stays reachable at its old
  // URL, which is precisely what "drafts are not public" has to mean.
  if (existsSync(NEWS_DIR)) {
    for (const entry of readdirSync(NEWS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !publishedSlugs.has(entry.name)) {
        rmSync(resolve(NEWS_DIR, entry.name), { recursive: true, force: true });
        console.log(`  removed stale/unpublished /news/${entry.name}/`);
      }
    }
  }

  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.html);
    console.log(`  wrote ${f.path.replace(repoRoot + "/", "")}`);
  }
  updateLanding();
  console.log(`  updated src/public/index.html (Latest News strip)`);
  console.log(`News build complete: ${published.length} published, ${NEWS_ARTICLES.length - published.length} draft(s) skipped.`);
  return files;
}

if (process.argv[1] && process.argv[1].endsWith("build-news.mjs")) {
  buildNews();
}
