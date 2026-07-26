/* assets/flightcheck.js — the homepage flight check. ~5 KB, no dependencies.
 *
 * THE CONTRACT (same as site.js): the page is already finished before this runs.
 * The form itself is `.needs-js`, so with JS off it is never shown at all and the
 * `.no-js-only` block below it — a link to every airline page — is the answer
 * surface instead. This file only turns that link list into a one-box lookup.
 *
 * IT BAKES NO DATA. The airline index it needs (key, display name, IATA code) is
 * read straight out of the no-JS fallback links that are already in the HTML:
 *
 *     <a class="pill" href="/airlines/qatar/">Qatar Airways <b>100</b></a>
 *
 * so the list cannot drift from the one the build rendered, and this file stays a
 * plain cacheable asset with no generated blob inside it.
 *
 * Everything else comes from our own API, client-side, same origin:
 *   /api/airlines/{key}        — the coarse ConnectScore for a whole fleet
 * No third party is contacted. Nothing is stored.
 *
 * A FLIGHT NUMBER RESOLVES TO ITS AIRLINE, NOT A PER-FLIGHT ANSWER. This box
 * used to call /api/score/{flightNumber} (retired 2026-07-26, spec D7): a
 * flight number with no date can only ever answer "what usually happens on
 * this route," not "will MY flight have it," and typing UA212 here looked
 * like the second question while answering the first. The real per-flight
 * answer is the WiFi Odds browser extension's job — it runs on the airline's
 * own booking page, where the flight AND the date are already known. This box
 * still recognises a flight number so a reader can type one without thinking,
 * but it answers with the fleet-wide ConnectScore, honestly labelled.
 *
 * HONEST TIERING IS THE POINT. The card never shows a number without saying
 * which method produced it (`method` in the response) and what that method can
 * and cannot promise. If the fetch fails we say so and fall back to the links —
 * we never guess a score.
 */
