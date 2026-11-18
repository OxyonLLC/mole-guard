
// API-base bridging is a shared platform primitive now (/assets/wallet-auth.js,
// loaded before this file) — see that file's own comment for why winlew.co
// shared hosting needs the /verify/api-proxy.php bridge at all.
const { hubApiFetch } = window.WinLEWAuth;

// Kept local (not the shared readHubApiJson): this version also throws on a
// non-OK HTTP status, which several other calls in this file (profile,
// history, claim, reconcile) rely on — the shared version leaves that check
// to the caller, matching Faucet/Quiz's simpler original contract instead.
async function readHubApiJson(response, fallback = 'api_request_failed') {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(/^\s*</.test(text)
      ? 'The WinLEW API bridge returned a web page. Refresh the Mole Hub and try again.'
      : `${fallback}:invalid_response`);
  }
  if (!response.ok) throw new Error(data?.error || fallback);
  return data || {};
}

function detectRuntimeMode() {
  try {
    const url = new URL(window.location.href);
    const discordFlag = ['discord', '1', 'true', 'activity'].includes(String(url.searchParams.get('platform') || '').trim().toLowerCase())
      || ['1', 'true', 'yes', 'on'].includes(String(url.searchParams.get('discord_activity') || '').trim().toLowerCase())
      || ['1', 'true', 'yes', 'on'].includes(String(url.searchParams.get('activity') || '').trim().toLowerCase());
    return {
      platform: discordFlag ? 'discord' : 'web',
      rewardMode: discordFlag ? 'deterministic' : 'random',
      isDiscordActivity: discordFlag,
    };
  } catch {
    return { platform: 'web', rewardMode: 'random', isDiscordActivity: false };
  }
}

const RuntimeMode = detectRuntimeMode();
document.documentElement.dataset.platform = RuntimeMode.platform;
document.documentElement.dataset.rewardMode = RuntimeMode.rewardMode;

function resolveCatalogImage(src) {
  if (!src || typeof src !== 'string') return src;
  if (!src.endsWith('.svg')) return src;
  const pngCandidate = src.replace(/\.svg$/i, '.png');
  return pngCandidate;
}

const catalogGames = [
  {
    id: 'rootglide',
    title: 'Root Glide',
    launch: 'rootglide',
    platform: 'mobile',
    subtitle: 'Mobile / Tap Runner',
    description: 'Glide through connected cave routes, dodge solid dirt and protruding hazards, snag golden worms, and reach the beacon reward box.',
    // Payout floor was 8, but a round-1 clear with no checkpoints, no distance
    // and the 0.5x reward box pays (18 + 1*5) * 0.60 * 0.5 = 6.9 LEW. The "+"
    // marks the ceiling as open: config.baseReward grows 5 per round, so high
    // rounds pay well above 35. Verified against root-glide.js 2026-08-05.
    stats: [['Difficulty', '1/5'], ['Time', '30 sec'], ['Payout', '7–35+ LEW']],
    tags: ['mobile', 'new', 'popular', 'live'],
    status: 'live',
    featuredOrder: 1,
    thumb: './assets/rootglide-card-600.jpg',
    badge: 'NEW',
    pill: 'Touch-first',
    shareText: 'Root Glide is the WinLEW touch-first tunnel runner built for fast mobile retries.',
    primary: true,
  },
  {
    id: 'burrowblaster',
    title: 'Burrow Blaster',
    launch: 'burrowblaster',
    platform: 'mobile',
    subtitle: 'Mobile / Arcade Shooter',
    description: 'Pilot Lew’s drill-ship through waves, blast raiders, dodge hazards, collect shards and power cores, and break boss rounds.',
    // Floor was 20; a wave-1 washout with the 0.5x box pays
    // (35 + 1*15) * 0.35 * 0.5 = 8.75 LEW. Ceiling is open — base grows 15 per
    // round plus wave/shard/kill bonuses. Verified against burrow-blaster.js.
    stats: [['Difficulty', '2/5'], ['Time', '40 sec'], ['Payout', '9–90+ LEW']],
    tags: ['mobile', 'new', 'popular', 'live'],
    status: 'live',
    featuredOrder: 2,
    thumb: './assets/burrowblaster-card-600.jpg',
    badge: 'NEW',
    pill: 'Featured mobile',
    shareText: 'Burrow Blaster is the WinLEW mole-themed arcade shooter built for mobile-first sessions.',
    primary: true,
  },
  {
    id: 'pacmole',
    title: 'Pac-Mole',
    launch: 'pacmole',
    platform: 'web',
    subtitle: 'Web / Arcade Maze',
    description: 'Flow-loop maze rebuild with fewer dead ends, less rim repetition, smoother enemy pressure, rotating beetle dens, and useful Burrow routes.',
    stats: [['Difficulty', '2/5'], ['Levels', '20'], ['Payout', '10–420 LEW']],
    tags: ['web', 'popular', 'live'],
    status: 'live',
    featuredOrder: 3,
    thumb: './assets/pacmole-card-600.jpg',
    pill: 'Arcade maze',
    shareText: 'Pac-Mole is the WinLEW maze chase with flow-loop layouts, filled path tiles, rotating beetle dens, smarter beetle pressure, and Burrow shortcuts.',
    primary: false,
  },
  {
    id: 'diglew',
    title: 'DigLEW',
    launch: 'diglew',
    platform: 'web',
    subtitle: 'Web / 3-Road Runner',
    description: 'Switch roads through balanced tunnel gates, chase top-road treasure, grab blue dash charges, smash cracked rocks, and reach checkpoint reward boxes.',
    // Floor was 2; a stage-1 checkpoint with nothing collected and the 0.5x box
    // pays 2 * 1 * 1 * 0.75 * 0.5 = 0.75 LEW (effects.rewardScale bottoms out
    // at 1, gradeBonus at 1). Ceiling is open — worm/gem/coin/distance bonuses
    // keep accruing. Verified against diglew.js 2026-08-05.
    stats: [['Difficulty', '2/5'], ['Time', '45 sec'], ['Payout', '1–30+ LEW']],
    tags: ['web', 'popular', 'live'],
    status: 'live',
    featuredOrder: 4,
    thumb: './assets/diglew-card-600.jpg',
    pill: 'Longer run',
    shareText: 'DigLEW is the WinLEW 3-road runner where road choices, blue charges, cracked-rock dashes, and checkpoint rewards drive the run.',
    primary: true,
  },
  {
    id: 'moleice',
    title: 'Mole Ice',
    launch: 'moleice',
    platform: 'web',
    subtitle: 'Web / Arcade Grid Puzzle',
    description: 'Push, slide, and shatter ice blocks through a frozen mine to crush every Glitch Bug. Chain multi-kill slides for big combo scores.',
    stats: [['Difficulty', '2/5'], ['Round', 'Quick'], ['Payout', 'Live']],
    tags: ['web', 'new', 'live'],
    status: 'live',
    featuredOrder: 5,
    thumb: './assets/moleice-card-600.jpg',
    badge: 'NEW',
    pill: 'Grid puzzle',
    shareText: 'Mole Ice is the WinLEW ice-sliding puzzle arcade — push blocks, crush Glitch Bugs, and chain combos.',
    primary: false,
  },
  {
    id: 'tunneltap',
    title: 'Tunnel Tap',
    launch: 'tunneltap',
    platform: 'mobile',
    subtitle: 'Mobile / Tap Survival',
    description: 'Tap to dodge spikes and falling rocks. Survive as long as you can while racing toward the next safe burrow pocket.',
    stats: [['Difficulty', '2/5'], ['Time', '30 sec'], ['Payout', '5–450 LEW']],
    tags: ['mobile', 'new', 'live'],
    status: 'live',
    featuredOrder: 5,
    thumb: './assets/tunneltap-card-600.jpg',
    badge: 'NEW',
    pill: 'Tap survival',
    shareText: 'Tunnel Tap is the WinLEW three-lane survival sprint — dodge cave hazards, collect W coins, and reach the next safe burrow.',
    primary: false,
  },
  {
    id: 'grubdrop',
    title: 'Grub Drop',
    launch: 'grubdrop',
    platform: 'mobile',
    subtitle: 'Mobile / Puzzle Tap',
    description: 'Hold the burrow: pop clumps of matching cave collectibles while new rows rise from below, faster every 30 seconds, with new colours joining as you go.',
    stats: [['Difficulty', '3/5'], ['Round', '2–5 min'], ['Payout', '2–160 LEW']],
    tags: ['mobile', 'new', 'live'],
    status: 'live',
    featuredOrder: 3,
    // Cache-busted (2026-07-25: real illustrated art, replacing the
    // hand-drawn SVG-rendered thumbnail) — the filename itself never
    // changes, so a browser that already cached the old art would
    // otherwise keep serving it indefinitely after this update.
    thumb: './assets/grubdrop-card-600.jpg',
    badge: 'NEW',
    pill: 'Puzzle lane',
    shareText: 'Grub Drop is the WinLEW cave-collecting tap puzzle — match illustrated treasures, chain combos, and bank a reward box.',
    primary: false,
  },
  {
    id: 'molespades',
    title: 'Mole Spades',
    launch: 'molespades',
    platform: 'web',
    subtitle: 'Web / Strategy Cards',
    description: 'Study your hand, bid a contract, and partner with Dirt Digger in a polished team trick-taking match.',
    stats: [['Difficulty', '3/5'], ['Match', 'Strategic'], ['Payout', 'WinLEW']],
    tags: ['web', 'new', 'popular', 'live'],
    status: 'live',
    featuredOrder: 2,
    thumb: './assets/mole-spades-card-v1.png',
    badge: 'NEW',
    pill: 'Trick-taking',
    shareText: 'Mole Spades brings team trick-taking, the WinLEW Wild, distinct mole rivals, and WinLEW match rewards to the Mole Hub.',
    primary: true,
  },
];

