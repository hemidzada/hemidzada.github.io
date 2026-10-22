// Builds the daily puzzle pages: /queens/2026-10-22/ and the like, one per
// game per day up to today (Baku time), plus each game's archive, the
// /daily/ hub, today's links on the guide pages and the sitemap.
// Run: node tools/build-daily.mjs [--today=YYYY-MM-DD]
// Only rewrites files whose content changed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dailyPuzzle, isWeekend } from '../daily/logic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://panda.az';
const FIRST_DAY = '2026-10-01';
// Days before this had no ranking yet.
const RANKED_FROM = '2026-10-23';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.pandaaz.pocketlogic';

const arg = process.argv.find((a) => a.startsWith('--today='));
const TODAY = arg ? arg.slice(8) : bakuToday();

function bakuToday() {
  return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
}
const addDays = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const shortDate = (day) => {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GAMES = {
  queens: {
    title: 'Queens',
    color: 'var(--queens)',
    rule: 'Place one crown in every row, every column and every colour region. Crowns may not touch, not even at a corner.',
    short: 'One crown per row, column and colour',
    how: 'Tap a cell once for ✕, twice for a crown. Drag across empty cells to mark many ✕ at once.',
  },
  zip: {
    title: 'Zip',
    color: 'var(--zip)',
    rule: 'Draw one line that passes through every cell, visiting the numbered dots in order from 1. The line cannot cross a wall.',
    short: 'One line through every cell, in order',
    how: 'Start on dot 1 and drag. Drag back to undo the last steps, or tap any cell on the line to cut it there.',
  },
  tango: {
    title: 'Tango',
    color: 'var(--tango)',
    rule: 'Fill every cell with a sun or a moon. Each row and column has as many suns as moons, never three of the same in a row. Cells joined by = match, cells joined by × are different.',
    short: 'Balance suns and moons',
    how: 'Tap a cell once for a sun, twice for a moon, three times to clear it. Grey cells are given.',
  },
};
const REGION_NAMES = ['pink', 'aqua', 'sand', 'periwinkle', 'mint', 'lilac', 'peach', 'sky blue', 'lime'];
const REGION_HEX = ['#FFAABC', '#7BE7E4', '#E3BA74', '#C7D7FF', '#76E3AB', '#D7ACE3', '#FFBDA5', '#75CCFF', '#D5DE8F'];

let written = 0;
function put(rel, content) {
  const file = join(ROOT, rel);
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  written++;
}

// ------------------------------------------------------------- puzzles

const days = [];
for (let d = FIRST_DAY; d <= TODAY; d = addDays(d, 1)) days.push(d);

const cache = new Map();
function puzzle(game, day) {
  const key = game + day;
  if (!cache.has(key)) cache.set(key, dailyPuzzle(game, day));
  return cache.get(key);
}

/// Client data; walls, signs and solution included (hints need them).
function clientData(p, day, live) {
  const base = { game: p.game, day, n: p.n, live, solution: p.solution };
  if (p.game === 'queens') return { ...base, regions: p.regions };
  if (p.game === 'zip') return { ...base, dots: p.dots, walls: p.walls };
  return { ...base, givens: p.givens, h: p.h, v: p.v };
}

function facts(p) {
  const n = p.n;
  if (p.game === 'queens') {
    const size = new Array(n).fill(0);
    p.regions.forEach((r) => size[r]++);
    const small = size.indexOf(Math.min(...size));
    return {
      lead: `a ${n}×${n} board with ${n} colour regions`,
      hint: `Start with the ${REGION_NAMES[small]} region: it has only ${size[small]} ${size[small] === 1 ? 'cell' : 'cells'}, so its crown has few places to go.`,
    };
  }
  if (p.game === 'zip') {
    const d0 = p.dots[0];
    return {
      lead: `a ${n}×${n} board with ${p.dots.length} numbered dots${p.walls.length ? ` and ${p.walls.length} ${p.walls.length === 1 ? 'wall' : 'walls'}` : ''}`,
      hint: `Dot 1 sits in row ${Math.floor(d0 / n) + 1}, column ${(d0 % n) + 1}. Fill corners and edges early: a corner cell can only be entered one way.`,
    };
  }
  const givens = p.givens.filter((g) => g >= 0).length;
  const signs = Object.keys(p.h).length + Object.keys(p.v).length;
  return {
    lead: `a ${n}×${n} board with ${givens} given cells and ${signs} = / × signs`,
    hint: 'Look for two equal symbols side by side: the cells on both ends of the pair must be the other symbol.',
  };
}

// ---------------------------------------------------------- answer svg

function boardSvg(p, solved = true) {
  const n = p.n, s = 40, W = n * s;
  const out = [`<svg viewBox="-2 -2 ${W + 4} ${W + 4}" width="100%" role="img" aria-label="${solved ? 'Solved' : 'Today’s'} ${GAMES[p.game].title} board">`];
  const rect = (i, fill) => `<rect x="${(i % n) * s}" y="${Math.floor(i / n) * s}" width="${s}" height="${s}" fill="${fill}" stroke="#1B1E3C" stroke-opacity=".25"/>`;
  const cx = (i) => (i % n) * s + s / 2, cy = (i) => Math.floor(i / n) * s + s / 2;
  if (p.game === 'queens') {
    for (let i = 0; i < n * n; i++) out.push(rect(i, REGION_HEX[p.regions[i]]));
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * s, y = Math.floor(i / n) * s;
      if (i % n < n - 1 && p.regions[i] !== p.regions[i + 1]) out.push(`<line x1="${x + s}" y1="${y}" x2="${x + s}" y2="${y + s}" stroke="#1B1E3C" stroke-width="3"/>`);
      if (i < n * n - n && p.regions[i] !== p.regions[i + n]) out.push(`<line x1="${x}" y1="${y + s}" x2="${x + s}" y2="${y + s}" stroke="#1B1E3C" stroke-width="3"/>`);
    }
    if (solved) p.solution.forEach((c, r) => {
      const x = c * s + s * 0.14, y = r * s + s * 0.14, w = s * 0.72;
      const pt = (u, v) => `${(x + u * w).toFixed(1)},${(y + v * w).toFixed(1)}`;
      out.push(`<path d="M${[[0.12, 0.3], [0.33, 0.5], [0.5, 0.18], [0.67, 0.5], [0.88, 0.3], [0.8, 0.74], [0.2, 0.74]].map(([u, v]) => pt(u, v)).join('L')}Z" fill="#fff" stroke="#1B1E3C" stroke-width="1.8" stroke-linejoin="round"/><rect x="${(x + 0.2 * w).toFixed(1)}" y="${(y + 0.8 * w).toFixed(1)}" width="${(0.6 * w).toFixed(1)}" height="${(0.08 * w).toFixed(1)}" rx="1" fill="#fff" stroke="#1B1E3C" stroke-width="1.8"/>`);
    });
  } else if (p.game === 'zip') {
    for (let i = 0; i < n * n; i++) out.push(rect(i, '#FFFFFF'));
    if (solved) out.push(`<polyline points="${p.solution.map((i) => `${cx(i)},${cy(i)}`).join(' ')}" fill="none" stroke="#009A94" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`);
    p.dots.forEach((i, k) => out.push(`<circle cx="${cx(i)}" cy="${cy(i)}" r="13" fill="#1B1E3C"/><text x="${cx(i)}" y="${cy(i) + 5}" text-anchor="middle" font-size="15" font-weight="800" fill="#fff" font-family="Archivo,sans-serif">${k + 1}</text>`));
    for (const w of p.walls) {
      const a = Math.floor(w / (n * n)), b = w % (n * n);
      if (b === a + 1) out.push(`<line x1="${(a % n + 1) * s}" y1="${Math.floor(a / n) * s}" x2="${(a % n + 1) * s}" y2="${Math.floor(a / n) * s + s}" stroke="#1B1E3C" stroke-width="5" stroke-linecap="round"/>`);
      else out.push(`<line x1="${(a % n) * s}" y1="${(Math.floor(a / n) + 1) * s}" x2="${(a % n) * s + s}" y2="${(Math.floor(a / n) + 1) * s}" stroke="#1B1E3C" stroke-width="5" stroke-linecap="round"/>`);
    }
  } else {
    for (let i = 0; i < n * n; i++) {
      out.push(rect(i, p.givens[i] >= 0 ? '#ECEFF3' : '#FFFFFF'));
      const v = solved ? p.solution[i] : p.givens[i];
      const r = s * 0.34, [x, y] = [cx(i), cy(i)];
      if (v === 0) {
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4, dx = Math.cos(a), dy = Math.sin(a);
          out.push(`<line x1="${(x + dx * r * 0.78).toFixed(1)}" y1="${(y + dy * r * 0.78).toFixed(1)}" x2="${(x + dx * r * 1.05).toFixed(1)}" y2="${(y + dy * r * 1.05).toFixed(1)}" stroke="#C16300" stroke-width="${(r * 0.22).toFixed(1)}" stroke-linecap="round"/>`);
        }
        out.push(`<circle cx="${x}" cy="${y}" r="${(r * 0.58).toFixed(1)}" fill="#FFD23F" stroke="#C16300" stroke-width="1.5"/>`);
      } else if (v === 1) {
        // Disc minus an offset disc: outer arc, then the inner arc back.
        const R = r * 0.78, ox = x + r * 0.42, oy = y - r * 0.3, rr = r * 0.66;
        out.push(`<mask id="m${i}"><rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="#fff"/><circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${rr.toFixed(1)}" fill="#000"/></mask><circle cx="${x}" cy="${y}" r="${R.toFixed(1)}" fill="#3B6CF0" mask="url(#m${i})"/>`);
      }
    }
    const sign = (x, y, k) => {
      const m = 2.7, ln = (a, b, c, d) => `<line x1="${x + a}" y1="${y + b}" x2="${x + c}" y2="${y + d}" stroke="#1B1E3C" stroke-width="1.6" stroke-linecap="round"/>`;
      return `<circle cx="${x}" cy="${y}" r="6" fill="#F8F9FB" stroke="#1B1E3C" stroke-width="1.5"/>` +
        (k === 's' ? ln(-m, -1.2, m, -1.2) + ln(-m, 1.2, m, 1.2) : ln(-m, -m, m, m) + ln(m, -m, -m, m));
    };
    for (const k in p.h) out.push(sign((+k % n + 1) * s, Math.floor(+k / n) * s + s / 2, p.h[k]));
    for (const k in p.v) out.push(sign((+k % n) * s + s / 2, (Math.floor(+k / n) + 1) * s, p.v[k]));
  }
  out.push(`<rect x="0" y="0" width="${W}" height="${W}" fill="none" stroke="#1B1E3C" stroke-width="3" rx="4"/></svg>`);
  return out.join('');
}

