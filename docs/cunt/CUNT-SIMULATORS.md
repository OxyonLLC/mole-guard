# CUNT Simulators — liquidity (§11) and release control (§45)

**Status: OFF-CHAIN MODELS.** Pure arithmetic. No network, no keys, no
transactions, no price feeds. A test asserts neither module references `fetch`,
`Connection`, `sendTransaction`, `process.env` or `Math.random`.

> [`src/cunt/liquiditySim.js`](../../src/cunt/liquiditySim.js) ·
> [`src/cunt/releaseSim.js`](../../src/cunt/releaseSim.js) ·
> [`test/cunt/simulators.test.mjs`](../../test/cunt/simulators.test.mjs) — 20 tests.

---

## 1. The liquidity model is validated against a real pool

A simulator never checked against reality is a spreadsheet with opinions. So
the AMM maths is tested against **WinLEW's actual Raydium pool**, decoded from
its PoolState account on 2026-08-08:

| | Observed | Model |
|---|---|---|
| Pool | 35,504,420.35 CUNT · 4.779927 WSOL | — |
| Price (GeckoTerminal) | $0.000009794 | within 5% |
| TVL (Raydium API) | $713.88 | within 2% |

Same arithmetic, same answers as a live market. That is the basis for trusting
what it says about a pool that does not exist yet.

## 2. The three levers are independent

This is the most useful thing the simulator produced, and it is not obvious.

**100M CUNT in the pool, SOL at $150:**

| SOL in | Opening price | FDV | Depth | Slippage on 1 SOL | on 10 SOL |
|---|---|---|---|---|---|
| 10 | $0.0000150 | $15,000 | 20.0% | 10.25% | 100.25% |
| 25 | $0.0000375 | $37,500 | 20.0% | 4.25% | 40.25% |
| 50 | $0.0000750 | $75,000 | 20.0% | 2.25% | 20.25% |
| 100 | $0.000150 | $150,000 | 20.0% | 1.25% | 10.25% |
| 250 | $0.000375 | $375,000 | 20.0% | 0.65% | 4.25% |

**50 SOL in the pool, varying CUNT:**

| CUNT in | Opening price | FDV | Depth | Slippage on 10 SOL |
|---|---|---|---|---|
| 10M | $0.000750 | $750,000 | 2.0% | 20.25% |
| 50M | $0.000150 | $150,000 | 10.0% | 20.25% |
| 100M | $0.0000750 | $75,000 | 20.0% | 20.25% |

Read across both tables and three separate levers fall out:

| What you want to change | What controls it |
|---|---|
| **Opening price** | the **ratio** — CUNT ÷ SOL |
| **Slippage / tradeability** | the **SOL side alone** |
| **How honest the FDV is** | the **token side alone** |

Slippage is identical at 20.25% for 10M, 50M and 100M CUNT — the token side does
not affect it at all. Depth is identical at 20% for 10 SOL and 250 SOL — the SOL
side does not affect that at all.

### §11's warning, demonstrated

> **THE LP RATIO ESTABLISHES THE OPENING PRICE. TOKEN SUPPLY ALONE DOES NOT.**

Same one billion supply, same 100M in the pool, 10 SOL vs 1,000 SOL: the price
and the FDV differ by exactly **100×**. Supply is identical in both. A test
pins the 100× to within 0.001%.

### `depthRatio` and why more SOL cannot fix FDV

```
depthRatio = 2 × (tokens in pool ÷ total supply)
```

The price cancels out completely. Adding SOL raises the price and the FDV in
the same proportion, so it **cannot** make the FDV less fictional — only
putting more of the supply in the pool can.

At the planned 100M market allocation (10% of supply), depth is 20% of FDV.
That is respectable. It is worth knowing that the other 80% of any quoted
market cap is not backed by anything sellable — which is true of every token
and stated here so nobody has to discover it during a drawdown.

*(This relationship was found by a test failing. The first assertion said depth
should be under 1%; it was 20%, because the assertion was wrong and the model
was right.)*

## 3. §8's warning, demonstrated rather than asserted

§8 says a release must not fire because "300M tokens were sold", since volume is
manufacturable. The simulator proves it:

**Attacker: 2 sybil identities, zero genuine participants, wash trading.**

| Trigger | Result |
|---|---|
| `naiveVolumeTrigger` (volume ≥ 300M) | **fires in week 1** — with ≤ 2 participants in the entire system |
| `objectiveTrigger` | **never fires**, across all 52 weeks |

`naiveVolumeTrigger` exists only so its failure is executable. It is not a
candidate.

### The objective trigger

Every condition must hold, and none of them is volume, price or market cap:

| Condition | Default |
|---|---|
| unique claimers | ≥ 250 |
| elapsed weeks | ≥ 12 |
| share of the community bucket distributed | ≥ 30% |
| top-10 concentration | ≤ 40% |
| sybil share | ≤ 25% |

