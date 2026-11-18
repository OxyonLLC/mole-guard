(function () {
  'use strict';
  const allowed = {
    diglew: ['DigLEW', 'diglew'], pacmole: ['Pac-Mole', 'pac'],
    rootglide: ['Root Glide', 'rootglide'], burrowblaster: ['Burrow Blaster', 'blaster'],
    tunneltap: ['Tunnel Tap', 'tunneltap'], moleice: ['Mole Ice', 'moleice'],
    molespades: ['Mole Spades', 'molespades'],
    grubdrop: ['Grub Drop', 'grubdrop'],
  };
  const game = new URLSearchParams(location.search).get('game');
  const frame = document.getElementById('game');
  const badge = document.getElementById('reward-state');
  if (!Object.hasOwn(allowed, game)) { location.replace('/xl1/arcade/'); return; }
  document.getElementById('game-name').textContent = allowed[game][0];
  document.title = `${allowed[game][0]} — XL1 Arcade`;

  frame.addEventListener('load', async () => {
    const win = frame.contentWindow;
    // Games scroll themselves into view when a round starts. scrollIntoView also scrolls every
    // page around the frame, which on a phone pushed this page down to blank space. Inside the
    // arcade a game may only scroll its own frame.
    if (win.Element?.prototype) win.Element.prototype.scrollIntoView = function (options) {
      const top = this.getBoundingClientRect().top + win.scrollY;
      const block = typeof options === 'object' && options ? options.block : (options === false ? 'end' : 'start');
      const y = block === 'end' ? top - win.innerHeight + this.getBoundingClientRect().height : top;
      win.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    };
    // Each game's "Back to Hub" (#…HomeTop) leaves the arcade for the Mole Hub; here it returns
    // to the arcade page.
    win.document?.addEventListener?.('click', event => {
      if (!event.target.closest?.('[id$="HomeTop"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      location.assign('/xl1/arcade/');
    }, true);
    // On phones the frame ended up at the bottom of the page when a round ended (owner, 2026-10-23).
    // Games reveal their side panels then (DigLEW: resources, upgrades, notes, log), which stack
    // ABOVE the game on a narrow screen and doubled the page; the browser's scroll anchoring then
    // left the frame at the footer. So: no scroll anchoring, nothing below the game that the arcade
    // doesn't need (the Best Runs list, the hub and site footers), and whenever the layout changes
    // or the frame scrolls on its own while the player is not touching or scrolling, the game is
    // brought back into view. The reward card is fixed on top of it, so nothing is hidden.
    const doc = win.document;
    if (doc?.createElement && doc.head) {
      const style = doc.createElement('style');
      // Pac-Mole's rightbar holds its Level Select, so it stays. Mole Spades' currency rail still says
      // XL1 is "planned", which is no longer true in the arcade.
      style.textContent = 'html{overflow-anchor:none}#catalogFooter,.wlSiteFooter,#molespadesView .ms-currency.planned{display:none!important}@media (max-width:900px){.view:not(#pacmoleView) .rightbar{display:none!important}}';
      doc.head.appendChild(style);
    }
    if (typeof win.addEventListener === 'function' && typeof win.requestAnimationFrame === 'function') {
      let gestureAt = 0;
      let pending = 0;
      // Any sign the player is moving the page themselves, including a momentum fling still running.
      for (const type of ['touchstart', 'touchmove', 'touchend', 'wheel', 'keydown', 'pointerdown', 'mousedown']) win.addEventListener(type, () => { gestureAt = Date.now(); }, { passive: true, capture: true });
      const keepGameInView = () => {
        if (pending || Date.now() - gestureAt < 3000) return;
        pending = win.requestAnimationFrame(() => {
          pending = 0;
          const stage = doc.querySelector('.view:not(.hidden) canvas, .view:not(.hidden) .mole-spades-board');
          if (!stage) return;
          const r = stage.getBoundingClientRect();
          if (r.height === 0 || (r.bottom > 0 && r.top < win.innerHeight)) return;   // hidden, or still on screen
          win.scrollTo({ top: Math.max(0, r.top + win.scrollY), behavior: 'auto' });
        });
      };
      // Layout changes only (a scroll alone is the player's, or the game's own scrollIntoView).
      if (typeof win.ResizeObserver === 'function' && doc.body) new win.ResizeObserver(keepGameInView).observe(doc.body);
    }
    const originalFetch = win.fetch.bind(win);
    let rewardSession;
    let rewardSessionAt = 0;
    let pendingStart;
    // The server expires a session 10 minutes after the round cap. A player who waits on a menu
    // longer would lose their next round, so a waiting session is renewed every 10 minutes (the
    // renewal supersedes it; a round already under way is then paid from the renewal).
    if (typeof setInterval === 'function') setInterval(() => { if (rewardSession && Date.now() - rewardSessionAt > 600000) void startSession(); }, 60000);
    const claims = new Map();
    // One reward session covers one round, but most games report the running total of the whole
    // run at each round end. Send only what this round added, or later rounds would be judged (and
    // paid) on points already rewarded. A lower total means a new run started. Mole Ice reports
    // each mine's own score, Mole Spades each match's, and Root Glide each round's distance.
    // Burrow Blaster reports no score at all: its kill count (a running total) shows the round was
    // really played. Rewards are paid for time played; this only has to prove the round was real.
    const PER_ROUND = { moleice: 'roundScore', molespades: 'score', rootglide: 'distance' };
    const RUNNING = { burrowblaster: 'kills' };
    let runTotal = 0;
    function roundScore(claim) {
      const field = PER_ROUND[game] ?? RUNNING[game] ?? 'score';
      const value = claim.meta?.[field];
      if (!Number.isSafeInteger(value) || value < 0) return null;
      if (Object.hasOwn(PER_ROUND, game)) return value;
      if (value < runTotal) runTotal = 0;
      const added = value - runTotal;
      runTotal = value;
      return added;
    }

    async function startSession() {
      if (game === 'grubdrop') { badge.textContent = 'Rewards: not enabled'; return null; }
      if (pendingStart) return pendingStart;
      pendingStart = (async () => {
        try {
          const response = await win.WinLEWAuth.hubApiFetch('/api/xl1-arcade/sessions', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'unavailable');
          rewardSession = data;
          rewardSessionAt = Date.now();
          return data;
        } catch (error) {
          badge.textContent = ['authentication_required', 'verified_xl1_wallet_required'].includes(error.message)
            ? 'Rewards: connect a verified XL1 wallet'
            // Earning needs a Discord account of a minimum age; play stays open (reward-engine.js).
            : error.message === 'discord_account_too_new' ? 'Rewards: your Discord account is too new to earn yet'
            : 'Rewards: unavailable';
          return null;
        }
      })();
      try { return await pendingStart; } finally { pendingStart = null; }
    }

    async function complete(session, rawScore) {
      // Retrying uses the exact same session/nonce/score, never a new award.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await win.WinLEWAuth.hubApiFetch(`/api/xl1-arcade/sessions/${encodeURIComponent(session.sessionId)}/complete`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ nonce: session.nonce, rawScore }),
          });
          const result = await response.json();
          if (!response.ok || !result.reward) {
            badge.textContent = 'Reward rejected';
            return { ok: false, error: result.error || 'reward_rejected', payout: 0 };
          }
          const reward = result.reward;
          badge.textContent = `${reward.status === 'SIMULATED' ? 'Simulated' : reward.status}: +${reward.actualXl1} XL1`;
          return { ok: true, payout: 0, xl1Reward: reward };
        } catch {
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      badge.textContent = 'Reward status unknown; check activity';
      return { ok: false, error: 'reward_status_unknown', payout: 0 };
    }

    // Intercept BEFORE sending: embedded play must never also create a WINLEW
    // claim in the canonical hub ledger. Other hub requests keep their behavior.
    win.fetch = async function (input, init) {
      const url = new URL(typeof input === 'string' ? input : input?.url || String(input), win.location.href);
      const requestPath = url.pathname.endsWith('/api-proxy.php') ? url.searchParams.get('path') : url.pathname;
      if (requestPath !== '/api/rewards/claim') return originalFetch(input, init);
      let claim;
      try {
        claim = JSON.parse(init?.body ?? await input.clone().text());
      } catch { return new win.Response(JSON.stringify({ ok: false, error: 'claim_invalid', payout: 0 }), { status: 400 }); }
      const respond = result => new win.Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
      if (game === 'grubdrop' || claim.game !== game) return respond({ ok: false, skipped: true, payout: 0 });
      const rawScore = roundScore(claim);
      if (rawScore == null || !claim.roundKey) {
        return respond({ ok: false, error: 'claim_invalid', payout: 0 });
      }
      const key = String(claim.roundKey);
      if (!claims.has(key)) {
        const session = rewardSession;
        if (!session) return respond({ ok: false, error: 'reward_session_unavailable', payout: 0 });
        rewardSession = null;
        const pending = complete(session, rawScore).then(async result => {
          await startSession();
          return result;
        });
        claims.set(key, pending);
      }
      return respond(await claims.get(key));
    };

    // The hub dynamically imports its launcher; wait for both auth and launcher.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (win.WinLEWAuth?.hubApiFetch && win.WinLEWLaunchDebug?.startGameFromLaunchKey) {
        const key = allowed[game][1];
        const go = async () => {
          const session = await startSession();
          if (session) badge.textContent = `Rewards: ${session.mode || 'dry-run'}`;
        };
        // The Mole Hub's pre-game screen (how to play, then Go), as on /mole-hub/ (2026-10-24).
        // The reward session starts when the player presses Go, not while they read, so the
        // round's time is play time. Back and Close return to the arcade's games, not the hub's.
        if (typeof win.showLaunchModal === 'function' && typeof win.showView === 'function' && win.WinLEWLaunchDebug.runPendingLaunch) {
          doc.addEventListener('click', (e) => {
            const target = e.target instanceof win.Element ? e.target : null;
            if (!target) return;
            if (target.closest('#gameLaunchGo')) {
              e.preventDefault(); e.stopPropagation();
              void go().then(() => win.WinLEWLaunchDebug.runPendingLaunch());
            } else if (target.closest('#gameLaunchBack, #gameLaunchClose, [data-close-launch-modal="true"]')) {
              e.preventDefault(); e.stopPropagation();
              location.assign('/xl1/arcade/#games');
            }
          }, true);
          if (game !== 'grubdrop') badge.textContent = 'Rewards: start with Go';
          win.showView(key);
          win.showLaunchModal(key);
          return;
        }
        await go();
        await win.WinLEWLaunchDebug.startGameFromLaunchKey(key);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    badge.textContent = 'Game launch unavailable';
  });
  frame.src = '/mole-hub/?xl1arcade=1';
})();