(function () {
  'use strict';
  var doc = document;
  var form = doc.getElementById('fchk');
  var input = doc.getElementById('fchk-q');
  var out = doc.getElementById('fchk-out');
  if (!form || !input || !out) return;

  /* ── the airline index, read off the baked fallback links ─────────────── */
  var AIR = [];
  try {
    Array.prototype.forEach.call(doc.querySelectorAll('.fchk-links a[href^="/airlines/"]'),
      function (a) {
        var key = (a.getAttribute('href') || '').split('/')[2] || '';
        var name = (a.getAttribute('data-name') || '').trim();
        var code = (a.getAttribute('data-code') || '').trim();
        if (key) AIR.push({ key: key, name: name || key, code: code, low: (name || key).toLowerCase() });
      });
  } catch (e) {}

  var EXT = (function () {
    var a = doc.querySelector('.extplug-go') || doc.querySelector('.topnav a.cta');
    return a ? a.getAttribute('href') : null;
  })();

  /* Same thresholds and the same words as build/lib/pages.js band() and
     labelFor() in assets/airlines.js. Duplicated ONLY as CSS class names, never
     as a score. */
  function bandClass(s) {
    return s >= 85 ? 'sc-exc' : s >= 60 ? 'sc-good' : s >= 35 ? 'sc-mix'
      : s >= 20 ? 'sc-long' : s >= 5 ? 'sc-rare' : 'sc-no';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function say(cls, html) { out.className = 'fchk-out ' + cls; out.innerHTML = html; }
  function busy(what) {
    say('is-busy', '<p class="fchk-busy">Checking <b>' + esc(what) + '</b> …</p>');
  }
  function oops(msg) {
    say('is-err', '<p class="fchk-err">' + msg +
      ' <a href="/airlines/">Browse every airline instead →</a></p>');
  }

  /* "ua212" · "UA 212" · "ua-0212" → "UA212". Deliberately the same shape the API
     accepts (parseFlight in functions/_lib/api.mjs); a mismatch here would send a
     request we know will 400. */
  var FLIGHT = /^([A-Z][A-Z0-9])0*(\d{1,4})[A-Z]?$/;
  function asFlight(raw) {
    var s = String(raw || '').toUpperCase().replace(/[\s\-_./]/g, '');
    var m = FLIGHT.exec(s);
    return m ? m[1] + String(parseInt(m[2], 10)) : null;
  }
  function airlineByCode(code) {
    var up = String(code || '').toUpperCase();
    for (var i = 0; i < AIR.length; i++) { if (AIR[i].code && AIR[i].code.toUpperCase() === up) return AIR[i]; }
    return null;
  }
  function asAirline(raw) {
    var s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    var bare = s.replace(/[^a-z]/g, ''), i, a;
    for (i = 0; i < AIR.length; i++) {
      a = AIR[i];
      if (a.low === s || a.key === bare || (a.code && a.code.toLowerCase() === s)) return a;
    }
    for (i = 0; i < AIR.length; i++) {
      a = AIR[i];
      if (a.low.indexOf(s) === 0 || (bare && a.key.indexOf(bare) === 0)) return a;
    }
    for (i = 0; i < AIR.length; i++) { if (AIR[i].low.indexOf(s) >= 0) return AIR[i]; }
    return null;
  }

  /* ── the tier line: what this number is, and what it is not ───────────── */
  function tier(j) {
    var a = j.airline || {};
    if (j.method === 'route-history') {
      var e = j.evidence || {};
      return {
        tag: 'Verified · per-flight',
        cls: 'tv',
        line: 'From ' + (e.observations || 0) + ' recent observation' +
          ((e.observations === 1) ? '' : 's') + ' of ' + esc(j.flight) +
          (e.routeLabel ? ' on ' + esc(e.routeLabel) : '') +
          (e.confidence ? ' · ' + esc(e.confidence) + ' confidence' : '') +
          '. Aircraft assignments change until departure, so this is a historical ' +
          'estimate, not a guarantee.'
      };
    }
    if (a.perFlightOdds) {
      return {
        tag: 'Verified fleet · no history for this flight',
        cls: 'tf',
        line: 'Every ' + esc(a.name) + ' tail is verified, but this flight number is not in our ' +
          'cached route history yet — so the honest answer is the fleet-wide number, not a ' +
          'per-flight one.'
      };
    }
    return {
      tag: 'Coarse · fleet-share estimate',
      cls: 'tc',
      line: 'No verified per-tail feed exists for this fleet yet, so this is a fleet-share model ' +
        'from public announcements. Good enough to choose an airline; not good enough to promise ' +
        'anything about one flight.'
    };
  }

  function fleetLine(a) {
    var f = a.fleet || {};
    var sys = (a.system && a.system.label) || 'unknown system';
    var body = f.total
      ? num(f.equipped) + ' of ' + num(f.total) + ' aircraft carry ' + esc(sys) +
        ' (' + f.equippedPct + '%)'
      : esc(sys) + ' fleetwide';
    var free = a.free && a.free.status;
    var FREE = {
      'free': 'free onboard',
      'loyalty-free': 'free for loyalty members',
      'loyalty-tier': 'free on paid status tiers',
      'partial': 'free on some cabins/routes',
      'unknown': 'free status unconfirmed',
      'paid': 'paid'
    };
    return body + (free ? ' · ' + (FREE[free] || free) : '');
  }

  function card(j) {
    var a = j.airline || {};
    var t = tier(j);
    var perFlight = typeof j.prob === 'number';
    var big = perFlight ? j.prob : a.connectScore;
    var unit = perFlight ? '%' : '<small>/100</small>';
    var head = j.flight
      ? esc(j.flight) + ' <span class="fa-air">' + esc(a.name) + '</span>'
      : esc(a.name);
    var deeper = a.perFlightOdds
      ? (j.moreDetail || a.url)
      : a.url;
    var deepLabel = a.perFlightOdds
      ? esc(a.name) + ', tail by tail →'
      : esc(a.name) + '’s full scorecard →';

    return '<div class="fa">' +
      '<div class="fa-h">' +
      '<div class="fa-big ' + bandClass(big) + '"><b>' + big + '</b>' + unit + '</div>' +
      '<div class="fa-t"><h3>' + head + '</h3>' +
      '<p class="fa-what">' + (perFlight
        ? 'odds this flight is flown by a Starlink aircraft'
        : 'ConnectScore — the odds of the good system on a random flight, ' +
          'weighted by whether it is free for you') + '</p></div>' +
      '<span class="band ' + bandClass(a.connectScore) + ' fa-band">' + esc(a.band) + '</span>' +
      '</div>' +
      '<p class="fa-tier"><span class="fa-tag ' + t.cls + '">' + t.tag + '</span> ' + t.line + '</p>' +
      '<p class="fa-fleet">' + fleetLine(a) + (a.note ? ' — ' + esc(a.note) : '') + '</p>' +
      '<div class="fa-links">' +
      '<a href="' + esc(deeper) + '">' + deepLabel + '</a>' +
      '<a href="/methodology/">How we know, and how sure →</a>' +
      (a.tracker ? '<a href="https://' + esc(a.tracker) + '" target="_blank" rel="noopener">Tails: ' +
        esc(a.tracker) + ' ↗</a>' : '') +
      '</div>' +
      (EXT ? '<p class="fa-ext">Want this on the booking page itself? ' +
        '<a href="' + esc(EXT) + '" target="_blank" rel="noopener">Get the free extension ↗</a></p>' : '') +
      '<p class="fa-as">Data as of ' + esc(j.asOf || a.asOf || '—') + '.</p>' +
      '</div>';
  }

  function get(url, onOk) {
    var done = false;
    fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (r) {
      done = true;
      if (r.ok) { onOk(r.j); return; }
      var e = r.j && r.j.error;
      if (e === 'unknown_airline_prefix') {
        oops('We don’t track airline <b>' + esc((r.j && r.j.prefix) || '') + '</b> yet, so there is ' +
          'no ConnectScore for it.');
      } else if (e === 'unparseable_flight') {
        oops('That doesn’t look like a flight number or an airline we know.');
      } else {
        oops('The lookup came back with an error' + (r.j && r.j.message ? ': ' + esc(r.j.message) : '.'));
      }
    }).catch(function () {
      if (!done) oops('The lookup couldn’t reach our API just now.');
    });
  }

  function run() {
    var raw = input.value;
    if (!String(raw || '').trim()) {
      say('', '');
      input.focus();
      return;
    }
    var fn = asFlight(raw);
    if (fn) {
      /* A flight number resolves to its AIRLINE, never a per-flight answer —
         /api/score/{flightNumber} is retired (spec D7). Same code path as
         typing the airline name, just with the flight number carried through
         so the card header still reads "UA212 United." */
      var fm = FLIGHT.exec(String(raw || '').toUpperCase().replace(/[\s\-_./]/g, ''));
      var air = fm ? airlineByCode(fm[1]) : null;
      if (!air) {
        oops('We don’t track airline <b>' + esc(fm ? fm[1] : '') +
          '</b> yet, so there is no ConnectScore for <b>' + esc(fn) + '</b>.');
        return;
      }
      busy(fn);
      get('/api/airlines/' + encodeURIComponent(air.key), function (j) {
        var a2 = j.airline || {};
        say('is-ok', card({
          flight: fn, airline: a2, prob: null, connectScore: a2.connectScore,
          method: 'airline-coarse', evidence: null, asOf: a2.asOf, moreDetail: a2.url
        }));
      });
      return;
    }
    var a = asAirline(raw);
    if (a) {
      busy(a.name);
      /* /api/airlines/{key} answers {airline:{…}}; card() wants the same flat
         envelope the flight-number branch above builds. Normalise the airline
         reply into it — method is honestly "airline-coarse", no per-flight
         number. */
      get('/api/airlines/' + encodeURIComponent(a.key), function (j) {
        var air = j.airline || {};
        say('is-ok', card({
          flight: null, airline: air, prob: null, connectScore: air.connectScore,
          method: 'airline-coarse', evidence: null, asOf: air.asOf, moreDetail: air.url
        }));
      });
      return;
    }
    oops('We couldn’t read “' + esc(String(raw).trim()) + '” as a flight number or an airline we track.');
  }

  form.addEventListener('submit', function (ev) { ev.preventDefault(); run(); });

  /* A ?q= in the URL runs the check on arrival — that is what makes an answer
     shareable, and it is also the shape the form would GET to /airlines/ if this
     script never loaded. */
  try {
    var pre = new URLSearchParams(location.search).get('q');
    if (pre) { input.value = pre; run(); }
  } catch (e) {}
})();
