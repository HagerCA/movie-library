#!/usr/bin/env node
/**
 * Fill detail, Costa Rica availability and a poster for rows that ALREADY have
 * a verified TMDB id but no poster yet.
 *
 * Why this exists: enrich.mjs in "missing" mode treats a row with a TMDB id as
 * done, because normally the id arrives with the details. The Netflix import on
 * 2026-10-04 arrived the other way round: the id was the proof the title was a
 * film at all, written before any detail was fetched. This pass closes that gap
 * without re-enriching the whole library.
 *
 * Output format matches enrich.mjs exactly, including the "Rent: " prefix.
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
const H = { Authorization: 'Bearer ' + env.TMDB_READ_TOKEN, accept: 'application/json' };
const REGION = env.TMDB_REGION || 'CR';
const today = new Date().toISOString().slice(0, 10);

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

const CSV = path.join(DIR, 'movie-library.csv');
const rows = parseCSV(fs.readFileSync(CSV, 'utf8'));
const HEAD = rows.shift().map(h => h.trim());
const col = n => HEAD.findIndex(h => h.toLowerCase() === n.toLowerCase());
const g = (r, c) => (r[col(c)] || '').trim();

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

const todo = rows.filter(r => g(r, 'TMDB ID') && !g(r, 'Poster') && g(r, 'Status') !== 'Dropped');
console.log(todo.length + ' rows have a verified id but no detail yet | region ' + REGION);

let calls = 0, ok = 0, failed = [], streaming = 0, posters = 0;
for (let i = 0; i < todo.length; i++) {
  const r = todo[i];
  const id = g(r, 'TMDB ID');
  const res = await fetch('https://api.themoviedb.org/3/movie/' + id + '?append_to_response=watch/providers', { headers: H });
  calls++;
  if (res.status === 429) { await new Promise(s => setTimeout(s, 2500)); i--; continue; }
  const d = await res.json();
  if (!d || !d.id) { failed.push(g(r, 'Title')); continue; }
  if (d.runtime) r[col('Runtime')] = String(d.runtime);
  if (d.overview && !g(r, 'Overview')) r[col('Overview')] = d.overview;
  if (d.release_date && !g(r, 'Year')) r[col('Year')] = d.release_date.slice(0, 4);
  const sv = providers(d['watch/providers']);
  r[col('Streaming')] = sv;
  r[col('Streaming Checked')] = today;
  if (sv) streaming++;
  const img = await poster(d.poster_path, d.id);
  if (img) { r[col('Poster')] = img; posters++; }
  ok++;
  if (ok % 60 === 0) console.log('  ... ' + ok + '/' + todo.length);
}

const body = rows.map(r => HEAD.map((_, i) => esc(r[i])).join(',')).join('\n');
const out = '﻿' + HEAD.map(esc).join(',') + '\n' + body + '\n';
const lines = out.split('\n').length - 1;
if (lines < rows.length) { console.error('COLLAPSED WRITE, aborting'); process.exit(1); }
fs.writeFileSync(CSV, out, 'utf8');
console.log('\nwrote movie-library.csv: ' + lines + ' lines for ' + rows.length + ' rows');
console.log('API calls ' + calls + ' | enriched ' + ok + ' | posters ' + posters + ' | streaming somewhere in CR ' + streaming);
if (failed.length) console.log('detail fetch failed: ' + failed.length + ' (' + failed.slice(0, 8).join(', ') + ')');
