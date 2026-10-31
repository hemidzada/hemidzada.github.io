// Playable daily board: Queens, Zip or Tango, with timer, undo, hint,
// local progress and the day's leaderboard.
import { isSolved, neighbours, wallKey } from './logic.js';

const API = 'https://aitspcgpmyiubuezffvy.supabase.co/functions/v1/site-daily';

const P = JSON.parse(document.getElementById('puzzle').textContent);
const { game, day, n } = P;
const total = n * n;
const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const storeKey = `panda-daily:${game}:${day}`;

function load() {
  try {
    return JSON.parse(localStorage.getItem(storeKey)) || {};
  } catch {
    return {};
  }
}
// Random id this browser keeps, so the leaderboard counts one solve per player.
function playerId() {
  try {
    let p = localStorage.getItem('panda-daily:player');
    if (!p) localStorage.setItem('panda-daily:player', (p = crypto.randomUUID()));
    return p;
  } catch {
    return undefined;
  }
}
function save(v) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(v));
  } catch {}
}

// ------------------------------------------------------------- state

// Queens: 0 empty, 1 ✕, 2 crown.  Tango: -1 empty, 0 sun, 1 moon.
// Zip: path of cells.
let state = game === 'zip' ? [] : game === 'queens' ? new Array(total).fill(0) : P.givens.slice();
const history = [];
let started = false, done = false, assisted = false;
let t0 = 0, elapsed = 0, tick = 0, runId = null;
const saved = load();

function snapshot() {
  history.push(state.slice());
  if (history.length > 300) history.shift();
}

// ------------------------------------------------------------ render
// The board is one canvas painted like KinQueens's board painters, so
// cells never resize and borders join cleanly.

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
let cs = 0, size = 0;

const RISO = {
  light: {
    ink: '#1B1E3C', sheet: '#F8F9FB', moon: '#3B6CF0', zip: '#009A94', queens: '#7B57C8', tango: '#F7B83D',
    regions: ['#FFAABC', '#7BE7E4', '#E3BA74', '#C7D7FF', '#76E3AB', '#D7ACE3', '#FFBDA5', '#75CCFF', '#D5DE8F'],
  },
  dark: {
    ink: '#ECEEF6', sheet: '#1E2139', moon: '#5A80F2', zip: '#49C7C0', queens: '#AB93ED', tango: '#FAC053',
    regions: ['#F594A3', '#5DDAE0', '#D7A75B', '#B0C6FF', '#6EC1A2', '#C99BD3', '#FFB296', '#52BAF4', '#C9C876'],
  },
};
const INK = '#1B1E3C', ERROR = '#E03153', ERROR_INK = '#A3122F', YELLOW = '#FFD23F', SUN_RIM = '#C16300', ORANGE = '#FF7A3D';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const theme = () => (darkQuery.matches ? RISO.dark : RISO.light);
darkQuery.addEventListener?.('change', () => paint());

const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
const cellXY = (i) => [(i % n) * cs, Math.floor(i / n) * cs];
const center = (i) => [((i % n) + 0.5) * cs, (Math.floor(i / n) + 0.5) * cs];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function line(x1, y1, x2, y2, color, w, cap = 'round') {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = cap;
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function hatch(i, color) {
  const [x, y] = cellXY(i);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, cs, cs);
  ctx.clip();
  const step = cs / 5;
  for (let d = -cs; d < cs; d += step) line(x + d, y + cs, x + d + cs, y, alpha(color, 0.55), 2, 'butt');
  ctx.restore();
}

function crownPath(x, y, w, h) {
  const p = (u, v) => [x + u * w, y + v * h];
  ctx.beginPath();
  const pts = [[0.12, 0.3], [0.33, 0.5], [0.5, 0.18], [0.67, 0.5], [0.88, 0.3], [0.8, 0.74], [0.2, 0.74]];
  pts.forEach(([u, v], k) => (k ? ctx.lineTo(...p(u, v)) : ctx.moveTo(...p(u, v))));
  ctx.closePath();
  const [bx, by] = p(0.2, 0.8);
  const [ex, ey] = p(0.8, 0.88);
  ctx.roundRect ? ctx.roundRect(bx, by, ex - bx, ey - by, w * 0.03) : ctx.rect(bx, by, ex - bx, ey - by);
}

