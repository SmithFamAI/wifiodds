'use strict';
/* build/lib/nojsroutes.js — the static route tables on /united/.
 *
 * WHY THIS EXISTS. /united/ was the one route on the site that failed the
 * JavaScript-off acceptance criterion. With script blocked it rendered zero
 * <table> elements and ten empty containers, and the playbook told the reader to
 * "take the top-ranked flight above" when nothing was above them.
 *
 * The data was already on disk the whole time. united/data.json carries
 * routeCache: 57 route entries, 34 of them with flight rows, 174 rows in total,
 * each with a flight number, a segment, a draw rate, an observation count and
 * the tracker's own confidence word. This module turns that cache into static
 * tables that are baked into the page at build time and call nothing.
 *
 * THE SAMPLE FLOOR IS 5, and it is the one editorial judgement in here. Measured
 * across the 174 rows on 25 Jul 2026: median 10 observations, 82% at 5 or more,
 * 55% at 10 or more, range 1 to 40. A flight seen three times can read 100% or
 * 0% and neither figure carries information, so below the floor the rate is not
 * printed at all. ARCHETYPES.md sets the wording: "history too thin to lean on".
 *
 * NO BAND COLOURS. Every figure here is ink. The four score bands are reserved
 * for ConnectScores and the site's own odds, and a draw rate off somebody else's
 * per-flight history is neither. Adding a fifth thing that wears a band is a
 * decision for a person, not for this file.
 *
 * NO SUPERLATIVE. Departures are ranked and never crowned; the word "best" does
 * not appear. The table already says which row is on top.
 */

var H = require('./html.js');
var DL = require('./data.js');
var esc = H.esc;

/* At or above this many observed departures, print the rate. Below it, words. */
var SAMPLE_FLOOR = 5;
var THIN = 'history too thin to lean on';

/* ── airport names, read out of the page's own script ─────────────────────
 * The optimizer's app JS carries `const AIRPORTS={DEN:"Denver",...}`. Reading
 * that literal rather than keeping a second copy here is what stops the static
 * tables and the live ones from calling the same airport two different things.
 *
 * A code the map does not carry falls back to the bare code, and a template
 * whose literal cannot be found falls back to bare codes for everything. Neither
 * fails the build: this runs unattended at 04:32 and a missing city name is not
 * worth taking the morning deploy down for. A code that is missing is visible in
 * the output as a three-letter code, which is still correct.
 */
var AIRPORT_RE = /const AIRPORTS=\{([\s\S]*?)\};/;
var _airports = null;

function airports() {
  if (_airports) return _airports;
  _airports = {};
  try {
    var src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'templates', 'united-optimizer.html'), 'utf8');
    var m = AIRPORT_RE.exec(src);
    if (m) _airports = new Function('return {' + m[1] + '};')();
  } catch (e) {
    _airports = {};
  }
  return _airports;
}

function place(code) {
  var a = airports()[code];
  return a ? a + ' (' + code + ')' : code;
}

function pairLabel(key) {
  var p = key.split('-');
  return place(p[0]) + ' to ' + place(p[1]);
}

function pairShort(key) {
  var p = key.split('-');
  return p[0] + ' → ' + p[1];
}

function cacheDay(entry) {
  return String(entry.ts || '').slice(0, 10);
}

/* ── the model ────────────────────────────────────────────────────────────
 * Routes carrying flight rows, ordered by the highest draw rate on the pair
 * among departures that clear the floor. A pair whose every row is below the
 * floor has no rate to sort on and goes to the end, which is the right place
 * for it: there is nothing on it a reader can act on.
 */
function model(m) {
  var cache = (m.D && m.D.routeCache) || {};
  var full = [], empty = [];

  Object.keys(cache).forEach(function (key) {
    var entry = cache[key] || {};
    var flights = (entry.flights || []).slice();
    if (!flights.length) {
      empty.push({ key: key, day: cacheDay(entry) });
      return;
    }
    flights.sort(function (a, b) {
      if (b.prob !== a.prob) return b.prob - a.prob;
      if (b.obs !== a.obs) return b.obs - a.obs;
      return a.fn < b.fn ? -1 : 1;
    });
    var qualified = flights.filter(function (f) { return f.obs >= SAMPLE_FLOOR; });
    full.push({
      key: key,
      day: cacheDay(entry),
      flights: flights,
      obs: flights.reduce(function (a, f) { return a + f.obs; }, 0),
      rank: qualified.length ? qualified[0].prob : -1
    });
  });

  full.sort(function (a, b) {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return a.key < b.key ? -1 : 1;
  });
  empty.sort(function (a, b) { return a.key < b.key ? -1 : 1; });

  var rows = full.reduce(function (a, r) { return a + r.flights.length; }, 0);
  var thin = full.reduce(function (a, r) {
    return a + r.flights.filter(function (f) { return f.obs < SAMPLE_FLOOR; }).length;
  }, 0);
  var days = {};
  full.concat(empty).forEach(function (r) { if (r.day) days[r.day] = 1; });
  days = Object.keys(days).sort();

  /* The observation range behind each of the tracker's confidence words. Read
     out of the data rather than written down, because the note in the page that
     quotes it would otherwise go stale the first morning the cache moves. */
  var conf = {};
  full.forEach(function (r) {
    r.flights.forEach(function (f) {
      var c = conf[f.conf] || (conf[f.conf] = { lo: f.obs, hi: f.obs, n: 0 });
      if (f.obs < c.lo) c.lo = f.obs;
      if (f.obs > c.hi) c.hi = f.obs;
      c.n++;
    });
  });

  return {
    full: full, empty: empty, rows: rows, thin: thin, conf: conf,
    firstDay: days[0], lastDay: days[days.length - 1]
  };
}

