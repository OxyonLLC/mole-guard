# WinLEW Public Directory — Content & Accuracy Audit

Folder-by-folder audit of `src/public/`. Started 2026-08-03.
Facts are checked against **WINLEW_PUBLIC_FACT_AUDIT.md**, which is the
register every correction must agree with.

**Scope measured at start:** 96 directories, 109 HTML, 84 JS, 16 CSS,
plus 45 root-level files.

**Status: IN PROGRESS.** Folders are logged as completed. Anything not listed
below has not yet been examined and should not be assumed clean.

---

## 🔴 SECURITY ISSUE — PUBLIC EXPOSURE (found first, fixed in repo)

### `src/public/log/x-access_log.2026-02-27`

**A web-server access log was tracked in git and publicly downloadable.**

- `https://winlew.co/log/x-access_log.2026-02-27` → **HTTP 200** (confirmed live 2026-08-03)
- 213 request lines, **46 unique visitor IP addresses**, timestamps, user agents
- No session/token/key parameters present in any request line (checked) — so no
  credential leak, but IP + timestamp + user agent is personal data about
  visitors, published without their knowledge and beyond what any WinLEW privacy
  policy offers.
- Directory listing at `/log/` is 403, so it was not browsable — but the exact
  filename is guessable and it was tracked in the repository, which is how it
  came to be uploaded at all.

**Action taken:** removed from the repository (`git rm`), and
`src/public/log/`, `.tmp-shots/`, `.tmp-audit/` added to `.gitignore` so server
logs and audit artifacts cannot reach the public tree again.

> ⚠️ **STILL LIVE — needs manual deletion on the host.** The site is uploaded by
> hand, so removing the file from git does **not** remove it from winlew.co.
> Delete `/log/` on the web host. Until then those 46 IPs remain downloadable.

### `src/public/.tmp-shots/` — 55 PNGs, 16 MB

Local audit screenshots. **Not** currently reachable (`/.tmp-shots/…` → 404) and
not tracked in git, so nothing is exposed today — but they sit inside the folder
that gets uploaded, so a future "upload the whole folder" would publish 16 MB of
internal screenshots. Now gitignored. Recommend deleting locally.

### `src/public/.tmp-audit/` — empty

Zero files. Now ignored. Safe to delete.

---

## Root-level files — CLASSIFIED (content review pending)

45 files. Initial classification only; individual content review still to come.

| File(s) | Class | Note |
|---|---|---|
| `index.html`, `landing.html` | A — production | landing + redirect |
| `style.css`, `favicon.*`, `apple-touch-icon.png`, `logo-128.png`, `pwa-*.png` | A — production | |
| `manifest.webmanifest`, `sw.js`, `workbox-9c191d2f.js` | A — production | PWA; `workbox-*` is a build artifact but required at runtime |
| `.htaccess` | A — production | server config |
| `_redirects`, `netlify.toml` | **B — inert here** | Netlify-format config; the site is served by openresty, so neither is read. Harmless, but they document routing that may no longer apply — check against `.htaccess` for conflicts. |
| `.htaccess-old` | **F — dead** | superseded; recommend removal after confirming `.htaccess` covers it |
| `game-hub.html`, `gamehub.html`, `gaming-hub.html` | B — compatibility | three root aliases; canonical target to confirm (`/mole-hub/`) |
| `geo-app.html`, `geo-index.html`, `geoagora.html`, `geowallet-*.html`, `GeoWallet.png`, `geowallet-icon.png` | B/D — needs classification | ecosystem/pre-launch pages; check against the lockdown pattern used for `/geoagora/` |
| `discord-bots.html`, `discord-index.html`, `privacy*.html`, `terms*.html` | A — production | legal/bot pages also present under `/discord-bots/` — **duplicate route pair to reconcile** |
| `health.html`, `profile.html`, `verify.html`, `winlew-forge.html` | B — compatibility | folder equivalents exist |
| `bot-links.cjs`, `bot-links.json` | **D — build/dev artifact in a public folder** | not referenced by any page yet checked; if they are build inputs they should not ship. Flagged, not removed. |

---

## Folders audited

### `/burn/` — COMPLETED, no changes required

**Checked:** `index.html`, `js/app.js`, all visible prose, hardcoded numbers,
data source, live API response, metadata.

**Verified end to end.** The page renders from `/api/burn/status` rather than
hardcoded totals, and the live API returns exactly the figures in the ledger:

```
confirmedBurned  49,707,077.187484      (= burnEvents.js summarizeBurnEvents)
target          100,000,000
remaining        50,292,922.812516
percentOfTarget  49.7
```

Page → API → `burnEvents.js` → on-chain signatures all agree. No stale number
was found anywhere on this page.

**The framing is already correct**, and notably survives every trap the audit
brief anticipated:

- August 1 is described as "an annual project benchmark … **not** a guaranteed
  scheduled transaction with a committed amount" — matching `BURN_BENCHMARK`
  verbatim rather than implying a promised burn.
- "Verified burned (destroyed)" is kept distinct from "Awaiting burn (in wallet,
  not yet destroyed)" — the staged-vs-burned distinction that matters most, and
  the one most easily got wrong.
- "the 100M target is a long-term goal, not tokens already set aside anywhere."
- Explicitly disclaims price/market-cap/investment outcomes.
- The API itself carries a `historyNotice` saying historical reconciliation is
  still in progress — honest rather than implying the ledger is complete.

The only literal numbers in the markup are the 100M target (correct), CSS colour
triples, and the 100K/1M/5M *contribute* buttons — not claims.

**Not changed:** nothing. This folder is a good model for the rest of the site —
figures come from one source and the prose states limits rather than hiding them.

**Confidence: HIGH.**

### `/about/` — COMPLETED, 2 changes

**Checked:** `index.html` (single page), metadata, all prose claims, 20 internal
links, purpose overlap with `/who-we-are/`.

**Accuracy: clean.** No stale token, market, burn, supply, roadmap-phase or
date claims — it is a structural orientation page and carries no figures at all,
which is why it has aged well. Nothing contradicted the fact register. All 20
existing links resolved.

**Purpose overlap with `/who-we-are/`: none.** They are already distinct —
`/about/` covers what the platform is and how the surfaces fit; `/who-we-are/`
is described here as "The team, official channels, and every wallet address".
No de-duplication needed.

**Found and fixed:**

1. **The entire "Platform structure" section was unlinked.** All 20 surfaces —
   Mole Hub, Quiz, Faucet, Leaderboards, Events, Verify, Dashboard, Burn Center,
   Transparency Center, Governance, Modules, Roadmap, Discord Bots, WinLEW
   Forge, Whitepaper — were plain `<li>` text. The page explained the platform
   without letting anyone walk into it, and `/leaderboards/` and
   `/winlew-forge/` were named nowhere else on the page, so they were
   unreachable from here entirely. Now linked, styled to inherit the muted list
   colour so the cards look unchanged until hover.
2. **Proof of Value was absent from the page completely** — no mention, no link
   — while `/proof-of-value/` exists and "Proof of Value, not Proof of Wealth"
   is the project's stated identity. Added to TRUST & GOVERN beside Dashboard.
   This is the clearest case on the page of underselling what WinLEW has.

**Deliberately not changed:** metadata. `/about/` has title, description and
og:title/og:description but no canonical and no `og:image`. That is a
**site-wide** inconsistency — only 6 of 40 folder pages set `og:image` — so
fixing one page in isolation would create a new inconsistency rather than
remove one. Logged for a single deliberate metadata pass across the site.

**Confidence: HIGH** (link targets verified to exist; no factual claims altered).

### `/app/` — COMPLETED, 1 change

**Checked:** `index.html` (single page), metadata, all claims, 10 internal
links, hardcoded values, data sources.

Written 2026-08-03 as the mobile app's home, so it is new — but audited by the
same standard as anything older, and it had the classic defect anyway.

**Found and fixed: a hardcoded threshold with a live source.** The page read
"After 10 claims the faucet asks you to verify". The real value is
`FAUCET_VERIFY_AFTER_CLAIMS` (default 10, tunable), so changing the setting
would have left the page confidently stating a number that was no longer true —
exactly the hardcoding this audit exists to catch. `/api/faucet/status` did not
expose it, so the fix was to the source rather than the wording: the endpoint
now returns `faucet.verifyAfterClaims` and the page renders that, falling back
to neutral wording if absent.

**`/faucet/js/app.js:96` carries the identical hardcoded "After 10 claims"** and
will be fixed when `/faucet/` is audited, using the same API field.

**Checked and correct:** the contract address matches the register exactly
(`DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump`), and hardcoding it is right —
a mint cannot change, and `index.html` does the same. All 10 links resolve.
`noindex` is correct for an app-only surface. Cooldown, balance and claim state
all come from the API rather than markup.

**Confidence: HIGH.**

### `.htaccess` — server-level fix for the exposed log

Follow-up to the security finding. The log is **not** the repo's copy: the live
file is 44,265 bytes against the 16 KB that was committed, and carries a
`Last-Modified` from March — the **host writes its own access logs into the web
root and keeps growing them**. Deleting files therefore does not hold; the
server recreates them.

Added `RewriteRule ^log(/|$) - [F,L]`, so the path is refused whatever the
filename and whether or not the file exists. `.htaccess` is confirmed live
(it 403s itself).

> ⚠️ Needs the updated `.htaccess` uploaded to take effect.

### Environment documentation — repo-wide gap

Owner-flagged rule: anything read from `.env` belongs in `.env.example`.
Audited it properly: **144 env vars are read by code, 231 documented, and 44
read-but-undocumented.**

Documented this pass, with defaults verified against `src/faucet/config.js`:
`FAUCET_VERIFY_AFTER_CLAIMS`, `FAUCET_LINKAGE_DISABLED`,
`FAUCET_LINKAGE_MAX_DEPTH`, `FAUCET_WALLET_BANS_COLLECTION`,
`FAUCET_COOLDOWN_HOURS`, `FAUCET_MIN_HOLDER_BALANCE`,
`DISABLE_FAUCET_HOLDER_CHECK`, `FAUCET_DISABLED`, `FAUCET_TREASURY_PUBKEY`,
`MOLE_NATIVE_HANDOFFS_COLLECTION`.

The remaining ~34 are mostly quiz payout tuning, Mongo collection overrides and
two OS variables (`HOME`, `USERPROFILE`) that are not configuration at all.
Left for a deliberate pass rather than guessing at semantics for settings I have
not read — a wrong description in an example file is worse than an absent one.

### `/assets/` — COMPLETED, 0 changes (flagged for owner decision)

Treated with extra care: `nav.js`, `nav.css` and `wallet-auth.js` are loaded by
all 109 pages, so a change here is a change everywhere.

**Shared site code is healthy.**

- `nav.js` — **39 nav destinations, 0 broken.** The site footer is generated
  from the same `NAV_GROUPS` list that builds the header, so header and footer
  cannot drift apart by construction. Only one external URL in the whole file,
  `https://cryptospades.netlify.app/` — verified live (HTTP 200).
- `nav.css`, `premium.css`, `wallet-auth.js` — no stale facts, no hardcoded
  project figures, no dead links.

**Finding: ~2.2 MB of dead build artifacts, publicly served.**

`/assets/` holds two overlapping generations of a **GeoWallet/GeoAgora app
build** — all stamped the same build minute (11 Jul 12:24) — sitting alongside
WinLEW's own shared code. Three files are referenced by **nothing anywhere in
the tree**, and all three are live:

| File | Size | Referenced by | Live |
|---|---|---|---|
| `index-cxcgskas.js` | 2,152,297 B | nothing | HTTP 200 |
| `index-dfu8kp_-.css` | 60,790 B | nothing | HTTP 200 |
| `ccip-b5fpycqk.js` | 2,889 B | nothing | HTTP 200 |

For contrast, the *live* generation is `index-BR4urr-Y.js` + `index-CTXMJTPO.css`
+ `ccip-cKDehk5Q.js`, referenced by `geo-app.html` and precached by the root
`sw.js`; a third set (`index-BDK3NTMu.js`, `ccip-rkgCz1kb.js`) is reachable only
from `wallet/sw.js` and from inside other bundles. So there are three
generations where one is needed.

**Deliberately NOT deleted.** Zero references is strong evidence, but these are
another application's build output and `/wallet/` and `/geoagora/` are
intentionally pre-launch. Deleting a bundle an unlaunched deployment turns out
to need would be a worse outcome than 2.2 MB of waste, and the brief is explicit
about classifying before removing. **Recommended owner action:** confirm the
GeoWallet build generation in use, then remove the other two generations from
both `/assets/` and `/wallet/assets/`, and re-generate `sw.js` precache lists so
the service worker stops caching files that no longer exist.

**Also noted:** mixing another project's hashed build output into the shared
`/assets/` folder is what made this hard to see. Ecosystem app bundles would be
safer under their own path (`/wallet/assets/` already exists) so WinLEW's shared
code is not sitting in the same directory as three copies of someone else's
2 MB bundle.

**Confidence: HIGH** on the dead-file evidence; the recommendation is deliberately
left as a decision rather than an action.

### `/bounties/` — COMPLETED, no changes required

**Checked:** `index.html`, `js/app.js`, prose claims, hardcoded figures, the
live API, 17 internal links, the outbound reporting path, and one cross-page
claim.

**Renders from `/api/bounties/status`** — there is not a single hardcoded ledger
figure in the markup. Live API at time of audit:

```
bountyCount 2 · paid 2 · pending 0 · paid total 2,000,000 WinLEW
```

**Cross-page claim verified.** The page says bounties are "Paid from the
Developer Reserve". *Developer Reserve* is a real named component in
`TRANSPARENCY_COMPONENTS` (`src/mole/web.js:3354`), so `/bounties/` and
`/transparency/` agree rather than inventing a wallet label.

**Link chain followed to its end.** The primary call to action links to
`/community/` rather than hardcoding an invite — the right choice, since
invites expire — and `/community/` carries `https://discord.gg/dJ7rPhy333`,
which returns **301**, Discord's redirect for a live invite (an expired one
404s). So "report it on Discord" actually lands somewhere. 17 internal links,
0 broken.

**Wording is careful in the way this audit is looking for.** With zero pending
rows the obvious misreading is "the programme is over", and the page pre-empts
exactly that: *"A ledger with zero pending rows means everything owed has been
paid — not that reporting is closed."* It also refuses to flip a row to Paid
before the transaction exists, and discloses that one bounty-worthy bug was
fixed before anyone could report it, so it has no ledger row. That is a
disclosure most projects would simply omit.

**Not changed:** nothing. Along with `/burn/`, this is the pattern the rest of
the site should be measured against — one dynamic source, no hardcoded numbers,
and prose that states the limits of what the page shows.

**Confidence: HIGH.**

### `/community/` — COMPLETED, 1 change

**Checked:** `index.html` (single static page), title, prose, 5 internal links,
the one external link, navigation, and overlap with `/links/` and
`/who-we-are/`.

**Accuracy: clean.** No figures, dates, token or market claims at all. Its one
external link — `https://discord.gg/dJ7rPhy333` — returns 301, Discord's
redirect for a live invite.

**Its purpose is deliberate and worth preserving.** This is not a channel
directory; it is a *stability* page: "the stable site-side entry point … If the
direct Discord invite rotates, this route stays valid and still gives people a
working path into WinLEW." That is why it carries a single external link and
does not duplicate `/links/`. Good design — an invite that expires cannot orphan
inbound links to this route.

**Found and fixed: it loaded `nav.css` but not `nav.js`.** So it had the site's
styling and none of its navigation — no header, no footer, no site map. A page
whose stated job is to be a working path into WinLEW was offering exactly four
links and no way to reach anything else. Adding the shared script gives it the
site footer; the page has no `.nav` markup and `nav.js` tolerates that
(`querySelectorAll('.nav')` iterates nothing, `setNavHeight` guards), so it gains
the footer without an imposed header.

**Site-wide check this prompted.** 11 of 40 folder index pages do not load
`nav.js`. Classifying them by size and content, **8 are redirect stubs** where
that is correct (`/profile/`, `/sponsors/`, `/game-hub/`, `/gamehub/`,
`/gaming-hub/`, `/geoagora/`, `/geohackers/`, `/images/` — all 241-1,726 bytes),
and of the 3 real pages, `/jdid93hf8dh/` is deliberately standalone and
`/wallet/` is the GeoWallet app (a separate application with its own shell —
and **live**, not pre-launch as this log first assumed; corrected during
`/ecosystem/`). `/community/` was the only genuine omission. **Navigation coverage is otherwise consistent.**

**Noted for their own turns:** `/sponsors/` is a 455-byte redirect stub while
`/partners/` is the real page — the canonical/alias relationship needs
confirming. `/profile/` is a 1,726-byte stub alongside `/verify/profile.html`.

**Confidence: HIGH.**

### `/contribute/` — COMPLETED, 1 correction

**Checked:** `index.html`, `js/app.js`, every hardcoded Solana address, the
governance pricing claims, prose, 10 internal links, data sources.

**Address safety — all five verified, none mislabelled.** This is the check
where a mistake would be most costly, so each address was matched to its
canonical definition in `src/mole/contributions.js`:

| Address | Page label | Canonical | |
|---|---|---|---|
| `D6d5byBx…` | `dev.winlew.sol` | Developer Reserve | ✓ |
| `EX5nxVKg…` | `burn.winlew.sol` | Burn Wallet | ✓ |
| `FcEtZqVo…` | `diglew.sol` | Discord & Web Faucet Reserve | ✓ |
| `GFxz42bi…` | `winlew.sol` | X Faucet Reserve / Governance Vote Fund | ✓ |
| `5nTz6Cq7…` | Raydium `pool_id` | `SOLSCAN_RAYDIUM_ID` | ✓ |

The page labels wallets by SNS domain and every one maps to the right reserve.
`GFxz42bi…` legitimately serves two causes in the canonical data.

**Governance pricing claims — verified exactly.** "roughly \$1 per additional
vote, capped at 10 per proposal, priced off a 3-day average" matches
`USD_PER_VOTE = 1`, `MAX_PURCHASED_VOTES_PER_PROPOSAL = 10` and
`SAMPLE_WINDOW_MS = 3 days` in `governancePricing.js`. Nothing overstated.

**Found and corrected — a real cross-page contradiction.** The Burn cause card
read **"Permanently removed from supply."** Contributing there does not remove
anything from supply: it *stages* tokens in the burn wallet, and destruction is
a separate `spl-token` burn transaction. This contradicted:

- `/burn/`, which is careful to separate "Verified burned (destroyed)" from
  "Awaiting burn (in wallet, not yet destroyed)";
- `burnEvents.js`, whose `TRANSFERRED_TO_BURN_WALLET` status exists precisely to
  mark staged-not-destroyed, and whose own notes say buying or transferring
  tokens is not destroying them.

Now reads **"Sent to the burn wallet, then destroyed in a recorded burn."** —
two steps, which is what actually happens. This is the first genuine factual
inaccuracy the audit has found on any page.

**Confidence: HIGH** — contradicted by the project's own burn ledger semantics.

### `/discord-bots/` — COMPLETED, no changes required

**Checked:** `index.html`, `js/app.js`, all 12 internal links, the 10 root-level
redirect twins, `Main-home.htm`, the five Terms/Privacy pairs, and the live
service-status API.

**The duplicate-route question resolves cleanly.** All ten root-level twins
(`privacy.html`, `terms.html`, `privacy-mole.html`, `terms-mole.html`,
`privacy-utility.html`, `terms-utility.html`, `privacy-watchdog.html`,
`terms-watchdog.html`, `discord-bots.html`, `discord-index.html`) are
277–635-byte **redirect stubs**, each pointing at its correct
`/discord-bots/…` equivalent. No duplicated legal text exists anywhere —
`/discord-bots/` is canonical and the root files are a compatibility layer
doing exactly their job. **Class B — keep.**

`Main-home.htm` is the same thing: a 549-byte redirect to `/discord-bots/`,
referenced by nothing internally and live (HTTP 200). The filename looks like a
legacy site-builder export, so it exists for old external links and bookmarks.
**Class B — keep**, and recorded here so it is not mistaken for junk later.

**Bot inventory matches reality.** Five bots claimed — The Mole Guard, WinLEW
Utility Bot, WinLEW Watch Dog, GeoHackers, GeoAgora — and the folder carries
exactly five Terms/Privacy pairs plus the general set. No retired functionality
is advertised.

**Live status is honest, which is the notable part.** `/api/discord-bots/status`
reported at audit time: `watchdog` reachable, **`geohackers` unreachable**,
**`geoagora` unreachable**. The page renders that faithfully — "🔴 Service
unreachable", never a green light it cannot justify — and the rendering code
only ever says *reachable*, never *bot online*, with a tooltip explaining it
checks the service's port rather than the Discord connection. The API's own note
goes further: the Mole Guard and Utility Bot are *"intentionally absent — there
is nothing honest to check for them today"* rather than being given a fabricated
indicator.

That is the third page (with `/burn/` and `/bounties/`) that states the limits
of its own evidence instead of implying more than it knows.

**Operational note, not a content defect:** GeoHackers and GeoAgora services
were unreachable when checked. The page is correct to show it; whether those
services *should* be up is an infrastructure question for the owner.

12 internal links, 0 broken. No external links at all.

**Confidence: HIGH.**

### `/ecosystem/` — COMPLETED, no changes required

**Checked:** all seven project pages, status/relationship language on each, XYO
partnership claims, the one "live" claim, internal links, and whether
`/ecosystem/` itself resolves.

**This folder passes the audit's hardest test.** The brief's biggest stated risk
was overstating relationships — turning "working toward XYO/XL1" into "official
XYO partner". A search across all seven pages for *official XYO*, *XYO partner*,
*partnership with*, *endorsed by* returns **nothing**. No endorsement is claimed
anywhere.

**Status language is precise and differentiated**, not boilerplate:

| Project | Status shown |
|---|---|
| GeoAgora, GeoHackers, GeoJustice, GeoPresence, GeoProof, uBlock | "Beyond WinLEW · **Not public yet**", titled "(Coming Soon)" |
| GeoWallet | "Beyond WinLEW · **Beta · Live today**" |

