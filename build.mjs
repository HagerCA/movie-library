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
    who: g(r, 'For') || 'Everyone', why: g(r, 'Why'),
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
const seenUnrated = films.filter(f => f.c === null && /^seen/i.test(f.s));
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

const SUGGEST_CSS = `
  /* ---------- SAGE Suggests ---------- */
  .sugglist{display:flex;flex-direction:column;gap:14px;margin-top:18px}
  .suggintro{padding:4px 0 6px}
  .suggintro h2{margin:0 0 6px;font-size:21px;font-weight:700;letter-spacing:-.02em;color:var(--gold)}
  .suggintro p{margin:0 0 14px;color:var(--fg2);font-size:13.5px;max-width:68ch}
  .audpills{display:flex;flex-wrap:wrap;gap:6px}
  .tab.sm{padding:6px 12px;font-size:12.5px}
  .sugg{display:flex;gap:16px;background:var(--bg2);border:1px solid var(--line);
    border-radius:var(--r);padding:14px;transition:.16s}
  .sugg:hover{border-color:var(--gold2)}
  .suggart{flex:0 0 96px;aspect-ratio:2/3;border-radius:9px;overflow:hidden;position:relative;
    background:var(--bg3);display:flex;align-items:center;justify-content:center}
  .suggart img{width:100%;height:100%;object-fit:cover}
  .suggart .phs{font-size:11px;font-weight:600;text-align:center;padding:8px;color:var(--fg3)}
  .suggbody{flex:1;min-width:0}
  .suggtop{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
  .suggtop h3{margin:0;font-size:16.5px;font-weight:650;letter-spacing:-.01em}
  .forwho{flex:0 0 auto;font-size:10.5px;font-weight:700;text-transform:uppercase;
    letter-spacing:.07em;padding:4px 9px;border-radius:999px;background:var(--bg3);
    border:1px solid var(--line);color:var(--fg2);white-space:nowrap}
  .forwho.datenight{color:var(--gold);border-color:var(--gold2)}
  .forwho.theboys{color:var(--green);border-color:#2f6b4c}
  .forwho.wholefamily{color:#8fb8e8;border-color:#39536f}
  .forwho.chris{color:#f0a6c0;border-color:#7b4a58}
  .suggmeta{color:var(--fg3);font-size:12px;margin-top:3px}
  .why{margin:9px 0 0;font-size:13.5px;color:var(--fg);line-height:1.55}
  .suggwhere{margin-top:11px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .streambadge,.rentbadge,.nobadge{font-size:11.5px;font-weight:600;padding:4px 9px;border-radius:7px}
  .streambadge{background:rgba(95,177,131,.14);color:var(--green);border:1px solid #2f6b4c}
  .rentbadge{background:rgba(224,178,83,.12);color:var(--gold);border:1px solid var(--gold2)}
  .nobadge{background:var(--bg3);color:var(--fg3);border:1px solid var(--line)}
  .checked{font-size:11px;color:var(--fg3)}
  @media(max-width:560px){
    .sugg{gap:12px;padding:12px}
    .suggart{flex:0 0 72px}
    .suggtop{flex-direction:column;gap:5px}
  }
`;

