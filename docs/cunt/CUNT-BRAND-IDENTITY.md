# Brand Identity (§31, §32, §33)

> **The branding can look irresponsible. The infrastructure cannot.**

---

## 1. The name hierarchy

Three names, three jobs. §32's rule, and the reason it exists: a project whose
every asset depends on an offensive ticker cannot be printed, posted, streamed
or worn.

| Name | Used for |
|---|---|
| **TUESDAY** | the primary visual brand — shirts, stickers, graphics, headers |
| **See You Next Tuesday** | the full project identity — the joke, said properly |
| **$CUNT** | the ticker, in crypto contexts only — explorers, wallets, DEX listings |

### The rule is already being followed, and more strictly than §32 asks

Measured on the live page:

| | Occurrences |
|---|---|
| `TUESDAY` | **13** |
| `See You Next Tuesday` | **8** |
| `platypus` | 6 |
| `God's Joke` | 3 |
| **`CUNT`** | **0** |

The ticker appears **nowhere** on the page — not in visible text, not in
markup, not in alt text. §32 permits it "where ticker context requires"; the
page needed it nowhere and therefore used it nowhere.

The Discord bot is the opposite and correctly so: `src/cunt/commands.js` names
the ticker 4 times, because a wallet-and-mint context is exactly where the
ticker belongs.

**That split is the brand working.** Same project, two surfaces, two registers.

### Consequence worth stating

A page that never prints its own ticker has to name the token another way. It
currently says *"this token"* and *"it is not $WinLEW"*. That is fine while
nothing is minted. **Once a mint exists, the ticker and the mint address must
appear** — in the disclaimer block, where §1's "not the utility token" warning
lives. Brand restraint must never cost a buyer the ability to verify what they
are buying.

## 2. The mascot

**A platypus. Concept: God's Joke.**

The reasoning is the joke: it looks like nature combined unrelated components
and shipped the result anyway. Which is also what this project is — a drunk
idea, engineered sober.

Approved phrases (§33 says preserve only these, and do not invent more during
engineering work):

- **GOD'S JOKE. OUR TOKEN.**
- **ODD BY DESIGN. LEGEND BY DEFAULT.**
- **NO ROADMAP. JUST TUESDAYS.**

That is the full approved list. Anything else needs approval before it ships.

## 3. Visual language

From §31 and the live stylesheet:

| Element | Value |
|---|---|
| Surface | dark brick wall, graffiti, stickers, paint splatter |
| Orange | `#f47b20` |
| Gold / yellow | `#f3b73e` |
| Creams | `#f8efe7`, `#f3eadf`, `#dfd0c3` |
| Section headings | `01 / THE LORE`, `02 / RECEIPTS, NOT HYPE`, `03 / THE PART WE COULD HAVE DELETED` |

### The one rule that matters visually

> **Keep the page chaotic. Keep the data sections exact.**

Graffiti around the edges, receipts in the middle. The moment a number is
styled like a joke, the joke stops working — because the entire proposition is
that you can check everything.

## 4. The two CUNTs

§1: document the Base original, never hide it.

> **THE FIRST CUNT** — created drunk. Base.
> **THE SECOND CUNT** — engineered sober. Solana.
> *"We learned absolutely nothing."*

Base contract: `0x555cc44a50f228da3a48ea8b8ab0d4831bff0804` — retired, and
**never to be presented as the Solana token**.

The page carries this under `03 / THE PART WE COULD HAVE DELETED`, which is the
right title for it: admitting the origin costs nothing, because there were zero
outside buyers, and a project claiming "we are not rewriting history" cannot
delete the chain it launched on.

## 5. Tuesday as culture, not price

§34. Tuesday means **participation**, not price.

Do not create weekly burns, weekly pumps, trading contests or price-linked
rituals without separate review. The heartbeat is that people show up — and
`PROOF OF TUESDAY > PROOF OF WEALTH` is the slogan for it.

Worth carrying the caveat from `CUNT-PROOF-OF-TUESDAY.md` into any marketing
use of that line: it measures **availability**, which is a different bias from
wealth, not the absence of one. The slogan is a direction, not a claim of
fairness.

## 6. What the brand may never say

§52, and these are not stylistic preferences:

- No investment framing, guaranteed return, ROI, yield, passive income or
  appreciation
- No "pay X and earn it back"
- No promise of listing, price, liquidity value or resale value
- Tuesday rewards are **participation mechanics**, denominated in CUNT — never
  "0.2 CUNT worth of SOL", which would turn a mechanic into a payment
  obligation
- Vanity wallet fees, if ever sold, are a **service fee for computational
  work**

The humour is allowed to be reckless. **The claims are not.**

## 7. Why "NO ROADMAP. JUST TUESDAYS." is safe to print

§53 draws the line precisely, and it is worth being explicit because the slogan
looks like an excuse not to plan.

Publicly: no roadmap theatre, no quarterly promise grid.

Internally: milestones, tests, deployment gates, an audit trail, versioning,
and a mainnet gate that a **test refuses to let anyone flip**. This sprint
produced 16 documents and 192 tests behind a page that says "no roadmap".

The joke is only funny because the engineering underneath is not.
