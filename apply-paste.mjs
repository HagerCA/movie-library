#!/usr/bin/env node
/**
 * Apply a "MOVIE LIBRARY CHANGES" paste from the app.
 *
 *   node apply-paste.mjs paste.txt
 *   cat paste.txt | node apply-paste.mjs
 *
 * Line format, one film each, fields separated by " | ":
 *   Title | Chris 4.5 | Pixie 4.2 | Rated | watched with Date Night | interest yes
 *   NEW FILM | Title | 2019 | Chris 4.5 | watched with Family
 *
 * Where each thing lands:
 *   - ratings           -> movie-library.csv
 *   - interest yes/no   -> upcoming.csv
 *   - a rated film that lives in upcoming.csv or suggestions.csv moves into the
 *     library and is retired from where it was, because a rating means watched
 *   - NEW FILM          -> a new library row, to be enriched by enrich.mjs
 *
 * Idempotent. Re-running the same paste changes nothing further.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
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
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
const norm = s => String(s).toLowerCase().replace(/^(the|a|an)\s+/, '')
  .replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');

function load(file) {
  const rows = parseCSV(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const head = rows.shift().map(h => h.trim());
  const ix = {}; head.forEach((h, i) => ix[h.toLowerCase()] = i);
  return { rows, head, ix, at: n => ix[n.toLowerCase()] };
}
function save(file, t) {
  fs.writeFileSync(path.join(DIR, file), '﻿' + t.head.map(esc).join(',') + '\n' +
    t.rows.map(r => t.head.map((_, i) => esc(r[i])).join(',')).join('\n') + '\n', 'utf8');
}

const lib = load('movie-library.csv');
const up  = fs.existsSync(path.join(DIR, 'upcoming.csv')) ? load('upcoming.csv') : null;
const sug = fs.existsSync(path.join(DIR, 'suggestions.csv')) ? load('suggestions.csv') : null;

const file = process.argv[2];
const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
const lines = text.split('\n').map(l => l.trim())
  .filter(l => l && !/^MOVIE LIBRARY CHANGES/i.test(l));

const stat = { rating: 0, interest: 0, fromUpcoming: 0, fromSuggest: 0, added: 0, unchanged: 0 };
const notFound = [], promoted = [], scorecard = [];

function newRow(title, year) {
  const r = lib.head.map(() => '');
  r[lib.at('Title')] = title;
  if (year) r[lib.at('Year')] = String(year);
  r[lib.at('Genre')] = 'Unsorted';
  r[lib.at('Context')] = 'Household';
  r[lib.at('Status')] = 'Rated';
  r[lib.at('Lane')] = 'Unsorted';
  return r;
}

for (const line of lines) {
  const bits = line.split('|').map(x => x.trim()).filter(Boolean);
  if (!bits.length) continue;

  let isNew = false;
  if (/^NEW FILM$/i.test(bits[0])) { isNew = true; bits.shift(); }
  const title = bits.shift();
  if (!title) continue;

  let chris = null, pixie = null, status = null, context = null, interest = null, year = null;
  const says = {};
  for (const b of bits) {
    let m;
    if ((m = b.match(/^Chris\s+([\d.]+)$/i)))           chris = m[1];
    else if ((m = b.match(/^Pixie\s+([\d.]+)$/i)))      pixie = m[1];
    else if ((m = b.match(/^interest\s+(yes|no|maybe)$/i))) interest = m[1].toLowerCase();
    else if ((m = b.match(/^watched with\s+(.+)$/i)))   context = m[1];
    else if ((m = b.match(/^Chris says:\s*(.+)$/i)))    says.chris = m[1];
    else if ((m = b.match(/^Pixie says:\s*(.+)$/i)))    says.pixie = m[1];
    else if ((m = b.match(/^Boys say:\s*(.+)$/i)))      says.boys = m[1];
    else if (/^(Rated|Watchlist|Not for us|Not watching|Dropped|Owned, unwatched)$/i.test(b)) status = b;
    else if (/^(19|20)\d\d$/.test(b))                   year = b;
  }

  const uRow = up  && up.rows.find(r  => norm(r[up.at('Title')])  === norm(title));
  const sRow = sug && sug.rows.find(r => norm(r[sug.at('Title')]) === norm(title));
  let lRow   = lib.rows.find(r => norm(r[lib.at('Title')]) === norm(title));

  if (interest && uRow) {
    if ((uRow[up.at('Interest')] || '') !== interest) { uRow[up.at('Interest')] = interest; stat.interest++; }
    else stat.unchanged++;
  }

  const rated = chris || pixie;

  /* Not in the library yet. Pull its data across from wherever it was.
   *
   * This used to read `if (!lRow && rated)`, which meant a NEW FILM line with no
   * rating on it fell straight through to notFound and was silently discarded,
   * even though the header of this file promises NEW FILM creates a row. The
   * Queue and Pass buttons in Our People emit exactly that shape, so every one
   * of them would have been thrown away. Found by running a real button click
   * through this tool on 2026-10-04 rather than assuming it worked.
   *
   * The Suggests and Coming Soon branches stay gated on `rated`, because both of
   * them write "and was watched" into the Note, which is only true of a rating. */
  if (!lRow && (rated || isNew)) {
    if (sRow && rated) {
      lRow = newRow(sRow[sug.at('Title')], sRow[sug.at('Year')]);
      for (const [from, to] of [['Streaming','Streaming'],['Streaming Checked','Streaming Checked'],
                                ['TMDB ID','TMDB ID'],['Poster','Poster'],['Runtime','Runtime'],['Overview','Overview']])
        if (sug.at(from) !== undefined) lRow[lib.at(to)] = sRow[sug.at(from)];
      const who = sRow[sug.at('For')] || '';
      lRow[lib.at('Context')] = who === 'The Boys' ? 'Family' : who === 'Whole Family' ? 'Family'
                              : who === 'Chris' ? 'Solo' : 'Date Night';
      lRow[lib.at('Note')] = 'Came from SAGE Suggests and was watched. Rated ' + today + '.';
      sRow[sug.at('Status')] = 'Watched, moved to the library';
      lib.rows.push(lRow); stat.fromSuggest++; stat.added++;
      scorecard.push({ t: title, who, r: Number(chris || pixie) });
    } else if (uRow && rated) {
      lRow = newRow(uRow[up.at('Title')], uRow[up.at('Year')]);
      for (const f of ['Streaming','Streaming Checked','TMDB ID','Poster','Runtime','Overview'])
        if (up.at(f) !== undefined) lRow[lib.at(f)] = uRow[up.at(f)];
      lRow[lib.at('Context')] = 'Family';
      lRow[lib.at('Note')] = 'Tracked in Coming Soon, then watched. Rated ' + today + '.';
      uRow[up.at('Status')] = 'Watched, moved to the library';
      if (interest) uRow[up.at('Interest')] = interest;
      lib.rows.push(lRow); stat.fromUpcoming++; stat.added++;
      promoted.push(title);
    } else if (isNew) {
      lRow = newRow(title, year);
      if (uRow) for (const f of ['Streaming','Streaming Checked','TMDB ID','Poster','Runtime','Overview'])
        if (up.at(f) !== undefined) lRow[lib.at(f)] = uRow[up.at(f)];
      lRow[lib.at('Note')] = 'Added from the app ' + today +
        (rated ? '. ' : ', unrated. ') + 'Needs genre, lane and a TMDB pass.';
      if (!rated) lRow[lib.at('Flag')] = ''; else lRow[lib.at('Flag')] = 'carry';
      lib.rows.push(lRow); stat.added++;
    } else {
      notFound.push(title); continue;
    }
  }

  if (!lRow) { if (rated || status || context) notFound.push(title); continue; }

  let changed = false;
  const set = (col, val) => {
    if (val == null) return;
    if ((lRow[lib.at(col)] || '').trim() === String(val)) return;
    lRow[lib.at(col)] = String(val); changed = true;
  };
  set('Chris', chris); set('Pixie', pixie); set('Context', context);
  if (says.chris) set('Chris Says', says.chris);
  if (says.pixie) set('Pixie Says', says.pixie);
  if (says.boys)  set('Boys Say', says.boys);
  if (chris && !(lRow[lib.at('Pixie')] || '').trim()) set('Pixie', chris);
  /* "Not for us" is what the app's buttons and the older pastes say; the schema's
   * word is "Not watching", so normalise rather than inventing a tenth status.
   * Dropped used to fall through here unrecognised, which made a Dropped line
   * report itself as "already applied" while changing nothing. */
  const S = status ? String(status) : '';
  if (/^Dropped$/i.test(S)) set('Status', 'Dropped');
  else if (/^(Not for us|Not watching)$/i.test(S)) set('Status', 'Not watching');
  else if (rated || /^Rated$/i.test(S)) set('Status', 'Rated');
  else if (/^Owned, unwatched$/i.test(S)) set('Status', 'Owned, unwatched');
  else if (/^Watchlist$/i.test(S) && !(lRow[lib.at('Chris')] || '').trim()) set('Status', 'Watchlist');

  if (changed) stat.rating++; else stat.unchanged++;
}

