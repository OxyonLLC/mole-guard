# WinLEW 3.0 — Phase 3B Production Readiness & Performance Architecture

Date: 2026-10-09
Status: isolated backend and browser-candidate implementation complete; production integration remains gated
Deployment status: no public homepage, proxy, navigation, redirect or production deployment changed

## 1. Executive conclusion

The current nine-request candidate is safe for private review but is not the recommended public architecture.

The primary constraint is not browser bandwidth alone. Every homepage API call passes through `/verify/api-proxy.php`, occupying a Network Solutions shared-host PHP worker while cURL waits on the upstream Mole Guard backend. The proxy has a five-second connection timeout, a 25-second total timeout, and a circuit breaker specifically because stalled proxy calls have previously exhausted the shared worker pool and affected the whole site.

The recommended production design is one new read-only `GET /api/homepage/summary` route in the existing Mole Guard backend, forwarded unchanged by the existing proxy. It should:

- call existing internal read functions rather than duplicate business logic;
- return only homepage fields;
- cache each source internally according to its own freshness policy;
- expose source-generated, cache-generated and response-generated timestamps separately;
- preserve last-known-good values only when explicitly marked stale;
- never contain user, wallet-session or authenticated data;
- make no mutations;
- avoid recomputing Health on each request.

The browser would make one request instead of nine. The existing proxy requires no modification because it already forwards allowlisted `/api/*` paths.

This is Option C operationally, with hybrid per-source freshness inside the summary. It is simpler and safer than client-side orchestration plus nine shared-host PHP workers.

## 2. Scope and evidence

Measured facts come from the accepted Phase 3A production integration gate: one controlled sequential set, one controlled parallel set, and authenticated browser validation. No Phase 3B load test was performed.

Static inspection covered:

- the deployed homepage adapter and presentation mappings;
- all endpoint consumers in 302 public files;
- `verify/api-proxy.php`;
- current Network Solutions hosting documentation.

The backend implementation referenced as `src/mole/web.js` is outside the writable/public workspace. Computation-cost classifications below are therefore either directly evidenced by response contents and public documentation or clearly marked as inference.

## 3. Current request path

```text
Browser
  → winlew.co/verify/api-proxy.php
      → shared-host PHP worker waits
          → Mole Guard backend through current upstream tunnel
              → source computation / external reads
```

Current proxy behavior:

- all nine responses receive `Cache-Control: no-store`;
- upstream cache headers are not forwarded;
- public supply-only routes are the exception and receive `public, max-age=60`;
- cURL connect timeout is five seconds;
- total proxy timeout is 25 seconds;
- three upstream gateway failures open a 30-second circuit breaker;
- proxy failures return structured 502/503 JSON rather than upstream HTML;
- the same proxy also carries critical authenticated and mutation traffic elsewhere, so homepage pressure must remain conservative.

The existing production root homepage already reads Price, Burn, Transparency and Modules. Phase 3A expands that pattern to nine sources; replacing those root reads must be part of any later integration so the old four and new summary are not accidentally run together.

## 4. Nine-adapter performance inventory

### Measured inventory

| Source | Sequential latency | Response size | Homepage fields actually consumed | Current cache |
|---|---:|---:|---|---|
| Price | 1,029.1 ms | 330 B | `priceUsd`, `liquidityUsd`, `fetchedAt` | Proxy `no-store` |
| Burn | 1,070.1 ms | 50,470 B | `progress.percentOfTarget`, `generatedAt` | Proxy `no-store` |
| Transparency | 929.7 ms | 77,338 B | `circulatingSupply.ok`, `circulatingDisplay`, `computedAtIso` | Proxy `no-store` |
| Modules | 602.1 ms | 38,448 B | public/non-internal count, live count, `generatedAt` | Proxy `no-store` |
| Quiz | 457.3 ms | 191 B | `cycle.endMs`; cycle boundaries for state | Proxy `no-store` |
| Faucet | 805.6 ms | 888 B | `totalConfirmedCount`, `generatedAt` | Proxy `no-store` |
| Governance | 345.0 ms | 973 B | proposal count, active-status count, `generatedAt` | Proxy `no-store` |
| Events | 583.6 ms | 13,255 B | live/upcoming group counts, `generatedAt` | Proxy `no-store` |
| Health | 591.3 ms | 1,589 B | `reachableCount`, `totalCount`, `checkedAt` | Proxy `no-store` |

Measured sequential total: approximately 183 KB of JSON. The later parallel snapshot was approximately 185.8 KB because live response contents changed.

