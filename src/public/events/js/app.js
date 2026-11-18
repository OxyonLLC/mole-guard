// WinLEW Community Events — fetches /api/events/status and renders exactly
// what the backend returns. Bucketing (upcoming/live/completed/cancelled)
// comes from the server's classifyEventBucket() (src/mole/eventsData.js),
// never recomputed or guessed on the frontend.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Dates render in UTC, because that is the timezone the records are written
 *  in — every event carries `timezone: "UTC"`.
 *
 *  Without the explicit timeZone this formatted in the READER's zone, and the
 *  campaign (2026-08-18T02:31:22Z) displayed as "Aug 17, 2026" anywhere west of
 *  UTC while its own announcement article says August 18. Two WinLEW pages
 *  disagreeing about the date of the same event is exactly the kind of drift
 *  this site is built to avoid — and it would have been invisible to anyone
 *  reviewing from Europe. */
function fmtDate(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const TYPE_LABELS = {
  'quiz-tournament': '🧠 Quiz Tournament',
  ama: '🎙️ AMA',
  'community-meetup': '👥 Community Meetup',
  'game-competition': '🎮 Game Competition',
  giveaway: '🎁 Giveaway',
  'sponsored-trivia': '💠 Sponsored Trivia',
  hackathon: '🛠️ Hackathon',
  'partnership-event': '🤝 Partnership Event',
  announcement: '📣 Announcement',
  'liquidity-program': '💧 Liquidity Program',
};

const STATUS_LABELS = {
  upcoming: { text: 'Upcoming', cls: 'upcoming' },
  live: { text: 'Live', cls: 'live' },
  completed: { text: 'Completed', cls: 'completed' },
  cancelled: { text: 'Cancelled', cls: 'cancelled' },
  postponed: { text: 'Postponed', cls: 'postponed' },
};

// Poster glyph + label per event type, for the events with no real artwork.
// Typographic on purpose: a generated scene would imply an event looked like
// something it never did. Falls back to the generic mark for an unknown type,
// so a new type added to eventsData.js renders sensibly before this is updated.
const TYPE_POSTERS = {
  'quiz-tournament': { glyph: '🧠', label: 'Quiz Tournament' },
  ama: { glyph: '🎙️', label: 'AMA' },
  'community-meetup': { glyph: '👥', label: 'Community' },
  'game-competition': { glyph: '🎮', label: 'Game' },
  giveaway: { glyph: '🎁', label: 'Giveaway' },
  'sponsored-trivia': { glyph: '💠', label: 'Sponsored Trivia' },
  hackathon: { glyph: '🛠️', label: 'Hackathon' },
  'partnership-event': { glyph: '🤝', label: 'Partnership' },
  announcement: { glyph: '📣', label: 'Announcement' },
  'liquidity-program': { glyph: '💧', label: 'Liquidity' },
};
const DEFAULT_POSTER = { glyph: '⛏️', label: 'Event' };

// Status is NEVER colour alone — each carries a glyph and a word.
const STATUS_GLYPH = { upcoming: '🟡', live: '🟢', completed: '🏆', cancelled: '🔴', postponed: '🟠' };

// Evidence links get an icon from their destination rather than a generic one,
// so a Solscan receipt is distinguishable from an X post at a glance.
function evidenceIcon(url, label) {
  const u = String(url || '');
  const l = String(label || '').toLowerCase();
  if (/solscan\.io|explorer\.solana/.test(u)) return '🔎';
  if (/x\.com|twitter\.com/.test(u)) return '𝕏';
  if (/\/news\//.test(u)) return '📰';
  if (/raydium\.io/.test(u)) return '💧';
  if (/discord/.test(u)) return '💬';
  if (/winner|result/.test(l)) return '🏆';
  return '🔗';
}

const EMPTY_STATES = {
  all: { eyes: '🐹⛏️', title: 'Nothing on the dig schedule… yet.', body: 'New events are announced through Discord and the X Community before they become part of the permanent record.', cta: true },
  upcoming: { eyes: '🐹⛏️', title: 'Nothing on the dig schedule… yet.', body: 'New events are announced through Discord and the X Community first. When one is confirmed, it appears here with its dates and rules.', cta: true },
  live: { eyes: '👀', title: 'Nothing live right now.', body: 'Check what is coming next, or dig through what already happened — every completed event here carries its receipts.', cta: false },
  completed: { eyes: '📜', title: 'No completed events with public evidence yet.', body: 'An event only moves here once its results can be verified publicly. Nothing is listed as completed on our word alone.', cta: false },
  cancelledOrPostponed: { eyes: '✅', title: 'Good news — nothing to report here.', body: 'No event has been cancelled or postponed.', cta: false },
};

let currentBucket = 'all';
let lastGroups = null;
let countdownTimer = null;

function dateRangeText(event) {
  const start = fmtDate(event.startIso);
  const end = fmtDate(event.endIso);
  if (start && end && start !== end) return `${start} → ${end}`;
  if (start) return start;
  return 'Date to be announced';
}

function bucketOf(event, groups) {
  if (groups.upcoming.includes(event)) return 'upcoming';
  if (groups.live.includes(event)) return 'live';
  if (groups.completed.includes(event)) return 'completed';
  return 'cancelledOrPostponed';
}

/** The 5:2 banner. Real artwork when the record has it, a typographic poster
 *  built from the event's own type when it does not. */
function posterHtml(event, { eager = false } = {}) {
  if (event.image) {
    return `<div class="eventPoster t-${esc(event.type)}">
      <img src="${esc(event.image)}" alt="${esc(event.imageAlt || event.title || 'Event artwork')}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" />
    </div>`;
  }
  const p = TYPE_POSTERS[event.type] || DEFAULT_POSTER;
  // The category name IS the artwork here — see .isFallback in the page CSS for
  // why a lone glyph was not enough. role="img" + aria-label so a screen reader
  // gets the category once, not the decorative glyph as well.
  return `<div class="eventPoster isFallback t-${esc(event.type)}" role="img" aria-label="${esc(p.label)} event">
    <span class="posterGlyph" aria-hidden="true">${p.glyph}</span>
    <span class="posterLabel">WinLEW</span>
    <span class="posterKind">${esc(p.label)}</span>
  </div>`;
}

/** Reward, lifted out of the paragraph it used to be buried in. The full text
 *  is preserved underneath — several rewards are deliberately hedged
 *  ("Committed: … Discretionary and NOT promised: …") and truncating that to a
 *  headline number is exactly how a conditional prize becomes a promise. */
function rewardHtml(event) {
  if (!event.rewards) return '';
  const text = String(event.rewards).trim();
  // "N/A" is a record saying there was no reward — the 2BRZ partnership is one.
  // Rendering a REWARD callout that reads "See details / N/A" invents a prize
  // slot where the record explicitly says none exists.
  if (/^(n\/?a|none|no rewards?)\.?$/i.test(text)) return '';
  // A leading amount, when the record starts with one, becomes the headline.
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*(?:WinLEW|\$WinLEW)/i);
  // No figure in the record means no figure on the card. "Not yet published" is
  // the honest headline for an event whose amount genuinely is not decided —
  // "See details" would imply a number is waiting behind a click.
  const unpublished = /not (yet )?published|not specified|to be (determined|announced)/i.test(text);
  const headline = match ? `${match[1]} $WinLEW` : (unpublished ? 'Not yet published' : 'See details');
  // The bar carries the headline and a CLAMPED note; the unabridged text lives
  // in the disclosure below, never truncated away. Several rewards are
  // deliberately hedged ("Committed: … Discretionary and NOT promised: …") and
  // a headline number alone would turn a conditional prize into a promise.
  return `<div class="rewardBar">
    <span class="rewardIcon" aria-hidden="true">🏆</span>
    <div>
      <div class="rewardLabel">Reward</div>
      <div class="rewardValue">${esc(headline)}</div>
      <div class="rewardNote clamp3">${esc(text)}</div>
    </div>
  </div>`;
}

/** The long-form fields, folded into a native <details>.
 *
 *  WHY: on a 390px screen the eligibility and rewards paragraphs made a single
 *  card ~2,000px tall — the whole page was 18,000px and the buttons on every
 *  card sat below the fold. Nothing is removed or truncated: <details> keeps
 *  the full text in the DOM, keyboard-operable and findable, and is announced
 *  properly by screen readers without any ARIA of our own. */
function detailsHtml(event, resultsHtml) {
  const parts = [];
  if (event.eligibility) parts.push(`<p class="muted"><strong>Eligibility:</strong> ${esc(event.eligibility)}</p>`);
  if (event.rewards) parts.push(`<p class="muted"><strong>Rewards, in full:</strong> ${esc(event.rewards)}</p>`);
  if (event.rules) parts.push(`<p class="muted"><strong>Rules:</strong> ${esc(event.rules)}</p>`);
  if (resultsHtml) parts.push(resultsHtml);
  if (!parts.length) return '';
  return `<details class="eventDetails">
    <summary>Eligibility, rules &amp; results</summary>
    ${parts.join('')}
  </details>`;
}

/** Whole units remaining until `iso`, or null when there is no real future
 *  timestamp. Never invents one — an event with no startIso gets no countdown. */
function countdownParts(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return [{ n: days, l: days === 1 ? 'Day' : 'Days' }, { n: hours, l: 'Hours' }, { n: mins, l: 'Mins' }];
}

function countdownHtml(event) {
  const parts = countdownParts(event.startIso);
  if (!parts) return '';
  return `<div class="countdown" data-countdown="${esc(event.startIso)}" aria-label="Time until this event starts">
    ${parts.map((p) => `<div class="cdUnit"><div class="n">${String(p.n).padStart(2, '0')}</div><div class="l">${esc(p.l)}</div></div>`).join('')}
  </div>`;
}

/** Re-renders every countdown in place, once a minute. Minute resolution, so a
 *  seconds ticker never forces a repaint on a page that is mostly static. */
function tickCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const parts = countdownParts(el.getAttribute('data-countdown'));
    if (!parts) { el.remove(); return; }
    el.querySelectorAll('.cdUnit').forEach((unit, i) => {
      const n = unit.querySelector('.n');
      if (n && parts[i]) n.textContent = String(parts[i].n).padStart(2, '0');
    });
  });
}

