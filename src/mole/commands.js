import pkg from "discord.js";
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = pkg;

import { getConfig } from "./config.js";
import { createSession } from "./sessions.js";
import { getUserContributionSummary } from "./contributions.js";
import { getMintSnapshot } from "./solana.js";
import { getVotePriceInWinlew, USD_PER_VOTE, MAX_PURCHASED_VOTES_PER_PROPOSAL } from "./governancePricing.js";
import { PROPOSALS, GOVERNANCE_CONFIG, VOTABLE_STATUSES, getProposalById, PROPOSAL_CATEGORIES, GOVERNANCE_MODES } from "./governanceData.js";
import { castVote, getWalletVote, computeResults } from "./governanceStore.js";
import { createSubmission } from "./governanceSubmissions.js";
import { getLinkedWalletRecord, getWalletVerificationStatus } from "./walletLink.js";
import { recordCheckin } from "./hodlCheckins.js";

// web.js owns eligibility + vote-weight resolution (single implementation,
// shared with every /api/governance route) — but it's a heavy module and
// src/register-commands.js imports THIS file just for commandData, so pull
// it in lazily at command time instead of at module load.
function webGovernance() {
  return import("./web.js");
}

function rolesFromFlags(flags = {}) {
  const roles = ["Verified Wallet"];
  if (flags.token_holder) roles.push("WinLEW Holder");
  if (flags.lewcrew_1m) roles.push("LewCrew 1M");
  if (flags.lewcrew_10m) roles.push("LewCrew 10M");
  if (flags.lewcrew_100m) roles.push("LewCrew 100M");
  if (flags.contributor) roles.push("Contributor");
  if (flags.governance_voter) roles.push("Governance Voter");
  return roles;
}

function getGamingHubUrl(cfg) {
  const configured = cfg.GAMING_HUB_URL || `${cfg.SITE_BASE_URL.replace(/\/$/, "")}/mole-hub/`;
  // Existing deployments may still carry the previous value in an untracked
  // .env file. Migrate that value in memory so a git pull is enough.
  return String(configured).replace(/\/gaming-hub\/?$/i, "/mole-hub/");
}

function buildSessionLinkedGamingHubUrl(cfg, discordUserId) {
  const url = new URL(getGamingHubUrl(cfg));
  const session = createSession(discordUserId, cfg.DISCORD_ACTIVITY_SESSION_TTL_SEC);
  url.searchParams.set("platform", "discord");
  url.searchParams.set("discord_activity", "1");
  url.searchParams.set("session", session);
  url.searchParams.set("app", "mole");
  return { url: url.toString(), sessionTtlSec: cfg.DISCORD_ACTIVITY_SESSION_TTL_SEC };
}

function formatSessionWindow(ttlSec) {
  const hours = Math.max(1, Math.round(Number(ttlSec || 0) / 3600));
  return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
}

function canLaunchEmbeddedHub(interaction, cfg) {
  if (!cfg.DISCORD_ACTIVITY_ENABLED) return false;
  const appFlags = interaction.client.application?.flags?.toArray?.() || [];
  return appFlags.includes("Embedded");
}

