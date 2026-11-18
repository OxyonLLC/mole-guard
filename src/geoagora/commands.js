import pkg from 'discord.js';
import {
  addGuildSubscription,
  cacheHealthResult,
  getCachedHealthResult,
  isChannelSubscribed,
  listGuildSubscriptions,
  removeGuildSubscription,
} from './storage.js';
import manifest from '../../package.json' with { type: 'json' };

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = pkg;

// Read from package.json, not hardcoded — a hardcoded string here is
// exactly what silently went stale (v3.3.3) through the v3.3.4 release.
const RELEASE_VERSION = `v${manifest.version}`;

function trimSlash(url = '') {
  return String(url || '').replace(/\/+$/, '');
}

export function getGeoAgoraBaseUrl() {
  return trimSlash(process.env.GEOAGORA_SITE_URL || 'https://winlew.co/geoagora');
}

export function getGeoAgoraPublicApiUrl() {
  return trimSlash(process.env.GEOAGORA_PUBLIC_API_URL || `${getGeoAgoraBaseUrl()}/api`);
}

export function getGeoAgoraApiUrl() {
  return trimSlash(
    process.env.GEOAGORA_BOT_API_URL ||
    process.env.GEOAGORA_PUBLIC_API_URL ||
    process.env.GEOAGORA_API_LOCAL_URL ||
    `${getGeoAgoraBaseUrl()}/api`,
  );
}

function encode(v) {
  return encodeURIComponent(String(v || '').trim());
}

export function getMarketplaceUrl() {
  return `${getGeoAgoraBaseUrl()}/marketplace`;
}

export function getWalletUrl(address) {
  return `${getGeoAgoraBaseUrl()}/wallet/${encode(address)}`;
}

export function getProfileUrl(target) {
  const text = String(target || '').trim();
  if (/^0x[a-f0-9]{40}$/i.test(text)) return `${getGeoAgoraBaseUrl()}/wallet/${encode(text)}`;
  return `${getGeoAgoraBaseUrl()}/user/${encode(text)}`;
}

export function getListingUrl(tokenId) {
  return `${getGeoAgoraBaseUrl()}/listing/${encode(tokenId)}`;
}

export function getOfferUrl(tokenId) {
  return `${getGeoAgoraBaseUrl()}/offer/${encode(tokenId)}`;
}

function routeButtons(...buttons) {
  return new ActionRowBuilder().addComponents(buttons);
}

function channelMention(id) {
  return `<#${id}>`;
}

function eventKey(evt = {}) {
  return String(evt?._id || [evt?.createdAt, evt?.eventType, evt?.entityType, evt?.entityId, evt?.tokenId].filter(Boolean).join(':'));
}

export function toAlertLine(evt = {}) {
  const label = String(evt?.eventType || 'market.event');
  const entityType = String(evt?.entityType || 'asset');
  const entityId = String(evt?.listingId || evt?.bundleId || evt?.tokenId || evt?.entityId || '');
  const seller = evt?.sellerWallet ? ` • seller \`${evt.sellerWallet}\`` : '';
  return `🪐 **${label}** on **${entityType}** ${entityId ? `• \`${entityId}\`` : ''}${seller}`;
}

export async function fetchGeoAgora(pathname, init = {}) {
  const normalizedPath = String(pathname || '').trim();
  const suffix = !normalizedPath || normalizedPath == '/' ? '' : (normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`);
  const url = `${getGeoAgoraApiUrl()}${suffix}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${text.slice(0, 180)}`.trim());
  }
  return response.json();
}

