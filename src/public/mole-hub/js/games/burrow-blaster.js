// WinLEW Gaming Hub v39 modular game chunk: blaster
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.blaster = function create_blaster(deps) {
    // Conservative legacy wrapper: gameplay code is unchanged and resolves shared hub helpers
    // through the provided dependency bag. This keeps v39 behavior stable while splitting files.
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
  const canvas = $('blasterCanvas');
  const ctx = canvas.getContext('2d');
  const statsEl = $('blasterStats');
  const boardEl = $('blasterBoard');
  const banner = $('blasterBanner');
  const sub = $('blasterSub');
  const modeEl = $('blasterMode');
  const hintEl = $('blasterHint');
  const progressEl = $('blasterProgress');
  const milestoneEl = $('blasterMilestone');
  const logEl = $('blasterLog');
  let board = load(Storage.blasterBoard, []);
  let meta = load(Storage.blasterState, { bestScore: 0, bestWave: 1, bestRound: 0, plays: 0 });
  if (typeof meta.bestRound !== 'number') meta.bestRound = 0;
  // Same fix as Root Glide's nextUnlockedRound (see root-glide.js for the
  // full rationale): meta.bestRound was tracked as a stat but never used to
  // resume, so any death sent the player back to Round 1 with no persistent
  // progress. Matches Pac-Mole's saveState.unlocked pattern.
  function nextUnlockedRound() { return Math.max(1, (meta.bestRound || 0) + 1); }
  let logs = ["Lew's drill-ship on standby."];
  let state = null;
  let raf = 0;
  let last = 0;
  const W = canvas.width;
  const H = canvas.height;
  const keys = new Set();
  const pointer = { active: false, x: W / 2, y: H - 170 };

  function addLog(msg) {
    logs.unshift(msg);
    logs = logs.slice(0, 8);
    logEl.innerHTML = logs.map((m) => `<div class="log-entry">${m}</div>`).join('');
  }

  function getRoundConfig(round) {
    const r = Math.max(1, round || 1);
    const endlessTier = Math.max(0, r - 3);
    const onboarding = r === 1;
    return {
      round: r,
      endlessTier,
      maxWave: 6,
      playerSpeed: Math.min(630 + (r - 1) * 14, 735),
      baseQuota: onboarding ? 6 : 7 + Math.min(r - 1, 5),
      spawnBase: onboarding ? 0.88 : Math.max(0.78 - (r - 1) * 0.03, 0.52),
      enemySpeedBonus: onboarding ? 0 : (r - 1) * 14,
      hazardBase: onboarding ? 3.05 : Math.max(2.45 - (r - 1) * 0.07, 1.35),
      maxActiveWarnings: onboarding ? 1 : Math.min(2 + Math.floor((r - 1) / 3), 4),
      maxActiveHazards: onboarding ? 2 : Math.min(3 + Math.floor((r - 1) / 3), 5),
      maxActiveThreats: onboarding ? 2 : Math.min(4 + Math.floor((r - 1) / 2), 6),
      riskShardChance: Math.min(0.28 + endlessTier * 0.035, 0.48),
      mercyHazardDelay: 0.55,
      bossHp: 20 + r * 5,
      baseReward: 35 + r * 15,
      waveClearBonus: 130 + r * 35,
    };
  }

  function makeState(round = 1, carry = {}) {
    const config = getRoundConfig(round);
    return {
      config,
      round: config.round,
      player: { x: W / 2, y: H - 170, r: 30, speed: config.playerSpeed, vx: 0, vy: 0, tilt: 0 },
      bullets: [],
      enemies: [],
      shards: [],
      powerups: [],
      hazards: [],
      warnings: [],
      floaters: [],
      particles: [],
      muzzleFlashes: [],
      shockwaves: [],
      exhaustTrail: [],
      arcadeBanner: null,
      score: 0,
      lives: 5,
      kills: 0,
      shardsRecovered: 0,
      fireTimer: 0,
      exhaustTimer: 0,
      spawnTimer: 0,
      spawned: 0,
      wave: 1,
      waveTheme: 'Raider Warmup',
      waveQuota: config.baseQuota + 2,
      carriersDown: 0,
      chargersDodged: 0,
      specialTimer: 0,
      specialCooldown: 0,
      shieldTimer: 0,
      shieldCharges: 0,
      weaponMode: 'default',
      weaponTimer: 0,
      hazardTimer: 0,
      bossWave: false,
      bossSpawned: false,
      bossIntroTimer: 0,
      bossDefeated: 0,
      bossVariant: null,
      bossName: '',
      bossPhase: 1,
      bossPhaseBanner: '',
      bossDefeatTimer: 0,
      bossRewardsDropped: false,
      shake: 0,
      flash: 0,
      combo: 0,
      bestCombo: 0,
      damageTaken: 0,
      nearMisses: 0,
      riskPickups: 0,
      hazardsDodged: 0,
      safetyDeferrals: 0,
      hurtTimer: 0,
      rewardPending: false,
      paused: false,
      over: false,
      totalScore: Number(carry.totalScore || 0),
      totalKills: Number(carry.totalKills || 0),
      totalShards: Number(carry.totalShards || 0),
      totalPayout: Number(carry.totalPayout || 0),
      roundsCleared: Number(carry.roundsCleared || 0),
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
      save(Storage.blasterState, meta);
    }
    state = makeState(round, carry);
    pointer.x = state.player.x;
    pointer.y = state.player.y;
    logs = [];
    addLog(`Round ${state.round} launched. Keep the drill moving across the whole tunnel.`);
    banner.textContent = `Stolen Stash Recovery — Round ${state.round}`;
    sub.textContent = "Pilot Lew's drill-ship, break through raiders, dodge cave hazards, and grab special drops.";
    hintEl.textContent = 'Payload D: premium arcade feel active. Sparks, muzzle flashes, banners, richer HUD, and reward feedback are online.';
    modeEl.textContent = 'Running';
    last = 0;
    loop(performance.now());
    renderAll();
  }

  function reset() {
    hideRewardOverlay();
    board = [];
    meta = { bestScore: 0, bestWave: 1, bestRound: 0, plays: 0 };
    save(Storage.blasterBoard, board);
    save(Storage.blasterState, meta);
    state = null;
    logs = ['Burrow Blaster reset.'];
    renderHubBoards();
    renderAll();
    draw();
  }

  function getWaveTheme(wave = state?.wave || 1) {
    const themes = {
      1: 'Raider Warmup',
      2: 'Scout Rush',
      3: 'Armor Push',
      4: 'Splitter Nest',
      5: 'Carrier Raid',
      6: state && state.bossWave ? 'Guardian Chamber' : 'Elite Swarm',
    };
    return themes[wave] || 'Deep Swarm';
  }

  function weightedChoice(table) {
    const total = table.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of table) {
      roll -= item.weight;
      if (roll <= 0) return item.type;
    }
    return table[table.length - 1].type;
  }

  function getWaveMix(wave = state.wave) {
    const round = state.round || 1;
    if (wave <= 1) {
      return [
        { type: 'raider', weight: 72 },
        { type: round >= 2 ? 'scout' : 'raider', weight: 18 },
        { type: round >= 3 ? 'carrier' : 'raider', weight: 10 },
      ];
    }
    if (wave === 2) return [{ type: 'scout', weight: 48 }, { type: 'raider', weight: 28 }, { type: 'armored', weight: 16 }, { type: 'carrier', weight: 8 }];
    if (wave === 3) return [{ type: 'armored', weight: 36 }, { type: 'raider', weight: 25 }, { type: 'scout', weight: 18 }, { type: 'tank', weight: 12 }, { type: 'carrier', weight: 9 }];
    if (wave === 4) return [{ type: 'splitter', weight: 30 }, { type: 'charger', weight: 24 }, { type: 'scout', weight: 18 }, { type: 'armored', weight: 18 }, { type: 'carrier', weight: 10 }];
    if (wave === 5) return [{ type: 'carrier', weight: 22 }, { type: 'charger', weight: 22 }, { type: 'tank', weight: 18 }, { type: 'splitter', weight: 18 }, { type: 'scout', weight: 12 }, { type: 'armored', weight: 8 }];
    return [{ type: 'tank', weight: 24 }, { type: 'charger', weight: 22 }, { type: 'splitter', weight: 20 }, { type: 'carrier', weight: 16 }, { type: 'scout', weight: 10 }, { type: 'armored', weight: 8 }];
  }

  function chooseEnemyType() {
    return weightedChoice(getWaveMix(state.wave));
  }

  function enemyStats(type) {
    const bonus = state.config.enemySpeedBonus;
    const stats = {
      raider: { r: 22, hp: 1, vy: 116 + state.wave * 14 + bonus, score: 35, color: '#8cff5c', vx: 38, seek: 0.16 },
      armored: { r: 26, hp: 3, vy: 92 + state.wave * 11 + bonus, score: 85, color: '#78d8ff', vx: 28, seek: 0.08 },
      scout: { r: 19, hp: 1, vy: 138 + state.wave * 17 + bonus, score: 55, color: '#d1ff5c', vx: 84, seek: 0.26 },
      splitter: { r: 24, hp: 2, vy: 106 + state.wave * 12 + bonus, score: 70, color: '#ffb15c', vx: 54, seek: 0.12 },
      tank: { r: 32, hp: 5, vy: 82 + state.wave * 10 + bonus, score: 160, color: '#ff7676', vx: 22, seek: 0.06 },
      charger: { r: 24, hp: 2, vy: 74 + state.wave * 8 + bonus, score: 115, color: '#ff6b3d', vx: 36, seek: 0.12, charge: true },
      carrier: { r: 28, hp: 3, vy: 72 + state.wave * 7 + bonus, score: 135, color: '#cda6ff', vx: 62, seek: 0.04, carrier: true },
      mini: { r: 15, hp: 1, vy: 156 + state.wave * 14 + bonus, score: 20, color: '#ffd15c', vx: 96, seek: 0.22 },
      boss: { r: 58, hp: state.config.bossHp, vy: 38, score: 650, color: '#ffb347', vx: 75, seek: 0.18, boss: true },
    };
    return stats[type] || stats.raider;
  }

  function spawnEnemy(type = chooseEnemyType(), xOverride = null, yOverride = -45, vxOverride = null) {
    const stats = enemyStats(type);
    const laneCount = 7;
    const lane = rand(laneCount);
    const x = xOverride ?? (70 + lane * ((W - 140) / (laneCount - 1)) + rand(34) - 17);
    const drift = vxOverride ?? ((Math.random() - 0.5) * stats.vx);
    state.enemies.push({
      type,
      x: clamp(x, 48, W - 48),
      y: yOverride,
      r: stats.r,
      hp: stats.hp,
      maxHp: stats.hp,
      vx: drift,
      vy: stats.vy + rand(34),
      score: stats.score,
      color: stats.color,
      seek: stats.seek || 0,
      boss: !!stats.boss,
      carrier: !!stats.carrier,
      charge: !!stats.charge,
      chargeState: stats.charge ? 'windup' : 'idle',
      chargeTimer: stats.charge ? 0.78 : 0,
      chargeVx: 0,
      chargeVy: 0,
      cooldown: 0.9,
      phase: Math.random() * Math.PI * 2,
      dead: false,
    });
    if (yOverride < -20) state.spawned += 1;
  }

  function spawnEnemyFormation() {
    const centerX = clamp(84 + rand(W - 168), 84, W - 84);
    const theme = getWaveTheme(state.wave);
    const roll = Math.random();

    if (theme === 'Scout Rush') {
      spawnEnemy('scout', centerX, -46, 30);
      spawnEnemy('scout', centerX - 82, -92, 65);
      spawnEnemy('scout', centerX + 82, -92, -65);
      return;
    }
    if (theme === 'Armor Push') {
      spawnEnemy('armored', centerX, -48, 0);
      spawnEnemy('raider', centerX - 78, -86, 16);
      spawnEnemy('raider', centerX + 78, -86, -16);
      if (Math.random() < 0.35) spawnEnemy('tank', centerX + (Math.random() < 0.5 ? -118 : 118), -128, 0);
      return;
    }
    if (theme === 'Splitter Nest') {
      spawnEnemy('splitter', centerX, -54, 0);
      spawnEnemy('charger', centerX + (Math.random() < 0.5 ? -105 : 105), -110, 0);
      if (Math.random() < 0.45) spawnEnemy('scout', centerX + (Math.random() < 0.5 ? 74 : -74), -150, 40);
      return;
    }
    if (theme === 'Carrier Raid') {
      spawnEnemy('carrier', centerX, -60, 0);
      spawnEnemy(Math.random() < 0.5 ? 'scout' : 'raider', centerX - 82, -102, 35);
      spawnEnemy(Math.random() < 0.5 ? 'scout' : 'raider', centerX + 82, -102, -35);
      if (roll > 0.62) spawnEnemy('charger', centerX, -160, 0);
      return;
    }
    if (theme === 'Elite Swarm') {
      spawnEnemy(Math.random() < 0.5 ? 'tank' : 'charger', centerX, -58, 0);
      spawnEnemy('splitter', centerX - 96, -112, 20);
      spawnEnemy('carrier', centerX + 96, -112, -20);
      return;
    }
    if (roll < 0.34) {
      spawnEnemy('raider', centerX, -46, 0);
      spawnEnemy(state.wave >= 2 ? 'scout' : 'raider', centerX - 80, -86, 20);
      spawnEnemy(state.wave >= 2 ? 'scout' : 'raider', centerX + 80, -86, -20);
      return;
    }
    if (roll < 0.68) {
      ['armored', 'raider', 'armored'].forEach((type, idx) => spawnEnemy(type, centerX + (idx - 1) * 70, -48 - idx * 12, (idx - 1) * 12));
      return;
    }
    spawnEnemy('carrier', centerX, -55, 0);
    spawnEnemy(state.wave >= 4 ? 'charger' : 'armored', centerX + (Math.random() < 0.5 ? -96 : 96), -100, 0);
  }


  function getWaveQuota(wave = state.wave) {
    const roundRamp = Math.min(Math.max(0, state.round - 1), 8);
    const endlessRamp = Math.max(0, state.round - 3);
    return state.config.baseQuota + wave * 2 + Math.floor(roundRamp * 0.75) + Math.min(endlessRamp, 6) + (wave >= 5 ? 2 : 0);
  }

  function activeThreatCount() {
    return state.warnings.length + state.hazards.length;
  }

  function warningLaneKey(w) {
    if (w.kind === 'rock') return `rock:${Math.round(w.x / 120)}:${Math.round(w.y / 120)}`;
    if (w.kind === 'beam') return w.orientation === 'vertical' ? `vbeam:${Math.round(w.x / 100)}` : `hbeam:${Math.round(w.y / 80)}`;
    return `root:${Math.round(w.y / 80)}`;
  }

  function buildWarningCandidate(kind = null) {
    const rolledKind = kind || (Math.random() < 0.58 ? 'rock' : Math.random() < 0.56 ? 'beam' : 'root');
    if (rolledKind === 'rock') {
      return {
        kind: 'rock',
        x: clamp(60 + rand(W - 120), 48, W - 48),
        y: 88 + rand(H - 230),
        r: 24 + rand(10),
        timer: 0.68,
        maxTimer: 0.68,
      };
    }
    if (rolledKind === 'beam') {
      const horizontal = Math.random() < 0.62;
      if (horizontal) {
        const fromLeft = Math.random() < 0.5;
        return {
          kind: 'beam',
          orientation: 'horizontal',
          side: fromLeft ? 'left' : 'right',
          x: fromLeft ? 0 : W,
          y: 110 + rand(H - 240),
          width: 130 + rand(90),
          height: 14,
          timer: 0.82,
          maxTimer: 0.82,
        };
      }
      return {
        kind: 'beam',
        orientation: 'vertical',
        x: 70 + rand(W - 140),
        y: 0,
        width: 14,
        height: 120 + rand(100),
        timer: 0.82,
        maxTimer: 0.82,
      };
    }
    const side = Math.random() < 0.5 ? 'left' : 'right';
    return {
      kind: 'root',
      side,
      x: side === 'left' ? 0 : W,
      y: 120 + rand(H - 260),
      width: 160,
      height: 24,
      timer: 0.74,
      maxTimer: 0.74,
    };
  }

  function isWarningTooCloseToPlayer(w, margin = 0) {
    if (!state?.player) return false;
    const px = state.player.x;
    const py = state.player.y;
    if (w.kind === 'rock') return Math.hypot(w.x - px, w.y - py) < 132 + margin;
    if (w.kind === 'beam') {
      if (w.orientation === 'vertical') return Math.abs(w.x - px) < 78 + margin && py < w.height + 120;
      return Math.abs(w.y - py) < 70 + margin;
    }
    return Math.abs(w.y - py) < 70 + margin;
  }

  function warningConflictsWithExisting(w) {
    const key = warningLaneKey(w);
    for (const other of state.warnings) {
      if (warningLaneKey(other) === key) return true;
      if ((w.kind === 'beam' || w.kind === 'root') && (other.kind === 'beam' || other.kind === 'root') && Math.abs((w.y || 0) - (other.y || 0)) < 68) return true;
      if (w.kind === 'rock' && other.kind === 'rock' && Math.hypot(w.x - other.x, w.y - other.y) < 120) return true;
    }
    for (const hazard of state.hazards) {
      if ((w.kind === 'beam' || w.kind === 'root') && (hazard.kind === 'beam' || hazard.kind === 'root') && Math.abs((w.y || 0) - (hazard.y || 0)) < 64) return true;
      if (w.kind === 'rock' && hazard.kind === 'rock' && Math.hypot(w.x - hazard.x, w.y - hazard.y) < 120) return true;
    }
    return false;
  }

  function canSpawnWarningCandidate(w) {
    if (state.warnings.length >= state.config.maxActiveWarnings) return false;
    if (state.hazards.length >= state.config.maxActiveHazards) return false;
    if (activeThreatCount() >= state.config.maxActiveThreats) return false;
    if (isWarningTooCloseToPlayer(w)) return false;
    if (warningConflictsWithExisting(w)) return false;
    return true;
  }

  function maybeSpawnRiskPickup(w) {
    if (!w || Math.random() > state.config.riskShardChance) return;
    if (state.lastRiskPickup && performance.now() - state.lastRiskPickup < 900) return;
    let x = W / 2;
    let y = H / 2;
    if (w.kind === 'rock') {
      x = clamp(w.x + (Math.random() < 0.5 ? -64 : 64), 48, W - 48);
      y = clamp(w.y + (Math.random() < 0.5 ? -52 : 52), 90, H - 80);
    } else if (w.kind === 'beam') {
      if (w.orientation === 'vertical') {
        x = clamp(w.x + (Math.random() < 0.5 ? -58 : 58), 48, W - 48);
        y = clamp(120 + rand(H - 250), 95, H - 88);
      } else {
        x = w.side === 'left' ? clamp(w.width + 54, 70, W - 70) : clamp(W - w.width - 54, 70, W - 70);
        y = clamp(w.y + (Math.random() < 0.5 ? -58 : 58), 95, H - 88);
      }
    } else {
      x = w.side === 'left' ? 188 : W - 188;
      y = clamp(w.y + (Math.random() < 0.5 ? -58 : 58), 95, H - 88);
    }
    if (Math.hypot(x - state.player.x, y - state.player.y) < 90) return;
    state.shards.push({ x, y, vx: 0, vy: 42, life: 5.8, r: 12, value: 55, risk: true });
    state.riskPickups += 1;
    state.lastRiskPickup = performance.now();
    floatText(x - 24, y - 18, 'RISK +55', '#ffcf6e');
  }

  function spawnWarning(kind = null) {
    const lowLifeMercy = state.lives <= 2;
    const attempts = lowLifeMercy ? 10 : 8;
    if (lowLifeMercy && Math.random() < 0.32) {
      state.safetyDeferrals += 1;
      return false;
    }
    for (let i = 0; i < attempts; i++) {
      const candidate = buildWarningCandidate(kind);
      if (canSpawnWarningCandidate(candidate)) {
        candidate.safeLane = warningLaneKey(candidate);
        state.warnings.push(candidate);
        maybeSpawnRiskPickup(candidate);
        return true;
      }
    }
    state.safetyDeferrals += 1;
    return false;
  }

  function spawnHazard(kind = null, warning = null) {
    const rolledKind = kind || (Math.random() < 0.64 ? 'rock' : Math.random() < 0.55 ? 'beam' : 'root');
    if (rolledKind === 'rock') {
      state.hazards.push({
        kind: 'rock',
        x: warning?.x ?? clamp(60 + rand(W - 120), 48, W - 48),
        y: warning ? warning.y - 180 : -35,
        targetY: warning?.y ?? null,
        r: warning?.r ?? (16 + rand(12)),
        vy: warning ? 280 + state.wave * 18 : 220 + state.wave * 22 + rand(35),
        vx: warning ? (Math.random() - 0.5) * 40 : (Math.random() - 0.5) * 90,
        spin: (Math.random() - 0.5) * 5,
        angle: Math.random() * Math.PI * 2,
        life: 6,
      });
      return;
    }
    if (rolledKind === 'beam') {
      const orientation = warning?.orientation || (Math.random() < 0.62 ? 'horizontal' : 'vertical');
      if (orientation === 'horizontal') {
        const side = warning?.side || (Math.random() < 0.5 ? 'left' : 'right');
        const width = warning?.width ?? (130 + rand(90));
        state.hazards.push({
          kind: 'beam',
          orientation,
          side,
          x: side === 'left' ? -width : W,
          y: warning?.y ?? (100 + rand(H - 220)),
          width,
          height: warning?.height ?? 12,
          vx: side === 'left' ? 260 + state.wave * 12 : -(260 + state.wave * 12),
          vy: 0,
          pulse: Math.random() * Math.PI * 2,
          life: 2.8,
        });
      } else {
        const height = warning?.height ?? (120 + rand(100));
        state.hazards.push({
          kind: 'beam',
          orientation,
          x: warning?.x ?? (70 + rand(W - 140)),
          y: -height,
          width: warning?.width ?? 14,
          height,
          vx: 0,
          vy: 240 + state.wave * 16,
          pulse: Math.random() * Math.PI * 2,
          life: 2.8,
        });
      }
      return;
    }
    const side = warning?.side ?? (Math.random() < 0.5 ? 'left' : 'right');
    state.hazards.push({
      kind: 'root',
      side,
      x: side === 'left' ? -10 : W + 10,
      y: warning?.y ?? (120 + rand(H - 260)),
      width: warning?.width ?? 160,
      height: warning?.height ?? 24,
      vx: side === 'left' ? 180 : -180,
      retractAt: 0.8,
      life: 1.65,
      pulse: Math.random() * Math.PI * 2,
    });
  }


  function getBossProfile(round = 1) {
    const profiles = [
      { id: 'shardjaw', name: 'Shardjaw Beetle', title: 'SHARDJAW BEETLE', subtitle: 'Armored stash crusher • rock pressure', color: '#ffb347', body: '#c76b1b', shell: '#7a3810', hpBonus: 0, score: 760, preferredDrop: 'spread' },
      { id: 'ironback', name: 'Ironback Burrow King', title: 'IRONBACK BURROW KING', subtitle: 'Tunnel tyrant • side-root pressure', color: '#a4e66f', body: '#6f8f2f', shell: '#33471d', hpBonus: 8, score: 860, preferredDrop: 'shield' },
      { id: 'drilleater', name: 'The Drill Eater', title: 'THE DRILL EATER', subtitle: 'Shock-core predator • beam pressure', color: '#ff9df7', body: '#8c4fb0', shell: '#3b1d55', hpBonus: 4, score: 900, preferredDrop: 'laser' },
    ];
    return profiles[(Math.max(1, round) - 1) % profiles.length];
  }

  function markBossPhase(boss) {
    const hpRatio = boss.maxHp ? boss.hp / boss.maxHp : 1;
    const nextPhase = hpRatio <= 0.28 ? 3 : hpRatio <= 0.62 ? 2 : 1;
    if (nextPhase !== boss.phase) {
      boss.phase = nextPhase;
      state.bossPhase = nextPhase;
      const phaseText = nextPhase === 2 ? 'ARMOR CRACKED' : 'RAGE TUNNEL';
      const subtitle = nextPhase === 2 ? `${boss.name} changes attack pattern.` : `${boss.name} is going all-in.`;
      showArcadeBanner(phaseText, subtitle, boss.color || '#ffb347', 1.1);
      floatText(boss.x, boss.y - boss.r - 34, phaseText, boss.color || '#ffb347');
      state.flash = Math.max(state.flash, 0.16);
      state.shake = Math.max(state.shake, nextPhase === 3 ? 10 : 6);
      addLog(`${boss.name} entered Phase ${nextPhase}.`);
      Sound.win();
    }
  }

  function bossAttack(boss) {
    const phase = boss.phase || 1;
    const profile = boss.profile || getBossProfile(state.round);
    const supportLimit = phase >= 3 ? 5 : phase >= 2 ? 4 : 3;
    const supportCount = state.enemies.filter((e) => !e.boss).length;
    if (profile.id === 'shardjaw') {
      spawnWarning('rock');
      if (phase >= 2) setTimeout(() => state && state.bossWave && spawnWarning('rock'), 120);
      if (phase >= 3) spawnWarning(Math.random() < 0.5 ? 'beam' : 'rock');
      if (supportCount < supportLimit) spawnEnemy(phase >= 3 ? 'charger' : 'raider', boss.x + (Math.random() < 0.5 ? -56 : 56), boss.y + 34, (Math.random() - 0.5) * 70);
    } else if (profile.id === 'ironback') {
      spawnWarning('root');
      if (phase >= 2) spawnWarning(Math.random() < 0.5 ? 'root' : 'rock');
      if (phase >= 3) spawnWarning('beam');
      if (supportCount < supportLimit) spawnEnemy(phase >= 2 ? 'tank' : 'armored', boss.x + (Math.random() < 0.5 ? -70 : 70), boss.y + 34, (Math.random() - 0.5) * 42);
    } else {
      spawnWarning('beam');
      if (phase >= 2) spawnWarning(Math.random() < 0.55 ? 'beam' : 'rock');
      if (phase >= 3) spawnWarning(Math.random() < 0.5 ? 'beam' : 'root');
      if (supportCount < supportLimit) spawnEnemy(phase >= 2 ? 'scout' : 'raider', boss.x + (Math.random() < 0.5 ? -62 : 62), boss.y + 34, (Math.random() - 0.5) * 90);
    }
    state.flash = Math.max(state.flash, 0.08);
  }

  function dropBossRewards(boss) {
    if (state.bossRewardsDropped) return;
    state.bossRewardsDropped = true;
    const preferred = boss?.profile?.preferredDrop || 'laser';
    const centerX = boss?.x || W / 2;
    const centerY = boss?.y || 150;
    [-54, -18, 18, 54].forEach((offset, idx) => {
      state.shards.push({ x: clamp(centerX + offset, 40, W - 40), y: centerY + 18 + idx * 8, vx: offset * 0.75, vy: 115 + idx * 8, life: 6.5, r: idx % 2 ? 11 : 10, risk: idx >= 2 });
    });
    state.powerups.push({ x: clamp(centerX, 45, W - 45), y: centerY + 30, vx: 0, vy: 115, life: 7.5, r: 16, kind: preferred });
  }

  function spawnBoss() {
    if (state.bossSpawned) return;
    const profile = getBossProfile(state.round);
    state.bossSpawned = true;
    state.bossVariant = profile.id;
    state.bossName = profile.name;
    state.bossPhase = 1;
    state.bossPhaseBanner = profile.title;
    state.bossRewardsDropped = false;
    spawnEnemy('boss', W / 2, 120, 90);
    const boss = state.enemies.find((e) => e.boss && !e.profile);
    if (boss) {
      boss.profile = profile;
      boss.variant = profile.id;
      boss.name = profile.name;
      boss.phase = 1;
      boss.hp += profile.hpBonus || 0;
      boss.maxHp = boss.hp;
      boss.score = profile.score || boss.score;
      boss.color = profile.color || boss.color;
      boss.bodyColor = profile.body;
      boss.shellColor = profile.shell;
      boss.cooldown = 1.45;
      boss.attackIndex = 0;
    }
    addLog(`${profile.name} entered the chamber. Watch the phase changes.`);
    showArcadeBanner(profile.title, profile.subtitle, profile.color, 1.75);
    floatText(W / 2, 180, profile.title, profile.color);
    state.flash = 0.26;
    state.shake = Math.max(state.shake, 12);
    Sound.win();
  }

  function fire() {
    const p = state.player;
    const powered = state.specialTimer > 0;
    const mode = powered ? state.weaponMode : 'default';
    if (mode === 'spread') {
      [-210, -105, 0, 105, 210].forEach((vx, idx) => {
        state.bullets.push({ x: p.x + (idx - 2) * 6, y: p.y - 42, vx, vy: -720, r: 5, pierce: 1, powered: true, style: 'spread' });
      });
      muzzleFlash('spread');
      Sound.blip(620, 0.04, 'sawtooth', 0.025);
      return;
    }
    if (mode === 'laser') {
      state.bullets.push({ x: p.x, y: p.y - 48, vx: 0, vy: -880, r: 8, pierce: 4, powered: true, style: 'laser' });
      state.particles.push({ x: p.x, y: p.y - 48, vx: 0, vy: -80, life: 0.12, color: '#ffb5ff', laserFlash: true, size: 7 });
      muzzleFlash('laser');
      Sound.blip(710, 0.04, 'triangle', 0.03);
      return;
    }
    state.bullets.push({ x: p.x - 9, y: p.y - 40, vx: -20, vy: -670, r: 5, pierce: 0, powered: false, style: 'default' });
    state.bullets.push({ x: p.x + 9, y: p.y - 40, vx: 20, vy: -670, r: 5, pierce: 0, powered: false, style: 'default' });
    muzzleFlash('default');
    Sound.blip(460, 0.04, 'square', 0.026);
  }

  function burst(x, y, color = '#fbbf24', count = 7, speed = 240) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.75);
      state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.38 + Math.random() * 0.28, color, size: 3 + Math.random() * 3 });
    }
  }

  function sparkBurst(x, y, color = '#ffd86a', count = 12) {
    burst(x, y, color, count, 320);
    state.shockwaves.push({ x, y, r: 8, maxR: 42 + count * 1.4, life: 0.34, color });
  }

  function enemyDeathBurst(enemy) {
    const color = enemy.boss ? '#ffb347' : enemy.type === 'charger' ? '#ff6b45' : enemy.type === 'carrier' ? '#cda6ff' : enemy.type === 'tank' ? '#86dfff' : '#ffd86a';
    sparkBurst(enemy.x, enemy.y, color, enemy.boss ? 30 : enemy.type === 'tank' ? 20 : 14);
    state.shockwaves.push({ x: enemy.x, y: enemy.y, r: enemy.r * 0.35, maxR: enemy.boss ? 120 : enemy.r * 2.3, life: enemy.boss ? 0.55 : 0.35, color });
  }

  function pickupBurst(x, y, kind = 'shard') {
    const color = kind === 'shield' ? '#92f7ff' : kind === 'laser' ? '#ff9df7' : kind === 'burst' ? '#ffb35c' : kind === 'risk' ? '#ffcf6e' : '#fbbf24';
    sparkBurst(x, y, color, kind === 'shard' ? 8 : 16);
  }

  function shieldAbsorbFx(x, y) {
    state.shockwaves.push({ x, y, r: 18, maxR: 92, life: 0.42, color: '#92f7ff' });
    burst(x, y, '#92f7ff', 24, 300);
  }

  function muzzleFlash(mode = 'default') {
    if (!state) return;
    const p = state.player;
    const color = mode === 'laser' ? '#ff9df7' : mode === 'spread' ? '#86f6ff' : '#47c7ff';
    state.muzzleFlashes.push({ x: p.x, y: p.y - 52, life: 0.11, maxLife: 0.11, color, mode });
  }

  function showArcadeBanner(title, subtitle = '', color = '#ffd86a', duration = 1.15) {
    if (!state) return;
    state.arcadeBanner = { title, subtitle, color, life: duration, maxLife: duration };
  }

  function floatText(x, y, text, color = '#eef2ff') {
    if (!state) return;
    state.floaters.push({ x, y, text, color, life: 1.05, vy: -38, alpha: 1 });
  }

  function addScore(points, x, y, label = null, color = '#ffd86a') {
    state.score += points;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    if (label) floatText(x, y, label, color);
  }

  function getRoundRank() {
    if (!state) return { rank: 'C', bonus: 0 };
    const performance = state.kills * 9 + state.shardsRecovered * 8 + state.nearMisses * 6 + state.bestCombo * 3 + state.bossDefeated * 90 - state.damageTaken * 38;
    if (performance >= 620) return { rank: 'S+', bonus: 0.30 };
    if (performance >= 460) return { rank: 'S', bonus: 0.22 };
    if (performance >= 330) return { rank: 'A', bonus: 0.15 };
    if (performance >= 210) return { rank: 'B', bonus: 0.08 };
    return { rank: 'C', bonus: 0 };
  }

  function damagePlayer(amount, message, x, y, color = '#ff7676', shake = 6) {
    if (!state || state.hurtTimer > 0) return false;
    if (state.shieldTimer > 0 || state.shieldCharges > 0) {
      state.shieldCharges = Math.max(0, state.shieldCharges - 1);
      if (state.shieldCharges <= 0) state.shieldTimer = Math.min(state.shieldTimer, 1.2);
      state.hurtTimer = 0.45;
      state.shake = Math.max(state.shake, shake * 0.45);
      shieldAbsorbFx(x ?? state.player.x, y ?? state.player.y);
      floatText(state.player.x, state.player.y - 34, 'SHIELD ABSORB', '#92f7ff');
      addLog('Shield core absorbed the hit.');
      Sound.power();
      return false;
    }
    state.lives -= amount;
    state.damageTaken += amount;
    state.combo = 0;
    state.hurtTimer = 0.75;
    state.shake = Math.max(state.shake, shake);
    burst(x ?? state.player.x, y ?? state.player.y, color, 14);
    if (message) addLog(message);
    Sound.hurt();
    return true;
  }

  function maybeDrop(enemy) {
    const shardChance = enemy.type === 'boss' ? 1 : enemy.type === 'carrier' ? 1 : enemy.type === 'tank' ? 0.78 : enemy.type === 'armored' ? 0.52 : enemy.type === 'charger' ? 0.46 : 0.34;
    if (Math.random() < shardChance) {
      const shardCount = enemy.type === 'carrier' ? 3 : enemy.type === 'boss' ? 4 : 1;
      for (let i = 0; i < shardCount; i++) state.shards.push({ x: enemy.x + (i - 1) * 12, y: enemy.y + rand(16) - 8, vx: (Math.random() - 0.5) * 110, vy: 105 + rand(30), life: 5.5, r: 10 });
    }
    const powerChance = enemy.type === 'carrier' ? 0.95 : enemy.type === 'boss' ? 1 : enemy.type === 'tank' ? 0.72 : enemy.type === 'splitter' ? 0.34 : enemy.type === 'charger' ? 0.3 : enemy.type === 'armored' ? 0.22 : 0.09;
    if (state.specialCooldown <= 0 && Math.random() < powerChance) {
      let kind = 'spread';
      const roll = Math.random();
      if (enemy.type === 'carrier') kind = roll < 0.28 ? 'shield' : roll < 0.56 ? 'burst' : roll < 0.78 ? 'laser' : 'spread';
      else if (enemy.type === 'boss') kind = enemy.profile?.preferredDrop || (roll < 0.35 ? 'laser' : roll < 0.65 ? 'shield' : roll < 0.84 ? 'burst' : 'spread');
      else if (enemy.type === 'tank') kind = roll < 0.36 ? 'laser' : roll < 0.64 ? 'shield' : roll < 0.78 ? 'burst' : 'spread';
      else if (enemy.type === 'charger') kind = roll < 0.5 ? 'burst' : roll < 0.78 ? 'laser' : 'spread';
      else if (roll < 0.22) kind = 'shield';
      state.powerups.push({ x: enemy.x, y: enemy.y, vx: (Math.random() - 0.5) * 60, vy: 120, life: 6.5, r: kind === 'burst' ? 15 : 14, kind });
      if (enemy.type === 'carrier') {
        state.carriersDown += 1;
        floatText(enemy.x, enemy.y - 28, 'DROP CARRIER', '#cda6ff');
      }
    }
  }


  function pushBoardEntry(reason = 'down') {
    const entry = {
      score: Math.round(state.totalScore + state.score),
      round: state.roundsCleared + (reason === 'clear' ? 1 : 0),
      wave: state.wave,
      kills: state.totalKills + state.kills,
      shards: state.totalShards + state.shardsRecovered,
      rank: getRoundRank().rank,
      combo: state.bestCombo,
      damage: state.damageTaken,
      payout: state.totalPayout,
    };
    board.push(entry);
    board.sort((a,b) => b.score - a.score);
    board = board.slice(0, 12);
    save(Storage.blasterBoard, board);
    meta.bestScore = Math.max(meta.bestScore, entry.score);
    meta.bestWave = Math.max(meta.bestWave, entry.wave);
    meta.bestRound = Math.max(meta.bestRound || 0, entry.round);
    save(Storage.blasterState, meta);
  }

  function openRoundRewardOverlay() {
    if (!state || state.rewardPending) return;
    state.rewardPending = true;
    state.paused = true;
    state.over = true;
    const rankInfo = getRoundRank();
    const rawReward = state.config.baseReward + state.wave * 5 + state.shardsRecovered * 2 + Math.floor(state.kills / 3);
    const rawBaseReward = Number((rawReward * (1 + rankInfo.bonus)).toFixed(2));
    const baseReward = balanceGameReward('burrowblaster', rawBaseReward);
    // Minted once, here, for the round itself — not inside onPick — so the
    // claim's dedup key is stable no matter how the box-pick handler is
    // invoked, matching diglew.js's pattern.
    const claimToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const boxes = buildRewardBoxes();
    showRewardOverlay({
      title: `Burrow Blaster — Round ${state.round} Clear`,
      badge: `Round ${state.round} stash recovered`,
      text: `Lew cleared all 6 waves and recovered the stash.<br><br>Round Rank: <strong>${rankInfo.rank}</strong>${rankInfo.bonus ? ` • Rank bonus +${Math.round(rankInfo.bonus * 100)}%` : ''}<br>Best combo: <strong>${state.bestCombo}</strong> • Damage taken: <strong>${state.damageTaken}</strong>${state.bossDefeated ? `<br>Bosses defeated: <strong>${state.bossDefeated}</strong>` : ''}<br><br>Base payout: <strong>${baseReward.toFixed(2)} WinLEW</strong>. Pick a reward box, then continue into Round ${state.round + 1}.`,
      boxes,
      continueLabel: `Continue to Round ${state.round + 1}`,
      onPick: (box) => {
        const payout = Number((baseReward * Number(box.multiplier || 1)).toFixed(2));
        state.totalPayout = Number((state.totalPayout + payout).toFixed(2));
        const walletTotal = addWallet(payout);
        renderAll();
        const claimPromise = postRewardClaim({
          game: 'burrowblaster',
          // Server-validated claim shape (recomputes payout = baseReward * multiplier);
          // without roundKey/baseReward/multiplier the claim was rejected + never saved.
          roundKey: `round-${state.round}-${claimToken}`,
          roundLabel: `Burrow Blaster round ${state.round} clear`,
          baseReward: rawBaseReward,
          multiplier: box.multiplier,
          payout,
          meta: {
            round: state.round,
            wave: state.wave,
            kills: state.totalKills + state.kills,
            shards: state.totalShards + state.shardsRecovered,
            rank: getRoundRank().rank,
            bestCombo: state.bestCombo,
            damageTaken: state.damageTaken,
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
      onContinue: continueToNextRound,
    });
  }

  function nextWave() {
    if (state.wave >= state.config.maxWave) {
      pushBoardEntry('clear');
      addLog(`Round ${state.round} cleared. Reward box ready.`);
      Sound.win();
      renderHubBoards();
      renderAll();
      openRoundRewardOverlay();
      return;
    }
    state.wave += 1;
    state.bossWave = state.wave === state.config.maxWave && state.round % 3 === 0;
    state.waveTheme = getWaveTheme(state.wave);
    if (state.bossWave) {
      const profile = getBossProfile(state.round);
      state.bossVariant = profile.id;
      state.bossName = profile.name;
      state.bossPhase = 1;
      state.bossRewardsDropped = false;
    }
    state.bossSpawned = false;
    state.waveQuota = state.bossWave ? 0 : getWaveQuota(state.wave);
    state.spawned = 0;
    state.spawnTimer = 0;
    state.hazardTimer = 0;
    state.bossIntroTimer = state.bossWave ? 1.45 : 0;
    state.flash = state.bossWave ? 0.18 : state.flash;
    state.shake = state.bossWave ? Math.max(state.shake, 6) : state.shake;
    addLog(state.bossWave ? `Wave ${state.wave} opened. Miniboss chamber ahead.` : `Wave ${state.wave}: ${state.waveTheme}. Watch the enemy roles.`);
    showArcadeBanner(state.bossWave ? 'GUARDIAN CHAMBER' : `WAVE ${state.wave}`, state.waveTheme, state.bossWave ? '#ffb347' : '#86f6ff', state.bossWave ? 1.35 : 0.85);
    Sound.win();
  }

  function continueToNextRound() {
    if (!state) return;
    const carry = {
      keepMeta: true,
      totalScore: state.totalScore + state.score + state.config.waveClearBonus,
      totalKills: state.totalKills + state.kills,
      totalShards: state.totalShards + state.shardsRecovered,
      totalPayout: state.totalPayout,
      roundsCleared: state.roundsCleared + 1,
    };
    const nextRound = state.round + 1;
    start(nextRound, carry);
    addLog(nextRound >= 4 ? `Endless depth ${nextRound - 3} started. Escalation increased, safety rules remain active.` : `Round ${nextRound} started.`);
  }

  function finish(reason) {
    if (!state || state.over || state.rewardPending) return;
    state.over = true;
    modeEl.textContent = 'Down';
    pushBoardEntry('down');
    addLog(`Run ended: ${reason}.`);
    renderHubBoards();
    renderAll();
    Sound.hurt();
  }

  function updatePlayer(dt) {
    const prevX = state.player.x;
    const prevY = state.player.y;
    if (pointer.active) {
      state.player.x += (pointer.x - state.player.x) * Math.min(1, dt * 14);
      state.player.y += (pointer.y - state.player.y) * Math.min(1, dt * 14);
    } else {
      const dx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
      const dy = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
      state.player.x += dx * state.player.speed * dt;
      state.player.y += dy * state.player.speed * dt;
    }
    state.player.x = clamp(state.player.x, 28, W - 28);
    state.player.y = clamp(state.player.y, 76, H - 58);
    const safeDt = Math.max(dt, 0.001);
    state.player.vx = (state.player.x - prevX) / safeDt;
    state.player.vy = (state.player.y - prevY) / safeDt;
    const targetTilt = clamp(state.player.vx / 700, -0.36, 0.36);
    state.player.tilt += (targetTilt - state.player.tilt) * Math.min(1, dt * 8);
  }

  function update(dt) {
    if (!state || state.paused || state.over || state.rewardPending) return;
    updatePlayer(dt);
    state.fireTimer += dt;
    state.exhaustTimer += dt;
    state.spawnTimer += dt;
    state.hazardTimer += dt;
    if (state.exhaustTimer >= 0.035) {
      state.exhaustTimer = 0;
      state.exhaustTrail.push({ x: state.player.x + (Math.random() - 0.5) * 12, y: state.player.y + 36, r: 7 + Math.random() * 6, life: 0.45, alpha: 0.42 });
    }
    state.specialTimer = Math.max(0, state.specialTimer - dt);
    state.specialCooldown = Math.max(0, state.specialCooldown - dt);
    state.shieldTimer = Math.max(0, state.shieldTimer - dt);
    if (state.shieldTimer <= 0) state.shieldCharges = 0;
    state.weaponTimer = Math.max(0, state.weaponTimer - dt);
    state.hurtTimer = Math.max(0, state.hurtTimer - dt);
    state.bossIntroTimer = Math.max(0, state.bossIntroTimer - dt);
    state.bossDefeatTimer = Math.max(0, state.bossDefeatTimer - dt);
    state.shake = Math.max(0, state.shake - dt * 18);
    state.flash = Math.max(0, state.flash - dt * 2.4);
    if (state.arcadeBanner) {
      state.arcadeBanner.life -= dt;
      if (state.arcadeBanner.life <= 0) state.arcadeBanner = null;
    }
    if (state.specialTimer <= 0) state.weaponMode = 'default';
    if (state.fireTimer >= (state.specialTimer > 0 && state.weaponMode === 'laser' ? 0.18 : state.specialTimer > 0 ? 0.12 : 0.15)) {
      state.fireTimer = 0;
      fire();
    }

    const lowLifeMercy = state.lives <= 2;
    const spawnEvery = Math.max(0.34, state.config.spawnBase - state.wave * 0.045 - state.config.endlessTier * 0.012 + (lowLifeMercy ? 0.16 : 0));
    if (state.bossWave) {
      if (!state.bossSpawned && state.bossIntroTimer <= 0) spawnBoss();
      else if (state.bossSpawned && Math.random() < dt * (0.38 + state.round * 0.018) && state.enemies.filter((e) => !e.boss).length < (lowLifeMercy ? 3 : 4)) {
        spawnEnemy(Math.random() < 0.55 ? 'raider' : 'scout', 90 + rand(W - 180), -40, (Math.random() - 0.5) * 50);
      }
    } else if (state.spawned < state.waveQuota && state.spawnTimer >= spawnEvery) {
      state.spawnTimer = 0;
      const formationChance = clamp(0.14 + state.wave * 0.032 + state.config.endlessTier * 0.018 - (lowLifeMercy ? 0.08 : 0), 0.12, 0.40);
      if (state.wave >= 2 && Math.random() < formationChance && state.spawned <= state.waveQuota - 2) spawnEnemyFormation();
      else spawnEnemy();
    }

    const hazardEvery = Math.max(1.15, state.config.hazardBase - state.wave * 0.045 - state.config.endlessTier * 0.018 + (lowLifeMercy ? state.config.mercyHazardDelay : 0));
    if (state.hazardTimer >= hazardEvery) {
      const spawnedWarning = spawnWarning();
      state.hazardTimer = spawnedWarning ? 0 : hazardEvery * 0.62;
    }

    state.bullets.forEach((b) => { b.y += b.vy * dt; b.x += (b.vx || 0) * dt; });
    state.bullets = state.bullets.filter((b) => b.y > -60 && b.x > -60 && b.x < W + 60);

    state.enemies.forEach((e) => {
      e.phase += dt * (e.type === 'scout' ? 5.5 : e.boss ? 1.8 : 2.1);
      if (e.boss) {
        markBossPhase(e);
        const phase = e.phase || 1;
        const profile = e.profile || getBossProfile(state.round);
        const driftAmp = profile.id === 'ironback' ? 56 : profile.id === 'drilleater' ? 104 : 86;
        const waveAmp = phase >= 3 ? 1.28 : phase >= 2 ? 1.12 : 1;
        e.x += Math.sin(e.phase * (profile.id === 'drilleater' ? 1.55 : 1.15)) * driftAmp * waveAmp * dt + e.vx * dt;
        if (e.x < 82 || e.x > W - 82) e.vx *= -1;
        e.x = clamp(e.x, 82, W - 82);
        e.y += Math.sin(e.phase * 0.9) * (10 + phase * 2) * dt;
        e.cooldown -= dt;
        if (e.cooldown <= 0) {
          e.attackIndex = (e.attackIndex || 0) + 1;
          e.cooldown = Math.max(0.78, 1.75 - phase * 0.24 - state.config.endlessTier * 0.03);
          bossAttack(e);
        }
        return;
      }
      if (e.type === 'charger') {
        e.chargeTimer -= dt;
        if (e.chargeState === 'windup') {
          e.y += e.vy * 0.42 * dt;
          e.x += Math.sin(e.phase * 2.4) * 24 * dt;
          if (e.chargeTimer <= 0) {
            const dx = clamp(state.player.x - e.x, -180, 180);
            const dy = clamp(state.player.y - e.y, 80, 280);
            const len = Math.hypot(dx, dy) || 1;
            const speed = 360 + state.wave * 22 + state.round * 10;
            e.chargeVx = dx / len * speed;
            e.chargeVy = dy / len * speed;
            e.chargeState = 'dash';
            e.chargeTimer = 0.9;
            floatText(e.x - 22, e.y - 20, 'CHARGE', '#ff8a4a');
          }
        } else if (e.chargeState === 'dash') {
          e.x += e.chargeVx * dt;
          e.y += e.chargeVy * dt;
          if (e.chargeTimer <= 0) {
            e.chargeState = 'recover';
            e.chargeTimer = 0.35;
          }
        } else {
          e.x += e.vx * 0.5 * dt;
          e.y += e.vy * 0.75 * dt;
        }
        if (e.x < 34 || e.x > W - 34) e.chargeVx *= -0.5;
        e.x = clamp(e.x, 34, W - 34);
        return;
      }
      if (e.type === 'carrier') {
        const escapeDrift = Math.sin(e.phase * 1.8) * 82;
        const avoidPlayer = clamp(e.x - state.player.x, -130, 130) * 0.08;
        e.x += (e.vx + escapeDrift + avoidPlayer) * dt;
        e.y += e.vy * dt;
        if (e.x < 44 || e.x > W - 44) e.vx *= -1;
        e.x = clamp(e.x, 44, W - 44);
        return;
      }
      const waveDrift = e.type === 'scout' ? Math.sin(e.phase) * 65 : e.type === 'splitter' ? Math.sin(e.phase) * 30 : 0;
      const seekForce = clamp(state.player.x - e.x, -140, 140) * (e.seek || 0);
      e.x += (e.vx + waveDrift + seekForce) * dt;
      e.y += e.vy * dt;
      if (e.x < 34 || e.x > W - 34) e.vx *= -1;
      e.x = clamp(e.x, 34, W - 34);
    });

    state.hazards.forEach((h) => {
      h.life -= dt;
      if (h.kind === 'rock') {
        h.y += h.vy * dt;
        h.x += h.vx * dt;
        h.angle += h.spin * dt;
        if (h.x < h.r || h.x > W - h.r) h.vx *= -1;
        h.x = clamp(h.x, h.r, W - h.r);
      } else if (h.kind === 'beam') {
        h.x += (h.vx || 0) * dt;
        h.y += (h.vy || 0) * dt;
        h.pulse += dt * 7;
      } else if (h.kind === 'root') {
        h.x += h.vx * dt;
        h.pulse += dt * 6;
        if (h.life <= h.retractAt) h.vx *= 0.93;
      }
    });
    state.warnings.forEach((w) => {
      w.timer -= dt;
      if (w.timer <= 0) {
        if (!w.forced && isWarningTooCloseToPlayer(w, -18)) {
          w.forced = true;
          w.timer = 0.24;
          state.safetyDeferrals += 1;
          return;
        }
        w.done = true;
        state.hazardsDodged += 1;
        spawnHazard(w.kind, w);
      }
    });
    state.floaters.forEach((f) => {
      f.y += f.vy * dt;
      f.life -= dt;
      f.alpha = clamp(f.life, 0, 1);
    });
    state.shards.forEach((s) => { s.y += s.vy * dt; s.x += s.vx * dt; s.life -= dt; });
    state.powerups.forEach((p) => { p.y += p.vy * dt; p.x += p.vx * dt; p.life -= dt; });
    state.particles.forEach((pt) => { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt; pt.vx *= 0.98; pt.vy *= 0.98; });
    state.muzzleFlashes.forEach((m) => { m.life -= dt; });
    state.shockwaves.forEach((sw) => { sw.life -= dt; sw.r += (sw.maxR - sw.r) * Math.min(1, dt * 8); });
    state.exhaustTrail.forEach((t) => { t.life -= dt; t.y += 34 * dt; t.r += 14 * dt; t.alpha = clamp(t.life, 0, 1) * 0.42; });
    state.shards = state.shards.filter((s) => s.life > 0 && s.y < H + 40);
    state.powerups = state.powerups.filter((p) => p.life > 0 && p.y < H + 40);
    state.hazards = state.hazards.filter((h) => h.life > 0 && h.y < H + 60 && h.x > -220 && h.x < W + 220);
    state.warnings = state.warnings.filter((w) => !w.done);
    state.floaters = state.floaters.filter((f) => f.life > 0);
    state.particles = state.particles.filter((pt) => pt.life > 0);
    state.muzzleFlashes = state.muzzleFlashes.filter((m) => m.life > 0);
    state.shockwaves = state.shockwaves.filter((sw) => sw.life > 0);
    state.exhaustTrail = state.exhaustTrail.filter((t) => t.life > 0);

    for (const bullet of state.bullets) {
      for (const enemy of state.enemies) {
        if (!enemy.dead && Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) <= bullet.r + enemy.r) {
          if (!bullet.powered || bullet.pierce <= 0) bullet.y = -100;
          else bullet.pierce -= 1;
          const dmg = bullet.style === 'laser' ? 3 : bullet.powered ? 2 : 1;
          enemy.hp -= dmg;
          burst(bullet.x, bullet.y, bullet.style === 'laser' ? '#ff8cf4' : bullet.powered ? '#86f6ff' : '#47c7ff', bullet.style === 'laser' ? 12 : bullet.powered ? 10 : 6);
          if (enemy.hp <= 0) {
            enemy.dead = true;
            addScore(enemy.score, enemy.x, enemy.y, `+${enemy.score}`, enemy.boss ? '#ffb347' : '#ffd86a');
            state.kills += 1;
            maybeDrop(enemy);
            enemyDeathBurst(enemy);
            state.shake = Math.max(state.shake, enemy.boss ? 12 : enemy.type === 'tank' ? 6 : 2.5);
            state.flash = Math.max(state.flash, enemy.boss ? 0.24 : 0.05);
            if (enemy.type === 'splitter') {
              spawnEnemy('mini', enemy.x - 18, enemy.y, -70);
              spawnEnemy('mini', enemy.x + 18, enemy.y, 70);
            }
            if (enemy.boss) {
              state.bossDefeated += 1;
              state.bossDefeatTimer = 1.6;
              dropBossRewards(enemy);
              showArcadeBanner(`${enemy.name || 'Guardian'} Defeated`, 'Boss stash unlocked • premium core dropped', enemy.color || '#ffb347', 1.45);
              floatText(enemy.x, enemy.y - enemy.r - 28, 'BOSS BROKEN', enemy.color || '#ffb347');
              addLog(`${enemy.name || 'Guardian'} defeated. Boss stash unlocked.`);
            }
            Sound.coin();
          }
          break;
        }
      }
      for (const hazard of state.hazards) {
        if (bullet.y < -50) break;
        if (hazard.kind === 'rock' && Math.hypot(bullet.x - hazard.x, bullet.y - hazard.y) <= bullet.r + hazard.r) {
          hazard.life = 0;
          bullet.y = -100;
          addScore(12, hazard.x, hazard.y, '+12', '#eab676');
          state.shake = Math.max(state.shake, 2);
          sparkBurst(hazard.x, hazard.y, '#eab676', 10);
          break;
        }
      }
    }
    state.enemies = state.enemies.filter((e) => !e.dead);

    for (const shard of state.shards) {
      if (Math.hypot(shard.x - state.player.x, shard.y - state.player.y) <= shard.r + state.player.r + 4) {
        shard.life = 0;
        state.shardsRecovered += 1;
        const shardValue = shard.value || 25;
        addScore(shardValue, shard.x, shard.y, shard.risk ? `+${shardValue} RISK` : `+${shardValue}`, shard.risk ? '#ffcf6e' : '#fbbf24');
        pickupBurst(shard.x, shard.y, shard.risk ? 'risk' : 'shard');
        Sound.power();
      }
    }
    for (const power of state.powerups) {
      if (Math.hypot(power.x - state.player.x, power.y - state.player.y) <= power.r + state.player.r + 8) {
        power.life = 0;
        if (power.kind === 'shield') {
          state.weaponMode = 'shield';
          state.shieldTimer = 9;
          state.shieldCharges = 2;
          state.specialCooldown = 8;
          addLog('Shield core recovered. Two hits can be absorbed.');
          pickupBurst(power.x, power.y, 'shield');
        } else if (power.kind === 'burst') {
          let cleared = 0;
          for (const enemy of state.enemies) {
            if (!enemy.boss && Math.hypot(enemy.x - power.x, enemy.y - power.y) <= 260) {
              enemy.dead = true;
              cleared += 1;
              addScore(Math.max(20, Math.floor(enemy.score * 0.55)), enemy.x, enemy.y, 'BURST', '#ffb35c');
              burst(enemy.x, enemy.y, '#ffb35c', 10);
            }
          }
          for (const hazard of state.hazards) {
            if (Math.hypot((hazard.x || 0) - power.x, (hazard.y || 0) - power.y) <= 280) {
              hazard.life = 0;
              cleared += 1;
            }
          }
          state.specialCooldown = 8;
          state.shake = Math.max(state.shake, 12);
          state.flash = Math.max(state.flash, 0.18);
          addLog(`Burst core recovered. Tunnel blast cleared ${cleared} threats.`);
          pickupBurst(power.x, power.y, 'burst');
        } else {
          state.weaponMode = power.kind || 'spread';
          state.specialTimer = power.kind === 'laser' ? 7.5 : 8.5;
          state.specialCooldown = 10;
          addLog(power.kind === 'laser' ? 'Power core recovered. Laser drill online!' : 'Power core recovered. Spread drill online!');
          pickupBurst(power.x, power.y, power.kind === 'laser' ? 'laser' : 'spread');
        }
        addScore(40, power.x, power.y, '+40 CORE', power.kind === 'shield' ? '#92f7ff' : power.kind === 'laser' ? '#ff9df7' : power.kind === 'burst' ? '#ffb35c' : '#ffd86a');
        Sound.win();
      }
    }

    for (const hazard of state.hazards) {
      if (hazard.kind === 'rock') {
        const dist = Math.hypot(hazard.x - state.player.x, hazard.y - state.player.y);
        if (dist <= hazard.r + state.player.r - 3) {
          if (damagePlayer(1, "Cave rock clipped Lew's drill-ship.", hazard.x, hazard.y, '#ffb36b', 7)) hazard.life = 0;
        } else if (dist <= hazard.r + state.player.r + 14 && !hazard.nearMiss) {
          hazard.nearMiss = true;
          state.nearMisses += 1;
          addScore(8, state.player.x, state.player.y - 24, '+8 NEAR', '#a9d3ff');
        }
      } else if (hazard.kind === 'beam') {
        const isHorizontal = (hazard.orientation || 'horizontal') === 'horizontal';
        const hitX = isHorizontal
          ? state.player.x + state.player.r > hazard.x && state.player.x - state.player.r < hazard.x + hazard.width
          : Math.abs(state.player.x - hazard.x) <= hazard.width * 0.5 + state.player.r * 0.55;
        const hitY = isHorizontal
          ? Math.abs(state.player.y - hazard.y) <= hazard.height * 0.5 + state.player.r * 0.55
          : state.player.y + state.player.r > hazard.y && state.player.y - state.player.r < hazard.y + hazard.height;
        if (hitX && hitY) {
          if (damagePlayer(1, 'Shock beam grazed the drill-ship.', state.player.x, state.player.y, '#ff8a8a', 6)) hazard.life = 0;
        }
      } else {
        const left = hazard.side === 'left' ? hazard.x : hazard.x - hazard.width;
        const right = hazard.side === 'left' ? hazard.x + hazard.width : hazard.x;
        const top = hazard.y - hazard.height * 0.5;
        const bottom = hazard.y + hazard.height * 0.5;
        if (state.player.x + state.player.r > left && state.player.x - state.player.r < right && state.player.y + state.player.r > top && state.player.y - state.player.r < bottom) {
          if (damagePlayer(1, 'Tunnel root whipped across the passage.', state.player.x, state.player.y, '#d0c47c', 5)) hazard.life = 0;
        }
      }
    }

    for (const enemy of state.enemies) {
      if (!enemy.boss && enemy.y > H + 50) {
        enemy.dead = true;
        damagePlayer(enemy.type === 'tank' ? 2 : 1, `${enemy.type === 'tank' ? 'Tank raider' : 'Raider'} slipped by and hit the stash line.`, enemy.x, H - 60, '#ff7676', enemy.type === 'tank' ? 8 : 4);
      } else if (Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) <= enemy.r + state.player.r - (enemy.boss ? 8 : 3)) {
        const damaged = damagePlayer(enemy.boss ? 2 : enemy.type === 'tank' ? 2 : 1, enemy.boss ? "Miniboss slammed the drill-ship." : "Direct hit on Lew's drill-ship.", enemy.x, enemy.y, '#ff7676', enemy.boss ? 10 : 6);
        if (damaged || !enemy.boss) enemy.dead = !enemy.boss;
      }
    }
    state.enemies = state.enemies.filter((e) => !e.dead);

    if (state.lives <= 0) finish('the raiders broke through');
    if (((state.bossWave && state.bossSpawned) || state.spawned >= state.waveQuota) && !state.enemies.length && !state.over) nextWave();
    renderAll();
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.03, (ts - (last || ts)) / 1000);
    last = ts;
    if (!views.blaster.classList.contains('hidden')) update(dt);
    draw();
  }

  function drawShockwave(sw) {
    ctx.save();
    const alpha = clamp(sw.life * 2.4, 0, 0.75);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sw.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawMuzzleFlash(m) {
    ctx.save();
    ctx.globalAlpha = clamp(m.life / m.maxLife, 0, 1);
    ctx.translate(m.x, m.y);
    ctx.shadowColor = m.color;
    ctx.shadowBlur = m.mode === 'laser' ? 22 : 14;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(12, -4);
    ctx.lineTo(0, 6);
    ctx.lineTo(-12, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(5, -3);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawArcadeBanner() {
    if (!state?.arcadeBanner) return;
    const b = state.arcadeBanner;
    const t = clamp(b.life / b.maxLife, 0, 1);
    const alpha = Math.min(1, t * 2.2);
    const y = 104 - (1 - t) * 16;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(5, 8, 18, .72)';
    ctx.beginPath();
    ctx.roundRect(W * 0.18, y, W * 0.64, 92, 18);
    ctx.fill();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.font = '800 34px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.title, W / 2, y + 42);
    if (b.subtitle) {
      ctx.fillStyle = '#dbe5ff';
      ctx.font = '600 18px Inter, sans-serif';
      ctx.fillText(b.subtitle, W / 2, y + 70);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function drawHudPanel() {
    const rank = getRoundRank().rank;
    const weapon = state.specialTimer > 0 ? (state.weaponMode === 'laser' ? 'LASER' : 'SPREAD') : state.shieldTimer > 0 ? 'SHIELD' : state.specialCooldown > 0 ? 'COOLDOWN' : 'READY';
    ctx.save();
    ctx.fillStyle = 'rgba(5, 8, 18, .52)';
    ctx.beginPath();
    ctx.roundRect(28, 24, 270, state.nearMisses > 0 ? 164 : 136, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(174, 207, 255, .22)';
    ctx.stroke();
    ctx.fillStyle = '#eef2ff';
    ctx.font = '700 22px Inter, sans-serif';
    ctx.fillText(`R${state.round}  W${state.wave}/6`, 46, 58);
    ctx.fillStyle = '#ff8a8a';
    ctx.font = '700 19px Inter, sans-serif';
    ctx.fillText(`♥ ${Math.max(0, state.lives)}`, 46, 88);
    ctx.fillStyle = weapon === 'LASER' ? '#ff9df7' : weapon === 'SPREAD' ? '#86f6ff' : weapon === 'SHIELD' ? '#92f7ff' : '#ffd86a';
    ctx.fillText(`◆ ${weapon}`, 112, 88);
    ctx.fillStyle = '#ffd86a';
    ctx.fillText(`★ Rank ${rank}`, 46, 118);
    ctx.fillStyle = '#a9d3ff';
    ctx.fillText(`⚡ Combo ${state.bestCombo}`, 150, 118);
    if (state.nearMisses > 0) {
      ctx.fillStyle = '#a9d3ff';
      ctx.fillText(`Near misses ${state.nearMisses}`, 46, 148);
    }
    ctx.restore();
  }

  function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt);
    ctx.shadowColor = 'rgba(255, 173, 66, .34)';
    ctx.shadowBlur = 20;
    const flame = 16 + Math.sin(performance.now() / 80) * 4;

    ctx.fillStyle = 'rgba(255, 187, 72, .22)';
    ctx.beginPath(); ctx.ellipse(0, 28, 40, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#703113';
    ctx.beginPath(); ctx.moveTo(-25, 26); ctx.lineTo(-10, 10); ctx.lineTo(-4, 34); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(25, 26); ctx.lineTo(10, 10); ctx.lineTo(4, 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#932f18';
    ctx.beginPath(); ctx.roundRect(-25, -18, 50, 60, 18); ctx.fill();
    ctx.fillStyle = '#cf5b28';
    ctx.beginPath(); ctx.roundRect(-17, -8, 34, 42, 14); ctx.fill();
    ctx.fillStyle = '#752212';
    for (const y of [-4, 8, 20]) ctx.fillRect(-14, y, 28, 4);

    ctx.fillStyle = '#d0d3df';
    ctx.beginPath();
    ctx.moveTo(0, -58); ctx.lineTo(28, -8); ctx.lineTo(12, -14); ctx.lineTo(0, -5); ctx.lineTo(-12, -14); ctx.lineTo(-28, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8f95a7';
    ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(15, -14); ctx.lineTo(0, -22); ctx.lineTo(-15, -14); ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#5d2512';
    ctx.beginPath(); ctx.arc(0, 8, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3c8af';
    ctx.beginPath(); ctx.arc(3, 8, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2416';
    ctx.beginPath(); ctx.arc(-4, 4, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(4, 7, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, 6, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 11, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ec9d1e';
    ctx.beginPath(); ctx.arc(0, -12, 12, Math.PI, 0); ctx.lineTo(12, -4); ctx.lineTo(-12, -4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffef91';
    ctx.beginPath(); ctx.arc(3, -13, 4.2, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#ff9418';
    ctx.beginPath(); ctx.moveTo(-10, 37); ctx.quadraticCurveTo(0, 37 + flame, 10, 37); ctx.quadraticCurveTo(0, 58 + flame, -10, 37); ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.moveTo(-5, 38); ctx.quadraticCurveTo(0, 38 + flame * .75, 5, 38); ctx.quadraticCurveTo(0, 50 + flame * .5, -5, 38); ctx.fill();
    if (state.shieldTimer > 0 || state.shieldCharges > 0) {
      ctx.strokeStyle = 'rgba(146, 247, 255, .82)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 46 + Math.sin(performance.now() / 110) * 3, 70, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(146, 247, 255, .08)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 46, 70, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const bob = Math.sin(performance.now() / 180 + e.x * 0.02) * 1.5;
    ctx.translate(0, bob);
    if (e.boss) {
      const profile = e.profile || getBossProfile(state.round);
      const phase = e.phase || 1;
      ctx.shadowColor = profile.id === 'drilleater' ? 'rgba(255, 157, 247, .46)' : profile.id === 'ironback' ? 'rgba(164, 230, 111, .42)' : 'rgba(255, 162, 73, .45)';
      ctx.shadowBlur = 22;
      ctx.fillStyle = e.bodyColor || profile.body || '#c76b1b';
      ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.78, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.shellColor || profile.shell || '#7a3810';
      ctx.beginPath(); ctx.ellipse(0, 6, e.r * 0.62, e.r * 0.44, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = profile.color || '#ffb347';
      ctx.lineWidth = phase >= 3 ? 5 : phase >= 2 ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(-e.r * .36, -4); ctx.lineTo(-8, 8); ctx.lineTo(4, -8); ctx.lineTo(e.r * .34, 5); ctx.stroke();
      if (phase >= 2) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-24, -18); ctx.lineTo(-4, -2); ctx.lineTo(-18, 16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(22, -14); ctx.lineTo(6, 2); ctx.lineTo(26, 18); ctx.stroke();
      }
      ctx.fillStyle = profile.id === 'drilleater' ? '#d7c6ff' : '#d7dff3';
      ctx.beginPath(); ctx.moveTo(0, -e.r - 20); ctx.lineTo(18, -18); ctx.lineTo(-18, -18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = profile.color || '#f0b25a';
      ctx.fillRect(-18, -6, 36, 22);
      ctx.fillStyle = '#fff6c7';
      ctx.beginPath(); ctx.arc(0, -10, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-12, -8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, -8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-12, -8, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, -8, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = profile.color || '#ffd39b';
      ctx.lineWidth = 4;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(side * 18, 2); ctx.lineTo(side * 48, 22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(side * 20, -16); ctx.lineTo(side * 48, -34); ctx.stroke();
        if (phase >= 2) { ctx.beginPath(); ctx.moveTo(side * 18, 14); ctx.lineTo(side * 44, 42); ctx.stroke(); }
      }
      ctx.fillStyle = 'rgba(10,16,24,.65)';
      ctx.fillRect(-50, e.r + 16, 100, 12);
      ctx.fillStyle = profile.color || '#ffb347';
      ctx.fillRect(-50, e.r + 16, 100 * Math.max(0, e.hp / e.maxHp), 12);
      ctx.fillStyle = '#eef2ff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`P${phase}`, 0, e.r + 42);
      ctx.textAlign = 'start';
      ctx.restore();
      return;
    }
    if (e.type === 'charger') {
      const pulse = e.chargeState === 'windup' ? 0.5 + Math.sin(performance.now() / 60) * 0.25 : 0.18;
      ctx.shadowColor = `rgba(255, 107, 61, ${pulse})`;
      ctx.shadowBlur = e.chargeState === 'windup' ? 18 : 10;
      ctx.fillStyle = '#ff7b3f';
      ctx.beginPath(); ctx.ellipse(0, 0, e.r * 0.92, e.r * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8e2c18';
      ctx.beginPath(); ctx.ellipse(0, 2, e.r * 0.58, e.r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd3a0';
      ctx.beginPath(); ctx.moveTo(0, e.r + 8); ctx.lineTo(-9, e.r * 0.18); ctx.lineTo(9, e.r * 0.18); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffd3a0'; ctx.lineWidth = 2.4;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 9, 2); ctx.lineTo(side * 27, 14); ctx.stroke(); ctx.beginPath(); ctx.moveTo(side * 8, -7); ctx.lineTo(side * 27, -18); ctx.stroke(); }
      if (e.chargeState === 'windup') { ctx.strokeStyle = 'rgba(255, 220, 160, .75)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, e.r + 8, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-6, -5, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(6, -5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-6, -5, 1.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(6, -5, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return;
    }

    if (e.type === 'carrier') {
      ctx.shadowColor = 'rgba(205, 166, 255, .35)'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#cda6ff'; ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.74, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b3e9a'; ctx.beginPath(); ctx.ellipse(0, 4, e.r * 0.58, e.r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.roundRect(-13, -12, 26, 16, 5); ctx.fill();
      ctx.fillStyle = '#815415'; ctx.fillRect(-9, -8, 18, 4);
      ctx.strokeStyle = '#e9d4ff'; ctx.lineWidth = 2;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 11, 2); ctx.lineTo(side * 30, 13); ctx.stroke(); ctx.beginPath(); ctx.moveTo(side * 11, -6); ctx.lineTo(side * 29, -17); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-6, -3, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(6, -3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-6, -3, 1.35, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(6, -3, 1.35, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return;
    }

    const body = e.type === 'tank' ? '#6db6d6' : e.type === 'armored' ? '#86d95a' : e.type === 'splitter' ? '#ffb34a' : e.type === 'scout' ? '#91dfff' : '#8ae55a';
    const shell = e.type === 'tank' ? '#3e7f99' : e.type === 'armored' ? '#4f932f' : e.type === 'splitter' ? '#b7711f' : e.type === 'scout' ? '#4e87a4' : '#4d9630';
    const trim = e.type === 'tank' ? '#e5f5ff' : e.type === 'armored' ? '#efffc7' : e.type === 'splitter' ? '#fff0af' : '#d9f3ff';
    ctx.shadowColor = 'rgba(80,160,255,.18)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.76, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shell;
    ctx.beginPath(); ctx.ellipse(0, 1, e.r * 0.62, e.r * 0.46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = trim;
    ctx.beginPath(); ctx.ellipse(0, -2, e.r * 0.26, e.r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    if (e.type === 'tank' || e.type === 'armored') {
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 2.5;
      for (const off of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(-e.r * .38, off - 6); ctx.lineTo(e.r * .38, off - 6); ctx.stroke(); }
    }
    if (e.type === 'splitter') {
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath(); ctx.arc(0, 0, e.r * .22, 0, Math.PI * 2); ctx.fill();
      for (const ang of [0, Math.PI/2, Math.PI, Math.PI*1.5]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * e.r * 0.55, Math.sin(ang) * e.r * 0.42);
        ctx.lineTo(Math.cos(ang) * e.r * 0.92, Math.sin(ang) * e.r * 0.72);
        ctx.strokeStyle = '#ffd97a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.strokeStyle = e.type === 'tank' ? '#dff5ff' : e.type === 'splitter' ? '#ffe6a8' : '#d7ffbf';
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(side * (e.r * 0.45), 1); ctx.lineTo(side * (e.r * 0.95), 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(side * (e.r * 0.45), -8); ctx.lineTo(side * (e.r * 0.98), -16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(side * (e.r * 0.2), 8); ctx.lineTo(side * (e.r * 0.85), 20); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-6, -4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, -4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-6, -4, 1.35, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, -4, 1.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff4cc';
    ctx.fillRect(-3, 4, 6, 3);
    ctx.restore();
  }

  function drawWarning(w) {
    const t = clamp(w.timer / w.maxTimer, 0, 1);
    const pulse = 0.45 + Math.sin(performance.now() / 70) * 0.18;
    ctx.save();
    ctx.globalAlpha = 0.35 + (1 - t) * 0.45;
    if (w.kind === 'rock') {
      ctx.strokeStyle = `rgba(255, 183, 88, ${pulse})`;
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r + 14 * (1 - t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 183, 88, .18)';
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'beam') {
      const horizontal = (w.orientation || 'horizontal') === 'horizontal';
      ctx.fillStyle = `rgba(255, 70, 70, ${0.18 + pulse * 0.28})`;
      if (horizontal) {
        const startX = w.side === 'left' ? 0 : W - w.width;
        ctx.fillRect(startX, w.y - 16, w.width, 32);
        ctx.fillStyle = 'rgba(255, 220, 190, .75)';
        ctx.fillRect(startX, w.y - 2, w.width, 4);
      } else {
        ctx.fillRect(w.x - 16, 0, 32, w.height);
        ctx.fillStyle = 'rgba(255, 220, 190, .75)';
        ctx.fillRect(w.x - 2, 0, 4, w.height);
      }
    } else {
      const sideX = w.side === 'left' ? 0 : W;
      ctx.strokeStyle = `rgba(220, 190, 94, ${pulse})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(sideX, w.y);
      ctx.lineTo(w.side === 'left' ? 145 : W - 145, w.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(220, 190, 94, .18)';
      ctx.fillRect(w.side === 'left' ? 0 : W - 150, w.y - 24, 150, 48);
    }
    ctx.restore();
  }

  function drawHazard(hazard) {
    ctx.save();
    if (hazard.kind === 'rock') {
      ctx.translate(hazard.x, hazard.y);
      ctx.rotate(hazard.angle || 0);
      ctx.fillStyle = '#8a6745';
      ctx.beginPath();
      ctx.moveTo(-hazard.r * 0.9, -hazard.r * 0.2);
      ctx.lineTo(-hazard.r * 0.35, -hazard.r);
      ctx.lineTo(hazard.r * 0.75, -hazard.r * 0.4);
      ctx.lineTo(hazard.r, hazard.r * 0.25);
      ctx.lineTo(hazard.r * 0.2, hazard.r);
      ctx.lineTo(-hazard.r * 0.8, hazard.r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 228, 186, .22)';
      ctx.beginPath();
      ctx.moveTo(-hazard.r * 0.2, -hazard.r * 0.4);
      ctx.lineTo(hazard.r * 0.45, -hazard.r * 0.15);
      ctx.lineTo(hazard.r * 0.05, hazard.r * 0.25);
      ctx.closePath();
      ctx.fill();
    } else if (hazard.kind === 'beam') {
      const alpha = 0.38 + Math.sin(hazard.pulse || 0) * 0.18;
      const horizontal = (hazard.orientation || 'horizontal') === 'horizontal';
      ctx.fillStyle = `rgba(255, 86, 74, ${alpha})`;
      if (horizontal) {
        ctx.fillRect(hazard.x, hazard.y - hazard.height * 0.5, hazard.width, hazard.height);
        ctx.fillStyle = 'rgba(255, 220, 180, .7)';
        ctx.fillRect(hazard.x, hazard.y - 1.5, hazard.width, 3);
        ctx.fillStyle = 'rgba(255, 100, 80, .22)';
        ctx.fillRect(hazard.x, hazard.y - 18, hazard.width, 36);
      } else {
        ctx.fillRect(hazard.x - hazard.width * 0.5, hazard.y, hazard.width, hazard.height);
        ctx.fillStyle = 'rgba(255, 220, 180, .7)';
        ctx.fillRect(hazard.x - 1.5, hazard.y, 3, hazard.height);
        ctx.fillStyle = 'rgba(255, 100, 80, .22)';
        ctx.fillRect(hazard.x - 18, hazard.y, 36, hazard.height);
      }
    } else {
      const left = hazard.side === 'left' ? hazard.x : hazard.x - hazard.width;
      const bulb = 0.35 + Math.sin(hazard.pulse || 0) * 0.1;
      ctx.fillStyle = `rgba(134, 104, 50, ${0.8 + bulb * 0.1})`;
      ctx.beginPath();
      ctx.roundRect(left, hazard.y - hazard.height * 0.5, hazard.width, hazard.height, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(186, 214, 109, .7)';
      for (let i = 0; i < 5; i++) ctx.fillRect(left + 18 + i * 24, hazard.y - 1 + Math.sin((hazard.pulse || 0) + i) * 4, 6, 3);
    }
    ctx.restore();
  }

  function drawPowerup(power) {
    ctx.save();
    ctx.translate(power.x, power.y);
    ctx.rotate(performance.now() / 420);
    const kind = power.kind || 'spread';
    if (kind === 'shield') {
      ctx.shadowColor = 'rgba(146, 247, 255, .65)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#92f7ff';
      ctx.beginPath(); ctx.arc(0, 0, power.r * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e8ffff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, power.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#0d5461';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(8, -1); ctx.lineTo(5, 9); ctx.lineTo(-5, 9); ctx.lineTo(-8, -1); ctx.closePath(); ctx.fill();
    } else if (kind === 'laser') {
      ctx.shadowColor = 'rgba(255, 157, 247, .65)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff9df7';
      ctx.beginPath(); ctx.roundRect(-8, -14, 16, 28, 6); ctx.fill();
      ctx.fillStyle = '#6c2f76';
      ctx.fillRect(-3, -11, 6, 22);
      ctx.fillStyle = '#fff1ff';
      ctx.fillRect(-1, -9, 2, 18);
    } else if (kind === 'burst') {
      ctx.shadowColor = 'rgba(255, 179, 92, .72)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ffb35c';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 4;
        const r = i % 2 === 0 ? power.r : power.r * 0.55;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7c2f12';
      ctx.beginPath(); ctx.arc(0, 0, power.r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff0c7';
      ctx.fillRect(-2, -9, 4, 18);
    } else {
      ctx.shadowColor = 'rgba(255, 216, 106, .65)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffd86a';
      ctx.beginPath(); ctx.roundRect(-12, -12, 24, 24, 7); ctx.fill();
      ctx.fillStyle = '#8c5c18';
      ctx.beginPath();
      ctx.moveTo(-6, -4); ctx.lineTo(0, -9); ctx.lineTo(6, -4); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6, 3); ctx.lineTo(0, -2); ctx.lineTo(6, 3); ctx.lineTo(0, 8); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const shakeX = state ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state ? (Math.random() - 0.5) * state.shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#050814');
    grad.addColorStop(0.45, '#07152a');
    grad.addColorStop(1, '#160d08');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    const wall = ctx.createLinearGradient(0, 0, W, 0);
    wall.addColorStop(0, 'rgba(86, 52, 20, .18)');
    wall.addColorStop(0.12, 'rgba(0,0,0,0)');
    wall.addColorStop(0.88, 'rgba(0,0,0,0)');
    wall.addColorStop(1, 'rgba(86, 52, 20, .18)');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 196, 122, .05)';
    for (let i = 0; i < 12; i++) {
      const edge = i % 2 === 0 ? 0 : W;
      const y = 40 + i * 54;
      const len = 36 + (i % 3) * 18;
      ctx.beginPath();
      ctx.roundRect(edge === 0 ? 0 : W - 10, y, 10, len, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 190, 120, .10)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(edge === 0 ? 8 : W - 8, y + 2);
      ctx.bezierCurveTo(edge === 0 ? 22 : W - 22, y + len * 0.2, edge === 0 ? 14 : W - 14, y + len * 0.7, edge === 0 ? 26 : W - 26, y + len + 12);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(214,168,102,.10)';
    for (let i = 0; i < 36; i++) ctx.fillRect((i * 67 + 30) % W, (i * 111 + i * 17) % H, 6, 6);
    if (!state) {
      ctx.fillStyle = '#eef2ff';
      ctx.font = 'bold 52px Inter, sans-serif';
      ctx.fillText('Burrow Blaster', 74, 154);
      ctx.font = '28px Inter, sans-serif';
      ctx.fillStyle = '#b9c2df';
      ctx.fillText("Pilot Lew's drill-ship. Drag on mobile; keyboard and mouse also work.", 74, 206);
      ctx.restore();
      return;
    }

    state.exhaustTrail.forEach((t) => {
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.fillStyle = 'rgba(255, 166, 73, .45)';
      ctx.beginPath(); ctx.ellipse(t.x, t.y, t.r * .75, t.r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    state.shockwaves.forEach(drawShockwave);
    state.bullets.forEach((b) => {
      ctx.shadowBlur = b.style === 'laser' ? 16 : 10;
      ctx.shadowColor = b.style === 'laser' ? 'rgba(255, 157, 247, .7)' : b.powered ? 'rgba(134, 246, 255, .7)' : 'rgba(71, 199, 255, .55)';
      ctx.fillStyle = b.style === 'laser' ? '#ff9df7' : b.powered ? '#86f6ff' : '#47c7ff';
      ctx.beginPath(); ctx.roundRect(b.x - (b.style === 'laser' ? 4 : 3), b.y - 14, b.style === 'laser' ? 8 : 6, b.style === 'laser' ? 24 : 18, 3); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = b.style === 'laser' ? 'rgba(255, 240, 255, .92)' : 'rgba(183, 240, 255, .92)';
      ctx.fillRect(b.x - 1, b.y - 12, 2, b.style === 'laser' ? 18 : 14);
    });
    state.warnings.forEach(drawWarning);
    state.hazards.forEach(drawHazard);
    state.shards.forEach((s) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      const squish = 0.8 + Math.sin(performance.now() / 180 + s.x * 0.04) * 0.12;
      ctx.scale(1, squish);
      ctx.shadowColor = 'rgba(255, 204, 72, .55)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffc942';
      ctx.beginPath(); ctx.arc(0, 0, s.r * 0.82, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a96d12';
      ctx.beginPath(); ctx.arc(0, 0, s.r * 0.56, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe8a0';
      ctx.beginPath(); ctx.arc(-2, -2, s.r * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd86a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(0, -3); ctx.lineTo(3, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.stroke();
      ctx.restore();
    });
    state.powerups.forEach(drawPowerup);
    state.particles.forEach((pt) => {
      ctx.save();
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = pt.laserFlash ? 18 : 8;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size || 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    state.enemies.forEach(drawEnemy);
    state.muzzleFlashes.forEach(drawMuzzleFlash);
    state.floaters.forEach((f) => {
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = f.color;
      ctx.font = '700 18px Inter, sans-serif';
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    });
    drawPlayer();
    drawArcadeBanner();
    drawHudPanel();

    // Premium HUD is drawn by drawHudPanel().
    if (state.bossIntroTimer > 0) {
      ctx.fillStyle = 'rgba(5,6,10,.68)';
      ctx.fillRect(110, H * 0.34, W - 220, 150);
      const profile = getBossProfile(state.round);
      ctx.fillStyle = profile.color || '#ffb347';
      ctx.font = 'bold 34px Inter, sans-serif';
      ctx.fillText(`${profile.title} DETECTED`, 150, H * 0.34 + 62);
      ctx.fillStyle = '#eef2ff';
      ctx.font = '22px Inter, sans-serif';
      ctx.fillText(profile.subtitle || 'Warning: final wave pressure rising.', 150, H * 0.34 + 104);
    }
    if (state.bossWave && state.bossSpawned && state.enemies.some((e) => e.boss)) {
      const boss = state.enemies.find((e) => e.boss);
      ctx.fillStyle = boss?.color || '#ffb347';
      ctx.font = '700 18px Inter, sans-serif';
      ctx.fillText(`${boss?.name || 'MINIBOSS'} • PHASE ${boss?.phase || 1}`, W - 300, 48);
    }
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.18, state.flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.over && !state.rewardPending) {
      ctx.fillStyle = 'rgba(5,6,10,.74)';
      ctx.fillRect(70, H * 0.36, W - 140, 210);
      ctx.fillStyle = '#eef2ff';
      ctx.font = 'bold 46px Inter, sans-serif';
      ctx.fillText('Drill-Ship Down', 120, H * 0.36 + 76);
      ctx.font = '28px Inter, sans-serif';
      ctx.fillStyle = '#d6deff';
      ctx.fillText('Tap the button above or click here to restart.', 120, H * 0.36 + 128);
    }
    ctx.restore();
  }

  function renderAll() {
    const totalScore = state ? Math.round(state.totalScore + state.score) : meta.bestScore;
    const stats = [
      ['Best Score', meta.bestScore || 0],
      ['Best Round', `R${meta.bestRound || 0}`],
      ['Best Wave', meta.bestWave || 1],
      ['Run Score', totalScore],
      ['Round', state ? `R${state.round}` : '--'],
      ['Lives', state ? Math.max(0, state.lives) : 5],
      ['Kills', state ? state.totalKills + state.kills : 0],
      ['Rank', state ? getRoundRank().rank : 'C'],
      ['Combo', state ? state.bestCombo : 0],
      ['Near Miss', state ? state.nearMisses : 0],
      ['Risk', state ? state.riskPickups : 0],
      ['Boss', state && state.bossWave ? (state.bossName || getBossProfile(state.round).name) : '--'],
      ['Shield', state && state.shieldTimer > 0 ? `${state.shieldCharges} hit${state.shieldCharges === 1 ? '' : 's'}` : 'Off'],
      ['Power', state && state.specialTimer > 0 ? `${state.weaponMode === 'laser' ? 'Laser' : 'Spread'} ${state.specialTimer.toFixed(1)}s` : state && state.specialCooldown > 0 ? `CD ${state.specialCooldown.toFixed(1)}s` : 'Ready'],
      ['Stored WinLEW', loadWallet().toFixed(2)]
    ];
    statsEl.innerHTML = stats.map(([k,v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
    progressEl.textContent = `Round ${state ? state.round : 1}${state && state.round >= 4 ? ` • Endless +${state.round - 3}` : ''} • Wave: ${state ? state.wave : 1} / 6${state ? ` • ${state.waveTheme || getWaveTheme(state.wave)}` : ''}`;
    milestoneEl.textContent = state ? `Rank ${getRoundRank().rank} • Stash: ${state.totalShards + state.shardsRecovered} recovered` : 'Rank C • Stash: 0 recovered';
    modeEl.textContent = !state ? 'Ready' : state.rewardPending ? 'Reward Ready' : state.over ? 'Down' : state.paused ? 'Paused' : 'Running';
    const startLabel = !state ? 'Start Run' : state.rewardPending ? 'Reward Ready' : state.over ? 'Restart Run' : state.paused ? 'Resume' : 'Running';
    [ $('blasterStartBtn'), $('blasterStartTop') ].forEach((btn) => { if (btn) btn.textContent = startLabel; });
    renderBoardList(boardEl, board, 'blaster');
    if (!logs.length) addLog("Lew's drill-ship on standby.");
    views.blaster.classList.toggle('hub-active-run', Boolean(state && !state.over));
  }

  function updatePointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = clamp((clientX - rect.left) / rect.width * W, 28, W - 28);
    pointer.y = clamp((clientY - rect.top) / rect.height * H, 76, H - 58);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (views.blaster.classList.contains('hidden')) return;
    if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
    pointer.active = true;
    updatePointer(e.clientX, e.clientY);
    if (!state || state.over) start(nextUnlockedRound());
  });
  canvas.addEventListener('pointermove', (e) => {
    if (views.blaster.classList.contains('hidden') || !pointer.active) return;
    updatePointer(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', () => { pointer.active = false; });
  canvas.addEventListener('mousemove', (e) => {
    if (views.blaster.classList.contains('hidden')) return;
    if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
    if (window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
      pointer.active = true;
      updatePointer(e.clientX, e.clientY);
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (window.matchMedia && window.matchMedia('(pointer:fine)').matches) pointer.active = false;
  });
  window.addEventListener('keydown', (e) => {
    if (views.blaster.classList.contains('hidden')) return;
    const key = e.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(key)) {
      keys.add(key);
      e.preventDefault();
    }
    if (key === 'p' && state && !state.rewardPending) {
      state.paused = !state.paused;
      renderAll();
    }
  }, true);
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(key)) keys.delete(key);
  }, true);

  function startOrResume() {
    if (rewardOverlay && !rewardOverlay.classList.contains('hidden')) return;
    if (!state) start(nextUnlockedRound());
    else if (state.rewardPending) return;
    else if (state.over) start(nextUnlockedRound());
    else { state.paused = false; modeEl.textContent = 'Running'; renderAll(); }
    // Bring the canvas into view, not the top of the whole site — scrolling
    // to page-top here (as this used to) jumps away from the game itself
    // whenever Start/Resume is tapped mid-session, not just on first launch.
    canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  $('blasterStartBtn').onclick = startOrResume;
  $('blasterResetBtn').onclick = reset;
  $('blasterStartTop').onclick = startOrResume;
  $('blasterResetTop').onclick = reset;
  $('blasterHomeTop').onclick = () => { hideRewardOverlay(); showView('hub'); renderHubBoards(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  renderAll();
  draw();
  return { startOrResume, reset, renderAll, draw };
      })();
    }
  };
})();