// Phase 4A presentation truth. Gameplay and reward logic remain in the
// existing game modules; this catalog only explains what can be launched and
// what the browser can (and cannot) prove.
const phase4aCatalogTruth = {
  rootglide: { maturity: 'Live', stats: [['Difficulty', '1/5'], ['Session', 'Quick'], ['Controls', 'Touch + keys']], rewardNote: 'Eligible results use the existing server claim flow; a local score alone is not a confirmed reward.' },
  burrowblaster: { maturity: 'Live', stats: [['Difficulty', '2/5'], ['Session', 'Quick'], ['Controls', 'Touch + keys']], rewardNote: 'Eligible results use the existing server claim flow; payout is confirmed only by the server response.' },
  pacmole: { maturity: 'Live', stats: [['Difficulty', '2/5'], ['Levels', '20'], ['Controls', 'Keyboard']], rewardNote: 'Eligible results use the existing server claim flow; local leaderboard entries remain on this device.' },
  diglew: { maturity: 'Live', stats: [['Difficulty', '2/5'], ['Session', 'Longer'], ['Controls', 'Touch + keys']], rewardNote: 'Checkpoint claims use the existing server flow; the interface distinguishes local score from confirmed payout.' },
  moleice: { maturity: 'Experimental', badge: 'EXPERIMENTAL', stats: [['Difficulty', '2/5'], ['Session', 'Quick'], ['Controls', 'Touch + keys']], rewardNote: 'Playable experimental build. Any eligible claim still requires the existing server confirmation.' },
  tunneltap: { maturity: 'Live', stats: [['Difficulty', '2/5'], ['Session', 'Quick'], ['Controls', 'Touch + keys']], rewardNote: 'Eligible results use the existing server claim flow; the displayed run score is not itself payout proof.' },
  grubdrop: { maturity: 'Live', stats: [['Difficulty', '2/5'], ['Session', 'Quick'], ['Controls', 'Touch']], rewardNote: 'Eligible results use the existing server claim flow; locally shown progress is not a confirmed reward.' },
  molespades: { maturity: 'Live', stats: [['Difficulty', '3/5'], ['Session', 'Full match'], ['Controls', 'Touch + mouse']], rewardNote: 'Match completion uses the existing claim flow. Server confirmation—not the win animation—records a reward.' },
};
catalogGames.forEach((game) => Object.assign(game, phase4aCatalogTruth[game.id] || {}));
catalogGames.push({
  id: 'molemarketrush', title: 'Mole Market Rush', platform: 'mobile',
  subtitle: 'Casual market concept',
  description: 'A planned casual market game. It is shown as coming—not presented as playable.',
  stats: [['State', 'Coming'], ['Session', 'Unknown'], ['Controls', 'Not final']],
  tags: ['mobile', 'planned'], status: 'planned', maturity: 'Coming', featuredOrder: 9,
  thumb: './assets/molemarketrush-card-600.jpg', badge: 'COMING', pill: 'In development',
  rewardNote: 'No availability or reward behavior is claimed.',
  shareText: 'Mole Market Rush is a planned WinLEW game concept.', primary: false,
});

function detectDeviceProfile() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.matchMedia?.('(max-width: 980px)').matches ?? window.innerWidth < 980;
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const isMobileLike = coarse || narrow || touchPoints > 1;
  return { coarse, narrow, touchPoints, isMobileLike, recommendedLane: isMobileLike ? 'mobile' : 'web' };
}
function recommendationText(profile = detectDeviceProfile()) {
  return profile.recommendedLane === 'mobile'
    ? '📱 Mobile users: touch-first lane recommended'
    : '🖥️ Desktop users: instant web lane recommended';
}
async function shareGame(game) {
  const url = new URL(window.location.href);
  if (game.launch) {
    url.searchParams.set('game', game.launch);
    url.hash = game.launch === 'pacmole' ? 'pacmole' : game.launch;
  }
  const sharePayload = {
    title: `WinLEW Arcade — ${game.title}`,
    text: game.shareText || `Check out ${game.title} in the WinLEW Gaming Hub.`,
    url: url.toString(),
  };
  try {
    if (navigator.share) {
      await navigator.share(sharePayload);
      return { ok: true, message: `${game.title} shared.` };
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${sharePayload.title}
${sharePayload.text}
${sharePayload.url}`);
      return { ok: true, message: `${game.title} link copied.` };
    }
    return { ok: false, message: 'Share not available on this device.' };
  } catch (_error) {
    return { ok: false, message: 'Share cancelled.' };
  }
}
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function buildCatalogStat(label, value) {
  const safeLabel = escapeHtml(label);
  const safeValue = escapeHtml(value);
  const kind = String(label || '').toLowerCase();
  if (kind === 'difficulty') {
    const match = String(value).match(/(\d+)\s*\/\s*(\d+)/);
    const active = match ? Number(match[1]) : 0;
    const total = match ? Number(match[2]) : 5;
    const meter = Array.from({ length: total }, (_, index) => `<i class="${index < active ? 'active' : ''}"></i>`).join('');
    return `
      <div class="catalog-stat" data-kind="difficulty">
        <span>${safeLabel}</span>
        <strong>${safeValue}</strong>
        <div class="catalog-meter" aria-hidden="true">${meter}</div>
      </div>
    `;
  }
  return `
    <div class="catalog-stat" data-kind="${escapeHtml(kind)}">
      <span>${safeLabel}</span>
      <strong>${safeValue}</strong>
    </div>
  `;
}
// The games the XL1 Arcade pays XL1 for (its play page takes these ids as ?game=).
const XL1_ARCADE_GAMES = new Set(['diglew', 'pacmole', 'rootglide', 'burrowblaster', 'tunneltap', 'moleice', 'molespades']);
function catalogCardTemplate(game) {
  const stats = game.stats.map(([label, value]) => buildCatalogStat(label, value)).join('');
  const live = game.status === 'live';
  const featured = Number(game.featuredOrder || 99) <= 2;
  const flag = game.badge ? `<span class="catalog-flag ${live ? '' : 'soon'}">${escapeHtml(game.badge)}</span>` : '';
  const maturity = game.maturity || (live ? 'Live' : 'Coming');
  const shareBtn = live ? `<button type="button" class="catalog-share-btn" data-share="${escapeHtml(game.id)}">↗ Share</button>` : '';
  // Two ways to play (2026-10-24): here in the Mole Hub for WinLEW, or in the XL1 Arcade, which
  // pays XL1 for the same game (Grub Drop doesn't earn XL1 yet, so it has only the first).
  const xl1 = live && XL1_ARCADE_GAMES.has(game.id)
    ? `<a class="btn ghost catalog-play-btn catalog-xl1-btn" href="/xl1/arcade/play/?game=${encodeURIComponent(game.id)}">▶ Play for XL1</a>`
    : '';
  const cta = live
    ? `<div class="catalog-play-pair"><button data-launch="${escapeHtml(game.launch)}" class="btn ${game.primary ? 'primary' : ''} catalog-play-btn">▶ Play for WinLEW</button>${xl1}</div>`
    : `<button type="button" class="btn ghost catalog-play-btn" disabled>Coming Soon</button>`;
  return `
    <article class="catalog-card card ${live ? 'is-live' : 'planned'} ${featured ? 'is-featured' : ''}"
      data-game-id="${escapeHtml(game.id)}"
      data-platform="${escapeHtml(game.platform)}"
      data-status="${escapeHtml(game.status)}"
      data-tags="${escapeHtml(game.tags.join(','))}"
      data-title="${escapeHtml(game.title)}"
      data-reward="${escapeHtml(String(game.stats.find(([label]) => label === 'Reward')?.[1] || '0').replace(/[^\d]/g, ''))}"
      data-featured-order="${escapeHtml(String(game.featuredOrder))}">
      <div class="catalog-thumb-wrap">
        ${flag}
        <picture>
          <source srcset="${escapeHtml(game.thumb.replace(/\.jpg$/, '.webp'))}" type="image/webp" />
          <img class="catalog-thumb" src="${escapeHtml(game.thumb)}" alt="${escapeHtml(game.title)}" width="600" height="338" loading="lazy" />
        </picture>
        <div class="catalog-thumb-sheen" aria-hidden="true"></div>
      </div>
      <div class="catalog-body">
        <div class="catalog-card-head">
          <div>
            <h3>${escapeHtml(game.title)}</h3>
            <div class="catalog-eyebrow">${escapeHtml(game.subtitle)}</div>
          </div>
          <div class="catalog-platform" aria-label="${game.platform === 'mobile' ? 'Mobile game' : 'Web game'}">${game.platform === 'mobile' ? '📱' : '🌐'}</div>
        </div>
        <p class="catalog-desc">${escapeHtml(game.description)}</p>
        <div class="catalog-stats">${stats}</div>
        <div class="catalog-trust">
          <span><strong>Product:</strong> ${escapeHtml(maturity)}</span>
          <span><strong>Record:</strong> ${escapeHtml(game.rewardNote || 'See the game result and server response for status.')}</span>
        </div>
        <div class="catalog-actions-row">
          ${cta}
          <div class="catalog-side-actions">
            ${shareBtn}
            <span class="catalog-pill ${live ? 'live' : 'planned-pill'}">${escapeHtml(game.pill)}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}
function initCatalogUi({ games, loadWallet }) {
  const grid = document.getElementById('catalogGrid');
  const filterButtons = [...document.querySelectorAll('.catalog-filter')];
  const laneButtons = [...document.querySelectorAll('[data-jump-filter]')];
  const sortSelect = document.getElementById('catalogSort');
  const toast = document.getElementById('catalogToast');
  const platformAmount = document.getElementById('navPlatformAmount');
  const gatewayHint = document.getElementById('gatewayHint');
  const webLane = document.getElementById('laneWeb');
  const mobileLane = document.getElementById('laneMobile');
  let activeFilter = 'all';
  let toastTimer;
  if (!grid) return { refreshWallet() {}, refreshRecommendations() {} };
  grid.innerHTML = games.map(catalogCardTemplate).join('');
  const cards = [...grid.querySelectorAll('.catalog-card')];
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
  };
  const getTags = (card) => String(card.dataset.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  const featuredRank = (card) => Number(card.dataset.featuredOrder || 999);
  const rewardRank = (card) => Number(card.dataset.reward || 0);
  function matchesFilter(card, filter) {
    if (filter === 'all') return true;
    if (filter === 'planned') return card.dataset.status === 'planned';
    return getTags(card).includes(filter);
  }
  function sortCards(mode) {
    const sorted = [...cards];
    sorted.sort((a, b) => {
      if (mode === 'az') return String(a.dataset.title || '').localeCompare(String(b.dataset.title || ''));
      if (mode === 'reward') return rewardRank(b) - rewardRank(a) || featuredRank(a) - featuredRank(b);
      if (mode === 'mobile' || mode === 'web') {
        const aBias = a.dataset.platform === mode ? 0 : 1;
        const bBias = b.dataset.platform === mode ? 0 : 1;
        return aBias - bBias || featuredRank(a) - featuredRank(b);
      }
      return featuredRank(a) - featuredRank(b);
    });
    sorted.forEach((card) => grid.appendChild(card));
  }
  function renderCatalog() {
    sortCards(sortSelect?.value || 'featured');
    cards.forEach((card) => card.classList.toggle('hidden-by-filter', !matchesFilter(card, activeFilter)));
  }
  function setFilter(filter) {
    activeFilter = filter || 'all';
    filterButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.filter === activeFilter));
    renderCatalog();
  }
  function refreshWallet() {
    if (platformAmount && typeof loadWallet === 'function') platformAmount.textContent = Number(loadWallet() || 0).toFixed(2);
  }
  function refreshRecommendations() {
    const profile = detectDeviceProfile();
    if (gatewayHint) gatewayHint.textContent = recommendationText(profile);
    webLane?.classList.toggle('recommended-lane', profile.recommendedLane === 'web');
    mobileLane?.classList.toggle('recommended-lane', profile.recommendedLane === 'mobile');
  }
  filterButtons.forEach((btn) => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));
  laneButtons.forEach((btn) => btn.addEventListener('click', () => {
    setFilter(btn.dataset.jumpFilter || 'all');
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  sortSelect?.addEventListener('change', renderCatalog);
  window.addEventListener('resize', refreshRecommendations);
  window.addEventListener('orientationchange', refreshRecommendations);
  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share]');
    if (!button) return;
    const game = games.find((item) => item.id === button.dataset.share);
    if (!game) return;
    const result = await shareGame(game);
    showToast(result.message);
  });
  refreshWallet();
  refreshRecommendations();
  renderCatalog();
  return { refreshWallet, refreshRecommendations };
}