async function apiJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`);
  return json;
}

export const commandInventory = [
  { path: '/mole link [app]', description: 'Open the linked roles and wallet verification flow.', audience: 'all', category: 'Verification' },
  { path: '/mole sync [app]', description: 'Re-sync roles from the saved wallet link.', audience: 'all', category: 'Verification' },
  { path: '/mole status', description: 'Show Mole Guard endpoints and health links.', audience: 'all', category: 'Status' },
  { path: '/mole votes', description: 'Check your Governance Vote Fund total and purchased vote weight.', audience: 'all', category: 'Governance' },
  { path: '/mole proposals', description: 'List governance proposals with live results.', audience: 'all', category: 'Governance' },
  { path: '/mole vote', description: 'Cast or update your vote on an open proposal (verified holders — 1 free vote + any purchased weight).', audience: 'all', category: 'Governance' },
  { path: '/mole myvote', description: 'Privately check your current vote on a proposal.', audience: 'all', category: 'Governance' },
  { path: '/mole propose', description: 'Submit a governance proposal for maintainer review (nothing becomes votable unreviewed).', audience: 'all', category: 'Governance' },
  { path: '/game hub', description: 'Open the WinLEW Gaming Hub.', audience: 'all', category: 'Gaming' },
];

// Discord choice labels for the proposal-submission review queue — values
// must stay exactly PROPOSAL_CATEGORIES/GOVERNANCE_MODES members, since
// createSubmission() validates against those sets.
const CATEGORY_CHOICES = [
  { name: "Community", value: PROPOSAL_CATEGORIES.COMMUNITY },
  { name: "Features", value: PROPOSAL_CATEGORIES.FEATURES },
  { name: "Quiz", value: PROPOSAL_CATEGORIES.QUIZ },
  { name: "Faucet", value: PROPOSAL_CATEGORIES.FAUCET },
  { name: "Games", value: PROPOSAL_CATEGORIES.GAMES },
  { name: "Events", value: PROPOSAL_CATEGORIES.EVENTS },
  { name: "Rewards", value: PROPOSAL_CATEGORIES.REWARDS },
  { name: "Proof of Value", value: PROPOSAL_CATEGORIES.PROOF_OF_VALUE },
  { name: "Burn Program", value: PROPOSAL_CATEGORIES.BURN_PROGRAM },
  { name: "Treasury Allocation", value: PROPOSAL_CATEGORIES.TREASURY_ALLOCATION },
  { name: "Partnerships", value: PROPOSAL_CATEGORIES.PARTNERSHIPS },
  { name: "Grants", value: PROPOSAL_CATEGORIES.GRANTS },
  { name: "Governance Rules", value: PROPOSAL_CATEGORIES.GOVERNANCE_RULES },
  { name: "Platform Policy", value: PROPOSAL_CATEGORIES.PLATFORM_POLICY },
];
const MODE_CHOICES = [
  { name: "Advisory (signal only)", value: GOVERNANCE_MODES.ADVISORY },
  { name: "Community-approved", value: GOVERNANCE_MODES.COMMUNITY_APPROVED },
  { name: "Maintainer-ratified", value: GOVERNANCE_MODES.MAINTAINER_RATIFIED },
  { name: "Binding within defined policy", value: GOVERNANCE_MODES.BINDING_WITHIN_POLICY },
];

export const commandData = [
  new SlashCommandBuilder()
    .setName("mole")
    .setDescription("Mole Guard verification and status commands")
    .addSubcommand((sc) =>
      sc
        .setName("link")
        .setDescription("Open the linked roles and wallet verification flow")
        .addStringOption((opt) =>
          opt
            .setName("app")
            .setDescription("Which Discord app to link")
            .addChoices(
              { name: "The Mole Guard (Linked Roles)", value: "mole" },
              { name: "WinLEW Utility Bot (optional)", value: "utility" }
            )
            .setRequired(false)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("sync")
        .setDescription("Re-sync roles from the saved wallet link")
        .addStringOption((opt) =>
          opt
            .setName("app")
            .setDescription("Which Discord app to sync")
            .addChoices(
              { name: "The Mole Guard (Linked Roles)", value: "mole" },
              { name: "WinLEW Utility Bot (optional)", value: "utility" }
            )
            .setRequired(false)
        )
    )
    .addSubcommand((sc) => sc.setName("status").setDescription("Show Mole Guard endpoints and health links"))
    .addSubcommand((sc) => sc.setName("votes").setDescription("Check your Governance Vote Fund total and purchased vote weight"))
    .addSubcommand((sc) => sc.setName("checkin").setDescription("Daily HODL check-in: counts one participation day (UTC) toward this week's HODL rate"))
    .addSubcommand((sc) => sc.setName("proposals").setDescription("List governance proposals with live results"))
    .addSubcommand((sc) =>
      sc
        .setName("vote")
        .setDescription("Cast or update your vote on an open governance proposal")
        .addStringOption((opt) =>
          opt.setName("proposal").setDescription("Which proposal (start typing to search)").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName("choice").setDescription("Your choice (options load after picking a proposal)").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("myvote")
        .setDescription("Privately check your current vote on a proposal")
        .addStringOption((opt) =>
          opt.setName("proposal").setDescription("Which proposal (start typing to search)").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("propose")
        .setDescription("Submit a governance proposal for maintainer review")
        .addStringOption((opt) =>
          opt.setName("category").setDescription("What area does this proposal affect?").setRequired(true).addChoices(...CATEGORY_CHOICES)
        )
        .addStringOption((opt) =>
          opt.setName("mode").setDescription("Requested governance mode").setRequired(true).addChoices(...MODE_CHOICES)
        )
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("game")
    .setDescription("WinLEW Gaming Hub commands")
    .addSubcommand((sc) =>
      sc
        .setName("hub")
        .setDescription("Open the WinLEW Gaming Hub")
    )
    .toJSON(),
];

export async function handleGame(interaction) {
  const cfg = getConfig();
  const sub = interaction.options.getSubcommand();
  const linkedHub = buildSessionLinkedGamingHubUrl(cfg, interaction.user.id);

  if (sub === "hub") {
    if (canLaunchEmbeddedHub(interaction, cfg)) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open Browser Fallback")
          .setURL(linkedHub.url),
      );

      try {
        await interaction.launchActivity();
        return interaction.followUp({
          ephemeral: true,
          content:
            `🎮 Discord Activity launched.
