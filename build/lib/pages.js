'use strict';
/* build/lib/pages.js — the page bodies. Every number, row and chart path in here
 * is rendered at BUILD time, which is the whole freshness architecture: the daily
 * data.json commit triggers a Pages rebuild and every page re-bakes. Client JS
 * only sorts, filters, toggles the theme and animates. Every page works with JS
 * disabled — that is a hard acceptance criterion, not an aspiration. */

var H = require('./html.js');
var V = require('./viz.js');
var DL = require('./data.js');
var C = require('./reel.js');
/* the rollout phase words. market.js requires nothing, so this cannot cycle. */
var MK = require('./market.js');
var esc = H.esc, num = DL.num;

function band(s) {
  return s >= 85 ? 'sc-exc' : s >= 60 ? 'sc-good' : s >= 35 ? 'sc-mix'
    : s >= 20 ? 'sc-long' : s >= 5 ? 'sc-rare' : 'sc-no';
}
var FREE = {
  'free': 'free onboard',
  'loyalty-free': 'free for loyalty members',
  'loyalty-tier': 'free on paid status tiers',
  'partial': 'free on some cabins/routes',
  'unknown': 'free status unconfirmed',
  'paid': 'paid'
};
function freeText(f) { return FREE[String(f || 'unknown').toLowerCase()] || '—'; }
function sysClass(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, '') || 'legacy'; }
function tagsFor(e) {
  var t = [String(e.system || '').toLowerCase()];
  if (t[0] === 'viasat' || t[0] === '2ku' || t[0] === 'intelsat' || t[0] === 'geo') t.push('legacy');
  if (e.future && e.future.system === 'leo') t.push('leo');
  if (e.free === 'free') t.push('freeall');
  return t.join(' ');
}

/* ── PROVENANCE: every figure carries a class, a source and a date ────────
 * Four words, and a figure on this site gets exactly one of them. VENDOR CLAIM
 * is a spec sheet. MEASURED is somebody who ran the test and published the
 * method. REPORTED is a press release or a trade outlet. FIELD REPORT is one
 * reader on one flight.
 *
 * The chips are monochrome on purpose and the rule is not negotiable: colour on
 * this site means score band, so a provenance tag in green would compete with
 * the arc and break the one rule the whole palette rests on. They separate by
 * border weight and border style instead. */
var CLS = {
  vendor: ['cls', 'Vendor claim'],
  measured: ['cls cls-m', 'Measured'],
  reported: ['cls', 'Reported'],
  field: ['cls cls-f', 'Field report']
};
function cls(kind) {
  var c = CLS[kind] || CLS.reported;
  return '<span class="' + c[0] + '">' + c[1] + '</span>';
}
/* A source line. The class, then who said it, then when they said it. A figure
 * without all three is an assertion, and this site does not publish those. */
function srcLine(kind, text) {
  return '<p class="src">' + cls(kind) + ' ' + text + '</p>';
}

/* ── THE PROJECTED SCORE, AND THE ONE WAY IT MAY BE RENDERED ──────────────
 * This is the only function on the site that prints a projected number, and it
 * exists so there is one place to check rather than a convention to remember.
 * build/prerender.js walks the built HTML and fails the build on every unit it
 * finds that does not honour the contract below.
 *
 *   <span class="proj" data-projected="american">
 *     <span class="pv">51</span>
 *     <span class="ph">installs begin 2027-Q1</span>
 *     <span class="conf">FIRM</span>
 *   </span>
 *
 * The value, the horizon phrase and the confidence word are one inseparable
 * visual unit. Nothing inside it may set --band: no sc-* class, no [data-band],
 * no var(--band) in an inline style. Green, amber and red mean measured, and
 * nobody has measured an aircraft that has not been built yet.
 *
 * `slipped` adds a hatched ground and KEEPS SHOWING the date that was missed.
 * It is derived from the build date inside assets/airlines.js, so a missed
 * promise does not depend on anyone noticing it. */
function projected(a) {
  var p = a && a.projected;
  if (!p) return '';
  return '<span class="proj' + (p.slipped ? ' slipped' : '') +
    '" data-projected="' + esc(a.key) + '">' +
    '<span class="pv">' + p.score + '</span>' +
    '<span class="ph">' + esc(p.horizon) + '</span>' +
    '<span class="conf' + (p.slipped ? ' slip' : '') + '">' + esc(p.confidence) + '</span></span>';
}
/* The same unit in a table cell. Where an airline has published no forward date
 * the cell says so in words. A dash there would read as a zero, and "nobody has
 * announced anything" and "the projection is zero" are different claims. */
function projCell(a, blank) {
  return a && a.projected ? projected(a)
    : '<span class="micro">' + esc(blank || 'No date published') + '</span>';
}

/* A score drawn as a length. The 40 and 60 ticks are the band thresholds, so a
 * reader can see which side of them a fleet sits on without reading the word. */
function tape(v) {
  return '<div class="tape" style="margin:0"><i style="width:' + Math.max(0, Math.min(100, v)) +
    '%"></i><span class="tk" style="left:40%"></span><span class="tk" style="left:60%"></span></div>';
}

