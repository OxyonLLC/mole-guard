# WinLEW Modules & Roadmap Status System

Date: 2026-07-12
Route: `/modules/`
Canonical data: `src/mole/modulesData.js`. API: `GET /api/modules/status` (`src/mole/web.js`). Validator: `src/scripts/validate-modules.js` (`npm run modules:validate`).

## Purpose

Before this system, module/roadmap status was scattered across the homepage, an untracked `/modules/index.html` prototype, and six individually-authored `/modules/*.html` pages — several of which said `WARMING`, `LOCKED`, or `COMING SOON` for systems (Burn Center, Governance, Community Events, Transparency Center) that had since fully shipped. This system replaces all of that with **one validated registry** that every other surface reads from.

## Canonical registry

- **Location**: `src/mole/modulesData.js` — static data only (no live RPC/API/Mongo dependency, no executable functions serialized into records), matching the established pattern of `partnersData.js`/`eventsData.js`/`burnEvents.js`/`governanceData.js`.
- **Format**: a plain `MODULES` array of records, plus a `ROADMAP_PHASES` array mapping every original roadmap phase/item to its real disposition.
- **Versioning**: `getModulesStatusPayload()` stamps every response with a `registryVersion` string (bump it when the record *shape* changes, not on every status edit) and a live `generatedAt` timestamp.
- **Validation**: `validateModulesRegistry(modules, roadmapPhases)` is pure (no I/O) and is run both by the test suite and by `npm run modules:validate` (which additionally checks that every module's `route` and internal `docs[].url` resolve to a real file under `src/public/`).

## Status vocabulary

Exactly ten controlled values (`MODULE_STATUSES` in modulesData.js) — never a vague word like "warming," "soon," "almost," or "in build":

| Status | Meaning |
|---|---|
| `live` | Shipped, working, publicly reachable today. |
| `beta` | Working but not fully validated/rolled out (e.g. Android beta, iOS build-unverified). |
| `partial` | Some real, documented sub-items are done; others aren't — see `limitations` and `progress`. |
| `ongoing` | Not itself a software deliverable — a recurring activity (used at the roadmap-item level; live modules that host ongoing activity instead set `ongoingOperation: true`, see below). |
| `planned` | Named in the roadmap, not started. |
| `deferred` | Named in the roadmap, intentionally not scheduled, no accepted "removed from scope" decision on record. |
| `blocked` | Blocked on an external dependency (e.g. a build environment that doesn't exist yet). |
| `retired` | Was live, deliberately taken down. |
| `historical` | An early concept superseded by real, shipped modules — kept as a record, not an active roadmap item. |
| `internal` | Real and live, but architecture rather than a separately-visitable public destination (no card is rendered for these). |

**Platform availability vs. ongoing activity** — a module's `status` describes the *software*; a separate `ongoingOperation: true` flag marks that the *activity* it enables never reaches "100%" because it recurs. Example: Governance's `status` is `live` (the voting software is fully shipped) and its `ongoingOperation` is `true` (individual proposals/votes are an ongoing program). Never conflate the two — a `live` module with `ongoingOperation: true` is not "incomplete."

## Progress rules

- `progress: 100` for fully shipped modules with nothing left undone.
- `progress: null` (omitted from the rendered card) for anything without a real, checklist-derived number — most `deferred`/`planned`/`beta` modules.
- A non-100 number is only ever used when it's derived from an explicit, documented set of sub-items (see `quests-progression`'s `limitations` field: "2 of 5 documented sub-items complete" → `progress: 40`). Never an arbitrary/vibes-based percentage.

## Roadmap mapping

`ROADMAP_PHASES` is the phase-by-phase reconciliation of the *original* roadmap against what's real today. Each phase has its own `state` (one of `ROADMAP_ITEM_STATES`: `complete` / `live` / `ongoing` / `deferred` / `removed-from-scope` / `not-started`) and a list of `items`, each independently stated and optionally linked to a `moduleId`. **A phase is never flattened to "complete" while any of its items are not** — Phase 5 is deliberately `ongoing`, not `complete`, because Cross-Chain Bridge is `deferred` and Platform v2 enhancements are `not-started`, even though Governance Module v1 within that same phase is fully `complete`.

`Cross-Chain Bridge` is `deferred`, not `removed-from-scope` — that stronger label is only ever used once an accepted Product Lead decision record explicitly says so. None exists as of this writing.

**2026-07-12 product decision, on record**: the Cross-Chain Bridge commitment is explicitly **retained** on the original roadmap — not removed, not abandoned, not complete. `deferred` here means *the roadmap commitment remains accepted but implementation is intentionally postponed* while WinLEW completes and operates its current community, governance, reward, and transparency systems — it does not mean "cancelled" and does not mean "in progress." The registry's `cross-chain-bridge` record carries this explicitly: `retainedOnRoadmap: true`, `implementationState: "not-started"`, `status: "deferred"`, `roadmapPhase: 5`. `validateModulesRegistry()` fails loudly if any of this is ever silently reversed in code (marked `live`/`retired`, deleted from the registry, omitted from the Phase 5 mapping, or its roadmap-item state changed to `complete`/`removed-from-scope`) without a new, separate, explicit decision being recorded — see `test/mole/modulesData.test.mjs`'s dedicated "Cross-Chain Bridge — retained on roadmap, deferred" test block for the full set of tampering scenarios this guards against.

## How to update module status

1. Edit the record in `src/mole/modulesData.js` (or the relevant `ROADMAP_PHASES` item).
2. Update any longer editorial content on that module's own detail page if it has one (registry owns title/status/progress/route/summary/roadmap mapping/last-verified date; **detail pages own their longer prose** — don't hand-duplicate the fields the registry already owns).
3. Run `npm run modules:validate`.
4. **Run `npm run roadmap:build` and commit the result.** `/roadmap/` is a static page whose registry-backed cards are generated from this file (see "Generated output: /roadmap/" below). Skip this and the page keeps describing the previous state; `test/mole/roadmapGenerated.test.mjs` fails until you do.
5. Run the full test suite (`npm test`).
6. Commit and push.