/* ── rendering ───────────────────────────────────────────────────────────── */
function rateCell(f) {
  if (f.obs < SAMPLE_FLOOR) return '<td>' + THIN + '</td>';
  return '<td class="num"><b>' + f.prob + '%</b></td>';
}

function routeTable(r) {
  var day = DL.prettyDate(r.day);
  var rows = r.flights.map(function (f) {
    return '        <tr><td class="mono"><b>' + esc(f.fn) + '</b></td>' +
      rateCell(f) +
      '<td class="num">' + f.obs + '</td>' +
      '<td class="micro">' + esc(f.conf) + '</td>' +
      '<td class="micro">' + day + '</td></tr>';
  }).join('\n');

  return '    <h3 id="nojs-' + esc(r.key) + '">' + pairShort(r.key) + '</h3>\n' +
    '    <p class="micro">' + esc(pairLabel(r.key)) + ' · ' + r.flights.length +
    ' departure' + (r.flights.length === 1 ? '' : 's') + ' · ' + r.obs +
    ' observations · cached ' + day + '</p>\n' +
    '    <div class="tbl-shell tablescroll"><table class="tbl">\n' +
    '      <thead><tr><th scope="col">Flight</th><th scope="col" class="num">Starlink draw rate</th>' +
    '<th scope="col" class="num">Departures observed</th><th scope="col">Tracker confidence</th>' +
    '<th scope="col">Cached</th></tr></thead>\n' +
    '      <tbody>\n' + rows + '\n      </tbody>\n    </table></div>\n';
}

function jumpNav(full) {
  return '    <nav class="qnav" aria-label="Jump to a route">\n' +
    full.map(function (r) {
      return '      <a href="#nojs-' + esc(r.key) + '">' + pairShort(r.key) + '</a>';
    }).join('\n') + '\n    </nav>\n';
}

/* "low covers 1 to 14 observations, medium 4 to 20, high 9 to 40" — built from
   the cache rather than written down, so the claim in the page is re-derived
   every build instead of remembered. */
function confNote(conf) {
  var order = ['low', 'medium', 'high'];
  var words = Object.keys(conf).sort(function (a, b) {
    var ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return words.map(function (w, i) {
    var c = conf[w];
    return esc(w) + ' covers ' + c.lo + ' to ' + c.hi + (i ? '' : ' observations');
  }).join(', ');
}

function emptyList(empty) {
  return '    <p>' + empty.map(function (r) {
    return '<b>' + pairShort(r.key) + '</b>';
  }).join(' · ') + '</p>\n';
}

/* The whole block, ready to be baked into the .no-js-only div in
 * build/templates/united-optimizer.html. Returns HTML with no <section> element
 * in it, because the wrapper it replaces is itself a <section> and tmpl.js's
 * data-bake regex closes on the first matching end tag. */
function block(m) {
  var d = model(m);
  var span = d.firstDay === d.lastDay
    ? DL.prettyDate(d.lastDay)
    : DL.prettyDate(d.firstDay) + ' to ' + DL.prettyDate(d.lastDay);

  return '' +
    '  <span class="kicker">Cached routes</span>\n' +
    '  <div class="sec-h"><h2>Every route already in this page\'s data file</h2>\n' +
    '    <span class="sub">' + d.full.length + ' pairs with flight history · ' +
    d.rows + ' departures</span></div>\n' +
    '  <p class="sec-lede">The optimizer asks the tracker for a route while you are looking at it, ' +
    'so it needs JavaScript. These tables do not. They are the last answer the tracker gave for ' +
    'every route in <a href="/united/data.json">this page\'s data file</a>, baked in when the ' +
    'site was built, and reading them sends nothing anywhere. Every row is a mainline United ' +
    'flight number, the share of its observed departures that drew a Starlink-equipped tail, the ' +
    'number of departures behind that share, the tracker\'s confidence word and the date the ' +
    'answer was cached. Pairs are ordered by the highest rate on the pair among departures with ' +
    'at least ' + SAMPLE_FLOOR + ' observations.</p>\n' +
    '  <div class="caveat">Below ' + SAMPLE_FLOOR + ' observed departures the rate is not printed. ' +
    'A flight seen three times can read 100% or 0% and neither figure tells you anything, so those ' +
    'rows say <b>' + THIN + '</b> instead. ' + d.thin + ' of the ' + d.rows + ' rows here fall ' +
    'below that floor. The confidence word is the tracker\'s own and it does not follow the ' +
    'observation count: ' + confNote(d.conf) + ', so the two columns are worth reading against ' +
    'each other.</div>\n' +
    jumpNav(d.full) +
    d.full.map(routeTable).join('\n') +
    '\n    <h3>Pairs with no flight history</h3>\n' +
    '    <p>' + d.empty.length + ' more routes sit in the cache with no departures on them. The ' +
    'tracker had no flight on the pair with any Starlink history when it was asked, which is ' +
    THIN + '. They are named here, so a reader who came for one of them gets an answer:</p>\n' +
    emptyList(d.empty) +
    '    <p class="src"><span class="cls cls-m">Measured</span> Every figure above is from ' +
    '<a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">unitedstarlinktracker.com</a>, ' +
    'read through <a href="/united/data.json">united/data.json</a> and cached ' + span + '. ' +
    'Each row prints the date its own answer was cached. Method at ' +
    '<a href="https://unitedstarlinktracker.com/methodology" target="_blank" rel="noopener">the tracker\'s methodology page</a>.</p>\n';
}

module.exports = {
  block: block, model: model, SAMPLE_FLOOR: SAMPLE_FLOOR, THIN: THIN,
  airports: airports
};
