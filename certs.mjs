#!/usr/bin/env node
/**
 * Pull the real age certificate for every film that has a TMDB id and write
 * it into the Cert column. US certification, because it is the one TMDB has
 * for almost everything and the one Chris recognises (G, PG, PG-13, R).
 *
 * Why this exists: the app needs to answer "is this safe for Hudson and
 * Hendrix" and "is this an adults-only pick". Guessing that from genre and
 * lane leaked Turbo and The Secret Life of Pets 2 into an adults-only filter
 * on 2026-10-04. A certificate is a fact; a lane is a label somebody typed.
 *
 * Caches per film id in certs-cache.json, so a rerun only fetches what is new.
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
let head = rows.shift().map(h => h.trim());
if (head.indexOf('Cert') === -1) {
  head.push('Cert');
  rows.forEach(r => { while (r.length < head.length) r.push(''); });
  console.log('added the Cert column');
}
const at = n => head.findIndex(h => h.toLowerCase() === n.toLowerCase());

const CACHE = path.join(DIR, 'certs-cache.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const todo = rows.filter(r => (r[at('TMDB ID')] || '').trim() &&
  !(r[at('Cert')] || '').trim() &&
  (r[at('Status')] || '').trim() !== 'Dropped');
console.log(todo.length + ' films need a certificate');

let calls = 0, found = 0, blank = 0;
for (let i = 0; i < todo.length; i++) {
  const r = todo[i];
  const id = r[at('TMDB ID')].trim();
  let cert = cache[id];
  if (cert === undefined) {
    const res = await fetch('https://api.themoviedb.org/3/movie/' + id + '/release_dates', { headers: H });
    calls++;
    if (res.status === 429) { await new Promise(s => setTimeout(s, 2000)); i--; continue; }
    const j = await res.json();
    const us = (j.results || []).find(x => x.iso_3166_1 === 'US');
    const rel = us ? (us.release_dates || []).find(d => (d.certification || '').trim()) : null;
    cert = rel ? rel.certification.trim() : '';
    cache[id] = cert;
    if (calls % 60 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); console.log('  ... ' + (i+1) + '/' + todo.length); }
  }
  r[at('Cert')] = cert;
  if (cert) found++; else blank++;
}
fs.writeFileSync(CACHE, JSON.stringify(cache));

const body = rows.map(r => head.map((_, i) => esc(r[i])).join(',')).join('\n');
const out = '﻿' + head.map(esc).join(',') + '\n' + body + '\n';
const lines = out.split('\n').length - 1;
if (lines < rows.length) { console.error('COLLAPSED WRITE, aborting'); process.exit(1); }
fs.writeFileSync(CSV, out, 'utf8');

const tally = {};
rows.forEach(r => { if ((r[at('Status')]||'').trim()==='Dropped') return;
  const c = (r[at('Cert')] || '').trim() || '(none)'; tally[c] = (tally[c] || 0) + 1; });
console.log('\nwrote movie-library.csv: ' + lines + ' lines for ' + rows.length + ' rows');
console.log('API calls ' + calls + ' | certificates found ' + found + ' | blank ' + blank);
console.log('\ncertificate spread:');
Object.entries(tally).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('  ' + k.padEnd(8) + v));
