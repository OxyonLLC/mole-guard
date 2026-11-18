// SNS (.sol domain) reverse resolution — extracted from src/faucet/bot.js
// (2026-07-28) so the website (src/mole/web.js) can show a wallet's .sol
// name too, not just the Discord bot. Effectively zero Discord coupling to
// begin with (it only ever touched a plain Connection + PublicKey), so this
// is a pure lift, not a rewrite. @bonfida/spl-name-service is already a root
// dependency (src/faucet/bot.js has always used it), so no new install.
import { PublicKey } from "@solana/web3.js";
import { reverseLookup, getPrimaryDomain } from "@bonfida/spl-name-service";

/**
 * Resolves a wallet's primary/registered .sol domain, if it has one.
 * Returns null (never throws) for an unresolvable pubkey, an account that
 * doesn't exist, or any RPC error — callers should treat this as
 * best-effort and always have a raw/truncated-address fallback ready.
 */
export async function resolveSolanaName(pubkeyString, connection) {
  try {
    const pubkey = new PublicKey(pubkeyString);
    try {
      const primary = await getPrimaryDomain(connection, pubkey);
      if (primary?.domain) return primary.domain;
    } catch {}
    const name = await reverseLookup(connection, pubkey);
    return name ? `${name}.sol` : null;
  } catch {
    return null;
  }
}
