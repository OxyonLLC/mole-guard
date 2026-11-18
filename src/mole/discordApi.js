import { getConfig } from './config.js';
import { readJson, writeJson, obfuscate, deobfuscate } from './storage.js';

const API_BASE = 'https://discord.com/api/v10';

function tokenDb() { return readJson('oauth_tokens.json', {}); }
function saveTokenDb(db) { writeJson('oauth_tokens.json', db); }

export function getUserTokens(discordUserId) {
  const db = tokenDb();
  const rec = db[String(discordUserId)];
  if (!rec) return null;
  return { ...rec, refresh_token: rec.refresh_token ? deobfuscate(rec.refresh_token) : null };
}

export function setUserTokens(discordUserId, tokens) {
  const db = tokenDb();
  db[String(discordUserId)] = {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    expires_at: tokens.expires_at,
    scope: tokens.scope,
    refresh_token: tokens.refresh_token ? obfuscate(tokens.refresh_token) : null,
  };
  saveTokenDb(db);
}
function tokenKey(appKey, userId) {
  return `${appKey}:${userId}`;
}
export function getUserTokensForApp(appKey, discordUserId) {
  const namespaced = getUserTokens(`${appKey}:${discordUserId}`);
  if (namespaced) return namespaced;

  // legacy fallback (old non-namespaced tokens)
  return getUserTokens(discordUserId);
}

export function setUserTokensForApp(appKey, discordUserId, tokens) {
  return setUserTokens(tokenKey(appKey, discordUserId), tokens);
}


export async function exchangeCodeForToken(code) {
  const cfg = getConfig();
  const body = new URLSearchParams({
    client_id: cfg.DISCORD_CLIENT_ID,
    client_secret: cfg.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.DISCORD_REDIRECT_URI,
  });

  const r = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`token_exchange_failed:${r.status}:${await r.text()}`);
  return r.json();
}

export async function refreshToken(refresh_token) {
  const cfg = getConfig();
  const body = new URLSearchParams({
    client_id: cfg.DISCORD_CLIENT_ID,
    client_secret: cfg.DISCORD_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token,
  });

  const r = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`token_refresh_failed:${r.status}:${await r.text()}`);
  return r.json();
}

export async function discordMe(access_token) {
  const r = await fetch(`${API_BASE}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` }});
  if (!r.ok) throw new Error(`discord_me_failed:${r.status}`);
  return r.json();
}

export async function putRoleConnection(access_token, applicationId, payload) {
  const url = `${API_BASE}/users/@me/applications/${applicationId}/role-connection`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (r.ok) return r.json();

    const text = await r.text();

    // Retry once on rate limit
    if (r.status === 429 && attempt === 0) {
      try {
        const j = JSON.parse(text);
        const waitMs = Math.ceil((Number(j.retry_after) || 1) * 1000);
        await new Promise(res => setTimeout(res, waitMs));
        continue;
      } catch {
        await new Promise(res => setTimeout(res, 5000));
        continue;
      }
    }

    throw new Error(`put_role_connection_failed:${r.status}:${text}`);
  }
}