const CSS = `  :root{
    --bg:#0b0d11; --bg2:#13171e; --bg3:#1b2029; --line:#262d38;
    --fg:#eef2f7; --fg2:#9aa6b6; --fg3:#67727f;
    --gold:#e0b253; --gold2:#8a6c28; --rose:#e0714a; --green:#5fb183;
    --r:14px;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
  a{color:var(--gold)}
  .wrap{max-width:1500px;margin:0 auto;padding:0 20px 90px}

  /* ---------- hero ---------- */
  header{padding:48px 0 26px;text-align:center;position:relative}
  header:after{content:"";position:absolute;inset:0;z-index:-1;
    background:radial-gradient(70% 120% at 50% 0%,rgba(224,178,83,.11),transparent 70%)}
  h1{margin:0;font-size:clamp(28px,5.5vw,46px);font-weight:700;letter-spacing:-.03em;
    background:linear-gradient(180deg,#fff,var(--gold));-webkit-background-clip:text;
    -webkit-text-fill-color:transparent;background-clip:text}
  .tag{margin:8px 0 0;color:var(--fg2);font-size:14px}
  .tag b{color:var(--gold)}

  .stats{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:22px 0 0}
  .stat{background:var(--bg2);border:1px solid var(--line);border-radius:var(--r);
    padding:10px 15px;min-width:92px}
  .stat .n{font-size:20px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
  .stat .k{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--fg3);margin-top:2px}

  /* ---------- tabs + filters ---------- */
  .bar{position:sticky;top:0;z-index:30;background:rgba(11,13,17,.93);
    backdrop-filter:blur(14px);border-bottom:1px solid var(--line);
    margin:26px -20px 0;padding:12px 20px}
  .tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
  .tabs::-webkit-scrollbar{display:none}
  .tab{background:none;border:1px solid var(--line);color:var(--fg2);border-radius:999px;
    padding:7px 15px;font:inherit;font-size:13.5px;cursor:pointer;white-space:nowrap;transition:.14s}
  .tab:hover{color:var(--fg);border-color:var(--gold2)}
  .tab[aria-selected=true]{background:var(--gold);border-color:var(--gold);color:#14110a;font-weight:600}

  .filters{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
  select,input[type=search]{background:var(--bg3);color:var(--fg);border:1px solid var(--line);
    border-radius:9px;padding:8px 11px;font:inherit;font-size:13.5px}
  input[type=search]{flex:1 1 220px;min-width:170px}
  select:focus,input:focus{outline:2px solid var(--gold2);outline-offset:1px}
  .ghost{background:none;border:1px solid var(--line);color:var(--fg3);border-radius:9px;
    padding:8px 13px;font:inherit;font-size:13px;cursor:pointer}
  .ghost:hover{color:var(--fg);border-color:var(--gold2)}
  .found{color:var(--fg3);font-size:12.5px;margin:12px 0 0}

  /* ---------- grid ---------- */
  .grid{display:grid;gap:16px;margin-top:18px;
    grid-template-columns:repeat(auto-fill,minmax(166px,1fr))}
  .card{background:var(--bg2);border:1px solid var(--line);border-radius:var(--r);
    overflow:hidden;cursor:pointer;transition:.16s;display:flex;flex-direction:column;text-align:left;
    padding:0;color:inherit;font:inherit}
  .card:hover{transform:translateY(-3px);border-color:var(--gold2);box-shadow:0 10px 28px rgba(0,0,0,.45)}
  .card:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  .art{position:relative;aspect-ratio:2/3;display:flex;align-items:center;justify-content:center;
    padding:14px;overflow:hidden}
  .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .art .ph{font-size:14px;font-weight:650;line-height:1.3;text-align:center;
    color:rgba(255,255,255,.93);text-shadow:0 1px 10px rgba(0,0,0,.6);z-index:1}
  .badges{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:5px;
    justify-content:space-between;z-index:2}
  .chip{font-size:11px;font-weight:700;padding:3px 7px;border-radius:7px;
    background:rgba(8,10,14,.82);backdrop-filter:blur(4px);line-height:1.3}
  .chip.c{color:var(--gold)} .chip.p{color:#f0a6c0}
  .chip.q{color:var(--fg2);font-weight:600}
  .meta{padding:10px 11px 12px}
  .meta .nm{font-size:13.5px;font-weight:600;line-height:1.3;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .meta .sub{font-size:11.5px;color:var(--fg3);margin-top:4px;
    display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .dot{width:3px;height:3px;border-radius:50%;background:var(--fg3);display:inline-block}
  .stream{color:var(--green);font-size:11px}
  .empty{text-align:center;color:var(--fg3);padding:70px 20px;font-size:14px}

  /* ---------- detail ---------- */
  .scrim{position:fixed;inset:0;background:rgba(4,6,9,.78);backdrop-filter:blur(5px);
    z-index:60;opacity:0;pointer-events:none;transition:.18s}
  .scrim.on{opacity:1;pointer-events:auto}
  .sheet{position:fixed;z-index:61;right:0;top:0;bottom:0;width:min(520px,100%);
    background:var(--bg2);border-left:1px solid var(--line);overflow-y:auto;
    transform:translateX(100%);transition:transform .22s cubic-bezier(.3,.8,.3,1)}
  .sheet.on{transform:none}
  @media(max-width:620px){
    .sheet{top:auto;width:100%;max-height:90vh;border-left:0;border-top:1px solid var(--line);
      border-radius:18px 18px 0 0;transform:translateY(100%)}
  }
  .sheet .hd{position:relative;padding:22px 22px 0}
  .sheet .x{position:absolute;top:14px;right:14px;background:var(--bg3);border:1px solid var(--line);
    color:var(--fg2);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1}
  .sheet h2{margin:0 44px 4px 0;font-size:22px;font-weight:700;letter-spacing:-.02em}
  .sheet .yr{color:var(--fg3);font-size:13px}
  .sheet .bd{padding:18px 22px 40px}
  .scores{display:flex;gap:10px;margin:16px 0 0}
  .sc{flex:1;background:var(--bg3);border:1px solid var(--line);border-radius:11px;padding:11px 13px}
  .sc .who{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--fg3)}
  .sc .v{font-size:23px;font-weight:700;letter-spacing:-.02em;margin-top:1px}
  .sc.c .v{color:var(--gold)} .sc.p .v{color:#f0a6c0}
  .sc .v.none{font-size:14px;font-weight:500;color:var(--fg3);font-style:italic;padding-top:6px}
  .rows{margin-top:18px}
  .row{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px}
  .row:last-child{border-bottom:0}
  .row .k{color:var(--fg3);min-width:96px;flex:0 0 96px;font-size:12.5px}
  .row .v{color:var(--fg)}
  .says{margin-top:20px;display:flex;flex-direction:column;gap:10px}
  .quote{background:var(--bg3);border-left:3px solid var(--gold2);border-radius:0 11px 11px 0;
    padding:11px 14px}
  .quote .who{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--gold);
    font-weight:650;margin-bottom:3px}
  .quote.p{border-left-color:#b06f85} .quote.p .who{color:#f0a6c0}
  .quote.b{border-left-color:var(--green)} .quote.b .who{color:var(--green)}
  .quote .q{font-size:13.5px;color:var(--fg);line-height:1.5}
  .nudge{margin-top:18px;background:var(--bg3);border:1px dashed var(--line);border-radius:11px;
    padding:12px 14px;color:var(--fg3);font-size:12.5px}
  .sysnote{margin-top:16px;color:var(--fg3);font-size:12px;line-height:1.5}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--fg3);font-size:12.5px;text-align:center}`;

