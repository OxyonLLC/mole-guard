// Pure-function tests for the Community Liquidity data model. No I/O, no
// RPC -- the seeded COMMUNITY_LIQUIDITY_EVENTS are exact on-chain-verified
// records (see docs/community-liquidity.md); these tests exercise the
// summarization math and the seeded data's internal consistency, not
// whether the underlying on-chain facts are correct.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITY_LIQUIDITY_EVENTS,
  LIQUIDITY_EVENT_TYPES,
  LIQUIDITY_PROVIDER_STATUSES,
  FARM_PROGRAMS,
  FARM_PARTICIPATION,
  TRACKED_POOL_ADDRESS,
  summarizeCommunityLiquidity,
} from '../../src/mole/communityLiquidity.js';

describe('communityLiquidity: seeded data integrity', () => {
  test('every seeded event has a unique id', () => {
    const ids = COMMUNITY_LIQUIDITY_EVENTS.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every seeded event has a unique signature', () => {
    const sigs = COMMUNITY_LIQUIDITY_EVENTS.map((e) => e.signature);
    assert.equal(new Set(sigs).size, sigs.length);
  });

  test('every seeded event has amounts as strings, never numbers (no float risk)', () => {
    for (const event of COMMUNITY_LIQUIDITY_EVENTS) {
      for (const field of ['winlewAmountBaseUnits', 'solAmountLamports', 'lpTokenAmount']) {
        assert.equal(typeof event[field], 'string', `${event.id}.${field} must be a string`);
        assert.doesNotThrow(() => BigInt(event[field]), `${event.id}.${field} must be a valid BigInt string`);
      }
    }
  });

  test('every seeded event has a known type and role', () => {
    const validTypes = new Set(Object.values(LIQUIDITY_EVENT_TYPES));
    for (const event of COMMUNITY_LIQUIDITY_EVENTS) {
      assert.ok(validTypes.has(event.type), `${event.id} has an unrecognized type: ${event.type}`);
      assert.ok(['community', 'founder'].includes(event.role), `${event.id} has an unrecognized role: ${event.role}`);
    }
  });

  test('every event targets the tracked pool and has an explorer URL containing its own signature', () => {
    for (const event of COMMUNITY_LIQUIDITY_EVENTS) {
      assert.equal(event.poolAddress, TRACKED_POOL_ADDRESS);
      assert.ok(event.explorerUrl?.includes(event.signature), `${event.id}'s explorerUrl must reference its own signature`);
    }
  });

  test('every wallet named in FARM_PARTICIPATION appears in at least one event', () => {
    const eventWallets = new Set(COMMUNITY_LIQUIDITY_EVENTS.map((e) => e.wallet));
    for (const wallet of Object.keys(FARM_PARTICIPATION)) {
      assert.ok(eventWallets.has(wallet), `${wallet} in FARM_PARTICIPATION has no matching event`);
    }
  });

  test('FARM_PROGRAMS entries have a label, address, and description', () => {
    for (const [key, farm] of Object.entries(FARM_PROGRAMS)) {
      assert.equal(farm.id, key);
      assert.ok(farm.label);
      assert.ok(farm.address);
      assert.ok(farm.description);
    }
  });
});