function sun(cx, cy, r, rim) {
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, dx = Math.cos(a), dy = Math.sin(a);
    line(cx + dx * r * 0.78, cy + dy * r * 0.78, cx + dx * r * 1.05, cy + dy * r * 1.05, rim || ORANGE, r * 0.22);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = YELLOW;
  ctx.fill();
  if (rim) {
    ctx.lineWidth = clamp(r * 0.1, 1.5, 2.5);
    ctx.strokeStyle = rim;
    ctx.stroke();
  }
}

function moon(cx, cy, r, color) {
  // Disc minus an offset disc, as Path.combine(difference) in the app.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.arc(cx + r * 0.42, cy - r * 0.3, r * 0.66, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// --- effects (same timings as the app's CellFx)
const fx = { cell: -1, popAt: -1e9, hint: -1, hintAt: -1e9, winAt: -1e9, bits: [] };
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
let raf = 0;
function animate() {
  if (!raf) raf = requestAnimationFrame(() => {
    raf = 0;
    paint();
    const now = performance.now();
    if (now - fx.popAt < 300 || now - fx.hintAt < 1400 || now - fx.winAt < 1300) animate();
  });
}
function pop(i) {
  fx.cell = i;
  fx.popAt = performance.now();
  animate();
}
function flash(i) {
  fx.hint = i;
  fx.hintAt = performance.now();
  animate();
}
function celebrate() {
  fx.winAt = performance.now();
  fx.bits = Array.from({ length: 110 }, (_, i) => ({
    angle: -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4,
    speed: 0.6 + Math.random() * 0.9,
    spin: (Math.random() - 0.5) * 14,
    size: 0.012 + Math.random() * 0.014,
    hue: ['#7B57C8', '#009A94', '#F7B83D', '#FF8A65', '#5A80F2'][i % 5],
  }));
  animate();
}
const popScale = (i) => {
  const t = (performance.now() - fx.popAt) / 180;
  return i === fx.cell && t < 1 ? 0.6 + 0.4 * easeOutBack(t) : 1;
};

function paintQueens(T) {
  const g = P.regions, bad = queensConflicts();
  ctx.save();
  roundRect(0, 0, size, size, 6);
  ctx.clip();
  for (let i = 0; i < total; i++) {
    const [x, y] = cellXY(i);
    ctx.fillStyle = T.regions[g[i] % T.regions.length];
    ctx.fillRect(x, y, cs, cs);
    if (bad.has(i)) hatch(i, ERROR);
  }
  ctx.restore();
  for (let k = 1; k < n; k++) {
    line(k * cs, 0, k * cs, size, alpha(INK, 0.18), 1, 'butt');
    line(0, k * cs, size, k * cs, alpha(INK, 0.18), 1, 'butt');
  }
  const thick = clamp(cs * 0.07, 2, 4);
  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / n), c = i % n;
    if (c < n - 1 && g[i] !== g[i + 1]) line((c + 1) * cs, r * cs, (c + 1) * cs, (r + 1) * cs, INK, thick);
    if (r < n - 1 && g[i] !== g[i + n]) line(c * cs, (r + 1) * cs, (c + 1) * cs, (r + 1) * cs, INK, thick);
  }
  for (let i = 0; i < total; i++) {
    if (!state[i]) continue;
    const k = popScale(i);
    const [cx, cy] = center(i);
    if (state[i] === 1) {
      const m = cs * 0.1 * k, w = clamp(cs * 0.04, 1.2, 2.4);
      line(cx - m, cy - m, cx + m, cy + m, alpha(INK, 0.4), w);
      line(cx + m, cy - m, cx - m, cy + m, alpha(INK, 0.4), w);
    } else {
      const wrong = bad.has(i), s = cs * k, d = cs * 0.14 * k;
      crownPath(cx - s / 2 + d, cy - s / 2 + d, s - 2 * d, s - 2 * d);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = clamp(cs * (wrong ? 0.07 : 0.045), 1.5, 4);
      ctx.strokeStyle = wrong ? ERROR_INK : INK;
      ctx.stroke();
      if (wrong) {
        ctx.beginPath();
        ctx.arc(cx, cy, cs * 0.44, 0, Math.PI * 2);
        ctx.lineWidth = clamp(cs * 0.06, 2, 4);
        ctx.stroke();
      }
    }
  }
  roundRect(0, 0, size, size, 6);
  ctx.lineWidth = thick * 1.3;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function paintZip(T) {
  const ink = T.ink, tone = T.zip;
  roundRect(0, 0, size, size, 6);
  ctx.fillStyle = T.sheet;
  ctx.fill();
  ctx.fillStyle = alpha(tone, 0.16);
  for (const i of state) ctx.fillRect(...cellXY(i), cs, cs);
  for (let k = 1; k < n; k++) {
    line(k * cs, 0, k * cs, size, alpha(ink, 0.16), 1, 'butt');
    line(0, k * cs, size, k * cs, alpha(ink, 0.16), 1, 'butt');
  }
  if (state.length > 1) {
    ctx.beginPath();
    state.forEach((i, k) => (k ? ctx.lineTo(...center(i)) : ctx.moveTo(...center(i))));
    ctx.strokeStyle = tone;
    ctx.lineWidth = cs * 0.34;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke();
  }
  const wall = clamp(cs * 0.1, 3, 6);
  for (const key of P.walls) {
    const a = Math.floor(key / total), b = key % total, ra = Math.floor(a / n), ca = a % n;
    if (b === a + 1) line((ca + 1) * cs, ra * cs, (ca + 1) * cs, (ra + 1) * cs, ink, wall);
    else line(ca * cs, (ra + 1) * cs, (ca + 1) * cs, (ra + 1) * cs, ink, wall);
  }
  roundRect(0, 0, size, size, 6);
  ctx.lineWidth = wall;
  ctx.strokeStyle = ink;
  ctx.stroke();
  const head = state[state.length - 1];
  if (state.length && !done) {
    const [hx, hy] = center(head);
    ctx.beginPath();
    if (P.dots.includes(head)) {
      ctx.arc(hx, hy, cs * 0.41, 0, Math.PI * 2);
      ctx.lineWidth = cs * 0.06;
      ctx.strokeStyle = ink;
      ctx.stroke();
    } else {
      ctx.arc(hx, hy, cs * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }
  const reached = state.filter((i) => P.dots.includes(i)).length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${cs * 0.32}px Archivo, system-ui, sans-serif`;
  P.dots.forEach((d, k) => {
    const [x, y] = center(d);
    ctx.beginPath();
    ctx.arc(x, y, cs * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = k < reached ? tone : ink;
    ctx.fill();
    ctx.fillStyle = T.sheet;
    ctx.fillText(String(k + 1), x, y + cs * 0.02);
  });
}

function paintTango(T) {
  const ink = T.ink, light = T === RISO.light, bad = tangoConflicts();
  roundRect(0, 0, size, size, 6);
  ctx.fillStyle = T.sheet;
  ctx.fill();
  for (let i = 0; i < total; i++) {
    const [x, y] = cellXY(i), [cx, cy] = center(i);
    if (P.givens[i] >= 0) {
      ctx.fillStyle = alpha(ink, 0.08);
      ctx.fillRect(x, y, cs, cs);
    }
    if (bad.has(i)) hatch(i, ERROR);
    const r = cs * 0.34 * popScale(i);
    if (state[i] === 0) sun(cx, cy, r, light ? SUN_RIM : null);
    if (state[i] === 1) moon(cx, cy, r, T.moon);
  }
  for (let k = 1; k < n; k++) {
    line(k * cs, 0, k * cs, size, alpha(ink, 0.2), 1, 'butt');
    line(0, k * cs, size, k * cs, alpha(ink, 0.2), 1, 'butt');
  }
  roundRect(0, 0, size, size, 6);
  ctx.lineWidth = 3;
  ctx.strokeStyle = ink;
  ctx.stroke();
  const sign = (x, y, s) => {
    const r = cs * 0.15, m = r * 0.45, w = clamp(cs * 0.04, 1.5, 3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = T.sheet;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
    if (s === 's') {
      line(x - m, y - m * 0.45, x + m, y - m * 0.45, ink, w);
      line(x - m, y + m * 0.45, x + m, y + m * 0.45, ink, w);
    } else {
      line(x - m, y - m, x + m, y + m, ink, w);
      line(x + m, y - m, x - m, y + m, ink, w);
    }
  };
  for (const k in P.h) sign(((+k % n) + 1) * cs, (Math.floor(+k / n) + 0.5) * cs, P.h[k]);
  for (const k in P.v) sign(((+k % n) + 0.5) * cs, (Math.floor(+k / n) + 1) * cs, P.v[k]);
}

function paintFx(T) {
  const now = performance.now(), color = T[game];
  const tp = (now - fx.popAt) / 280;
  if (fx.cell >= 0 && tp < 1) {
    const t = easeOutCubic(tp), [x, y] = center(fx.cell);
    ctx.beginPath();
    ctx.arc(x, y, cs * (0.25 + 0.45 * t), 0, Math.PI * 2);
    ctx.lineWidth = cs * 0.09 * (1 - t) + 1;
    ctx.strokeStyle = alpha(color, 0.85 * (1 - t));
    ctx.stroke();
  }
  const th = (now - fx.hintAt) / 1400;
  if (fx.hint >= 0 && th < 1) {
    const [x, y] = cellXY(fx.hint);
    ctx.lineWidth = 4;
    ctx.strokeStyle = alpha(T.moon, 1 - th);
    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
  }
  const tw = (now - fx.winAt) / 1100;
  if (tw < 1) {
    const front = tw * (2 * n + 2) - 1.5;
    for (let i = 0; i < total; i++) {
      const d = front - (Math.floor(i / n) + (i % n));
      if (d <= 0 || d >= 3) continue;
      const a = Math.sin((Math.PI * d) / 3), [x, y] = cellXY(i), inset = cs * 0.08 * (1 - a);
      roundRect(x + inset, y + inset, cs - 2 * inset, cs - 2 * inset, cs * 0.18);
      ctx.fillStyle = T === RISO.dark ? alpha(color, 0.35 * a) : alpha('#FFFFFF', 0.5 * a);
      ctx.fill();
    }
  }
  const tc = (now - fx.winAt) / 1200;
  if (tc < 1) {
    for (const b of fx.bits) {
      const v = b.speed * size, s = b.size * size;
      const x = size / 2 + Math.cos(b.angle) * v * tc;
      const y = size * 0.55 + Math.sin(b.angle) * v * tc + 1.1 * size * tc * tc;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.spin * tc);
      ctx.globalAlpha = clamp(1 - tc * tc, 0, 1);
      ctx.fillStyle = b.hue;
      ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
      ctx.restore();
    }
  }
}

function paint() {
  const T = theme();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = canvas.width / size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (game === 'queens') paintQueens(T);
  else if (game === 'zip') paintZip(T);
  else paintTango(T);
  paintFx(T);
}

function resize() {
  size = boardEl.clientWidth;
  cs = size / n;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  paint();
}

function build() {
  canvas.setAttribute('role', 'img');
  boardEl.appendChild(canvas);
  new ResizeObserver(resize).observe(boardEl);
  resize();
  document.fonts?.ready.then(paint);
}

let last = null;

function queensConflicts() {
  const bad = new Set();
  const crowns = [];
  for (let i = 0; i < total; i++) if (state[i] === 2) crowns.push(i);
  for (let a = 0; a < crowns.length; a++) {
    for (let b = a + 1; b < crowns.length; b++) {
      const i = crowns[a], j = crowns[b];
      const ri = Math.floor(i / n), ci = i % n, rj = Math.floor(j / n), cj = j % n;
      if (ri === rj || ci === cj || P.regions[i] === P.regions[j] || (Math.abs(ri - rj) <= 1 && Math.abs(ci - cj) <= 1)) {
        bad.add(i);
        bad.add(j);
      }
    }
  }
  return bad;
}

function tangoConflicts() {
  const bad = new Set();
  const half = n / 2;
  for (let k = 0; k < n; k++) {
    for (const line of [
      Array.from({ length: n }, (_, c) => k * n + c),
      Array.from({ length: n }, (_, r) => r * n + k),
    ]) {
      for (const x of [0, 1]) {
        if (line.filter((i) => state[i] === x).length > half) line.forEach((i) => state[i] === x && bad.add(i));
      }
      for (let i = 0; i + 2 < n; i++) {
        const [a, b, c] = [line[i], line[i + 1], line[i + 2]];
        if (state[a] >= 0 && state[a] === state[b] && state[a] === state[c]) [a, b, c].forEach((j) => bad.add(j));
      }
    }
  }
  const chk = (a, b, s) => {
    if (state[a] >= 0 && state[b] >= 0 && (state[a] === state[b]) !== (s === 's')) {
      bad.add(a);
      bad.add(b);
    }
  };
  for (const k in P.h) chk(+k, +k + 1, P.h[k]);
  for (const k in P.v) chk(+k, +k + n, P.v[k]);
  return bad;
}

function render() {
  // Pop the newest mark, as the app does.
  if (last) {
    if (game === 'zip') {
      if (state.length > last.length) pop(state[state.length - 1]);
    } else {
      const k = state.findIndex((v, i) => v !== last[i] && v !== (game === 'queens' ? 0 : -1));
      if (k >= 0) pop(k);
    }
  }
  last = state.slice();
  paint();
  $('#undo').disabled = !history.length || done;
}

// ------------------------------------------------------------ input

function cellAt(x, y) {
  const r = boardEl.getBoundingClientRect();
  const c = Math.floor(((x - r.left) / r.width) * n);
  const row = Math.floor(((y - r.top) / r.height) * n);
  if (c < 0 || c >= n || row < 0 || row >= n) return -1;
  return row * n + c;
}

let drag = null;

function zipStep(j) {
  const head = state[state.length - 1];
  if (j === head) return;
  if (state.length > 1 && j === state[state.length - 2]) {
    state.pop();
    return;
  }
  if (state.includes(j)) return;
  if (!neighbours(n, head).includes(j) || P.walls.includes(wallKey(n, head, j))) return;
  const d = P.dots.indexOf(j);
  if (d >= 0) {
    const reached = state.filter((i) => P.dots.includes(i)).length;
    if (d !== reached) return;
  }
  state.push(j);
}

function zipTo(j) {
  // Walk in straight steps so a fast drag along a row or column still counts.
  for (let guard = 0; guard < 2 * n; guard++) {
    const head = state[state.length - 1];
    if (head === j || j < 0) return;
    const hr = Math.floor(head / n), hc = head % n, jr = Math.floor(j / n), jc = j % n;
    let next;
    if (Math.abs(jr - hr) >= Math.abs(jc - hc)) next = head + Math.sign(jr - hr) * n;
    else next = head + Math.sign(jc - hc);
    const before = state.length;
    zipStep(next);
    if (state.length === before) return;
  }
}

boardEl.addEventListener('pointerdown', (e) => {
  if (!started || done) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i < 0) return;
  boardEl.setPointerCapture(e.pointerId);
  if (game === 'zip') {
    snapshot();
    const k = state.indexOf(i);
    if (k >= 0) state = state.slice(0, k + 1);
    else if (state.length === 0 && i === P.dots[0]) state = [i];
    else if (state.length) zipTo(i);
    drag = { moved: false };
  } else if (game === 'queens') {
    drag = { start: i, moved: false, mark: state[i] === 0 };
  } else if (P.givens[i] < 0) {
    snapshot();
    state[i] = state[i] === -1 ? 0 : state[i] === 0 ? 1 : -1;
  }
  render();
  check();
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || done) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i < 0) return;
  if (game === 'zip') {
    if (state.length) zipTo(i);
    render();
    check();
  } else if (game === 'queens' && i !== drag.start && drag.mark) {
    // Dragging from an empty cell paints ✕ marks.
    if (!drag.moved) {
      snapshot();
      drag.moved = true;
      state[drag.start] = 1;
    }
    if (state[i] === 0) state[i] = 1;
    render();
  }
});

function endDrag() {
  if (!drag) return;
  if (game === 'queens' && !drag.moved && !done) {
    const i = drag.start;
    snapshot();
    state[i] = (state[i] + 1) % 3;
    render();
    check();
  }
  drag = null;
}
boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', () => (drag = null));

// ------------------------------------------------------------- tools

$('#undo').addEventListener('click', () => {
  if (!history.length || done) return;
  state = history.pop();
  render();
});
$('#clear').addEventListener('click', () => {
  if (done) return;
  snapshot();
  state = game === 'zip' ? [] : game === 'queens' ? new Array(total).fill(0) : P.givens.slice();
  render();
});

function hint() {
  if (!started || done) return;
  assisted = true;
  snapshot();
  const sol = P.solution;
  if (game === 'queens') {
    for (let i = 0; i < total; i++) {
      const crown = sol[Math.floor(i / n)] === i % n;
      if ((state[i] === 2 && !crown) || (state[i] === 1 && crown)) {
        state[i] = crown ? 2 : 0;
        return flash(i);
      }
    }
    for (let r = 0; r < n; r++) {
      const i = r * n + sol[r];
      if (state[i] !== 2) {
        state[i] = 2;
        return flash(i);
      }
    }
  } else if (game === 'tango') {
    for (let i = 0; i < total; i++) {
      if (state[i] >= 0 && state[i] !== sol[i]) {
        state[i] = sol[i];
        return flash(i);
      }
    }
    for (let i = 0; i < total; i++) {
      if (state[i] < 0) {
        state[i] = sol[i];
        return flash(i);
      }
    }
  } else {
    let k = 0;
    while (k < state.length && state[k] === sol[k]) k++;
    state = sol.slice(0, Math.max(k, 1) + 3);
    flash(state[state.length - 1]);
  }
}
$('#hint').addEventListener('click', () => {
  hint();
  render();
  check();
});

// ------------------------------------------------------------- timer

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtPrecise = (ms) => {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

function startGame() {
  started = true;
  $('#cover').remove();
  t0 = performance.now();
  tick = setInterval(() => ($('#timer').textContent = fmt(performance.now() - t0)), 250);
  if (P.live) {
    api('start', { game, day, player: playerId() })
      .then((r) => (runId = r.id))
      .catch(() => {});
  }
}
$('#start').addEventListener('click', startGame);

async function api(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'error');
  return data;
}

// --------------------------------------------------------------- win

function answer() {
  if (game === 'zip') return state;
  if (game === 'tango') return state;
  const cols = new Array(n).fill(-1);
  state.forEach((v, i) => v === 2 && (cols[Math.floor(i / n)] = i % n));
  return cols;
}

function check() {
  if (done || !isSolved(P, answer())) return;
  done = true;
  clearInterval(tick);
  elapsed = performance.now() - t0;
  $('#timer').textContent = fmt(elapsed);
  render();
  ['undo', 'clear', 'hint'].forEach((id) => ($('#' + id).disabled = true));
  celebrate();
  save({ ms: Math.round(elapsed), assisted });
  showWin(Math.round(elapsed));
  if (P.live && runId && !assisted) submit();
}

function showWin(ms, again) {
  const w = $('#win');
  w.classList.add('show');
  $('#win-title').textContent = assisted ? 'Solved with hints' : `Solved in ${fmtPrecise(ms)}`;
  $('#win-text').textContent = P.practice
    ? 'Nice! Pick a size and tap New puzzle for another board.'
    : again
    ? 'You already solved this board on this device.'
    : assisted
      ? 'Hints were used, so this run is not ranked. Try tomorrow’s board without hints.'
      : P.live
        ? 'Checking your rank…'
        : 'Ranking is open only on the day of the puzzle. Today’s board is waiting.';
}

async function submit() {
  try {
    const r = await api('finish', { id: runId, answer: answer() });
    const s = load();
    save({ ...s, rank: r.rank, id: runId, ms: r.ms });
    $('#win-title').textContent = `Solved in ${fmtPrecise(r.ms)}`;
    if (!r.counted) {
      $('#win-text').textContent = 'Only your first solve of the day is ranked.';
    } else if (r.rank <= 100) {
      $('#win-text').textContent = `You are #${r.rank} of ${r.total} today. Add your name to the top 100.`;
      $('#name-form').hidden = false;
    } else {
      $('#win-text').textContent = `You are #${r.rank} of ${r.total} today. The top 100 get on the list.`;
    }
    loadTop(runId);
  } catch {
    $('#win-text').textContent = 'Solved! The ranking could not be reached right now.';
  }
}

