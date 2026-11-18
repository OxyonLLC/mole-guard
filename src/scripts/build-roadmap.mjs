#!/usr/bin/env node
// Generates the registry-backed cards on src/public/roadmap/index.html.
//
// Content-audit register #22: /roadmap/ shared no data source with the module
// registry, so the page could say something modulesData.js contradicted, and —
// worse, because no test can see it — could stay silent about a module
// entirely. Six live modules went unmentioned that way until 2026-08-12.
//
// Why generate rather than fetch. /modules/ renders client-side from
// /api/modules/status, which is the obvious precedent, but it gives up two
// things /roadmap/ currently has: a crawler sees the whole roadmap today and
// would see an empty one after, and the page keeps working when the backend
// 502s, which it has. Generating at build time keeps the output static HTML and
// still leaves one source of truth. It is the same shape as
// src/scripts/build-sitemap.mjs, whose committed output is likewise generated.
//
// Only the marked regions are rewritten. Everything else on the page —
// Discord Ecosystem, Partner Expansion, the Research cards, Build/Map/Empower —
// is editorial with no registry record, and hand-written HTML is the right home
// for it. Those cards are outside the markers and this script never sees them.
//
// Run: npm run roadmap:build
//
// SAFETY: reads the registry and one HTML file, writes exactly that same file.
// No network, no credentials, nothing outside src/public/roadmap/.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { MODULES, MODULE_STATUSES } from "../mole/modulesData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ROADMAP_PATH = resolve(repoRoot, "src/public/roadmap/index.html");

// Module status → the page's own card status. These seven values are fixed by
// the legend and the filter buttons, and test/mole/roadmapPageRegistry.test.mjs
// fails on a card using anything outside them — so an unmapped status must
// throw here rather than quietly emit one.
const STATUS_TO_CARD = new Map([
  [MODULE_STATUSES.LIVE, "complete"],
  [MODULE_STATUSES.BETA, "progress"],
  [MODULE_STATUSES.PARTIAL, "progress"],
  [MODULE_STATUSES.ONGOING, "progress"],
  [MODULE_STATUSES.PLANNED, "planned"],
  [MODULE_STATUSES.DEFERRED, "deferred"],
  [MODULE_STATUSES.BLOCKED, "progress"],
]);

const CHIP_LABEL = new Map([
  ["complete", "✅ Complete"],
  ["progress", "🚧 In Progress"],
  ["planned", "🗓 Planned"],
  ["deferred", "⏸ Deferred"],
]);

// Which generated region each card status belongs to. The three regions are the
// page's first three sections; "research", "partnership" and "future" cards are
// editorial only and never generated.
const REGION_FOR_CARD_STATUS = new Map([
  ["complete", "completed-modules"],
  ["progress", "current-focus-modules"],
  ["planned", "upcoming-modules"],
  ["deferred", "upcoming-modules"],
]);

export const REGION_IDS = ["completed-modules", "current-focus-modules", "upcoming-modules"];

/** Modules that belong on the public roadmap, in card order. */
export function roadmapModules(modules = MODULES) {
  return modules
    .filter((m) => m.status !== MODULE_STATUSES.INTERNAL && m.status !== MODULE_STATUSES.HISTORICAL)
    .filter((m) => m.publicVisibility !== false)
    .filter((m) => m.roadmapVisible !== false)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderCard(module, counts) {
  const cardStatus = STATUS_TO_CARD.get(module.status);
  if (!cardStatus) {
    throw new Error(
      `${module.id}: status "${module.status}" has no card-status mapping. Add one to ` +
        `STATUS_TO_CARD *and* give /roadmap/ a legend entry and filter button for it, ` +
        `or roadmapPageRegistry.test.mjs will fail on an undefined status.`,
    );
  }

  const chip = CHIP_LABEL.get(cardStatus);
  if (!chip) throw new Error(`no chip label for card status "${cardStatus}"`);

  const heading = (module.roadmapTitle || module.title)
    .replace(/\{live\}/g, String(counts.live))
    .replace(/\{total\}/g, String(counts.total));
  const blurb = module.roadmapBlurb || module.shortDescription;

  const lines = [
    `      <div class="rmCard" data-status="${cardStatus}">`,
    `        <span class="statusChip ${cardStatus}">${chip}</span>`,
    `        <h3>${escapeHtml(heading)}</h3>`,
    `        <p>${escapeHtml(blurb)}</p>`,
  ];
  // Three modules have no route — Mobile App Beta, the Bridge and Platform v2.
  // A card with no link is correct for them; a link to nowhere is not.
  if (module.route) {
    lines.push(
      `        <div class="rmLinks"><a href="${escapeHtml(module.route)}">Open ${escapeHtml(module.title)} →</a></div>`,
    );
  }
  lines.push("      </div>");
  return lines.join("\n");
}

/** { regionId: html } for every generated region. */
export function renderRegions(modules = MODULES) {
  const eligible = roadmapModules(modules);
  const counts = {
    live: modules.filter((m) => m.status === MODULE_STATUSES.LIVE).length,
    total: modules.length,
  };

  const regions = Object.fromEntries(REGION_IDS.map((id) => [id, []]));
  for (const module of eligible) {
    const region = REGION_FOR_CARD_STATUS.get(STATUS_TO_CARD.get(module.status));
    if (!region) throw new Error(`${module.id}: no region for status "${module.status}"`);
    regions[region].push(renderCard(module, counts));
  }
  return Object.fromEntries(Object.entries(regions).map(([id, cards]) => [id, cards.join("\n")]));
}

function markers(regionId) {
  return {
    start: `<!-- roadmap:generated:start ${regionId} -->`,
    end: `<!-- roadmap:generated:end ${regionId} -->`,
  };
}

/** Replace every marked region in `html`. Pure — the test calls this directly. */
export function applyToHtml(html, modules = MODULES) {
  const regions = renderRegions(modules);
  let out = html;

  for (const regionId of REGION_IDS) {
    const { start, end } = markers(regionId);
    const startAt = out.indexOf(start);
    const endAt = out.indexOf(end);
    if (startAt === -1 || endAt === -1) {
      throw new Error(
        `/roadmap/ is missing the "${regionId}" markers. They delimit generated content; ` +
          `without them this script would have to guess which cards it owns.`,
      );
    }
    if (endAt < startAt) throw new Error(`"${regionId}" end marker precedes its start marker`);

    out = out.slice(0, startAt + start.length) + "\n" + regions[regionId] + "\n      " + out.slice(endAt);
  }
  return out;
}

export function buildRoadmap() {
  const current = readFileSync(ROADMAP_PATH, "utf8");
  const next = applyToHtml(current);
  if (next === current) return { changed: false, cards: roadmapModules().length };
  writeFileSync(ROADMAP_PATH, next);
  return { changed: true, cards: roadmapModules().length };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { changed, cards } = buildRoadmap();
  console.log(
    changed
      ? `✅ /roadmap/ rebuilt from the registry — ${cards} module cards.`
      : `✅ /roadmap/ already matches the registry — ${cards} module cards, nothing to write.`,
  );
}