` +
            `Mole Hub now mints its own Discord rewards session inside the Activity, so WinLEW claims can attach automatically when the Activity opens.
` +
            `If the embedded launch has trouble on this client, the fallback button below opens the same hub in your browser with a rewards session pre-attached for ${formatSessionWindow(linkedHub.sessionTtlSec)}.`,
          components: [row],
        });
      } catch (error) {
        console.warn("[mole] /game hub activity launch failed, falling back to browser link:", error?.message || error);
        const payload = {
          ephemeral: true,
          content:
            `🎮 Discord couldn't launch the embedded Mole Hub on this client.
` +
            `Use the button below to open the same hub in your browser with a rewards session pre-attached for ${formatSessionWindow(linkedHub.sessionTtlSec)}.`,
          components: [row],
        };
        if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
        return interaction.reply(payload);
      }
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Gaming Hub").setURL(linkedHub.url)
    );
    const intro = cfg.DISCORD_ACTIVITY_ENABLED
      ? "🎮 The embedded Discord Activity is not available for this app/client, so the Mole Hub is opening in your browser instead."
      : "🎮 WinLEW Gaming Hub is ready.";

    return interaction.editReply({
      content:
        `${intro}
` +
        `Destination: ${linkedHub.url}
` +
        `This link already carries your Discord-linked rewards session for DigLEW, Pac-Mole, and the other Mole Hub games.`,
      components: [row],
    });
  }
}

export async function handleMole(interaction) {
  const cfg = getConfig();
  const sub = interaction.options.getSubcommand();

  if (sub === "status") {
    return interaction.editReply({
      content:
        `🛡️ Mole Guard online.
` +
        `API / OAuth: ${cfg.PUBLIC_BASE_URL}
` +
        `Verify UI: ${cfg.VERIFY_UI_URL}
` +
        `Bot Services: ${cfg.BOT_SERVICES_URL}
` +
        `Gaming Hub: ${getGamingHubUrl(cfg)}
` +
        `Health UI: ${cfg.WATCHDOG_URL}
` +
        `Bot sync endpoint: ${cfg.PUBLIC_BASE_URL}/api/roles/sync-bot`,
    });
  }

  if (sub === "link") {
    const appKey = interaction.options.getString("app") || "mole";
    const url =
      appKey === "utility"
        ? `${cfg.PUBLIC_BASE_URL}/linked-role/utility`
        : `${cfg.PUBLIC_BASE_URL}/linked-role/mole`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Start Verification").setURL(url)
    );

    return interaction.editReply({
      content: `🔗 Click to link your wallet + sync roles.