function renderEventCard(event, groups, featured) {
  const el = document.createElement('div');
  el.className = featured ? 'eventCard featured' : 'eventCard';
  el.id = `event-${event.id}`;

  const bucket = bucketOf(event, groups);
  const statusInfo = STATUS_LABELS[event.status] || STATUS_LABELS[bucket] || { text: event.status, cls: 'completed' };
  const featuredBadge = featured ? '<div class="featuredBadge">⭐ Next up</div>' : '';

  const evidenceLinks = (event.evidence || [])
    .map((e) => `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">${evidenceIcon(e.url, e.label)} ${esc(e.label)} ↗</a>`)
    .join('');
  const participateLink = event.participationUrl
    ? `<a class="btn primary" href="${esc(event.participationUrl)}" target="_blank" rel="noreferrer">Participate ↗</a>`
    : '';

  // The full write-up, when one exists. Internal link, so no target="_blank" —
  // the evidence buttons open externally and this deliberately does not, since
  // it stays on winlew.co.
  const articleLink = event.articleUrl
    ? `<a class="btn" href="${esc(event.articleUrl)}">Full rules &amp; announcement</a>`
    : '';

  const resultsHtml = event.results && (event.results.summary || event.results.standingsUrl)
    ? `<p class="muted"><strong>Results:</strong> ${esc(event.results.summary || '')}${event.results.standingsUrl ? ` — <a href="${esc(event.results.standingsUrl)}" target="_blank" rel="noreferrer">standings ↗</a>` : ''}</p>`
    : '';

  if (bucket === 'completed') el.classList.add('isCompleted');

  const glyph = STATUS_GLYPH[statusInfo.cls] || '•';
  const liveDot = statusInfo.cls === 'live' ? '<span class="liveDot" aria-hidden="true"></span>' : '';

  // ORDER MATTERS ON A PHONE: art, then what it is, then status, date, reward
  // and the countdown — all of it above the long prose. The eligibility and
  // description paragraphs are the tallest things on the card and used to push
  // the reward and the buttons off the first screen.
  el.innerHTML = `
    ${featuredBadge}
    ${posterHtml(event)}
    <div class="eventHead">
      <h3>${esc(TYPE_LABELS[event.type] || event.type)} — ${esc(event.title)}</h3>
      <span class="statusPill ${statusInfo.cls}">${liveDot}<span aria-hidden="true">${glyph}</span> ${esc(statusInfo.text)}</span>
    </div>
    <div class="eventMeta">${esc(dateRangeText(event))}${event.host ? ` · Host: ${esc(event.host)}` : ''}</div>
    ${countdownHtml(event)}
    ${rewardHtml(event)}
    <p class="eventSummary clamp4">${esc(event.description || '')}</p>
    ${detailsHtml(event, resultsHtml)}
    ${event.partnerId ? `<p class="muted"><a href="/partners/#partner-${esc(event.partnerId)}">See related partner record →</a></p>` : ''}
    <div class="eventLinks">${participateLink}${articleLink}${evidenceLinks}</div>
  `;
  return el;
}

