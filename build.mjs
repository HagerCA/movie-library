#!/usr/bin/env node
/**
 * The Hager Movie Library — build.
 *
 *   node 11-Artifacts/movie-library/build.mjs
 *
 * movie-library.csv is the one source of truth. This reads it, validates it,
 * normalises it back out, and regenerates:
 *
 *   index.html          the app. Self-contained, data inlined, deployable.
 *   movie-library.md    the readable view, grouped by genre.
 *   library.json        the raw data, for anything else that wants it.
 *
 * Never hand-edit those three. Node only, no dependencies, nothing leaves
 * the machine.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(DIR, 'movie-library.csv');
const today = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ csv io */

function parseCSV(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const csvEscape = v => {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

const COLS = ['Title', 'Year', 'Genre', 'Chris', 'Pixie', 'Context', 'Status', 'Lane',
  'Streaming', 'Streaming Checked', 'Chris Says', 'Pixie Says', 'Boys Say',
  'TMDB ID', 'Poster', 'Runtime', 'Overview', 'Note', 'Flag'];

if (!fs.existsSync(CSV)) { console.error('No movie-library.csv beside build.mjs.'); process.exit(1); }
const rows = parseCSV(fs.readFileSync(CSV, 'utf8'));
const header = rows.shift().map(h => h.trim().toLowerCase());
const at = name => {
  const i = header.indexOf(name.toLowerCase());
  if (i === -1) { console.error('CSV is missing the "' + name + '" column.'); process.exit(1); }
  return i;
};
const I = {}; COLS.forEach(c => I[c] = at(c));

function score(raw, who, rowNo, title) {
  const v = (raw || '').trim();
  if (v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0 || n > 5) {
    console.error('Row ' + rowNo + ' ("' + title + '"): ' + who + ' rating "' + v + '" is not 0 to 5.');
    process.exit(1);
  }
  return n;
}
const txt = (r, c) => (r[I[c]] || '').trim();

const allRows = rows.map((r, i) => ({
  t: txt(r, 'Title'),
  y: Number(txt(r, 'Year')) || null,
  g: txt(r, 'Genre') || 'Unsorted',
  c: score(r[I['Chris']], 'Chris', i + 2, txt(r, 'Title')),
  p: score(r[I['Pixie']], 'Pixie', i + 2, txt(r, 'Title')),
  w: txt(r, 'Context') || 'Unclear',
  s: txt(r, 'Status') || 'Watchlist',
  l: txt(r, 'Lane') || 'Unsorted',
  sv: txt(r, 'Streaming'),
  sc: txt(r, 'Streaming Checked'),
  cs: txt(r, 'Chris Says'),
  ps: txt(r, 'Pixie Says'),
  bs: txt(r, 'Boys Say'),
  id: txt(r, 'TMDB ID'),
  img: txt(r, 'Poster'),
  rt: Number(txt(r, 'Runtime')) || null,
  ov: txt(r, 'Overview'),
  n: txt(r, 'Note'),
  f: txt(r, 'Flag').toLowerCase()
})).filter(f => f.t);

// Rows Chris asked to scrap keep their place in the CSV and vanish from every
// view and count. Nothing is ever removed; "Dropped" is how a mistake retires.
const films = allRows.filter(f => f.s !== 'Dropped');

/* normalise the CSV back out so Excel round-trips stay clean */
fs.writeFileSync(CSV, '﻿' + COLS.join(',') + '\n' + allRows.map(f =>
  [f.t, f.y ?? '', f.g, f.c ?? '', f.p ?? '', f.w, f.s, f.l, f.sv, f.sc,
   f.cs, f.ps, f.bs, f.id, f.img, f.rt ?? '', f.ov, f.n, f.f].map(csvEscape).join(',')
).join('\n') + '\n', 'utf8');

/* ------------------------------------------------------- suggestions.csv */
/* SAGE's picks. Separate file so a suggestion never pollutes the library, and
   so the app can show the reasoning rather than just the title. Enrich it with
   the same pass: node enrich.mjs --file=suggestions.csv                       */

const SUGG_CSV = path.join(DIR, 'suggestions.csv');
let suggestions = [];
if (fs.existsSync(SUGG_CSV)) {
  const sr = parseCSV(fs.readFileSync(SUGG_CSV, 'utf8'));
  const sh = sr.shift().map(h => h.trim().toLowerCase());
  const sAt = n => sh.indexOf(n.toLowerCase());
  const g = (r, n) => { const i = sAt(n); return i === -1 ? '' : (r[i] || '').trim(); };
  suggestions = sr.map(r => ({
    t: g(r, 'Title'), y: Number(g(r, 'Year')) || null,
    who: g(r, 'For') || 'Everyone', why: g(r, 'Why'), thread: g(r, 'Thread'),
    sv: g(r, 'Streaming'), sc: g(r, 'Streaming Checked'),
    img: g(r, 'Poster'), rt: Number(g(r, 'Runtime')) || null, ov: g(r, 'Overview')
  })).filter(x => x.t);

  // A suggestion for a film they have already seen is worse than none at all.
  const seen = new Set(films.map(f => f.t.toLowerCase()
    .replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '')));
  const before = suggestions.length;
  suggestions = suggestions.filter(x => !seen.has(
    x.t.toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '')));
  if (before !== suggestions.length)
    console.log('  dropped ' + (before - suggestions.length) + ' suggestion(s) already in the library');
}

