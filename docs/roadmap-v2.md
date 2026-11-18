# WinLEW Product Roadmap — Version 2

Status: **2.1, 2.2, and 2.3 complete, tested, committed, and pushed.** Version 1.0 (Phases 1–3: Foundation & Tokenomics, Core Infrastructure, Platform Launch) is archived — see `docs/roadmap-sprint-1-3.md`, which is not being modified going forward.

- **2.1 — Proof of Value**: `src/mole/proofOfValue.js` (commits `c240559`, `c0a3e81`). See its docs at `docs/proof-of-value.md`.
- **2.2 — Unified User Dashboard**: `/verify/profile.html` evolved into the dashboard (commit `b8d6b7c`). See its docs at `docs/unified-dashboard.md`.
- **2.3 — Participation Platform**: streak/weekly/tier-progress signals added to the Dashboard, reusing Proof of Value and milestone data (commit `649ec7b`). See its docs at `docs/participation-platform.md`.
- **2.4–2.5**: not started.

This document preserves the Version 2 roadmap brief verbatim. It sets mission, principles, and five planned sub-releases (2.1–2.5); it does not by itself specify what to build first or how deep to go on any one item — that will be tracked as each sub-release is actually scoped and started.

## Original #LewCrew roadmap — Phase 4 completion sprint (2026-07-16)

Separate from the Version 2 sub-releases above — this work belongs to the **original roadmap's Phase 4 wording** ("bring information that exists across Discord, X posts, blockchain explorers, and old announcements onto WinLEW.co as a permanent, verifiable record"), not to Version 2.4/2.5, which remain not started and are unrelated to this sprint.

Completed, tested, committed, and pushed:

- **Burn Program / Burn Center** — `/burn/`, `src/mole/burnEvents.js` (commit `f5bae5d`). Both known burn transactions independently re-verified on-chain; the burn wallet's complete transaction history was reconstructed to confirm no additional burn exists beyond the two known ones. See `docs/burn-program.md`.
- **Sponsors & Partners** — `/partners/` (`/sponsors/` redirects here), `src/mole/partnersData.js` (commit `50cb4ea`). Initial 2BRZ record, evidence-based, deliberately not marked active. See `docs/sponsors-and-partners.md`.
- **Discord-to-Web migration matrix** — a complete inventory of every Discord bot command/workflow cross-referenced against the website (commit `29afea4`). One confirmed gap (quiz point redemption) documented, not implemented — see `docs/discord-to-web-migration.md` for why.
- **Navigation integration** — Burn + Partners added to the standard site nav (commit `5b4cb85`).

This does **not** change the Whitepaper's own §13 Roadmap table's Phase 4 definition (Utility Expansion, Community Ops — both still genuinely "Coming soon"); burn/partners/migration-parity are historical-transparency and participation-completeness work that sits alongside the phase structure, not inside it. Not part of, and not a step toward, Governance, Cross-Chain Bridge, Mobile App Beta, or "Phase 5" — none of that was started.

## Original #LewCrew roadmap — Phase 4 closeout sprint (2026-07-16, continued)

Direct continuation of the completion sprint above, in the same session — closes the three remaining original Phase 4 items:

- **Web Quiz Point Redemption** — `POST /api/quiz/redeem`, `/quiz/`'s "Redeem points" card (commit `88670f2`). The one confirmed Discord-to-web gap from the migration matrix above is now resolved — a signed-in web user can convert quiz points to WinLEW without Discord, through the exact same shared service (`src/quiz/redemption.js`) Discord's `/redeem` now also calls. See `docs/web-quiz-redemption.md`; `docs/discord-to-web-migration.md` updated to reflect the gap closing.
- **Mobile App Beta** — `mobile/` Capacitor wrapper (commit `4c48678`). Android built, installed, and launched on a real emulator this sprint (screenshot-verified rendering of the live production site, zero crashes). iOS structurally scaffolded, honestly reported Blocked (no macOS/Xcode in this environment). See `docs/mobile-beta.md`.
- **Community Events & Partnerships** — `/events/`, `src/mole/eventsData.js` (commit `9a1bf7f`). Real historical events only (the 2025 Raydium farm, the 2BRZ announcement) — no fabricated calendar entries. Cross-linked with the existing Partners page. See `docs/community-events.md`.