/** Every event, once, in the order a reader cares about: what is happening
 *  now, what is next, then the record of what already happened. Built from the
 *  server's own buckets — never re-classified here. */
function allEvents(groups) {
  const seen = new Set();
  const out = [];
  for (const bucket of ['live', 'upcoming', 'completed', 'cancelledOrPostponed']) {
    for (const event of groups[bucket] || []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      out.push(event);
    }
  }
  return out;
}

function emptyStateHtml(bucket) {
  const e = EMPTY_STATES[bucket] || EMPTY_STATES.all;
  return `<div class="emptyState">
    <div class="eyes" aria-hidden="true">${e.eyes}</div>
    <h3>${esc(e.title)}</h3>
    <p>${esc(e.body)}</p>
    ${e.cta ? `<a class="btn primary" href="/community/">💬 Join Discord</a>
    <a class="btn" href="https://x.com/i/communities/1890899109684683068" target="_blank" rel="noreferrer">𝕏 Follow the X Community</a>` : ''}
  </div>`;
}

function renderBucket(bucket) {
  currentBucket = bucket;
  document.querySelectorAll('#eventTabs .tab').forEach((btn) => {
    const on = btn.getAttribute('data-bucket') === bucket;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const grid = document.getElementById('eventGrid');
  if (!grid || !lastGroups) return;
  const list = bucket === 'all' ? allEvents(lastGroups) : (lastGroups[bucket] || []);
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = emptyStateHtml(bucket);
    return;
  }
  // Nothing is "featured" inside the grid any more — whatever deserves that
  // treatment is already in the panel above it, and two featured styles on one
  // screen made neither read as special.
  list.forEach((event) => grid.appendChild(renderEventCard(event, lastGroups, false)));
  tickCountdowns();
}

/** The panel above the grid: the live event if there is one, else the next
 *  upcoming one. Hidden outright when there is neither — an empty "LIVE NOW"
 *  band is worse than no band. */
function renderFeature(groups) {
  const box = document.getElementById('featureBox');
  const panel = document.getElementById('featurePanel');
  const eyebrow = document.getElementById('featureEyebrow');
  if (!box || !panel) return;

  const live = (groups.live || [])[0];
  // "Next" is the soonest event that actually has a start date. One without a
  // date is genuinely upcoming but cannot be positioned, so it is not promoted.
  const dated = (groups.upcoming || [])
    .filter((e) => Number.isFinite(Date.parse(e.startIso || '')))
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
  const event = live || dated[0];
  if (!event) { box.classList.add('hidden'); return; }

  const isLive = Boolean(live);
  if (eyebrow) eyebrow.textContent = isLive ? '🔴 Live now' : '👀 Next up';

  const cta = event.participationUrl
    ? `<a class="btn primary" href="${esc(event.participationUrl)}" target="_blank" rel="noreferrer">${isLive ? 'Join the event ↗' : 'Take part ↗'}</a>`
    : '';
  const readMore = event.articleUrl ? `<a class="btn" href="${esc(event.articleUrl)}">📰 Full rules &amp; announcement</a>` : '';

  panel.innerHTML = `
    ${posterHtml(event, { eager: true })}
    <div>
      <span class="statusPill ${isLive ? 'live' : 'upcoming'}">
        ${isLive ? '<span class="liveDot" aria-hidden="true"></span>' : ''}<span aria-hidden="true">${isLive ? '🟢' : '🟡'}</span> ${isLive ? 'Live now' : 'Upcoming'}
      </span>
      <h2 style="margin-top:10px;">${esc(event.title)}</h2>
      <div class="eventMeta">${esc(dateRangeText(event))}${event.host ? ` · Host: ${esc(event.host)}` : ''}</div>
      ${countdownHtml(event)}
      ${rewardHtml(event)}
      <p class="eventSummary clamp4">${esc(event.description || '')}</p>
      <div class="eventLinks">${cta}${readMore}</div>
    </div>`;
  box.classList.remove('hidden');
  tickCountdowns();
}

/** The permanent record as a timeline. Only real event records with a real
 *  date — never a news article, and never an undated event, which would have
 *  to be placed by guesswork. */
function renderTimeline(groups) {
  const box = document.getElementById('timelineBox');
  const list = document.getElementById('eventTimeline');
  if (!box || !list) return;

  const dated = allEvents(groups)
    .filter((e) => Number.isFinite(Date.parse(e.startIso || '')))
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
  if (!dated.length) { box.classList.add('hidden'); return; }

  let html = '';
  let year = null;
  for (const e of dated) {
    const y = new Date(Date.parse(e.startIso)).getUTCFullYear();
    if (y !== year) { year = y; html += `<li class="tlYear">${y}</li>`; }
    const isLive = (groups.live || []).some((x) => x.id === e.id);
    html += `<li class="tlItem${isLive ? ' isLive' : ''}">
      <div class="tlDate">${esc(fmtDate(e.startIso) || '')}${isLive ? ' · live' : ''}</div>
      <div class="tlName">${esc(event_titleFor(e))}</div>
    </li>`;
  }
  list.innerHTML = html;
  box.classList.remove('hidden');
}

function event_titleFor(e) {
  return `${(TYPE_POSTERS[e.type] || DEFAULT_POSTER).glyph} ${e.title}`;
}

async function loadEventsStatus() {
  try {
    const res = await hubApiFetch('/api/events/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'events_status_failed');
    lastGroups = data.groups || { upcoming: [], live: [], completed: [], cancelledOrPostponed: [] };
    renderFeature(lastGroups);
    renderTimeline(lastGroups);
    renderBucket(currentBucket);
    const liveCard = document.getElementById('statCardLive');
    if (liveCard) liveCard.classList.toggle('isLive', (lastGroups.live || []).length > 0);
    // Minute resolution: nothing here needs a seconds ticker, and a repaint
    // every second on a mostly static page is wasted battery.
    if (!countdownTimer) countdownTimer = setInterval(tickCountdowns, 60000);

    const heroUpcoming = document.getElementById('heroEventsUpcoming');
    if (heroUpcoming) heroUpcoming.textContent = lastGroups.upcoming.length;
    const heroCompleted = document.getElementById('heroEventsCompleted');
    if (heroCompleted) heroCompleted.textContent = lastGroups.completed.length;
    const heroLive = document.getElementById('heroEventsLive');
    if (heroLive) heroLive.textContent = lastGroups.live.length;
    const heroCancelled = document.getElementById('heroEventsCancelled');
    if (heroCancelled) heroCancelled.textContent = lastGroups.cancelledOrPostponed.length;
  } catch (e) {
    console.warn('[events] status load failed:', e);
    const grid = document.getElementById('eventGrid');
    if (grid) grid.innerHTML = '<p class="muted">⚠️ Could not load event records right now. Try refreshing.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#eventTabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => renderBucket(btn.getAttribute('data-bucket')));
  });
  loadEventsStatus();
});

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