const Storage = {
  sound: 'winlew.sound',
  diglew: 'winlew.diglew.progress',
  diglewBoard: 'winlew.diglew.board',
  pacBoard: 'winlew.pac.board',
  pacState: 'winlew.pac.state',
  pacClaims: 'winlew.pac.claims',
  glideBoard: 'winlew.glide.board',
  glideState: 'winlew.glide.state',
  blasterBoard: 'winlew.blaster.board',
  blasterState: 'winlew.blaster.state',
  grubState: 'winlew.grub.state',
  moleiceBoard: 'winlew.moleice.board',
  moleiceState: 'winlew.moleice.state',
  tunnelTapBoard: 'winlew.tunneltap.board',
  tunnelTapState: 'winlew.tunneltap.state',
  moleSpadesState: 'winlew.molespades.state',
  moleSpadesSession: 'winlew.molespades.session.v2',
  wallet: 'winlew.wallet'
};

const views = {
  hub: document.getElementById('hubView'),
  diglew: document.getElementById('diglewView'),
  pac: document.getElementById('pacmoleView'),
  rootglide: document.getElementById('rootglideView'),
  blaster: document.getElementById('burrowblasterView'),
  grubdrop: document.getElementById('grubdropView'),
  moleice: document.getElementById('moleiceView'),
  tunneltap: document.getElementById('tunneltapView'),
  molespades: document.getElementById('molespadesView')
};
const soundToggle = document.getElementById('soundToggle');
const homeBtn = document.getElementById('homeBtn');
const gatewayHint = document.getElementById('gatewayHint');

function $(id) { return document.getElementById(id); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function rand(max) { return Math.floor(Math.random() * max); }
function choice(arr) { return arr[rand(arr.length)]; }
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function keyOf(x, y) { return `${x},${y}`; }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}


const WalletOwnerKey = 'winlew.wallet.owner';
function walletOwner(auth = getAuthContext()) {
  return auth.session ? `member:${auth.app}:${auth.session}` : 'guest';
}
function isCurrentHubAuth(auth) {
  const current = getAuthContext();
  return current.session === auth.session && current.app === auth.app;
}
function loadWallet() {
  const owner = localStorage.getItem(WalletOwnerKey);
  if (owner && owner !== 'guest' && owner !== walletOwner()) {
    // A member mirror never follows the browser into another account or
    // guest mode. Reset only the display cache, not any server records.
    save(Storage.wallet, 0);
    localStorage.setItem(WalletOwnerKey, walletOwner());
    return 0;
  }
  return Number(load(Storage.wallet, 0)) || 0;
}
function setNavArcadeMetric(amount) {
  const formatted = Number(amount || 0).toFixed(2);
  const payload = {
    amountText: formatted,
    title: `${formatted} LEW stored in Mole Hub`,
    ariaLabel: `Your Mole Hub stored WinLEW: ${formatted} LEW`,
  };
  window.__winlewPendingPlatformMetric = payload;
  window.WinLEWNav?.setPlatformMetric?.(payload);
}
function renderWalletDisplays() {
  setNavArcadeMetric(loadWallet());
  if (window.__catalogUi?.refreshWallet) window.__catalogUi.refreshWallet();
}
function saveWallet(value) {
  save(Storage.wallet, Number(value.toFixed(2)));
  localStorage.setItem(WalletOwnerKey, walletOwner());
  renderWalletDisplays();
}
function addWallet(amount) {
  const next = loadWallet() + Number(amount || 0);
  saveWallet(next);
  return next;
}

const AuthKeys = {
  session: 'winlew.verify.session',
  app: 'winlew.verify.app',
  wallet: 'winlew.verify.wallet',
  verification: 'winlew.hub.verification',
};

function syncAuthFromUrl() {
  try {
    const url = new URL(window.location.href);
    const session = url.searchParams.get('session');
    const app = url.searchParams.get('app');
    if (session) localStorage.setItem(AuthKeys.session, session);
    if (app) localStorage.setItem(AuthKeys.app, app);
  } catch {}
}

function getAuthContext() {
  try {
    const url = new URL(window.location.href);
    return {
      session: url.searchParams.get('session') || localStorage.getItem(AuthKeys.session) || '',
      app: url.searchParams.get('app') || localStorage.getItem(AuthKeys.app) || 'mole',
    };
  } catch {
    return {
      session: localStorage.getItem(AuthKeys.session) || '',
      app: localStorage.getItem(AuthKeys.app) || 'mole',
    };
  }
}

