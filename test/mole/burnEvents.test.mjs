// Pure-function tests for the Burn Program data model. No I/O, no RPC — the
// seeded BURN_EVENTS are exact on-chain-verified records (see
// docs/burn-program.md); these tests exercise the summarization/progress
// math, not the underlying data's accuracy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BURN_EVENTS,
  BURN_EVENT_STATUSES,
  BURN_TARGET_BASE_UNITS,
  summarizeBurnEvents,
  computeBurnProgress,
  getBurnEventById,
  COMMUNITY_BURNS,
  summarizeCommunityBurns,
} from '../../src/mole/burnEvents.js';

describe('burnEvents: seeded data integrity', () => {
  test('every seeded event has a unique id', () => {
    const ids = BURN_EVENTS.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every seeded event has an amount as a string, never a number (no float risk)', () => {
    for (const event of BURN_EVENTS) {
      assert.equal(typeof event.amountBaseUnits, 'string');
      assert.doesNotThrow(() => BigInt(event.amountBaseUnits), `${event.id} amount must be a valid BigInt string`);
    }
  });

  test('every confirmed-burn event has a real explorer URL containing its own signature', () => {
    // Only CONFIRMED_BURN carries this guarantee. A PENDING_VERIFICATION
    // event (e.g. a claimed burn reconstructed from a supply delta rather
    // than a located transaction) legitimately has no signature yet — that
    // gap is exactly why it isn't CONFIRMED_BURN.
    for (const event of BURN_EVENTS) {
      if (event.status !== BURN_EVENT_STATUSES.CONFIRMED_BURN) continue;
      assert.ok(event.explorerUrl?.includes(event.signature), `${event.id}'s explorerUrl must reference its own signature`);
    }
  });

  test('every seeded event has a known, valid status', () => {
    const validStatuses = new Set(Object.values(BURN_EVENT_STATUSES));
    for (const event of BURN_EVENTS) {
      assert.ok(validStatuses.has(event.status), `${event.id} has an unrecognized status: ${event.status}`);
    }
  });
});