describe('communityLiquidity: summarizeCommunityLiquidity', () => {
  test('empty input produces an empty summary', () => {
    assert.deepEqual(summarizeCommunityLiquidity([]), []);
  });

  test('a single deposit gives an active status and correct totals', () => {
    const summary = summarizeCommunityLiquidity([
      {
        wallet: 'W1', discordHandle: 'alice', role: 'community',
        type: LIQUIDITY_EVENT_TYPES.DEPOSIT, dateIso: '2026-01-01T00:00:00Z',
        winlewAmountBaseUnits: '1000000', solAmountLamports: '500000', lpTokenAmount: '10',
      },
    ]);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].status, LIQUIDITY_PROVIDER_STATUSES.ACTIVE);
    assert.equal(summary[0].totalWinlewDepositedBaseUnits, '1000000');
    assert.equal(summary[0].deposits, 1);
    assert.equal(summary[0].withdrawals, 0);
  });

  test('a full deposit-then-withdraw nets to a withdrawn status, never negative', () => {
    const summary = summarizeCommunityLiquidity([
      {
        wallet: 'W1', discordHandle: null, role: 'community',
        type: LIQUIDITY_EVENT_TYPES.DEPOSIT, dateIso: '2026-01-01T00:00:00Z',
        winlewAmountBaseUnits: '1000000', solAmountLamports: '500000', lpTokenAmount: '10',
      },
      {
        // Withdraw returns slightly MORE than was deposited (real AMM fee
        // accrual) -- must not make any total negative or throw.
        wallet: 'W1', discordHandle: null, role: 'community',
        type: LIQUIDITY_EVENT_TYPES.WITHDRAW, dateIso: '2026-01-02T00:00:00Z',
        winlewAmountBaseUnits: '1050000', solAmountLamports: '520000', lpTokenAmount: '10',
      },
    ]);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].status, LIQUIDITY_PROVIDER_STATUSES.WITHDRAWN);
    assert.equal(summary[0].totalWinlewDepositedBaseUnits, '1000000');
    assert.equal(summary[0].totalWinlewWithdrawnBaseUnits, '1050000');
    assert.equal(summary[0].netLpTokenAmount, '0');
    assert.ok(!summary[0].lastWithdrawIso === false);
  });

  test('multiple wallets are kept separate and sorted by gross deposited, descending', () => {
    const summary = summarizeCommunityLiquidity([
      { wallet: 'small', role: 'community', type: LIQUIDITY_EVENT_TYPES.DEPOSIT, dateIso: '2026-01-01T00:00:00Z', winlewAmountBaseUnits: '100', solAmountLamports: '1', lpTokenAmount: '1' },
      { wallet: 'big', role: 'community', type: LIQUIDITY_EVENT_TYPES.DEPOSIT, dateIso: '2026-01-01T00:00:00Z', winlewAmountBaseUnits: '9999', solAmountLamports: '1', lpTokenAmount: '1' },
    ]);
    assert.equal(summary.length, 2);
    assert.equal(summary[0].wallet, 'big');
    assert.equal(summary[1].wallet, 'small');
  });

  test('farmPrograms is populated from FARM_PARTICIPATION for known wallets, empty array otherwise', () => {
    const [known] = Object.keys(FARM_PARTICIPATION);
    const summary = summarizeCommunityLiquidity([
      { wallet: known, role: 'community', type: LIQUIDITY_EVENT_TYPES.DEPOSIT, dateIso: '2026-01-01T00:00:00Z', winlewAmountBaseUnits: '1', solAmountLamports: '1', lpTokenAmount: '1' },
      { wallet: 'unknown-wallet', role: 'community', type: LIQUIDITY_EVENT_TYPES.DEPOSIT, dateIso: '2026-01-01T00:00:00Z', winlewAmountBaseUnits: '1', solAmountLamports: '1', lpTokenAmount: '1' },
    ]);
    const knownRow = summary.find((s) => s.wallet === known);
    const unknownRow = summary.find((s) => s.wallet === 'unknown-wallet');
    assert.deepEqual(knownRow.farmPrograms, FARM_PARTICIPATION[known]);
    assert.deepEqual(unknownRow.farmPrograms, []);
  });

  test('the real seeded data sums to the independently-verified on-chain totals', () => {
    const summary = summarizeCommunityLiquidity();
    assert.equal(summary.length, 11);
    // 58 until 2026-08-10, when re-walking the LP mint found two founder
    // deposits (2026-08-08 and 2026-08-10) that were not in the ledger.
    assert.equal(COMMUNITY_LIQUIDITY_EVENTS.length, 61);

    let totalDeposited = 0n;
    let totalWithdrawn = 0n;
    for (const row of summary) {
      totalDeposited += BigInt(row.totalWinlewDepositedBaseUnits);
      totalWithdrawn += BigInt(row.totalWinlewWithdrawnBaseUnits);
    }
    assert.equal(totalDeposited.toString(), '133631351215113');
    assert.equal(totalWithdrawn.toString(), '57102537754173');

    const activeCount = summary.filter((s) => s.status === LIQUIDITY_PROVIDER_STATUSES.ACTIVE).length;
    assert.equal(activeCount, 3); // founder wallet + millerknoll + one single-deposit provider
    assert.equal(summary.length - activeCount, 8);
  });

  test("the founder wallet's net LP matches the balance held on-chain", () => {
    // The one assertion here that can be checked against something outside
    // this repo. summarizeCommunityLiquidity() derives net LP by summing the
    // ledger's own mint/burn amounts, so if a deposit or withdrawal is missing
    // the sum drifts from the wallet's real LP token balance.
    //
    // Read from mainnet on 2026-08-10, immediately after the deposit in
    // signature 5yFUvCu…: the wallet's LP token account held 285.924362877
    // (285924362877 base units, LP mint has 9 decimals). The ledger agrees.
    //
    // This is deliberately a static number, not a live RPC call — the suite
    // runs offline. It going red is the intended signal that liquidity moved
    // and the ledger has not caught up yet; re-walk the LP mint, add the
    // events, then update this figure with the new on-chain balance.
    const founder = summarizeCommunityLiquidity().find(
      (s) => s.wallet === 'D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ'
    );
    assert.equal(founder.netLpTokenAmount.toString(), '400227974978');
    assert.equal(founder.status, LIQUIDITY_PROVIDER_STATUSES.ACTIVE);
  });

  test('default parameter uses the real seeded COMMUNITY_LIQUIDITY_EVENTS when called with no arguments', () => {
    assert.equal(summarizeCommunityLiquidity().length, summarizeCommunityLiquidity(COMMUNITY_LIQUIDITY_EVENTS).length);
  });
});