function verificationDate(unixSeconds) {
  const value = Number(unixSeconds || 0);
  if (!value) return '';
  return new Date(value * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const yourPlayState = {
  connection: getAuthContext().session ? 'remembered' : 'guest',
  verification: getAuthContext().session ? 'checking' : 'guest',
  history: 'checking',
  historyCount: null,
};

function setYourPlayText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderYourPlay() {
  const connected = yourPlayState.connection === 'confirmed';
  const remembered = yourPlayState.connection === 'remembered';
  setYourPlayText('yourPlayConnection', connected ? 'Account session confirmed' : (remembered ? 'Session found — confirming' : 'Guest play active'));
  setYourPlayText('yourPlayConnectionHelp', connected
    ? 'The server accepted the existing WinLEW session. No wallet address is displayed here.'
    : (remembered ? 'A browser session exists, but it is not trusted until the server accepts it.' : 'No connection is required to browse or play supported games.'));
  const verificationLabels = { current: 'Wallet verification current', expired: 'Verification expired', unavailable: 'Verification unavailable', guest: 'Not checked for guests', checking: 'Checking profile…' };
  setYourPlayText('yourPlayVerification', verificationLabels[yourPlayState.verification] || 'Verification unavailable');
  setYourPlayText('yourPlayVerificationHelp', yourPlayState.verification === 'current'
    ? 'Confirmed by the existing private profile response.'
    : (yourPlayState.verification === 'expired' ? 'Reconnect through Verify when an eligible action requires current verification.' : 'No verified state is inferred from browser storage.'));
  const historyLabel = yourPlayState.history === 'available'
    ? `${yourPlayState.historyCount} server-confirmed record${yourPlayState.historyCount === 1 ? '' : 's'}`
    : (yourPlayState.history === 'empty' ? 'No server records yet' : (yourPlayState.history === 'unavailable' ? 'History unavailable' : 'Checking history…'));
  setYourPlayText('yourPlayHistory', historyLabel);
  setYourPlayText('yourPlayHistoryHelp', yourPlayState.history === 'unavailable'
    ? 'The history service could not answer. This is not shown as zero activity.'
    : 'Only accepted server history is counted here; local scoreboards remain local.');
  setYourPlayText('yourPlayNext', connected
    ? 'Next: play, then use Profile to inspect recorded participation and Proof of Value.'
    : 'Next: play as a guest, or connect when you want eligible records linked to your profile.');
}

function updateYourPlayFromProfile(data) {
  yourPlayState.connection = 'confirmed';
  const verification = data?.verification || {};
  const expired = Number(verification.expires_at || 0) > 0 && Number(verification.expires_at) <= Math.floor(Date.now() / 1000);
  yourPlayState.verification = verification.verified && !expired ? 'current' : (expired ? 'expired' : 'unavailable');
  renderYourPlay();
}

function updateYourPlayFromHistory(data) {
  const history = Array.isArray(data?.history) ? data.history : null;
  if (!history) yourPlayState.history = 'unavailable';
  else {
    yourPlayState.historyCount = history.length;
    yourPlayState.history = history.length ? 'available' : 'empty';
  }
  renderYourPlay();
}

function setWalletVerificationUi(verification, warning = '') {
  const notice = document.getElementById('walletVerificationNotice');
  const text = document.getElementById('walletVerificationText');
  if (!notice || !text || !verification) return;

  const expired = Number(verification.expires_at || 0) > 0 && Number(verification.expires_at) <= Math.floor(Date.now() / 1000);
  const verified = !!verification.verified && !expired;
  const status = expired ? 'expired' : verification.status;
  const expires = verificationDate(verification.expires_at);
  notice.classList.remove('hidden');
  notice.classList.toggle('verified', verified);
  text.textContent = verified
    ? `Wallet verified. Your profile is connected and token access is unlocked${expires ? ` through ${expires}` : ' for this quiz cycle'}.`
    : (warning || (status === 'expired'
      ? 'Your profile is connected, but wallet verification expired for the new quiz cycle. Please verify on our Discord to unlock your tokens again.'
      : 'Your profile is connected. Please verify your wallet on our Discord to unlock your tokens. Your play and rewards will stay saved.'));
  try { localStorage.setItem(AuthKeys.verification, JSON.stringify({ ...verification, verified, status, warning })); } catch {}
}

function restoreWalletVerificationUi() {
  try {
    const saved = JSON.parse(localStorage.getItem(AuthKeys.verification) || 'null');
    if (saved) setWalletVerificationUi(saved, saved.warning || '');
  } catch {}
}

async function refreshWalletVerification() {
  const auth = getAuthContext();
  if (!auth.session) return;
  try {
    const res = await hubApiFetch(`/api/profile/me?app=${encodeURIComponent(auth.app)}`);
    if (!isCurrentHubAuth(auth)) return;
    if (res.status === 401) {
      localStorage.removeItem(AuthKeys.session);
      localStorage.removeItem(AuthKeys.verification);
      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.get('session') === auth.session) {
        currentUrl.searchParams.delete('session');
        history.replaceState(null, '', currentUrl.toString());
      }
      document.getElementById('walletVerificationNotice')?.classList.add('hidden');
      setWalletConnectedUi('');
      updateGuestNudge();
      yourPlayState.connection = 'guest';
      yourPlayState.verification = 'guest';
      renderYourPlay();
      renderWalletDisplays();
      void syncServerWallet();
      return;
    }
    if (!res.ok) {
      yourPlayState.verification = 'unavailable';
      renderYourPlay();
      return;
    }
    const data = await readHubApiJson(res, 'profile_failed');
    if (!isCurrentHubAuth(auth)) return;
    updateYourPlayFromProfile(data);
    if (data?.verification) setWalletVerificationUi(data.verification);
  } catch {
    if (!isCurrentHubAuth(auth)) return;
    yourPlayState.verification = 'unavailable';
    renderYourPlay();
  }
}

// ── Identity: Discord session OR anonymous guest ─────────────────────────────
// Everyone can play. Anonymous play is saved server-side under a persistent
// guest id, then merged into the player's Discord account when they connect —
// so winnings are never lost just because they haven't verified yet.
const HubGuestKey = 'winlew.hub.guest';
const HubReconciledKey = 'winlew.hub.reconciled';

function initDiscordModeNotice() {
  const notice = document.getElementById('discordModeNotice');
  const text = document.getElementById('discordModeText');
  if (!notice || !text || !RuntimeMode.isDiscordActivity) return;
  text.textContent = 'Discord mode is active. Connecting your Discord rewards session and using deterministic payouts for Activity-safe WinLEW claims.';
  notice.classList.remove('hidden');
}

function setDiscordModeNotice(message, verified = false) {
  const notice = document.getElementById('discordModeNotice');
  const text = document.getElementById('discordModeText');
  if (!notice || !text || !RuntimeMode.isDiscordActivity) return;
  text.textContent = String(message || '');
  notice.classList.remove('hidden');
  notice.classList.toggle('verified', !!verified);
}

function getGuestId() {
  let g = localStorage.getItem(HubGuestKey);
  if (!g || !/^[a-zA-Z0-9_-]{8,64}$/.test(g)) {
    const raw = (window.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
    g = ('g' + raw.replace(/[^a-zA-Z0-9_-]/g, '')).slice(0, 40);
    localStorage.setItem(HubGuestKey, g);
  }
  return g;
}

// ── Server-authoritative winnings ────────────────────────────────────────
// The durable winnings total lives server-side (rewardHistory), keyed to the
// player's Discord id (session) or their guest id. localStorage is an offline
// mirror — so winnings no longer "reset" on cache-clear / new device.

async function getServerWalletTotal() {
  const auth = getAuthContext();
  const url = auth.session
    ? `/api/rewards/history?app=${encodeURIComponent(auth.app)}`
    : `/api/rewards/history?guest=${encodeURIComponent(getGuestId())}`;
  try {
    const res = await hubApiFetch(url);
    if (!isCurrentHubAuth(auth)) return null;
    if (!res.ok) {
      yourPlayState.history = 'unavailable';
      renderYourPlay();
      return null;
    }
    const data = await readHubApiJson(res, 'history_failed');
    if (!isCurrentHubAuth(auth)) return null;
    updateYourPlayFromHistory(data);
    const total = Number(data?.summary?.totalPayout);
    return Number.isFinite(total) ? total : null;
  } catch {
    if (!isCurrentHubAuth(auth)) return null;
    yourPlayState.history = 'unavailable';
    renderYourPlay();
    return null;
  }
}

/** Reconcile the displayed wallet to the server total. For identified players
 *  the server is authoritative. For guests we only sync UP — never wipe local
 *  winnings that predate guest-id recording (they get credited on connect). */
async function syncServerWallet() {
  const auth = getAuthContext();
  const total = await getServerWalletTotal();
  if (total === null || !isCurrentHubAuth(auth)) return false;
  if (auth.session) {
    saveWallet(total); // identified: server wins
  } else if (total > loadWallet()) {
    saveWallet(total); // guest: bump up only, preserve un-migrated local total
  }
  return true;
}

async function postRewardClaim(payload) {
  const auth = getAuthContext();
  const meta = {
    ...(payload?.meta && typeof payload.meta === 'object' ? payload.meta : {}),
    surface: RuntimeMode.platform,
    rewardMode: RuntimeMode.rewardMode,
  };
  // Identified → session; anonymous → guest id (still recorded + validated).
  const body = auth.session
    ? { session: auth.session, app: auth.app, ...payload, meta }
    : { guestId: getGuestId(), ...payload, meta };
  try {
    const res = await hubApiFetch('/api/rewards/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readHubApiJson(res, 'claim_failed');
    // After a round is durably recorded, refresh the display from the server total.
    if (data && data.ok && isCurrentHubAuth(auth)) void syncServerWallet();
    return data;
  } catch (error) {
    return { ok: false, error: error?.message || 'claim_failed' };
  }
}

/**
 * Reconciles an optimistic local credit against the server's authoritative
 * claim result, in both directions.
 *
 * Every game credits the wallet immediately with its OWN computed payout for
 * a responsive UI, then posts the claim. The server may bank a smaller
 * amount (a flagged/clamped claim), reject it outright, or confirm it as
 * submitted — and syncServerWallet()'s guest branch only ever bumps the
 * displayed total UP, never down (see its own comment), so a clamped or
 * rejected claim could otherwise leave a guest's local balance permanently
 * overstating what is actually stored and payable. This corrects THIS
 * claim's optimistic credit to match reality the moment the response
 * arrives, for guests and authenticated players alike, instead of relying
 * on the one-directional background sync to eventually paper over it.
 *
 * Returns the same result shape postRewardClaim() does, so callers already
 * passing that promise into showRewardOverlay()'s `{ immediate, sync }`
 * contract (which reads only `.ok` for its own status text) keep working
 * unchanged.
 *
 * Does not call syncServerWallet() itself: postRewardClaim() already fires
 * it on a successful claim, and a failed/rejected claim changed nothing
 * server-side to resync.
 */
async function reconcileClaimResult(optimisticPayout, claimPromise) {
  const auth = getAuthContext();
  let result;
  try {
    result = await claimPromise;
  } catch (error) {
    result = { ok: false, error: error?.message || 'claim_failed' };
  }
  if (!isCurrentHubAuth(auth)) return result;
  const optimistic = Number(optimisticPayout || 0);
  if (result && result.ok) {
    const authoritative = Number(result.payout || 0);
    const delta = Number((authoritative - optimistic).toFixed(2));
    if (delta) addWallet(delta);
  } else if (optimistic) {
    // Rejected/failed outright: the optimistic credit never happened server-side.
    addWallet(-optimistic);
  }
  renderWalletDisplays();
  return result;
}

/** On connect: merge this browser's guest winnings into the Discord account and
 *  credit any pre-guest-id local total (capped, server-side). Runs once per guest. */
async function reconcileGuest() {
  const auth = getAuthContext();
  if (!auth.session) return;
  const guestId = localStorage.getItem(HubGuestKey);
  if (!guestId) return;
  const mirrorOwner = localStorage.getItem(WalletOwnerKey);
  // Retain unlabelled legacy guest migration, never a member-owned mirror.
  const localTotal = !mirrorOwner || mirrorOwner === 'guest' ? loadWallet() : 0;
  // Always ask the idempotent server reconciliation endpoint. The same durable
  // guest can earn again after a logout; a local "already merged" marker must
  // never strand those later events.
  try {
    const res = await hubApiFetch('/api/rewards/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: auth.session, guestId, localTotal }),
    });
    const data = await readHubApiJson(res, 'reconcile_failed');
    if (res.ok && data && data.ok && isCurrentHubAuth(auth)) {
      localStorage.setItem(HubReconciledKey, guestId);
      await syncServerWallet();
    }
  } catch (error) {
    console.warn('[reconcile] failed:', error);
  }
}

function applyDiscordActivitySession(detail = {}) {
  if (!detail || !detail.session) return;
  yourPlayState.connection = 'confirmed';
  localStorage.setItem(AuthKeys.session, detail.session);
  localStorage.setItem(AuthKeys.app, detail.app || 'mole');
  if (detail?.verification?.wallet) {
    localStorage.setItem(AuthKeys.wallet, detail.verification.wallet);
    localStorage.setItem(HubWalletKey, detail.verification.wallet);
    setWalletConnectedUi(detail.verification.wallet);
  } else {
    setWalletConnectedUi(localStorage.getItem(AuthKeys.wallet) || localStorage.getItem(HubWalletKey) || 'connected');
  }
  if (detail.verification) setWalletVerificationUi(detail.verification, detail.warning || '');
  setDiscordModeNotice(
    detail?.verification?.verified
      ? 'Discord mode is active. Rewards are connected to your verified WinLEW profile, and deterministic Activity payouts are enabled.'
      : 'Discord mode is active. Your Discord rewards session is connected. Deterministic Activity payouts are enabled; verify your wallet on Discord to unlock token payouts if needed.',
    !!detail?.verification?.verified,
  );
  updateGuestNudge();
  void reconcileGuest();
  void syncServerWallet();
}

function initDiscordActivityAuth() {
  if (!RuntimeMode.isDiscordActivity) return;
  const bridge = window.WinLEWDiscordActivity;
  if (bridge?.state?.status === 'ready' && bridge.state.session) {
    applyDiscordActivitySession(bridge.state);
  }
  window.addEventListener('winlew:discord-activity-ready', (event) => {
    applyDiscordActivitySession(event.detail || {});
  });
  window.addEventListener('winlew:discord-activity-error', (event) => {
    const detail = event.detail || {};
    console.warn('[discord-activity] failed:', detail.error || detail);
    setDiscordModeNotice('Discord mode is active, but the automatic Discord rewards handshake failed. You can still play; claims will fall back until the session reconnects.');
  });
}

// ── Wallet connect (web identity) ────────────────────────────────────────
// Lets a web-only player (not launched from a Discord link) identify by signing
// a challenge with GeoWallet/Phantom. The wallet resolves to its Discord-linked
// account server-side and mints a session, so winnings persist. Discord stays
// the canonical identity.
const HubWalletKey = 'winlew.hub.wallet';

// Provider detection, the mobile deep-link picker, and the API-base bridge
// are shared platform primitives now (/assets/wallet-auth.js, loaded before
// this file) — Mole Hub was the original, most complete implementation of
// all of this, and Faucet/Quiz/Verify's profile signing were ported from it
// earlier. This file keeps its own walletLogin() below rather than the
// shared generic one, because it has real extra steps (wallet-verification
// UI, guest-winnings reconciliation, server wallet sync) tightly interleaved
// with the login flow — but the low-level building blocks it calls are the
// same ones every other app uses, not a second copy of them.
const {
  isMobileDevice,
  getHubWalletProviders,
  walletProviderHelp,
  connectHubWalletProvider,
  showMobileWalletPicker,
} = window.WinLEWAuth;

function setWalletConnectedUi(walletOrLabel) {
  const btn = document.getElementById('navWalletConnect');
  if (!btn) return;
  if (walletOrLabel) {
    const w = String(walletOrLabel);
    const short = w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
    btn.textContent = w === 'connected' ? 'Connected ✓' : `◎ ${short}`;
    btn.classList.add('active');
    btn.title = 'Wallet connected — your winnings are saving to your account';
  } else {
    yourPlayState.connection = 'guest';
    btn.textContent = 'Connect wallet';
    btn.classList.remove('active');
    btn.title = 'Connect your wallet so your winnings save (links to your Discord-verified wallet)';
  }
  renderYourPlay();
}

async function walletLogin(triggerBtn) {
  if (!getHubWalletProviders().length) {
    if (isMobileDevice()) {
      // No wallet is injected into a plain mobile browser tab. Let the user
      // pick which wallet app to hand off to on this same URL, so the whole
      // connect/sign flow finishes here instead of forcing a detour through
      // /verify/.
      showMobileWalletPicker(triggerBtn || document.getElementById('navWalletConnect'));
      return;
    }
    alert(walletProviderHelp());
    return;
  }
  const btn = document.getElementById('navWalletConnect');
  const restore = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    const connected = await connectHubWalletProvider();
    const provider = connected?.provider;
    const wallet = connected?.wallet || '';
    if (!provider || !wallet) throw new Error('No compatible Solana wallet found');

    const chRes = await hubApiFetch('/api/hub/wallet-login/challenge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const ch = await readHubApiJson(chRes, 'challenge_failed');
    if (!ch || !ch.message) throw new Error((ch && ch.error) || 'challenge_failed');

    const encoded = new TextEncoder().encode(ch.message);
    const signed = await provider.signMessage(encoded, 'utf8');
    const raw = signed && signed.signature;
    const sigBytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw || []);
    if (sigBytes.length !== 64) throw new Error(`unexpected_signature_length:${sigBytes.length}`);
    const signature = JSON.stringify(Array.from(sigBytes));

    const liRes = await hubApiFetch('/api/hub/wallet-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature, message: ch.message }),
    });
    const li = await readHubApiJson(liRes, 'wallet_login_failed');
    if (!li || !li.session) {
      throw new Error((li && li.error) || 'wallet_login_failed');
    }

    localStorage.setItem(AuthKeys.session, li.session);
    localStorage.setItem(AuthKeys.app, li.app || 'mole');
    localStorage.setItem(AuthKeys.wallet, wallet);
    localStorage.setItem(HubWalletKey, wallet);
    yourPlayState.connection = 'confirmed';
    setWalletConnectedUi(wallet);
    setWalletVerificationUi(li.verification, li.warning || '');
    await reconcileGuest();   // merge guest winnings + credit pre-existing local total
    await syncServerWallet();
    updateGuestNudge();
  } catch (error) {
    console.warn('[wallet-login] failed:', error);
    if (btn && restore) btn.textContent = restore;
    const message = /unsupported method:\s*sol_connect/i.test(String(error?.message || error))
      ? 'Oxyon Wallet\'s Solana connector is not available in this browser. Open the page with Phantom or Solflare, then connect the wallet you verified on Discord.'
      : (error?.message || error);
    alert('Wallet connect failed: ' + message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updateGuestNudge() {
  const el = document.getElementById('guestNudge');
  if (el) el.classList.toggle('hidden', !!getAuthContext().session);
}

function initWalletConnect() {
  const btn = document.getElementById('navWalletConnect');
  if (btn) btn.addEventListener('click', () => void walletLogin(btn));
  const nudgeBtn = document.getElementById('guestNudgeBtn');
  if (nudgeBtn) nudgeBtn.addEventListener('click', () => void walletLogin(nudgeBtn));
  // Reflect existing identity (Discord session or a prior wallet connect).
  if (getAuthContext().session) {
    setWalletConnectedUi(localStorage.getItem(HubWalletKey) || 'connected');
    restoreWalletVerificationUi();
    void refreshWalletVerification();
    void reconcileGuest(); // arrivals via Discord verify link may have guest winnings
  }
  updateGuestNudge();
}

syncAuthFromUrl();
const rewardOverlay = document.getElementById('rewardOverlay');
const rewardTitle = document.getElementById('rewardTitle');
const rewardBadge = document.getElementById('rewardBadge');
const rewardText = document.getElementById('rewardText');
const rewardBoxes = document.getElementById('rewardBoxes');
const rewardResult = document.getElementById('rewardResult');
const rewardContinueBtn = document.getElementById('rewardContinueBtn');

function hideRewardOverlay() {
  rewardOverlay.classList.add('hidden');
  rewardOverlay.setAttribute('aria-hidden', 'true');
  rewardBoxes.innerHTML = '';
  rewardResult.classList.add('hidden');
  rewardResult.textContent = '';
  rewardContinueBtn.classList.add('hidden');
  rewardContinueBtn.onclick = null;
}
let rewardOverlayVersion = 0;

function showRewardOverlay({ title, badge = 'Reward reveal', text, boxes = [], onPick, continueLabel = 'Continue', onContinue }) {
  const overlayVersion = ++rewardOverlayVersion;
  rewardTitle.textContent = title;
  rewardBadge.textContent = badge;
  rewardText.innerHTML = text;
  rewardBoxes.innerHTML = '';
  rewardResult.classList.add('hidden');
  rewardResult.textContent = '';
  rewardContinueBtn.classList.add('hidden');
  rewardContinueBtn.textContent = continueLabel;
  rewardContinueBtn.onclick = null;
  rewardOverlay.classList.remove('hidden');
  rewardOverlay.setAttribute('aria-hidden', 'false');

  const formatRewardResult = (value) => {
    if (value && typeof value.then === 'function') return '✨ Finalizing reward...';
    if (value == null) return 'Reward complete.';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      const ok = value.ok ? 'Saved to your profile history.' : (value.skipped ? 'Saved locally. Profile sync skipped.' : 'Saved locally.');
      const reason = value.reason || value.error || '';
      return reason ? `<span class="muted">${ok} ${escapeHtml(reason)}</span>` : `<span class="muted">${ok}</span>`;
    }
    return String(value);
  };

  const reveal = (resultText) => {
    rewardResult.innerHTML = formatRewardResult(resultText);
    rewardResult.classList.remove('hidden');
    rewardContinueBtn.classList.remove('hidden');
    rewardContinueBtn.textContent = continueLabel;
    rewardContinueBtn.onclick = () => {
      hideRewardOverlay();
      if (typeof onContinue === 'function') onContinue();
    };
  };

  const finishProfileSync = (syncPromise) => {
    Promise.resolve(syncPromise).then((remote) => {
      if (overlayVersion !== rewardOverlayVersion) return;
      const syncStatus = rewardResult.querySelector('[data-reward-sync]');
      if (!syncStatus) return;
      syncStatus.textContent = remote?.ok
        ? 'Saved to your profile history.'
        : 'Saved locally. Profile sync is pending.';
    }).catch(() => {
      if (overlayVersion !== rewardOverlayVersion) return;
      const syncStatus = rewardResult.querySelector('[data-reward-sync]');
      if (syncStatus) syncStatus.textContent = 'Saved locally. Profile sync is pending.';
    });
  };

  if (!boxes.length) {
    reveal(text);
    return;
  }

  boxes.forEach((box, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rewardBoxBtn';
    btn.textContent = box.label || `Reward Box ${idx + 1}`;
    btn.onclick = async () => {
      rewardBoxes.querySelectorAll('button').forEach((b) => b.disabled = true);
      btn.classList.add('revealed');
      rewardResult.innerHTML = '✨ Revealing your reward...';
      rewardResult.classList.remove('hidden');
      try {
        const picked = onPick ? onPick(box, idx) : `${box.multiplier || 1}x`;
        if (picked && typeof picked === 'object' && 'immediate' in picked) {
          reveal(`${picked.immediate}<br><span class="muted" data-reward-sync>Saving to your profile...</span>`);
          if (picked.sync) finishProfileSync(picked.sync);
          return;
        }
        reveal(await Promise.resolve(picked));
      } catch (error) {
        reveal(`⚠️ Reward reveal failed.<br><span class="muted">${String(error?.message || 'Please try the next round.')}</span>`);
      }
    };
    rewardBoxes.appendChild(btn);
  });
}
function buildRewardBoxes() {
  if (RuntimeMode.rewardMode === 'deterministic') {
    return [{
      multiplier: 1,
      label: '🎯 Claim Discord Reward'
    }];
  }
  const multipliers = [0.5, 1, 1.5, 2].sort(() => Math.random() - 0.5);
  return multipliers.map((multiplier, index) => ({
    multiplier,
    label: `🎁 Reward Box Pick ${index + 1}`
  }));
}

// Economy balance is centralized so every game can keep its own scoring curve
// without drifting into a much faster token faucet than the others.
const GAME_REWARD_SCALES = Object.freeze({
  grubdrop: 0.08,
  tunneltap: 0.25,
  pacmole: 0.20,
  burrowblaster: 0.35,
  rootglide: 0.60,
  diglew: 0.75,
  molespades: 0.50,
  // Proposed starting value, not a confirmed final balance — see
  // js/games/mole-ice.js's offerRoundReward() for the pre-scale formula.
  moleice: 0.30,
});

function balanceGameReward(game, rawBaseReward) {
  const raw = Math.max(0, Number(rawBaseReward || 0));
  const scale = Number(GAME_REWARD_SCALES[String(game || '').toLowerCase()] ?? 1);
  return Number((raw * scale).toFixed(2));
}

const Sound = {
  enabled: load(Storage.sound, true),
  ctx: null,
  ensure() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (typeof Audio !== 'function') return false;
    try {
      if (!this.ctx) this.ctx = new Audio();
      if (this.ctx.state === 'suspended') this.ctx.resume()?.catch(() => {});
      return true;
    } catch { return false; }
  },
  blip(freq = 440, time = 0.07, type = 'square', gainValue = 0.03) {
    if (!this.enabled) return;
    if (!this.ensure()) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = gainValue;
    o.connect(g); g.connect(this.ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + time);
    o.stop(this.ctx.currentTime + time);
  },
  coin() { this.blip(760, 0.08, 'triangle', 0.05); setTimeout(() => this.blip(1040, 0.06, 'triangle', 0.04), 45); },
  hurt() { this.blip(160, 0.18, 'sawtooth', 0.06); },
  power() { this.blip(520, 0.08, 'square', 0.04); setTimeout(() => this.blip(660, 0.08, 'square', 0.04), 50); },
  win() { [620, 780, 980].forEach((f, i) => setTimeout(() => this.blip(f, 0.1, 'triangle', 0.05), i * 70)); },
  dash() { this.blip(300, 0.05, 'sawtooth', 0.06); setTimeout(() => this.blip(480, 0.05, 'square', 0.04), 35); }
};
soundToggle.textContent = `Sound: ${Sound.enabled ? 'On' : 'Off'}`;
soundToggle.addEventListener('click', () => {
  Sound.enabled = !Sound.enabled;
  save(Storage.sound, Sound.enabled);
  soundToggle.textContent = `Sound: ${Sound.enabled ? 'On' : 'Off'}`;
  if (Sound.enabled) Sound.coin();
});


function updateGatewayHint() {
  if (window.__catalogUi?.refreshRecommendations) window.__catalogUi.refreshRecommendations();
}

function updateRouteForView(key) {
  const url = new URL(window.location.href);
  if (key === 'diglew') {
    url.searchParams.set('game', 'diglew');
    url.hash = 'diglew';
  } else if (key === 'pac') {
    url.searchParams.set('game', 'pacmole');
    url.hash = 'pacmole';
  } else if (key === 'rootglide') {
    url.searchParams.set('game', 'rootglide');
    url.hash = 'rootglide';
  } else if (key === 'blaster') {
    url.searchParams.set('game', 'burrowblaster');
    url.hash = 'burrowblaster';
  } else if (key === 'grubdrop') {
    url.searchParams.set('game', 'grubdrop');
    url.hash = 'grubdrop';
  } else if (key === 'moleice') {
    url.searchParams.set('game', 'moleice');
    url.hash = 'moleice';
  } else if (key === 'tunneltap') {
    url.searchParams.set('game', 'tunneltap');
    url.hash = 'tunneltap';
  } else if (key === 'molespades') {
    url.searchParams.set('game', 'molespades');
    url.hash = 'molespades';
  } else {
    url.searchParams.delete('game');
    url.hash = '';
  }
  window.history.replaceState({}, '', url.toString());
}

function routeToInitialView() {
  const url = new URL(window.location.href);
  const game = (url.searchParams.get('game') || url.hash.replace('#', '') || '').toLowerCase();
  if (game === 'diglew') return 'diglew';
  if (game === 'pacmole' || game === 'pac') return 'pac';
  if (game === 'rootglide' || game === 'glide') return 'rootglide';
  if (game === 'burrowblaster' || game === 'blaster') return 'blaster';
  if (game === 'grubdrop' || game === 'grub') return 'grubdrop';
  if (game === 'moleice' || game === 'mole-ice') return 'moleice';
  if (game === 'tunneltap' || game === 'tunnel-tap') return 'tunneltap';
  if (game === 'molespades' || game === 'mole-spades' || game === 'cryptospades') return 'molespades';
  return 'hub';
}

function showView(key) {
  Object.entries(views).forEach(([name, el]) => el.classList.toggle('hidden', name !== key));
  homeBtn.classList.toggle('hidden', key === 'hub');
  updateRouteForView(key);
}

// After a game actually starts, bring its play area to the top of the screen so
// players don't have to scroll down past the view header to see the canvas.
function scrollGameIntoView(key) {
  const viewIdMap = { diglew: 'diglewView', pac: 'pacmoleView', rootglide: 'rootglideView', blaster: 'burrowblasterView', grubdrop: 'grubdropView', moleice: 'moleiceView', tunneltap: 'tunneltapView', molespades: 'molespadesView' };
  const view = document.getElementById(viewIdMap[key]);
  if (!view) return;
  const target = view.querySelector('.play-area') || view;
  // Wait a frame so the canvas has been sized by the game before we scroll.
  requestAnimationFrame(() => {
    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch { target.scrollIntoView(); }
  });
}
homeBtn.addEventListener('click', () => { hideRewardOverlay(); showView('hub'); renderHubBoards();
wireLaunchModalEvents(); renderWalletDisplays(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
window.__catalogUi = initCatalogUi({ games: catalogGames, loadWallet });
renderWalletDisplays();
updateGatewayHint();
document.querySelectorAll('[data-launch]').forEach((btn) => btn.addEventListener('click', () => {
  const game = btn.dataset.launch;
  launchReturnFocus = btn;
  if (game === 'diglew') {
    showView('diglew');
    showLaunchModal('diglew');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'pacmole') {
    showView('pac');
    showLaunchModal('pac');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'rootglide') {
    showView('rootglide');
    showLaunchModal('rootglide');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'burrowblaster') {
    showView('blaster');
    showLaunchModal('blaster');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'grubdrop') {
    showView('grubdrop');
    showLaunchModal('grubdrop');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'moleice') {
    showView('moleice');
    showLaunchModal('moleice');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'tunneltap') {
    showView('tunneltap');
    showLaunchModal('tunneltap');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'molespades') {
    showView('molespades');
    showLaunchModal('molespades');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}));


const gameLaunchCopy = {
  diglew: {
    eyebrow: 'Web / 3-road runner',
    title: 'DigLEW',
    desc: 'Read the road, switch lanes, grab blue dash charges, smash cracked-rock gates, chase top-road treasure, and reach the checkpoint reward box. Clean runs now earn extra polish bonuses.',
    image: './assets/diglew-card-600.jpg',
    tips: [
      '⬆️⬇️ Move up/down between three roads — mobile can swipe or use buttons',
      '🟡 Risk Road pays best, but mines and squeeze gates punish greed',
      '🟢 Safe Road helps recovery, but camping it pays less and can still get taxed',
      '🔋 Blue dash charges set up cracked-rock gates',
      '📱 On mobile, swipe up/down or use Road Up / Dash / Road Down buttons',
      '⚡ SPACE / SHIFT / X dashes through cracked rock walls',
      '❤️ Hearts restore health when the tunnel gets rough',
      '🏆 Clean runs can earn a Perfect Road bonus',
      '🎁 Reach the checkpoint to open a reward box'
    ]
  },
  pac: {
    eyebrow: 'Mobile / Arcade maze',
    title: 'Pac-Mole',
    desc: 'Pac-Mole now uses flow-loop maze layouts: fewer dead ends, less repeated border-rim pathing, stronger enemy routes, rotating 2x2 beetle dens, and useful Burrow shortcuts.',
    image: './assets/pacmole-card-600.jpg',
    tips: [
      '🕹️ Move with Arrow keys / WASD — clear every golden worm and glow-globe',
      '🧭 Levels rotate between classic, chamber, ring, switchback, and split-route layouts',
      '✨ Glow-globes trigger power mode so beetles can be chomped for bonus points',
      '🏠 Beetles use a rotating 2x2 den: corner dens most rounds, center den every 4th round',
      '👾 Beetle movement now spreads enemies apart so they do not collapse into one tile',
      '⚡ SPACE uses Burrow traversal after at least one worm is collected',
      '🧱 Burrow shortcuts help, but the maze should keep beetles in the chase',
      '🎁 Clearing a level opens a reward box and continues the 20-level campaign'
    ]
  },
  rootglide: {
    eyebrow: 'Mobile / Tap survival',
    title: 'Root Glide',
    desc: 'Guide Lew through a connected cave route toward the beacon. Brown dirt and solid columns are danger, while the open blue tunnel is the safe route. Protruding gear and roots shrink the opening as rounds get harder.',
    image: './assets/rootglide-card-600.jpg',
    tips: [
      '👆 Tap, click, or press SPACE to hop — holding nothing lets Lew glide forward automatically',
      '🌌 Stay in the open blue tunnel; brown dirt, solid columns, boots, shovels, rocks, roots, and thorn bursts cost a heart',
      '❤️ 3 hearts per expedition — a clipped hazard costs 1 heart (with a moment of safety after), not the whole run',
      '🪱 Golden worms sit near risky edges for bonus points and better reward payouts',
      '⚡ Edge saves, checkpoints, worms, and clean distance improve your rank and banked WinLEW',
      '🏁 Reach the beacon distance to open the reward box, then continue into harder rounds'
    ]
  },
  blaster: {
    eyebrow: 'Mobile / Arcade blaster',
    title: 'Burrow Blaster',
    desc: 'Pilot Lew’s drill-ship through wave-based tunnel combat. Auto-fire clears raiders while you dodge hazards, collect shards, grab special cores, and break boss waves for bigger payouts.',
    image: './assets/burrowblaster-card-600.jpg',
    tips: [
      '🚀 Drag on touch, move with keyboard, or hover/steer on desktop while the drill-ship auto-fires',
      '👾 Raider types include scouts, tanks, splitters, chargers, carriers, and boss guardians',
      '⚠️ Watch warning tells for rocks, side/top shock beams, root sweeps, and boss pressure before they hit',
      '💎 Collect shards and risk shards; carriers and bosses can drop Spread, Laser, Shield, and Burst cores',
      '🛡️ Shield absorbs hits, Burst clears danger, and Spread/Laser change your shot pattern for a short time',
      '🏆 Clear all waves in a round to claim a reward box; rank, combo, shards, bosses, and damage taken affect payout'
    ]
  },
  grubdrop: {
    eyebrow: 'Mobile / Puzzle Tap',
    title: 'Grub Drop',
    desc: 'Rising Burrow: a mole-themed tap puzzle against the clock. Pop clumps of matching grubs while new rows push up from below. Every 30 seconds the rows come faster, and new colours join. Hold out as long as you can, then pick a reward box.',
    image: './assets/grubdrop-card-600.jpg',
    tips: [
      '👆 Tap a group of 2 or more touching same-colored grubs to pop the whole clump',
      '⬆️ A new row rises from the bottom; the bar above the board shows when the next one comes',
      '⏱️ Every 30 seconds rows rise faster, and at levels 3 and 6 a new colour joins',
      '🟥 When the board glows red a column has reached the top: clear it, or the next row ends the run',
      '🔥 Pop again quickly to build a combo, and leave as few lone grubs as you can',
      '🎁 From 600 points your score sets the base payout, then you pick a reward box'
    ]
  },
  moleice: {
    eyebrow: 'Web / Arcade grid puzzle',
    title: 'Mole Ice',
    desc: 'An original Pengo-inspired prototype fresh out of the WinLEW arcade lab. Push ice blocks through a frozen mine to slide, shatter, and crush every Glitch Bug before they corner you.',
    image: './assets/moleice-card-600.jpg',
    tips: [
      '🕹️ Arrow keys / WASD to move and face a direction — SPACE to push',
      '🧊 Pushing ice with nothing behind it shatters it for points',
      '💥 Pushing ice with room to slide sends it sliding until it hits a wall, another block, or a Glitch Bug',
      '⛏️ Crush multiple bugs in a single slide to chain a big combo bonus',
      '❤️ 3 lives per run — a Glitch Bug catching you costs a life',
      '⏸️ P (or the Pause button) pauses mid-round',
      '📱 On mobile, use the on-screen D-pad and PUSH button below the board',
      '🎁 Clearing a mine opens a reward box; new enemy types are still in the lab'
    ]
  },
  tunneltap: {
    eyebrow: 'Mobile / Tap survival',
    title: 'Tunnel Tap',
    desc: 'A fast three-lane cave sprint. Tap either side to dodge falling boulders, wall spikes, and crystal beds while racing toward a safe burrow checkpoint.',
    image: './assets/tunneltap-card-600.jpg',
    tips: [
      'Tap the left or right side of the game to move one lane in that direction',
      'Red warning shadows show where the next hazard is going to land',
      'Falling rocks, steel wall spikes, and crystal beds cost one heart',
      'Collect glowing W coins for score and a stronger checkpoint payout',
      'Survive 30 seconds to reach the safe burrow and open a reward box',
      'Each new tunnel is faster; reaching safety restores one heart'
    ]
  },
  molespades: {
    eyebrow: 'Web / Strategy cards',
    title: 'Mole Spades',
    desc: 'Study all 13 cards, set a contract, and team with Dirt Digger against Molegan and Lady Burrow. Deep Spades are trump and the WinLEW Wild is their highest card.',
    image: './assets/mole-spades-card-v1.png',
    tips: [
      'Study your full hand, then bid 0–7 tricks and select 1×–3× risk',
      'Dirt Digger sits across from you as your partner; team scores are combined',
      'You must follow the led faction whenever your hand can do so',
      'Deep Spades are trump; the WinLEW Wild is highest, and trump cannot lead until broken unless it is all you hold',
      'Exact contracts earn 3× risk; missing by one is safe; larger misses lose risk',
      'Three consecutive tricks and dominant rounds earn Tunnel Drop bonuses',
      'Reach 25 with a unique team lead to finish the match and reveal a WinLEW box',
      'To earn XL1 for Mole Spades, play it from the XL1 Arcade (Play for XL1)'
    ]
  }
};

let pendingLaunchKey = null;
let launchReturnFocus = null;
let launchInProgress = false;
const launchChunkConfig = {
  diglew: { instance: 'diglew', factory: 'diglew', script: './js/games/diglew.js' },
  pac: { instance: 'pac', factory: 'pac', script: './js/games/pac-mole.js' },
  rootglide: { instance: 'rootglide', factory: 'glide', script: './js/games/root-glide.js' },
  blaster: { instance: 'blaster', factory: 'blaster', script: './js/games/burrow-blaster.js' },
  grubdrop: { instance: 'grubdrop', factory: 'grubdrop', script: './js/games/grub-drop.js' },
  moleice: { instance: 'moleice', factory: 'moleice', script: './js/games/mole-ice.js' },
  tunneltap: { instance: 'tunneltap', factory: 'tunneltap', script: './js/games/tunnel-tap.js' },
  molespades: { instance: 'molespades', factory: 'molespades', script: './js/games/mole-spades.js' },
};
function getLaunchModalParts() {
  return {
    modal: document.getElementById('gameLaunchModal'),
    thumb: document.getElementById('gameLaunchThumb'),
    eyebrow: document.getElementById('gameLaunchEyebrow'),
    title: document.getElementById('gameLaunchTitle'),
    desc: document.getElementById('gameLaunchDesc'),
    list: document.getElementById('gameLaunchList'),
  };
}
function showLaunchModal(key){
  wireLaunchModalEvents();
  const ui = getLaunchModalParts();
  const data = gameLaunchCopy[key];
  if (!ui.modal || !data) return;
  if (ui.modal.classList.contains('hidden') && !launchReturnFocus?.isConnected) {
    launchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  pendingLaunchKey = key;
  ui.thumb.src = data.image;
  ui.thumb.alt = data.title + ' preview';
  ui.eyebrow.textContent = data.eyebrow;
  ui.title.textContent = data.title;
  ui.desc.textContent = data.desc;
  ui.list.innerHTML = data.tips.map((tip) => `<li>${tip}</li>`).join('');
  ui.modal.classList.remove('hidden');
  ui.modal.setAttribute('aria-hidden', 'false');
  document.getElementById('gameLaunchGo')?.focus();
}
function hideLaunchModal({ clearPending = true, restoreFocus = true } = {}){
  const ui = getLaunchModalParts();
  if (!ui.modal) return;
  ui.modal.classList.add('hidden');
  ui.modal.setAttribute('aria-hidden', 'true');
  if (clearPending) pendingLaunchKey = null;
  if (restoreFocus && launchReturnFocus?.isConnected) launchReturnFocus.focus();
  if (restoreFocus) launchReturnFocus = null;
}
function getGameInstanceForLaunch(key) {
  if (key === 'diglew') return diglew;
  if (key === 'pac') return pac;
  if (key === 'rootglide') return glide;
  if (key === 'blaster') return blaster;
  if (key === 'grubdrop') return grubdrop;
  if (key === 'moleice') return moleice;
  if (key === 'tunneltap') return tunneltap;
  if (key === 'molespades') return molespades;
  return null;
}
function setGameInstanceForLaunch(key, instance) {
  if (key === 'diglew') diglew = instance;
  if (key === 'pac') pac = instance;
  if (key === 'rootglide') glide = instance;
  if (key === 'blaster') blaster = instance;
  if (key === 'grubdrop') grubdrop = instance;
  if (key === 'moleice') moleice = instance;
  if (key === 'tunneltap') tunneltap = instance;
  if (key === 'molespades') molespades = instance;
}
function setLaunchStatus(message, { keepTips = true } = {}) {
  const ui = getLaunchModalParts();
  if (ui?.desc && message) ui.desc.textContent = message;
  if (!keepTips && ui?.list) ui.list.innerHTML = '';
}
function setLaunchButtonBusy(isBusy) {
  const goBtn = document.getElementById('gameLaunchGo');
  if (!goBtn) return;
  goBtn.disabled = !!isBusy;
  goBtn.textContent = isBusy ? 'Launching…' : 'Go';
}
function waitForExistingGameChunk(key, timeoutMs = 1800) {
  const cfg = launchChunkConfig[key];
  if (!cfg) return Promise.resolve(false);
  if (typeof window.WinLEWGameFactories?.[cfg.factory] === 'function') return Promise.resolve(true);
  const scripts = [...document.querySelectorAll('script[src]')];
  const existing = scripts.find((script) => String(script.getAttribute('src') || '').includes(cfg.script));
  if (!existing) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok || typeof window.WinLEWGameFactories?.[cfg.factory] === 'function');
    };
    existing.addEventListener?.('load', () => finish(true), { once: true });
    existing.addEventListener?.('error', () => finish(false), { once: true });
    setTimeout(() => finish(false), timeoutMs);
  });
}
function injectGameChunk(key) {
  const cfg = launchChunkConfig[key];
  if (!cfg) return Promise.resolve(false);
  if (typeof window.WinLEWGameFactories?.[cfg.factory] === 'function') return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.defer = true;
    script.dataset.gameChunkRetry = key;
    script.src = `${cfg.script}?v=v42-launch-guard-retry-${Date.now()}`;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok && typeof window.WinLEWGameFactories?.[cfg.factory] === 'function');
    };
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    setTimeout(() => finish(false), 8000);
    document.head.appendChild(script);
  });
}
async function ensureGameInstanceForLaunch(key) {
  const cfg = launchChunkConfig[key];
  if (!cfg) return null;
  let game = getGameInstanceForLaunch(key);
  if (game && !game.__missing) return game;

  setLaunchStatus('Loading the game engine… one second.');
  const existingReady = await waitForExistingGameChunk(key);
  if (!existingReady && typeof window.WinLEWGameFactories?.[cfg.factory] !== 'function') {
    setLaunchStatus('The game engine was not ready yet, retrying the chunk now…');
    await injectGameChunk(key);
  }

  game = createGameInstance(cfg.instance, cfg.factory);
  setGameInstanceForLaunch(key, game);
  return game;
}