describe('burnEvents: summarizeBurnEvents', () => {
  test('empty input produces a zeroed, non-null summary', () => {
    const summary = summarizeBurnEvents([]);
    assert.equal(summary.eventCount, 0);
    assert.equal(summary.confirmedBurnedBaseUnits, '0');
    assert.equal(summary.stagedBaseUnits, '0');
  });

  test('only confirmed-burn events count toward the confirmed total', () => {
    const summary = summarizeBurnEvents([
      { amountBaseUnits: '1000000', status: BURN_EVENT_STATUSES.CONFIRMED_BURN },
      { amountBaseUnits: '500000', status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET },
      { amountBaseUnits: '250000', status: BURN_EVENT_STATUSES.PENDING_VERIFICATION },
    ]);
    assert.equal(summary.confirmedBurnedBaseUnits, '1000000');
    assert.equal(summary.confirmedEventCount, 1);
  });

  test('transferred-to-burn-wallet and queued events count as staged, never as confirmed', () => {
    const summary = summarizeBurnEvents([
      { amountBaseUnits: '2000000', status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET },
      { amountBaseUnits: '3000000', status: BURN_EVENT_STATUSES.QUEUED },
    ]);
    assert.equal(summary.confirmedBurnedBaseUnits, '0');
    assert.equal(summary.stagedBaseUnits, '5000000');
    assert.equal(summary.stagedEventCount, 2);
  });

  test('disputed and unknown events count toward neither confirmed nor staged', () => {
    const summary = summarizeBurnEvents([
      { amountBaseUnits: '9999999', status: BURN_EVENT_STATUSES.DISPUTED },
      { amountBaseUnits: '9999999', status: BURN_EVENT_STATUSES.UNKNOWN },
    ]);
    assert.equal(summary.confirmedBurnedBaseUnits, '0');
    assert.equal(summary.stagedBaseUnits, '0');
    assert.equal(summary.eventCount, 2, 'they still count toward the raw event total, just not toward either sum');
  });

  test('the real seeded BURN_EVENTS sum to the independently-verified on-chain total', () => {
    // 2 original 2025 burns + 29 BOOST TWAP burns (2026-07-22, promoted from
    // PENDING_VERIFICATION once independently located and verified — see
    // docs/burn-program.md §7) + the 2026-08-01 benchmark burn (§6a).
    //
    // This total is cross-checkable against the chain without trusting this
    // file: mint supply (950,000,000 after 2026-08-01) plus this figure equals
    // 999,707,077.187484, the implied ~1B launch supply. If someone adds a
    // fabricated or double-counted event, that invariant breaks.
    const summary = summarizeBurnEvents();
    assert.equal(summary.confirmedBurnedBaseUnits, '49707077187484');
    assert.equal(summary.confirmedEventCount, 32);
  });

  test('stagedInflow is a LIFETIME INFLOW, not a current balance — burning staged tokens never reduces it', () => {
    // The distinction that bit us on 2026-08-01: tokens are staged in, then
    // some are burned and some moved out, and this ledger only records
    // arrivals. So the sum can exceed the wallet's real balance and that is
    // correct behaviour, not drift. Anything wanting "awaiting burn right
    // now" must read the live wallet balance instead.
    const stagedThenBurned = summarizeBurnEvents([
      { amountBaseUnits: '50000000000000', status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET },
      { amountBaseUnits: '50000000000000', status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET },
      // Destroying staged tokens does NOT decrement the staged inflow total.
      { amountBaseUnits: '14878231210253', status: BURN_EVENT_STATUSES.CONFIRMED_BURN },
    ]);
    assert.equal(stagedThenBurned.stagedInflowBaseUnits, '100000000000000');
    assert.equal(stagedThenBurned.confirmedBurnedBaseUnits, '14878231210253');
  });

  test('the 800k Contribute-flow transfer is seeded and staged, and never inflates burned progress', () => {
    // Found on 2026-08-01 by reconciling the burn wallet: a real inflow the
    // staged ledger had been silently omitting. Seeded rather than excused,
    // so stagedInflow stops understating known arrivals — but it is a
    // transfer, so confirmed progress must not move because of it.
    const contribution = BURN_EVENTS.find((e) => e.id === 'transfer-2026-07-25-contribute-flow-test');
    assert.ok(contribution, 'the 800k Contribute-flow transfer should be recorded');
    assert.equal(contribution.status, BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET);
    assert.equal(contribution.amountBaseUnits, '800000000000');

    const summary = summarizeBurnEvents();
    // All nine inflows the burn wallet has ever received, seeded 2026-08-01.
    assert.equal(summary.stagedEventCount, 9);
    assert.equal(summary.stagedInflowBaseUnits, '119331816055862');
    // The invariant that actually matters: staged inflow never leaks into burned.
    assert.equal(summary.confirmedBurnedBaseUnits, '49707077187484');
  });

  test('each 2025 burn destroyed exactly the inflows that preceded it', () => {
    // Reconstructed 2026-08-01 from the wallet's full signature history. If
    // any seeded amount were fabricated or mis-transcribed, these would not
    // balance to the last decimal.
    const amount = (id) => BigInt(BURN_EVENTS.find((e) => e.id === id).amountBaseUnits);

    const round1 =
      amount('transfer-2025-02-16-dev-reserve-to-burn-wallet') +
      amount('transfer-2025-02-22-winlew-sol-to-burn-wallet');
    assert.equal(round1, amount('burn-2025-02-22'), '300,000 + 1,529,373.21 = burn-2025-02-22');

    const round2 =
      amount('buy-and-burn-2025-02-22-market-buy') +
      amount('transfer-2025-04-03-dev-reserve-to-burn-wallet');
    assert.equal(round2, amount('burn-2025-08-02'), '77,932.510911 + 10,000,000 = burn-2025-08-02');
  });

  test('the burn wallet reconciles to its live on-chain balance', () => {
    // inflow - burns this wallet authorized - the pre-burn outflow = 50,000,000,
    // the balance read from chain on 2026-08-01. The 29 BOOST burns are
    // excluded deliberately: the PumpSwap pool executed those against its own
    // reserve and they never touched this wallet (docs/burn-program.md §7).
    const summary = summarizeBurnEvents();
    const amount = (id) => BigInt(BURN_EVENTS.find((e) => e.id === id).amountBaseUnits);

    const burnsAuthorizedHere =
      amount('burn-2025-02-22') + amount('burn-2025-08-02') + amount('burn-2026-08-01');
    assert.equal(burnsAuthorizedHere.toString(), '26785536931164');

    const OUTFLOW_BEFORE_AUG1_BURN = 42546279124698n; // moved out; not an event
    const implied =
      BigInt(summary.stagedInflowBaseUnits) - burnsAuthorizedHere - OUTFLOW_BEFORE_AUG1_BURN;

    assert.equal(implied.toString(), '50000000000000', 'implied balance must equal the live 50,000,000');
  });

  test('only un-consumed staged entries are "awaiting burn", and they equal the live wallet balance', () => {
    // The Burn Center renders a staged entry as "Awaiting burn" unless it
    // carries supersededBy. Once the ledger gained the full 2025 history,
    // getting this wrong would have claimed ~69.6M was awaiting burn when the
    // wallet holds 50M. Every staged entry except the 2026-08-01 restock has
    // since been destroyed or moved out, so the un-consumed ones must sum to
    // exactly the balance read on-chain.
    const stillAwaiting = BURN_EVENTS.filter(
      (e) => e.status === BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET && !e.supersededBy,
    );
    assert.equal(stillAwaiting.length, 1, 'only the 2026-08-01 restock is still awaiting burn');
    assert.equal(stillAwaiting[0].id, 'transfer-2026-08-01-restock-burn-wallet');

    const total = stillAwaiting.reduce((sum, e) => sum + BigInt(e.amountBaseUnits), 0n);
    assert.equal(total.toString(), '50000000000000', 'must equal the live burn wallet balance');

    // Every consumed entry must name the burn that consumed it, and that burn
    // must actually exist — no dangling references.
    for (const e of BURN_EVENTS.filter((x) => x.supersededBy)) {
      assert.ok(
        BURN_EVENTS.some((b) => b.id === e.supersededBy && b.status === BURN_EVENT_STATUSES.CONFIRMED_BURN),
        `${e.id} points at ${e.supersededBy}, which must be a real confirmed burn`,
      );
    }
  });

  test('a buy-and-burn PURCHASE is staged, never counted as a destruction', () => {
    // Buying tokens off the market removes nothing from supply — they sit in
    // the burn wallet exactly like a donation until a real burn instruction
    // destroys them. Collapsing the buy into the burn would let a purchase
    // masquerade as a destruction, which is the failure mode §4 exists for.
    const buy = BURN_EVENTS.find((e) => e.id === 'buy-and-burn-2026-01-06-market-buy');
    assert.ok(buy, 'the 2026-01-06 buy-and-burn purchase should be recorded');
    assert.equal(buy.status, BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET);
    assert.equal(buy.amountBaseUnits, '2624510334951');

    const freecryptoa = BURN_EVENTS.find((e) => e.id === 'transfer-2026-05-30-freecryptoa-donation');
    assert.ok(freecryptoa, "FreeCryptoA's donation should be recorded");
    assert.equal(freecryptoa.status, BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET);
    assert.equal(freecryptoa.amountBaseUnits, '4000000000000');
    assert.equal(freecryptoa.sourceWallet, '64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp');

    // Together these two reconstruct the 2026-07-16 burn wallet reading
    // exactly — the figure the docs once called "no recorded origin".
    const sum = BigInt(buy.amountBaseUnits) + BigInt(freecryptoa.amountBaseUnits);
    assert.equal(sum.toString(), '6624510334951');
  });

  test('stagedBaseUnits is kept as a deprecated alias of stagedInflowBaseUnits', () => {
    // /api/burn/status still ships the old key; it must never drift from the
    // explicitly-named one.
    const summary = summarizeBurnEvents();
    assert.equal(summary.stagedBaseUnits, summary.stagedInflowBaseUnits);
  });

  test('the 2026-08-01 restock transfer is staged, never counted as destroyed', () => {
    // Regression guard for §4's core distinction: 50M was sent back into the
    // burn wallet right after the benchmark burn. It must never reach the
    // confirmed-burn total just because it landed in the burn wallet.
    const restock = BURN_EVENTS.find((e) => e.id === 'transfer-2026-08-01-restock-burn-wallet');
    assert.ok(restock, 'the 2026-08-01 restock transfer should be recorded');
    assert.equal(restock.status, BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET);
    assert.equal(restock.amountBaseUnits, '50000000000000');

    const burn = BURN_EVENTS.find((e) => e.id === 'burn-2026-08-01');
    assert.ok(burn, 'the 2026-08-01 benchmark burn should be recorded');
    assert.equal(burn.status, BURN_EVENT_STATUSES.CONFIRMED_BURN);
    assert.equal(burn.amountBaseUnits, '14878231210253');
  });

  test('default parameter uses the real seeded BURN_EVENTS when called with no arguments', () => {
    const summary = summarizeBurnEvents();
    assert.equal(summary.eventCount, BURN_EVENTS.length);
  });
});

