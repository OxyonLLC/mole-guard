const fs = require('fs');
const path = require('path');

// Defaults are the production locations. FAUCET_DATA_DIR matches the override
// already honoured by mole/web.js and mole/walletLink.js; LINKED_WALLETS_DIRS
// (path-delimited, src first then root) lets an isolated process point the
// mole mirrors at disposable copies. Both are read per call.
function faucetFile(name) {
  const dir = String(process.env.FAUCET_DATA_DIR || '').trim() || path.resolve(__dirname, '..', 'faucet');
  return path.resolve(dir, name);
}

function linkedWalletFiles() {
  const override = String(process.env.LINKED_WALLETS_DIRS || '').trim();
  const dirs = override
    ? override.split(path.delimiter).filter(Boolean)
    : [path.resolve(__dirname, '..', 'data'), path.resolve(__dirname, '..', '..', 'data')];
  return dirs.map((dir) => path.resolve(dir, 'linked_wallets.json'));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function toMsTimestamp(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num < 1e12 ? num * 1000 : num;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCandidate(record, source, intent) {
  if (!record) return null;
  if (typeof record === 'string') {
    return { input: record, address: record, updatedAt: 0, source, intent };
  }
  if (typeof record !== 'object' || Array.isArray(record)) return null;

  const walletIntents = record.wallets && typeof record.wallets === 'object' && !Array.isArray(record.wallets)
    ? record.wallets
    : {};

  const preferred = walletIntents[intent]
    || (intent === 'payout' ? walletIntents.faucet : null)
    || (intent === 'faucet' ? walletIntents.payout : null)
    || walletIntents.verified
    || walletIntents.airdrop
    || (record.address ? record : null)
    || (record.wallet ? record : null);

  if (!preferred) return null;
  const address = preferred.address || preferred.wallet || record.address || record.wallet;
  if (!address) return null;

  return {
    input: preferred.input || record.input || address,
    address,
    updatedAt: toMsTimestamp(preferred.updatedAt || preferred.linked_at || record.updatedAt || record.linked_at),
    source,
    intent,
  };
}

function getWalletLinks() {
  const raw = readJson(faucetFile('wallet_links.json'), {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  if (raw.links && typeof raw.links === 'object') return raw.links;
  return raw;
}

function readWalletMap(filePath) {
  const raw = readJson(filePath, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw.links && typeof raw.links === 'object' ? raw.links : raw;
}

function pickPreferredWallet(candidates) {
  return candidates
    .filter((candidate) => candidate && candidate.address)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

function getLinkedWallet(discordUserId, intent = 'payout') {
  const userId = String(discordUserId);
  const links = getWalletLinks();
  const [srcLinksFile, rootLinksFile] = linkedWalletFiles();
  const moleLinks = srcLinksFile ? readWalletMap(srcLinksFile) : {};
  const rootLinks = rootLinksFile ? readWalletMap(rootLinksFile) : {};
  const candidates = [
    normalizeCandidate(links[userId], 'faucet', intent),
    normalizeCandidate(moleLinks[userId], 'mole-src-data', intent),
    normalizeCandidate(rootLinks[userId], 'mole-root-data', intent),
  ];

  const legacyRegistrations = readJson(faucetFile('registrations.json'), {});
  if (legacyRegistrations && typeof legacyRegistrations === 'object' && !Array.isArray(legacyRegistrations)) {
    candidates.push(normalizeCandidate(legacyRegistrations[userId], 'legacy-registrations', intent));
  }

  const legacyAirdrops = readJson(faucetFile('airdrops.json'), {});
  if (legacyAirdrops && typeof legacyAirdrops === 'object' && !Array.isArray(legacyAirdrops)) {
    candidates.push(normalizeCandidate(legacyAirdrops[userId], 'legacy-airdrops', intent));
  }

  return pickPreferredWallet(candidates);
}

module.exports = {
  getLinkedWallet,
};
