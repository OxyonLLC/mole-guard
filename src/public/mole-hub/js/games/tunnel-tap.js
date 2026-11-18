// WinLEW Mole Hub game chunk: Tunnel Tap
// Three-lane, touch-first survival run. Tap either side of the canvas to dodge,
// collect coins, and reach a safe burrow checkpoint before the timer expires.
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.tunneltap = function create_tunneltap(deps) {
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
        const canvas = $('tunnelTapCanvas');
        if (!canvas || typeof canvas.getContext !== 'function') {
          return { __missing: true, startOrResume() {}, reset() {}, renderAll() {}, draw() {} };
        }
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const lanes = [225, 450, 675];
        const PLAYER_Y = 1015;
        const ROUND_SECONDS = 30;

        const scoreEl = $('tunnelTapScore');
        const bestEl = $('tunnelTapBest');
        const timeEl = $('tunnelTapTime');
        const heartsEl = $('tunnelTapHearts');
        const modeEl = $('tunnelTapMode');
        const hintEl = $('tunnelTapHint');
        const progressEl = $('tunnelTapProgress');
        const coinsEl = $('tunnelTapCoins');
        const boardEl = $('tunnelTapBoard');
        const bannerEl = $('tunnelTapBanner');
        const subEl = $('tunnelTapSub');

        const loadSprite = (src) => {
          const image = new Image();
          image.decoding = 'async';
          image.src = src;
          image.addEventListener('load', () => draw(), { once: true });
          return image;
        };
        const art = {
          moleRight: loadSprite('./assets/tunneltap-mole-v2.png'),
          moleLeft: loadSprite('./assets/tunneltap-mole-dash-left-v3.png'),
          moleIdle: loadSprite('./assets/tunneltap-mole-idle-v3.png'),
          hazards: loadSprite('./assets/tunneltap-hazards-v2.png'),
        };
        const ready = (image) => image.complete && image.naturalWidth > 0;

        let meta = load(Storage.tunnelTapState, { best: 0, bestRound: 0 });
        let state = null;
        let raf = 0;
        let last = 0;

        function newRun() {
          // Bring the canvas into view, not the top of the whole site —
          // scrolling to page-top jumps away from the game itself. Instant,
          // not smooth — this game's own timer/hazards can't afford the
          // animation's real time. See also startOrResume()'s resume branch
          // and the round-clear onContinue below, which set state.running
          // directly without going through this function.
          canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
          state = {
            lane: 1, x: lanes[1], targetX: lanes[1], moveDirection: 0,
            score: 0, round: 1, time: ROUND_SECONDS, hearts: 3,
            coins: 0, dodges: 0, running: true, paused: false, over: false,
            invulnerable: 0, spawnClock: 0.5, speed: 360,
            hazards: [], particles: [], floaters: [], shake: 0,
          };
          if (bannerEl) bannerEl.textContent = 'Race to the safe burrow';
          if (subEl) subEl.textContent = 'Tap left or right to change lanes. Read the warning shadows.';
          if (hintEl) hintEl.textContent = 'Tap either side of the tunnel to dodge. Collect glowing W coins when the lane is safe.';
          renderAll();
          ensureLoop();
        }

        function startOrResume() {
          if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
          if (!state || state.over) newRun();
          else {
            canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
            state.paused = false; state.running = true; last = performance.now(); renderAll(); ensureLoop();
          }
        }

        function reset() { newRun(); }

        function moveLane(dir) {
          if (!state || !state.running || state.paused || state.over) return;
          const previousLane = state.lane;
          state.lane = clamp(state.lane + dir, 0, 2);
          state.targetX = lanes[state.lane];
          if (state.lane !== previousLane) state.moveDirection = Math.sign(dir);
          Sound.blip(240 + state.lane * 70, 0.035, 'sine', 0.025);
        }

        function spawnHazard() {
          if (!state) return;
          const roll = Math.random();
          const lane = rand(3);
          const type = roll < 0.53 ? 'rock' : roll < 0.79 ? 'spike' : roll < 0.91 ? 'crystal' : 'coin';
          state.hazards.push({
            type, lane, x: lanes[lane], y: type === 'spike' && Math.random() < 0.5 ? -140 : -110,
            size: type === 'coin' ? 64 : type === 'rock' ? 108 : 112,
            speed: state.speed * (type === 'coin' ? 0.9 : 1),
            spin: (Math.random() - 0.5) * 1.4,
            angle: 0, warned: false,
          });
        }

        function burst(x, y, color, count = 14) {
          for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 190;
            state.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1, color, r: 2 + Math.random() * 5 });
          }
        }

        function hit(hazard) {
          if (state.invulnerable > 0) return;
          state.hearts--;
          state.invulnerable = 1.25;
          state.shake = 16;
          burst(state.x, PLAYER_Y, '#ff6b58', 24);
          state.floaters.push({ x: state.x, y: PLAYER_Y - 50, text: 'OUCH!', life: 1, color: '#ff8b76' });
          Sound.hurt();
          hazard.dead = true;
          if (state.hearts <= 0) finishRun('The tunnel caught you');
        }

        function collect(hazard) {
          hazard.dead = true;
          state.coins++;
          state.score += 125 + state.round * 15;
          burst(hazard.x, hazard.y, '#ffd95e', 18);
          state.floaters.push({ x: hazard.x, y: hazard.y, text: `+${125 + state.round * 15}`, life: 1, color: '#ffe477' });
          Sound.coin();
        }

        function checkpoint() {
          state.running = false;
          state.paused = true;
          const survival = 600 + state.round * 175;
          state.score += survival;
          const completedRound = state.round;
          meta.best = Math.max(meta.best || 0, state.score);
          meta.bestRound = Math.max(meta.bestRound || 0, completedRound);
          save(Storage.tunnelTapState, meta);
          saveBoard();
          Sound.win();
          const rawBaseReward = clamp(Math.round((state.score + state.coins * 75) / 10), 40, 900);
          const baseReward = balanceGameReward('tunneltap', rawBaseReward);
          const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          showRewardOverlay({
            title: `Tunnel Tap — Burrow ${completedRound} Reached`,
            badge: `${state.dodges} hazards dodged`,
            text: `You survived the tunnel and banked <strong>${state.score}</strong> points with <strong>${state.coins}</strong> W coins.<br><br>Base payout: <strong>${baseReward.toFixed(2)} WinLEW</strong>. Pick a reward box.`,
            boxes: buildRewardBoxes(),
            continueLabel: 'Next tunnel',
            onPick: (box) => {
              const payout = Number((baseReward * Number(box.multiplier || 1)).toFixed(2));
              const walletTotal = addWallet(payout);
              const claimPromise = postRewardClaim({
                game: 'tunneltap', roundKey: `burrow-${completedRound}-${token}`,
                roundLabel: `Tunnel Tap burrow ${completedRound}`,
                baseReward: rawBaseReward, multiplier: box.multiplier, payout,
                meta: { score: state.score, round: completedRound, coins: state.coins, dodges: state.dodges, rawBaseReward },
              });
              // Corrects this optimistic credit to the server-authoritative
              // amount (up, down, or rolled back entirely) the moment the
              // claim response lands, instead of leaving it to eventually
              // self-heal — which for a guest only ever heals upward.
              const sync = reconcileClaimResult(payout, claimPromise);
              return { immediate: `You earned <strong>${payout.toFixed(2)} WinLEW</strong>.<br>Stored total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`, sync };
            },
            onContinue: () => {
              // Round-clear continue never went through newRun() or
              // startOrResume() — the next round's hazards were live the
              // instant this fired, with no scroll to bring them into view.
              canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
              state.round++;
              state.time = ROUND_SECONDS;
              state.hearts = Math.min(3, state.hearts + 1);
              state.speed = Math.min(660, 360 + (state.round - 1) * 42);
              state.hazards = [];
              state.spawnClock = 0.8;
              state.paused = false;
              state.running = true;
              if (bannerEl) bannerEl.textContent = `Tunnel ${state.round}`;
              if (subEl) subEl.textContent = 'The walls tighten and hazards fall faster. Keep moving.';
              last = performance.now();
              renderAll();
              ensureLoop();
            },
          });
          renderAll();
        }

        function finishRun(reason) {
          if (!state || state.over) return;
          state.running = false;
          state.over = true;
          meta.best = Math.max(meta.best || 0, state.score);
          meta.bestRound = Math.max(meta.bestRound || 0, state.round - 1);
          save(Storage.tunnelTapState, meta);
          saveBoard();
          if (bannerEl) bannerEl.textContent = 'Run ended';
          if (subEl) subEl.textContent = `${reason}. Final score: ${state.score}.`;
          renderAll();
        }

        function saveBoard() {
          const list = load(Storage.tunnelTapBoard, []);
          list.push({ score: state.score, round: state.round, coins: state.coins });
          list.sort((a, b) => b.score - a.score);
          save(Storage.tunnelTapBoard, list.slice(0, 12));
        }

        function update(dt) {
          if (!state || !state.running || state.paused || state.over) return;
          state.time -= dt;
          if (state.time <= 0) { state.time = 0; checkpoint(); return; }
          state.invulnerable = Math.max(0, state.invulnerable - dt);
          state.x += (state.targetX - state.x) * Math.min(1, dt * 14);
          if (Math.abs(state.targetX - state.x) < 0.75) {
            state.x = state.targetX;
            state.moveDirection = 0;
          }
          state.spawnClock -= dt;
          if (state.spawnClock <= 0) {
            spawnHazard();
            const pressure = Math.max(0.33, 0.82 - state.round * 0.045);
            state.spawnClock = pressure + Math.random() * 0.28;
          }
          for (const h of state.hazards) {
            h.y += h.speed * dt;
            h.angle += h.spin * dt;
            if (!h.warned && h.y > 720) h.warned = true;
            const dx = Math.abs(h.x - state.x);
            const dy = Math.abs(h.y - PLAYER_Y);
            if (!h.dead && dx < (h.type === 'coin' ? 72 : 76) && dy < (h.type === 'coin' ? 76 : 68)) {
              if (h.type === 'coin') collect(h); else hit(h);
            }
            if (!h.dead && h.y > H + 130) {
              h.dead = true;
              if (h.type !== 'coin') { state.dodges++; state.score += 18 + state.round * 2; }
            }
          }
          state.hazards = state.hazards.filter((h) => !h.dead);
          for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt; p.life -= dt * 1.8; }
          state.particles = state.particles.filter((p) => p.life > 0);
          for (const f of state.floaters) { f.y -= 45 * dt; f.life -= dt * 1.35; }
          state.floaters = state.floaters.filter((f) => f.life > 0);
          state.shake *= Math.pow(0.001, dt);
          renderHud();
        }

        function drawCave() {
          const grad = ctx.createLinearGradient(0, 0, 0, H);
          grad.addColorStop(0, '#120b08'); grad.addColorStop(0.55, '#2b160c'); grad.addColorStop(1, '#090504');
          ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
          const t = performance.now() / 1000;
          for (let i = 0; i < 18; i++) {
            const y = ((i * 97 + t * state?.speed * 0.18) % (H + 120)) - 60;
            const w = 55 + (i % 4) * 17;
            ctx.fillStyle = i % 2 ? '#321b11' : '#422317';
            ctx.beginPath(); ctx.roundRect(i % 2 ? 0 : W - w, y, w, 72, 12); ctx.fill();
          }
          ctx.strokeStyle = 'rgba(255,155,70,.14)'; ctx.lineWidth = 3;
          lanes.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 100); ctx.lineTo(x, H); ctx.stroke(); });
          const glow = ctx.createRadialGradient(W / 2, 80, 8, W / 2, 80, 460);
          glow.addColorStop(0, 'rgba(255,186,76,.26)'); glow.addColorStop(1, 'rgba(255,120,30,0)');
          ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 600);
        }

        function drawHazard(h) {
          if (h.y < 760) {
            const warningAlpha = clamp((h.y + 120) / 700, 0.12, 0.55);
            ctx.save(); ctx.globalAlpha = warningAlpha; ctx.fillStyle = h.type === 'coin' ? '#ffd85c' : '#ff633f';
            ctx.beginPath(); ctx.ellipse(h.x, PLAYER_Y + 65, 52, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }
          ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.angle);
          if (h.type === 'coin') {
            ctx.shadowColor = '#ffd95a'; ctx.shadowBlur = 24; ctx.fillStyle = '#f3b62e';
            ctx.beginPath(); ctx.arc(0, 0, h.size * 0.42, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff0a8'; ctx.lineWidth = 7; ctx.stroke();
            ctx.fillStyle = '#70400c'; ctx.font = `900 ${h.size * 0.48}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('W', 0, 2);
          } else if (ready(art.hazards)) {
            const typeIndex = h.type === 'spike' ? 0 : h.type === 'rock' ? 1 : 2;
            const sw = art.hazards.naturalWidth / 3;
            const sh = art.hazards.naturalHeight;
            const d = h.size * (h.type === 'rock' ? 1.25 : 1.45);
            ctx.drawImage(art.hazards, typeIndex * sw, 0, sw, sh, -d / 2, -d / 2, d, d);
          } else {
            ctx.fillStyle = h.type === 'crystal' ? '#ff4e31' : '#777';
            ctx.beginPath(); ctx.arc(0, 0, h.size * 0.42, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }

        function drawPlayer() {
          if (!state) return;
          ctx.save();
          ctx.translate(state.x, PLAYER_Y);
          const tilt = clamp((state.targetX - state.x) / 180, -0.24, 0.24);
          ctx.rotate(tilt);
          ctx.globalAlpha = state.invulnerable > 0 && Math.floor(performance.now() / 80) % 2 ? 0.34 : 1;
          ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 24;
          const movement = state.moveDirection || Math.sign(state.targetX - state.x);
          const sprite = movement < 0 ? art.moleLeft : movement > 0 ? art.moleRight : art.moleIdle;
          const moving = movement !== 0;
          const size = moving ? 176 : 164;
          const bob = moving ? Math.sin(performance.now() * 0.025) * 3 : Math.sin(performance.now() * 0.004) * 2;
          if (ready(sprite)) ctx.drawImage(sprite, -size / 2, -size / 2 + bob, size, size);
          else if (ready(art.moleRight)) ctx.drawImage(art.moleRight, -88, -92, 176, 176);
          else { ctx.fillStyle = '#7b4a2b'; ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.fill(); }
          ctx.restore();
        }

        function drawHud() {
          if (!state) return;
          ctx.save();
          ctx.fillStyle = 'rgba(8,5,4,.68)'; ctx.beginPath(); ctx.roundRect(28, 25, W - 56, 105, 24); ctx.fill();
          ctx.strokeStyle = 'rgba(255,185,92,.32)'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#fff0d3'; ctx.font = '900 28px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`TUNNEL ${state.round}`, 52, 67);
          ctx.font = '800 22px system-ui'; ctx.fillStyle = '#ffd464'; ctx.fillText(`${Math.ceil(state.time)}s`, 52, 103);
          ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(`${state.score} PTS`, W / 2, 76);
          ctx.fillStyle = '#ffd45e'; ctx.fillText(`W × ${state.coins}`, W / 2, 105);
          ctx.textAlign = 'right'; ctx.fillStyle = '#ff8d78'; ctx.fillText('● '.repeat(Math.max(0, state.hearts)).trim() || '—', W - 52, 84);
          ctx.restore();
        }

        function draw() {
          ctx.clearRect(0, 0, W, H);
          ctx.save();
          if (state?.shake) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
          drawCave();
          if (!state) {
            ctx.fillStyle = '#fff1d8'; ctx.font = '900 54px system-ui'; ctx.textAlign = 'center'; ctx.fillText('TUNNEL TAP', W / 2, H * 0.42);
            ctx.font = '700 25px system-ui'; ctx.fillStyle = '#d6ad83'; ctx.fillText('Tap left or right to dodge the tunnel.', W / 2, H * 0.47);
            ctx.restore(); return;
          }
          state.hazards.forEach(drawHazard);
          drawPlayer();
          for (const p of state.particles) { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
          ctx.globalAlpha = 1;
          for (const f of state.floaters) { ctx.globalAlpha = f.life; ctx.fillStyle = f.color; ctx.font = '900 28px system-ui'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y); }
          ctx.globalAlpha = 1;
          drawHud();
          if (state.paused && !state.over && rewardOverlay.classList.contains('hidden')) {
            ctx.fillStyle = 'rgba(5,3,2,.72)'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#fff'; ctx.font = '900 56px system-ui'; ctx.textAlign = 'center'; ctx.fillText('PAUSED', W / 2, H / 2);
          }
          if (state.over) {
            ctx.fillStyle = 'rgba(5,3,2,.78)'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#fff0d3'; ctx.font = '900 52px system-ui'; ctx.textAlign = 'center'; ctx.fillText('TUNNEL CLOSED', W / 2, H / 2 - 42);
            ctx.font = '700 27px system-ui'; ctx.fillStyle = '#ffc56f'; ctx.fillText(`Score ${state.score} • Coins ${state.coins}`, W / 2, H / 2 + 15);
            ctx.fillStyle = '#fff'; ctx.fillText('Tap Start / Resume for a new run', W / 2, H / 2 + 63);
          }
          ctx.restore();
        }

        function renderHud() {
          if (scoreEl) scoreEl.textContent = state ? String(state.score) : '0';
          if (bestEl) bestEl.textContent = String(meta.best || 0);
          if (timeEl) timeEl.textContent = state ? `${Math.ceil(state.time)}s` : `${ROUND_SECONDS}s`;
          if (heartsEl) heartsEl.textContent = state ? '● '.repeat(Math.max(0, state.hearts)).trim() || '—' : '● ● ●';
          if (modeEl) modeEl.textContent = !state ? 'Ready' : state.over ? 'Run over' : state.paused ? 'Paused' : 'Running';
          if (progressEl) progressEl.textContent = state ? `Tunnel ${state.round} • ${Math.ceil(state.time)}s to safety` : 'Tunnel 1 ready';
          if (coinsEl) coinsEl.textContent = state ? `Coins: ${state.coins}` : 'Coins: 0';
          renderBoardList(boardEl, load(Storage.tunnelTapBoard, []), 'tunneltap');
        }

        function renderAll() {
          renderHud(); draw();
          views.tunneltap.classList.toggle('hub-active-run', Boolean(state && state.running && !state.paused));
        }

        function loop(now) {
          raf = requestAnimationFrame(loop);
          if (views.tunneltap.classList.contains('hidden')) return;
          if (!last) last = now;
          const dt = Math.min(0.045, (now - last) / 1000);
          last = now;
          update(dt); draw();
        }
        function ensureLoop() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }

        function pointerMove(ev) {
          ev.preventDefault();
          if (!state || state.over) { startOrResume(); return; }
          const rect = canvas.getBoundingClientRect();
          moveLane(ev.clientX < rect.left + rect.width / 2 ? -1 : 1);
        }
        canvas.addEventListener('pointerdown', pointerMove, { passive: false });
        window.addEventListener('keydown', (ev) => {
          if (views.tunneltap.classList.contains('hidden')) return;
          if (ev.key === 'ArrowLeft' || ev.key === 'a' || ev.key === 'A') { ev.preventDefault(); moveLane(-1); }
          if (ev.key === 'ArrowRight' || ev.key === 'd' || ev.key === 'D') { ev.preventDefault(); moveLane(1); }
          if (ev.key === 'p' || ev.key === 'P') { if (state && !state.over) { state.paused = !state.paused; state.running = !state.paused; renderAll(); } }
        });

        const wire = (id, fn) => { const button = $(id); if (button) button.onclick = fn; };
        wire('tunnelTapStartBtn', startOrResume);
        wire('tunnelTapResetBtn', reset);
        wire('tunnelTapStartTop', startOrResume);
        wire('tunnelTapPauseTop', () => { if (state && !state.over) { state.paused = !state.paused; state.running = !state.paused; renderAll(); } });
        wire('tunnelTapResetTop', reset);
        wire('tunnelTapHomeTop', () => { hideRewardOverlay(); showView('hub'); renderHubBoards(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

        renderAll();
        return { startOrResume, reset, renderAll, draw };
      })();
    }
  };
})();