/* ----------------------------------------------------------- upcoming.csv */
/* Films not yet watchable here, tracked from what the family already rates
   highly. Built by upcoming.mjs. The column that matters is Status: can they
   watch it in Costa Rica yet, and where.                                     */

const UP_CSV = path.join(DIR, 'upcoming.csv');
let upcoming = [];
if (fs.existsSync(UP_CSV)) {
  const ur = parseCSV(fs.readFileSync(UP_CSV, 'utf8'));
  const uh = ur.shift().map(h => h.trim().toLowerCase());
  const u = (r, n) => { const i = uh.indexOf(n.toLowerCase()); return i === -1 ? '' : (r[i] || '').trim(); };
  upcoming = ur.map(r => ({
    t: u(r, 'Title'), y: u(r, 'Year'), src: u(r, 'Why Tracked'),
    date: u(r, 'Release Date'), crDate: u(r, 'Release Costa Rica'),
    status: u(r, 'Status'), sv: u(r, 'Streaming'), sc: u(r, 'Streaming Checked'),
    img: u(r, 'Poster'), rt: Number(u(r, 'Runtime')) || null, ov: u(r, 'Overview'),
    interest: u(r, 'Interest')
  })).filter(x => x.t)
    // A tracked film that got watched now lives in the library. Keep the row in
    // upcoming.csv as the record, but stop showing it in Coming Soon.
    .filter(x => !/moved to the library/i.test(x.status));
}

/* ------------------------------------------------------------ favorites */
/* Who they keep watching, ranked by credibility-weighted average. Built by
   credits.mjs from the real TMDB cast and crew of every rated film.         */

const FAV_JSON = path.join(DIR, 'favorites.json');
const favorites = fs.existsSync(FAV_JSON)
  ? JSON.parse(fs.readFileSync(FAV_JSON, 'utf8')) : null;

/* ------------------------------------------------------------------- stats */

const rated = films.filter(f => f.c !== null);
const avg = rated.length ? rated.reduce((s, f) => s + f.c, 0) / rated.length : 0;
const pRated = films.filter(f => f.p !== null);
const pAvg = pRated.length ? pRated.reduce((s, f) => s + f.p, 0) / pRated.length : 0;

// Chris's scale, stated 2026-10-03: 4.0 and up means a film they go back to.
const rewatch = rated.filter(f => f.c >= 4);
const onceOnly = rated.filter(f => f.c >= 3.5 && f.c < 4);
const below = rated.filter(f => f.c < 3.5);
const diverge = films.filter(f => f.c !== null && f.p !== null && f.c !== f.p)
  .sort((a, b) => Math.abs(b.p - b.c) - Math.abs(a.p - a.c));

const tally = k => films.reduce((m, f) => (m[f[k]] = (m[f[k]] || 0) + 1, m), {});
const spread = {}; rated.forEach(f => spread[f.c] = (spread[f.c] || 0) + 1);
const spreadLine = Object.keys(spread).map(Number).sort((a, b) => b - a)
  .map(k => k.toFixed(1) + ' (' + spread[k] + ')').join(' · ');