describe('burnEvents: computeBurnProgress', () => {
  test('zero burned is zero percent, full remaining', () => {
    const progress = computeBurnProgress('0', '100000000000000');
    assert.equal(progress.percentOfTarget, 0);
    assert.equal(progress.remainingBaseUnits, '100000000000000');
  });

  test('a value exactly at the target is 100%, zero remaining', () => {
    const progress = computeBurnProgress('100000000000000', '100000000000000');
    assert.equal(progress.percentOfTarget, 100);
    assert.equal(progress.remainingBaseUnits, '0');
  });

  test('a value beyond the target is clamped to 100%, remaining floors at zero (never negative)', () => {
    const progress = computeBurnProgress('999999999999999', '100000000000000');
    assert.equal(progress.percentOfTarget, 100);
    assert.equal(progress.remainingBaseUnits, '0');
  });

  test('percent is computed to one decimal place using integer arithmetic, not floating point', () => {
    // 1/3 of the target -> 33.3%, not a float-precision artifact like 33.33333333333333
    const progress = computeBurnProgress('33333333333333', '100000000000000');
    assert.equal(progress.percentOfTarget, 33.3);
  });

  test('the real seeded total against the real 100M target is 49.7%', () => {
    const progress = computeBurnProgress('49707077187484', BURN_TARGET_BASE_UNITS);
    assert.equal(progress.percentOfTarget, 49.7);
    assert.equal(progress.remainingBaseUnits, '50292922812516');
  });

  test('a non-positive target never divides by zero or throws', () => {
    assert.doesNotThrow(() => computeBurnProgress('500', '0'));
    assert.equal(computeBurnProgress('500', '0').percentOfTarget, 0);
  });
});