Never hand-edit the same status across multiple HTML files — that's exactly the drift this system exists to prevent.

## Generated output: `/roadmap/`

`src/public/roadmap/index.html` is **partly generated**. `src/scripts/build-roadmap.mjs` (`npm run roadmap:build`) rewrites only the three regions delimited by `<!-- roadmap:generated:start … -->` / `<!-- roadmap:generated:end … -->`; everything outside them is editorial content with no registry record (Discord Ecosystem, Partner Expansion, the Research cards, Build/Map/Empower) and is never touched.

Why generated rather than fetched client-side like `/modules/`: the roadmap stays static HTML, so a crawler sees the whole page and it survives a backend outage. Same shape as `src/scripts/build-sitemap.mjs`.

Three optional per-record fields control it, all documented above the registry in `modulesData.js`:

| Field | Effect |
|---|---|
| `roadmapVisible: false` | Keep a module off `/roadmap/` while leaving it on `/modules/`. Only `shared-navigation` uses it. |
| `roadmapTitle` | Overrides the card heading. Supports `{live}` / `{total}`, filled at build time — this is why the module count on the page cannot go stale. |
| `roadmapBlurb` | Overrides the card body when `shortDescription` is written for `/modules/` and reads wrong elsewhere. |

Modules with `status: internal` or `status: historical` are excluded outright.

Two tests cover it: `roadmapGenerated.test.mjs` fails if the committed page differs from the generator's output, and `roadmapPageRegistry.test.mjs` independently checks the facts a test can compute (module count, Cross-Chain Bridge retention, Phase 4/5 coverage, status-legend validity).

## How to add a module

Add a record to `MODULES` with a unique `id` and (if `status: live`) a unique `route` that resolves to a real file under `src/public/`. Group related functionality into one module rather than one card per internal technical component — e.g. Governance's eligibility-snapshot and submission-queue subsystems are documented inside the single `governance` record's `fullDescription`/`limitations`/`meta` fields, not as separate cards.

## How to retire a module

Set `status: "retired"` (was live, deliberately taken down) or `status: "historical"` (an early concept superseded by something real — see `utility-expansion-legacy`/`community-ops-legacy` for the pattern). Never delete the record outright if real inbound links to its `route` might still exist elsewhere on the site — check with `grep -rn "your-route" src/public/` first, and repoint any real inbound links before removing the module from active navigation.

## How to update a route

Change the `route` field, then `npm run modules:validate` will fail loudly if the new path doesn't resolve to a real file under `src/public/`. Also check for and update any hardcoded inbound links elsewhere (`grep -rn "old-route" src/public/`).

## How to record an accepted scope decision

If a Product Lead / accepted decision formally removes something from WinLEW's scope (e.g. a future Cross-Chain Bridge decision), set that module's `status: "removed-from-scope"` equivalent roadmap-item state to `removed-from-scope` and link the decision record in its `docs` array. Do not use this state speculatively — it is reserved for a real, on-record decision.

## How validation catches drift

