#!/usr/bin/env node
/**
 * TMDB enrichment for The Hager Movie Library.
 *
 *   node 11-Artifacts/movie-library/enrich.mjs            # only films missing data
 *   node 11-Artifacts/movie-library/enrich.mjs --streaming # refresh streaming on everything
 *   node 11-Artifacts/movie-library/enrich.mjs --all       # re-match everything from scratch
 *
 * Fills TMDB ID, Poster, Runtime, Overview, canonical Year, and Streaming for
 * region CR. Downloads each poster into posters/ so the app stays entirely
 * self-contained: no CDN, works offline, works in the preview pane.
 *
 * Credentials come from .env at the vault root, which is gitignored.
 *
 * Honesty rules baked in:
 *  - A match is only written when the title and year genuinely agree. Anything
 *    weaker is written AND flagged 'carry' so a human confirms it.
 *  - Streaming Checked is stamped with today's date. No date means no claim.
 *  - Region is CR. US catalogue data is wrong for a family in Guanacaste.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
// --file lets the same pass enrich suggestions.csv, which shares the columns
// it needs. Defaults to the library.
const fileArg = (process.argv.find(a => a.startsWith('--file=')) || '').slice(7);
const CSV = path.join(DIR, fileArg || 'movie-library.csv');
const POSTERS = path.join(DIR, 'posters');
const today = new Date().toISOString().slice(0, 10);

const MODE = process.argv.includes('--all') ? 'all'
  : process.argv.includes('--streaming') ? 'streaming' : 'missing';

/* --------------------------------------------------------------- creds */
const envFile = path.join(ROOT, '.env');
if (!fs.existsSync(envFile)) { console.error('No .env at the vault root.'); process.exit(1); }
const env = {};
fs.readFileSync(envFile, 'utf8').split('\n').forEach(l => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
});
const TOKEN = env.TMDB_READ_TOKEN, REGION = env.TMDB_REGION || 'CR';
if (!TOKEN) { console.error('TMDB_READ_TOKEN missing from .env'); process.exit(1); }
const H = { Authorization: 'Bearer ' + TOKEN, accept: 'application/json' };

