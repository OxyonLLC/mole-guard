// WinLEW Gaming Hub game chunk: Mole Ice
// An original, Pengo-inspired grid arcade prototype: push ice blocks down a
// frozen mine corridor to slide, shatter, and crush Glitch Bugs. Ported from
// the standalone Phase 1 prototype (src/Mole-Ice-AI-Handoff) into the hub's
// canvas/dependency-injection pattern.
//
// REWARD WIRING (added after the Phase 1 port). Clearing a mine (every
// Glitch Bug crushed) is this game's checkpoint, the same role DigLEW's
// road checkpoint and Pac-Mole's level clear play — so it's the point a
// reward box opens. The claim's roundKey is minted once per round, when the
// round is cleared, and reused across every box pick for that round (same
// pattern as diglew.js), so a retried pick cannot dodge the server's
// duplicate-claim index. Base reward is the score earned DURING that round
// (shatters + crushes + the clear bonus), not lifetime score, so repeatedly
// retrying a round after a hit cannot inflate the reward for finally
// clearing it. See GAME_REWARD_SCALES in this file's app.js/rewardRules.js
// counterparts for the economy scale — proposed, not yet owner-confirmed.
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.moleice = function create_moleice(deps) {
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
        const canvas = $('moleiceCanvas');
        if (!canvas || typeof canvas.getContext !== 'function') {
          return { __missing: true, startOrResume() {}, reset() {}, renderAll() {}, draw() {} };
        }
        const ctx = canvas.getContext('2d');

        const scoreEl = $('moleiceScore');
        const bestEl = $('moleiceBest');
        const roundEl = $('moleiceRound');
        const livesEl = $('moleiceLives');
        const modeEl = $('moleiceMode');
        const hintEl = $('moleiceHint');
        const progressEl = $('moleiceProgress');
        const enemiesEl = $('moleiceEnemies');
        const bannerEl = $('moleiceBanner');
        const subEl = $('moleiceSub');
        const boardEl = $('moleiceBoard');

        const COLS = 15;
        const ROWS = 13;
        const T = canvas.width / COLS; // 80 at the module's 1200x1040 canvas
        const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        const sprite = (src) => {
          const image = new Image();
          image.decoding = 'async';
          image.src = src;
          image.addEventListener('load', () => draw(), { once: true });
          return image;
        };
        const art = {
          mole: sprite('./assets/moleice-mole.png'),
          bug: sprite('./assets/moleice-glitch-bug.png'),
          ice: sprite('./assets/moleice-ice-block.png'),
        };
        const ready = (image) => image.complete && image.naturalWidth > 0;

        // Same two hand-authored mine layouts as the Phase 1 prototype —
        // '#' wall, 'I' ice block, '.' open floor. Rounds cycle between them.
        const LEVELS = [
          ['###############', '#..I.I.I.I.I..#', '#.I...I...I.I.#', '#...I...I.....#', '#.I...I.I.I.I.#', '#...I.......I.#', '#.I.I.I.I.I...#', '#.....I...I.I.#', '#.I.I...I...I.#', '#...I.I...I...#', '#.I...I.I...I.#', '#..I.I...I.I..#', '###############'],
          ['###############', '#I..I...I..I..#', '#..I..I...I.I.#', '#.I..I..I.....#', '#...I..I..I.I.#', '#I...I...I....#', '#..I...I..I.I.#', '#.I..I....I...#', '#...I..I...I..#', '#.I...I..I..I.#', '#..I.I...I....#', '#I....I...I.I.#', '###############'],
        ];
        const SPAWN_SPOTS = [[13, 11], [13, 1], [1, 11], [7, 6], [11, 9], [3, 9]];

        let meta = load(Storage.moleiceState, { best: 0 });
        if (typeof meta.best !== 'number') meta.best = 0;

        let board, player, bugs, particles;
        let score = 0, round = 1, lives = 3, crushes = 0;
        // The score at the moment the CURRENT round's play began (set on
        // every start(), including a post-hit restart of the same round —
        // resetLevel() respawns the round's bugs from scratch either way, so
        // the reward for eventually clearing it should only reflect that
        // clean attempt, not score piled up across earlier failed tries.
        let roundStartScore = 0;
        // Run-scoped, reset only on a genuinely new run — this run's total
        // banked WinLEW, shown on the leaderboard the same way root-glide.js
        // and burrow-blaster.js show their own totalPayout.
        let totalPayout = 0;
        let running = false, paused = false;
        // Drives which on-canvas overlay draw() shows — kept as an explicit
        // state rather than inferred from score/lives/bugs so the overlay
        // can never guess wrong: 'ready' | 'playing' | 'paused' | 'hit' | 'roundclear' | 'over'.
        let uiPhase = 'ready';
        let last = 0, enemyClock = 0, slide = null;
        let raf = 0;
        let hintDefault = 'Push ice into a Glitch Bug to crush it. Chain crushes for bigger combos.';
        let hintTimer = 0;

        function inside(x, y) { return x >= 0 && x < COLS && y >= 0 && y < ROWS; }

        function resetLevel() {
          board = LEVELS[(round - 1) % LEVELS.length].map((row) => row.split(''));
          player = { x: 1, y: 1, dir: 'right' };
          bugs = [];
          const count = clamp(2 + round, 2, SPAWN_SPOTS.length);
          for (let i = 0; i < count; i++) {
            const [x, y] = SPAWN_SPOTS[i];
            board[y][x] = '.';
            bugs.push({ x, y, phase: Math.random() * 6 });
          }
          slide = null;
          particles = [];
        }

        function renderHud() {
          if (scoreEl) scoreEl.textContent = String(score);
          if (bestEl) bestEl.textContent = String(meta.best || 0);
          if (roundEl) roundEl.textContent = String(round);
          if (livesEl) livesEl.textContent = Array(Math.max(0, lives)).fill('●').join(' ') || '—';
          if (progressEl) progressEl.textContent = `Round ${round}`;
          if (enemiesEl) enemiesEl.textContent = `Bugs: ${bugs ? bugs.length : 0}`;
          if (modeEl) {
            modeEl.textContent = {
              ready: 'Ready', playing: 'Playing', paused: 'Paused',
              hit: 'Hit!', roundclear: 'Round clear', over: 'Run over',
            }[uiPhase] || 'Ready';
          }
        }

        function showHint(message, holdMs = 1400) {
          if (!hintEl) return;
          hintEl.textContent = message;
          hintTimer = holdMs;
        }

        function pushBoardEntry() {
          const list = load(Storage.moleiceBoard, []);
          list.push({ score, round, crushes, payout: totalPayout });
          list.sort((a, b) => b.score - a.score);
          save(Storage.moleiceBoard, list.slice(0, 12));
          renderBoard();
        }

        function renderBoard() {
          renderBoardList(boardEl, load(Storage.moleiceBoard, []), 'moleice');
        }

        function start() {
          if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
          // Bring the canvas into view, not the top of the whole site —
          // scrolling to page-top jumps away from the game itself, and every
          // entry into active play (fresh start, resume, mine continue)
          // funnels through here, so Glitch Bugs can't already be moving
          // before the player can even see the mine. Instant, not smooth —
          // this real-time game can't afford the animation's real time.
          canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
          if (lives <= 0) { score = 0; round = 1; lives = 3; crushes = 0; totalPayout = 0; }
          resetLevel();
          roundStartScore = score;
          running = true;
          paused = false;
          uiPhase = 'playing';
          last = performance.now();
          ensureLoop();
          if (bannerEl) bannerEl.textContent = `Round ${round}`;
          if (subEl) subEl.textContent = 'Crush every Glitch Bug to clear the mine.';
          hintTimer = 0;
          if (hintEl) hintEl.textContent = hintDefault;
          renderHud();
          Sound.blip(420, 0.07);
        }

        function startOrResume() {
          if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
          if (paused) { paused = false; running = true; uiPhase = 'playing'; last = performance.now(); ensureLoop(); renderHud(); return; }
          if (running) return;
          start();
        }

        function reset() {
          score = 0; round = 1; lives = 3; crushes = 0; totalPayout = 0; roundStartScore = 0;
          running = false; paused = false;
          uiPhase = 'ready';
          resetLevel();
          if (bannerEl) bannerEl.textContent = 'Ready to dig?';
          if (subEl) subEl.textContent = 'Move through the frozen mine. Push ice blocks to crush every Glitch Bug.';
          hintTimer = 0;
          if (hintEl) hintEl.textContent = hintDefault;
          renderAll();
        }

        function togglePause() {
          if (!running && !paused) return;
          paused = !paused;
          running = !paused && lives > 0;
          uiPhase = paused ? 'paused' : 'playing';
          if (!paused) { last = performance.now(); ensureLoop(); }
          renderHud();
        }

        function blocked(x, y) {
          return !inside(x, y) || board[y][x] === '#' || board[y][x] === 'I' || (slide && slide.x === x && slide.y === y);
        }
        function bugAt(x, y) { return bugs.findIndex((b) => b.x === x && b.y === y); }

        function move(dir) {
          if (!running || paused || slide) return;
          player.dir = dir;
          const [dx, dy] = DIRS[dir];
          const nx = player.x + dx, ny = player.y + dy;
          if (!blocked(nx, ny) && bugAt(nx, ny) < 0) {
            player.x = nx; player.y = ny;
            Sound.blip(160, 0.025);
          }
        }

        function pushIce() {
          if (!running || paused || slide) return;
          const [dx, dy] = DIRS[player.dir];
          const bx = player.x + dx, by = player.y + dy;
          if (!inside(bx, by) || board[by][bx] !== 'I') {
            showHint('No ice to push that way.');
            Sound.blip(90, 0.06, 'sawtooth', 0.03);
            return;
          }
          const nx = bx + dx, ny = by + dy;
          if (!inside(nx, ny) || board[ny][nx] === '#' || board[ny][nx] === 'I') {
            board[by][bx] = '.';
            burst(bx, by, '#baf6ff');
            score += 25;
            showHint('+25 shatter!');
            Sound.blip(260, 0.08);
            renderHud();
            return;
          }
          board[by][bx] = '.';
          slide = { x: bx, y: by, px: bx, py: by, dx, dy, t: 0, kills: 0 };
          Sound.blip(520, 0.05);
        }

        function updateSlide(dt) {
          if (!slide) return;
          slide.t += dt * 12;
          if (slide.t < 1) return;
          slide.px = slide.x; slide.py = slide.y;
          slide.x += slide.dx; slide.y += slide.dy;
          slide.t = 0;
          const bi = bugAt(slide.x, slide.y);
          if (bi >= 0) {
            bugs.splice(bi, 1);
            slide.kills++;
            crushes++;
            const pts = slide.kills === 1 ? 100 : slide.kills === 2 ? 300 : slide.kills === 3 ? 750 : 2000;
            score += pts;
            burst(slide.x, slide.y, '#ff4c70');
            showHint(slide.kills > 1 ? `${slide.kills}x combo! +${pts}` : `Crush! +${pts}`);
            Sound.blip(680 + slide.kills * 130, 0.08);
            renderHud();
          }
          const nx = slide.x + slide.dx, ny = slide.y + slide.dy;
          if (!inside(nx, ny) || board[ny][nx] === '#' || board[ny][nx] === 'I') {
            board[slide.y][slide.x] = 'I';
            slide = null;
            if (!bugs.length) roundClear();
          }
        }

        function moveBugs() {
          for (const b of bugs) {
            const options = [];
            const horiz = player.x === b.x ? [] : [player.x > b.x ? 'right' : 'left'];
            const vert = player.y === b.y ? [] : [player.y > b.y ? 'down' : 'up'];
            for (const d of [...horiz, ...vert, 'left', 'right', 'up', 'down']) {
              if (options.includes(d)) continue;
              const [dx, dy] = DIRS[d];
              const x = b.x + dx, y = b.y + dy;
              if (!blocked(x, y) && bugAt(x, y) < 0) options.push(d);
            }
            if (options.length) {
              const d = Math.random() < 0.76 ? options[0] : choice(options);
              const [dx, dy] = DIRS[d];
              b.x += dx; b.y += dy;
            }
            if (b.x === player.x && b.y === player.y) { hit(); return; }
          }
        }

        function hit() {
          lives--;
          running = false;
          burst(player.x, player.y, '#ffd84b');
          Sound.hurt();
          renderHud();
          setTimeout(() => {
            if (lives > 0) {
              uiPhase = 'hit';
              if (bannerEl) bannerEl.textContent = 'Ouch!';
              if (subEl) subEl.textContent = 'The Glitch Bugs got you. Reposition and use the ice.';
            } else {
              uiPhase = 'over';
              if (bannerEl) bannerEl.textContent = 'Mine closed';
              if (subEl) subEl.textContent = `Final score ${score} on round ${round}. Start a new run any time.`;
              pushBoardEntry();
              if (score > meta.best) { meta.best = score; save(Storage.moleiceState, meta); }
            }
            renderHud();
          }, 380);
        }

        function roundClear() {
          running = false;
          const clearedRound = round;
          score += 500 * round;
          const roundScoreDelta = score - roundStartScore;
          Sound.win();
          renderHud();
          setTimeout(() => {
            uiPhase = 'roundclear';
            if (bannerEl) bannerEl.textContent = 'Mine cleared!';
            if (subEl) subEl.textContent = `Round bonus: ${500 * clearedRound} points. The next mine has more Glitch Bugs.`;
            renderHud();
            offerRoundReward(clearedRound, roundScoreDelta);
          }, 450);
        }

        function offerRoundReward(clearedRound, roundScoreDelta) {
          // Pre-scale range matches tunnel-tap.js's clamp(40, 900) — a
          // similar real-time positioning/timing skill tier. The economy
          // scale itself (GAME_REWARD_SCALES.moleice) is a proposed starting
          // value, not a confirmed final balance.
          const rawBaseReward = clamp(Math.round(roundScoreDelta / 15), 40, 900);
          const baseReward = balanceGameReward('moleice', rawBaseReward);
          const claimToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const boxes = buildRewardBoxes();
          showRewardOverlay({
            title: `Mole Ice — Mine ${clearedRound} Cleared`,
            badge: `Round ${clearedRound} reward box`,
            text: `You crushed every Glitch Bug and cleared Mine ${clearedRound}.<br><br>Round score: <strong>${roundScoreDelta}</strong><br>Base reward: <strong>${baseReward.toFixed(2)} WinLEW</strong>. Pick one reward box to reveal your bonus multiplier.`,
            boxes,
            continueLabel: `Continue to Mine ${clearedRound + 1}`,
            onPick: (box) => {
              const payout = Number((baseReward * Number(box.multiplier || 1)).toFixed(2));
              const walletTotal = addWallet(payout);
              totalPayout = Number((totalPayout + payout).toFixed(2));
              const claimPromise = postRewardClaim({
                game: 'moleice',
                roundKey: `mine-${clearedRound}-${claimToken}`,
                roundLabel: `Mole Ice mine ${clearedRound} cleared`,
                baseReward: rawBaseReward,
                multiplier: box.multiplier,
                payout,
                meta: { round: clearedRound, roundScore: roundScoreDelta, crushes, lives, rawBaseReward },
              });
              // Corrects this optimistic credit to the server-authoritative
              // amount (up, down, or rolled back entirely) the moment the
              // claim response lands, instead of leaving it to eventually
              // self-heal — which for a guest only ever heals upward.
              const sync = reconcileClaimResult(payout, claimPromise);
              return {
                immediate: `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong>.<br>Stored total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`,
                sync,
              };
            },
            onContinue: () => { round = clearedRound + 1; start(); },
          });
        }

        function burst(x, y, color) {
          for (let i = 0; i < 12; i++) {
            particles.push({ x: x + 0.5, y: y + 0.5, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, life: 1, color });
          }
        }

        // ── rendering ──────────────────────────────────────────────────────
        function drawWall(x, y) {
          ctx.fillStyle = '#092334'; ctx.fillRect(x, y, T, T);
          ctx.fillStyle = '#1e566c'; ctx.fillRect(x + T * 0.075, y + T * 0.075, T - T * 0.15, T * 0.2);
          ctx.fillStyle = '#0f3c51'; ctx.fillRect(x + T * 0.075, y + T * 0.35, T - T * 0.15, T * 0.575);
        }
        function drawIce(x, y, moving = false) {
          if (ready(art.ice)) {
            ctx.save();
            if (moving) { ctx.shadowColor = '#4eeaff'; ctx.shadowBlur = T * 0.24; }
            ctx.drawImage(art.ice, x - T * 0.04, y - T * 0.08, T * 1.02, T * 1.02);
            ctx.restore();
            return;
          }
          ctx.save();
          ctx.translate(x, y);
          if (moving) { ctx.shadowColor = '#4eeaff'; ctx.shadowBlur = T * 0.225; }
          ctx.fillStyle = '#99edff'; ctx.fillRect(T * 0.05, T * 0.05, T * 0.8, T * 0.8);
          ctx.fillStyle = '#dffcff'; ctx.fillRect(T * 0.0875, T * 0.0875, T * 0.575, T * 0.175);
          ctx.fillStyle = '#36a9d1'; ctx.fillRect(T * 0.675, T * 0.375, T * 0.15, T * 0.425);
          ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2;
          ctx.strokeRect(T * 0.05, T * 0.05, T * 0.8, T * 0.8);
          ctx.restore();
        }
        function drawMole(x, y, dir) {
          if (ready(art.mole)) {
            ctx.save();
            ctx.translate(x + T * 0.5, y + T * 0.5);
            if (dir === 'left') ctx.scale(-1, 1);
            ctx.drawImage(art.mole, -T * 0.51, -T * 0.59, T * 1.02, T * 1.02);
            ctx.restore();
            return;
          }
          ctx.save();
          ctx.translate(x + T * 0.5, y + T * 0.525);
          if (dir === 'left') ctx.scale(-1, 1);
          ctx.fillStyle = '#24212a';
          ctx.beginPath(); ctx.ellipse(0, T * 0.075, T * 0.35, T * 0.325, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffd3ad';
          ctx.beginPath(); ctx.ellipse(T * 0.125, T * 0.125, T * 0.225, T * 0.175, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#b9f83b';
          ctx.fillRect(-T * 0.325, -T * 0.35, T * 0.65, T * 0.175);
          ctx.fillRect(-T * 0.2, -T * 0.5, T * 0.425, T * 0.2);
          ctx.fillStyle = '#071827';
          ctx.fillRect(T * 0.2, 0, T * 0.075, T * 0.075);
          ctx.fillStyle = '#ff8290';
          ctx.fillRect(T * 0.325, T * 0.15, T * 0.125, T * 0.075);
          ctx.restore();
        }
        function drawBug(x, y, t) {
          if (ready(art.bug)) {
            ctx.save();
            ctx.translate(x + T * 0.5, y + T * 0.5);
            ctx.rotate(Math.sin(t) * 0.055);
            ctx.drawImage(art.bug, -T * 0.48, -T * 0.52, T * 0.96, T * 0.96);
            ctx.restore();
            return;
          }
          ctx.save();
          ctx.translate(x + T * 0.5, y + T * 0.525);
          ctx.rotate(Math.sin(t) * 0.08);
          ctx.fillStyle = '#ff4168';
          ctx.beginPath(); ctx.ellipse(0, T * 0.05, T * 0.325, T * 0.3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#7e1b55';
          ctx.fillRect(-T * 0.075, -T * 0.275, T * 0.15, T * 0.65);
          ctx.strokeStyle = '#ff91ae'; ctx.lineWidth = 3;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(s * T * 0.175, -T * 0.175); ctx.lineTo(s * T * 0.375, -T * 0.325);
            ctx.moveTo(s * T * 0.25, T * 0.025); ctx.lineTo(s * T * 0.425, T * 0.025);
            ctx.moveTo(s * T * 0.175, T * 0.225); ctx.lineTo(s * T * 0.375, T * 0.375);
            ctx.stroke();
          }
          ctx.fillStyle = '#fff';
          ctx.fillRect(-T * 0.2, -T * 0.125, T * 0.125, T * 0.125);
          ctx.fillRect(T * 0.075, -T * 0.125, T * 0.125, T * 0.125);
          ctx.restore();
        }

        function drawOverlay(title, subtitle) {
          ctx.fillStyle = 'rgba(3,16,27,.79)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.font = `900 ${Math.round(T * 0.75)}px system-ui`;
          ctx.fillText(title, canvas.width / 2, canvas.height / 2 - T * 0.2);
          if (subtitle) {
            ctx.font = `700 ${Math.round(T * 0.3)}px system-ui`;
            ctx.fillStyle = 'rgba(255,255,255,.82)';
            ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + T * 0.45);
          }
        }

        function draw(now = 0) {
          ctx.fillStyle = '#061c2a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
              const px = x * T, py = y * T;
              ctx.fillStyle = (x + y) % 2 ? '#0b3449' : '#0d3a50';
              ctx.fillRect(px, py, T, T);
              ctx.strokeStyle = '#12465b';
              ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
              const tile = board?.[y]?.[x];
              if (tile === '#') drawWall(px, py);
              else if (tile === 'I') drawIce(px, py);
            }
          }
          if (slide) {
            const sx = (slide.px + (slide.x - slide.px) * slide.t) * T;
            const sy = (slide.py + (slide.y - slide.py) * slide.t) * T;
            drawIce(sx, sy, true);
          }
          if (bugs) for (const b of bugs) drawBug(b.x * T, b.y * T, b.phase + now / 220);
          if (player) drawMole(player.x * T, player.y * T, player.dir);
          if (particles) {
            for (const p of particles) {
              ctx.globalAlpha = p.life;
              ctx.fillStyle = p.color;
              ctx.fillRect(p.x * T - T * 0.075, p.y * T - T * 0.075, T * 0.15, T * 0.15);
            }
            ctx.globalAlpha = 1;
          }
          const overlays = {
            ready: ['READY TO DIG?', 'Press Start / Resume to begin'],
            paused: ['PAUSED', 'Press Start / Resume to continue'],
            hit: ['OUCH!', 'The Glitch Bugs got you — press Start / Resume to try again'],
            roundclear: ['MINE CLEARED!', `Round bonus: ${500 * (round - 1)} points — press Start / Resume for round ${round}`],
            over: ['MINE CLOSED', `Final score ${score} — press Start / Resume for a new run`],
          };
          if (overlays[uiPhase]) drawOverlay(...overlays[uiPhase]);
        }

        function renderAll() {
          renderHud();
          draw();
          renderBoard();
          views.moleice.classList.toggle('hub-active-run', Boolean(running && !paused));
        }

        function loop(now) {
          raf = requestAnimationFrame(loop);
          if (views.moleice.classList.contains('hidden')) return;
          if (!last) last = now;
          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          if (running && !paused) {
            updateSlide(dt);
            enemyClock += dt;
            if (enemyClock > Math.max(0.24, 0.63 - round * 0.025)) {
              enemyClock = 0;
              moveBugs();
            }
            for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.8; }
            particles = particles.filter((p) => p.life > 0);
            if (hintTimer > 0) {
              hintTimer -= dt * 1000;
              if (hintTimer <= 0 && hintEl) hintEl.textContent = hintDefault;
            }
          }
          draw(now);
        }
        function ensureLoop() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }

        // ── input ────────────────────────────────────────────────────────
        const KEY_MOVE = {
          ArrowUp: 'up', w: 'up', W: 'up',
          ArrowDown: 'down', s: 'down', S: 'down',
          ArrowLeft: 'left', a: 'left', A: 'left',
          ArrowRight: 'right', d: 'right', D: 'right',
        };
        window.addEventListener('keydown', (e) => {
          if (views.moleice.classList.contains('hidden')) return;
          if (KEY_MOVE[e.key]) { e.preventDefault(); move(KEY_MOVE[e.key]); }
          else if (e.code === 'Space') { e.preventDefault(); pushIce(); }
          else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); }
        });
        document.querySelectorAll('.moleice-dpad [data-move]').forEach((b) => {
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); move(b.dataset.move); }, { passive: false });
        });
        const pushBtn = $('moleicePushBtn');
        if (pushBtn) pushBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); pushIce(); }, { passive: false });

        const wireBtn = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
        wireBtn('moleiceStartBtn', startOrResume);
        wireBtn('moleiceStartTop', startOrResume);
        wireBtn('moleiceResetBtn', reset);
        wireBtn('moleiceResetTop', reset);
        wireBtn('moleicePauseTop', togglePause);
        wireBtn('moleiceHomeTop', () => {
          showView('hub');
          if (typeof renderHubBoards === 'function') renderHubBoards();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        resetLevel();
        renderAll();
        return { startOrResume, reset, renderAll, draw, start };
      })();
    }
  };
})();