// ------------------------------------------------------------ shared html

const HEAD_COMMON = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-551DG28P8J"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-551DG28P8J');
</script>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">`;

function head({ title, description, path, extraLd = [] }) {
  const url = SITE + path;
  return `<!doctype html>
<html lang="en">
<head>
${HEAD_COMMON}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Panda.az Studio">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/img/shots/pocket-logic-1.webp">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/img/favicon.png">
<meta name="theme-color" content="#F6F5F3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/daily/daily.css">
${extraLd.map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 1)}\n</script>`).join('\n')}
</head>`;
}

const HEADER = `<header>
    <a class="brand" href="/" aria-label="Panda.az Studio home">
      <img src="/img/favicon.png" alt="" width="40" height="40">
      <div class="wordmark">PANDA.AZ<span>STUDIO</span></div>
    </a>
    <nav><a href="/daily/">Daily puzzles</a><a href="/#games">Games</a></nav>
  </header>`;

const FOOTER = `<footer>
    <ul>
      <li><a href="/">Panda.az Studio</a></li>
      <li><a href="/daily/">Daily puzzles</a></li>
      <li><a href="/pocketlogic/privacy.html">Pocket Logic privacy</a></li>
      <li><a href="mailto:hello@panda.az">hello@panda.az</a></li>
      <li><a href="https://play.google.com/store/apps/dev?id=7946829773877726722">All our games on Google Play</a></li>
    </ul>
    © 2026 Panda.az Studio
  </footer>`;

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3.5v17a1 1 0 0 0 1.5.86l14.2-8.5a1 1 0 0 0 0-1.72L6.5 2.64A1 1 0 0 0 5 3.5z"/></svg>';

const crumbsLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], k) => ({ '@type': 'ListItem', position: k + 1, name, item: SITE + path })),
});

function appPanel(title) {
  return `<div class="panel app">
        <img src="/img/pocket-logic.png" alt="Pocket Logic icon" width="64" height="64">
        <div>
          <p><strong>Same board in the app.</strong> Pocket Logic has today’s ${title} plus hundreds of levels, streaks and hints. Free, works offline.</p>
          <a class="play" href="${PLAY_URL}">${PLAY_SVG}Play in the app</a>
        </div>
      </div>`;
}

// ------------------------------------------------------------- day page

function dayPage(game, day) {
  const G = GAMES[game];
  const p = puzzle(game, day);
  const f = facts(p);
  const isToday = day === TODAY;
  const live = day >= addDays(TODAY, -1) && day >= RANKED_FROM;
  const ranked = day >= RANKED_FROM;
  const path = `/${game}/${day}/`;
  const nice = longDate(day);
  const title = `${G.title} Puzzle ${nice}: Play, Hint and Answer | Panda.az`;
  const description = `Play the ${G.title} puzzle for ${nice} free in your browser: ${f.lead}. Get a hint, check the answer and see the day’s fastest players.`;
  const prev = day > FIRST_DAY ? addDays(day, -1) : null;
  const next = day < TODAY ? addDays(day, 1) : null;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: `${G.title} puzzle for ${nice}`,
      description,
      url: SITE + path,
      image: `${SITE}/img/shots/pocket-logic-1.webp`,
      datePublished: day,
      author: { '@type': 'Organization', name: 'Panda.az Studio', url: SITE + '/' },
      publisher: { '@type': 'Organization', name: 'Panda.az Studio', url: SITE + '/' },
    },
    crumbsLd([['Panda.az Studio', '/'], ['Daily puzzles', '/daily/'], [`${G.title} archive`, `/${game}/archive/`], [nice, path]]),
  ];
  return `${head({ title, description, path, extraLd: ld })}
