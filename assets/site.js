/* assets/site.js — WiFi Odds progressive enhancement. ~6 KB, no dependencies.
 *
 * THE CONTRACT: every page is already finished when this file loads. The HTML
 * carries every number, every table row and every chart path, baked at build
 * time by build/prerender.js. This file only adds affordances:
 *
 *   1. reveal + count-up     (only when prefers-reduced-motion: no-preference)
 *   2. table sort            (reads baked data-s attributes; never parses text)
 *   3. filter chips + search (toggles the `hidden` attribute on baked rows)
 *   4. waffle tooltip        (the title attribute is the no-JS truth)
 *
 * If it throws, the page still reads correctly — which is why every block is
 * independently guarded.
 *
 * THE THEME TOGGLE IS NOT IN THIS FILE ANY MORE, and this file stores nothing.
 * It used to own a `.tt` button that set data-theme and wrote
 * localStorage.woTheme. The Forecast allows no storage of any kind, so the
 * switch moved into build/lib/html.js as a five-line inline script that toggles
 * a class on <html> and lasts until you reload. Nothing here reads or writes
 * localStorage, sessionStorage or a cookie, and nothing here should start.
 */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  root.classList.add('js');

  /* ── 1. motion: reveal + count-up ─────────────────────────────────────── */
  var motionOK = false;
  try {
    motionOK = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  } catch (e) { motionOK = false; }

  function countUp(el) {
    var raw = el.textContent.trim();
    var m = raw.match(/^([^\d\-]*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    var pre = m[1], body = m[2], post = m[3];
    var dec = body.indexOf('.') >= 0 ? body.split('.')[1].length : 0;
    var target = parseFloat(body.replace(/,/g, ''));
    if (!isFinite(target) || target === 0) return;
    var grouped = body.indexOf(',') >= 0;
    el.style.minWidth = el.getBoundingClientRect().width + 'px';
    el.style.display = 'inline-block';
    var t0 = 0, DUR = 600;
    function fmt(v) {
      var s = dec ? v.toFixed(dec) : String(Math.round(v));
      if (grouped) {
        var parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        s = parts.join('.');
      }
      return pre + s + post;
    }
    function frame(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / DUR);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
    }
    requestAnimationFrame(frame);
  }

  try {
    var REVEAL = '.rv,.viz,.waffle,.track';
    var targets = doc.querySelectorAll(REVEAL);
    if (!motionOK || !('IntersectionObserver' in window)) {
      /* finished state, immediately — .anim is never added, so CSS never hides */
      Array.prototype.forEach.call(targets, function (el) { el.classList.add('in'); });
    } else {
      root.classList.add('anim');
      /* THRESHOLD 0.25 ALONE HIDES TALL CONTENT FOREVER. A `.rv` element taller
       * than about 4× the viewport can never reach a 25% intersection ratio — the
       * viewport is not big enough — so it sits at opacity 0 permanently and the
       * page looks blank where its main content should be. This bit /race/, whose
       * 18-row table is ~2,000px on a laptop and far taller on a phone, and it is
       * exactly this project's recurring failure: a green build, a 200, and no
       * bytes on screen.
       *
       * So the observer watches BOTH edges (0 and 0.25) and reveals when either
       * "a quarter of it is showing" or "it is too tall for that to ever be true
       * and some of it is showing". Short elements keep the original feel. */
      /* THE SECOND HALF OF THIS BUG, found on the day The Plate shipped.
       *
       * The try/catch wrapping this whole block CANNOT catch a throw in here.
       * The observer callback runs later, on its own task, so an exception
       * escapes to window.onerror and the fallback below never runs. Worse, a
       * throw part-way through `entries.forEach` abandons every entry after it
       * in the same batch, and those elements were already unobserved-or-not in
       * an inconsistent state. One bad count-up silently froze 15 of the
       * homepage's 16 sections at opacity 0 — a 923px leaderboard, seven airline
       * cards and three FAQ blocks, all invisible on a page that scrolled fine
       * and returned 200.
       *
       * So: reveal FIRST, decorate second, and give every entry its own
       * try/catch. Making an element visible is the part that must not be
       * skippable; the animated counter is the part that may fail. */
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          try {
            if (!en.isIntersecting) return;
            var el = en.target;
            var tall = en.boundingClientRect.height >
              (en.rootBounds ? en.rootBounds.height : window.innerHeight) * 0.9;
            if (!tall && en.intersectionRatio < 0.25) return;
            el.classList.add('in');
            io.unobserve(el);
            try {
              Array.prototype.forEach.call(el.querySelectorAll('.cu'), countUp);
              if (el.classList.contains('cu')) countUp(el);
            } catch (inner) { /* a counter is decoration; the content is not */ }
          } catch (outer) {
            /* Last resort: if anything above failed, the element still becomes
             * visible. Blank content is the only unacceptable outcome here. */
            try { en.target.classList.add('in'); } catch (e3) {}
          }
        });
      }, { threshold: [0, 0.25], rootMargin: '0px 0px -8% 0px' });
      Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
      /* count-ups that live outside a revealed container still run */
      Array.prototype.forEach.call(doc.querySelectorAll('.cu'), function (el) {
        if (!el.closest(REVEAL)) countUp(el);
      });

      /* THE DEAD-MAN SWITCH. Six seconds after load, anything still hidden gets
       * revealed regardless of why. This site's one recurring failure is a page
       * that returns 200 and shows nothing, and an animation is never worth a
       * blank section. If this ever fires in the wild the cause is a bug worth
       * finding, so it says so in the console rather than healing quietly. */
      setTimeout(function () {
        var stuck = doc.querySelectorAll(REVEAL.split(',').map(function (s) {
          return s + ':not(.in)';
        }).join(','));
        if (!stuck.length) return;
        Array.prototype.forEach.call(stuck, function (el) { el.classList.add('in'); });
        if (window.console && console.warn) {
          console.warn('wifiodds: revealed ' + stuck.length + ' element(s) the observer ' +
            'never fired for. Content is visible, but that is a bug — please report it.');
        }
      }, 6000);
    }
  } catch (e) {
    try {
      Array.prototype.forEach.call(doc.querySelectorAll('.rv,.viz,.waffle,.track'),
        function (el) { el.classList.add('in'); });
    } catch (e2) {}
  }

  /* ── 2. table sort — data-s attributes are pre-resolved at build time, so the
        sorter never parses a date or strips a comma. ──────────────────────── */
  function cellVal(tr, i) {
    var td = tr.cells[i];
    if (!td) return '';
    var s = td.getAttribute('data-s');
    if (s === null) return td.textContent.trim().toLowerCase();
    var n = parseFloat(s);
    return isFinite(n) && String(n) === s.trim() ? n : s.toLowerCase();
  }
  try {
    Array.prototype.forEach.call(doc.querySelectorAll('table.tbl'), function (tbl) {
      var heads = tbl.querySelectorAll('thead th[data-k]');
      Array.prototype.forEach.call(heads, function (th) {
        th.setAttribute('role', 'button');
        th.setAttribute('tabindex', '0');
        function run() {
          var i = th.cellIndex;
          var asc = th.getAttribute('aria-sort') !== 'ascending';
          /* numeric columns want big-first on the first click; text wants a-z */
          if (th.getAttribute('aria-sort') === null) asc = th.getAttribute('data-t') !== 'num';
          var body = tbl.tBodies[0];
          var rows = Array.prototype.slice.call(body.rows);
          rows.sort(function (a, b) {
            var x = cellVal(a, i), y = cellVal(b, i);
            if (x === y) return 0;
            return (x < y ? -1 : 1) * (asc ? 1 : -1);
          });
          var frag = doc.createDocumentFragment();
          rows.forEach(function (r) { frag.appendChild(r); });
          body.appendChild(frag);
          Array.prototype.forEach.call(heads, function (h) { h.removeAttribute('aria-sort'); });
          th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
        }
        th.addEventListener('click', run);
        th.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); run(); }
        });
      });
    });
  } catch (e) {}

  /* ── 3. filter chips + search — toggle `hidden` on baked rows ─────────── */
  function applyFilters(scope) {
    var sel = scope.getAttribute('data-target');
    var host = sel ? doc.querySelector(sel) : null;
    if (!host) return;
    var f = scope.getAttribute('data-cur') || 'all';
    var qEl = doc.querySelector('.srch input[data-target="' + sel + '"]');
    var q = qEl ? qEl.value.trim().toLowerCase() : '';
    var rows = host.querySelectorAll('[data-f]');
    var shown = 0;
    Array.prototype.forEach.call(rows, function (r) {
      var tags = (' ' + (r.getAttribute('data-f') || '') + ' ');
      var okF = (f === 'all') || tags.indexOf(' ' + f + ' ') >= 0;
      var okQ = !q || (r.getAttribute('data-q') || '').toLowerCase().indexOf(q) >= 0;
      if (okF && okQ) { r.removeAttribute('hidden'); shown++; }
      else r.setAttribute('hidden', '');
    });
    var out = doc.querySelector('[data-count-for="' + sel + '"]');
    if (out) out.textContent = shown;
  }
  try {
    Array.prototype.forEach.call(doc.querySelectorAll('.filters[data-target]'), function (scope) {
      var btns = scope.querySelectorAll('button[data-f]');
      Array.prototype.forEach.call(btns, function (b) {
        b.addEventListener('click', function () {
          scope.setAttribute('data-cur', b.getAttribute('data-f'));
          Array.prototype.forEach.call(btns, function (o) {
            o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
          });
          applyFilters(scope);
        });
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.srch input[data-target]'), function (inp) {
      inp.addEventListener('input', function () {
        var sel = inp.getAttribute('data-target');
        var scope = doc.querySelector('.filters[data-target="' + sel + '"]');
        if (scope) applyFilters(scope);
        else {
          var host = doc.querySelector(sel);
          if (!host) return;
          var q = inp.value.trim().toLowerCase();
          Array.prototype.forEach.call(host.querySelectorAll('[data-q]'), function (r) {
            if (!q || r.getAttribute('data-q').toLowerCase().indexOf(q) >= 0) r.removeAttribute('hidden');
            else r.setAttribute('hidden', '');
          });
        }
      });
    });
  } catch (e) {}

  /* ── 4. waffle tooltip — pointer sugar over the baked title attribute ─── */
  try {
    var tip = null;
    function hide() { if (tip) { tip.remove(); tip = null; } }
    Array.prototype.forEach.call(doc.querySelectorAll('.waffle'), function (w) {
      w.addEventListener('mouseover', function (ev) {
        var t = ev.target;
        if (!t || t.tagName !== 'I' || !t.getAttribute('title')) return hide();
        if (!tip) { tip = doc.createElement('div'); tip.className = 'wtip'; doc.body.appendChild(tip); }
        tip.textContent = t.getAttribute('title');
        var r = t.getBoundingClientRect();
        tip.style.left = Math.max(6, Math.min(window.innerWidth - 190, r.left - 60)) + 'px';
        tip.style.top = Math.max(6, r.top - 30) + 'px';
      });
      w.addEventListener('mouseleave', hide);
    });
    window.addEventListener('scroll', hide, { passive: true });
  } catch (e) {}

  /* ── 5. rank boards — the Big 4 / all-18 "Rank by" control ─────────────
   * ONE handler moves four things together: the pressed button, the header's
   * aria-sort, the baked rank numbers (ties share a rank; unranked rows get
   * "—", never a 0) and the caption paragraph under the control. Nothing here
   * reorders on load — the table already ships in ConnectScore order, so
   * script-off and the default state agree. */
  /* THE CARD RECORDS FOLLOW THE TABLE (Phase 1b). Below 880px each board
   * renders as .crd records instead of the table; the table still exists in
   * the DOM and remains the single sorting mechanism. After any re-order the
   * cards are re-appended in the table's row order (matched on data-key) and
   * take the row's freshly-ranked number, so the two renderings can never
   * disagree about order or rank. */
  function syncBoardCards(scope, tbody) {
    var list = scope.querySelector('.cardsb');
    if (!list || !tbody) return;
    var frag = doc.createDocumentFragment();
    Array.prototype.forEach.call(tbody.rows, function (r) {
      var k = r.getAttribute('data-key');
      var c = k && list.querySelector('[data-key="' + k + '"]');
      if (!c) return;
      var rk = r.querySelector('.rank'), ck = c.querySelector('.crd-rank');
      /* cards bake two-digit ranks ("03"); keep that after a re-sort */
      if (rk && ck) {
        var t = rk.textContent.trim();
        ck.textContent = /^\d$/.test(t) ? '0' + t : t;
      }
      frag.appendChild(c);
    });
    list.appendChild(frag);
  }
  try {
    Array.prototype.forEach.call(doc.querySelectorAll('.rankb'), function (root) {
      var table = root.querySelector('table');
      if (!table) return;
      var tbody = table.tBodies[0];
      var orig = [].slice.call(tbody.rows);
      var caps = [].slice.call(root.querySelectorAll('.sortcap p'));
      var btns = [].slice.call(root.querySelectorAll('.filters button[data-sort]'));
      function val(r, k) {
        var v = r.getAttribute('data-' + k);
        return v === '' || v === null ? null : parseFloat(v);
      }
      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-sort');
          btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
          table.setAttribute('data-active', k);
          /* THE ARROW MUST MATCH THE LABEL. Every numeric column here ranks
             best-first, i.e. descending; "A–Z" is the one column that reads
             the other way, ascending, and has to say so — this is the exact
             failure this control is under a test for (a labelled-A–Z control
             that quietly sorted Z–A). */
          Array.prototype.forEach.call(table.querySelectorAll('th[data-rc]'), function (th) {
            if (th.getAttribute('data-rc') !== k) { th.removeAttribute('aria-sort'); return; }
            th.setAttribute('aria-sort', k === 'name' ? 'ascending' : 'descending');
          });
          caps.forEach(function (p) { p.hidden = p.getAttribute('data-for') !== k; });
          var list;
          if (k === 'score') {
            list = orig.slice();
            list.forEach(function (r, i) { r.querySelector('.rank').textContent = String(i + 1); });
          } else if (k === 'name') {
            /* A to Z, and it is not a ranking — every row keeps the "unranked"
               dash rather than a position number, the same idiom the numeric
               columns use for a row with no published number, so a reader
               never mistakes alphabetical order for a score. */
            list = orig.slice().sort(function (a, b2) {
              return a.getAttribute('data-name').localeCompare(b2.getAttribute('data-name'));
            });
            list.forEach(function (r) { r.querySelector('.rank').textContent = '—'; });
          } else {
            var ranked = orig.filter(function (r) { return val(r, k) !== null; })
              .sort(function (a, b2) {
                return (val(b2, k) - val(a, k)) ||
                  a.getAttribute('data-name').localeCompare(b2.getAttribute('data-name'));
              });
            var un = orig.filter(function (r) { return val(r, k) === null; })
              .sort(function (a, b2) {
                return a.getAttribute('data-name').localeCompare(b2.getAttribute('data-name'));
              });
            var prev = null, rank = 0;
            ranked.forEach(function (r, i) {
              var v = val(r, k);
              if (v !== prev) { rank = i + 1; prev = v; }
              r.querySelector('.rank').textContent = String(rank);
            });
            un.forEach(function (r) { r.querySelector('.rank').textContent = '—'; });
            list = ranked.concat(un);
          }
          var frag = doc.createDocumentFragment();
          list.forEach(function (r) { frag.appendChild(r); });
          tbody.appendChild(frag);
          syncBoardCards(root, tbody);
        });
      });
    });
  } catch (e) {}

  /* 5b ── the homepage 18-board's cards follow ITS table too. That board is
   * sorted by the generic header sorter (§2) driven by the Rank-by row (§7 in
   * the second closure), so the sync hangs off the sort events themselves:
   * any header click or keypress re-syncs after the sort has run. */
  try {
    var hb = doc.querySelector('#board .board-shell table.tbl.board');
    var hcards = doc.querySelector('#board .cardsb');
    if (hb && hcards) {
      var resync = function () {
        setTimeout(function () { syncBoardCards(doc.getElementById('board'), hb.tBodies[0]); }, 0);
      };
      Array.prototype.forEach.call(hb.querySelectorAll('thead th[data-k]'), function (th) {
        th.addEventListener('click', resync);
        th.addEventListener('keydown', resync);
      });
      /* the Rank-by buttons' own handler (§7, second closure) restores the
         baked order for "ConnectScore" without touching a header, so the
         buttons re-sync too; setTimeout runs this after that handler */
      Array.prototype.forEach.call(doc.querySelectorAll('#board-rank button[data-bs]'),
        function (b) { b.addEventListener('click', resync); });
    }
  } catch (e) {}
})();


