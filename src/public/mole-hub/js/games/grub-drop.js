// WinLEW Gaming Hub game chunk: Grub Drop
// Mole-themed tap-to-clear puzzle, "Rising Burrow" (2026-10-24). Tap a group of 2+ touching
// same-colored grubs to pop them; grubs above fall. A new row pushes up from the bottom on a
// timer that speeds up every 30 s survived, and a 4th then 5th colour joins. The run ends when
// a row pushes into a full top row. Points grow steadily with the grubs you pop (not with luck),
// so a round's score tracks how long and how well it was played. Then a reward box.
// The old version ended when no pair was left, about 22 taps or 10 seconds.
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.grubdrop = function create_grubdrop(deps) {
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
        const canvas = $('grubDropCanvas');
        if (!canvas || typeof canvas.getContext !== 'function') {
          return { __missing: true, startOrResume() {}, reset() {}, renderAll() {}, draw() {} };
        }
        const ctx = canvas.getContext('2d');
        const W = canvas.width;   // 900
        const H = canvas.height;  // 1280

        const scoreEl = $('grubScore');
        const bestEl = $('grubBest');
        const comboEl = $('grubCombo');
        const movesEl = $('grubMoves');
        const modeEl = $('grubMode');
        const hintEl = $('grubHint');

        const COLS = 8;
        const ROWS = 11;
        const PAD = 18;
        // Leave a real stage above the board for the mascot and live combo feedback.
        // The old board consumed almost the entire canvas and made the game feel like
        // a debug grid rather than the illustrated cave promised by the card art.
        const STAGE_H = 170;
        const CELL = Math.floor(Math.min((W - PAD * 2) / COLS, (H - STAGE_H - PAD) / ROWS));
        const BOARD_W = CELL * COLS;
        const BOARD_H = CELL * ROWS;
        const OX = Math.floor((W - BOARD_W) / 2);               // board origin x
        const OY = H - BOARD_H - PAD;                           // board sits at the bottom (thumb reach)
        // Rounds now last minutes, not seconds: the divisor keeps a typical round's payout where a
        // typical old round's was (about 340 raw), so WinLEW paid per minute of play goes down.
        const SCORE_PER_LEW = 22;                               // score -> raw base divisor; hub economy scale applies below
        const CLEAR_BONUS = 300;                                // popping every grub on the board
        const GOLDEN_BONUS = 200;                               // popping a Golden Grub pair
        const COMBO_WINDOW_MS = 2600;
        // Rising Burrow tuning, settled with docs/marathon-2026-10/sprint-grubdrop/grubdrop-sim.mjs:
        // casual and good bots both last about 2-4 minutes (median about 3), at 41-45 points/s.
        const START_ROWS = 5;
        const LEVEL_MS = 30000;                                 // a level every 30 s survived
        const FIRST_RISE_MS = 5500, RISE_STEP_MS = 450, MIN_RISE_MS = 1800;
        const GOLDEN_ROW_CHANCE = 1 / 12;
        // A run has to be played to pay: the board now fills by itself, so without this an idle
        // run ended after about 38 s and still took the minimum payout. About 15 s of real play.
        const MIN_PAID_SCORE = 600;
        const riseInterval = (level) => Math.max(MIN_RISE_MS, FIRST_RISE_MS - (level - 1) * RISE_STEP_MS);
        const coloursAt = (level) => (level >= 6 ? 5 : level >= 3 ? 4 : 3);   // worm, grub, mushroom, then crystal, then coin
        // Steady points: 10 a grub, +15 for each grub past 4 in one clump, x1.0-1.6 for a live combo.
        const popScore = (n, combo) => Math.round((n * 10 + Math.max(0, n - 4) * 15) * (1 + Math.min(combo, 6) * 0.1));

        // WinLEW Underground collectible set (2026-07-19 visual rebrand,
        // spawn mechanic tuned 2026-07-19 after simulated playtesting). Six
        // thematic items, three rarity tiers. Board mechanics (flood-fill
        // same-type matching, scoring, session-end) are UNCHANGED from the
        // original 4-type version.
        //
        // Rares/epic do NOT spawn via independent per-cell weighted random
        // like the 3 commons do — a first attempt at that (each cell rolls
        // among all 6 types, commons weighted heavily) was simulated over
        // 2000 sessions and found a real problem: Golden Grub only ever got
        // successfully matched 30-38% of the time, Coin ~51-62% — with so
        // few cells of a rare type scattered independently across an
        // 88-cell board, most of them never happened to land next to a
        // matching neighbor, so players would see the exciting epic pull
        // and then usually never get to actually pop it. Instead, rares/
        // epic are stamped onto the board as GUARANTEED ADJACENT PAIRS
        // (see emptyGrid below) — every rare/epic instance starts already
        // matchable. Re-simulated: clear rates for every type landed in the
        // 89-94% range (commons included), average pops/session barely
        // moved (~21 -> ~22), and it still preserves "you rarely see a
        // rare/epic pair" (COMMON/RARE/EPIC_PAIR_COUNT below) — the rarity
        // feel comes from how OFTEN a pair appears, not from artificially
        // starving each pull of a partner to match with.
        const COLLECTIBLES = [
          { key: 'worm', label: 'Earthworm', tier: 'common' },
          { key: 'grub', label: 'Fat Grub', tier: 'common' },
          { key: 'mushroom', label: 'Mushroom', tier: 'common' },
          { key: 'crystal', label: 'Crystal', tier: 'rare' },
          { key: 'coin', label: 'WinLEW Coin', tier: 'rare' },
          { key: 'golden', label: 'Golden Grub', tier: 'epic' },
        ];
        const TYPES = COLLECTIBLES.length;
        const COMMON_WEIGHTS = [40, 40, 30]; // worm, grub, mushroom — fills every cell not claimed by a special pair
        const CRYSTAL_PAIR_COUNT = 3;
        const COIN_PAIR_COUNT = 2;
        const GOLDEN_PAIR_COUNT = 1;

        let meta = load(Storage.grubState, { best: 0, plays: 0 });
        if (typeof meta.best !== 'number') meta.best = 0;
        let state = null;
        let raf = 0;
        let lastTs = 0;
        // anim: { kind:'pop'|'settle', t, dur, cells:Set("r,c") }
        let anim = null;
        let inputLocked = false;
        // Mole mascot reacting in the corner — 'idle' (default), 'happy'
        // (any successful pop), 'excited' (combo x3+ or a rare/epic pull),
        // 'celebrate' (full board clear). Reverts to idle when its timer runs out.
        let moleExpression = 'idle';
        let moleExpressionUntil = 0;
        let hoverGroup = [];
        let tapPulse = null;
        let floaters = [];
        const loadSprite = (src) => {
          const image = new Image();
          image.decoding = 'async';
          image.src = src;
          image.addEventListener('load', () => draw(), { once: true });
          return image;
        };
        const art = {
          atlas: loadSprite('./assets/grubdrop-collectibles-v2.png'),
          mascot: loadSprite('./assets/grubdrop-mascot-v2.png'),
        };
        const artReady = (image) => image.complete && image.naturalWidth > 0;
        function setMoleExpression(expr, durMs = 900) {
          moleExpression = expr;
          moleExpressionUntil = performance.now() + durMs;
        }

        function shuffleInPlace(arr) {
          for (let i = arr.length - 1; i > 0; i--) {
            const j = rand(i + 1);
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
          }
          return arr;
        }

        // One new row for the bottom: the colours open at this level, sometimes a Golden Grub pair.
        function newRow(level) {
          const colours = coloursAt(level);
          const row = [];
          for (let c = 0; c < COLS; c++) row.push(rand(colours));
          if (Math.random() < GOLDEN_ROW_CHANCE) { const c = rand(COLS - 1); row[c] = 5; row[c + 1] = 5; }
          return row;
        }

        function startGrid() {
          const g = [];
          for (let r = 0; r < ROWS; r++) g[r] = r >= ROWS - START_ROWS ? newRow(1) : new Array(COLS).fill(-1);
          return g;
        }

        // The pre-2026-10-24 full board (kept for reference; Rising Burrow starts from startGrid()).
        function emptyGrid() {
          const g = [];
          for (let r = 0; r < ROWS; r++) { g[r] = []; for (let c = 0; c < COLS; c++) g[r][c] = -1; }

          // Stamp guaranteed adjacent pairs for rares/epic first (see the
          // comment above COLLECTIBLES for why) — indices 3/4/5 = crystal/
          // coin/golden, matching COLLECTIBLES' order.
          const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          const pairPlan = [[3, CRYSTAL_PAIR_COUNT], [4, COIN_PAIR_COUNT], [5, GOLDEN_PAIR_COUNT]];
          const cellPool = [];
          for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cellPool.push([r, c]);
          for (const [typeIdx, targetPairs] of pairPlan) {
            let placed = 0;
            let attempts = 0;
            while (placed < targetPairs && attempts < 400) {
              attempts++;
              const [r, c] = cellPool[rand(cellPool.length)];
              if (g[r][c] !== -1) continue;
              shuffleInPlace(dirs);
              for (const [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (inBounds(nr, nc) && g[nr][nc] === -1) {
                  g[r][c] = typeIdx; g[nr][nc] = typeIdx;
                  placed++;
                  break;
                }
              }
            }
          }
          // Fill everything else with weighted commons (worm/grub/mushroom).
          const commonTotal = COMMON_WEIGHTS.reduce((a, b) => a + b, 0);
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (g[r][c] !== -1) continue;
              let roll = Math.random() * commonTotal;
              let t = 0;
              for (let i = 0; i < COMMON_WEIGHTS.length; i++) {
                roll -= COMMON_WEIGHTS[i];
                t = i;
                if (roll <= 0) break;
              }
              g[r][c] = t;
            }
          }
          return g;
        }

        function newSession() {
          state = {
            grid: startGrid(),
            level: 1,
            elapsed: 0,                      // ms of play (paused while the view is hidden)
            riseIn: riseInterval(1),         // ms until the next row pushes up
            popped: 0,
            rising: 0,                       // 0..1 while the board slides up a row
            score: 0,
            combo: 0,
            bestCombo: 0,
            comboTimer: 0,
            moves: 0,
            over: false,
            rewardOpen: false,
            particles: [],
          };
          anim = null;
          inputLocked = false;
          hoverGroup = [];
          tapPulse = null;
          floaters = [];
          moleExpression = 'idle';
          moleExpressionUntil = 0;
          meta.plays = Number(meta.plays || 0) + 1;
          save(Storage.grubState, meta);
        }

        function key(r, c) { return r + ',' + c; }
        function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

        // Flood-fill the connected same-type group containing (r,c).
        function groupAt(r, c) {
          const grid = state.grid;
          const t = grid[r][c];
          if (t < 0) return [];
          const seen = new Set([key(r, c)]);
          const stack = [[r, c]];
          const out = [];
          while (stack.length) {
            const [cr, cc] = stack.pop();
            out.push([cr, cc]);
            const nb = [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]];
            for (const [nr, nc] of nb) {
              if (inBounds(nr, nc) && !seen.has(key(nr, nc)) && grid[nr][nc] === t) {
                seen.add(key(nr, nc));
                stack.push([nr, nc]);
              }
            }
          }
          return out;
        }

        function anyMovesLeft() {
          const grid = state.grid;
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (grid[r][c] < 0) continue;
              const t = grid[r][c];
              if ((inBounds(r + 1, c) && grid[r + 1][c] === t) || (inBounds(r, c + 1) && grid[r][c + 1] === t)) return true;
            }
          }
          return false;
        }

        function boardEmpty() {
          for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (state.grid[r][c] >= 0) return false;
          return true;
        }

        // Gravity (cells fall within their column) then collapse empty columns left.
        function settleBoard() {
          const grid = state.grid;
          for (let c = 0; c < COLS; c++) {
            const stackCol = [];
            for (let r = ROWS - 1; r >= 0; r--) if (grid[r][c] >= 0) stackCol.push(grid[r][c]);
            for (let r = ROWS - 1; r >= 0; r--) grid[r][c] = stackCol.length ? (r >= ROWS - stackCol.length ? stackCol[ROWS - 1 - r] : -1) : -1;
          }
          // Columns no longer slide together: in Rising Burrow an empty column refills from below.
        }

        // Push every column up one row and add a new bottom row. A full top row means the burrow
        // is full: the run ends.
        function riseRow() {
          const grid = state.grid;
          if (grid[0].some((v) => v >= 0)) { endSession(); return; }
          grid.shift();
          grid.push(newRow(state.level));
          state.rising = 1;
          hoverGroup = [];
          state.riseIn = riseInterval(state.level);
          if (Sound) Sound.blip(120, 0.05, 'triangle', 0.025);
          renderHud();
        }
        // A column has reached the top row: the next row to rise ends the run unless it is cleared.
        function inDanger() { return state && state.grid[0].some((v) => v >= 0); }

        function tapAt(px, py) {
          if (!state || state.over || inputLocked || anim) return;
          const c = Math.floor((px - OX) / CELL);
          const r = Math.floor((py - OY - state.rising * CELL) / CELL);   // the board may be mid-slide
          if (!inBounds(r, c) || state.grid[r][c] < 0) return;
          const popType = state.grid[r][c];
          const group = groupAt(r, c);
          if (group.length < 2) {
            // dead tap: drop the combo, low blip
            state.combo = 0;
            state.comboTimer = 0;
            tapPulse = { x: px, y: py, t: 0, dur: 260, bad: true };
            if (Sound) Sound.blip(180, 0.06, 'sawtooth', 0.03);
            renderHud();
            return;
          }
          // score: steady per grub, a little extra for big clumps, scaled by the live combo
          const golden = popType === 5;
          const earned = popScore(group.length, state.combo) + (golden ? GOLDEN_BONUS : 0);
          state.score += earned;
          state.popped += group.length;
          state.combo += 1;
          state.bestCombo = Math.max(state.bestCombo, state.combo);
          state.comboTimer = COMBO_WINDOW_MS;
          state.moves += 1;
          const center = group.reduce((p, cell) => ({ x: p.x + OX + cell[1] * CELL + CELL / 2, y: p.y + OY + cell[0] * CELL + CELL / 2 }), { x: 0, y: 0 });
          floaters.push({ x: center.x / group.length, y: center.y / group.length, text: `+${earned}`, life: 760, maxLife: 760, rare: (COLLECTIBLES[popType] || COLLECTIBLES[0]).tier !== 'common' });
          hoverGroup = [];
          for (const [gr, gc] of group) {
            const cx = OX + gc * CELL + CELL / 2;
            const cy = OY + gr * CELL + CELL / 2;
            spawnMatchParticles(cx, cy, popType);
            state.grid[gr][gc] = -1; // logically cleared; pop anim shows it
          }
          anim = { kind: 'pop', t: 0, dur: 170, popType, cells: new Set(group.map(([gr, gc]) => key(gr, gc))) };
          inputLocked = true;
          if (Sound) { state.combo >= 3 ? Sound.power() : Sound.coin(); }
          const tier = (COLLECTIBLES[popType] || COLLECTIBLES[0]).tier;
          if (state.combo >= 3 || tier === 'epic') setMoleExpression('excited', 1100);
          else if (tier === 'rare') setMoleExpression('excited', 850);
          else setMoleExpression('happy', 650);
          renderHud();
        }

        function finishPop() {
          settleBoard();
          anim = { kind: 'settle', t: 0, dur: 130, cells: null };
        }

        function finishSettle() {
          anim = null;
          inputLocked = false;
          // Every grub popped: a bonus, and the next row comes straight away.
          if (boardEmpty()) {
            state.score += CLEAR_BONUS;
            floaters.push({ x: W / 2, y: OY + BOARD_H / 2, text: `Burrow clear! +${CLEAR_BONUS}`, life: 1200, maxLife: 1200, rare: true });
            setMoleExpression('celebrate', 1600);
            state.riseIn = 0;
            renderHud();
          }
        }

        function endSession() {
          if (!state || state.over) return;
          state.over = true;
          inputLocked = true;
          const cleared = false;
          const survived = Math.round(state.elapsed / 1000);
          const survivedText = `${Math.floor(survived / 60)}:${String(survived % 60).padStart(2, '0')}`;
          if (state.score > meta.best) { meta.best = state.score; save(Storage.grubState, meta); }
          if (Sound) Sound.coin();
          setMoleExpression('idle', 100);
          renderHud();

          const run = { score: state.score, bestCombo: state.bestCombo, moves: state.moves, level: state.level, survivedMs: Math.round(state.elapsed), popped: state.popped };
          state.rewardOpen = true;
          if (run.score < MIN_PAID_SCORE) {
            showRewardOverlay({
              title: 'Grub Drop — Burrow Full',
              badge: `Level ${run.level} · ${survivedText}`,
              text: `You scored <strong>${run.score}</strong> in ${survivedText}.<br><br>No payout this time: a run pays from <strong>${MIN_PAID_SCORE}</strong> points. Pop clumps before the rows fill the burrow.`,
              boxes: [],
              continueLabel: 'Play again',
              onContinue: () => { start(); },
            });
            return;
          }
          const rawBaseReward = clamp(Math.round(run.score / SCORE_PER_LEW), 60, 1000);
          const baseReward = balanceGameReward('grubdrop', rawBaseReward);
          const token = Date.now() + '-' + Math.random().toString(16).slice(2);
          const boxes = buildRewardBoxes();
          showRewardOverlay({
            title: 'Grub Drop — Burrow Full',
            badge: `Level ${state.level} · ${survivedText}`,
            text: `You scored <strong>${state.score}</strong> and held the burrow for <strong>${survivedText}</strong>, reaching level <strong>${state.level}</strong>.<br>${state.popped} grubs popped · best combo <strong>x${state.bestCombo}</strong>.<br><br>Base payout: <strong>${baseReward.toFixed(2)} WinLEW</strong>. Pick a reward box.`,
            boxes,
            continueLabel: 'Play again',
            onPick: (box) => {
              const payout = Number((baseReward * Number(box.multiplier || 1)).toFixed(2));
              const walletTotal = addWallet(payout);
              const claimPromise = postRewardClaim({
                game: 'grubdrop',
                roundKey: `session-${token}`,
                roundLabel: `Grub Drop session — ${run.score} pts`,
                baseReward: rawBaseReward,
                multiplier: box.multiplier,
                payout,
                meta: { ...run, cleared, rawBaseReward, mode: 'rising-burrow' },
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
            onContinue: () => { start(); },
          });
        }

        // ── rendering ──────────────────────────────────────────────────────────
        function roundRect(x, y, w, h, r, targetCtx = ctx) {
          targetCtx.beginPath();
          targetCtx.moveTo(x + r, y);
          targetCtx.arcTo(x + w, y, x + w, y + h, r);
          targetCtx.arcTo(x + w, y + h, x, y + h, r);
          targetCtx.arcTo(x, y + h, x, y, r);
          targetCtx.arcTo(x, y, x + w, y, r);
          targetCtx.closePath();
        }

        function drawSparkle(x, y, r) {
          ctx.beginPath();
          ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.28, y - r * 0.28);
          ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.28, y + r * 0.28);
          ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.28, y + r * 0.28);
          ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.28, y - r * 0.28);
          ctx.closePath();
          ctx.fill();
        }

        function drawEarthworm(cx, cy, s, alpha) {
          ctx.save();
          ctx.globalAlpha = alpha;
          const grad = ctx.createLinearGradient(cx - s * 0.36, cy - s * 0.3, cx + s * 0.3, cy + s * 0.2);
          grad.addColorStop(0, '#a3e675');
          grad.addColorStop(1, '#4f8f34');
          ctx.strokeStyle = grad;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = s * 0.30;
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.34, cy + s * 0.22);
          ctx.quadraticCurveTo(cx - s * 0.10, cy - s * 0.30, cx + s * 0.16, cy - s * 0.04);
          ctx.quadraticCurveTo(cx + s * 0.32, cy + s * 0.14, cx + s * 0.30, cy - s * 0.10);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(60,100,35,.4)';
          ctx.lineWidth = s * 0.03;
          ctx.lineCap = 'butt';
          [[cx - 0.20 * s, cy + 0.12 * s], [cx, cy - 0.12 * s], [cx + 0.20 * s, cy - 0.02 * s]].forEach(([px, py]) => {
            ctx.beginPath(); ctx.moveTo(px - s * 0.05, py - s * 0.09); ctx.lineTo(px + s * 0.05, py + s * 0.09); ctx.stroke();
          });
          const hx = cx + s * 0.30, hy = cy - s * 0.10;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(hx - s * 0.05, hy - s * 0.03, s * 0.045, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(hx + s * 0.06, hy - s * 0.03, s * 0.045, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2d1a10';
          ctx.beginPath(); ctx.arc(hx - s * 0.05, hy - s * 0.01, s * 0.022, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(hx + s * 0.06, hy - s * 0.01, s * 0.022, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }

        function drawFatGrub(cx, cy, s, alpha, golden = false) {
          ctx.save();
          ctx.globalAlpha = alpha;
          if (golden) ctx.shadowColor = 'rgba(255,215,80,.6)';
          else ctx.shadowColor = 'rgba(0,0,0,.25)';
          ctx.shadowBlur = s * (golden ? 0.30 : 0.14);
          const bodyGrad = ctx.createRadialGradient(cx - s * 0.12, cy - s * 0.18, s * 0.05, cx, cy, s * 0.55);
          if (golden) {
            bodyGrad.addColorStop(0, '#fff6d0'); bodyGrad.addColorStop(0.5, '#ffd65e'); bodyGrad.addColorStop(1, '#c98f1e');
          } else {
            bodyGrad.addColorStop(0, '#fff6e0'); bodyGrad.addColorStop(0.55, '#f2d9a8'); bodyGrad.addColorStop(1, '#d9b578');
          }
          ctx.fillStyle = bodyGrad;
          ctx.beginPath();
          ctx.ellipse(cx, cy + s * 0.02, s * 0.42, s * 0.38, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = golden ? 'rgba(150,100,10,.4)' : 'rgba(150,110,60,.35)';
          ctx.lineWidth = s * 0.02;
          [-0.14, 0.06, 0.24].forEach((oy) => {
            ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.02 + s * oy, s * 0.38, s * 0.06, 0, 0, Math.PI * 2); ctx.stroke();
          });
          if (!golden) {
            ctx.fillStyle = '#c99a5c';
            [-0.22, 0, 0.22].forEach((ox) => {
              ctx.beginPath(); ctx.ellipse(cx + s * ox, cy + s * 0.38, s * 0.06, s * 0.045, 0, 0, Math.PI * 2); ctx.fill();
            });
          }
          if (golden) {
            ctx.fillStyle = '#ffe98a';
            ctx.beginPath();
            ctx.moveTo(cx - s * 0.14, cy - s * 0.34);
            ctx.lineTo(cx - s * 0.09, cy - s * 0.48);
            ctx.lineTo(cx - s * 0.02, cy - s * 0.36);
            ctx.lineTo(cx + s * 0.02, cy - s * 0.48);
            ctx.lineTo(cx + s * 0.09, cy - s * 0.36);
            ctx.lineTo(cx + s * 0.14, cy - s * 0.48);
            ctx.lineTo(cx + s * 0.18, cy - s * 0.34);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#a5720f'; ctx.lineWidth = s * 0.015; ctx.stroke();
          }
          const eyeR = s * (golden ? 0.10 : 0.115);
          [-1, 1].forEach((dir) => {
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx + dir * s * 0.16, cy - s * 0.11, eyeR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = golden ? '#5a3a08' : '#3a2a12';
            ctx.beginPath(); ctx.arc(cx + dir * s * 0.16 + dir * s * 0.02, cy - s * 0.09, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx + dir * s * 0.16 + dir * s * 0.035 - s * 0.01, cy - s * 0.14, eyeR * 0.22, 0, Math.PI * 2); ctx.fill();
          });
          if (!golden) {
            ctx.fillStyle = 'rgba(230,140,120,.35)';
            ctx.beginPath(); ctx.ellipse(cx - s * 0.24, cy + s * 0.02, s * 0.06, s * 0.035, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(cx + s * 0.24, cy + s * 0.02, s * 0.06, s * 0.035, 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.strokeStyle = golden ? '#7a530c' : '#8a5a2c';
          ctx.lineWidth = s * 0.025;
          ctx.beginPath(); ctx.arc(cx, cy + s * 0.02, s * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
          if (golden) {
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            [[-0.32, -0.22], [0.34, -0.06], [0.28, 0.30], [-0.30, 0.26]].forEach(([ox, oy], i) => {
              drawSparkle(cx + s * ox, cy + s * oy, s * (0.045 + (i % 2) * 0.02));
            });
          }
          ctx.restore();
        }

        function drawMushroom(cx, cy, s, alpha) {
          ctx.save();
          ctx.globalAlpha = alpha;
          const stemGrad = ctx.createLinearGradient(cx - s * 0.14, cy, cx + s * 0.14, cy);
          stemGrad.addColorStop(0, '#f4e6c8');
          stemGrad.addColorStop(1, '#d9c193');
          ctx.fillStyle = stemGrad;
          roundRect(cx - s * 0.14, cy + s * 0.02, s * 0.28, s * 0.32, s * 0.10);
          ctx.fill();
          const capGrad = ctx.createRadialGradient(cx - s * 0.10, cy - s * 0.24, s * 0.04, cx, cy - s * 0.12, s * 0.46);
          capGrad.addColorStop(0, '#ff9d6a');
          capGrad.addColorStop(0.6, '#e0663f');
          capGrad.addColorStop(1, '#a5402a');
          ctx.fillStyle = capGrad;
          ctx.beginPath();
          ctx.ellipse(cx, cy - s * 0.12, s * 0.42, s * 0.30, 0, Math.PI, 0);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(140,60,30,.30)';
          ctx.beginPath(); ctx.ellipse(cx, cy - s * 0.02, s * 0.40, s * 0.06, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,235,190,.9)';
          [[-0.16, -0.20], [0.12, -0.26], [0.02, -0.10]].forEach(([ox, oy]) => {
            ctx.beginPath(); ctx.arc(cx + s * ox, cy + s * oy, s * 0.045, 0, Math.PI * 2); ctx.fill();
          });
          ctx.fillStyle = '#5a4324';
          ctx.beginPath(); ctx.arc(cx - s * 0.06, cy + s * 0.14, s * 0.025, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cx + s * 0.06, cy + s * 0.14, s * 0.025, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#5a4324';
          ctx.lineWidth = s * 0.02;
          ctx.beginPath(); ctx.arc(cx, cy + s * 0.17, s * 0.05, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
          ctx.restore();
        }

        function drawCrystal(cx, cy, s, alpha) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.shadowColor = 'rgba(120,200,255,.55)';
          ctx.shadowBlur = s * 0.32;
          const grad = ctx.createLinearGradient(cx - s * 0.3, cy - s * 0.4, cx + s * 0.3, cy + s * 0.4);
          grad.addColorStop(0, '#bff2ff');
          grad.addColorStop(0.5, '#6fb8ff');
          grad.addColorStop(1, '#7a5fe0');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(cx, cy - s * 0.44);
          ctx.lineTo(cx + s * 0.26, cy - s * 0.10);
          ctx.lineTo(cx + s * 0.16, cy + s * 0.42);
          ctx.lineTo(cx - s * 0.16, cy + s * 0.42);
          ctx.lineTo(cx - s * 0.26, cy - s * 0.10);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,.5)';
          ctx.lineWidth = s * 0.018;
          ctx.beginPath();
          ctx.moveTo(cx, cy - s * 0.44); ctx.lineTo(cx, cy + s * 0.42);
          ctx.moveTo(cx - s * 0.26, cy - s * 0.10); ctx.lineTo(cx + s * 0.26, cy - s * 0.10);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.02, cy - s * 0.38);
          ctx.lineTo(cx + s * 0.08, cy - s * 0.16);
          ctx.lineTo(cx - s * 0.06, cy - s * 0.14);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        function drawCoin(cx, cy, s, alpha) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.shadowColor = 'rgba(255,210,110,.5)';
          ctx.shadowBlur = s * 0.24;
          const grad = ctx.createRadialGradient(cx - s * 0.12, cy - s * 0.14, s * 0.05, cx, cy, s * 0.42);
          grad.addColorStop(0, '#fff3c8');
          grad.addColorStop(0.5, '#f0c04c');
          grad.addColorStop(1, '#b9812a');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(cx, cy, s * 0.40, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(150,95,20,.5)';
          ctx.lineWidth = s * 0.02;
          ctx.beginPath(); ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#7a4e12';
          ctx.lineWidth = s * 0.06;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - s * 0.18, cy - s * 0.12);
          ctx.lineTo(cx - s * 0.09, cy + s * 0.14);
          ctx.lineTo(cx, cy - s * 0.04);
          ctx.lineTo(cx + s * 0.09, cy + s * 0.14);
          ctx.lineTo(cx + s * 0.18, cy - s * 0.12);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,.55)';
          ctx.lineWidth = s * 0.04;
          ctx.beginPath(); ctx.arc(cx, cy, s * 0.30, -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke();
          ctx.restore();
        }

        function drawCollectible(cx, cy, size, type, scale, alpha) {
          const s = size * 0.82 * scale;
          const key = (COLLECTIBLES[type] || COLLECTIBLES[0]).key;
          if (artReady(art.atlas)) {
            const sw = art.atlas.naturalWidth / 3;
            const sh = art.atlas.naturalHeight / 2;
            const sx = (type % 3) * sw;
            const sy = Math.floor(type / 3) * sh;
            const d = s * 1.04;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.shadowColor = type >= 3 ? 'rgba(93,208,255,.52)' : 'rgba(0,0,0,.34)';
            ctx.shadowBlur = type >= 3 ? s * 0.18 : s * 0.1;
            ctx.beginPath();
            ctx.arc(cx, cy, d * 0.47, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(art.atlas, sx, sy, sw, sh, cx - d / 2, cy - d / 2, d, d);
            ctx.restore();
            return;
          }
          if (key === 'worm') drawEarthworm(cx, cy, s, alpha);
          else if (key === 'grub') drawFatGrub(cx, cy, s, alpha, false);
          else if (key === 'mushroom') drawMushroom(cx, cy, s, alpha);
          else if (key === 'crystal') drawCrystal(cx, cy, s, alpha);
          else if (key === 'coin') drawCoin(cx, cy, s, alpha);
          else if (key === 'golden') drawFatGrub(cx, cy, s, alpha, true);
        }

        // ── board texture (built once — a per-frame-random dirt fill would flicker) ──
        let boardTextureCanvas = null;
        function buildBoardTexture() {
          const tw = BOARD_W + 16, th = BOARD_H + 16;
          const tex = document.createElement('canvas');
          tex.width = tw; tex.height = th;
          const t = tex.getContext('2d');
          const grad = t.createLinearGradient(0, 0, 0, th);
          grad.addColorStop(0, '#3a2416');
          grad.addColorStop(1, '#1c0f08');
          t.fillStyle = grad;
          roundRect(0, 0, tw, th, 26, t);
          t.fill();
          for (let i = 0; i < 90; i++) {
            const x = Math.random() * tw, y = Math.random() * th, r = 2 + Math.random() * 5;
            t.fillStyle = `rgba(0,0,0,${(0.10 + Math.random() * 0.12).toFixed(3)})`;
            t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.fill();
          }
          for (let i = 0; i < 46; i++) {
            const x = Math.random() * tw, y = Math.random() * th, r = 1 + Math.random() * 2.5;
            t.fillStyle = `rgba(190,150,95,${(0.10 + Math.random() * 0.10).toFixed(3)})`;
            t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.fill();
          }
          for (let i = 0; i < 7; i++) {
            const x = Math.random() * tw, y = Math.random() * th;
            t.fillStyle = 'rgba(140,210,255,.09)';
            t.beginPath(); t.arc(x, y, 10 + Math.random() * 14, 0, Math.PI * 2); t.fill();
          }
          // a few root/vine strands
          t.strokeStyle = 'rgba(90,60,30,.35)';
          t.lineWidth = 3;
          t.lineCap = 'round';
          for (let i = 0; i < 5; i++) {
            const x0 = Math.random() * tw, y0 = 0;
            t.beginPath();
            t.moveTo(x0, y0);
            t.quadraticCurveTo(x0 + (Math.random() - 0.5) * 60, th * 0.4, x0 + (Math.random() - 0.5) * 90, th * 0.85);
            t.stroke();
          }
          return tex;
        }

        // ── match particle effects (a shared burst, tinted/shaped per collectible tier) ──
        function spawnMatchParticles(cx, cy, type) {
          if (!state) return;
          const info = COLLECTIBLES[type] || COLLECTIBLES[0];
          const palette = {
            worm: ['#a3e675', '#5f9f3c'],
            grub: ['#f2d9a8', '#c99a5c'],
            mushroom: ['#ff9d6a', '#ffe6b0'],
            crystal: ['#bff2ff', '#7a5fe0'],
            coin: ['#fff3c8', '#f0c04c'],
            golden: ['#ffe98a', '#ffb020'],
          }[info.key] || ['#f2d9a8', '#c99a5c'];
          const count = info.tier === 'epic' ? 22 : info.tier === 'rare' ? 16 : 10;
          const spread = info.key === 'coin' || info.key === 'crystal' ? 1 : 0.6;
          for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2 * spread + (spread < 1 ? -Math.PI / 2 : 0);
            const speed = 60 + Math.random() * 120;
            state.particles.push({
              x: cx, y: cy,
              vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 30,
              gravity: 260,
              life: 380 + Math.random() * 260, maxLife: 640,
              color: palette[i % 2],
              r: 2 + Math.random() * (info.tier === 'epic' ? 4 : 3),
              shape: info.key === 'crystal' || info.key === 'golden' ? 'spark' : 'dot',
            });
          }
        }

        function drawParticles() {
          if (!state?.particles?.length) return;
          for (const p of state.particles) {
            const k = clamp(p.life / p.maxLife, 0, 1);
            ctx.globalAlpha = k;
            ctx.fillStyle = p.color;
            if (p.shape === 'spark') drawSparkle(p.x, p.y, p.r * 1.4);
            else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
          }
          ctx.globalAlpha = 1;
        }

        // ── mole mascot (top-left corner, reacts to combos/clears) ──────────
        function drawMoleMascot() {
          const cx = OX + 68, cy = OY - 76, r = 58;
          ctx.save();
          ctx.translate(cx, cy);
          const bounce = moleExpression === 'celebrate' ? Math.sin(performance.now() / 90) * 3 : 0;
          ctx.translate(0, bounce);
          if (artReady(art.mascot)) {
            const scale = moleExpression === 'excited' || moleExpression === 'celebrate' ? 1.07 : 1;
            ctx.scale(scale, scale);
            ctx.drawImage(art.mascot, -r * 1.12, -r * 1.12, r * 2.24, r * 2.24);
            ctx.restore();
            return;
          }
          // ears
          ctx.fillStyle = '#6b4a30';
          ctx.beginPath(); ctx.arc(-r * 0.62, -r * 0.55, r * 0.28, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(r * 0.62, -r * 0.55, r * 0.28, 0, Math.PI * 2); ctx.fill();
          // head
          const headGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r);
          headGrad.addColorStop(0, '#9a7350');
          headGrad.addColorStop(1, '#5c4028');
          ctx.fillStyle = headGrad;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          // snout
          ctx.fillStyle = '#c9a377';
          ctx.beginPath(); ctx.ellipse(0, r * 0.34, r * 0.42, r * 0.30, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#3a2a1a';
          ctx.beginPath(); ctx.ellipse(0, r * 0.30, r * 0.10, r * 0.07, 0, 0, Math.PI * 2); ctx.fill();
          // eyes: expression-dependent
          const happy = moleExpression === 'happy' || moleExpression === 'excited' || moleExpression === 'celebrate';
          ctx.strokeStyle = '#20140a';
          ctx.fillStyle = '#20140a';
          ctx.lineWidth = r * 0.09;
          ctx.lineCap = 'round';
          [-1, 1].forEach((dir) => {
            const ex = dir * r * 0.34, ey = -r * 0.06;
            if (happy) {
              ctx.beginPath(); ctx.arc(ex, ey + r * 0.05, r * 0.16, Math.PI, 0); ctx.stroke();
            } else {
              ctx.beginPath(); ctx.arc(ex, ey, r * 0.09, 0, Math.PI * 2); ctx.fill();
            }
          });
          // mouth
          ctx.beginPath();
          if (moleExpression === 'celebrate' || moleExpression === 'excited') {
            ctx.ellipse(0, r * 0.58, r * 0.14, r * 0.10, 0, 0, Math.PI * 2); ctx.fillStyle = '#3a1c14'; ctx.fill();
          } else {
            ctx.arc(0, r * 0.5, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
          }
          if (moleExpression === 'celebrate') {
            ctx.fillStyle = 'rgba(255,230,150,.95)';
            [[-r * 1.1, -r * 0.9], [r * 1.1, -r * 0.7], [0, -r * 1.3]].forEach(([sx, sy], i) => {
              drawSparkle(sx, sy, r * (0.14 + (i % 2) * 0.05));
            });
          }
          ctx.restore();
        }

        function draw() {
          ctx.clearRect(0, 0, W, H);
          const cave = ctx.createRadialGradient(W * 0.5, H * 0.28, 40, W * 0.5, H * 0.5, H * 0.72);
          cave.addColorStop(0, '#553019');
          cave.addColorStop(0.46, '#24130b');
          cave.addColorStop(1, '#080503');
          ctx.fillStyle = cave;
          ctx.fillRect(0, 0, W, H);
          if (!boardTextureCanvas) boardTextureCanvas = buildBoardTexture();
          ctx.drawImage(boardTextureCanvas, OX - 8, OY - 8);
          drawMoleMascot();
          if (!state) return;
          ctx.save();
          ctx.textAlign = 'left';
          ctx.fillStyle = '#fff1ca';
          ctx.font = '900 31px system-ui';
          ctx.fillText(state.combo > 1 ? `COMBO x${state.combo}` : 'GRUB DROP', OX + 145, OY - 82);
          ctx.fillStyle = 'rgba(255,238,202,.72)';
          ctx.font = '700 18px system-ui';
          ctx.fillText(`Level ${state.level}  •  ${state.score} points`, OX + 147, OY - 50);
          // Next-row meter: fills as the next row gets closer; red when the burrow is nearly full.
          const meterX = OX + 147, meterY = OY - 34, meterW = BOARD_W - 162, meterH = 12;
          const fill = state.over ? 0 : 1 - clamp(state.riseIn / riseInterval(state.level), 0, 1);
          const danger = inDanger();
          ctx.fillStyle = 'rgba(255,238,202,.16)';
          roundRect(meterX, meterY, meterW, meterH, 6); ctx.fill();
          ctx.fillStyle = danger ? '#ff6f61' : '#ffcc47';
          roundRect(meterX, meterY, Math.max(meterH, meterW * fill), meterH, 6); ctx.fill();
          ctx.restore();
          if (danger && !state.over) {
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 160);
            ctx.strokeStyle = '#ff6f61';
            ctx.lineWidth = 6;
            roundRect(OX - 4, OY - 4, BOARD_W + 8, CELL + 8, 10); ctx.stroke();
            ctx.restore();
          }
          const popping = anim && anim.kind === 'pop';
          const settling = anim && anim.kind === 'settle';
          const popK = popping ? (anim.t / anim.dur) : 0;       // 0..1
          const settleK = settling ? (anim.t / anim.dur) : 1;
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const t = state.grid[r][c];
              if (t < 0) continue;
              const cx = OX + c * CELL + CELL / 2;
              const cy = OY + r * CELL + CELL / 2 + state.rising * CELL;   // slides up as a row arrives
              let scale = 1, alpha = 1;
              if (settling) scale = 0.86 + 0.14 * easeOut(settleK);
              const selected = hoverGroup.some(([hr, hc]) => hr === r && hc === c);
              if (selected) {
                const pulse = 1 + Math.sin(performance.now() / 90) * 0.025;
                scale *= 1.08 * pulse;
                ctx.save();
                ctx.strokeStyle = 'rgba(255,226,112,.95)';
                ctx.lineWidth = 4;
                ctx.shadowColor = '#ffcc47';
                ctx.shadowBlur = 16;
                ctx.beginPath(); ctx.arc(cx, cy, CELL * 0.43, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
              }
              drawCollectible(cx, cy, CELL, t, scale, alpha);
            }
          }
          // pop animation overlays the cleared cells (they're already -1 in the grid)
          if (popping && anim.cells) {
            for (const k of anim.cells) {
              const [pr, pc] = k.split(',').map(Number);
              const cx = OX + pc * CELL + CELL / 2;
              const cy = OY + pr * CELL + CELL / 2 + state.rising * CELL;
              drawCollectible(cx, cy, CELL, anim.popType != null ? anim.popType : 0, 1 + popK * 0.55, 1 - popK);
            }
          }
          drawParticles();
          if (tapPulse) {
            const k = clamp(tapPulse.t / tapPulse.dur, 0, 1);
            ctx.save();
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = tapPulse.bad ? '#ff6f61' : '#ffe168';
            ctx.lineWidth = 8 * (1 - k);
            ctx.beginPath(); ctx.arc(tapPulse.x, tapPulse.y, 18 + k * 44, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          }
          for (const f of floaters) {
            const k = clamp(f.life / f.maxLife, 0, 1);
            ctx.save();
            ctx.globalAlpha = k;
            ctx.textAlign = 'center';
            ctx.font = `900 ${f.rare ? 34 : 27}px system-ui`;
            ctx.fillStyle = f.rare ? '#ffe26b' : '#fff7dd';
            ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
            ctx.fillText(f.text, f.x, f.y - (1 - k) * 48);
            ctx.restore();
          }
        }

        function easeOut(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 2); }

        function renderHud() {
          if (scoreEl) scoreEl.textContent = state ? String(state.score) : '0';
          if (bestEl) bestEl.textContent = String(meta.best || 0);
          if (comboEl) comboEl.textContent = state && state.combo > 1 ? `x${state.combo}` : '—';
          if (movesEl) movesEl.textContent = state ? String(state.moves) : '0';
          if (modeEl) modeEl.textContent = !state ? 'Ready' : state.over ? 'Burrow full' : `Level ${state.level}`;
        }

        function renderAll() {
          renderHud();
          draw();
          views.grubdrop.classList.toggle('hub-active-run', Boolean(state && !state.over));
        }

        function loop(ts) {
          raf = requestAnimationFrame(loop);
          if (!lastTs) lastTs = ts;
          const dt = Math.min(48, ts - lastTs);
          lastTs = ts;
          // Don't run/repaint while the hub or another view is showing.
          if (views.grubdrop.classList.contains('hidden')) return;
          if (state && !state.over) {
            if (state.comboTimer > 0 && !anim) {
              state.comboTimer -= dt;
              if (state.comboTimer <= 0) { state.combo = 0; renderHud(); }
            }
          }
          // Rows rise and time counts only while the board is in play: not behind the how-to-play
          // screen (the hub can open it over a live run) or any other overlay.
          const launchModal = document.getElementById('gameLaunchModal');
          const covered = (launchModal && !launchModal.classList.contains('hidden')) || (rewardOverlay && !rewardOverlay.classList.contains('hidden'));
          if (state && !state.over && !covered) {
            state.elapsed += dt;
            const level = 1 + Math.floor(state.elapsed / LEVEL_MS);
            if (level !== state.level) {
              state.level = level;
              floaters.push({ x: W / 2, y: OY + 60, text: `Level ${level}${coloursAt(level) > coloursAt(level - 1) ? ' · new colour!' : ''}`, life: 1400, maxLife: 1400, rare: true });
              setMoleExpression('excited', 1100);
              renderHud();
            }
            if (state.rising > 0) state.rising = Math.max(0, state.rising - dt / 160);
            state.riseIn -= dt;
            if (state.riseIn <= 0 && !anim) riseRow();
          }
          if (state?.particles?.length) {
            const dtSec = dt / 1000;
            for (const p of state.particles) {
              p.x += p.vx * dtSec;
              p.y += p.vy * dtSec;
              p.vy += (p.gravity || 0) * dtSec;
              p.life -= dt;
            }
            state.particles = state.particles.filter((p) => p.life > 0);
          }
          if (tapPulse) {
            tapPulse.t += dt;
            if (tapPulse.t >= tapPulse.dur) tapPulse = null;
          }
          for (const f of floaters) f.life -= dt;
          floaters = floaters.filter((f) => f.life > 0);
          if (moleExpression !== 'idle' && performance.now() > moleExpressionUntil) moleExpression = 'idle';
          if (anim) {
            anim.t += dt;
            if (anim.t >= anim.dur) {
              if (anim.kind === 'pop') finishPop();
              else if (anim.kind === 'settle') finishSettle();
            }
          }
          draw();
        }

        function ensureLoop() { if (!raf) { lastTs = 0; raf = requestAnimationFrame(loop); } }

        function start() {
          // Bring the canvas into view, not the top of the whole site —
          // scrolling to page-top jumps away from the game itself, and every
          // entry into active play (fresh start, resume, session continue)
          // funnels through here. Instant, not smooth — a fast game can't
          // afford the animation's real time.
          canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
          newSession();
          renderAll();
          ensureLoop();
          if (hintEl) hintEl.textContent = 'Pop clumps of 2+ before the burrow fills: a new row rises from below, faster every 30 seconds.';
        }

        function startOrResume() {
          if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
          if (!state || state.over) start();
          else { renderAll(); ensureLoop(); }
        }

        function reset() { start(); }

        // ── input ────────────────────────────────────────────────────────────
        function pointerToCanvas(ev) {
          const rect = canvas.getBoundingClientRect();
          const style = getComputedStyle(canvas);
          const borderLeft = parseFloat(style.borderLeftWidth) || 0;
          const borderRight = parseFloat(style.borderRightWidth) || 0;
          const borderTop = parseFloat(style.borderTopWidth) || 0;
          const borderBottom = parseFloat(style.borderBottomWidth) || 0;
          const boxW = Math.max(1, rect.width - borderLeft - borderRight);
          const boxH = Math.max(1, rect.height - borderTop - borderBottom);
          const sourceAspect = canvas.width / canvas.height;
          const boxAspect = boxW / boxH;
          let drawW = boxW;
          let drawH = boxH;
          let drawLeft = rect.left + borderLeft;
          let drawTop = rect.top + borderTop;

          // `object-fit: contain` may letterbox the intrinsic canvas when a
          // viewport height cap changes the CSS box. Map against the pixels
          // actually occupied by the game, not the whole element box.
          if (boxAspect > sourceAspect) {
            drawW = boxH * sourceAspect;
            drawLeft += (boxW - drawW) / 2;
          } else if (boxAspect < sourceAspect) {
            drawH = boxW / sourceAspect;
            drawTop += (boxH - drawH) / 2;
          }

          const nx = (ev.clientX - drawLeft) / drawW;
          const ny = (ev.clientY - drawTop) / drawH;
          return {
            x: clamp(nx * canvas.width, 0, canvas.width - 0.001),
            y: clamp(ny * canvas.height, 0, canvas.height - 0.001),
            inside: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1,
          };
        }
        canvas.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          if (views.grubdrop.classList.contains('hidden')) return;
          const p = pointerToCanvas(ev);
          if (!p.inside) return;
          tapAt(p.x, p.y);
        }, { passive: false });
        canvas.addEventListener('pointermove', (ev) => {
          if (!state || state.over || inputLocked || anim) return;
          const p = pointerToCanvas(ev);
          if (!p.inside) { hoverGroup = []; return; }
          const c = Math.floor((p.x - OX) / CELL);
          const r = Math.floor((p.y - OY - state.rising * CELL) / CELL);
          hoverGroup = inBounds(r, c) && state.grid[r][c] >= 0 ? groupAt(r, c) : [];
          if (hoverGroup.length < 2) hoverGroup = [];
        });
        canvas.addEventListener('pointerleave', () => { hoverGroup = []; });

        // In-view buttons (each game wires its own, like burrow-blaster).
        const wireBtn = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
        wireBtn('grubStartBtn', startOrResume);
        wireBtn('grubResetBtn', reset);
        wireBtn('grubStartTop', startOrResume);
        wireBtn('grubResetTop', reset);
        wireBtn('grubHomeTop', () => {
          hideRewardOverlay();
          showView('hub');
          if (typeof renderHubBoards === 'function') renderHubBoards();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        renderAll();
        return { startOrResume, reset, renderAll, draw, start };
      })();
    }
  };
})();
