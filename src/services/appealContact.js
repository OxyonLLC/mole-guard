/**
 * How someone contests a refusal.
 *
 * Every automated gate in this project — the identity-age gate, the faucet ban
 * list, the payout blocklist — can be wrong about a real person. Cluster
 * matching in particular is explicitly a signal and not a proof: walletBans.js
 * says so itself ("two people who share a funder look identical to one person
 * with two wallets"). Two housemates, or a friend who funded someone's first
 * wallet, produce exactly the pattern an abuser does.
 *
 * A refusal with no route back is how a false positive becomes a permanent,
 * silent ban on someone who did nothing. So every refusal carries this, and it
 * lives in one file so a channel change does not leave a dead address quoted
 * across a dozen error strings.
 */

export const APPEAL_EMAIL = String(process.env.SUPPORT_EMAIL || "support@winlew.co").trim();
export const APPEAL_DISCORD_URL = String(process.env.SUPPORT_DISCORD_URL || "https://winlew.co/community/").trim();
export const APPEAL_CONTACT_URL = String(process.env.SUPPORT_CONTACT_URL || "https://winlew.co/contact/").trim();

/** One-line appeal route for a plain-text/error-string context. */
export function appealLine() {
  return `If you believe this is a mistake: email ${APPEAL_EMAIL}, use ${APPEAL_CONTACT_URL}, or ask in the WinLEW Discord (${APPEAL_DISCORD_URL}). Include your wallet address so it can be checked.`;
}

/** Markdown flavour for Discord messages, where the URL should not be embedded. */
export function appealLineMarkdown() {
  return `If you believe this is a mistake: email **${APPEAL_EMAIL}**, use <${APPEAL_CONTACT_URL}>, or open a ticket in the WinLEW Discord (<${APPEAL_DISCORD_URL}>). Include your wallet address so it can be checked.`;
}

/** Append the appeal route to a refusal message, with no double spacing. */
export function withAppeal(message, { markdown = false } = {}) {
  const base = String(message || "").trim();
  const line = markdown ? appealLineMarkdown() : appealLine();
  return base ? `${base} ${line}` : line;
}
