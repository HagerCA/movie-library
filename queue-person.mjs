#!/usr/bin/env node
/**
 * Queue one person's best films that are not in the library yet.
 *
 *   node queue-person.mjs "Gore Verbinski"              # preview, writes nothing
 *   node queue-person.mjs "Gore Verbinski" --write      # add them as Watchlist rows
 *   node queue-person.mjs "Emma Thompson" --role=actors --top=5 --write
 *
 * Chris asked for this on 2026-10-05: "let's place Verbinski's top 10 films in
 * the queue. I'll go back and see if I recognize some of them and then I'll
 * catalog them if I have." Our People only ranks the top twelve in each
 * category, so anybody outside that has no drawer. This is the drawer for one
 * person, on demand, by name.
 *
 * Same rules as discover.mjs, deliberately: a credibility-weighted score rather
 * than a raw TMDB average, 150 votes minimum, no TV movies, no promo pieces,
 * and nothing already in the library. A leading role counts for the cast roles.
 *
 * Writes Watchlist rows with the TMDB id already filled in, which means the
 * follow-up pass is enrich-by-id.mjs and NOT enrich.mjs: enrich in "missing"
 * mode treats a row that has an id as finished and will skip these entirely,
 * leaving them with no poster, runtime or overview. Genre and Lane are left
 * Unsorted on purpose: those are a judgement call, set deliberately rather
 * than guessed here.
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
const TODAY = new Date().toISOString().slice(0, 10);

const MIN_VOTES = 150, PRIOR_VOTES = 1200, PRIOR_SCORE = 6.3, LEAD_ORDER = 5;
const JUNK = /\b(\d+th Anniversary|Return to Hogwarts|Making of|Behind the Scenes|Blooper|Featurette|Promo|Holiday Special|Christmas Special)\b/i;
const CREW_JOB = {
  directors: j => j === 'Director',
  writers:   j => /^(Writer|Screenplay|Story|Novel|Characters)$/.test(j),
  composers: j => /Composer|^Music$/.test(j)
};

const args = process.argv.slice(2);
const NAME  = args.find(a => !a.startsWith('--'));
const WRITE = args.includes('--write');
const ROLE  = (args.find(a => a.startsWith('--role=')) || '--role=directors').split('=')[1];
const TOP_N = Number((args.find(a => a.startsWith('--top=')) || '--top=10').split('=')[1]);
if (!NAME) {
  console.error('usage: node queue-person.mjs "Name" [--role=directors|actors|writers|composers] [--top=10] [--write]');
  process.exit(1);
}

let calls = 0;
async function api(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: H }); calls++;
      if (r.status === 429) { await new Promise(s => setTimeout(s, 1600)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise(s => setTimeout(s, 700)); }
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
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

const LIB = path.join(DIR, 'movie-library.csv');
const rows = parseCSV(fs.readFileSync(LIB, 'utf8'));
const head = rows.shift().map(h => h.trim());
const ix = {}; head.forEach((h, i) => ix[h.toLowerCase()] = i);
const at = n => ix[n.toLowerCase()];
const SEEN_IDS = new Set(), SEEN_TITLES = new Set();
for (const r of rows) {
  const id = (r[at('TMDB ID')] || '').trim(); if (id) SEEN_IDS.add(id);
  SEEN_TITLES.add((r[at('Title')] || '').trim().toLowerCase());
}

/* the person: the credits cache first, a search only if they are not in it */
let personId = null;
const credits = JSON.parse(fs.readFileSync(path.join(DIR, 'credits-cache.json'), 'utf8'));
outer: for (const fid of Object.keys(credits)) {
  for (const p of (credits[fid].cast || []).concat(credits[fid].crew || []))
    if (p.n === NAME) { personId = p.id; break outer; }
}
if (!personId) {
  const s = await api('https://api.themoviedb.org/3/search/person?query=' + encodeURIComponent(NAME));
  const hit = (s && s.results || [])[0];
  if (!hit) { console.error('no TMDB person found for ' + NAME); process.exit(1); }
  personId = hit.id;
  console.log('not in the credits cache, matched by search: ' + hit.name + ' (id ' + hit.id + ')');
} else {
  console.log(NAME + ' found in the credits cache, id ' + personId);
}

const d = await api('https://api.themoviedb.org/3/person/' + personId + '/movie_credits');
if (!d) { console.error('could not fetch credits'); process.exit(1); }

