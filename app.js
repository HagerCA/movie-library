/* The Hager Movie Library — app logic.
 *
 * SOURCE FILE. Hand-written, committed, and never generated. build.mjs only
 * writes index.html (the shell plus the inlined data) and leaves this alone,
 * so it is safe to edit directly.
 *
 * DATA, SUGG and UPCOMING are inlined into index.html by the build, so this
 * page makes no network request of any kind and works offline.
 *
 * Edits are held in localStorage and handed back to SAGE as text. This is a
 * staging basket, not a live database: nothing on GitHub Pages can accept a
 * write, so "Copy for SAGE" is the save button.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
   * WHAT THE HAGERS ACTUALLY PAY FOR. Edit this one line when that changes.
   * Chris, 2026-10-03: "we have Disney+, Amazon Prime, Netflix, and Apple TV.
   * We do not have anything else."
   * ---------------------------------------------------------------------- */
  var SUBSCRIPTIONS = ['Netflix', 'Amazon Prime Video', 'Disney Plus', 'Apple TV', 'Apple TV+'];

  /* Amazon "Channels" are paid add-ons sold on top of Prime, not included with
   * it. Universal+ alone covers 57 films in this library, and every one of them
   * looks like Amazon while being something they would have to buy. Treating
   * those as owned would be the single most misleading thing this app could do. */
  var ADDON = /Amazon Channel$/i;

  /* ------------------------------------------------------------------------
   * LIVE SAVING. Paste the Apps Script web app URL here and every change
   * writes straight to the Google Sheet instead of waiting for a copy-paste.
   * Empty means the copy-for-SAGE loop stays, which always works.
   * ---------------------------------------------------------------------- */
  var SAVE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzDtZVfIDXuo9SVlUiLRq-n6k9dQ7rgc7BVqP5STeP89YNJsfzGV61zG8ZqpGTEbBAo/exec';

  var APP_URL = 'https://hagerca.github.io/movie-library/';
  var LS = 'hager-movie-pending-v1';
  var pending = {};
  try { pending = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { pending = {}; }

  /* The basket used to sit at "35 changes" forever because copying them to SAGE
   * did not clear them, and there was no way for the page to know they had
   * landed. It knows now: every time this page loads it is carrying freshly
   * built data, so any pending change the library already agrees with has made
   * the round trip and gets dropped. Paste, wait for the rebuild, refresh, and
   * the counter empties itself. */
  function reconcile() {
    var lib = {}, up = {};
    DATA.forEach(function (d) { lib[d.t.toLowerCase()] = d; });
    if (typeof UPCOMING !== 'undefined')
      UPCOMING.forEach(function (u) { up[u.t.toLowerCase()] = u; });

    var dropped = 0;
    Object.keys(pending).forEach(function (k) {
      var p = pending[k];
      var d = lib[(p.title || k).toLowerCase()];
      var u = up[(p.title || k).toLowerCase()];
      var landed = true;

      // A film added by hand has landed once it exists in the library at all.
      if (p.isNew) { if (!d) landed = false; }
      else if (!d && !u) landed = false;

      var same = function (mine, theirs) {
        if (mine === undefined || mine === '') return true;
        if (theirs === null || theirs === undefined) return false;
        return String(mine) === String(theirs);
      };
      if (landed && d) {
        if (!same(p.chris, d.c)) landed = false;
        if (!same(p.pixie, d.p)) landed = false;
        if (p.context && d.w !== p.context) landed = false;
        if (p.chrisSays && d.cs !== p.chrisSays) landed = false;
        if (p.pixieSays && d.ps !== p.pixieSays) landed = false;
        if (p.boysSay && d.bs !== p.boysSay) landed = false;
      }
      if (landed && p.interest) {
        // An interest answer has landed if the tracker agrees, or if the film
        // has since moved into the library, which retires the question.
        if (!(u && u.interest === p.interest) && !d) landed = false;
      }
      if (landed) { delete pending[k]; dropped++; }
    });
    if (dropped) localStorage.setItem(LS, JSON.stringify(pending));
    return dropped;
  }
  var reconciled = reconcile();

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var num = function (v) { return v === null || v === undefined || v === '' ? null : Number(v).toFixed(1); };
  var $ = function (id) { return document.getElementById(id); };

  /* Green: on something they pay for. Amber: rentable. Red: needs a service
   * they do not have. Grey: not available in Costa Rica at all. */
  function classify(sv) {
    if (!sv) return { k: 'none', cls: 'swNone', label: 'Not available in Costa Rica', short: 'not here' };
    if (/^(Rent|Buy):/i.test(sv)) {
      return { k: 'rent', cls: 'swRent', label: sv.replace(/^Rent: /, 'Rent from '),
               short: 'rent' };
    }
    var all = sv.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var mine = all.filter(function (x) { return SUBSCRIPTIONS.indexOf(x) > -1; });
    if (mine.length) {
      return { k: 'have', cls: 'swHave', label: mine.join(', '), short: mine[0],
               note: 'You pay for this already.' };
    }
    var addons = all.filter(function (x) { return ADDON.test(x); });
    return {
      k: 'need', cls: 'swNeed',
      label: all.join(' or '),
      short: all[0],
      note: addons.length
        ? 'These are paid Amazon add-ons, not included with Prime.'
        : 'You do not have this service.'
    };
  }

  /* A stable colour per title, so a film with no poster still looks deliberate. */
  function hue(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360; return h; }
  function art(d) {
    if (d.img) return '<img src="' + esc(d.img) + '" alt="" loading="lazy">';
    var h = hue(d.t);
    return '<div class="phbg" style="background:linear-gradient(155deg,hsl(' + h +
      ' 42% 26%),hsl(' + ((h + 42) % 360) + ' 38% 13%))"></div><div class="ph">' + esc(d.t) + '</div>';
  }

  /* ---------------------------------------------------------- pending edits */

  function key(title) { return title; }
  function edit(title, patch) {
    var k = key(title);
    pending[k] = Object.assign({ title: title }, pending[k] || {}, patch);
    localStorage.setItem(LS, JSON.stringify(pending));
    paintBasket();
    push(pending[k]);
  }

  /* With an endpoint configured, each change goes straight to the sheet. It
   * stays in the basket until the next build confirms it, so a failed request
   * never silently loses an edit: worst case it is still there to copy. */
  function push(change) {
    if (!SAVE_ENDPOINT) return;
    var bar = $('savestate');
    if (bar) { bar.hidden = false; bar.className = 'savestate saving'; bar.textContent = 'Saving...'; }
    fetch(SAVE_ENDPOINT, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(change)
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (bar) {
        bar.className = 'savestate ' + (j && j.ok ? 'saved' : 'failed');
        bar.textContent = j && j.ok ? 'Saved to the sheet' : 'Could not save, it is still in Review';
        setTimeout(function () { bar.hidden = true; }, 2600);
      }
    }).catch(function () {
      if (bar) {
        bar.className = 'savestate failed';
        bar.textContent = 'Offline. Change kept in Review.';
        setTimeout(function () { bar.hidden = true; }, 2600);
      }
    });
  }
  function pendingFor(title) { return pending[key(title)] || null; }
  function countPending() { return Object.keys(pending).length; }

  function paintBasket() {
    var n = countPending();
    var bar = $('basket');
    if (!n) {
      if (reconciled) {
        bar.hidden = false;
        bar.className = 'basket done';
        bar.innerHTML = '<span class="bcount">\u2713</span><span class="btext">' + reconciled +
          ' change' + (reconciled === 1 ? '' : 's') + ' saved and live </span>' +
          '<button class="bbtn" id="bdismiss">Nice</button>';
        $('bdismiss').addEventListener('click', function () { reconciled = 0; paintBasket(); });
      } else bar.hidden = true;
      return;
    }
    bar.className = 'basket';
    bar.hidden = false;
    bar.innerHTML = '<span class="bcount">' + n + '</span>' +
      '<span class="btext">' + (n === 1 ? 'change' : 'changes') + ' not saved yet </span>' +
      '<button class="bbtn" id="bopen">Review</button>';
    $('bopen').addEventListener('click', openBasket);
  }

  /* The format SAGE parses. Readable to a human, trivial to apply. */
  function basketText() {
    var lines = ['MOVIE LIBRARY CHANGES ' + new Date().toISOString().slice(0, 10)];
    Object.keys(pending).forEach(function (k) {
      var p = pending[k], bits = [];
      if (p.isNew) bits.push('NEW FILM');
      bits.push(p.title);
      if (p.year) bits.push(p.year);
      if (p.chris !== undefined && p.chris !== '') bits.push('Chris ' + p.chris);
      if (p.pixie !== undefined && p.pixie !== '') bits.push('Pixie ' + p.pixie);
      if (p.status) bits.push(p.status);
      if (p.context) bits.push('watched with ' + p.context);
      if (p.interest) bits.push('interest ' + p.interest);
      if (p.chrisSays) bits.push('Chris says: ' + p.chrisSays);
      if (p.pixieSays) bits.push('Pixie says: ' + p.pixieSays);
      if (p.boysSay) bits.push('Boys say: ' + p.boysSay);
      lines.push(bits.join(' | '));
    });
    return lines.join('\n');
  }

  function openBasket() {
    var txt = basketText();
    sheetEl.innerHTML =
      '<div class="hd"><button class="x" id="closeX" aria-label="Close">&times;</button>' +
      '<h2 id="sheetTitle">' + countPending() + ' unsaved ' + (countPending() === 1 ? 'change' : 'changes') + '</h2>' +
      '<div class="yr">Nothing here has reached the library yet.</div></div>' +
      '<div class="bd">' +
      '<p class="bnote">This page is served as static files, so it cannot write to the library by itself. ' +
      'Copy these lines, paste them to SAGE in chat, and they go into the real file and get rebuilt. ' +
      'Your edits stay on this device until you do.</p>' +
      '<pre class="basketpre">' + esc(txt) + '</pre>' +
      '<div class="brow">' +
      '<button class="pbtn primary" id="copyAll">Copy for SAGE</button>' +
      '<button class="pbtn" id="dlAll">Download .txt</button>' +
      '<button class="pbtn danger" id="clearAll">Discard all</button>' +
      '</div></div>';
    showSheet();
    $('closeX').addEventListener('click', closeSheet);
    $('copyAll').addEventListener('click', function () {
      var b = this;
      navigator.clipboard.writeText(txt).then(function () {
        b.textContent = 'Copied. Now paste it to SAGE.';
        b.classList.add('done');
      }, function () {
        b.textContent = 'Could not copy. Select the text above instead.';
      });
    });
    $('dlAll').addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
      a.download = 'movie-changes-' + new Date().toISOString().slice(0, 10) + '.txt';
      a.click();
    });
    $('clearAll').addEventListener('click', function () {
      if (!confirm('Discard all ' + countPending() + ' unsaved changes? They have not reached the library.')) return;
      pending = {}; localStorage.removeItem(LS); paintBasket(); closeSheet(); render();
    });
  }

  /* -------------------------------------------------------------- the tabs */

  var TABS = [
    { k: 'all',     label: 'Everything',          fn: function () { return true; } },
    { k: 'towatch', label: 'Watch List',          fn: function (f) { return /watchlist|owned|theaters|not released/i.test(f.s); } },
    { k: 'date',    label: 'Date Night \uD83C\uDF77', fn: function (f) { return f.w === 'Date Night'; } },
    { k: 'fam',     label: 'With the Boys',       fn: function (f) { return f.w === 'Family'; } },
    { k: 'best',    label: 'The 5s',              fn: function (f) { return f.c !== null && f.c >= 4.9; } },
    { k: 'need',    label: 'Seen, Needs a Number', fn: function (f) { return f.c === null && /^seen/i.test(f.s); } },
    { k: 'xmas',    label: '\uD83C\uDF84 Christmas',  fn: function (f) { return f.l === 'Christmas'; } },
    { k: 'stream',  label: '\u2705 Watch Tonight',  fn: function (f) { return classify(f.sv).k === 'have'; } },
    { k: 'sagg',    label: '✨ SAGE Suggests', special: true },
    { k: 'soon',    label: '🎬 Coming Soon', special: true },
    { k: 'people',  label: '⭐ Our People',   special: true }
  ];
  var tab = 'all';

  var tabsEl = $('tabs');
  tabsEl.innerHTML = TABS.map(function (t) {
    return '<button class="tab" role="tab" data-k="' + t.k + '" aria-selected="' +
      (t.k === 'all') + '">' + t.label + '</button>';
  }).join('');
  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    tab = b.dataset.k;
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.tab'), function (x) {
      x.setAttribute('aria-selected', x === b);
    });
    render();
  });

  /* ------------------------------------------------------------- filtering */

  function uniq(k) {
    var s = {};
    DATA.forEach(function (d) { if (d[k]) s[d[k]] = 1; });
    return Object.keys(s).sort();
  }
  function fill(id, label, k) {
    $(id).innerHTML = '<option value="">' + label + '</option>' +
      uniq(k).map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
  }
  fill('fg', 'All genres', 'g');
  fill('fl', 'All lanes', 'l');

  var services = (function () {
    var s = {};
    DATA.forEach(function (d) {
      if (d.sv && !/^(Rent|Buy):/.test(d.sv))
        d.sv.split(',').forEach(function (x) { s[x.trim()] = 1; });
    });
    return Object.keys(s).sort();
  })();
  $('fw').innerHTML = '<option value="">Anywhere</option>' +
    '<option value="__have">\u2705 On a service we have</option>' +
    '<option value="__rent">\uD83D\uDCB3 Rent or buy</option>' +
    '<option value="__need">\u274C Service we do not have</option>' +
    '<option value="__none">Not available in Costa Rica</option>' +
    '<option disabled>\u2500\u2500 by service \u2500\u2500</option>' +
    services.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');

  function current() {
    var q = $('q').value.toLowerCase().trim();
    var g = $('fg').value, l = $('fl').value, w = $('fw').value;
    var r = $('fr').value, so = $('fs').value;
    var tf = TABS.filter(function (t) { return t.k === tab; })[0].fn;
    var list = DATA.filter(function (d) {
      return tf(d) && (!g || d.g === g) && (!l || d.l === l) &&
        (!q || (d.t + ' ' + d.l + ' ' + d.g + ' ' + d.n + ' ' + d.cs + ' ' + d.ps + ' ' + d.bs)
          .toLowerCase().indexOf(q) > -1) &&
        (!r || (r === 'u' ? d.c === null : d.c !== null && d.c >= parseFloat(r))) &&
        (!w || (w.slice(0, 2) === '__'
              ? classify(d.sv).k === w.slice(2)
              : (!!d.sv && !/^(Rent|Buy):/.test(d.sv) &&
                 d.sv.split(',').map(function (x) { return x.trim(); }).indexOf(w) > -1)));
    });
    list.sort(function (a, b) {
      if (so === 't') return a.t.localeCompare(b.t);
      if (so === 'y') return (b.y || 0) - (a.y || 0) || a.t.localeCompare(b.t);
      if (so === 'yo') return (a.y || 9999) - (b.y || 9999) || a.t.localeCompare(b.t);
      var ac = a.c === null ? -1 : a.c, bc = b.c === null ? -1 : b.c;
      return bc - ac || a.t.localeCompare(b.t);
    });
    return list;
  }

  /* ---------------------------------------------------------------- render */

  var gridEl = $('grid');

  /* ----------------------------------------------------------- Our People */

  var PEOPLE_VIEWS = [
    ['directors', 'Directors'], ['actors', 'Actors'], ['actresses', 'Actresses'],
    ['writers', 'Writers'], ['composers', 'Composers'],
    ['prolific', 'Most Appearances'], ['genres', 'Genres'], ['lanes', 'Lanes']
  ];
  var peopleView = 'directors';

  function renderPeople() {
    gridEl.className = 'sugglist';
    if (!FAVOURITES) {
      gridEl.innerHTML = '<div class="suggintro"><h2>\u2B50 Our People</h2>' +
        '<p>Not built yet. Run credits.mjs.</p></div>';
      return;
    }
    var list = FAVOURITES[peopleView] || [];
    var isPerson = ['directors','actors','actresses','writers','composers','prolific'].indexOf(peopleView) > -1;

    gridEl.innerHTML = '<div class="suggintro"><h2>\u2B50 Our People</h2>' +
      '<p>Pulled from the real cast and crew of all ' + FAVOURITES.films + ' rated films. ' +
      'Ranked by a weighted average, not a raw one: somebody with one 5.0 does not outrank ' +
      'somebody with nine films at 4.6. Your library mean is ' + FAVOURITES.mean + '.</p>' +
      '<div class="audpills">' + PEOPLE_VIEWS.map(function (v) {
        return '<button class="tab sm" data-pv="' + v[0] + '" aria-selected="' +
          (v[0] === peopleView) + '">' + v[1] + '</button>';
      }).join('') + '</div></div>' +
      '<ol class="ranklist">' + list.map(function (e, i) {
        return '<li class="rank">' +
          '<span class="rnum">' + (i + 1) + '</span>' +
          '<span class="rname">' + esc(e.name) + '</span>' +
          '<span class="rbar"><span class="rfill" style="width:' +
            Math.max(4, Math.round(((e.avg - 3) / 2) * 100)) + '%"></span></span>' +
          '<span class="ravg">' + e.avg.toFixed(2) + '</span>' +
          '<span class="rn">' + e.n + ' film' + (e.n === 1 ? '' : 's') + '</span>' +
          (e.top ? '<span class="rtop">' + esc(e.top.join(' \u00b7 ')) + '</span>' : '') +
          '</li>';
      }).join('') + '</ol>';
    $('empty').hidden = true;
    $('found').textContent = list.length + ' ' + (isPerson ? 'people' : 'categories') +
      ', ranked by weighted average';
    gridEl.querySelectorAll('[data-pv]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); peopleView = b.dataset.pv; renderPeople();
      });
    });
  }

  function render() {
    if (tab === 'sagg') return renderSuggest();
    if (tab === 'soon') return renderSoon();
    if (tab === 'people') return renderPeople();
    gridEl.className = 'grid';
    var list = current();
    gridEl.innerHTML = list.map(function (d) {
      var i = DATA.indexOf(d);
      var p = pendingFor(d.t);
      var c = p && p.chris !== undefined && p.chris !== '' ? p.chris : d.c;
      var px = p && p.pixie !== undefined && p.pixie !== '' ? p.pixie : d.p;
      var cc = c === null || c === undefined || c === '' ? '' : '<span class="chip c">' + num(c) + '</span>';
      var pp = (px !== null && px !== undefined && px !== '' && num(px) !== num(c))
        ? '<span class="chip p">' + num(px) + '</span>' : '';
      var qq = (!cc && /watchlist|owned|theaters|not released/i.test(d.s))
        ? '<span class="chip q">to watch</span>' : '';
      return '<button class="card' + (p ? ' edited' : '') + '" data-i="' + i + '">' +
        '<div class="art">' + art(d) +
        '<div class="badges"><span>' + (cc || qq) + '</span><span>' + pp + '</span></div>' +
        (p ? '<span class="editdot" title="You changed this. Not saved yet.">●</span>' : '') +
        '</div>' +
        '<div class="meta"><div class="nm">' + esc(d.t) + '</div><div class="sub">' +
        (d.y ? '<span>' + d.y + '</span><span class="dot"></span>' : '') +
        '<span>' + esc(d.g) + '</span>' +
        '<span class="dot"></span><span class="stream ' + classify(d.sv).cls + '">' +
          esc(classify(d.sv).short) + '</span>' +
        '</div></div></button>';
    }).join('');
    // Nothing matched a real search? Offer to add it rather than dead-end.
    var q = $('q').value.trim();
    var addBar = $('addbar');
    if (q.length > 1 && list.length === 0) {
      addBar.hidden = false;
      addBar.innerHTML = '<div class="addinner">' +
        '<div class="addq">No film called <b>' + esc(q) + '</b> in the library.</div>' +
        '<button class="pbtn primary" id="addNew">Add \u201c' + esc(q) + '\u201d</button></div>';
      $('addNew').addEventListener('click', function () { openAdd(q); });
    } else if (q.length > 1) {
      addBar.hidden = false;
      addBar.innerHTML = '<div class="addinner"><div class="addq">Not the film you meant?</div>' +
        '<button class="pbtn" id="addNew">Add \u201c' + esc(q) + '\u201d as a new film</button></div>';
      $('addNew').addEventListener('click', function () { openAdd(q); });
    } else {
      addBar.hidden = true;
    }

    $('empty').hidden = list.length > 0;
    var rated = list.filter(function (d) { return d.c !== null; });
    $('found').textContent = list.length + ' of ' + DATA.length + ' films' +
      (rated.length ? '  ·  ' + rated.filter(function (d) { return d.c >= 4; }).length +
        ' of them we go back to' : '');
  }

  /* ------------------------------------------------------------ add a film */
  /* The app has no network and no server, so it cannot look a film up. It
   * captures what Chris knows, and SAGE does the TMDB lookup when the paste
   * comes back. Better than making him switch to the sheet mid-film. */

  function openAdd(prefill) {
    sheetEl.innerHTML =
      '<div class="hd"><button class="x" id="closeX" aria-label="Close">&times;</button>' +
      '<h2 id="sheetTitle">Add a film</h2>' +
      '<div class="yr">Not in the library yet</div></div>' +
      '<div class="bd">' +
      '<div class="editbox">' +
        '<div class="eh">Title</div>' +
        '<input class="pnum" id="newTitle" type="text" value="' + esc(prefill || '') + '" placeholder="Exact title helps me find it">' +
        '<div class="eh">Year, if you know it</div>' +
        '<input class="pnum" id="newYear" type="number" min="1900" max="2030" placeholder="e.g. 2019">' +
        '<div class="eh">Who watched it</div>' +
        '<div class="actions" id="newCtx">' +
          '<button class="pbtn" data-c="Date Night">Date Night</button>' +
          '<button class="pbtn" data-c="Family">With the boys</button>' +
          '<button class="pbtn" data-c="Solo">On my own</button>' +
          '<button class="pbtn" data-c="Queue">Not seen yet</button>' +
        '</div>' +
        '<div class="eh">Rate it</div>' +
        ratePicker('Chris', 'nC', null) +
        ratePicker('Pixie', 'nP', null) +
        '<div class="eh">Anything to say about it</div>' +
        '<textarea class="tsay" id="newSay" rows="2" placeholder="Chris says..."></textarea>' +
        '<div class="brow"><button class="pbtn primary" id="newSave">Add to the list</button></div>' +
        '<div class="ehint" id="ehint">I will look it up on TMDB and pull the poster, runtime and ' +
        'Costa Rica streaming when you send this over.</div>' +
      '</div></div>';
    showSheet();
    $('closeX').addEventListener('click', closeSheet);

    // The quick-tap chips in this form were inert: openAdd never called
    // wireEditor, so only the typed number was ever read. Wire them to the
    // number input they sit above.
    sheetEl.querySelectorAll('.picker').forEach(function (pk) {
      var input = pk.querySelector('.pnum');
      pk.querySelectorAll('.pc').forEach(function (b) {
        b.addEventListener('click', function () {
          pk.querySelectorAll('.pc').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          input.value = b.dataset.v;
        });
      });
    });

    var ctx = null;
    $('newCtx').querySelectorAll('[data-c]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('newCtx').querySelectorAll('[data-c]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); ctx = b.dataset.c;
      });
    });
    // The pickers write straight into the pending basket, so read them back here.
    $('newSave').addEventListener('click', function () {
      var t = $('newTitle').value.trim();
      if (!t) { $('ehint').innerHTML = '<b>It needs a title.</b>'; return; }
      var patch = { title: t, isNew: true };
      var y = $('newYear').value.trim(); if (y) patch.year = y;
      if (ctx) patch.context = ctx;
      sheetEl.querySelectorAll('.picker').forEach(function (pk) {
        var v = pk.querySelector('.pnum').value.trim();
        if (!v) return;
        if (pk.dataset.who === 'Chris') patch.chris = v; else patch.pixie = v;
      });
      var say = $('newSay').value.trim(); if (say) patch.chrisSays = say;
      if (patch.chris || patch.pixie) patch.status = 'Rated';
      edit(t, patch);
      this.textContent = 'Added. Hit Review at the bottom when you are done.';
      this.classList.add('done');
      var again = document.createElement('button');
      again.className = 'pbtn'; again.textContent = 'Add another';
      again.addEventListener('click', function () { openAdd(''); });
      this.parentNode.appendChild(again);
    });
  }

  $('addNewTop').addEventListener('click', function () { openAdd(''); });

  /* --------------------------------------------------------- detail drawer */

  var sheetEl = $('sheet'), scrimEl = $('scrim');
  function showSheet() {
    sheetEl.classList.add('on'); scrimEl.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    sheetEl.classList.remove('on'); scrimEl.classList.remove('on');
    document.body.style.overflow = '';
  }
  scrimEl.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  var QUICK = [2.5, 3, 3.5, 4, 4.3, 4.5, 4.8, 5];

  /* ---------------------------------------------------------------- sharing */
  /* Everything in the drawer, as text somebody can read in WhatsApp. */
  function shareText(d, opts) {
    opts = opts || {};
    var L = [];
    L.push('\uD83C\uDFAC ' + d.t + (d.y ? ' (' + d.y + ')' : ''));
    var rate = [];
    if (d.c !== null && d.c !== undefined && d.c !== '') rate.push('Chris ' + Number(d.c).toFixed(1));
    if (d.p !== null && d.p !== undefined && d.p !== '' && d.p !== d.c) rate.push('Pixie ' + Number(d.p).toFixed(1));
    if (rate.length) L.push('\u2B50 ' + rate.join('  \u00b7  ') + ' out of 5');
    if (opts.why) L.push('');
    if (opts.why) L.push(opts.why);
    if (d.ov) { L.push(''); L.push(d.ov); }
    if (d.thread) { L.push(''); L.push('Why: ' + d.thread); }
    if (d.sv) {
      L.push('');
      L.push(/^(Rent|Buy):/.test(d.sv) ? '\uD83D\uDCB3 ' + d.sv : '\u25B6\uFE0F Streaming on ' + d.sv +
        (d.sc ? ' (Costa Rica, checked ' + d.sc + ')' : ''));
    }
    L.push('');
    // Chris, 2026-10-04: leave the URL off. The site is public and a forwarded
    // message should not be how a stranger finds it.
    L.push('\u2014 from the Hager family movie library');
    return L.join('\n');
  }

  function shareRow(d, opts) {
    return '<div class="sharerow">' +
      '<button class="pbtn primary sharebtn" data-share="1">\uD83D\uDCE4 Share this</button>' +
      '<a class="pbtn wa" target="_blank" rel="noopener" data-wa="1">WhatsApp</a>' +
      '<button class="pbtn" data-copy="1">Copy</button>' +
      '</div>';
  }

  /* Fetch the poster as a File so the share sheet can carry the image with the
   * text. Phones handle this; most desktop browsers do not, and canShare is how
   * we find out before trying. A missing poster just sends the text. */
  function posterFile(d) {
    if (!d.img) return Promise.resolve(null);
    return fetch(d.img)
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) {
        if (!b) return null;
        var name = d.t.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.jpg';
        var file = new File([b], name, { type: b.type || 'image/jpeg' });
        return (navigator.canShare && navigator.canShare({ files: [file] })) ? file : null;
      })
      .catch(function () { return null; });
  }

  function wireShare(d, opts) {
    var txt = shareText(d, opts);
    var box = sheetEl.querySelector('.sharerow');
    if (!box) return;
    var wa = box.querySelector('[data-wa]');
    if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(txt);
    var btn = box.querySelector('[data-share]');
    // The native sheet is the good path on a phone: it offers WhatsApp,
    // Messages, Mail, AirDrop, whatever they have. Desktop usually has none,
    // so fall back to the clipboard rather than showing a dead button.
    if (!navigator.share) btn.textContent = '\uD83D\uDCCB Copy to share';
    btn.addEventListener('click', function () {
      if (navigator.share) {
        var label = btn.textContent;
        btn.textContent = 'Getting the poster...';
        posterFile(d).then(function (file) {
          var payload = { title: d.t, text: txt };
          if (file) payload.files = [file];
          btn.textContent = label;
          return navigator.share(payload);
        }).catch(function () { btn.textContent = label; });
      } else {
        navigator.clipboard.writeText(txt).then(function () {
          btn.textContent = 'Copied. Paste it anywhere.'; btn.classList.add('done');
        });
      }
    });
    var cp = box.querySelector('[data-copy]');
    cp.addEventListener('click', function () {
      navigator.clipboard.writeText(txt).then(function () {
        cp.textContent = 'Copied'; cp.classList.add('done');
      });
    });
  }

  function ratePicker(who, cls, value) {
    return '<div class="picker" data-who="' + who + '">' +
      '<div class="pwho">' + who + '</div>' +
      '<div class="pchips">' + QUICK.map(function (v) {
        return '<button class="pc' + (String(value) === String(v) ? ' on' : '') +
          '" data-v="' + v + '">' + v.toFixed(1) + '</button>';
      }).join('') + '</div>' +
      '<div class="pfree"><input type="number" min="0" max="5" step="0.1" placeholder="or type e.g. 4.4" ' +
      'value="' + (value === null || value === undefined ? '' : value) + '" class="pnum ' + cls + '"></div>' +
      '</div>';
  }

  function openFilm(i) {
    var d = DATA[i];
    var p = pendingFor(d.t) || {};
    var curC = p.chris !== undefined && p.chris !== '' ? p.chris : d.c;
    var curP = p.pixie !== undefined && p.pixie !== '' ? p.pixie : d.p;
    var row = function (k, v) {
      return v ? '<div class="row"><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>' : '';
    };
    var says = [['Chris', d.cs, 'c'], ['Pixie', d.ps, 'p'], ['The boys', d.bs, 'b']]
      .filter(function (x) { return x[1]; })
      .map(function (x) {
        return '<div class="quote ' + x[2] + '"><div class="who">' + x[0] +
          ' says</div><div class="q">' + esc(x[1]) + '</div></div>';
      }).join('');

    sheetEl.innerHTML =
      '<div class="hd"><button class="x" id="closeX" aria-label="Close">&times;</button>' +
      '<h2 id="sheetTitle">' + esc(d.t) + '</h2><div class="yr">' +
      [d.y, d.g, d.rt ? d.rt + ' min' : ''].filter(Boolean).map(esc).join(' · ') + '</div></div>' +
      '<div class="bd">' +
      (d.ov ? '<p class="ov">' + esc(d.ov) + '</p>' : '') +
      '<div class="editbox">' +
        '<div class="eh">Rate it</div>' +
        ratePicker('Chris', 'nC', curC) +
        ratePicker('Pixie', 'nP', curP) +
        '<div class="eh">Mark it</div>' +
        '<div class="actions">' +
          '<button class="pbtn" data-set="status" data-val="Rated">Seen it</button>' +
          '<button class="pbtn" data-set="status" data-val="Watchlist">Add to To Watch</button>' +
          '<button class="pbtn" data-set="context" data-val="Date Night">Date Night</button>' +
          '<button class="pbtn" data-set="context" data-val="Family">With the boys</button>' +
        '</div>' +
        '<div class="eh">Say something about it</div>' +
        '<textarea class="tsay" id="sayC" rows="2" placeholder="Chris says...">' + esc(p.chrisSays || '') + '</textarea>' +
        '<textarea class="tsay" id="sayP" rows="2" placeholder="Pixie says...">' + esc(p.pixieSays || '') + '</textarea>' +
        '<textarea class="tsay" id="sayB" rows="2" placeholder="The boys say...">' + esc(p.boysSay || '') + '</textarea>' +
        '<div class="ehint" id="ehint">' + (Object.keys(p).length > 1
          ? 'Changed. Open <b>Review</b> at the bottom to send it to SAGE.'
          : 'Changes are held on this device until you hand them to SAGE.') + '</div>' +
      '</div>' +
      '<div class="rows">' + row('Watched with', d.w) + row('Status', d.s) + row('Lane', d.l) +
        '</div>' +
      '<div class="suggwhere" style="margin-top:4px">' + whereBadge(d.sv, d.sc) + '</div>' +
      (says ? '<div class="says">' + says + '</div>' : '') +
      (d.n ? '<div class="sysnote">' + esc(d.n) + '</div>' : '') +
      shareRow(d) +
      '</div>';

    showSheet();
    $('closeX').addEventListener('click', closeSheet);
    wireEditor(d.t);
    wireShare(d);
  }

  function wireEditor(title, extra) {
    var box = sheetEl.querySelector('.editbox');
    if (!box) return;
    var flash = function (msg) {
      var h = $('ehint');
      if (h) h.innerHTML = msg || 'Changed. Open <b>Review</b> at the bottom to send it to SAGE.';
    };
    box.querySelectorAll('.picker').forEach(function (pk) {
      var who = pk.dataset.who;
      var field = who === 'Chris' ? 'chris' : 'pixie';
      pk.querySelectorAll('.pc').forEach(function (b) {
        b.addEventListener('click', function () {
          pk.querySelectorAll('.pc').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          pk.querySelector('.pnum').value = b.dataset.v;
          var patch = { status: 'Rated' };
          patch[field] = b.dataset.v;
          if (extra) Object.assign(patch, extra);
          edit(title, patch);
          flash();
        });
      });
      pk.querySelector('.pnum').addEventListener('change', function () {
        var v = this.value;
        if (v === '') return;
        var patch = { status: 'Rated' };
        patch[field] = v;
        if (extra) Object.assign(patch, extra);
        edit(title, patch);
        flash();
      });
    });
    box.querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        var patch = {};
        patch[b.dataset.set] = b.dataset.val;
        if (extra) Object.assign(patch, extra);
        edit(title, patch);
        box.querySelectorAll('[data-set="' + b.dataset.set + '"]').forEach(function (x) {
          x.classList.remove('on');
        });
        b.classList.add('on');
        flash();
      });
    });
    [['sayC', 'chrisSays'], ['sayP', 'pixieSays'], ['sayB', 'boysSay']].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener('change', function () {
        var patch = {};
        patch[pair[1]] = this.value.trim();
        if (extra) Object.assign(patch, extra);
        edit(title, patch);
        flash();
      });
    });
  }

  gridEl.addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (c) { openFilm(Number(c.dataset.i)); return; }
    var s = e.target.closest('[data-sugg]');
    if (s) { openSugg(Number(s.dataset.sugg)); return; }
    var u = e.target.closest('[data-soon]');
    if (u) { openSoon(Number(u.dataset.soon)); return; }
  });

  /* ------------------------------------------------------- SAGE Suggests */

  var AUDIENCES = ['All of it', 'Date Night', 'The Boys', 'Whole Family', 'Chris'];
  var audience = 'All of it';

  function whereBadge(sv, sc) {
    var c = classify(sv);
    return '<span class="swbadge ' + c.cls + '">' + esc(c.label) + '</span>' +
      (c.note ? '<span class="swnote">' + esc(c.note) + '</span>' : '') +
      (sc ? '<span class="checked">checked ' + esc(sc) + '</span>' : '');
  }

  function renderSuggest() {
    var list = audience === 'All of it' ? SUGG : SUGG.filter(function (x) { return x.who === audience; });
    gridEl.className = 'sugglist';
    gridEl.innerHTML = '<div class="suggintro"><h2>✨ SAGE Suggests</h2>' +
      '<p>' + SUGG.length + ' films you have never seen. Every reason below cites a rating already in your ' +
      'library, never general taste. Streaming checked for Costa Rica. Tap one to add it, rate it, or kill it.</p>' +
      '<div class="audpills">' + AUDIENCES.map(function (a) {
        var n = a === 'All of it' ? SUGG.length : SUGG.filter(function (x) { return x.who === a; }).length;
        return '<button class="tab sm" data-aud="' + a + '" aria-selected="' + (a === audience) + '">' +
          a + ' (' + n + ')</button>';
      }).join('') + '</div></div>' +
      list.map(function (x) {
        var i = SUGG.indexOf(x);
        var p = pendingFor(x.t);
        return '<article class="sugg' + (p ? ' edited' : '') + '" data-sugg="' + i + '">' +
          '<div class="suggart">' + (x.img ? '<img src="' + esc(x.img) + '" alt="" loading="lazy">' :
            '<div class="phs">' + esc(x.t) + '</div>') + '</div>' +
          '<div class="suggbody">' +
            '<div class="suggtop"><h3>' + esc(x.t) + '</h3><span class="forwho ' +
              x.who.replace(/\s+/g, '').toLowerCase() + '">' + esc(x.who) + '</span></div>' +
            '<div class="suggmeta">' + [x.y, x.rt ? x.rt + ' min' : ''].filter(Boolean).join(' · ') +
              (p ? ' · <b class="pendflag">you answered this</b>' : '') + '</div>' +
            '<p class="why">' + esc(x.why) + '</p>' +
            (x.thread ? '<p class="thread"><span class="tlabel">The thread</span>' +
              esc(x.thread) + '</p>' : '') +
            '<div class="suggwhere">' + whereBadge(x.sv, x.sc) + '</div>' +
          '</div></article>';
      }).join('');
    $('empty').hidden = true;
    $('found').textContent = list.length + ' suggestions' +
      (audience === 'All of it' ? '' : ' for ' + audience.toLowerCase());
    gridEl.querySelectorAll('[data-aud]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        audience = b.dataset.aud;
        renderSuggest();
      });
    });
  }

  function openSugg(i) {
    var x = SUGG[i];
    var p = pendingFor(x.t) || {};
    sheetEl.innerHTML =
      '<div class="hd"><button class="x" id="closeX" aria-label="Close">&times;</button>' +
      '<h2 id="sheetTitle">' + esc(x.t) + '</h2><div class="yr">' +
      [x.y, x.rt ? x.rt + ' min' : '', 'suggested for ' + x.who].filter(Boolean).map(esc).join(' · ') +
      '</div></div>' +
      '<div class="bd">' +
      '<div class="quote c"><div class="who">Why SAGE picked it</div><div class="q">' + esc(x.why) + '</div></div>' +
      (x.thread ? '<p class="thread"><span class="tlabel">The thread</span>' + esc(x.thread) + '</p>' : '') +
      (x.ov ? '<p class="ov">' + esc(x.ov) + '</p>' : '') +
      '<div class="suggwhere" style="margin-top:14px">' + whereBadge(x.sv, x.sc) + '</div>' +
      '<div class="editbox">' +
        '<div class="eh">What do you want to do with it?</div>' +
        '<div class="actions">' +
          '<button class="pbtn primary" data-set="status" data-val="Watchlist">Add to To Watch</button>' +
          '<button class="pbtn" data-set="context" data-val="Date Night">Date Night</button>' +
          '<button class="pbtn" data-set="context" data-val="Family">With the boys</button>' +
          '<button class="pbtn danger" data-set="status" data-val="Not for us">Not for us</button>' +
        '</div>' +
        '<div class="eh">Already seen it? Rate it and it moves into the library.</div>' +
        ratePicker('Chris', 'nC', p.chris) +
        ratePicker('Pixie', 'nP', p.pixie) +
        '<textarea class="tsay" id="sayC" rows="2" placeholder="Chris says...">' + esc(p.chrisSays || '') + '</textarea>' +
        '<div class="ehint" id="ehint">' + (Object.keys(p).length > 1
          ? 'Answered. Open <b>Review</b> at the bottom to send it to SAGE.'
          : 'Your answer trains the next batch.') + '</div>' +
      '</div>' + shareRow(x) + '</div>';
    showSheet();
    $('closeX').addEventListener('click', closeSheet);
    wireEditor(x.t, { from: 'suggestion' });
    wireShare({ t: x.t, y: x.y, c: null, p: null, ov: x.ov, sv: x.sv, sc: x.sc, thread: x.thread },
      { why: 'SAGE picked this one: ' + x.why });
  }

  /* --------------------------------------------------------- Coming Soon */

  var SOON_VIEWS = ['Everything', 'Upcoming', 'Now streaming', 'In theaters or not here yet'];
  var soonView = 'Everything';

  function renderSoon() {
    var list = soonView === 'Everything' ? UPCOMING
      : UPCOMING.filter(function (x) { return x.status === soonView; });
    gridEl.className = 'sugglist';
    gridEl.innerHTML = '<div class="suggintro"><h2>🎬 Coming Soon</h2>' +
      '<p>' + UPCOMING.length + ' films tracked because of what you already rate highly: Marvel, Star Wars, ' +
      'Pixar, DreamWorks, Cartoon Saloon and anything Guy Ritchie touches. The useful column is not the ' +
      'release date, it is whether you can watch it in Costa Rica yet. Tap one and tell me yes or no.</p>' +
      '<div class="audpills">' + SOON_VIEWS.map(function (v) {
        var n = v === 'Everything' ? UPCOMING.length
          : UPCOMING.filter(function (x) { return x.status === v; }).length;
        return '<button class="tab sm" data-soonview="' + esc(v) + '" aria-selected="' +
          (v === soonView) + '">' + v + ' (' + n + ')</button>';
      }).join('') + '</div></div>' +
      list.map(function (x) {
        var i = UPCOMING.indexOf(x);
        var p = pendingFor(x.t);
        var stat = x.status === 'Now streaming' ? 'statnow'
          : x.status === 'Upcoming' ? 'statsoon' : 'statwait';
        return '<article class="sugg' + (p ? ' edited' : '') + '" data-soon="' + i + '">' +
          '<div class="suggart">' + (x.img ? '<img src="' + esc(x.img) + '" alt="" loading="lazy">' :
            '<div class="phs">' + esc(x.t) + '</div>') + '</div>' +
          '<div class="suggbody">' +
            '<div class="suggtop"><h3>' + esc(x.t) + '</h3>' +
              '<span class="forwho ' + stat + '">' + esc(x.status) + '</span></div>' +
            '<div class="suggmeta">' + esc(x.date || 'date TBA') + ' · ' + esc(x.src) +
              (x.rt ? ' · ' + x.rt + ' min' : '') +
              (p && p.interest ? ' · <b class="pendflag">you said ' + esc(p.interest) + '</b>'
                : x.interest ? ' · <b class="pendflag">' + esc(x.interest) + '</b>' : '') +
            '</div>' +
            (x.ov ? '<p class="why">' + esc(x.ov.slice(0, 230)) + (x.ov.length > 230 ? '…' : '') + '</p>' : '') +
            '<div class="suggwhere">' + whereBadge(x.sv, x.sc) + '</div>' +
          '</div></article>';
      }).join('');
    $('empty').hidden = true;
    $('found').textContent = list.length + ' tracked' + (soonView === 'Everything' ? '' : ', ' + soonView.toLowerCase());
    gridEl.querySelectorAll('[data-soonview]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        soonView = b.dataset.soonview;
        renderSoon();
      });
    });
  }

  function openSoon(i) {
    var x = UPCOMING[i];
    var p = pendingFor(x.t) || {};
    var row = function (k, v) {
      return v ? '<div class="row"><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>' : '';
    };
    sheetEl.innerHTML =
      '<div class="hd"><button class="x" id="closeX" aria-label="Close">&times;</button>' +
      '<h2 id="sheetTitle">' + esc(x.t) + '</h2><div class="yr">' + esc(x.status) + '</div></div>' +
      '<div class="bd">' +
      (x.ov ? '<p class="ov">' + esc(x.ov) + '</p>' : '') +
      '<div class="rows">' + row('Release date', x.date) + row('Costa Rica release', x.crDate) +
        row('Tracked because', x.src) + row('Runtime', x.rt ? x.rt + ' min' : '') + '</div>' +
      '<div class="suggwhere" style="margin-top:12px">' + whereBadge(x.sv, x.sc) + '</div>' +
      '<div class="editbox">' +
        '<div class="eh">Do you want to see this?</div>' +
        '<div class="actions">' +
          '<button class="pbtn primary' + (p.interest === 'yes' ? ' on' : '') + '" data-set="interest" data-val="yes">Yes</button>' +
          '<button class="pbtn' + (p.interest === 'maybe' ? ' on' : '') + '" data-set="interest" data-val="maybe">Maybe</button>' +
          '<button class="pbtn danger' + (p.interest === 'no' ? ' on' : '') + '" data-set="interest" data-val="no">No</button>' +
        '</div>' +
        '<div class="eh">Already seen it?</div>' +
        ratePicker('Chris', 'nC', p.chris) +
        '<div class="ehint" id="ehint">' + (Object.keys(p).length > 1
          ? 'Noted. Open <b>Review</b> at the bottom to send it to SAGE.'
          : 'Every yes and no sharpens what gets tracked next.') + '</div>' +
      '</div>' + shareRow(x) + '</div>';
    showSheet();
    $('closeX').addEventListener('click', closeSheet);
    wireEditor(x.t, { from: 'upcoming' });
    wireShare({ t: x.t, y: x.y, c: null, p: null, ov: x.ov, sv: x.sv, sc: x.sc },
      { why: x.status + (x.date ? ', out ' + x.date : '') + '. Tracked because of ' + x.src + '.' });
  }

  /* --------------------------------------------------------------- wiring */

  ['q', 'fg', 'fl', 'fw', 'fr', 'fs'].forEach(function (id) {
    $(id).addEventListener(id === 'q' ? 'input' : 'change', render);
  });
  $('reset').addEventListener('click', function () {
    ['fg', 'fl', 'fw', 'fr', 'fs'].forEach(function (id) { $(id).value = ''; });
    $('q').value = '';
    render();
  });

  paintBasket();
  render();
})();
