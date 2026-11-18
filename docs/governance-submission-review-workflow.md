# Governance Proposal Submission — Review Workflow

For maintainers reviewing community-submitted proposal ideas from `/governance/submit/`. See `docs/governance-v1.1-hardening.md` for the technical design; this doc is the operational how-to.

## Statuses

`submitted` → `under-review` → (`revision-requested` → `under-review` again, or `approved-for-drafting`, or `rejected`) → `archived`. Owners can also `withdraw` from `submitted`/`revision-requested` at any time.

A submission can **never** reach a real, votable proposal by itself. `approved-for-drafting` means "a maintainer intends to hand-write a real proposal from this" — nothing more. Publishing it is always the separate, existing v1 step: edit `PROPOSALS` in `src/mole/governanceData.js`, run `node --test test/mole/governanceData.test.mjs`, commit, push.

## Reviewing (currently API-only — no admin page yet)

List everything waiting on review:

```
curl -H 'X-WinLEW-Session: <your session token>' \
  'https://winlew.co/verify/api-proxy.php?path=/api/governance/submissions'
```

Use the header, not `?session=<token>`. This is a maintainer pasting a live
credential by hand, and a token in a URL goes into shell history, the browser's
address bar and history, and the shared host's access log — the same class of
leak register #28 removed from the site itself on 2026-08-13. The query form
still works, so an old note or muscle memory will not break; it just leaves the
token somewhere it does not need to be.

Requires your Discord id to be in `MOD_IDS` (`.env`) — the same allowlist the faucet bot's moderator commands use.

Move one into active review:

```
POST /api/governance/submissions/:id/review
{ "session": "<token>", "toStatus": "under-review" }
```

Approve it for drafting (you intend to write a real proposal from it):

```
POST /api/governance/submissions/:id/review
{ "session": "<token>", "toStatus": "approved-for-drafting" }
```

Ask the author for more detail — **`reason` is required**, and is shown to the author on their submissions page:

```
POST /api/governance/submissions/:id/review
{ "session": "<token>", "toStatus": "revision-requested", "reason": "Please add more detail on affected systems." }
```

Reject — **`reason` is required**:

```
POST /api/governance/submissions/:id/review
{ "session": "<token>", "toStatus": "rejected", "reason": "Out of scope for the current roadmap." }
```

Archive a resolved (approved/rejected/withdrawn) submission once you're done with it:

```
POST /api/governance/submissions/:id/review
{ "session": "<token>", "toStatus": "archived" }
```

## What the author sees

Their own `/governance/submit/` page lists every submission they've made with its current status and, for `revision-requested`/`rejected`, your `reason` text verbatim. They cannot see anyone else's submissions, and no one else can see theirs (`GET /api/governance/submissions/:id` returns 404 — not 403 — to a non-owner, non-maintainer caller, so existence itself isn't leaked).

## After approval

1. Read the full submission (`GET /api/governance/submissions/:id`) for the source material.
2. Hand-write the real proposal record in `src/mole/governanceData.js`'s `PROPOSALS` array, exactly as documented in `docs/governance-v1.md`'s "Proposal publishing" section.
3. Optionally set `archived` on the original submission once it's been superseded by the real published proposal — it stays in the queue's history either way, it's just no longer active.

There is no automatic link between a submission id and the proposal that gets published from it — that's a manual decision each time, on purpose (a maintainer may merge two submissions, split one into several, or substantially rewrite before publishing).
