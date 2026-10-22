// Puzzle generators, solvers and rule checks for the daily Queens, Zip and
// Tango boards. A line-by-line port of Pocket Logic's lib/logic/*.dart, so a
// given date gives the same board on the site and in the app.
// Used by the page script, the static build (tools/build-daily.mjs) and the
// leaderboard edge function.

// ------------------------------------------------------------------ rng

export class Rng {
  constructor(seed) {
    this.s = seed >>> 0;
  }
  nextU32() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0)) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }
  nextInt(n) {
    return this.nextU32() % n;
  }
  nextBool() {
    return (this.nextU32() & 1) === 1;
  }
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
  }
}

export const GAMES = ['queens', 'zip', 'tango'];

/// "2026-10-22" -> seed; same formula as the app's dailySeed().
export function dailySeed(day, game) {
  const [y, m, d] = day.split('-').map(Number);
  return (y * 10000 + m * 100 + d) * 31 + GAMES.indexOf(game) * 7919;
}

/// Friday to Sunday boards are a size bigger, as in the app.
export function isWeekend(day) {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return wd === 0 || wd === 5 || wd === 6;
}

export function dailyPuzzle(game, day) {
  const weekend = isWeekend(day);
  const rng = new Rng(dailySeed(day, game));
  if (game === 'queens') {
    for (;;) {
      const p = generateQueens(weekend ? 8 : 7, rng);
      if (gradeQueens(p) <= 4) return p;
    }
  }
  if (game === 'zip') {
    return generateZip(weekend ? 7 : 6, rng, { maxDots: weekend ? 9 : 10 });
  }
  for (;;) {
    const p = generateTango(6, rng, weekend ? 7 : 9);
    if (gradeTango(p) <= 2) return p;
  }
}

// --------------------------------------------------------------- queens

const D4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function placeCrowns(n, rng) {
  const p = new Array(n).fill(0);
  const used = new Array(n).fill(false);
  const bt = (r) => {
    if (r === n) return true;
    const cols = Array.from({ length: n }, (_, i) => i);
    rng.shuffle(cols);
    for (const c of cols) {
      if (used[c] || (r > 0 && Math.abs(p[r - 1] - c) <= 1)) continue;
      p[r] = c;
      used[c] = true;
      if (bt(r + 1)) return true;
      used[c] = false;
    }
    return false;
  };
  bt(0);
  return p;
}

function growRegions(n, crowns, rng) {
  const g = new Array(n * n).fill(-1);
  for (let r = 0; r < n; r++) g[r * n + crowns[r]] = r;
  let left = n * n - n;
  while (left > 0) {
    const reg = rng.nextInt(n);
    const frontier = [];
    for (let i = 0; i < n * n; i++) {
      if (g[i] !== reg) continue;
      const r = Math.floor(i / n), c = i % n;
      for (const d of D4) {
        const rr = r + d[0], cc = c + d[1];
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && g[rr * n + cc] < 0) {
          frontier.push(rr * n + cc);
        }
      }
    }
    if (frontier.length === 0) continue;
    g[frontier[rng.nextInt(frontier.length)]] = reg;
    left--;
  }
  return g;
}

export function solveQueens(n, g, limit = 2) {
  const sols = [];
  const colUsed = new Array(n).fill(false);
  const regUsed = new Array(n).fill(false);
  const cur = new Array(n).fill(0);
  const bt = (r, prev) => {
    if (r === n) {
      sols.push(cur.slice());
      return sols.length >= limit;
    }
    for (let c = 0; c < n; c++) {
      if (colUsed[c] || Math.abs(prev - c) <= 1) continue;
      const rg = g[r * n + c];
      if (regUsed[rg]) continue;
      colUsed[c] = regUsed[rg] = true;
      cur[r] = c;
      if (bt(r + 1, c)) return true;
      colUsed[c] = regUsed[rg] = false;
    }
    return false;
  };
  bt(0, -9);
  return sols;
}

