import { PublicKey } from "@solana/web3.js";

const SNS_API_BASE = (process.env.SNS_API_BASE || "https://sns-api.bonfida.com").replace(/\/$/, "");
const SNS_SUGGEST_PROXY_URL = process.env.SNS_SUGGEST_PROXY_URL || "https://sns-suggest-proxy.bonfida.com";
const QUICKNODE_URL = process.env.QUICKNODE_URL || process.env.RPC_URL || "";

const DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000;
const PRIMARY_CACHE_TTL_MS = 5 * 60 * 1000;

const domainCache = new Map();
const primaryCache = new Map();

function now() {
  return Date.now();
}

function getCached(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expires <= now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(map, key, value, ttlMs) {
  map.set(key, { value, expires: now() + ttlMs });
  return value;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  return response.json();
}

async function tryQuickNodeRpc(method, params) {
  if (!QUICKNODE_URL) return null;
  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  };
  try {
    const data = await fetchJson(QUICKNODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (data?.error) {
      throw new Error(data.error?.message || "QuickNode SNS RPC error");
    }
    return data?.result ?? null;
  } catch {
    return null;
  }
}

function normalizeDomain(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.endsWith(".sol") ? raw.slice(0, -4) : raw;
}

export async function resolveSolanaName(pubkeyString) {
  const key = String(pubkeyString || "").trim();
  if (!key) return null;
  const cached = getCached(primaryCache, key);
  if (cached !== null) return cached;

  const quickNodePrimary = await tryQuickNodeRpc("sns_getFavouriteDomain", [key]);
  const quickNodeName = quickNodePrimary?.name || quickNodePrimary?.domain || null;
  if (quickNodeName) {
    return setCached(primaryCache, key, `${String(quickNodeName).replace(/\.sol$/i, "")}.sol`, PRIMARY_CACHE_TTL_MS);
  }

  const endpointCandidates = [
    `${SNS_API_BASE}/v2/user/fav-domains/${encodeURIComponent(key)}`,
    `${SNS_API_BASE}/v2/user/primary-domains/${encodeURIComponent(key)}`,
  ];

  for (const url of endpointCandidates) {
    try {
      const data = await fetchJson(url);
      const value = data?.[key] || data?.result?.[key] || null;
      if (value) {
        return setCached(primaryCache, key, `${String(value).replace(/\.sol$/i, "")}.sol`, PRIMARY_CACHE_TTL_MS);
      }
    } catch {
      // try next endpoint
    }
  }

  return setCached(primaryCache, key, null, 60_000);
}

export async function resolveSolanaAddress(address) {
  const input = String(address || "").trim();
  if (!input) throw new Error("Address is required.");

  if (!input.toLowerCase().endsWith(".sol")) {
    return new PublicKey(input);
  }

  const domain = normalizeDomain(input);
  const cached = getCached(domainCache, domain);
  if (cached) return cached;

  const fullDomain = `${domain}.sol`;

  const quickNodeResolved = await tryQuickNodeRpc("sns_resolveDomain", [fullDomain]);
  if (quickNodeResolved) {
    const key = new PublicKey(String(quickNodeResolved));
    setCached(domainCache, domain, key, DOMAIN_CACHE_TTL_MS);
    setCached(domainCache, key.toBase58(), key, DOMAIN_CACHE_TTL_MS);
    return key;
  }

  const queries = [fullDomain, domain];
  for (const q of queries) {
    try {
      const data = await fetchJson(SNS_SUGGEST_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      const exact = hits.find((hit) => {
        const hitDomain = normalizeDomain(hit?.domain_name || hit?.id || "");
        return hitDomain === domain && hit?.owner_key;
      });
      if (exact?.owner_key) {
        const key = new PublicKey(String(exact.owner_key));
        setCached(domainCache, domain, key, DOMAIN_CACHE_TTL_MS);
        setCached(domainCache, key.toBase58(), key, DOMAIN_CACHE_TTL_MS);
        return key;
      }
    } catch {
      // continue to next fallback
    }
  }

  throw new Error(`SNS: Could not resolve \`${input}\`. Check the domain spelling or SNS availability.`);
}
