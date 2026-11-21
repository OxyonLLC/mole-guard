// Oxyon Blitz payouts from the GeoHackers reserve (owner-approved 2026-11-21; plan in the owner's workspace:
// handoff/oxyon-blitz-play/RESERVE-PAYOUTS-PLAN.md). Pure rules, no I/O, so they are unit-tested.
//
// Units: 1 unit = one millionth of XL1 (same as the arcade; signer-adapter ATTO_PER_REWARD_UNIT = 10^12 atto).
// Blitz sends amountMillionths, which are exactly these units.

export const DEFAULT_BATCH_MAX = 50;
const DISCORD_EPOCH_MS = 1420070400000n;
const WALLET = /^[a-f0-9]{40}$/;

/** Blitz network name ↔ XL1 network this bridge signs on. The first week runs on beta (Sequence). */
export const blitzNetworkFor = xl1Network => ({ beta: 'sequence', mainnet: 'mainnet' })[xl1Network] ?? null;

/**
 * One batch = one XL1 transaction with many recipients (owner: "batch payments together").
 * Takes READY items oldest first, merges several items to the same wallet into one line, and stops at
 * `maxRecipients` wallets or when the next item would pass the day's remaining ceiling (never skips ahead,
 * so nobody waits behind a later, smaller request forever).
 */
export function buildBatch(items, { maxRecipients = DEFAULT_BATCH_MAX, remainingUnits }) {
  const transfers = new Map(), itemIds = [];
  let total = 0n;
  const left = BigInt(remainingUnits);
  for (const item of [...items].sort((a, b) => (a.claimedAtMs - b.claimedAtMs) || String(a._id).localeCompare(String(b._id)))) {
    if (!WALLET.test(item.wallet)) throw new Error('blitz_item_wallet_invalid');
    const units = BigInt(item.units);
    if (units <= 0n) throw new Error('blitz_item_amount_invalid');
    if (!transfers.has(item.wallet) && transfers.size >= maxRecipients) break;
    if (total + units > left) break;
    transfers.set(item.wallet, (transfers.get(item.wallet) ?? 0n) + units);
    itemIds.push(String(item._id));
    total += units;
  }
  return { transfers: Object.fromEntries([...transfers].map(([w, u]) => [w, u.toString()])), itemIds, totalUnits: total.toString() };
}

/** UTC day key, for the daily payout ceiling. */
export const utcDay = ms => new Date(ms).toISOString().slice(0, 10);

/** When a Discord account was created, from its snowflake ID. */
export function discordCreatedMs(id) {
  if (!/^\d{15,22}$/.test(String(id))) return null;
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

/**
 * Wallets proven with the GeoHackers bot (Oxyon Wallet signature), for Blitz's "cash out today" fast track.
 * Same signed-record rule as the arcade (verified-wallet.js). discordAgeOk mirrors the arcade's 30-day rule.
 */
export function verifiedWallets(database, nowMs, minDiscordAgeDays = 30) {
  const out = new Map();
  for (const [id, record] of Object.entries(database?.users ?? {})) {
    if (record?.discordUserId !== id) continue;
    const signed = (['xl1-jwt', 'xl1-boundwitness'].includes(record.verificationMethod) && record.xl1?.ownershipVerified === true)
      || (record.xl1?.mode === 'wallet-signature' && record.xl1?.source === 'xl1-wallet-signature');
    const address = String(record.xl1?.xl1Address ?? '').trim().toLowerCase().replace(/^0x/, '');
    if (!signed || !WALLET.test(address)) continue;
    const created = discordCreatedMs(id);
    const ageOk = created !== null && nowMs - created >= minDiscordAgeDays * 86400000;
    out.set(address, { address, discordAgeOk: (out.get(address)?.discordAgeOk ?? false) || ageOk });
  }
  return [...out.values()];
}
