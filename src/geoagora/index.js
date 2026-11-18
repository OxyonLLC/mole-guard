import 'dotenv/config';
import pkg from 'discord.js';
import { fetchGeoAgora, handleGeoAgora, recentEventKeys, toAlertLine } from './commands.js';
import { getAllSubscriptions, getSeenEventKeys, isBootstrapped, markSeenEventKeys, setBootstrapped } from './storage.js';
import { isMongoEnabled, pingMongo } from '../lib/mongo.js';

const { Client, GatewayIntentBits } = pkg;

function alertsEnabled() {
  return /^true$/i.test(String(process.env.GEOAGORA_ALERTS_ENABLED || 'true'));
}

function pollSeconds() {
  return Math.max(15, Number(process.env.GEOAGORA_ALERT_POLL_SEC || 60));
}

async function allSubscribedChannelIds() {
  const guilds = await getAllSubscriptions();
  return [...new Set(Object.values(guilds).flatMap((entry) => entry?.channels || []).filter(Boolean))];
}

async function fetchRecent(limit = 8) {
  const data = await fetchGeoAgora(`/events?limit=${Math.max(1, Math.min(Number(limit || 8), 20))}`);
  return Array.isArray(data?.events) ? data.events : [];
}

async function announceNewEvents(client) {
  const channelIds = await allSubscribedChannelIds();
  if (!channelIds.length) return;

  let events = [];
  try {
    events = await fetchRecent(8);
  } catch (error) {
    console.warn('[geoagora] alerts poll failed:', error?.message || String(error));
    return;
  }

  if (!events.length) return;

  if (!(await isBootstrapped())) {
    await markSeenEventKeys(recentEventKeys(events));
    await setBootstrapped(true);
    console.log(`[geoagora] alerts bootstrapped with ${events.length} existing event(s).`);
    return;
  }

  const seen = await getSeenEventKeys();
  const unseen = events.filter((evt) => {
    const [key] = recentEventKeys([evt]);
    return key ? !seen.has(key) : false;
  });
  if (!unseen.length) return;

  const lines = unseen.slice().reverse().map(toAlertLine);
  const content = `🪐 **GeoAgora activity update**\n${lines.join('\n')}`;

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ content });
      }
    } catch (error) {
      console.warn(`[geoagora] failed to send alerts to ${channelId}:`, error?.message || String(error));
    }
  }

  await markSeenEventKeys(recentEventKeys(unseen));
}

export async function startGeoAgoraBot() {
  const token = process.env.GEOAGORA_DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('GEOAGORA_DISCORD_BOT_TOKEN is missing.');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  let timer = null;

  client.on('clientReady', async () => {
    console.log(`🪐 GeoAgora bot online as ${client.user.tag}`);
    if (isMongoEnabled()) {
      try {
        const ping = await pingMongo();
        if (ping.ok) console.log(`[geoagora] Mongo ready: ${ping.database}`);
      } catch (error) {
        console.warn('[geoagora] Mongo ping failed:', error?.message || String(error));
      }
    }
    if (alertsEnabled()) {
      await announceNewEvents(client).catch(() => {});
      timer = setInterval(() => {
        announceNewEvents(client).catch(() => {});
      }, pollSeconds() * 1000);
      timer.unref?.();
      console.log(`🔔 GeoAgora alerts polling every ${pollSeconds()}s`);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'geoagora') return;

    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      await handleGeoAgora(interaction);
    } catch (error) {
      console.error('[geoagora] interaction failed:', error);
      const msg = `❌ GeoAgora bot error: ${error?.message || String(error)}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  });

  client.once('shardDisconnect', () => {
    if (timer) clearInterval(timer);
  });

  await client.login(token);
  return client;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startGeoAgoraBot().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
