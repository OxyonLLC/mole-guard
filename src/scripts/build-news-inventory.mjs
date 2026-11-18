#!/usr/bin/env node
// Generates NEWS_INVENTORY.md — the §20 gate before anything is published.
//
// WHY GENERATED, NOT HAND-WRITTEN
//
// The brief asks for "exactly what historical material you discovered". A
// hand-written list is a claim about the repository; a generated one IS the
// repository. Re-run it after adding records and the inventory updates itself,
// which is also what §17 asks for — the system has to keep working after this
// import.
//
// CONFIDENCE IS DERIVED, NEVER GUESSED:
//   high    an on-chain signature, or a decodable X/Discord snowflake
//   medium  a dated record whose evidence is a page or a label
//   low     date inferred, or evidence is a vague string like "April 2025"
//
// Nothing here publishes anything. Every row lands as REVIEW except those the
// evidence makes unambiguous, and the owner decides.
//
// Run: npm run news:inventory

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { BURN_EVENTS, WINLEW_DECIMALS } from "../mole/burnEvents.js";
import { EVENTS } from "../mole/eventsData.js";
import { MODULES, MODULE_STATUSES } from "../mole/modulesData.js";
import { NEWS_ARTICLES } from "../mole/newsData.js";
import { xStatusCreatedAtMs } from "../shared/snowflake.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const INVENTORY_PATH = resolve(repoRoot, "NEWS_INVENTORY.md");

const CONFIDENCE = { HIGH: "high", MEDIUM: "medium", LOW: "low" };

const fmt = (base) => (Number(base) / 10 ** WINLEW_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 6 });
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

/** One candidate row. */
function row({ date, title, category, source, evidence, related = [], confidence, publish, notes }) {
  return { date: date || "UNKNOWN", title, category, source, evidence, related, confidence, publish, notes };
}

const candidates = [];

// ── Burns and supply movements ───────────────────────────────────────────────
// Every one carries a transaction signature, so the DATE is not in question.
// What varies is whether an individual transfer is newsworthy on its own.
for (const e of BURN_EVENTS) {
  const destroyed = e.eventType === "spl-token-burn-instruction";
  const amount = fmt(e.amountBaseUnits);
  // A staging transfer is a step, not a story. Only actual destruction, and
  // unusually large movements, are proposed as articles; the rest are listed so
  // the inventory is complete and the owner can disagree.
  const big = Number(e.amountBaseUnits) >= 10_000_000 * 10 ** WINLEW_DECIMALS;
  candidates.push(
    row({
      date: e.dateIso,
      title: destroyed ? `${amount} WinLEW destroyed` : `${amount} WinLEW — ${e.eventType.replace(/-/g, " ")}`,
      category: destroyed ? "burns" : "supply-locks",
      source: "src/mole/burnEvents.js",
      evidence: e.explorerUrl || (e.signature ? `https://solscan.io/tx/${e.signature}` : ""),
      related: ["/burn/", "/transparency/"],
      confidence: CONFIDENCE.HIGH,
      publish: destroyed || big ? "YES" : "REVIEW",
      notes: destroyed
        ? "Real destruction via the SPL burn instruction — reduces total supply."
        : `Movement, NOT destruction. status=${e.status}.${e.supersededBy ? " Superseded." : ""}`,
    })
  );
}

// ── Events already recorded ──────────────────────────────────────────────────
for (const e of EVENTS) {
  const xEvidence = (e.evidence || []).find((v) => xStatusCreatedAtMs(v.url));
  const derived = xEvidence ? new Date(xStatusCreatedAtMs(xEvidence.url)).toISOString() : null;
  const dated = Boolean(e.startIso);
  candidates.push(
    row({
      date: (e.startIso || "").slice(0, 10) || "UNKNOWN",
      title: e.title,
      category: e.type === "giveaway" ? "community" : "announcements",
      source: "src/mole/eventsData.js",
      evidence: (e.evidence || [])[0]?.url || "",
      related: ["/events/"],
      confidence: xEvidence ? CONFIDENCE.HIGH : dated ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
      publish: e.status === "completed" ? "YES" : "REVIEW",
      notes:
        `status=${e.status}.` +
        (derived ? ` X evidence decodes to ${derived}.` : "") +
        (dated ? "" : " NO DATE — startIso is null, flagged per §6."),
    })
  );
}

