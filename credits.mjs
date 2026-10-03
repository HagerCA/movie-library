#!/usr/bin/env node
/**
 * Who the Hagers actually keep watching.
 *
 *   node 11-Artifacts/movie-library/credits.mjs
 *
 * Pulls full cast and crew for every rated film from TMDB, caches them in
 * credits-cache.json, and writes favorites.json: ranked directors, writers,
 * actors, actresses and composers, scored against their own ratings.
 *
 * The ranking rule matters. Sorting by average alone crowns somebody with one
 * 5.0 and nothing else. Sorting by count alone crowns whoever happens to be in
 * every Marvel film. So this uses a credibility-weighted score: an average
 * pulled toward the library mean in proportion to how little evidence there is.
 * Three films at 4.8 beats one film at 5.0, and ten films at 4.6 beats both.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const CACHE = path.join(DIR, 'credits-cache.json');
const OUT = path.join(DIR, 'favorites.json');

const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(l => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim();
});
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

function parseCSV(t) {
  t = t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const R = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); R.push(r); r = []; f = ''; }
    else f += c; }
  if (f.length || r.length) { r.push(f); R.push(r); }
  return R.filter(x => x.some(c => c.trim() !== ''));
}

const rows = parseCSV(fs.readFileSync(path.join(DIR, 'movie-library.csv'), 'utf8'));
const head = rows.shift().map(h => h.trim().toLowerCase());
const at = n => head.indexOf(n);

const films = rows.filter(r => (r[at('status')] || '') !== 'Dropped')
  .map(r => ({
    t: r[at('title')], id: (r[at('tmdb id')] || '').trim(),
    c: (r[at('chris')] || '').trim() === '' ? null : Number(r[at('chris')]),
    g: r[at('genre')], lane: r[at('lane')], w: r[at('context')]
  }))
  .filter(f => f.id && f.c !== null);

const MEAN = films.reduce((s, f) => s + f.c, 0) / films.length;
console.log(films.length + ' rated films with a TMDB id. Library mean ' + MEAN.toFixed(3));

let cache = {};
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const todo = films.filter(f => !cache[f.id]);
console.log(todo.length + ' need a credits fetch, ' + (films.length - todo.length) + ' cached');

const queue = todo.slice();
let done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const d = await api('/movie/' + f.id + '/credits');
    done++;
    if (done % 50 === 0) console.log('  ... ' + done + '/' + todo.length);
    if (!d) continue;
    cache[f.id] = {
      cast: (d.cast || []).slice(0, 15).map(c => ({ id: c.id, n: c.name, g: c.gender, o: c.order })),
      crew: (d.crew || []).filter(c => /^(Director|Writer|Screenplay|Original Music Composer)$/.test(c.job))
        .map(c => ({ id: c.id, n: c.name, j: c.job, g: c.gender }))
    };
  }
}));
fs.writeFileSync(CACHE, JSON.stringify(cache), 'utf8');
console.log('credits cached. ' + calls + ' API calls.');

/* ------------------------------------------------------------- the ranking */

/* Chris, 2026-10-03: "let's go with people who have leading roles, being like
 * 2x for those in supporting roles. I want the supporting roles in there for
 * sure but I'm really looking for the leading man, the leading ladies."
 *
 * His example was exact. Vin Diesel topped the actors on three words as Groot,
 * which is not a relationship with an actor. TMDB billing order is the honest
 * proxy: top three billed counts double, everyone else counts once, so a lead
 * across nine films outranks a voice cameo across five.
 *
 * Crew have no billing order, so they always weigh 1 and `lead` stays false. */
function collect(pick) {
  const by = {};
  for (const f of films) {
    const cr = cache[f.id]; if (!cr) continue;
    const seen = new Set();
    for (const p of pick(cr)) {
      if (seen.has(p.id)) continue;      // one credit per person per film
      seen.add(p.id);
      const lead = p.o !== undefined && p.o <= 2;
      const e = by[p.id] = by[p.id] || { id: p.id, name: p.n, g: p.g, films: [] };
      e.films.push({ t: f.t, r: f.c, w: lead ? 3 : 1, lead: lead, crew: p.o === undefined });
    }
  }
  return by;
}

