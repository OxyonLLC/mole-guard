
// Pre-existing bug found while live-testing the new Governance dashboard
// section (2026-07-20), unrelated to governance itself — affects every
// dashboard fetch, not just this one. This local API_BASE resolution used
// the api-proxy.php path unconditionally whenever the page's data-api-base
// attribute was present, with no check for whether the page is actually
// running on the shared-hosting domain that proxy exists for. On
// winlew.co that's harmless (the attribute is only meaningful there
// anyway), but visiting this page against any other host serving the same
// static files (localhost, a Docker/test environment) sent every API call
// to a .php file no non-PHP server can execute, silently breaking the
// entire dashboard with no console error (the resulting non-JSON response
// was swallowed by error handling deep in api()). Matches the
// onSharedHost guard /assets/wallet-auth.js's hubApiUrl() already has —
// this brings profile.js's own separate implementation in line with it.
const API_BASE = (() => {
  const onSharedHost = /^(?:www\.)?winlew\.co$/i.test(window.location.hostname || "");
  const raw = window.WINLEW_API_BASE || (onSharedHost ? document.documentElement.getAttribute("data-api-base") : "") || "";
  return String(raw).replace(/\/$/, "");
})();

const ProfileStore = {
  session: "winlew.verify.session",
  app: "winlew.verify.app",
  wallet: "winlew.verify.wallet",
  verifiedAt: "winlew.verify.verifiedAt",
  draft: "winlew.profile.draft",
  cache: "winlew.profile.cache",
  editGrants: "winlew.profile.editGrants",
};

function apiUrl(path) {
  const rawPath = String(path || "");
  if (!API_BASE) return rawPath;
  const looksLikeProxy = /api-proxy\.php(?:$|\?)/.test(API_BASE);
  if (!looksLikeProxy) return `${API_BASE}${rawPath}`;

  const [pathnamePart, queryPart = ""] = rawPath.split("?");
  const cleanPath = pathnamePart.startsWith("/") ? pathnamePart : `/${pathnamePart}`;
  const url = new URL(API_BASE, window.location.origin);
  url.searchParams.set("path", cleanPath);
  const extra = new URLSearchParams(queryPart);
  for (const [key, value] of extra.entries()) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getCookie(name) {
  try {
    const key = `${encodeURIComponent(name)}=`;
    const hit = document.cookie.split("; ").find((part) => part.startsWith(key));
    return hit ? decodeURIComponent(hit.slice(key.length)) : "";
  } catch {
    return "";
  }
}

function setCookie(name, value, maxAgeSeconds = 86400) {
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax; Secure`;
  } catch {}
}

function parseSessionFromReferrer() {
  try {
    if (!document.referrer) return { session: "", app: "" };
    const ref = new URL(document.referrer);
    if (ref.origin !== window.location.origin || !ref.pathname.startsWith("/verify/")) return { session: "", app: "" };
    return {
      session: ref.searchParams.get("session") || "",
      app: ref.searchParams.get("app") || "",
    };
  } catch {
    return { session: "", app: "" };
  }
}

function getAuth() {
  const url = new URL(window.location.href);
  const ref = parseSessionFromReferrer();
  return {
    session:
      url.searchParams.get("session") ||
      localStorage.getItem(ProfileStore.session) ||
      sessionStorage.getItem(ProfileStore.session) ||
      getCookie(ProfileStore.session) ||
      ref.session ||
      "",
    app:
      url.searchParams.get("app") ||
      localStorage.getItem(ProfileStore.app) ||
      sessionStorage.getItem(ProfileStore.app) ||
      getCookie(ProfileStore.app) ||
      ref.app ||
      "mole",
    wallet:
      url.searchParams.get("wallet") ||
      localStorage.getItem(ProfileStore.wallet) ||
      sessionStorage.getItem(ProfileStore.wallet) ||
      getCookie(ProfileStore.wallet) ||
      "",
  };
}

// Set from the payload the server actually returned. Until 2026-08-05 the view
// mode was inferred from the URL alone, which was fine only because
// /api/profile/by-wallet handed out the full payload to anybody. Now that it
// releases the reduced payload unless a session proves ownership, the URL can
// say "owner view" while the response is public — so the server's own
// publicView flag has to win, or the page renders owner-only sections empty
// instead of hiding them.
let serverSaysPublicView = false;
function notePayloadViewMode(payload) {
  serverSaysPublicView = payload?.publicView === true;
}

function isPublicView() {
  if (serverSaysPublicView) return true;
  const url = new URL(window.location.href);
  const urlWallet = String(url.searchParams.get("wallet") || "").trim();
  const hasExplicitPublic = url.searchParams.get("public") === "1";
  const hasUrlSession = !!url.searchParams.get("session");
  return hasExplicitPublic || (!!urlWallet && !hasUrlSession);
}

function buildPublicProfileUrl(wallet = "") {
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return "";
  const url = new URL("/verify/profile.html", window.location.origin);
  url.searchParams.set("wallet", walletStr);
  url.searchParams.set("public", "1");
  return url.toString();
}

function setPublicProfileStatus(text = "") {
  const host = $("publicProfileStatus") || $("shareProfileStatus");
  if (host) host.textContent = text;
}

function shortWallet(value = "") {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function applyPublicViewState(payload = {}, auth = {}) {
  const publicView = isPublicView();
  document.querySelectorAll(".ownerOnly").forEach((el) => el.classList.toggle("hidden", publicView));
  const wallet = payload?.wallets?.primaryWallet || payload?.profile?.wallet || auth.wallet || "";
  const publicUrl = buildPublicProfileUrl(wallet);

  const publicBtn = $("publicProfileBtn");
  const publicInline = $("publicProfileOpenInline");
  if (publicBtn) {
    publicBtn.href = publicUrl || "#";
    publicBtn.classList.toggle("hidden", !publicUrl);
  }
  if (publicInline) {
    publicInline.href = publicUrl || "#";
    publicInline.classList.toggle("hidden", !publicUrl);
  }

  const shareBtn = $("shareProfileBtn");
  if (shareBtn) {
    shareBtn.classList.toggle("hidden", publicView || !publicUrl);
  }

  setPublicProfileStatus(
    publicUrl
      ? (publicView ? "You are viewing the shareable public profile." : "Shareable profile links stay read-only. Editing remains protected.")
      : (publicView ? "This public profile could not be resolved yet." : "A public profile link will appear after a linked wallet is available.")
  );
}

async function api(path, opts = {}) {
  // Delegate to the shared hubApiFetch when it is present (profile.html loads
  // wallet-auth.js immediately before this file). That is what attaches the
  // x-winlew-session header and carries the deploy-safety retry, so this page
  // stops being the one place that still put the session token in a URL.
  //
  // Looked up at call time rather than captured at load time so script-order
  // changes cannot silently drop us back to the raw path, and kept as a
  // fallback rather than a hard dependency because this file's own apiUrl()
  // still works standalone.
  const hubFetch = window.WinLEWAuth?.hubApiFetch;
  const r = hubFetch
    ? await hubFetch(path, { headers: { "Content-Type": "application/json" }, ...opts })
    : await fetch(apiUrl(path), {
        headers: { "Content-Type": "application/json" },
        ...opts,
      });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`);
  return json ?? {};
}