/* ── round seven (27 Jul 2026) — three additions, all progressive. ─────────
 * 6. header shrink with hysteresis (note 18). The sticky part is CSS and
 *    needs nothing from here. The shrink toggles html.hdr-c compact past
 *    170px of scroll and full again under 40px; the 130px gap is ~3x the
 *    height the header gives up, so the change can never re-cross its own
 *    trigger and oscillate. rAF-throttled, passive.
 * 7. rank-by buttons for the 18-board (note 5). Each button drives the
 *    matching sortable header, so aria-sort, arrows and order stay one
 *    mechanism; a direct header click un-presses the buttons it no longer
 *    matches.
 * 8. clickable headers for the rank boards (note 5). A header click presses
 *    the matching Rank-by button, so ranks, captions, colour column and
 *    aria-sort all move together through the one handler in section 5. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;

  /* 6 ── header shrink, hysteresis 170/40 */
  try {
    var compact = false, ticking = false;
    function judge() {
      ticking = false;
      var y = window.pageYOffset || 0;
      if (!compact && y > 170) { compact = true; root.classList.add('hdr-c'); }
      else if (compact && y < 40) { compact = false; root.classList.remove('hdr-c'); }
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(judge); }
    }, { passive: true });
    judge();
  } catch (e) {}

  /* 7 ── the 18-board's Rank-by row drives its sortable headers */
  try {
    var ctrl = doc.getElementById('board-rank');
    var board = doc.querySelector('#board table.tbl.board');
    if (ctrl && board) {
      var bbtns = [].slice.call(ctrl.querySelectorAll('button[data-bs]'));
      var dirFor = function (k) { return (k === 'score' || k === 'nextgen') ? 'descending' : 'ascending'; };
      var thFor = function (k) { return board.querySelector('thead th[data-k="' + k + '"]'); };
      function sync() {
        bbtns.forEach(function (b) {
          var th = thFor(b.getAttribute('data-bs'));
          var on = !!th && th.getAttribute('aria-sort') === dirFor(b.getAttribute('data-bs'));
          b.setAttribute('aria-pressed', String(on));
        });
      }
      var baked = [].slice.call(board.tBodies[0].rows);
      bbtns.forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-bs'), th = thFor(k);
          if (!th) return;
          if (k === 'score') {
            /* restore the baked order rather than re-sorting: three fleets
               tie at 100, and a re-sort would leave the tie in whatever
               order the last rank left it, disagreeing with the baked
               rank numbers 01-03. */
            var frag = document.createDocumentFragment();
            baked.forEach(function (r) { frag.appendChild(r); });
            board.tBodies[0].appendChild(frag);
            [].slice.call(board.querySelectorAll('thead th[data-k]')).forEach(function (h) { h.removeAttribute('aria-sort'); });
            th.setAttribute('aria-sort', 'descending');
            sync();
            return;
          }
          var want = dirFor(k);
          /* the header handler toggles, so at most two clicks reach any
             direction from any state */
          for (var i = 0; i < 2 && th.getAttribute('aria-sort') !== want; i++) th.click();
          sync();
        });
      });
      [].slice.call(board.querySelectorAll('thead th[data-k]')).forEach(function (th) {
        th.addEventListener('click', function () { setTimeout(sync, 0); });
        th.addEventListener('keydown', function () { setTimeout(sync, 0); });
      });
    }
  } catch (e) {}

  /* 8 ── every rank board's headers press its own Rank-by buttons. All .rankb
     roots, not one id: the homepage's Big 4, /airlines/'s Big 4 and the full
     18 all carry the same control. */
  try {
    [].slice.call(doc.querySelectorAll('.rankb')).forEach(function (rb) {
      [].slice.call(rb.querySelectorAll('thead th[data-rc]')).forEach(function (th) {
        var k = th.getAttribute('data-rc');
        if (k === 'rank') return;
        var btn = rb.querySelector('.filters button[data-sort="' + k + '"]');
        if (!btn) return;
        th.setAttribute('role', 'button');
        th.setAttribute('tabindex', '0');
        function go() { btn.click(); }
        th.addEventListener('click', go);
        th.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
        });
      });
    });
  } catch (e) {}
})();
