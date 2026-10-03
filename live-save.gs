/**
 * The Hager Movie Library — live save endpoint.
 *
 * Paste this into the Apps Script editor attached to the Google Sheet, deploy
 * it as a Web App, and the movie library app writes ratings straight into the
 * sheet instead of waiting for a copy and paste.
 *
 * ── HOW TO INSTALL ──────────────────────────────────────────────────────────
 *
 *  1. Open the sheet:
 *     https://docs.google.com/spreadsheets/d/1e674RDkgyo-fFGIGNHFtB36qLg81BihjSuBuNIsfe58/edit
 *  2. Extensions → Apps Script. A code editor opens in a new tab.
 *  3. Select everything in Code.gs and replace it with this entire file.
 *  4. Save (the disk icon).
 *  5. Deploy → New deployment.
 *       - click the gear next to "Select type", choose **Web app**
 *       - Description: movie library live save
 *       - Execute as: **Me**
 *       - Who has access: **Anyone**            <-- this one matters
 *     Deploy.
 *  6. It asks for authorization the first time. Google shows a scary
 *     "Google hasn't verified this app" screen because you wrote it yourself
 *     and never submitted it for review. Click Advanced, then
 *     "Go to ... (unsafe)", then Allow. You are granting your own script
 *     access to your own sheet.
 *  7. Copy the Web app URL. It looks like
 *     https://script.google.com/macros/s/AKfy..../exec
 *  8. Send that URL to SAGE. One line goes into app.js and saving is live.
 *
 * ── WHAT "ANYONE" MEANS, PLAINLY ────────────────────────────────────────────
 *
 * The URL is unguessable but it is not secret, and it is embedded in a public
 * page. Anyone who found it could write a row to this sheet. For a family
 * movie list that is an acceptable trade. The guards below make it a poor
 * target: it only ever touches this one sheet, it only writes the handful of
 * columns listed in ALLOWED, it never deletes a row, and it never adds a film
 * that is not already in the library unless the payload explicitly says so.
 *
 * If that ever stops feeling fine, set SHARED_SECRET below to any phrase, tell
 * SAGE, and the app will send it with every request. Anything without it is
 * refused.
 */

var SHEET_ID = '1e674RDkgyo-fFGIGNHFtB36qLg81BihjSuBuNIsfe58';
var SHARED_SECRET = '';   // optional. set a phrase here and tell SAGE.

// The only columns this endpoint may ever write.
var ALLOWED = {
  chris: 'Chris',
  pixie: 'Pixie',
  context: 'Context',
  status: 'Status',
  chrisSays: 'Chris Says',
  pixieSays: 'Pixie Says',
  boysSay: 'Boys Say'
};

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return out({ ok: false, error: 'bad secret' });
    }
    var title = (body.title || '').toString().trim();
    if (!title) return out({ ok: false, error: 'no title' });

    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    var values = sheet.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).trim(); });

    var col = {};
    head.forEach(function (h, i) { col[h] = i; });

    var want = norm(title);
    var rowIndex = -1;
    for (var r = 1; r < values.length; r++) {
      if (norm(values[r][col['Title']]) === want) { rowIndex = r; break; }
    }

    // A film nobody has logged yet. Only create one if the app said so.
    if (rowIndex === -1) {
      if (!body.isNew) return out({ ok: false, error: 'not in the library: ' + title });
      var fresh = new Array(head.length).fill('');
      fresh[col['Title']] = title;
      if (body.year && col['Year'] !== undefined) fresh[col['Year']] = body.year;
      if (col['Note'] !== undefined) {
        fresh[col['Note']] = 'Added from the app ' +
          Utilities.formatDate(new Date(), 'America/Costa_Rica', 'yyyy-MM-dd') +
          '. Needs genre, lane and a TMDB pass.';
      }
      sheet.appendRow(fresh);
      rowIndex = sheet.getLastRow() - 1;
      values = sheet.getDataRange().getValues();
    }

    var written = [];
    Object.keys(ALLOWED).forEach(function (k) {
      if (body[k] === undefined || body[k] === null || body[k] === '') return;
      var name = ALLOWED[k];
      if (col[name] === undefined) return;
      sheet.getRange(rowIndex + 1, col[name] + 1).setValue(body[k]);
      written.push(name);
    });

    // A rating means it has been watched.
    if ((body.chris || body.pixie) && col['Status'] !== undefined && !body.status) {
      sheet.getRange(rowIndex + 1, col['Status'] + 1).setValue('Rated');
      written.push('Status');
    }

    if (!written.length) return out({ ok: false, error: 'nothing to write' });
    return out({ ok: true, title: title, row: rowIndex + 1, wrote: written });

  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

// A GET so you can paste the URL into a browser and see that it is alive.
function doGet() {
  return out({ ok: true, service: 'Hager Movie Library live save', ready: true });
}

function norm(s) {
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