/* ── §3 THE FIELD: all eighteen, in ONE view ──────────────────────────────
 * The homepage used to carry three different pictures of the same field: a
 * three-card race teaser, a systems teaser and the US card row. Three surfaces,
 * one question, and a reader had to reconcile them. This is the single ranked
 * view: every airline we score, the number, the number as a length, the phase
 * it is in, and the forward figure where one exists.
 *
 * Ranked on ConnectScore, which is what is flying. The projected column carries
 * "does not sort" in its own header and its <th> has no data-k, so the client
 * sorter cannot reach it. */
function fieldTable(m) {
  var rows = m.ranked.map(function (a, i) {
    var ph = MK.phaseOf(m.A, a);
    return '      <tr data-f="' + ph + '">' +
      '<td class="rank">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</td>' +
      '<td><a class="aname" href="/airlines/' + a.key + '/">' + esc(a.name) +
      '<span class="code">' + esc(a.code || '') + '</span></a></td>' +
      '<td class="num ' + band(a.score) + '"><span class="sco">' + a.score + '</span></td>' +
      '<td class="' + band(a.score) + '" style="width:22%;min-width:110px">' + tape(a.score) + '</td>' +
      '<td class="micro">' + esc(MK.PHASE_LABEL[ph]) + '</td>' +
      '<td class="num">' + projCell(a, ph === 'done' ? 'Rollout complete' : 'No date published') +
      '</td></tr>';
  }).join('\n');

  return '<div class="tbl-shell rv"><table class="tbl">\n' +
    '    <thead><tr><th>#</th><th>Airline</th><th class="num">ConnectScore</th>' +
    '<th>Scale · 0 to 100</th><th>Programme state</th>' +
    '<th class="num">Projected · does not sort</th></tr></thead>\n' +
    '    <tbody>\n' + rows + '\n    </tbody>\n  </table></div>\n';
}

/* ── §3.2 ConnectScore leaderboard, baked <table> ───────────────────────── */
function leaderboard(m, limit) {
  var rows = m.ranked.slice(0, limit || m.ranked.length).map(function (a, i) {
    var e = m.A.WIFI_AIRLINES[a.key];
    var pct = Math.round(a.parts.pctEquipped * 100);
    var fleetCell = a.fleet
      ? '<span class="mono">' + num(a.equipped) + ' / ' + num(a.fleet) + '</span>' +
        '<span class="track mini"><i class="fill" style="--pct:' + pct + '%"></i></span>'
      : '<span class="mono">fleetwide</span>';
    var fut = a.future
      ? ' <span style="color:var(--faint)">→ ' +
        esc(a.future.system === 'leo' ? 'Amazon Leo' : a.future.system) + ' ' + esc(a.future.from) + '</span>'
      : '';
    return '      <tr class="arow' + (a.instrumented ? ' instr' : '') + '" data-f="' + tagsFor(e) +
      '" data-q="' + esc((a.name + ' ' + (a.code || '')).toLowerCase()) + '">' +
      '<td class="rank" data-s="' + (i + 1) + '">' + (i + 1) + '</td>' +
      '<td><a class="aname" href="/airlines/' + a.key + '/">' + esc(a.name) +
      '<span class="code">' + esc(a.code || '') + '</span></a>' +
      (a.instrumented ? ' <a class="pill" href="' + (a.key === 'united' ? '/united/' : '/alaska/') +
        '">Per-flight odds →</a>' : '') + '</td>' +
      '<td data-s="' + a.score + '"><span class="sco">' + a.score + '</span> ' +
      '<span class="band ' + band(a.score) + '">' + esc(a.label) + '</span></td>' +
      '<td data-s="' + esc(a.systemLabel) + '"><span class="sysdot ' + sysClass(a.system) +
      '"></span>' + esc(a.systemLabel) + fut + '</td>' +
      '<td data-s="' + (a.parts.pctEquipped).toFixed(4) + '">' + fleetCell + '</td>' +
      '<td data-s="' + esc(e.free || 'unknown') + '">' + esc(freeText(e.free)) + '</td>' +
      '<td class="note hide-sm">' + esc(a.note) + '</td></tr>';
  }).join('\n');

  return '<div class="tbl-shell rv"><table class="tbl" id="lbTable">\n' +
    '    <thead><tr><th data-k="rank" data-t="num">#</th><th data-k="name">Airline</th>' +
    /* aria-sort is baked because the table really IS sorted by score desc on
       arrival — which also makes the first click on that header flip to ascending
       instead of re-applying the order it already has. */
    '<th data-k="score" data-t="num" aria-sort="descending">ConnectScore</th><th data-k="sys">System</th>' +
    '<th data-k="fleet" data-t="num">Fleet equipped</th><th data-k="free">Free</th>' +
    '<th class="hide-sm">Note</th></tr></thead>\n    <tbody>\n' + rows + '\n    </tbody>\n' +
    '  </table></div>\n';
}