// app.css is written once and then left alone. Chris owns the styling; the
// generator only supplies it when the file is missing. Delete it to get the
// default back.
const cssPath = path.join(DIR, 'app.css');
const cssExisted = fs.existsSync(cssPath);
if (!cssExisted) fs.writeFileSync(cssPath, CSS + SUGGEST_CSS, 'utf8');
else {
  // Chris owns app.css, so it is never rewritten. But a new feature's styles
  // have to reach an existing file or the view renders unstyled. Append only
  // what is missing, and only once.
  const live = fs.readFileSync(cssPath, 'utf8');
  if (!live.includes('.sugglist')) {
    fs.writeFileSync(cssPath, live.replace(/\s*$/, '') + '\n' + SUGGEST_CSS, 'utf8');
    console.log('  app.css: appended the SAGE Suggests styles, left everything else untouched.');
  }
}


const appData = films.map(f => ({
  t: f.t, y: f.y, g: f.g, c: f.c, p: f.p, w: f.w, s: f.s, l: f.l,
  sv: f.sv, sc: f.sc, cs: f.cs, ps: f.ps, bs: f.bs,
  img: f.img, rt: f.rt, ov: f.ov, n: f.n, f: f.f
}));

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
    <div class="stat"><div class="n">${films.filter(f => /watchlist|owned|theaters/i.test(f.s)).length}</div><div class="k">In the queue</div></div>
    <div class="stat"><div class="n">${seenUnrated.length}</div><div class="k">Need a number</div></div>
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
  </div>
  <p class="found" id="found"></p>
</div>

<div class="grid" id="grid"></div>
<div class="empty" id="empty" hidden>Nothing matches that. Try clearing a filter.</div>