App: **${appKey}**`,
      components: [row],
    });
  }

  if (sub === "sync") {
    const appKey = interaction.options.getString("app") || "mole";

    if (!cfg.BOT_SYNC_SECRET) {
      return interaction.editReply(
        "❌ BOT_SYNC_SECRET is missing in .env (server + bot must share it)."
      );
    }

    try {
      const userId = interaction.user.id;

      const pushed = await apiJson(`${cfg.PUBLIC_BASE_URL}/api/roles/sync-bot`, {
        secret: cfg.BOT_SYNC_SECRET,
        userId,
        app: appKey,
      });

      const roles = rolesFromFlags(pushed.flags);
      const bal = Number(pushed.balance || 0);

      return interaction.editReply(
        `✅ Synced!
` +
          `App: **${appKey}**
` +
          `Wallet: \`${pushed.wallet}\`
` +
          `Balance: **${bal.toLocaleString()} WinLEW**
` +
          `Roles: ${roles.map((r) => `**${r}**`).join(", ")}`
      );
    } catch (e) {
      return interaction.editReply(`❌ Sync failed: ${e?.message || e}`);
    }
  }

  if (sub === "checkin") {
    // One participation day per verified identity per UTC day, server clock only.
    const record = getLinkedWalletRecord(interaction.user.id);
    const status = record ? getWalletVerificationStatus(record, Math.floor(Date.now() / 1000)) : null;
    if (!status?.verified) {
      const siteBase = String(cfg.SITE_BASE_URL || "").replace(/\/$/, "");
      return interaction.editReply(`🔒 Check-ins count for verified holders. Verify your wallet first: ${siteBase}/verify/`);
    }
    const result = recordCheckin(interaction.user.id, { source: "discord" });
    if (!result.ok) return interaction.editReply("Check-in could not be recorded. Please try again later.");
    return interaction.editReply(
      result.already
        ? `✅ Already checked in for **${result.day}** (UTC). One check-in per day counts; come back tomorrow.`
        : `✅ Checked in for **${result.day}** (UTC). Your HODL rate counts the distinct days you took part (check-in, faucet, quiz or games) in the **7 complete UTC days before each weekly snapshot** — the snapshot day itself is not counted. 0 days = 0.100%, 7 days = 0.150%. Missing a day never erases earlier days.`
    );
  }

  if (sub === "votes") {
    try {
      const [summary, mint] = await Promise.all([
        getUserContributionSummary(interaction.user.id),
        getMintSnapshot().catch(() => null),
      ]);
      const governanceTotal = Number(summary?.byCause?.governance || 0);
      const siteBase = String(cfg.SITE_BASE_URL || "").replace(/\/$/, "");

      if (governanceTotal <= 0) {
        return interaction.editReply(
          `🗳️ You haven't contributed to the Governance Vote Fund yet.\n` +
            `Every WinLEW sent there is worth roughly $${USD_PER_VOTE} of extra vote weight (capped at ${MAX_PURCHASED_VOTES_PER_PROPOSAL} per proposal), on top of your one free vote as a verified holder.\n` +
            `Contribute here: ${siteBase}/contribute/?cause=governance`
        );
      }

      const supply = Number(mint?.supply);
      const pricing = supply > 0 ? getVotePriceInWinlew({ supply }) : { ok: false };
      if (!pricing.ok) {
        return interaction.editReply(
          `🗳️ Governance Vote Fund total: **${governanceTotal.toLocaleString()} WinLEW**\n` +
            `Current vote pricing isn't available right now (no recent price samples) — check back shortly or see /governance/ for the live number.`
        );
      }

      // Overview only, not allocation-aware — the exact per-proposal number
      // (src/mole/governanceVoteCredits.js) also excludes whatever's already
      // committed to OTHER open proposals from the same shared pool, so the
      // real number on a specific proposal's page can be slightly lower.
      const theoreticalVotes = Math.min(MAX_PURCHASED_VOTES_PER_PROPOSAL, Math.floor(governanceTotal / pricing.winlewPerVote));
      return interaction.editReply(
        `🗳️ Governance Vote Fund total: **${governanceTotal.toLocaleString()} WinLEW**\n` +
          `Current price: ~${pricing.winlewPerVote.toLocaleString(undefined, { maximumFractionDigits: 0 })} WinLEW per vote ($${USD_PER_VOTE}, 3-day average)\n` +
          `Up to **${theoreticalVotes} purchased vote${theoreticalVotes === 1 ? "" : "s"}** available (capped at ${MAX_PURCHASED_VOTES_PER_PROPOSAL} per proposal), on top of your free vote as a verified holder.\n` +
          `_This is an overview — see the specific proposal on /governance/ for the exact live number, since funds already committed to another open proposal reduce what's available here._`
      );
    } catch (e) {
      return interaction.editReply(`❌ Couldn't check your vote weight: ${e?.message || e}`);
    }
  }

  if (sub === "proposals") {
    try {
      const siteBase = String(cfg.SITE_BASE_URL || "").replace(/\/$/, "");
      if (!PROPOSALS.length) {
        return interaction.editReply(`🏛️ No governance proposals yet — watch ${siteBase}/governance/ and this server.`);
      }
      const lines = PROPOSALS.slice(0, 10).map((p) => {
        const votable = VOTABLE_STATUSES.includes(p.status);
        const results = computeResults(p);
        const tally = Object.entries(results.weightByChoice || {})
          .map(([choice, weight]) => `${choice} ${weight}`)
          .join(" · ") || "no votes yet";
        const window = votable && p.votingEndIso ? ` — closes <t:${Math.floor(Date.parse(p.votingEndIso) / 1000)}:R>` : "";
        return (
          `${votable ? "🟢" : "🔒"} **${p.title}** (\`${p.id}\`)${window}\n` +
          `   Status: ${p.status} · Weighted tally: ${tally}\n` +
          `   ${siteBase}/governance/proposal/?id=${encodeURIComponent(p.id)}`
        );
      });
      return interaction.editReply(
        `🏛️ **Governance proposals**\n\n${lines.join("\n\n")}\n\n` +
        `Vote right here with \`/mole vote\` — every verified holder gets **1 free vote** (that's what verifying earns you), plus any purchased weight from \`/mole votes\`.`
      );
    } catch (e) {
      return interaction.editReply(`❌ Couldn't load proposals: ${e?.message || e}`);
    }
  }

  if (sub === "vote") {
    try {
      const proposal = getProposalById(interaction.options.getString("proposal") || "", PROPOSALS);
      if (!proposal) return interaction.editReply("❌ Unknown proposal — use `/mole proposals` to see valid ids.");
      const siteBase = String(cfg.SITE_BASE_URL || "").replace(/\/$/, "");
      const proposalUrl = `${siteBase}/governance/proposal/?id=${encodeURIComponent(proposal.id)}`;

      const { resolveGovernanceEligibility, resolveVoteWeightInfo, sendGovernanceVoteMessage } = await webGovernance();

      const eligibility = await resolveGovernanceEligibility(interaction.user.id, proposal);
      if (eligibility.eligible === null) {
        return interaction.editReply("⏳ The live balance check is temporarily unavailable — nothing was recorded, try again in a minute.");
      }
      if (!eligibility.eligible) {
        if (eligibility.reason === "wallet_not_verified") {
          return interaction.editReply(
            "🔗 Your free vote comes from being a **verified** WinLEW holder — and this account has no verified wallet yet.\n" +
            `Run \`/mole link\` (or open ${siteBase}/mole-link/) to verify, then vote again.`
          );
        }
        return interaction.editReply(
          `❌ Not eligible to vote on this proposal (\`${eligibility.reason}\`). ` +
          `Your free vote needs a verified wallet holding at least ${Number(GOVERNANCE_CONFIG.minWinlewToVote).toLocaleString()} WinLEW.`
        );
      }

      const choice = String(interaction.options.getString("choice") || "").trim();
      // allocate:true is deliberate and mirrors /api/governance/vote — this
      // is the moment a vote is actually cast, so purchased weight for this
      // proposal is locked in now, not previewed.
      // balance comes from the eligibility result above so purchased weight is
      // judged on the same snapshot-locked number — see resolveVoteWeightInfo.
      const voteWeight = await resolveVoteWeightInfo(interaction.user.id, proposal.id, { allocate: true, balance: eligibility.balance });
      const totalWeight = 1 + voteWeight.purchasedWeight;
      const result = castVote({ proposal, walletAddress: eligibility.wallet, discordUserId: interaction.user.id, choice, weight: totalWeight });
      if (!result.ok) {
        if (result.error === "invalid_choice") {
          return interaction.editReply(`❌ \`${choice}\` isn't a valid choice here. Valid choices: ${(proposal.choices || []).map((c) => `\`${c}\``).join(" · ")}`);
        }
        return interaction.editReply(`❌ Vote not recorded: \`${result.error}\``);
      }

      // Same best-effort maintainer-channel notification the web vote sends.
      sendGovernanceVoteMessage({ proposal, discordUserId: interaction.user.id, choice });

      const results = computeResults(proposal);
      const tally = Object.entries(results.weightByChoice || {}).map(([c, w]) => `${c} ${w}`).join(" · ");
      const weightNote = voteWeight.purchasedWeight > 0
        ? `**${result.vote.weight}** (1 free verified-holder vote + ${voteWeight.purchasedWeight} purchased)`
        : `**${result.vote.weight}** (your free verified-holder vote)`;
      return interaction.editReply(
        `🗳️ Vote recorded on **${proposal.title}**\n` +
        `Choice: **${result.vote.choice}** · Weight: ${weightNote}\n` +
        `Live weighted tally: ${tally}\n` +
        `You can change it any time while voting is open — just vote again, latest choice wins.\n${proposalUrl}`
      );
    } catch (e) {
      return interaction.editReply(`❌ Vote failed: ${e?.message || e}`);
    }
  }

  if (sub === "myvote") {
    try {
      const proposal = getProposalById(interaction.options.getString("proposal") || "", PROPOSALS);
      if (!proposal) return interaction.editReply("❌ Unknown proposal — use `/mole proposals` to see valid ids.");
      const linked = getLinkedWalletRecord(interaction.user.id);
      const verification = getWalletVerificationStatus(linked);
      if (!verification.verified || !verification.wallet) {
        return interaction.editReply("🔗 No verified wallet on this account yet — run `/mole link` first.");
      }
      const vote = getWalletVote(proposal.id, verification.wallet);
      if (!vote) {
        return interaction.editReply(
          `You haven't voted on **${proposal.title}** yet.` +
          (VOTABLE_STATUSES.includes(proposal.status) ? " It's open — `/mole vote` when ready." : " Voting is not currently open on it.")
        );
      }
      return interaction.editReply(
        `🗳️ Your vote on **${proposal.title}**: **${vote.choice}** (weight ${vote.weight || 1})\n` +
        `Cast <t:${Math.floor(Date.parse(vote.castAtIso) / 1000)}:R>` +
        (vote.updatedAtIso && vote.updatedAtIso !== vote.castAtIso ? `, last changed <t:${Math.floor(Date.parse(vote.updatedAtIso) / 1000)}:R>` : "") +
        `\nOnly you can see this — public results are aggregate-only.`
      );
    } catch (e) {
      return interaction.editReply(`❌ Couldn't check your vote: ${e?.message || e}`);
    }
  }

  if (sub === "propose") {
    // No deferReply for this subcommand (bot.js skips it) — a modal must be
    // the FIRST response to the interaction or Discord rejects it.
    const category = interaction.options.getString("category");
    const mode = interaction.options.getString("mode");
    const modal = new ModalBuilder()
      .setCustomId(`mole-propose:${category}:${mode}`)
      .setTitle("Governance proposal (for review)");
    const input = (id, label, style, required, maxLength, placeholder) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength).setPlaceholder(placeholder)
      );
    modal.addComponents(
      input("title", "Title", TextInputStyle.Short, true, 200, "One line — what is being proposed?"),
      input("summary", "Summary", TextInputStyle.Paragraph, true, 1000, "2–4 sentences a voter can decide from."),
      input("problem", "Problem", TextInputStyle.Paragraph, true, 3000, "What's wrong or missing today?"),
      input("proposedOutcome", "Proposed outcome", TextInputStyle.Paragraph, true, 3000, "What should happen if this passes?"),
      input("communityBenefit", "Community benefit (optional)", TextInputStyle.Paragraph, false, 1500, "Who gains, and how?")
    );
    return interaction.showModal(modal);
  }
}

