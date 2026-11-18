import pkg from 'discord.js';
const { Client, GatewayIntentBits } = pkg;

import { getConfig } from './config.js';
import { handleMole, handleGame, handleMoleAutocomplete, handleMoleProposeModal } from './commands.js';

export async function startBot() {
  const cfg = getConfig();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('clientReady', () => console.log(`🕵️‍♂️ The Mole Guard online as ${client.user.tag}`));

  // Helpful diagnostics so you can see why an interaction might fail
  process.on('unhandledRejection', (e) => console.error('[mole] unhandledRejection', e));
  process.on('uncaughtException', (e) => console.error('[mole] uncaughtException', e));

  client.on('interactionCreate', async (interaction) => {
    // Governance autocomplete (/mole vote|myvote option suggestions) —
    // must respond fast and never with a visible message.
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== 'mole') return;
      await handleMoleAutocomplete(interaction).catch((e) => {
        console.warn('[mole] autocomplete failed:', e?.message || e);
        interaction.respond([]).catch(() => {});
      });
      return;
    }

    // /mole propose modal submit — arrives as its own interaction type.
    if (interaction.isModalSubmit()) {
      if (String(interaction.customId || '').startsWith('mole-propose:')) {
        await handleMoleProposeModal(interaction).catch((e) => console.error('[mole] propose modal error:', e));
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!['mole', 'game'].includes(interaction.commandName)) return;
    try {
      const subcommand = interaction.options.getSubcommand(false);
      const appFlags = interaction.client.application?.flags?.toArray?.() || [];
      const launchActivityDirectly =
        interaction.commandName === 'game'
        && subcommand === 'hub'
        && cfg.DISCORD_ACTIVITY_ENABLED
        && appFlags.includes('Embedded');

      // /mole propose answers with a modal, which Discord only accepts as
      // the FIRST response — deferring first would break it.
      const answersWithModal = interaction.commandName === 'mole' && subcommand === 'propose';

      // Discord requires *some* response quickly. Defer immediately.
      if (!launchActivityDirectly && !answersWithModal && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      if (interaction.commandName === 'mole') await handleMole(interaction);
      if (interaction.commandName === 'game') await handleGame(interaction);
    } catch (e) {
      console.error(e);
      const msg = '❌ Mole Guard error.';
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(()=>{});
      else await interaction.reply({ content: msg, ephemeral: true }).catch(()=>{});
    }
  });

  await client.login(cfg.DISCORD_TOKEN);
  await client.application?.fetch().catch((error) => {
    console.warn('[mole] application fetch failed:', error?.message || error);
  });
}