<footer>
  <p>Source of truth is <code>movie-library.csv</code>. Add a film in the
  <a href="https://docs.google.com/spreadsheets/d/1e674RDkgyo-fFGIGNHFtB36qLg81BihjSuBuNIsfe58/edit">shared sheet</a>,
  or just tell SAGE.</p>
  <p>Streaming is checked for <b>Costa Rica</b>. A film with no date beside it has not been checked.</p>
</footer>
</div>

<div class="scrim" id="scrim"></div>
<aside class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"></aside>

<script>
const DATA = ${JSON.stringify(appData)};
const SUGG = ${JSON.stringify(suggestions)};

const TABS = [
  { k:'all',   label:'Everything',    fn:()=>true },
  { k:'towatch',label:'To Watch',      fn:f=>/watchlist|owned|theaters|not released/i.test(f.s) },
  { k:'date',  label:'Date Night',    fn:f=>f.w==='Date Night' },
  { k:'fam',   label:'With the Boys', fn:f=>f.w==='Family' },
  { k:'best',  label:'The 5s',        fn:f=>f.c!==null&&f.c>=4.9 },
  { k:'need',  label:'Seen, Needs a Number', fn:f=>f.c===null&&/^seen/i.test(f.s) },
  { k:'xmas',  label:'Christmas',     fn:f=>f.l==='Christmas' },
  { k:'sagg',  label:"\u2728 SAGE Suggests", fn:()=>false },
  { k:'stream',label:'On a Subscription', fn:f=>!!f.sv&&!/^(Rent|Buy):/.test(f.sv) }
];
let tab='all';

const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uniq=k=>[...new Set(DATA.map(d=>d[k]).filter(Boolean))].sort();
const num=v=>v===null?null:(v%1?v.toFixed(1):v.toFixed(1));

// A stable colour per title, so a film without a poster still looks deliberate.
function hue(t){let h=0;for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))%360;return h}
function art(d){
  if(d.img) return '<img src="'+esc(d.img)+'" alt="" loading="lazy">';
  const h=hue(d.t);
  return '<div style="position:absolute;inset:0;background:linear-gradient(155deg,hsl('+h+
    ' 42% 26%),hsl('+((h+42)%360)+' 38% 13%))"></div><div class="ph">'+esc(d.t)+'</div>';
}

const tabsEl=document.getElementById('tabs');
tabsEl.innerHTML=TABS.map(t=>'<button class="tab" role="tab" data-k="'+t.k+
  '" aria-selected="'+(t.k==='all')+'">'+t.label+'</button>').join('');
tabsEl.addEventListener('click',e=>{
  const b=e.target.closest('.tab'); if(!b)return;
  tab=b.dataset.k;
  tabsEl.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x===b));
  render();
});

function fill(id,label,k){
  document.getElementById(id).innerHTML='<option value="">'+label+'</option>'+
    uniq(k).map(v=>'<option>'+esc(v)+'</option>').join('');
}
fill('fg','All genres','g'); fill('fl','All lanes','l');

// Every distinct subscription service in the library, so "what is on Netflix
// tonight" is one click. Rent and Buy entries are deliberately excluded.
const SERVICES=[...new Set(DATA.flatMap(d=>
  (d.sv&&!/^(Rent|Buy):/.test(d.sv))?d.sv.split(',').map(x=>x.trim()):[]
).filter(Boolean))].sort();
document.getElementById('fw').innerHTML='<option value="">Anywhere</option>'+
  SERVICES.map(v=>'<option>'+esc(v)+'</option>').join('')+
  '<option value="__rent">Rent or buy only</option>'+
  '<option value="__none">Not streaming in Costa Rica</option>';

