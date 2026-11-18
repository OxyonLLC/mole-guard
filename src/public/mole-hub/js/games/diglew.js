// WinLEW Gaming Hub modular game chunk: DigLEW v47 release candidate
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.diglew = function create_diglew(deps) {
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
        const canvas = $('diglewCanvas');
        const ctx = canvas.getContext('2d');
        const resourceEl = $('diglewResources');
        const upgradesEl = $('diglewUpgrades');
        const logEl = $('diglewLog');
        const boardEl = $('diglewBoard');
        const missionTitle = $('diglewMissionTitle');
        const missionText = $('diglewMissionText');
        const missionYard = $('diglewMissionYard');
        const turnsEl = $('diglewTurns');
        const senseEl = $('diglewSense');
        const runInfoEl = $('diglewRunInfo');
        const upgradeHintEl = $('diglewUpgradeHint');
        const playArea = canvas?.closest?.('.play-area') || canvas?.parentElement;

        const loadSprite = (src) => {
          const image = new Image();
          image.decoding = 'async';
          image.src = src;
          image.addEventListener('load', () => draw(), { once: true });
          return image;
        };
        const diglewArt = {
          runner: loadSprite('./assets/diglew-runner-v2.png'),
          pickups: loadSprite('./assets/diglew-pickups-v2.png'),
          hazards: loadSprite('./assets/diglew-hazards-v2.png'),
        };
        const artReady = (image) => image.complete && image.naturalWidth > 0;

        function drawAtlasSprite(image, index, columns, x, y, width, height) {
          if (!artReady(image)) return false;
          const sourceWidth = image.naturalWidth / columns;
          ctx.drawImage(image, sourceWidth * index, 0, sourceWidth, image.naturalHeight, x - width / 2, y - height / 2, width, height);
          return true;
        }

        const CACHE_LABEL = 'v47-step8-polish';
        const BASE_CHECKPOINT = 300;
        const CHECKPOINT_STEP = 150;
        const MAX_CHECKPOINT = 900;
        const PLAYER_X = 190;
        const PLAYER_W = 74;
        const PLAYER_H = 82;
        const TOP = 0;
        const MID = 1;
        const BOT = 2;
        const START_LANE = MID;
        const LANE_CHANGE_COOLDOWN = 0.09;
        const HIT_INVULN = 1.0;
        const DASH_DURATION = 0.30;
        const DEFAULT_DASH_COOLDOWN = 3.5;
        const LANES = [
          { id: TOP, name: 'Risk Road', y: 326, tint: '#f8c84d', reward: 1.35 },
          { id: MID, name: 'Main Road', y: 474, tint: '#65d8ff', reward: 1.0 },
          { id: BOT, name: 'Safe Road', y: 622, tint: '#80ef7b', reward: 0.62 },
        ];

        const defaultProgress = {
          worms: 20,
          winlew: 0,
          city: { scanner: 0, forge: 0, larder: 0, brace: 0 },
          bestDistance: 0,
          bestScore: 0,
          totalRuns: 0,
          checkpoints: 0,
        };

        const upgrades = {
          scanner: {
            name: 'Road Lamps',
            desc: 'Clearer lane lighting and stronger pickup pull.',
            base: 6,
            max: 5,
          },
          forge: {
            name: 'Dash Pistons',
            desc: 'Shorter dash cooldown for cracked rock walls.',
            base: 7,
            max: 5,
          },
          larder: {
            name: 'Treasure Pack',
            desc: 'Improves worm, gem, and checkpoint reward value.',
            base: 5,
            max: 5,
          },
          brace: {
            name: 'Tunnel Bracing',
            desc: 'Adds shield pips and longer recovery after damage.',
            base: 6,
            max: 5,
          },
        };

        const PATTERNS = [
          { id: 'top_coin_rush', minRound: 1, weight: 4, safeLanes: [MID, BOT], obstacles: [{ type: 'mine', lane: TOP, dx: 176 }], pickups: [{ type: 'coin', lane: TOP, dx: 0 }, { type: 'coin', lane: TOP, dx: 42 }, { type: 'coin', lane: TOP, dx: 84 }, { type: 'gem', lane: TOP, dx: 126 }, { type: 'coin', lane: MID, dx: 210 }, { type: 'worm', lane: BOT, dx: 246 }] },
          { id: 'middle_coin_line', minRound: 1, weight: 3, safeLanes: [TOP, MID, BOT], obstacles: [], pickups: [{ type: 'coin', lane: MID, dx: 0 }, { type: 'coin', lane: MID, dx: 42 }, { type: 'coin', lane: MID, dx: 84 }, { type: 'worm', lane: MID, dx: 126 }] },
          { id: 'middle_spike_redirect', minRound: 1, weight: 2, safeLanes: [TOP, BOT], obstacles: [{ type: 'spikes', lane: MID, dx: 110 }], pickups: [{ type: 'coin', lane: TOP, dx: 28 }, { type: 'coin', lane: BOT, dx: 40 }, { type: 'worm', lane: TOP, dx: 154 }] },
          { id: 'dash_gate_bonus', minRound: 1, weight: 3, safeLanes: [BOT], obstacles: [{ type: 'rock', lane: MID, dx: 116 }], pickups: [{ type: 'dash', lane: MID, dx: 36 }, { type: 'gem', lane: MID, dx: 182 }, { type: 'coin', lane: TOP, dx: 74 }, { type: 'coin', lane: BOT, dx: 30 }] },
          { id: 'bottom_relocation', minRound: 1, weight: 2, safeLanes: [TOP, MID], obstacles: [{ type: 'spikes', lane: BOT, dx: 118 }], pickups: [{ type: 'coin', lane: MID, dx: 10 }, { type: 'coin', lane: TOP, dx: 54 }, { type: 'worm', lane: MID, dx: 150 }] },
          { id: 'top_mine_coin_ladder', minRound: 2, weight: 3, safeLanes: [MID, BOT], obstacles: [{ type: 'mine', lane: TOP, dx: 132 }, { type: 'mine', lane: TOP, dx: 248 }], pickups: [{ type: 'coin', lane: TOP, dx: 0 }, { type: 'coin', lane: TOP, dx: 44 }, { type: 'coin', lane: TOP, dx: 88 }, { type: 'gem', lane: TOP, dx: 208 }, { type: 'coin', lane: MID, dx: 286 }] },
          { id: 'middle_dash_double', minRound: 2, weight: 2, safeLanes: [BOT], obstacles: [{ type: 'rock', lane: MID, dx: 108 }, { type: 'rock', lane: MID, dx: 252 }], pickups: [{ type: 'dash', lane: MID, dx: 18 }, { type: 'dash', lane: MID, dx: 180 }, { type: 'gem', lane: MID, dx: 322 }, { type: 'coin', lane: BOT, dx: 66 }] },
          { id: 'split_top_vs_safe', minRound: 2, weight: 2, safeLanes: [BOT], obstacles: [{ type: 'mine', lane: TOP, dx: 126 }, { type: 'rock', lane: MID, dx: 178 }], pickups: [{ type: 'coin', lane: TOP, dx: 0 }, { type: 'coin', lane: TOP, dx: 42 }, { type: 'gem', lane: MID, dx: 244 }, { type: 'coin', lane: BOT, dx: 54 }, { type: 'worm', lane: BOT, dx: 98 }] },
          { id: 'top_rock_treasure', minRound: 2, weight: 2, safeLanes: [MID, BOT], obstacles: [{ type: 'rock', lane: TOP, dx: 118 }, { type: 'mine', lane: TOP, dx: 272 }], pickups: [{ type: 'dash', lane: TOP, dx: 24 }, { type: 'gem', lane: TOP, dx: 190 }, { type: 'coin', lane: TOP, dx: 228 }, { type: 'coin', lane: MID, dx: 88 }] },
          { id: 'bottom_spike_escape', minRound: 3, weight: 2, safeLanes: [MID], obstacles: [{ type: 'spikes', lane: BOT, dx: 100 }, { type: 'mine', lane: TOP, dx: 200 }], pickups: [{ type: 'coin', lane: MID, dx: 18 }, { type: 'coin', lane: MID, dx: 60 }, { type: 'coin', lane: MID, dx: 102 }, { type: 'worm', lane: MID, dx: 146 }] },
          { id: 'mixed_pressure', minRound: 3, weight: 2, safeLanes: [TOP], obstacles: [{ type: 'rock', lane: MID, dx: 104 }, { type: 'spikes', lane: BOT, dx: 164 }], pickups: [{ type: 'coin', lane: TOP, dx: 0 }, { type: 'coin', lane: TOP, dx: 42 }, { type: 'coin', lane: TOP, dx: 84 }, { type: 'gem', lane: TOP, dx: 126 }] },
          { id: 'triple_choice', minRound: 4, weight: 2, safeLanes: [MID], obstacles: [{ type: 'mine', lane: TOP, dx: 88 }, { type: 'rock', lane: BOT, dx: 142 }], pickups: [{ type: 'dash', lane: MID, dx: 24 }, { type: 'coin', lane: MID, dx: 70 }, { type: 'gem', lane: MID, dx: 208 }, { type: 'coin', lane: TOP, dx: 182 }] },
          { id: 'charge_dash_gate_forced', minRound: 2, weight: 3, safeLanes: [MID], skillGate: true, obstacles: [{ type: 'mine', lane: TOP, dx: 142 }, { type: 'spikes', lane: BOT, dx: 158 }, { type: 'rock', lane: MID, dx: 214 }], pickups: [{ type: 'dash', lane: MID, dx: 18 }, { type: 'coin', lane: MID, dx: 62 }, { type: 'coin', lane: MID, dx: 106 }, { type: 'gem', lane: MID, dx: 286 }, { type: 'worm', lane: MID, dx: 330 }] },
          { id: 'top_treasure_squeeze', minRound: 2, weight: 3, safeLanes: [MID, BOT], obstacles: [{ type: 'mine', lane: TOP, dx: 118 }, { type: 'mine', lane: TOP, dx: 262 }], pickups: [{ type: 'coin', lane: TOP, dx: 0 }, { type: 'coin', lane: TOP, dx: 38 }, { type: 'gem', lane: TOP, dx: 76 }, { type: 'coin', lane: MID, dx: 166 }, { type: 'coin', lane: TOP, dx: 220 }, { type: 'gem', lane: TOP, dx: 326 }] },
          { id: 'low_road_tax', minRound: 2, weight: 2, safeLanes: [MID], obstacles: [{ type: 'spikes', lane: BOT, dx: 104 }, { type: 'spikes', lane: BOT, dx: 228 }], pickups: [{ type: 'coin', lane: MID, dx: 12 }, { type: 'coin', lane: MID, dx: 54 }, { type: 'coin', lane: MID, dx: 96 }, { type: 'worm', lane: TOP, dx: 150 }, { type: 'coin', lane: MID, dx: 198 }, { type: 'coin', lane: MID, dx: 240 }] },
          { id: 'dash_bonus_branch', minRound: 3, weight: 3, safeLanes: [BOT], obstacles: [{ type: 'mine', lane: TOP, dx: 96 }, { type: 'rock', lane: MID, dx: 142 }], pickups: [{ type: 'dash', lane: MID, dx: 10 }, { type: 'gem', lane: MID, dx: 210 }, { type: 'gem', lane: MID, dx: 254 }, { type: 'coin', lane: BOT, dx: 42 }, { type: 'worm', lane: BOT, dx: 90 }] },
          { id: 'late_round_pressure_gate', minRound: 4, weight: 2, safeLanes: [MID], skillGate: true, obstacles: [{ type: 'mine', lane: TOP, dx: 88 }, { type: 'spikes', lane: BOT, dx: 126 }, { type: 'rock', lane: MID, dx: 188 }, { type: 'mine', lane: TOP, dx: 318 }], pickups: [{ type: 'dash', lane: MID, dx: 8 }, { type: 'coin', lane: TOP, dx: 30 }, { type: 'coin', lane: MID, dx: 64 }, { type: 'gem', lane: MID, dx: 260 }, { type: 'heart', lane: MID, dx: 344 }] },
          { id: 'checkpoint_reward_line', minRound: 1, weight: 999, checkpointOnly: true, safeLanes: [MID, BOT], obstacles: [], pickups: [{ type: 'coin', lane: TOP, dx: 0 }, { type: 'coin', lane: MID, dx: 40 }, { type: 'coin', lane: TOP, dx: 80 }, { type: 'worm', lane: MID, dx: 120 }, { type: 'gem', lane: TOP, dx: 170 }, { type: 'coin', lane: BOT, dx: 220 }] },
        ];
        const TUTORIAL_SEQUENCE = ['middle_coin_line', 'top_coin_rush', 'middle_spike_redirect', 'dash_gate_bonus', 'bottom_relocation'];

        let progress = migrateProgress(load(Storage.diglew, defaultProgress));
        let board = migrateBoard(load(Storage.diglewBoard, []));
        let run = null;
        let log = [];
        let animId = 0;
        let lastTs = 0;
        let pendingDiglewReward = null;
        let touchControls = null;
        let inputInitDone = false;

        function migrateProgress(raw) {
          const source = raw || {};
          const next = { ...defaultProgress, ...source };
          next.city = { ...defaultProgress.city, ...(source.city || {}) };
          next.bestDistance = Number(source.bestDistance || source.bestDepth || 0) || 0;
          next.bestScore = Number(source.bestScore || 0) || 0;
          next.totalRuns = Number(source.totalRuns || 0) || 0;
          next.checkpoints = Number(source.checkpoints || 0) || 0;
          next.worms = Number(source.worms || 0) || 0;
          next.winlew = Number(source.winlew || 0) || 0;
          return next;
        }

        function migrateBoard(items) {
          return (Array.isArray(items) ? items : []).map((item) => ({
            score: Number(item.score || 0) || 0,
            distance: Number(item.distance || item.depth || 0) || 0,
            coins: Number(item.coins || 0) || 0,
            worms: Number(item.worms || 0) || 0,
            gems: Number(item.gems || item.gold || 0) || 0,
            hits: Number(item.hits || 0) || 0,
            dashes: Number(item.dashes || 0) || 0,
            rocks: Number(item.rocks || item.rocksBroken || 0) || 0,
            round: Number(item.round || item.stage || 1) || 1,
            checkpoint: Number(item.checkpoint || BASE_CHECKPOINT) || BASE_CHECKPOINT,
            payout: item.payout ? Number(item.payout) : undefined,
            multiplier: item.multiplier ? Number(item.multiplier) : undefined,
          })).sort((a, b) => b.score - a.score).slice(0, 12);
        }

        function currentStage() { return Math.max(1, Number(progress.checkpoints || 0) + 1); }
        function checkpointForStage(stage = currentStage()) { return Math.min(MAX_CHECKPOINT, BASE_CHECKPOINT + (Math.max(1, stage) - 1) * CHECKPOINT_STEP); }
        function laneY(lane) { return LANES[clamp(lane, TOP, BOT)]?.y || LANES[MID].y; }
        function laneName(lane) { return LANES[clamp(lane, TOP, BOT)]?.name || 'Main Road'; }

        function isMobileLike() {
          try {
            const profile = typeof detectDeviceProfile === 'function' ? detectDeviceProfile() : null;
            return Boolean(profile?.isMobileLike || window.innerWidth < 860 || Number(navigator.maxTouchPoints || 0) > 0);
          } catch (_error) {
            return window.innerWidth < 860 || Number(navigator.maxTouchPoints || 0) > 0;
          }
        }
        function getTuning() {
          const mobile = isMobileLike();
          return {
            mobile,
            speedScale: mobile ? 0.91 : 1,
            magnetBonus: mobile ? 14 : 0,
            dashCooldownBonus: mobile ? 0.18 : 0,
            spawnGapBonus: mobile ? 7 : 0,
            laneCooldown: mobile ? 0.065 : LANE_CHANGE_COOLDOWN,
            touchSwipeMin: mobile ? 24 : 32,
          };
        }
        function buildSupportDrops(stage, checkpoint) {
          const drops = [];
          const heartFractions = stage === 1 ? [0.56] : stage === 2 ? [0.46, 0.80] : [0.28, 0.58, 0.84].filter((f) => checkpoint * f < checkpoint - 24);
          heartFractions.forEach((fraction, idx) => drops.push({ type: 'heart', at: Math.floor(checkpoint * fraction), lane: idx % 2 === 0 ? MID : BOT, spawned: false }));
          const chargeFractions = stage >= 4 ? [0.18, 0.42, 0.66, 0.84] : [0.20, 0.45, 0.70];
          chargeFractions.filter((f) => checkpoint * f < checkpoint - 36).forEach((fraction, idx) => drops.push({ type: 'dash', at: Math.floor(checkpoint * fraction), lane: [TOP, MID, TOP, MID][idx % 4], spawned: false }));
          return drops.sort((a, b) => a.at - b.at);
        }
        function spawnSupportDrops() {
          if (!run?.supportDrops?.length) return;
          run.supportDrops.forEach((drop) => {
            if (drop.spawned || run.distance < drop.at) return;
            drop.spawned = true;
            addPickup(drop.type, canvas.width + (isMobileLike() ? 205 : 170), clamp(drop.lane, TOP, BOT));
          });
        }
        function laneColor(laneId, alpha = 1) {
          const lane = LANES[clamp(laneId, TOP, BOT)] || LANES[MID];
          const hex = lane.tint.replace('#', '');
          const to = (i) => parseInt(hex.slice(i, i + 2), 16);
          return `rgba(${to(0)}, ${to(2)}, ${to(4)}, ${alpha})`;
        }
        function drawHexGem(x, y, r, fill, stroke) {
          ctx.fillStyle = fill;
          ctx.beginPath();
          for (let i = 0; i < 6; i += 1) {
            const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
          if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
        }

        function getEffects() {
          const stage = currentStage();
          const tuning = getTuning();
          const baseSpeed = 302 + Math.min(78, (stage - 1) * 14) + progress.city.forge * 8;
          return {
            magnet: 34 + progress.city.scanner * 13 + tuning.magnetBonus,
            speed: Math.round(baseSpeed * tuning.speedScale),
            dashCooldown: Math.max(1.95, DEFAULT_DASH_COOLDOWN - progress.city.forge * 0.26 - tuning.dashCooldownBonus),
            rewardScale: 1 + progress.city.larder * 0.08,
            maxHearts: 3 + (progress.city.brace >= 4 ? 1 : 0),
            shield: Math.floor(progress.city.brace / 2),
            invuln: HIT_INVULN + progress.city.brace * 0.04 + (tuning.mobile ? 0.10 : 0),
          };
        }

        function saveAll() { save(Storage.diglew, progress); save(Storage.diglewBoard, board); }
        function addLog(msg) {
          log.unshift(msg); log = log.slice(0, 12);
          if (logEl) logEl.innerHTML = log.map((m) => `<div class="log-entry">${m}</div>`).join('');
        }
        function blurActiveControl() {
          const active = document.activeElement;
          if (active && typeof active.blur === 'function' && ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) active.blur();
        }
        function normalizePlayer() {
          if (!run?.player) return;
          const p = run.player;
          p.targetLane = clamp(Number.isFinite(p.targetLane) ? p.targetLane : START_LANE, TOP, BOT);
          p.lane = clamp(Number.isFinite(p.lane) ? p.lane : p.targetLane, TOP, BOT);
          const expectedY = laneY(p.targetLane);
          if (!Number.isFinite(p.laneY) || p.laneY < 0 || p.laneY > canvas.height + 160) p.laneY = expectedY;
          if (!Number.isFinite(p.x) || p.x < -40 || p.x > canvas.width) p.x = PLAYER_X;
          if (!Number.isFinite(p.dashCooldown)) p.dashCooldown = 0;
          if (!Number.isFinite(p.dashTime)) p.dashTime = 0;
          if (!Number.isFinite(p.laneCooldown)) p.laneCooldown = 0;
          if (!Number.isFinite(p.moveDirection)) p.moveDirection = 0;
          if (!Number.isFinite(p.landBounce)) p.landBounce = 0;
        }
        function cancelLoop() { if (animId) cancelAnimationFrame(animId); animId = 0; lastTs = 0; }
        function ensureLoop() { if (!animId && run && !run.over) { lastTs = 0; animId = requestAnimationFrame(loop); } }
        function setRunningClass() {
          if (!views?.diglew) return;
          views.diglew.classList.toggle('diglew-active-run', Boolean(run && !run.over));
          views.diglew.classList.toggle('diglew-ended-run', Boolean(run && run.over));
          views.diglew.classList.toggle('diglew-paused-run', Boolean(run && run.paused && !run.over));
        }

        function ensurePauseButton() {
          let btn = $('diglewPauseTop');
          if (btn) return btn;
          const startTop = $('diglewStartTop');
          if (!startTop?.parentElement) return null;
          btn = document.createElement('button');
          btn.id = 'diglewPauseTop';
          btn.className = 'btn ghost hidden';
          btn.type = 'button';
          btn.textContent = 'Pause';
          startTop.insertAdjacentElement('afterend', btn);
          return btn;
        }

        function togglePause(force) {
          if (!run || run.over) return;
          blurActiveControl();
          normalizePlayer();
          run.paused = typeof force === 'boolean' ? force : !run.paused;
          lastTs = 0;
          const pauseBtn = ensurePauseButton();
          if (pauseBtn) pauseBtn.textContent = run.paused ? 'Resume' : 'Pause';
          addLog(run.paused ? 'Paused. Press P / Esc or Resume to continue.' : 'Resumed. Keep the safe road open and push to the checkpoint.');
          renderAll(); draw(); setRunningClass(); ensureLoop();
        }

        function ensureTouchControls() {
          if (!playArea) return;
          if (!document.getElementById('diglewStep6TouchStyle')) {
            const style = document.createElement('style');
            style.id = 'diglewStep6TouchStyle';
            style.textContent = `
              #diglewCanvas{touch-action:none;-webkit-user-select:none;user-select:none;}
              .diglew-touch-controls-v47{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:none;gap:12px;z-index:8;pointer-events:auto;}
              .diglew-touch-controls-v47 button{min-width:92px;min-height:58px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:rgba(8,10,16,.72);color:#fff;font-weight:900;box-shadow:0 10px 24px rgba(0,0,0,.32);backdrop-filter:blur(10px);}
              .diglew-touch-controls-v47 button span{display:block;font-size:11px;opacity:.85;margin-top:2px;}
              .diglew-touch-controls-v47 button[data-action="dash"]{background:linear-gradient(180deg,rgba(245,172,63,.92),rgba(154,79,18,.88));border-color:rgba(255,220,143,.45);}
              .diglew-touch-controls-v47 button.is-pressed{transform:translateY(1px) scale(.98);filter:brightness(1.2);}
              @media (pointer:coarse),(max-width:860px){.diglew-active-run .diglew-touch-controls-v47,.diglew-paused-run .diglew-touch-controls-v47{display:flex}.diglew-active-run .sidebar,.diglew-active-run .rightbar{display:none}.diglew-active-run .game-shell{grid-template-columns:1fr}.diglew-active-run .play-area{min-height:calc(100vh - 132px)}.diglew-active-run .hud-strip{font-size:12px;gap:8px}.diglew-active-run .gameHeader{font-size:12px}.diglew-active-run .gameHeader .headerActions{gap:6px;flex-wrap:wrap}.diglew-active-run .gameHeader .btn{padding:9px 11px;font-size:12px}}
            `;
            document.head.appendChild(style);
          }
          if (canvas) {
            canvas.style.touchAction = 'none';
            canvas.style.webkitUserSelect = 'none';
            canvas.style.userSelect = 'none';
          }
          if (playArea) playArea.style.touchAction = 'none';
          if (!touchControls) {
            touchControls = document.createElement('div');
            touchControls.className = 'diglew-touch-controls diglew-touch-controls-v47';
            touchControls.innerHTML = `
              <button type="button" data-action="laneUp">⬆️<span>Road Up</span></button>
              <button type="button" data-action="dash">⚡<span>Dash</span></button>
              <button type="button" data-action="laneDown">⬇️<span>Road Down</span></button>
            `;
            playArea.appendChild(touchControls);
            touchControls.querySelectorAll('button').forEach((btn) => {
              const release = () => btn.classList.remove('is-pressed');
              btn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                btn.classList.add('is-pressed');
                if (typeof btn.blur === 'function') btn.blur();
                blurActiveControl();
                const action = btn.dataset.action;
                if (action === 'laneUp') changeLane(-1);
                if (action === 'laneDown') changeLane(1);
                if (action === 'dash') requestDash();
              });
              btn.addEventListener('pointerup', release);
              btn.addEventListener('pointercancel', release);
              btn.addEventListener('pointerleave', release);
            });
          }
          if (canvas && !canvas.dataset.diglewStep6Gestures) {
            canvas.dataset.diglewStep6Gestures = '1';
            let start = null;
            canvas.addEventListener('pointerdown', (e) => {
              if (!isMobileLike()) return;
              e.preventDefault();
              start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
              try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
            }, { passive: false });
            canvas.addEventListener('pointerup', (e) => {
              if (!start || !isMobileLike()) return;
              e.preventDefault();
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              const min = getTuning().touchSwipeMin;
              if (Math.abs(dy) >= min && Math.abs(dy) > Math.abs(dx) * 0.72) changeLane(dy < 0 ? -1 : 1);
              else if (Math.abs(dx) >= 54 && Math.abs(dx) > Math.abs(dy) * 1.1) requestDash();
              start = null;
            }, { passive: false });
            canvas.addEventListener('pointercancel', () => { start = null; });
          }
        }

        function resetProgress() {
          blurActiveControl();
          cancelLoop(); hideRewardOverlay(); pendingDiglewReward = null;
          progress = JSON.parse(JSON.stringify(defaultProgress));
          board = []; run = null; log = ['Progress reset. DigLEW is ready for a fresh 3-road tunnel run.'];
          saveAll(); renderWalletDisplays(); renderAll(); draw(); renderHubBoards(); setRunningClass();
        }

        function makePlayer() {
          return { x: PLAYER_X, lane: START_LANE, targetLane: START_LANE, laneY: laneY(START_LANE), w: PLAYER_W, h: PLAYER_H, dashTime: 0, dashCooldown: 0, laneCooldown: 0, moveDirection: 0, landBounce: 0, state: 'run' };
        }

        function startRun() {
          blurActiveControl();
          // Bring the canvas into view, not the top of the whole site —
          // scrolling to page-top jumps away from the game itself, and every
          // entry into active play (fresh start, resume, checkpoint
          // continue) funnels through here, so hazards can't already be
          // moving before the player can even see the board. Instant, not
          // smooth — a fast game can't afford the animation's real time.
          canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
          ensureTouchControls();
          const pauseBtn = ensurePauseButton();
          if (run && run.won && pendingDiglewReward) { rewardOverlay.classList.remove('hidden'); rewardOverlay.setAttribute('aria-hidden', 'false'); return; }
          pendingDiglewReward = null; hideRewardOverlay(); cancelLoop();
          const effects = getEffects(); const stage = currentStage();
          run = {
            over: false, won: false, paused: false, stage, checkpoint: checkpointForStage(stage),
            distance: 0, score: 0, speed: effects.speed, hearts: effects.maxHearts, maxHearts: effects.maxHearts,
            shield: effects.shield, invuln: 0, time: 0, worldX: 0, player: makePlayer(), objects: [], particles: [], floatTexts: [],
            nextPatternDistance: 26, tutorialStep: 0, previousPatternId: '', previousBottomHazard: false, checkpointLineSpawned: false,
            patternCount: 0, forcedDashGateShown: false, branchGateShown: false,
            supportDrops: buildSupportDrops(stage, checkpointForStage(stage)),
            combo: 0, bestCombo: 0, summary: null, stats: { coins: 0, worms: 0, gems: 0, hits: 0, dashes: 0, laneChanges: 0, rocksBroken: 0, hearts: 0, dashPacks: 0 },
            message: `Reach ${checkpointForStage(stage)}m to open the reward box.`, shake: 0, flash: 0, flashGold: 0, introTime: 2.15, checkpointBurstTime: 0,
          };
          normalizePlayer();
          if (pauseBtn) { pauseBtn.classList.remove('hidden'); pauseBtn.textContent = 'Pause'; }
          log = [];
          addLog(`Round ${stage} started. Read the roads, chase Risk Road treasure, and earn the ${run.checkpoint}m checkpoint reward.`);
          renderAll(); draw(); setRunningClass(); animId = requestAnimationFrame(loop);
        }

        function changeLane(delta) {
          if (!run || run.over || run.paused) return;
          normalizePlayer();
          const p = run.player;
          if (p.laneCooldown > 0) return;
          const next = clamp(p.targetLane + delta, TOP, BOT);
          if (next === p.targetLane) return;
          p.targetLane = next;
          p.moveDirection = Math.sign(delta);
          p.laneCooldown = getTuning().laneCooldown;
          p.state = 'lane';
          run.stats.laneChanges += 1;
          run.score += 2;
          spawnBurst(p.x + 24, p.laneY - 34, LANES[next].tint, 7, 0.45);
          Sound.blip(360 + next * 70, 0.045, 'triangle', 0.024);
        }

        function requestDash() {
          if (!run || run.over || run.paused) return;
          normalizePlayer();
          const p = run.player; const effects = getEffects();
          if (p.dashCooldown > 0 || p.dashTime > 0) return;
          p.dashTime = DASH_DURATION;
          p.dashCooldown = effects.dashCooldown;
          p.state = 'dash';
          run.stats.dashes += 1;
          run.combo += 1;
          run.score += 14;
          run.bestCombo = Math.max(run.bestCombo || 0, run.combo || 0);
          spawnBurst(p.x + p.w, p.laneY - 44, '#65d8ff', 24, 1.35);
          addFloatText('DASH', p.x + p.w + 22, p.laneY - 72, '#65d8ff');
          run.shake = Math.max(run.shake || 0, 2.6);
          Sound.power();
          setTimeout(() => Sound.blip(820, 0.045, 'triangle', 0.025), 35);
        }

        function gradeRun(score, won = false) {
          if (!run) return won ? 'A' : 'C';
          const cleanBonus = run.stats.hits === 0 ? 1 : 0;
          const rewardPull = run.stats.gems * 2 + run.stats.rocksBroken + Math.floor(run.stats.coins / 10) + cleanBonus;
          if (won && rewardPull >= 10) return 'S';
          if (won && rewardPull >= 7) return 'A';
          if (won) return 'B';
          if (score >= 900) return 'B';
          return 'C';
        }

        function buildRunSummary(score, won) {
          const grade = gradeRun(score, won);
          return {
            grade, score, won, round: run?.stage || 1, distance: Math.floor(run?.distance || 0), checkpoint: run?.checkpoint || checkpointForStage(),
            coins: run?.stats?.coins || 0, worms: run?.stats?.worms || 0, gems: run?.stats?.gems || 0,
            hits: run?.stats?.hits || 0, dashes: run?.stats?.dashes || 0, rocks: run?.stats?.rocksBroken || 0,
            bestCombo: run?.bestCombo || run?.combo || 0, dashPacks: run?.stats?.dashPacks || 0, hearts: run?.stats?.hearts || 0,
            perfect: Boolean(won && (run?.stats?.hits || 0) === 0),
          };
        }

        function completeCheckpoint() {
          if (!run || run.over) return;
          run.distance = Math.max(run.distance, run.checkpoint); run.won = true; run.over = true; run.paused = false; cancelLoop();
          const score = Math.max(0, Math.floor(run.stats.coins * 10 + run.stats.worms * 20 + run.stats.gems * 50 + run.distance * 1.2 + run.stats.rocksBroken * 35 - run.stats.hits * 50 + run.score));
          run.score = score;
          run.summary = buildRunSummary(score, true);
          spawnBurst(canvas.width * 0.5, 160, '#f8c84d', 48, 2.1);
          spawnBurst(canvas.width * 0.5 + 80, 170, '#65d8ff', 32, 1.7);
          addFloatText(`GRADE ${run.summary.grade}`, canvas.width * 0.5 - 20, 210, '#fff1c7');
          run.shake = 8;
          run.flashGold = 0.75;
          run.checkpointBurstTime = 1.8;
          Sound.win();
          setTimeout(() => Sound.blip(1040, 0.06, 'triangle', 0.035), 70);
          setTimeout(() => Sound.blip(1260, 0.06, 'triangle', 0.03), 140);
          addLog(`Round ${run.stage} checkpoint reached: Grade ${run.summary.grade}, Score ${score}, Rocks ${run.stats.rocksBroken}, Hits ${run.stats.hits}.`);
          openReward(score); renderAll(); draw(); setRunningClass();
        }

        function failRun(reason) {
          if (!run || run.over) return;
          const score = Math.max(0, Math.round(run.score || 0));
          run.summary = buildRunSummary(score, false);
          run.over = true; run.paused = false; run.won = false; cancelLoop();
          addLog(`<strong>Run failed.</strong> ${reason} Score ${score}, distance ${Math.floor(run.distance)}m.`);
          Sound.hurt(); renderAll(); draw(); setRunningClass();
        }

        function openReward(score) {
          if (!run) return;
          const claimToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const effects = getEffects(); const distance = Math.floor(run.distance);
          const checkpointReward = 2 + Math.min(run.stage - 1, 4) * 0.75;
          const wormBonus = run.stats.worms * 0.25;
          const gemBonus = run.stats.gems * 0.5;
          const coinBonus = Math.floor(run.stats.coins / 10) * 0.25;
          const distanceBonus = Math.floor(distance / 100) * 0.25;
          const grade = run.summary?.grade || gradeRun(score, true);
          const gradeBonus = grade === 'S' ? 1.15 : grade === 'A' ? 1.08 : grade === 'B' ? 1.03 : 1;
          const cleanBonus = run.stats.hits === 0 ? 0.5 : 0;
          const perfectBonus = run.stats.hits === 0 ? Number((0.5 + Math.min(run.stage, 5) * 0.12).toFixed(2)) : 0;
          const rockBonus = run.stats.rocksBroken * 0.2;
          const rawBaseReward = Number(((checkpointReward + wormBonus + gemBonus + coinBonus + distanceBonus + cleanBonus + perfectBonus + rockBonus) * effects.rewardScale * gradeBonus).toFixed(2));
          const baseReward = balanceGameReward('diglew', rawBaseReward);
          const boxes = buildRewardBoxes(); pendingDiglewReward = true;
          showRewardOverlay({
            title: 'DigLEW ✨ Road Checkpoint Reward', badge: `${run.checkpoint}m reached`,
            text: `You reached the <strong>Round ${run.stage} • ${run.checkpoint}m checkpoint</strong> with <strong>Grade ${grade}</strong>.<br><br>Base reward: <strong>${baseReward.toFixed(2)} WinLEW</strong>${perfectBonus ? `<br><strong>Perfect Road Bonus:</strong> +${perfectBonus.toFixed(2)} base` : ''}<br><span class="muted">Coins ${run.stats.coins} • Worms ${run.stats.worms} • Gems ${run.stats.gems} • Rocks ${run.stats.rocksBroken} • Hits ${run.stats.hits} • Best combo ${run.bestCombo || run.combo || 0}</span>`,
            boxes, continueLabel: '➡️ Start Next Run',
            onPick: (box) => {
              const payout = Number((baseReward * box.multiplier).toFixed(2));
              const walletTotal = addWallet(payout); renderWalletDisplays();
              const wormGain = run.stats.worms + Math.max(2, Math.floor(run.stats.coins / 8)) + run.stats.gems;
              progress.worms += wormGain; progress.winlew = walletTotal; progress.totalRuns += 1; progress.checkpoints += 1;
              progress.bestDistance = Math.max(progress.bestDistance, distance); progress.bestScore = Math.max(progress.bestScore, score);
              board.push({ score, distance, checkpoint: run.checkpoint, round: run.stage, coins: run.stats.coins, worms: run.stats.worms, gems: run.stats.gems, hits: run.stats.hits, dashes: run.stats.dashes, rocks: run.stats.rocksBroken, payout, multiplier: box.multiplier });
              board.sort((a, b) => b.score - a.score); board = board.slice(0, 12); saveAll(); renderHubBoards(); renderAll(); draw();
              const claimPromise = postRewardClaim({
                game: 'diglew', roundKey: `road-${claimToken}`, roundLabel: `DigLEW road ${run.stage} ${run.checkpoint}m checkpoint ${progress.totalRuns}`,
                baseReward: rawBaseReward, multiplier: box.multiplier, payout,
                meta: { round: run.stage, distance, checkpoint: run.checkpoint, coins: run.stats.coins, worms: run.stats.worms, gems: run.stats.gems, hits: run.stats.hits, dashes: run.stats.dashes, rocksBroken: run.stats.rocksBroken, score, rawBaseReward },
              });
              // Corrects this optimistic credit to the server-authoritative
              // amount (up, down, or rolled back entirely) the moment the
              // claim response lands, instead of leaving it to eventually
              // self-heal — which for a guest only ever heals upward.
              const sync = reconcileClaimResult(payout, claimPromise);
              return {
                immediate: `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> in-app.<br>Stored total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`,
                sync,
              };
            },
            onContinue: () => { pendingDiglewReward = null; startRun(); },
          });
        }

        function buyUpgrade(key) {
          const up = upgrades[key]; const lvl = progress.city[key];
          if (lvl >= up.max) return addLog(`${up.name} is maxed.`);
          const cost = up.base + lvl * 4;
          if (progress.worms < cost) return addLog(`Need ${cost} worms for ${up.name}.`);
          progress.worms -= cost; progress.city[key] += 1; saveAll();
          addLog(`${up.name} upgraded to level ${progress.city[key]}.`); Sound.power(); renderAll(); renderHubBoards();
        }

        function playerRect() {
          if (!run) return { x: 0, y: 0, w: 0, h: 0 };
          const p = run.player;
          return { x: p.x + 18, y: p.laneY - 70, w: p.w - 32, h: 58 };
        }
        function objectRect(obj) {
          const fy = laneY(obj.lane);
          if (obj.type === 'spikes') return { x: obj.x + 10, y: fy - 44, w: (obj.w || 92) - 20, h: 42 };
          if (obj.type === 'mine') return { x: obj.x - (obj.r || 30), y: fy - 124, w: (obj.r || 30) * 2, h: (obj.r || 30) * 2 };
          if (obj.type === 'rock') return { x: obj.x + 8, y: fy - (obj.h || 104) + 8, w: (obj.w || 76) - 16, h: (obj.h || 104) - 12 };
          return { x: obj.x, y: obj.y, w: obj.w || 0, h: obj.h || 0 };
        }
        function rectsOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
        function addObject(obj) { run.objects.push({ ...obj, id: `${obj.type}-${Date.now()}-${Math.random()}`, hit: false, collected: false }); }
        function addPickup(type, x, lane) { const fy = laneY(lane); addObject({ type, x, lane, y: fy - 62, r: type === 'gem' ? 15 : type === 'worm' ? 13 : type === 'heart' ? 16 : 14 }); }

        function spawnPatternById(id) {
          const pattern = PATTERNS.find((p) => p.id === id);
          if (!pattern || !run) return;
          const spawnX = canvas.width + 150;
          pattern.obstacles.forEach((obs) => {
            const lane = obs.type === 'mine' ? TOP : clamp(obs.lane, TOP, BOT);
            const base = { type: obs.type, lane, x: spawnX + (obs.dx || 0) };
            if (obs.type === 'spikes') Object.assign(base, { w: 92, h: 42 });
            if (obs.type === 'mine') Object.assign(base, { r: 29 + Math.min(5, run.stage), chainTop: 104, swing: 0 });
            if (obs.type === 'rock') Object.assign(base, { w: 76, h: 104 });
            addObject(base);
          });
          pattern.pickups.forEach((pick) => addPickup(pick.type, spawnX + (pick.dx || 0), clamp(pick.lane, TOP, BOT)));
          run.previousPatternId = pattern.id;
          run.previousBottomHazard = pattern.obstacles.some((o) => o.lane === BOT);
          run.patternCount = (run.patternCount || 0) + 1;
          if (pattern.skillGate) addLog('Skill gate ahead: grab the blue charge, then dash the cracked rock.');
        }

        function patternCanSpawn(pattern) {
          if (!pattern || pattern.checkpointOnly) return false;
          if (run.stage < pattern.minRound) return false;
          if (pattern.id === run.previousPatternId) return false;
          const bottomHazard = pattern.obstacles.some((o) => o.lane === BOT);
          if (bottomHazard && run.previousBottomHazard) return false;
          if (pattern.skillGate && ['charge_dash_gate_forced', 'late_round_pressure_gate'].includes(run.previousPatternId)) return false;
          if (!pattern.safeLanes || pattern.safeLanes.length < 1) return false;
          return true;
        }

        function choosePatternId() {
          if (run.stage === 1 && run.tutorialStep < TUTORIAL_SEQUENCE.length) return TUTORIAL_SEQUENCE[run.tutorialStep++];
          const count = run.patternCount || 0;

          if (run.stage >= 2 && !run.forcedDashGateShown && run.distance > Math.min(150, run.checkpoint * 0.26)) {
            run.forcedDashGateShown = true;
            if (patternCanSpawn(PATTERNS.find((p) => p.id === 'charge_dash_gate_forced'))) return 'charge_dash_gate_forced';
          }
          if (run.stage >= 3 && !run.branchGateShown && run.distance > Math.min(260, run.checkpoint * 0.42)) {
            run.branchGateShown = true;
            if (patternCanSpawn(PATTERNS.find((p) => p.id === 'dash_bonus_branch'))) return 'dash_bonus_branch';
          }

          const choreoPool = [];
          if (run.stage >= 2 && count % 4 === 1) choreoPool.push('top_treasure_squeeze');
          if (run.stage >= 2 && count % 5 === 2) choreoPool.push('low_road_tax');
          if (run.stage >= 4 && count % 6 === 3) choreoPool.push('late_round_pressure_gate');
          for (const id of choreoPool) {
            const pattern = PATTERNS.find((pp) => pp.id === id);
            if (patternCanSpawn(pattern)) return id;
          }

          const candidates = PATTERNS.filter(patternCanSpawn);
          const total = candidates.reduce((sum, p) => sum + (p.weight || 1), 0);
          let roll = Math.random() * Math.max(1, total);
          for (const p of candidates) { roll -= p.weight || 1; if (roll <= 0) return p.id; }
          return candidates[0]?.id || 'middle_coin_line';
        }

        function spawnBurst(x, y, color, count, spread = 1) {
          if (!run) return;
          for (let i = 0; i < count; i++) run.particles.push({ x, y, vx: (Math.random() * 240 - 120) * spread, vy: -60 - Math.random() * 180, gravity: 480, life: 0.4 + Math.random() * 0.32, size: 3 + Math.random() * 6, color });
        }
        function addFloatText(text, x, y, color = '#fff1c7') {
          if (!run) return;
          run.floatTexts = run.floatTexts || [];
          run.floatTexts.push({ text, x, y, color, life: 1.05, vy: -34, scale: 1 });
          run.floatTexts = run.floatTexts.slice(-10);
        }

        function collect(obj) {
          if (!run || obj.collected) return;
          obj.collected = true; run.combo += 1;
          const laneBonus = LANES[obj.lane]?.reward || 1;
          if (obj.type === 'coin') { const gain = Math.round((10 + Math.min(20, run.combo)) * laneBonus); run.stats.coins += 1; run.score += gain; run.bestCombo = Math.max(run.bestCombo || 0, run.combo || 0); spawnBurst(obj.x, obj.y, '#f8c84e', 7, 0.7); addFloatText(`+${gain}`, obj.x, obj.y - 24, '#f8c84e'); Sound.coin(); }
          if (obj.type === 'worm') { const gain = Math.round((20 + Math.min(24, run.combo)) * laneBonus); run.stats.worms += 1; run.score += gain; run.bestCombo = Math.max(run.bestCombo || 0, run.combo || 0); spawnBurst(obj.x, obj.y, '#80ef7b', 9, 0.75); addFloatText(`WORM +${gain}`, obj.x, obj.y - 24, '#80ef7b'); Sound.coin(); }
          if (obj.type === 'gem') { const gain = Math.round((50 + Math.min(30, run.combo)) * laneBonus); run.stats.gems += 1; run.score += gain; run.bestCombo = Math.max(run.bestCombo || 0, run.combo || 0); spawnBurst(obj.x, obj.y, '#69b7ff', 12, 0.9); addFloatText(`GEM +${gain}`, obj.x, obj.y - 28, '#69b7ff'); Sound.power(); }
          if (obj.type === 'dash') {
            // Full reset, not a partial cooldown reduction: two patterns
            // (charge_dash_gate_forced, late_round_pressure_gate) place a
            // rock obstacle in the ONLY safe lane, so dashing through it is
            // not optional — it's the only way to avoid a hit. A partial
            // reduction left a real gap: a player who'd just dashed shortly
            // before entering the pattern could still be on cooldown when
            // they reached the rock, taking an unavoidable hit despite
            // grabbing the "guaranteed" dash pickup placed there for exactly
            // that purpose (and costing them the 0-hits Perfect Road/S-grade
            // bonus through no fault of their own). A full reset guarantees
            // the pickup actually does what its placement promises.
            run.stats.dashPacks += 1; run.player.dashCooldown = 0; run.score += Math.round(28 * laneBonus); spawnBurst(obj.x, obj.y, '#71d8ff', 14, 0.95); Sound.power(); addFloatText('DASH CHARGE', obj.x, obj.y - 28, '#71d8ff');
            addLog('Dash charge collected. Ready to dash.'); }
          if (obj.type === 'heart') { run.stats.hearts += 1; if (run.hearts < run.maxHearts) { run.hearts += 1; addFloatText('+1 HEART', obj.x, obj.y - 28, '#ff7a92');
              addLog(`Heart pickup recovered 1 heart. Hearts ${run.hearts}/${run.maxHearts}.`); } else { run.score += 35; addFloatText('HEART BONUS', obj.x, obj.y - 28, '#ff7a92');
              addLog('Heart pickup converted to bonus score.'); } spawnBurst(obj.x, obj.y, '#ff7a92', 16, 1.0); Sound.win(); }
        }

        function hit(reason) {
          if (!run || run.over || run.invuln > 0) return;
          run.invuln = getEffects().invuln; run.flash = 0.28; run.shake = 6; run.combo = 0; run.stats.hits += 1;
          if (run.shield > 0) { run.shield -= 1; addLog(`${reason} Shield bracing absorbed the hit.`); }
          else { run.hearts -= 1; addLog(`${reason} Hearts left: ${Math.max(0, run.hearts)}.`); }
          spawnBurst(run.player.x + 40, run.player.laneY - 42, '#ff6d6d', 24, 1.25); addFloatText(run.shield > 0 ? 'SHIELD' : '-1 HEART', run.player.x + 58, run.player.laneY - 92, '#ff8c8c'); Sound.hurt();
          if (run.hearts <= 0) failRun('The tunnel got you. Switch lanes, dash cracked rocks, then try again.');
        }

        function updatePlayer(dt) {
          normalizePlayer();
          const p = run.player;
          p.dashCooldown = Math.max(0, p.dashCooldown - dt);
          p.dashTime = Math.max(0, p.dashTime - dt);
          p.laneCooldown = Math.max(0, p.laneCooldown - dt);
          p.landBounce = Math.max(0, p.landBounce - dt * 5.2);
          const targetY = laneY(p.targetLane);
          const wasChangingLane = p.lane !== p.targetLane;
          p.laneY += (targetY - p.laneY) * Math.min(1, dt * 13);
          if (Math.abs(p.laneY - targetY) < 0.5) {
            p.laneY = targetY;
            p.lane = p.targetLane;
            if (wasChangingLane) p.landBounce = 1;
          }
          if (p.dashTime > 0) p.state = 'dash';
          else if (p.lane !== p.targetLane) p.state = 'lane';
          else p.state = 'run';
        }

        function updateObjects(dt, scroll) {
          const effects = getEffects(); const body = playerRect();
          run.objects.forEach((obj) => {
            obj.x -= scroll * dt;
            if (obj.type === 'mine') obj.swing = (obj.swing || 0) + dt * 2.4;
            if (['coin', 'worm', 'gem', 'dash', 'heart'].includes(obj.type) && !obj.collected) {
              const sameLane = Math.abs(laneY(obj.lane) - run.player.laneY) < 48;
              const cx = body.x + body.w * 0.5; const cy = body.y + body.h * 0.5;
              const dx = cx - obj.x; const dy = cy - obj.y; const d = Math.hypot(dx, dy);
              if (sameLane && d < effects.magnet + obj.r) { obj.x += dx * dt * 8; obj.y += dy * dt * 8; }
              if (sameLane && d < obj.r + 26) collect(obj);
            }
            if (obj.hit || obj.collected) return;
            const sameLane = Math.abs(laneY(obj.lane) - run.player.laneY) < 42;
            if (!sameLane) return;
            if (obj.type === 'spikes' && rectsOverlap(body, objectRect(obj))) { obj.hit = true; hit('Spikes blocked this road. Move lanes earlier.'); }
            if (obj.type === 'mine' && rectsOverlap(body, objectRect(obj))) { obj.hit = true; hit('Top-road mine hit Lew. Drop to a lower road.'); }
            if (obj.type === 'rock' && rectsOverlap(body, objectRect(obj))) {
              if (run.player.dashTime > 0) {
                obj.hit = true; obj.breaking = true; run.combo += 2; run.bestCombo = Math.max(run.bestCombo || 0, run.combo || 0); run.stats.rocksBroken += 1; run.score += 48;
                spawnBurst(obj.x + (obj.w || 76) * 0.5, laneY(obj.lane) - (obj.h || 104) * 0.5, '#d69a5b', 36, 1.65);
                spawnBurst(obj.x + (obj.w || 76) * 0.5, laneY(obj.lane) - (obj.h || 104) * 0.5, '#71d8ff', 18, 1.2);
                addFloatText('SMASH +48', obj.x + 8, laneY(obj.lane) - 124, '#71d8ff');
                run.shake = Math.max(run.shake || 0, 8); run.flashBlue = 0.20; Sound.power();
                setTimeout(() => Sound.blip(420, 0.05, 'sawtooth', 0.035), 35);
              } else { obj.hit = true; hit('Cracked rock blocked this road. Dash or switch lanes.'); }
            }
          });
          run.objects = run.objects.filter((obj) => obj.x > -180 && !obj.collected && !obj.breaking);
        }

        function updateParticles(dt) {
          run.particles = run.particles.filter((p) => { p.life -= dt; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.life > 0; });
          run.floatTexts = (run.floatTexts || []).filter((f) => { f.life -= dt; f.y += f.vy * dt; f.scale += dt * 0.16; return f.life > 0; });
        }

        function update(dt) {
          if (!run || run.over || run.paused) return;
          normalizePlayer();
          run.time += dt; run.invuln = Math.max(0, run.invuln - dt); run.flash = Math.max(0, run.flash - dt); run.flashBlue = Math.max(0, (run.flashBlue || 0) - dt); run.flashGold = Math.max(0, (run.flashGold || 0) - dt); run.introTime = Math.max(0, (run.introTime || 0) - dt); run.checkpointBurstTime = Math.max(0, (run.checkpointBurstTime || 0) - dt); run.shake = Math.max(0, run.shake - 26 * dt);
          const scroll = run.speed + (run.player.dashTime > 0 ? 140 : 0);
          run.distance += scroll * dt * 0.094; run.worldX += scroll * dt; run.score += scroll * dt * 0.08;
          updatePlayer(dt);
          spawnSupportDrops();
          if (!run.checkpointLineSpawned && run.checkpoint - run.distance <= 90) { spawnPatternById('checkpoint_reward_line'); run.checkpointLineSpawned = true; }
          if (run.distance >= run.nextPatternDistance && run.distance < run.checkpoint - 96) {
            spawnPatternById(choosePatternId());
            const stageGap = Math.max(28, 50 - Math.min(17, (run.stage - 1) * 3.1));
            const flowBonus = run.patternCount % 3 === 0 ? 8 : 0;
            run.nextPatternDistance += stageGap + flowBonus + getTuning().spawnGapBonus + Math.min(22, run.distance * 0.017);
          }
          updateObjects(dt, scroll); updateParticles(dt);
          if (run.distance >= run.checkpoint) completeCheckpoint();
        }

        function loop(ts) {
          animId = 0;
          if (!run || run.over) return;
          try {
            if (!lastTs) lastTs = ts;
            const dt = Math.min(0.033, Math.max(0.001, (ts - lastTs) / 1000));
            lastTs = ts;
            // Idle the run while the hub/another view is showing — keep the frame
            // timer + re-arm alive, but don't progress or repaint in the
            // background (prevents a checkpoint reward popping over the hub).
            if (!views.diglew.classList.contains('hidden')) {
              update(dt);
              renderAll();
              draw();
            }
          } catch (error) {
            console.error('[WinLEW][DigLEW] render/update guard paused the run instead of freezing.', error);
            if (run && !run.over) {
              run.paused = true;
              lastTs = 0;
              addLog('Render guard paused DigLEW instead of freezing. Press Resume to continue.');
              try { renderAll(); draw(); setRunningClass(); } catch (_inner) {}
            }
            return;
          }
          if (run && !run.over) animId = requestAnimationFrame(loop);
        }

        function renderResources() {
          const effects = getEffects(); const nextCheckpoint = checkpointForStage();
          const items = [ ['Colony Worms', progress.worms], ['Stored WinLEW', loadWallet().toFixed(2)], ['Next Round', `${currentStage()} • ${nextCheckpoint}m`], ['Best Score', Math.floor(progress.bestScore)], ['Runs', progress.totalRuns], ['Dash Cooldown', `${effects.dashCooldown.toFixed(1)}s`] ];
          resourceEl.innerHTML = items.map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
        }

        function renderUpgrades() {
          if (run && !run.over) {
            upgradesEl.innerHTML = `<div class="upgrade-card diglew-run-tip"><h4>Focus on the roads</h4><p>Read the road, chase top-road treasure, grab blue charges, and smash cracked-rock gates. The bottom road helps recovery but does not pay for free.</p></div>`;
            return;
          }
          upgradesEl.innerHTML = Object.entries(upgrades).map(([key, up]) => {
            const lvl = progress.city[key]; const cost = up.base + lvl * 4; const ready = progress.worms >= cost && lvl < up.max;
            let benefit = '';
            if (key === 'scanner') benefit = `Pickup pull ${34 + lvl * 13}px → ${34 + (lvl + 1) * 13}px.`;
            if (key === 'forge') benefit = `Dash cooldown ${Math.max(2.05, DEFAULT_DASH_COOLDOWN - lvl * 0.26).toFixed(1)}s → ${Math.max(2.05, DEFAULT_DASH_COOLDOWN - (lvl + 1) * 0.26).toFixed(1)}s.`;
            if (key === 'larder') benefit = `Reward scale +${Math.round(lvl * 8)}% → +${Math.round((lvl + 1) * 8)}%.`;
            if (key === 'brace') benefit = `Shield pips ${Math.floor(lvl / 2)} → ${Math.floor((lvl + 1) / 2)}.`;
            return `<div class="upgrade-card ${ready ? 'ready' : ''}"><div class="upgrade-meta"><div><h4>${up.name}</h4><div class="cost">Level ${lvl}/${up.max}</div></div><button class="secondary-btn buy-diglew" data-key="${key}" ${lvl >= up.max ? 'disabled' : ''}>Upgrade</button></div><p>${up.desc}</p><div class="cost">${benefit}</div><div class="cost">Cost: ${cost} worms</div></div>`;
          }).join('');
          upgradesEl.querySelectorAll('.buy-diglew').forEach((btn) => btn.onclick = () => buyUpgrade(btn.dataset.key));
        }

        function renderMission() {
          const pauseBtn = ensurePauseButton();
          if (!run) {
            missionYard.textContent = 'Web / 3-Road Runner';
            missionTitle.textContent = `Round ${currentStage()} reaches ${checkpointForStage()}m`;
            missionText.textContent = 'Move roads, read choreographed gates, chase top-road treasure, grab dash charges and hearts, and dash cracked rocks.';
            turnsEl.textContent = `Checkpoint: ${checkpointForStage()}m`;
            senseEl.textContent = 'Controls: Up/Down lanes • Space/Shift/X dash';
            runInfoEl.textContent = 'Start on the middle road';
            upgradeHintEl.textContent = 'Top road pays the most. Bottom road is safer, but no longer free.';
            if (pauseBtn) pauseBtn.classList.add('hidden'); setRunningClass(); return;
          }
          missionYard.textContent = run.over ? (run.won ? 'Checkpoint Complete' : 'Run Failed') : (run.paused ? 'Paused' : `Round ${run.stage} Tunnel`);
          missionTitle.textContent = run.paused ? 'Paused — Resume when ready' : run.over ? (run.won ? 'Reward box ready' : 'Try the route again') : 'Switch • Dash • Collect';
          missionText.textContent = run.paused ? 'Press P / Esc or Resume to continue.' : run.over ? (run.won ? 'Pick a reward box, then launch the next longer road.' : 'The tunnel got you. Switch roads, dash cracked rocks, then try again.') : (isMobileLike() ? 'Swipe up/down or use the buttons. Risk Road pays more; blue charges set up dash gates.' : 'Move up/down between roads. Risk Road has the richest treasure, Safe Road has lighter rewards, and blue charges set up dash gates.');
          turnsEl.textContent = `Distance: ${Math.floor(run.distance)}m / ${run.checkpoint}m`;
          senseEl.textContent = `Hearts ${run.hearts}/${run.maxHearts} • Shield ${run.shield} • ${laneName(run.player.targetLane)} • Dash ${run.player.dashCooldown <= 0 ? 'ready' : `${run.player.dashCooldown.toFixed(1)}s`}`;
          runInfoEl.textContent = `Score ${Math.floor(run.score)} • Coins ${run.stats.coins} • Worms ${run.stats.worms} • Gems ${run.stats.gems} • Charges ${run.stats.dashPacks} • Combo ${run.bestCombo || run.combo || 0}`;
          upgradeHintEl.textContent = run.over ? 'Claim the reward, then upgrade between runs.' : (isMobileLike() ? `Mobile comfort active: slightly wider spacing and easier pickup pull. Reach ${run.checkpoint}m.` : `Round ${run.stage}: reach ${run.checkpoint}m. Choreographed gates are active — charge, route, dash, then collect.`);
          if (pauseBtn) { pauseBtn.classList.toggle('hidden', !run || run.over); pauseBtn.textContent = run.paused ? 'Resume' : 'Pause'; }
          setRunningClass();
        }

        function renderBoard() { renderBoardList(boardEl, board, 'diglew'); }
        function renderAll() {
          renderResources(); renderUpgrades(); renderMission(); renderBoard();
          const startLabel = run && run.won && pendingDiglewReward ? 'Claim Reward' : run && run.over ? 'Start Next Run' : run ? 'Restart Run' : 'Start Run';
          [ $('diglewStartBtn'), $('diglewStartTop') ].forEach((btn) => { if (btn) btn.textContent = startLabel; });
          if (logEl) logEl.innerHTML = log.map((m) => `<div class="log-entry">${m}</div>`).join('');
        }

        function drawRoundedRect(x, y, w, h, r) {
          const radius = Math.min(r, w / 2, h / 2);
          ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius); ctx.lineTo(x + w, y + h - radius); ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h); ctx.lineTo(x + radius, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
        }
        function runWorld(speed = 1) { return run ? run.worldX * speed : performance.now() * 0.03 * speed; }

        function drawBackground() {
          const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
          bg.addColorStop(0, '#120906'); bg.addColorStop(0.25, '#24140c'); bg.addColorStop(0.55, '#4a2a19'); bg.addColorStop(1, '#090505');
          ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
          const centerX = canvas.width * 0.60; const centerY = 392;
          const tunnelGlow = ctx.createRadialGradient(centerX - runWorld(0.03), centerY, 40, centerX - runWorld(0.03), centerY, 620);
          tunnelGlow.addColorStop(0, 'rgba(255,197,95,.22)'); tunnelGlow.addColorStop(0.35, 'rgba(255,150,62,.12)'); tunnelGlow.addColorStop(0.75, 'rgba(66,28,11,.06)'); tunnelGlow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = tunnelGlow; ctx.fillRect(0, 0, canvas.width, canvas.height);
          for (let i = 16; i >= 0; i -= 1) { ctx.strokeStyle = `rgba(255,${155 + i * 4},${78 + i * 2},${0.018 + i * 0.005})`; ctx.lineWidth = 10 + i * 2.6; ctx.beginPath(); ctx.ellipse(centerX - runWorld(0.016), centerY, 130 + i * 76, 58 + i * 34, 0, 0, Math.PI * 2); ctx.stroke(); }
          const wallOffset = runWorld(0.34) % 220;
          for (let x = -wallOffset; x < canvas.width + 220; x += 220) { ctx.fillStyle = 'rgba(50,28,17,.50)'; ctx.beginPath(); ctx.moveTo(x - 10, 118); ctx.lineTo(x + 30, 118); ctx.lineTo(x + 78, 300); ctx.lineTo(x + 20, 300); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 170, 118); ctx.lineTo(x + 214, 118); ctx.lineTo(x + 168, 330); ctx.lineTo(x + 112, 330); ctx.closePath(); ctx.fill(); if (((x / 220) | 0) % 2 === 0) drawHexGem(x + 16, 170 + (x % 90), 14, 'rgba(132,236,138,.85)', 'rgba(255,255,255,.55)'); else drawHexGem(x + 198, 200 + (x % 70), 16, 'rgba(108,183,255,.85)', 'rgba(255,255,255,.55)'); }
          for (let i = 0; i < 58; i += 1) { const layer = i % 4; const speed = [0.10, 0.16, 0.25, 0.38][layer]; const x = ((i * 191 - runWorld(speed)) % (canvas.width + 260)) - 130; const y = 70 + (i * 67) % 650; ctx.fillStyle = ['rgba(255,216,142,.34)', 'rgba(120,214,255,.32)', 'rgba(255,153,86,.24)', 'rgba(139,255,183,.22)'][layer]; ctx.beginPath(); ctx.arc(x, y, 1.2 + layer * 0.8, 0, Math.PI * 2); ctx.fill(); }
          drawMineSupports(); drawRoads();
          const vignette = ctx.createLinearGradient(0, 0, 0, canvas.height); vignette.addColorStop(0, 'rgba(0,0,0,.18)'); vignette.addColorStop(0.35, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.28)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        function drawMineSupports() {
          const offset = runWorld(0.62) % 280;
          for (let x = -offset; x < canvas.width + 280; x += 280) { ctx.fillStyle = 'rgba(70,42,26,.72)'; ctx.fillRect(x + 44, 112, 24, 638); ctx.fillRect(x + 186, 112, 24, 638); ctx.fillStyle = 'rgba(109,69,43,.54)'; ctx.fillRect(x + 32, 112, 190, 24); ctx.strokeStyle = 'rgba(255,211,154,.12)'; ctx.lineWidth = 3; ctx.strokeRect(x + 44, 112, 24, 638); ctx.strokeRect(x + 186, 112, 24, 638); ctx.beginPath(); ctx.moveTo(x + 54, 172); ctx.lineTo(x + 198, 290); ctx.moveTo(x + 198, 172); ctx.lineTo(x + 54, 290); ctx.moveTo(x + 54, 474); ctx.lineTo(x + 198, 592); ctx.moveTo(x + 198, 474); ctx.lineTo(x + 54, 592); ctx.stroke(); ctx.fillStyle = 'rgba(255,190,102,.06)'; ctx.fillRect(x + 48, 138, 160, 7); }
        }

        function drawRoads() {
          const offset = runWorld(1) % 78;
          LANES.forEach((lane) => { const fy = lane.y; const isActive = lane.id === (run?.player?.targetLane ?? START_LANE); const roadGrad = ctx.createLinearGradient(0, fy - 82, 0, fy + 28); roadGrad.addColorStop(0, isActive ? laneColor(lane.id, 0.20) : 'rgba(255,255,255,.05)'); roadGrad.addColorStop(0.35, isActive ? 'rgba(86,56,34,.84)' : 'rgba(62,38,24,.78)'); roadGrad.addColorStop(1, 'rgba(17,10,8,.95)'); ctx.fillStyle = roadGrad; drawRoundedRect(12, fy - 78, canvas.width - 24, 98, 24); ctx.fill(); const laneGlow = ctx.createLinearGradient(0, fy - 70, 0, fy); laneGlow.addColorStop(0, laneColor(lane.id, isActive ? 0.16 : 0.08)); laneGlow.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = laneGlow; drawRoundedRect(24, fy - 72, canvas.width - 48, 42, 18); ctx.fill(); ctx.strokeStyle = isActive ? laneColor(lane.id, 0.62) : 'rgba(255,255,255,.12)'; ctx.lineWidth = isActive ? 3 : 1.5; drawRoundedRect(12, fy - 78, canvas.width - 24, 98, 24); ctx.stroke(); ctx.fillStyle = '#2b1a11'; ctx.fillRect(0, fy, canvas.width, 14); ctx.fillStyle = 'rgba(255,241,190,.20)'; for (let x = -offset; x < canvas.width + 80; x += 78) ctx.fillRect(x, fy + 4, 42, 3); ctx.fillStyle = 'rgba(0,0,0,.20)'; for (let x = 60 - offset; x < canvas.width + 96; x += 156) ctx.fillRect(x, fy - 26, 68, 2); ctx.fillStyle = 'rgba(5,6,10,.54)'; drawRoundedRect(28, fy - 68, 184, 36, 16); ctx.fill(); ctx.fillStyle = lane.tint; ctx.font = 'bold 14px Inter, sans-serif'; ctx.fillText(lane.name.toUpperCase(), 44, fy - 45); ctx.fillStyle = 'rgba(235,241,255,.85)'; ctx.font = 'bold 13px Inter, sans-serif'; ctx.fillText(`x${lane.reward.toFixed(2)}`, 160, fy - 45); if (isActive) { const sweepX = (runWorld(2.4) % (canvas.width + 260)) - 140; const sweep = ctx.createLinearGradient(sweepX, 0, sweepX + 160, 0); sweep.addColorStop(0, 'rgba(255,255,255,0)'); sweep.addColorStop(0.5, laneColor(lane.id, 0.18)); sweep.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sweep; drawRoundedRect(20, fy - 76, canvas.width - 40, 90, 22); ctx.fill(); } });
        }

        function drawPickupArt(obj, index, glow, size = 58) {
          if (!artReady(diglewArt.pickups)) return false;
          ctx.save();
          const pulse = 1 + Math.sin((run?.time || 0) * 8 + obj.x * 0.02) * 0.055;
          ctx.translate(obj.x, obj.y);
          ctx.scale(pulse, pulse);
          ctx.shadowBlur = 22;
          ctx.shadowColor = glow;
          drawAtlasSprite(diglewArt.pickups, index, 5, 0, 0, size, size);
          ctx.restore();
          return true;
        }
        function drawCoin(obj) { if (drawPickupArt(obj, 0, '#ffd45a', 58)) return; ctx.save(); const pulse = 1 + Math.sin((run?.time || 0) * 8 + obj.x * 0.02) * 0.05; ctx.translate(obj.x, obj.y); ctx.scale(pulse, pulse); ctx.shadowBlur = 22; ctx.shadowColor = '#ffd45a'; const grad = ctx.createLinearGradient(-obj.r, -obj.r, obj.r, obj.r); grad.addColorStop(0, '#fff1a9'); grad.addColorStop(0.55, '#f8c84e'); grad.addColorStop(1, '#c97a12'); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, obj.r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(124,70,10,.65)'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#825100'; ctx.font = 'bold 18px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('W', 0, 1); ctx.restore(); }
        function drawWorm(obj) { if (drawPickupArt(obj, 1, '#f7ba47', 62)) return; ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = '#80ef7b'; ctx.fillStyle = '#80ef7b'; ctx.beginPath(); ctx.ellipse(obj.x, obj.y, obj.r + 4, obj.r - 2, Math.sin((run?.time || 0) * 6) * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#eaffd8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(obj.x - 10, obj.y + 1); ctx.quadraticCurveTo(obj.x, obj.y - 10, obj.x + 10, obj.y + 1); ctx.stroke(); ctx.restore(); }
        function drawGem(obj) { if (drawPickupArt(obj, 2, '#69b7ff', 62)) return; ctx.save(); const pulse = 1 + Math.sin((run?.time || 0) * 7 + obj.x * 0.03) * 0.06; ctx.translate(obj.x, obj.y); ctx.scale(pulse, pulse); ctx.shadowBlur = 26; ctx.shadowColor = '#69b7ff'; drawHexGem(0, 0, obj.r + 1, '#69b7ff', 'rgba(255,255,255,.85)'); ctx.restore(); }


        function drawDashPickup(obj) {
          if (drawPickupArt(obj, 3, '#71d8ff', 62)) return;
          ctx.save();
          const pulse = 1 + Math.sin((run?.time || 0) * 7 + obj.x * 0.02) * 0.06;
          ctx.translate(obj.x, obj.y);
          ctx.scale(pulse, pulse);
          ctx.shadowBlur = 24;
          ctx.shadowColor = '#71d8ff';
          const grad = ctx.createRadialGradient(0, 0, 3, 0, 0, (obj.r || 14) + 7);
          grad.addColorStop(0, 'rgba(178,244,255,.98)');
          grad.addColorStop(1, '#173046');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, (obj.r || 14) + 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.36)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(113,216,255,.46)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, (obj.r || 14) + 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#71d8ff';
          const r = obj.r || 14;
          ctx.beginPath();
          ctx.moveTo(2, -r - 1);
          ctx.lineTo(-7, 1);
          ctx.lineTo(0, 1);
          ctx.lineTo(-3, r + 1);
          ctx.lineTo(10, -2);
          ctx.lineTo(1, -2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        function drawHeart(obj) {
          if (drawPickupArt(obj, 4, '#ff7a92', 62)) return;
          ctx.save();
          const pulse = 1 + Math.sin((run?.time || 0) * 7 + obj.x * 0.01) * 0.06;
          ctx.translate(obj.x, obj.y);
          ctx.scale(pulse, pulse);
          ctx.shadowBlur = 22;
          ctx.shadowColor = '#ff7a92';
          ctx.fillStyle = '#ff6b86';
          const r = obj.r || 16;
          ctx.beginPath();
          ctx.moveTo(0, r * 0.9);
          ctx.bezierCurveTo(-r * 1.3, r * 0.1, -r * 1.3, -r * 0.9, 0, -r * 0.15);
          ctx.bezierCurveTo(r * 1.3, -r * 0.9, r * 1.3, r * 0.1, 0, r * 0.9);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          ctx.fillRect(-2, -7, 4, 14);
          ctx.fillRect(-7, -2, 14, 4);
          ctx.restore();
        }

        function drawSpikes(obj) {
          const fy = laneY(obj.lane);
          if (artReady(diglewArt.hazards)) { ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(255,185,94,.24)'; drawAtlasSprite(diglewArt.hazards, 0, 3, obj.x + (obj.w || 92) / 2, fy - 33, 116, 78); ctx.restore(); return; }
          ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(obj.x - 6, fy - 10, (obj.w || 92) + 12, 12);
          const count = 4; for (let i = 0; i < count; i++) { const px = obj.x + 8 + i * (((obj.w || 92) - 16) / count); const w = (((obj.w || 92) - 16) / count); ctx.fillStyle = '#cfd3d8'; ctx.beginPath(); ctx.moveTo(px, fy - 2); ctx.lineTo(px + w * 0.5, fy - 43); ctx.lineTo(px + w, fy - 2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.56)'; ctx.stroke(); }
          ctx.restore();
        }
        function drawMine(obj) {
          const fy = laneY(TOP); const ballY = fy - 104 + Math.sin(obj.swing || 0) * 8; ctx.save();
          ctx.strokeStyle = '#5a4738'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(obj.x, obj.chainTop || 104); ctx.lineTo(obj.x, ballY); ctx.stroke();
          if (drawAtlasSprite(diglewArt.hazards, 1, 3, obj.x, ballY - 18, 122, 122)) { ctx.restore(); return; }
          ctx.fillStyle = '#404653'; ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(255,180,92,.22)'; ctx.beginPath(); ctx.arc(obj.x, ballY, obj.r || 30, 0, Math.PI * 2); ctx.fill();
          for (let i = 0; i < 8; i++) { const a = (Math.PI * 2 * i) / 8; ctx.strokeStyle = '#d5d8df'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(obj.x + Math.cos(a) * ((obj.r || 30) - 1), ballY + Math.sin(a) * ((obj.r || 30) - 1)); ctx.lineTo(obj.x + Math.cos(a) * ((obj.r || 30) + 10), ballY + Math.sin(a) * ((obj.r || 30) + 10)); ctx.stroke(); }
          ctx.restore();
        }
        function drawRock(obj) {
          const fy = laneY(obj.lane); const y = fy - (obj.h || 104); ctx.save();
          if (drawAtlasSprite(diglewArt.hazards, 2, 3, obj.x + (obj.w || 76) / 2, fy - (obj.h || 104) / 2, 114, 126)) { ctx.restore(); return; }
          const grad = ctx.createLinearGradient(obj.x, y, obj.x + (obj.w || 76), fy); grad.addColorStop(0, '#784c2d'); grad.addColorStop(1, '#2b1a12'); ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(obj.x + 6, fy); ctx.lineTo(obj.x + 10, y + 18); ctx.lineTo(obj.x + (obj.w || 76) * 0.42, y + 4); ctx.lineTo(obj.x + (obj.w || 76) - 6, y + 26); ctx.lineTo(obj.x + (obj.w || 76) - 4, fy); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,211,142,.45)'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = '#71d8ff'; ctx.shadowBlur = 16; ctx.shadowColor = '#71d8ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(obj.x + 25, y + 20); ctx.lineTo(obj.x + 47, y + 52); ctx.lineTo(obj.x + 32, y + 82); ctx.lineTo(obj.x + 55, y + 104); ctx.stroke(); ctx.restore();
        }
        function drawObjects() { if (!run) return; [...run.objects].sort((a, b) => laneY(a.lane || 0) - laneY(b.lane || 0)).forEach((obj) => { if (obj.type === 'coin') drawCoin(obj); if (obj.type === 'worm') drawWorm(obj); if (obj.type === 'gem') drawGem(obj); if (obj.type === 'dash') drawDashPickup(obj); if (obj.type === 'heart') drawHeart(obj); if (obj.type === 'spikes') drawSpikes(obj); if (obj.type === 'mine') drawMine(obj); if (obj.type === 'rock') drawRock(obj); }); }
        function drawParticles() { if (!run) return; ctx.save(); run.particles.forEach((p) => { ctx.globalAlpha = clamp(p.life / 0.72, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.4, p.size), 0, Math.PI * 2); ctx.fill(); }); ctx.restore(); }
        function drawFloatTexts() {
          if (!run?.floatTexts?.length) return;
          ctx.save();
          run.floatTexts.forEach((f) => {
            ctx.globalAlpha = clamp(f.life, 0, 1);
            ctx.font = `bold ${Math.round(18 * (f.scale || 1))}px Inter, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.shadowBlur = 14; ctx.shadowColor = f.color;
            ctx.fillStyle = f.color;
            ctx.fillText(f.text, f.x, f.y);
          });
          ctx.restore();
        }

        function drawLew() {
          if (!run) return;
          normalizePlayer();
          const p = run.player; const x = p.x; const h = PLAYER_H; const y = p.laneY - h; const stride = Math.sin(run.time * (p.dashTime > 0 ? 28 : 15));
          ctx.save();
          if (run.invuln > 0) ctx.globalAlpha = 0.72 + Math.sin(Date.now() * 0.035) * 0.22;
          if (p.dashTime > 0) { ctx.shadowBlur = 30; ctx.shadowColor = '#65d8ff'; ctx.fillStyle = 'rgba(101,216,255,.18)'; for (let i = 0; i < 5; i++) ctx.fillRect(x - 26 - i * 18, y + h * 0.40 + i * 2, 42, 8); }
          ctx.fillStyle = 'rgba(0,0,0,.34)'; ctx.beginPath(); ctx.ellipse(x + 42, p.laneY + 5, 38, 10, 0, 0, Math.PI * 2); ctx.fill();
          if (artReady(diglewArt.runner)) {
            const spriteWidth = p.dashTime > 0 ? 154 : 142;
            const spriteHeight = spriteWidth * (diglewArt.runner.naturalHeight / diglewArt.runner.naturalWidth);
            const laneDelta = laneY(p.targetLane) - p.laneY;
            const changingLane = Math.abs(laneDelta) > 1;
            const runWave = Math.sin(run.time * (p.dashTime > 0 ? 25 : 15));
            const bob = changingLane ? -Math.sin(Math.min(1, Math.abs(laneDelta) / 74) * Math.PI) * 13 : Math.abs(runWave) * -4;
            const landing = Math.sin(p.landBounce * Math.PI) * 7;
            const rotation = p.dashTime > 0 ? -0.13 : changingLane ? p.moveDirection * 0.11 : runWave * 0.025;
            const squash = p.landBounce > 0 ? Math.sin(p.landBounce * Math.PI) * 0.08 : 0;
            const centerX = x + 44;
            const footY = p.laneY + bob + landing + 8;
            ctx.save();
            ctx.translate(centerX, footY);
            ctx.rotate(rotation);
            ctx.scale((p.dashTime > 0 ? 1.08 : 1) + squash * 0.35, 1 - squash);
            ctx.drawImage(diglewArt.runner, -spriteWidth * 0.5, -spriteHeight, spriteWidth, spriteHeight);
            ctx.restore();
            ctx.restore();
            return;
          }
          ctx.strokeStyle = '#2f211a'; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + 28, y + h * 0.72); ctx.lineTo(x + 18, y + h * 0.95 + stride * 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 47, y + h * 0.72); ctx.lineTo(x + 62, y + h * 0.94 - stride * 7); ctx.stroke();
          const bodyGrad = ctx.createLinearGradient(x, y, x + 80, y + h); bodyGrad.addColorStop(0, '#6b4a37'); bodyGrad.addColorStop(1, '#332018'); ctx.fillStyle = bodyGrad; ctx.beginPath(); ctx.ellipse(x + 38, y + h * 0.58, 28, 25, -0.1, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#53616f'; drawRoundedRect(x + 23, y + h * 0.48, 32, 30, 9); ctx.fill(); ctx.fillStyle = '#e3aa46'; ctx.beginPath(); ctx.arc(x + 30, y + h * 0.56, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 48, y + h * 0.56, 3.4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#4f3629'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x + 25, y + h * 0.54); ctx.lineTo(x + 8, y + h * 0.58 + stride * 5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 50, y + h * 0.53); ctx.lineTo(x + 69, y + h * 0.48 - stride * 5); ctx.stroke();
          ctx.fillStyle = '#5b3c2d'; ctx.beginPath(); ctx.ellipse(x + 45, y + 24, 24, 22, -0.05, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#704936'; ctx.beginPath(); ctx.arc(x + 29, y + 14, 7, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 53, y + 12, 6, 0, Math.PI * 2); ctx.fill();
          const helmet = ctx.createLinearGradient(x + 18, y + 2, x + 68, y + 24); helmet.addColorStop(0, '#ffc24a'); helmet.addColorStop(1, '#cc6f13'); ctx.fillStyle = helmet; ctx.beginPath(); ctx.arc(x + 44, y + 17, 24, Math.PI, 0); ctx.lineTo(x + 69, y + 23); ctx.lineTo(x + 19, y + 23); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#7d4a14'; ctx.fillRect(x + 20, y + 21, 49, 5);
          ctx.fillStyle = '#dfe8f4'; ctx.beginPath(); ctx.arc(x + 59, y + 15, 10, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff0a8'; ctx.beginPath(); ctx.arc(x + 59, y + 15, 6.5, 0, Math.PI * 2); ctx.fill(); const beam = ctx.createRadialGradient(x + 64, y + 17, 0, x + 128, y + 22, 130); beam.addColorStop(0, 'rgba(255,232,150,.35)'); beam.addColorStop(1, 'rgba(255,232,150,0)'); ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(x + 58, y + 12); ctx.lineTo(x + 220, y - 18); ctx.lineTo(x + 220, y + 70); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#f4c3a0'; ctx.beginPath(); ctx.ellipse(x + 53, y + 31, 16, 12, 0.05, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#101014'; ctx.beginPath(); ctx.arc(x + 47, y + 26, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 57, y + 27, 2.1, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 65, y + 31, 4.2, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#85442f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + 56, y + 36, 7, 0.12, 2.7); ctx.stroke();
          ctx.restore();
        }

        function drawHud() {
          if (!run) return; ctx.save();
          ctx.fillStyle = 'rgba(5,6,10,.66)'; drawRoundedRect(26, 22, 390, 96, 18); ctx.fill(); ctx.fillStyle = '#fff0c7'; ctx.font = 'bold 24px Inter, sans-serif'; ctx.fillText(`DigLEW R${run.stage}`, 48, 56); ctx.font = 'bold 19px Inter, sans-serif'; ctx.fillText(`${'❤️'.repeat(Math.max(0, run.hearts))}${'🖤'.repeat(Math.max(0, run.maxHearts - run.hearts))}`, 48, 88); ctx.fillStyle = '#d3def3'; ctx.font = 'bold 16px Inter, sans-serif'; ctx.fillText(`${laneName(run.player.targetLane)}   🪙 ${run.stats.coins}   🪱 ${run.stats.worms}   💎 ${run.stats.gems}   ⚡ ${run.stats.dashPacks}`, 48, 110);
          const barX = canvas.width / 2 - 230; const barY = 34; const barW = 460; ctx.fillStyle = 'rgba(5,6,10,.66)'; drawRoundedRect(barX - 20, 20, barW + 40, 82, 18); ctx.fill(); ctx.fillStyle = '#d3def3'; ctx.font = 'bold 17px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${Math.floor(run.distance)}m / ${run.checkpoint}m`, canvas.width / 2, 42); ctx.textAlign = 'left'; ctx.fillStyle = '#1c2430'; ctx.fillRect(barX, barY + 16, barW, 14); const prog = ctx.createLinearGradient(barX, barY, barX + barW, barY); prog.addColorStop(0, '#f9c84d'); prog.addColorStop(1, '#65d8ff'); ctx.fillStyle = prog; ctx.fillRect(barX, barY + 16, barW * clamp(run.distance / run.checkpoint, 0, 1), 14); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.strokeRect(barX, barY + 16, barW, 14); ctx.fillStyle = '#f6d68b'; ctx.font = 'bold 15px Inter, sans-serif'; ctx.fillText(`🎁 Round ${run.stage} checkpoint`, barX, barY + 55); ctx.fillText(`Score ${Math.floor(run.score)}`, barX + 300, barY + 55);
          const dashX = canvas.width - 224; const dashY = 28; ctx.fillStyle = 'rgba(5,6,10,.66)'; drawRoundedRect(dashX - 16, dashY - 8, 190, 86, 18); ctx.fill(); ctx.fillStyle = '#e9eefc'; ctx.font = 'bold 17px Inter, sans-serif'; ctx.fillText('⚡ Dash', dashX, dashY + 16); ctx.fillStyle = '#1c2430'; ctx.fillRect(dashX, dashY + 30, 134, 12); const cool = getEffects().dashCooldown; const ready = run.player.dashCooldown <= 0 ? 1 : 1 - clamp(run.player.dashCooldown / cool, 0, 1); ctx.fillStyle = run.player.dashCooldown <= 0 ? '#65d8ff' : '#748cff'; ctx.fillRect(dashX, dashY + 30, 134 * ready, 12); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.strokeRect(dashX, dashY + 30, 134, 12); ctx.fillStyle = '#cfd7eb'; ctx.font = '14px Inter, sans-serif'; ctx.fillText(run.player.dashCooldown <= 0 ? 'Ready' : `${run.player.dashCooldown.toFixed(1)}s`, dashX, dashY + 60);
          ctx.restore();
        }

        function drawIdleSplash() {
          drawBackground(); ctx.fillStyle = 'rgba(5,6,10,.48)'; drawRoundedRect(70, 90, 745, 440, 28); ctx.fill();
          const titleGrad = ctx.createLinearGradient(100, 0, 560, 0); titleGrad.addColorStop(0, '#fff1c7'); titleGrad.addColorStop(1, '#f7b64b'); ctx.fillStyle = titleGrad; ctx.font = 'bold 62px Inter, sans-serif'; ctx.fillText('DigLEW', 104, 166);
          ctx.fillStyle = '#8ee7ff'; ctx.font = 'bold 27px Inter, sans-serif'; ctx.fillText('3-Road Tunnel Runner', 108, 206);
          ctx.fillStyle = '#e4e9f8'; ctx.font = '22px Inter, sans-serif'; ctx.fillText(`Round ${currentStage()} reaches ${checkpointForStage()}m. Start on the middle road.`, 108, 256); ctx.fillText('Move roads for treasure. Dash cracked rocks. Avoid mines and spikes.', 108, 290);
          const tips = ['W / ↑ or swipe up = higher road', 'S / ↓ or swipe down = lower road', 'SPACE / SHIFT / X or ⚡ = Dash', 'Top road = richest rewards', 'Blue charge = dash-gate prep', 'Perfect road = bonus reward']; ctx.font = 'bold 20px Inter, sans-serif'; tips.forEach((tip, i) => { ctx.fillStyle = ['#f8c84d', '#80ef7b', '#65d8ff', '#f6a65c', '#9fffd1', '#d7d9ff'][i]; ctx.fillText(tip, 112, 348 + i * 34); });
          ctx.fillStyle = 'rgba(101,216,255,.12)'; drawRoundedRect(100, 566, 520, 54, 18); ctx.fill();
          ctx.fillStyle = '#dbeafe'; ctx.font = 'bold 18px Inter, sans-serif'; ctx.fillText('Premium polish: round cards, combo pops, bigger checkpoint feel.', 122, 600);
        }

        function drawRoundIntroOverlay() {
          if (!run || run.over || run.paused || !run.introTime) return;
          const alpha = clamp(run.introTime / 2.15, 0, 1);
          ctx.save();
          ctx.globalAlpha = Math.min(1, alpha + 0.12);
          ctx.fillStyle = 'rgba(5,6,10,.36)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          const x = canvas.width * 0.5 - 320; const y = 142;
          ctx.fillStyle = 'rgba(5,6,10,.78)'; drawRoundedRect(x, y, 640, 210, 28); ctx.fill();
          ctx.strokeStyle = 'rgba(248,200,77,.44)'; ctx.lineWidth = 2; drawRoundedRect(x, y, 640, 210, 28); ctx.stroke();
          ctx.fillStyle = '#fff1c7'; ctx.font = 'bold 54px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`ROUND ${run.stage}`, canvas.width * 0.5, y + 76);
          ctx.fillStyle = '#8ee7ff'; ctx.font = 'bold 24px Inter, sans-serif'; ctx.fillText(`${run.checkpoint}m Checkpoint`, canvas.width * 0.5, y + 114);
          ctx.fillStyle = '#dbe6f6'; ctx.font = '19px Inter, sans-serif'; ctx.fillText('Risk Road pays best • Dash rocks • Perfect runs earn bonus', canvas.width * 0.5, y + 154);
          ctx.textAlign = 'left';
          ctx.restore();
        }

        function drawCheckpointBurst() {
          if (!run || !run.checkpointBurstTime) return;
          const a = clamp(run.checkpointBurstTime / 1.8, 0, 1);
          ctx.save();
          ctx.globalAlpha = a;
          for (let i = 0; i < 18; i += 1) {
            const angle = (Math.PI * 2 * i) / 18 + (1.8 - run.checkpointBurstTime) * 1.5;
            const r = 50 + (1 - a) * 260;
            ctx.strokeStyle = i % 2 ? 'rgba(101,216,255,.55)' : 'rgba(248,200,77,.65)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(canvas.width * 0.5 + Math.cos(angle) * (r - 26), 170 + Math.sin(angle) * (r - 26));
            ctx.lineTo(canvas.width * 0.5 + Math.cos(angle) * (r + 38), 170 + Math.sin(angle) * (r + 38));
            ctx.stroke();
          }
          ctx.restore();
        }
        function drawPauseOverlay() { if (!run || !run.paused || run.over) return; ctx.fillStyle = 'rgba(5,6,10,.58)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff1c7'; ctx.font = 'bold 58px Inter, sans-serif'; ctx.fillText('Paused', 92, 166); ctx.fillStyle = '#e7edf8'; ctx.font = '24px Inter, sans-serif'; ctx.fillText('Press P / Esc or Resume to continue the road.', 96, 210); }
        function drawEndOverlay() {
          if (!run || !run.over) return;
          const summary = run.summary || buildRunSummary(Math.round(run.score || 0), run.won);
          ctx.fillStyle = run.won ? 'rgba(5,6,10,.30)' : 'rgba(68,10,10,.36)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = run.won ? '#fff1c7' : '#ffd1d1'; ctx.font = 'bold 54px Inter, sans-serif'; ctx.fillText(run.won ? 'Checkpoint Reached!' : 'Run Failed', 92, 144);
          ctx.fillStyle = '#e7edf8'; ctx.font = '24px Inter, sans-serif'; ctx.fillText(run.won ? 'Strong run — pick a reward box, then launch the next longer road.' : 'The tunnel got you. Read the roads, dash cracked rocks, then try again.', 96, 186);
          ctx.fillStyle = 'rgba(5,6,10,.66)'; drawRoundedRect(92, 224, 620, 184, 24); ctx.fill();
          ctx.strokeStyle = run.won ? 'rgba(248,200,77,.42)' : 'rgba(255,125,125,.36)'; ctx.lineWidth = 2; drawRoundedRect(92, 224, 620, 184, 24); ctx.stroke();
          ctx.fillStyle = run.won ? '#f8c84d' : '#ff8c8c'; ctx.font = 'bold 56px Inter, sans-serif'; ctx.fillText(`Grade ${summary.grade}`, 124, 292);
          ctx.fillStyle = '#f1f5ff'; ctx.font = 'bold 22px Inter, sans-serif'; ctx.fillText(`Score ${summary.score}  •  ${summary.distance}m / ${summary.checkpoint}m`, 124, 328);
          ctx.fillStyle = '#cfd7eb'; ctx.font = '18px Inter, sans-serif';
          ctx.fillText(`Coins ${summary.coins} • Worms ${summary.worms} • Gems ${summary.gems}`, 124, 360);
          ctx.fillText(`Rocks smashed ${summary.rocks} • Hits ${summary.hits} • Best combo ${summary.bestCombo}`, 124, 388);
          if (summary.perfect) { ctx.fillStyle = '#fff1c7'; ctx.font = 'bold 18px Inter, sans-serif'; ctx.fillText('PERFECT ROAD BONUS EARNED', 124, 420); }
        }
        function draw() { ctx.clearRect(0, 0, canvas.width, canvas.height); if (!run) { drawIdleSplash(); return; } ctx.save(); if (run.shake > 0) ctx.translate((Math.random() - 0.5) * run.shake, (Math.random() - 0.5) * run.shake); drawBackground(); drawObjects(); drawParticles(); drawLew(); drawFloatTexts(); ctx.restore(); drawHud(); drawCheckpointBurst(); if (run.flashGold > 0) { ctx.fillStyle = `rgba(248,200,77,${run.flashGold * 0.26})`; ctx.fillRect(0, 0, canvas.width, canvas.height); } if (run.flashBlue > 0) { ctx.fillStyle = `rgba(80,190,255,${run.flashBlue * 0.34})`; ctx.fillRect(0, 0, canvas.width, canvas.height); } if (run.flash > 0) { ctx.fillStyle = `rgba(255,70,70,${run.flash * 0.35})`; ctx.fillRect(0, 0, canvas.width, canvas.height); } drawRoundIntroOverlay(); drawPauseOverlay(); drawEndOverlay(); }

        function onKeyDown(e) {
          if (views.diglew.classList.contains('hidden')) return;
          const k = e.key.toLowerCase(); const code = e.code;
          const handled = ['ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight', 'Escape'].includes(code) || ['w', 's', 'x', 'p'].includes(k);
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
            blurActiveControl();
          }
          if (e.repeat && (code === 'Escape' || k === 'p')) return;
          if (code === 'Escape' || k === 'p') { togglePause(); return; }
          if (code === 'ArrowUp' || k === 'w') changeLane(-1);
          if (code === 'ArrowDown' || k === 's') changeLane(1);
          if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight' || k === 'x') requestDash();
        }
        function onKeyUp(e) {
          if (views.diglew.classList.contains('hidden')) return;
          const code = e.code;
          const k = e.key.toLowerCase();
          const handled = ['ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight', 'Escape'].includes(code) || ['w', 's', 'x', 'p'].includes(k);
          if (handled) { e.preventDefault(); e.stopPropagation(); blurActiveControl(); }
        }
        function bindInputsOnce() { if (inputInitDone) return; inputInitDone = true; window.addEventListener('keydown', onKeyDown, true); window.addEventListener('keyup', onKeyUp, true); }

        bindInputsOnce(); ensurePauseButton();
        const withBlur = (fn) => (event) => { event?.preventDefault?.(); event?.currentTarget?.blur?.(); blurActiveControl(); fn(); };
        $('diglewStartBtn').onclick = withBlur(startRun); $('diglewResetBtn').onclick = withBlur(resetProgress); $('diglewStartTop').onclick = withBlur(startRun); $('diglewResetTop').onclick = withBlur(resetProgress);
        const pauseTop = ensurePauseButton(); if (pauseTop) pauseTop.onclick = withBlur(() => togglePause());
        $('diglewHomeTop').onclick = withBlur(() => { hideRewardOverlay(); cancelLoop(); showView('hub'); renderHubBoards(); renderWalletDisplays(); window.scrollTo({ top: 0, behavior: 'auto' }); });
        ensureTouchControls(); renderAll(); draw();
        return { renderAll, draw, startRun, resetProgress, bankRun: completeCheckpoint, togglePause };
      })();
    }
  };
})();
