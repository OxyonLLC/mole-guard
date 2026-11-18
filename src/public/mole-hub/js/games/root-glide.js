// WinLEW Gaming Hub v39 modular game chunk: glide
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.glide = function create_glide(deps) {
    // Conservative legacy wrapper: gameplay code is unchanged and resolves shared hub helpers
    // through the provided dependency bag. This keeps v39 behavior stable while splitting files.
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
  const canvas = $('glideCanvas');
  const ctx = canvas.getContext('2d');
  const statsEl = $('glideStats');
  const boardEl = $('glideBoard');
  const banner = $('glideBanner');
  const sub = $('glideSub');
  const modeEl = $('glideMode');
  const hintEl = $('glideHint');
  const progressEl = $('glideProgress');
  const milestoneEl = $('glideMilestone');
  const logEl = $('glideLog');
  let board = load(Storage.glideBoard, []);
  let meta = load(Storage.glideState, { bestScore: 0, bestDistance: 0, bestRound: 0, plays: 0 });
  if (typeof meta.bestRound !== 'number') meta.bestRound = 0;
  // Every round makes the next one meaningfully longer + faster (see
  // getRoundConfig), so surviving rounds 1-4 back to back in one unbroken
  // life gets exponentially less likely the further a player gets. Without
  // this, ANY single mistake anywhere sent the player all the way back to
  // Round 1 (start(1), see below) — so reaching round 4 required a flawless
  // run through 1-3 first, every single time, which is what actually made
  // round 4 feel like a wall. Pac-Mole already persists progress the same
  // way (saveState.unlocked) — this brings Root Glide in line with it: a
  // fresh life after dying resumes at the furthest round ever reached, not
  // a full restart. "Reset Progress" still wipes this back to Round 1.
  function nextUnlockedRound() { return Math.max(1, (meta.bestRound || 0) + 1); }
  let logs = ['Touch-first root glide ready.'];
  let state = null;
  let raf = 0;
  let last = 0;
  let rootGlideRenderFaults = 0;
  const W = canvas.width;
  const H = canvas.height;
  const playerX = 190;
  const glideSprites = {
    fly: new Image(),
    up: new Image(),
    down: new Image(),
  };
  glideSprites.fly.src = './assets/rootglide-player-fly.png';
  glideSprites.up.src = './assets/rootglide-player-up.png';
  glideSprites.down.src = './assets/rootglide-player-down.png';

  function addLog(msg) {
    logs.unshift(msg);
    logs = logs.slice(0, 8);
    logEl.innerHTML = logs.map((m) => `<div class="log-entry">${m}</div>`).join('');
  }

  function getRoundConfig(round) {
    const safeRound = Math.max(1, round || 1);
    const progress = safeRound - 1;
    return {
      round: safeRound,
      // Halved from +120m/round (2026-07-19, fairness pass) — simulated
      // 500 runs/round with a predictive bot (see the playtest note below
      // requestDash-adjacent code isn't relevant here; see maxHearts
      // comment) and found survival collapsed 95%->55%->11%->0.2%->0% by
      // round 4, even for near-optimal play, because ANY single mistake
      // ended the run and longer rounds meant threading far more gaps
      // with zero margin. Root Glide was the only one of the 5 hub games
      // with a pure one-hit-death model — DigLEW has 3 hearts, Burrow
      // Blaster has 5 lives, Pac-Mole has lives too. Halving round-length
      // growth alone isn't enough by itself (still hits a wall), see
      // maxHearts below for the other half of the fix.
      targetDistance: 320 + progress * 60,
      maxHearts: 3,
      startSpeed: Math.min(265 + progress * 18, 420),
      maxSpeed: Math.min(410 + progress * 22, 560),
      speedGain: Math.min(3.2 + progress * 0.22, 6.4),
      gravity: Math.min(1740 + progress * 30, 1980),
      flap: -420,
      maxRise: -820,
      maxFall: 860,
      spawnEvery: Math.max(1.54 - progress * 0.06, 0.94),
      minSpawnEvery: Math.max(1.08 - progress * 0.05, 0.72),
      gapBase: Math.max(430 - progress * 18, 270),
      gapMin: Math.max(306 - progress * 14, 214),
      gapCheckpointPenalty: 10 + progress * 1.5,
      gapDifficultyPenalty: 66 + progress * 5,
      checkpointEvery: 5,
      maxGapShift: Math.min(108 + progress * 10, 190),
      margin: 120,
      obstacleWidth: Math.min(94 + progress * 4, 126),
      // Payload C.3: always define route spacing/prebuild values so obstacle x positions never become NaN.
      spawnSpacing: Math.max(218 - progress * 4, 184),
      initialRouteSegments: 7,
      maxRouteSegments: 9,
      wormBonus: 34 + progress * 3,
      wormSpawnChance: Math.min(0.7 + progress * 0.04, 0.92),
      wormEdgeInset: 34,
      baseReward: 18 + safeRound * 5,
      clearBonus: 85 + safeRound * 24,
      checkpointBonus: 28,
      obstacleBonus: 12,
    };
  }

  function milestoneName(distance, round = 1) {
    if (round >= 6) return 'Lantern legend';
    if (round >= 4) return 'Deep courier';
    if (round >= 2) return 'Burrow runner';
    if (distance >= 220) return 'Tunnel scout';
    return 'Rookie';
  }

  function getOpenGapBounds(obstacle) {
    const gapY = Number.isFinite(obstacle?.gapY) ? obstacle.gapY : H * 0.28;
    const gap = Number.isFinite(obstacle?.gap) ? obstacle.gap : (H * 0.48);
    const topInset = obstacle?.topBlocker && Number.isFinite(obstacle.topBlocker.jut) ? obstacle.topBlocker.jut : 0;
    const bottomInset = obstacle?.bottomBlocker && Number.isFinite(obstacle.bottomBlocker.jut) ? obstacle.bottomBlocker.jut : 0;
    const top = clamp(gapY + topInset, 54, H - 120);
    const bottom = clamp(gapY + gap - bottomInset, top + 150, H - 54);
    return { top, bottom };
  }

  function getWormAnchor(obstacle, topLane) {
    const bounds = getOpenGapBounds(obstacle);
    if (topLane) {
      return {
        x: obstacle.x + obstacle.width * 0.46,
        y: bounds.top + 12,
      };
    }
    return {
      x: obstacle.x + obstacle.width * 0.54,
      y: bounds.bottom - 12,
    };
  }

  function getWormPoints(worm) {
    const dir = worm.lane === 'top' ? 1 : -1;
    const points = [];
    const segments = 9;
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const curve = Math.sin(worm.sway + t * 1.7) * (3.5 + t * 5.8);
      const x = worm.x + curve;
      const y = worm.y + dir * (t * 14 + Math.pow(t, 1.45) * 40) + Math.sin(worm.bob + t * 1.9) * 1.8;
      const r = i >= segments - 2 ? 7.8 : Math.max(3.8, 6.4 - t * 1.25);
      points.push({ x, y, r });
    }
    return points;
  }

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby || 1;
    const apx = px - ax;
    const apy = py - ay;
    const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    return Math.hypot(px - qx, py - qy);
  }

  function glideBlockerLabel(type) {
    return type === 'boot'
      ? 'a lodged boot'
      : type === 'shovel'
      ? 'a buried shovel'
      : type === 'thorn'
      ? 'a thorn burst'
      : type === 'rock'
      ? 'a stone outcrop'
      : type === 'root'
      ? 'a hooked root'
      : 'the tunnel terrain';
  }

  function buildGlideBlocker(type, jut) {
    return {
      type,
      jut,
      seed: Math.random() * Math.PI * 2,
      scale: 0.92 + Math.random() * 0.2,
    };
  }

  function spawnObstacle() {
    const cfg = state.config;
    const difficulty = Math.min(1.1, state.distance / cfg.targetDistance);
    const gap = clamp(
      cfg.gapBase - state.checkpoints * cfg.gapCheckpointPenalty - difficulty * cfg.gapDifficultyPenalty,
      cfg.gapMin,
      cfg.gapBase
    );
    const margin = cfg.margin;
    const minCenter = margin + gap / 2;
    const maxCenter = H - margin - gap / 2;
    const previousCenter = Number.isFinite(state.lastGapCenter) ? state.lastGapCenter : H * 0.5;
    const shiftRange = cfg.maxGapShift + difficulty * 34;
    const targetCenter = clamp(previousCenter + (rand(Math.round(shiftRange * 2)) - shiftRange), minCenter, maxCenter);
    state.lastGapCenter = targetCenter;
    const spacing = Number.isFinite(state.config.spawnSpacing) ? state.config.spawnSpacing : 210;
    const validXs = state.obstacles.map((o) => Number(o.x)).filter(Number.isFinite);
    const furthestX = validXs.length ? Math.max(...validXs) : W + 80;
    const startX = Math.max(W + 120, furthestX + spacing);

    const safeOpening = Math.max(178, gap - (50 + difficulty * 14));
    const availableInset = Math.max(0, gap - safeOpening);
    let topJut = 0;
    let bottomJut = 0;
    if (availableInset > 18) {
      if (Math.random() < 0.72) {
        topJut = Math.min(Math.max(18, 14 + rand(Math.round(availableInset * 0.72) + 1)), availableInset);
      }
      const remaining = Math.max(0, availableInset - topJut);
      if (remaining > 14 && Math.random() < 0.62) {
        bottomJut = Math.min(Math.max(14, 12 + rand(Math.round(remaining) + 1)), remaining);
      }
      if (!topJut && !bottomJut && Math.random() < 0.55) {
        topJut = Math.min(Math.max(18, 14 + rand(Math.round(availableInset * 0.7) + 1)), availableInset);
      }
    }

    const blockerTypes = ['boot', 'shovel', 'thorn', 'rock', 'root'];
    const obstacle = {
      x: startX,
      width: cfg.obstacleWidth,
      gapY: targetCenter - gap / 2,
      gap,
      type: 'soil',
      passed: false,
      accentSeed: rand(1000),
      wormLane: null,
      pulse: Math.random() * Math.PI * 2,
      topBlocker: topJut > 0 ? buildGlideBlocker(choice(blockerTypes), topJut) : null,
      bottomBlocker: bottomJut > 0 ? buildGlideBlocker(choice(blockerTypes), bottomJut) : null,
    };
    state.obstacles.push(obstacle);

    if (Math.random() < cfg.wormSpawnChance) {
      const availableLanes = [];
      if (!obstacle.topBlocker || obstacle.topBlocker.jut < obstacle.gap * 0.34) availableLanes.push('top');
      if (!obstacle.bottomBlocker || obstacle.bottomBlocker.jut < obstacle.gap * 0.34) availableLanes.push('bottom');
      const lane = availableLanes.length ? choice(availableLanes) : (Math.random() < 0.5 ? 'top' : 'bottom');
      const anchor = getWormAnchor(obstacle, lane === 'top');
      obstacle.wormLane = lane;
      state.worms.push({
        x: anchor.x,
        y: anchor.y,
        lane,
        bob: Math.random() * Math.PI * 2,
        sway: Math.random() * Math.PI * 2,
        value: cfg.wormBonus,
        collected: false,
      });
    }
    return obstacle;
  }

  function prebuildInitialRoute() {
    if (!state || state.obstacles.length) return;
    const count = state.config.initialRouteSegments || 7;
    const spacing = Number.isFinite(state.config.spawnSpacing) ? state.config.spawnSpacing : 210;
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const obstacle = spawnObstacle();
      if (obstacle) spawned.push(obstacle);
    }
    const firstX = W + 72;
    spawned.forEach((obstacle, idx) => {
      obstacle.x = firstX + idx * spacing;
    });
    state.worms.forEach((worm) => {
      let obstacle = spawned.find((obs) => obs.wormLane === worm.lane && Math.abs((obs.x + obs.width * 0.5) - worm.x) < spacing * 1.2);
      if (!obstacle) obstacle = spawned.find((obs) => obs.wormLane === worm.lane) || spawned[spawned.length - 1];
      if (!obstacle) return;
      const anchor = getWormAnchor(obstacle, worm.lane === 'top');
      worm.x = anchor.x;
      worm.y = anchor.y;
    });
    state.spawnTimer = 0;
  }

  function ensureRouteCoverage() {
    if (!state || state.over || state.rewardPending) return;
    const spacing = Number.isFinite(state.config.spawnSpacing) ? state.config.spawnSpacing : 210;
    const maxSegments = state.config.maxRouteSegments || 9;
    state.obstacles = state.obstacles.filter((obs) => Number.isFinite(obs.x) && obs.x + obs.width > -140);
    let safety = 0;
    while (state.obstacles.length < maxSegments && safety < 12) {
      spawnObstacle();
      safety += 1;
    }
    let rightMost = state.obstacles.reduce((max, obs) => Math.max(max, Number.isFinite(obs.x) ? obs.x : -Infinity), -Infinity);
    while (rightMost < W + spacing * 4 && safety < 18) {
      const obstacle = spawnObstacle();
      if (!obstacle || !Number.isFinite(obstacle.x)) break;
      rightMost = Math.max(rightMost, obstacle.x);
      safety += 1;
    }
  }

  function createState(round = 1, carry = {}) {
    const cfg = getRoundConfig(round);
    return {
      round: cfg.round,
      config: cfg,
      y: H * 0.5,
      vy: 0,
      gravity: cfg.gravity,
      flap: cfg.flap,
      maxRise: cfg.maxRise,
      maxFall: cfg.maxFall,
      speed: cfg.startSpeed,
      // Fairness pass (2026-07-19): a 3-heart buffer, matching DigLEW's
      // hearts / Burrow Blaster's lives — Root Glide was the only real-time
      // hub game with pure one-hit-death, which is what actually made the
      // difficulty curve collapse (see getRoundConfig's targetDistance
      // comment for the simulated evidence). hitInvuln mirrors DigLEW's
      // HIT_INVULN so a hit can't chain into a second hit the same frame.
      hearts: cfg.maxHearts,
      maxHearts: cfg.maxHearts,
      hitInvuln: 0,
      score: 0,
      distance: 0,
      checkpoints: 0,
      obstaclesPassed: 0,
      spawnTimer: 0,
      spawnEvery: cfg.spawnEvery,
      paused: false,
      over: false,
      rewardPending: false,
      cleared: false,
      finishReason: '',
      routeWarning: false,
      startedAt: performance.now(),
      lastGapCenter: H * 0.5,
      obstacles: [],
      worms: [],
      floaters: [],
      particles: [],
      trail: [],
      arcadeBanner: null,
      beaconApproachShown: false,
      finalPushShown: false,
      wormsCollected: 0,
      wormBonusScore: 0,
      edgeSaves: 0,
      sessionScore: Number(carry.sessionScore || 0),
      totalDistance: Number(carry.totalDistance || 0),
      totalCheckpoints: Number(carry.totalCheckpoints || 0),
      totalObstacles: Number(carry.totalObstacles || 0),
      totalWorms: Number(carry.totalWorms || 0),
      roundsCleared: Number(carry.roundsCleared || 0),
      totalPayout: Number(carry.totalPayout || 0),
      lastReward: Number(carry.lastReward || 0)
    };
  }

  function start(round = 1, carry = {}) {
    // Also fires on a round-to-round continue (continueToNextRound), not
    // just the Start/Resume button — startOrResume()'s own scrollIntoView
    // below never runs for that path, so without this a new round could
    // already be live before the player has scrolled to see it.
    canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
    cancelAnimationFrame(raf);
    const freshRun = !carry || !carry.keepMeta;
    if (freshRun) {
      meta.plays += 1;
      save(Storage.glideState, meta);
    }
    state = createState(round, carry);
    prebuildInitialRoute();
    ensureRouteCoverage();
    logs = [];
    addLog(`Round ${state.round} launched. Ride the burrow stream and guide Lew through the openings early.`);
    banner.textContent = `Beacon Run — Round ${state.round}`;
    sub.textContent = 'Guide Lew through glowing roots, falling cave gear, stone shelves, and thorn bursts.';
    modeEl.textContent = 'Running';
    hintEl.textContent = `Payload E active: terrain geometry is corrected, beacon setpieces are online, and buried easter eggs reward careful viewers. Reach ${state.config.targetDistance} m to unlock the next reward box.`;
    last = 0;
    rootGlideRenderFaults = 0;
    try {
      loop(performance.now());
    } catch (error) {
      console.error('[WinLEW][RootGlide] First frame guard caught an error.', error);
      window.WinLEWLastRootGlideError = { message: error?.message || String(error), stack: error?.stack || '', firstFrame: true };
      state.paused = true;
      modeEl.textContent = 'Paused';
      hintEl.textContent = 'Root Glide loaded, but the first frame hit a render guard. Tap Resume to retry without leaving the game.';
    }
    renderAll();
  }

  function glideRoundRank() {
    if (!state) return { rank: 'C', bonus: 0 };
    const score = state.wormsCollected * 20 + state.checkpoints * 25 + state.obstaclesPassed * 8 + state.edgeSaves * 12;
    if (score >= 240) return { rank: 'S+', bonus: 0.28 };
    if (score >= 180) return { rank: 'S', bonus: 0.20 };
    if (score >= 125) return { rank: 'A', bonus: 0.13 };
    if (score >= 75) return { rank: 'B', bonus: 0.07 };
    return { rank: 'C', bonus: 0 };
  }

  function glideBannerFx(title, subtitle = '', color = '#ffd86a', duration = 1.2) {
    if (!state) return;
    state.arcadeBanner = { title, subtitle, color, life: duration, maxLife: duration };
  }

  function glideFloatText(x, y, text, color = '#ffd86a') {
    if (!state) return;
    state.floaters.push({ x, y, text, color, life: 1, vy: -34, alpha: 1 });
  }

  function glideBurst(x, y, color = '#ffd86a', count = 10) {
    if (!state) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 35 + rand(95);
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.55 + Math.random() * 0.35, color, r: 2 + Math.random() * 3 });
    }
  }

  function getLewHitbox() {
    return { x: playerX + 5, y: state.y + 1, rx: 25, ry: 21 };
  }

  function openClearRewardOverlay() {
    if (!state || state.rewardPending) return;
    state.rewardPending = true;
    state.paused = true;
    state.cleared = true;
    renderAll();
    const rankInfo = glideRoundRank();
    const rawBaseReward = (state.config.baseReward + state.checkpoints * 2 + Math.floor(state.distance / 120)) * (1 + rankInfo.bonus);
    const baseReward = balanceGameReward('rootglide', rawBaseReward);
    // Minted once, here, for the round itself — not inside onPick — so the
    // claim's dedup key is stable no matter how the box-pick handler is
    // invoked, matching diglew.js's pattern.
    const claimToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const boxes = buildRewardBoxes();
    showRewardOverlay({
      title: `Root Glide — Round ${state.round} Clear`,
      badge: `Round ${state.round} reward box`,
      text: `Lew reached the glowing beacon for <strong>Round ${state.round}</strong>.<br><br>Round Rank: <strong>${rankInfo.rank}</strong>${rankInfo.bonus ? ` • Rank bonus +${Math.round(rankInfo.bonus * 100)}%` : ''}<br>Worms: <strong>${state.wormsCollected}</strong> • Edge saves: <strong>${state.edgeSaves}</strong><br><br>Your base payout is <strong>${baseReward.toFixed(2)} WinLEW</strong>. Pick one reward box to reveal your multiplier and then continue into Round ${state.round + 1}.`,
      boxes,
      continueLabel: `Continue to Round ${state.round + 1}`,
      onPick: (box) => {
        const payout = Number((baseReward * Number(box.multiplier || 1)).toFixed(2));
        state.lastReward = payout;
        state.totalPayout = Number((state.totalPayout + payout).toFixed(2));
        const walletTotal = addWallet(payout);
        renderAll();
        const claimPromise = postRewardClaim({
          game: 'rootglide',
          // Server-validated claim shape (recomputes payout = baseReward * multiplier);
          // without roundKey/baseReward/multiplier the claim was rejected + never saved.
          roundKey: `round-${state.round}-${claimToken}`,
          roundLabel: `Root Glide round ${state.round} beacon`,
          baseReward: rawBaseReward,
          multiplier: box.multiplier,
          payout,
          meta: {
            round: state.round,
            distance: Math.round(state.distance),
            totalDistance: Math.round(state.totalDistance + state.distance),
            checkpoints: state.totalCheckpoints + state.checkpoints,
            obstacles: state.totalObstacles + state.obstaclesPassed,
            worms: state.totalWorms + state.wormsCollected,
            rawBaseReward,
          },
        });
        // Corrects this optimistic credit to the server-authoritative amount
        // (up, down, or rolled back entirely) the moment the claim response
        // lands, instead of leaving it to eventually self-heal — which for a
        // guest only ever heals upward.
        const sync = reconcileClaimResult(payout, claimPromise);
        return {
          immediate: `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> for clearing Round ${state.round}.<br>Stored total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`,
          sync,
        };
      },
      onContinue: () => {
        continueRoundAfterReward();
      }
    });
  }

  function continueToNextRound() {
    if (!state) return;
    const carry = {
      keepMeta: true,
      sessionScore: state.sessionScore + state.score + state.config.clearBonus,
      totalDistance: state.totalDistance + state.distance,
      totalCheckpoints: state.totalCheckpoints + state.checkpoints,
      totalObstacles: state.totalObstacles + state.obstaclesPassed,
      totalWorms: state.totalWorms + state.wormsCollected,
      roundsCleared: state.roundsCleared + 1,
      totalPayout: state.totalPayout,
      lastReward: state.lastReward,
    };
    const nextRound = state.round + 1;
    addLog(`Round ${nextRound} ready. Keep descending.`);
    start(nextRound, carry);
  }

  function flap() {
    if (!state) {
      start(nextUnlockedRound());
      return;
    }
    if (state.rewardPending) return;
    if (state.over) {
      start(nextUnlockedRound());
      return;
    }
    state.paused = false;
    state.vy = clamp(Math.min(state.vy, 80) + state.flap, state.maxRise, state.maxFall);
    Sound.blip(680, 0.06, 'triangle', 0.04);
  }

  function reset() {
    hideRewardOverlay();
    board = [];
    meta = { bestScore: 0, bestDistance: 0, bestRound: 0, plays: 0 };
    save(Storage.glideBoard, board);
    save(Storage.glideState, meta);
    state = null;
    logs = ['Root Glide reset.'];
    renderHubBoards();
    renderAll();
    draw();
  }

  function finish(reason) {
    if (!state || state.over || state.rewardPending) return;
    state.over = true;
    state.finishReason = reason;
    const roundsReached = state.roundsCleared + (reason === 'clear' ? 1 : 0);
    const totalDistance = Math.round(state.totalDistance + state.distance);
    const totalCheckpoints = state.totalCheckpoints + state.checkpoints;
    const totalObstacles = state.totalObstacles + state.obstaclesPassed;
    const totalWorms = state.totalWorms + state.wormsCollected;
    const totalScore = Math.round(state.sessionScore + state.score + (reason === 'clear' ? state.config.clearBonus : 0));
    modeEl.textContent = reason === 'clear' ? 'Round Clear' : 'Down';
    meta.bestScore = Math.max(meta.bestScore, totalScore);
    meta.bestDistance = Math.max(meta.bestDistance, totalDistance);
    meta.bestRound = Math.max(meta.bestRound || 0, roundsReached);
    save(Storage.glideState, meta);

    if (reason === 'clear') {
      addLog(`Round ${state.round} cleared. Reward box ready.`);
      const rankInfo = glideRoundRank();
      glideBannerFx(`ROUND ${state.round} CLEAR`, `Rank ${rankInfo.rank} • Worms ${state.wormsCollected}`, '#ffd86a', 1.4);
      Sound.win();
      renderAll();
      renderHubBoards();
      openClearRewardOverlay();
      return;
    }

    const entry = {
      score: totalScore,
      distance: totalDistance,
      checkpoints: totalCheckpoints,
      obstacles: totalObstacles,
      worms: totalWorms,
      round: Math.max(1, state.round),
      payout: state.totalPayout,
    };
    board.push(entry);
    board.sort((a,b) => b.score - a.score);
    board = board.slice(0, 12);
    save(Storage.glideBoard, board);
    addLog(`Expedition down: ${reason}. Reached Round ${Math.max(1, state.round)} with ${totalWorms} worms collected.`);
    renderHubBoards();
    renderAll();
    Sound.hurt();
  }

  // Hearts-aware hit handler (2026-07-19 fairness pass — see createState's
  // comment). While invulnerable, a hit is fully ignored (no heart lost, no
  // re-trigger) so a single bad frame near an obstacle can't burn multiple
  // hearts at once. Nudges Lew back toward the vertical center so the very
  // next frame doesn't immediately re-collide with the same obstacle.
  function takeHit(reason) {
    if (!state || state.hitInvuln > 0) return false;
    state.hearts -= 1;
    state.hitInvuln = 1.0;
    state.y = clamp(state.y, 220, H - 220);
    state.vy = Math.min(state.vy, 0);
    glideBurst(playerX, state.y, '#ff9a62', 16);
    glideFloatText(playerX + 18, state.y - 24, `-1 (${state.hearts}/${state.maxHearts})`, '#ff9a62');
    addLog(`${reason} Hearts left: ${Math.max(0, state.hearts)}.`);
    Sound.hurt();
    if (state.hearts <= 0) {
      finish(reason);
      return true;
    }
    return false;
  }

  function update(dt) {
    if (!state || state.paused || state.over || state.rewardPending) return;
    state.hitInvuln = Math.max(0, (state.hitInvuln || 0) - dt);
    state.spawnTimer += dt;
    if (state.spawnTimer >= state.spawnEvery) {
      state.spawnTimer = 0;
      spawnObstacle();
      state.spawnEvery = Math.max(state.config.minSpawnEvery, state.spawnEvery - 0.006);
    }
    state.speed = Math.min(state.config.maxSpeed, state.speed + dt * state.config.speedGain);
    state.vy = clamp(state.vy + state.gravity * dt, state.maxRise, state.maxFall);
    state.y += state.vy * dt;
    state.distance += state.speed * dt * 0.08;
    state.score = state.distance + state.checkpoints * state.config.checkpointBonus + state.obstaclesPassed * state.config.obstacleBonus + state.wormBonusScore;

    for (const obstacle of state.obstacles) {
      obstacle.x -= state.speed * dt;
      if (!obstacle.passed && obstacle.x + obstacle.width < playerX) {
        obstacle.passed = true;
        state.obstaclesPassed += 1;
        Sound.coin();
        if (state.obstaclesPassed % state.config.checkpointEvery === 0) {
          state.checkpoints += 1;
          addLog(`Checkpoint ${state.checkpoints} secured. The burrow stream tightens.`);
          glideBannerFx(`CHECKPOINT ${state.checkpoints}`, 'Route confirmed. Stay centered through the next gap.', '#9fe8ff', 1.05);
          glideBurst(playerX + 46, state.y, '#8fe7ff', 10);
          Sound.win();
        }
      }
    }
    state.obstacles = state.obstacles.filter((obs) => Number.isFinite(obs.x) && obs.x + obs.width > -140);
    ensureRouteCoverage();

    for (const worm of state.worms) {
      worm.x -= state.speed * dt;
      worm.bob += dt * 7;
      worm.sway += dt * 4.6;
      if (!worm.collected) {
        const points = getWormPoints(worm);
        let snagged = points.some((pt) => Math.hypot(pt.x - playerX, pt.y - state.y) < pt.r + 28);
        if (!snagged) {
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            if (pointToSegmentDistance(playerX, state.y, a.x, a.y, b.x, b.y) < 31) {
              snagged = true;
              break;
            }
          }
        }
        if (snagged) {
          worm.collected = true;
          state.wormsCollected += 1;
          state.wormBonusScore += worm.value;
          glideFloatText(worm.x, worm.y, `+${worm.value}`, '#ffd86a');
          glideBurst(worm.x, worm.y, '#ffd86a', 12);
          addLog(`Golden worm snagged! +${worm.value} pts for flying the risky line.`);
          if (state.wormsCollected % 3 === 0) {
            glideBannerFx('GOLDEN LINE', `${state.wormsCollected} worms collected`, '#ffd86a', 0.95);
          }
          Sound.coin();
        }
      }
    }
    state.worms = state.worms.filter((worm) => !worm.collected && worm.x > -60);
    state.floaters.forEach((f) => { f.y += f.vy * dt; f.life -= dt; f.alpha = clamp(f.life, 0, 1); });
    state.floaters = state.floaters.filter((f) => f.life > 0);
    state.particles.forEach((pt) => { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.97; pt.vy *= 0.97; pt.life -= dt; });
    state.particles = state.particles.filter((pt) => pt.life > 0);
    state.trail.push({ x: playerX - 34, y: state.y + 6, life: 0.42, r: 10 + Math.random() * 7 });
    state.trail.forEach((t) => { t.x -= state.speed * dt * 0.42; t.life -= dt; });
    state.trail = state.trail.filter((t) => t.life > 0);
    if (state.arcadeBanner) {
      state.arcadeBanner.life -= dt;
      if (state.arcadeBanner.life <= 0) state.arcadeBanner = null;
    }

    const hit = getLewHitbox();
    const gapMercy = 12;
    if (hit.y - hit.ry < 46 || hit.y + hit.ry > H - 46) {
      if (takeHit('Lew clipped the cavern wall.')) return;
    }
    for (const obstacle of state.obstacles) {
      const bounds = getOpenGapBounds(obstacle);
      const withinX = hit.x + hit.rx > obstacle.x + 2 && hit.x - hit.rx < obstacle.x + obstacle.width - 2;
      const inGap = hit.y - hit.ry > bounds.top - gapMercy && hit.y + hit.ry < bounds.bottom + gapMercy;
      if (withinX && !inGap) {
        const blocker = hit.y < (bounds.top + bounds.bottom) * 0.5 ? obstacle.topBlocker : obstacle.bottomBlocker;
        const label = blocker ? glideBlockerLabel(blocker.type) : 'the tunnel terrain';
        if (takeHit(`${label} caught Lew.`)) return;
      } else if (withinX && inGap && Math.min(Math.abs(hit.y - bounds.top), Math.abs(hit.y - bounds.bottom)) < 32) {
        if (!obstacle.edgeScored) {
          obstacle.edgeScored = true;
          state.edgeSaves += 1;
          state.score += 12;
          glideFloatText(hit.x + 18, hit.y - 18, '+12 edge', '#a9f7ff');
          if (state.edgeSaves % 3 === 0) {
            glideBannerFx('THREAD THE GAP', `${state.edgeSaves} clean threads`, '#9fe8ff', 1.05);
          }
        }
      }
    }

    // Payload C.3: connector rails are preview/guidance only. Solid collision lives on columns and protruding gear.

    const routeProgress = state.distance / state.config.targetDistance;
    if (!state.beaconApproachShown && routeProgress >= 0.72) {
      state.beaconApproachShown = true;
      glideBannerFx('BEACON SIGNAL', 'The gate is lighting up ahead.', '#ffd86a', 1.05);
    }
    if (!state.finalPushShown && routeProgress >= 0.92) {
      state.finalPushShown = true;
      glideBannerFx('FINAL GLIDE', 'Hold the route and bank the round.', '#ffb85a', 1.05);
    }

    if (state.distance >= state.config.targetDistance) {
      finish('clear');
      return;
    }
    renderAll();
  }

  function loop(ts) {
    try {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.03, (ts - (last || ts)) / 1000);
      last = ts;
      if (!views.rootglide.classList.contains('hidden')) update(dt);
      draw();
      rootGlideRenderFaults = 0;
    } catch (error) {
      rootGlideRenderFaults += 1;
      console.error('[WinLEW][RootGlide] Render/update guard caught an error.', error);
      window.WinLEWLastRootGlideError = { message: error?.message || String(error), stack: error?.stack || '', faults: rootGlideRenderFaults };
      if (state) {
        state.paused = true;
        modeEl.textContent = 'Paused';
        hintEl.textContent = 'A render guard paused Root Glide instead of crashing the launch. Tap Resume once the page settles.';
      }
      try { renderAll(); } catch (renderError) { console.error('[WinLEW][RootGlide] renderAll guard failed.', renderError); }
      if (rootGlideRenderFaults < 2) {
        raf = requestAnimationFrame(loop);
      }
    }
  }

  function drawTunnelStripe(y, alpha) {
    ctx.strokeStyle = `rgba(214,168,102,${alpha})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  function drawBackgroundDetails() {
    const t = performance.now() / 1000;
    const scrollA = (t * 22) % W;
    const scrollB = (t * 38) % W;
    const beaconPulse = 0.52 + Math.sin(t * 2.3) * 0.12;
    const beaconX = W - 102;
    const beaconY = 142;

    ctx.save();

    const glow = ctx.createRadialGradient(beaconX, beaconY, 12, beaconX, beaconY, 320);
    glow.addColorStop(0, `rgba(255, 220, 120, ${0.42 + beaconPulse * 0.18})`);
    glow.addColorStop(0.22, 'rgba(255, 177, 58, .22)');
    glow.addColorStop(0.65, 'rgba(255, 126, 29, .08)');
    glow.addColorStop(1, 'rgba(255, 126, 29, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // distant tunnel ribs
    ctx.strokeStyle = 'rgba(84, 56, 28, .24)';
    ctx.lineWidth = 20;
    for (let i = -1; i < 8; i++) {
      const x = i * 170 - scrollA + 30;
      ctx.beginPath();
      ctx.moveTo(x, -20);
      ctx.bezierCurveTo(x + 20, 150, x - 30, H - 210, x + 10, H + 20);
      ctx.stroke();
    }

    // mid roots / depth lines
    ctx.strokeStyle = 'rgba(211, 148, 86, .28)';
    ctx.lineWidth = 6;
    for (let i = -1; i < 10; i++) {
      const x = i * 122 - scrollB * 0.65 + 18;
      ctx.beginPath();
      ctx.moveTo(x, -20);
      ctx.bezierCurveTo(x + 34, 86, x - 26, 168, x + 20, 310);
      ctx.stroke();
    }

    // hanging roots
    ctx.strokeStyle = 'rgba(228, 145, 56, .46)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const rootX = (i * 165 + 42 - scrollA * 0.9) % (W + 120) - 60;
      ctx.beginPath();
      ctx.moveTo(rootX, -20);
      ctx.bezierCurveTo(rootX + 28, 44, rootX - 18, 82, rootX + 16, 126);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rootX + 10, 46);
      ctx.lineTo(rootX + 30, 74);
      ctx.stroke();
      ctx.lineWidth = 4;
    }

    // foreground soil silhouettes for premium depth
    for (let i = 0; i < 3; i++) {
      const baseX = ((i * 320 - scrollB * 0.42) % (W + 340)) - 170;
      ctx.fillStyle = i % 2 ? 'rgba(34, 21, 10, .24)' : 'rgba(61, 35, 12, .20)';
      ctx.beginPath();
      ctx.moveTo(baseX, H);
      ctx.lineTo(baseX + 50, H - 30);
      ctx.lineTo(baseX + 180, H - 54 - i * 10);
      ctx.lineTo(baseX + 320, H - 16);
      ctx.lineTo(baseX + 360, H);
      ctx.closePath();
      ctx.fill();
    }

    // beacon gate and target tunnel
    ctx.save();
    ctx.translate(beaconX, beaconY);
    ctx.shadowColor = 'rgba(255, 200, 90, .42)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(255, 195, 93, .58)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(173, 103, 35, .66)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 220, 120, .92)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // guide rays from beacon
    ctx.fillStyle = 'rgba(255, 197, 104, .08)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(beaconX - 10, beaconY);
      ctx.lineTo(beaconX - 240 - i * 34, beaconY - 78 - i * 14);
      ctx.lineTo(beaconX - 258 - i * 36, beaconY - 38 + i * 6);
      ctx.closePath();
      ctx.fill();
    }

    // ambient dust
    for (let i = 0; i < 52; i++) {
      const px = (i * 73 + t * (14 + (i % 5) * 4)) % (W + 80) - 40;
      const py = (i * 47 + Math.sin(t + i) * 10) % H;
      const a = 0.08 + (i % 4) * 0.03;
      ctx.fillStyle = `rgba(255, 225, 168, ${a})`;
      ctx.fillRect(px, py, 2 + (i % 2), 2 + (i % 2));
    }

    // luminous tunnel markers
    ctx.fillStyle = 'rgba(127,229,127,.12)';
    for (let i = 0; i < 24; i++) ctx.fillRect((i * 92 + 20 - scrollA) % W, 84 + (i % 3) * 18, 12, 10);
    ctx.fillStyle = 'rgba(255, 184, 74, .12)';
    for (let i = 0; i < 18; i++) ctx.fillRect((i * 104 + 40 - scrollB * 0.35) % W, H - 220 + (i % 2) * 16, 8, 8);

    ctx.restore();
  }

  function getTerrainPalette(obstacle) {
    // Payload C.2: keep live-run terrain warm/brown for readability.
    // Future round/checkpoint themes can intentionally override this later.
    return {
      fill: '#6a4323',
      dark: '#2d170a',
      accent: '#c89152',
      glow: 'rgba(240,178,116,.12)',
      fleck: 'rgba(255,211,157,.18)',
      guide: 'rgba(220, 161, 92, .72)',
    };
  }

  function seededUnit(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  function cubicBezierValue(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return (mt ** 3) * p0 + 3 * (mt ** 2) * t * p1 + 3 * mt * (t ** 2) * p2 + (t ** 3) * p3;
  }

  function drawTerrainEasterEgg(type, x, y, size, rotation, palette, embeddedTone = 0.78) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(size, size);
    ctx.globalAlpha *= 0.9;
    ctx.shadowColor = 'rgba(0,0,0,.16)';
    ctx.shadowBlur = 4;

    const dirtHi = 'rgba(255, 216, 170, .18)';
    const dirtLo = 'rgba(28, 14, 7, .26)';
    const warmMetal = '#d29b56';
    const orangeMetal = '#d86d27';
    const leafGreen = '#7fbb58';
    const pipeBrown = '#7a4d2b';
    const berryRed = '#ba4e39';
    const dirtMask = `rgba(93, 57, 29, ${0.18 + (1 - embeddedTone) * 0.12})`;

    if (type === 'boot') {
      ctx.fillStyle = '#6d4525';
      ctx.beginPath();
      ctx.roundRect(-9, -5, 10, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#3d2415';
      ctx.beginPath();
      ctx.roundRect(-12, 4, 18, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#c79359';
      ctx.fillRect(-7, -2, 6, 1.6);
      ctx.fillRect(-7, 1, 6, 1.6);
    } else if (type === 'shovel') {
      ctx.strokeStyle = '#ad8455';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(0, 4);
      ctx.stroke();
      ctx.fillStyle = '#b9c2d6';
      ctx.beginPath();
      ctx.ellipse(0, 8, 7, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.2)';
      ctx.beginPath();
      ctx.ellipse(-1.5, 6.5, 3, 4, -.25, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'pipe') {
      ctx.strokeStyle = pipeBrown;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-6, 6);
      ctx.lineTo(3, 6);
      ctx.quadraticCurveTo(10, 6, 10, -1);
      ctx.lineTo(10, -8);
      ctx.stroke();
      ctx.strokeStyle = '#b98758';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-5, 4);
      ctx.lineTo(1, 4);
      ctx.stroke();
    } else if (type === 'fruit') {
      ctx.fillStyle = berryRed;
      ctx.beginPath();
      ctx.arc(0, 1, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0c56f';
      ctx.beginPath();
      ctx.arc(-2, -1, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8bc46a';
      ctx.beginPath();
      ctx.moveTo(1, -7);
      ctx.quadraticCurveTo(8, -11, 10, -5);
      ctx.quadraticCurveTo(5, -3, 1, -7);
      ctx.fill();
    } else if (type === 'worm') {
      for (let i = 0; i < 5; i++) {
        const px = Math.sin(i * 0.66) * 4.6;
        const py = i * 4.6 - 9;
        ctx.fillStyle = i < 2 ? '#c08822' : i < 4 ? '#e2b03c' : '#ffdc6d';
        ctx.beginPath();
        ctx.ellipse(px, py, 4 - i * 0.25, 3.4 - i * 0.18, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'lantern') {
      ctx.fillStyle = warmMetal;
      ctx.beginPath();
      ctx.roundRect(-5, -4, 10, 12, 3);
      ctx.fill();
      ctx.strokeStyle = '#f7d374';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, -5, 4.2, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#f7db80';
      ctx.beginPath();
      ctx.ellipse(0, 1, 3.2, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'glider') {
      ctx.fillStyle = '#2d2017';
      ctx.beginPath();
      ctx.ellipse(-1, 3, 8.5, 6.2, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = orangeMetal;
      ctx.beginPath();
      ctx.arc(0, -3, 6.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f6ddbe';
      ctx.beginPath();
      ctx.ellipse(2, 3, 4.2, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = leafGreen;
      ctx.beginPath();
      ctx.moveTo(-8, -1);
      ctx.lineTo(-18, -8);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, -5);
      ctx.lineTo(-14, -14);
      ctx.lineTo(-6, -6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f6d77a';
      ctx.beginPath();
      ctx.arc(0, -6, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'blaster') {
      ctx.fillStyle = orangeMetal;
      ctx.beginPath();
      ctx.roundRect(-8, -3, 16, 18, 6);
      ctx.fill();
      ctx.fillStyle = '#d9a35b';
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(8, -3);
      ctx.lineTo(-8, -3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2f2117';
      ctx.beginPath();
      ctx.ellipse(0, 4, 5.2, 5.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f6d8b6';
      ctx.beginPath();
      ctx.ellipse(0, 5.2, 3.4, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd06a';
      ctx.beginPath();
      ctx.arc(0, -1, 2.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#6ea0d1';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, 11);
      ctx.lineTo(-7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fill();
    }

    // bury the bottom portion slightly so the prop feels embedded in the terrain.
    ctx.fillStyle = dirtMask;
    ctx.beginPath();
    ctx.roundRect(-14, 3, 28, 15, 5);
    ctx.fill();
    ctx.fillStyle = dirtHi;
    ctx.fillRect(-9, 5, 8, 1.5);
    ctx.fillStyle = dirtLo;
    ctx.fillRect(-12, 8, 18, 1.8);
    ctx.restore();
  }

  function paintConnectorEasterEggs(path, side, aRight, gapX, startY, midY, endY, palette, seedBase) {
    const pocket = side === 'top' ? Math.min(startY, endY) : H - Math.max(startY, endY);
    if (pocket < 56) return;
    const types = ['boot', 'shovel', 'pipe', 'fruit', 'worm', 'lantern', 'glider', 'blaster'];
    const count = pocket > 110 ? 3 : 2;
    ctx.save();
    ctx.clip(path);
    for (let i = 0; i < count; i++) {
      const seed = seedBase + i * 13.7;
      const pct = 0.18 + i * (0.64 / Math.max(1, count - 1)) + seededUnit(seed + 9.2) * 0.06;
      const x = aRight + gapX * pct;
      const curveY = cubicBezierValue(startY, midY, midY, endY, pct);
      const depth = 20 + seededUnit(seed + 4.1) * Math.min(54, pocket * 0.45);
      const y = side === 'top'
        ? clamp(curveY - depth, 18, Math.max(18, curveY - 12))
        : clamp(curveY + depth, Math.min(H - 18, curveY + 12), H - 18);
      const type = types[Math.floor(seededUnit(seed + 1.7) * types.length) % types.length];
      const rotation = (seededUnit(seed + 2.9) - 0.5) * 0.55;
      const size = 0.72 + seededUnit(seed + 6.4) * 0.32;
      const alpha = 0.18 + seededUnit(seed + 7.3) * 0.16;
      ctx.globalAlpha = alpha;
      drawTerrainEasterEgg(type, x, y, size, rotation, palette, 0.74);
    }
    ctx.restore();
  }

  function drawTerrainConnectors() {
    if (!state || state.obstacles.length < 2) return;
    const sorted = [...state.obstacles]
      .filter((obs) => Number.isFinite(obs.x) && Number.isFinite(obs.gapY) && Number.isFinite(obs.gap))
      .sort((a, b) => a.x - b.x);
    if (sorted.length < 2) return;
    ctx.save();
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const aRight = a.x + a.width;
      const bLeft = b.x;
      const gapX = bLeft - aRight;
      if (gapX <= 0 || gapX > W * 0.72) continue;

      // Payload E geometry fix:
      // Use the true column lips as the terrain source-of-truth, not the smaller blocker-adjusted gap.
      // Brown = solid dirt. Blue/dark open space = playable tunnel.
      const aTopLip = a.gapY;
      const bTopLip = b.gapY;
      const aBottomLip = a.gapY + a.gap;
      const bBottomLip = b.gapY + b.gap;
      const palette = getTerrainPalette(a);
      const c1x = aRight + gapX * 0.34;
      const c2x = aRight + gapX * 0.66;
      const visualBuffer = clamp(7 + (state.round - 1) * 0.8, 7, 14);
      const topStart = aTopLip + visualBuffer;
      const topEnd = bTopLip + visualBuffer;
      const bottomStart = aBottomLip - visualBuffer;
      const bottomEnd = bBottomLip - visualBuffer;
      const topMid = (topStart + topEnd) * 0.5;
      const bottomMid = (bottomStart + bottomEnd) * 0.5;

      const topPath = new Path2D();
      topPath.moveTo(aRight, -10);
      topPath.lineTo(aRight, topStart);
      topPath.bezierCurveTo(c1x, topMid, c2x, topMid, bLeft, topEnd);
      topPath.lineTo(bLeft, -10);
      topPath.closePath();

      const bottomPath = new Path2D();
      bottomPath.moveTo(aRight, H + 10);
      bottomPath.lineTo(aRight, bottomStart);
      bottomPath.bezierCurveTo(c1x, bottomMid, c2x, bottomMid, bLeft, bottomEnd);
      bottomPath.lineTo(bLeft, H + 10);
      bottomPath.closePath();

      ctx.globalAlpha = 0.98;
      ctx.fillStyle = palette.fill;
      ctx.fill(topPath);
      ctx.fill(bottomPath);

      // Layered dirt mass: full graphic richness, but the edge stays just inside the column horizon.
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = palette.dark;
      const topShade = new Path2D();
      topShade.moveTo(aRight, -10);
      topShade.lineTo(aRight, Math.max(-10, topStart - 34));
      topShade.bezierCurveTo(c1x, topMid - 32, c2x, topMid - 32, bLeft, Math.max(-10, topEnd - 34));
      topShade.lineTo(bLeft, -10);
      topShade.closePath();
      ctx.fill(topShade);
      const bottomShade = new Path2D();
      bottomShade.moveTo(aRight, H + 10);
      bottomShade.lineTo(aRight, Math.min(H + 10, bottomStart + 34));
      bottomShade.bezierCurveTo(c1x, bottomMid + 32, c2x, bottomMid + 32, bLeft, Math.min(H + 10, bottomEnd + 34));
      bottomShade.lineTo(bLeft, H + 10);
      bottomShade.closePath();
      ctx.fill(bottomShade);

      // Stream-friendly buried easter eggs, clipped to dirt so they never pollute playable space.
      paintConnectorEasterEggs(topPath, 'top', aRight, gapX, topStart, topMid, topEnd, palette, a.accentSeed + b.accentSeed + i * 17);
      paintConnectorEasterEggs(bottomPath, 'bottom', aRight, gapX, bottomStart, bottomMid, bottomEnd, palette, a.accentSeed + b.accentSeed + i * 29 + 5);

      // The route boundary line sits on the safe opening side of the dirt, not floating in the middle.
      ctx.globalAlpha = 0.94;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(aRight, topStart);
      ctx.bezierCurveTo(c1x, topMid, c2x, topMid, bLeft, topEnd);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(aRight, bottomStart);
      ctx.bezierCurveTo(c1x, bottomMid, c2x, bottomMid, bLeft, bottomEnd);
      ctx.stroke();

      ctx.globalAlpha = 0.24;
      ctx.strokeStyle = 'rgba(255, 224, 164, .46)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(aRight, topStart - 8);
      ctx.bezierCurveTo(c1x, topMid - 8, c2x, topMid - 8, bLeft, topEnd - 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(aRight, bottomStart + 8);
      ctx.bezierCurveTo(c1x, bottomMid + 8, c2x, bottomMid + 8, bLeft, bottomEnd + 8);
      ctx.stroke();

      ctx.globalAlpha = 0.28;
      ctx.fillStyle = palette.fleck;
      for (let j = 0; j < 5; j++) {
        const pct = (j + 1) / 6;
        const fx = aRight + gapX * pct;
        const ty = topStart + (topEnd - topStart) * pct;
        const by = bottomStart + (bottomEnd - bottomStart) * pct;
        ctx.fillRect(fx, Math.max(6, ty - 18 - (j % 2) * 5), 6 + (j % 2) * 2, 3);
        ctx.fillRect(fx - 4, Math.min(H - 12, by + 14 + (j % 2) * 5), 6 + (j % 3), 3);
      }
    }
    ctx.restore();
  }

  function getInterpolatedRouteBounds(x) {
    if (!state || state.obstacles.length < 2) return null;
    const sorted = [...state.obstacles].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const aRight = a.x + a.width;
      const bLeft = b.x;
      if (x <= aRight || x >= bLeft) continue;
      const gapX = bLeft - aRight;
      if (gapX <= 0 || gapX > W * 0.82) continue;
      const t = clamp((x - aRight) / gapX, 0, 1);
      const aBounds = getOpenGapBounds(a);
      const bBounds = getOpenGapBounds(b);
      return {
        top: aBounds.top + (bBounds.top - aBounds.top) * t,
        bottom: aBounds.bottom + (bBounds.bottom - aBounds.bottom) * t,
      };
    }
    return null;
  }

  function drawTerrainFeature(obstacle, blocker, side, palette) {
    if (!blocker) return;
    const dir = side === 'top' ? 1 : -1;
    const edgeY = side === 'top' ? obstacle.gapY : obstacle.gapY + obstacle.gap;
    const centerX = obstacle.x + obstacle.width * (0.42 + Math.sin(blocker.seed) * 0.08);
    const jut = blocker.jut;
    const t = performance.now() / 1000;
    const wobble = Math.sin(t * 2.4 + blocker.seed) * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.24)';
    ctx.shadowBlur = 8;

    if (blocker.type === 'boot') {
      const bodyW = 30 * blocker.scale;
      const bodyH = Math.max(24, jut - 14);
      const bodyY = side === 'top' ? edgeY + 2 : edgeY - bodyH - 2;
      ctx.fillStyle = '#6a4126';
      ctx.beginPath();
      ctx.roundRect(centerX - bodyW * 0.46, bodyY, bodyW * 0.72, bodyH, 9);
      ctx.fill();
      ctx.fillStyle = '#3f2414';
      const soleY = side === 'top' ? bodyY + bodyH - 4 : bodyY - 10;
      ctx.beginPath();
      ctx.roundRect(centerX - bodyW * 0.62, soleY, bodyW * 1.16, 12, 6);
      ctx.fill();
      ctx.fillStyle = '#c78f53';
      for (let i = 0; i < 3; i++) {
        const laceY = side === 'top' ? bodyY + 8 + i * 9 : bodyY + bodyH - 16 - i * 9;
        ctx.fillRect(centerX - 9, laceY, 18, 2.8);
      }
    } else if (blocker.type === 'shovel') {
      ctx.strokeStyle = '#b68a58';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(centerX, edgeY);
      ctx.lineTo(centerX + wobble, edgeY + dir * (jut - 18));
      ctx.stroke();
      ctx.fillStyle = '#cdd5e8';
      ctx.beginPath();
      ctx.ellipse(centerX + wobble, edgeY + dir * (jut - 6), 16, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#93a0ba';
      ctx.beginPath();
      ctx.ellipse(centerX + wobble, edgeY + dir * (jut - 6), 10, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (blocker.type === 'thorn') {
      ctx.fillStyle = '#7fbc57';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(centerX + i * 10, edgeY);
        ctx.lineTo(centerX + i * 6 - 8, edgeY + dir * (jut * 0.65));
        ctx.lineTo(centerX + i * 4 + 8, edgeY + dir * (jut * 0.88));
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = '#dff2be';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(centerX, edgeY + dir * 4);
      ctx.lineTo(centerX, edgeY + dir * (jut * 0.84));
      ctx.stroke();
    } else if (blocker.type === 'rock') {
      ctx.fillStyle = '#8d8478';
      ctx.beginPath();
      ctx.moveTo(centerX - 18, edgeY + dir * 3);
      ctx.lineTo(centerX - 24, edgeY + dir * (jut * 0.52));
      ctx.lineTo(centerX - 9, edgeY + dir * (jut * 0.92));
      ctx.lineTo(centerX + 16, edgeY + dir * (jut * 0.78));
      ctx.lineTo(centerX + 22, edgeY + dir * (jut * 0.36));
      ctx.lineTo(centerX + 8, edgeY + dir * 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.beginPath();
      ctx.moveTo(centerX - 10, edgeY + dir * (jut * 0.2));
      ctx.lineTo(centerX + 6, edgeY + dir * (jut * 0.42));
      ctx.lineTo(centerX - 6, edgeY + dir * (jut * 0.52));
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = '#9b6a37';
      ctx.lineWidth = 7;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(centerX + i * 10, edgeY);
        ctx.bezierCurveTo(centerX + i * 16, edgeY + dir * (jut * 0.26), centerX + i * 2 - 8, edgeY + dir * (jut * 0.65), centerX + i * 14, edgeY + dir * jut);
        ctx.stroke();
      }
      ctx.strokeStyle = '#d9a56f';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(centerX - 3, edgeY + dir * 8);
      ctx.lineTo(centerX + 2, edgeY + dir * (jut * 0.82));
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawObstacle(obstacle) {
    const topH = obstacle.gapY;
    const bottomY = obstacle.gapY + obstacle.gap;
    const palette = getTerrainPalette(obstacle);
    const wobble = Math.sin(performance.now() / 700 + obstacle.pulse) * 4;

    ctx.save();
    ctx.fillStyle = palette.glow;
    ctx.fillRect(obstacle.x - 20, 0, obstacle.width + 40, topH);
    ctx.fillRect(obstacle.x - 20, bottomY, obstacle.width + 40, H - bottomY);

    ctx.fillStyle = palette.dark;
    ctx.fillRect(obstacle.x + 10, 0, obstacle.width, topH);
    ctx.fillRect(obstacle.x + 10, bottomY, obstacle.width, H - bottomY);

    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.roundRect(obstacle.x, -16, obstacle.width, topH + 16, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(obstacle.x, bottomY, obstacle.width, H - bottomY + 16, 10);
    ctx.fill();

    ctx.fillStyle = palette.accent;
    ctx.fillRect(obstacle.x + 4, topH - 10, obstacle.width - 8, 10);
    ctx.fillRect(obstacle.x + 4, bottomY, obstacle.width - 8, 10);

    ctx.fillStyle = palette.fleck;
    for (let i = 0; i < 16; i++) {
      const offsetX = 12 + (i * 17 + obstacle.accentSeed) % Math.max(18, obstacle.width - 20);
      const topY = Math.max(8, topH - 20 - (i * 13 % 84));
      const bottomFleckY = bottomY + 16 + (i * 11 % 86);
      ctx.fillRect(obstacle.x + offsetX, topY, 7 + (i % 3) * 2, 3 + (i % 2));
      ctx.fillRect(obstacle.x + offsetX - 3, bottomFleckY, 7 + (i % 2) * 2, 3 + (i % 3));
    }

    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const veinX = obstacle.x + 16 + i * (obstacle.width / 3.4);
      ctx.beginPath();
      ctx.moveTo(veinX, 0);
      ctx.lineTo(veinX + wobble * 0.3, topH - 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(veinX - 4, bottomY + 12);
      ctx.lineTo(veinX + wobble * 0.24, H);
      ctx.stroke();
    }

    drawTerrainFeature(obstacle, obstacle.topBlocker, 'top', palette);
    drawTerrainFeature(obstacle, obstacle.bottomBlocker, 'bottom', palette);

    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 4;
    if (obstacle.wormLane !== 'top') {
      ctx.beginPath();
      ctx.moveTo(obstacle.x + obstacle.width * .5, topH);
      ctx.bezierCurveTo(obstacle.x + obstacle.width * .20 + wobble, topH + 18, obstacle.x + obstacle.width * .88, topH + 42, obstacle.x + obstacle.width * .35, topH + 70);
      ctx.stroke();
    }
    if (obstacle.wormLane !== 'bottom') {
      ctx.beginPath();
      ctx.moveTo(obstacle.x + obstacle.width * .55, bottomY);
      ctx.bezierCurveTo(obstacle.x + obstacle.width * .78, bottomY - 18, obstacle.x + obstacle.width * .18 + wobble, bottomY - 44, obstacle.x + obstacle.width * .65, bottomY - 72);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawWorm(worm) {
    const dir = worm.lane === 'top' ? 1 : -1;
    const points = getWormPoints(worm);
    ctx.save();
    ctx.shadowColor = 'rgba(255, 201, 82, .42)';
    ctx.shadowBlur = 14;

    ctx.strokeStyle = 'rgba(122, 80, 18, .92)';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();

    points.forEach((pt, idx) => {
      ctx.fillStyle = idx >= points.length - 2 ? '#ffd86a' : idx >= 2 ? '#e4b63b' : '#bf8c1f';
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y, pt.r, pt.r * 0.76, dir * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 248, 205, .55)';
      ctx.beginPath();
      ctx.ellipse(pt.x - 1.5, pt.y - dir * 1, pt.r * 0.42, pt.r * 0.26, dir * 0.18, 0, Math.PI * 2);
      ctx.fill();
    });

    const head = points[points.length - 1];
    ctx.fillStyle = '#2d1c08';
    ctx.beginPath();
    ctx.arc(head.x + 2, head.y - dir * 1.6, 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x - 1, head.y - dir * 1.1, 0.95, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }


  function drawCourierFallback() {
    // Fallback courier body used while image assets are still loading.
    // This prevents slower hosts/mobile browsers from crashing the first frame after the launch popup.
    ctx.save();
    ctx.shadowColor = 'rgba(255, 190, 70, .28)';
    ctx.shadowBlur = 14;

    const body = ctx.createLinearGradient ? ctx.createLinearGradient(-44, -24, 44, 28) : null;
    if (body) {
      body.addColorStop(0, '#f8d681');
      body.addColorStop(0.55, '#b9742d');
      body.addColorStop(1, '#5b3215');
      ctx.fillStyle = body;
    } else {
      ctx.fillStyle = '#b9742d';
    }
    ctx.beginPath();
    ctx.ellipse(-5, 2, 48, 25, -0.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7a461f';
    ctx.beginPath();
    ctx.ellipse(34, -4, 22, 18, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffe7a7';
    ctx.beginPath();
    ctx.ellipse(7, -6, 19, 8, -0.04, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2b1b12';
    ctx.beginPath();
    ctx.arc(41, -9, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 236, 165, .8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(49, -5);
    ctx.lineTo(68, -15);
    ctx.moveTo(50, -2);
    ctx.lineTo(70, -2);
    ctx.moveTo(48, 1);
    ctx.lineTo(66, 12);
    ctx.stroke();

    ctx.fillStyle = 'rgba(88, 50, 21, .9)';
    ctx.beginPath();
    ctx.ellipse(-43, -2, 11, 8, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f3c66b';
    ctx.beginPath();
    ctx.ellipse(-18, 24, 14, 5, 0.2, 0, Math.PI * 2);
    ctx.ellipse(20, 23, 13, 5, -0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }


  function drawCourier() {
    if (!state) return;
    ctx.save();
    ctx.translate(playerX, state.y);

    let sprite = glideSprites.fly;
    let width = 118;
    let rotation = 0;

    if (state.vy < -120) {
      sprite = glideSprites.up;
      width = 120;
      rotation = -0.18;
    } else if (state.vy > 170) {
      sprite = glideSprites.down;
      width = 112;
      rotation = 0.28;
    } else {
      sprite = glideSprites.fly;
      width = 116;
      rotation = -0.04;
    }

    ctx.rotate(rotation);
    ctx.shadowColor = 'rgba(255, 187, 64, .28)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = 'rgba(249, 196, 109, .08)';
    ctx.beginPath();
    ctx.ellipse(0, 4, width * 0.46, width * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    if (sprite && sprite.complete && sprite.naturalWidth) {
      const ratio = sprite.naturalHeight / sprite.naturalWidth;
      const height = width * ratio;
      ctx.drawImage(sprite, -width * 0.62, -height * 0.5, width, height);
    } else {
      drawCourierFallback();
    }

    ctx.restore();
  }

  function drawGlideTrail() {
    if (!state) return;
    ctx.save();
    state.trail.forEach((t) => {
      ctx.globalAlpha = Math.max(0, t.life * 1.8);
      ctx.fillStyle = 'rgba(255, 174, 62, .26)';
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, t.r * 1.8, t.r * .78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 227, 145, .18)';
      ctx.beginPath();
      ctx.ellipse(t.x + 6, t.y - 1, t.r * .92, t.r * .28, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawGlideFx() {
    if (!state) return;
    ctx.save();
    state.particles.forEach((pt) => {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r || 3, 0, Math.PI * 2);
      ctx.fill();
    });
    state.floaters.forEach((f) => {
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = 'rgba(7,10,18,.42)';
      ctx.fillRect(f.x - 10, f.y - 18, Math.max(54, f.text.length * 12), 28);
      ctx.fillStyle = f.color;
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.restore();
  }

  function drawGlideBanner() {
    if (!state || !state.arcadeBanner) return;
    const b = state.arcadeBanner;
    const alpha = clamp(b.life / b.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.4);
    ctx.fillStyle = 'rgba(5, 8, 14, .72)';
    ctx.fillRect(110, 120, W - 220, 130);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(118, 128, W - 236, 114);
    ctx.fillStyle = b.color;
    ctx.font = '900 40px Inter, sans-serif';
    ctx.fillText(b.title, 150, 174);
    ctx.fillStyle = '#eef2ff';
    ctx.font = '600 22px Inter, sans-serif';
    ctx.fillText(b.subtitle, 150, 214);
    ctx.restore();
  }

  function drawBeaconSetpiece() {
    if (!state) return;
    const progress = clamp(state.distance / state.config.targetDistance, 0, 1);
    const approach = clamp((progress - 0.72) / 0.28, 0, 1);
    const t = performance.now() / 1000;
    const x = W - 96;
    const y = 122 + Math.sin(t * 1.7) * 6;
    ctx.save();
    ctx.globalAlpha = 0.28 + approach * 0.52;
    ctx.shadowColor = 'rgba(255, 207, 108, .52)';
    ctx.shadowBlur = 22 + approach * 26;
    ctx.strokeStyle = 'rgba(255, 191, 78, .70)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x, y, 28 + i * 18 + Math.sin(t * 2 + i) * 3 + approach * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255, 219, 119, ${0.72 + approach * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 10 + approach * 5, 18 + approach * 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 188, 76, ${0.12 + approach * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.lineTo(playerX - 26, state.y - 34);
    ctx.lineTo(playerX - 18, state.y + 24);
    ctx.closePath();
    ctx.fill();
    if (approach > 0.01) {
      ctx.globalAlpha = approach * 0.85;
      ctx.fillStyle = 'rgba(7, 10, 18, .55)';
      ctx.beginPath();
      ctx.roundRect(W - 304, 28, 238, 42, 12);
      ctx.fill();
      ctx.fillStyle = '#ffd86a';
      ctx.font = '900 16px Inter, sans-serif';
      ctx.fillText('BEACON LOCK', W - 286, 55);
      ctx.fillStyle = '#eef2ff';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.fillText(`${Math.round(progress * 100)}% route secured`, W - 176, 55);
    }
    ctx.restore();
  }

  function drawStatusBanner() {
    if (!state) return;
    const rankInfo = glideRoundRank();
    ctx.save();
    ctx.fillStyle = 'rgba(7, 10, 18, .54)';
    ctx.fillRect(24, 20, 330, 102);
    ctx.strokeStyle = 'rgba(255, 188, 87, .24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 20, 330, 102);

    ctx.fillStyle = '#eef2ff';
    ctx.font = '700 28px Inter, sans-serif';
    ctx.fillText(`Round ${state.round}`, 40, 52);
    ctx.font = '700 26px Inter, sans-serif';
    ctx.fillText(`${Math.round(state.distance)} / ${state.config.targetDistance} m`, 40, 88);

    const chips = [
      { label: `Worms ${state.wormsCollected}`, x: 40, y: 104, w: 96, color: '#ffd86a' },
      { label: `Rank ${rankInfo.rank}`, x: 146, y: 104, w: 82, color: '#9fe8ff' },
      { label: `Edge ${state.edgeSaves}`, x: 238, y: 104, w: 86, color: '#c8ff9a' },
    ];
    chips.forEach((chip) => {
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.beginPath();
      ctx.roundRect(chip.x, chip.y - 18, chip.w, 22, 8);
      ctx.fill();
      ctx.fillStyle = chip.color;
      ctx.font = '700 13px Inter, sans-serif';
      ctx.fillText(chip.label, chip.x + 8, chip.y - 3);
    });
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#071018');
    grad.addColorStop(0.45, '#112033');
    grad.addColorStop(1, '#241006');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    drawTunnelStripe(132, .10);
    drawTunnelStripe(H - 156, .08);
    drawBackgroundDetails();
    if (state) drawBeaconSetpiece();
    if (!state) {
      ctx.fillStyle = '#eef2ff';
      ctx.font = 'bold 54px Inter, sans-serif';
      ctx.fillText('Root Glide', 84, 160);
      ctx.font = '28px Inter, sans-serif';
      ctx.fillStyle = '#b9c2df';
      ctx.fillText('Tap, click, or press SPACE to launch Lew.', 84, 212);
      ctx.fillText('Clear rounds, claim reward boxes, and keep gliding.', 84, 248);
      return;
    }
    drawTerrainConnectors();
    state.obstacles.forEach(drawObstacle);
    state.worms.forEach(drawWorm);
    drawGlideTrail();
    drawCourier();
    drawGlideFx();
    drawStatusBanner();
    drawGlideBanner();
    if (state.over && !state.rewardPending) {
      ctx.fillStyle = 'rgba(5,6,10,.80)';
      ctx.fillRect(64, H * 0.34, W - 128, 244);
      ctx.strokeStyle = 'rgba(255, 172, 86, .34)';
      ctx.lineWidth = 2;
      ctx.strokeRect(64, H * 0.34, W - 128, 244);
      ctx.fillStyle = '#eef2ff';
      ctx.font = 'bold 46px Inter, sans-serif';
      ctx.fillText('Expedition Down', 118, H * 0.34 + 72);
      ctx.font = '24px Inter, sans-serif';
      ctx.fillStyle = '#ffd5a2';
      ctx.fillText(state.finishReason || 'The tunnel won this run.', 118, H * 0.34 + 112);
      ctx.font = '28px Inter, sans-serif';
      ctx.fillStyle = '#d6deff';
      ctx.fillText(`Reached Round ${Math.max(1, state.round)} • ${Math.round(state.totalDistance + state.distance)} m total`, 118, H * 0.34 + 152);
      ctx.fillText(`Worms ${state.totalWorms + state.wormsCollected} • Checkpoints ${state.totalCheckpoints + state.checkpoints} • Bank ${state.totalPayout.toFixed(2)} WinLEW`, 118, H * 0.34 + 188);
      ctx.fillText('Tap, click, or press SPACE to restart the expedition.', 118, H * 0.34 + 222);
    }
  }

  function renderAll() {
    const live = state ? state : null;
    const score = live ? Math.round(live.sessionScore + live.score) : meta.bestScore;
    const distance = live ? Math.round(live.totalDistance + live.distance) : meta.bestDistance;
    const checkpoints = live ? live.totalCheckpoints + live.checkpoints : 0;
    const currentRound = live ? live.round : Math.max(1, meta.bestRound || 1);
    const worms = live ? live.totalWorms + live.wormsCollected : 0;
    const stats = [
      ['Best Score', meta.bestScore || 0],
      ['Best Distance', `${meta.bestDistance || 0} m`],
      ['Best Round', `R${meta.bestRound || 0}`],
      ['Run Score', score],
      ['Hearts', live ? `${Math.max(0, live.hearts)}/${live.maxHearts}` : '—'],
      ['Distance', `${distance} m`],
      ['Round', `R${currentRound}`],
      ['Checkpoints', checkpoints],
      ['Worms', worms],
      ['Reward Bank', `${live ? live.totalPayout.toFixed(2) : '0.00'} WinLEW`],
      ['Stored WinLEW', loadWallet().toFixed(2)]
    ];
    statsEl.innerHTML = stats.map(([k,v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
    progressEl.textContent = live ? `Round ${live.round}: ${Math.round(live.distance)} / ${live.config.targetDistance} m • Worms ${live.totalWorms + live.wormsCollected}` : 'Round 1 ready';
    milestoneEl.textContent = `Milestone: ${milestoneName(distance, currentRound)}`;
    modeEl.textContent = !live ? 'Ready' : live.rewardPending ? 'Reward Ready' : live.over ? 'Down' : live.paused ? 'Paused' : 'Running';
    const startLabel = !live ? 'Start Expedition' : live.rewardPending ? 'Reward Ready' : live.over ? 'Restart Expedition' : live.paused ? 'Resume' : 'Running';
    [ $('glideStartBtn'), $('glideStartTop') ].forEach((btn) => { if (btn) btn.textContent = startLabel; });
    renderBoardList(boardEl, board, 'glide');
    if (!logs.length) addLog('Touch-first root glide ready.');
    views.rootglide.classList.toggle('hub-active-run', Boolean(live && !live.over));
  }

  function inputHop(e) {
    if (views.rootglide.classList.contains('hidden')) return;
    if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    flap();
  }

  canvas.addEventListener('pointerdown', inputHop);
  window.addEventListener('keydown', (e) => {
    if (views.rootglide.classList.contains('hidden')) return;
    if (rewardOverlay && !rewardOverlay.classList.contains('hidden') && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      inputHop(e);
    }
    if (e.key.toLowerCase() === 'p' && state && !state.rewardPending) {
      state.paused = !state.paused;
      renderAll();
    }
  }, true);

  function startOrResume() {
    if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
    if (!state) start(nextUnlockedRound());
    else if (state.rewardPending) return;
    else if (state.over) start(nextUnlockedRound());
    else {
      state.paused = false;
      modeEl.textContent = 'Running';
      renderAll();
    }
    // Bring the canvas into view, not the top of the whole site — scrolling
    // to page-top here (as this used to) jumps away from the game itself
    // whenever Start/Resume is tapped mid-session, not just on first launch.
    canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function continueRoundAfterReward() {
    continueToNextRound();
    renderAll();
  }


  $('glideStartBtn').onclick = startOrResume;
  $('glideResetBtn').onclick = reset;
  $('glideStartTop').onclick = startOrResume;
  $('glideResetTop').onclick = reset;
  $('glideHomeTop').onclick = () => { hideRewardOverlay(); showView('hub'); renderHubBoards(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  renderAll();
  draw();
  return { startOrResume, reset, renderAll, draw };
      })();
    }
  };
})();