const laneAgg = {};
films.forEach(f => {
  const L = laneAgg[f.l] = laneAgg[f.l] || { total: 0, scores: [] };
  L.total++; if (f.c !== null) L.scores.push(f.c);
});
const lanes = Object.entries(laneAgg).map(([name, v]) => ({
  name, total: v.total, rated: v.scores.length,
  avg: v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null
})).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.total - a.total);

const conflicts = films.filter(f => f.f === 'conflict');
const carried = films.filter(f => f.f === 'carry');
// "Seen, Chris partial" means he watched part of it and has deliberately
// declined to score it. That is a settled answer, not an outstanding task, so
// it does not sit in the needs-a-number count forever.
const seenUnrated = films.filter(f => f.c === null && /^seen/i.test(f.s) && !/partial/i.test(f.s));
const enriched = films.filter(f => f.img).length;

/* ---------------------------------------------------------------- markdown */

const GENRE_ORDER = ['Rom-com', 'Romance', 'Period drama', 'Drama', 'Comedy',
  'Action-comedy', 'Action', 'Adventure', 'Sci-fi', 'Animated / family'];
const genres = [...new Set(films.map(f => f.g))].sort((a, b) => {
  const ia = GENRE_ORDER.indexOf(a), ib = GENRE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1; if (ib !== -1) return 1;
  return a.localeCompare(b);
});

const mdCell = s => String(s == null ? '' : s).replace(/\|/g, '\\|');
const num = v => v === null ? '' : (v % 1 ? String(v) : v.toFixed(0));
const mark = f => f.f === 'carry' ? ' †' : f.f === 'conflict' ? ' ⚠' : '';

let md = `# The Hager Movie Library

**Generated file. Do not hand-edit.** The source of truth is \`movie-library.csv\`.
Edit the CSV, or the [Google Sheet](https://docs.google.com/spreadsheets/d/1e674RDkgyo-fFGIGNHFtB36qLg81BihjSuBuNIsfe58/edit), then run:

    node 11-Artifacts/movie-library/build.mjs

Last built **${today}** · **${films.length} films** · Chris has rated ${rated.length} (avg **${avg.toFixed(2)}**), Pixie ${pRated.length} (avg ${pAvg.toFixed(2)})
The app is \`index.html\` in this folder.

## The scale

> *"If something's a 3.5 it means that we enjoyed it but wouldn't necessarily watch it again. Four and above we'll love so much that we go back to watch them time and time again."* — Chris, 2026-10-03

**4.0 is the rewatch threshold.** A predicted 3.5 is a miss, not a near-win. ${rewatch.length} of ${rated.length} rated films clear it.

## Columns

| Field | Meaning |
|---|---|
| **Chris** / **Pixie** | Each rating out of 5, any decimal. Blank means not yet rated. |
| **Chris Says** / **Pixie Says** / **Boys Say** | What each of them actually said. Shows as a quote card in the app. |
| **Context** | \`Date Night\`, \`Family\`, \`Solo\`, \`Household\` (seen, audience not recorded), \`Queue\` |
| **Status** | \`Rated\`, \`Seen, unrated\`, \`Owned, unwatched\`, \`Watchlist\`, \`Dropped\` (retired, hidden everywhere) |
| **Streaming** / **Streaming Checked** | Where it streams **in Costa Rica**, and the date that was verified. No date means no claim. |
| **†** | Second-hand, unconfirmed. **⚠** The source contradicted itself. |

---
`;

for (const g of genres) {
  const list = films.filter(f => f.g === g).sort((a, b) => (b.c ?? -1) - (a.c ?? -1) || a.t.localeCompare(b.t));
  const gr = list.filter(f => f.c !== null);
  const gavg = gr.length ? ' · avg ' + (gr.reduce((s, f) => s + f.c, 0) / gr.length).toFixed(2) : '';
  md += `\n## ${g.toUpperCase()}\n\n*${list.length} films${gavg}*\n\n`;
  md += '| Film | Year | Chris | Pixie | Context | Status | Lane | Streaming | Note |\n';
  md += '|---|---|---|---|---|---|---|---|---|\n';
  for (const f of list) {
    md += `| ${mdCell(f.t)} | ${f.y ?? ''} | ${f.c === null ? '' : '**' + num(f.c) + '**' + mark(f)} `
        + `| ${num(f.p)} | ${mdCell(f.w)} | ${mdCell(f.s)} | ${mdCell(f.l)} | ${mdCell(f.sv)} | ${mdCell(f.n)} |\n`;
  }
}

