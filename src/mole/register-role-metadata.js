import dotenv from "dotenv";
import { getRoleMetadataRecords } from "./role-metadata.js";

dotenv.config();

const RETRY_MAX_ATTEMPTS = Math.max(1, Number(process.env.ROLE_METADATA_RETRY_MAX_ATTEMPTS || 6));
const RETRY_BUFFER_MS = Math.max(0, Number(process.env.ROLE_METADATA_RETRY_BUFFER_MS || 500));
const BETWEEN_APPS_DELAY_MS = Math.max(0, Number(process.env.ROLE_METADATA_BETWEEN_APPS_DELAY_MS || 1500));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAppConfigs() {
  const moleClientId = process.env.MOLE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  const utilityClientId = process.env.UTILITY_DISCORD_CLIENT_ID;

  return [
    {
      key: 'mole',
      clientId: moleClientId,
      token: process.env.MOLE_DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN,
      enabled: !!moleClientId,
    },
    {
      key: 'utility',
      clientId: utilityClientId,
      token: process.env.UTILITY_DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN,
      enabled: !!utilityClientId,
    },
  ];
}

async function putMetadata({ key, clientId, token }, attempt = 1) {
  const records = getRoleMetadataRecords(key);
  const r = await fetch(`https://discord.com/api/v10/applications/${clientId}/role-connections/metadata`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(records),
  });

  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (r.status === 429 && attempt < RETRY_MAX_ATTEMPTS) {
    const retryAfterSeconds = Number(json?.retry_after || r.headers.get('retry-after') || 1);
    const waitMs = Math.max(1000, Math.ceil(retryAfterSeconds * 1000) + RETRY_BUFFER_MS);
    console.warn(`[role-metadata] rate limited on ${key}; waiting ${waitMs}ms before retry ${attempt + 1}/${RETRY_MAX_ATTEMPTS}`);
    await sleep(waitMs);
    return putMetadata({ key, clientId, token }, attempt + 1);
  }

  if (!r.ok) {
    throw new Error(`register_role_metadata_failed:${key}:${r.status}:${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }

  return json;
}

async function main() {
  const apps = getAppConfigs().filter((app) => app.enabled);
  if (!apps.length) {
    throw new Error('no_role_metadata_apps_configured');
  }

  for (let index = 0; index < apps.length; index += 1) {
    const app = apps[index];
    if (!app.token) {
      console.warn(`[role-metadata] skipping ${app.key}: missing bot token`);
      continue;
    }
    const result = await putMetadata(app);
    console.log(`[role-metadata] registered ${app.key} metadata (${Array.isArray(result) ? result.length : 0} fields)`);
    if (Array.isArray(result)) {
      for (const row of result) {
        console.log(` - ${row.key} (${row.type})`);
      }
    }
    if (index < apps.length - 1 && BETWEEN_APPS_DELAY_MS > 0) {
      console.log(`[role-metadata] waiting ${BETWEEN_APPS_DELAY_MS}ms before next app...`);
      await sleep(BETWEEN_APPS_DELAY_MS);
    }
  }
}

main().catch((err) => {
  console.error('[role-metadata] fatal:', err?.message || err);
  process.exit(1);
});
