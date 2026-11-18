// "C U Next Tuesday" — slash commands.
//
// Application ID 1535139923445809252. Reveal target: 2026-10-29.
//
// Scope note, and it is the important one.
//
// This bot belongs to the community MEME token. It used to live on Base, and
// "different chain" did the work of separating it from $WinLEW. As of
// 2026-08-07 it is moving to **Solana** — the same chain as $WinLEW — so that
// separation is gone and has to be made in words instead.
//
// That makes the disclaimer MORE important than it was, not less. Both tokens
// will appear in the same wallet, the same explorer and the same Discord. The
// only reliable way to tell them apart is the mint address, which is why
// DISCLAIMER below names the mint rather than the chain.
//
// src/public/cunt/ carries the identical warning ("Check the mint address every
// time. Never assume the name."). If the wording changes in one place it must
// change in both.
//
// Features are deliberately not built yet (owner: "still working out the
// details"). What is here is the skeleton plus one honest /cunt about command,
// so the app can be registered, invited and smoke-tested long before October
// without shipping anything that claims to do more than it does.
import pkg from 'discord.js';

const { SlashCommandBuilder } = pkg;

/**
 * The $WinLEW mint. Hardcoded on purpose: this is the address the disclaimer
 * tells people to check against, so it must not depend on env that could be
 * unset or wrong in a fresh deploy. Matches src/faucet/dexscreener.js's MINT.
 */
export const WINLEW_MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';

/**
 * The meme token's own Solana mint. NULL until it is actually minted.
 *
 * Leave it null rather than guessing. A placeholder or a stale address in a
 * message telling people to "verify the mint" is worse than saying nothing —
 * it is a confident wrong answer, and it is exactly how someone buys the wrong
 * token. DISCLAIMER below reads this and changes what it claims accordingly.
 */
export const CUNT_MINT = null;

/**
 * One string, used everywhere the token is mentioned — so the wording cannot
 * drift between commands.
 *
 * Both tokens are on Solana now, so "different chain" is no longer available as
 * shorthand and the mint address is the only thing that actually distinguishes
 * them. While CUNT_MINT is null there is nothing legitimate to buy, and saying
 * so plainly is the most useful warning available.
 */
export const DISCLAIMER = CUNT_MINT
  ? [
      '⚠️ **This is not $WinLEW.**',
      `This meme token: \`${CUNT_MINT}\``,
      `$WinLEW (the utility token): \`${WINLEW_MINT}\``,
      'Both are on Solana, so your wallet will show you both. Check the mint address — never the name.',
    ].join('\n')
  : [
      '⚠️ **This is not $WinLEW**, and it does not exist yet.',
      'No Solana mint has been created for this meme token. **Anyone selling one is lying.**',
      `$WinLEW — the real utility token — is \`${WINLEW_MINT}\`.`,
      'When this one is minted, its address will be published here and on winlew.co/cunt/future/.',
    ].join('\n');

/** @deprecated Kept so nothing silently breaks if an older import lingers. */
export const CHAIN_DISCLAIMER = DISCLAIMER;

export const commandInventory = [
  {
    path: '/cunt about',
    description: 'What this is, what it is not, and how to tell it apart from $WinLEW.',
    audience: 'all',
    category: 'Meme',
  },
];

export const commandData = [
  new SlashCommandBuilder()
    .setName('cunt')
    .setDescription('See You Next Tuesday — the WinLEW community meme')
    .addSubcommand((sub) =>
      sub.setName('about').setDescription('What this is, what it is not, and how to tell it apart from $WinLEW')
    )
    .toJSON(),
];

const SITE_BASE = String(process.env.SITE_BASE_URL || 'https://winlew.co').replace(/\/$/, '');

async function handleAbout(interaction) {
  await interaction.editReply(
    [
      '**See You Next Tuesday** — the WinLEW community meme.',
      '',
      'No roadmap. No fake utility. Just Tuesdays.',
      '',
      DISCLAIMER,
      '',
      // The page lives at /cunt/future/, not /cunt/ — /cunt/ is a guard stub
      // that redirects to /no-thank-you/. The nested path is deliberate: the
      // page is live but unlisted (noindex, in no nav, linked from nowhere)
      // until launch. This bot is the ONLY thing that publishes the path, so
      // when it goes live the page stops being unlisted. That is fine at
      // launch and wrong before it — check the page is ready first.
      `Read the lore: ${SITE_BASE}/cunt/future/`,
    ].join('\n')
  );
}

/**
 * Entry point for the /cunt command tree. Deliberately explicit about unknown
 * subcommands rather than silently doing nothing — a slash command that
 * appears to hang is worse than one that says it is not built yet.
 */
export async function handleCunt(interaction) {
  const sub = interaction.options.getSubcommand(false);
  switch (sub) {
    case 'about':
      return handleAbout(interaction);
    default:
      // `.trim()` used to sit inside this template literal, so the bot would
      // have posted the characters ".trim()" to Discord. Build the label first.
      return interaction.editReply(
        `\`${`/cunt ${sub || ''}`.trim()}\` isn't a thing yet. Try \`/cunt about\`.`
      );
  }
}
