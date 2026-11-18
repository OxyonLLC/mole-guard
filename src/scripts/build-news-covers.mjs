#!/usr/bin/env node
// Generates a cover image for every news article that has no artwork.
//
//   npm run news:covers            render only articles with no image
//   npm run news:covers -- --all   re-render every generated cover
//   npm run news:covers -- --check fail if any article would be left coverless
//
// WHY GENERATED PNG AND NOT SVG. og:image is the whole point — Discord and X
// read it out of the raw HTML, and neither renders SVG. A vector cover would
// look perfect on the site and share as a broken preview, which is the exact
// failure /news/ exists to avoid (see the header of newsData.js).
//
// WHY THIS IS A FLOOR, NOT A CEILING. Real artwork always wins. Nothing here
// overwrites a hand-made image: a cover is only produced for an article whose
// `image` is unset, and dropping real art in is a one-line change to
// newsData.js with no code involved. What this guarantees is that an article
// can never ship with NO preview — which is what was happening, and what made
// the index grid ragged where imageless cards sat next to illustrated ones.
//
// Output: src/public/images/news/generated/<slug>.png at 1200x630 (the og
// standard, so nothing is centre-cropped away), committed like every other
// generated artefact in this repo.

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { NEWS_ARTICLES, NEWS_CATEGORIES } from "../mole/newsData.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "src/public/images/news/generated");
const WIDTH = 1200;
const HEIGHT = 630;

/** Per-category accent. Deliberately drawn from the site's own palette rather
 *  than invented: the brand gold is the default, and only categories with a
 *  real conventional colour (fire, alert) deviate. */
const ACCENTS = {
  announcements: "#d6a866",
  development: "#7fb2d9",
  security: "#d98c8c",
  burns: "#e08a4a",
  governance: "#b79ae0",
  ecosystem: "#7fd9b2",
  milestones: "#e0c66a",
};

const args = new Set(process.argv.slice(2));
const renderAll = args.has("--all");
const checkOnly = args.has("--check");

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function page(article) {
  // NO EMOJI ON THE COVER, on purpose. Headless Chromium here ships without an
  // emoji font, so the category glyph renders as a tofu box — and a broken
  // glyph baked into a PNG is permanent, unlike one missing in a browser.
  // newsData.js already settled the principle for exactly this case: "The emoji
  // is decorative — every card also carries the text label, so a platform
  // without the glyph still says what the article is." The label carries it.
  const cat = NEWS_CATEGORIES[article.category] || { label: article.category };
  const accent = ACCENTS[article.category] || "#d6a866";
  // Long headlines step down rather than overflow. Measured against the real
  // titles in the registry, not guessed.
  const title = String(article.title || "");
  const size = title.length > 46 ? 62 : title.length > 30 ? 74 : 86;
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
  *{box-sizing:border-box;margin:0}
  body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial;
    color:#f6efe8;
    background:
      radial-gradient(900px 520px at 88% 8%, ${accent}26, transparent 62%),
      radial-gradient(700px 460px at 6% 96%, ${accent}1a, transparent 60%),
      linear-gradient(160deg,#130b08 0%,#24150d 55%,#130b08 100%);
    position:relative;display:flex;flex-direction:column;justify-content:space-between;
    padding:64px 72px}
  /* A single hairline rule in the accent, echoing the card borders on /news/. */
  .edge{position:absolute;left:0;top:0;bottom:0;width:10px;background:linear-gradient(180deg,${accent},${accent}22)}
  .top{display:flex;align-items:center;gap:18px}
  .pill{display:inline-flex;align-items:center;gap:12px;border:1px solid ${accent}66;
    background:${accent}14;color:${accent};border-radius:999px;padding:12px 26px;
    font-size:23px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
  .date{color:rgba(246,239,232,.62);font-size:23px;font-weight:600}
  h1{font-size:${size}px;line-height:1.08;font-weight:900;letter-spacing:-.02em;max-width:16ch}
  .sub{margin-top:22px;font-size:27px;line-height:1.5;color:rgba(246,239,232,.82);max-width:30ch;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .foot{display:flex;align-items:center;justify-content:space-between}
  .mark{font-size:29px;font-weight:900;letter-spacing:.02em}
  .mark span{color:${accent}}
  .dom{color:rgba(246,239,232,.55);font-size:24px;font-weight:600}
  </style></head><body>
  <div class="edge"></div>
  <div class="top"><div class="pill">${esc(cat.label)}</div><div class="date">${esc(article.date)}</div></div>
  <div>
    <h1>${esc(title)}</h1>
    ${article.subtitle ? `<div class="sub">${esc(article.subtitle)}</div>` : ""}
  </div>
  <div class="foot">
    <div class="mark">Win<span>LEW</span></div>
    <div class="dom">winlew.co/news</div>
  </div>
  </body></html>`;
}

const targets = NEWS_ARTICLES.filter((a) => renderAll || checkOnly || !a.image);

if (checkOnly) {
  const missing = NEWS_ARTICLES.filter((a) => !a.image).map((a) => a.slug);
  if (missing.length) {
    console.error(`Articles with no cover:\n  ${missing.join("\n  ")}`);
    console.error("\nRun: npm run news:covers");
    process.exit(1);
  }
  console.log(`All ${NEWS_ARTICLES.length} articles have a cover.`);
  process.exit(0);
}

if (!targets.length) {
  console.log("Every article already has an image. Nothing to render.");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  const view = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  for (const article of targets) {
    await view.setContent(page(article), { waitUntil: "load" });
    const file = join(OUT_DIR, `${article.slug}.png`);
    const existed = existsSync(file);
    writeFileSync(file, await view.screenshot({ type: "png" }));
    console.log(`  ${existed ? "updated" : "wrote  "} images/news/generated/${article.slug}.png`);
  }
} finally {
  await browser.close();
}

console.log(`\n${targets.length} cover(s) rendered at ${WIDTH}x${HEIGHT}.`);
console.log("Set each article's `image` to /images/news/generated/<slug>.png in newsData.js,");
console.log("then run `npm run news:build`. Replace with real artwork any time — just");
console.log("point `image` somewhere else; nothing here will overwrite it.");