function connectedWithout(n, g, reg, skip) {
  const cells = [];
  for (let i = 0; i < n * n; i++) if (g[i] === reg && i !== skip) cells.push(i);
  if (cells.length === 0) return false;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / n), c = i % n;
    for (const d of D4) {
      const rr = r + d[0], cc = c + d[1];
      const j = rr * n + cc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && j !== skip && g[j] === reg && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === cells.length;
}

export function generateQueens(n, rng) {
  for (;;) {
    const crowns = placeCrowns(n, rng);
    const g = growRegions(n, crowns, rng);
    const fixed = new Set();
    for (let r = 0; r < n; r++) fixed.add(r * n + crowns[r]);
    for (let it = 0; it < 600; it++) {
      const sols = solveQueens(n, g);
      if (sols.length === 1) return { game: 'queens', n, regions: g, solution: crowns };
      const alt = sols.find((s) => s.some((v, r) => v !== crowns[r]));
      const cand = [];
      for (let r = 0; r < n; r++) if (!fixed.has(r * n + alt[r])) cand.push(r * n + alt[r]);
      if (cand.length === 0) break;
      const i = cand[rng.nextInt(cand.length)];
      const r = Math.floor(i / n), c = i % n;
      const nb = [];
      for (const d of D4) {
        const rr = r + d[0], cc = c + d[1];
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && g[rr * n + cc] !== g[i]) nb.push(g[rr * n + cc]);
      }
      if (nb.length === 0 || !connectedWithout(n, g, g[i], i)) continue;
      g[i] = nb[rng.nextInt(nb.length)];
    }
  }
}

function* combinations(n, k) {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return;
  for (;;) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export function gradeQueens(p) {
  const n = p.n, g = p.regions;
  const s = new Array(n * n).fill(0);
  let hardest = 1;
  const gs = [];
  for (let r = 0; r < n; r++) gs.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) gs.push(Array.from({ length: n }, (_, r) => r * n + c));
  for (let k = 0; k < n; k++) {
    const grp = [];
    for (let i = 0; i < n * n; i++) if (g[i] === k) grp.push(i);
    gs.push(grp);
  }
  const attacks = (a, b) => {
    const ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n;
    return ra === rb || ca === cb || g[a] === g[b] || (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1);
  };
  const place = (i) => {
    s[i] = 2;
    for (let j = 0; j < n * n; j++) if (j !== i && s[j] === 0 && attacks(i, j)) s[j] = 1;
  };
  const singles = () => {
    for (const grp of gs) {
      if (grp.some((i) => s[i] === 2)) continue;
      const open = grp.filter((i) => s[i] === 0);
      if (open.length === 1) {
        place(open[0]);
        return true;
      }
    }
    return false;
  };
  const confinement = () => {
    let changed = false;
    for (const a of gs) {
      if (a.some((i) => s[i] === 2)) continue;
      const open = new Set(a.filter((i) => s[i] === 0));
      if (open.size === 0) continue;
      for (const b of gs) {
        if (a === b) continue;
        if ([...open].every((i) => b.includes(i))) {
          for (const j of b) {
            if (s[j] === 0 && !open.has(j)) {
              s[j] = 1;
              changed = true;
            }
          }
        }
      }
    }
    return changed;
  };
  const lines = gs.slice(0, 2 * n);
  const regionGroups = gs.slice(2 * n);
  const pigeonhole = () => {
    const tryFamily = (owners, targets) => {
      const open = [];
      for (const o of owners) {
        if (!o.some((i) => s[i] === 2)) open.push(new Set(o.filter((i) => s[i] === 0)));
      }
      for (let k = 2; k <= 3; k++) {
        for (const combo of combinations(open.length, k)) {
          const cells = new Set();
          for (const x of combo) for (const c of open[x]) cells.add(c);
          for (const tCombo of combinations(targets.length, k)) {
            const tCells = new Set();
            for (const x of tCombo) for (const c of targets[x]) tCells.add(c);
            if (![...cells].every((c) => tCells.has(c))) continue;
            let changed = false;
            for (const j of tCells) {
              if (s[j] === 0 && !cells.has(j)) {
                s[j] = 1;
                changed = true;
              }
            }
            if (changed) return true;
          }
        }
      }
      return false;
    };
    const rows = lines.slice(0, n), cols = lines.slice(n);
    return (
      tryFamily(regionGroups, rows) ||
      tryFamily(regionGroups, cols) ||
      tryFamily(rows, regionGroups) ||
      tryFamily(cols, regionGroups)
    );
  };
  const lookahead = () => {
    for (let i = 0; i < n * n; i++) {
      if (s[i] !== 0) continue;
      for (const grp of gs) {
        if (grp.some((j) => s[j] === 2)) continue;
        if (grp.every((j) => j === i || s[j] !== 0 || attacks(i, j))) {
          s[i] = 1;
          return true;
        }
      }
    }
    return false;
  };
  while (s.filter((v) => v === 2).length < n) {
    if (singles()) continue;
    if (confinement()) {
      if (hardest < 2) hardest = 2;
      continue;
    }
    if (pigeonhole()) {
      if (hardest < 3) hardest = 3;
      continue;
    }
    if (lookahead()) {
      hardest = 4;
      continue;
    }
    return 5;
  }
  return hardest;
}