/* ── §3.1b US airlines at a glance — the homepage's first data surface ────
 * What used to sit here: a 4-KPI strip in which TWO of the four cells were
 * United's rollout trivia (481 equipped, 27% of the fleet) — one airline's
 * numbers presented as the site's headline — followed by the global top-8
 * ConnectScore leaderboard. The leaderboard is honestly sorted, which is exactly
 * the problem on a US homepage: airBaltic, JSX and ZIPAIR take the podium with
 * 139 aircraft between them that a US visitor will never board. Owner feedback,
 * verbatim: "US flyers care most about American, Delta, United, Southwest,
 * Alaska, JetBlue."
 *
 * So US_MAJORS is a FIXED, EDITORIAL set — seven carriers, hand-picked, and it
 * must NOT become a filter over the data (there is no `country` field in
 * assets/airlines.js to filter on, and inventing one to re-derive this list would
 * be a lie dressed as a rule). Within the set the ORDER is data: ConnectScore
 * desc, ties alphabetically, the same comparator as A.rankAirlines(). Membership
 * is the only opinion here.
 *
 * The full 18 are one click away at /airlines/, which still carries the whole
 * sortable table. Do not re-add it here.
 *
 * NOTE ON THE SCORES: American, Delta and jetBlue still outrank United and
 * Alaska on ConnectScore, and that is not a bug — free modern GEO across most of
 * a fleet scores 0.55 × 1.0 on most of its rows, while a quarter-finished
 * Starlink fleet earns its Starlink points on 30% of its rows and legacy points
 * on the rest. The status line under each name says which, so nobody reads "51"
 * as "Starlink". The cards lead with the NEXT-GEN number for that reason. */
var US_MAJORS = ['american', 'delta', 'united', 'southwest', 'alaska', 'jetblue', 'hawaiian'];

/* ── THE TWO LINES ON EVERY CARD ──────────────────────────────────────────
 * These cards used to carry ONE line and ONE number, the ConnectScore, and that
 * was the site's most misleading surface. Delta showed 60 on free fleetwide
 * Viasat; United showed 27 on a quarter-finished Starlink fleet. Both numbers are
 * right. Side by side, in 21px mono, they say "Delta's WiFi beats United's
 * Starlink" — a comparison no reader asked for and neither number makes.
 *
 * So: two lines, and the headline is now the NEXT-GEN number.
 *   nextGenLine  odds of a Starlink or Amazon Leo aircraft. Delta reads
 *                "Next-gen: 0 (Amazon Leo signed, 2028)" — the deal is named,
 *                because it is real, and scored zero, because it is not flying.
 *   todayLine    what you actually get if you board tomorrow. This is where free
 *                fleetwide Viasat gets its due: "streaming-class fleetwide, free
 *                onboard" is a good answer, and a nextGenScore of 0 on its own
 *                would have read as "nothing".
 * The ConnectScore has not gone anywhere — it is the card's footer line, so the
 * homepage and /airlines/ can be reconciled by anyone who wonders why the order
 * differs.
 *
 * `<1%` rather than a rounded `0%` for Southwest: 1 of 817 really is one aircraft,
 * and "0%" reads as "none", which is false. */
function pctText(share) {
  var raw = share * 100;
  return raw > 0 && raw < 1 ? '<1%' : Math.round(raw) + '%';
}

/* THE DENOMINATOR ON THIS LINE IS `known`, NOT `fleet`, wherever the two differ.
 * United is 481 of 1,808 aircraft and 481 of 1,579 aircraft whose system the
 * tracker publishes, which is 27% and 30%. The share the next-gen number is
 * built from is the second one, so this line has to print the second denominator
 * or the card would show 30 next to an arithmetic that gives 27. It says which
 * denominator it is using rather than leaving the reader to reconcile it. */
function nextGenLine(m, a) {
  if (a.nextGenScore > 0 || a.nextGenSystem) {
    var count = a.known && a.known !== a.fleet
      ? num(a.equipped) + ' of ' + num(a.known) + ' with a published system'
      : a.fleet ? num(a.equipped) + ' of ' + num(a.fleet)
        : a.known ? num(a.equipped || 0) + ' of ' + num(a.known) : null;
    return 'Next-gen: ' + a.nextGenScore + ' · ' + a.nextGenLabel +
      (count ? ' on ' + count + ' (' + pctText(a.nextGenShare) + ')' : ' on the whole fleet');
  }
  if (a.future) {
    return 'Next-gen: 0 (' + (m.A.SYSTEM_LABEL[a.future.system] || a.future.system) +
      ' signed, ' + a.future.from + ')';
  }
  return 'Next-gen: 0 · nothing signed';
}

