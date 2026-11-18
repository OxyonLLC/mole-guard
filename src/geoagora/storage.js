import fs from 'node:fs';
import path from 'node:path';

import { getMongoDb, isMongoEnabled } from '../lib/mongo.js';

const ROOT = path.resolve(process.cwd(), 'src', 'data', 'geoagora');
const SUBS_FILE = path.join(ROOT, 'subscriptions.json');
const STATE_FILE = path.join(ROOT, 'state.json');

const SUBSCRIPTIONS_COLLECTION = String(process.env.GEOAGORA_SUBSCRIPTIONS_COLLECTION || 'geoagora_subscriptions').trim();
const STATE_COLLECTION = String(process.env.GEOAGORA_STATE_COLLECTION || 'geoagora_state').trim();
const STATUS_CACHE_COLLECTION = String(process.env.GEOAGORA_STATUS_CACHE_COLLECTION || 'geoagora_status_cache').trim();
const STATE_DOC_ID = 'global';
const STATUS_DOC_ID = 'health';

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function readJson(file, fallback) {
  try {
    ensureRoot();
    if (!fs.existsSync(file)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, value) {
  ensureRoot();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function subscriptionsFallback() {
  return { guilds: {} };
}

function stateFallback() {
  return { seenEventKeys: [], bootstrapped: false, lastPollAt: null };
}

async function getCollections() {
  if (!isMongoEnabled()) return null;
  const db = await getMongoDb();
  if (!db) return null;
  return {
    subscriptions: db.collection(SUBSCRIPTIONS_COLLECTION),
    state: db.collection(STATE_COLLECTION),
    status: db.collection(STATUS_CACHE_COLLECTION),
  };
}

async function importSubscriptionsIfNeeded(collection) {
  const count = await collection.estimatedDocumentCount().catch(() => 0);
  if (count > 0) return;
  const fallback = readJson(SUBS_FILE, subscriptionsFallback());
  const entries = Object.entries(fallback?.guilds || {});
  if (!entries.length) return;
  await collection.insertMany(entries.map(([guildId, entry]) => ({
    _id: guildId,
    guildId,
    channels: [...new Set((entry?.channels || []).filter(Boolean))],
    source: 'json-migration',
    migratedAt: new Date(),
    updatedAt: new Date(),
  })));
}

async function importStateIfNeeded(collection) {
  const existing = await collection.findOne({ _id: STATE_DOC_ID }, { projection: { _id: 1 } }).catch(() => null);
  if (existing) return;
  const fallback = readJson(STATE_FILE, stateFallback());
  await collection.updateOne(
    { _id: STATE_DOC_ID },
    {
      $set: {
        seenEventKeys: [...new Set((fallback.seenEventKeys || []).filter(Boolean))].slice(-500),
        bootstrapped: Boolean(fallback.bootstrapped),
        lastPollAt: fallback.lastPollAt || null,
        source: 'json-migration',
        migratedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function loadSubscriptionsFromMongo() {
  const collections = await getCollections();
  if (!collections) return null;
  await importSubscriptionsIfNeeded(collections.subscriptions);
  const docs = await collections.subscriptions.find({}).toArray();
  const guilds = {};
  for (const doc of docs) {
    guilds[String(doc.guildId || doc._id)] = {
      channels: [...new Set((doc.channels || []).filter(Boolean))],
    };
  }
  return { guilds };
}

async function loadStateFromMongo() {
  const collections = await getCollections();
  if (!collections) return null;
  await importStateIfNeeded(collections.state);
  const doc = await collections.state.findOne({ _id: STATE_DOC_ID });
  if (!doc) return stateFallback();
  return {
    seenEventKeys: [...new Set((doc.seenEventKeys || []).filter(Boolean))].slice(-500),
    bootstrapped: Boolean(doc.bootstrapped),
    lastPollAt: doc.lastPollAt || null,
  };
}

export async function loadSubscriptions() {
  return (await loadSubscriptionsFromMongo()) || readJson(SUBS_FILE, subscriptionsFallback());
}

export async function getAllSubscriptions() {
  const data = await loadSubscriptions();
  return data?.guilds || {};
}

export async function listGuildSubscriptions(guildId) {
  const all = await getAllSubscriptions();
  const channels = all?.[guildId]?.channels || [];
  return [...new Set(channels.filter(Boolean))];
}

export async function isChannelSubscribed(guildId, channelId) {
  return (await listGuildSubscriptions(guildId)).includes(channelId);
}

export async function addGuildSubscription(guildId, channelId) {
  const collections = await getCollections();
  if (collections) {
    await collections.subscriptions.updateOne(
      { _id: guildId },
      {
        $setOnInsert: { guildId, createdAt: new Date() },
        $addToSet: { channels: channelId },
        $set: { updatedAt: new Date() },
      },
      { upsert: true },
    );
    return listGuildSubscriptions(guildId);
  }

  const data = readJson(SUBS_FILE, subscriptionsFallback());
  if (!data.guilds[guildId]) data.guilds[guildId] = { channels: [] };
  const set = new Set(data.guilds[guildId].channels || []);
  set.add(channelId);
  data.guilds[guildId].channels = [...set];
  writeJson(SUBS_FILE, data);
  return data.guilds[guildId].channels;
}

export async function removeGuildSubscription(guildId, channelId) {
  const collections = await getCollections();
  if (collections) {
    await collections.subscriptions.updateOne(
      { _id: guildId },
      {
        $pull: { channels: channelId },
        $set: { updatedAt: new Date() },
      },
    );
    const doc = await collections.subscriptions.findOne({ _id: guildId });
    const channels = [...new Set((doc?.channels || []).filter(Boolean))];
    if (!channels.length) {
      await collections.subscriptions.deleteOne({ _id: guildId });
      return [];
    }
    return channels;
  }

  const data = readJson(SUBS_FILE, subscriptionsFallback());
  if (!data.guilds[guildId]) return [];
  data.guilds[guildId].channels = (data.guilds[guildId].channels || []).filter((id) => id !== channelId);
  if (!data.guilds[guildId].channels.length) delete data.guilds[guildId];
  writeJson(SUBS_FILE, data);
  return data.guilds[guildId]?.channels || [];
}

export async function loadState() {
  return (await loadStateFromMongo()) || readJson(STATE_FILE, stateFallback());
}

export async function getSeenEventKeys() {
  return new Set((await loadState()).seenEventKeys || []);
}

export async function markSeenEventKeys(keys = []) {
  const dedupedKeys = [...new Set(keys.filter(Boolean))];
  const collections = await getCollections();
  if (collections) {
    const current = await loadState();
    const merged = [...new Set([...(current.seenEventKeys || []), ...dedupedKeys])].slice(-500);
    await collections.state.updateOne(
      { _id: STATE_DOC_ID },
      {
        $set: {
          seenEventKeys: merged,
          lastPollAt: new Date().toISOString(),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return;
  }

  const state = readJson(STATE_FILE, stateFallback());
  const merged = new Set([...(state.seenEventKeys || []), ...dedupedKeys]);
  state.seenEventKeys = [...merged].slice(-500);
  state.lastPollAt = new Date().toISOString();
  writeJson(STATE_FILE, state);
}

export async function setBootstrapped(value = true) {
  const bootstrapped = Boolean(value);
  const collections = await getCollections();
  if (collections) {
    await collections.state.updateOne(
      { _id: STATE_DOC_ID },
      {
        $set: {
          bootstrapped,
          lastPollAt: new Date().toISOString(),
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
          seenEventKeys: [],
        },
      },
      { upsert: true },
    );
    return;
  }

  const state = readJson(STATE_FILE, stateFallback());
  state.bootstrapped = bootstrapped;
  state.lastPollAt = new Date().toISOString();
  writeJson(STATE_FILE, state);
}

export async function isBootstrapped() {
  return Boolean((await loadState()).bootstrapped);
}

export async function cacheHealthResult(result = {}) {
  const collections = await getCollections();
  if (!collections) return false;
  const payload = {
    _id: STATUS_DOC_ID,
    ok: Boolean(result.ok),
    path: result.path || null,
    error: result.error || null,
    health: result.health || null,
    fetchedAt: new Date().toISOString(),
    updatedAt: new Date(),
  };
  await collections.status.updateOne({ _id: STATUS_DOC_ID }, { $set: payload, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  return true;
}

export async function getCachedHealthResult() {
  const collections = await getCollections();
  if (!collections) return null;
  const doc = await collections.status.findOne({ _id: STATUS_DOC_ID });
  if (!doc) return null;
  return {
    ok: Boolean(doc.ok),
    path: doc.path || null,
    error: doc.error || null,
    health: doc.health || null,
    fetchedAt: doc.fetchedAt || null,
    cached: true,
  };
}