/// Crowns as a column per row (-1 = none) -> true when every rule holds.
export function queensSolved(p, cols) {
  const n = p.n;
  if (cols.length !== n || cols.some((c) => !(c >= 0 && c < n))) return false;
  const colSeen = new Set(), regSeen = new Set();
  for (let r = 0; r < n; r++) {
    if (colSeen.has(cols[r])) return false;
    colSeen.add(cols[r]);
    const rg = p.regions[r * n + cols[r]];
    if (regSeen.has(rg)) return false;
    regSeen.add(rg);
    if (r > 0 && Math.abs(cols[r] - cols[r - 1]) <= 1) return false;
  }
  return true;
}

// ------------------------------------------------------------------ zip

export const wallKey = (n, a, b) => (a < b ? a * n * n + b : b * n * n + a);

export function neighbours(n, i) {
  const r = Math.floor(i / n), c = i % n;
  const out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

function randomPath(n, rng) {
  const total = n * n;
  for (;;) {
    const visited = new Array(total).fill(false);
    const path = [];
    let budget = 20000;
    const degree = (j) => neighbours(n, j).filter((k) => !visited[k]).length;
    const bt = (i) => {
      if (--budget < 0) return false;
      visited[i] = true;
      path.push(i);
      if (path.length === total) return true;
      const next = neighbours(n, i).filter((j) => !visited[j]);
      rng.shuffle(next);
      // Dart sorts lists this short with a stable insertion sort; so does JS.
      const deg = new Map(next.map((j) => [j, degree(j)]));
      next.sort((a, b) => deg.get(a) - deg.get(b));
      for (const j of next) if (bt(j)) return true;
      visited[i] = false;
      path.pop();
      return false;
    };
    if (bt(rng.nextInt(total))) return path;
  }
}

export function solveZip(n, dots, walls, limit = 2) {
  const total = n * n;
  const dotIndex = new Array(total).fill(-1);
  dots.forEach((cell, k) => (dotIndex[cell] = k));
  const adj = [];
  for (let i = 0; i < total; i++) adj.push(neighbours(n, i).filter((j) => !walls.has(wallKey(n, i, j))));
  const visited = new Array(total).fill(false);
  const path = [];
  const sols = [];
  const last = dots[dots.length - 1];
  const viable = (head) => {
    const seen = new Array(total).fill(false);
    const stack = [head];
    seen[head] = true;
    let reached = 0;
    while (stack.length) {
      const i = stack.pop();
      for (const j of adj[i]) {
        if (!visited[j] && !seen[j]) {
          seen[j] = true;
          reached++;
          stack.push(j);
        }
      }
    }
    if (reached !== total - path.length) return false;
    for (let i = 0; i < total; i++) {
      if (visited[i] || i === last) continue;
      let free = 0;
      for (const j of adj[i]) if (!visited[j] || j === head) free++;
      if (free < 2) return false;
    }
    return true;
  };
  const bt = (i, nextDot) => {
    visited[i] = true;
    path.push(i);
    if (path.length === total) {
      if (i === last) sols.push(path.slice());
      visited[i] = false;
      path.pop();
      return sols.length >= limit;
    }
    if (i !== last && viable(i)) {
      for (const j of adj[i]) {
        if (visited[j]) continue;
        const d = dotIndex[j];
        if (d >= 0 && d !== nextDot) continue;
        if (bt(j, d >= 0 ? nextDot + 1 : nextDot)) return true;
      }
    }
    visited[i] = false;
    path.pop();
    return false;
  };
  bt(dots[0], 1);
  return sols;
}

export function generateZip(n, rng, { startDots = 4, wallBias = 0.65, maxDots } = {}) {
  const total = n * n;
  const dotCap = maxDots ?? n + 4;
  attempt: for (;;) {
    const path = randomPath(n, rng);
    // Dart's Set keeps insertion order; sorting below makes it irrelevant.
    const steps = new Set([0, total - 1]);
    while (steps.size < startDots + 2) steps.add(1 + rng.nextInt(total - 2));
    const pathEdges = new Set();
    for (let k = 0; k + 1 < total; k++) pathEdges.add(wallKey(n, path[k], path[k + 1]));
    const walls = new Set();
    for (;;) {
      const dots = [...steps].sort((a, b) => a - b).map((k) => path[k]);
      if (dots.length > dotCap) continue attempt;
      const sols = solveZip(n, dots, walls);
      if (sols.length === 1) return { game: 'zip', n, dots, walls: [...walls], solution: path };
      const pj = path.join(',');
      const alt = sols.find((s) => s.join(',') !== pj);
      let k = 0;
      while (alt[k] === path[k]) k++;
      const altEdge = wallKey(n, alt[k - 1], alt[k]);
      if (!pathEdges.has(altEdge) && rng.nextInt(1000) < wallBias * 1000) {
        walls.add(altEdge);
      } else {
        let at = Math.min(Math.max(k + rng.nextInt(3), 1), total - 2);
        while (steps.has(at) && at > 1) at--;
        if (steps.has(at)) steps.add(Math.min(Math.max(k, 1), total - 2));
        else steps.add(at);
      }
    }
  }
}

/// Path of cell indices -> true when it is a full, legal Zip solution.
export function zipSolved(p, path) {
  const n = p.n, total = n * n;
  if (path.length !== total || path[0] !== p.dots[0] || path[total - 1] !== p.dots[p.dots.length - 1]) return false;
  const walls = new Set(p.walls);
  const seen = new Set();
  let next = 0;
  for (let k = 0; k < total; k++) {
    const i = path[k];
    if (!(i >= 0 && i < total) || seen.has(i)) return false;
    seen.add(i);
    if (k > 0) {
      const a = path[k - 1];
      if (!neighbours(n, a).includes(i) || walls.has(wallKey(n, a, i))) return false;
    }
    const d = p.dots.indexOf(i);
    if (d >= 0) {
      if (d !== next) return false;
      next++;
    }
  }
  return next === p.dots.length;
}

// ---------------------------------------------------------------- tango

// Signs are stored as { cellIndex: 's' | 'd' } (same / different).

export function tangoValid(n, v, h, vs, complete = false) {
  const half = n / 2;
  for (let k = 0; k < n; k++) {
    const row = [], col = [];
    for (let c = 0; c < n; c++) row.push(v[k * n + c]);
    for (let r = 0; r < n; r++) col.push(v[r * n + k]);
    for (const line of [row, col]) {
      let z = 0, o = 0;
      for (const x of line) {
        if (x === 0) z++;
        else if (x === 1) o++;
      }
      if (z > half || o > half) return false;
      if (complete && line.includes(-1)) return false;
      for (let i = 0; i + 2 < n; i++) {
        if (line[i] >= 0 && line[i] === line[i + 1] && line[i] === line[i + 2]) return false;
      }
    }
  }
  const signOk = (a, b, s) => v[a] < 0 || v[b] < 0 || (v[a] === v[b]) === (s === 's');
  for (const k in h) if (!signOk(+k, +k + 1, h[k])) return false;
  for (const k in vs) if (!signOk(+k, +k + n, vs[k])) return false;
  return true;
}

function countTango(n, givens, h, vs, limit = 2) {
  const v = givens.slice();
  let count = 0;
  const bt = (i) => {
    if (i === n * n) {
      count++;
      return count >= limit;
    }
    if (v[i] >= 0) return bt(i + 1);
    for (const x of [0, 1]) {
      v[i] = x;
      if (tangoValid(n, v, h, vs) && bt(i + 1)) return true;
    }
    v[i] = -1;
    return false;
  };
  bt(0);
  return count;
}

function fullGrid(n, rng) {
  const v = new Array(n * n).fill(-1);
  const bt = (i) => {
    if (i === n * n) return true;
    const opts = rng.nextBool() ? [0, 1] : [1, 0];
    for (const x of opts) {
      v[i] = x;
      if (tangoValid(n, v, {}, {}) && bt(i + 1)) return true;
    }
    v[i] = -1;
    return false;
  };
  bt(0);
  return v;
}

export function generateTango(n, rng, signCount = 8) {
  const sol = fullGrid(n, rng);
  const h = {}, vs = {};
  const edges = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (c + 1 < n) edges.push([i, 0]);
      if (r + 1 < n) edges.push([i, 1]);
    }
  }
  rng.shuffle(edges);
  for (const [i, dir] of edges.slice(0, signCount)) {
    const j = dir === 0 ? i + 1 : i + n;
    (dir === 0 ? h : vs)[i] = sol[i] === sol[j] ? 's' : 'd';
  }
  const givens = sol.slice();
  const order = Array.from({ length: n * n }, (_, i) => i);
  rng.shuffle(order);
  for (const i of order) {
    const keep = givens[i];
    givens[i] = -1;
    if (countTango(n, givens, h, vs) !== 1) givens[i] = keep;
  }
  return { game: 'tango', n, givens, h, v: vs, solution: sol };
}