<body style="--game:${G.color}">
<div class="wrap">
  ${HEADER}
  <div class="crumb"><a href="/">Panda.az Studio</a> / <a href="/daily/">Daily puzzles</a> / <a href="/${game}/archive/">${G.title}</a> / ${nice}</div>
  <div class="day-head">
    <span class="kicker">${isToday ? 'Today’s' : 'Daily'} ${G.title}${isWeekend(day) ? ' · weekend size' : ''}</span>
    <h1>${G.title} puzzle for ${nice}</h1>
    <p>${G.rule}</p>
  </div>

  <div class="play-area">
    <div class="game-card">
      <div class="bar"><span class="timer" id="timer">0:00</span><span class="size">${p.n}×${p.n}</span></div>
      <div class="stage">
        <div class="board" id="board" aria-label="${G.title} board, ${p.n} by ${p.n}"></div>
        <div class="cover" id="cover"><button class="btn" id="start" type="button">${isToday ? 'Start today’s puzzle' : 'Start'}</button></div>
      </div>
      <div class="tools">
        <button id="undo" type="button" disabled>Undo</button>
        <button id="clear" type="button" disabled>Clear</button>
        <button id="hint" type="button" disabled>Hint</button>
      </div>
      <div class="win" id="win" aria-live="polite">
        <h3 id="win-title"></h3>
        <p id="win-text"></p>
        <form class="name-form" id="name-form" hidden>
          <input id="name" name="name" maxlength="16" minlength="2" autocomplete="nickname" placeholder="Your name" required>
          <button class="btn" type="submit">Join the list</button>
        </form>
        <div class="msg" id="name-msg"></div>
      </div>
    </div>

    <div class="side">