function fmt(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtTs(value) {
  const n = Number(value || 0);
  const raw = value && typeof value === "string" && !/^\d+$/.test(value) ? Date.parse(value) : n;
  const ms = Number.isFinite(raw) && raw > 0 ? (raw < 1e12 ? raw * 1000 : raw) : 0;
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function fmtIso(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return new Date(parsed).toLocaleString();
}

function saveDraft(draft) {
  localStorage.setItem(ProfileStore.draft, JSON.stringify({ version: 1, scope: profileDraftScope(), draft: draft || {} }));
}

function profileDraftScope() {
  return profileCacheScope() || JSON.stringify([getAuth().app, 'guest-draft']);
}

function loadDraft() {
  try {
    const cached = JSON.parse(localStorage.getItem(ProfileStore.draft) || "null");
    return cached?.version === 1 && cached.scope === profileDraftScope() ? cached.draft || {} : {};
  } catch {
    return {};
  }
}

function profileCacheScope() {
  const auth = getAuth();
  if (isPublicView()) return auth.wallet ? JSON.stringify([auth.app, 'public', auth.wallet]) : null;
  return auth.session ? JSON.stringify([auth.app, 'private', auth.session]) : null;
}

function saveProfileCache(payload) {
  try {
    const scope = profileCacheScope();
    if (!scope) { localStorage.removeItem(ProfileStore.cache); return; }
    localStorage.setItem(ProfileStore.cache, JSON.stringify({ version: 1, scope, payload: payload || null }));
  } catch {}
}

function loadProfileCache() {
  try {
    const scope = profileCacheScope();
    const cached = JSON.parse(localStorage.getItem(ProfileStore.cache) || "null");
    return scope && cached?.version === 1 && cached.scope === scope ? cached.payload : null;
  } catch {
    return null;
  }
}

function persistWalletSnapshot(wallet) {
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return;
  try {
    localStorage.setItem(ProfileStore.wallet, walletStr);
    sessionStorage.setItem(ProfileStore.wallet, walletStr);
    setCookie(ProfileStore.wallet, walletStr, 86400);
  } catch {}
}

function loadEditGrants() {
  try {
    return JSON.parse(localStorage.getItem(ProfileStore.editGrants) || "{}");
  } catch {
    return {};
  }
}

function saveEditGrants(map) {
  try {
    localStorage.setItem(ProfileStore.editGrants, JSON.stringify(map || {}));
  } catch {}
}

function getEditGrant(wallet) {
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return null;
  const map = loadEditGrants();
  const row = map[walletStr];
  const now = Math.floor(Date.now() / 1000);
  if (!row || !row.token || Number(row.expires_at || 0) <= now) {
    if (row) {
      delete map[walletStr];
      saveEditGrants(map);
    }
    return null;
  }
  return row;
}

function storeEditGrant(wallet, token, expiresAt) {
  const walletStr = String(wallet || "").trim();
  if (!walletStr || !token) return;
  const map = loadEditGrants();
  map[walletStr] = {
    token: String(token),
    expires_at: Number(expiresAt || 0),
    stored_at: Math.floor(Date.now() / 1000),
  };
  saveEditGrants(map);
}

function clearEditGrant(wallet) {
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return;
  const map = loadEditGrants();
  if (map[walletStr]) {
    delete map[walletStr];
    saveEditGrants(map);
  }
}

function fmtGrantExpiry(expiresAt) {
  const ts = Number(expiresAt || 0);
  if (!ts) return "until it expires";
  return fmtTs(ts);
}


function setEditStatus(message) {
  const el = $("profileEditStatus");
  if (el) el.textContent = message;
}

// Provider detection lives in /assets/wallet-auth.js now (loaded before this
// file) — this used to be its own copy checking only Phantom/Solflare, with
// no GeoWallet support and no mobile deep-link fallback. Reusing the shared
// connectHubWalletProvider() here means profile-edit re-authorization gets
// the same wallet coverage as every other app for free.
const { connectHubWalletProvider, logout: sharedLogout, walletLogin: sharedWalletLogin, setConnectedUi, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function providerLabel(provider) {
  if (!provider) return "wallet";
  if (provider.isGeoWallet) return "Oxyon Wallet";
  if (provider.isPhantom) return "Phantom";
  if (provider.isSolflare) return "Solflare";
  return "wallet";
}

async function connectForSigning(expectedWallet) {
  const connected = await connectHubWalletProvider();
  if (!connected) throw new Error("No supported Solana wallet with message signing was detected on this device.");
  const { provider, wallet: actualWallet } = connected;
  const expected = String(expectedWallet || "").trim();
  if (!actualWallet) throw new Error("Wallet connection failed.");
  if (expected && actualWallet !== expected) {
    throw new Error(`Connected ${providerLabel(provider)} wallet does not match the linked wallet on this profile.`);
  }
  return provider;
}

async function signUtf8Message(provider, message) {
  const bytes = new TextEncoder().encode(String(message || ""));
  let signed;
  try {
    signed = await provider.signMessage(bytes, "utf8");
  } catch {
    signed = await provider.signMessage(bytes);
  }
  const raw = signed?.signature || signed;
  if (raw instanceof Uint8Array) return Array.from(raw);
  if (Array.isArray(raw)) return raw;
  if (raw?.data && Array.isArray(raw.data)) return raw.data;
  throw new Error("Wallet returned an unreadable signature.");
}

/**
 * Synced-account chips under the profile name.
 *
 * The SERVER decides who is visible — it sends `identities: []` for anyone who
 * has not opted in, so this renders nothing for them without needing to know
 * the rule. That is the point of having one gate: the page cannot accidentally
 * out somebody by getting a condition wrong, because it never sees the data.
 */
function renderProfileIdentities(payload = {}) {
  const host = $("profileIdentities");
  if (!host) return;
  const list = Array.isArray(payload.identities) ? payload.identities : [];
  if (!list.length) { host.innerHTML = ""; return; }

  const LABEL = { discord: "Discord", x: "X" };
  host.innerHTML = list
    .map((entry) => {
      const provider = String(entry.provider || "").toLowerCase();
      const label = LABEL[provider] || provider;
      const handle = `@${esc(entry.handle || "")}`;
      const cls = `idChip ${esc(provider)}`;
      // A Discord handle is not a URL you can visit, so it stays plain text.
      // Only render a link where the server actually supplied one.
      return entry.url
        ? `<a class="${cls}" href="${esc(entry.url)}" target="_blank" rel="noreferrer noopener" title="${esc(label)}">${esc(label)} ${handle} ↗</a>`
        : `<span class="${cls}" title="${esc(label)}">${esc(label)} ${handle}</span>`;
    })
    .join("");
}

function renderProfileMeta(profile = {}, holdings = {}, auth = getAuth()) {
  const host = $("profileMeta");
  if (!host) return;
  const parts = [];
  if (profile.username) parts.push(`<span class="metaChip">@${esc(profile.username)}</span>`);
  if (profile.discordUserId) parts.push(`<span class="metaChip">Discord ${esc(profile.discordUserId)}</span>`);
  const verificationSource = profile.discordUserId || auth.session
    ? "✅ Discord verified"
    : (auth.wallet ? "✕ Wallet-only" : "✕ Not verified");
  parts.push(`<span class="metaChip">${esc(verificationSource)}</span>`);
  if (holdings?.roles?.length) parts.push(`<span class="metaChip">${esc(holdings.roles.join(" • "))}</span>`);
  host.innerHTML = parts.join("");
}

// Wallet nicknames are purely local (this device only, no server round-trip)
// — the point is helping a multi-wallet holder recognize their own wallets
// at a glance in the list below, not a synced/shared identity field. Keyed
// by address so it survives re-renders and works across every account this
// browser has ever viewed (owner-only section anyway).
const WALLET_NICKNAME_KEY = "winlew.walletNicknames";
function loadWalletNicknames() {
  try { return JSON.parse(localStorage.getItem(WALLET_NICKNAME_KEY) || "{}"); } catch { return {}; }
}
function saveWalletNickname(address, nickname) {
  try {
    const map = loadWalletNicknames();
    const trimmed = String(nickname || "").trim().slice(0, 40);
    if (trimmed) map[address] = trimmed; else delete map[address];
    localStorage.setItem(WALLET_NICKNAME_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Which of this person's wallets receives money — and let them move it.
 *
 * THE MODEL THIS RENDERS: user > account(s) > wallets, one payout. Every
 * verified wallet is listed; exactly one is selected. Choosing another does not
 * unlink anything, and the server refuses any address this account has not
 * verified, so the worst a stray click can do is move the money to another
 * wallet the same person already proved they hold.
 *
 * Silent when the endpoint is unavailable — an old backend answers 404 here,
 * and a broken panel is worse than no panel (same rule as the identities card).
 */
async function renderPayoutWallet() {
  const host = $("payoutWallet");
  if (!host) return;
  const section = document.getElementById("detailsPayoutWallet")?.closest(".subsection");
  let data;
  try {
    data = await api("/api/wallet/payout");
  } catch (error) {
    console.warn("[profile] payout wallet unavailable:", error);
    if (section) section.style.display = "none";
    return;
  }

  const rows = Array.isArray(data.wallets) ? data.wallets : [];
  if (!rows.length) {
    host.innerHTML = '<div class="muted">No verified wallet yet. Verify one and it will appear here.</div>';
    return;
  }

  const nicknames = loadWalletNicknames();
  const current = String(data.payoutWallet || "");
  host.innerHTML = rows.map((row) => {
    const selected = row.wallet === current;
    const nickname = nicknames[row.wallet] || "";
    return `
    <label class="walletCard" style="display:block;cursor:pointer;${selected ? "outline:2px solid var(--accent, #6cf);" : ""}">
      <div class="label">
        <input type="radio" name="payoutWalletChoice" value="${esc(row.wallet)}" ${selected ? "checked" : ""} />
        ${selected ? "💰 Gets paid" : "Link only"}${nickname ? ` • <strong>${esc(nickname)}</strong>` : ""}
      </div>
      <div class="walletAddr" title="${esc(row.wallet)}">${esc(row.wallet)}</div>
      <div class="muted" style="margin-top:8px;">Verified ${esc(fmtTs(row.verified_at))} • expires ${esc(fmtTs(row.expires_at))}</div>
    </label>
  `;
  }).join("") + '<div id="payoutWalletMsg" class="muted" style="margin-top:10px;"></div>';

  const msg = $("payoutWalletMsg");
  host.querySelectorAll('input[name="payoutWalletChoice"]').forEach((input) => {
    input.addEventListener("change", async () => {
      const wallet = input.value;
      if (!wallet || wallet === current) return;
      if (msg) msg.textContent = "Saving…";
      try {
        await api("/api/wallet/payout", { method: "POST", body: JSON.stringify({ wallet }) });
        await renderPayoutWallet();
        const after = $("payoutWalletMsg");
        if (after) after.textContent = "✅ Payouts now go to this wallet.";
      } catch (error) {
        if (msg) msg.textContent = `⚠️ Could not change it: ${String(error?.message || error)}`;
        // Put the radio back where the server still has it, so the page never
        // shows a choice that was not actually saved.
        await renderPayoutWallet();
      }
    });
  });
}

function renderWallets(wallets = {}) {
  const host = $("knownWallets");
  if (!host) return;
  const rows = Array.isArray(wallets.knownWallets) ? wallets.knownWallets : [];
  if (!rows.length) {
    host.innerHTML = '<div class="muted">No linked wallets were found yet.</div>';
    return;
  }
  const nicknames = loadWalletNicknames();
  host.innerHTML = rows.map((row) => {
    const nickname = nicknames[row.address] || "";
    return `
    <div class="walletCard">
      <div class="label">${esc(String(row.kind || "wallet").replace(/_/g, " "))}${nickname ? ` • <strong>${esc(nickname)}</strong>` : ""}</div>
      <div class="walletAddr" title="${esc(row.address)}">${row.snsName ? `${esc(row.snsName)} (${esc(row.address)})` : esc(row.address)}</div>
      <div class="muted" style="margin-top:8px;">Source: ${esc(row.source || "linked")} ${row.updatedAt ? `• updated ${esc(fmtIso(row.updatedAt))}` : ""}</div>
      <div class="muted" style="margin-top:4px;">${row.verified
        ? "✅ Verification is current — this wallet counts toward your balance and can be chosen for payouts."
        : "⏳ Verification has lapsed. It is still linked to you; sign with it again to bring it back into your balance."}</div>
      <div class="field" style="margin-top:10px;max-width:280px;">
        <input class="walletNicknameInput" type="text" maxlength="40" placeholder="Add a nickname (this device only)" value="${esc(nickname)}" data-wallet-address="${esc(row.address)}" />
      </div>
      <div class="actions">
        <button class="btn ghost walletNicknameSaveBtn" type="button" data-wallet-address="${esc(row.address)}">💾 Save nickname</button>
      </div>
    </div>
  `;
  }).join("");

  const commit = (address) => {
    const input = host.querySelector(`.walletNicknameInput[data-wallet-address="${CSS.escape(address)}"]`);
    saveWalletNickname(address, input?.value || "");
    // The nickname is shown on the payout card too, so both lists re-render.
    renderWallets(wallets);
    void renderPayoutWallet();
  };
  host.querySelectorAll(".walletNicknameSaveBtn").forEach((btn) => {
    btn.addEventListener("click", () => commit(btn.getAttribute("data-wallet-address")));
  });
  host.querySelectorAll(".walletNicknameInput").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commit(input.getAttribute("data-wallet-address"));
    });
  });
}

function renderRoles(holdings = {}, discord = {}) {
  const host = $("rolesList");
  if (!host) return;
  const roles = Array.isArray(discord.displayRoles) && discord.displayRoles.length
    ? discord.displayRoles
    : (Array.isArray(holdings.roles) ? holdings.roles : []);
  if (!roles.length) {
    host.innerHTML = '<span class="muted">No linked roles yet.</span>';
  } else {
    host.innerHTML = roles.map((role) => `<span class="pillTag">${esc(role)}</span>`).join("");
  }
  const meta = $("holdingsMeta");
  if (meta) {
    if (holdings.balance === null || holdings.balance === undefined) {
      meta.textContent = holdings.error
        ? `Connected wallet LEW could not be refreshed right now (${holdings.error}).`
        : "Connected wallet LEW is unavailable right now.";
    } else {
      // The connected wallet is still named, because it is the one that
      // signs and the one that gets paid. It is just no longer presented as
      // if it were everything the person holds.
      const across = identityHoldingsLine(holdings);
      meta.textContent = `Connected wallet snapshot: ${fmt(holdings.balance)} WinLEW on ${holdings.wallet || "linked wallet"}.${across}`;
    }
  }
}

/**
 * The across-all-wallets sentence, or "" when there is nothing extra to say.
 *
 * A PARTIAL read is labelled "at least", never rounded up to a clean total —
 * one wallet's balance failed to load, so the real figure is higher than this
 * and saying so plainly beats showing a number that is quietly wrong.
 */
function identityHoldingsLine(holdings = {}) {
  const identity = holdings.identity;
  if (!identity || identity.total === null || identity.total === undefined) return "";
  const walletCount = Array.isArray(identity.wallets) ? identity.wallets.length : 0;
  if (walletCount <= 1) return "";
  if (identity.partial) {
    return ` Across your ${walletCount} verified wallets: at least ${fmt(identity.total)} WinLEW (${identity.unreadable} could not be read just now).`;
  }
  return ` Across your ${walletCount} verified wallets: ${fmt(identity.total)} WinLEW.`;
}

/** The headline balance: what the PERSON holds when that is known and larger,
 *  falling back to the connected wallet. Returns null when neither is known —
 *  the caller renders "—", because a zero here would read as a fact. */
function headlineBalance(holdings = {}) {
  const single = holdings.balance;
  const total = holdings.identity?.total;
  const haveSingle = single !== null && single !== undefined;
  const haveTotal = total !== null && total !== undefined;
  if (haveTotal && (!haveSingle || Number(total) > Number(single))) return Number(total);
  return haveSingle ? Number(single) : null;
}

function renderFaucet(faucet = {}) {
  const host = $("faucetStatus");
  if (!host) return;
  const rows = [
    ["Linked faucet wallet", faucet.linkedWallet || "—"],
    ["Registered for airdrops", faucet.registeredForAirdrops ? "Yes" : "No"],
    ["Confirmed claims", faucet.historyOk ? fmt(faucet.confirmedClaims || 0) : "Unavailable right now"],
    ["Total distributed", faucet.historyOk ? `${fmt(faucet.totalConfirmedAmount || 0)} WinLEW` : "Unavailable right now"],
    ["Most recent successful claim", faucet.lastClaimAtUser ? fmtIso(faucet.lastClaimAtUser) : "—"],
    ["Cooldown", faucet.cooldownStatusOk === false
      ? "Unavailable right now"
      : (faucet.cooldownReady ? "Ready now" : `${Math.ceil(Number(faucet.readyInMs || 0) / 60000)} min remaining`)],
  ];
  host.innerHTML = rows.map(([k, v]) => `
    <div class="kv"><div class="muted">${esc(k)}</div><div>${esc(String(v))}</div></div>
  `).join("");
}

function renderQuizCurrentCycle(quiz = {}) {
  const host = $("quizCurrentCycle");
  if (!host) return;
  const cycle = quiz.currentCycle || {};
  host.innerHTML = `
    <div class="kv"><div class="muted">Cycle</div><div>${esc(cycle.id || "—")}</div></div>
    <div class="kv"><div class="muted">Window</div><div>${esc(cycle.startAt ? `${fmtIso(cycle.startAt)} → ${fmtIso(cycle.endAt)}` : "—")}</div></div>
    <div class="kv"><div class="muted">Current cycle quiz points</div><div>${fmt(cycle.points || 0)}</div></div>
    <div class="kv"><div class="muted">Redeemable cycle points</div><div>${fmt(cycle.unpaidPoints || 0)}</div></div>
    <div class="kv"><div class="muted">Estimated cycle payout</div><div>${fmt(cycle.estimatedPayout || 0)} WinLEW</div></div>
  `;
}

function renderQuizOverview(quiz = {}) {
  const host = $("quizOverview");
  if (!host) return;
  // accuracy is null (not 0) when nothing has been tracked since the
  // per-platform accuracy feature shipped — an honest "not enough tracked
  // data" state instead of a fabricated 0%. See docs/unified-dashboard.md.
  const accuracyText = quiz.accuracy === null || quiz.accuracy === undefined
    ? `Not enough tracked data yet${quiz.trackedAnswers ? "" : " (0 tracked answers)"}`
    : `${(quiz.accuracy * 100).toFixed(1)}% (${fmt(quiz.trackedCorrect || 0)}/${fmt(quiz.trackedAnswers || 0)} tracked)`;
  const rankText = quiz.rank ? `#${fmt(quiz.rank.rank)} of ${fmt(quiz.rank.totalRankedPlayers)}` : "Not yet ranked";
  host.innerHTML = `
    <div class="kv"><div class="muted">Lifetime points</div><div>${fmt(quiz.lifetimePoints || 0)}</div></div>
    <div class="kv"><div class="muted">Redeemable points</div><div>${fmt(quiz.unpaidPoints || 0)}</div></div>
    <div class="kv"><div class="muted">Redeemed points</div><div>${fmt(quiz.redeemedPoints || 0)}</div></div>
    <div class="kv"><div class="muted">Total quizzes won</div><div>${fmt(quiz.questionWins || 0)}</div></div>
    <div class="kv"><div class="muted">Regular wins</div><div>${fmt(quiz.regularQuestionWins || 0)}</div></div>
    <div class="kv"><div class="muted">Sponsor wins</div><div>${fmt(quiz.sponsorQuestionWins || 0)}</div></div>
    <div class="kv"><div class="muted">Cycles played</div><div>${fmt(quiz.cyclesPlayed || 0)}</div></div>
    <div class="kv"><div class="muted">Questions this cycle</div><div>${fmt(quiz.questionsThisCycle || 0)}</div></div>
    <div class="kv"><div class="muted">Accuracy (tracked answers)</div><div>${esc(accuracyText)}</div></div>
    <div class="kv"><div class="muted">Current streak</div><div>${fmt(quiz.currentStreak || 0)}</div></div>
    <div class="kv"><div class="muted">Best streak</div><div>${fmt(quiz.bestStreak || 0)}</div></div>
    <div class="kv"><div class="muted">Leaderboard rank</div><div>${esc(rankText)}</div></div>
  `;
}

function renderQuizPayouts(quiz = {}) {
  const host = $("quizPayouts");
  if (!host) return;
  const payouts = quiz.payouts || {};
  host.innerHTML = `
    <div class="kv"><div class="muted">Pending</div><div>${fmt(payouts.pending || 0)}</div></div>
    <div class="kv"><div class="muted">Paid</div><div>${fmt(payouts.paid || 0)}</div></div>
    <div class="kv"><div class="muted">Failed</div><div>${fmt(payouts.failed || 0)}</div></div>
    <div class="kv"><div class="muted">Rejected</div><div>${fmt(payouts.rejected || 0)}</div></div>
    <div class="kv"><div class="muted">Total WinLEW sent</div><div>${fmt(payouts.totalWinlewSent || 0)}</div></div>
    <div class="kv"><div class="muted">Leaderboard eligible points</div><div>${fmt(payouts.eligibleLeaderboardPoints || 0)}</div></div>
    <div class="kv"><div class="muted">Estimated leaderboard payout</div><div>${fmt(payouts.estimatedLeaderboardPayout || 0)} WinLEW</div></div>
  `;
}

function renderQuizRecent(quiz = {}) {
  const host = $("quizRecent");
  if (!host) return;
  const rows = Array.isArray(quiz?.payouts?.recent) ? quiz.payouts.recent : [];
  if (!rows.length) {
    host.innerHTML = '<div class="muted">No quiz payout or redeem history yet.</div>';
    return;
  }
  host.innerHTML = rows.map((row) => `
    <div class="row">
      <div>
        <div><strong>${esc(row.kind || "redeem")}</strong></div>
        <div class="muted" style="margin-top:4px;">${fmtTs(row.paidTs || row.ts || row.rejectedTs || row.lastAttemptTs)}</div>
      </div>
      <div style="text-align:right;">
        <div class="badge">${esc(row.status || "pending")}</div>
        <div style="margin-top:8px;font-weight:900;">${fmt(row.winlewSent || row.winlewDue || row.amount || 0)} ${row.winlewSent || row.winlewDue ? "WinLEW" : "pts"}</div>
      </div>
    </div>
  `).join("");
}

const GOVERNANCE_ELIGIBILITY_LABELS = {
  eligible: "Eligible to vote",
  below_minimum_balance: "Not eligible — below the minimum WinLEW balance",
  wallet_not_verified: "Not eligible — verify a wallet first",
};

const CONTRIBUTION_CAUSE_LABELS = { dev: "Dev", faucet: "Faucet", xFaucet: "X Faucet", burn: "Burn" };

function renderContributions(summary = {}) {
  const host = $("contributionsSummary");
  if (!host) return;
  if (summary.ok === false) {
    host.innerHTML = '<div class="muted">⚠️ Could not load your contributions right now.</div>';
    return;
  }
  if (!summary.total) {
    host.innerHTML = `<div class="muted">No contributions yet — <a href="/contribute/">give to Dev, Faucet, X Faucet, or Burn</a> to earn Clout.</div>`;
    return;
  }
  const byCause = summary.byCause || {};
  const rows = Object.keys(CONTRIBUTION_CAUSE_LABELS)
    .filter((c) => Number(byCause[c] || 0) > 0)
    .map((c) => `<div class="kv"><div class="muted">${esc(CONTRIBUTION_CAUSE_LABELS[c])}</div><div>${fmt(byCause[c])} WinLEW</div></div>`)
    .join("");
  host.innerHTML = `
    <div class="kv"><div class="muted">Total contributed</div><div>${fmt(summary.total)} WinLEW</div></div>
    <div class="kv"><div class="muted">Clout rank</div><div>${summary.rank ? `#${fmt(summary.rank)} of ${fmt(summary.totalContributors)}` : "—"}</div></div>
    ${rows}
    <div style="margin-top:10px;"><a class="btn" href="/contribute/">Contribute more →</a></div>
  `;
}

async function loadContributions() {
  const auth = getAuth();
  if (!auth.session) return;
  try {
    const summary = await api('/api/contribute/mine');
    renderContributions(summary);
  } catch (e) {
    console.warn("[profile] contributions load failed:", e);
    renderContributions({ ok: false });
  }
}

function renderGovernanceSummary(governance = {}) {
  const host = $("governanceSummary");
  if (!host) return;
  if (governance.ok === false) {
    host.innerHTML = '<div class="muted">⚠️ Governance summary temporarily unavailable.</div>';
    return;
  }
  const eligibilityText = governance.eligible === null
    ? "Eligibility temporarily unavailable"
    : (GOVERNANCE_ELIGIBILITY_LABELS[governance.eligibilityReason] || (governance.eligible ? "Eligible to vote" : "Not eligible"));

  const active = Array.isArray(governance.votableProposals) ? governance.votableProposals : [];
  const closingSoon = Array.isArray(governance.closingSoon) ? governance.closingSoon : [];

  host.innerHTML = `
    <div class="kv"><div class="muted">Your eligibility</div><div>${esc(eligibilityText)}</div></div>
    <div class="kv"><div class="muted">Active proposals</div><div>${fmt(governance.activeCount || 0)}</div></div>
    ${active.length ? `<div style="margin-top:10px;">${active.slice(0, 5).map((p) => `<div class="row"><div><a href="/governance/proposal/?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></div></div>`).join("")}</div>` : '<div class="muted" style="margin-top:8px;">Nothing open for a vote right now.</div>'}
    ${closingSoon.length ? `<div class="muted" style="margin-top:10px;font-size:12px;">Closing soon: ${closingSoon.map((p) => esc(p.title)).join(", ")}</div>` : ""}
  `;
}

function renderGovernanceMyVotes(governance = {}) {
  const host = $("governanceMyVotes");
  if (!host) return;
  if (governance.ok === false) {
    host.innerHTML = '<div class="muted">⚠️ Temporarily unavailable.</div>';
    return;
  }
  const votes = Array.isArray(governance.myVotes) ? governance.myVotes : [];
  if (!votes.length) {
    host.innerHTML = '<div class="muted">You haven\'t voted on anything yet.</div>';
    return;
  }
  host.innerHTML = votes.map((v) => `
    <div class="row">
      <div><a href="/governance/proposal/?id=${encodeURIComponent(v.proposalId)}">${esc(v.title)}</a></div>
      <div style="text-align:right;"><div class="badge">${esc(v.choice)}</div><div class="muted" style="margin-top:4px;font-size:11px;">${fmtTs(v.updatedAtIso)}</div></div>
    </div>
  `).join("");
}

function renderGameHistory(rows = []) {
  const host = $("historyList");
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = '<div class="muted">No game reward history yet. Play DigLEW or Pac-Mole from the Gaming Hub to start earning in-app rewards.</div>';
    return;
  }
  host.innerHTML = rows.map((row) => `
    <div class="row">
      <div>
        <div><strong>${esc(row.roundLabel || row.game)}</strong></div>
        <div class="muted" style="margin-top:4px;">${fmtIso(row.claimedAt)}</div>
      </div>
      <div style="text-align:right;">
        <div class="badge">${row.paid === true ? 'Paid' : 'Pending'} · ${esc(row.game)}</div>
        <div style="margin-top:8px;font-weight:900;">${fmt(row.payout)} WinLEW</div>
        <div class="muted" style="margin-top:4px;">${fmt(row.baseReward)} × ${row.multiplier}x</div>
        ${row.paidTx ? `<div class="muted" style="margin-top:4px;">Tx ${esc(String(row.paidTx).slice(0, 8))}…</div>` : ''}
      </div>
    </div>
  `).join("");
}

function renderGameSummary(summary = {}) {
  const host = $("gameSummary");
  if (!host) return;
  const rows = Array.isArray(summary.byGame) ? summary.byGame : [];
  $("topGame").textContent = rows.length ? rows[0].game : "—";
  if (!rows.length) {
    host.innerHTML = '<div class="muted">No per-game reward data yet.</div>';
    return;
  }
  host.innerHTML = rows.map((row) => `
    <div class="row">
      <div>
        <div><strong>${esc(row.game)}</strong></div>
        <div class="muted" style="margin-top:4px;">${fmt(row.claims)} claim${Number(row.claims) === 1 ? "" : "s"}</div>
      </div>
      <div style="text-align:right;font-weight:900;">${fmt(row.payout)} WinLEW</div>
    </div>
  `).join("");
}


const POV_COMPONENT_LABELS = {
  quiz: "Quiz",
  faucet: "Faucet",
  games: "Games",
  verification: "Wallet verification",
};

// Per-component accent for the inline sub-score bars — matches the stat-tile
// colour language (quiz purple, faucet teal, games blue, verification green).
const POV_COMPONENT_COLORS = {
  quiz: "#c9a2ff",
  faucet: "#4fd6c0",
  games: "#6aa8ff",
  verification: "#55f0a5",
};

// Mirrors the tier floors in src/mole/proofOfValue.js (TIERS, v2.4). Used only
// to draw the informational within-tier progress gauge on the PoV tile — the
// authoritative score/tier always come from the server payload.
const POV_TIER_FLOORS = [
  { min: 90, label: "Legend" },
  { min: 70, label: "Pillar" },
  { min: 45, label: "Contributor" },
  { min: 20, label: "Participant" },
  { min: 0, label: "Newcomer" },
];

function renderPovGauge(pov = {}) {
  const fill = $("povGaugeFill");
  const label = $("povGaugeLabel");
  if (!fill || !label) return;
  if (pov.ok === false) { fill.style.width = "0%"; label.textContent = ""; return; }
  const score = Math.max(0, Math.min(100, Number(pov.score || 0)));
  const asc = [...POV_TIER_FLOORS].sort((a, b) => a.min - b.min);
  const next = asc.find((t) => t.min > score);
  const currentFloor = [...asc].reverse().find((t) => t.min <= score) || asc[0];
  const pct = next ? ((score - currentFloor.min) / (next.min - currentFloor.min)) * 100 : 100;
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  label.textContent = next
    ? `${Math.max(0, next.min - score)} to ${next.label}`
    : "Top tier reached 🏆";
}

function renderProofOfValue(pov = {}) {
  const scoreEl = $("povScore");
  const tierEl = $("povTier");
  const breakdownHost = $("povBreakdown");
  const weightsHost = $("povWeights");

  renderPovGauge(pov);

  if (pov.ok === false) {
    if (scoreEl) scoreEl.textContent = "—";
    if (tierEl) tierEl.textContent = "Unavailable right now";
    if (breakdownHost) breakdownHost.innerHTML = `<div class="muted">Proof of Value could not be calculated right now (${esc(pov.error || "unknown error")}). Try refreshing.</div>`;
    if (weightsHost) weightsHost.innerHTML = "";
    return;
  }

  if (scoreEl) scoreEl.textContent = fmt(pov.score ?? 0);
  if (tierEl) tierEl.textContent = pov.tier || "—";

  const breakdown = pov.breakdown || {};
  if (breakdownHost) {
    const rows = Object.keys(POV_COMPONENT_LABELS).map((key) => {
      const part = breakdown[key] || {};
      const sub = Math.max(0, Math.min(100, Math.round(part.subScore || 0)));
      const color = POV_COMPONENT_COLORS[key] || "var(--brand)";
      return `
        <div class="povRow">
          <div class="povRowTop">
            <span class="muted">${esc(POV_COMPONENT_LABELS[key])}</span>
            <span class="povRowVal">${fmt(sub)} / 100</span>
          </div>
          <div class="povBar"><div class="povBarFill" style="width:${sub}%;background:${color};"></div></div>
        </div>
      `;
    }).join("");
    const streakNote = pov.streakMultiplier && pov.streakMultiplier > 1
      ? `<div class="help" style="margin-top:10px;">Streak bonus: ×${esc(String(pov.streakMultiplier))} from your current quiz answer streak.</div>`
      : "";
    breakdownHost.innerHTML = rows + streakNote;
  }

  if (weightsHost) {
    const weights = pov.weights || {};
    weightsHost.innerHTML = Object.keys(POV_COMPONENT_LABELS).map((key) => {
      const pct = Math.max(0, Math.min(100, Math.round((weights[key] || 0) * 100)));
      const color = POV_COMPONENT_COLORS[key] || "var(--brand)";
      return `
        <div class="povRow">
          <div class="povRowTop">
            <span class="muted">${esc(POV_COMPONENT_LABELS[key])}</span>
            <span class="povRowVal">${pct}%</span>
          </div>
          <div class="povBar"><div class="povBarFill" style="width:${pct}%;background:${color};"></div></div>
        </div>
      `;
    }).join("");
  }
}

// Milestones are derived server-side (src/mole/milestones.js) — this just
// renders whatever `items` the payload contains. No scoring/thresholds are
// reimplemented here.
function renderMilestones(milestones = {}) {
  const host = $("milestonesList");
  if (!host) return;
  if (milestones.ok === false) {
    host.innerHTML = '<div class="muted">Milestones could not be calculated right now. Try refreshing.</div>';
    return;
  }
  const items = Array.isArray(milestones.items) ? milestones.items : [];
  if (!items.length) {
    host.innerHTML = '<div class="muted">No milestones available yet.</div>';
    return;
  }
  // "contribution" (a real, verified on-chain contribution to Dev/Faucet/
  // Burn — see src/mole/contributions.js) always sorts first and renders
  // purple, standing apart from the green participation milestones below it.
  const sorted = [...items].sort((a, b) => (b.variant === "contribution") - (a.variant === "contribution"));
  host.innerHTML = sorted.map((m) => {
    const isContribution = m.variant === "contribution";
    // Contribution = purple; other earned milestones = gold "unlocked"; not-yet
    // earned = plain + dimmed so the earned ones clearly stand out.
    const cls = isContribution
      ? "pillTag pillTagContribution"
      : (m.achieved ? "pillTag pillTagAchieved" : "pillTag");
    return `<span class="${cls}" style="opacity:${m.achieved ? 1 : 0.45};">${m.achieved ? (isContribution ? "💜" : "✅") : "⬜"} ${esc(m.label)}</span>`;
  }).join("");
}

// Recent activity is a best-effort merge of existing records (faucet
// claims, game rewards, quiz redemptions) built server-side
// (src/mole/dashboardActivity.js) — not a full unified event log. See
// docs/unified-dashboard.md.
const ACTIVITY_ICONS = {
  faucet_claim: "🚰",
  game_reward: "🎮",
  quiz_redemption: "🧠",
};

function renderRecentActivity(recentActivity = {}) {
  const host = $("recentActivityList");
  if (!host) return;
  if (recentActivity.ok === false) {
    host.innerHTML = '<div class="muted">Recent activity could not be loaded right now. Try refreshing.</div>';
    return;
  }
  const items = Array.isArray(recentActivity.items) ? recentActivity.items : [];
  if (!items.length) {
    host.innerHTML = '<div class="muted">No recent activity yet. Play the quiz, claim the faucet, or earn a game reward to see it here.</div>';
    return;
  }
  host.innerHTML = items.map((item) => `
    <div class="row">
      <div>${ACTIVITY_ICONS[item.type] || "•"} ${esc(item.label)}</div>
      <div class="muted">${fmtTs(item.at)}</div>
    </div>
  `).join("");
}

// Version 2.3 — all numbers here are read straight from the payload's
// `participation` block, which is itself built from data already shown
// elsewhere on the dashboard (Proof of Value, milestones, faucet/game
// history). No new scoring happens in this file.
function renderKeepGoing(participation = {}) {
  const host = $("keepGoingList");
  if (!host) return;
  if (participation.ok === false) {
    host.innerHTML = '<div class="muted">This could not be loaded right now. Try refreshing.</div>';
    return;
  }

  const rows = [];

  const quizStreak = Number(participation.quizCurrentStreak || 0);
  rows.push(["Current quiz answer streak", quizStreak > 0 ? `${fmt(quizStreak)} correct in a row` : "No active streak — answer a question to start one"]);

  if (participation.faucetDataOk === false) {
    rows.push(["Faucet claim streak", "Unavailable right now"]);
  } else {
    const streak = participation.faucetStreak || {};
    const days = Number(streak.currentStreakDays || 0);
    const streakText = days > 0 ? `${fmt(days)} day${days === 1 ? "" : "s"} in a row` : "No active streak";
    rows.push(["Faucet claim streak", streak.claimedToday ? `${streakText} (claimed today)` : streakText]);
  }

  const tierProgress = participation.povTierProgress;
  if (tierProgress) {
    rows.push(["Proof of Value", tierProgress.nextTier
      ? `${fmt(tierProgress.pointsToNextTier)} points to ${esc(tierProgress.nextTier)} tier`
      : `You've reached the top tier (${esc(tierProgress.tier)})`]);
  }

  const next = participation.nextMilestone;
  rows.push(["Closest milestone", next
    ? `${esc(next.label)} — ${Math.round(Number(next.progress || 0) * 100)}% there`
    : "No partially-completed milestone right now"]);

  host.innerHTML = rows.map(([k, v]) => `
    <div class="kv"><div class="muted">${esc(k)}</div><div>${v}</div></div>
  `).join("");
}

function renderWeeklySummary(participation = {}) {
  const host = $("weeklySummaryList");
  if (!host) return;
  if (participation.ok === false) {
    host.innerHTML = '<div class="muted">This could not be loaded right now. Try refreshing.</div>';
    return;
  }
  const summary = participation.weeklySummary || {};
  const rows = [
    ["Faucet claims", participation.faucetDataOk === false ? "Unavailable right now" : fmt(summary.faucetClaimCount || 0)],
    ["WinLEW claimed", participation.faucetDataOk === false ? "Unavailable right now" : `${fmt(summary.faucetAmount || 0)} WinLEW`],
    ["Game rewards", fmt(summary.gameClaimCount || 0)],
    ["Game WinLEW earned", `${fmt(summary.gamePayout || 0)} WinLEW`],
  ];
  host.innerHTML = rows.map(([k, v]) => `
    <div class="kv"><div class="muted">${esc(k)}</div><div>${v}</div></div>
  `).join("");
}

function renderGeoAgora(geoAgora = {}) {
  const publicView = isPublicView();
  const heroBtn = $("geoAgoraHeroBtn");
  const profileBtn = $("geoAgoraProfileBtn");
  const status = $("geoAgoraStatus");
  const xl1 = $("geoAgoraXl1");
  const footprint = $("geoAgoraFootprint");
  const meta = $("geoAgoraMeta");

  const available = !!geoAgora?.available && !!geoAgora?.publicUrl;
  const ownerUrl = geoAgora?.ownerUrl || "/geoagora/profile";
  const publicUrl = geoAgora?.publicUrl || "";
  const routeTarget = geoAgora?.target || geoAgora?.xl1Wallet || "";
  const routeWallets = geoAgora?.wallets || {};

  if (heroBtn) {
    if (publicView) {
      heroBtn.classList.toggle("hidden", !available);
      heroBtn.href = publicUrl || "#";
      heroBtn.textContent = "🛰 Open GeoAgora";
    } else {
      heroBtn.classList.remove("hidden");
      heroBtn.href = ownerUrl;
      heroBtn.textContent = "🛰 Open GeoAgora";
    }
  }
  if (profileBtn) {
    if (publicView) {
      profileBtn.classList.toggle("hidden", !available);
      profileBtn.href = publicUrl || "#";
    } else {
      profileBtn.classList.toggle("hidden", !ownerUrl);
      profileBtn.href = ownerUrl || "#";
      profileBtn.textContent = "🛰 Open GeoAgora profile";
    }
  }
  if (status) {
    status.textContent = available
      ? (publicView
        ? "GeoAgora detected a linked identity for this member."
        : "GeoAgora detected a linked identity for this member. Open GeoAgora profile to manage linked wallets and names.")
      : "No linked GeoAgora identity has been detected yet.";
  }
  if (xl1) {
    const text = geoAgora?.xl1Wallet || "—";
    xl1.textContent = text;
    xl1.title = text;
  }
  if (footprint) {
    footprint.textContent = available
      ? `${fmt(geoAgora.collectionCount || 0)} colls • ${fmt(geoAgora.assetCount || 0)} assets`
      : "Not linked";
  }
  if (meta) {
    if (available) {
      const parts = [
        geoAgora?.linkedName ? `Name: ${geoAgora.linkedName}` : "",
        routeTarget ? `Route: ${shortWallet(routeTarget)}` : "",
        routeWallets?.ethereum ? `ETH ${shortWallet(routeWallets.ethereum)}` : "",
        routeWallets?.solana ? `SOL ${shortWallet(routeWallets.solana)}` : "",
      ].filter(Boolean);
      meta.textContent = parts.join(" • ") || "GeoAgora identity ready.";
    } else {
      meta.textContent = "A GeoAgora link appears here automatically when a linked GeoAgora identity is found.";
    }
  }
}

function applyProfilePayload(payload) {
  const profile = payload?.profile || {};
  const wallets = payload?.wallets || {};
  const holdings = payload?.holdings || {};
  const faucet = payload?.faucet || {};
  const quiz = payload?.quiz || {};
  const games = payload?.games || {};
  const discord = payload?.discord || {};

  $("displayName").textContent = profile.displayName || profile.username || `User ${profile.discordUserId || ""}` || "Linked user";
  $("avatar").src = profile.avatarUrl || "/images/mole-dirt-square.png";
  renderProfileMeta(profile, holdings, getAuth());

  const primaryWallet = wallets.primaryWallet || profile.wallet || "No linked wallet";
  // Best-effort SNS (.sol) name from the payload (src/mole/web.js's
  // buildProfilePayload) — shown alongside the full address, never instead
  // of it, so nothing about wallet identity is hidden, just made friendlier.
  $("walletValue").textContent = wallets.primaryWalletSnsName
    ? `${wallets.primaryWalletSnsName} (${primaryWallet})`
    : primaryWallet;
  $("walletMeta").textContent = primaryWallet && primaryWallet !== "No linked wallet"
    ? `Verified ${profile.lastVerified ? fmtIso(profile.lastVerified) : "recently"} • ${wallets.knownWallets?.length || 1} known wallet${(wallets.knownWallets?.length || 1) === 1 ? "" : "s"}`
    : "Wallet not linked yet.";

  // ── At-a-glance strip ────────────────────────────────────────────────
  // A second VIEW of numbers this function already has — never a second
  // source. Each one is also shown in full inside its own card below, and if a
  // value is genuinely unknown it stays "—" rather than being shown as zero,
  // which on a balance or an unpaid total would read as a fact.
  const glance = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const headline = headlineBalance(holdings);
  glance("glBalance", headline === null ? "—" : `${fmt(headline)}`);
  glance("glFaucet", faucet?.cooldownStatusOk === false
    ? "Unknown"
    : (faucet?.cooldownReady ? "Ready now"
      : (faucet?.readyInMs ? `${Math.ceil(Number(faucet.readyInMs) / 60000)} min` : "—")));
  glance("glQuiz", fmt(quiz.currentCycle?.points || 0));
  // proofOfValue is not one of the destructured locals above — read it off the
  // payload directly. Written as `pov?.score` first, which is a ReferenceError
  // rather than undefined and took the whole render down.
  const povSummary = payload?.proofOfValue || {};
  glance("glPov", povSummary.score === null || povSummary.score === undefined
    ? "—" : `${fmt(povSummary.score)} / 100`);
  glance("glRewards", games.summary?.pendingPayout === null || games.summary?.pendingPayout === undefined
    ? "—" : fmt(games.summary.pendingPayout));

  $("claimCount").textContent = fmt(games.summary?.totalClaims || 0);
  $("totalPayout").textContent = fmt(games.summary?.totalPayout || 0);
  if ($("pendingPayout")) $("pendingPayout").textContent = fmt(games.summary?.pendingPayout || 0);
  if ($("paidPayout")) $("paidPayout").textContent = fmt(games.summary?.paidPayout || 0);
  $("quizLifetime").textContent = fmt(quiz.lifetimePoints || 0);
  $("quizCyclePoints").textContent = fmt(quiz.currentCycle?.points || 0);
  $("holdingsBalance").textContent = headline === null ? "—" : `${fmt(headline)} WinLEW`;
  const topGame = games.summary?.byGame?.[0]?.game || "—";
  if ($("topGame")) $("topGame").textContent = topGame;

  renderWallets(wallets);
  void renderPayoutWallet();
  renderProfileIdentities(payload);
  renderRoles(holdings, discord);
  renderFaucet(faucet);
  renderQuizCurrentCycle(quiz);
  renderQuizOverview(quiz);
  renderQuizPayouts(quiz);
  renderQuizRecent(quiz);
  renderGameHistory(games.history || []);
  renderGameSummary(games.summary || {});
  renderGovernanceSummary(payload?.governance || {});
  renderGovernanceMyVotes(payload?.governance || {});
  void loadContributions();
  renderProofOfValue(payload?.proofOfValue || {});
  renderMilestones(payload?.milestones || {});
  renderRecentActivity(payload?.recentActivity || {});
  renderKeepGoing(payload?.participation || {});
  renderWeeklySummary(payload?.participation || {});
  renderGeoAgora(payload?.geoAgora || {});
  persistWalletSnapshot(primaryWallet && primaryWallet !== "No linked wallet" ? primaryWallet : "");
  saveProfileCache(payload);
  applyPublicViewState(payload, getAuth());
}

function fillProfileForm(payload = {}, auth = {}) {
  const draft = loadDraft();
  const profile = payload?.profile || {};
  $("editDisplayName").value = draft.displayName ?? profile.displayName ?? "";
  $("editBio").value = draft.bio ?? profile.bio ?? "";
  $("editAvatarUrl").value = draft.avatarUrl ?? profile.avatarUrl ?? "";
  $("saveProfileBtn").disabled = !auth.wallet;
  const grant = auth.wallet ? getEditGrant(auth.wallet) : null;
  setEditStatus(auth.wallet
    ? (grant
        ? `This browser is approved for protected profile edits until ${fmtGrantExpiry(grant.expires_at)}.`
        : "Saving changes will request one wallet signature, then this browser stays approved for one cycle (91 days).")
    : "Link a wallet first. Device-only saving is still available as a local draft.");
}

async function loadProfile(auth) {
  if (isPublicView() && auth.wallet) {
    return await api(`/api/profile/public?wallet=${encodeURIComponent(auth.wallet)}&app=${encodeURIComponent(auth.app)}`);
  }
  if (auth.session) {
    try {
      return await api(`/api/profile/me?app=${encodeURIComponent(auth.app)}`);
    } catch (error) {
      if (!auth.wallet) throw error;
    }
  }
  if (auth.wallet) {
    // Send the session if we still have one. The server releases the full
    // payload only when it proves this wallet's owner is the caller (see the
    // security note on /api/profile/by-wallet); without it the response is the
    // same reduced payload /api/profile/public returns, carrying
    // publicView: true so the UI hides owner-only sections rather than
    // rendering them empty.
    const q = new URLSearchParams({ wallet: auth.wallet, app: auth.app });
    if (auth.session) q.set("session", auth.session);
    return await api(`/api/profile/by-wallet?${q.toString()}`);
  }
  throw new Error("profile_not_found");
}

async function saveProfileRemote(auth) {
  const wallet = String(auth.wallet || $("walletValue")?.textContent || "").trim();
  if (!wallet || wallet === "—" || wallet === "No linked wallet") {
    throw new Error("No linked wallet is available for this profile.");
  }

  const update = {
    wallet,
    app: auth.app,
    displayName: $("editDisplayName").value.trim(),
    bio: $("editBio").value.trim(),
    avatarUrl: $("editAvatarUrl").value.trim(),
  };

  const existingGrant = getEditGrant(wallet);
  if (existingGrant) {
    try {
      setEditStatus(`Saving with remembered wallet approval until ${fmtGrantExpiry(existingGrant.expires_at)}…`);
      const res = await api("/api/profile/update-authorized", {
        method: "POST",
        body: JSON.stringify({
          ...update,
          editToken: existingGrant.token,
        }),
      });
      if (res?.editGrant?.expires_at) {
        storeEditGrant(wallet, existingGrant.token, res.editGrant.expires_at);
      }
      saveDraft({});
      setEditStatus(`Profile saved. This browser stays approved until ${fmtGrantExpiry(existingGrant.expires_at)}.`);
      return res;
    } catch (error) {
      const msg = String(error?.message || "");
      if (!/edit_grant_/i.test(msg)) throw error;
      clearEditGrant(wallet);
    }
  }

  setEditStatus("Preparing a secure profile update challenge…");
  const challenge = await api("/api/profile/challenge", {
    method: "POST",
    body: JSON.stringify(update),
  });

  const provider = await connectForSigning(wallet);
  setEditStatus(`Awaiting ${providerLabel(provider)} signature…`);
  const signature = await signUtf8Message(provider, challenge.message);

  setEditStatus("Verifying signature and saving profile…");
  const res = await api("/api/profile/update-signed", {
    method: "POST",
    body: JSON.stringify({
      ...update,
      message: challenge.message,
      signature,
    }),
  });

  if (res?.editGrant?.token) {
    storeEditGrant(wallet, res.editGrant.token, res.editGrant.expires_at);
  }

  saveDraft({});
  setEditStatus(`Profile saved with wallet signature. This browser is approved until ${fmtGrantExpiry(res?.editGrant?.expires_at)}.`);
  return res;
}

/**
 * Sync your account — the panel that turns a wallet-rooted account into a
 * payable one.
 *
 * Owner view only, and hidden until the API answers: flashing "you cannot be
 * paid" at somebody before the data arrives is worse than a moment of nothing.
 */
async function renderAccountSync() {
  const section = document.getElementById('syncAccountSection');
  const statusEl = document.getElementById('syncStatus');
  const providersEl = document.getElementById('syncProviders');
  if (!section || !statusEl || !providersEl) return;

  const hubFetch = window.WinLEWAuth?.hubApiFetch;
  if (!hubFetch || !getAuth().session) return;

  let data;
  try {
    const res = await hubFetch('/api/account/identities');
    data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'identities_failed');
  } catch (error) {
    console.warn('[profile] account identities unavailable:', error);
    return; // stays hidden — a broken panel is worse than no panel
  }

  const synced = new Set((data.identities || []).map((i) => i.provider));

  // The URL carries the OUTCOME of a sync round trip; say what happened before
  // anything else, because that is what the person came back to find out.
  const params = new URLSearchParams(window.location.search);
  const justSynced = params.get('synced');
  const syncError = params.get('syncError');

  const justMerged = params.get('merged') === '1';

  if (syncError === 'already_linked') {
    statusEl.innerHTML = '🚫 <strong>That account is already synced to a different WinLEW account, '
      + 'and joining the two did not complete.</strong> Nothing changed. Sign in to the account that already '
      + 'has it, or try again.';
  } else if (syncError) {
    statusEl.textContent = '⚠️ That sync did not complete. Nothing changed — you can try again.';
  } else if (justMerged) {
    // The merge case says what MOVED, because the person is about to look at a
    // wallet list that just grew and should know why.
    statusEl.innerHTML = `✅ <strong>${esc(justSynced || 'That account')} synced — your two accounts are now one.</strong> `
      + 'Every wallet you had verified is on this account. You can hold as many as you like; '
      + 'exactly one of them receives payouts.';
  } else if (justSynced) {
    statusEl.innerHTML = `✅ <strong>${esc(justSynced)} synced.</strong> Your account can receive payouts.`;
  } else if (data.canBePaid) {
    statusEl.innerHTML = data.rootedIn === 'discord'
      ? '✅ <strong>Your account can receive payouts.</strong> It is a Discord account, which is proof enough on its own.'
      : '✅ <strong>Your account can receive payouts.</strong>';
  } else {
    statusEl.innerHTML = '⚠️ <strong>Payouts are locked.</strong> Sync Discord or X below to unlock them. '
      + 'Everything else — playing, the faucet, the quiz — already works.';
  }

  const providers = [
    { key: 'discord', label: 'Discord', glyph: '💬' },
    { key: 'x', label: 'X', glyph: '𝕏' },
  ];

  providersEl.innerHTML = providers.map((p) => {
    if (synced.has(p.key)) {
      return `<span class="btn" aria-disabled="true" title="Already synced to this account">${p.glyph} ${esc(p.label)} · synced ✓</span>`;
    }
    if (!data.providers?.[p.key]?.available) {
      // Advertised, not offered. A button that cannot work is a worse promise
      // than a plain "coming soon".
      return `<span class="btn" aria-disabled="true" style="opacity:.55;" title="Not available yet">${p.glyph} ${esc(p.label)} · coming soon</span>`;
    }
    return `<button class="btn primary" type="button" data-sync-provider="${esc(p.key)}">${p.glyph} Sync ${esc(p.label)}</button>`;
  }).join('');

  providersEl.querySelectorAll('[data-sync-provider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const provider = btn.getAttribute('data-sync-provider');
      const restore = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Opening…';
      try {
        const res = await hubFetch(`/api/account/sync/${provider}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ next: '/verify/profile.html' }),
        });
        const body = await res.json().catch(() => ({}));
        if (body?.ok && body.url) { window.location.href = body.url; return; }
        throw new Error(body?.error || 'sync_start_failed');
      } catch (error) {
        console.warn('[profile] sync start failed:', error);
        btn.disabled = false;
        btn.textContent = restore;
        statusEl.textContent = '⚠️ Could not start that sync. Please try again.';
      }
    });
  });

  // ── Public visibility, opt-in ───────────────────────────────────────────
  // Rendered only once the API has answered, and only inside the owner view.
  // Default is off; nothing here ever turns it on by itself.
  const visRow = document.getElementById('publicIdentityRow');
  if (visRow) {
    const on = data.publicIdentity === true;
    visRow.innerHTML = `
      <label class="visToggle">
        <input type="checkbox" id="publicIdentityToggle" ${on ? 'checked' : ''} />
        <span><strong>Show me publicly</strong> — list my name and synced accounts on pages like
        <a href="/hodl/">HODL payouts</a>. Off by default; you can turn it back off at any time.</span>
      </label>
      <div class="muted" id="publicIdentityStatus" style="font-size:12.5px;margin-top:6px;"></div>`;
    const box = document.getElementById('publicIdentityToggle');
    const status = document.getElementById('publicIdentityStatus');
    status.textContent = on
      ? 'You are shown on public pages.'
      : 'You are not shown publicly. You still take part and are still paid.';
    box.addEventListener('change', async () => {
      const want = box.checked;
      box.disabled = true;
      status.textContent = 'Saving…';
      try {
        const res = await hubFetch('/api/account/public-identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show: want }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) throw new Error(body?.error || 'save_failed');
        status.textContent = body.publicIdentity
          ? 'Saved — you are shown on public pages.'
          : 'Saved — you are not shown publicly.';
      } catch (error) {
        console.warn('[profile] public identity save failed:', error);
        box.checked = !want; // reflect the truth, not the attempt
        status.textContent = 'Could not save that. Nothing changed.';
      } finally {
        box.disabled = false;
      }
    });
  }

  section.classList.remove('hidden');
}

async function boot() {
  const auth = getAuth();
  applyPublicViewState({ wallets: { primaryWallet: auth.wallet }, profile: { wallet: auth.wallet } }, auth);

  try {
    const payload = await loadProfile(auth);
    // Must run BEFORE applyProfilePayload — it decides whether owner-only
    // sections render at all, and the server may have returned the reduced
    // payload even though the URL looks like an owner view.
    notePayloadViewMode(payload);
    applyProfilePayload(payload);
    void renderAccountSync();
    fillProfileForm(payload, {
      ...auth,
      wallet: payload?.wallets?.primaryWallet || payload?.profile?.wallet || auth.wallet,
    });
    // Minimal additive hook (2026-07-28) — profile.html's own "Save Your
    // Profile" modal script listens for this rather than polling or
    // duplicating any load logic here. Owner view only: a public visitor
    // browsing someone else's profile has no wallet to sign a save with, so
    // the nudge would never be actionable for them.
    if (!isPublicView()) document.dispatchEvent(new CustomEvent("winlew:profile-loaded", { detail: payload }));
  } catch (error) {
    const cached = loadProfileCache();
    if (cached?.profile) {
      applyProfilePayload(cached);
      fillProfileForm(cached, {
        ...auth,
        wallet: cached?.wallets?.primaryWallet || cached?.profile?.wallet || auth.wallet,
      });
      setEditStatus("Loaded your last known profile snapshot from this browser.");
    } else {
      $("displayName").textContent = isPublicView() ? "Public profile unavailable" : "No linked profile found";
      $("walletValue").textContent = auth.wallet || "—";
      $("walletMeta").textContent = auth.wallet
        ? "A wallet is known on this browser, but the linked profile could not be loaded yet."
        : "Open this page from verify or complete the wallet link flow first.";
      renderGeoAgora({});
      applyPublicViewState({ wallets: { primaryWallet: auth.wallet }, profile: { wallet: auth.wallet } }, auth);
      setEditStatus(isPublicView() ? "This public profile could not be loaded yet." : "Open this page from verify to load and cache your full profile.");
      fillProfileForm({}, auth);
    }
  }

  $("saveLocalProfileBtn")?.addEventListener("click", () => {
    const draft = {
      displayName: $("editDisplayName").value.trim(),
      bio: $("editBio").value.trim(),
      avatarUrl: $("editAvatarUrl").value.trim(),
    };
    saveDraft(draft);

    if (draft.displayName) $("displayName").textContent = draft.displayName;
    if (draft.avatarUrl) $("avatar").src = draft.avatarUrl;

    const cached = loadProfileCache() || { profile: {}, wallets: {}, faucet: {}, quiz: {}, games: { history: [], summary: {} }, discord: {}, holdings: {} };
    cached.profile = {
      ...(cached.profile || {}),
      displayName: draft.displayName || cached.profile?.displayName || $("displayName").textContent,
      bio: draft.bio || cached.profile?.bio || "",
      avatarUrl: draft.avatarUrl || cached.profile?.avatarUrl || $("avatar").src,
      wallet: cached.profile?.wallet || getAuth().wallet || "",
    };
    saveProfileCache(cached);
    setEditStatus("Profile draft saved on this device.");
  });

  $("resetProfileDraftBtn")?.addEventListener("click", () => {
    saveDraft({});
    const cached = loadProfileCache();
    $("editDisplayName").value = cached?.profile?.displayName || "";
    $("editBio").value = cached?.profile?.bio || "";
    $("editAvatarUrl").value = cached?.profile?.avatarUrl || "";
    setEditStatus("Device draft cleared.");
  });

  $("saveProfileBtn")?.addEventListener("click", async () => {
    const currentAuth = getAuth();
    if (!currentAuth.wallet) {
      setEditStatus("No linked wallet was found for this profile yet.");
      return;
    }
    try {
      const payload = await saveProfileRemote(currentAuth);
      applyProfilePayload(payload);
      fillProfileForm(payload, {
        ...currentAuth,
        wallet: payload?.wallets?.primaryWallet || payload?.profile?.wallet || currentAuth.wallet,
      });
    } catch (error) {
      setEditStatus(error?.message || "Profile save failed.");
    }
  });

  $("copyWalletBtn")?.addEventListener("click", async () => {
    const wallet = getAuth().wallet || $("walletValue")?.textContent || "";
    if (!wallet || wallet === "No linked wallet") return;
    try {
      await navigator.clipboard.writeText(wallet);
      const btn = $("copyWalletBtn");
      const original = btn.textContent;
      btn.textContent = "✅ Copied";
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      // Clipboard permission denied or unavailable — the address is already
      // visible in the wallet card, so this is a convenience feature only.
    }
  });

  // Reuses the shared wallet-connect/session flow (window.WinLEWAuth) — no
  // second wallet modal. On success, reload so boot() re-runs against the
  // freshly stored session, the same pattern Faucet/Quiz already use.
  $("switchWalletBtn")?.addEventListener("click", () => {
    sharedWalletLogin({
      btnId: "switchWalletBtn",
      onSuccess: () => { window.location.reload(); },
    });
  });

  $("navWalletConnect")?.addEventListener("click", (e) => {
    sharedWalletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || "connected");
  refreshWalletBalance();

  $("disconnectBtn")?.addEventListener("click", () => {
    // Use the existing keepalive server revocation, not only localStorage
    // cleanup. This page's own
    // getAuth() also reads sessionStorage and a cookie as fallbacks (see
    // parseSessionFromReferrer/setCookie above — populated by the /verify/
    // link flow), so those are cleared explicitly too. Otherwise a stale
    // copy in either place would silently resurrect the session on reload.
    sharedLogout();
    for (const key of [ProfileStore.session, ProfileStore.app, ProfileStore.wallet]) {
      try { sessionStorage.removeItem(key); } catch {}
      setCookie(key, "", 0);
    }
    try { localStorage.removeItem(ProfileStore.cache); } catch {}
    window.location.href = "/verify/";
  });
}

boot().catch((error) => {
  console.error(error);
  const cached = loadProfileCache();
  if (cached?.profile) {
    applyProfilePayload(cached);
    fillProfileForm(cached, getAuth());
    setEditStatus("Loaded your last known profile snapshot from this browser.");
    return;
  }
  $("displayName").textContent = "Profile unavailable";
  $("walletMeta").textContent = error?.message || "Could not load profile.";
});
