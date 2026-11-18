'use strict';

// Real, already-vetted WinLEW purchase links (same mint address used
// everywhere else on the site, e.g. src/public/index.html and
// src/public/home/index.html) — reused here rather than inventing new
// ones, so anyone rejected by the holder-only gate (2026-07-26, see
// src/quiz/redemption.js and src/faucet/eligibility.js) is told exactly
// how to become a holder, on whichever platform they'd rather use.
const WINLEW_MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';

const BUY_WINLEW_LINKS = Object.freeze([
  { label: '🏁 pump.fun (Coin page)', url: `https://pump.fun/coin/${WINLEW_MINT}` },
  { label: '🔁 Swap on pump.fun', url: `https://swap.pump.fun/?input=So11111111111111111111111111111111111111112&output=${WINLEW_MINT}` },
  { label: '🔁 Swap on Raydium', url: `https://raydium.io/swap/?inputMint=sol&outputMint=${WINLEW_MINT}` },
]);

// The actual reason for the holder-only requirement, framed as the fair
// trade it is (project owner's own words, 2026-07-26): a wallet's very
// first WinLEW transfer requires creating its token account on-chain,
// which costs real SOL — paid by us, out of the faucet/quiz treasury, for
// every brand-new zero-balance wallet, forever, if we don't ask for this.
// Holding any amount already means that account exists. The "after ~10
// redemptions it pays for itself" line is the owner's own reassurance that
// this isn't about limiting rewards for real participants — only about not
// paying that one-time cost for a wallet that never comes back.
const WHY_HOLDER_ONLY = "It's a fair trade: you cover the one-time cost of getting your first $WinLEW (creating your own token account), and we'll gladly keep sending you $WinLEW for faucet claims and quiz rewards after that — usually within about 10 redemptions, we've already broken even on that cost.";

const BUY_WINLEW_NOTE = 'Buy on whichever platform you prefer — always double-check the mint address before swapping:\n' +
  `\`${WINLEW_MINT}\``;

/** Discord ActionRow of link buttons — one per BUY_WINLEW_LINKS entry. */
function buildBuyWinlewButtonsRow({ ActionRowBuilder, ButtonBuilder, ButtonStyle }) {
  const row = new ActionRowBuilder();
  for (const link of BUY_WINLEW_LINKS) {
    row.addComponents(
      new ButtonBuilder().setLabel(link.label).setStyle(ButtonStyle.Link).setURL(link.url),
    );
  }
  return row;
}

module.exports = { WINLEW_MINT, BUY_WINLEW_LINKS, BUY_WINLEW_NOTE, WHY_HOLDER_ONLY, buildBuyWinlewButtonsRow };