async function startGameFromLaunchKey(key) {
  if (!key || !gameLaunchCopy[key]) {
    console.warn(`[WinLEW] No pending launch key was available.`);
    setLaunchStatus('⚠️ The launch button lost its game target. Go back to the hub and tap Start again.', { keepTips: false });
    return false;
  }

  const game = await ensureGameInstanceForLaunch(key);
  const launchViewMap = { diglew: 'diglew', pac: 'pac', rootglide: 'rootglide', blaster: 'blaster', grubdrop: 'grubdrop', moleice: 'moleice', tunneltap: 'tunneltap', molespades: 'molespades' };
  const targetView = launchViewMap[key];
  if (targetView && views?.[targetView]?.classList?.contains('hidden')) {
    showView(targetView);
  }
  const starter = key === 'diglew'
    ? (game?.startRun || game?.startOrResume)
    : (game?.startOrResume || game?.startRun);

  if (typeof starter !== 'function' || game?.__missing) {
    console.warn(`[WinLEW] ${key || 'unknown'} game module is not ready.`);
    showLaunchModal(key);
    setLaunchStatus('⚠️ This game engine did not finish loading. Hard refresh once, then tap Start again.');
    return false;
  }

  try {
    starter.call(game);
    return true;
  } catch (error) {
    console.error(`[WinLEW] Failed to launch ${key}.`, error);
    window.WinLEWLastLaunchError = { key, message: error?.message || String(error), stack: error?.stack || '' };
    showLaunchModal(key);
    const detail = error?.message ? ` (${error.message})` : '';
    setLaunchStatus(`⚠️ The game tried to start but hit a launch error${detail}. Open the browser console and copy the red WinLEW line if this repeats.`);
    return false;
  }
}