Tested to fire for a genuine, distributed community — and to be **held back** by
concentration (12 participants → top 10 hold nearly everything) and by sybil
dominance.

### What it resists is an OUTSIDER manufacturing a population

That is the attacker §8 describes, and the trigger handles it. It does not
handle the one the authority matrix points at.

`register_participant` is held by the project. Walk the same conditions as the
**registration authority** rather than as an outside attacker:

| Condition | An outsider | The registration authority |
|---|---|---|
| unique claimers ≥ 250 | expensive — needs 250 aged, verifiable accounts | **admit 250** |
| elapsed weeks ≥ 12 | must wait | must wait |
| ≥ 30% distributed | must actually claim | those identities claim; it distributes |
| top-10 concentration ≤ 40% | hard — sybils cluster | **easier** — see below |
| sybil share ≤ 25% | the binding condition | **unmeasurable** — see §6 |

Only the clock genuinely constrains it.

**The concentration condition inverts.** It exists to catch a population where a
few holders dominate — which is what a *real* community looks like, because real
communities have whales. A manufactured population spread evenly across 250
identities puts the top 10 at roughly **4%**, comfortably inside the 40%
ceiling. So the condition rewards whoever can distribute most carefully, and
that is precisely the registration authority.

None of this makes the objective trigger worse than the naive one — it is still
strictly better, and §8's warning stands. But its guarantee should be read as
**"volume cannot summon a release"**, not **"only a genuine community can."**

## 4. Findings

### 4.1 The release schedule is unreachable at plausible reward sizes

600 participants claiming 55% of the time move 330,000 CUNT a week. Against the
800M community bucket:

> **2,424 weeks. About 47 years.**

Two years in, only **4.3%** is distributed. The BELLY stage alone would never
complete.

To clear BELLY's 300M in a year, `reward_per_claim` must be roughly
**17,500 CUNT** — seventeen times the 1,000 that felt natural. Either the reward
is far larger than instinct suggests, or the stage thresholds are unreachable
and the whole staged model is decorative.

**This is the single most actionable output of the sprint so far**, and exactly
the sort of thing §45 exists to surface before a number is written into a
program.

### 4.2 Automation beats participation, roughly 2:1

100 automated identities against 100 genuine ones — equal counts — and the
automated side takes **over 60%** of the distribution, because a script never
misses a Tuesday and people do.

This is not a bug in the model, it is the finding. Any per-claim reward
advantages automation, which is why `maxSybilShare` is a trigger condition and
why `CUNT-PROOF-OF-TUESDAY.md` states plainly that a streak measures a claim
landing rather than a person caring.

### 4.3 A thin pool is brutal, and the current WinLEW pool is thin

A 5 SOL buy into WinLEW's real ~4.8 SOL pool slips **over 30%**. A pool 100×
deeper slips less than a tenth as much on the identical trade.

If $CUNT opens with 10 SOL, a single 10 SOL buy costs the buyer **100%**
slippage. That is the number to look at when deciding the SOL side — not the
FDV.

## 5. Recommendations

None of these are decisions; they are what the model implies.

1. **Set `reward_per_claim` from the schedule, not from intuition.** Pick how
   long BELLY should take, divide. Anything under ~10,000 makes the staged model
   ornamental.
2. **Size the SOL side for tradeability, the token side for honesty.** They are
   independent levers; treating "more liquidity" as one number conflates them.
3. **Never use volume, price or market cap in a release trigger.** Demonstrated
   gameable, in week one, by an attacker with two accounts.
4. **Keep a sybil-share ceiling in the trigger** even though identity gating
   exists — gating raises the cost of sybils, it does not remove them.

## 6. Limits

- **`sybilShare` cannot be computed in production, and the simulator hides
  that.** The model identifies sybils by their name:

  ```js
  const sybilHeld = [...claimsByParticipant.entries()]
    .filter(([id]) => id.startsWith("sybil-"))
  ```

  That is legitimate *inside a simulation* — it is how you measure whether the
  trigger reacts to sybil dominance at all. But it means the model is **told**
  which participants are fake, and nothing on-chain ever will be. A program
  implementing `objectiveTrigger` would need an estimator that does not exist,
  and identities admitted through the legitimate registration path would be
  indistinguishable from genuine ones **by construction**.

  So of the five conditions, one is currently **not implementable**. Either an
  estimator is specified and its false-negative rate stated, or the condition is
  dropped and the trigger stops claiming to measure sybil dominance. Quietly
  shipping it as though the production value were as knowable as the simulated
  one would be the worst of the three.

- Both models are **deterministic and seeded**. A simulator whose output moves
  between runs cannot justify a decision.
- The release model treats claiming as an independent weekly coin flip. Real
  participation is bursty, correlated with announcements, and decays.
- The liquidity model is a single constant-product pool with no arbitrage, no
  other venues, no MEV and no fee tiers. It answers "what does this pool do",
  not "what will the market do".
- Neither model says anything about price *after* launch, and nothing here
  should be read as a forecast.