md += `\n---\n\n## Needs your input\n\n`;
md += conflicts.length
  ? `**${conflicts.length} conflict(s):**\n\n` + conflicts.map(f => `- **${f.t}** — ${f.n}`).join('\n') + '\n\n'
  : `**No open conflicts.** ✓\n\n`;
md += carried.length
  ? `**${carried.length} unconfirmed second-hand ratings:** ${carried.map(f => f.t).join(', ')}.\n\n`
  : `**All ratings confirmed first-hand.** ✓\n\n`;
if (seenUnrated.length) md += `**${seenUnrated.length} watched but never rated.**\n\n`;
md += enriched
  ? `**TMDB enrichment: ${enriched} of ${films.length} films have a poster.**\n\n`
  : `**TMDB enrichment has not run.** No posters, no runtimes, no Costa Rica streaming data yet. Needs an API key in \`.env\`.\n\n`;

md += `---\n\n## Lanes, ranked\n\n| Lane | Films | Rated | Avg |\n|---|---|---|---|\n`;
lanes.forEach(L => md += `| ${mdCell(L.name)} | ${L.total} | ${L.rated} | ${L.avg === null ? '—' : L.avg.toFixed(2)} |\n`);

md += `\n---\n\n## Counts, built ${today}\n\n`;
md += `- **${films.length} films.** ` + Object.entries(tally('s')).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') + '\n';
md += `- **Chris ${rated.length} rated, avg ${avg.toFixed(2)}. Pixie ${pRated.length} rated, avg ${pAvg.toFixed(2)}.**\n`;
md += `- Rewatches (4.0+): **${rewatch.length}** · enjoyed once (3.5): ${onceOnly.length} · below: ${below.length}\n`;
md += `- Where they differ: **${diverge.length}**` + (diverge.length ? ' (' + diverge.slice(0, 8).map(f => f.t).join(', ') + ')' : ', her column is still seeded from his') + '\n';
md += `- Spread: ${spreadLine}\n`;
md += `- Context: ` + Object.entries(tally('w')).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') + '\n';
md += `- Retired rows kept in the CSV but hidden: ${allRows.length - films.length}\n`;

fs.writeFileSync(path.join(DIR, 'movie-library.md'), md, 'utf8');
fs.writeFileSync(path.join(DIR, 'library.json'), JSON.stringify(films, null, 1), 'utf8');

/* --------------------------------------------------------------------- app */
/* index.html is a thin shell. The real work lives in two SOURCE files beside
   it, app.css and app.js, which are hand-written, committed, and never
   generated. Only the data is inlined here, which is what keeps the page
   working offline and inside the preview pane with no network at all.

   Chris can edit app.css and app.js directly. This build will not touch them. */

const appData = films.map(f => ({
  t: f.t, y: f.y, g: f.g, c: f.c, p: f.p, w: f.w, s: f.s, l: f.l,
  sv: f.sv, sc: f.sc, cs: f.cs, ps: f.ps, bs: f.bs,
  img: f.img, rt: f.rt, ov: f.ov, n: f.n, f: f.f
}));

for (const need of ['app.css', 'app.js']) {
  if (!fs.existsSync(path.join(DIR, need))) {
    console.error('Missing source file ' + need + '. The app will not render without it.');
    process.exit(1);
  }
}

const inQueue = films.filter(f => /watchlist|owned|theaters|not released/i.test(f.s)).length;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0d11">
<title>The Hager Movie Library</title>
<link rel="stylesheet" href="./app.css">
</head>
<body>
<div class="wrap">

<header>
  <h1>The Hager Movie Library</h1>
  <p class="tag">${films.length} films &middot; built <b>${today}</b> &middot; 4.0 and up means we go back to it</p>
  <div class="stats">
    <div class="stat"><div class="n">${films.length}</div><div class="k">Films</div></div>
    <div class="stat"><div class="n">${rewatch.length}</div><div class="k">Rewatches</div></div>
    <div class="stat"><div class="n">${avg.toFixed(2)}</div><div class="k">Chris avg</div></div>
    <div class="stat"><div class="n">${pAvg.toFixed(2)}</div><div class="k">Pixie avg</div></div>
    <div class="stat"><div class="n">${inQueue}</div><div class="k">To watch</div></div>
    <div class="stat"><div class="n">${seenUnrated.length}</div><div class="k">Need a number</div></div>
    <div class="stat"><div class="n">${upcoming.length}</div><div class="k">Coming soon</div></div>
  </div>