### Cost, freshness and optimization assessment

| Source | Cost assessment | Appropriate freshness | Safe initial TTL | Failure rule | Smaller alternative |
|---|---|---|---:|---|---|
| Price | Medium; external/market retrieval inferred from source contract and ~1 s latency | Market context, not trading UI | 60 s | Show unavailable or explicitly stale last-known value; retain source fetch time | Summary fields only |
| Burn | High payload; chain wallet, recent transactions and 41 burn events returned | Public progress changes infrequently | 300 s | Stale value allowed only with stale badge and original source time | Summary `percentOfTarget` only |
| Transparency | Highest payload; mint, 14 components, 61 liquidity events and supply calculation returned | Circulating supply changes less often than price | 300 s | Never substitute total supply; stale circulating value must be labeled | Existing `/api/supply/circulating` is narrow and already proxy-cached 60 s |
| Modules | Low/medium compute inferred; registry-like data but 30 full module records returned | Changes on releases/content updates | 900 s | Last-known version may be stale-labeled | Summary should return precomputed visible/live counts |
| Quiz | Low; 191-byte cycle record | State changes at cycle boundary | 60 s, never beyond next boundary | Derive active only from authoritative end time | Existing response already efficient |
| Faucet | Medium inferred; aggregate plus on-chain reconciliation details | Public claim count can tolerate short delay | 60 s | No eligibility or user claim state inferred | Summary count only |
| Governance | Low for current one-proposal response | 60 s while active; 300 s otherwise | Dynamic 60/300 s | Never cache or summarize vote mutation responses; read record only | Summary status counts only |
| Events | Low/medium inferred; seven full event records are returned | Schedule changes infrequently | 300 s, capped at next event transition | Server classification remains authoritative | Summary live/upcoming counts only |
| Health | High fan-out: endpoint actively probes 19 first-party routes | Status overview, not an uptime guarantee | 60–120 s minimum | Never trigger fresh 19-route probe per homepage visit; stale status explicitly labeled | Cached last completed health snapshot, or link-only homepage treatment |

“Safe initial TTL” is a recommendation, not a measured production setting. It must be verified against backend ownership and update semantics before implementation.

### Timestamp rules

Each summary item must expose:

- `sourceAt`: time supplied by or derived from the authoritative source;
- `cachedAt`: when the summary cache stored the normalized item;
- `expiresAt`: freshness boundary used by the summary;
- `servedAt`: summary response generation time;
- `state`: `live | stale | unavailable`;
- `evidence`: existing public evidence route.

The UI must never relabel `servedAt` or browser fetch time as source freshness.

## 5. Architecture comparison

| Option | Browser requests | Estimated payload | Shared-host workers/visit | Complexity | Freshness | Main risk |
|---|---:|---:|---:|---|---|---|
| A. Client scheduling | 9 | 181–186 KB | 9, capped at 3 simultaneous | Low | Direct | Total backend/proxy work unchanged |
| B. Conservative caching on existing paths | 9 | Up to 181–186 KB without conditional/edge support | 9 on browser-cache misses | Medium/high | Per-route | Proxy edits affect critical ecosystem traffic; shared worker count remains |
| C. Homepage summary | 1 | Estimated 1–3 KB | 1 | Medium | Per-field metadata | Requires one carefully reviewed backend read route |
| D. Summary plus direct reads | 2–4 | Estimated 2–80 KB depending on direct sources | 2–4 | Medium/high | Highest for selected items | More failure combinations and scheduling logic |

### Option A

The three-request cap is retained as a fallback and development safeguard. Prioritization could load Quiz, Events and Price first and defer Health/economy until visible. This improves perceived load but does not reduce total work. It is not sufficient for unrestricted traffic.

### Option B

Editing the shared PHP proxy to cache these paths is not recommended as the first move. That file gates authentication, wallet, claims and other critical flows. It also intentionally stamps `no-store` on non-supply responses. A route-specific disk cache is technically possible on shared hosting, but it introduces locking, expiry, invalidation and stale-file failure modes into the highest-blast-radius file.

Browser caching alone is also insufficient: first visits still make nine PHP calls, and `cache: no-store` is currently explicit in both adapter and proxy.

### Option C

One narrow backend response gives the largest reduction with the smallest public request surface. Normalization occurs next to authoritative backend functions, not in shared-host PHP or browser code. The existing proxy can forward the path without a change.

### Option D