/**
 * Modal submit for /mole propose. Goes into the SAME review queue as the
 * website's /governance/submit/ (src/mole/governanceSubmissions.js) — a
 * submission can never become a votable proposal by itself; a maintainer
 * reviews it and only then hand-publishes a real proposal. That review gate
 * is the protection against a crafted/exploitable proposal going live and
 * being voted through unseen.
 */
export async function handleMoleProposeModal(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  try {
    const [, category, mode] = String(interaction.customId || "").split(":");
    // customId round-trips through the client — never trust it came back
    // unmodified; createSubmission validates again, this just fails earlier.
    if (!Object.values(PROPOSAL_CATEGORIES).includes(category) || !Object.values(GOVERNANCE_MODES).includes(mode)) {
      return interaction.editReply("❌ Invalid category or governance mode — start over with `/mole propose`.");
    }

    const linked = getLinkedWalletRecord(interaction.user.id);
    const verification = getWalletVerificationStatus(linked);
    if (!verification.verified || !verification.wallet) {
      return interaction.editReply("🔗 Submitting a proposal requires a verified wallet — run `/mole link` first, then `/mole propose` again.");
    }

    const fields = {
      category,
      requestedGovernanceMode: mode,
      title: interaction.fields.getTextInputValue("title"),
      summary: interaction.fields.getTextInputValue("summary"),
      problem: interaction.fields.getTextInputValue("problem"),
      proposedOutcome: interaction.fields.getTextInputValue("proposedOutcome"),
      communityBenefit: interaction.fields.getTextInputValue("communityBenefit") || "",
    };

    const result = createSubmission({ discordUserId: interaction.user.id, wallet: verification.wallet, fields });
    if (!result.ok) {
      return interaction.editReply(`❌ Submission rejected: \`${result.error}\`${result.field ? ` (field: ${result.field})` : ""}${result.limit ? ` — limit ${result.limit} characters` : ""}. Nothing was saved; fix and resubmit.`);
    }

    const cfg = getConfig();
    const { sendGovernanceSubmissionMessage } = await webGovernance();
    sendGovernanceSubmissionMessage({ webhookUrl: cfg.GOVERNANCE_WEBHOOK_URL, submission: result.submission });

    const siteBase = String(cfg.SITE_BASE_URL || "").replace(/\/$/, "");
    return interaction.editReply(
      `📝 Submitted for review — **${result.submission.title}** (\`${result.submission.id}\`)\n\n` +
      `⚠️ This is a **reviewable draft, not a live vote**. A maintainer checks every submission before anything is published to ${siteBase}/governance/ — no proposal can go votable unreviewed. ` +
      `You'll see status updates in the governance channel, and you can track it at ${siteBase}/governance/submit/.`
    );
  } catch (e) {
    console.error("[mole] propose modal failed:", e);
    return interaction.editReply(`❌ Submission failed: ${e?.message || e}`).catch(() => {});
  }
}

