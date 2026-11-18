const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Production keeps the quiz bot's existing src/quiz/data directory. An
// isolated process may set QUIZ_DATA_DIR to keep db.json, its lock and
// recent_questions.json inside a disposable directory. Resolved per call so
// no import-time path outlives the override.
function quizDataDir() {
  const override = String(process.env.QUIZ_DATA_DIR || '').trim();
  return override ? path.resolve(override) : path.join(__dirname, 'data');
}
const DOC_ID = 'global';

const MANAGED_FILES = {
  'db.json': {
    collection: () => String(process.env.QUIZ_DB_COLLECTION || 'quiz_db').trim(),
    fallback: () => ({
      meta: {
        cycleEpochMs: Date.now(),
        cycleLengthDays: 91,
        closedCycles: [],
        wasConfigured: false,
      },
      users: {},
      redemptions: [],
    }),
  },
  'recent_questions.json': {
    collection: () => String(process.env.QUIZ_RECENT_QUESTIONS_COLLECTION || 'quiz_recent_questions').trim(),
    fallback: () => ({ channels: {} }),
  },
};

let clientPromise = null;
let dbPromise = null;
let bootPromise = null;
const persistChains = new Map();

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isMongoEnabled() {
  if (parseBoolean(process.env.MONGO_ENABLED, false)) return true;
  return Boolean(String(process.env.MONGO_URI || '').trim());
}

function getMongoConfig() {
  return {
    enabled: isMongoEnabled(),
    uri: String(process.env.MONGO_URI || '').trim(),
    database: String(process.env.MONGO_DATABASE || '').trim() || 'mole_guard',
  };
}

async function getMongoClient() {
  const { enabled, uri } = getMongoConfig();
  if (!enabled || !uri) return null;

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
}

async function getMongoDb() {
  const { enabled, database } = getMongoConfig();
  if (!enabled) return null;
  if (!dbPromise) {
    dbPromise = getMongoClient().then((client) => (client ? client.db(database) : null)).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function ensureQuizDataDir() {
  fs.mkdirSync(quizDataDir(), { recursive: true });
}

function filePath(name) {
  return path.join(quizDataDir(), name);
}

function readLocal(name, fallback) {
  try {
    const target = filePath(name);
    if (!fs.existsSync(target)) return clone(fallback);
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    console.warn(`[quiz-storage] read failed for ${name}:`, error?.message || error);
    return clone(fallback);
  }
}

function writeLocal(name, value) {
  ensureQuizDataDir();
  const target = filePath(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

function isMeaningful(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

async function getCollection(name) {
  const spec = MANAGED_FILES[name];
  if (!spec || !isMongoEnabled()) return null;
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection(spec.collection());
}

async function bootstrapFile(name) {
  const spec = MANAGED_FILES[name];
  if (!spec) return;

  const fallback = spec.fallback();
  const localValue = readLocal(name, fallback);
  const collection = await getCollection(name);

  if (!collection) {
    if (!fs.existsSync(filePath(name))) writeLocal(name, localValue);
    return;
  }

  const existing = await collection.findOne({ _id: DOC_ID }).catch(() => null);
  const remoteValue = existing?.payload;

  if (!isMeaningful(localValue) && isMeaningful(remoteValue)) {
    writeLocal(name, remoteValue);
    return;
  }

  if (isMeaningful(localValue) && !isMeaningful(remoteValue)) {
    await collection.updateOne(
      { _id: DOC_ID },
      {
        $set: {
          fileName: name,
          payload: localValue,
          source: 'json-migration',
          migratedAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    ).catch((error) => {
      console.warn(`[quiz-storage] bootstrap write failed for ${name}:`, error?.message || error);
    });
    return;
  }

  if (!fs.existsSync(filePath(name))) {
    writeLocal(name, localValue);
  }
}

function queuePersist(name, value) {
  if (!MANAGED_FILES[name] || !isMongoEnabled()) return;
  const next = (persistChains.get(name) || Promise.resolve())
    .then(async () => {
      const collection = await getCollection(name);
      if (!collection) return;
      await collection.updateOne(
        { _id: DOC_ID },
        {
          $set: {
            fileName: name,
            payload: clone(value),
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    })
    .catch((error) => {
      console.warn(`[quiz-storage] persist failed for ${name}:`, error?.message || error);
    });
  persistChains.set(name, next);
}

async function initQuizStorage() {
  ensureQuizDataDir();
  if (!bootPromise) {
    bootPromise = (async () => {
      for (const name of Object.keys(MANAGED_FILES)) {
        await bootstrapFile(name);
      }
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

function readManagedQuizJson(name, fallback) {
  const spec = MANAGED_FILES[name];
  return readLocal(name, spec ? spec.fallback() : fallback);
}

function writeManagedQuizJson(name, value) {
  const spec = MANAGED_FILES[name];
  const payload = clone(value ?? (spec ? spec.fallback() : {}));
  writeLocal(name, payload);
  if (spec) queuePersist(name, payload);
}

/**
 * Await every queued Mongo persist. Call this before process.exit().
 *
 * writeManagedQuizJson() writes local disk synchronously and pushes to Mongo on
 * a background chain. Exiting straight after a write kills that chain, so the
 * write reaches local disk and never reaches Mongo.
 *
 * This layer is less exposed than the faucet and mole ones — readManagedQuizJson
 * reads LOCAL, and bootstrapFile() lets a meaningful local value win — so a
 * dropped persist does not corrupt the running machine. What it does is leave
 * Mongo silently behind, and Mongo is the copy that becomes truth if the local
 * db.json is ever lost or another machine boots with an empty one. A quiz
 * cycle-close settles payouts; that is not a write to lose from the backup.
 *
 * Found 2026-08-16 while sweeping for the hodl:pay variant of this bug, where
 * the same pattern was actively destructive because that layer refreshes FROM
 * Mongo on every run.
 */
async function flushManagedQuizWrites() {
  await Promise.allSettled([...persistChains.values()]);
}

module.exports = {
  quizDataDir,
  ensureQuizDataDir,
  initQuizStorage,
  readManagedQuizJson,
  writeManagedQuizJson,
  flushManagedQuizWrites,
};
