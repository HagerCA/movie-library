#!/usr/bin/env node
/**
 * Our People -> what you have NOT seen.
 *
 * Chris's idea, 2026-10-04: "if I float on Steven Spielberg and you have all the
 * ones that I've watched: what if we gave his top 10 unwatched movies in there as
 * well? That could also generate new things to watch for us."
 *
 * So for every person already ranked in favorites.json (directors, actors,
 * actresses, writers, composers, most appearances) this pulls their real
 * filmography from TMDB, removes everything already in the library, and keeps the
 * ten best remaining films. Writes them back onto each person as `unwatched`.
 *
 * Three rules carried over from the rest of this library:
 *
 *  - A leading role counts, a walk-on does not. For the cast categories a credit
 *    only qualifies at billing order 5 or better, because "a Rupert Grint film"
 *    means one he is in, not one he appears in for ninety seconds.
 *  - Ranked by a credibility-weighted score, never a raw TMDB average, for the
 *    same reason Our People itself is: one obscure film at 8.4 with 180 votes is
 *    not better than a film at 7.9 with 40,000.
 *  - Availability is checked live for region CR and date-stamped, or it is not
 *    claimed at all. A wrong "it's on Netflix" costs Chris an evening.
 *
 * Run order: credits.mjs, then this, then build.mjs.
 * Caches per person and per film, so a rerun only fetches what is new.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(l => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim();
});
const TOKEN = env.TMDB_READ_TOKEN;
if (!TOKEN) { console.error('TMDB_READ_TOKEN missing from .env'); process.exit(1); }
const REGION = env.TMDB_REGION || 'CR';
const H = { Authorization: 'Bearer ' + TOKEN, accept: 'application/json' };

const TOP_N        = 10;    // films kept per person
const MIN_VOTES    = 150;   // below this TMDB is noise, not signal
const LEAD_ORDER   = 5;     // cast billing cutoff
const PRIOR_VOTES  = 1200;  // credibility prior: pulls thin evidence to the mean
const PRIOR_SCORE  = 6.3;   // TMDB's own global mean, roughly

/* Reunion specials and promo pieces are listed as movies on TMDB and are not
   films anybody sits down to watch. "Harry Potter 20th Anniversary: Return to
   Hogwarts" was the one that made this necessary. */
const JUNK = /\b(\d+th Anniversary|Return to Hogwarts|Making of|Behind the Scenes|Blooper|Featurette|Promo)\b/i;

const CAST_CATS = { actors: 1, actresses: 1, prolific: 1 };
const CREW_JOB = {
  directors: j => j === 'Director',
  writers:   j => /^(Writer|Screenplay|Story|Novel|Characters)$/.test(j),
  composers: j => /Composer|^Music$/.test(j)
};
const CATEGORIES = ['directors', 'actors', 'actresses', 'writers', 'composers', 'prolific'];

/* ---------------------------------------------------------------- the library */
function parseCSV(t) {
  t = t.replace(/^﻿/, '');
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const lib = parseCSV(fs.readFileSync(path.join(DIR, 'movie-library.csv'), 'utf8'));
const lh = lib[0], li = n => lh.indexOf(n);
const SEEN_IDS = new Set(), SEEN_TITLES = new Set();
for (const r of lib.slice(1)) {
  if (r.length < 2 || !r[0].trim()) continue;
  const id = (r[li('TMDB ID')] || '').trim();
  if (id) SEEN_IDS.add(id);
  SEEN_TITLES.add((r[0] || '').trim().toLowerCase());
}
console.log('library: ' + SEEN_IDS.size + ' films with a TMDB id, ' + SEEN_TITLES.size + ' distinct titles');

/* ------------------------------------------------- name -> TMDB person id map */
const credits = JSON.parse(fs.readFileSync(path.join(DIR, 'credits-cache.json'), 'utf8'));
const personId = new Map();
for (const fid of Object.keys(credits)) {
  for (const p of credits[fid].cast || []) if (!personId.has(p.n)) personId.set(p.n, p.id);
  for (const p of credits[fid].crew || []) if (!personId.has(p.n)) personId.set(p.n, p.id);
}

/* ------------------------------------------------------------------- fetching */
const PCACHE = path.join(DIR, 'discover-cache.json');
const cache = fs.existsSync(PCACHE) ? JSON.parse(fs.readFileSync(PCACHE, 'utf8')) : { people: {}, prov: {} };
cache.people = cache.people || {}; cache.prov = cache.prov || {};
let calls = 0;

async function api(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(url, { headers: H });
      calls++;
      if (res.status === 429) { await new Promise(s => setTimeout(s, 1600)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch { await new Promise(s => setTimeout(s, 700)); }
  }
  return null;
}
async function pool(items, n, fn) {
  const q = items.slice();
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.pop()); }));
}

/* who do we need? */
const fav = JSON.parse(fs.readFileSync(path.join(DIR, 'favorites.json'), 'utf8'));
const wanted = [];
for (const cat of CATEGORIES) for (const p of fav[cat] || []) {
  const id = personId.get(p.name);
  if (!id) { console.log('  no TMDB id for ' + p.name + ' (' + cat + ') - skipped'); continue; }
  wanted.push({ cat, name: p.name, id });
}
const needFetch = wanted.filter(w => !cache.people[w.id]);
console.log('people ranked: ' + wanted.length + ' | credit lists to fetch: ' + needFetch.length);

