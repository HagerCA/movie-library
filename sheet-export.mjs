#!/usr/bin/env node
/**
 * Build the sheet-shaped export of movie-library.csv.
 *
 * Why this exists: the Google Sheet is the family front end and carries only the
 * human columns, in its own order. The canonical CSV carries machine columns too
 * (TMDB ID, Poster, Overview, Flag) which the sheet has never had. Pushing the
 * canonical file straight up would add four columns Pixie did not ask for and
 * would shift every column she is used to.
 *
 * Dropped rows are excluded, same as every other view and upload.
 * No BOM: Drive's CSV conversion puts a literal  on the first header otherwise.
 *
 * Output goes to the workspace connector's attachments folder, which is the only
 * path update_drive_file will read from.
 */
import fs from 'node:fs';
import path from 'node:path';

const SHEET_COLS = ['Title','Year','Genre','Chris','Pixie','Context','Status','Lane',
  'Cert','Runtime','Streaming','Streaming Checked','Chris Says','Pixie Says','Boys Say','Note'];
const OUT = process.argv[2] ||
  'C:/Users/chris/.workspace-mcp/attachments/hager-movie-library.csv';

function parse(t){t=t.replace(/^\uFEFF/,'');const rows=[];let f='',row=[],q=false;
 for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
  else{if(c==='"')q=true;else if(c===','){row.push(f);f=''}
   else if(c==='\n'){row.push(f);rows.push(row);row=[];f=''}
   else if(c==='\r'){}else f+=c}}
 if(f!==''||row.length){row.push(f);rows.push(row)}return rows}
const esc=v=>/[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;

const rows=parse(fs.readFileSync('movie-library.csv','utf8'));
const hdr=rows[0];
for(const c of SHEET_COLS) if(hdr.indexOf(c)<0) throw new Error('canonical CSV is missing column: '+c);
const body=rows.slice(1).filter(r=>r.length>1&&r[0].trim());
const si=hdr.indexOf('Status');
const live=body.filter(r=>(r[si]||'').trim()!=='Dropped');

const out=[SHEET_COLS.map(esc).join(',')];
for(const r of live) out.push(SHEET_COLS.map(c=>esc((r[hdr.indexOf(c)]||'').replace(/\r?\n/g,' ').trim())).join(','));
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,out.join('\n')+'\n','utf8');

const bytes=fs.statSync(OUT).size;
console.log('wrote '+OUT);
console.log('  data rows '+live.length+' (excluded '+(body.length-live.length)+' Dropped) | columns '+SHEET_COLS.length+' | '+bytes+' bytes');
console.log('  first byte is BOM: '+(fs.readFileSync(OUT)[0]===0xEF));
const longest=live.reduce((m,r)=>Math.max(m,(r[hdr.indexOf('Note')]||'').length),0);
console.log('  longest Note cell: '+longest+' chars (Sheets cell limit is 50000)');
