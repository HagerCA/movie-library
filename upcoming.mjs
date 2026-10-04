#!/usr/bin/env node
/**
 * Upcoming and newly-released films worth tracking, built from what the family
 * already rates highly.
 *
 *   node 11-Artifacts/movie-library/upcoming.mjs
 *
 * Writes upcoming.csv. Re-run it any time: existing Interest answers and notes
 * are preserved, everything else refreshes.
 *
 * Why this exists, in Chris's words 2026-10-03: "we don't get to see a lot of
 * movies out here." So the useful signal is not the trailer, it is the moment a
 * film becomes watchable in Costa Rica. Each row tracks theatrical date, then
 * streaming status for region CR, and says which.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const OUT = path.join(DIR, 'upcoming.csv');
const POSTERS = path.join(DIR, 'posters');
const today = new Date().toISOString().slice(0, 10);

const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(l => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim();
});
const REGION = env.TMDB_REGION || 'CR';
const H = { Authorization: 'Bearer ' + env.TMDB_READ_TOKEN, accept: 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function api(p, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      const r = await fetch('https://api.themoviedb.org/3' + p, { headers: H });
      calls++;
      if (r.status === 429) { await sleep(1500 * a); continue; }
      if (!r.ok) { if (a === tries) return null; await sleep(400 * a); continue; }
      return await r.json();
    } catch { if (a === tries) return null; await sleep(500 * a); }
  }
  return null;
}

/* ---------------------------------------------------------------- csv io */
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
  .replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');

/* ----------------------------------------------- what they already have */
const libRows = parseCSV(fs.readFileSync(path.join(DIR, 'movie-library.csv'), 'utf8'));
const lh = libRows.shift().map(h => h.trim().toLowerCase());
const seen = new Set(libRows.map(r => norm(r[lh.indexOf('title')])));

/* --------------------------------- keep any Interest answers from before */
/* A Dropped status is carried across too. Discovery will keep re-finding a
   title Chris has already retired, and a refresh that quietly resurrects it
   makes the drop meaningless. Nothing is deleted; the row stays, hidden.    */
const prior = {};
if (fs.existsSync(OUT)) {
  const pr = parseCSV(fs.readFileSync(OUT, 'utf8'));
  const ph = pr.shift().map(h => h.trim().toLowerCase());
  pr.forEach(r => {
    const id = r[ph.indexOf('tmdb id')];
    if (id) prior[id] = {
      interest: r[ph.indexOf('interest')] || '',
      note: ph.indexOf('note') > -1 ? (r[ph.indexOf('note')] || '') : '',
      dropped: /^Dropped$/i.test((r[ph.indexOf('status')] || '').trim())
    };
  });
}

/* ------------------------------------------------- where to look, and why */
// Companies and people the family's own ratings point at.
const COMPANIES = [
  [420,   'Marvel'],
  [1,     'Lucasfilm / Star Wars'],
  [3,     'Pixar'],
  [521,   'DreamWorks Animation'],
  [23948, 'Cartoon Saloon'],
  [2,     'Disney'],
  [7505,  'Marvel Entertainment']
];
// Directors are no longer guessed at. favorites.json ranks them from the real
// credits of every rated film, so the tracker follows whoever the family's own
// numbers say they follow. Guy Ritchie stays pinned because he is the clearest
// signal in the data and TMDB ids are stable.
const PEOPLE = [[956, 'Guy Ritchie']];
const FAV = path.join(DIR, 'favorites.json');
if (fs.existsSync(FAV)) {
  const fav = JSON.parse(fs.readFileSync(FAV, 'utf8'));
  for (const d of (fav.directors || []).slice(0, 8)) {
    const r = await api('/search/person?query=' + encodeURIComponent(d.name));
    const hit = r && r.results && r.results[0];
    if (hit && !PEOPLE.some(p => p[0] === hit.id))
      PEOPLE.push([hit.id, d.name + ' (' + d.n + ' films at ' + d.avg + ')']);
  }
  console.log('  following ' + PEOPLE.length + ' directors from favorites.json');
}

// Named sequels in franchises they have rated 4.0 or better. Searched by title
// so a film with no company match still lands.
const SEEDS = [
  ['Avengers: Doomsday', 'Marvel'],
  ['Avengers: Secret Wars', 'Marvel'],
  ['Spider-Man: Brand New Day', 'Marvel'],
  ['Star Wars: Starfighter', 'Lucasfilm / Star Wars'],
  ['The Mandalorian and Grogu', 'Lucasfilm / Star Wars'],
  ['Beyond the Spider-Verse', 'Spider-Verse'],
  ['Toy Story 5', 'Pixar'],
  ['Shrek 5', 'DreamWorks'],
  ['Wake Up Dead Man: A Knives Out Mystery', 'Knives Out'],
  ['Dune: Part Three', 'Denis Villeneuve'],
  ['Avatar: Fire and Ash', 'Avatar'],
  ['Zootopia 2', 'Disney Animation'],
  ['Wicked: For Good', 'Musical, after The Greatest Showman'],
  ['How to Train Your Dragon', 'How to Train Your Dragon'],
  ['Moana', 'Disney Animation'],
  ['The Super Mario Galaxy Movie', 'Nintendo, after Super Mario Bros'],
  ['Minions 3', 'Illumination'],
  ['Sense and Sensibility', 'Austen']
];

const FROM = '2026-04-01';   // far enough back to catch films now hitting streaming
const TO   = '2028-12-31';

const found = new Map();   // tmdb id -> { id, title, date, source }
function add(m, source) {
  if (!m || !m.id) return;
  if (seen.has(norm(m.title))) return;             // already in the library
  if (found.has(m.id)) return;
  const d = m.release_date || '';
  if (d && (d < FROM || d > TO)) return;
  found.set(m.id, { id: m.id, title: m.title, date: d, source });
}