export function gradeTango(p) {
  const n = p.n;
  const v = p.givens.slice();
  let hardest = 1;
  const simple = () => {
    let changed = false;
    for (let i = 0; i < n * n; i++) {
      if (v[i] >= 0) continue;
      for (const x of [0, 1]) {
        v[i] = x;
        const ok = tangoValid(n, v, p.h, p.v);
        v[i] = -1;
        if (!ok) {
          v[i] = 1 - x;
          changed = true;
          break;
        }
      }
    }
    return changed;
  };
  const lookahead = () => {
    for (let i = 0; i < n * n; i++) {
      if (v[i] >= 0) continue;
      for (const x of [0, 1]) {
        const snapshot = v.slice();
        v[i] = x;
        let dead = false;
        for (;;) {
          if (!tangoValid(n, v, p.h, p.v)) {
            dead = true;
            break;
          }
          if (!simple()) break;
        }
        if (!dead && !tangoValid(n, v, p.h, p.v)) dead = true;
        for (let k = 0; k < v.length; k++) v[k] = snapshot[k];
        if (dead) {
          v[i] = 1 - x;
          return true;
        }
      }
    }
    return false;
  };
  while (v.includes(-1)) {
    if (simple()) continue;
    if (lookahead()) {
      hardest = 2;
      continue;
    }
    return 3;
  }
  return hardest;
}

/// Full board of 0/1 -> true when it matches the givens and every rule holds.
export function tangoSolved(p, board) {
  const n = p.n;
  if (board.length !== n * n || board.some((x) => x !== 0 && x !== 1)) return false;
  if (p.givens.some((g, i) => g >= 0 && g !== board[i])) return false;
  return tangoValid(n, board, p.h, p.v, true);
}

/// One check for all three games; `answer` is crowns per row (Queens), the
/// path (Zip) or the full board (Tango).
export function isSolved(p, answer) {
  if (!Array.isArray(answer)) return false;
  if (p.game === 'queens') return queensSolved(p, answer);
  if (p.game === 'zip') return zipSolved(p, answer);
  return tangoSolved(p, answer);
}