save('movie-library.csv', lib);
if (up)  save('upcoming.csv', up);
if (sug) save('suggestions.csv', sug);

console.log('ratings and edits applied: ' + stat.rating);
console.log('interest answers recorded:  ' + stat.interest);
console.log('new library rows:           ' + stat.added +
  '  (from Suggests ' + stat.fromSuggest + ', from Coming Soon ' + stat.fromUpcoming + ')');
console.log('lines already applied:      ' + stat.unchanged);
if (promoted.length) console.log('moved out of Coming Soon: ' + promoted.join(', '));
if (notFound.length) console.log('\nNOT FOUND anywhere, needs a decision:\n  ' + notFound.join('\n  '));

if (scorecard.length) {
  console.log('\n=== scorecard on SAGE Suggests ===');
  scorecard.sort((a, b) => b.r - a.r).forEach(s =>
    console.log('  ' + s.r.toFixed(1) + '  ' + s.t + '  [' + s.who + ']'));
  const hits = scorecard.filter(s => s.r >= 4).length;
  const avg = scorecard.reduce((a, s) => a + s.r, 0) / scorecard.length;
  console.log('  ' + hits + ' of ' + scorecard.length + ' cleared the 4.0 rewatch line. Average ' + avg.toFixed(2) + '.');
}