function todayLine(m, a, e) {
  var bits = [];
  if (a.serviceTier === 'mixed') {
    bits.push(a.nextGenLabel + ' ' + pctText(a.nextGenShare) + ', rest ' +
      (a.restTierLabel || 'older satellite service'));
  } else if (a.serviceTier === 'next-gen') {
    bits.push(a.nextGenLabel + ' fleetwide');
  } else {
    /* "fleetwide" is a CLAIM about coverage, so it has to be checked against the
     * coverage number rather than assumed from the tier. Delta was the case that
     * broke it: streaming-tier, but Sync reaches ~86% of the fleet, with the 80
     * Boeing 717s carrying nothing at all since May 2026. American is the same
     * shape at ~90%. Only say fleetwide when the share actually is. */
    var share = a.parts && typeof a.parts.pctEquipped === 'number'
      ? a.parts.pctEquipped : 1;
    bits.push(share >= 0.99
      ? a.serviceTierLabel + ' fleetwide'
      : a.serviceTierLabel + ' on ' + pctText(share) + ' of the fleet');
    if (a.restTierLabel) bits.push('the rest ' + a.restTierLabel + ' or none');
  }
  bits.push(freeText(e.free));
  return 'Today: ' + bits.join(' · ');
}

/* Kept for compatibility with anything that still wants the one-liner. */
function usStatus(m, a, e) { return todayLine(m, a, e); }

/* The set, scored and ordered. ONE function, because the row and the page's
 * ItemList must not be able to disagree about either membership or order.
 *
 * ORDERED BY NEXT-GEN ODDS, which is the headline the cards now show. Ties fall
 * back to the ConnectScore so the three US carriers sitting at next-gen 0 still
 * order sensibly among themselves (American 51, jetBlue 55, Delta 49), then by
 * name. /airlines/ keeps the ConnectScore sort — two orders, two questions, and
 * both pages say which one they are answering. */