Six say plainly they are not public. The seventh claims to be live — **and it
is**: its "Launch GeoWallet (Beta)" button goes to `/wallet/`, which returns
HTTP 200 and serves a real GeoWallet application page. The one status claim that
could have been an overstatement is verified true.

The relationship wording is careful too — GeoWallet is "built by the same team
behind WinLEW" (a factual statement of authorship, not a partnership), and
GeoProof describes itself as "a protocol, not an app". GeoJustice even states
what it deliberately is *not*.

**Correction to this log:** earlier entries described `/wallet/` as "the
pre-launch GeoWallet area". That was wrong — it is live and indexable. Fixed
above.

**Minor, flagged not fixed:** there is no `/ecosystem/index.html`, so
`/ecosystem/` returns 403. Nothing links there — every project is reached
directly from elsewhere — so no link is broken, but a visitor who trims the URL
dead-ends. An index listing the seven would be an improvement; it is a new page
rather than a correction, so it is left as a recommendation.

**Confidence: HIGH.**

### `/events/` — COMPLETED, no changes required

**Checked:** `index.html`, `js/app.js`, the live `/api/events/status` feed, all
four event groups, hardcoded dates, 17 internal links, and cross-consistency
with the partner records.

**No hardcoded user-facing dates.** The two `2026-07-1x` strings in the markup
are **CSS comments** recording when a layout bug was found — not content. Every
event comes from the API.

Live feed at audit: **upcoming 2, live 0, completed 3, cancelled/postponed 0.**
The two completed Raydium liquidity farms (2025-03-10, 2025-06-16) are correctly
filed as *completed* rather than lingering as if current — which matters, since
stale farm/liquidity references were one of the brief's specific concerns.

**Partnership language cross-checked and correct.** The completed "2BRZ / 2
Brotherz Community Partnership Announcement" describes a "community
collaboration" and defers to "the linked partner record for the full
evidence/claims boundary". The canonical record in `partnersData.js` backs that
up precisely:

```
status: status-unconfirmed
type:   community-partner
claim:  "...announced publicly on X in April 2025. Public language at the
         time described shared goals, mutual support, and community
         alignment..."
```

It is labelled **unconfirmed**, typed as *community-partner* rather than
"partner", and reports what the announcement said instead of asserting an
agreement exists. Event page and partner data agree. This is the second-hardest
item in the brief (after the XYO one) and it is handled correctly.

17 internal links, 0 broken.

**One item for the owner — disclosed, not wrong.** The upcoming "500-Follower
Giveaway" description reads: *"As of this writing (2026-07-17), the account has
66 followers — independently confirmed by fetching the account's live profile
page."* That is the **correct** pattern per the brief: a snapshot that dates
itself rather than posing as live. But it is now ~3 weeks old and the giveaway
triggers at 500 followers, so the figure is worth refreshing in
`src/mole/eventsData.js`. Not changed here — I cannot verify the current
follower count from this environment, and replacing a dated, sourced figure with
an unverified one would make it worse.

**Confidence: HIGH** on everything checked; the follower figure is flagged as
owner-refreshable rather than incorrect.

---

### 11. `/faucet/` — 4 fixes (1 factual error, 1 lost proof, 2 hardcodes)

`index.html`, `js/app.js`, `css/faucet.css`, 2 assets. 8 internal links, 0 broken.
`og:image` resolves. Distribution stats correctly separate the on-chain lifetime
total from the platform-recorded subset, and the comment explaining why the
larger number leads is worth keeping.

**Fix 1 — a removed capability was still advertised as a feature.** The page read:

> 💡 Discord gives you more precise control — `!faucet <wallet-or-domain>` lets
> you claim to a specific wallet or .sol domain directly, instead of always using
> your linked wallet.

That is exactly what **v3.3.5 deliberately removed** (`src/faucet/service.js:45-88`,
2026-08-02): a claim may now only target the wallet the account has already
registered, else `wallet_not_registered`. So the page was advertising the abuse
vector the release closed. Replaced with the rule that actually applies — the
faucet pays your registered wallet and only that wallet; change it with
`!register` first.

**Fix 2 — the website could report a payout without showing the transaction.**
`POST /api/faucet/claim` returned `{id, status, amount}` with **no signature**,
while the `GET` poll route returns `signature` + `explorerUrl`. The page's
`status === 'confirmed'` branch therefore rendered a bare "✅ Confirmed!" with
nothing to click. Same class as the `!drip` proof regression.

Scope, stated precisely: a *fresh* web claim returns `pending` and is paid by
the separate worker (`service.js:176`), so it reaches confirmation through the
poll path, which already linked the transaction. The gap is the **idempotent
replay** path (`service.js:137`) — a retried `requestId` returns the original
claim, which may already be confirmed and carry a signature. That is the case
that showed success with no proof. Both routes now return the proof fields, and
the `reconciling` refusal passes its signature through as well (currently a
Discord-path reason, handled here because both interfaces share this service and
the reason means the transfer *did* reach the network).

**Fix 3 — the queued "After 10 claims" hardcode**, carried over from `/app/`.
`REASON_COPY` entries now take the status payload and read
`faucet.verifyAfterClaims`; the gate threshold is no longer written in the page.

**Fix 4 — claim failures rendered raw reason codes.** `submitClaim()` printed
`data.reason` verbatim, but the claim endpoint returns **eligibility reasons too**
(`service.js:101,107`) — so a gate tripping between page load and clicking Claim
surfaced as `❌ verification_required`. This is the "bare reason code" problem the
file's own comment says was fixed for the eligibility path. Both paths now share
`REASON_COPY`, extended to cover the claim-only reasons.

**Also: the page never stated its own rules to a signed-out visitor.** Amount,
cooldown and the verification gate all rendered as em-dashes until you connected
a wallet — shown only to people who already knew them, and the gate appeared
only *after* it had blocked someone. `/api/faucet/global-stats` (public, no
session) now carries a `rules` block of pure server config, and the page renders
the amount, cooldown and a verification notice from it. The notice hides itself
when the gate is disabled rather than describing a rule the server is not
enforcing.

Two alt attributes also corrected: one hardcoded "every 24 hours" (the cooldown
is `FAUCET_COOLDOWN_HOURS`), and the page-header banner said "keep the streak
alive" — streaks are a quiz mechanic, not a faucet one.

Verified accurate and unchanged: holder-only gating, the shared Discord/website
cooldown (stated three times, correctly each time), `!drip`/`!faucet`/
`!faucetstatus` all real commands, claim-history wording, and the meta
description. `REASON_COPY` covers all 11 `ELIGIBILITY_REASONS`.

**Confidence: HIGH** — every rule checked against `src/faucet/config.js`,
`eligibility.js` and `service.js`.

---

### 12. `/game-hub/` + `/gamehub/` + `/gaming-hub/` — duplicate routes RESOLVED

Audited together because they are the same artifact. **`/mole-hub/` is confirmed
canonical** and this closes the open question carried since the route inventory.

All six files — three directories and three root `.html` twins — were
**byte-identical JS redirect stubs** pointing at `/mole-hub/`. Nothing else lives
in them; `/game-hub/` has no content of its own to audit. The substantive games
content is `/mole-hub/` (26 MB), audited separately.

Evidence for canonical status: `nav.js` links `/mole-hub/` in all 5 nav groups
that reference games, and a repo-wide search found **zero** internal references
to any of the three older names. They exist solely for old bookmarks and
external posts — a legitimate reason to keep them, so none were removed.

**Three problems, all fixed:**

1. **Only `gaming-hub` had a server-side rule.** `.htaccess` redirected it, but
   `/game-hub/` and `/gamehub/` redirected *purely in JavaScript* — slower, and
   nothing at all without JS. Added matching rules so all three behave
   identically and redirect before any HTML is served. The stubs remain as the
   fallback for a host without `mod_rewrite`.
2. **Nothing marked them `noindex`.** Three duplicate routes serving the same
   destination, free to compete with `/mole-hub/` in search results. All six now
   carry `<meta name="robots" content="noindex,follow">` — don't index the stub,
   do follow it through to the real page, which is the correct directive for a
   redirect stub and better here than a canonical tag.
3. `gaming-hub.html` used CRLF while the other five used LF. Cosmetic only;
   normalised so the six stay byte-identical, since they are maintained as one
   thing and any drift between them is a bug.

**Deliberately NOT changed — flagged for the owner.** Every redirect in
`.htaccess` is a **302 (temporary)**, including permanently retired routes like
`/treasury/` → `/transparency/`. For a permanent retirement, **301** is the
correct status and is what consolidates search ranking onto the destination; a
302 tells search engines to keep the old URL indexed. I did not change these:
301s are cached hard by browsers and are painful to reverse, so it is the
owner's call, not an audit fix.

**Site-wide finding while here: there is no `sitemap.xml` and no `robots.txt`
anywhere in `src/public/`.** Neither is required, but with 57 index pages and
now-`noindex`ed duplicates, a sitemap is the normal way to tell search engines
which routes are real. Logged for the final repo-wide pass.

**Confidence: HIGH** — canonical status verified against `nav.js` and a
repo-wide reference search, not inferred.

---

### Skipped by owner decision: `/geoagora/`, `/geohackers/`

Owner, 2026-08-04: these forward to **separate projects built on different
dapps**. They are not WinLEW content and are out of scope for this audit. The
July 2026 pre-launch lockdown pattern (`index.html` → `home.html` + redirect)
still applies to them and is unchanged.

---

### 13. `/governance/` — 3 fixes, 1 serious finding for the owner

`index.html`, `submit/index.html`, `proposal/index.html` + 3 JS files + 2 assets.
**Zero broken internal links** (21 targets; both in-page anchors exist,
`/linked-role/mole` is a real Express route at `web.js:2098`).

This is the best-written content audited so far. The execution-boundary language
is careful and repeated in every place it matters — a vote "does not itself move
treasury funds, execute a token burn, or trigger any on-chain transaction",
passed votes go to maintainer review, and the submit page states plainly that
"submitting is not publishing". None of it overstates what governance does.

**Every hardcoded number on the submit page verifies exactly:**

| Page claim | Source | ✓ |
|---|---|---|
| 5 max open drafts | `MAX_OPEN_SUBMISSIONS_PER_USER = 5` | ✓ |
| 24h duplicate-title window | `DUPLICATE_TITLE_WINDOW_MS = 24*60*60*1000` | ✓ |
| 14 categories | `PROPOSAL_CATEGORIES` — exactly 14 keys | ✓ |
| 4 governance modes | `GOVERNANCE_MODES` — exactly 4 keys | ✓ |

Vote-privacy wording also verified against `docs/governance-v1.md`: individual
choice is `private-until-never`, aggregates are public. The 5-voter seal recorded
in project memory applies to the **governance leaderboard**
(`GOVERNANCE_LEADERBOARD_MIN_VOTERS || 5`, `web.js:3995`), not proposal results,
so the page's "only the aggregate result is ever shown publicly" is correct as
written. That env var is already documented in the root `.env.example`.

**Fix 1 — a link whose text disagreed with its destination.** The execution-
boundaries paragraph read "See `docs/governance-v1.md` for the full rules" while
its `href` was `/governance/#rules` — a same-page anchor. Relabelled to
"Rules & documentation below", which is where it actually goes.

**Fix 2/3 — governance was invisible on Discord.** `/mole proposals|vote|myvote|
votes|propose` shipped 2026-07-31, but no governance page mentioned any of them:
the entire Discord voting flow was discoverable only by finding the commands
yourself. Added a "Prefer Discord?" section to `/governance/` listing all five
(each verified against `src/mole/commands.js`), and a matching note on
`/governance/submit/` for `/mole propose`, which lands in the same review queue.

While adding those: `.actions` and `.fine` are **not defined** for these pages —
they come from `mole-hub/css/styles.css`, which governance does not load (it
loads `nav.css` + `premium.css` only). Used the pages' own `.ctaRow` /
`.disclaimer` instead. Noted separately: `.ctaRow` is undefined in every
stylesheet yet used on both pages already; harmless today because the inline
`margin-top` does the visible work, but its `justify-content` does nothing on a
non-flex block.

#### 🔴 The serious one: public pages link into a PRIVATE GitHub repo

`github.com/LewSales/mole-gaurd` is **private** (`gh repo view` →
`"visibility":"PRIVATE"`), so every link to it **404s for every visitor**. The
repo name's "gaurd" spelling is not a typo in the links — that genuinely is the
repo name, so the URLs are right and the visibility is the problem.

Worst case is here in `/governance/`: the **entire "Rules & documentation"
section contains nothing but those two dead links**, and the execution-boundary
paragraph points readers to it. A governance page whose credibility rests on
published, checkable rules currently offers no way to read them.

Full blast radius — **6 dead links across 5 pages in 3 folders**:

| Page | Link | Repo |
|---|---|---|
| `governance/index.html:315` | `docs/governance-v1.md` | mole-gaurd (private) |
| `governance/index.html:315` | `docs/governance-proposal-template.md` | mole-gaurd (private) |
| `modules/index.html:200` | `docs/modules-system.md` | mole-gaurd (private) |
| `modules/index.html:260` | `docs/modules-system.md` | mole-gaurd (private) |
| `wallet/privacy/index.html:54` | `GeoWallet/issues` | GeoWallet (private) |
| `wallet/support/index.html:47` | `GeoWallet/issues` | GeoWallet (private) |
| `wallet/support/privacy.html:108` | `GeoWallet/issues` | GeoWallet (private) |

(`who-we-are/index.html:296` → `LewSales/Discord-Bot` is **public** and fine.)

The `wallet/support` ones are their own problem: a support page and a privacy
policy both send users to a 404 to report issues, so the documented support
channel does not exist for anyone outside the org.

**Not fixed here, deliberately.** The correct fix is to publish the docs, and
that is the owner's call — I will not create new public surface or delete an
owner's intentional reference on my own judgement. Two facts to decide with:

