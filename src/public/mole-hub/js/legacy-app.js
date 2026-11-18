const Storage = {
  sound: 'winlew.sound',
  diglew: 'winlew.diglew.progress',
  diglewBoard: 'winlew.diglew.board',
  pacBoard: 'winlew.pac.board',
  pacState: 'winlew.pac.state',
  pacClaims: 'winlew.pac.claims',
  wallet: 'winlew.wallet'
};

const views = {
  hub: document.getElementById('hubView'),
  diglew: document.getElementById('diglewView'),
  pac: document.getElementById('pacmoleView')
};
const soundToggle = document.getElementById('soundToggle');
const homeBtn = document.getElementById('homeBtn');

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


function loadWallet() { return Number(load(Storage.wallet, 0)) || 0; }
function saveWallet(value) { save(Storage.wallet, Number(value.toFixed(2))); }
function addWallet(amount) {
  const next = loadWallet() + Number(amount || 0);
  saveWallet(next);
  return next;
}

const AuthKeys = {
  session: 'winlew.verify.session',
  app: 'winlew.verify.app',
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

async function postRewardClaim(payload) {
  const auth = getAuthContext();
  if (!auth.session) return { ok: false, skipped: true, reason: 'no_session' };
  try {
    const res = await fetch('/api/rewards/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: auth.session, app: auth.app, ...payload }),
    });
    return await res.json();
  } catch (error) {
    return { ok: false, error: error?.message || 'claim_failed' };
  }
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
function showRewardOverlay({ title, badge = 'Reward reveal', text, boxes = [], onPick, continueLabel = 'Continue', onContinue }) {
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

  const reveal = (resultText) => {
    rewardResult.innerHTML = resultText;
    rewardResult.classList.remove('hidden');
    rewardContinueBtn.classList.remove('hidden');
    rewardContinueBtn.textContent = continueLabel;
    rewardContinueBtn.onclick = () => {
      hideRewardOverlay();
      if (typeof onContinue === 'function') onContinue();
    };
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
    btn.onclick = () => {
      rewardBoxes.querySelectorAll('button').forEach((b) => b.disabled = true);
      btn.classList.add('revealed');
      const resultText = onPick ? onPick(box, idx) : `${box.multiplier || 1}x`;
      reveal(resultText);
    };
    rewardBoxes.appendChild(btn);
  });
}
function buildRewardBoxes() {
  const multipliers = [0.5, 1, 1.5, 2].sort(() => Math.random() - 0.5);
  return multipliers.map((multiplier, index) => ({
    multiplier,
    label: `Reward Box Pick ${index + 1}`
  }));
}

