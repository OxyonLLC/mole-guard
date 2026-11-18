# Liquidity Policy — DRAFT (§10, §11, §12)

**Status: DRAFT. NO POOL EXISTS AND NONE WILL BE CREATED THIS SPRINT** (§12).

Every figure here is measured — from WinLEW's live Raydium pool, from Raydium's
API, or from `src/cunt/liquiditySim.js`, which reproduces that pool's real
price to within 5%.

---

## 1. The baseline: what WinLEW's pool actually looks like

Not a hypothetical. Measured 2026-08-08:

| | |
|---|---|
| Pool value | **$714** (4.78 WSOL + 35,504,420 WinLEW) |
| LP supply | 409.13 |
| Held by **Developer Reserve** | **53.66%** |
| Held by two outside wallets | 43.82% + 2.52% |
| **LP burned / locked** | **0.05%** |
| 24h volume | $8.96 |
| LP fees earned | **$6.87/year — 0.96% APR** |
| A 1 SOL buy slips | **21.2%** |
| A 10 SOL buy slips | **209%** |

Three things follow, and they are the reason this policy exists.

**"We provided liquidity" is not a commitment that it stays.** 53.66% of that
position is withdrawable by one wallet, today, with no cliff. Nothing prevents
it. That is the default state of any pool unless the LP is explicitly locked.

**Fees will not fund anything.** At real volume the entire position earns
**under two cents a day**. Any plan premised on LP income is premised on
nothing.

**The pool is too thin to trade.** A 10 SOL buy — about $750 — moves the price
209%. This is what a $714 pool means in practice.

## 2. The three levers are independent

From `CUNT-SIMULATORS.md`, and it is the most useful thing to hold in mind when
choosing numbers:

| To change | Adjust | Does NOT depend on |
|---|---|---|
| **Opening price** | the ratio CUNT ÷ SOL | either side alone |
| **Slippage / tradeability** | the **SOL side** | the token side, at all |
| **How honest the FDV is** | the **token side** | the SOL side, at all |

`depthRatio = 2 × (tokens in pool ÷ total supply)` — the price cancels out. So
**adding SOL cannot make the FDV less fictional**, and adding tokens cannot make
the pool easier to trade. Treating "more liquidity" as one number conflates two
decisions.

## 3. Opening scenarios

The full 100M market allocation, SOL at $150:

| SOL in | Opening price | FDV | 1 SOL buy slips | 10 SOL buy slips |
|---|---|---|---|---|
| 10 | $0.0000150 | $15,000 | 10.25% | **100.3%** |
| 25 | $0.0000375 | $37,500 | 4.25% | 40.3% |
| 50 | $0.0000750 | $75,000 | 2.25% | 20.3% |
| 100 | $0.000150 | $150,000 | 1.25% | 10.3% |
| 250 | $0.000375 | $375,000 | 0.65% | 4.3% |

**Read the slippage column, not the FDV column.** The FDV is whatever the ratio
says; the slippage is what a buyer actually experiences. At 10 SOL, one $1,500
buy costs the buyer 100%.

There is no correct row here — it depends on how much SOL is genuinely
available, which is an open question (§8). But the row should be chosen for the
slippage, and the resulting price accepted as a consequence.

## 4. §12's eleven questions

| # | Question | Draft answer |
|---|---|---|
| 1 | Who controls the LP position? | **Multisig** (§18). Not a single key — that is the WinLEW situation above. |
| 2 | Can liquidity be removed? | **Only if we choose to allow it.** This is the central decision, §5 below. |
| 3 | Is the position locked? | **Recommended: yes.** Not locked by default; locking is an act. |
| 4 | For how long? | Recommended **permanent (burn)** for the genesis position. See §5. |
| 5 | Is the lock verifiable? | Yes — a burn is verifiable from LP supply; a time-lock from the escrow account. Must be published in `TRANSPARENCY_COMPONENTS`. |
| 6 | Where do LP fees go? | **0.21% of volume**, accruing into the position. If the LP is burned they are unrecoverable; if locked, they accrue to the beneficiary. Must be decided *with* the lock. |
| 7 | Can liquidity migrate? | Only by removing and re-adding — impossible if burned. A migration path is the same capability as a rug; treat it as one. |
| 8 | What authority can modify it? | Whoever holds the LP tokens. There is no separate permission. |
| 9 | Can that authority be multisig? | Yes, and must be, for anything not burned. |
| 10 | If a DEX becomes unavailable? | Burned LP is **stranded** — the honest cost of burning. Mitigation is a second venue added later, not retained control of the first. |
| 11 | How is secondary liquidity authorized? | By the same multisig, from the same 100M bucket, disclosed before it is added. Never from the community allocation (§63). |