// Credibility weighting: an average pulled toward the library mean in
// proportion to how thin the evidence is. K is the number of films at which
// somebody's own average starts to outweigh the prior.
const K = 4;
function score(e) {
  const n = e.films.length;
  const leads = e.films.filter(f => f.lead).length;
  // Weight by billing: a lead carries twice the evidence of a supporting part.
  const W = e.films.reduce((s, f) => s + f.w, 0);
  const avg = e.films.reduce((s, f) => s + f.r, 0) / n;
  const wavg = e.films.reduce((s, f) => s + f.r * f.w, 0) / W;
  return { n, leads, W, avg, wavg, weighted: (wavg * W + MEAN * K) / (W + K) };
}

function rank(by, minFilms, filter) {
  return Object.values(by)
    .map(e => Object.assign({}, e, score(e)))
    .filter(e => e.n >= minFilms)
    .filter(e => !filter || filter(e))
    .sort((a, b) => b.weighted - a.weighted || b.n - a.n)
    .map(e => ({
      name: e.name, n: e.n, leads: e.leads,
      avg: Number(e.avg.toFixed(2)), wavg: Number(e.wavg.toFixed(2)),
      weighted: Number(e.weighted.toFixed(3)),
      top: e.films.sort((a, b) => (b.lead - a.lead) || (b.r - a.r)).slice(0, 4)
        .map(f => f.t + ' ' + f.r.toFixed(1) + (f.crew || f.lead ? '' : ' (supporting)'))
    }));
}

const directors = collect(c => c.crew.filter(x => x.j === 'Director'));
const writers   = collect(c => c.crew.filter(x => /Writer|Screenplay/.test(x.j)));
const composers = collect(c => c.crew.filter(x => x.j === 'Original Music Composer'));
const actors    = collect(c => c.cast.filter(x => x.o <= 6));

// TMDB gender: 1 female, 2 male, 0 or 3 unknown or non-binary.
const favorites = {
  built: new Date().toISOString().slice(0, 10),
  films: films.length,
  mean: Number(MEAN.toFixed(3)),
  directors: rank(directors, 2).slice(0, 12),
  writers:   rank(writers, 2).slice(0, 10),
  // Two leading roles minimum. One lead plus four cameos is not somebody you
  // follow, it is somebody who keeps turning up. Vin Diesel topped this list on
  // The Iron Giant plus four Groot credits, which was Chris's exact objection.
  // He stays visible under Most Appearances, where that fact belongs.
  actors:    rank(actors, 3, e => e.g === 2 && e.leads >= 2).slice(0, 12),
  actresses: rank(actors, 3, e => e.g === 1 && e.leads >= 2).slice(0, 12),
  composers: rank(composers, 3).slice(0, 8),
  prolific:  rank(actors, 1).sort((a, b) => b.n - a.n).slice(0, 10)
};

// Genres and lanes come from their own labels, not TMDB's.
function byField(field) {
  const m = {};
  films.forEach(f => {
    const k = f[field]; if (!k) return;
    (m[k] = m[k] || []).push(f.c);
  });
  return Object.entries(m).map(([k, v]) => ({
    name: k, n: v.length,
    avg: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)),
    weighted: Number(((v.reduce((a, b) => a + b, 0) + MEAN * K) / (v.length + K)).toFixed(3))
  })).sort((a, b) => b.weighted - a.weighted);
}
favorites.genres = byField('g');
favorites.lanes = byField('lane').filter(x => x.n >= 2);

fs.writeFileSync(OUT, JSON.stringify(favorites, null, 1), 'utf8');

const show = (label, list) => {
  console.log('\n=== ' + label + ' ===');
  list.slice(0, 8).forEach((e, i) =>
    console.log('  ' + (i + 1) + '. ' + e.name.padEnd(24) + String(e.n).padStart(2) + ' films' +
      (e.leads !== undefined ? ', ' + e.leads + ' leading' : '') +
      ', avg ' + e.avg.toFixed(2) + (e.top ? '   ' + e.top.slice(0, 2).join(', ') : '')));
};
show('DIRECTORS', favorites.directors);
show('ACTORS', favorites.actors);
show('ACTRESSES', favorites.actresses);
show('WRITERS', favorites.writers);
show('COMPOSERS', favorites.composers);
console.log('\n=== MOST APPEARANCES ===');
favorites.prolific.slice(0, 8).forEach((e, i) =>
  console.log('  ' + (i + 1) + '. ' + e.name.padEnd(26) + e.n + ' films, avg ' + e.avg.toFixed(2)));
show('GENRES', favorites.genres);
console.log('\nWrote favorites.json');