function usRanked(m) {
  return US_MAJORS.map(function (k) { return m.A.scoreAirline(k); })
    .filter(Boolean)
    .sort(function (a, b) {
      if (b.nextGenScore !== a.nextGenScore) return b.nextGenScore - a.nextGenScore;
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
}

function usGlance(m) {
  return '  <div class="usrow">' + usRanked(m).map(function (a) {
    var e = m.A.WIFI_AIRLINES[a.key];
    return '<a class="card rv uscard" href="/airlines/' + a.key + '/">' +
      '<div class="ush"><h3>' + esc(a.name) + '</h3>' +
      '<span class="sco">' + a.nextGenScore + '</span>' +
      '<span class="band ' + band(a.nextGenScore) + '">' +
      esc(m.A.labelFor(a.nextGenScore)) + '</span></div>' +
      '<p class="usng">' + esc(nextGenLine(m, a)) + '</p>' +
      '<p class="usnow">' + esc(todayLine(m, a, e)) + '</p>' +
      '<p class="uscs">ConnectScore ' + a.score + ' · ' + esc(a.label) + '</p></a>';
  }).join('') + '</div>\n';
}

/* ── §2 HOW WE KNOW: the instrumentation ladder ───────────────────────────
 * The tier an answer was derived at is part of the answer, not a disclaimer
 * under it. A 27 read off a tail record and a 27 read off a fleet percentage
 * are different claims about the world.
 *
 * THE SPLIT IS DERIVED. `instrumented` in assets/airlines.js is the flag and
 * United is the only fleet with a per-flight route history in data.json, so the
 * three rows fall out of the data. A hand-maintained list would rot the day
 * Hawaiian lands. */
function tierRows(m) {
  var verified = m.ranked.filter(function (a) { return a.key === 'united'; });
  var derived = m.ranked.filter(function (a) { return a.instrumented && a.key !== 'united'; });
  var coarse = m.ranked.filter(function (a) { return !a.instrumented; });
  function names(list) { return list.map(function (a) { return a.name; }).join(', ') || 'none'; }
  return [
    ['A', 'Tail-verified', 'The aircraft on your flight is resolved to a registration, and that ' +
      'registration to an install record.', names(verified),
      'A number for one flight, with the sample size attached.'],
    ['B', 'Type-derived', 'The tails are verified the same way and nobody publishes which aircraft ' +
      'is scheduled onto which flight, so there is no history to count.', names(derived),
      'A number for an aircraft type. Not for a departure.'],
    ['C', 'Fleet-share', 'No per-tail verification exists, so the input is what the airline itself ' +
      'said publicly about how many aircraft are equipped.', names(coarse),
      'A number for an airline. Nothing narrower.'],
    ['D', 'Announced only', 'A signed deal with nothing in the air. Today’s odds are zero and the ' +
      'projected figure carries the forward view, fenced, in grey.',
      m.ranked.filter(function (a) { return a.projected; })
        .map(function (a) { return a.name; }).join(', ') || 'none',
      'A promise with a year on it. Never a measurement.']
  ];
}
function tierTable(m) {
  var rows = tierRows(m).map(function (t) {
    return '      <tr><td class="mono"><b>' + t[0] + '</b></td>' +
      '<td><b>' + esc(t[1]) + '</b><div class="note" style="margin-top:3px">' + esc(t[2]) +
      '</div></td><td class="micro">' + esc(t[3]) + '</td>' +
      '<td class="hide-sm">' + esc(t[4]) + '</td></tr>';
  }).join('\n');
  return '<div class="tbl-shell rv"><table class="tbl">\n' +
    '    <thead><tr><th>Tier</th><th>What was checked</th><th>Airlines</th>' +
    '<th class="hide-sm">What you can conclude</th></tr></thead>\n' +
    '    <tbody>\n' + rows + '\n    </tbody>\n  </table></div>\n';
}

/* ── FIELD REPORTS ────────────────────────────────────────────────────────
 * One reader, one flight, one speed test. These sit BESIDE the peer-reviewed
 * medians and never inside them, and no field report has ever moved a
 * ConnectScore. Every row is attributed and dated so a reader can weigh it.
 * See build/lib/reports.js for the read path. */
function reportTable(list, caption) {
  if (!list || !list.length) return '';
  var rows = list.map(function (r) {
    function n(v, unit) {
      return v === null || v === undefined ? '<span class="micro">not run</span>'
        : v + (unit || '');
    }
    return '      <tr><td class="mono">' + esc(r.flownOn) + '</td>' +
      '<td class="mono">' + esc(r.flightNumber) + '</td>' +
      '<td>' + esc(r.route || 'not given') + '</td>' +
      '<td>' + esc(r.aircraft || 'not given') + '</td>' +
      '<td><span class="sysdot ' + sysClass(r.system) + '"></span>' + esc(r.systemLabel) + '</td>' +
      '<td class="num">' + n(r.downMbps) + '</td>' +
      '<td class="num">' + n(r.upMbps) + '</td>' +
      '<td class="num">' + n(r.latencyMs, ' ms') + '</td>' +
      '<td>' + esc(r.credit || 'anonymous') + '</td></tr>';
  }).join('\n');
  return '<div class="tbl-shell rv"><table class="tbl">\n' +
    (caption ? '    <caption class="micro" style="text-align:left;padding-bottom:10px">' +
      esc(caption) + '</caption>\n' : '') +
    '    <thead><tr><th>Flown</th><th>Flight</th><th>Route</th><th>Aircraft</th><th>System</th>' +
    '<th class="num">Down</th><th class="num">Up</th><th class="num">Latency</th>' +
    '<th>Reported by</th></tr></thead>\n' +
    '    <tbody>\n' + rows + '\n    </tbody>\n  </table></div>\n';
}

/* ── THE INTAKE FORM ──────────────────────────────────────────────────────
 * POSTs to /api/report (functions/_lib/reports.mjs). Read that file's header
 * before changing a name here: the field table over there IS the contract, and
 * a field this form invents is rejected by name rather than silently dropped.
 *
 * WORKS WITH JAVASCRIPT OFF. This is a real <form method="post">, so a browser
 * with no script posts urlencoded and the endpoint accepts it. The script in
 * methodologyPage()'s afterWrap only upgrades that to a fetch so the errors can
 * land next to the inputs instead of replacing the page.
 *
 * THE HONEYPOT IS THE CAPTCHA. Turnstile, reCAPTCHA and hCaptcha are all
 * third-party scripts and this site makes zero third-party requests, so the
 * anti-abuse story is an off-screen empty field plus server-side rate limiting
 * on a hashed address. A person never sees `website`; a bot fills everything. */
var REPORT_SYSTEMS = [
  ['starlink', 'Starlink'], ['leo', 'Amazon Leo'], ['viasat', 'Viasat'],
  ['panasonic', 'Panasonic'], ['intelsat', 'Intelsat or 2Ku'], ['hughes', 'Hughes'],
  ['none', 'There was no wifi to test'], ['unsure', 'The portal did not say']
];
function field(id, name, label, attrs, hint) {
  return '      <div class="ff"><label for="' + id + '">' + esc(label) + '</label>' +
    '<input id="' + id + '" name="' + name + '" ' + attrs +
    ' aria-describedby="e-' + name + '">' +
    (hint ? '<span class="fh">' + esc(hint) + '</span>' : '') +
    '<p class="ferr" id="e-' + name + '" role="alert"></p></div>\n';
}
function reportForm(m) {
  var opts = REPORT_SYSTEMS.map(function (s) {
    return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>';
  }).join('');
  return '  <form class="frm" id="rform" method="post" action="/api/report" ' +
    'enctype="application/x-www-form-urlencoded">\n' +
    /* off-screen, empty, and never focusable. See the note above. */
    '    <div class="hp" aria-hidden="true"><label for="f-website">Leave this empty</label>' +
    '<input id="f-website" name="website" type="text" value="" tabindex="-1" autocomplete="off">' +
    '</div>\n' +
    '    <p class="ferr frm-top" id="e-_body" role="alert"></p>\n' +
    '    <div class="ffgrid">\n' +
    field('f-flownon', 'flownOn', 'Date you flew', 'type="date" required max="' + esc(m.updated) + '"') +
    field('f-airline', 'airline', 'Airline', 'type="text" required maxlength="60" placeholder="United"') +
    field('f-flight', 'flightNumber', 'Flight number',
      'type="text" required spellcheck="false" autocapitalize="characters" placeholder="UA2402"') +
    '      <div class="ff"><label for="f-system">System</label>' +
    '<select id="f-system" name="system" required aria-describedby="e-system">' +
    '<option value="">Pick one</option>' + opts + '</select>' +
    '<span class="fh">The captive portal usually names it.</span>' +
    '<p class="ferr" id="e-system" role="alert"></p></div>\n' +
    field('f-route', 'route', 'Route', 'type="text" spellcheck="false" placeholder="IAH-SFO"') +
    field('f-aircraft', 'aircraft', 'Aircraft type or tail',
      'type="text" spellcheck="false" placeholder="737-9 MAX or N27273"') +
    field('f-down', 'downMbps', 'Download, Mbps', 'type="text" inputmode="decimal" placeholder="143"') +
    field('f-up', 'upMbps', 'Upload, Mbps', 'type="text" inputmode="decimal" placeholder="18"') +
    field('f-lat', 'latencyMs', 'Latency, ms', 'type="text" inputmode="numeric" placeholder="52"') +
    '      <div class="ff"><label for="f-free">Cost onboard</label>' +
    '<select id="f-free" name="wasFree" aria-describedby="e-wasFree">' +
    '<option value="">Not saying</option><option value="true">It was free</option>' +
    '<option value="false">I paid for it</option></select>' +
    '<p class="ferr" id="e-wasFree" role="alert"></p></div>\n' +
    field('f-credit', 'credit', 'Name or handle to credit',
      'type="text" maxlength="60" placeholder="How the row should read"') +
    '      <div class="ff full"><label for="f-note">Anything else worth knowing</label>' +
    '<textarea id="f-note" name="note" maxlength="500" rows="3" aria-describedby="e-note" ' +
    'placeholder="How full the cabin was, what the portal charged, what broke"></textarea>' +
    '<p class="ferr" id="e-note" role="alert"></p></div>\n' +
    '    </div>\n' +
    '    <div class="frm-ft">\n' +
    '      <p class="note">One measurement is enough: download, upload or latency. Pick ' +
    '&ldquo;there was no wifi to test&rdquo; if there was nothing to measure. Every submission ' +
    'lands unpublished and a person reads it before it appears here. No account, no cookie, no ' +
    'analytics, and the only thing kept about you is the name you type in the credit box.</p>\n' +
    '      <button class="btn" type="submit">Send the reading</button>\n' +
    '    </div>\n' +
    '    <p class="frm-ok" id="rform-ok" role="status"></p>\n' +
    '  </form>\n';
}

/* ── §3.8 route-odds teaser ─────────────────────────────────────────────── */
function routePills(m) {
  if (!m.leaderboard.length) {
    return '<div class="steady">No cached route leaderboard in today’s data pull.</div>';
  }
  return '<div>' + m.leaderboard.map(function (r) {
    return '<a class="pill" href="/united/"><b>' + esc(r.route.replace('-', '–')) + '</b> · ' +
      r.departures + ' Starlink departures/48h' + (r.next ? ' · next in ' + esc(r.next) : '') + '</a>';
  }).join('') + '</div>';
}

/* ── §3.1 KPI cards ─────────────────────────────────────────────────────── */
function kpi(n, label, detail, cls) {
  return '<div class="chip rv ' + (cls || '') + '"><div class="n cu">' + n + '</div>' +
    '<div class="l">' + label + '</div><div class="d">' + detail + '</div></div>';
}

var ROADMAP = [
  ['building', 'Tail-swap Guardian', 'Watches your booked flight for equipment swaps, booking to boarding. ' +
    'Prototype built; ships with extension 2.1.'],
  ['building', 'More airlines, in rollout order', 'Hawaiian next, which has the best US Starlink odds at 42 of 66, ' +
    'then the near-complete fleets: WestJet, Air France, airBaltic, JSX. Each gets the United treatment ' +
    'as instrumentation lands.'],
  ['planned', 'PWA', 'Installable, offline ConnectScores, and push notifications for Guardian alerts.'],
  /* v0 is live. The status word here is read off what actually answers a curl:
     the endpoints below are real, the date-scoped variant in the original plan is
     not, so it stays out of the description rather than being implied by it. */
  ['shipped', 'Public ConnectScore API', 'Live now: <code>GET /api/airlines</code>, ' +
    '<code>GET /api/airlines/qatar</code> and <code>GET /api/score/UA212</code>. Free, no key, ' +
    'CORS open, credits in every response body. <a href="/api/docs/">Read the API docs →</a>'],
  ['shipped', 'The rollout archive', 'The daily install history grows into the industry’s rollout record; ' +
    'every new airline inherits its priors.']
];
function roadmapSteps(limit) {
  return '<div class="steps rm">' + ROADMAP.slice(0, limit || ROADMAP.length).map(function (s) {
    return '<div class="step ' + s[0] + ' rv"><div class="sh"><h3>' + s[1] + '</h3>' +
      '<span class="st">' + s[0] + '</span></div><p>' + s[2] + '</p></div>';
  }).join('') + '</div>';
}

/* ── §A the flight check — the above-the-fold ANSWER ──────────────────────
 * The first screenful used to describe our ability to answer the stranger's
 * question ("will MY flight have WiFi that works?") and then hand them a
 * leaderboard whose top three are airBaltic, JSX and ZIPAIR. This box answers it
 * instead: one input, one card, from /api/score/{flightNumber} (per-flight where
 * we have route history) or /api/airlines/{key} (the coarse fleet score).
 *
 * PROGRESSIVE ENHANCEMENT, and read this before you touch the classes:
 *   - the whole box is `.needs-js`, so with JS off it is NEVER SHOWN. There is no
 *     dead input on the page.
 *   - `.no-js-only` under it is the real no-JS answer surface: a link to every
 *     airline page, each carrying the same score, method and tier.
 *   - the wrapper carries `.needs-js`, not the <form>. `html.js .needs-js{display:
 *     revert}` outranks a plain `.fchk-form{display:flex}`, so putting the marker
 *     on the flex element would silently un-flex it. Marker on a plain <div>,
 *     layout on the children.
 *   - those fallback links ARE the data source for assets/flightcheck.js — it
 *     reads key/name/code off them (hence data-name / data-code) rather than
 *     carrying a generated copy of the airline table. One list, baked once.
 *   - the form still has a real action/method, so a browser with JS on but our
 *     script blocked lands on /airlines/ instead of doing nothing. */
function flightCheck(m) {
  var links = m.ranked.map(function (a) {
    return '<a class="pill" href="/airlines/' + a.key + '/" data-name="' + esc(a.name) +
      '" data-code="' + esc(a.code || '') + '">' + esc(a.name) + ' <b>' + a.score + '</b></a>';
  }).join('');
  var opts = m.ranked.map(function (a) {
    return '<option value="' + esc(a.name) + '"></option>';
  }).join('');
  return '  <div class="fchk needs-js">\n' +
    '    <form class="fchk-form" id="fchk" action="/airlines/" method="get" role="search">\n' +
    '      <label class="fchk-lb" for="fchk-q">Flight number, or airline</label>\n' +
    '      <div class="fchk-row">\n' +
    '        <input class="fchk-in" id="fchk-q" name="q" type="search" list="fchk-air" ' +
    'autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search" ' +
    'placeholder="UA212 · AS15 · Qatar" aria-describedby="fchk-hint">\n' +
    '        <button class="btn fchk-go" type="submit">Check the odds →</button>\n' +
    '      </div>\n' +
    '      <datalist id="fchk-air">' + opts + '</datalist>\n' +
    '      <p class="fchk-hint" id="fchk-hint">Any flight number works: <b>UA212</b>, <b>AS15</b>, ' +
    '<b>AA1234</b>. An airline name works too. The answer comes from our own daily-verified data ' +
    'and the card names the method it used. No account, nothing stored.</p>\n' +
    '    </form>\n' +
    '    <div class="fchk-out" id="fchk-out" role="status" aria-live="polite"></div>\n' +
    '  </div>\n' +
    '  <div class="fchk-nojs no-js-only">\n' +
    '    <p class="fchk-hint">The live check needs JavaScript. Pick your airline instead. Every ' +
    'page below carries the same ConnectScore, the method behind it, and how much to trust it.</p>\n' +
    '    <div class="fchk-links">' + links + '</div>\n' +
    '    <p class="fchk-hint"><a href="/airlines/">All ' + m.airlineCount +
    ' airlines, ranked →</a> · <a href="/methodology/">How we know →</a></p>\n' +
    '  </div>\n';
}

/* ── the full extension section ───────────────────────────────────────────
 * The demo is built by build/lib/reel.js: ONE sequence over the TWO REAL
 * screenshots in assets/, with four captions — search → odds → sort → guard. It
 * replaced 883 lines of hand-drawn fake united.com/Navan UI, two scenes of which
 * demonstrated the same sort twice. Read the header of reel.js before touching
 * it; the short version is that we already owned photographs of the product and
 * were shipping a drawing of them instead.
 *
 * This function only supplies the surround: a dark stage (the reel declares its
 * own light-on-dark palette, so it needs one in both themes) plus feature detail.
 *
 * ═══ WHAT THIS SECTION MAY CLAIM — READ BEFORE ADDING A FEATURE ═══════════
 * The repo's extension/manifest.json says 2.0.0 and lists alaskaair.com and
 * www.google.com under optional_host_permissions. THE STORE DOES NOT SHIP THAT
 * YET. Verified by the listing body, not by a version constant:
 *
 *     $ curl -s https://chromewebstore.google.com/detail/ \
 *         starlink-odds-for-united/ojpladpffbibebedfbcgbhckajbnijec | grep -i version
 *     → Version 1.5.1 · Updated July 24, 2026 · "Starlink Odds for United Flights"
 *
 * and united-starlink-companion/STORE.md says so too: the live listing is "the
 * shipped v1.5.x/1.6 copy" and the "v2.0 SUBMISSION COPY (WiFi Odds rename)"
 * block is still waiting to be uploaded.
 *
 * So this section is split IN TWO on purpose, and the split is not cosmetic:
 *   LIVE TODAY (1.5.1)  united.com + app.navan.com badges, sort, route panel.
 *                       That is also exactly what the reel above shows — the two
 *                       screenshots are 1.5.1 captures and the reel says so on
 *                       its own badge, so the pictures and the copy agree.
 *   NOT YET INSTALLABLE alaskaair.com + Google Flights + all-18 ConnectScores in
 *                       the popup (2.0, awaiting store review) and the tail-swap
 *                       Guardian (2.1, built and in test — see ROADMAP above).
 *
 * A visitor who clicks "Add to Chrome" gets the FIRST group. Promising them the
 * second is the same failure as a 200 with an empty body: technically sourced,
 * factually false. When 2.0 clears review, move the pills up and re-run the curl
 * above to prove it — do not move them because the manifest says 2.0.0. */
function extensionSection(m) {
  return '<section class="blk extblk" id="extension">\n' +
    '  <div class="sec-h"><span class="sub">§5 · Take it with you</span>' +
    '<h2>The same odds, on the booking page</h2>' +
    '<span class="sub" style="position:static">Chrome extension · free · v1.5.1 in the store</span>' +
    '</div>\n' +
    '  <p class="sec-lede">This site answers one flight at a time. The extension answers the page ' +
    'you are already looking at. On united.com and Navan every result picks up an odds badge, and ' +
    'one click sorts the whole page by them without leaving the booking flow. The pictures below ' +
    'are captures of the shipped build.</p>\n' +
    '  <div class="extdemo">\n' + C.section() + '\n  </div>\n' +
    '  <div class="kv" style="margin-top:18px">' +
    '<div><p class="micro">In the store today</p><span class="v">1.5.1</span></div>' +
    '<div><p class="micro">Staged, awaiting review</p><span class="v">2.0.0</span></div>' +
    '<div><p class="micro">Account required</p><span class="v">None</span></div>' +
    '<div><p class="micro">Third-party requests</p><span class="v">0</span></div></div>\n' +
    '  <div class="faq" style="margin-top:18px">\n' +
    '    <div class="q rv"><h3>Live today <span class="pill live">1.5.1</span></h3>' +
    '<p>Odds badges on every united.com and app.navan.com result, a one-click sort that keeps the ' +
    'prices and times where they were, and a route panel that flips itself for the return leg. ' +
    'A badge carries a tick when the assigned tail is already confirmed, and it carries the same ' +
    'tier label this site uses when it is not.</p></div>\n' +
    '    <div class="q rv"><h3>Waiting on store review <span class="pill soon">2.0.0</span></h3>' +
    '<p>alaskaair.com and Google Flights, both behind an optional permission you grant yourself, ' +
    'plus all ' + m.airlineCount + ' ConnectScores in the popup. This build is not in the store, ' +
    'so installing today does not get you any of it.</p></div>\n' +
    '    <div class="q rv"><h3>Not in any store build <span class="pill soon">2.1</span></h3>' +
    '<p>Aircraft assignments change after you book, and Tail-swap Guardian watches your booked ' +
    'flight from booking to boarding to tell you when the equipment moves. It is built and in ' +
    'test. Do not go looking for it in the store.</p></div>\n' +
    '  </div>\n' +
    '  <div class="cta-row"><a class="btn" href="' + H.EXT + '" target="_blank" rel="noopener">' +
    'Install from the Chrome Web Store ↗</a></div>\n' +
    '  <p class="note extfine"><b>No accounts, no analytics, no tracking.</b> It stores your ' +
    'settings locally and phones nothing home. The odds come from the same data as this site. ' +
    'Unofficial, and not affiliated with any airline, Navan, SpaceX/Starlink or the trackers.</p>\n' +
    '  <p class="src">' + cls('reported') + ' Store version and coverage read off the ' +
    '<a href="' + H.EXT + '" target="_blank" rel="noopener">Chrome Web Store listing body</a>, ' +
    '24 Jul 2026. Tail data: unitedstarlinktracker.com and alaskastarlinktracker.com, 25 Jul 2026. ' +
    'Every other airline from public announcements, Jul 2026.</p>\n' +
    '</section>\n\n';
}

module.exports = {
  band: band, freeText: freeText, sysClass: sysClass, tagsFor: tagsFor,
  leaderboard: leaderboard, routePills: routePills, kpi: kpi,
  US_MAJORS: US_MAJORS, usRanked: usRanked, usStatus: usStatus, usGlance: usGlance,
  nextGenLine: nextGenLine, todayLine: todayLine, pctText: pctText,
  roadmapSteps: roadmapSteps, ROADMAP: ROADMAP,
  flightCheck: flightCheck, extensionSection: extensionSection,
  cls: cls, srcLine: srcLine, projected: projected, projCell: projCell, tape: tape,
  fieldTable: fieldTable, tierRows: tierRows, tierTable: tierTable,
  reportTable: reportTable, reportForm: reportForm, REPORT_SYSTEMS: REPORT_SYSTEMS,
  FREE: FREE
};