const Sound = {
  enabled: load(Storage.sound, true),
  ctx: null,
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  blip(freq = 440, time = 0.07, type = 'square', gainValue = 0.03) {
    if (!this.enabled) return;
    this.ensure();
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


function updateRouteForView(key) {
  const url = new URL(window.location.href);
  if (key === 'diglew') {
    url.searchParams.set('game', 'diglew');
    url.hash = 'diglew';
  } else if (key === 'pac') {
    url.searchParams.set('game', 'pacmole');
    url.hash = 'pacmole';
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
  return 'hub';
}

function showView(key) {
  Object.entries(views).forEach(([name, el]) => el.classList.toggle('hidden', name !== key));
  homeBtn.classList.toggle('hidden', key === 'hub');
  updateRouteForView(key);
}
homeBtn.addEventListener('click', () => { showView('hub'); renderHubBoards(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
document.querySelectorAll('[data-launch]').forEach((btn) => btn.addEventListener('click', () => {
  const game = btn.dataset.launch;
  if (game === 'diglew') {
    showView('diglew');
    diglew.startRun();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (game === 'pacmole') {
    showView('pac');
    pac.startOrResume();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}));

function renderBoardList(el, items, type) {
  el.innerHTML = '';
  if (!items.length) {
    el.innerHTML = '<li>No runs yet.</li>';
    return;
  }
  items.slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    if (type === 'diglew') {
      li.innerHTML = `<strong>${item.score}</strong> pts — ${item.worms} worms, ${item.depth} depth, ${item.turns} turns${item.payout ? ` • ${item.payout} WinLEW` : ''}`;
    } else {
      li.innerHTML = `<strong>${item.score}</strong> pts — L${item.level}, ${item.worms} worms, ${item.beetles} beetles, ${item.dashes || 0} dashes${item.reward ? ` • ${item.reward} WinLEW` : ''}`;
    }
    el.appendChild(li);
  });
}
function renderHubBoards() {
  renderBoardList($('hubDiglewBoard'), load(Storage.diglewBoard, []), 'diglew');
  renderBoardList($('hubPacBoard'), load(Storage.pacBoard, []), 'pac');
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

const diglew = (() => {
  const canvas = $('diglewCanvas');
  const ctx = canvas.getContext('2d');
  const COLS = 29, ROWS = 19, TILE = 34;
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

  const defaultProgress = {
    worms: 20,
    winlew: 0,
    city: { scanner: 0, forge: 0, larder: 0, brace: 0 },
    bestDepth: 0,
    totalRuns: 0,
    unlocked: 1
  };
  const upgrades = {
    scanner: { name: 'Scanner Lab', desc: 'Reveal more of the maze and improve Q pulse.', base: 6, max: 5 },
    forge: { name: 'Claw Forge', desc: 'Lower movement cost and squeeze more turns out of a run.', base: 7, max: 5 },
    larder: { name: 'Larder Vault', desc: 'Start runs with more energy and larger carrying capacity.', base: 5, max: 5 },
    brace: { name: 'Burrow Bracing', desc: 'Reduce hazard damage and slow the hunter down.', base: 6, max: 5 }
  };
  let progress = load(Storage.diglew, defaultProgress);
  let board = load(Storage.diglewBoard, []);
  let log = [];
  let run = null;
let pendingDiglewReward = null;

  function getEffects() {
    return {
      reveal: 2 + progress.city.scanner,
      pulse: 4 + progress.city.scanner,
      moveCost: Math.max(1, 2 - Math.floor(progress.city.forge / 3)),
      startEnergy: 34 + progress.city.larder * 7,
      carry: 6 + progress.city.larder * 3,
      hazardDamage: Math.max(1, 5 - Math.floor(progress.city.brace / 2)),
      hunterDelay: Math.max(2, 5 - Math.floor(progress.city.brace / 2)),
      baseTurns: 96 + progress.city.forge * 10
    };
  }

  function resetProgress() {
    progress = JSON.parse(JSON.stringify(defaultProgress));
    board = [];
    save(Storage.diglew, progress);
    save(Storage.diglewBoard, board);
    run = null;
    log = ['Progress reset. Your colony is back to bare dirt.'];
    renderAll();
    draw();
    renderHubBoards();
  }

  function addLog(msg) {
    log.unshift(msg);
    log = log.slice(0, 18);
    logEl.innerHTML = log.map((m) => `<div class="log-entry">${m}</div>`).join('');
  }

  function buildMaze() {
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(1));
    function carve(x, y) {
      grid[y][x] = 0;
      const dirs = [[2,0],[-2,0],[0,2],[0,-2]].sort(() => Math.random() - 0.5);
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx > 0 && ny > 0 && nx < COLS - 1 && ny < ROWS - 1 && grid[ny][nx] === 1) {
          grid[y + dy/2][x + dx/2] = 0;
          carve(nx, ny);
        }
      }
    }
    carve(1, 1);
    for (let i = 0; i < 18; i++) {
      const rx = 2 + rand(COLS - 4), ry = 2 + rand(ROWS - 4);
      for (let y = ry; y < Math.min(ROWS - 1, ry + 2 + rand(2)); y++) {
        for (let x = rx; x < Math.min(COLS - 1, rx + 2 + rand(2)); x++) grid[y][x] = 0;
      }
    }
    const exit = { x: 1, y: 1 };
    const player = { x: 1, y: 2 };
    grid[exit.y][exit.x] = 2;
    grid[player.y][player.x] = 0;
    const open = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (grid[y][x] === 0) open.push({ x, y });

    const worms = [];
    const hazardList = [];
    const gold = [];

    // Guaranteed early route worms.
    const nearStart = open.filter((p) => dist(p, player) >= 2 && dist(p, player) <= 6).sort((a, b) => dist(a, player) - dist(b, player));
    for (let i = 0; i < 6 && i < nearStart.length; i++) worms.push({ ...nearStart[i] });

    const farOpen = open.filter((p) => dist(p, player) > 6);
    const wormCount = 20 + rand(8);
    const hazards = 12 + rand(5);
    for (let i = worms.length; i < wormCount; i++) placeUnique(farOpen, worms, player, exit, 4, []);
    for (let i = 0; i < 3; i++) placeUnique(farOpen, gold, player, exit, 8, worms);
    // Hazards are biased near worms and gold, but not at spawn.
    const hazardCandidates = [...worms, ...gold].flatMap((item) => [
      { x: item.x + 1, y: item.y }, { x: item.x - 1, y: item.y }, { x: item.x, y: item.y + 1 }, { x: item.x, y: item.y - 1 }
    ]).filter((p) => p.x > 0 && p.y > 0 && p.x < COLS - 1 && p.y < ROWS - 1 && grid[p.y][p.x] === 0 && dist(p, player) > 5);
    while (hazardList.length < hazards && hazardCandidates.length) {
      const idx = rand(hazardCandidates.length);
      const p = hazardCandidates.splice(idx, 1)[0];
      if (hasAt(hazardList, p.x, p.y) < 0 && hasAt(worms, p.x, p.y) < 0 && hasAt(gold, p.x, p.y) < 0) hazardList.push({ ...p });
    }
    while (hazardList.length < hazards) placeUnique(farOpen, hazardList, player, exit, 5, [...worms, ...gold]);

    const finish = farthestOpen(open.filter((p) => !(p.x === exit.x && p.y === exit.y) && !(p.x === player.x && p.y === player.y)), player, exit);
    grid[finish.y][finish.x] = 3;
    const hunter = farthestOpen(open, player, finish);
    return { grid, player, exit, finish, worms, hazardList, gold, hunter };
  }

  function placeUnique(open, arr, player, exit, minDistance, blocked = []) {
    let tries = 500;
    while (tries--) {
      const p = choice(open);
      const occupied = arr.some((a) => a.x === p.x && a.y === p.y) || blocked.some((a) => a.x === p.x && a.y === p.y);
      if (!occupied && dist(p, player) > minDistance && dist(p, exit) > 3) {
        arr.push({ ...p });
        return;
      }
    }
  }
  function farthestOpen(open, player, exit) {
    let best = open[0], bestScore = -1;
    open.forEach((p) => {
      const score = dist(p, player) + dist(p, exit);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return { ...best };
  }
  function hasAt(list, x, y) { return list.findIndex((p) => p.x === x && p.y === y); }

  function startRun() {
    pendingDiglewReward = null;
    hideRewardOverlay();
    const effects = getEffects();
    const m = buildMaze();
    run = {
      ...m,
      energy: effects.startEnergy,
      maxEnergy: effects.startEnergy,
      turns: effects.baseTurns,
      revealed: new Set(),
      carrying: 0,
      goldBag: 0,
      hazardsHit: 0,
      hunterTrail: 0,
      over: false,
      won: false,
      usedSecondWind: false,
      mission: 'Carry what you can, then reach the green finish tunnel.',
      depth: 0,
      steps: 0
    };
    log = [];
    addLog('Run started. Follow the maze, collect worms, and reach the green finish tunnel to bank your haul and reveal a reward box.');
    reveal(run.player.x, run.player.y, effects.reveal + 1);
    renderAll();
    draw();
  }

  function reveal(cx, cy, radius) {
    if (!run) return;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS && Math.hypot(x - cx, y - cy) <= radius + 0.5) run.revealed.add(`${x},${y}`);
      }
    }
  }

  function buyUpgrade(key) {
    const up = upgrades[key];
    const lvl = progress.city[key];
    if (lvl >= up.max) return addLog(`${up.name} is maxed.`);
    const cost = up.base + lvl * 4;
    if (progress.worms < cost) return addLog(`Need ${cost} worms for ${up.name}.`);
    progress.worms -= cost;
    progress.city[key] += 1;
    save(Storage.diglew, progress);
    addLog(`${up.name} upgraded to level ${progress.city[key]}.`);
    Sound.power();
    renderAll();
    renderHubBoards();
  }

  function movePlayer(dx, dy) {
    if (!run || run.over) return;
    const nx = run.player.x + dx;
    const ny = run.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
    const tile = run.grid[ny][nx];
    if (tile === 1) {
      addLog('Solid dirt. That wall is not your route.');
      return;
    }
    const effects = getEffects();
    run.player.x = nx; run.player.y = ny;
    run.energy -= effects.moveCost;
    run.turns -= 1;
    run.steps += 1;
    run.depth = Math.max(run.depth, ny);
    reveal(nx, ny, effects.reveal);
    const wi = hasAt(run.worms, nx, ny);
    if (wi >= 0) {
      run.worms.splice(wi, 1);
      run.carrying += 1;
      run.energy = Math.min(run.maxEnergy, run.energy + 10);
      run.turns += 3;
      addLog(`Worm secured. +1 carried, +10 energy, +3 turns.`);
      Sound.coin();
    }
    const gi = hasAt(run.gold, nx, ny);
    if (gi >= 0) {
      run.gold.splice(gi, 1);
      run.goldBag += 1;
      run.energy = Math.min(run.maxEnergy, run.energy + 6);
      run.turns += 4;
      addLog('Golden grub pocket found. +4 turns and a major score boost if banked.');
      Sound.power();
    }
    const hi = hasAt(run.hazardList, nx, ny);
    if (hi >= 0) {
      run.hazardList.splice(hi, 1);
      run.energy -= effects.hazardDamage;
      run.hazardsHit += 1;
      addLog(`Hazard triggered. -${effects.hazardDamage} energy.`);
      Sound.hurt();
    }
    if (run.player.x === run.finish.x && run.player.y === run.finish.y) {
      finishRun();
      return;
    }
    moveHunter();
    if (run.turns <= 0 && maybeSecondWind()) { renderAll(); draw(); return; }
    if (run.turns <= 0 || run.energy <= 0) failRun(run.turns <= 0 ? 'Out of turns.' : 'Out of energy.');
    else if (run.hunter.x === run.player.x && run.hunter.y === run.player.y) failRun('The hunter found your route.');
    renderAll(); draw();
  }

  function moveHunter() {
    const effects = getEffects();
    if (run.turns % effects.hunterDelay !== 0) return;
    const next = nextGridStep(
      run.grid.map((row) => row.map((tile) => (tile === 1 ? '#' : '.'))),
      run.hunter,
      run.player,
      {
        passable: (x, y) => run.grid[y][x] !== 1 && !(x === run.exit.x && y === run.exit.y)
      }
    );
    if (next) {
      run.hunter = { x: next.x, y: next.y };
    } else {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]]
        .map(([dx, dy]) => ({ x: run.hunter.x + dx, y: run.hunter.y + dy }))
        .filter((p) => p.x >= 0 && p.y >= 0 && p.x < COLS && p.y < ROWS && run.grid[p.y][p.x] !== 1 && !(p.x === run.exit.x && p.y === run.exit.y));
      if (dirs.length) run.hunter = choice(dirs);
    }
    if (run.hunterTrail > 0) run.hunterTrail--;
  }

  function maybeSecondWind() {
    if (!run || run.over || run.usedSecondWind) return false;
    if (run.turns > 0 || run.energy < 12) return false;
    run.usedSecondWind = true;
    run.energy = Math.max(0, run.energy - 12);
    run.turns = 8;
    addLog('Second wind: 12 energy converted into 8 emergency turns.');
    Sound.power();
    return true;
  }

  function pulse() {
    if (!run || run.over) return;
    run.turns -= 1;
    run.hunterTrail = 4;
    reveal(run.player.x, run.player.y, getEffects().pulse);
    addLog('Scent pulse: nearby dirt exposed, hunter trail exposed briefly.');
    Sound.blip(720, 0.09, 'triangle', 0.04);
    if (run.turns <= 0 && maybeSecondWind()) { renderAll(); draw(); return; }
    if (run.turns <= 0) failRun('Out of turns after pulsing.');
    else { moveHunter(); renderAll(); draw(); }
  }

  function eat() {
    if (!run || run.over) return;
    if (run.carrying <= 0) return addLog('No carried worms to eat.');
    run.carrying -= 1;
    run.energy = Math.min(run.maxEnergy, run.energy + 14);
    addLog('You ate one worm to keep the run alive. +14 energy.');
    Sound.coin();
    renderAll(); draw();
  }

  function bank() {
    if (!run || run.over) return;
    if (run.player.x !== run.finish.x || run.player.y !== run.finish.y) return addLog('Reach the green finish tunnel to bank your run.');
    finishRun();
  }

  function openDiglewRewardFlow(config) {
    pendingDiglewReward = config;
    showRewardOverlay({
      title: config.title,
      badge: config.badge,
      text: config.text,
      boxes: config.boxes,
      continueLabel: config.continueLabel,
      onPick: config.onPick,
      onContinue: () => {
        pendingDiglewReward = null;
        if (typeof config.onContinue === 'function') config.onContinue();
      }
    });
  }

  function finishRun() {
    if (!run || run.over) return;
    run.over = true;
    run.won = true;
    const claimToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const baseReward = run.carrying;
    const colonyGain = run.carrying + run.goldBag * 2;
    const score = run.carrying * 14 + run.goldBag * 80 + run.depth * 3 + Math.max(0, run.turns) * 2 - run.hazardsHit * 9;
    const boxes = buildRewardBoxes();
    Sound.win();
    addLog(`Finish reached. ${run.carrying} worms and ${run.goldBag} gold secured. Pick a reward box to reveal your WinLEW multiplier.`);

    openDiglewRewardFlow({
      claimToken,
      title: 'DigLEW Round Reward',
      badge: 'Finish reached',
      text: `Pick one reward box.<br><br>Your base reward is <strong>${baseReward} WinLEW</strong> at <strong>1 worm = 1 WinLEW</strong>. Gold still boosts your run score and colony worms.`,
      boxes,
      onPick: async (box) => {
        const payout = Number((baseReward * box.multiplier).toFixed(2));
        const walletTotal = addWallet(payout);
        progress.worms += colonyGain;
        progress.winlew = walletTotal;
        progress.totalRuns += 1;
        progress.bestDepth = Math.max(progress.bestDepth, run.depth);
        board.push({ score, worms: run.carrying, depth: run.depth, turns: run.turns, gold: run.goldBag, payout, multiplier: box.multiplier });
        board.sort((a,b) => b.score - a.score);
        board = board.slice(0, 12);
        save(Storage.diglew, progress);
        save(Storage.diglewBoard, board);
        renderHubBoards();
        renderAll();
        draw();

        const claimResponse = await postRewardClaim({
          game: 'diglew',
          roundKey: `finish-${claimToken}`,
          roundLabel: `DigLEW finish ${progress.totalRuns}`,
          baseReward,
          multiplier: box.multiplier,
          payout,
          meta: {
            depth: run.depth,
            worms: run.carrying,
            gold: run.goldBag,
            turnsRemaining: run.turns,
            score,
          },
        });

        if (claimResponse?.ok) {
          return `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> in-app.<br>Wallet total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.<br><span class="muted">Saved to your profile history.</span>`;
        }

        return `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> in-app.<br>Wallet total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`;
      },
      continueLabel: 'Start Next Run',
      onContinue: () => {
        startRun();
      }
    });

    renderAll();
    draw();
  }

  function failRun(reason) {
    run.over = true;
    addLog(`<strong>Run failed.</strong> ${reason}`);
    Sound.hurt();
    renderAll(); draw();
  }

  function renderResources() {
    const effects = getEffects();
    const items = [
      ['Colony Worms', progress.worms],
      ['Stored WinLEW', loadWallet().toFixed(2)],
      ['Best Depth', `${progress.bestDepth}`],
      ['Runs', progress.totalRuns],
      ['Reveal Radius', effects.reveal],
      ['Move Cost', effects.moveCost]
    ];
    resourceEl.innerHTML = items.map(([k,v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
  }

  function renderUpgrades() {
    upgradesEl.innerHTML = Object.entries(upgrades).map(([key, up]) => {
      const lvl = progress.city[key];
      const cost = up.base + lvl * 4;
      const ready = progress.worms >= cost && lvl < up.max;
      let benefit = '';
      if (key === 'scanner') benefit = `Reveal ${2 + lvl} now, pulse ${4 + lvl} next.`;
      if (key === 'forge') benefit = `Move cost ${Math.max(1, 2 - Math.floor(lvl / 3))}. Turns ${96 + lvl * 10}.`;
      if (key === 'larder') benefit = `Start energy ${34 + lvl * 7}. Carry ${6 + lvl * 3}.`;
      if (key === 'brace') benefit = `Hazards hit for ${Math.max(1, 5 - Math.floor(lvl / 2))}. Hunter every ${Math.max(2, 5 - Math.floor(lvl / 2))} turns.`;
      return `<div class="upgrade-card ${ready ? 'ready' : ''}">
        <div class="upgrade-meta"><div><h4>${up.name}</h4><div class="cost">Level ${lvl}/${up.max}</div></div>
        <button class="secondary-btn buy-diglew" data-key="${key}" ${lvl >= up.max ? 'disabled' : ''}>Upgrade</button></div>
        <p>${up.desc}</p><div class="cost">${benefit}</div><div class="cost">Cost: ${cost} worms</div>
      </div>`;
    }).join('');
    upgradesEl.querySelectorAll('.buy-diglew').forEach((btn) => btn.onclick = () => buyUpgrade(btn.dataset.key));
  }

  function renderMission() {
    if (!run) {
      missionYard.textContent = 'City Build';
      missionTitle.textContent = 'Upgrade before the run';
      missionText.textContent = 'Put worms into the city, then start the maze. Upgrades never appear during the run.';
      turnsEl.textContent = 'Turns: --';
      senseEl.textContent = 'Sense: start a run';
      runInfoEl.textContent = 'Run: idle';
      const next = Object.entries(upgrades)
        .map(([key, up]) => ({ key, up, lvl: progress.city[key], cost: up.base + progress.city[key] * 4 }))
        .filter((x) => x.lvl < x.up.max)
        .sort((a,b) => a.cost - b.cost)[0];
      upgradeHintEl.textContent = next ? `Upgrade hint: ${next.up.name} costs ${next.cost} worms.` : 'Upgrade hint: colony maxed.';
      return;
    }
    missionYard.textContent = 'Live Maze';
    missionTitle.textContent = run.over ? (run.won ? 'Finish reached' : 'Run failed') : 'Carry worms to the green finish';
    missionText.textContent = run.over ? (run.won ? 'Reward ready. Pick a box, then launch the next run.' : 'Return to the city and improve before the next route.') : run.mission;
    turnsEl.textContent = `Turns: ${run.turns}`;
    const nearestWorm = run.worms.length ? run.worms.map((w) => dist(w, run.player)).sort((a,b)=>a-b)[0] : '--';
    const nearestGold = run.gold.length ? run.gold.map((g) => dist(g, run.player)).sort((a,b)=>a-b)[0] : '--';
    const hunterD = dist(run.hunter, run.player);
    senseEl.textContent = `Sense: worm ${nearestWorm}, gold ${nearestGold}, hunter ${hunterD}`;
    runInfoEl.textContent = `Run: energy ${run.energy}/${run.maxEnergy}, bag ${run.carrying}/${getEffects().carry}, gold ${run.goldBag}`;
    const finishDistance = dist(run.player, run.finish);
    const carryGoal = finishDistance <= 4 ? 'Finish is close — bank the run.' : `Finish ${finishDistance} steps away.`;
    upgradeHintEl.textContent = `Upgrade hint: ${carryGoal}`;
  }

  function renderBoard() { renderBoardList(boardEl, board, 'diglew'); }
  function renderAll() {
    renderResources(); renderUpgrades(); renderMission(); renderBoard();
    logEl.innerHTML = log.map((m) => `<div class="log-entry">${m}</div>`).join('');
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#020409';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!run) {
      drawCenterText('DigLEW Tycoon', 'Upgrade your city, then press Start Run.');
      return;
    }
    const ox = (canvas.width - COLS * TILE) / 2;
    const oy = 16;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const rx = ox + x * TILE, ry = oy + y * TILE;
        const key = `${x},${y}`;
        const visible = run.revealed.has(key) || (run.hunterTrail > 0 && x === run.hunter.x && y === run.hunter.y);
        if (!visible) {
          ctx.fillStyle = '#000';
          ctx.fillRect(rx, ry, TILE, TILE);
          continue;
        }
        const tile = run.grid[y][x];
        ctx.fillStyle = tile === 1 ? '#4a311d' : '#b49272';
        if (tile === 2) ctx.fillStyle = '#4f96ff';
        if (tile === 3) ctx.fillStyle = '#4fbf73';
        ctx.fillRect(rx, ry, TILE, TILE);
        ctx.strokeStyle = 'rgba(255,255,255,.06)';
        ctx.strokeRect(rx, ry, TILE, TILE);
        if (hasAt(run.hazardList, x, y) >= 0) drawHazard(rx, ry);
        if (hasAt(run.worms, x, y) >= 0) drawWorm(rx, ry);
        if (hasAt(run.gold, x, y) >= 0) drawGold(rx, ry);
      }
    }
    if (run.hunterTrail > 0 || dist(run.hunter, run.player) <= 4) drawHunter(ox + run.hunter.x*TILE, oy + run.hunter.y*TILE);
    drawMole(ox + run.player.x*TILE, oy + run.player.y*TILE);
    if (run.finish) drawFinish(ox + run.finish.x*TILE, oy + run.finish.y*TILE);
    drawEnergyBar();
  }
  function drawCenterText(title, sub) {
    ctx.fillStyle = '#eef2ff';
    ctx.font = 'bold 42px Inter, sans-serif';
    ctx.fillText(title, 80, 120);
    ctx.fillStyle = '#aeb8d6';
    ctx.font = '22px Inter, sans-serif';
    ctx.fillText(sub, 80, 160);
  }
  function drawWorm(x, y) {
    ctx.fillStyle = '#7fe57f';
    ctx.beginPath(); ctx.arc(x + 17, y + 17, 9, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#c9ffc9'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x+10,y+18); ctx.quadraticCurveTo(x+17,y+10,x+24,y+18); ctx.stroke();
  }
  function drawGold(x, y) {
    ctx.fillStyle = '#f0c95b'; ctx.fillRect(x+8,y+8,18,18);
    ctx.strokeStyle='#fff1b1'; ctx.strokeRect(x+8,y+8,18,18);
  }
  function drawHazard(x, y) {
    ctx.strokeStyle = '#ff7676'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x+10,y+25); ctx.lineTo(x+17,y+9); ctx.lineTo(x+24,y+25); ctx.stroke();
  }
  function drawMole(x, y) {
    ctx.fillStyle = '#251813'; ctx.beginPath(); ctx.arc(x+17,y+17,11,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f4c5b6'; ctx.beginPath(); ctx.arc(x+23,y+18,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x+19,y+13,2,0,Math.PI*2); ctx.fill();
  }
  function drawHunter(x, y) {
    ctx.fillStyle = '#a44cff'; ctx.beginPath(); ctx.arc(x+17,y+17,11,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x+14,y+13,2,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(x+20,y+13,2,0,Math.PI*2); ctx.fill();
  }
  function drawFinish(x, y) {
    ctx.strokeStyle = '#c9ffd7';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
  }
  function drawEnergyBar() {
    if (!run) return;
    const x = 36, y = canvas.height - 30, w = 260;
    ctx.fillStyle = '#16213c'; ctx.fillRect(x, y, w, 12);
    ctx.fillStyle = '#6aff8c'; ctx.fillRect(x, y, w * (run.energy / run.maxEnergy), 12);
    ctx.fillStyle = '#eef2ff'; ctx.font = '15px Inter, sans-serif'; ctx.fillText(`Energy ${run.energy}/${run.maxEnergy}`, x, y - 6);
  }

  window.addEventListener('keydown', (e) => {
    if (views.diglew.classList.contains('hidden')) return;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.key)) e.preventDefault();
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowUp' || k === 'w') movePlayer(0,-1);
    if (e.key === 'ArrowDown' || k === 's') movePlayer(0,1);
    if (e.key === 'ArrowLeft' || k === 'a') movePlayer(-1,0);
    if (e.key === 'ArrowRight' || k === 'd') movePlayer(1,0);
    if (k === 'q') pulse();
    if (k === 'e') eat();
    if (k === 'r') bank();
  });

  $('diglewStartBtn').onclick = startRun;
  $('diglewResetBtn').onclick = resetProgress;
  $('diglewStartTop').onclick = startRun;
  $('diglewResetTop').onclick = resetProgress;
  $('diglewHomeTop').onclick = () => { hideRewardOverlay(); showView('hub'); renderHubBoards(); window.scrollTo({ top: 0, behavior: 'auto' }); };
  renderAll(); draw();
  return { renderAll, draw, startRun, resetProgress };
})();

const pac = (() => {
  const canvas = $('pacCanvas');
  const ctx = canvas.getContext('2d');
  const statsEl = $('pacStats');
  const boardEl = $('pacBoard');
  const levelBtns = $('pacLevelButtons');
  const banner = $('pacBanner');
  const sub = $('pacSub');
  const modeEl = $('pacMode');
  const hintEl = $('pacHint');
  const progressEl = $('pacProgress');
  const enemyEl = $('pacEnemyInfo');

  const TILE = 32;
  const defaultState = { unlocked: 1, highLevel: 1 };
  let saveState = load(Storage.pacState, defaultState);
  let claimState = load(Storage.pacClaims, {});
  let board = load(Storage.pacBoard, []);
  let state = null;
  let pacPendingReward = null;
  let raf = 0;
  let last = 0;

  
  function templates() {
    const baseSets = [
      [
        '############################',
        '#............##............#',
        '#.####.#####.##.#####.####.#',
        '#o####.#####.##.#####.####o#',
        '#..........................#',
        '#.####.##.########.##.####.#',
        '#......##....##....##......#',
        '######.#####.##.#####.######',
        '#......##..........##......#',
        '#.####.##.##....##.##.####.#',
        '#......##.##.##.##.##......#',
        '######.##.##.##.##.##.######',
        '#..........##..##..........#',
        '#.####.###.######.###.####.#',
        '#......###........###......#',
        '############################',
      ],
      [
        '############################',
        '#............##............#',
        '#.##########.##.##########.#',
        '#o...........##...........o#',
        '#.###.######.##.######.###.#',
        '#...#..................#...#',
        '###.#.##.##########.##.#.###',
        '#...#..#....##......#.#...#',
        '#.#####.###.##.####.#.###.#',
        '#.......#....##..##.#.....#',
        '#.#####.#.##.##.##..#####.#',
        '#.....#.#.##....##..#.....#',
        '###.#.#.##########.#.#.####',
        '#...#................#....#',
        '#.##########.##.#########.#',
        '############################',
      ],
      [
        '############################',
        '#............##............#',
        '#.####.#####.##.#####.####.#',
        '#.....o.....####.....o.....#',
        '#####.#####.####.#####.#####',
        '#..........#....#..........#',
        '#.########.#.##.#.########.#',
        '#.#......#.#.##.#.#......#.#',
        '#.#.####.#.#....#.#.####.#.#',
        '#.#....#.#.######.#.#....#.#',
        '#.####.#.#........#.#.####.#',
        '#......#.#.######.#.#......#',
        '#.######.#.#....#.#.######.#',
        '#...........##.............#',
        '#.#########.##.###########.#',
        '############################',
      ],
      [
        '############################',
        '#......##........##........#',
        '#.####.##.######.##.######.#',
        '#o####....######....#####o.#',
        '#......##........##........#',
        '######.##########.##########',
        '#......##....##....##......#',
        '#.####.##.##.##.##.##.####.#',
        '#.#.......##....##.......#.#',
        '#.#.#####.########.#####.#.#',
        '#.#.....#....##....#.....#.#',
        '#.#####.####.##.####.#####.#',
        '#..........#....#..........#',
        '#.########.######.########.#',
        '#..........................#',
        '############################',
      ],
      [
        '############################',
        '#............##............#',
        '#.##########.##.##########.#',
        '#.#........#.##.#........#.#',
        '#.#.######.#.##.#.######.#.#',
        '#.#.#....#.#....#.#....#.#.#',
        '#.#.#.##.#.######.#.##.#.#.#',
        '#.#.#.##.#........#.##.#.#.#',
        '#.#.#.##.##########.##.#.#.#',
        '#.#.#..................#.#.#',
        '#.#.####################.#.#',
        '#.#......................#.#',
        '#.########################.#',
        '#o........................o#',
        '#..........................#',
        '############################',
      ],
    ];

    function flipH(rows) {
      return rows.map((row) => row.split('').reverse().join(''));
    }
    function flipV(rows) {
      return rows.slice().reverse();
    }
    function rotate180(rows) {
      return flipV(flipH(rows));
    }
    function carve(rows, ops = []) {
      const grid = rows.map((row) => row.split(''));
      ops.forEach(([x, y]) => {
        if (grid[y] && grid[y][x] === '#') grid[y][x] = '.';
      });
      return grid.map((row) => row.join(''));
    }

    return [
      baseSets[0],
      flipH(baseSets[0]),
      carve(baseSets[0], [[13, 8], [14, 8], [13, 9], [14, 9]]),
      flipV(baseSets[0]),

      baseSets[1],
      carve(baseSets[1], [[13, 7], [14, 7], [15, 7], [13, 8], [15, 8]]),
      flipH(baseSets[1]),
      rotate180(baseSets[1]),

      baseSets[2],
      flipH(baseSets[2]),
      carve(baseSets[2], [[10, 7], [17, 7], [13, 8], [14, 8]]),
      flipV(baseSets[2]),

      baseSets[3],
      flipH(baseSets[3]),
      carve(baseSets[3], [[6, 8], [7, 8], [20, 8], [21, 8]]),
      rotate180(baseSets[3]),

      baseSets[4],
      flipH(baseSets[4]),
      carve(baseSets[4], [[13, 5], [14, 5], [13, 10], [14, 10]]),
      flipV(baseSets[4]),
    ];
  }

function normalizeTemplate(rows) {
    const width = Math.max(...rows.map((r) => r.length));
    return rows.map((row) => row.padEnd(width, '#').replace(/ /g, '#').split(''));
  }

  function reachableSet(map, start) {
    const seen = new Set([keyOf(start.x, start.y)]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]) {
        let nx = cur.x + d.x;
        let ny = cur.y + d.y;
        if (nx < 0) nx = map[0].length - 1;
        if (nx >= map[0].length) nx = 0;
        if (ny < 0 || ny >= map.length) continue;
        if (map[ny][nx] === '#') continue;
        const k = keyOf(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
    return seen;
  }

  function ensureReachable(map, start) {
    let seen = reachableSet(map, start);
    let changed = true;
    while (changed) {
      changed = false;
      let target = null;
      outer: for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[0].length; x++) {
          if (map[y][x] !== '#' && !seen.has(keyOf(x, y))) { target = { x, y }; break outer; }
        }
      }
      if (!target) break;
      const reachableCells = [];
      for (const entry of seen) {
        const [x, y] = entry.split(',').map(Number);
        reachableCells.push({ x, y });
      }
      reachableCells.sort((a, b) => dist(a, target) - dist(b, target));
      const near = reachableCells[0];
      if (!near) break;
      let x = target.x, y = target.y;
      while (x !== near.x) {
        x += x < near.x ? 1 : -1;
        if (map[y][x] === '#') map[y][x] = '.';
      }
      while (y !== near.y) {
        y += y < near.y ? 1 : -1;
        if (map[y][x] === '#') map[y][x] = '.';
      }
      seen = reachableSet(map, start);
      changed = true;
    }
    return map;
  }

  function makeLevel(num) {
    let temp = normalizeTemplate(templates()[(num - 1) % templates().length]);
    let playerSpawn = { x: 1, y: 1 };
    temp = ensureReachable(temp, playerSpawn);
    const worms = [];
    const powers = [];
    const paths = [];
    for (let y = 0; y < temp.length; y++) {
      for (let x = 0; x < temp[0].length; x++) {
        const ch = temp[y][x];
        if (ch !== '#') paths.push({ x, y });
        if (ch === '.') worms.push({ x, y, eaten: false });
        if (ch === 'o') powers.push({ x, y, eaten: false });
      }
    }
    playerSpawn = paths.find((p) => p.x === 1 && p.y === 1) || paths[0];
    const player = { x: playerSpawn.x, y: playerSpawn.y, dir: { x: 0, y: 0 }, next: { x: 0, y: 0 } };
    const enemyCount = Math.min(4, 1 + Math.floor((num - 1) / 3));
    const enemies = [];
    const spawns = paths.filter((p) => dist(p, player) > 10);
    for (let i = 0; i < enemyCount; i++) {
      const spot = spawns[(i * 11 + 7) % spawns.length];
      enemies.push({
        x: spot.x,
        y: spot.y,
        dir: choice([{x:1,y:0},{x:-1,y:0},{x:0, y:1},{x:0,y:-1}]),
        vulnerable: 0,
        home: { x: spot.x, y: spot.y },
        lastDir: { x: 0, y: 0 }
      });
    }
    return {
      num,
      map: temp,
      width: temp[0].length,
      height: temp.length,
      player,
      enemies,
      worms,
      powers,
      score: 0,
      lives: 4,
      cleared: false,
      paused: false,
      powerTimer: 0,
      speed: Math.max(0.085, 0.16 - num * 0.0035),
      enemySpeed: Math.max(0.095, 0.18 - num * 0.003),
      pacClock: 0,
      enemyClock: 0,
      wormsLeft: worms.length + powers.length,
      dashCooldown: 0,
      dashUsed: 0,
      beetlesEaten: 0,
      rewardPending: false
    };
  }

  function isWall(map, x, y) {
    if (y < 0 || x < 0 || y >= map.length || x >= map[0].length) return true;
    return map[y][x] === '#';
  }

  function wrappedNextStep(map, start, target) {
    const width = map[0].length;
    const height = map.length;
    const queue = [{ x: start.x, y: start.y }];
    const came = new Map([[keyOf(start.x, start.y), null]]);
    while (queue.length) {
      const cur = queue.shift();
      if (cur.x === target.x && cur.y === target.y) break;
      for (const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]) {
        let nx = cur.x + d.x;
        let ny = cur.y + d.y;
        if (nx < 0) nx = width - 1;
        if (nx >= width) nx = 0;
        if (ny < 0 || ny >= height) continue;
        if (isWall(map, nx, ny)) continue;
        const nk = keyOf(nx, ny);
        if (came.has(nk)) continue;
        came.set(nk, cur);
        queue.push({ x: nx, y: ny });
      }
    }
    if (!came.has(keyOf(target.x, target.y))) return null;
    let step = { x: target.x, y: target.y };
    while (true) {
      const prev = came.get(keyOf(step.x, step.y));
      if (!prev) return null;
      if (prev.x === start.x && prev.y === start.y) return step;
      step = prev;
    }
  }

  function start(level = saveState.unlocked) {
    pacPendingReward = null;
    hideRewardOverlay();
    cancelAnimationFrame(raf);
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    state = makeLevel(level);
    banner.textContent = `Level ${level} — ${levelName(level)}`;
    sub.textContent = 'Collect every worm. Glow-grubs trigger power mode. SPACE dashes through one wall segment.';
    modeEl.textContent = 'Running';
    hintEl.textContent = 'Tip: dash costs 1 worm and has a cooldown. Save it for corners or clutch escapes.';
    last = 0;
    loop(performance.now());
    renderAll();
  }

  function resetRun() {
    pacPendingReward = null;
    hideRewardOverlay();
    saveState = { unlocked: 1, highLevel: 1 };
    board = [];
    claimState = {};
    save(Storage.pacState, saveState);
    save(Storage.pacBoard, board);
    cancelAnimationFrame(raf);
    start(1);
    renderHubBoards();
  }

  function levelName(n) {
    const names = ['Pantry Loop','Root Riot','Sprinkler Grid','Moonlight Burrows','Bedrock Shift','Gutter Lines','Mulch Maze','Fence Run','Grub Vault','Storm Drain','Stone Teeth','Dry Yard','Ivy Loop','Rafter Roots','Cracked Clay','Garden War','Deep Pantry','Tunnel Crown','Mole King','Night Harvest'];
    return names[n - 1] || `Level ${n}`;
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!state) return;
    const dt = Math.min(40, ts - last || 16);
    last = ts;
    if (!state.paused && !state.cleared) update(dt / 1000);
    draw();
  }

  function update(dt) {
    state.pacClock += dt;
    state.enemyClock += dt;
    state.dashCooldown = Math.max(0, state.dashCooldown - dt);
    if (state.powerTimer > 0) {
      state.powerTimer = Math.max(0, state.powerTimer - dt);
      if (state.powerTimer <= 0) state.enemies.forEach((e) => e.vulnerable = 0);
    }

    if (state.pacClock >= state.speed) {
      state.pacClock = 0;
      movePac();
      eatStuff();
      checkEnemyCollisions();
    }
    if (state.enemyClock >= state.enemySpeed) {
      state.enemyClock = 0;
      moveEnemies();
      checkEnemyCollisions();
    }
    renderAll();
  }

  function movePac() {
    const p = state.player;
    const tryDir = p.next;
    if (!isWall(state.map, p.x + tryDir.x, p.y + tryDir.y)) p.dir = { ...tryDir };
    if (!isWall(state.map, p.x + p.dir.x, p.y + p.dir.y)) {
      p.x += p.dir.x; p.y += p.dir.y;
      if (p.x < 0) p.x = state.width - 1; if (p.x >= state.width) p.x = 0;
    }
  }

  function eatStuff() {
    let got = false;
    state.worms.forEach((w) => {
      if (!w.eaten && w.x === state.player.x && w.y === state.player.y) {
        w.eaten = true; state.score += 10; state.wormsLeft -= 1; got = true;
      }
    });
    state.powers.forEach((p) => {
      if (!p.eaten && p.x === state.player.x && p.y === state.player.y) {
        p.eaten = true; state.score += 50; state.wormsLeft -= 1; state.powerTimer = 8; state.enemies.forEach((e) => e.vulnerable = 8); got = true; Sound.power();
      }
    });
    if (got) Sound.coin();
    if (state.wormsLeft <= 0) levelComplete();
  }

  function opposite(dir) { return { x: -dir.x, y: -dir.y }; }
  function sameDir(a, b) { return a.x === b.x && a.y === b.y; }

  function moveEnemies() {
    state.enemies.forEach((e) => {
      const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
      const reverse = { x: -e.lastDir.x, y: -e.lastDir.y };
      let options = dirs.filter((d) => {
        let nx = e.x + d.x;
        let ny = e.y + d.y;
        if (nx < 0) nx = state.width - 1;
        if (nx >= state.width) nx = 0;
        if (ny < 0 || ny >= state.height) return false;
        return !isWall(state.map, nx, ny);
      });
      if (options.length > 1) options = options.filter((d) => !(d.x === reverse.x && d.y === reverse.y));
      let bestDir = options[0] || e.dir;
      if (e.vulnerable > 0) {
        let farScore = -1;
        options.forEach((d) => {
          let nx = e.x + d.x;
          let ny = e.y + d.y;
          if (nx < 0) nx = state.width - 1;
          if (nx >= state.width) nx = 0;
          const score = dist({ x: nx, y: ny }, state.player);
          if (score > farScore) { farScore = score; bestDir = d; }
        });
        e.vulnerable = Math.max(0, e.vulnerable - state.enemySpeed);
      } else {
        const next = wrappedNextStep(state.map, { x: e.x, y: e.y }, { x: state.player.x, y: state.player.y });
        if (next) {
          let dx = next.x - e.x;
          let dy = next.y - e.y;
          if (dx > 1) dx = -1;
          if (dx < -1) dx = 1;
          if (options.some((d) => d.x === dx && d.y === dy)) bestDir = { x: dx, y: dy };
        }
      }
      e.dir = bestDir;
      e.lastDir = bestDir;
      e.x += bestDir.x;
      e.y += bestDir.y;
      if (e.x < 0) e.x = state.width - 1;
      if (e.x >= state.width) e.x = 0;
    });
  }

  function checkEnemyCollisions() {
    state.enemies.forEach((e) => {
      if (e.x === state.player.x && e.y === state.player.y) {
        if (e.vulnerable > 0) {
          state.score += 200;
          state.beetlesEaten += 1;
          e.x = e.home.x; e.y = e.home.y; e.vulnerable = 0;
          Sound.win();
        } else {
          state.lives -= 1; Sound.hurt();
          if (state.lives <= 0) gameOver();
          else {
            const spawn = { x: 1, y: 1 };
            state.player.x = spawn.x; state.player.y = spawn.y; state.player.dir = { x: 0, y: 0 }; state.player.next = { x: 0, y: 0 };
            state.enemies.forEach((enemy) => { enemy.x = enemy.home.x; enemy.y = enemy.home.y; enemy.dir = choice([{x:1,y:0},{x:-1,y:0},{x:0, y:1},{x:0,y:-1}]); });
          }
        }
      }
    });
  }

  function dash() {
    if (!state || state.paused || state.cleared) return;
    if (state.dashCooldown > 0) {
      hintEl.textContent = `Dash cooling down: ${state.dashCooldown.toFixed(1)}s`;
      return;
    }
    const availableWorms = state.worms.filter((w) => w.eaten).length + state.powers.filter((p) => p.eaten).length;
    if (availableWorms <= state.dashUsed) {
      hintEl.textContent = 'Need one collected worm to fuel a dash.';
      return;
    }
    let dir = state.player.dir;
    if (dir.x === 0 && dir.y === 0) dir = state.player.next;
    if (dir.x === 0 && dir.y === 0) return;

    const firstX = state.player.x + dir.x;
    const firstY = state.player.y + dir.y;
    if (!isWall(state.map, firstX, firstY)) {
      hintEl.textContent = 'Dash works when you punch through a wall.';
      return;
    }

    let landing = null;
    let wallsCrossed = 0;
    for (let step = 1; step <= 3; step++) {
      const tx = state.player.x + dir.x * step;
      const ty = state.player.y + dir.y * step;
      if (tx < 0 || ty < 0 || ty >= state.map.length || tx >= state.map[0].length) break;
      if (isWall(state.map, tx, ty)) {
        wallsCrossed += 1;
        continue;
      }
      landing = { x: tx, y: ty };
      break;
    }

    if (!landing || wallsCrossed < 1 || wallsCrossed > 2) {
      hintEl.textContent = 'No safe tunnel within two wall segments.';
      return;
    }

    state.player.x = landing.x;
    state.player.y = landing.y;
    state.player.dir = { ...dir };
    state.player.next = { ...dir };
    state.dashCooldown = 3.2;
    state.dashUsed += 1;
    state.score = Math.max(0, state.score - 5);
    Sound.dash();
    eatStuff();
    checkEnemyCollisions();
    hintEl.textContent = `Burrow Dash used through ${wallsCrossed} wall segment${wallsCrossed > 1 ? 's' : ''}. Worm spent, cooldown started.`;
  }

  function openPacRewardFlow(config) {
    pacPendingReward = config;
    showRewardOverlay({
      title: config.title,
      badge: config.badge,
      text: config.text,
      boxes: config.boxes,
      continueLabel: config.continueLabel,
      onPick: config.onPick,
      onContinue: () => {
        pacPendingReward = null;
        if (typeof config.onContinue === 'function') config.onContinue();
      }
    });
  }

  function levelComplete() {
    state.cleared = true;
    state.paused = true;
    state.rewardPending = true;
    Sound.win();
    state.score += state.lives * 100;
    saveState.unlocked = Math.max(saveState.unlocked, Math.min(20, state.num + 1));
    saveState.highLevel = Math.max(saveState.highLevel, state.num);
    save(Storage.pacState, saveState);
    modeEl.textContent = 'Level cleared';
    const baseReward = 100 + (state.num - 1) * 50;
    const claimKey = String(state.num);
    const lastClaim = Number(claimState[claimKey] || 0);
    const now = Date.now();
    const eligible = !lastClaim || (now - lastClaim) >= 86400000;
    const claimToken = `${state.num}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const advance = () => {
      state.rewardPending = false;
      if (state.num < 20) start(state.num + 1);
      else start(1);
    };

    if (!eligible) {
      const remainingMs = 86400000 - (now - lastClaim);
      const hours = Math.ceil(remainingMs / 3600000);
      hintEl.textContent = `Level reward already claimed. Practice clears stay open; reward resets in about ${hours}h.`;
      board.push({ score: state.score, level: state.num, worms: state.worms.length + state.powers.length, beetles: state.beetlesEaten, dashes: state.dashUsed, reward: 0 });
      board.sort((a,b) => b.score - a.score);
      board = board.slice(0, 12);
      save(Storage.pacBoard, board);
      renderHubBoards();
      renderAll();
      openPacRewardFlow({
        claimToken,
        title: 'Round Reward',
        badge: 'Practice clear',
        text: `Level ${state.num} is still playable, but its WinLEW payout can only be claimed once every 24 hours.<br><br>Your base reward would be <strong>${baseReward} WinLEW</strong>, but this run is marked as practice only.`,
        boxes: [],
        continueLabel: state.num < 20 ? 'Next Round' : 'Restart Campaign',
        onContinue: advance
      });
      return;
    }

    const boxes = buildRewardBoxes();
    hintEl.textContent = 'Pick a reward box before moving to the next round.';
    renderAll();
    openPacRewardFlow({
      claimToken,
      title: 'Round Reward',
      badge: `Level ${state.num} clear`,
      text: `Pick one reward box.<br><br>Level ${state.num} base reward is <strong>${baseReward} WinLEW</strong>. Choose one box to reveal your multiplier.`,
      boxes,
      continueLabel: state.num < 20 ? 'Next Round' : 'Restart Campaign',
      onPick: async (box) => {
        const payout = Number((baseReward * box.multiplier).toFixed(2));
        const walletTotal = addWallet(payout);
        claimState[claimKey] = Date.now();
        save(Storage.pacClaims, claimState);
        board.push({ score: state.score, level: state.num, worms: state.worms.length + state.powers.length, beetles: state.beetlesEaten, dashes: state.dashUsed, reward: payout });
        board.sort((a,b) => b.score - a.score);
        board = board.slice(0, 12);
        save(Storage.pacBoard, board);
        renderHubBoards();
        renderAll();

        const claimResponse = await postRewardClaim({
          game: 'pacmole',
          roundKey: `level-${state.num}-${claimToken}`,
          roundLabel: `Pac-Mole Level ${state.num}`,
          baseReward,
          multiplier: box.multiplier,
          payout,
          meta: {
            level: state.num,
            score: state.score,
            worms: state.worms.length + state.powers.length,
            beetles: state.beetlesEaten,
            dashes: state.dashUsed,
          },
        });

        if (claimResponse?.ok) {
          return `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> in-app.<br>Wallet total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.<br><span class="muted">Saved to your profile history.</span>`;
        }

        return `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> in-app.<br>Wallet total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`;
      },
      onContinue: advance
    });
  }

  function gameOver() {
    modeEl.textContent = 'Game over';
    board.push({ score: state.score, level: state.num, worms: (state.worms.length + state.powers.length) - state.wormsLeft, beetles: state.beetlesEaten, dashes: state.dashUsed });
    board.sort((a,b) => b.score - a.score);
    board = board.slice(0, 12);
    save(Storage.pacBoard, board);
    renderHubBoards(); renderAll();
    state.paused = true;
  }

  function renderAll() {
    const collectedWorms = state ? (state.worms.filter((w) => w.eaten).length + state.powers.filter((p) => p.eaten).length) : 0;
    const stats = [
      ['Level', state ? state.num : saveState.unlocked],
      ['Score', state ? state.score : 0],
      ['Lives', state ? state.lives : 4],
      ['Worms Left', state ? state.wormsLeft : '--'],
      ['Dash Fuel', state ? `${Math.max(0, collectedWorms - state.dashUsed)}` : '--'],
      ['Wallet WinLEW', loadWallet().toFixed(2)],
      ['Best Level', saveState.highLevel]
    ];
    statsEl.innerHTML = stats.map(([k,v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
    progressEl.textContent = `Progress: ${saveState.highLevel} / 20 cleared`;
    const dashReady = state ? (state.dashCooldown <= 0 ? 'ready' : `${state.dashCooldown.toFixed(1)}s`) : '--';
    enemyEl.textContent = `Beetles: ${state ? state.enemies.length : '--'} • Dash ${dashReady}${state && state.powerTimer > 0 ? ' • power mode' : ''}`;
    renderBoardList(boardEl, board, 'pac');
    renderLevelButtons();
  }

  function renderLevelButtons() {
    levelBtns.innerHTML = '';
    for (let i = 1; i <= 20; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      if (state && state.num === i) btn.classList.add('current');
      if (i > saveState.unlocked) btn.classList.add('locked');
      btn.disabled = i > saveState.unlocked;
      btn.onclick = () => {
        if (state && state.rewardPending && pacPendingReward) {
          rewardOverlay.classList.remove('hidden');
          rewardOverlay.setAttribute('aria-hidden', 'false');
          return;
        }
        start(i);
      };
      levelBtns.appendChild(btn);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#020409';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state) {
      ctx.fillStyle = '#eef2ff'; ctx.font = 'bold 40px Inter'; ctx.fillText('Pac-Mole', 80, 120);
      ctx.fillStyle = '#aeb8d6'; ctx.font = '22px Inter'; ctx.fillText('Press Start / Resume to begin the 20-level run.', 80, 160);
      return;
    }
    const ox = (canvas.width - state.width * TILE) / 2;
    const oy = 36;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const rx = ox + x * TILE, ry = oy + y * TILE;
        if (state.map[y][x] === '#') {
          ctx.fillStyle = '#2a3d92';
          ctx.fillRect(rx, ry, TILE, TILE);
          ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.strokeRect(rx, ry, TILE, TILE);
        } else {
          ctx.fillStyle = '#111'; ctx.fillRect(rx, ry, TILE, TILE);
        }
      }
    }
    state.worms.forEach((w) => { if (!w.eaten) { ctx.fillStyle = '#7fe57f'; ctx.beginPath(); ctx.arc(ox+w.x*TILE+TILE/2, oy+w.y*TILE+TILE/2, 5, 0, Math.PI*2); ctx.fill(); } });
    state.powers.forEach((p) => { if (!p.eaten) { ctx.fillStyle = '#f0c95b'; ctx.beginPath(); ctx.arc(ox+p.x*TILE+TILE/2, oy+p.y*TILE+TILE/2, 8, 0, Math.PI*2); ctx.fill(); } });
    state.enemies.forEach((e, idx) => {
      ctx.fillStyle = e.vulnerable > 0 ? '#47c7ff' : ['#ff7676','#ffa44d','#f15bff','#8cff5c'][idx % 4];
      ctx.beginPath(); ctx.arc(ox+e.x*TILE+TILE/2, oy+e.y*TILE+TILE/2, TILE/2 - 6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ox+e.x*TILE+12, oy+e.y*TILE+13, 3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox+e.x*TILE+20, oy+e.y*TILE+13, 3, 0, Math.PI*2); ctx.fill();
    });
    ctx.fillStyle = '#3a2416'; ctx.beginPath(); ctx.arc(ox+state.player.x*TILE+TILE/2, oy+state.player.y*TILE+TILE/2, TILE/2 - 6, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f4c5b6'; ctx.beginPath(); ctx.arc(ox+state.player.x*TILE+TILE/2+7, oy+state.player.y*TILE+TILE/2+2, 6, 0, Math.PI*2); ctx.fill();
    drawDashBar();
  }

  function drawDashBar() {
    const x = 42, y = canvas.height - 28, w = 220;
    ctx.fillStyle = '#16213c'; ctx.fillRect(x, y, w, 12);
    const fill = state.dashCooldown <= 0 ? 1 : 1 - (state.dashCooldown / 3.2);
    ctx.fillStyle = '#f0c95b'; ctx.fillRect(x, y, w * clamp(fill, 0, 1), 12);
    ctx.fillStyle = '#eef2ff'; ctx.font = '15px Inter, sans-serif';
    ctx.fillText(`Burrow Dash ${state.dashCooldown <= 0 ? 'Ready' : state.dashCooldown.toFixed(1) + 's'}`, x, y - 6);
  }

  window.addEventListener('keydown', (e) => {
    if (views.pac.classList.contains('hidden')) return;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"," "].includes(e.key) || e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement && ['BUTTON', 'A'].includes(document.activeElement.tagName)) document.activeElement.blur();
    }
    if (!state) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowUp' || k === 'w') state.player.next = { x: 0, y: -1 };
    if (e.key === 'ArrowDown' || k === 's') state.player.next = { x: 0, y: 1 };
    if (e.key === 'ArrowLeft' || k === 'a') state.player.next = { x: -1, y: 0 };
    if (e.key === 'ArrowRight' || k === 'd') state.player.next = { x: 1, y: 0 };
    if (k === 'p') { state.paused = !state.paused; modeEl.textContent = state.paused ? 'Paused' : 'Running'; }
    if (e.code === 'Space') dash();
  }, true);

  function startOrResumePac() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    if (state && state.rewardPending && pacPendingReward) {
      rewardOverlay.classList.remove('hidden');
      rewardOverlay.setAttribute('aria-hidden', 'false');
      return;
    }
    if (!state) start(saveState.unlocked);
    else if (state.cleared && state.num < 20) start(state.num + 1);
    else if (state.cleared && state.num >= 20) start(1);
    else { state.paused = false; modeEl.textContent = 'Running'; }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function resetPacRun() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    resetRun();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  $('pacStartBtn').onclick = startOrResumePac;
  $('pacResetBtn').onclick = resetPacRun;
  $('pacStartTop').onclick = startOrResumePac;
  $('pacResetTop').onclick = resetPacRun;
  $('pacHomeTop').onclick = () => { showView('hub'); renderHubBoards(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  renderAll(); draw();
  return { renderAll, draw, startOrResume: startOrResumePac, start, resetRun };
})();

renderHubBoards();
const initialView = routeToInitialView();
showView(initialView);
if (initialView === 'diglew') { diglew.startRun(); }
if (initialView === 'pac') { pac.startOrResume(); }
