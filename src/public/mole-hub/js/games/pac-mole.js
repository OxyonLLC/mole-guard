// WinLEW Gaming Hub v39 modular game chunk: pac
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.pac = function create_pac(deps) {
    // Conservative legacy wrapper: gameplay code is unchanged and resolves shared hub helpers
    // through the provided dependency bag. This keeps v39 behavior stable while splitting files.
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
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

  const TILE = 34;
  const PAC_WIDTH = 32;
  const PAC_HEIGHT = 18;
  const defaultState = { unlocked: 1, highLevel: 1 };
  let saveState = load(Storage.pacState, defaultState);
  let claimState = load(Storage.pacClaims, {});
  let board = load(Storage.pacBoard, []);
  let state = null;
  let pacPendingReward = null;
  let raf = 0;
  let last = 0;

  

  function pacEdgeGates(level, width, height) {
    const right = width - 2;
    const bottom = height - 2;
    const variant = ((level || 1) - 1) % 5;
    const sharedStart = [[1,1],[2,1],[3,1],[1,2],[1,3],[2,2]];
    const variants = [
      [[right, 6], [right, 7], [24, bottom], [25, bottom], [8, 1], [9, 1]],
      [[1, 5], [1, 6], [12, 1], [13, 1], [18, bottom], [19, bottom]],
      [[6, 1], [7, 1], [1, 11], [1, 12], [right, 6], [right, 7]],
      [[1, 3], [1, 4], [20, 1], [21, 1], [10, bottom], [11, bottom]],
      [[1, 7], [1, 8], [14, 1], [15, 1], [16, bottom], [17, bottom]],
    ];
    return [...sharedStart, ...variants[variant]];
  }

  function buildLiquidTemplate(level) {
    const width = PAC_WIDTH;
    const height = PAC_HEIGHT;
    const grid = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return '#';
      return '#';
    }));

    const hash = (x, y, seed = 0) => {
      const v = Math.sin(x * 12.9898 + y * 78.233 + level * 37.719 + seed * 19.19) * 43758.5453;
      return v - Math.floor(v);
    };
    const inBounds = (x, y) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
    const clear = (x, y) => { if (inBounds(x, y)) grid[y][x] = '-'; };

    // Step 3 flips the generator: start with stone, carve a real maze, then fill all
    // carved path cells with worms/globes. This gets closer to the classic reference
    // instead of an open room with scattered walls.
    const cellW = 15; // x positions 1,3,5,...,29
    const cellH = 8;  // y positions 1,3,5,...,15
    const visited = Array.from({ length: cellH }, () => Array(cellW).fill(false));
    const cellToGrid = (cx, cy) => ({ x: 1 + cx * 2, y: 1 + cy * 2 });
    const carveCell = (cx, cy) => { const p = cellToGrid(cx, cy); clear(p.x, p.y); };
    const stack = [{ cx: 0, cy: 0 }];
    visited[0][0] = true;
    carveCell(0, 0);

    const dirsBase = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
    ];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const dirs = dirsBase
        .map((d) => ({ ...d, r: hash(cur.cx + d.dx * 7, cur.cy + d.dy * 11, stack.length) }))
        .sort((a, b) => a.r - b.r);
      let moved = false;
      for (const d of dirs) {
        const nx = cur.cx + d.dx;
        const ny = cur.cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= cellW || ny >= cellH || visited[ny][nx]) continue;
        visited[ny][nx] = true;
        const a = cellToGrid(cur.cx, cur.cy);
        const b = cellToGrid(nx, ny);
        clear((a.x + b.x) / 2, (a.y + b.y) / 2);
        clear(b.x, b.y);
        stack.push({ cx: nx, cy: ny });
        moved = true;
        break;
      }
      if (!moved) stack.pop();
    }

    // Add extra loop openings so the maze feels liquid, not like one long perfect-maze snake.
    for (let y = 2; y < height - 2; y += 2) {
      for (let x = 2; x < width - 2; x += 2) {
        const horizontal = grid[y][x - 1] === '-' && grid[y][x + 1] === '-';
        const vertical = grid[y - 1][x] === '-' && grid[y + 1][x] === '-';
        const roll = hash(x, y, 31);
        if ((horizontal || vertical) && roll < 0.30) clear(x, y);
      }
    }

    // Carve a few classic horizontal bands like the reference, but break them with gates.
    const bands = [3, 7, 11, 15];
    bands.forEach((y, idx) => {
      for (let x = 2; x < width - 2; x++) {
        if ((x + idx + level) % 7 === 0) continue;
        if (hash(x, y, 42 + idx) < 0.68) clear(x, y);
      }
    });
    const spines = [5, 11, 17, 23, 28];
    spines.forEach((x, idx) => {
      for (let y = 2; y < height - 2; y++) {
        if ((y + idx + level) % 6 === 0) continue;
        if (hash(x, y, 66 + idx) < 0.54) clear(x, y);
      }
    });

    // Keep player launch area readable, but not empty for long.
    [[1,1],[2,1],[3,1],[1,2],[1,3]].forEach(([x,y]) => clear(x,y));

    function denOrigin() {
      if (level % 4 === 0) return { x: 15, y: 8, label: 'center' };
      const corners = [
        { x: width - 4, y: 1, label: 'upper-right' },
        { x: 1, y: height - 4, label: 'lower-left' },
        { x: width - 4, y: height - 4, label: 'lower-right' },
      ];
      return corners[(level - 1) % corners.length];
    }
    const den = denOrigin();
    // 2x2 den, with a one-tile stone shell around it. It no longer owns the whole middle.
    for (let y = den.y - 1; y <= den.y + 2; y++) {
      for (let x = den.x - 1; x <= den.x + 2; x++) if (inBounds(x, y)) grid[y][x] = '#';
    }
    [[den.x, den.y], [den.x + 1, den.y], [den.x, den.y + 1], [den.x + 1, den.y + 1]].forEach(([x, y]) => { if (inBounds(x, y)) grid[y][x] = 'D'; });
    const exits = den.label === 'center'
      ? [[den.x - 1, den.y], [den.x + 2, den.y + 1], [den.x, den.y - 1], [den.x + 1, den.y + 2]]
      : [[den.x - 1, den.y], [den.x, den.y - 1], [den.x + 2, den.y + 1], [den.x + 1, den.y + 2]];
    exits.forEach(([x, y]) => clear(x, y));

    // Add dash walls as intentional shortcut gates between existing corridors.
    const dashCandidates = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (grid[y][x] !== '#') continue;
        const horizontalGate = grid[y][x - 1] === '-' && grid[y][x + 1] === '-';
        const verticalGate = grid[y - 1][x] === '-' && grid[y + 1][x] === '-';
        const farFromSpawn = Math.abs(x - 1) + Math.abs(y - 1) > 8;
        const farFromDen = Math.abs(x - den.x) + Math.abs(y - den.y) > 5;
        if ((horizontalGate || verticalGate) && farFromSpawn && farFromDen) dashCandidates.push({ x, y, h: hash(x, y, 90) });
      }
    }
    dashCandidates.sort((a, b) => a.h - b.h).slice(0, 3 + (level % 3)).forEach(({ x, y }) => { grid[y][x] = 'X'; });

    // Fill all walkable path tiles. Power globes vary by level; the rest become worms.
    const paths = [];
    const denCells = new Set([[den.x,den.y],[den.x+1,den.y],[den.x,den.y+1],[den.x+1,den.y+1]].map(([x,y]) => `${x},${y}`));
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grid[y][x] !== '-') continue;
        if (denCells.has(`${x},${y}`)) continue;
        paths.push({ x, y, h: hash(x, y, 101) });
      }
    }

    const reserved = new Set(['1,1']);
    const powerTarget = level < 4 ? 4 : level < 10 ? 5 : 6;
    const powers = [];
    paths.slice().sort((a, b) => hash(a.x, a.y, 109) - hash(b.x, b.y, 109)).forEach((cell) => {
      if (powers.length >= powerTarget) return;
      if (reserved.has(`${cell.x},${cell.y}`)) return;
      const farEnough = powers.every((p) => Math.abs(p.x - cell.x) + Math.abs(p.y - cell.y) >= 7);
      const awayFromSpawn = Math.abs(cell.x - 1) + Math.abs(cell.y - 1) >= 7;
      if (farEnough && awayFromSpawn) powers.push(cell);
    });
    powers.forEach(({ x, y }) => { grid[y][x] = 'o'; reserved.add(`${x},${y}`); });
    paths.forEach(({ x, y }) => {
      const k = `${x},${y}`;
      if (reserved.has(k)) return;
      grid[y][x] = '.';
    });

    return grid.map((row) => row.join(''));
  }

  function templates() {
    return Array.from({ length: 20 }, (_, i) => buildLiquidTemplate(i + 1));
  }