${ranked ? `      <div class="panel">
        <h2>Fastest today</h2>
        <ol class="lb" id="lb"></ol>
        <p class="lb-note" id="lb-count">Loading…</p>
        <p class="lb-note">Your first solve without hints is ranked. The top 100 can add a name.</p>
      </div>
` : ''}      ${appPanel(G.title)}
    </div>
  </div>

  <div class="daynav">
    ${prev ? `<a href="/${game}/${prev}/">← ${shortDate(prev)}</a>` : '<span class="ghost"></span>'}
    <a href="/${game}/archive/">All ${G.title} puzzles</a>
    ${next ? `<a href="/${game}/${next}/">${shortDate(next)} →</a>` : '<span class="ghost"></span>'}
  </div>

  <section class="prose">
    <h2>How to play</h2>
    <p>${G.title} for ${nice} is ${f.lead}. ${G.rule}</p>
    <p>${G.how}</p>
    <p>New to ${G.title}? Read the <a href="/${game}/">${G.title} rules and strategy guide</a>.</p>
  </section>

  <section class="prose">
    <h2>Hint and answer</h2>
    <p><strong>Hint:</strong> ${f.hint}</p>
    <details class="answer">
      <summary>Show the answer for ${nice}</summary>
      ${boardSvg(p)}
    </details>
  </section>

  <section>
    <h2>More daily puzzles</h2>
    <div class="more">