1. `docs/governance-v1.md` (167 lines) **reads as finished public policy** —
   Purpose, Scope, Eligibility, Voting method, Vote privacy, Quorum, Execution
   boundaries. It contains no secrets; the only three matches for
   key/seed/password patterns are policy *statements about* private keys ("no
   private key handling exists anywhere in Governance v1"). It is written to be
   published.
2. One thing to scrub first: line 119 refers to "the sprint report" and
   "Remaining Gaps", pointing at an internal artifact that is not public.

Options, cheapest first: serve the two docs from `src/public/governance/`; or
revive the parked public-snapshot repo; or, if neither, remove the links rather
than leave known-404s on a governance page. **I recommend the first** — it is
self-contained, needs no repo restructuring, and puts the rules on the same
origin as the page that cites them.

#### ✅ RESOLVED for `/governance/` — owner chose to serve the docs (2026-08-04)

Two new pages, linked from the "Rules & documentation" section in place of the
dead GitHub links:

- **`/governance/rules/`** — all 22 sections of `docs/governance-v1.md`, with a
  contents index. Purpose, Scope, Eligibility, Voting method, Snapshot rule,
  Lifecycle, Categories, Modes, Vote privacy, Vote-change, Quorum, Approval
  threshold, Anti-abuse (as a table), Publishing, Burn handling, Feature
  handling, Ratification, Emergency boundaries, Execution boundaries, Archive,
  Security model, the 2026-07-17 hardening review, and Known limitations.
- **`/governance/proposal-template/`** — the full proposal record and the extra
  `burnDetails` block required for burn proposals.

**Nothing was softened.** The hardening review's "Not fixed, deliberately"
finding is published in full, including that a wallet could in principle be
funded at a snapshot boundary and drained afterward, and that raising the
minimum to 1,000,000 WinLEW *raises the cost of that without closing it*. The
structural admission that wallet-based one-vote cannot stop one person running
multiple funded wallets, with no KYC planned, is published too. The source doc
already said both belonged on the public page.

**What changed in adaptation, and why.** References to documents that are *not*
published — `docs/governance-v1.1-hardening.md` (×4), `PRODUCT_BOUNDARIES.md`,
`docs/governance-submission-review-workflow.md`, and three "sprint report /
sprint spec" mentions — were replaced by the substance they pointed at, or by
on-site links. Publishing them verbatim would have traded two dead links for
several more. Implementation citations were rewritten as plain description
(e.g. "the results calculation never returns a per-wallet mapping" rather than
naming the function and test file): the guarantee is the public-facing fact, and
it stays checkable by behaviour rather than by a file path in a private repo.

**Three claims were re-verified against source before publishing**, rather than
trusted from the doc:

| Published claim | Verified against |
|---|---|
| Minimum 1,000,000 WinLEW to vote | `minWinlewToVote: 1_000_000` |
| >50%, and >2/3 for governance-rules — ties and exact 2/3 fail | `topChoiceShare > threshold`, strict `>` both cases |
| 17 proposal statuses | `PROPOSAL_STATUSES` — exactly 17 keys |

The threshold wording was **corrected in the process**: the source doc says "at
least two-thirds" in one sentence and then "exactly two-thirds does not pass" in
the next. The code is strictly-greater, so the published page says "more than
two-thirds" and drops the contradiction.

**Drift guard.** Both source `.md` files now carry a header naming their
published copy and requiring policy changes to be made in both. This is the real
long-term risk: a rules page that silently stops matching the rules in force is
worse than one that 404s, because it looks authoritative.

**Still open:** the other four private-repo links — `/modules/` ×2
(`docs/modules-system.md`) and `/wallet/` ×3 (`GeoWallet/issues`) — are
untouched and remain owner decisions. The `/wallet/` ones matter most now: a
support page and a privacy policy both direct users to a nonexistent issue
tracker.

**Confidence: HIGH** — repo visibility confirmed via `gh`, every number checked
against source, every command checked against `commands.js`.

---

### 14. `/health/` — stale by a whole migration, and monitoring the wrong things

`index.html` + `js/app.js` (91 lines). 16 internal links, 0 broken. The JS is
clean: it hardcodes no routes and renders whatever `/api/health/status` returns,
so all the staleness was in the prose and in the route list itself.

**The page was still describing a finished migration in the present tense.** It
read as a maintainer handoff note, not a public status page — "gives **you** a
clean first-party destination for health references after moving away from
brittle subdomains", "are ready for shared hosting", "so **you** are not
dependent on subdomain SSL support". That move is complete: a repo-wide search
found **zero** subdomain URLs anywhere in `src/public/`. Rewritten to describe
what each area does now.

**A "Next optional upgrade" that was already done.** The roadmap note asked to
"point Discord bot help commands at these first-party routes" — but
`src/shared/command-inventory.js` already uses 14 `https://winlew.co/...` URLs
and no subdomains. Removed rather than left advertising completed work as
pending.

**A maintainer instruction printed on a public page.** The same note told the
reader to "add them to `FIRST_PARTY_ROUTES` in `src/mole/web.js`'s
`/api/health/status` handler". Moved into the code, next to the array it
describes, where the person who needs it will actually be.

Both were replaced with a **"What this page is not"** section, because the page
had a real honesty gap: it shows a "Checks / Healthy" score with no statement
of scope. It now says plainly that this is a live check with no stored history,
that it claims no uptime percentage, that a red mark means "failing right now",
and that APIs are held to the higher bar of reporting success *inside* their
response body — which the endpoint genuinely does.

#### The substantive finding: the monitored set never grew with the site

`FIRST_PARTY_ROUTES` covered 4 pages — `/verify/`, `/discord-bots/`, `/health/`,
`/bounties/` — and 6 data APIs. **None of the routes people actually come to
this site for were monitored**: not the faucet, not the quiz, not the games, not
governance, not even the landing page. A health page that omits every route
whose failure anyone would notice is not reporting on the system.

Added 7 pages (`/`, `/faucet/`, `/quiz/`, `/mole-hub/`, `/governance/`,
`/transparency/`, `/burn/`) and 2 APIs. The most valuable addition is
**`/api/price/status`** — the endpoint that exists precisely because the
third-party price sources it replaced kept failing, and which was not being
watched at all. It is server-cached (30s), so checking it is cheap.

**One route deliberately left out, and why:** `/api/discord-bots/status` is
public and would otherwise belong here, but it is **uncached and fans out to 3
external services per call**. Including it would turn every `/health/` load into
3 extra outbound requests, and its own 30-per-10s rate limit would let a page
refresh amplify that to ~90. Documented in the code as "add it once it caches
its reachability results the way the price and faucet-stats routes do."

Session-gated routes (e.g. `/api/faucet/status`) are also excluded and now
documented as such — loopback checks carry no cookies, so one would report 401
and show as permanently unhealthy.

**Confidence: HIGH** — migration completeness verified by repo-wide search,
command URLs verified in `command-inventory.js`, every added route verified
session-free, and the price endpoint's cache verified before adding it.

---

### 15–17. `/leaderboards/`, `/images/`, `/jdid93hf8dh/` — logged retroactively

These three were audited in commit `fd86521` but never written into this file,
which left them looking unexamined under the rule at the top of this document.
Recorded here from that commit's findings, with the independently checkable
claims re-verified 2026-08-04:

- **`/leaderboards/`** — audited there, and it is what exposed the governance
  voting-rule error: the page's statement that extra weight comes from the
  Governance Vote Fund contradicted the rules page published two commits
  earlier, and **the leaderboard was the one telling the truth**. The
  correction landed in `/governance/` and `/governance/rules/`. No separate
  defect was recorded against the page itself. *This entry is thinner than the
  others — if parity matters, `/leaderboards/` is worth its own pass.*
- **`/images/old-index.htm`** — an orphaned 21,937-byte superseded landing
  page, publicly reachable, still carrying MemeFi positioning and Pump.fun as
  the active buy route. Marked `noindex, nofollow` rather than deleted, and
  flagged for the owner. **Re-verified:** the file is that size and does carry
  the noindex tag.
- **`/jdid93hf8dh/`** — the unlisted beta-APK folder. Clean: `noindex`, unlinked
  except from the app. **Re-verified independently:** `sha256sum` of
  `winlew-beta-0.1.0.apk` is `dc1bd7f6…22b5` at 25,824,859 bytes, matching both
  the hash printed on `index.html` and the one in `latest.json` exactly. The
  second hex string on the page is the signing-certificate fingerprint, a
  different value by design, consistent across both files.

---

### 18. `/home/` — a lapsed domain, a superseded voting rule, and a nav that never rendered

`index.html` only — 1,985 lines, no separate JS or CSS. 20 internal links, all
resolve; 4 images, all present; every in-page anchor resolves. The live page
was fetched and diffed against local (it is reachable and current apart from
the two prose fixes already committed in `fd86521`).

> A note on method: the first fetch of `winlew.co/home/` returned **403**, which
> looked like the page being down. It was a user-agent block — with a browser
> UA it is a normal 200. Recorded because the same trap will catch the next
> person checking this site from the command line.

#### The page was still publishing the voting rule the previous commit set out to correct

`fd86521` fixed "one verified wallet, one vote" on `/governance/` and
`/governance/rules/` after establishing that capped pay-per-vote weight shipped
2026-07-28. It missed this page. A repo-wide search now shows `/home/`'s
MODULE-06 card was **the last place in `src/public/` still publishing the
superseded rule** — in both `data-long` and `data-points`, i.e. in the summary
line and in the bullet list. `web.js` computes
`totalWeight = 1 + voteWeight.purchasedWeight` for every proposal. Rewritten to
the real rule: one free vote per verified wallet, up to 10 more at $1 each,
hard-capped at 11.

#### `winlew.token` — a real feature that expired, still advertised as current

The "Simplified discovery" section told every visitor they could type
`winlew.token` into their explorer instead of pasting an address.

This **did** work once — `/images/solscan-domain.png` is a genuine screenshot of
Solscan resolving the name with Domain Owner set to the WinLEW mint. It does not
work now. The lookup came from a RugCheck-paid verification package the owner
confirms lapsed over a year ago, and AllDomains' current 48-TLD list no longer
carries `.token` at all. Nothing in the repo registers or resolves the name, and
the string appears nowhere else in `src/public/`.

So the page gave an instruction that fails for everyone who tries it,
illustrated by a screenshot of the era when it succeeded — the most persuasive
possible presentation of something untrue. Replaced with the mint-address
lookup, which is what actually works; the screenshot is dropped rather than
shown as current proof, and the file is left in place, not deleted.

#### 16 navigation links that have never rendered

`nav.js`'s `buildTwoLevelNav()` calls `links.remove()` on the page's own
`.navLinks` and rebuilds both the primary row and the grouped Menu from
`NAV_SETS`/`NAV_GROUPS`. This page's hand-written 16-pill list was therefore
dead markup — **and stale**: no `/leaderboards/`, `/policies/`, `/who-we-are/`,
`/roadmap/`, `/ecosystem/`, `/contribute/` or `/merch/`. The only circumstance
in which it could ever appear (nav.js failing to load) is exactly the
circumstance in which it would hand visitors an out-of-date menu. Emptied, with
the element kept because nav.js requires it and reuses its id for the toggle's
`aria-controls`. Confirmed by rendering: 5 primary pills, built from config.

#### A module shown as LOCKED that is 40% shipped

MODULE-03 (Quests & Progression) rendered a dashed **LOCKED / "Access pending"**
badge while its own `data-desc` on the same card said "Streaks and milestone
badges are live", and while `/modules/quests-progression.html` states
**PARTIAL (40%)** with both sub-items shipped and running on the Dashboard.
Switched to the `warming`/PARTIAL state — whose styles already existed in this
file, unused. Two further corrections on the same card: the phase label said
"Phase 3 — Engagement & Mechanism Rollout" where the module's own page says
"Phase 3 — Platform Launch", and `data-time="Q3 2026"` was a forward-looking
promise that has arrived (August 2026 *is* Q3 2026). The module page carries no
date; this card no longer invents one.

#### Two pieces of honest content that no visitor has ever seen

- The roadmap bar opened at `88%` above the line **"5 of 6 shown here are
  LIVE"** — an accurate, genuinely useful summary. `applySelection()` runs
  unconditionally on load and overwrites both with the *selected module's*
  figures, so it was replaced before it could be read. The standing count now
  lives in `.roadSub`, where nothing overwrites it.
- `applySelection()` rendered `points.slice(0, 4)`. All six cards define exactly
  **5** points, so every card silently dropped its last bullet — including
  MODULE-06's "No automatic treasury/burn execution, ever", the strongest safety
  claim on the card and the one a sceptical reader most needs. Slice removed.

Also: MODULE-01 carried `data-progress="38"` while its own page says ONLINE and
every other live module uses 100. Because it is the default selection, **38% was
what the roadmap bar showed on first load** — the page opened by reporting its
own finished foundation as a third built.

#### Smaller corrections

- **No `<h1>` anywhere.** The page opened at `<h2>`, leaving the `h1` rule in its
  own `<style>` block orphaned. Promoted; verified by render that the rule was
  written for this hero (58px, correct at 1440 and 390, no overflow).
- **"Historical Launch Market" is chronologically wrong.** Pool creation dates
  read from GeckoTerminal: Raydium `5nTz…` **2025-02-10**, this pool `H3Ho…`
  **2025-07-19**, PumpSwap `Hmif…` **2026-07-22**. It is five months *younger*
  than the Raydium market it was presented as predating, and the token launched
  on the bonding curve in Dec 2024, before all three. Relabelled "Retired
  pump.fun AMM Pool"; the graduate banner's matching phrase was corrected too.
- **The GeoAgora link went nowhere.** `https://winlew.co/GeoAgora`, labelled
  "Under construction", 302s via `.htaccess` to `/geoagora/`, whose `index.html`
  is a redirect stub to `/` — so the one link presented as a destination bounced
  the visitor back to the landing page. Repointed at `/ecosystem/geoagora/`, the
  intentionally-published page; the raw build stays locked down.
- **Internal links opening in new tabs.** `/discord-bots/`, `/health/` and
  `/verify/` carried `target="_blank"` in this one section while the same
  destinations elsewhere on the page did not.

#### Verified correct — no change made

- **The graduation claim checks out.** The hero states "Verified market created
  July 22, 2026"; the PumpSwap pool's creation timestamp is
  **2026-07-22T15:59:15Z**.
- `H3Ho…` reports **$0.00** liquidity — "currently reporting no liquidity" is
  accurate.
- The stats widget correctly reads this site's own `/api/price/status` rather
  than calling DexScreener/GeckoTerminal from the browser, and degrades to "—"
  with an honest message when the endpoint is unavailable (exercised: the
  endpoint 404s with no backend and the page handles it cleanly).
- **A previously-recorded broken link is no longer broken.** The 2026-07-19 note
  that GeckoTerminal 404s for the Raydium pool `5nTz…` is out of date — GT has
  since indexed it. All three pool links resolve.

**Confidence: HIGH** on everything above except the `.token` registration
itself, which rests on the owner's own account plus AllDomains' current TLD list
(the lapsed registration cannot be re-observed directly). 773/773 tests pass;
page re-rendered at 1440px and 390px with no horizontal overflow and no console
errors beyond the expected offline price endpoint.

---

### 19. `/images/` — 10 MB of logo served into 64px boxes, and 41 MB nothing points at

79 files, **62 MB** — by far the heaviest folder in `src/public/`. Three
`index.html` directory guards (`/images/`, `page-headers/`, `page-icons/`) are
present, identical, and correctly redirect to `/no-thank-you/` with
`noindex, nofollow`. `old-index.htm` was handled in `fd86521`; note it is
`.htm`, so the `index.html` guard does not cover it — it is reachable by exact
URL and relies on its own noindex.

#### The substantive finding: nav avatars and bot icons are 256–384× oversized

`.nav .brandAvatar` renders at **64×64** (56 on mobile). `.botIcon` and
`.policyIcon` render at **44×44**, `.policyHeroIcon` at **52**. What was being
downloaded into those boxes:

| file | native | weight | box | over |
|---|---|---|---|---|
| `WinLewLogo.png` | 1079×1196 | 1,323 KB | 64px | 315× |
| `mole-hub/assets/brand-avatar.png` | 1254×1254 | 1,534 KB | 64px | 384× |
| `WinLEW-Utility-Bot.png` | 1024×1024 | 1,585 KB | 64/44px | 256× |
| `geoagora-night.png` | 1536×1024 | 2,866 KB | 44px | — |
| `WinLEW-Watch Dog.png` | 1024×1024 | 1,617 KB | 44px | — |
| `MoleGuardLogo.png` | 1024×1024 | 1,083 KB | 44/52px | — |
| `GeoHacker.jpg` | 1011×1244 | 350 KB | 44px | — |

The nav avatar is on **every page**, so the landing page spent ~1.3 MB on a
64px logo. `/discord-bots/` loaded all five bot icons at once: **7.5 MB** of
image to draw five 44px squares.

The `page-icons/*` set (28–46 KB, ~135×128) shows this was already understood —
those are correct. The oversized files are the ones pointed at directly instead.

**Fixed.** Generated `/images/avatars/` — seven 128px PNGs (2× the largest box,
so still crisp on HiDPI), centre-cropped square to match the `object-fit:cover`
the browser was already applying. **10.11 MB of source → 224 KB.** Repointed
`nav.js` (7 refs), the three arcade pages' hardcoded `brandAvatar`, `/app/`, all
11 `discord-bots/*.html` and `/policies/`. Added the same directory guard the
sibling folders use. Originals left untouched.

Per page: landing/`/home/`/`/about/` **1,323 KB → 34 KB**; arcade brand
1,534 → 26; `/app/` 1,585 → 37; `/discord-bots/` **7,501 KB → 165 KB**; each
policy page hero 1,083 → 26.

Verified by render across 10 pages: zero broken images, every avatar resolving
at 128×128 into a 40–62px box. `/quiz/` and `/faucet/` turned out to have their
`brandAvatar` overridden by `nav.js` with the correct `page-icons/` file
already — their hardcoded `src` was only ever the no-JS fallback, and is now
correct too.

#### 41.7 MB that nothing references — flagged, not deleted

23 files, **41.7 MB of the folder's 62 MB**, with no reference anywhere in
`src/`. Not removed: these are exactly the kind of asset that gets linked from
outside the repo (an X post, a Discord embed), which the repo cannot see, and
the standing rule here is that removing something reachable is the owner's call.

- **13.8 MB is exact byte-for-byte duplication.** Seven files —
  `hub-banner.png` and the six `*-card.png` game thumbnails — exist identically
  in both `/images/` and `/mole-hub/assets/`, and only the `/mole-hub/assets/`
  copies are referenced (via relative `./assets/…`). Confirmed by `md5sum`.
- `TheMoleGaurd.png` is byte-identical to `TheMoleGuard.png` — a typo-named
  copy, 2.08 MB. (The same "Gaurd" misspelling as the private repo name.)
- `winlew.ico` is byte-identical to `favicon.ico`, 0.73 MB. Separately: **712 KB
  is very large for a favicon**; a normal one is 5–15 KB.
- `page-icons/brand-avatar.png` (1.57 MB) is an orphan — the referenced
  `brand-avatar.png` is the different file under `/mole-hub/assets/`.
  `page-icons/mole-hub.png` is the one member of the icon set nothing uses.
- Two files carry **literal ChatGPT export filenames** —
  `ChatGPT Image May 22, 2025, 01_49_50 PM.png` and the April 18 one, 3.7 MB
  together. Publicly reachable by exact URL. Owner may not want the provenance,
  or the spaces and commas in a public path.
- Remainder: `building-mole.png`, `HEADER-Template.png`, `Verified_Apps.png`,
  `New-Banner.png`, `berry-Worm-card.png`, `bonded.png`, `bonded-1.png`,
  `WInLEW-Pill.png` (note the capital-I typo), `Cool Story.jpg`, `ROADMAP.png`.

#### Also found, not fixed — the page-header banners are upscaled

The 22 `page-headers/*.png` are ~503px wide natively but render at **1374px** on
a 1440 viewport — a **2.7× upscale**, i.e. visibly soft on desktop across the
whole site. Weight is fine (3.2 MB for 22). Not fixable from here: sharpening
requires re-exporting from the original source at 2×, and upscaling what exists
would add pixels without adding detail. Mobile is unaffected.

> **Method note that changed a result.** An early orphan scan matched bare
> filenames and reported 14 files; matching full paths reported 24. Both were
> wrong. `WinLEW-Watch Dog.png` is referenced as `WinLEW-Watch%20Dog.png`, so a
> raw path match called a live file dead. The count is only trustworthy against
> a **URL-decoded** haystack. Any future sweep for unused assets on this site
> must decode `%20` first.

**Confidence: HIGH** on the sizing work (measured natively, re-measured in a
real render) and on the duplicate claims (`md5sum`). The unreferenced list is
HIGH *within the repo* and says nothing about external links — which is
precisely why nothing was deleted.

---

### 20. `/leaderboards/` — the full pass it was owed

`index.html` (176 lines) + `js/app.js` (275). Supersedes the thin retroactive
note in the 15–17 block. All internal links resolve, all five in-page anchors
resolve, one `<h1>`, no `rel="canonical"` (the known site-wide gap, item 6).

**The client is genuinely well built and needed no correction.** It escapes
everything it renders, computes no rankings of its own, and every one of the six
endpoints it calls exists in `web.js`. Field-by-field the response shapes match
what it renders. Two things that looked like bugs and were not:

- `/api/quiz/leaderboard/platform` spreads `...row` without adding `rank`, which
  the client renders — but `rankUsersByPlatform()` already attaches
  `rank: i + 1` (`platform-stats.js:115`). Correct.
- The client renders `Math.round(e.accuracy * 100)`; `accuracyOf()` returns
  `correct / total`, a 0–1 fraction. Correct.

**The game list is right, and worth recording because it looks wrong.** The
board offers five games; the Mole Hub has card art for seven. `KNOWN_GAME_KEYS`
in `web.js` and `GAME_REWARD_SCALES` in `rewardRules.js` both contain exactly
those same five. Tunnel Tap and Mole Market Rush have artwork but no reward
scale, so they cannot pay out and correctly do not appear on a board that ranks
by WinLEW earned.

#### The hero claimed something three of its own boards contradict

> "Every board below ranks players by WinLEW actually earned or claimed — not
> raw score"

Untrue for most of the page. **Quiz** ranks by platform points — and says so
itself two cards down ("Ranked by platform points… separate from real payout
totals"), directly contradicting the hero above it. **Governance** ranks by
proposals voted. **Clout** ranks by WinLEW *contributed to* the reserves, which
is the opposite direction of travel from earning. Only Gaming Hub and Faucet
matched the claim.

The same over-claim appeared twice more in the same card: the eyebrow read
"Ranked by real earnings", and the `<h1>` subtitle named three of the five
boards, omitting Clout and Governance despite both having their own sections.
All three rewritten to state what each board actually sorts on.

#### Accessibility: every inline link was the browser's default blue

This page never declared a colour for `<a>`, so every inline link in the `.fine`
footnotes — and the Solscan links in Clout's Evidence column — rendered at
`rgb(0, 0, 238)` on a near-black card. **Measured 1.92:1**, against the 4.5:1
WCAG AA needs for body text; it fails even the 3:1 large-text floor. Added
`a{color:var(--brand)}` — **now 8.31:1**, above AAA. `.pill`, `.btn` and
`.navBrand` set their own colour at higher specificity and were verified
unaffected.

**Swept the rest of the site for the same defect.** `/health/` (2 links) and
`/policies/` (3) had it too and are fixed with the same rule. Every other page
checked was already clean. Note `/health/` was audited at #14 and this was
missed then — a rendered-contrast check is not something reading the CSS
surfaces.

#### Governance note now states the cap

The vote-weight sentence here was already correct on 2026-08-04 — it is what
exposed `/governance/` still publishing "one wallet, one vote" (fixed in
`fd86521`). What it omitted was the ceiling, which is what makes the **Vote
Weight** column above it safe to read: without it a visitor sees a number with
no stated maximum. Now states one free vote plus up to 10 purchased at $1,
capped at 11 — verified against `governancePricing.js` (`USD_PER_VOTE = 1`,
`MAX_PURCHASED_VOTES_PER_PROPOSAL = 10`) and `governanceStore.js`
(`MAX_TOTAL_WEIGHT = 1 + 10`).

#### Verified, no change

All five boards degrade to a plain "⚠️ Could not load…" with **zero page
errors** when the API is unreachable — exercised directly, and currently the
live behaviour (see the infrastructure note below). No overflow at 1440 or 390.

> **False positive worth recording.** A local `python3 -m http.server` sweep
> flagged 7 default-blue links on `/ecosystem/`. There is no
> `/ecosystem/index.html` — those were the dev server's own **directory
> listing**. Live, `/ecosystem/` returns **403**; listing is disabled at the
> server. Nothing is exposed. Any local-server sweep of this site will
> mis-report every folder that has no index page.

**Confidence: HIGH** — endpoints and field shapes read from source, the game
list cross-checked against two independent server-side constants, contrast
measured before and after in a real render.

---

### 🔴 INFRASTRUCTURE — every API on the live site is down (2026-08-04)

Not a folder finding, recorded here because it was discovered during this pass
and affects the whole site.

`https://winlew.co/verify/api-proxy.php?path=/api/...` returns **`ERR_NGROK_3200`
— "The endpoint … .ngrok-free.dev is offline"** for *every* route tried:
`price/status`, `health/status`, `burn/status`, `transparency/status`, and all
five leaderboards. Static pages are unaffected — `/`, `/leaderboards/`,
`/faucet/`, `/quiz/`, `/governance/`, `/burn/` all serve 200.

So the site currently renders, but everything dynamic is dead: live price, burn
totals, transparency figures, the health page itself, every leaderboard, faucet
claims, quiz play, wallet connect and governance voting.

The tunnel/runner on the serving machine needs restarting — `npm run status`
and `npm run site:check` exist for exactly this, but must run **on that
machine**. This is the same failure mode recorded on 2026-08-01.

---

### 21. `/links/` — the two X accounts were swapped, and the site disagreed with itself

One 14 KB `index.html`. Every internal link resolves; every external link
resolves (the 403s from DexScreener, Solscan and Coinbase are user-agent bot
blocks, the same pattern `winlew.co` itself returns — all three load in a
browser). One `<h1>`, no `rel="canonical"` (site-wide item 6).

#### @WinLewToken and @LetEveryOneWin were described backwards

The page whose entire job is saying which account is which had both wrong:

| | `/links/` said | actually |
|---|---|---|
| `@WinLewToken` | "Token account" | runs the X/Twitter **faucet** & giveaway program |
| `@LetEveryOneWin` | "Faucet / bot account" | the official **project** account, and the burn program |

This was not a simple typo — **the codebase genuinely contradicted itself**, which
is why it survived. `/home/`, `/whitepaper/`, `/contribute/` and `web.js`'s
`xFaucetReserve` component (`winlew.sol` / `GFxz42…EhAp` is *"held by
@WinLewToken — the X giveaway host account"*) all said one thing. `/links/` and
`/who-we-are/` said the opposite — and `/who-we-are/` contradicted **itself**,
describing `@LetEveryOneWin` as the faucet account in one section while stating
*"X (Twitter) Faucet Reserve — winlew.sol — held by @WinLewToken"* in another.
`bot.js` contradicted itself too: its `!xwallet` reply and its `!links` list
disagreed.

**Resolved by the owner's own DNS**, which no page can argue with:

```
faucet.winlew.xyz -> x.com/winlewtoken
burn.winlew.xyz   -> x.com/leteveryonewin
dev.winlew.xyz    -> x.com/lewsales
```

So `@WinLewToken` is the faucet account and `@LetEveryOneWin` is the token/burn
account. Corrected in three places: `/links/`, `/who-we-are/` (out of folder
order, but leaving a now-disproven statement live was not defensible), and
`bot.js`'s `!links` command — where the two "Direct:" handles were printed
beside the *very vanity domains that redirect to the other account*, so the
command disagreed with its own links on the same line.

#### "Every winlew.co page" was missing eight of them

The hero promises "every winlew.co page". Diffed the Explore grid against
`nav.js`'s own path list: **9 of 38 nav-advertised paths were absent.**

- **4 of the 7 `/ecosystem/` pages** — GeoJustice, GeoPresence, GeoProof and
  uBlock — while GeoWallet, GeoAgora and GeoHackers were listed. All seven are
  live (200), carry no `noindex`, and are in nav.js's menu. Added.
- **`/merch/`** — was deliberately out of nav while private, but became a public,
  indexable "coming soon" teaser on 2026-07-31 (nav.js documents the change).
  Added.
- Legitimately omitted, left alone: `/discord-bots/terms.html` and
  `privacy.html` (covered by the Policies link) and `/no-thank-you/promotions/`
  (an opt-out, not a destination).

#### Smaller corrections

- **Raydium was labelled "Post-graduation swap"** — the wrong market. The
  post-graduation market is the PumpSwap pool `Hmif58…` (created 2026-07-22);
  Raydium's `5nTz…` was created 2025-02-10 and is the established *secondary*
  route, which is how `/home/` and `/transparency/` both describe it. Relabelled.
- **DexTools URL carried an `/en` locale segment DexTools 301s away**, costing
  every visitor a redirect. Now the canonical path, verified 200.

#### Verified correct — no change

- **"CoinGecko — Not yet listed" is true**, and worth confirming rather than
  assuming, since the page is on GeckoTerminal (CoinGecko's DEX product) which
  is easily mistaken for a listing. CoinGecko's search API returns zero results
  for "WinLEW" and its contract endpoint returns `coin not found`.
- The **Coinbase** card's careful wording — "Trackable and tradeable via
  Coinbase's onchain DEX view — not a formal exchange listing" — is exactly the
  distinction that matters, and is left as written.
- The "not yet listed" dashed-card pattern is a good honesty device and should
  be kept for future platforms.

**Flagged for its own folder:** `/mole-link/` ("Link Wallet + Roles") and
`/verify/` are two entry points to the same wallet-linking flow — 4.8 KB versus
25 KB, same stated purpose. Not added to `/links/`: advertising both before the
duplication is resolved would just move the confusion onto this page.

**Confidence: HIGH.** The account mapping rests on live DNS resolution plus four
agreeing in-repo sources; the CoinGecko and DexTools claims were tested against
those services directly.

---

### 22. `/merch/` — an honest teaser, a well-staged shop, and a 3.9 MB og:image that never rendered

Two pages: `index.html` (public "coming soon" teaser, `index, follow`) and
`shop.html` (the real shop, **`noindex, nofollow, noarchive`** with no inbound
links anywhere), plus `merch.js`, `products.json` and 12 images. `MERCH_README.md`
documents the whole thing.

**The staging is done properly and deserves recording.** `shop.html` is
unlinked and noindexed; `merch.js` renders a *disabled* "Crypto checkout coming
online" button whenever a product's crypto URL still matches `/^TODO_/`, and an
empty `PAYPAL_CLIENT_ID` produces "PayPal checkout coming online" rather than a
broken button. Nothing half-built is reachable or clickable.

The teaser's copy is also the right kind of careful: *"nothing is on sale yet,
and there's no pre-order, waitlist, or deposit. If you see one, it isn't us."*
That is a real anti-scam control on a page announcing a drop, and it should
survive future edits.

#### The one visitor-facing defect: the social card was broken

`og:image` was **`/merch/img/winlew-first-tee-shirt.png`** — a *relative* path.
Open Graph requires an absolute URL, so scrapers had nothing to fetch and the
share card rendered imageless. Every other page on the site already uses the
absolute form. Fixed, and `og:url` added to match the site's pattern.

The same file was also the page's hero. At **3,949 KB / 1536px wide**, rendered
into a box measured at **366px** on desktop and 276px on mobile — so every
visitor to a public, indexed page pulled ~4 MB to fill a 366px slot, and every
share unfurl pulled it too (slow enough that some scrapers time out).

Now serves a 900px WebP (**118 KB**) with a JPEG fallback (128 KB) via the same
`<picture>` pattern `/home/` already uses, and a 269 KB 1200px JPEG for
`og:image`. Verified visually identical at the real display width. The two other
WinLEW PNGs (1.2 MB and 1.8 MB, used by the staged shop) got the same treatment
via `products.json`. **Source PNGs left untouched on disk.**

Same shape as `/images/`: WinLEW's own artwork is 1.2–3.9 MB while the
XYO-supplied JPEGs alongside it are 16–63 KB and needed nothing.

#### The XYO catalog is accurate — verified against XYO's own store

These are someone else's prices, so they were checked rather than trusted. All
**9 XYO products**: `productUrl` returns 200, and the price matches
`shop.xyo.network`'s own `product:price:amount` **exactly** ($35/$35/$35/$20/
$65/$65/$35/$75/$75). `config.catalogLastVerified` bumped `2026-07-29` →
`2026-08-04`. Checkout stays `linkout` — the code comments note this only
changes if XYO grants written resale authorization, which is the correct posture.

#### The holder discount is real and computed server-side

The teaser promises "a discount that scales with what they hold, calculated from
your verified wallet at checkout". `/api/merch/discount` does exactly that:
session-gated, reads the live verified-wallet balance, 1% per 1M capped at 15%,
WinLEW section only — and **fails closed** (`discountPct: 0` on no session or
error). Config in `products.json` matches the route's defaults.

#### Doc drift corrected

`MERCH_README.md`'s TODO said to "replace the three `EDIT ME` placeholders in
`products.json`". That work is **done** — all five WinLEW products have real
names, prices and descriptions, and no placeholder remains. (An early grep of
mine appeared to find one; it was matching "EDIT" inside "orange **EDIT**ION".)
Marked complete, and replaced with what is genuinely still outstanding: the
crypto payment links, and photos for the two products that still have
`image: null` and fall back to a glyph.

#### Already documented, still the main launch risk

`MERCH_README.md` already carries an explicit warning that v1 PayPal checkout is
client-side and "a tampered client could construct its own order amount", with
the mitigation *"check the order total against the price sheet in your PayPal
dashboard before shipping anything."* Confirmed accurate: `createOrder` builds
the amount in the browser from `product.price` and `state.discountPct`, so the
server-computed discount can simply be ignored by a modified client. Recorded as
register item 18 — not a new discovery, but the control is manual and does not
scale.

**Confidence: HIGH** — prices fetched from XYO's live store, exposure controls
and the TODO-guard read from source, both pages re-rendered at 1440 and 390 with
zero broken images and zero page errors.

---

### 23. `/modules/` — a system built to stop drift, whose own detail pages sit outside it

8 files: `index.html`, `js/app.js`, six `*.html` detail pages. All internal
links across all of them resolve. `npm run modules:validate` passes clean — 24
modules, 5 roadmap phases, 0 errors.

**This is the most disciplined system on the site and mostly checks out.** One
registry (`modulesData.js`) with ten controlled status values, a rule against
vibes-based percentages, a validator that fails the build on duplicate ids,
unknown statuses, or a `live` module whose route doesn't resolve to a real file,
and a dedicated test block guarding the Cross-Chain Bridge decision against
silent reversal. The two `historical` modules both label themselves
**HISTORICAL — superseded by shipped modules** clearly and repeatedly on their
own pages, so nobody lands on a retired concept and reads it as current.

#### Closes register item 10's `/modules/` half

Both "Read the Docs" links pointed at
`github.com/LewSales/mole-gaurd/blob/main/docs/modules-system.md`. That repo is
**private** — verified **404** for any logged-out visitor, so the page inviting
readers to check the rules behind its own status labels was a dead end for
everyone except the owner.

Fixed the way the owner already chose for the governance docs: published on-site
at **`/modules/system/`**. The source doc is maintainer-facing in places, so it
was reframed for a reader checking whether the labels mean anything — the ten
status words, why "live" and "ongoing" are kept separate, where percentages come
from, the Cross-Chain Bridge decision in full, and what the validator refuses to
let through. The procedural "run this command" steps were left out; the
`/health/` audit already established that maintainer instructions don't belong
on a public page.

The footer's second dead link went too, along with its bare
`src/mole/modulesData.js` reference — naming a file a visitor cannot open reads
as evidence while proving nothing.

> `nav.js` matches page configs **exactly, not by prefix**, so `/modules/system/`
> had to be added to the modules match list or it would have silently fallen
> back to `PAGE_CONFIGS[0]` and rendered the wrong nav. The file's own comment
> on the `/policies/` config warns about this; worth heeding for every new
> nested page.

#### The substantive finding: the anti-drift rule isn't enforced where it matters

`docs/modules-system.md` states plainly: *"Never hand-edit the same status across
multiple HTML files — that's exactly the drift this system exists to prevent."*

**All six detail pages hardcode their own status badge, and none of them fetches
`/api/modules/status`.** Only `/modules/index.html` renders from the registry.
So the rule is stated but unenforced, and `validate-modules.js` cannot catch a
violation — it validates the registry and never reads the detail pages' HTML.

They all still agree with the registry today, with one wrinkle:
`core-infrastructure` renders **`ONLINE`**, which is not one of the ten
controlled values (`live` is). That is the drift the vocabulary exists to
prevent, already visible in its mildest form.

Not fixed here — closing it properly means either rendering each badge from the
API or teaching the validator to parse the detail pages, and both are feature
work rather than an audit correction. Documented in
`docs/modules-system.md` as a known gap, with both options written up and a
stopgap rule: editing the registry also means grepping
`src/public/modules/*.html` for the old status string.

#### One overclaim corrected

`games-trivia.html`'s kicker read **"playable in the browser + Discord"** — which
its own status badge contradicts two lines below it ("Quiz + Mole Hub in the
browser"). The page is the shared explainer for *two* modules, and the claim is
only half true: the Quiz runs on both, but every Mole Hub game is web-only.
`/leaderboards/` says so outright and disables its Discord tab with "The Gaming
Hub isn't on Discord yet". A reader arriving from `/mole-hub/`'s "Gaming Hub
overview" button was being told the arcade is on Discord. Split per surface.

#### A finding I withdrew

`games-trivia.html` first looked like an orphan — a live, linked page with no
module record owning its route. It is not: it is registered as a shared
`docs[]` entry on both the `quiz` and `mole-hub` modules, which the validator
*does* check resolves. That is correct design under the registry's own
"group related functionality into one module" rule.

**Verified separately:** `/who-we-are/`'s claim that "the original bot source is
public" is **true** — `github.com/LewSales/Discord-Bot` returns 200. Left alone.

**Confidence: HIGH** — registry read directly, validator run, every detail page's
badge compared against its record, private-repo 404s confirmed by request, all
pages re-rendered.

---

### 24. `/mole-hub/` — 10 MB to draw six 252px thumbnails, and payout floors below what's advertised

The biggest folder: **26 MB**, ~12,700 lines of game code across 5 games, 59
markdown docs, 19 PNGs. Every game launches clean at 1440 and 390 with zero
console errors, and the arcade's own `.htaccess` sets a genuinely tight CSP
(`object-src 'none'`, `script-src-attr 'none'`, an explicit origin allow-list).

#### The advertised payout ranges — two exactly right, three understating the floor

The catalog cards advertise a WinLEW range per game. These are claims about real
money, so each was derived from source rather than trusted:
`payout = rawBase × GAME_REWARD_SCALES[game] × rewardBox(0.5–2×)`.

| game | card said | derived worst case | verdict |
|---|---|---|---|
| Pac-Mole | 10–420 | `100×0.20×0.5` = **10** … `1050×0.20×2` = **420** | **exact, both ends** |
| Grub Drop | 2–160 | `60×0.08×0.5` = **2.4** … `1000×0.08×2` = **160** | **exact** |
| Root Glide | 8–35 | `(18+5)×0.60×0.5` = **6.9** | floor too high |
| Burrow Blaster | 20–90 | `(35+15)×0.35×0.5` = **8.75** | floor too high |
| DigLEW | 2–30 | `2×0.75×0.5` = **0.75** | floor too high |

Pac-Mole and Grub Drop match to the decimal, which shows these *were* derived
carefully — so the other three are drift, not guesswork. The problem is
directional: a player who has a bad run gets **less than the minimum they were
shown**. DigLEW's real floor is under a third of its advertised one.

Corrected to the true worst case (`7–35+`, `9–90+`, `1–30+`). The `+` is
deliberate: Root Glide's base grows 5/round, Burrow Blaster's 15/round, and
DigLEW's bonuses keep accruing, so those ceilings are open-ended and the old
two-number range understated the top as well. Pac-Mole (hard cap at level 20)
and Grub Drop (raw clamped to 1000) keep their exact ranges.

#### `GAME_REWARD_SCALES` was declared twice with nothing keeping them in sync

The same economic constant lives in **`src/mole/rewardRules.js`** (the server,
which decides what is banked) and **`src/public/mole-hub/js/app.js`** (the
browser, which decides the number the player is shown). They agreed — but
nothing asserted it.

Had one drifted, every claim would arrive with a payout the server disagrees
with, get flagged `payout_mismatch`, be clamped, and players would see a number
they never receive. Added a test that parses the client file and asserts the
scales match, **verified to actually fail** by temporarily changing diglew
`0.75 → 0.99` (test failed; restored, passed).

**Also corrected a misleading comment in the payout-injection test.** It read
*"diglew scale 0.08 in GAME_REWARD_SCALES; base 100 * 0.08 = 8"*. DigLEW's scale
is **0.75** — `0.08` is Grub Drop's. The claim actually banks **75**, not 8. The
assertion is `< 100` so the test passed either way, but anyone tightening it to
the documented 8 would have been chasing a phantom in a security-relevant test.

#### 10.43 MB → 1.26 MB on the arcade's front page

Measured on first load of `/mole-hub/`: **10.43 MB of images**, because the six
catalog thumbnails are 1672px PNGs (1.6–3.2 MB each) **rendered at 252px** —
6.6× oversized. Same pattern as `/images/` and `/merch/`, but on the highest-
traffic page in the folder.

Generated 600px WebP + JPEG derivatives (22–56 KB each), emitted through
`<picture>`, and repointed both the catalog and the game-launch modal. Verified
visually identical at the real 252px catalog size. **First-load image weight is
now 1.26 MB — an 8.3× reduction**, with all six cards rendering and all five
games launching.

`favicon.ico` is **byte-identical in three places** (`/`, `/images/`,
`/mole-hub/`) at 712 KB each — 2.1 MB of the same file, and mole-hub's own copy
is never used: its HTML points at `/images/favicon.ico`. Register item 13 already
covers the size; the duplication is added there.

#### 59 internal dev docs are publicly downloadable — untidy, not a breach

`/mole-hub/docs/` holds 58 development specs (build orders, hotfix plans,
release candidates, fairness audits) plus `ROADMAP.md`. Directory listing is
**403**, but **every file returns 200 at its exact URL** — confirmed live.

**Deliberately not characterised as a security issue,** unlike the access log at
the top of this document. Checked and found **no credentials, no API keys, no
local filesystem paths, no "internal only" markers**; 232 KB total. And the
mechanics they describe are already readable in the 12,700 lines of unminified
game JS served to every player, so they leak nothing the source doesn't. It is
internal development chatter published unintentionally on a production site —
an owner decision, added as register item 19.

#### Dead code, confirmed and larger than previously recorded

**12 of 19 JS files are never loaded** by `index.html`: `legacy-app.js` (1,637
lines), all 6 of `js/core/`, all 3 of `js/gateway/`, and 2 framework files —
80 KB. The earlier note (`legacy-app.js` and `js/gateway/` are dead) was right
but understated. `js/gateway/catalog-data.js` still points at the full-size card
PNGs, which is harmless precisely because nothing loads it. Flagged, not deleted,
consistent with `/assets/`.

**Verified and left alone:** the CSP allows `cdn.jsdelivr.net` for scripts, and
that allowance is used — `discord-activity.js` imports the Discord Embedded App
SDK from it. It is **properly gated**: the import only runs after the server
confirms Activity is enabled and returns a client id, so an ordinary web visitor
never fetches third-party code.

> **A finding I withdrew.** A launch-modal sweep showed Grub Drop displaying
> DigLEW's thumbnail. Re-tested in isolation and it is correct — the previous
> game's modal was still open and swallowing the click. A test artifact, not a
> bug.

**Confidence: HIGH** — payout ranges computed from the actual claim-site
expressions in each game file, the drift test proven to fail on drift, page
weight measured by intercepting real responses before and after, all five games
launch-tested at two viewports.

---

### 25. `/mole-link/` — a page in the menu with no way out of it

One 4.8 KB `index.html`. Content is accurate throughout and the security posture
is good.

#### It rendered with no navigation at all

The page loaded `nav.css` and `nav.js` but carried **no `.nav` markup**, so
`buildTwoLevelNav()` hit its `if (!navInner || !links) return` guard and exited
immediately. Result: zero site navigation — no primary row, no Menu, no
Dashboard, no footer.

That matters more here than it would elsewhere, because `/mole-link/` **is in the
shared menu** as "Link Wallet + Roles" (`NAV_GROUPS`). Anyone reaching it the
intended way landed on a page with no way onward except the browser back button.
Same defect `/community/` had at #6.

Fixed by adding the standard nav shell and the wallet-auth wiring. It was also
absent from `PAGE_CONFIGS`, so it would have fallen back to `PAGE_CONFIGS[0]`
and shown the wrong identity — added to `/verify/`'s config instead of getting
its own, since they are one journey. Renders at 1440 and 390 with 5 pills, the
verify avatar and accent, "VERIFY • LINK • TRUST", an auto-injected footer, no
overflow and no errors.

#### Correcting register item 16 — this is not a duplicate of `/verify/`

Item 16 recorded these as "two front doors to the same flow" and asked which is
canonical. Having now read both, **that framing was wrong and is withdrawn.**

- `/mole-link/` (4.8 KB) is a **launcher**: it explains the three steps and
  offers four entry points — start Mole verification, start *Utility* app
  verification, open the Dashboard/Verify page, or run `/mole link` in Discord.
- `/verify/` (25 KB) is **where the wallet signature actually happens**.

They are a chooser and its destination, not rivals. The size difference that
first suggested duplication is exactly what you would expect. Nothing to
consolidate; item 16 closed.

#### Verified correct — no change

- **`/mole link` is a real registered subcommand** (`commands.js:118`), so
  "the same flow as `/mole link` in Discord" is accurate.
- **Both linked-role entry points work**: `/verify/api-proxy.php/linked-role/mole`
  and `.../utility` each return **302 to `discord.com/oauth2/authorize`** with
  the correct per-app client id, `identify role_connections.write` scope, and a
  state parameter. The separate Utility app registration referenced by the
  second CTA is real (`web.js:537`).
- The anti-phishing footnote — verification "never asks you to approve a
  transaction, share a seed phrase, or DM anyone" — is exactly right for a
  wallet-linking page and should survive future edits.

> **Not a finding, recorded so it is not re-diagnosed.** The OAuth `redirect_uri`
> resolves to the raw **ngrok** hostname rather than `winlew.co`. This is
> deliberate and already handled. It was handled by `brandedBotRedirectPage()`,
> which made every link on the post-OAuth page absolute to `winlew.co` so nobody
> was stranded on the tunnel host; **since 2026-08-15 the callback is a straight
> `302` to `/verify/` and renders no page at all**, which removes the problem
> rather than papering over it. That function has been deleted; the constraint it
> encoded now lives as a comment where it applies, because anything rendered from
> a callback on this origin must still use absolute URLs. The residual
> consequence is structural, not a bug: while the tunnel is down, verification
> is down with it — as it was earlier the same day (see the infrastructure note
> under #20).

**Confidence: HIGH** — nav behaviour confirmed by render, both OAuth entry
points followed to Discord, the Discord subcommand located in source.

---

### 26. `/partners/` — the most carefully-hedged page on the site, with one stale holding

`index.html` + `js/app.js`, rendering from `/api/partners/status`. All internal
links resolve, no overflow at 1440 or 390, no console errors, and the page
degrades to an honest "couldn't load" message when the API is unavailable.

**This page sets the standard the rest of the site is being measured against,
and that deserves recording rather than passing over.** The hero states outright
that it is *"a historical, evidence-based record… not a promotional logo wall or
a paid-placement directory"*, and the ecosystem table is introduced with
*"Paid listing/infrastructure services are not sponsorships."* Both are true of
the data behind them.

The single partner record is hedged exactly as it should be. 2BRZ carries
`status: "status-unconfirmed"` and a summary saying the public language was
*"promotional framing, not a documented formal legal or financial arrangement."*
Confirmed the card renders that summary directly under the status pill, so the
caveat reaches the reader rather than living only in the data. Verified
independently: the 2BRZ mint is real on-chain (GeckoTerminal returns name
`2BRZ`, symbol `2BRZ`), and all three evidence links — the X announcement,
`2brz.com`, and the pump.fun coin page — return 200.

**The `dex-rugcheck-services` entry is a model worth copying.** Two
owner-supplied statements give different dates (April 24 2025 vs "August"), and
rather than silently picking one, the record carries
`verification: "conflicting-dates"` and preserves both with a pointer to the
fuller note. That is the correct handling of an unresolvable conflict.

#### The one correction: a lapsed registration listed as a current holding

`winlew-token-registration` read *"Registration of the winlew.token domain as
part of the project's official-domain footprint alongside winlew.co"* — present
tense, on a list introduced as "verified purchases, registrations, and programs".

`winlew.token` no longer resolves. Established during the `/home/` audit at #18
and re-confirmed here: the owner states the lookup came from a RugCheck-paid
verification package that expired over a year ago, and `.token` is absent from
AllDomains' current 48-TLD list, so it cannot even be re-registered under that
suffix today. `/home/` already had its "type winlew.token into your explorer"
instruction removed; this record was the other half of the same claim and was
still standing.

Rewritten to say the purchase was real and the name no longer works, relabelled
"(lapsed)", with the lapse evidence and the historical screenshot
(`/images/solscan-domain.png`) recorded in the notes. The entry is kept, not
deleted — it belongs in a historical spend record.

> ⚠️ **This fix needs a backend restart, not a file upload.** Unlike almost
> everything else in this audit, `partnersData.js` is **server-side** — the page
> fetches it from `/api/partners/status`. Confirmed against the live API mid-
> audit: it still returns the old `"winlew.token Domain Registration"` label.
> Re-uploading static files will not change it.

**Confidence: HIGH** — partner records read from source and validated, live API
payload compared field-by-field against what `app.js` renders, mint confirmed
on-chain, every evidence link followed.

---

### 27. `/policies/` — an enforcement page whose every claim checks out in code

Two pages: `index.html` (the 12-document hub, 6 product cards) and
`abuse/index.html`. All 24 internal links resolve, no overflow at 1440 or 390,
no broken images, no console errors.

The hub is accurate: the site plus **five** Discord bots each publish Terms and
Privacy, all 12 documents are linked, and the count matches the five bot records
elsewhere in the repo.

#### `/policies/abuse/` — checked line by line against the faucet code

This page documents how faucet abuse is detected and enforced. It makes specific,
falsifiable claims, so each was checked against source rather than read
approvingly. **Every one holds:**

| the page says | source |
|---|---|
| "Verification is asked for after 10 lifetime claims" | `config.js:74` — `FAUCET_VERIFY_AFTER_CLAIMS ?? 10` |
| counts are "the higher of the two", never summed | `eligibility.js:162`, with the reasoning spelled out |
| "Every detection tool is advisory — none of them can ban anyone" | the **only** call to `banWallet()` is inside the `!faucetban` handler |
| "A person… makes the call, and their name is on it" | `banWallet(..., { bannedBy: message.author.tag })` |
| "Every action is reversible" | `!faucetunban` exists and is mod-gated |
| detection is advisory-only | eligibility returns *reasons* (`wallet_banned`, `linked_to_banned`, `verification_required`) — it never bans |

`!faucetban` is gated to an explicit `MOD_ID_LIST` allow-list and supports
`--review`, which records a wallet **without** refusing its claims.

**What makes this page unusual is what it refuses to claim.** Each of the three
detection signals is given a "Can show / Cannot show" pair, and the claim-count
signal's own entry reads *"Cannot show: anything at all about abuse. A loyal
daily user is the top of this list, which is why crossing it asks you to verify
rather than accusing you of something."* It also states plainly that claiming
often is not abuse, and having friends who also claim is not abuse. That is a
project documenting the limits of its own enforcement tooling, and it is the
right standard. No changes.

#### One fix, and a gap in my own earlier method

`/policies/abuse/` had **7 links at the browser-default `rgb(0,0,238)`** — the
same missing-`a{color}` defect fixed at #20 on `/leaderboards/`, `/health/` and
`/policies/`. It was missed then because **that sweep enumerated top-level
folders and never descended into subdirectories.**

Fixed here, and the sweep was redone properly: **all 56 pages including every
nested one** now render zero default-blue links. Recording the method error
because it would otherwise recur — a page-level check on this site has to walk
the tree, not the first level.

**Confidence: HIGH** — enforcement claims traced to specific lines, the absence
of any automatic ban path confirmed by searching every caller of `banWallet()`,
contrast re-verified across the full page tree.

---

## 🔴 SECURITY — private dashboard data was readable from a wallet address alone

Found 2026-08-05 auditing `/profile/`. Fixed in the same pass, with a regression
test proven to catch it.

### `GET /api/profile/by-wallet` returned the full private payload, unauthenticated

The dashboard has three profile endpoints. Two were correct:

- `/api/profile/me` — checks `getSession()`, 401s without a valid one.
- `/api/profile/public` — no session, but returns
  `buildPublicProfilePayload(...)`, a deliberately reduced view.

The third was not. **`/api/profile/by-wallet` had only a rate limit.** It took a
wallet address from the query string, trusted it, and returned the *same
unfiltered payload* `/api/profile/me` gives an authenticated owner.

**Wallet addresses are public on this site by design** — they are printed on
`/leaderboards/`, the `/contribute/` board, `/burn/`, and Solscan. So anyone
could take a wallet from a public leaderboard and read that person's private
dashboard.

**Confirmed against the live API** during the audit, using the owner's own
published Dev wallet so no third party's data was touched. The response was
**42,718 bytes** and contained:

| field | why it matters |
|---|---|
| `wallets.knownWallets` — **3 entries** | every other wallet that person has linked; `buildPublicProfilePayload` forces this to `[]` |
| `faucet.cooldownReady`, `faucet.nextClaimAt` | the code's own comment marks these *"owner-only"* |
| `discord.username`, `globalName`, `linkedRoleFlags` | the public view is reduced to `displayRoles` alone |
| `holdings.balance` | live token balance |
| `governance`, `quiz`, `games`, `participation`, `recentActivity`, `proofOfValue`, `milestones` | full activity history |
| `publicView` flag | **absent** — confirming this was the private payload |

The existence of `buildPublicProfilePayload`, and its explicit comment that
faucet cooldown status *"is owner-only"*, is what makes this unambiguous: the
project had already decided these fields were private, and one route handed
them out anyway.

**Fix.** Supplying a wallet address is not evidence of controlling it, so the
full payload is now released only when a valid session proves the caller *is*
that wallet's owner (`session.discordUserId === hit.discordUserId`). Everything
else receives exactly what `/api/profile/public` returns. Response for an
unauthenticated caller went **42,718 → 2,682 bytes**.

The client's legitimate use — session expired, wallet still remembered in this
browser — still works; it now passes its session when it has one, and otherwise
degrades to the public view, which is correct, because at that moment the server
has no evidence of ownership either.

**Client fix required alongside it.** `isPublicView()` derived the view mode from
the *URL* only. That was safe only while the endpoint handed everyone the full
payload. Now the URL can say "owner view" while the response is public, so the
server's `publicView` flag wins — otherwise owner-only sections would render
empty instead of hiding.

**Regression test:** `test/mole/profileByWalletPrivacy.test.mjs` — 4 tests
against the real server on an isolated data dir. Asserts the unauthenticated
response is flagged `publicView`, carries no `knownWallets`, none of the
owner-only faucet fields, and — the check that catches a future field being
added carelessly — that a second linked wallet appears **nowhere in the raw
response body**. An invalid session is treated as no session. **Verified to
actually fail:** reverting the one-line fix failed 3 of the 4 tests.

> ⚠️ **This is a backend fix — it needs a server restart, not a file upload.**
> `web.js` is server-side. Until the backend restarts, the live endpoint remains
> exploitable. The client half (`profile.js`) is static and does need uploading,
> but uploading it alone does not close the hole.

---

### 28. `/profile/` — a redirect stub, and three indexable URLs for one dashboard

`/profile/index.html` is a 1,726-byte redirect stub to `/verify/profile.html`
(the real 42 KB dashboard + 52 KB of JS, which belongs to `/verify/`'s own
audit). The stub is well built: meta-refresh **plus** a JS fallback **plus** a
visible link, so it works with JavaScript disabled, and it preserves
`search` + `hash` so a deep link survives the hop.

**`/profile.html` at the site root is a byte-identical second stub** to the same
target. So the dashboard has three live URLs — `/profile/`, `/profile.html`, and
`/verify/profile.html` — and **neither stub carried `noindex`**, leaving two
thin "redirecting…" pages competing with the real dashboard in search results.
Both now carry `noindex, nofollow` and a canonical pointing at the real page.

**The wider pattern, recorded as register item 20:** of **30 redirect stubs**
across `src/public/`, only **6** carry `noindex`. This is the same family as
items 6 (4 of 57 pages have `rel=canonical`) and 8 (permanent redirects served
as 302) — duplicate-route hygiene, best fixed in one deliberate pass rather than
folder by folder.

**Confidence: HIGH** — the vulnerability reproduced against the live API and
closed against a real server in test; stub behaviour read directly.

---

### 29. `/proof-of-value/` — the page told two different untruths about its own engine

One 10 KB `index.html`, no JS. Links resolve, no overflow at 1440 or 390, no
console errors. The parts that were right were right precisely: the four
signal weights (25% each) match `POV_WEIGHTS` exactly, and every tier boundary
on the ladder — 0/20/45/70/90 — matches `TIERS` exactly.

Two things did not match, and both had drifted silently because nothing tied
the prose to the constants.

#### It described a curve the engine stopped using

The page said each sub-score scales "with diminishing returns (**a square-root
curve**)". That was true of v2.4. `POV_CURVE_EXPONENT` is **0.75**, changed from
0.5 on 2026-07-30 in v2.5 — deliberately, and documented in
`proofOfValue.js:35-55`: the owner had reached 67 after two weeks and called for
the top to be "a ~6-month task". Describing it as a square root understated how
much work the back half now takes. Rewritten to describe the real shape without
naming an exponent, so it stays true if the number is tuned again.

#### It denied affecting payouts, while affecting payouts

> "Proof of Value is explicitly informational — it's a status and recognition
> layer, and it **never touches a payout-eligible field** (quiz points, faucet
> claims, or game payouts directly)."

Not true. `povRewardMultiplier()` feeds `getCombinedRewardMultiplier()`, which is
passed to `validateRewardClaim()` as `rewardMultiplier` and drives the amount
actually banked. Traced to two live call sites: **`quiz/db.js:51`** and
**`web.js:2996`**. A Legend earns **+12%** on the same claim a Newcomer makes
(Contributor +5%, Pillar +8%), stacking with Clout's +5% under a combined
**+25%** ceiling.

Hiding that on the page whose entire argument is *"we reward participation, not
wealth"* was backwards — **the bonus is the argument**. And a user comparing two
payouts for identical work had no way to explain the difference. Now stated
plainly, with every percentage, both caps, and the fact that the multiplier
never drops below 1 (no penalty for being new).

**Scope corrected while verifying it:** the faucet is **not** affected. It pays a
flat `DRIP_AMOUNT` to every claimant regardless of tier, and nothing under
`src/faucet/` mentions a multiplier at all. `rewardMultipliers.js`'s own header
claimed "faucet service.js" was a caller — it never was. Comment corrected with
the three verified call sites and the faucet's exclusion called out as
deliberate design, since an equal-drip faucet is the one place a tier bonus
would feel least fair.

#### Pinned so it cannot drift a third time

`test/mole/proofOfValue.test.mjs` gained four tests that parse the published page
and compare it against the engine: every printed tier bonus must match
`POV_REWARD_MULTIPLIERS`, every printed boundary must match `TIERS`, the page may
not call the curve a square root while the exponent isn't 0.5, and it may not
claim payouts are untouched while any multiplier exceeds 1.

They compare **rendered text**, not markup — the tier ladder splits each label
and its range across separate spans, so "Legend" and "90" are adjacent on screen
but not in the HTML. Strict about numbers, loose about wording, so the page stays
free to be rewritten. **Verified to actually fail:** changing Legend to 1.2 in
the engine failed the bonus test with "page must state Legend +20%".

**Confidence: HIGH** — every constant read from the engine, both multiplier call
sites traced, the faucet's exclusion confirmed by searching all of `src/faucet/`.

---

### 30. `/quiz/` — closes two open register items, and one page that talked itself out of its own feature

`index.html` + `js/app.js` + `css/quiz.css`. All internal links resolve, no
overflow at 1440 or 390, no broken images, no console errors.

#### Register item 5 — RESOLVED: the bank is exactly 242

Counted from source: **115 regular** (Easy 40 / Medium 35 / Hard 40) plus
**127 sponsor** (XYO 72, WinLEW 55) = **242**, matching the figure recorded when
the item was opened. **No "250+" claim survives anywhere in `src/public/`** — the
overclaim the item warned about is gone. Item closed.

#### Register item 4 — RESOLVED: the live cadence is quarterly

The item said cadence "cannot be determined off-box" because quiz reads come
from the serving machine's local `db.json`. With the API back up it can now be
read directly: `/api/quiz/cycle` returns **`C3`, 2026-07-02 → 2026-10-01 = 91
days**. Quarterly, on the original `C` prefix.

That reconciles cleanly with everything else: `db.js` defaults to
`DEFAULT_CYCLE_LENGTH_DAYS = 91` / `DEFAULT_CYCLE_PREFIX = 'C'`, and
`docs/quiz-sponsor-split-and-cycle-cadence.md` states the monthly switch **"has
not been"** triggered. The `/cycleswitchmonthly` command exists and was never
run.

**And no public page states a cadence at all** — the only two "weekly" hits in
`src/public/` are about the Dashboard's *weekly activity summary*, not payouts.
So there was nothing to correct. Item closed.

> A note on method: my own working memory recorded that quiz cycles had been
> "switched quarterly→weekly live". The live machine says otherwise. The
> recorded note was wrong, and checking the box rather than trusting the note is
> the only reason that didn't become a published error.

#### The page sent visitors to Discord to use a feature it already offers

The kicker read *"played in Discord • tracked here"* and the sub-heading *"The
WinLEW quiz runs in Discord… This board is your live scoreboard."*

Both understate it. `/api/quiz/play/next` and `/play/answer` are live and
session-gated, and the **Daily Quiz** and **Sponsor Quiz** sections further down
the same page are a full play surface with a per-day cap
(`QUIZ_WEB_DAILY_CAP`, default 20 scored answers). The page was telling people
to leave for Discord while offering them the quiz two screens below.

Rewritten to say you can play here or in Discord, on the same question bank,
points balance and payout queue.

#### Verified true — no change

- **"minimum per redemption (matched to one faucet drip)"** — true in
  production. The live faucet reports `rules.amount: 1500` and
  `QUIZ_MIN_REDEMPTION_WINLEW` is 1500.
- **"2BRZ 🔜 Coming soon"** — honest: the sponsor pools are XYO and WinLEW only,
  with no 2BRZ questions, so the disabled tile is not faking a feature.
- **"same redeemable points balance, same queue, same payout worker"** as
  Discord `/redeem` — the web redeem path writes the same pending-redemption
  record.

#### One latent fragility, guarded rather than changed

The two constants behind the "matched to one faucet drip" claim have **different
code defaults**: `QUIZ_MIN_REDEMPTION_WINLEW` falls back to **1500**,
`DRIP_AMOUNT` to **1000**. Production sets both to 1500 via env, so the claim
holds today — but leaving `DRIP_AMOUNT` unset would silently falsify a published
statement.

Deliberately did **not** change a money default, which is the owner's call.
Instead both declarations now carry a cross-reference naming the other and
saying they must move together.

**Confidence: HIGH** — question pools counted from source, cadence read from the
live machine, drip amount read from the live API, play routes traced server-side.

---

### 31. `/roadmap/` — the page that promises to say what's real, omitting six things that are

`index.html` only. Static, **zero API calls**, 40 cards. No console errors, no
overflow at 390, all eight status filters work, all internal links resolve.

The framing is genuinely good and I want to say so before the findings: *"A
living document, not marketing"*, *"Planned ≠ guaranteed — we say which is
which"*, every status defined inline in a legend, and a Research section that
opens **"Research items are not commitments."** That is a better standard than
most projects set for themselves. Every finding below is this page failing its
own standard, not a low one.

#### The shape of the problem: nothing connects this page to the registry

`src/mole/modulesData.js` is the canonical registry — 24 modules, 5 roadmap
phases, `validateModulesRegistry()`, `npm run modules:validate`. `/roadmap/`
makes **zero** calls to it and shares **zero** vocabulary with it. Its six
statuses (Complete / In Progress / Planned / Research / Partnership / Future
Goal) exist nowhere in `ROADMAP_ITEM_STATES` or `MODULE_STATUSES`.

Divergent vocabulary is defensible — a public roadmap can speak plainer than an
internal registry, and this one defines its terms. What is not defensible is
that the page was hand-maintained with no check of any kind, so the registry
moved and the page didn't. Which is exactly what `/modules/system/` — a page
published during audit #23 — warns against in as many words: *"Never hand-edit
the same status across multiple HTML files."*

#### Six things the registry knows that the page didn't say

| Registry | State | On the page |
|---|---|---|
| `proof-of-value` | live, Phase 4 COMPLETE | **absent — zero mentions** |
| `cross-chain-bridge` | deferred, retention guarded in code | **absent** |
| `governance` | live, 100%, Phase 5 COMPLETE | **absent** (yet linked from 3 CTAs) |
| `mobile-app-beta` | beta, Phase 4 live | **absent** |
| `platform-v2-enhancements` | planned, Phase 5 NOT_STARTED | **absent** |
| `quests-progression` | partial, 40% | **absent** |

Two of these are worse than the others.

**Proof of Value appeared zero times.** It is the idea the entire project is
organised around — the site has a whole page titled *"Proof of Value, NOT
Wealth"* — it is a live module, and Phase 4 records it COMPLETE. A roadmap of
this project that never mentions it is not a roadmap of this project.

**The Cross-Chain Bridge is the one item the code explicitly protects.** A
2026-07-12 product decision recorded it as *retained* on the roadmap — deferred,
not cancelled — and `validateModulesRegistry()` carries a dedicated block that
fails loudly if that is reversed in code. Meanwhile the public roadmap it is
"retained on" didn't mention it at all. The guard was protecting a promise no
visitor could see. The page also had no vocabulary for *deferred*: committed-
then-paused isn't "research" and isn't "planned", so a `⏸ Deferred` status was
added to the legend, the filter row, and the chip styling rather than
misfiling the Bridge under a state that flatters it.

#### Two numbers, one wrong from birth and one that rots on a schedule

**"17 of 23 Platform Modules Live."** The live count was right. The total was
never right — `MODULES` has held **24** entries since the registry's first
commit (`bed5538`), so this was wrong the day it was typed, not gradually. Now
17 of 24, and asserted against the registry by test.

**"WinLEW Website v3.3.3."** True on 2026-07-19 when the page was built. False
by 2026-07-26 (v3.3.4). False again now (v3.3.5). A static page with no API
calls has no mechanism to keep a version current, and this project has already
been burned by precisely this once before — `RELEASE_VERSION` was hardcoded, went
stale, and now reads `package.json`. The milestone here was the unification, not
the digits, so the card is now **"Unified Website Platform"** and a test fails if
any `vN.N.N` string reappears on the page.

#### A card that contradicted its own chip

The **XL1 Integration** card was chipped `🗓 Planned` — defined on that same page
as *"Direction set, not yet started"* — while its body read *"**Continue**
integrating WinLEW records into XL1."* Both cannot be true.

The code says which one is: nothing writes any WinLEW record to XL1. The only
XL1 touchpoint that exists is **read-only** — `web.js:270` reads a linked XL1
wallet out of the GeoAgora ownership summary to build a profile link. The other
34 XL1 references are a CoinGecko price ticker and quiz questions *about* XL1.
The registry itself states there is no official public XL1 bridging mechanism
yet. Reworded to say it hasn't started, to describe the read-only reality, and
to make the dependency explicit.

#### Smaller

- Quarter tags carried **no year** (`Q3`, `Q4`). On a self-described living
  document a bare "Q4" reads as permanently-almost-here however long it sits.
  Now `Q3 2026` / `Q4 2026`, so a stale item becomes visibly stale.
- The completed card **"Discord Bot Integration"** is the registry's
  `discord-web-parity`; retitled to **"Discord ↔ Web Parity"** so one thing
  doesn't carry two names, and its copy now makes the checkable claim (shared
  settlement logic) rather than the vague one.
- **`Sponsors & Partners`** is live in the registry but the page showed only
  "Partner Expansion" as in-progress — implying partnerships are upcoming rather
  than existing. Added as complete alongside the in-progress expansion.

#### Guarded by test, and the test's own bug

`test/mole/roadmapPageRegistry.test.mjs` (5 tests): module counts match the
registry, no hardcoded version, the Bridge stays visible, every Phase 4/5 item
appears, and no card uses a status the legend doesn't define (or vice versa —
a filter with no cards renders an empty page).

Verified by reverting each defect: deleting the Bridge card fails 2 tests,
dropping Proof of Value fails 1, reintroducing a version string fails 1.

**That verification caught a real bug in my own test.** The first run of the
Bridge check *passed* after I had deleted the Bridge card. Cause: I stripped
HTML tags and `<!-- -->` comments, but not `<style>` and `<script>` **bodies** —
so the CSS comment I had written explaining the Deferred chip, which contains
the words "Cross-Chain Bridge", was being counted as visible page text and
satisfied the assertion on its own. A test that only ever passes proves
nothing; this one needed to be watched failing first. Both blocks are now
dropped wholesale before text extraction.

#### Checked, no finding

- **`/mole-hub/ROADMAP.md`** (publicly readable, register item 19) does **not**
  compete with this page — it is a Gaming Hub *architecture* doc (module layout,
  file responsibilities), not a product roadmap. No contradiction.
- **`images/ROADMAP.png`** is referenced nowhere — already covered by the orphan
  image register item, not re-raised here.

**Confidence: HIGH** — every claim checked against `modulesData.js` directly,
version against `package.json`, XL1 against the full source tree, module count
against registry history, and the rendered page driven in a real browser.
`npm test` 787/787, `modules:validate` clean.

---

### 32. `/scripts/` — a build tool on the live site, and the eight pages its blind spot was hiding

One file: `header-audit.mjs`, 17 KB, **not** gitignored, therefore downloadable
at `https://winlew.co/scripts/header-audit.mjs`.

Read in full first. It is a genuinely well-built local dev tool — serves
`src/public/` on port 8137, drives headless Chrome across 26 routes × 8 widths ×
5 zooms, and reports nav/header geometry. It even carries proper path-traversal
protection (`withinRoot()`). **No secrets, keys, tokens or internal hostnames**
— the `token` matches are its own local report-correlation protocol. Nothing on
the site loads it, and it imports `node:` modules, so a browser could not run it
even if something tried.

So the exposure is low. But it is *tooling*, not site content, and it was the
only one of eleven dev scripts not living in `src/scripts/`. Moved there,
`publicRoot` repointed, and given an npm entry (`npm run header:audit`) like
every sibling.

#### The thing worth finding: its route list had drifted, and the gap was hiding a live bug

`DEFAULT_ROUTES` is what the tool actually visits, so anything absent is a page
whose nav can break unwatched. It had drifted from `nav.js`'s `NAV_GROUPS` by
**13 routes** — `/home/`, `/proof-of-value/`, `/links/`, `/merch/`,
`/mole-link/`, `/no-thank-you/promotions/`, and all seven `/ecosystem/` pages.
The nav e2e test's own `PAGES` list was missing the same 13 plus `/about/`.

Three hardcoded copies of "the list of pages" (`NAV_GROUPS`, `DEFAULT_ROUTES`,
e2e `PAGES`), nothing keeping them in step. Checking what the blind spot
contained turned up a real, live defect:

**Eight pages in the navigation menu had no `PAGE_CONFIGS` entry at all.**
`PAGE_CONFIGS` matching is **exact, not prefix-based**, so they fell through to
`PAGE_CONFIGS[0]` — the storefront. Verified in a real browser at 1440 and 390,
all eight rendered with the storefront's `WELCOME • LEARN • BEGIN` subtitle, its
icon, and **"Home" highlighted as the active link**:

- the seven `/ecosystem/<slug>/` sister-project pages (GeoWallet, GeoAgora,
  GeoJustice, GeoHackers, GeoPresence, GeoProof, uBlock)
- `/no-thank-you/promotions/`

Every one is reachable from the menu on every page of the site.

`/no-thank-you/promotions/` is the sharpest of these: its **parent's**
`PAGE_CONFIGS` entry carries a comment saying the page *"still gets a correct
nav identity rather than silently falling back to Home's"* — written by someone
who understood the trap exactly, for an entry that did not cover its own child.

#### This is the second time, and last time the fix was manual

`docs/site-navigation.md` already records this identical bug: `/bounties/` and
`/who-we-are/` rendered the homepage's identity for the same reason. That fix
added those two pages to the two hardcoded lists **by hand and added no guard**
— so it fixed two pages and left the mechanism intact, and it recurred with
eight more.

Fixed properly this time:
- A `PAGE_CONFIGS` entry for the seven ecosystem pages
  (`ECOSYSTEM • BUILD • CONNECT`). Its `active` id deliberately matches no pill
  — none of the five primary pills *is* one of these pages, so nothing
  highlighting is the honest outcome, rather than highlighting Home.
- `/no-thank-you/promotions/` added to its parent's match array.
- The 13 missing routes added to `DEFAULT_ROUTES`.
- **`test/nav/navRouteCoverage.test.mjs`** parses `NAV_GROUPS` and fails if any
  nav route lacks an exact `PAGE_CONFIGS` entry, if header-audit doesn't visit
  it, or if the tool reappears under `src/public/`. It includes a
  parser-sanity test, because a parse that silently returns nothing would make
  every other assertion pass vacuously.

Verified by reverting: removing one ecosystem path from `PAGE_CONFIGS` fails the
coverage test naming that exact page; putting the script back in the web root
fails the location test. (The first revert attempt was **my** error, not the
test's — a blind `str.replace` stripped the path from `NAV_GROUPS` too, so both
sides lost it and the test correctly saw no gap.)

#### Deliberately not done

The nav e2e `PAGES` list was **left alone**. It drives real browsers × 3
viewports, so adding 14 routes means +42 browser tests for a property the new
static test already guarantees more cheaply. Noting the choice rather than
quietly widening the slowest suite in the repo.

**Confidence: HIGH** — script read end to end, secrets scanned, all 26 routes
resolved to real files, the three page lists diffed programmatically, and the
defect confirmed and then re-confirmed fixed in a real browser at two viewports.
`npm test` 791/791.

---

### 33. `/no-thank-you/` — BACKFILL: the anti-shill page gave away a vote it can't give

**This folder was skipped by the alphabetical pass** — it sits between
`/mole-link/` (#25) and `/partners/` (#26) and no entry was ever written. Found
while auditing `/scripts/`, and audited here in full. Exactly the failure mode
this document's own resume rule warns about.

Two pages, both static, zero API calls. All internal links resolve on both.
Nav identity for `/no-thank-you/promotions/` was broken and is fixed in #32.

#### `/no-thank-you/` — the asset-folder deterrent

Correctly `noindex, nofollow`, and correctly wired: `/images/`,
`page-headers/` and `page-icons/` all redirect here instead of listing.

One overclaim: *"Every real image on WinLEW is already shown in context, on the
page it belongs to."* Audit #19 established that **23 files in `/images/` are
referenced by nothing on the site**. Small, but self-defeating on the one page
whose job is to tell a scraper there's nothing here worth taking — the folder
does hold things shown nowhere. Narrowed to "the images this site actually
uses".

#### `/no-thank-you/promotions/` — good page, one claim it can't back

Deliberately `index, follow` (its sibling is `noindex`), and the comment
explaining why is right: it's the link to reply to promo DMs with, and the page
that lets anyone check an "I'm sponsored by WinLEW" claim. The content is
strong and the position is unambiguous — *"if someone says WinLEW is paying
them to promote it, they're lying."*

**The finding:** under *"What we do instead — earn it, don't get gifted it"* it
said:

> Governance — verify your wallet and you get a free vote, because you took the
> time.

That is false. Voting requires a verified wallet **holding at least 1,000,000
WinLEW** — `GOVERNANCE_CONFIG.minWinlewToVote`, enforced at `web.js:1435`.
Verification alone gets you nothing. And the rest of the site says so correctly:
`/governance/`, `/governance/rules/` (twice) and the Discord command text at
`commands.js:421` all state the figure. This page was the only surface
contradicting it.

The irony is the point. A page arguing that standing must be earned rather than
gifted described a million-token gate as free-for-showing-up — the exact shape
of overclaim it exists to oppose. Rewritten to state the requirement plainly
while keeping the argument: *"It isn't bought and it isn't granted by us, but it
is held."*

Two sibling bullets had the same shape of omission and now say so: the
**faucet** needs a linked wallet already holding WinLEW
(`FAUCET_MIN_HOLDER_BALANCE`, default 1, holder check on by default), and quiz
**redemption** is holder-only (`redemption.js:91-122`) even though playing and
earning points is free. The lead-in *"no DM required, no follower count
checked"* was kept — that is the real contrast with a paid-promo deal, and it
is true.

#### Guarded

`test/mole/governanceMinimumPublished.test.mjs` asserts the three pages stating
the minimum agree with `GOVERNANCE_CONFIG`, that none reintroduces the
verification-alone wording, and — guarding its own premise — that eligibility is
still balance-gated at all, so if voting ever genuinely became free the prose
gets revisited rather than the test quietly enforcing a stale rule. The figure
has moved once already (1 → 1,000,000 on 2026-07-17), which is why it needs
pinning. Verified failing against the original wording.

**Confidence: HIGH** — eligibility traced from the public claim through
`resolveSnapshotEligibility` → `checkLiveWinlewEligibility` →
`GOVERNANCE_CONFIG.minWinlewToVote`; faucet and quiz gates read from source;
links resolved; nav verified in-browser. `npm test` 794/794.

---

### 34. `/sponsors/` — one 455-byte stub, and the sitewide sweep it was the last excuse to postpone

`/sponsors/` is a single redirect stub to `/partners/` (audited at #26). It is
correct: canonical present, redirect preserves `location.search` and
`location.hash`, `PAGE_CONFIGS` gives it the right identity for the moment
before the jump, and nothing on the site links to it — it exists purely so an
old or guessed URL lands somewhere real. Verified in a browser.

Its only defect was the one **register item 20** describes, and since this
folder's whole content *is* a redirect stub, this was the right moment to do
the sweep that item asks for rather than fix one file and move on.

#### Register item 20 — RESOLVED: all 38 stubs, not the 6 that had it

The item recorded "only 6 of 30 redirect stubs carry `noindex`". A full walk
found **38** stubs (the earlier count was low), of which **23 were missing it**
— including `/verify.html`, `/health.html`, `/winlew-forge.html`,
`/discord-bots.html`, and all eight root-level `terms*.html` / `privacy*.html`
twins of the real nested policy pages. Every one could be indexed in place of
the page it points at, so a searcher lands on a page whose only content is the
word "redirecting".

All 38 now carry `noindex, nofollow`.

#### Canonical: added where it's true, removed where it isn't

The same pass would naturally have added a canonical to all 34 stubs lacking
one. That would have been wrong for two groups, and I removed 13 canonicals I
had just added once the targets were checked:

- **Directory guards** (`/images/`, `/images/avatars/`, `page-headers/`,
  `page-icons/`, `/geo-index.html`, `/geowallet-index.html`) point at
  `/no-thank-you/`, which is **itself `noindex`**. A canonical naming a
  noindex page as the real version of this one is a contradictory signal.
- **Pre-launch lockdown stubs** (`/geoagora/*`, `/geohackers/index.html`) point
  at `/`. A canonical there tells a crawler the stub *is* the storefront, which
  already has its own canonical.

`noindex` alone is the correct and sufficient signal for both. Canonical was
kept or added only where a stub is a genuine alias of one specific real page —
`/verify.html` → `/verify/`, `/terms.html` → `/discord-bots/terms.html`,
`/sponsors/` → `/partners/`, the three `/game-hub|gamehub|gaming-hub/` spellings
→ `/mole-hub/`. 25 stubs carry one; 13 correctly do not.

`landing.html` was left as-is: it already had `noindex` and its canonical to `/`
is legitimate, because it genuinely is an alias of the homepage.

#### Guarded

`test/nav/redirectStubHygiene.test.mjs` walks `src/public/`, finds every file
under 3 KB containing a redirect, and fails if any lacks `noindex` or declares a
canonical pointing at `/no-thank-you/`. Includes a collector-sanity assertion,
since a broken walk would make the rest pass vacuously. Verified failing with
`noindex` stripped from `/verify.html`.

Ten representative redirects were then driven in a real browser to confirm the
inserted `<meta>` didn't disturb the redirect script — all ten land on the right
page.

**Confidence: HIGH** — stub set enumerated programmatically rather than by
guesswork (which is how the original count of 30 came in low), every canonical
target checked for indexability, redirects confirmed in-browser. `npm test`
797/797.

---

### 35. `/transparency/` — every hard number checks out; the prose under-counted its own locks

`index.html` + `js/app.js`. One endpoint (`/api/transparency/status`), nine
tracked components, three market addresses. This is the page with the most to
lose from being wrong, so almost everything here is verification rather than
correction — and almost everything held.

#### Verified on-chain, 2026-08-05 — all true

Read directly from Solana rather than taken from the page or the backend:

| Claim | On-chain |
|---|---|
| Total supply | **950,000,000** ✓ |
| Mint authority | **null — renounced** ✓ |
| Freeze authority | **null — none** ✓ |
| 50M Token Lock | **50,000,000.00** exactly ✓ |
| 15M Team Lock | **15,000,000.00** exactly ✓ |
| Streamflow (22M) | **22,069,652.82** ✓ |
| Streamflow (7M) | **7,013,300.00** ✓ |
| Graduation "July 22, 2026" | PumpSwap pool created **2026-07-22T15:59:15Z** ✓ |
| Historical pump.fun market "reporting no liquidity" | reserve **$0.00** ✓ |

**All five `.sol` names re-resolved live via SNS** and every one still points at
the address it is listed against: `burn.winlew.sol`, `winlew.sol`,
`diglew.sol`, `dev.winlew.sol`, `lewsales.sol`. This mattered more than usual —
`/partners/` (#26) found a lapsed registration presented as current, and a
`.sol` primary-domain bug was fixed on 2026-07-30, so these were checked rather
than trusted. They are clean.

**The "never invents a number" promise is real.** `app.js`'s header comment
claims a failed lookup shows "temporarily unavailable" and never falls back to a
zero. Tested by rendering the page against a backend returning 502: all seven
live stats showed `—`, **zero** `.statVal` cells showed a fabricated `0`, a
plain error notice appeared, and there were no console errors at either 1440 or
390.

**The burn wallet is described precisely.** It holds 50,000,000 — the same
figure as the total destroyed to date — which is exactly the coincidence that
invites a reader to double-count. The component text pre-empts it: *"The balance
shown is what's currently in the wallet, **not yet destroyed**."* 50M destroyed
plus 50M staged also reconciles with the stated 100M long-term target.

#### The finding: the tokenomics paragraph under-reports the locks it lists

The summary read:

> a 50M lock and a 15M team lock were placed via Jupiter Lock, **22M+ was placed
> in a Streamflow vesting contract**

There are **two** Streamflow contracts. The second holds **7,013,300** tokens on
a full cliff to Oct 29 2030, and `web.js` records that it *"was previously
missing from the Transparency Center entirely"* before being added as a live
component on 2026-07-17. The component was added; the paragraph one section
below was not updated. So the page listed the lock and then under-reported it —
**94.08M of locked supply summarised as 87.07M**.

Nobody was misled in a self-serving direction (the error understates how much
is locked), but a transparency page cannot carry a quiet undercount, and the
fix is one sentence.

#### "Active" was doing unquantified work

The markets table labelled both live pools "Active" with no figure attached.
The page's own rule — Active means it has liquidity, Historical means it
doesn't — is fair and correctly applied. But re-verified 2026-08-05:

- PumpSwap `Hmif…` — depth **$5,603**, 24h volume **$0.00**, zero trades
- Raydium `5nTz…` — depth **$601**, 24h volume **$0.00**, zero trades

"Active · established" over $601 of depth invites a reader to picture more than
is there. Depth now appears beside each label with its verification date, and
the Raydium row says plainly that it is thin and that PumpSwap is the primary
route. Depth is quoted rather than 24h volume on purpose: volume swings hourly
and would be stale in static HTML within the day, while depth is the stable
figure that decides whether a market is usable. The stale "last verified
2026-07-24" line was moved to 2026-08-05, since I had just re-verified it.

#### Guarded

`test/mole/transparencyPageClaims.test.mjs` — the tokenomics prose must account
for every Streamflow component in the registry (fails on the old singular
wording, verified); the mint printed on the page must equal the canonical
`MINT` constant and be the only mint-like address shown, since the page tells
readers to "always verify the mint"; no page address may be unknown to the
backend; and total supply must never be hardcoded, because it falls with every
burn and the page promises it is read live.

#### A second correction, caught by the fact register doing its job

The page called `H3HoYtV5…` the **"Historical pump.fun launch market"**, under a
heading reading "Historical Launch Infrastructure". It is not the launch market.

I first logged this as an open question for the owner. That was wrong: the fact
register already settled it on **2026-08-04** at HIGH confidence — *"`H3Ho…` is
**not** the launch market — it post-dates Raydium by 5 months."* My own 2026-08-05
reads agree: pump.fun pool created **2025-07-19**, Raydium **2025-02-10**, and
the stated launch is December 2024.

This is the register earning its keep, and a reminder to consult it *before*
opening a new question rather than after. Corrected to "Superseded pump.fun
market", with the creation date stated and the bonding-curve launch described
separately — the token did launch through pump.fun, just not through this pool.
On a page whose stated purpose is that WinLEW "does not rewrite or hide its
history", getting the order of its own markets wrong is the worst available
error.

#### Method note

**`winlew.co` returned 403 to every request from this machine — including the
plain HTML page**, not just the API. That is my egress being blocked, not an
outage, and it is a broader block than the User-Agent trap recorded earlier.
Live-API verification was therefore impossible from here; everything above was
verified against Solana RPC and GeckoTerminal directly instead, which is the
stronger source anyway.

**Confidence: HIGH** for every on-chain figure (read from chain, not from the
site). The only unverified item is how the live endpoint renders in production,
for the access reason above.

---

### 36. `/verify/` — the safety claims are all true; the handoff link was not treated like the credential it is

The wallet-link flow. Audited deliberately slowly, read-only first, and one
planned fix was **reverted rather than shipped** because it could not be
verified here (below).

#### The headline claims are true — checked, not assumed

> **Security note:** this flow uses a one-time ownership signature only.
> It does **not** request a transaction and it cannot move funds.

- **"cannot move funds"** — `link.js` references **no** transaction API at all:
  no `signTransaction`, `signAllTransactions`, `sendTransaction`,
  `signAndSendTransaction`, no `Transaction`, `SystemProgram` or transfer. It
  uses `signMessage` only, and a wallet is not even considered usable unless it
  exposes `solana:signMessage`.
- **"one-time"** — enforced server-side. `getActiveChallenge()` refuses a
  `used` or expired challenge, and `completeLink()` sets `used = true` **after**
  the signature verifies (so a mistyped attempt doesn't burn it). 5-minute
  expiry.
- **Replay across accounts is blocked** — the signed message must contain the
  exact nonce, `Discord: <id>` and `Expires: <ts>`; Ed25519 is verified
  server-side with `nacl.sign.detached.verify` against the claimed pubkey, with
  signature and key length checks and a base58 guard.

The `api-proxy.php` boundary is also in good shape: dot-segments rejected
before the prefix allowlist (with a comment explaining that curl normalises
`..` itself), a redirect host allowlist, a fresh header list so nothing the
browser sends is forwarded, and the client-IP claim only honoured alongside a
shared secret. `api-proxy-secret.php` is gitignored via `**/*secret*` and has
never been committed.

#### The finding: the verify link is a bearer credential, and it was being posted to a third party

`/verify/` is opened from Discord as `/verify/?session=<token>`. That token can
complete a link and repoint the account's **faucet and payout wallets**
(`buildVerifiedWalletRecord`), for 15 minutes.

The desktop handoff drew its QR by setting `img.src` to
`api.qrserver.com/v1/create-qr-code/?…&data=<the whole verify URL>` — **token
included**. It fired automatically on every desktop load, including for people
who never expanded that collapsed section, because an `<img>` fetches whether
or not its `<details>` is open.

Demonstrated rather than argued: serving the pre-fix files in a real browser
with `?session=SECRETTOKEN123`, the outbound request to `api.qrserver.com`
contains the token. (The request was aborted in the harness; nothing real was
sent.)

The QR is removed rather than reimplemented. A hand-rolled QR encoder is
precisely the change that cannot be verified without a scanner, and this is not
the page to ship unverifiable code to. **Copy link and the Phantom/Solflare
handoff buttons — the paths that actually complete the flow — are untouched**,
and `.handoff`'s grid went from `220px 1fr` to `1fr` so the remaining content
doesn't sit in the vacated 220px column. Restoring a QR later means a local
encoder or a one-time handoff code minted by the backend; both are noted as
follow-ups, neither is a blocker.

The page also now says what the link is. Its only security note was about
signatures — true, but it would leave someone thinking the copyable link is
harmless, on the page where a stuck user is most likely to paste what's on
screen into a help channel.

#### A sibling proxy was quietly undoing the verify proxy's allowlist

`/geoagora/api-proxy.php` (and its identical twin under `assets/`) had **no
path allowlist and no dot-segment rejection**. `?path=/../api/…` produced
`<base>/geoagora-api/../api/…`, which curl normalises to `<base>/api/…` —
escaping the prefix and reaching any backend route, bypassing the control
`/verify/api-proxy.php` enforces for exactly this reason. Both also echoed the
full `$target`, publishing the tunnel URL to any visitor whenever it was down.

Severity is bounded and stated honestly: the backend's only non-`/api` routes
are `/health`, `/link`, `/linked-role` and `/discord-oauth-callback`; there are
no admin or debug routes, `/link` only redirects, the callback 400s without a
valid code, and this proxy never forwards `Location`, so it is not an open
redirect. The point is that the allowlist exists so a *future* route can't
become publicly reachable by accident — and a copy of the file next door
removed that guarantee. Same shape as the `PAGE_CONFIGS` recurrence in #32: the
fix landed on one file and not its siblings.

Dot-segments now rejected (regex copied verbatim from the hardened proxy) and
the target no longer echoed.

#### Deliberately NOT shipped

I had also removed `curl_error()` from `/verify/api-proxy.php`'s error body
(project precedent: raw errors are logged, never returned). **Reverted, and the
file is byte-identical to HEAD.** There is no PHP binary, container or Windows
PHP available in this environment, so the edit could not be syntax-checked —
and that one file gates *every* API call the site makes. An unverifiable change
to it, while the owner is away and slow to restore, is not worth a tidier error
string. Logged as a register item to land when a parser is available.

The `/geoagora/` copies were kept to a different standard on purpose: they are
off the critical path, and a PHP fatal there fails *closed* (the open proxy
stops working), which is the safe direction. Their diff was reviewed
content-only and the added regex is byte-identical to the proven one.

#### Black text — the same root cause, twice more

Raised by the owner mid-audit with a screenshot of the Dashboard. Swept all
**64 real pages** in a browser, computing each element's colour against its
effective background:

- **`/verify/profile.html`** — `.pill,.btn` set background, border and weight
  but **no `color`**. `<a class="btn">` looked fine only because of
  `a{color:inherit}`; the **24 `<button class="btn">`** on the page fell back to
  the UA's black — "Copy address", "Disconnect", "Reconnect / switch wallet" at
  **1.08:1** against AA's 4.5:1. Exactly the owner's screenshot.
- **`/mole-hub/`** — `.catalog-lane` is a `<button>` with no `color`, on a
  near-black gradient. `.catalog-lane p` and the icon set their own colours, so
  only `.catalog-lane-title` ("Instant Web Play", "Mobile-Native Play") went
  black-on-black.

Buttons inherit neither `color` nor `font` — the same root cause as the nav
Connect-Wallet pill fixed on 2026-07-27, in two rules that pass missed. Only
`color` was added, **not** `font:inherit`, which would also change font-size
(button default ~13.3px vs the 16px body) and reflow 24 controls. Verified
after: `rgb(246,239,232)`, `font-size` unchanged at 13.33px.

**The first sweep produced false positives and was rebuilt.** It flagged
`/app/`'s Connect button and `/jdid93hf8dh/`'s download link, both of which are
dark text on a *gold gradient* — correct and readable. A gradient makes
`backgroundColor` transparent, so walking ancestors for a solid colour finds a
dark panel and reports a contrast failure that isn't there. Rewritten to read
the gradient's own colour stops; the rebuilt sweep reports **no dark-on-dark
text on any of the 64 pages**.

#### Guarded

`test/mole/verifyPageSecrecy.test.mjs` — no third-party host may appear in
`link.js` beyond the wallet vendors the user explicitly hands off to; the QR
pattern and `handoffQr` element must not return; the working handoff controls
must still exist; the credential warning must be present; and no
transaction-signing API may appear. Its own first version failed against the
explanatory comment quoting the removed URL — corrected to judge code, not
prose, then re-verified failing against a genuine reintroduction.

**Confidence: HIGH** on every claim checked (signature flow traced from page to
`nacl` verification; leak demonstrated in a browser before and after; contrast
measured, not eyeballed). `npm test` **807/807** — one `/contribute/`
`networkidle` timeout appeared on the first run and passed clean on re-run; it
is a browser-test flake on a page this pass never touched.

---

### 37. `/wallet/` — FAST PASS (owner-flagged as Alpha / soft beta)

Audited quickly at the owner's request, since GeoWallet is pre-release and this
route is skippable. No changes made — the findings are all owner decisions.

**It is not the wallet app.** `/wallet/index.html` is a **static marketing
page**: zero `<script>` tags, no service-worker registration, no manifest link.
"Launch Web Wallet" points at the real deployment on
`aesthetic-pastelito-8546f6.netlify.app`. `./support/` and `./privacy/` both
exist and resolve.

That matters, because the folder *looks* alarming and isn't. It contains
`sw.js`, `workbox-*.js` and a `manifest.webmanifest` declaring
`scope: "/"`, `start_url: "/"`, plus a Workbox
`createHandlerBoundToURL("/index.html")` — all of which, if they were live,
would mean an installed GeoWallet opening the **WinLEW storefront** and a
service worker trying to claim the whole origin. **None of it is wired up**:
the landing page loads none of these files, so nothing registers and nothing
is hijacked. Checked before reporting, rather than raising an alarm off a
grep.

**Verified clean:** no secrets or key-shaped strings anywhere in the folder,
and no keyed third-party RPC hosts (Alchemy/Infura/Helius/QuickNode) baked into
the bundles.

#### Owner decisions, not fixed

1. **7.20 MB of the 11 MB is unreferenced** — a whole `dist/` was copied in and
   the landing page uses 5.35 MB of it. The dead weight includes two app
   bundles at **2.1 MB each** (`index-cxcgskas.js`, `index-BDK3NTMu.js`), an
   1.8 MB `GeoWallet.png`, and duplicate 334 KB icons. Deleting the
   unreferenced set is safe *for this page*, but it is another project's build
   output, so it is the owner's call.
2. **`netlify.toml` is publicly readable** at `/wallet/netlify.toml`. It has no
   secrets, but it documents the private GeoWallet repo's internal layout —
   `apps/web`, `apps/extension`, `packages/*`, the pnpm/turbo build command and
   the `@geowallet/web` target. It is inert on this host (openresty, not
   Netlify). Same family as register item 19. `_redirects` / `_redirects.txt`
   are likewise inert Netlify SPA-fallback files.
3. **`robots: index,follow`** on a soft-beta product page. Flagged, deliberately
   **not** changed: this is a marketing page with a launch CTA, so being
   indexed is plausibly the intent — unlike `/merch/`, which was noindexed
   precisely because it was *not* meant to be found yet. Worth one conscious
   decision either way.

**Confidence: HIGH** on what was checked (page behaviour read from source,
secret scan run, byte accounting measured). Not a full pass — no live render,
no content-accuracy review of the marketing copy, by agreement.

---

### 38. `/whitepaper/` — the hand-maintained twins really are in sync; one date wasn't

`index.html` (45 KB, served) + `whitepaper.md` (29 KB, the "Download Markdown"
copy). The page does **not** render the markdown — they are two independently
hand-maintained copies of the same document, a drift risk on record since the
2026-07-16 polish pass.

**They are in sync, and that deserves saying.** Compared three ways: all 14
section headings match; every substantive figure (thousands-separated amounts,
precise decimals, percentages) appears in both with **zero** on either side
alone; and a sentence-level prose diff surfaced only page chrome and artefacts
of my own normaliser. Someone has kept these aligned by hand across many edits.

#### Verified against the chain today, not against the site

The token-identity table checks out completely — mint
`Dnrcd…pump`, decimals **6**, total supply **950,000,000**, **mint authority
None (renounced)**, **freeze authority None** — all read directly from Solana
during the `/transparency/` pass earlier the same day. "32 verified
transactions" matches the burn register.

The supply-reconciliation passage is also correct and well-judged. It states
the ~292,922 gap plainly, explains it as early recipients burning their own
tokens from their own wallets, and refuses to invent ledger entries to make the
arithmetic close — matching register item 1's resolution without overclaiming
certainty about attribution it cannot have.

#### The finding: the downloadable copy had no date

The served page carries **"Last updated: 2026-08-01. This is a living document
— see §14."** The markdown twin carried only "Version 1.0 · Built on Solana".

So the copy a reader *keeps* — the portable one, the one that gets forwarded and
quoted — was the one with no way to tell how current it was, on a document whose
own §14 is about being a living document. Added to the markdown header,
matching the served page exactly. The date was **not** bumped to today: no
content changed, and moving it would falsely imply the figures were re-checked.

My substantive-figure diff nearly missed this, because a bare `2026-08-01`
matches neither the thousands-separator nor the decimal pattern. The
sentence-level diff is what caught it.

#### Guarded

`test/mole/whitepaperTwinsInSync.test.mjs` — every markdown section must appear
on the served page; both copies must quote exactly the same figures (in either
direction); both must carry a `Last updated` date **and agree on it**; and both
must still state the live total supply. Verified failing with the new date line
removed.

Rendered clean at 1440 and 390: 15 `<h2>`, no overflow, no console errors, 42
internal links, and `/whitepaper/whitepaper.md` serves 200.

**Confidence: HIGH** — token identity read from chain, burn figures cross-checked
against the register, twin sync measured three independent ways. One figure
could not be verified from here: the faucet distribution total
(**1,287,846.66** across 1,001 payouts to 41 wallets) comes from
`npm run faucet:scan`, which only produces data on the serving machine.

---

### 39. `/who-we-are/` — a stale burn total, understating the project's own record by 15M

Static, no API calls. Renders clean at 1440 and 390; all 39 internal links
resolve.

This is the page a wallet-security reviewer is pointed at, and it holds up. The
five published addresses (developer, Discord/Web faucet, burn, X faucet, mint)
all match what I read on **chain** during `/transparency/`. "Mint authority is
renounced" — verified on-chain. "10 Public reserve & lock addresses" — 9
`TRANSPARENCY_COMPONENTS` plus the mint, exactly 10. `github.com/LewSales/Discord-Bot`,
offered as "the original bot source is public", returns **HTTP 200** and is
still public.

**The finding:** *"Every confirmed burn (34.8M+ WinLEW so far…)"*. The canonical
ledger says **49,707,077.187484**. The arithmetic identifies the cause exactly —
34.83M plus the 2026-08-01 burn of 14,878,231.210253 is 49,707,077.187484 — so
this line was written before that burn and never updated, while `/burn/` and the
whitepaper both moved. It understated the project's own achievement by ~15M,
which is the safe direction to be wrong in and still wrong on a page whose
argument is "don't take our word for it".

Corrected to 49.7M+ with an "as of" date, and guarded:
`test/mole/whoWeAreBurnFigure.test.mjs` reads `summarizeBurnEvents()` and fails
if the page overstates at all, or trails the ledger by more than a rounding
step — so the *next* burn fails the suite rather than silently ageing the page.
Verified failing against the old 34.8M figure.

**Confidence: HIGH.**

---

### 40. `/winlew-forge/` — one module claimed finished on a page that is otherwise scrupulous

Static page plus one endpoint, `POST /api/forge/ai`. Renders clean at both
widths, 38 links, none dead.

**The endpoint is properly gated** — valid session, then
`isGovernanceMaintainer()` or 403, behind a 10-per-15s rate limit. That matters
because it spends the project's own AI credits, and the page says so plainly:
*"running a brain requires a connected WinLEW maintainer wallet, since it uses
the project's own API keys. Anyone can view the workspace; only maintainers can
run it."* Accurate.

Both advertised brains are real: `routeForgePrompt()` dispatches to
`sendAnthropic()` and `sendOpenAI()`. The image and Web3 catalogues are every
one `status: 'planned'`, matching the page's "Scaffolded" and "Planned" tags.

**The finding:** **📦 Project Vault was tagged "Ready".** Nothing is built —
the page has no `localStorage`, no `indexedDB` and no save path of any kind,
and `/api/forge/ai` is the only Forge route the live backend serves (the
`health`/`catalog` routes live in `src/public-server.js`, a separate dev
server). Its two siblings are honestly tagged "Scaffolded" and "Planned", which
is exactly what made this stand out: on a page whose hero admits the Forge is
internal and half-built, the single module claiming completion was the only
line that wasn't straight. Retagged **Planned**, and "Keep … in one place"
reworded to state the intent and that nothing is stored yet.

**Confidence: HIGH.**

---

### 41. `/xyo/` — the partnership disclaimer is exemplary; one biographical figure doesn't line up

Static, no API calls, clean at both widths, 39 links, none dead. **The last
folder in the alphabetical pass.**

**On the one thing that matters most here, this page is a model.** The fact
register's standing rule is that nothing in this repo establishes an official
XYO partnership, so XYO work must never be described as one. The page says so
three separate times — a header badge (*"Independent community initiative · Not
an official partner"*), a dedicated callout (*"WinLEW is not officially
partnered with, sponsored by, or endorsed by XYO"*), and again in the Journey
section (*"To be explicit: that partnership has not been announced and does not
exist today"*). It even frames an official partnership as an aspiration to be
earned "through years of demonstrated work — not through assumptions."

Two standing decisions are also honoured correctly: every sister-project link
goes to `/ecosystem/<slug>/` rather than the locked-down raw app paths
`/geoagora/` and `/geohackers/`, and **Oxyon is not named anywhere**.

**One item for the owner** (register 29): the page states the founder has been
an XYO community leader for *"roughly five years"* while the WinLEW effort has
been building toward XYO for *"about six years"* — i.e. building toward the
ecosystem a year longer than being a leader in it. It is reconcilable
(*member* for six years, *leader* for five), but as written the ordering reads
oddly on a page whose whole case is "measured by what's shipped and verifiable".
Both figures are owner-stated and unverifiable from this repo, so this is
flagged rather than rewritten — it is his own history to state.

**Confidence: HIGH** on everything checkable; the two year-counts are
owner-stated.

---

## Items needing human confirmation

1. ~~Original token supply unresolved~~ **RESOLVED 2026-08-03.** Original
   1,000,000,000; current 950,000,000; total destroyed exactly 50,000,000, of
   which 49,707,077.187484 is the project ledger and **292,922.812516 was burned
   by holders themselves** (owner-confirmed: airdrop recipients burning outright,
   closing accounts burning remainders). Supply can only fall via a burn
   instruction, so the delta is destroyed tokens by definition. **Now HIGH
   confidence.** Follow-up worth considering: `/burn/` shows 49.7% because it
   counts only project-evidenced burns — on-chain the total is 50.0%. Both are
   true and measure different things; showing both would be more transparent
   than either alone.
2. ~~**Active market pair** `Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL` is
   owner-stated and not yet confirmed on-chain.~~ **RESOLVED 2026-08-04** while
   auditing `/home/`. GeckoTerminal's index resolves that address to a
   **WinLEW / SOL pool on PumpSwap**, created **2026-07-22T15:59:15Z** — which
   independently confirms both the pair address and the "market created July 22,
   2026" graduation date the site states. Liquidity $5,603.26 at time of check.
   Confidence now HIGH. (Third-party index rather than a raw RPC read; a direct
   account fetch would make it unimpeachable, but the dex label and creation
   timestamp both agreeing with the owner's account is already strong.)
3. **Launch date 2024-12-07** is owner-stated; not independently verified.
   Partial corroboration from the pool timeline established 2026-08-04: the
   oldest WinLEW pool (Raydium `5nTz…`) was created 2025-02-10, so trading
   pre-dates that only via the bonding curve, consistent with a Dec 2024 launch.
4. ~~**Quiz cycle cadence cannot be determined off-box.**~~ **RESOLVED
   2026-08-05** (see #30). Read from the live machine once the API was back:
   `/api/quiz/cycle` returns `C3`, 2026-07-02 → 2026-10-01 = **91 days,
   quarterly**, on the original `C` prefix. Matches `db.js`'s defaults and the
   cadence doc's own note that the monthly switch "has not been" triggered. No
   public page states a cadence, so nothing needed correcting.
5. ~~**Quiz bank is 242 questions, not "250+".**~~ **RESOLVED 2026-08-05**
   (see #30). Recounted from source: 115 regular (40/35/40) + 127 sponsor
   (XYO 72, WinLEW 55) = **242**. No "250+" claim survives anywhere in
   `src/public/`.
6. ~~**Site-wide: only 4 of 57 `index.html` pages carry `rel="canonical"`.**~~
   **RESOLVED 2026-08-10.** The deferred repo-wide pass ran.
   `rel="canonical"` added to **61 pages** — every indexable page that lacked
   one. (The count had drifted to 11 by the time the pass ran; the redirect-stub
   work in #20 had added some.) Redirect stubs and `noindex` pages were skipped,
   since #20 already governs those.

   `test/nav/indexingHygiene.test.mjs` now fails if an indexable page ships
   without a canonical, with more than one, or — the assertion that actually
   earns its keep — with one pointing at a **different** page. A missing
   canonical costs a little ranking; a copy-pasted one hands that page's ranking
   away entirely, and nothing looks wrong in a browser when it happens.

   One classifier bug worth recording, because it is easy to repeat: matching
   "has a `robots` meta tag" instead of "the directive contains `noindex`"
   silently excludes `/merch/`, `/wallet/*` and `/no-thank-you/promotions/`,
   all of which carry an explicit `content="index, follow"`.
7. 🟡 **HALF RESOLVED 2026-08-13. The holder count is now better than a
   snapshot; the follower count is owner-only.** Both figures in
   `src/mole/eventsData.js` were 2026-07-17 snapshots.

   **Holder count — upgraded from unverified to on-chain.** It was the weaker of
   the two: 65, owner-supplied, explicitly *never* cross-checked because Solscan
   403s automated access. Now counted directly — `getProgramAccounts` over the
   SPL Token program filtered to 165-byte accounts whose mint field (offset 0)
   is the WinLEW mint: **226 token accounts, 151 empty, 75 holding a balance**,
   resolving to **75 distinct owner wallets** (one account each). The balances
   sum to exactly 950,000,000, matching `getTokenSupply`, which is the proof the
   enumeration was complete rather than truncated. The 100-holder milestone
   still has not triggered.

   Recorded honestly on the page: those 75 include the liquidity pool, the burn
   wallet and the locked reserves, which are addresses rather than people.

   Operational note for the next refresh: this call is heavy enough that the
   primary Alchemy endpoint refused it five times on compute-units before the
   fallback answered. Retry with backoff; do not conclude it cannot be done.

   **Follower count — refresh attempted and failed, do not repeat it.** The
   2026-07-17 method (fetching the live profile page) no longer works: x.com and
   twitter.com both return 200 with ~640 KB of JavaScript shell containing no
   follower figure, and `syndication.twitter.com` rate-limits with 429. The
   figure stays at 66/2026-07-17 and is now **owner-refreshable only**. The
   failure is written into `eventsData.js` beside the entry so a future session
   does not spend the same time rediscovering it.
8. 🟡 **RESOLVED as far as it should be, 2026-08-10.** Owner chose 301 for the
   four permanent retirements only: `/treasury/` → `/transparency/` and the
   three hub aliases → `/mole-hub/`. The other four rules (`/verify`,
   `/health`, `/discord-bots`, and the `/geoagora` legacy path) stay **302 on
   purpose** — they point at live routes that could move again, and a 301 is
   cached hard enough that undoing one means waiting out every visitor's cache.
   The reasoning is written into `.htaccess` itself so a future sweep does not
   "finish the job" by mistake.
9. ~~**No `sitemap.xml` and no `robots.txt` exist.**~~ **RESOLVED 2026-08-10.**
   Both now exist.

   `sitemap.xml` is **generated** by `src/scripts/build-sitemap.mjs`
   (`npm run sitemap:build`), not written by hand — on a 118-file site a
   hand-written one is stale the first time someone adds a page. 66 URLs. It
   deliberately carries no `<lastmod>`: the only two sources available are
   filesystem mtime (churns on any checkout) and the file's last git commit date
   (always one commit stale at build time, which would make the
   "committed sitemap matches the generator" test flap red after every commit).
   Google ignores a `lastmod` it does not trust. `changefreq` and `priority` are
   omitted because Google has said it ignores both.

   One page is excluded by hand with its reason recorded in the generator:
   `/governance/proposal/`, a client-rendered shell driven by `?id=` where every
   id serves identical markup. It keeps its self-canonical — that is what
   consolidates the `?id=` variants onto one URL — but it is not a destination.

   `robots.txt` has **no `Disallow` lines, and a test enforces that.** Two
   reasons, both worth keeping: the file is world-readable, so a `Disallow`
   advertises the path it means to hide; and a blocked page can never be
   crawled, so its `noindex` is never read and it stays in the index with no
   description. `noindex` is the mechanism on this site. The existing
   unlisted-page test proved the point immediately by failing the first draft of
   `robots.txt`, which named a test file whose own filename contains the string
   that must never appear in a public file.
10. 🟡 **PARTLY RESOLVED 2026-08-04.** Originally: 6 links on 5 public pages
    point into PRIVATE GitHub repos and 404 for every visitor — `mole-gaurd` (governance rules ×2, modules-system ×2) and
    `GeoWallet` (support/privacy issue links ×3). Highest impact: the
    `/governance/` "Rules & documentation" section is *only* these links, and
    `/wallet/support/` sends users to a nonexistent issue tracker. The
    governance doc is publishable as-is apart from one internal "sprint report"
    reference. Owner decision — see the `/governance/` entry for options.
    **Note:** `/modules/` was audited earlier and I did not catch this then;
    found only when `/governance/` prompted a check of repo visibility.

    **The 2 governance links are fixed** — the owner chose to serve the docs,
    now at `/governance/rules/` and `/governance/proposal-template/`.
    **The 2 `/modules/` links are fixed** (2026-08-04) — `docs/modules-system.md`
    is now published on-site at `/modules/system/`, same shape as the governance
    fix. Both GitHub URLs were re-confirmed **404** for a logged-out visitor
    before replacing them.
    **3 remain, all in `/wallet/`** → `GeoWallet/issues` (repo confirmed 404).
    `/wallet/support/` and `/wallet/privacy/` both send users to a nonexistent
    issue tracker, so the documented support channel does not exist for anyone
    outside the org. Unlike the other two, this one **needs a real support
    destination, not a published doc** — an owner decision, deferred to the
    `/wallet/` folder audit.
    Separately verified and fine: `/who-we-are/`'s "the original bot source is
    public" link to `github.com/LewSales/Discord-Bot` returns **200**.

11. 🟡 **Approved subset REMOVED 2026-08-10; the rest stays.** Originally:
    41.7 MB of `/images/` is unreferenced (found 2026-08-04, see the `/images/`
    entry), and not removable outright because the repo cannot see links made
    from X, Discord or anywhere else off-site.

    Owner approved the duplicate subset. Deleted 8 files, **15 MB**: the seven
    game cards and `hub-banner.png` that also live in `/mole-hub/assets/`, plus
    `TheMoleGaurd.png`, the misspelled twin of `TheMoleGuard.png`. Before
    deleting, confirmed that **no file in the repo references the `/images/`
    path** for any of them — every reference points at the surviving
    `/mole-hub/assets/` twin. That recoverability is the whole argument for this
    subset: an off-site link can be repointed at a file that still exists.

    `winlew.ico` was **not** deleted; it was re-encoded along with the other
    favicon copies (see #13), which was the cheaper fix for the same bytes.

    `src/public/images/` is now 45 MB, down from 60 MB. The remaining ~28 MB of
    unreferenced content stays. Also found and deliberately left alone:
    `/GeoWallet.png` ↔ `/wallet/assets/GeoWallet.png` (1.8 MB),
    `geowallet-icon.png` in three places (0.7 MB), three
    `rootglide-player-*.png` ↔ `generated/rootglide-*.png` pairs (0.6 MB), and a
    2.9 MB pair under `/cunt/future/` — that last one inside halted-sprint
    territory.
12. **Two files carry literal ChatGPT export filenames** and are publicly
    reachable by exact URL (3.7 MB together). Rename, remove, or leave — but
    worth a deliberate choice rather than an accident.
13. ~~**`favicon.ico` is 712 KB, and exists in three byte-identical copies.**~~
    **RESOLVED 2026-08-10, and it was worse than recorded.** Two corrections to
    the original finding, both found only by opening the file rather than
    trusting its extension:

    - It is **not an ICO at all.** It is a 700×700 **PNG** with the extension
      renamed. Browsers sniff content and cope, which is why nobody noticed.
    - There are **five** byte-identical copies, not three — `/favicon.ico`,
      `/discord-bots/favicon.ico`, `/images/favicon.ico`, `/images/winlew.ico`
      and `/mole-hub/favicon.ico`. 3.65 MB of the same file.

    Re-encoded with Pillow to a real multi-size ICO (16/32/48/64) at 20 KB each,
    reclaiming **3.38 MB**. Every size was then checked to carry real content
    (fully opaque, thousands of distinct colours) rather than assuming the
    encode worked.

    All five were re-encoded **in place** rather than de-duplicated to one file:
    most pages reference `/images/favicon.ico`, and on a hand-uploaded static
    site deleting a remote file needs the owner. Rewriting contents takes the
    3.38 MB at zero risk. Pointing every page at a single `/favicon.ico` remains
    a sensible follow-up and is not done.
14. **The 22 `page-headers/*.png` render at 2.7× their native width** (~503px
    shown at 1374px), so every page's banner is soft on desktop. Fixing needs a
    re-export from the original artwork at ~1400px; it cannot be done by
    upscaling what is in the repo.
15. ~~**30+ pages carry hand-written `.navLinks` markup that never renders.**~~
    **RESOLVED 2026-08-12.** Originally: `nav.js` calls `links.remove()` and
    rebuilds from config, so those 5–14 pills per page are dead — they appear
    only if `nav.js` fails to load, which is also the only moment they could
    show a stale menu. Harmless to a visitor but a maintenance trap: editing nav
    there has no effect.

    The owner chose to sweep. **473 pills across 55 pages** were retired in
    `bdf9ef1`, each row left as the empty element with a comment saying why —
    the element must stay, because `nav.js` bails out entirely if `.navLinks` is
    absent.

    That sweep **missed two pages**, found on 2026-08-12: the two `/ecosystem/`
    entries for GeoAgora and GeoHackers, which both load `nav.js` and so had ten
    dead pills between them. Swept now, same comment. The likely reason for the
    miss is worth recording — the audit skips the *top-level* `/geoagora/` and
    `/geohackers/` folders by owner decision, and these are differently-scoped
    public sister-project pages that the skip does not cover.

    **Guarded**: `test/nav/deadNavPills.test.mjs` fails if any `.navLinks` row
    ships with an `<a>` in it. One trap in writing it, which is why the guard
    strips comments first: the canonical "intentionally empty" comment contains
    the literal text `<a>`, so a naive scan reports a pill on every page that
    has already been fixed. Watched fail against a reinserted pill before being
    trusted.
16. ~~**`/mole-link/` and `/verify/` are two front doors to one flow.**~~
    **WITHDRAWN 2026-08-05** after auditing `/mole-link/` (see #25). They are not
    duplicates: `/mole-link/` is a *launcher* offering four entry points
    (Mole verification, Utility-app verification, Dashboard, or `/mole link` in
    Discord), and `/verify/` is where the wallet signature actually happens. A
    chooser and its destination. The size difference that suggested duplication
    is exactly what that split predicts. Nothing to consolidate; no owner
    decision needed.
17. ~~**`bot.js`'s `!links` prints `WinLEW.xyz` as "The OFFICIAL Website".**~~
    **RESOLVED 2026-08-12.** It redirected, so it worked — but the site had
    moved off `.xyz` entirely and this was the last place handing out a `.xyz`
    address for the website itself, on the first URL many users ever see. Now
    `https://winlew.co`, and https rather than the http it was printing.

    The three `.xyz` lines beside it were deliberately left alone:
    `burn.`/`dev.`/`faucet.WinLEW.xyz` are vanity redirects to **X profiles**,
    not to this site, and each already prints its real `x.com` destination next
    to it. Fixing "all the .xyz links" would have broken three working
    shortcuts to fix one wrong one.

    Shipped alongside the DexScreener link change so both reach users on the
    same faucet-bot restart rather than needing two.
18. ~~**Merch v1 takes payment on a client-computed amount.**~~ **RESOLVED
    2026-08-10.** `createOrder` called `actions.order.create({ amount })` in the
    BROWSER with a total computed in the browser from a discount computed in the
    browser, and `onApprove` captured it in the browser too — so the server never
    saw the order at all, not even that a sale had happened. A modified client
    could pay $0.01 for a $40 tee.

    Now server-priced: `POST /api/merch/order` prices the basket in
    `src/mole/merchOrders.js` from `products.json` plus the session's own
    verified holdings, records the expected amount, and creates the PayPal order
    server-side; `POST /api/merch/capture` captures and **checks what PayPal
    actually took against that record** before confirming. The rule is that the
    client names the product and never the price.

    Details worth keeping:
    - **The blocker was a documented instruction.** `.env.example` said "NEVER
      put the PayPal secret anywhere", written when checkout was client-only —
      and PayPal's REST API needs `client_credentials`, so that instruction was
      what kept the hole open. Updated with the reasoning: the backend runs on
      the owner's own machine, not the shared host, and already holds a Solana
      keypair controlling real funds.
    - **Fails closed.** With a client id but no secret, the page shows "checkout
      coming online" rather than rendering buttons — a half-applied fix would be
      worse than none, because the page would look fixed. `PAYPAL_ENV` defaults
      to `sandbox`, so a misconfigured deploy fails to take money rather than
      taking it for real.
    - **Money is integer cents throughout.** The old client did float
      arithmetic; `40.07 * 100` is `4006.9999999999995`.
    - **Two bugs found while writing the tests:** the first draft read sizes from
      `product.sizes`, which exists on no real product (the real shape is
      `product.options.size` gated by `hasOptions`) — that would have rejected
      every order naming a size, i.e. all of them. And bare `Number()` coercion
      accepted `qty: true` as 1 and `qty: [3]` as 3; non-numeric types are now
      refused outright.
    - Maintainers can list orders at `GET /api/merch/orders`, with a computed
      `mismatch` flag instead of a total to eyeball.

20. ~~**Only 6 of 30 redirect stubs carry `noindex`.**~~ **RESOLVED 2026-08-05**
    during `/sponsors/` (see #34). The real count was **38 stubs, 23 missing
    `noindex`** — the original 30 was low because it was eyeballed rather than
    walked. All 38 now carry it, canonical was added only where a stub is a
    true alias of one real page (and 13 removed where the target was
    `/no-thank-you/` or `/`), and
    `test/nav/redirectStubHygiene.test.mjs` fails if a new stub ships without
    it. Items 6 (canonical tags) and 8 (302 vs 301) remain open — those are
    server-config questions, not file contents.
21. ~~**`src/public/.tmp-shots/` holds 16 MB / 55 debug screenshots.**~~
    **RESOLVED 2026-08-06** — deleted at the owner's request. 52 PNGs plus 3
    `header-audit-*.json` reports, all untracked and gitignored, all
    regenerable via `npm run header:audit`. Nothing referenced them. Removing
    them can't affect the site (they were never uploaded intentionally) and
    closes the risk that a folder-level hand-upload would publish them.
22. ~~**`/roadmap/` shares no data source with the module registry.**~~
    **RESOLVED 2026-08-12.** Originally: the page was hand-maintained HTML, so a
    test could only catch drift *after* someone edited the registry, and could
    never catch an omission at all.

    **Not rendered client-side.** `/modules/` fetches `/api/modules/status` and
    renders in the browser, which was the obvious precedent and was rejected:
    it would cost `/roadmap/` two things it currently has — a crawler sees the
    whole roadmap today and would see an empty one after, and the page keeps
    working when the backend 502s, which it has. Instead
    `src/scripts/build-roadmap.mjs` (`npm run roadmap:build`) generates the
    cards at build time and the committed output stays static HTML. Same shape
    as `build-sitemap.mjs`, whose committed output is likewise generated.

    **Only the registry-backed cards are generated.** 26 of the page's 42 cards
    come from `modulesData.js`, inside three marked regions. The other 16 —
    Discord Ecosystem, Partner Expansion, the five Research cards,
    Build/Map/Empower and the rest — are editorial programmes with no registry
    record, sit outside the markers, and the generator never sees them. Giving
    them fake module records to force uniformity would have been the wrong
    trade.

    Three optional per-record fields carry the exceptions, each documented above
    the registry: `roadmapVisible: false` (only `shared-navigation`, which would
    otherwise sit beside Core Infrastructure saying the same thing),
    `roadmapTitle` with `{live}`/`{total}` placeholders (which is why the
    "21 of 30" count can no longer be hand-typed wrong), and `roadmapBlurb`.

    Net effect on the page: "Daily Faucet" and "Web Faucet" collapse into one
    Faucet card, since the registry holds one faucet module whose own
    description already covers both surfaces, and several headings now match
    their registry names rather than diverging from `/modules/`.

    **Guarded** by `test/mole/roadmapGenerated.test.mjs`: byte-exact match
    against the generator, an idempotency check (a non-idempotent generator
    would pass a freshly-built file while duplicating cards on every run), and
    an independent coverage rule that does *not* reuse the generator's own
    filter — a public, non-internal module must have a card or an explicit
    `roadmapVisible: false`. Watched failing by editing the registry without
    rebuilding, which is the exact scenario it exists for.

    One test of mine was deleted rather than fixed: a second assertion that each
    card's text appears in the page reimplemented the generator's HTML escaping
    and failed on the four titles containing `&`. The byte-exact match already
    covered it. A check that restates a stronger check only adds somewhere to be
    wrong.

    **2026-08-12 — six modules registered, and the gap was in the registry, not
    the page.** Diffing module `route`s against `src/public/*/` found six live,
    nav-linked surfaces with no record anywhere in `modulesData.js`:
    `/contribute/`, `/leaderboards/`, `/bounties/`, `/policies/` (all LIVE),
    plus `/merch/` and `/winlew-forge/` (both PARTIAL). So `/modules/` and
    `/roadmap/` were not drifting here — they were silent, which no drift test
    can catch. Nothing on either page was wrong; six things were simply absent.

    Registry 24 → 30 entries, 17 → 21 live. Phase 3's "Leaderboards" item was
    repointed from `quiz` to the new `leaderboards` module, which is the real
    implementation. The two PARTIAL records state what does *not* work, and both
    are listed under Current Focus rather than Completed Milestones.

    `roadmapItem` is deliberately `null` on the five that were never on the
    original whitepaper roadmap. The existing convention attaches such modules
    to `"Platform v2 enhancements"`, but that item is NOT-STARTED, so pointing
    shipped work at it is itself the drift this registry exists to catch. Three
    older records (`shared-navigation`, `health-status`, `modules-registry`)
    still do that and were left alone rather than churned.

    **This pass is the argument for the fix.** The count test derives "N of M
    Platform Modules Live" from the registry, so it went red the moment the
    records landed and forced the page edit. That worked — but it only works for
    the one number a test happens to compute. The four new cards had to be
    written by hand, and nothing would have failed if they had not been.
29. **`/xyo/`'s two year-counts don't line up.** "~5 yrs Community
    leadership" vs "~6 yrs Building toward XYO" — building toward the
    ecosystem a year longer than leading in it. Reconcilable (member six,
    leader five), but it reads oddly on that page in particular. Owner-stated
    and unverifiable here; his history to correct or explain.
26. ~~**`/verify/api-proxy.php` still echoes `curl_error()` to the client.**~~
    **RESOLVED 2026-08-12.** It named the backend tunnel host whenever the
    tunnel was unreachable — publishing the private origin exactly when the site
    was broken and people were most likely to be looking. `curl_error()` now
    goes to `error_log()` and the client gets `{"ok":false,"error":
    "proxy_request_failed"}` with nothing else, matching the `/geoagora/`
    copies. (Their comment claimed they already matched this file. They did
    not — this file was the one still leaking.)

    **The blocker is gone.** `php-cli` 8.3.6 was installed on both machines at
    the owner's hand on 2026-08-12, so the fix that was written and reverted in
    #36 could finally be checked. All three proxies are `php -l` clean.

    **Verified by execution, not just linting**, which matters on a file that
    gates every API call. This build of php has **no curl extension**, so
    `curl_*` were undefined and therefore free to define in userland — a shim
    drove the *real, unmodified* file through its failure branch. Evidence:

    - before: `{"ok":false,"error":"proxy_request_failed","detail":"Could not
      resolve host: …ngrok-free.dev"}`
    - after: `{"ok":false,"error":"proxy_request_failed"}`, with the host and
      full target URL appearing only on `stderr` (the server log)

    Also re-checked with the same harness because the edit moved `curl_close()`:
    the success path still passes a 200 body straight through, and the path
    allowlist still rejects `/admin` and the `/api/../../admin` traversal.

    **Guarded** by `test/nav/proxyErrorDisclosure.test.mjs` — deliberately
    written in JS, not PHP: php-cli is not guaranteed in every environment
    `npm test` runs in, and a guard that silently skips is not a guard. It
    asserts `curl_error()` may only feed `error_log()`, and separately that no
    proxy emits a `'detail'` field. Both watched failing against the pre-fix
    file.
27. 🟡 **HANDED OFF 2026-08-12 — still needs one look at the serving machine.**
    `WEB_PROXY_SHARED_SECRET` is absent from this checkout's `.env` (re-checked
    2026-08-12, still absent), while the PHP side's `api-proxy-secret.php` is
    present. If the *serving* machine is also missing it, the 2026-08-01 per-IP
    rate-limit fix is inert — the backend ignores the forwarded IP and buckets
    the whole shared host together. That fails safe, so nothing is broken, but
    the fix isn't doing its job.

    **Why it stayed open this long, and why it could not just be fixed here:**
    `.env` is gitignored. It cannot be pushed, pulled, or read across machines,
    so neither the check nor the fix can travel through the repo — the only
    thing that can travel is instructions. The owner was away from the serving
    PC on 2026-08-12, so instructions are what was written.

    Two places now carry them, on the theory that whoever needs this will find
    one or the other:
    - `A.i-Talks/proxy-secret-2026-08-12.md` — full walkthrough for the
      assistant on that machine: the hop topology, both sides to check, how to
      generate and install the value, and the constraints `api-proxy.php`
      enforces (printable ASCII, no CR/LF, 8–256 chars) so a bad value is not
      dropped in silence.
    - `.env.example`, inline above the key itself, for anyone who never opens
      `A.i-Talks/`.

    The check is `grep -c '^WEB_PROXY_SHARED_SECRET=.\+' .env`, which prints 1
    or 0 and never the value. Verified against four fixtures — set, blank,
    absent, commented-out — because an instruction sent to another machine gets
    no second attempt if the regex is wrong. There is also a no-shell check: the
    backend logs `[security] WEB_PROXY_SHARED_SECRET is unset ...` at every boot
    when it is missing.

    Closes when that machine reports back set / not set.
28. 🟡 **DESKTOP PATH FIXED 2026-08-10; the mobile path is still open.**
    Originally scoped as "restore the handoff QR." The better option named there
    — mint a one-time code so the link stops being a bearer credential — is what
    shipped, and building it surfaced that the problem was larger than the QR.

    **What was actually wrong.** The desktop hand-off handed out
    `canonicalVerifyUrl()`, which keeps the query string, so the "verify link"
    *was* `/verify/?session=<live token>`. The panel warned "treat this link like
    a password… never paste it into a chat, a ticket, or a screenshot" — while
    the two buttons beside it did exactly that: `buildPhantomBrowseUrl()` and its
    Solflare twin wrap the URL into `https://phantom.app/ul/browse/<encoded>`,
    which are **real HTTPS requests to those companies**, putting a live session
    token into a third party's logs. Same leak as the QR removed in #36; that fix
    caught the picture and missed the buttons next to it, because the test
    written at the time allowed the wallet vendors on the reasoning that "handing
    the page to the wallet you are verifying with IS the feature." Handing it the
    *page* and handing it the *credential* were one act only because the URL
    carried both.

    **Fixed** by `src/mole/webHandoff.js` + `/api/verify/handoff/{start,claim,peek}`:
    the link now carries a hand-off id, redeemable once and only alongside a
    six-digit pairing code that never leaves the desktop screen. The desktop's own
    token never leaves the server — `claim` mints a fresh session for the same
    Discord user, inheriting the remaining life of the original and capped at an
    hour, so a hand-off can't extend authority. `peek` lets the originating screen
    see that its hand-off was used, which is how a user notices a claim they did
    not make. 21 tests, plus a guard in `verifyPageSecrecy.test.mjs` that fails if
    the hand-off ever reads the current URL again. Full writeup:
    `docs/verify-handoff.md`.

    **The mobile path is now fixed too** (2026-08-10, same day). It leaked the
    same way and worse: `wallet-auth.js` is loaded by **56 pages** and its wallet
    picker is reachable from all of them, so `target = window.location.href`
    shipped the token from any page reached by a Discord link.

    It uses `HANDOFF_MODES.DIRECT`, and the weakness is stated rather than
    glossed: a same-device hand-off has no second screen, so there is nowhere to
    show a code the link doesn't also reach, and the id alone redeems. What
    changes is the kind of exposure — Phantom's logs go from receiving a session
    token valid for hours and replayable without limit, to a **single-use id
    valid for 120 seconds**. A leak of that is a race against a page loading a
    second later, not a key. Not equivalent to the desktop flow and must not be
    described as if it were.

    **The root cause was neither panel.** All three `build*BrowseUrl()` helpers
    took `url = currentBrowseUrl()` as a **default argument**, so any call
    written without an argument silently shipped the current URL. The August QR
    fix removed one caller and left the loaded gun on the table. The default is
    gone, the parameter is required, and `currentBrowseUrl()` is deleted — the
    leak can now only be reintroduced deliberately.

    **Two findings from driving a real browser** (`test/nav/mobile-handoff.e2e.test.mjs`,
    headless Chromium, iPhone UA, canary token, real click):
    `link.js`'s own mobile target function **never runs for Phantom** —
    `openWalletBrowser()` delegates to `wallet-auth.js` and excludes only Jupiter,
    so sabotaging `link.js` changed nothing while sabotaging `wallet-auth.js`
    failed instantly. And the **first version of that test was vacuous**: its
    selector matched no element, so nothing was clicked and every assertion was
    skipped — it passed with the leak fully restored. It now asserts that a
    wallet navigation was captured before checking anything about it.

    **Root fix, PARTLY DONE 2026-08-10.** The verify flow read the session *only*
    from the query string, so `?session=` could not be stripped without logging
    everyone out. Fixed: `hasUsableSession()`, `getChallenge()` and
    `verifyAndSync()` now read through `readSessionToken()` (URL, then storage),
    and `/verify/` **scrubs the token out of the address bar** with
    `replaceState` once it is stored. The token no longer reaches the address
    bar, browser history, a screenshot of the page, a copied link, or the shared
    host's access log for the page request.

    Server side, all 35 request reads now go through one `sessionFromRequest()`
    helper that prefers a header, then body, then query string.

    **The structural blocker is GONE as of 2026-08-12; one staged step remains.**
    Previously: the client could not send the session as a header, because
    `/verify/api-proxy.php` builds its outbound header list *from scratch* and
    deliberately carries nothing the browser sent — that is what stops a browser
    spoofing `X-WinLEW-Proxy-Secret` / `X-WinLEW-Client-IP`, which the per-IP
    rate limiter trusts. With php-cli installed (#26) that file can finally be
    changed safely.

    `X-WinLEW-Session` is now forwarded, and it is the **only** browser header
    that proxy passes through. The reason it is safe is specific and does not
    generalise: it is a bearer credential the browser already holds and can
    already present as `?session=`, so forwarding grants no authority it did not
    have — it only changes where the token travels. Every other `X-WinLEW-*`
    header is a claim *about* the browser that only the proxy may make.

    Exercised with the same userland-`curl_*` shim used for #26, five scenarios:
    a normal token is forwarded; a value containing CRLF is dropped whole (no
    injected header line); a browser sending its own `X-WinLEW-Proxy-Secret`,
    `X-WinLEW-Client-IP` and `X-Forwarded-For` has all three discarded and
    replaced with the proxy's observed values while its legitimate session still
    passes; an undersized token is dropped; absence adds nothing.

    **The `?session=` removal landed 2026-08-13, made deploy-order-proof rather
    than deploy-order-dependent.** All 16 call sites across 9 files now rely on
    the header alone; `/verify/profile.js`'s separate `api()` helper, which had
    its own raw `fetch` and was the last place still putting a token in a URL,
    delegates to `hubApiFetch` when it is present.

    The obvious risk was upload order: this site is hand-uploaded file by file
    and **has served stale assets before**, so "JS up, PHP not" would have
    authenticated nobody. Rather than depend on order, `hubApiFetch` detects. A
    401 on a header-carrying request is retried once with `?session=`, and the
    fallback latches for the rest of the page **only if that retry succeeds**.
    Latching on success rather than on the 401 is the load-bearing detail: an
    ordinarily expired session also returns 401, and latching there would push
    the token back into URLs for the rest of the page over nothing.

    **Guarded** by `test/nav/session-header-fallback.e2e.test.mjs` (real
    Chromium, intercepted requests) across three deploy states: proxy forwards
    the header (no retry, no token in any URL), proxy drops it (one clean
    attempt, one successful retry, then latched), and session genuinely expired
    (retried each time, never latched).

    **Two of those tests were wrong first, and both failures are worth keeping.**
    The original latch test drove the page's own load-time requests and **passed
    with the latch deliberately moved onto the 401** — `/faucet/` issues its
    calls concurrently, so all of them start before any 401 returns and every
    one looks "clean" whatever the latch does. It was measuring timing, not
    logic. Instrumenting the second failure showed the app *clears the session*
    after repeated 401s, so the "expired" scenario had actually been measuring a
    logged-out page. Both are correct application behaviour and a broken
    harness; the sequential tests now run against a bare page served by the test
    itself, which fetches nothing of its own. Re-run under sabotage afterwards,
    including the exact mutation that previously slipped through.

    Also guarded by `test/nav/proxyHeaderAllowlist.test.mjs`: a per-proxy
    allowlist of readable `$_SERVER['HTTP_*']` keys, plus a check that the
    session header is bounds-validated before forwarding. Writing it found
    something not previously recorded — the `/geoagora/` proxies forward
    `Accept` and `Authorization` from the browser. Reviewed and kept: `Accept`
    is content negotiation and `Authorization` is that app's own bearer
    credential, carrying the same argument as the session here. The allowlist is
    per-file rather than shared so that neither proxy's exceptions silently
    license the other's.

    `hubApiFetch()` already attaches the header; it is dropped by the proxy
    today and starts working the moment the PHP forwards it. Two independent
    paths persist the session to the same `winlew.verify.session` key
    (`wallet-auth.js`'s `getAuth()` and `link.js`'s `syncStoredSession()`) —
    worth knowing before changing either.
24. **Six stale build artifacts sit in `/geoagora/`**, publicly reachable by
    exact URL: `index_260503214320.html`, `index_260503230853.html`,
    `index_260506025236.html`, `index_260506025319.html`, `index-web.html`, and
    the `.htm` twin under `/discord-bots/Main-home.htm`. All now redirect and
    are `noindex` (see #34), so they leak nothing and rank nowhere — but they
    are dated save-copies nobody meant to publish. Deleting them is safe;
    flagged rather than done because `/geoagora/` is owner-skipped territory.
23. **`/scripts/header-audit.mjs` is still live on the server.** Moved out of
    `src/public/` in the repo (see #32), but a hand-upload does not delete
    remote files — the old URL keeps serving until `/scripts/` is removed on
    the host. Harmless content, but the point of the move was that it stops
    being published. Same applies to any other file this audit relocates.
35. ~~**Every authenticated GET wrote a live session token to a log file.**~~
    **RESOLVED 2026-08-10.** Found by sweeping for the token after the same leak
    turned up twice in two days — the lesson being that two instances of one
    class is a reason to look everywhere, not to assume there are two.

    `src/mole/web.js` had `app.use(morgan("dev"))`. Morgan's `:url` token is
    `req.originalUrl`, which includes the query string; **20+ authenticated GET
    routes** take `?session=<token>` and **11+ client call sites** put it there;
    and `ecosystem.config.cjs` sends each service's stdout to
    `logs/<service>.out.log`. So every authenticated GET appended a live session
    token to a file on disk.

    The most durable form of this leak, and the reason it matters more than it
    first sounds: a log file outlives the session it records, gets copied when
    someone debugs, and gets pasted into a chat when someone asks for help. The
    shared host's own access log was publicly downloadable until 2026-08-03 for
    exactly that kind of reason (see the `/log/` block in `.htaccess`) — and
    `/verify/?session=…` is a request that host logs too.

    Fixed by `src/mole/logRedaction.js`, which overrides morgan's built-in
    `:url` token so **every** format is covered — a bespoke `:safeUrl` would
    have protected only the one format someone remembered to change. Values are
    replaced, keys kept, so a log still shows a request was authenticated
    without showing which session. Demonstrated end to end against real
    express + morgan: `?session=<token>` before, `?session=[redacted]` after.

    **Confirmed already on disk, and confirmed harmless:**
    `logs/winlew-mole.out.log` holds 50 occurrences of 2 distinct tokens, last
    written 2026-07-24. Sessions live for hours, so both expired weeks ago, and
    `.gitignore:69` (`*.log`) meant they were never at risk of being committed.
    The mechanism was real; this instance of it was not exploitable.

    One found while writing the tests: the sensitive-key list held `apikey` and
    `api_key`, and `X-Api-Key` matched neither because of the hyphen. Keys are
    now normalised (lowercased, `-` and `_` stripped) on both sides, so
    separator style cannot defeat a match.

    **Containment, not the cure.** The cure is not putting credentials in URLs
    at all — see #28.

19. **59 internal development docs are publicly downloadable** under
    `/mole-hub/docs/` (58 specs + `ROADMAP.md`, 232 KB). Directory listing is
    403 but every file returns 200 at its exact URL. **Not a breach** — checked
    for credentials, keys, local paths and "internal only" markers, found none,
    and the mechanics they describe are already readable in the unminified game
    JS every player downloads. It is internal build chatter ("STEP3A FREEZE
    FOCUS HOTFIX", build orders, release candidates) published unintentionally
    on a production site. Options: gitignore and stop uploading them, move them
    to the repo's own `docs/`, or leave them. Owner decision.