**Per the sprint's explicit closing instructions, the original #LewCrew Phase 4 roadmap item is now considered complete:**

- ✅ Proof of Value Full Integration (prior sprint, Version 2.1/2.2)
- ✅ Mobile App Beta
- ✅ First Token-Burn Cycle / Burn Program (transparency infrastructure; see `docs/burn-program.md` for the explicit boundary — the website documents and tracks burns, it does not execute one)
- ✅ Community Events & Partnerships
- ✅ Discord-to-Web redemption gap — resolved

This still does **not** touch the Whitepaper's own §13 Roadmap table (Utility Expansion/Community Ops remain "Coming soon" — unrelated Version 2.4/2.5 items, not started). Not part of, and not a step toward, Governance, Cross-Chain Bridge, Community Burn Contributions, advanced analytics, multi-language support, or "Phase 5" — none of that was started this sprint.

## Original #LewCrew roadmap — Phase 5, Governance Module v1 (2026-07-20)

The original roadmap's next item after Phase 4: **"$WinLEW holders vote on feature proposals" / "$WinLEW holders vote on token-burn schedules."**

- **Governance Module v1** — `/governance/`, `/governance/proposal/?id=<id>`, `src/mole/governanceData.js` + `src/mole/governanceStore.js`. One verified wallet = one vote, private individual choice / public aggregate results, server-verified eligibility (verified linked wallet + ≥1 WinLEW), explicit governance modes (advisory / community-approved / maintainer-ratified / binding-within-defined-policy) on every proposal. **No vote executes a treasury or burn transaction by itself** — a passed proposal moves to maintainer safety review, then a separately, manually authorized action, with public execution evidence recorded afterward. See `docs/governance-v1.md` for the full rules and `docs/governance-proposal-template.md` for how to publish a new proposal.
- Seeded with exactly one real record at launch (the Governance Launch milestone itself, informational) — no fabricated voting history.
- Not added to `/modules/` — `src/public/modules/index.html` remains untracked/pre-existing dirty worktree state (consistent with every prior sprint this project), and no existing tracked module page (Core Infrastructure, Games & Trivia, Proof of Value Engine, Quests & Progression, Utility Expansion, Community Ops) is an honest fit for Governance's actual scope. Site-wide nav integration was done instead.
- This does **not** touch the Whitepaper's own §13 Roadmap table, matching the precedent already set for Burn/Partners/Events.

## Original #LewCrew roadmap — Modules & Roadmap Status system (2026-07-12)

`/modules/` is now built and canonical (superseding the "not added" note above, which described the state as of the Governance Phase 5 sprint) — `src/mole/modulesData.js` is the single source of truth for module/roadmap status, replacing the untracked prototype and the several stale detail pages that predated it. See `docs/modules-system.md`.

**Cross-Chain Bridge product decision, on record**: the original roadmap's Cross-Chain Bridge commitment is **retained**, not removed or abandoned. Current status: `deferred`. This roadmap commitment was created with future WinLEW interoperability with XL1 in mind. No official public XL1 bridging mechanism is currently available, so implementation remains deferred until supported infrastructure and technical specifications are released. No bridge architecture, wrapped-token design, contracts, or third-party integration work exists anywhere in this repository. This decision is enforced in code — `validateModulesRegistry()` in `src/mole/modulesData.js` fails if this status is ever silently changed without a new, explicit decision being recorded.

---

## Original brief (verbatim)