async function runPendingLaunch(){
  if (launchInProgress) return;
  const key = pendingLaunchKey;
  launchInProgress = true;
  setLaunchButtonBusy(true);
  try {
    const ok = await startGameFromLaunchKey(key);
    if (ok) {
      hideLaunchModal({ clearPending: true, restoreFocus: false });
      scrollGameIntoView(key); // bring the canvas into view instead of the view header
      const activeView = views?.[{ diglew: 'diglew', pac: 'pac', rootglide: 'rootglide', blaster: 'blaster', grubdrop: 'grubdrop', moleice: 'moleice', tunneltap: 'tunneltap', molespades: 'molespades' }[key]];
      activeView?.querySelector('button:not([disabled]), [tabindex="0"]')?.focus();
      launchReturnFocus = null;
    } else if (key) {
      pendingLaunchKey = key;
    }
  } finally {
    launchInProgress = false;
    setLaunchButtonBusy(false);
  }
}
function wireLaunchModalEvents(){
  const modal = document.getElementById('gameLaunchModal');
  const goBtn = document.getElementById('gameLaunchGo');
  const backBtn = document.getElementById('gameLaunchBack');
  const closeBtn = document.getElementById('gameLaunchClose');

  if (goBtn && goBtn.dataset.directWired !== '1') {
    goBtn.dataset.directWired = '1';
    goBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runPendingLaunch();
    });
  }
  const wireBack = (btn) => {
    if (!btn || btn.dataset.directWired === '1') return;
    btn.dataset.directWired = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showView('hub');
      hideLaunchModal();
    });
  };
  wireBack(backBtn);
  wireBack(closeBtn);

  if (!modal || modal.dataset.wired === '1') return;
  modal.dataset.wired = '1';
  modal.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest('#gameLaunchGo')) {
      e.preventDefault();
      e.stopPropagation();
      runPendingLaunch();
      return;
    }
    if (target.closest('#gameLaunchBack') || target.closest('#gameLaunchClose')) {
      e.preventDefault();
      e.stopPropagation();
      showView('hub');
      hideLaunchModal();
      return;
    }
    if (target.closest('[data-close-launch-modal="true"]')) {
      e.preventDefault();
      e.stopPropagation();
      showView('hub');
      hideLaunchModal();
      return;
    }
  }, true);
}
window.WinLEWLaunchDebug = {
  startGameFromLaunchKey,
  runPendingLaunch,
  get pendingLaunchKey() { return pendingLaunchKey; },
  getLaunchModalParts,
  getGameInstanceForLaunch,
};
wireLaunchModalEvents();
window.addEventListener('keydown', (e) => {
  const ui = getLaunchModalParts();
  if (e.key === 'Tab' && ui.modal && !ui.modal.classList.contains('hidden')) {
    const focusable = [...ui.modal.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  if (e.key === 'Escape') {
    if (ui.modal && !ui.modal.classList.contains('hidden')) {
      showView('hub');
      hideLaunchModal();
    }
  }
});

function renderBoardList(el, items, type) {
  if (!el) return;
  el.innerHTML = '';
  if (!items.length) {
    el.innerHTML = '<li>No runs yet.</li>';
    return;
  }
  items.slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    if (type === 'diglew') {
      li.innerHTML = `<strong>${item.score}</strong> pts — R${item.round || 1}, ${item.distance || item.depth || 0}m, ${item.coins || 0} coins, ${item.worms || 0} worms, ${item.gems || item.gold || 0} gems${item.payout ? ` • ${Number(item.payout).toFixed(2)} WinLEW` : ''}`;
    } else if (type === 'glide') {
      li.innerHTML = `<strong>${item.score}</strong> pts — R${item.round || 1}, ${item.distance} m, ${item.checkpoints} checkpoints, ${item.obstacles} obstacles, ${item.worms || 0} worms${item.payout ? ` • ${Number(item.payout).toFixed(2)} WinLEW` : ''}`;
    } else if (type === 'blaster') {
      li.innerHTML = `<strong>${item.score}</strong> pts — R${item.round || 1}, W${item.wave}, ${item.kills} kills, ${item.shards} shards${item.payout ? ` • ${Number(item.payout).toFixed(2)} WinLEW` : ''}`;
    } else if (type === 'moleice') {
      li.innerHTML = `<strong>${item.score}</strong> pts — Round ${item.round || 1}, ${item.crushes || 0} crushes${item.payout ? ` • ${Number(item.payout).toFixed(2)} WinLEW` : ''}`;
    } else if (type === 'tunneltap') {
      li.innerHTML = `<strong>${item.score}</strong> pts — Tunnel ${item.round || 1}, ${item.coins || 0} W coins`;
    } else {
      li.innerHTML = `<strong>${item.score}</strong> pts — L${item.level}, ${item.worms} worms, ${item.beetles} beetles, ${item.dashes || 0} dashes${item.reward ? ` • ${item.reward} WinLEW` : ''}`;
    }
    el.appendChild(li);
  });
}
function renderHubBoards() {
  renderBoardList($('hubDiglewBoard'), load(Storage.diglewBoard, []), 'diglew');
  renderBoardList($('hubPacBoard'), load(Storage.pacBoard, []), 'pac');
  renderBoardList($('hubGlideBoard'), load(Storage.glideBoard, []), 'glide');
  renderBoardList($('hubBlasterBoard'), load(Storage.blasterBoard, []), 'blaster');
}

