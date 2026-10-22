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

const ICON = {
  crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7.5l4.6 4 4.4-6.5 4.4 6.5 4.6-4-1.9 11H4.9z"/><rect x="4.9" y="19.6" width="14.2" height="2" rx="1"/></svg>',
  x: '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="var(--sun)" stroke="var(--sun-rim)" stroke-width="2"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M15.5 3.2A9 9 0 1 0 20.8 15 7.2 7.2 0 0 1 15.5 3.2z" fill="var(--moon)"/></svg>',
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(storeKey)) || {};
  } catch {
    return {};
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

const cells = [];
let trail = null;

function build() {
  boardEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  boardEl.classList.add(game[0]);
  for (let i = 0; i < total; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.dataset.i = i;
    const r = Math.floor(i / n), col = i % n;
    if (game === 'queens') {
      c.style.background = `var(--r${P.regions[i]})`;
      if (col < n - 1 && P.regions[i] !== P.regions[i + 1]) c.classList.add('rt');
      if (r < n - 1 && P.regions[i] !== P.regions[i + n]) c.classList.add('bt');
    } else if (game === 'zip') {
      const walls = new Set(P.walls);
      if (col < n - 1 && walls.has(wallKey(n, i, i + 1))) c.classList.add('wr');
      if (r < n - 1 && walls.has(wallKey(n, i, i + n))) c.classList.add('wb');
      const d = P.dots.indexOf(i);
      if (d >= 0) c.innerHTML = `<span class="dot">${d + 1}</span>`;
    } else if (P.givens[i] >= 0) {
      c.classList.add('given');
    }
    cells.push(c);
    boardEl.appendChild(c);
  }
  if (game === 'zip') {
    trail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    trail.setAttribute('class', 'trail');
    trail.setAttribute('viewBox', `0 0 ${n} ${n}`);
    trail.innerHTML = `<polyline fill="none" stroke="var(--zip)" stroke-width="0.34" stroke-linecap="round" stroke-linejoin="round"/>`;
    boardEl.appendChild(trail);
  }
  if (game === 'tango') {
    const put = (i, s, horiz) => {
      const el = document.createElement('span');
      el.className = 'sign';
      el.textContent = s === 's' ? '=' : '×';
      const r = Math.floor(i / n), col = i % n;
      el.style.left = `${((horiz ? col + 1 : col + 0.5) / n) * 100}%`;
      el.style.top = `${((horiz ? r + 0.5 : r + 1) / n) * 100}%`;
      boardEl.appendChild(el);
    };
    for (const k in P.h) put(+k, P.h[k], true);
    for (const k in P.v) put(+k, P.v[k], false);
  }
}

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
  if (game === 'queens') {
    const bad = queensConflicts();
    cells.forEach((c, i) => {
      c.innerHTML = state[i] === 2 ? ICON.crown : state[i] === 1 ? ICON.x : '';
      c.classList.toggle('bad', bad.has(i));
    });
  } else if (game === 'tango') {
    const bad = tangoConflicts();
    cells.forEach((c, i) => {
      c.innerHTML = state[i] === 0 ? ICON.sun : state[i] === 1 ? ICON.moon : '';
      c.classList.toggle('bad', bad.has(i));
    });
  } else {
    const on = new Set(state);
    cells.forEach((c, i) => c.classList.toggle('on', on.has(i)));
    trail.firstChild.setAttribute(
      'points',
      state.map((i) => `${(i % n) + 0.5},${Math.floor(i / n) + 0.5}`).join(' '),
    );
  }
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

function flash(i) {
  const c = cells[i];
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
}

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
    api('start', { game, day })
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
  save({ ms: Math.round(elapsed), assisted });
  showWin(Math.round(elapsed));
  if (P.live && runId && !assisted) submit();
}

function showWin(ms, again) {
  const w = $('#win');
  w.classList.add('show');
  $('#win-title').textContent = assisted ? 'Solved with hints' : `Solved in ${fmtPrecise(ms)}`;
  $('#win-text').textContent = again
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
  render();
  showWin(saved.ms, true);
  if (saved.rank) $('#win-text').textContent = `You were #${saved.rank} on this board.`;
}
['undo', 'clear', 'hint'].forEach((id) => ($('#' + id).disabled ||= done));
loadTop(saved.id);
// Re-enable tools once started (they start disabled behind the cover).
$('#start')?.addEventListener('click', () => ['clear', 'hint'].forEach((id) => ($('#' + id).disabled = false)));