## 5. The central decision — burn, lock, or retain

| Option | Credibility | Reversible | Cost |
|---|---|---|---|
| **Burn the LP** | Highest — provably cannot be pulled | **Never** | Position stranded if the DEX dies; fees unrecoverable |
| **Time-lock (Streamflow/Jupiter)** | High, and verifiable | At expiry | Requires choosing a duration; needs a beneficiary who is not a team wallet |
| **Retain in multisig** | Lowest — "trust us" | Any time | Indistinguishable from WinLEW's current position |

**Recommendation: burn the genesis LP.**

The argument is that this project's entire pitch is receipts. A locked position
says "we promise not to for N years"; a burned one says "we cannot". Given
§43's prohibition on manufactured decentralisation, the stronger claim is worth
its cost — and the cost is real and should be stated: **the SOL is gone. It is
not a treasury asset that might come back.**

If burning is unacceptable, a **long verifiable time-lock with a non-team
beneficiary** is the fallback. Retaining it in a multisig is not recommended
and should not be described as "locked liquidity", because it is not.

*(Raydium reportedly offers a mechanism to permanently lock LP while still
collecting fees. That would dominate a plain burn if it exists as described —
**verify it directly before relying on it**, rather than on this sentence.)*

## 5b. "All of the above" — a split, and it works

Owner leaning 2026-08-08. Burn, lock and retain are mutually exclusive **for a
given position**, but the 100M market bucket does not have to be one position.

A worked split, illustrative only:

| Portion | Treatment | What it buys |
|---|---|---|
| 50M | **burned** | the provable claim — "this half can never be pulled" |
| 30M | **time-locked**, non-team beneficiary | verifiable commitment with an exit if the venue dies |
| 20M | **multisig-retained** | the operational reserve — a second venue later, or a migration |

Honest accounting of what this costs:

- The credibility claim weakens from *"we cannot"* to *"we cannot touch half"*.
  That is still far stronger than most projects and much stronger than a bare
  lock, but it is a different sentence and must be written as one.
- **It must never be described as "liquidity is locked".** The precise
  statement is "50% burned, 30% locked until <date>, 20% multisig-controlled",
  with all three verifiable on-chain.
- Three positions is three things to publish and keep accurate on
  `/cunt/transparency/`, not one.

The split is a legitimate answer, and the ratios are the decision. What is not
legitimate is choosing a split and then describing it with the burn's sentence.

## 6. Venue

**Single primary venue at birth — Raydium.** §10's leaning, and the simulator
supports it: splitting a fixed amount of SOL across two pools roughly doubles
slippage in each, because slippage depends on the SOL side alone.

Pool creation costs **0.15 SOL** (measured). Orca can be added later from the
same bucket, disclosed, once there is enough depth that fragmenting it does not
hurt.

## 7. Non-negotiables

1. **No pool this sprint** (§12).
2. Liquidity comes from the **100M market allocation only** — never from the
   800M community bucket (§63 warns about exactly this confusion).
3. The LP position and its status are **published** in the transparency
   registry, as WinLEW's now is.
4. **Never describe unlocked liquidity as locked.**
5. No claim that liquidity depth implies value, price support, or a floor.

## 8. Open decisions

1. **How much SOL is actually available?** Everything in §3 depends on it, and
   nothing else can be chosen first.
2. **Burn, lock, or retain** (§5) — the credibility decision.
3. **If locked: duration and beneficiary.** The beneficiary must not be a team
   wallet, for the same reason the 100M protocol lock's was not.
4. **Where fees go**, decided together with (2).
5. Whether to verify and use Raydium's permanent-lock-with-fees mechanism.

Question 1 gates the rest. Until there is a real SOL figure, every table in §3
is arithmetic without a decision attached.