</header>

<div class="bar">
  <div class="tabs" role="tablist" id="tabs"></div>
  <div class="filters">
    <input type="search" id="q" placeholder="Search a title, a lane, a note...">
    <select id="fg"></select>
    <select id="fl"></select>
    <select id="fw"></select>
    <select id="fr">
      <option value="">Any rating</option>
      <option value="5">5.0 only</option>
      <option value="4.5">4.5 and up</option>
      <option value="4">4.0 and up (rewatches)</option>
      <option value="u">Not yet rated</option>
    </select>
    <select id="fs"><option value="">Sort: rating</option>
      <option value="t">Sort: title</option>
      <option value="y">Sort: newest</option>
      <option value="yo">Sort: oldest</option>
    </select>
    <button class="ghost" id="reset">Reset</button>
    <button class="ghost addbtn" id="addNewTop">+ Add a film</button>
  </div>
  <p class="found" id="found"></p>
</div>

<div class="addbar" id="addbar" hidden></div>

<div class="grid" id="grid"></div>
<div class="empty" id="empty" hidden>Nothing matches that. Try clearing a filter.</div>

<footer>
  <p>Tap any film to rate it or add it to the queue. Changes are held on your device
  until you hit <b>Review</b> and hand them to SAGE, because this page is served as
  static files and cannot write to the library by itself.</p>
  <p>For a big batch of edits, the <a href="https://docs.google.com/spreadsheets/d/1e674RDkgyo-fFGIGNHFtB36qLg81BihjSuBuNIsfe58/edit">shared sheet</a> is faster.</p>
  <p>Streaming is checked for <b>Costa Rica</b>. A film with no date beside it has not been checked.
  Posters from TMDB, stored locally, so this page makes no third-party requests.</p>
</footer>
</div>

<div class="savestate" id="savestate" hidden></div>
<div class="basket" id="basket" hidden></div>
<div class="scrim" id="scrim"></div>
<aside class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"></aside>

<script>
const DATA = ${JSON.stringify(appData)};
const SUGG = ${JSON.stringify(suggestions)};
const UPCOMING = ${JSON.stringify(upcoming)};
const FAVOURITES = ${JSON.stringify(favorites)};
</script>
<script src="./app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(DIR, 'index.html'), html, 'utf8');

/* ------------------------------------------------------------------ report */

console.log('Built from movie-library.csv');
console.log('  ' + films.length + ' films (' + (allRows.length - films.length) + ' retired and hidden)');
console.log('  Chris ' + rated.length + ' rated, avg ' + avg.toFixed(2) +
            ' | Pixie ' + pRated.length + ' rated, avg ' + pAvg.toFixed(2));
console.log('  rewatches (4.0+): ' + rewatch.length + ' | once-only (3.5): ' + onceOnly.length + ' | below: ' + below.length);
console.log('  spread: ' + spreadLine);
console.log('  conflicts: ' + conflicts.length + ' | unconfirmed: ' + carried.length + ' | need a number: ' + seenUnrated.length);
console.log('  TMDB enrichment: ' + enriched + '/' + films.length + ' have a poster');
console.log('  Coming Soon: ' + upcoming.length + ' tracked (' + Object.entries(upcoming.reduce((m,x)=>(m[x.status]=(m[x.status]||0)+1,m),{})).map(([k,v])=>k+' '+v).join(', ') + ')');
console.log('  Our People: ' + (favorites
  ? favorites.directors.length + ' directors, ' + favorites.actors.length + ' actors, ' +
    favorites.actresses.length + ' actresses from ' + favorites.films + ' rated films'
  : 'favorites.json missing, run credits.mjs'));
console.log('  SAGE Suggests: ' + suggestions.length + ' picks (' + Object.entries(suggestions.reduce((m,x)=>(m[x.who]=(m[x.who]||0)+1,m),{})).map(([k,v])=>k+' '+v).join(', ') + ')');
console.log('Wrote index.html, movie-library.md, library.json');
console.log('  app.css and app.js are source files and were not touched.');