function normalizeTemplate(rows) {
    const width = Math.max(...rows.map((r) => r.length));
    return rows.map((row) => row.padEnd(width, '#').replace(/ /g, '#').split(''));
  }


  function applyPacMazeGrammar(map, level, playerSpawn) {
    const width = map[0].length;
    const height = map.length;
    const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    const hash = (x, y, seed = 0) => {
      const v = Math.sin(x * 12.9898 + y * 78.233 + level * 37.719 + seed * 19.19) * 43758.5453;
      return v - Math.floor(v);
    };
    const inBounds = (x, y) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
    const isDen = (x, y) => map[y]?.[x] === 'D';
    const nearDen = (x, y, r = 2) => {
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) {
          if (map[yy]?.[xx] === 'D') return true;
        }
      }
      return false;
    };
    const wallish = (x, y) => map[y]?.[x] === '#' || map[y]?.[x] === 'X';
    const pathish = (x, y) => map[y]?.[x] && map[y][x] !== '#' && map[y][x] !== 'X' && map[y][x] !== 'D';
    const degree = (x, y) => dirs.reduce((sum, d) => sum + (pathish(x + d.x, y + d.y) ? 1 : 0), 0);
    const wallDegree = (x, y) => dirs.reduce((sum, d) => sum + (wallish(x + d.x, y + d.y) ? 1 : 0), 0);
    const clear = (x, y) => { if (inBounds(x, y) && !isDen(x, y)) map[y][x] = '-'; };
    const solid = (x, y) => { if (inBounds(x, y) && !isDen(x, y) && !nearDen(x, y, 1)) map[y][x] = '#'; };

    function enforceOneTileBorder() {
      for (let x = 0; x < width; x++) { map[0][x] = '#'; map[height - 1][x] = '#'; }
      for (let y = 0; y < height; y++) { map[y][0] = '#'; map[y][width - 1] = '#'; }
      // Only preserve a few archetype-specific edge gates instead of a full inner rim.
      pacEdgeGates(level, width, height).forEach(([x, y]) => {
        if (!nearDen(x, y, 1)) clear(x, y);
      });
      [[1,1],[2,1],[3,1],[1,2],[1,3],[2,2]].forEach(([x,y]) => clear(x,y));
    }

    function removeOpen2x2Blobs() {
      let changed = false;
      for (let y = 1; y < height - 2; y++) {
        for (let x = 1; x < width - 2; x++) {
          const cells = [[x,y],[x+1,y],[x,y+1],[x+1,y+1]];
          if (!cells.every(([cx, cy]) => pathish(cx, cy))) continue;
          const choices = cells
            .filter(([cx, cy]) => !(Math.abs(cx - playerSpawn.x) + Math.abs(cy - playerSpawn.y) < 3))
            .filter(([cx, cy]) => !nearDen(cx, cy, 2))
            .map(([cx, cy]) => ({ x: cx, y: cy, d: degree(cx, cy), h: hash(cx, cy, 209) }))
            .sort((a, b) => (b.d - a.d) || (a.h - b.h));
          const pick = choices[0];
          if (pick) { solid(pick.x, pick.y); changed = true; }
        }
      }
      return changed;
    }

    function removeIsolatedWallSingles() {
      let changed = false;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (map[y][x] !== '#') continue;
          if (nearDen(x, y, 1)) continue;
          if (wallDegree(x, y) === 0) { clear(x, y); changed = true; }
        }
      }
      return changed;
    }

    function breakThick3x3Stone() {
      let changed = false;
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          if (nearDen(x, y, 2)) continue;
          let full = true;
          for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
            if (!wallish(xx, yy)) full = false;
          }
          if (full) { clear(x, y); changed = true; }
        }
      }
      return changed;
    }

    function reduceDeadEnds() {
      let changed = false;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (!pathish(x, y)) continue;
          if (nearDen(x, y, 1)) continue;
          if (x === playerSpawn.x && y === playerSpawn.y) continue;
          if (degree(x, y) > 1) continue;
          const options = dirs
            .map((d) => ({ d, wx: x + d.x, wy: y + d.y, bx: x + d.x * 2, by: y + d.y * 2, h: hash(x + d.x * 3, y + d.y * 3, 233) }))
            .filter((o) => inBounds(o.wx, o.wy) && inBounds(o.bx, o.by) && wallish(o.wx, o.wy) && pathish(o.bx, o.by) && !nearDen(o.wx, o.wy, 1))
            .sort((a, b) => a.h - b.h);
          if (options[0]) { clear(options[0].wx, options[0].wy); changed = true; }
        }
      }
      return changed;
    }

    enforceOneTileBorder();
    for (let pass = 0; pass < 7; pass++) {
      const changed = [breakThick3x3Stone, reduceDeadEnds, removeOpen2x2Blobs, removeIsolatedWallSingles, enforceOneTileBorder]
        .map((fn) => fn())
        .some(Boolean);
      if (!changed && pass > 2) break;
    }
    enforceOneTileBorder();
    removeIsolatedWallSingles();
    return map;
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
        if (isWall(map, nx, ny)) continue;
        const k = keyOf(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
    return seen;
  }

  function fillPacEmptyPaths(map, level, playerSpawn) {
    const hash = (x, y, seed = 0) => {
      const v = Math.sin(x * 12.9898 + y * 78.233 + level * 37.719 + seed * 19.19) * 43758.5453;
      return v - Math.floor(v);
    };
    const width = map[0].length;
    const height = map.length;
    const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    const collectible = (x, y) => map[y]?.[x] === '.' || map[y]?.[x] === 'o';
    const wallish = (x, y) => map[y]?.[x] === '#' || map[y]?.[x] === 'X';
    const nearDen = (x, y, r = 1) => {
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) if (map[yy]?.[xx] === 'D') return true;
      }
      return false;
    };
    const legalPathTile = (x, y) => map[y]?.[x] === '-' || map[y]?.[x] === '.' || map[y]?.[x] === 'o';
    const collectibleNeighborCount = (x, y) => dirs.reduce((sum, d) => sum + (collectible(x + d.x, y + d.y) ? 1 : 0), 0);
    const wallNeighborCount = (x, y) => dirs.reduce((sum, d) => sum + (wallish(x + d.x, y + d.y) ? 1 : 0), 0);
    const openCount = () => {
      let count = 0;
      for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) if (!isWall(map, xx, yy)) count += 1;
      return count;
    };
    const keepsConnectivityAsWall = (x, y) => {
      const old = map[y][x];
      if (old === 'D') return false;
      map[y][x] = '#';
      const seen = reachableSet(map, { x: playerSpawn.x, y: playerSpawn.y });
      const ok = seen.size >= openCount();
      map[y][x] = old;
      return ok;
    };
    const canBecomeWall = (x, y) => {
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) return false;
      if (nearDen(x, y, 2)) return false;
      if (Math.abs(x - playerSpawn.x) + Math.abs(y - playerSpawn.y) < 4) return false;
      if (!legalPathTile(x, y)) return false;
      if (wallNeighborCount(x, y) < 1) return false;
      return keepsConnectivityAsWall(x, y);
    };
    const placeWall = (x, y) => {
      if (!canBecomeWall(x, y)) return false;
      map[y][x] = '#';
      return true;
    };

    // Clear old collectibles, then refill legal path tiles. The strict grammar below
    // converts bad cluster cells into attached wall so no empty non-wall tiles are left.
    const open = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (map[y][x] === '.' || map[y][x] === 'o') map[y][x] = '-';
        if (map[y][x] === '-') open.push({ x, y, h: hash(x, y, 151) });
      }
    }

    const powerTarget = level < 4 ? 4 : level < 10 ? 5 : 6;
    const powers = [];
    open
      .slice()
      .filter((cell) => !nearDen(cell.x, cell.y, 1))
      .sort((a, b) => hash(a.x, a.y, 161) - hash(b.x, b.y, 161))
      .forEach((cell) => {
        if (powers.length >= powerTarget) return;
        const awayFromSpawn = Math.abs(cell.x - playerSpawn.x) + Math.abs(cell.y - playerSpawn.y) >= 6;
        const farEnough = powers.every((p) => Math.abs(p.x - cell.x) + Math.abs(p.y - cell.y) >= 7);
        if (awayFromSpawn && farEnough) {
          map[cell.y][cell.x] = 'o';
          powers.push(cell);
        }
      });

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (map[y][x] !== '-') continue;
        if (nearDen(x, y, 0)) continue;
        map[y][x] = '.';
      }
    }

    function breakTwoByTwoCollectibleBlocks() {
      let changed = false;
      for (let y = 1; y < height - 2; y++) {
        for (let x = 1; x < width - 2; x++) {
          const cells = [[x,y],[x+1,y],[x,y+1],[x+1,y+1]];
          if (!cells.every(([cx, cy]) => collectible(cx, cy))) continue;
          const pick = cells
            .map(([cx, cy]) => ({ x: cx, y: cy, n: collectibleNeighborCount(cx, cy), wall: wallNeighborCount(cx, cy), h: hash(cx, cy, 271) }))
            .filter((c) => canBecomeWall(c.x, c.y))
            .sort((a, b) => (b.n - a.n) || (b.wall - a.wall) || (b.h - a.h))[0];
          if (pick && placeWall(pick.x, pick.y)) changed = true;
        }
      }
      return changed;
    }

    function capCollectibleAdjacency() {
      let changed = false;
      const hot = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (!collectible(x, y)) continue;
          const n = collectibleNeighborCount(x, y);
          if (n > 2) hot.push({ x, y, n, wall: wallNeighborCount(x, y), h: hash(x, y, 307) });
        }
      }
      hot
        .sort((a, b) => (b.n - a.n) || (b.wall - a.wall) || (b.h - a.h))
        .forEach((cell) => {
          if (!collectible(cell.x, cell.y)) return;
          if (collectibleNeighborCount(cell.x, cell.y) <= 2) return;
          if (placeWall(cell.x, cell.y)) changed = true;
        });
      return changed;
    }

    function removeInnerBorderDoubleWalls() {
      let changed = false;
      pacEdgeGates(level, width, height).forEach(([x, y]) => {
        if (map[y][x] === '#') { map[y][x] = '.'; changed = true; }
      });
      [[1,1],[2,1],[3,1],[1,2],[1,3],[2,2]].forEach(([x,y]) => { if (map[y][x] === '#') { map[y][x] = '.'; changed = true; } });
      return changed;
    }

    function removeWallSingles() {
      let changed = false;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (map[y][x] !== '#') continue;
          if (nearDen(x, y, 1)) continue;
          if (wallNeighborCount(x, y) === 0) { map[y][x] = '.'; changed = true; }
        }
      }
      return changed;
    }

    for (let pass = 0; pass < 10; pass++) {
      const changed = [breakTwoByTwoCollectibleBlocks, capCollectibleAdjacency, removeWallSingles, removeInnerBorderDoubleWalls]
        .map((fn) => fn())
        .some(Boolean);
      if (!changed && pass > 2) break;
    }

    removeInnerBorderDoubleWalls();
    removeWallSingles();

    // Final pass: any remaining legal non-wall / non-den tile gets a collectible.
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (map[y][x] === '-') map[y][x] = '.';
      }
    }

    return map;
  }

  function ensureReachable(map, start) {
    let seen = reachableSet(map, start);
    let changed = true;
    while (changed) {
      changed = false;
      let target = null;
      outer: for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[0].length; x++) {
          if (!isWall(map, x, y) && !seen.has(keyOf(x, y))) { target = { x, y }; break outer; }
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
        if (map[y][x] === '#') map[y][x] = '-';
      }
      while (y !== near.y) {
        y += y < near.y ? 1 : -1;
        if (map[y][x] === '#') map[y][x] = '-';
      }
      seen = reachableSet(map, start);
      changed = true;
    }
    return map;
  }

  function makeLevel(num) {
    let temp = normalizeTemplate(templates()[(num - 1) % templates().length]);
    let playerSpawn = { x: 1, y: 1 };
    // applyPacMazeGrammar (the V48 Step 5 "map validator" pass: one-tile
    // border, isolated wall singles removed, 3x3 stone chunks broken up,
    // dead ends carved into loops, 2x2 open blobs reduced) was written but
    // never actually wired into level generation — every live level was
    // only reachability-patched + worm-filled, skipping the whole fairness
    // pass this function exists for. Runs before ensureReachable so its one
    // wall-adding step (removeOpen2x2Blobs) can never strand a cell:
    // ensureReachable always carves back to full connectivity afterward.
    temp = applyPacMazeGrammar(temp, num, playerSpawn);
    temp = ensureReachable(temp, playerSpawn);
    temp = fillPacEmptyPaths(temp, num, playerSpawn);
    const worms = [];
    const powers = [];
    const paths = [];
    const denCells = [];
    for (let y = 0; y < temp.length; y++) {
      for (let x = 0; x < temp[0].length; x++) {
        const ch = temp[y][x];
        if (!isWall(temp, x, y)) paths.push({ x, y });
        if (ch === 'D') denCells.push({ x, y });
        if (ch === '.') worms.push({ x, y, eaten: false });
        if (ch === 'o') powers.push({ x, y, eaten: false });
      }
    }
    playerSpawn = paths.find((p) => p.x === 1 && p.y === 1) || paths[0];
    const player = { x: playerSpawn.x, y: playerSpawn.y, dir: { x: 0, y: 0 }, next: { x: 0, y: 0 } };
    const enemyCount = Math.min(4, 1 + Math.floor((num - 1) / 3));
    const enemies = [];
    const den = denCells.length ? denCells : paths.filter((p) => dist(p, player) > 12).slice(0, 6);
    for (let i = 0; i < enemyCount; i++) {
      const spot = den[(i * 3 + 1) % den.length] || paths[(i * 11 + 7) % paths.length];
      enemies.push({
        x: spot.x,
        y: spot.y,
        type: ['redRaider', 'blueScout', 'armoredBeetle', 'splitter'][i % 4],
        dir: choice([{x:1,y:0},{x:-1,y:0},{x:0, y:1},{x:0,y:-1}]),
        vulnerable: 0,
        home: { x: spot.x, y: spot.y },
        lastDir: { x: 0, y: 0 },
        respawnGlow: 0
      });
    }
    return {
      num,
      map: temp,
      width: temp[0].length,
      height: temp.length,
      player,
      enemies,
      denCells,
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
      rewardPending: false,
      over: false,
      hitCooldown: 0
    };
  }

  function isWall(map, x, y) {
    if (y < 0 || x < 0 || y >= map.length || x >= map[0].length) return true;
    return map[y][x] === '#' || map[y][x] === 'X';
  }

  function isDashWall(map, x, y) {
    if (y < 0 || x < 0 || y >= map.length || x >= map[0].length) return false;
    return map[y][x] === 'X';
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

  function showPacBanner(title, subtitle = '', color = '#ffd86a') {
    if (banner) banner.textContent = title;
    if (sub) sub.textContent = subtitle;
    if (hintEl) hintEl.textContent = `${title}: ${subtitle}`;
    // Local Pac banner guard: avoids calling Burrow Blaster's scoped arcade-banner helper.
    return { title, subtitle, color };
  }

  function start(level = saveState.unlocked) {
    pacPendingReward = null;
    hideRewardOverlay();
    // Bring the canvas into view, not the top of the whole site — scrolling
    // to page-top jumps away from the game itself, and every entry into
    // active play (fresh start, resume, level continue) funnels through
    // here, so ghosts can't already be moving before the player can even see
    // the maze. Instant, not smooth — a fast game can't afford the
    // animation's real time.
    canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
    cancelAnimationFrame(raf);
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    state = makeLevel(level);
    banner.textContent = `Level ${level} — ${levelName(level)}`;
    sub.textContent = 'Flow-loop maze rebuild: smoother routes, fewer dead ends, better enemy pressure, and stronger level variety.';
    modeEl.textContent = 'Running';
    hintEl.textContent = 'Pac-Mole flow-loop rebuild: fewer dead ends, stronger enemy routes, no repeated rim loop, and smoother Pac-style maze variety.';
    showPacBanner(`Level ${level}`, `${levelName(level)} • flow-loop rebuild`, '#86f6ff');
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
    // Don't run the game (or repaint) while the hub/another view is showing —
    // otherwise it keeps progressing in the background and can pop a reward
    // overlay over the hub. Mirrors the guard in root-glide / burrow-blaster.
    if (views.pac.classList.contains('hidden')) return;
    if (!state.paused && !state.cleared && !state.over) update(dt / 1000);
    draw();
  }

  function update(dt) {
    state.pacClock += dt;
    state.enemyClock += dt;
    state.dashCooldown = Math.max(0, state.dashCooldown - dt);
    state.hitCooldown = Math.max(0, (state.hitCooldown || 0) - dt);
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

  function spreadEnemies() {
    if (!state?.enemies?.length) return;
    const occupied = new Map();
    const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    state.enemies.forEach((e, idx) => {
      const k = keyOf(e.x, e.y);
      if (!occupied.has(k)) {
        occupied.set(k, idx);
        return;
      }
      const options = dirs
        .map((d) => {
          let nx = e.x + d.x;
          let ny = e.y + d.y;
          if (nx < 0) nx = state.width - 1;
          if (nx >= state.width) nx = 0;
          return { x: nx, y: ny, d, score: Math.abs(nx - state.player.x) + Math.abs(ny - state.player.y) };
        })
        .filter((o) => o.y >= 0 && o.y < state.height && !isWall(state.map, o.x, o.y) && !occupied.has(keyOf(o.x, o.y)))
        .sort((a, b) => b.score - a.score);
      const pick = options[0];
      if (pick) {
        e.x = pick.x;
        e.y = pick.y;
        e.dir = pick.d;
        e.lastDir = pick.d;
        occupied.set(keyOf(e.x, e.y), idx);
      }
    });
  }

  function nearestReachableTarget(start, preferred, fallbackList = []) {
    const width = state.map[0].length;
    const queue = [{ x: start.x, y: start.y }];
    const seen = new Set([keyOf(start.x, start.y)]);
    const targets = new Set([keyOf(preferred.x, preferred.y), ...fallbackList.map((p) => keyOf(p.x, p.y))]);
    while (queue.length) {
      const cur = queue.shift();
      if (targets.has(keyOf(cur.x, cur.y))) return cur;
      for (const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]) {
        let nx = cur.x + d.x;
        let ny = cur.y + d.y;
        if (nx < 0) nx = width - 1;
        if (nx >= width) nx = 0;
        if (ny < 0 || ny >= state.map.length) continue;
        if (isWall(state.map, nx, ny)) continue;
        const k = keyOf(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
    return preferred;
  }

  function moveEnemies() {
    const exits = (state.denCells || [])
      .flatMap((cell) => [{x:cell.x+1,y:cell.y},{x:cell.x-1,y:cell.y},{x:cell.x,y:cell.y+1},{x:cell.x,y:cell.y-1}])
      .filter((p, idx, arr) => p.y >= 0 && p.y < state.height && p.x >= 0 && p.x < state.width && !isWall(state.map, p.x, p.y) && arr.findIndex((q) => q.x === p.x && q.y === p.y) === idx);

    state.enemies.forEach((e, enemyIndex) => {
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
        // Give each beetle a slight personality so they do not stack on one exact chase line.
        let target = { x: state.player.x, y: state.player.y };
        if (enemyIndex === 1) target = { x: Math.max(1, state.player.x - 3), y: state.player.y };
        if (enemyIndex === 2) target = { x: state.player.x, y: Math.max(1, state.player.y - 3) };
        if (enemyIndex === 3) target = exits[(state.pacClock * 10 + enemyIndex) % Math.max(1, exits.length)] || target;
        target = nearestReachableTarget({ x: e.x, y: e.y }, target, exits);
        const next = wrappedNextStep(state.map, { x: e.x, y: e.y }, target);
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
    spreadEnemies();
  }

  function checkEnemyCollisions() {
    if (!state || state.over || state.hitCooldown > 0) return;
    for (const e of state.enemies) {
      if (e.x !== state.player.x || e.y !== state.player.y) continue;
      if (e.vulnerable > 0) {
        state.score += 200;
        state.beetlesEaten += 1;
        e.x = e.home.x; e.y = e.home.y; e.vulnerable = 0;
        Sound.win();
      } else {
        state.lives -= 1;
        state.hitCooldown = 1.15;
        Sound.hurt();
        if (state.lives <= 0) {
          gameOver();
        } else {
          const spawn = { x: 1, y: 1 };
          state.player.x = spawn.x;
          state.player.y = spawn.y;
          state.player.dir = { x: 0, y: 0 };
          state.player.next = { x: 0, y: 0 };
          state.powerTimer = 0;
          state.enemies.forEach((enemy) => {
            enemy.x = enemy.home.x;
            enemy.y = enemy.home.y;
            enemy.vulnerable = 0;
            enemy.dir = choice([{x:1,y:0},{x:-1,y:0},{x:0, y:1},{x:0,y:-1}]);
            enemy.lastDir = { x: 0, y: 0 };
          });
          hintEl.textContent = `Ouch — ${state.lives} ${state.lives === 1 ? 'life' : 'lives'} left. Re-center before moving.`;
        }
      }
      break;
    }
  }

  function dash() {
    if (!state || state.paused || state.cleared || state.over || state.lives <= 0) return;
    if (state.dashCooldown > 0) {
      hintEl.textContent = `Burrow cooling down: ${state.dashCooldown.toFixed(1)}s`;
      return;
    }
    const availableWorms = state.worms.filter((w) => w.eaten).length + state.powers.filter((p) => p.eaten).length;
    if (availableWorms <= state.dashUsed) {
      hintEl.textContent = 'Need one collected worm to fuel a burrow.';
      return;
    }

    // Prefer the buffered direction so Arrow/WASD + SPACE feels responsive even before
    // the mole has completed a grid step. Fall back to current travel direction.
    let dir = state.player.next;
    if (dir.x === 0 && dir.y === 0) dir = state.player.dir;
    if (dir.x === 0 && dir.y === 0) {
      hintEl.textContent = 'Choose a direction, then press SPACE to burrow.';
      return;
    }

    let landing = null;
    let wallsCrossed = 0;
    let blocked = false;
    for (let step = 1; step <= 3; step++) {
      const tx = state.player.x + dir.x * step;
      const ty = state.player.y + dir.y * step;
      if (tx < 0 || ty < 0 || ty >= state.map.length || tx >= state.map[0].length) { blocked = true; break; }

      if (isWall(state.map, tx, ty)) {
        wallsCrossed += 1;
        if (wallsCrossed > 2) { blocked = true; break; }
        continue;
      }

      landing = { x: tx, y: ty };
      break;
    }

    if (blocked || !landing || wallsCrossed < 1 || wallsCrossed > 2) {
      hintEl.textContent = 'No safe landing within two burrowed wall spaces.';
      return;
    }

    // Burrow traversal phases under the wall and preserves the map. Nothing is destroyed.
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
    hintEl.textContent = `Burrowed under ${wallsCrossed} wall space${wallsCrossed > 1 ? 's' : ''}. Map intact, worm fuel spent.`;
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
    const rawBaseReward = 100 + (state.num - 1) * 50;
    const baseReward = balanceGameReward('pacmole', rawBaseReward);
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
        title: '✨ Round Reward',
        badge: 'Practice clear',
        text: `Level ${state.num} is still playable, but its WinLEW payout can only be claimed once every 24 hours.<br><br>Your base reward would be <strong>${baseReward} WinLEW</strong>, but this run is marked as practice only.`,
        boxes: [],
        continueLabel: state.num < 20 ? '➡️ Next Round' : 'Restart Campaign',
        onContinue: advance
      });
      return;
    }

    const boxes = buildRewardBoxes();
    hintEl.textContent = 'Pick a reward box before moving to the next round.';
    renderAll();
    openPacRewardFlow({
      claimToken,
      title: '✨ Round Reward',
      badge: `Level ${state.num} clear`,
      text: `Pick one reward box and reveal your bonus.<br><br>Level ${state.num} base reward is <strong>${baseReward} WinLEW</strong>. Choose one box to reveal your bonus multiplier.`,
      boxes,
      continueLabel: state.num < 20 ? '➡️ Next Round' : 'Restart Campaign',
      onPick: (box) => {
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

        const claimPromise = postRewardClaim({
          game: 'pacmole',
          roundKey: `level-${state.num}-${claimToken}`,
          roundLabel: `Pac-Mole Level ${state.num}`,
          baseReward: rawBaseReward,
          multiplier: box.multiplier,
          payout,
          meta: {
            level: state.num,
            score: state.score,
            worms: state.worms.length + state.powers.length,
            beetles: state.beetlesEaten,
            dashes: state.dashUsed,
            rawBaseReward,
          },
        });
        // Corrects this optimistic credit to the server-authoritative amount
        // (up, down, or rolled back entirely) the moment the claim response
        // lands, instead of leaving it to eventually self-heal — which for a
        // guest only ever heals upward.
        const sync = reconcileClaimResult(payout, claimPromise);

        return {
          immediate: `Multiplier revealed: <strong>${box.multiplier}x</strong><br>You earned <strong>${payout.toFixed(2)} WinLEW</strong> in-app.<br>Stored total: <strong>${walletTotal.toFixed(2)} WinLEW</strong>.`,
          sync,
        };
      },
      onContinue: advance
    });
  }

  function gameOver() {
    if (!state || state.over) return;
    state.over = true;
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
      ['Lives', state ? Math.max(0, state.lives) : 4],
      ['Worms Left', state ? state.wormsLeft : '--'],
      ['Burrow Fuel', state ? `${Math.max(0, collectedWorms - state.dashUsed)}` : '--'],
      ['Stored WinLEW', loadWallet().toFixed(2)],
      ['Best Level', saveState.highLevel]
    ];
    statsEl.innerHTML = stats.map(([k,v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
    progressEl.textContent = `Progress: ${saveState.highLevel} / 20 cleared`;
    const dashReady = state ? (state.dashCooldown <= 0 ? 'ready' : `${state.dashCooldown.toFixed(1)}s`) : '--';
    enemyEl.textContent = `Beetles: ${state ? state.enemies.length : '--'} • Dash ${dashReady}${state && state.powerTimer > 0 ? ' • power mode' : ''}`;
    const startLabel = !state ? 'Start Run' : state.rewardPending ? 'Claim Reward' : (state.over || state.lives <= 0) ? 'Restart Level' : state.cleared ? 'Next Level' : state.paused ? 'Resume' : 'Running';
    [ $('pacStartBtn'), $('pacStartTop') ].forEach((btn) => { if (btn) btn.textContent = startLabel; });
    renderBoardList(boardEl, board, 'pac');
    renderLevelButtons();
    views.pac.classList.toggle('hub-active-run', Boolean(state && !state.over));
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
    drawPacBackground();
    if (!state) {
      drawPacTitleScreen();
      return;
    }

    const ox = (canvas.width - state.width * TILE) / 2;
    const oy = Math.max(72, Math.floor((canvas.height - state.height * TILE) / 2) - 20);
    ctx.save();
    ctx.shadowColor = 'rgba(37, 110, 255, .16)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(2, 6, 18, .78)';
    ctx.beginPath();
    ctx.roundRect(ox - 18, oy - 18, state.width * TILE + 36, state.height * TILE + 36, 22);
    ctx.fill();
    ctx.restore();

    // Floor first so the maze feels like the thumbnail's dark underground arena.
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const rx = ox + x * TILE, ry = oy + y * TILE;
        if (isWall(state.map, x, y)) drawPacWall(rx, ry, x, y, state.map[y][x] === 'X');
        else drawPacFloor(rx, ry, x, y);
      }
    }

    state.worms.forEach((w) => { if (!w.eaten) drawGoldenWorm(ox + w.x*TILE + TILE/2, oy + w.y*TILE + TILE/2, w.x + w.y * 31); });
    state.powers.forEach((p) => { if (!p.eaten) drawGlowGrub(ox + p.x*TILE + TILE/2, oy + p.y*TILE + TILE/2, p.x + p.y * 17); });

    state.enemies.forEach((e, idx) => {
      drawPacEnemy(ox + e.x*TILE + TILE/2, oy + e.y*TILE + TILE/2, e, idx);
    });

    drawThumbnailMole(ox + state.player.x*TILE + TILE/2, oy + state.player.y*TILE + TILE/2, state.player.dir, 1.12);
    drawPacCanvasHud();
    drawDashBar();
  }

  function drawPacBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#030713');
    g.addColorStop(.55, '#040915');
    g.addColorStop(1, '#140b08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalAlpha = .72;
    for (let i = 0; i < 90; i++) {
      const x = (i * 97 + Math.sin((performance.now()/1000) + i) * 12) % canvas.width;
      const y = (i * 53 + Math.cos((performance.now()/1300) + i) * 8) % canvas.height;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(255, 182, 70, .18)' : 'rgba(92, 151, 255, .10)';
      ctx.fillRect(x, y, i % 4 === 0 ? 3 : 2, i % 3 === 0 ? 3 : 2);
    }
    const glow = ctx.createRadialGradient(canvas.width * .74, canvas.height * .22, 0, canvas.width * .74, canvas.height * .22, canvas.width * .55);
    glow.addColorStop(0, 'rgba(255, 174, 48, .18)');
    glow.addColorStop(.45, 'rgba(24, 69, 203, .08)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawPacTitleScreen() {
    ctx.fillStyle = '#eef2ff';
    ctx.font = 'bold 44px Inter, sans-serif';
    ctx.fillText('Pac-Mole', 80, 112);
    ctx.fillStyle = '#aeb8d6';
    ctx.font = '22px Inter, sans-serif';
    ctx.fillText('Classic chase reset: tighter loops, clearer routes, fewer dead ends, and stronger beetle pressure.', 80, 152);
    drawThumbnailMole(170, 240, { x: 1, y: 0 }, 1.55);
    ctx.fillStyle = 'rgba(255,216,106,.9)';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText('Press Start / Resume to begin the 20-level run.', 80, 330);
  }

  function drawPacFloor(rx, ry, x, y) {
    const ch = state?.map?.[y]?.[x];
    if (ch === 'D') {
      const denGrad = ctx.createLinearGradient(rx, ry, rx + TILE, ry + TILE);
      denGrad.addColorStop(0, 'rgba(47, 22, 50, .96)');
      denGrad.addColorStop(.55, 'rgba(16, 29, 72, .96)');
      denGrad.addColorStop(1, 'rgba(7, 10, 24, .98)');
      ctx.fillStyle = denGrad;
      ctx.fillRect(rx, ry, TILE, TILE);
      ctx.strokeStyle = 'rgba(255, 98, 178, .34)';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 2, ry + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = 'rgba(255, 112, 188, .10)';
      ctx.beginPath();
      ctx.arc(rx + TILE / 2, ry + TILE / 2, TILE * .28, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = ((x + y) % 2 === 0) ? 'rgba(5,10,25,.94)' : 'rgba(3,7,19,.96)';
    ctx.fillRect(rx, ry, TILE, TILE);
    if ((x * 13 + y * 7) % 11 === 0) {
      ctx.fillStyle = 'rgba(255,171,62,.10)';
      ctx.fillRect(rx + 12, ry + 10, 3, 3);
    }
    if ((x * 17 + y * 5) % 19 === 0) {
      ctx.fillStyle = 'rgba(67,147,255,.12)';
      ctx.fillRect(rx + 5, ry + 22, 4, 2);
    }
  }

  function drawPacWall(rx, ry, x, y, cracked = false) {
    const palettes = [
      ['#1430a5', '#174dec', '#071966', '#6facff'],
      ['#4a1c96', '#7b35ff', '#1e0f5c', '#d7b7ff'],
      ['#0e5b7a', '#18a8d8', '#06344a', '#a4f2ff'],
      ['#185d3d', '#28bd71', '#07351f', '#b9ffd6'],
      ['#7a3b12', '#d07925', '#3d1a08', '#ffe2a2'],
      ['#7d1738', '#dd3f77', '#3d0b1e', '#ffc0da'],
    ];
    const pal = palettes[((state?.num || 1) - 1) % palettes.length];
    const g = ctx.createLinearGradient(rx, ry, rx + TILE, ry + TILE);
    g.addColorStop(0, cracked ? '#6b4b18' : pal[0]);
    g.addColorStop(.45, cracked ? '#b37222' : pal[1]);
    g.addColorStop(1, cracked ? '#2b1608' : pal[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(rx + 1.5, ry + 1.5, TILE - 3, TILE - 3, 7);
    ctx.fill();

    ctx.strokeStyle = cracked ? 'rgba(255, 225, 116, .76)' : `${pal[3]}99`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rx + 3, ry + 3, TILE - 6, TILE - 6, 6);
    ctx.stroke();

    // Per-level tile accents keep walls from looking pasted one-for-one.
    const motif = (x * 17 + y * 29 + (state?.num || 1) * 11) % 6;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    if (motif === 0) {
      ctx.fillRect(rx + 7, ry + 5, TILE - 14, 3);
      ctx.fillRect(rx + 7, ry + 12, 8, 2);
    } else if (motif === 1) {
      ctx.beginPath(); ctx.arc(rx + TILE / 2, ry + TILE / 2, 5, 0, Math.PI * 2); ctx.fill();
    } else if (motif === 2) {
      ctx.fillRect(rx + 8, ry + 7, 4, TILE - 14);
      ctx.fillRect(rx + TILE - 12, ry + 7, 4, TILE - 14);
    } else if (motif === 3) {
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rx + 8, ry + TILE - 8); ctx.lineTo(rx + TILE - 8, ry + 8); ctx.stroke();
    } else {
      ctx.fillRect(rx + 7, ry + 5, TILE - 14, 3);
    }
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(rx + 5, ry + TILE - 7, TILE - 10, 3);

    if ((x * 11 + y * 3 + (state?.num || 1)) % 8 === 0 || cracked) {
      ctx.strokeStyle = cracked ? 'rgba(255, 211, 98, .86)' : 'rgba(4, 11, 45, .38)';
      ctx.lineWidth = cracked ? 2.4 : 1.3;
      ctx.beginPath();
      ctx.moveTo(rx + 8, ry + TILE - 6);
      ctx.lineTo(rx + 14, ry + TILE - 12);
      ctx.lineTo(rx + 22, ry + TILE - 7);
      ctx.stroke();
    }
    if (cracked) {
      ctx.shadowColor = 'rgba(255, 194, 74, .75)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(255, 214, 105, .88)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx + 9, ry + 6);
      ctx.lineTo(rx + 17, ry + 13);
      ctx.lineTo(rx + 12, ry + 21);
      ctx.lineTo(rx + 23, ry + 27);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawGoldenWorm(cx, cy, seed = 0) {
    const t = performance.now() / 1000 + seed;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 209, 82, .74)';
    ctx.shadowBlur = 12;
    for (let i = 0; i < 4; i++) {
      const px = cx - 7 + i * 4.6;
      const py = cy + Math.sin(t * 3 + i) * 1.4;
      ctx.fillStyle = i === 3 ? '#ffe47d' : '#ffc433';
      ctx.beginPath();
      ctx.ellipse(px, py, 3.4, 4.1, .2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff0b0';
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 2, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGlowGrub(cx, cy, seed = 0) {
    const pulse = .86 + Math.sin(performance.now()/240 + seed) * .12;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 186, 53, .92)';
    ctx.shadowBlur = 22;
    const rg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 24 * pulse);
    rg.addColorStop(0, 'rgba(255,243,156,.95)');
    rg.addColorStop(.38, 'rgba(255,183,48,.56)');
    rg.addColorStop(1, 'rgba(255,183,48,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, 24 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffbd31';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff5b5';
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPacEnemy(cx, cy, enemy, idx) {
    const vulnerable = enemy.vulnerable > 0;
    const type = enemy.type || ['redRaider','blueScout','armoredBeetle','splitter'][idx % 4];
    const color = vulnerable ? '#56d6ff' : type === 'redRaider' ? '#ff5f71' : type === 'blueScout' ? '#55b9ff' : type === 'armoredBeetle' ? '#ff9c3b' : '#d95cff';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = vulnerable ? 'rgba(86,214,255,.55)' : 'rgba(255, 88, 108, .42)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 2, 12.5, 10.5, 0, Math.PI, 0);
    ctx.lineTo(12.5, 6);
    ctx.quadraticCurveTo(5, 13, 0, 11);
    ctx.quadraticCurveTo(-5, 13, -12.5, 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = vulnerable ? '#0b3d55' : 'rgba(70,14,22,.36)';
    ctx.fillRect(-10, 5, 20, 3);
    ctx.strokeStyle = 'rgba(255,255,255,.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(0, 9);
    ctx.stroke();

    // beetle legs
    ctx.strokeStyle = vulnerable ? '#bff4ff' : '#ffc6c6';
    ctx.lineWidth = 2;
    [-8, 0, 8].forEach((lx, i) => {
      ctx.beginPath();
      ctx.moveTo(lx, 5);
      ctx.lineTo(lx - 5, 10 + (i % 2));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lx, 5);
      ctx.lineTo(lx + 5, 10 + ((i + 1) % 2));
      ctx.stroke();
    });

    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4.4, -2.4, 2.8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(4.4, -2.4, 2.8, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1a1020';
    const eyeShift = vulnerable ? 0 : 1.1;
    ctx.beginPath(); ctx.arc(-3.8 + eyeShift, -2.2, 1.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5.0 + eyeShift, -2.2, 1.2, 0, Math.PI*2); ctx.fill();

    if (type === 'armoredBeetle' && !vulnerable) {
      ctx.strokeStyle = 'rgba(255,236,185,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 2, 10, Math.PI * 1.04, Math.PI * 1.96);
      ctx.stroke();
    }
    if (type === 'splitter' && !vulnerable) {
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.beginPath(); ctx.arc(-8, 2, 2, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(8, 2, 2, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawThumbnailMole(cx, cy, dir = { x: 1, y: 0 }, scale = 1) {
    const facing = dir && dir.x < 0 ? -1 : 1;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(cx, cy + Math.sin(t * 8) * 1.1);
    ctx.scale(facing * scale, scale);

    // dust trail / motion fantasy from the thumbnail
    ctx.globalAlpha = .42;
    ctx.fillStyle = 'rgba(209, 127, 55, .35)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(-16 - i * 4, 7 + i * 1.5, 10 - i, 4.8 - i * .35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // leaf cape
    ctx.fillStyle = '#8cc85a';
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.quadraticCurveTo(-23, -17, -34, -9);
    ctx.quadraticCurveTo(-20, -6, -10, 1);
    ctx.fill();
    ctx.fillStyle = '#b7e46e';
    ctx.beginPath();
    ctx.moveTo(-5, -9);
    ctx.quadraticCurveTo(-20, -25, -30, -18);
    ctx.quadraticCurveTo(-16, -13, -6, -3);
    ctx.fill();

    // body
    ctx.fillStyle = '#5a3322';
    ctx.beginPath();
    ctx.ellipse(-2, 6, 15, 11, -.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#321c15';
    ctx.beginPath();
    ctx.ellipse(-6, 8, 10, 7, -.1, 0, Math.PI * 2);
    ctx.fill();

    // helmet
    ctx.fillStyle = '#c96923';
    ctx.beginPath();
    ctx.arc(2, -6, 12, Math.PI, 0);
    ctx.lineTo(13, -3);
    ctx.quadraticCurveTo(2, 2, -11, -3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f5a438';
    ctx.fillRect(-9, -7, 20, 3);
    ctx.strokeStyle = '#6d3516';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -17);
    ctx.lineTo(2, -3);
    ctx.stroke();

    // headlamp
    ctx.shadowColor = 'rgba(255, 202, 84, .8)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffd06a';
    ctx.beginPath();
    ctx.arc(4, -15, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // face/snout
    ctx.fillStyle = '#f1b799';
    ctx.beginPath();
    ctx.ellipse(11, 0, 9.5, 8.2, .1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e1210';
    ctx.beginPath();
    ctx.arc(18, -2, 3.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(6, -7, 4.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(7.4, -6.4, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // paws
    ctx.fillStyle = '#f1b799';
    ctx.beginPath(); ctx.arc(9, 12, 3.3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(-11, 11, 3.0, 0, Math.PI*2); ctx.fill();

    ctx.restore();
  }

  function drawPacCanvasHud() {
    if (!state) return;
    const collected = state.worms.filter((w) => w.eaten).length + state.powers.filter((p) => p.eaten).length;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 6, 15, .72)';
    ctx.beginPath();
    ctx.roundRect(24, 16, 330, 78, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(77, 151, 255, .36)';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 16, 330, 78);
    ctx.fillStyle = '#eef2ff';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.fillText(`Level ${state.num}`, 42, 46);
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText(`Lives ${state.lives} • Worms ${state.wormsLeft}`, 42, 72);
    ctx.fillStyle = state.powerTimer > 0 ? '#ffd86a' : '#86f6ff';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillText(state.powerTimer > 0 ? `POWER ${state.powerTimer.toFixed(1)}s` : `Burrow Fuel ${Math.max(0, collected - state.dashUsed)}`, 205, 72);
    ctx.restore();
  }

  function drawDashBar() {
    if (!state) return;
    const x = 42, y = canvas.height - 30, w = 230, h = 13;
    ctx.save();
    ctx.fillStyle = 'rgba(7, 14, 34, .86)';
    ctx.beginPath();
    ctx.roundRect(x - 8, y - 24, w + 16, 42, 12);
    ctx.fill();
    ctx.fillStyle = '#16213c';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    const fill = state.dashCooldown <= 0 ? 1 : 1 - (state.dashCooldown / 3.2);
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#ffb53e');
    grad.addColorStop(1, '#ffe06e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w * clamp(fill, 0, 1), h, 8);
    ctx.fill();
    ctx.fillStyle = '#eef2ff';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillText(`Burrow ${state.dashCooldown <= 0 ? 'Ready' : state.dashCooldown.toFixed(1) + 's'}`, x, y - 7);
    ctx.restore();
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
    else if (state.over || state.lives <= 0) start(state.num || saveState.unlocked);
    else if (state.cleared && state.num < 20) start(state.num + 1);
    else if (state.cleared && state.num >= 20) start(1);
    else { state.paused = false; modeEl.textContent = 'Running'; hintEl.textContent = 'Running — clear the maze, use glow-grubs for power mode, and keep the beetles in play.'; }
    // Bring the canvas into view, not the top of the whole site — scrolling
    // to page-top here (as this used to) jumps away from the game itself
    // whenever Start/Resume is tapped mid-session, not just on first launch.
    canvas.scrollIntoView({ block: 'start', behavior: 'auto' });
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
    }
  };
})();
