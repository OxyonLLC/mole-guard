# WinLEW Governance Proposal Template

> **⚠ PUBLISHED COPY: `src/public/governance/proposal-template/index.html`.**
> Served at <https://winlew.co/governance/proposal-template/> and cited from the
> Governance page. Keep the two in sync — if a field is added, removed, or its
> rule changes here, update the published page in the same commit. Added
> 2026-08-04.

Use this as the starting point for a new entry in `src/mole/governanceData.js`'s `PROPOSALS` array. See `docs/governance-v1.md` for the full rules this template implements, and `PRODUCT_BOUNDARIES.md` for what is and isn't in scope for a WinLEW governance proposal at all.

Before drafting: run `node --test test/mole/governanceData.test.mjs` after adding your record — `validateProposalRecord()` will catch missing/invalid fields immediately.

```js
{
  id: "short-kebab-case-id-with-year",          // must be unique — findDuplicateProposalIds() checks this
  schemaVersion: 1,
  title: "Plain-language title",
  summary: "One or two sentences — this is what shows on the /governance/ landing page card.",
  fullDescription: "The full proposal text. What is being proposed, and why.",
  author: "Display name or handle",
  authorType: "maintainer",                      // or "community-member" / "system"
  category: "features",                          // one of the 14 fixed PROPOSAL_CATEGORIES — see governance-v1.md
  governanceMode: "advisory",                    // advisory / community-approved / maintainer-ratified / binding-within-defined-policy
  status: "draft",                                // start here — see PROPOSAL_STATUSES / VALID_STATUS_TRANSITIONS

  createdIso: "2026-01-01T00:00:00Z",
  discussionStartIso: null,                       // set once Discord discussion opens
  votingStartIso: null,                           // leave null until scheduled — a null votingStartIso means
                                                   // "not yet open for a vote," and choices are not required until it's set
  votingEndIso: null,
  executionDeadlineIso: null,                     // only if approval implies a deadline for maintainer action

  eligibilityRule: {
    authenticatedUser: true,
    verifiedWallet: true,
    minWinlewBalance: 1_000_000,                  // matches GOVERNANCE_CONFIG.minWinlewToVote unless this proposal
                                                   // has an explicit, documented reason to differ
    proposalSpecificOverride: null,
  },
  votingMethod: "one-wallet-one-vote",
  choices: null,                                  // set to e.g. ["Yes", "No"] once votingStartIso is set — required
                                                   // (>=2, no duplicates) only once the proposal is actually voteable
  quorumRule: { type: "fixed", minVotes: 0 },      // set a real number before going active — never a fabricated
                                                   // percentage of "all holders"
  approvalThresholdOverride: null,                 // leave null to use the standard >50% (or >2/3 for
                                                   // governance-rules category) default
  snapshotRule: "per-proposal-boundary-first-check-lock-in", // set from GOVERNANCE_CONFIG.snapshotMethod — see
                                                   // docs/governance-v1.1-hardening.md for what this guarantees
                                                   // and does not (not a full chain-wide historical snapshot)

  supportingEvidence: [],                          // [{ label, url }]
  relatedPlatformPages: [],                         // e.g. ["/quiz/", "/burn/"]
  financialImpact: "None." ,
  tokenImpact: "None.",
  securityConsiderations: "",
  risks: "",
  alternativesConsidered: "",
  implementationPlan: "",
  maintainerPosition: null,                         // fill in once a maintainer has reviewed it

  finalResults: null,                               // required once status reaches a CLOSED state — see governance-v1.md
  finalDecision: null,
  executionStatus: "not-applicable",                 // not-applicable / pending / in-progress / completed / failed / declined
  executionEvidence: [],                              // required (>=1) once status is "executed"
  cancellationOrRejectionReason: null,

  lastUpdatedIso: "2026-01-01T00:00:00Z",
  publicNotes: "",
  burnDetails: null,                                  // REQUIRED (see below) if category === "burn-program"

  discussionUrl: "https://discord.gg/dJ7rPhy333",     // or a specific channel/thread link
  metadata: {},                                        // namespaced extension point — do not put load-bearing
                                                         // fields here; this is for optional, non-critical extras only
}
```

## If `category` is `"burn-program"`

`burnDetails` is required and must include:

```js
burnDetails: {
  proposedAmountDisplay: "e.g. 5,000,000 WinLEW",
  proposedSource: "e.g. staged/held burn-wallet balance",
  proposedBenchmark: "e.g. tied to the August 1 annual benchmark",
  reason: "Why this burn, why now.",
  effectOnGoal: "How this moves the long-term 100M goal — reference /burn/'s live progress, don't restate a stale number.",
  executionAuthority: "Maintainer, after safety review", // do not write anything implying automatic/on-chain execution
  executionDeadline: "e.g. within 30 days of approval, or null",
}
```

**Never write a number here as if it's the canonical current burn total.** The proposal detail page fetches that live from `/api/burn/status` — this object should only contain the *proposed* new amount and its rationale.

## Reminders

- Do not fabricate a vote result. `finalResults`/`finalDecision` stay `null` until a real vote actually happens and closes.
- Do not mark `status` as anything beyond `draft`/`review`/`discussion` until the proposal is genuinely ready — see `VALID_STATUS_TRANSITIONS` in `governanceData.js` for what's actually a legal next step from wherever it is now.
- If this is a template/example rather than a real proposal, put **"Example — Not Open for Voting"** directly in the title and keep `status` at `draft`, never `active`.