/** Autocomplete for /mole vote + /mole myvote — proposal ids and per-proposal choices. */
export async function handleMoleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value || "").toLowerCase();

  if (focused.name === "proposal") {
    const votableForVote = interaction.options.getSubcommand(false) === "vote";
    const sorted = [...PROPOSALS].sort((a, b) =>
      Number(VOTABLE_STATUSES.includes(b.status)) - Number(VOTABLE_STATUSES.includes(a.status))
    );
    const matches = sorted
      .filter((p) => !votableForVote || VOTABLE_STATUSES.includes(p.status))
      .filter((p) => !query || p.id.toLowerCase().includes(query) || String(p.title).toLowerCase().includes(query))
      .slice(0, 25)
      .map((p) => ({
        name: `${VOTABLE_STATUSES.includes(p.status) ? "🟢" : "🔒"} ${p.title}`.slice(0, 100),
        value: p.id,
      }));
    return interaction.respond(matches);
  }

  if (focused.name === "choice") {
    const proposal = getProposalById(interaction.options.getString("proposal") || "", PROPOSALS);
    const choices = (proposal?.choices || [])
      .filter((c) => !query || String(c).toLowerCase().includes(query))
      .slice(0, 25)
      .map((c) => ({ name: String(c).slice(0, 100), value: String(c) }));
    return interaction.respond(choices);
  }

  return interaction.respond([]);
}