/* ----------------------------------------------------------------- csv */
function parseCSV(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
const norm = s => String(s).toLowerCase().replace(/^(the|a|an)\s+/, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

const rows = parseCSV(fs.readFileSync(CSV, 'utf8'));
const HEAD = rows.shift().map(h => h.trim());
const ix = {}; HEAD.forEach((h, i) => ix[h.toLowerCase()] = i);
const col = n => ix[n.toLowerCase()];

/* Entries that are not a single film and will never match cleanly. */
const NOT_A_FILM = /\(complete series|\(series\)/i;

const work = rows.filter(r => {
  if ((r[col('Status')] || '') === 'Dropped') return false;
  if (NOT_A_FILM.test(r[col('Title')] || '')) return false;
  if (MODE === 'all') return true;
  if (MODE === 'streaming') return !!(r[col('TMDB ID')] || '').trim();
  return !(r[col('TMDB ID')] || '').trim();
});

console.log(path.basename(CSV) + ' | region ' + REGION + ' | mode ' + MODE + ' | ' + work.length + ' films to process');
fs.mkdirSync(POSTERS, { recursive: true });

/* ----------------------------------------------------------- tmdb calls */
let calls = 0;
async function api(url, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      const r = await fetch(url, { headers: H });
      calls++;
      if (r.status === 429) { await sleep(1500 * a); continue; }
      if (!r.ok) { if (a === tries) return null; await sleep(400 * a); continue; }
      return await r.json();
    } catch (e) { if (a === tries) return null; await sleep(500 * a); }
  }
  return null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickMatch(results, title, year) {
  if (!results || !results.length) return null;
  const nt = norm(title);
  const scored = results.map(r => {
    const ry = r.release_date ? Number(r.release_date.slice(0, 4)) : null;
    const titleExact = norm(r.title) === nt || norm(r.original_title || '') === nt;
    const yearGap = (year && ry) ? Math.abs(ry - year) : null;
    let conf = 'weak';
    if (titleExact && yearGap === 0) conf = 'exact';
    else if (titleExact && (yearGap === null || yearGap <= 1)) conf = 'good';
    else if (titleExact) conf = 'title-only';
    else if (yearGap === 0) conf = 'year-only';
    return { r, ry, conf, yearGap, pop: r.popularity || 0 };
  });
  const order = { exact: 0, good: 1, 'title-only': 2, 'year-only': 3, weak: 4 };
  scored.sort((a, b) => order[a.conf] - order[b.conf] || b.pop - a.pop);
  return scored[0];
}

function providers(wp) {
  const cr = wp && wp.results && wp.results[REGION];
  if (!cr) return '';
  const names = a => (a || []).map(x => x.provider_name);
  const flat = names(cr.flatrate).concat(names(cr.free || []));
  if (flat.length) return [...new Set(flat)].join(', ');
  const rent = names(cr.rent), buy = names(cr.buy);
  if (rent.length) return 'Rent: ' + [...new Set(rent)].slice(0, 3).join(', ');
  if (buy.length) return 'Buy: ' + [...new Set(buy)].slice(0, 3).join(', ');
  return '';
}

async function poster(p, id) {
  if (!p) return '';
  const file = 'posters/' + id + '.jpg';
  const dest = path.join(DIR, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return file;
  try {
    const r = await fetch('https://image.tmdb.org/t/p/w342' + p);
    if (!r.ok) return '';
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return file;
  } catch { return ''; }
}

/* ------------------------------------------------------------- the pass */
const stats = { exact: 0, good: 0, weak: 0, none: 0, posters: 0, streaming: 0 };
const weakList = [], noneList = [];

async function one(r) {
  const title = r[col('Title')];
  const year = Number(r[col('Year')]) || null;
  let id = (r[col('TMDB ID')] || '').trim();
  let conf = 'exact';

  if (!id || MODE === 'all') {
    const qs = new URLSearchParams({ query: title });
    if (year) qs.set('year', String(year));
    let s = await api('https://api.themoviedb.org/3/search/movie?' + qs);
    let best = pickMatch(s && s.results, title, year);
    // No hit with the year filter? Try without it, the year may be ours and wrong.
    if ((!best || best.conf === 'weak') && year) {
      s = await api('https://api.themoviedb.org/3/search/movie?' + new URLSearchParams({ query: title }));
      const b2 = pickMatch(s && s.results, title, year);
      if (b2 && (!best || b2.conf !== 'weak')) best = b2;
    }
    if (!best) { stats.none++; noneList.push(title + (year ? ' (' + year + ')' : '')); return; }
    id = String(best.r.id); conf = best.conf;
  }

  const d = await api('https://api.themoviedb.org/3/movie/' + id + '?append_to_response=watch/providers');
  if (!d || !d.id) { stats.none++; noneList.push(title + ' [details failed]'); return; }

  r[col('TMDB ID')] = String(d.id);
  if (d.runtime) r[col('Runtime')] = String(d.runtime);
  if (d.overview && !r[col('Overview')]) r[col('Overview')] = d.overview;
  if (d.release_date && !r[col('Year')]) r[col('Year')] = d.release_date.slice(0, 4);

  const sv = providers(d['watch/providers']);
  r[col('Streaming')] = sv;
  r[col('Streaming Checked')] = today;
  if (sv) stats.streaming++;

  const img = await poster(d.poster_path, d.id);
  if (img) { r[col('Poster')] = img; stats.posters++; }

  if (conf === 'exact' || conf === 'good') stats[conf === 'exact' ? 'exact' : 'good']++;
  else {
    stats.weak++;
    weakList.push(title + (year ? ' (' + year + ')' : '') + ' -> ' + d.title +
      ' (' + (d.release_date || '?').slice(0, 4) + ') [' + conf + ']');
    // A shaky match is flagged, not quietly trusted.
    if (!r[col('Flag')]) r[col('Flag')] = 'carry';
    const note = r[col('Note')] || '';
    const add = 'TMDB matched this to "' + d.title + '" (' + (d.release_date || '?').slice(0, 4) +
      ') on a ' + conf + ' match. Confirm it is the right film.';
    if (!note.includes('TMDB matched')) r[col('Note')] = note ? note + ' ' + add : add;
  }
}

/* modest concurrency, politely */
const LIMIT = 6;
let done = 0;
async function run() {
  const queue = work.slice();
  await Promise.all(Array.from({ length: LIMIT }, async () => {
    while (queue.length) {
      const r = queue.shift();
      await one(r);
      done++;
      if (done % 40 === 0) console.log('  ... ' + done + '/' + work.length);
    }
  }));
}

await run();

fs.writeFileSync(CSV, '﻿' + HEAD.map(esc).join(',') + '\n' +
  rows.map(r => HEAD.map((_, i) => esc(r[i])).join(',')).join('\n') + '\n', 'utf8');

console.log('\nTMDB pass complete. ' + calls + ' API calls.');
console.log('  matched exactly: ' + stats.exact + ' | good: ' + stats.good + ' | weak (flagged): ' + stats.weak + ' | no match: ' + stats.none);
console.log('  posters downloaded or already present: ' + stats.posters);
console.log('  films streaming somewhere in ' + REGION + ': ' + stats.streaming);
if (weakList.length) { console.log('\nWEAK MATCHES, flagged for Chris:'); weakList.forEach(x => console.log('  ' + x)); }
if (noneList.length) { console.log('\nNO MATCH:'); noneList.forEach(x => console.log('  ' + x)); }