console.log('Discovering, region ' + REGION + ', window ' + FROM + ' to ' + TO);

for (const [cid, label] of COMPANIES) {
  for (let page = 1; page <= 2; page++) {
    const r = await api('/discover/movie?with_companies=' + cid +
      '&primary_release_date.gte=' + FROM + '&primary_release_date.lte=' + TO +
      '&sort_by=primary_release_date.asc&page=' + page);
    if (!r || !r.results) break;
    r.results.forEach(m => add(m, label));
    if (page >= (r.total_pages || 1)) break;
  }
}
for (const [pid, label] of PEOPLE) {
  const r = await api('/person/' + pid + '/movie_credits');
  if (r && r.crew) r.crew.filter(c => /Director|Writer/.test(c.job || ''))
    .forEach(m => add(m, label));
}
for (const [title, label] of SEEDS) {
  const r = await api('/search/movie?query=' + encodeURIComponent(title));
  if (r && r.results && r.results.length) {
    // The seeds are specific titles, so take the closest name match.
    const exact = r.results.find(m => norm(m.title) === norm(title));
    add(exact || r.results[0], label);
  }
}

console.log('  ' + found.size + ' candidates, now pulling dates and providers');

/* ---------------------------------------------------- detail + providers */
function providers(wp) {
  const cr = wp && wp.results && wp.results[REGION];
  if (!cr) return '';
  const names = a => (a || []).map(x => x.provider_name);
  const flat = [...new Set(names(cr.flatrate).concat(names(cr.free || [])))];
  if (flat.length) return flat.join(', ');
  const rb = [...new Set(names(cr.rent).concat(names(cr.buy)))];
  return rb.length ? 'Rent: ' + rb.slice(0, 3).join(', ') : '';
}
async function poster(p, id) {
  if (!p) return '';
  const rel = 'posters/' + id + '.jpg';
  const dest = path.join(DIR, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return rel;
  try {
    const r = await fetch('https://image.tmdb.org/t/p/w342' + p);
    if (!r.ok) return '';
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return rel;
  } catch { return ''; }
}

const out = [];
const list = [...found.values()];
let n = 0;
const LIMIT = 6;
await Promise.all(Array.from({ length: LIMIT }, async () => {
  while (list.length) {
    const c = list.shift();
    const d = await api('/movie/' + c.id + '?append_to_response=watch/providers,release_dates');
    n++;
    if (n % 25 === 0) console.log('  ... ' + n);
    if (!d || !d.id) continue;
    if (d.status === 'Canceled') continue;

    // Company discovery drags in shorts, promo clips and behind-the-scenes
    // filler. A tracker full of "Toy Story Back-To-School Lunchbox Disaster!"
    // is worse than a shorter honest one.
    if (d.runtime && d.runtime < 45) continue;
    if (/Insider|Short|Team-Up!|Behind the Scenes|Sneak Peek|Featurette|Making of/i.test(d.title)) continue;

    // Theatrical date for this region if TMDB has one, else the global date.
    let crDate = '';
    const rd = d.release_dates && d.release_dates.results;
    const mine = rd && rd.find(x => x.iso_3166_1 === REGION);
    if (mine) {
      const theatrical = mine.release_dates.find(x => x.type === 3 || x.type === 2);
      if (theatrical) crDate = theatrical.release_date.slice(0, 10);
    }
    const global = d.release_date || '';
    const sv = providers(d['watch/providers']);

    // The status that actually matters: can they watch it yet, and where.
    let status;
    if (!global || global > today) status = 'Upcoming';
    else if (sv && !/^Rent:/.test(sv)) status = 'Now streaming';
    else if (sv) status = 'Rent or buy';
    else status = 'In theaters or not here yet';
    if ((prior[d.id] || {}).dropped) status = 'Dropped';

    // Several tracked titles share a name with a film the family already loves.
    // Disambiguate by year in the title so nobody mistakes one for the other.
    let label = d.title;
    if (seen.has(norm(d.title)) || /How to Train Your Dragon 2|Moana|How to Train Your Dragon$/.test(d.title))
      label = d.title + ' (' + (global ? global.slice(0, 4) : 'TBA') + ')';

    out.push({
      t: label, y: global ? global.slice(0, 4) : '',
      src: c.source, id: String(d.id),
      crDate, global, status, sv, sc: today,
      img: await poster(d.poster_path, d.id),
      rt: d.runtime || '',
      ov: d.overview || '',
      interest: (prior[d.id] || {}).interest || '',
      note: (prior[d.id] || {}).note || ''
    });
  }
}));

out.sort((a, b) => (a.global || '9999') .localeCompare(b.global || '9999'));

const HEAD = ['Title','Year','Why Tracked','TMDB ID','Release Date','Release Costa Rica',
  'Status','Streaming','Streaming Checked','Poster','Runtime','Overview','Interest','Note'];
fs.writeFileSync(OUT, '﻿' + HEAD.join(',') + '\n' + out.map(r =>
  [r.t, r.y, r.src, r.id, r.global, r.crDate, r.status, r.sv, r.sc, r.img, r.rt, r.ov, r.interest, r.note]
    .map(esc).join(',')).join('\n') + '\n', 'utf8');

const by = out.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
console.log('\n' + out.length + ' films tracked. ' + calls + ' API calls.');
Object.entries(by).forEach(([k, v]) => console.log('  ' + String(v).padStart(3) + '  ' + k));
console.log('  answers preserved: ' + out.filter(r => r.interest).length);
console.log('\nNext up:');
out.filter(r => r.status === 'Upcoming').slice(0, 12).forEach(r =>
  console.log('  ' + (r.global || '????-??-??') + '  ' + r.t + '  [' + r.src + ']'));