`npm run modules:validate` (`src/scripts/validate-modules.js`) fails the process (non-zero exit) when:
- a module id or route is duplicated,
- a status value isn't one of the ten controlled values,
- `progress` is outside 0–100,
- a `live` module has no `route`,
- a `relatedModules` reference points at a nonexistent id,
- a roadmap-phase item references a nonexistent `moduleId`,
- a module's `route` (or an internal `docs[].url`) doesn't resolve to a real file under `src/public/`,
- a `retired`/`historical` module's route collides with a currently-`live` module's route.

`test/mole/modulesData.test.mjs` additionally locks in the specific "current expected truth" facts from this milestone (Governance/PoV/Dashboard/Burn/Events are `live`; Mobile is `beta`; Cross-Chain Bridge and Platform v2 enhancements are never `live`; ongoing programs render as `ongoingOperation`, not as incomplete) so a future edit can't silently regress one of these without a test failing.

## Source-of-truth approach: API, not runtime file rewriting

`/modules/` and its `js/app.js` fetch `GET /api/modules/status` at page-load time and render entirely from that response — the same pattern already used by `/governance/`, `/partners/`, and `/events/`. This was chosen over a purely static JSON file because the backend already has an established, tested pattern for exactly this (`src/mole/web.js`'s other `/api/*/status` routes), and it means the homepage, `/modules/`, and any future consumer all read the exact same computed payload with zero duplication. Nothing in this system rewrites any file at runtime — the registry is only ever edited by a human, in source control, the same way `governanceData.js`/`partnersData.js` already are.

## What must never be duplicated manually

- Status, progress, route, roadmap mapping, and last-verified date — these belong to the registry only. If you find yourself editing the same status string in a second HTML file, stop and fix the registry (and that page's fetch/render logic) instead.
- Detail pages (the individual `/modules/*.html` explainer pages) may freely own their own longer prose, screenshots, and narrative — that content has no equivalent in the registry and isn't duplicated anywhere.

### Detail-page badges — hand-written, but enforced (closed 2026-08-13)

All six `/modules/*.html` detail pages **hardcode their own status badge** and
none of them fetches `/api/modules/status`; only `/modules/index.html` renders
from the registry. That is still true, and it is fine now, because the
duplication is checked by the suite instead of trusted. `validate-modules.js`
still cannot catch it — it validates the registry and never opens these files —
so the check lives in `test/mole/moduleDetailBadges.test.mjs`.

The mapping it enforces (values shown as of 2026-08-13, after the two
corrections noted below):

| page | badge says | registry says |
|---|---|---|
| `core-infrastructure` | `LIVE` | `live` (100) |
| `proof-of-value-engine` | `LIVE` | `live` (100) |
| `quests-progression` | `PARTIAL (40%)` | `partial` (40) |
| `utility-expansion` | `HISTORICAL` | `historical` |
| `community-ops` | `HISTORICAL` | `historical` |
| `games-trivia` | `LIVE` | *(not a module — it is a shared `docs[]` entry on `quiz` and `mole-hub`, both `live`)* |

**Closed 2026-08-13 by enforcement, not by rendering.** The pages still hold
their own badges; `test/mole/moduleDetailBadges.test.mjs` now fails if any of
them disagrees with its registry record — status, the `PARTIAL (n%)` percentage,
and the phase title — and it checks in both directions, so editing the registry
without the page fails just as loudly as editing the page without the registry.
`games-trivia.html` is covered too: it owns no record, so it is checked against
the two modules (`quiz`, `mole-hub`) whose `docs[]` point at it, and the test
fails if those two ever stop agreeing, because then one badge cannot speak for
both.

**Why enforcement rather than option 1 above**, which this document previously
preferred: fetching the badge from the API would make these static pages depend
on the backend being up and would leave a crawler with no status at all. A badge
that renders empty during an outage, or says "loading" forever, is worse than
one that is briefly stale. Build-time generation — the pattern
`src/scripts/build-roadmap.mjs` uses for `/roadmap/` — would get both, and is
the right answer if this duplication ever grows past one status and one phase
per page. For two fields it is heavier machinery than the failure justifies.

**Two real drifts were found the moment the test first ran**, having sat
unnoticed since the pages were written:

- `core-infrastructure` said **`ONLINE`**, which is not one of the ten
  controlled values, in two places on the page. Now `LIVE`. (The `online` CSS
  class is kept — it is presentational, and renaming it would mean editing
  styles to fix a wording bug.)
- `proof-of-value-engine` said **`Phase 2 — Core Infrastructure`**, which was
  never right: Phase 2 is the liquidity pool, the farm, locked supply and the
  website. The registry records the module at Phase 4. Now
  `Phase 4 — Engagement & Mechanism Roll-out`.

You no longer need to grep `src/public/modules/*.html` after editing the
registry — the suite does it.