function current(){
  const q=document.getElementById('q').value.toLowerCase().trim();
  const g=document.getElementById('fg').value, l=document.getElementById('fl').value;
  const r=document.getElementById('fr').value, so=document.getElementById('fs').value;
  const w=document.getElementById('fw').value;
  const tf=TABS.find(t=>t.k===tab).fn;
  let list=DATA.filter(d=>tf(d)&&(!g||d.g===g)&&(!l||d.l===l)&&
    (!q||(d.t+' '+d.l+' '+d.g+' '+d.n+' '+d.cs+' '+d.ps+' '+d.bs).toLowerCase().includes(q))&&
    (!r || (r==='u'? d.c===null : d.c!==null&&d.c>=parseFloat(r)))&&
    (!w || (w==='__none'? !d.sv
          : w==='__rent'? (!!d.sv&&/^(Rent|Buy):/.test(d.sv))
          : (!!d.sv&&!/^(Rent|Buy):/.test(d.sv)&&d.sv.split(',').map(x=>x.trim()).includes(w)))));
  list.sort((a,b)=>{
    if(so==='t')return a.t.localeCompare(b.t);
    if(so==='y')return (b.y||0)-(a.y||0)||a.t.localeCompare(b.t);
    if(so==='yo')return (a.y||9999)-(b.y||9999)||a.t.localeCompare(b.t);
    return (b.c??-1)-(a.c??-1)||a.t.localeCompare(b.t);
  });
  return list;
}

/* ---- SAGE Suggests ---- */
const AUDIENCES=['All of it','Date Night','The Boys','Whole Family','Chris'];
let audience='All of it';

function renderSuggest(){
  const grid=document.getElementById('grid');
  const list=audience==='All of it'?SUGG:SUGG.filter(x=>x.who===audience);
  const pills=AUDIENCES.map(a=>'<button class="tab sm" data-aud="'+a+'" aria-selected="'+
    (a===audience)+'">'+a+(a==='All of it'?' ('+SUGG.length+')':
      ' ('+SUGG.filter(x=>x.who===a).length+')')+'</button>').join('');
  grid.className='sugglist';
  grid.innerHTML='<div class="suggintro"><h2>SAGE Suggests</h2>'+
    '<p>Twenty-four films you have never seen, each one argued from a rating already in your library. '+
    'Streaming checked for Costa Rica. Tell me what you think and I will replace the list.</p>'+
    '<div class="audpills">'+pills+'</div></div>'+
    list.map(x=>{
      const art=x.img?'<img src="'+esc(x.img)+'" alt="" loading="lazy">':
        '<div class="phs">'+esc(x.t)+'</div>';
      const where=x.sv
        ? (/^(Rent|Buy):/.test(x.sv)
            ? '<span class="rentbadge">'+esc(x.sv)+'</span>'
            : '<span class="streambadge">'+esc(x.sv)+'</span>')
        : '<span class="nobadge">Not streaming in Costa Rica</span>';
      return '<article class="sugg">'+
        '<div class="suggart">'+art+'</div>'+
        '<div class="suggbody">'+
          '<div class="suggtop"><h3>'+esc(x.t)+'</h3>'+
            '<span class="forwho '+x.who.replace(/\s+/g,'').toLowerCase()+'">'+esc(x.who)+'</span></div>'+
          '<div class="suggmeta">'+[x.y,x.rt?x.rt+' min':''].filter(Boolean).join(' \u00b7 ')+'</div>'+
          '<p class="why">'+esc(x.why)+'</p>'+
          '<div class="suggwhere">'+where+(x.sc?'<span class="checked">checked '+esc(x.sc)+'</span>':'')+'</div>'+
        '</div></article>';
    }).join('');
  document.getElementById('empty').hidden=true;
  document.getElementById('found').textContent=
    list.length+' suggestions'+(audience==='All of it'?'':' for '+audience.toLowerCase());
  grid.querySelectorAll('[data-aud]').forEach(b=>b.addEventListener('click',()=>{
    audience=b.dataset.aud; renderSuggest();
  }));
}

function render(){
  if(tab==='sagg'){ renderSuggest(); return; }
  document.getElementById('grid').className='grid';
  const list=current();
  const grid=document.getElementById('grid');
  grid.innerHTML=list.map((d,i)=>{
    const ci=DATA.indexOf(d);
    const cc=d.c===null?'':'<span class="chip c">'+num(d.c)+'</span>';
    const pp=(d.p!==null&&d.p!==d.c)?'<span class="chip p">'+num(d.p)+'</span>':'';
    const qq=(d.c===null&&/watchlist|owned|theaters|not released/i.test(d.s))
      ?'<span class="chip q">queue</span>':'';
    return '<button class="card" data-i="'+ci+'">'+
      '<div class="art">'+art(d)+'<div class="badges"><span>'+(cc||qq)+'</span><span>'+pp+'</span></div></div>'+
      '<div class="meta"><div class="nm">'+esc(d.t)+'</div><div class="sub">'+
      (d.y?'<span>'+d.y+'</span><span class="dot"></span>':'')+'<span>'+esc(d.g)+'</span>'+
      (d.sv?'<span class="dot"></span><span class="stream">'+esc(d.sv.split(/[,;]/)[0])+'</span>':'')+
      '</div></div></button>';
  }).join('');
  document.getElementById('empty').hidden=list.length>0;
  const r=list.filter(d=>d.c!==null);
  document.getElementById('found').textContent=
    list.length+' of '+DATA.length+' films'+
    (r.length?'  \\u00b7  '+r.filter(d=>d.c>=4).length+' of them we go back to':'');
}