${Object.keys(GAMES).filter((g) => g !== game).map((g) => `      <a href="/${g}/${day}/">${GAMES[g].title} for ${shortDate(day)}</a>`).join('\n')}
      <a href="/daily/">All daily puzzles</a>
    </div>
  </section>

  ${FOOTER}
</div>
<script type="application/json" id="puzzle">${JSON.stringify(clientData(p, day, live))}</script>
<script type="module" src="/daily/play.js"></script>
</body>
</html>
`;
}

// ------------------------------------------------------------ archive

function archivePage(game) {
  const G = GAMES[game];
  const path = `/${game}/archive/`;
  const title = `${G.title} Puzzle Archive: Play Every Past Daily Board | Panda.az`;
  const description = `Every daily ${G.title} puzzle since ${longDate(FIRST_DAY)}, free to play in your browser with hints and answers.`;
  const months = new Map();
  for (const d of days) {
    const m = d.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(d);
  }
  const blocks = [...months.entries()].reverse().map(([m, ds]) => {
    const [y, mo] = m.split('-').map(Number);
    const firstDow = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    const lead = Array.from({ length: firstDow + Number(ds[0].slice(8)) - 1 }, () => '<span></span>').join('');
    const links = ds.map((d) => `<a href="/${game}/${d}/" data-day="${d}"${d === TODAY ? ' class="today"' : ''} aria-label="${G.title} ${longDate(d)}">${Number(d.slice(8))}</a>`).join('');
    return `<div><h3>${MONTHS[mo - 1]} ${y}</h3><div class="days">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => `<span class="dow">${x}</span>`).join('')}${lead}${links}</div></div>`;
  });
  return `${head({ title, description, path, extraLd: [crumbsLd([['Panda.az Studio', '/'], ['Daily puzzles', '/daily/'], [`${G.title} archive`, path]])] })}
<body style="--game:${G.color}">
<div class="wrap">
  ${HEADER}
  <div class="crumb"><a href="/">Panda.az Studio</a> / <a href="/daily/">Daily puzzles</a> / ${G.title} archive</div>
  <div class="day-head">
    <span class="kicker">${G.title} archive</span>
    <h1>Every daily ${G.title} puzzle</h1>
    <p>Pick any day to play it. Filled days are ones you solved on this device. Today’s board: <a href="/${game}/${TODAY}/">${longDate(TODAY)}</a>.</p>
  </div>
  <section class="cal">
${blocks.join('\n')}
  </section>
  <section>${appPanel(G.title)}</section>
  ${FOOTER}
</div>
<script>
  for (const a of document.querySelectorAll('.days a')) {
    try { if (localStorage.getItem('panda-daily:${game}:' + a.dataset.day)) a.classList.add('done'); } catch (e) {}
  }
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- hub