A direct Price read plus a cached summary could provide slightly fresher price data, but WinLEW is not a trading terminal and Price already has a defensible 60-second freshness target. The extra shared worker and failure mode are not justified initially.

### Recommendation

Implement Option C with per-field TTLs and stale metadata. Keep the existing client adapter set behind a preview-only diagnostic switch during isolated QA, not as an automatic nine-request fallback. An automatic fallback would recreate the exact load being removed during upstream trouble.

## 6. Estimated reduction

These are estimates, not measurements:

- Requests: 9 → 1, an 88.9% reduction.
- Shared-host PHP worker acquisitions: 9 → 1 per uncached visit, an 88.9% reduction.
- JSON: approximately 183–186 KB → estimated 1–3 KB, approximately 98.4–99.5% reduction.
- Health probes: potentially one 19-route probe per visit → one cached probe per 60–120-second cache window.

The estimate assumes the summary contains values, state, evidence URL and timestamp metadata—not event arrays, wallet transactions, module descriptions or transparency ledgers.

## 7. Proposed response contract

```json
{
  "ok": true,
  "generatedAt": "ISO-8601",
  "schemaVersion": 1,
  "items": {
    "price": {
      "state": "live",
      "priceUsd": 0,
      "liquidityUsd": 0,
      "sourceAt": "ISO-8601",
      "cachedAt": "ISO-8601",
      "expiresAt": "ISO-8601",
      "evidence": "/links/"
    },
    "burn": {
      "state": "live",
      "percentOfTarget": 0,
      "sourceAt": "ISO-8601",
      "cachedAt": "ISO-8601",
      "expiresAt": "ISO-8601",
      "evidence": "/burn/"
    }
  }
}
```

The complete contract should include `transparency`, `modules`, `quiz`, `faucet`, `governance`, `events` and `health` using only the fields listed in the inventory. Partial success is required: one failed source must not make the whole response `ok:false`.

Security contract:

- GET and HEAD only;
- public data only;
- no cookies, sessions, wallet addresses, Discord identity, IP-derived state or personalized values;
- no claim, vote, reward, verification or transaction calls;
- bounded internal work;
- response-size ceiling;
- schema version;
- safe error strings;
- no upstream hostname leakage.

## 8. Shared-hosting compatibility

Confirmed capabilities:

- the current UNIX hosting executes PHP;
- File Manager/SFTP support PHP, JSON and hidden configuration files;
- the existing proxy can forward a new `/api/*` path without a rule change;
- filesystem-backed breaker state already works in the PHP temporary directory.