function nextGridStep(map, start, target, options = {}) {
  const width = map[0].length;
  const height = map.length;
  const dirs = options.dirs || [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
  const passable = options.passable || ((x, y) => !map[y] || map[y][x] !== '#');
  const key = (x, y) => `${x},${y}`;
  const queue = [{ x: start.x, y: start.y }];
  const came = new Map([[key(start.x, start.y), null]]);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === target.x && cur.y === target.y) break;
    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!passable(nx, ny)) continue;
      const nk = key(nx, ny);
      if (came.has(nk)) continue;
      came.set(nk, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  if (!came.has(key(target.x, target.y))) return null;
  let step = { x: target.x, y: target.y };
  while (true) {
    const prev = came.get(key(step.x, step.y));
    if (!prev) return null;
    if (prev.x === start.x && prev.y === start.y) return step;
    step = prev;
  }
}

function pathDistance(map, start, target, options = {}) {
  const width = map[0].length;
  const height = map.length;
  const dirs = options.dirs || [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
  const passable = options.passable || ((x, y) => !map[y] || map[y][x] !== '#');
  const key = (x, y) => `${x},${y}`;
  const queue = [{ x: start.x, y: start.y, d: 0 }];
  const seen = new Set([key(start.x, start.y)]);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === target.x && cur.y === target.y) return cur.d;
    for (const dir of dirs) {
      const nx = cur.x + dir.x;
      const ny = cur.y + dir.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!passable(nx, ny)) continue;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      seen.add(nk);
      queue.push({ x: nx, y: ny, d: cur.d + 1 });
    }
  }
  return Infinity;
}