const pool = (ROLE === 'actors' || ROLE === 'actresses' || ROLE === 'prolific')
  ? (d.cast || []).filter(f => (f.order == null ? 99 : f.order) <= LEAD_ORDER)
  : (d.crew || []).filter(f => (CREW_JOB[ROLE] || CREW_JOB.directors)(f.job || ''));

const score = f => ((f.vote_count || 0) * (f.vote_average || 0) + PRIOR_VOTES * PRIOR_SCORE)
                 / ((f.vote_count || 0) + PRIOR_VOTES);

const byId = new Map(); const already = [];
for (const f of pool) {
  const t = f.title, rd = f.release_date || '';
  if (!t || !rd || rd > TODAY) continue;
  if ((f.vote_count || 0) < MIN_VOTES) continue;
  if ((f.genre_ids || []).indexOf(10770) > -1) continue;
  if (JUNK.test(t)) continue;
  if (SEEN_IDS.has(String(f.id)) || SEEN_TITLES.has(t.trim().toLowerCase())) { already.push(t); continue; }
  if (!byId.has(f.id)) byId.set(f.id, f);
}
const picks = [...byId.values()].sort((a, b) => score(b) - score(a)).slice(0, TOP_N);

console.log('');
console.log(NAME + ' as ' + ROLE + ': ' + pool.length + ' credits, '
  + already.length + ' already in the library, ' + picks.length + ' to queue');
if (already.length) console.log('  already here: ' + [...new Set(already)].join(', '));

/* availability, region CR, dated or not claimed */
const prov = {};
for (const f of picks) {
  const w = await api('https://api.themoviedb.org/3/movie/' + f.id + '/watch/providers');
  const cr = w && w.results && w.results[REGION];
  let label = '';
  if (cr) {
    const names = a => (a || []).map(x => x.provider_name);
    const flat = names(cr.flatrate).concat(names(cr.free || []));
    if (flat.length) label = [...new Set(flat)].slice(0, 3).join(', ');
    else {
      const rb = names(cr.rent).concat(names(cr.buy || []));
      if (rb.length) label = 'Rent: ' + [...new Set(rb)].slice(0, 3).join(', ');
    }
  }
  prov[f.id] = label;
}

console.log('');
picks.forEach((f, i) => console.log('  ' + String(i + 1).padStart(2) + '. '
  + f.title + ' (' + (f.release_date || '').slice(0, 4) + ')  '
  + (f.vote_average || 0).toFixed(1) + '/' + (f.vote_count || 0) + '  ['
  + (prov[f.id] || 'nothing in ' + REGION) + ']'));

if (!WRITE) {
  console.log('');
  console.log('preview only. add --write to put these on the Watchlist. ' + calls + ' TMDB calls.');
  process.exit(0);
}

for (const f of picks) {
  const r = head.map(() => '');
  r[at('Title')]   = f.title;
  r[at('Year')]    = (f.release_date || '').slice(0, 4);
  r[at('Genre')]   = 'Unsorted';
  r[at('Context')] = 'Queue';
  r[at('Status')]  = 'Watchlist';
  r[at('Lane')]    = 'Unsorted';
  r[at('TMDB ID')] = String(f.id);
  if (prov[f.id]) { r[at('Streaming')] = prov[f.id]; r[at('Streaming Checked')] = TODAY; }
  r[at('Note')] = 'Queued ' + TODAY + ' from ' + NAME + ' as ' + ROLE
    + ', ranked by the same credibility-weighted score Our People uses. Not seen as far as the '
    + 'library knows: Chris asked for these so he could recognise the ones he has already watched.';
  rows.push(r);
}
fs.writeFileSync(LIB, '﻿' + head.map(esc).join(',') + '\n'
  + rows.map(r => head.map((_, i) => esc(r[i])).join(',')).join('\n') + '\n', 'utf8');
console.log('');
console.log('wrote ' + picks.length + ' Watchlist rows. Library is now ' + rows.length
  + ' rows. ' + calls + ' TMDB calls.');
console.log('Next: node enrich-by-id.mjs && node certs.mjs && node credits.mjs && node discover.mjs && node build.mjs');
console.log('  (enrich-by-id, not enrich: these rows already carry a TMDB id, which enrich reads as done.)');