async function getHealthSummary() {
  const candidates = ['', '/', '/health', '/api/health'];
  let lastError = null;
  for (const path of candidates) {
    try {
      const health = await fetchGeoAgora(path);
      const result = { ok: true, health, path: path || '/' };
      await cacheHealthResult(result).catch(() => {});
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  const cached = await getCachedHealthResult().catch(() => null);
  if (cached) {
    return { ...cached, ok: false, error: lastError?.message || String(lastError || 'Health check failed') };
  }
  return { ok: false, error: lastError?.message || String(lastError || 'Health check failed') };
}

async function getRecentEvents(limit = 5) {
  const data = await fetchGeoAgora(`/events?limit=${Math.max(1, Math.min(Number(limit || 5), 10))}`);
  return Array.isArray(data?.events) ? data.events : [];
}

function getMongoStatusLine(mongo = {}) {
  const mongoConnected =
    mongo.state === 'connected' ||
    Number(mongo.readyState) === 1 ||
    mongo.connected === true;

  if (mongoConnected) {
    return `connected:true${mongo.state ? ` (${mongo.state})` : ''}`;
  }

  if (mongo && typeof mongo === 'object' && Object.keys(mongo).length) {
    const parts = [`connected:false`];
    if (mongo.state) parts.push(`(${mongo.state})`);
    return parts.join(' ');
  }

  return 'connected:false';
}

function buildStatusEmbed(healthResult) {
  const emb = new EmbedBuilder()
    .setTitle('🪐 GeoAgora status')
    .setColor(healthResult.ok ? 0x2dd4bf : 0xef4444)
    .setDescription('GeoAgora preview links, health, and tester entry points.')
    .addFields(
      { name: 'Site', value: getGeoAgoraBaseUrl(), inline: false },
      { name: 'Marketplace', value: getMarketplaceUrl(), inline: false },
      { name: 'API', value: getGeoAgoraPublicApiUrl(), inline: false },
      { name: 'Health', value: healthResult.ok ? 'Online ✅' : `Unavailable ⚠️\n${healthResult.error}`, inline: false },
    )
    .setTimestamp(new Date());

  if (healthResult.ok && typeof healthResult.health?.mongo === 'object') {
    emb.addFields({ name: 'Mongo', value: getMongoStatusLine(healthResult.health.mongo), inline: true });
  }

  if (healthResult.cached && healthResult.fetchedAt) {
    emb.addFields({ name: 'Cache', value: `Last good health snapshot: ${healthResult.fetchedAt}`, inline: false });
  }

  return emb;
}

export const commandInventory = [
  { path: '/geoagora status', description: 'Show GeoAgora beta links and status.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora health', description: 'Check the GeoAgora API health endpoint.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora marketplace', description: 'Open the GeoAgora marketplace preview.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora wallet <address>', description: 'Open a wallet route on the GeoAgora site.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora profile <target>', description: 'Open a public profile by name or wallet.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora listing <tokenid>', description: 'Open a listing detail route.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora offer <tokenid>', description: 'Open an offer board route.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora recent [limit]', description: 'Show recent GeoAgora market events.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora watch list', description: 'List subscribed GeoAgora alert channels.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora watch start', description: 'Subscribe a channel to GeoAgora alerts.', audience: 'mod', category: 'GeoAgora' },
  { path: '/geoagora watch status', description: 'Check whether a channel is subscribed.', audience: 'all', category: 'GeoAgora' },
  { path: '/geoagora watch stop', description: 'Unsubscribe a channel from GeoAgora alerts.', audience: 'mod', category: 'GeoAgora' },
  { path: '/geoagora help', description: 'Show GeoAgora command help.', audience: 'all', category: 'GeoAgora' },
];

function helpAudienceSuffix(item) {
  return item.audience === 'mod' ? ' (Manage Channels/Admin)' : '';
}

export const commandData = [
  new SlashCommandBuilder()
    .setName('geoagora')
    .setDescription('GeoAgora site, status, and alert commands')
    .addSubcommand((sc) => sc.setName('status').setDescription('Show GeoAgora beta links and status'))
    .addSubcommand((sc) => sc.setName('health').setDescription('Check the GeoAgora API health endpoint'))
    .addSubcommand((sc) => sc.setName('marketplace').setDescription('Open the GeoAgora marketplace preview'))
    .addSubcommand((sc) =>
      sc
        .setName('wallet')
        .setDescription('Open a wallet route on the GeoAgora site')
        .addStringOption((opt) => opt.setName('address').setDescription('Wallet address').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('profile')
        .setDescription('Open a public profile by name or wallet')
        .addStringOption((opt) => opt.setName('target').setDescription('Name, domain, or wallet').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('listing')
        .setDescription('Open a listing detail route')
        .addStringOption((opt) => opt.setName('tokenid').setDescription('Token ID').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('offer')
        .setDescription('Open an offer board route')
        .addStringOption((opt) => opt.setName('tokenid').setDescription('Token ID').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('recent')
        .setDescription('Show recent GeoAgora market events')
        .addIntegerOption((opt) => opt.setName('limit').setDescription('How many events to show (1-10)').setMinValue(1).setMaxValue(10)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('watch')
        .setDescription('Manage GeoAgora alert subscriptions')
        .addSubcommand((sc) =>
          sc
            .setName('start')
            .setDescription('Subscribe a channel to GeoAgora alerts')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to receive alerts (defaults to current)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement),
            ),
        )
        .addSubcommand((sc) =>
          sc
            .setName('stop')
            .setDescription('Unsubscribe a channel from GeoAgora alerts')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to remove (defaults to current)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement),
            ),
        )
        .addSubcommand((sc) => sc.setName('list').setDescription('List subscribed GeoAgora alert channels'))
        .addSubcommand((sc) =>
          sc
            .setName('status')
            .setDescription('Check whether a channel is subscribed')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to check (defaults to current)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement),
            ),
        ),
    )
    .addSubcommand((sc) => sc.setName('help').setDescription('Show GeoAgora command help'))
    .toJSON(),
];

async function handleWatch(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild?.id;
  if (!guildId) {
    return interaction.editReply('This command can only be used inside a server.');
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const canManage =
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions.has(PermissionFlagsBits.Administrator);

  const target = interaction.options.getChannel('channel') || interaction.channel;

  if (sub === 'list') {
    const channelIds = await listGuildSubscriptions(guildId);
    if (!channelIds.length) return interaction.editReply('📭 No channels are subscribed yet.');
    return interaction.editReply(`🔔 GeoAgora alerts are enabled in:\n${channelIds.map(channelMention).join('\n')}`);
  }

  if (sub === 'status') {
    return interaction.editReply(
      await isChannelSubscribed(guildId, target.id)
        ? `✅ ${channelMention(target.id)} is subscribed to GeoAgora alerts.`
        : `❌ ${channelMention(target.id)} is not subscribed.`,
    );
  }

  if (!canManage) {
    return interaction.editReply('⛔ You need **Manage Channels** or **Administrator** to change GeoAgora alert subscriptions.');
  }

  if (sub === 'start') {
    await addGuildSubscription(guildId, target.id);
    return interaction.editReply(`✅ GeoAgora alerts will now post in ${channelMention(target.id)}.`);
  }

  if (sub === 'stop') {
    await removeGuildSubscription(guildId, target.id);
    return interaction.editReply(`🛑 GeoAgora alerts stopped for ${channelMention(target.id)}.`);
  }

  return interaction.editReply('Unknown watch subcommand.');
}

export async function handleGeoAgora(interaction) {
  const sub = interaction.options.getSubcommand();
  const subGroup = typeof interaction.options.getSubcommandGroup === 'function'
    ? interaction.options.getSubcommandGroup(false)
    : null;

  if (subGroup === 'watch') return handleWatch(interaction);

  const baseUrl = getGeoAgoraBaseUrl();
  const marketplaceUrl = getMarketplaceUrl();

  if (sub === 'status' || sub === 'health') {
    const healthResult = await getHealthSummary();
    const row = routeButtons(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open GeoAgora').setURL(baseUrl),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Marketplace').setURL(marketplaceUrl),
    );
    return interaction.editReply({ embeds: [buildStatusEmbed(healthResult)], components: [row] });
  }

  if (sub === 'marketplace') {
    return interaction.editReply({
      content: `🛒 GeoAgora marketplace: ${marketplaceUrl}`,
      components: [routeButtons(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open marketplace').setURL(marketplaceUrl))],
    });
  }

  if (sub === 'wallet') {
    const address = interaction.options.getString('address', true);
    const url = getWalletUrl(address);
    return interaction.editReply({
      content: `👛 Wallet route ready: ${url}`,
      components: [routeButtons(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open wallet').setURL(url))],
    });
  }

  if (sub === 'profile') {
    const target = interaction.options.getString('target', true);
    const url = getProfileUrl(target);
    return interaction.editReply({
      content: `🧭 Profile route ready: ${url}`,
      components: [routeButtons(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open profile').setURL(url))],
    });
  }

  if (sub === 'listing') {
    const tokenId = interaction.options.getString('tokenid', true);
    const url = getListingUrl(tokenId);
    return interaction.editReply({
      content: `📦 Listing detail route: ${url}`,
      components: [routeButtons(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open listing').setURL(url))],
    });
  }

  if (sub === 'offer') {
    const tokenId = interaction.options.getString('tokenid', true);
    const url = getOfferUrl(tokenId);
    return interaction.editReply({
      content: `💸 Offer board route: ${url}`,
      components: [routeButtons(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open offer board').setURL(url))],
    });
  }

  if (sub === 'recent') {
    const limit = interaction.options.getInteger('limit') || 5;
    try {
      const events = await getRecentEvents(limit);
      if (!events.length) return interaction.editReply('😶 No recent GeoAgora market events found.');

      const emb = new EmbedBuilder()
        .setTitle('📰 Recent GeoAgora events')
        .setColor(0x22c55e)
        .setDescription(events.slice(0, limit).map((evt) => `• ${toAlertLine(evt)}`).join('\n'))
        .setFooter({ text: `Showing ${Math.min(limit, events.length)} event(s)` })
        .setTimestamp(new Date());

      return interaction.editReply({ embeds: [emb] });
    } catch (error) {
      return interaction.editReply(`⚠️ Could not fetch recent events: ${error?.message || String(error)}`);
    }
  }

  if (sub === 'help') {
    const emb = new EmbedBuilder()
      .setTitle(`🧭 GeoAgora help — ${RELEASE_VERSION}`)
      .setColor(0x8b5cf6)
      .setDescription(commandInventory.map((item) => `• **${item.path}** — ${item.description}${helpAudienceSuffix(item)}`).join('\n'))
      .setTimestamp(new Date());
    return interaction.editReply({ embeds: [emb] });
  }

  return interaction.editReply('Unknown GeoAgora command.');
}

export function recentEventKeys(events = []) {
  return events.map(eventKey).filter(Boolean);
}