$('#name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  const s = load();
  $('#name-msg').textContent = 'Saving…';
  try {
    await api('name', { id: s.id || runId, name });
    save({ ...s, named: true });
    $('#name-form').hidden = true;
    $('#name-msg').textContent = 'You are on today’s list.';
    loadTop(s.id || runId);
  } catch (err) {
    $('#name-msg').textContent =
      err.message === 'bad_name' ? 'Use 2–16 letters or numbers, nothing rude.' : 'Could not save, try again.';
  }
});

// ------------------------------------------------------- leaderboard

async function loadTop(mine) {
  const list = $('#lb');
  if (!list) return;
  try {
    const r = await api(`top?game=${game}&day=${day}${mine ? `&me=${mine}` : ''}`);
    $('#lb-count').textContent = r.total
      ? `${r.total.toLocaleString('en')} ${r.total === 1 ? 'player' : 'players'} solved this board.`
      : 'No solves yet. Be the first!';
    list.innerHTML = '';
    for (const row of r.top) {
      const li = document.createElement('li');
      if (row.me === mine) li.className = 'me';
      li.innerHTML = '<span class="rk"></span><span class="nm"></span><span></span>';
      li.children[0].textContent = row.rank;
      li.children[1].textContent = row.name || 'Anonymous';
      li.children[2].textContent = fmtPrecise(row.ms);
      list.appendChild(li);
    }
  } catch {
    $('#lb-count').textContent = 'The ranking is offline right now.';
  }
}

// -------------------------------------------------------------- boot

build();
render();
if (saved.ms != null) {
  // Show the finished board again.
  $('#cover').remove();
  started = done = true;
  assisted = !!saved.assisted;
  if (game === 'zip') state = P.solution.slice();
  else if (game === 'tango') state = P.solution.slice();
  else state = P.solution.reduce((s, c, r) => ((s[r * n + c] = 2), s), new Array(total).fill(0));
  $('#timer').textContent = fmt(saved.ms);
  last = null;
  render();
  showWin(saved.ms, true);
  if (saved.rank) $('#win-text').textContent = `You were #${saved.rank} on this board.`;
}
['undo', 'clear', 'hint'].forEach((id) => ($('#' + id).disabled ||= done));
loadTop(saved.id);
// Re-enable tools once started (they start disabled behind the cover).
$('#start')?.addEventListener('click', () => ['clear', 'hint'].forEach((id) => ($('#' + id).disabled = false)));