/* ---- detail ---- */
const sheet=document.getElementById('sheet'), scrim=document.getElementById('scrim');
function open(i){
  const d=DATA[i];
  const sc=(who,v,cls)=>'<div class="sc '+cls+'"><div class="who">'+who+'</div><div class="v'+
    (v===null?' none':'')+'">'+(v===null?'not rated':num(v))+'</div></div>';
  const row=(k,v)=>v?'<div class="row"><div class="k">'+k+'</div><div class="v">'+esc(v)+'</div></div>':'';
  const says=[['Chris',d.cs,'c'],['Pixie',d.ps,'p'],['The boys',d.bs,'b']]
    .filter(x=>x[1]).map(([w,q,c])=>'<div class="quote '+c+'"><div class="who">'+w+
    ' says</div><div class="q">'+esc(q)+'</div></div>').join('');
  sheet.innerHTML='<div class="hd"><button class="x" id="closeX" aria-label="Close">&times;</button>'+
    '<h2 id="sheetTitle">'+esc(d.t)+'</h2><div class="yr">'+
    [d.y,d.g,d.rt?d.rt+' min':''].filter(Boolean).map(esc).join(' \\u00b7 ')+'</div></div>'+
    '<div class="bd">'+
    (d.ov?'<p style="color:var(--fg2);font-size:13.5px;margin:14px 0 0">'+esc(d.ov)+'</p>':'')+
    '<div class="scores">'+sc('Chris',d.c,'c')+sc('Pixie',d.p,'p')+'</div>'+
    '<div class="rows">'+row('Watched with',d.w)+row('Status',d.s)+row('Lane',d.l)+
    row('Streaming',d.sv?d.sv+(d.sc?' (checked '+d.sc+')':''):'')+'</div>'+
    (says?'<div class="says">'+says+'</div>':
      '<div class="nudge">Nobody has written down what they thought of this one yet. '+
      'Add it in the <b>Chris Says</b>, <b>Pixie Says</b> or <b>Boys Say</b> column of the sheet '+
      'and it shows up here as a quote.</div>')+
    (d.n?'<div class="sysnote">'+esc(d.n)+'</div>':'')+
    '</div>';
  sheet.classList.add('on'); scrim.classList.add('on');
  document.body.style.overflow='hidden';
  document.getElementById('closeX').addEventListener('click',close);
  document.getElementById('closeX').focus();
}
function close(){
  sheet.classList.remove('on'); scrim.classList.remove('on');
  document.body.style.overflow='';
}
document.getElementById('grid').addEventListener('click',e=>{
  const c=e.target.closest('.card'); if(c)open(Number(c.dataset.i));
});
scrim.addEventListener('click',close);
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

['q','fg','fl','fw','fr','fs'].forEach(id=>{
  const el=document.getElementById(id);
  el.addEventListener(id==='q'?'input':'change',render);
});
document.getElementById('reset').addEventListener('click',()=>{
  ['fg','fl','fw','fr','fs'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('q').value=''; render();
});

render();
</script>
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
console.log('  SAGE Suggests: ' + suggestions.length + ' picks (' + Object.entries(suggestions.reduce((m,x)=>(m[x.who]=(m[x.who]||0)+1,m),{})).map(([k,v])=>k+' '+v).join(', ') + ')');
console.log('Wrote index.html, movie-library.md, library.json');
console.log(cssExisted
  ? '  app.css: your edits were preserved. Only genuinely new feature styles get appended.'
  : '  app.css created from the default. Edit it freely; the build will not overwrite it.');
