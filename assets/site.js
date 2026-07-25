/* assets/site.js — WiFi Odds progressive enhancement. ~6 KB, no dependencies.
 *
 * THE CONTRACT: every page is already finished when this file loads. The HTML
 * carries every number, every table row and every chart path, baked at build
 * time by build/prerender.js. This file only adds affordances:
 *
 *   1. theme toggle          (writes localStorage.woTheme — the only key we use)
 *   2. reveal + count-up     (only when prefers-reduced-motion: no-preference)
 *   3. table sort            (reads baked data-s attributes; never parses text)
 *   4. filter chips + search (toggles the `hidden` attribute on baked rows)
 *   5. waffle tooltip        (the title attribute is the no-JS truth)
 *
 * If it throws, the page still reads correctly — which is why every block is
 * independently guarded.
 */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  root.classList.add('js');

  /* ── 1. theme ─────────────────────────────────────────────────────────── */
  function stored() { try { return localStorage.getItem('woTheme'); } catch (e) { return null; } }
  function current() {
    var a = root.getAttribute('data-theme');
    if (a) return a;
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) { return 'dark'; }
  }
  function paintToggle(btn, t) {
    btn.textContent = t === 'light' ? '☼' : '☽';
    btn.setAttribute('aria-label', 'Switch to ' + (t === 'light' ? 'dark' : 'light') + ' theme');
    btn.setAttribute('title', btn.getAttribute('aria-label'));
  }
  try {
    var btns = doc.querySelectorAll('.tt');
    Array.prototype.forEach.call(btns, function (btn) {
      paintToggle(btn, current());
      btn.addEventListener('click', function () {
        var next = current() === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('woTheme', next); } catch (e) {}
        Array.prototype.forEach.call(btns, function (b) { paintToggle(b, next); });
      });
    });
    if (!stored() && !root.getAttribute('data-theme')) { /* media query rules */ }
  } catch (e) {}

  /* ── 2. motion: reveal + count-up ─────────────────────────────────────── */
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

  /* ── 3. table sort — data-s attributes are pre-resolved at build time, so the
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

  /* ── 4. filter chips + search — toggle `hidden` on baked rows ─────────── */
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

  /* ── 5. waffle tooltip — pointer sugar over the baked title attribute ─── */
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
})();