> ## Version 1.0 Complete
>
> The original WinLEW roadmap has now been fulfilled.
>
> - Phase 1 ✓ Foundation & Tokenomics
> - Phase 2 ✓ Core Infrastructure
> - Phase 3 ✓ Platform Launch
>
> These phases should now be considered complete and preserved as historical milestones. Do not modify or rewrite them. Archive them. Everything moving forward belongs to the next chapter of WinLEW.
>
> ## Mission
>
> The goal is no longer simply building features. The goal is building the best community-driven participation platform in Web3.
>
> Every feature should support one or more of the following: Education, Participation, Transparency, Community, Security, Sustainability.
>
> If a feature does not improve one of those pillars, question whether it belongs.
>
> ## Version 2 Roadmap
>
> ### Version 2.1 — Proof of Value
>
> Finish the Proof of Value engine. Move away from isolated rewards. Instead calculate participation from the entire ecosystem.
>
> Examples: Quiz activity, Faucet participation, Games, Community events, Wallet verification, Daily activity, Streaks, Future platform modules.
>
> Create a unified participation score. This should become the heart of WinLEW.
>
> ### Version 2.2 — Unified User Dashboard
>
> Every user should have one profile. One dashboard. One identity.
>
> The dashboard should include: Wallet, Token balance, Quiz statistics, Faucet history, Game history, Achievements, Streaks, Proof of Value score, XP, Reputation, Leaderboards, Badges, Community milestones.
>
> The dashboard should become the user's home.
>
> ### Version 2.3 — Community Platform
>
> Expand community interaction.
>
> Examples: Achievements, Collections, Seasonal challenges, Daily missions, Weekly missions, Community goals, Referral rewards, Event participation.
>
> Everything should reward meaningful contribution.
>
> ### Version 2.4 — Mobile Experience
>
> Bring the complete platform to mobile. Not simply responsive pages. A polished experience.
>
> Users should be able to Verify, Claim faucet, Play quiz, Play games, View dashboard, Manage profile — without losing functionality.
>
> ### Version 2.5 — Platform Polish
>
> Audit the entire platform again. Remove inconsistencies. Improve accessibility. Improve performance. Improve loading times. Improve animations. Improve responsiveness. Reduce technical debt.
>
> The goal is making the platform feel premium.
>
> ## Product Principles
>
> Every feature should be evaluated against these principles:
>
> 1. Participation should create value.
> 2. Knowledge should be rewarded.
> 3. Transparency builds trust.
> 4. Community comes before hype.
> 5. Security is a feature.
> 6. Utility is more valuable than speculation.
> 7. Simple experiences beat complicated systems.
> 8. The blockchain should verify important actions whenever practical.
>
> ## Engineering Rules
>
> Before beginning any feature, ask: Does this improve the user experience? Does this reduce friction? Does this strengthen trust? Does this improve education? Does this encourage participation?
>
> If not, reconsider the feature.
>
> Always prefer polishing existing systems over creating new ones. Avoid duplicate logic. Avoid duplicate UI. Avoid duplicate APIs. Maintain one consistent design language. Maintain one authentication system. Maintain one platform.
>
> ## Success
>
> Users should no longer think "This is a meme token." Users should think "This is one of the most polished community platforms in Web3."
>
> When new users visit WinLEW they should immediately understand: what WinLEW is, why it exists, how to participate, how to earn, why transparency matters, why the community continues to grow.
>
> That is now the objective. Build toward that vision.

---

## Notes for scoping Version 2 work

Each of 2.1–2.5 is, on its own, a substantial project — not a single milestone the way Phases 1–3 were:

- **2.1 (Proof of Value)** needs a data model decision before any code: what feeds a "unified participation score," how it's weighted across quiz/faucet/games/verification/streaks, and whether it's computed on read or maintained incrementally. This is foundational to 2.2 (the dashboard would display it) and 2.3 (missions/achievements would likely key off it), so it's the natural dependency-order starting point if sequencing matters.
- **2.2 (Unified Dashboard)** is effectively a new application surface (XP, reputation, badges, leaderboards, achievements, streaks, all in one place) — the engineering rules explicitly favor "polishing existing systems over creating new ones," so this should probably absorb and consolidate the existing scattered pieces (profile page, quiz standings, wallet chip — flagged as a gap in the Version 1 whitepaper, §2) rather than be built as a parallel new thing.
- **2.3 (Community Platform)** — seasonal challenges, missions, referral rewards — has real economic implications (new reward flows) similar in weight to the faucet/quiz work already done; would need the same anti-farm/atomic-claim rigor already established for those.
- **2.4 (Mobile Experience)** — "not simply responsive pages" implies a scope beyond CSS breakpoints (offline handling, app-like navigation, possibly a PWA manifest/service worker — both of which already exist as untracked files in `src/public/`, worth investigating before assuming a from-scratch build).
- **2.5 (Platform Polish)** depends on 2.1–2.4 existing first — auditing systems that don't exist yet isn't meaningful.

No sub-release is marked highest-priority the way Phase 3 was in the Version 1 brief. Starting point and depth for each is a product decision, not an engineering one — to be confirmed before implementation begins.