function makeGameDeps() {
  // Keep native browser APIs bound before passing them into modular game chunks.
  // Modular game chunks run through a dependency bag, so browser-native functions
  // must keep window as their receiver or Chrome can throw "Illegal invocation".
  const raf = typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (fn) => window.setTimeout(() => fn(performance.now()), 16);
  const caf = typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame.bind(window)
    : window.clearTimeout.bind(window);
  const timer = window.setTimeout.bind(window);
  const clearTimer = window.clearTimeout.bind(window);
  return {
    catalogGames, resolveCatalogImage, detectDeviceProfile, recommendationText, shareGame,
    escapeHtml, buildCatalogStat, catalogCardTemplate, initCatalogUi, Storage, views,
    soundToggle, homeBtn, gatewayHint, $, clamp, rand, choice, dist, keyOf, save, load,
    loadWallet, renderWalletDisplays, saveWallet, addWallet, AuthKeys, syncAuthFromUrl,
    getAuthContext, postRewardClaim, getServerWalletTotal, syncServerWallet,
    rewardOverlay, rewardTitle, rewardBadge, rewardText, rewardBoxes,
    rewardResult, rewardContinueBtn, hideRewardOverlay, showRewardOverlay, buildRewardBoxes,
    GAME_REWARD_SCALES, balanceGameReward,
    Sound, updateGatewayHint, updateRouteForView, routeToInitialView, showView, gameLaunchCopy,
    getLaunchModalParts, showLaunchModal, hideLaunchModal, runPendingLaunch, wireLaunchModalEvents,
    renderBoardList, renderHubBoards, nextGridStep, pathDistance, window, document, localStorage,
    performance, requestAnimationFrame: raf, cancelAnimationFrame: caf, navigator, Math, Date, URL,
    URLSearchParams, setTimeout: timer, clearTimeout: clearTimer, console, Image, Path2D, Audio
  };
}

function missingGameModule(name) {
  const warn = () => console.warn(`[WinLEW] ${name} game module was not loaded.`);
  return {
    __missing: true,
    startRun: warn,
    startOrResume: warn,
    startOrResumePac: warn,
    reset() {},
    resetRun() {},
    renderAll() {},
    draw() {}
  };
}

function createGameInstance(name, factoryName = name) {
  const fallback = missingGameModule(name);
  const factory = window.WinLEWGameFactories?.[factoryName];
  if (typeof factory !== 'function') {
    console.warn(`[WinLEW] Missing game factory: ${factoryName}.`);
    return fallback;
  }
  try {
    return factory(makeGameDeps()) || fallback;
  } catch (error) {
    console.error(`[WinLEW] Failed to initialize game factory: ${factoryName}.`, error);
    return fallback;
  }
}

let diglew = createGameInstance('diglew');
let pac = createGameInstance('pac');
let glide = createGameInstance('rootglide', 'glide');
let blaster = createGameInstance('burrowblaster', 'blaster');
let grubdrop = createGameInstance('grubdrop', 'grubdrop');
let moleice = createGameInstance('moleice');
let tunneltap = createGameInstance('tunneltap');
let molespades = createGameInstance('molespades');


renderHubBoards();
renderWalletDisplays();
renderYourPlay();
initDiscordModeNotice();
initDiscordActivityAuth();
// Wallet connect (web identity) + restore the durable winnings total from the server.
initWalletConnect();
void syncServerWallet();
const initialView = routeToInitialView();
showView(initialView);
if (initialView === 'diglew') { showLaunchModal('diglew'); }
if (initialView === 'pac') { showLaunchModal('pac'); }
if (initialView === 'rootglide') { showLaunchModal('rootglide'); }
if (initialView === 'blaster') { showLaunchModal('blaster'); }
if (initialView === 'grubdrop') { showLaunchModal('grubdrop'); }
if (initialView === 'moleice') { showLaunchModal('moleice'); }
if (initialView === 'tunneltap') { showLaunchModal('tunneltap'); }
if (initialView === 'molespades') { showLaunchModal('molespades'); }