await pool(needFetch, 8, async w => {
  const d = await api('https://api.themoviedb.org/3/person/' + w.id + '/movie_credits');
  if (!d) return;
  cache.people[w.id] = {
    cast: (d.cast || []).map(f => ({ id: f.id, t: f.title, d: f.release_date || '',
      va: f.vote_average || 0, vc: f.vote_count || 0, o: f.order == null ? 99 : f.order,
      g: f.genre_ids || [] })),
    crew: (d.crew || []).map(f => ({ id: f.id, t: f.title, d: f.release_date || '',
      va: f.vote_average || 0, vc: f.vote_count || 0, j: f.job || '', g: f.genre_ids || [] }))
  };
});
fs.writeFileSync(PCACHE, JSON.stringify(cache));

/* --------------------------------------------------------------- the shortlist */
const TODAY = new Date().toISOString().slice(0, 10);
const score = f => (f.vc * f.va + PRIOR_VOTES * PRIOR_SCORE) / (f.vc + PRIOR_VOTES);

function shortlist(w) {
  const rec = cache.people[w.id]; if (!rec) return [];
  let pool2;
  if (CAST_CATS[w.cat]) pool2 = (rec.cast || []).filter(f => f.o <= LEAD_ORDER);
  else { const ok = CREW_JOB[w.cat]; pool2 = (rec.crew || []).filter(f => ok(f.j)); }
  const byId = new Map();
  for (const f of pool2) {
    if (!f.t || !f.d || f.d > TODAY) continue;        // unreleased or undated
    if (f.vc < MIN_VOTES) continue;                   // too obscure to judge
    if ((f.g || []).indexOf(10770) > -1) continue;    // TV movie
    if (JUNK.test(f.t)) continue;                     // reunion special, not a film
    if (SEEN_IDS.has(String(f.id))) continue;         // already in the library
    if (SEEN_TITLES.has(f.t.trim().toLowerCase())) continue;
    if (!byId.has(f.id)) byId.set(f.id, f);
  }
  return [...byId.values()].sort((a, b) => score(b) - score(a)).slice(0, TOP_N);
}

const picks = new Map();                 // person key -> films
const filmIds = new Set();
for (const w of wanted) {
  const list = shortlist(w);
  picks.set(w.cat + '|' + w.name, list);
  list.forEach(f => filmIds.add(f.id));
}
console.log('distinct films shortlisted: ' + filmIds.size);

/* ------------------------------------------------- availability, region CR only */
function providerLabel(wp) {
  const cr = wp && wp.results && wp.results[REGION];
  if (!cr) return '';
  const names = a => (a || []).map(x => x.provider_name);
  const flat = names(cr.flatrate).concat(names(cr.free || []));
  if (flat.length) return [...new Set(flat)].slice(0, 3).join(', ');
  const rent = names(cr.rent).concat(names(cr.buy || []));
  if (rent.length) return 'Rent: ' + [...new Set(rent)].slice(0, 3).join(', ');
  return '';
}
const needProv = [...filmIds].filter(id => cache.prov[id] === undefined);
console.log('availability checks needed: ' + needProv.length);
await pool(needProv, 8, async id => {
  const d = await api('https://api.themoviedb.org/3/movie/' + id + '/watch/providers');
  cache.prov[id] = d ? providerLabel(d) : '';
});
fs.writeFileSync(PCACHE, JSON.stringify(cache));

/* ------------------------------------------------------------------- write out */
let attached = 0, green = 0;
for (const cat of CATEGORIES) for (const p of fav[cat] || []) {
  const list = picks.get(cat + '|' + p.name);
  if (!list || !list.length) { delete p.unwatched; continue; }
  p.unwatched = list.map(f => {
    const sw = cache.prov[f.id] || '';
    if (sw && !/^Rent:/.test(sw)) green++;
    return { t: f.t, y: (f.d || '').slice(0, 4), va: Math.round(f.va * 10) / 10, vc: f.vc, sw };
  });
  attached++;
}
fav.unwatchedChecked = TODAY;
fav.unwatchedRegion = REGION;
fs.writeFileSync(path.join(DIR, 'favorites.json'), JSON.stringify(fav, null, 1));

console.log('\nattached an unwatched list to ' + attached + ' of ' + wanted.length + ' people');
console.log('film rows written: ' + [...picks.values()].reduce((a, b) => a + b.length, 0) +
  ' | streaming on something somewhere: ' + green);
console.log('TMDB calls this run: ' + calls + ' | availability dated ' + TODAY + ' for region ' + REGION);
console.log('\nspot check:');
for (const cat of CATEGORIES) {
  const p = (fav[cat] || [])[0];
  if (p && p.unwatched) console.log('  ' + cat + ' #1 ' + p.name + ': ' +
    p.unwatched.slice(0, 3).map(f => f.t + ' (' + f.y + ')' + (f.sw ? ' [' + f.sw + ']' : ' [nothing in CR]')).join(' | '));
}