describe('burnEvents: getBurnEventById', () => {
  test('finds a real seeded event by id', () => {
    const event = getBurnEventById('burn-2025-02-22');
    assert.ok(event);
    assert.equal(event.amountBaseUnits, '1829373210000');
  });

  test('returns null for an unknown id, not undefined or a throw', () => {
    assert.equal(getBurnEventById('does-not-exist'), null);
  });
});

// ── Community burns (2026-08-19) ─────────────────────────────────────────
//
// Supply destroyed by holders rather than by this project. The whole risk here
// is presentational: these must never flatter the project's own burn progress,
// and the list must never be read as complete.
describe('burnEvents: community burns are counted apart', () => {
  test('the total is derived from the rows, to the base unit', () => {
    const expected = COMMUNITY_BURNS.reduce((sum, e) => sum + BigInt(e.amountBaseUnits), 0n);
    assert.equal(summarizeCommunityBurns().burnedBaseUnits, expected.toString());
    assert.equal(summarizeCommunityBurns().burnedBaseUnits, '100830472170',
      '100,830.472170 WinLEW as of the 2026-08-19 scan');
  });

  test('they do NOT appear in the project ledger or its progress', () => {
    const ids = new Set(BURN_EVENTS.map((e) => e.id));
    for (const event of COMMUNITY_BURNS) {
      assert.ok(!ids.has(event.id), `${event.id} must not be in BURN_EVENTS`);
    }
    // The target measures what this project destroys. A stranger clearing out
    // a wallet is not progress toward it.
    const before = summarizeBurnEvents().confirmedBurnedBaseUnits;
    assert.equal(summarizeBurnEvents(BURN_EVENTS).confirmedBurnedBaseUnits, before);
  });

  test('the list declares itself incomplete', () => {
    // Only wallets this project could enumerate were ever scanned. Anyone who
    // bought on the open market and burned is still invisible, so this figure
    // is a floor and the summary has to say so.
    assert.equal(summarizeCommunityBurns().complete, false);
    assert.match(summarizeCommunityBurns().scannedPopulation, /giveaway recipients/i);
  });

  test('the six-base-unit row survives — a ledger that drops small rows is not one', () => {
    const tiny = COMMUNITY_BURNS.find((e) => e.amountBaseUnits === '6');
    assert.ok(tiny, 'an earlier pass reported this burn as "0" purely because the display divided it away');
    assert.equal(tiny.dateIso, '2025-11-22T01:24:38.000Z');
  });

  test('every row carries a signature and a matching explorer link', () => {
    for (const event of COMMUNITY_BURNS) {
      assert.match(event.signature, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/, `${event.id} signature`);
      assert.equal(event.explorerUrl, `https://solscan.io/tx/${event.signature}`);
      assert.ok(Number(event.slot) > 0, `${event.id} needs the slot it landed in`);
      assert.match(event.authority, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${event.id} authority`);
    }
  });

  test('ids are unique', () => {
    const ids = COMMUNITY_BURNS.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
