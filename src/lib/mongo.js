import { MongoClient } from 'mongodb';

let clientPromise = null;
let dbPromise = null;

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function isMongoEnabled() {
  if (parseBoolean(process.env.MONGO_ENABLED, false)) return true;
  return Boolean(String(process.env.MONGO_URI || '').trim());
}

export function getMongoConfig() {
  return {
    enabled: isMongoEnabled(),
    uri: String(process.env.MONGO_URI || '').trim(),
    database: String(process.env.MONGO_DATABASE || '').trim() || 'mole_guard',
  };
}

export async function getMongoClient() {
  const { enabled, uri } = getMongoConfig();
  if (!enabled || !uri) return null;

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      // Overridable for tests that deliberately point at an unreachable URI
      // to exercise failure handling hermetically — production keeps the
      // 10s default unless someone sets this on purpose.
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 10000,
    });

    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
}

export async function getMongoDb() {
  const { enabled, database } = getMongoConfig();
  if (!enabled) return null;

  if (!dbPromise) {
    dbPromise = getMongoClient()
      .then((client) => (client ? client.db(database) : null))
      .catch((error) => {
        dbPromise = null;
        throw error;
      });
  }

  return dbPromise;
}

export async function pingMongo() {
  const db = await getMongoDb();
  if (!db) return { ok: false, enabled: false };
  await db.command({ ping: 1 });
  return { ok: true, enabled: true, database: db.databaseName };
}

export async function closeMongo() {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  dbPromise = null;
  if (client) {
    await client.close().catch(() => {});
  }
}


// Backward-compatible alias for modules that import getDb
export const getDb = getMongoDb;