function hubPage() {
  const path = '/daily/';
  const title = 'Daily Logic Puzzles: Queens, Zip and Tango Free Online | Panda.az';
  const description = 'Three new logic puzzles every day: Queens, Zip and Tango. Play free in your browser, race the clock and get on the daily top 100.';
  const cards = Object.entries(GAMES).map(([g, G]) => {
    const p = puzzle(g, TODAY);
    return `<a href="/${g}/${TODAY}/" style="--game:${G.color}"><h3>${G.title}</h3><p>${p.n}×${p.n} · ${G.short}</p><div class="mini">${boardSvg(p, false)}</div></a>`;
  });
  return `${head({ title, description, path, extraLd: [crumbsLd([['Panda.az Studio', '/'], ['Daily puzzles', path]])] })}
<body style="--game:var(--accent)">
<div class="wrap">
  ${HEADER}
  <div class="crumb"><a href="/">Panda.az Studio</a> / Daily puzzles</div>
  <div class="day-head">
    <span class="kicker">${longDate(TODAY)}</span>
    <h1>Today’s logic puzzles</h1>
    <p>A new Queens, Zip and Tango board every day, the same for everyone. Each has exactly one solution, checked by a solver. Solve without hints to join the day’s top 100.</p>
  </div>
  <section class="hub">
${cards.map((c) => '    ' + c).join('\n')}
  </section>
  <section>
    <h2>Archives</h2>
    <div class="more">
${Object.entries(GAMES).map(([g, G]) => `      <a href="/${g}/archive/">${G.title} archive</a>`).join('\n')}
    </div>
  </section>
  <section>${appPanel('puzzles')}</section>
  ${FOOTER}
</div>
</body>
</html>
`;
}

// ------------------------------------------------- guide pages, sitemap

function guideBlock(game) {
  const G = GAMES[game];
  return `<!-- daily:start -->
  <div class="daily-strip">
    <a class="btn" href="/${game}/${TODAY}/">Play today’s ${G.title} online</a>
    <a class="link" href="/${game}/archive/">Past ${G.title} puzzles</a>
  </div>
  <!-- daily:end -->`;
}

function updateGuide(game) {
  const rel = `${game}/index.html`;
  let html = readFileSync(join(ROOT, rel), 'utf8');
  if (html.includes('<!-- daily:start -->')) {
    html = html.replace(/<!-- daily:start -->[\s\S]*?<!-- daily:end -->/, guideBlock(game));
  } else {
    // First run: put the block right under the guide's intro paragraph.
    html = html.replace(/(<p class="intro">[\s\S]*?<\/p>)/, `$1\n      ${guideBlock(game)}`);
    html = html.replace('<link rel="stylesheet" href="/style.css">', '<link rel="stylesheet" href="/style.css">\n<link rel="stylesheet" href="/daily/daily.css">');
  }
  put(rel, html);
}

function updateSitemap() {
  const rel = 'sitemap.xml';
  const old = readFileSync(join(ROOT, rel), 'utf8');
  const keep = old
    .split('\n')
    .filter((l) => l.includes('<url>') && !/\/(queens|zip|tango)\/(\d{4}-\d\d-\d\d|archive)\/|\/daily\//.test(l));
  const urls = [`  <url><loc>${SITE}/daily/</loc><lastmod>${TODAY}</lastmod></url>`];
  for (const g of Object.keys(GAMES)) {
    urls.push(`  <url><loc>${SITE}/${g}/archive/</loc><lastmod>${TODAY}</lastmod></url>`);
    for (const d of [...days].reverse()) {
      // A page changes the day after it goes up (its "next" link appears).
      urls.push(`  <url><loc>${SITE}/${g}/${d}/</loc><lastmod>${d === TODAY ? d : addDays(d, 1)}</lastmod></url>`);
    }
  }
  put(rel, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...keep, ...urls].join('\n')}
</urlset>
`);
}

// ---------------------------------------------------------------- main

for (const g of Object.keys(GAMES)) {
  for (const d of days) put(`${g}/${d}/index.html`, dayPage(g, d));
  put(`${g}/archive/index.html`, archivePage(g));
  updateGuide(g);
}
put('daily/index.html', hubPage());
updateSitemap();
console.log(`today ${TODAY}: ${days.length} days, ${written} files written`);