// ── Module launches (release milestones) ─────────────────────────────────────
for (const m of MODULES) {
  if (!m.launchDate) continue;
  if (m.publicVisibility === false || m.status === MODULE_STATUSES.INTERNAL) continue;
  // Many launchDates are month-granular placeholders (the 1st). Say so rather
  // than presenting them as the day something shipped.
  const placeholder = /-01$/.test(m.launchDate);
  candidates.push(
    row({
      date: m.launchDate,
      title: `${m.title} goes ${String(m.status).toUpperCase()}`,
      category: "releases",
      source: "src/mole/modulesData.js",
      evidence: m.route || "",
      related: [m.route].filter(Boolean),
      confidence: placeholder ? CONFIDENCE.LOW : CONFIDENCE.MEDIUM,
      publish: "REVIEW",
      notes: placeholder
        ? "launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION."
        : `status=${m.status}.`,
    })
  );
}

// ── Already in the news registry ─────────────────────────────────────────────
for (const a of NEWS_ARTICLES) {
  candidates.push(
    row({
      date: a.date,
      title: a.title,
      category: a.category,
      source: "src/mole/newsData.js",
      evidence: (a.sources || [])[0]?.url || "",
      related: (a.related || []).map((r) => r.path),
      confidence: CONFIDENCE.HIGH,
      publish: a.status === "published" ? "PUBLISHED" : "DRAFT",
      notes: a.status === "published" ? "Live." : "Written, awaiting owner approval.",
    })
  );
}

candidates.sort((a, b) => String(b.date).localeCompare(String(a.date)));

const counts = candidates.reduce((acc, c) => ((acc[c.publish] = (acc[c.publish] || 0) + 1), acc), {});
const byConfidence = candidates.reduce((acc, c) => ((acc[c.confidence] = (acc[c.confidence] || 0) + 1), acc), {});

const md = `# NEWS_INVENTORY.md

> **Generated** by \`npm run news:inventory\` from the repository's own records.
> Do not hand-edit — re-run it instead. Generated ${new Date().toISOString()}.

This is the §20 gate: everything discovered, before anything is published.

**Nothing in this file is live.** \`PUBLISH\` is a recommendation for the owner,
not an action taken.

## Where this came from

The historical document referenced in §1 has not been supplied. §18, however,
asks for the codebase itself to be searched — and it turns out to hold most of
the history already, in structured form with evidence attached:

| Source | Records | Evidence quality |
|---|---|---|
| \`src/mole/burnEvents.js\` | ${BURN_EVENTS.length} | every one carries a transaction signature |
| \`src/mole/eventsData.js\` | ${EVENTS.length} | X links, partner records |
| \`src/mole/modulesData.js\` | ${MODULES.filter((m) => m.launchDate).length} dated | a live route |
| \`src/mole/newsData.js\` | ${NEWS_ARTICLES.length} | already written |

## Totals

- **${candidates.length}** candidates
- By recommendation: ${Object.entries(counts).map(([k, v]) => `**${k}** ${v}`).join(" · ")}
- By confidence: ${Object.entries(byConfidence).map(([k, v]) => `**${k}** ${v}`).join(" · ")}

## How confidence was decided

Derived, never guessed. **high** = an on-chain signature or a decodable
X/Discord snowflake. **medium** = a dated record whose evidence is a page or a
label. **low** = the date is inferred or the evidence is a vague string.

A \`launchDate\` ending in \`-01\` is treated as **low**: those are month-granular
placeholders, and presenting one as the day something shipped would be
inventing precision the record does not have (§6).

## Candidates

| DATE | TITLE | CATEGORY | SOURCE | RELATED | CONF | PUBLISH? | NOTES |
|---|---|---|---|---|---|---|---|
${candidates
  .map(
    (c) =>
      `| ${esc(c.date)} | ${esc(c.title)} | ${esc(c.category)} | ${esc(c.source)} | ${esc(c.related.join(" "))} | ${c.confidence} | **${c.publish}** | ${esc(c.notes)} |`
  )
  .join("\n")}

## Deliberately NOT proposed

- **Ordinary staging transfers.** Most \`burnEvents.js\` rows are movements
  between project wallets, not destruction. They are listed for completeness and
  marked REVIEW; turning each into an article would bury the ${BURN_EVENTS.filter((e) => e.eventType === "spl-token-burn-instruction").length} that
  actually destroyed supply.
- **Anything from \`communityLiquidity.js\`** (62 deposits). Individually they are
  ledger rows, not news. A single article about community-funded liquidity may be
  worth writing; 62 are not.
- **Manufactured history.** §15 of the original brief is explicit, and no article
  has been generated from prose found lying around the repository.

## Known gaps

- The supplied historical document (§1) — Discord and X history that exists
  nowhere in this repository.
- Anything before **2025-02-10**, the earliest date any data module records —
  including the launch itself on **2024-12-07**, evidenced only by the pump.fun
  coin page.
`;

if (process.argv[1] && process.argv[1].endsWith("build-news-inventory.mjs")) {
  writeFileSync(INVENTORY_PATH, md);
  console.log(`NEWS_INVENTORY.md written — ${candidates.length} candidates`);
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
}

export { candidates };