Network Solutions documents PHP version management for UNIX hosting and File Manager/SFTP support for PHP and related files: [PHP hosting support](https://www.networksolutions.com/help/article/change-php-version-hosting), [File Manager](https://www.networksolutions.com/help/article/pbns-file-management-navigating-file-manager).

Not established:

- Redis or another persistent memory cache;
- dependable cron scheduling on this specific plan;
- background workers on shared hosting;
- a general server cache manager (Network Solutions documents its Cache Manager as WordPress-only).

Therefore the recommendation does not depend on Redis, cron, a new server or shared-host cache configuration. Cache the normalized summary inside the already-running Mole Guard backend using its existing process/storage patterns. If durable caching is later required, it needs a separate hosting/backend design review.

## 9. Security and regression risks

### Critical

- Do not implement homepage caching inside the shared proxy without a dedicated review. A defect there affects verification, authentication and mutation traffic.
- The summary must never call mutation handlers or include personalized/session data.
- Never automatically fall back from one failed summary request to nine concurrent direct reads during an outage.

### High

- Stale economic values could be presented as live if timestamps or state are flattened.
- Health fan-out can amplify public traffic unless cached independently.
- Reusing full endpoint handlers through internal HTTP could create recursive proxy/backend pressure; use backend functions directly.
- Independent cache entries need bounded refresh concurrency to prevent a cold-cache stampede.

### Moderate

- Partial summary results require card-level state handling.
- Schema drift needs contract tests and `schemaVersion`.
- A process-memory cache disappears on restart; this is acceptable if cold refresh is bounded and failures remain truthful.

## 10. Proposed isolated implementation plan

This plan requires explicit backend-change approval.

1. Identify the existing backend read functions behind the nine routes and document whether each is pure, cached, or externally networked.
2. Define a typed/validated summary schema containing only the consumed fields.
3. Add per-source cache entries with the recommended initial TTLs and one in-flight refresh promise per source to prevent stampedes.
4. Build `GET /api/homepage/summary` by composing those functions directly. Do not call the public routes over HTTP.
5. Return partial states independently, with source/cache/expiry/served timestamps.
6. Add unit/contract tests for live, stale, unavailable, partial, timeout and malformed-source states.
7. Add response-size and no-sensitive-field assertions.
8. Connect a copy of the password-protected Phase 3A preview to the summary adapter; retain the current preview as the comparison baseline.
9. Run sequential summary tests, then a single browser integration pass. Do not load test production.
10. Measure actual summary latency, size, cold/warm behavior and backend call counts.
11. Verify that failure does not trigger nine direct reads.
12. Present evidence at a new approval gate before any root integration.

## 11. Remaining performance and accessibility QA

Before public launch:

- Firefox desktop and mobile-responsive viewport;
- WebKit/Safari desktop and iOS-responsive viewport;
- NVDA + Firefox or Chrome on Windows;
- VoiceOver + Safari on macOS/iOS where available;
- accessibility-tree review for navigation toggle, status badges and live-data updates;
- confirm whether asynchronously updated status text needs `aria-live` without creating announcement noise;
- 200% and 400% zoom in at least two engines;
- keyboard order after summary-state updates;
- slow-network and offline fallback behavior;
- cold-cache and warm-cache summary measurements;
- LCP, CLS and INP through a production-shaped preview;
- payload and request count from browser performance entries;
- image decoding and cache behavior;
- explicit check that the protected preview remains excluded from indexing.

No Firefox, WebKit, NVDA or VoiceOver pass is claimed.

## 12. Production launch checklist

### Before approval

- [ ] Backend summary route reviewed and separately authorized.
- [ ] Summary contract and field provenance documented.
- [ ] Measured cold/warm size and latency recorded.
- [ ] Cache TTLs owner-approved.
- [ ] Partial/stale/unavailable states verified.
- [ ] No sensitive or personalized fields present.
- [ ] No mutation code path reachable.
- [ ] Proxy remains unchanged.
- [ ] Firefox/WebKit and assistive-technology gaps resolved or explicitly accepted.
- [ ] Root homepage checkpoint created.
- [ ] Existing root four-request scripts identified for removal from the new page so they cannot run beside the summary.

### Release

- [ ] Deploy homepage HTML and candidate-owned assets only.
- [ ] Do not change global navigation, redirects, product routes or authentication.
- [ ] Confirm one summary request per clean visit.
- [ ] Confirm evidence links and timestamps.
- [ ] Confirm analytics, SEO metadata, canonical and sitemap behavior under separately approved changes.
- [ ] Observe proxy/backend errors and latency.

### Rollback

- [ ] Restore the checkpointed root `index.html`.
- [ ] Remove or stop loading candidate-only assets.
- [ ] Leave the summary endpoint inert; it is read-only and unreferenced after rollback.
- [ ] Do not roll back or touch proxy, authentication, games, rewards, faucet, governance or blockchain systems.
- [ ] Verify the former root homepage and its existing four reads.

## 13. Approval gate

Phase 3B investigation and isolated implementation are complete.

Implemented in the local candidate:

- `src/mole/homepageSummary.js`: independent per-source caches, in-flight
  refresh coalescing, explicit live/stale/unavailable states, sanitized public
  errors and timestamp metadata.
- `GET /api/homepage/summary` in `src/mole/web.js`: nine narrow public
  summaries composed from existing in-process reads, never internal HTTP.
- Health summary status now consumes only an already completed, fresh
  90-second cached snapshot and never starts the 19-route probe.
- The response is capped at 16 KiB and remains partial when individual sources
  fail.
- `.tmp-audit/phase3b-homepage/summary-adapter.js`: a one-request adapter
  retaining the Phase 3A candidate's data interface, with no nine-request
  automatic fallback.
- `test/mole/homepageSummary.test.mjs`: contract coverage for cache reuse,
  concurrent refresh coalescing, stale last-known-good data, source isolation
  and sensitive-field omission through explicit normalization.

Validation completed locally:

- `node --check src/mole/web.js`
- `node --check src/mole/homepageSummary.js`
- `node --test test/mole/homepageSummary.test.mjs` (4 passing)

The existing Phase 3A preview is unchanged and remains the comparison baseline.
The shared PHP proxy is unchanged. No root-page integration or deployment was
performed.

Requested next authorization: exercise the isolated candidate against a
non-production backend, record cold/warm latency and actual response size,
complete the remaining browser/accessibility matrix, then stop at the public
integration approval gate.

## 14. Local completion evidence

Date: 2026-10-09
Boundary: local deterministic sources and local adapter execution only. No
production endpoint, upload, deployment, Phase 3A file, proxy, or public route
was contacted or changed during this evidence pass.

### Exact schema

The top-level response is:

| Field | Type | Rule |
|---|---|---|
| `ok` | boolean | Always `true` for a successfully composed partial response |
| `schemaVersion` | integer | `1` |
| `generatedAt` | ISO-8601 string | Response generation time |
| `items` | object | Exactly the nine named public source summaries |

Every available or stale item contains `state`, `sourceAt`, `cachedAt`,
`expiresAt`, `servedAt`, and `evidence`. A stale item produced after a failed
refresh also contains `retryAt`. An unavailable item contains
`state: "unavailable"`, a sanitized `error`, `cachedAt`, `retryAt`,
`expiresAt`, `servedAt`, and `evidence`. No raw upstream error is returned.

### Nine-source field mapping

| Item | Existing source/function | Summary-only fields | TTL |
|---|---|---|---:|
| `price` | primary `buildPriceSnapshot` cache | `priceUsd`, `liquidityUsd` | 60 s |
| `burn` | `buildBurnSnapshot` cache | `percentOfTarget` | 300 s |
| `transparency` | `cachedTransparencySnapshot` | `circulatingSupplyOk`, `circulatingDisplay` | 300 s |
| `modules` | `getModulesStatusPayload` | `visibleCount`, `liveCount` | 900 s |
| `quiz` | `quizDb.getCurrentCycle` | `cycleEndMs` | 60 s |
| `faucet` | `cachedFaucetStats` | `totalConfirmedCount` | 60 s |
| `governance` | public `PROPOSALS` records | `proposalCount`, `activeCount` | 60 s |
| `events` | `groupEventsByBucket(EVENTS)` | `liveCount`, `upcomingCount` | 300 s |
| `health` | existing fresh `_healthCache` entry only (no probe initiation) | `reachableCount`, `totalCount` | 90 s |

### Deterministic local measurements

Evidence file: `phase3b-evidence-results.json`.

- Twelve simultaneous cold summary requests completed in **58.230 ms**.
- A warm summary request completed in **0.096 ms**.
- Each of the nine underlying source functions was invoked exactly **once**
  across the twelve-request cold burst.
- All concurrent responses carried identical normalized source values and
  cache metadata. Response-level `generatedAt` and `servedAt` may differ by
  request and were correctly excluded from that equality assertion.
- The representative complete response was **2,216 bytes**.
- Compared with the previously measured 185,800-byte nine-response snapshot,
  this is a **98.81% payload reduction**.
- The response remained below the enforced 16 KiB limit.

These are repeatable local harness measurements, not production latency. The
source delays are deterministic and exercise cache/single-flight behavior; they
do not claim real RPC or tunnel timing.

### Adapter request count

Evidence file: `phase3b-adapter-evidence-results.json`.

Executing all nine packaged adapter reads concurrently produced exactly one
`GET /api/homepage/summary` fetch and zero legacy source fetches. This is a
local VM result, not a browser-engine network-panel result.

### Security assertions

- Normalizers use explicit allowlists; full endpoint records are not spread
  into the response.
- Recursive output inspection found no key matching wallet, Discord, session,
  cookie, authorization, token, secret, IP, user-id, or account-id categories.
- The route is GET/HEAD only through Express; it accepts no session and invokes
  no claim, vote, reward, verification, transaction, or mutation function.
- Source errors are reduced to `source_timeout` or `source_unavailable`.
- The response-size ceiling is 16 KiB.
- The browser adapter uses `credentials: "omit"` and has no direct-read
  fallback.

### Separate preview package

Prepared locally at `.tmp-audit/phase3b-preview/`. It is independent of the
unchanged Phase 3A directory and contains:

- a self-contained Phase 3B copy of the candidate HTML/CSS/presentation code;
- the single-request summary adapter;
- explicit stale styling and stale labels;
- `noindex,nofollow` metadata and an Apache X-Robots-Tag guard;
- an exact upload allowlist and rollback procedure;
- a local integrity manifest containing Phase 3A baseline hashes and Phase 3B
  package hashes.

No password or credential is stored in the package. Network Solutions Password
Protected Directory configuration must be enabled before any future upload.

### Browser and accessibility evidence status

Direct Playwright QA was completed locally against the installed system
browsers:

- Google Chrome: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Microsoft Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

Both browsers were launched independently against a fixture-backed local HTTP
server. No production URL or production backend was contacted.

Chrome and Edge each passed:

- exactly one summary request on every tested page load;
- zero requests to all nine legacy source endpoints;
- live, partial, stale, unavailable, timeout and malformed-response assertions;
- desktop 1440×1000, tablet 768×1024 and mobile 390×844 layouts;
- no horizontal overflow at those sizes;
- 200% and 400% reflow equivalents at 640 px and 320 px CSS viewport widths;
- twelve-step keyboard traversal with visible focus on every focused control;
- working mobile menu state and minimum 44×44 px navigation targets;
- reduced-motion media-query behavior with transition duration reduced to
  0.01 seconds or less;
- duplicate-ID, image-alt, button-name, link-name and landmark checks;
- no console errors and no uncaught page errors.

The partial fixture made only Events unavailable while the other sources
remained live. The stale fixture retained Price and Burn values with explicit
“Stale snapshot” timestamps. Unavailable, timeout and malformed responses
rendered unavailable states without invented values.

The first browser run exposed a missing copied base stylesheet in the separate
Phase 3B package. That omission caused a local 404, disabled responsive rules
and undersized mobile targets. `phase2-prototype/styles.css` was added to the
Phase 3B package only; the complete rerun passed in both engines.

Machine-readable evidence: `phase3b-browser-qa-results.json`. Screenshots are
under `phase3b-preview/screenshots/local/{chrome,edge}/`; each engine has live
desktop/tablet/mobile captures plus partial, stale, unavailable, timeout and
malformed desktop captures.

Firefox and WebKit were not used because the requested installed system
browsers were Chrome and Edge. No result is claimed for Firefox, WebKit, NVDA
or VoiceOver.

## 15. Upload approval gate

Stop here. The Phase 3B package has not been uploaded. Any protected preview
upload requires explicit approval, must use a new directory such as
`/winlew-3b-review/`, and must not alter or replace the existing protected
Phase 3A preview.

## 16. Runtime-verification defects and corrective implementation

The first controlled live runtime verification did not pass acceptance. The
original run established the following failure measurements/observations, but
did not retain more precise wall-clock values; none are reconstructed here:

| Check | Failed live result | Relevant configured bound |
|---|---|---|
| Repeated unavailable source | A nominally warm summary request paid the full source wait again instead of returning promptly | 10 s default source deadline |
| Cold Health summary item | The summary invoked `cachedHealthSnapshot()`, which initiated the 19-route Health probe and blocked summary completion | 20 s Health source deadline in the rejected implementation; 25 s outer PHP proxy timeout |
| Cold Transparency overlap | Summary and Health-side Transparency reads could both observe an empty cache and start separate builds | Transparency build is approximately 10 RPC reads; exact duplicate-call count was not instrumented in the failed run |

These are failed controlled-live observations, not load-test results. The
earlier 58.230 ms cold and 0.096 ms warm figures remain explicitly synthetic,
in-process harness measurements and did not expose these integration paths.

### Root cause

- The composer cached only successful normalized values. With no last-known-
  good value, every request retried an unavailable source immediately and paid
  its deadline again.
- The Health summary provider called the same read-through function as the
  `/api/health/status` endpoint. On an empty/expired Health cache, that function
  owns and starts the 19-route fan-out.
- `cachedTransparencySnapshot()` checked the cache and then awaited a build
  without retaining the build promise. Two cold callers could pass the check
  before either stored the result.

### Corrective behavior

- Unavailable results now receive a bounded 15-second negative cache by
  default (source-overridable, clamped to 1–60 seconds). They remain truthfully
  `state: "unavailable"` and expose `cachedAt`, `retryAt`, `expiresAt`, and
  `servedAt`. Expired last-known-good values remain `stale` and also expose the
  next retry time.
- The summary Health provider can only read an already completed, still-fresh
  Health cache entry. With no such entry it returns unavailable and has no code
  path that can initiate the Health builder or route probes.
- The underlying Transparency build is protected by one shared in-flight
  promise. Summary, Health, supply, and Transparency route callers coalesce on
  the same cold build.
- Source failures remain isolated and there is still no automatic nine-route
  browser or server fallback.

Focused verification command:

```text
node --test test/mole/homepageSummary.test.mjs
```

Result: 8 tests passed, 0 failed. Coverage includes negative caching, prompt
warm failure responses, Health non-probing behavior, concurrent Transparency
coalescing, partial-failure isolation, deadline handling, and absence of an
automatic nine-endpoint fallback.
