'use strict';
/* build/lib/pages.js — the page bodies. Every number, row and chart path in here
 * is rendered at BUILD time, which is the whole freshness architecture: the daily
 * data.json commit triggers a Pages rebuild and every page re-bakes. Client JS
 * only sorts, filters, toggles the theme and animates. Every page works with JS
 * disabled — that is a hard acceptance criterion, not an aspiration. */

var H = require('./html.js');
var V = require('./viz.js');
var DL = require('./data.js');
/* the rollout phase words. market.js requires nothing, so this cannot cycle. */
var MK = require('./market.js');
var esc = H.esc, num = DL.num;

/* ── THE BANDS, RECONCILED WITH THE SPEC ──────────────────────────────────
 * ARCHETYPES.md sets four bands at four thresholds: green 60 to 100, amber 40
 * to 59, clay 1 to 39, grey for zero. This function used to cut at 85/60/35/20/5
 * and emit six classes. site.css mapped those six onto four hues so a score
 * could not invent a fifth colour, and it flagged the one real seam: 35 to 39
 * came out amber where the spec says clay. 1 to 4 had the same problem at the
 * other end, coming out grey where the spec says clay — and grey is reserved for
 * projections and for a genuine zero, so a fleet with one equipped aircraft was
 * wearing the colour of a fleet with none.
 *
 * Four thresholds now, and four of the six existing class names. sc-exc and
 * sc-rare are simply no longer emitted; their rules in site.css are already
 * aliases of sc-good and sc-long, so nothing in that file has to move for this
 * to be right, and build/prerender.js keeps checking all six inside projections.
 *
 * assets/airlines.js labelFor() still returns SIX words at the OLD cuts. That
 * file is a byte-copy of the extension's and it feeds the public API, so it is
 * not touched here. bandWord() below is the site's four-word vocabulary and it
 * is what every band chip and every scorehead prints. The NUMBER a page shows
 * is always the API's number; only the adjective differs, and only for the three
 * fleets at 100 (page: good · API: excellent) and for scores under 20. */
function band(s) {
  return s >= 60 ? 'sc-good' : s >= 40 ? 'sc-mix' : s >= 1 ? 'sc-long' : 'sc-no';
}
var BAND_WORD = { 'sc-good': 'good', 'sc-mix': 'mixed', 'sc-long': 'long shot', 'sc-no': 'not yet' };
function bandWord(s) { return BAND_WORD[band(s)]; }
/* the chip: the score's own word, wearing the score's own colour, and nothing
   else on the site is allowed both. */
function bandChip(s) {
  return '<span class="band ' + band(s) + '">' + bandWord(s) + '</span>';
}
var BAND_LEGEND = 'Bands: good 60 to 100, mixed 40 to 59, long shot 1 to 39, not yet 0.';
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
  /* The spaces between these three spans are load-bearing and must not be
     minified away. Without them the element's textContent runs together, and
     the result is not merely ugly: Southwest's chip read "37300+ by end-2026",
     so a projected score of 37 rendered as the figure 37,300 to anyone copying
     the text, and to every screen reader. American's read
     "51installs begin 2027-Q1FIRM". The spans are laid out by the container,
     so whitespace between them changes no pixel and fixes the text.
     `build/apitest.js` asserts no element boundary produces a digit-letter
     collision anywhere on the built pages. */
  return '<span class="proj' + (p.slipped ? ' slipped' : '') +
    '" data-projected="' + esc(a.key) + '">' +
    '<span class="pv">' + p.score + '</span> ' +
    '<span class="ph">' + esc(p.horizon) + '</span> ' +
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

/* ── THE HALF MARK IS GONE — round seven, 27 Jul 2026. The homepage no longer
 * runs in two named halves; the companion section's own kicker names the one
 * pitch, and the seam strips left with the layout that needed them. */

/* ── THE WORKED ANSWER ────────────────────────────────────────────────────
 * The card the whole register rests on: odds, a sentence a person would say out
 * loud, the umbrella, and the provenance. The mockup in the websites repo drew
 * this with invented numbers (UA 2123, 39%, a 7:05 am at 88%). Every figure in
 * the version below is read out of today's route cache instead, so the card on
 * the page is a real departure with a real observation count and it changes when
 * the data does.
 *
 * THE CHOICE IS DETERMINISTIC, and the rule is worth stating: take the cached
 * United route with the widest spread between its best and its worst departure,
 * counting only departures with at least ten observations and a confidence above
 * `low`. The point of the card is the umbrella — the bad answer has to have a
 * good alternative sitting next to it, or there is nothing to advise. A route
 * where every flight is 90% is a fine forecast and a useless illustration.
 *
 * Where no route qualifies the card is omitted rather than faked. The check
 * above it still works and the board below it still answers. */
function worstBestRoute(m) {
  var rc = (m.D && m.D.routeCache) || {};
  var best = null;
  Object.keys(rc).sort().forEach(function (route) {
    var fl = (rc[route].flights || []).filter(function (f) {
      return f.obs >= 10 && f.conf !== 'low' && typeof f.prob === 'number';
    });
    if (fl.length < 3) return;
    var s = fl.slice().sort(function (a, b) { return a.prob - b.prob || a.fn.localeCompare(b.fn); });
    var lo = s[0], hi = s[s.length - 1];
    var spread = hi.prob - lo.prob;
    if (!best || spread > best.spread) {
      best = { route: route, lo: lo, hi: hi, spread: spread, n: fl.length };
    }
  });
  return best;
}
function workedAnswer(m) {
  var r = worstBestRoute(m);
  if (!r) return '';
  var pair = r.route.split('-');
  var lo = r.lo, hi = r.hi;
  return '  <div class="fa ' + band(lo.prob) + '" style="margin-top:1.6rem" ' +
    'aria-label="A worked answer">\n' +
    '    <div class="fa-h"><div class="fa-big"><b>' + lo.prob + '</b><small>%</small></div>\n' +
    '      <div class="fa-t"><h3>' + esc(lo.fn) + ' · ' + esc(pair[0]) + ' → ' + esc(pair[1]) +
    '</h3><p class="fa-what">Odds this departure draws a Starlink aircraft</p></div>\n' +
    '      <span class="fa-band">' + bandChip(lo.prob) + '</span></div>\n' +
    /* The source rides INSIDE the say-sentence, not only in the provenance line
       under the card. The umbrella paragraph sits between the two and is long
       enough to push the prov line past the 260-character window the build's
       unsubstantiated-claim check uses — and the check is right about that:
       a date three paragraphs down is not attached to the figure a reader is
       looking at. */
    '    <p class="say">Starlink came up on ' + lo.prob + '% of this flight’s last ' + lo.obs +
    ' departures (tracker history, ' + esc(H.chipDate(m.updated)) + '). Plan the trip around the ' +
    'older cabin, and carry something to do offline.</p>\n' +
    '    <p class="umbrella"><b>The umbrella:</b> aircraft assignments firm up about two days out, ' +
    'so re-check at T-48h. If you drew a dud, ' + esc(hi.fn) + ' on the same route pulled a Starlink ' +
    'tail on ' + hi.prob + '% of its last ' + hi.obs + ' departures, and the route optimizer ranks ' +
    'all ' + r.n + ' of them. <a href="/united/">Rank this route →</a></p>\n' +
    '    <p class="prov"><b>Reported</b> · flight history from unitedstarlinktracker.com, ' +
    esc(H.plateDate(m.updated)) + ' · confidence ' + esc(lo.conf) + ', ' + lo.obs +
    ' observations</p>\n  </div>\n';
}

/* ── THE CONFIDENCE LADDER ────────────────────────────────────────────────
 * Four cards, one per tier, built from tierRows() so the ladder and the
 * methodology table can never name different airlines. The letter is a category,
 * so it is ink in a ring; it is not a score and it does not take a band. */
function ladderCards(m) {
  return '  <div class="grid2" style="margin:1.4rem 0 .6rem">\n' +
    tierRows(m).map(function (t) {
      return '    <div class="card rv"><h3><span style="display:inline-block;width:1.6rem;' +
        'height:1.6rem;border-radius:50%;border:1px solid var(--ink);text-align:center;' +
        'line-height:1.5rem;font-family:var(--sans);font-size:.85rem;margin-right:.5rem">' +
        esc(t[0]) + '</span>' + esc(t[1]) + '</h3>' +
        '<p>' + esc(t[2]) + ' ' + esc(t[4]) + '</p>' +
        '<p class="micro" style="margin-top:auto">' + esc(t[3]) + '</p></div>';
    }).join('\n') + '\n  </div>\n';
}

/* ── THE FENCE ────────────────────────────────────────────────────────────
 * One live projection as the worked example, then the five rules in a sentence
 * each. The chip comes from projected(), which is the only renderer on the site
 * and the one build/prerender.js walks the bytes for. */
function fenceBlock(m) {
  var d = m.A.scoreAirline('delta');
  return '  <p style="margin:1.2rem 0 .6rem">' + projected(d) + '</p>\n' +
    '  <p class="prose">Where a carrier has signed and published an aircraft count, a projected ' +
    'score appears in that grey chip and nowhere else. It never sorts a table. It carries its ' +
    'horizon date and a confidence word everywhere it goes, and when a horizon passes with nothing ' +
    'installed it flips to SLIPPED while keeping the date it missed. That flip is computed from the ' +
    'build date, so it does not wait for anyone to notice. <a href="/methodology/#projected">The ' +
    'arithmetic and all five rules →</a></p>\n';
}

/* ── THE LOOP ─────────────────────────────────────────────────────────────
 * The five channels an observation can come back on, as a definition list.
 * Closing beat of the companion half. It is not a pitch: nothing here asks for
 * an install, and no channel asks for an email address. */
function loopSection() {
  var chans = [
    ['The report form',
      'At the foot of every airline page, posting to the same intake the extension uses. ' +
      'A flight, a date, what the WiFi did. Plain feedback about the site or the extension rides ' +
      'the same channel.'],
    ['The extension itself',
      'The panel carries a report action, and the design calls for one accuracy prompt after a few ' +
      'real uses. Never on install day, never twice.'],
    ['A store review',
      'Chrome ranks listings partly on reviews, so a review is the one act that puts the extension ' +
      'in front of the next traveller. If it earned one, two sentences there carry more weight than ' +
      'anything I could write about it myself.'],
    ['GitHub issues',
      'Bugs, wrong badges with a screenshot, feature requests. Slower than the form, better for ' +
      'anything with a repro.'],
    ['Reddit',
      'Field reports keep surfacing in airline and Starlink threads. I read them, and a confirmed ' +
      'one enters the record wearing its REPORTED label like everything else.']
  ];
  return '  <dl class="loop">\n' + chans.map(function (c) {
    return '    <dt>' + esc(c[0]) + '</dt><dd>' + esc(c[1]) + '</dd>';
  }).join('\n') + '\n  </dl>\n' +
    '  <p class="prov"><b>The intake</b> · POST /api/report · no channel attaches an account · ' +
    'what the server keeps is on the <a href="/privacy">privacy page</a></p>\n';
}

/* ── THE REPORT BLOCK, a shared component ─────────────────────────────────
 * Foot of the airline pages, /race/, /systems/ and both United sub-pages. Kicker,
 * one serif sentence naming what the record cannot see, then a real form.
 *
 * ═══ WHERE THIS DEPARTS FROM ARCHETYPES.md, AND WHY ═══════════════════════
 * The spec asks for four fields: flight or airline, date flown, what happened as
 * free text, and a `kind` selector reading field report / feedback / correction.
 * There is no `kind` field. functions/_lib/reports.mjs publishes its FIELDS table
 * as the contract and rejects anything not on it BY NAME, so a `kind` input would
 * bounce the whole submission — a form whose author thinks it arrived, which is
 * the exact failure that table exists to prevent. `system` is also required over
 * there, and `flownOn`, `airline` and `flightNumber` are required with it.
 *
 * So this block carries the four fields the endpoint actually requires plus the
 * free-text note, and the note's own label invites the correction and the piece
 * of feedback the spec wanted the selector for. One pipe, sorted on arrival,
 * which is what the spec was after. If a `kind` column ever lands in the intake,
 * this is one <select> and the FIELDS table is where it starts.
 *
 * WORKS WITH JAVASCRIPT OFF: a real <form method="post">, urlencoded, and the
 * endpoint accepts that shape. No page carries the upgrade script except
 * /methodology/, and none of them needs it. */
function observeBlock(sentence, idp) {
  var p = idp || 'ob';
  var opts = REPORT_SYSTEMS.map(function (s) {
    return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>';
  }).join('');
  return '<section class="blk" id="observe">\n' +
    '  <span class="kicker">Add an observation</span>\n' +
    '  <h2>What the record cannot see</h2>\n' +
    '  <p class="say">' + sentence + '</p>\n' +
    '  <form class="frm" method="post" action="/api/report" ' +
    'enctype="application/x-www-form-urlencoded">\n' +
    '    <div class="hp" aria-hidden="true"><label for="' + p + '-website">Leave this empty</label>' +
    '<input id="' + p + '-website" name="website" type="text" value="" tabindex="-1" ' +
    'autocomplete="off"></div>\n' +
    /* labels wrap their fields — see field() above for the target-size case */
    '    <div class="ffgrid">\n' +
    '      <div class="ff"><label for="' + p + '-air"><span class="lt">Airline</span> ' +
    '<input id="' + p + '-air" name="airline" type="text" required maxlength="60"></label></div>\n' +
    '      <div class="ff"><label for="' + p + '-fn"><span class="lt">Flight number</span> ' +
    '<input id="' + p + '-fn" name="flightNumber" type="text" required spellcheck="false" ' +
    'autocapitalize="characters" placeholder="UA2402"></label></div>\n' +
    '      <div class="ff"><label for="' + p + '-on"><span class="lt">Date you flew</span> ' +
    '<input id="' + p + '-on" name="flownOn" type="date" required></label></div>\n' +
    '      <div class="ff"><label for="' + p + '-sys"><span class="lt">System</span> ' +
    '<select id="' + p + '-sys" name="system" required aria-describedby="' + p + '-sys-h">' +
    '<option value="">Pick one</option>' +
    opts + '</select></label><span class="fh" id="' + p + '-sys-h">' +
    'The captive portal usually names it.</span></div>\n' +
    '      <div class="ff full"><label for="' + p + '-note"><span class="lt">What happened, or ' +
    'what we got wrong</span> ' +
    '<textarea id="' + p + '-note" name="note" maxlength="500" rows="3" ' +
    'placeholder="Whether the login worked, what a call survived, which badge was wrong">' +
    '</textarea></label></div>\n' +
    '    </div>\n' +
    '    <div class="frm-ft"><p class="note">Every submission lands unpublished and a person reads ' +
    'it before it appears here. No account, no cookie, no email field. The full form, with speed ' +
    'and latency boxes, is on <a href="/methodology/#field">the methodology page</a>.</p>\n' +
    '      <button class="btn" type="submit">Send it</button></div>\n' +
    '  </form>\n</section>\n\n';
}

/* ── THE SCOREHEAD ────────────────────────────────────────────────────────
 * First thing on an airline page and the thing that has to survive 390px: the
 * number, its band word, where it sits on the board, the say-sentence and the
 * provenance line. The whole block wears the band, which is how the ring in
 * V.scoreRing() finds its colour — until a .sc-* class landed on .scorebox the
 * ring drew in plain ink on all eighteen pages. */
function scorehead(m, a, rank, ring, sayHtml, provHtml) {
  return '  <div class="scorebox rv ' + band(a.score) + '">' + ring +
    '<div class="sbmid">' +
    '<div class="t">ConnectScore ' + bandChip(a.score) + ' · ranked ' + rank + ' of ' +
    m.airlineCount + '</div>' +
    '<p class="say" style="margin-top:.5rem">' + sayHtml + '</p>' +
    '<div class="m">' + provHtml + '</div></div></div>\n';
}

/* ── THE PLAYBOOK ─────────────────────────────────────────────────────────
 * Rule three of the register: no bad answer without the next move attached. The
 * moves are the umbrella, spelled out, and WHAT THEY MAY SAY IS SET BY THE TIER.
 *
 *   A  the aircraft on your flight resolves to a registration, so a move may
 *      name a departure and the odds for it.
 *   B  the tails are verified and nobody publishes which one is scheduled onto
 *      which departure, so "verify the tail you drew" becomes "check the
 *      scheduled aircraft type" — and the move says why that is weaker rather
 *      than hoping the reader does not ask.
 *   C  no per-tail data exists at all. What survives is the carrier's own
 *      amenity flag at T-48h and the economics of a same-day switch.
 *   D  a C page. The signed deal is a second beat, and it never becomes a move,
 *      because you cannot connect to a signature.
 *
 * A move that a tier cannot support is not softened here. It is cut. */
function playbook(m, a) {
  var tier = tierLetter(a);
  var pct = Math.round((a.parts && a.parts.pctEquipped || 0) * 100);
  var moves = [];
  moves.push(['T-48h', 'Re-check about two days out',
    'Aircraft assignments firm up roughly 48 hours before departure and they can still move up to ' +
    'pushback. Whatever this page says today, the answer for your flight is more settled then.']);
  if (tier === 'A') {
    moves.push(['Book', 'Rank the route before you pick a departure',
      'Every ' + esc(a.name) + ' departure on a cached route carries its own history and its own ' +
      'observation count. The optimizer ranks them, and a two-hour-later flight is often a ' +
      'different answer entirely. <a href="/united/">Open the route optimizer →</a>']);
    moves.push(['Verify', 'Check the tail you actually drew',
      'The registration on your itinerary can be looked up against the install archive, which is ' +
      'the only place on this site where the answer stops being a probability. ' +
      '<a href="/united/fleet/">The tail registry →</a>']);
  } else if (tier === 'B') {
    moves.push(['Type', 'Check the scheduled aircraft type',
      'The tails on this fleet are verified one by one. Nobody publishes which tail is scheduled ' +
      'onto which departure, so there is no per-flight history to count. A type is a weaker answer ' +
      'than a registration and it is the strongest one this fleet supports. ' +
      '<a href="/alaska/">Where the sub-fleets stand →</a>']);
  } else {
    moves.push(['Amenity', 'Read the airline’s own WiFi flag at T-48h',
      esc(a.name) + ' publishes an amenity marker against each flight in its own booking flow, and ' +
      'that marker is about the aircraft now assigned to it. It is the closest thing to a per-flight ' +
      'answer this fleet has. The airline is asserting it; nobody has verified the install.']);
  }
  if (a.fleet && pct > 0 && pct < 90) {
    moves.push(['Switch', 'Price the same-day change before you need it',
      'Roughly ' + pct + '% of the fleet carries ' + esc(a.systemLabel) + ' today, so a different ' +
      'departure is a real second draw. Whether that is worth doing is a question about the change ' +
      'fee on your fare, and it is cheaper to know the answer before the gate than at it.']);
  }
  moves.push(['Fallback', 'Have the offline version of the work',
    'Nobody has load-tested a full cabin on any of these systems, so a good score is not a promise ' +
    'about the hour you fly. Downloading the deck is the move that makes the odds stop mattering.']);

  return '<section class="blk" id="playbook">\n' +
    '  <span class="kicker">The playbook</span>\n' +
    '  <h2>What to do about it</h2>\n' +
    '  <p class="sec-lede">Four things, in the order they become useful. Every one of them is ' +
    'available at tier ' + tier + ', which is the tier this page was derived at. Anything this ' +
    'fleet cannot support has been cut from the list.</p>\n' +
    '  <ul class="moves">\n' + moves.map(function (mv) {
      /* The space after the tag span is load-bearing: `.moves .tag` is
         position:absolute, so it changes no pixel of the heading that follows,
         but without it "T-48h" and "Re-check about two days out" welded into
         "T-48hRe-check..." in the rendered textContent -- a screen reader and
         anyone who copied the row got the fused token, not the two values. */
      return '    <li><span class="tag">' + esc(mv[0]) + '</span> <b>' + esc(mv[1]) + '</b>' +
        '<p>' + mv[2] + '</p></li>';
    }).join('\n') + '\n  </ul>\n</section>\n\n';
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
function tierLetter(a) {
  if (a.key === 'united') return 'A';
  if (a.instrumented) return 'B';
  return a.projected ? 'D' : 'C';
}

/* ═══ THE MOBILE RECORD (Phase 1b) ════════════════════════════════════════
 * Below 880px both boards stop being tables: the row was carrying rank,
 * airline, code, score, band, tier, fitted share, next-gen odds, publication
 * state and sort state at once, and no column tuning makes that work at
 * 390-440px — the audit's verdict, and the reason `overflow-wrap:anywhere`
 * was shattering airline names. One record per airline instead, generated
 * from the SAME scored objects as the table beside it, so there is no second
 * source of truth:
 *
 *   03  United  UA                       48  mixed
 *       Chance of next-gen WiFi              31%
 *       27% of the fleet has Starlink · tail-verified data
 *       View United →
 *
 * The band WORD rides with the score — it is the non-colour signal (WCAG
 * 1.4.1) and it does not get dropped for space. The next-gen line is
 * labelled in words and carries its per cent sign; the SAS/Air France shape
 * prints "count unpublished", never a zero. The support line states its own
 * denominator — the WHOLE fleet — because the next-gen figure beside it is
 * computed over the published-system subset, and conflating the two is the
 * confusion the audit called the site's worst moment. The tier word answers
 * TODAY's question, so an announced-only carrier reads "fleet-share", not
 * "announced" (tierRows(): A/B/C are today, D is the forward number).
 * Sorting stays with the same Rank-by control: site.js re-orders these
 * records off the table rows by data-key, so the two renderings cannot
 * disagree about order. Column headers do not exist here, so no sort
 * affordance points at one. */
function todayTierWord(a) {
  if (a.key === 'united') return 'tail-verified';
  if (a.instrumented) return 'type-derived';
  return 'fleet-share';
}
function cardSupport(a) {
  /* the same fleetwide test todayLine() uses: only claim fleetwide at >=99%
     of the whole fleet, unresolved aircraft included — and the unpublished
     branch comes first, because pctEquipped() is null there and a null share
     must never fall through to a percentage or a fleetwide claim */
  var eq;
  var share = a.parts && typeof a.parts.pctEquipped === 'number' ? a.parts.pctEquipped : 1;
  if (a.equippedPublished === false) {
    eq = a.systemLabel + ' count unpublished' +
      (a.fleet ? ' for the ' + num(a.fleet) + '-aircraft fleet' : '');
  } else if (share >= 0.99) {
    eq = a.systemLabel + ' fleetwide';
  } else {
    eq = pctText(share) + ' of the fleet has ' + a.systemLabel;
  }
  return eq + ' · ' + todayTierWord(a) + ' data';
}
function boardCard(a, i) {
  var ngPublished = a.nextGenPublished !== false;
  var rank = (i + 1 < 10 ? '0' : '') + (i + 1);
  /* the spaces between inline elements are load-bearing: without them the
     rendered textContent welds "United" into "UnitedUA" and "48" into
     "48mixed" — build/apitest.js scans every boundary */
  return '    <li class="crd ' + band(a.score) + '" data-key="' + esc(a.key) + '">' +
    '<p class="crd-top"><span class="crd-rank">' + rank + '</span> ' +
    '<a class="aname" href="/airlines/' + a.key + '/">' + esc(a.name) + '</a> ' +
    '<span class="code">' + esc(a.code || '') + '</span> ' +
    '<span class="crd-sco"><span class="sco">' + a.score + '</span> ' + bandChip(a.score) +
    '</span></p>' +
    '<p class="crd-ng"><span>Chance of next-gen WiFi</span> ' +
    (ngPublished ? '<b>' + a.nextGenScore + '%</b>'
      : '<b class="ngunpub" title="' + esc(a.name + ' has launched ' + a.systemLabel +
        ' but has not published an aircraft count') + '">count unpublished</b>') + '</p>' +
    '<p class="crd-sub">' + esc(cardSupport(a)) + '</p>' +
    '<a class="crd-go" href="/airlines/' + a.key + '/">View ' + esc(a.name) + ' →</a></li>';
}
function boardCards(list, opts) {
  opts = opts || {};
  return '  <ol class="cardsb' + (opts.dense ? ' dense' : '') + '" aria-label="The same ' +
    'ranking, one record per airline">\n' +
    list.map(function (a, i) { return boardCard(a, i); }).join('\n') + '\n  </ol>\n';
}
function fieldTable(m) {
  /* THE BOARD IS DRAWN NOW, Jeremy's pivot of 26 Jul 2026: every row carries a
   * fill bar whose length is the score and whose colour is the band, so the
   * table reads at a glance like a departures board. The tier letter stays (it
   * is provenance), the projection chip keeps every fence attribute, and the
   * score is still printed as a number beside its bar — the bar is a drawing OF
   * the number, never a replacement for it. */
  /* Sort order for the rollout column: the phase words are a sequence, not an
     alphabet, so the cell carries the sequence number as its sort key. */
  var PHASE_SORT = { done: 1, installing: 2, signed: 3, none: 4 };
  var rows = m.ranked.map(function (a, i) {
    var ph = MK.phaseOf(m.A, a);
    var ng = a.nextGenScore;
    /* data-key pairs this row with its .crd record so the card list can be
       re-ordered off the sorted rows — see syncBoardCards() in site.js */
    return '      <tr data-f="' + ph + '" data-key="' + esc(a.key) + '">' +
      '<td class="rank">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</td>' +
      '<td data-s="' + esc(a.name.toLowerCase()) + '"><a class="aname" href="/airlines/' + a.key +
      '/">' + esc(a.name) + ' ' +
      '<span class="code">' + esc(a.code || '') + '</span></a></td>' +
      '<td class="num ' + band(a.score) + '" data-s="' + a.score + '"><span class="sco">' +
      a.score + '</span> ' + bandChip(a.score) + fitBadge(a) + '</td>' +
      /* the bar is a drawing of the number; the chip word beside the number is
         the non-colour signal, so a reader who cannot tell green from clay
         still gets the band. */
      '<td class="barcell"><span class="scobar"><i class="fill ' + band(a.score) +
      '" style="width:' + a.score + '%"></i></span></td>' +
      /* the tier letter is a CATEGORY — provenance, not score — so it stays ink */
      '<td class="micro">' + tierLetter(a) + '</td>' +
      /* a.nextGenPublished === false is the SAS shape: 0 known next-gen
         aircraft with some still unresolved. That 0 is not a measurement, so
         it does not get the score treatment. It says so in words, ranks with
         data-s="-1" below every real number, and never prints a zero. */
      /* data-col marks which cell holds the next-gen number. Without it a
         checker has to guess from position or band class, and the parity guard
         written on 27 Jul guessed wrong: it took the ConnectScore cell for any
         airline whose score cell carried no fitted badge, and reported Delta's
         next-gen as 49. A label the generator emits beats a heuristic the
         checker infers. */
      (a.nextGenPublished === false
        ? '<td class="num" data-col="nextgen" data-s="-1"><span class="ngunpub" title="' +
          esc(a.name + ' has launched ' + a.systemLabel + ' but has not published an aircraft ' +
            'count') + '">counts unpublished</span></td>'
        : '<td class="num ' + band(ng) + '" data-col="nextgen" data-s="' + ng + '"><span class="sco" ' +
          'style="font-size:1rem">' + ng + '</span></td>') +
      /* the span is the measurable line box: the assert reads element height
         against line-height, and a bare one-word td stretched by a taller
         neighbour in the same row measures like a broken word */
      '<td class="micro phz" data-s="' + PHASE_SORT[ph] + '"><span>' +
      esc(MK.PHASE_LABEL[ph]) + '</span></td>' +
      '<td class="num">' + (a.projected ? projected(a) : '<span class="dash">&middot;</span>') +
      '</td></tr>';
  }).join('\n');

  /* The Rank-by row drives the sortable headers below it through site.js §7;
     the headers themselves stay clickable, which is what the buttons press.
     The projected column has no data-k, so nothing can ever sort on it. */
  var ctl =
    '  <div class="segctrl needs-js" id="board-rank"><span class="lbl">Rank by</span>' +
    '<div class="filters" role="group" aria-label="Number to rank the board by">' +
    '<button type="button" data-bs="score" aria-pressed="true">ConnectScore</button>' +
    '<button type="button" data-bs="nextgen" aria-pressed="false">Next-gen odds</button>' +
    '<button type="button" data-bs="tier" aria-pressed="false">Tier</button>' +
    '<button type="button" data-bs="phase" aria-pressed="false">Rollout</button>' +
    '<button type="button" data-bs="name" aria-pressed="false">A–Z</button>' +
    '</div></div>\n';

  return ctl +
    /* .board-shell so the 880px card cut can hide exactly this table; the
       cards below it are the same m.ranked objects, other rendering */
    '<div class="tbl-shell tablescroll board-shell rv"><table class="tbl board">\n' +
    /* header text sits in spans: a table cell's box is its ROW's height, so a
       one-line heading beside a two-line one measured like a broken word to
       the layout assert. The span is the true line box. */
    '    <thead><tr><th scope="col"><span>#</span></th>' +
    '<th scope="col" data-k="name"><span>Airline</span></th>' +
    '<th scope="col" class="num" data-k="score" data-t="num" aria-sort="descending">' +
    '<span>ConnectScore</span></th>' +
    '<th scope="col" class="barcell"><span class="visually-hidden">Score drawn as a bar</span></th>' +
    '<th scope="col" data-k="tier"><span>Tier</span></th>' +
    '<th scope="col" class="num" data-k="nextgen" data-t="num"><span>Next-gen odds</span></th>' +
    '<th scope="col" class="phz" data-k="phase"><span>Rollout</span></th>' +
    '<th scope="col" class="num"><span>Projected · grey, never sorts</span></th></tr></thead>\n' +
    '    <tbody>\n' + rows + '\n    </tbody>\n  </table></div>\n' +
    boardCards(m.ranked, { dense: true }) +
    /* Everything below the board is one box (round seven, notes 7/8/11). */
    '  <div class="bfoot">\n' +
    '    <div class="bf-grid-row"><div class="bf-grid">\n' +
    '      <div><span class="bf-l">Bands</span><p>Good 60 to 100 · mixed 40 to 59 · long shot ' +
    '1 to 39 · not yet 0.</p></div>\n' +
    '      <div><span class="bf-l">Tiers</span><p>A to D, from a fleet tracked tail by tail down ' +
    'to a signed deal with nothing in the air.</p></div>\n' +
    '      <div><span class="bf-l">Dashes and grey figures</span><p>No published count ranks as ' +
    'a dash or as “counts unpublished”, never zero. Projected figures are grey, dated and never ' +
    'sort.</p></div>\n' +
    '    </div></div>\n' +
    '    <div class="board-note"><span class="bf-l">On a phone</span><p>Each airline renders as ' +
    'one card: rank, score with its band word, and the chance of next-gen WiFi. The score bar, ' +
    'tier, rollout phase and projections stay on the wide board and on each airline’s own ' +
    'page.</p></div>\n' +
    '    <div><span class="bf-l">Go deeper</span><div class="btnrow">' +
    '<a class="btn ghost mini" href="/methodology/">How it’s scored →</a>' +
    '<a class="btn ghost mini" href="/record/">The written record →</a></div></div>\n' +
    '    <div><p class="src">' + cls('reported') + ' Tail verification for United, Alaska and ' +
    'Hawaiian: <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">' +
    'unitedstarlinktracker.com</a> and <a href="https://alaskastarlinktracker.com" ' +
    'target="_blank" rel="noopener">alaskastarlinktracker.com</a>, both by @martinamps, ' +
    esc(H.plateDate(m.updated)) + ' · every other airline from public announcements, Jul 2026 · ' +
    '<a href="/methodology/#credit">the full credit</a>.</p></div>\n' +
    '  </div>\n';
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
      '<td><a class="aname" href="/airlines/' + a.key + '/">' + esc(a.name) + ' ' +
      '<span class="code">' + esc(a.code || '') + '</span></a>' +
      (a.instrumented ? ' <a class="pill" href="' + (a.key === 'united' ? '/united/' : '/alaska/') +
        '">Per-flight odds →</a>' : '') + '</td>' +
      '<td class="' + band(a.score) + '" data-s="' + a.score + '"><span class="sco">' + a.score +
      '</span> ' + bandChip(a.score) + '</td>' +
      '<td data-s="' + esc(a.systemLabel) + '"><span class="sysdot ' + sysClass(a.system) +
      '"></span>' + esc(a.systemLabel) + fut + '</td>' +
      '<td data-s="' + (a.parts.pctEquipped).toFixed(4) + '">' + fleetCell + '</td>' +
      '<td data-s="' + esc(e.free || 'unknown') + '">' + esc(freeText(e.free)) + '</td>' +
      '<td class="note hide-sm">' + esc(a.note) + '</td></tr>';
  }).join('\n');

  return '<div class="tbl-shell rv"><table class="tbl" id="lbTable">\n' +
    '    <thead><tr><th scope="col" data-k="rank" data-t="num">#</th><th scope="col" data-k="name">Airline</th>' +
    /* aria-sort is baked because the table really IS sorted by score desc on
       arrival — which also makes the first click on that header flip to ascending
       instead of re-applying the order it already has. */
    '<th scope="col" data-k="score" data-t="num" aria-sort="descending">ConnectScore</th><th scope="col" data-k="sys">System</th>' +
    '<th scope="col" data-k="fleet" data-t="num">Fleet equipped</th><th scope="col" data-k="free">Free</th>' +
    '<th scope="col" class="hide-sm">Note</th></tr></thead>\n    <tbody>\n' + rows + '\n    </tbody>\n' +
    '  </table></div>\n';
}

/* ── Option A leaderboard: Big 4 board + full 18, one Rank-by control each ──
 * Ported from the reviewed mockup at websites/public/wifiodds-big4/ (Version A,
 * approved by Jeremy 26 Jul 2026 — Version B in that file is reference only and
 * does not ship). ONE client handler (assets/site.js, the rankb section) moves
 * the button state, the header aria-sort, the rank column and the caption
 * together, so the label can never point one way while the rows sort another —
 * this site once shipped an A-Z control that sorted Z-A and the label never
 * caught up.
 *
 * COLOUR: only the actively ranked column wears its band colour and chip; the
 * rest render in ink (site.css .rankb block, keyed off table[data-active]).
 * That is how four score-ish columns share a row without turning into a
 * rainbow, and it is what satisfies rule 8 here.
 *
 * MAINLINE/REGIONAL ARE READ, NEVER RECOMPUTED. a.nextGenSplit comes straight
 * from assets/airlines.js nextGenSplitFor() — United carries real numbers,
 * every other row carries the STATE ITSELF as content ("no regional fleet",
 * "split not published", "no mainline fleet" for JSX). A state is not a zero,
 * so it never sorts as one and never fills a cell with a dash.
 *
 * THE RANK COLUMN header uses `data-rc`, not `data-k` — `data-k` is what
 * site.js's generic column-click sorter (§2) hooks on every `table.tbl`, and
 * this board is sorted by the Rank-by control, not by clicking a header. */

/* Per-airline gloss for the "no regional fleet" empty state, ported verbatim
 * from the approved mockup — D3: "adapted per airline". These are the plain
 * facts of each fleet's composition (all-737, all-A220, ...), not a figure
 * that needs a citation of its own. */
var NO_REGIONAL_NOTE = {
  /* Trimmed from 'every aircraft is a 737' to 'all 737' (Big 4 board fix,
     approved by Jeremy 27 Jul 2026, mockup-approved layout) so the empty-state
     text fits the widened split columns on one line without wrapping. Both
     boards read this same table, so both render the shorter note; the full
     18-airline board keeps its own horizontal scroll regardless. */
  southwest: 'all 737', jetblue: 'all A320/A321/A220',
  airbaltic: 'all A220', zipair: 'all 787', emirates: 'all widebody',
  virginatlantic: 'all widebody'
};
function splitEmptyText(state, key) {
  if (state === 'no-mainline-fleet') return 'no mainline fleet';
  if (state === 'no-regional-fleet') {
    var note = NO_REGIONAL_NOTE[key];
    return 'no regional fleet' + (note ? ' · ' + note : '');
  }
  return 'split not published';
}
/* Returns { v, col, html }: `v` is the numeric value for the data-mainline /
 * data-regional sort attribute ('' when there is none, never 0), `col` is the
 * band class to put on the <td> (empty when there is no number), `html` is the
 * cell body. */
function splitCell(a, part) {
  var s = a.nextGenSplit || { state: 'split-not-published' };
  var seg = s[part];
  if (s.state !== 'value' || !seg) {
    return { v: '', col: '', html: '<span class="empty-state cell">' +
      esc(splitEmptyText(s.state, a.key)) + '</span>' };
  }
  return {
    v: seg.pct, col: band(seg.pct),
    /* "of all": these two columns count their WHOLE segments, unlike the
       next-gen column beside them, whose denominator is the published-system
       subset. The label says so instead of leaving the reader to reconcile
       12% and 51% against a 31 they do not average to. */
    /* `.rankb .lab` is display:block, so the space below changes no pixel --
       the sco span already starts its own line. Without it "1,138" and "12%"
       welded into "1,13812%" in the rendered textContent. */
    html: '<span class="lab">' + num(seg.n) + ' of all ' + num(seg.of) + '</span> ' +
      '<span class="sco pct">' + seg.pct + '%</span> ' + bandChip(seg.pct)
  };
}
/* The aircraft count under the next-gen number. It has to be the NEXT-GEN
 * count over the SAME denominator the score is computed on, or the label
 * contradicts the number printed beside it.
 *
 * Until 27 Jul 2026 this printed `a.equipped / a.fleet`: the PRIMARY system's
 * count over the WHOLE fleet. Two separate faults, both live, both on the
 * homepage's top board.
 *
 *   American's primary system is Viasat, so the cell read "890/989 flying"
 *   directly above a next-gen score of 0. Eight hundred and ninety modern-GEO
 *   aircraft, printed under a heading that says next-gen.
 *
 *   United's read "482/1,807" beside a score of 31, and 31 is 482/1,580. The
 *   score excludes the 227 tails whose system the tracker does not publish;
 *   the label put them back in the denominator. No reader could reconcile the
 *   two, and the mainline and regional columns beside it (12%, 51%) reconcile
 *   to neither.
 *
 * The ledger already carries both halves: rows flagged `nextGen` and `known`,
 * which is the denominator the score uses. Read them rather than reassembling
 * the number from fields that mean something else.
 *
 * `build/apitest.js` asserts the printed pair round-trips to the printed
 * score, on the built bytes. A comment cannot hold this; the two numbers sit
 * in different columns and nothing else compares them. */
function nextGenLab(a) {
  if (a.nextGenPublished === false) return '';
  var L = a.ledger;
  if (!L || !L.rows || !L.known) return '';
  var n = L.rows.reduce(function (s, r) { return s + (r.nextGen ? r.n : 0); }, 0);
  /* "published" when the denominator is the published-system subset rather
     than the whole fleet (United: 1,580 of 1,807), because "flying" over a
     denominator that excludes 227 flying aircraft reads as a fleet count.
     build/apitest.js matches both words when it round-trips the pair. */
  return num(n) + '/' + num(L.known) + (a.fleet && L.known !== a.fleet ? ' published' : ' flying');
}

/* THE "X of Y" PHRASE — one function, so "0 of 123" standing in for "not
 * published" cannot happen twice. Any surface printing an equipped/fleet
 * count for an airline routes through this. */
function eqPhrase(a) {
  if (!a.fleet) return 'fleetwide';
  if (a.equippedPublished === false) return num(a.fleet) + ' aircraft, count unpublished';
  return num(a.equipped) + ' of ' + num(a.fleet);
}
/* Dated citation for the horizon shown in the projected chip, ported from the
 * approved mockup's own footnote. One line, same cell as the chip it backs, so
 * "300+ by end-2026" never sits unsourced. */
var PROJECTION_SRC = {
  american: 'Runway Girl Network, 26 May 2026', delta: 'Delta/Amazon release, 31 Mar 2026',
  southwest: 'target restated 22 Jun 2026', jetblue: 'press release, 4 Sep 2025'
};
function rankRow(a, i) {
  var ng = a.nextGenScore;
  /* SAS shape: 0 known next-gen aircraft, some still unresolved. That 0 is
     not a measurement — see nextGenPublished() in assets/airlines.js — so it
     may not sort or print as a real score. data-nextgen="" is the same
     "unranked, never zero" idiom splitCell() already uses for mainline and
     regional: site.js's rank-by handler treats an empty value as null and
     ranks the row "—", alphabetically among its unranked peers, never below
     a row with a real (even lower) number. */
  var ngPublished = a.nextGenPublished !== false;
  var mn = splitCell(a, 'mainline');
  var rg = splitCell(a, 'regional');
  var lab = nextGenLab(a);
  var ngCell = ngPublished
    ? '<td class="num vcell ' + band(ng) + '" data-col="nextgen">' +
      /* A literal space here, not styling: `.rankb .lab` is display:block (see
         splitCell above), so the space changes no pixel — the sco span already
         starts its own line. Without it "0/989 flying" and "0%" welded into
         "0/989 flying0%" in the rendered textContent. */
      (lab ? '<span class="lab">' + esc(lab) + '</span> ' : '') +
      /* The per cent sign is not decoration. Next-gen odds IS a percentage —
         it is round(nextGenShare * 100) — and it sits in a row beside
         "27% fitted", "12%" and "51%". Printed bare it was the one unitless
         number on the board, and a reader had to infer the unit from its
         neighbours. ConnectScore stays unitless because it is a weighted
         score, not a share of anything. */
      '<span class="sco">' + ng + '%</span> ' + bandChip(ng) + '</td>'
    : '<td class="num" data-col="nextgen"><span class="empty-state cell" title="' +
      esc(a.name + ' has launched ' + a.systemLabel + ' but has not published an aircraft count') +
      '">count unpublished</span></td>';
  /* data-key sits LAST: build/apitest.js round-trips these rows against the
     API with a regex that reads data-name, data-score and data-nextgen as
     adjacent attributes, and the card-sync key must not break that read */
  return '      <tr data-name="' + esc(a.name) + '" data-score="' + a.score + '" data-nextgen="' +
    (ngPublished ? ng : '') + '" data-mainline="' + mn.v + '" data-regional="' + rg.v +
    '" data-key="' + esc(a.key) + '">' +
    '<td class="rank">' + (i + 1) + '</td>' +
    '<td><b>' + esc(a.name) + '</b> <span class="code">' + esc(a.code || '') + '</span></td>' +
    '<td class="num vcell ' + band(a.score) + '" data-col="score"><span class="sco">' + a.score +
    '</span> ' + bandChip(a.score) + fitBadge(a) + '</td>' +
    ngCell +
    '<td class="num' + (mn.col ? ' vcell ' + mn.col : '') + '" data-col="mainline">' + mn.html + '</td>' +
    '<td class="num' + (rg.col ? ' vcell ' + rg.col : '') + '" data-col="regional">' + rg.html + '</td>' +
    '<td>' + (a.projected ? projected(a) + (PROJECTION_SRC[a.key] ?
      ' <span class="micro">' + esc(PROJECTION_SRC[a.key]) + '</span>' : '') :
      '<span class="dash" title="no signed next-generation deal outstanding">·</span>') +
    '</td></tr>';
}
/* [key, label, one-line caption]. Jeremy's refinement, verbatim: one or two
 * lines under the board, tied to the selected column, linking to /methodology/
 * rather than restating it. Tightened from D3's draft copy, not lengthened. */
var RANK_COLS = [
  /* The default column carries no caption: the board opens on it, its meaning
     is in the column-guide disclosure above, and a paragraph under the control
     before anyone touches it read as a warning label (round seven, note 5). */
  ['score', 'ConnectScore', ''],
  ['nextgen', 'Next-gen odds', 'Your chance of drawing Starlink or Amazon Leo on a random aircraft.'],
  ['mainline', 'Mainline', 'Next-gen odds on the big jets alone.'],
  ['regional', 'Regional', 'Next-gen odds on the regional fleet, where United is furthest ahead.'],
  ['name', 'A–Z', 'Alphabetical, not a ranking.']
];
function rankBoard(id, list, opts) {
  opts = opts || {};
  var btns = RANK_COLS.map(function (c, i) {
    return '<button type="button" data-sort="' + c[0] + '" aria-pressed="' + (i === 0) + '">' +
      esc(c[1]) + '</button>';
  }).join('');
  var caps = RANK_COLS.filter(function (c) { return c[2]; }).map(function (c) {
    return '<p data-for="' + c[0] + '" hidden>' + c[2] + '</p>';
  }).join('');
  var rows = list.map(function (a, i) { return rankRow(a, i); }).join('\n');
  return '<div class="rankb" id="' + id + '">\n' +
    /* needs-js on the WHOLE control row, label included, so script off never
       shows an orphan "RANK BY". .segctrl has a single-class display:flex rule
       in site.css, which build/apitest.js counts on: it is one of the elements
       proving the no-`html.js .needs-js` guard is load-bearing. */
    '  <div class="segctrl needs-js"><span class="lbl">Rank by</span>' +
    '<div class="filters" role="group" aria-label="Number to rank by">' + btns +
    '</div></div>\n' +
    '  <div class="sortcap">' + caps + '</div>\n' +
    /* header text in spans — a th's box is its row's height, and a one-line
       heading beside the two-line "Mainline next-gen" measured like a broken
       word to the layout assert; the span is the true line box */
    '  <div class="tbl-shell tablescroll"><table class="tbl" data-active="score"><thead><tr>' +
    '<th data-rc="rank"><span>#</span></th><th data-rc="name"><span>Airline</span></th>' +
    '<th class="num" data-rc="score" aria-sort="descending"><span>ConnectScore</span></th>' +
    '<th class="num" data-rc="nextgen"><span>Next-gen odds</span></th>' +
    '<th class="num" data-rc="mainline"><span>Mainline next-gen</span></th>' +
    '<th class="num" data-rc="regional"><span>Regional next-gen</span></th>' +
    '<th><span>Signed, not flying</span></th></tr></thead><tbody>\n' + rows +
    '\n  </tbody></table></div>\n' +
    boardCards(list, { dense: !!opts.dense }) +
    /* Everything below the board is ONE box: hairline-ruled rows inside a
       single border, each row under a small-caps label (round seven, notes
       7/8/11). The old six-sentence footnote is these rows now. */
    '  <div class="bfoot">\n' +
    (opts.lead || '') +
    '    <div><span class="bf-l">Dashes and grey figures</span><p>A row with no published number ' +
    'ranks with a dash, never zero. Projected figures are grey, dated and never sort.</p></div>\n' +
    '    <div class="board-note"><span class="bf-l">On a phone</span><p>Each airline renders as ' +
    'one card: rank, score with its band word, and the chance of next-gen WiFi. The segment ' +
    'split and the projected column live on the wide board and on each airline’s own ' +
    'page.</p></div>\n' +
    '  </div>\n' +
    '</div>\n';
}
/* The Big 4: United, American, Delta, Southwest, ranked on ConnectScore by
 * default (the order the page ships with script off). */
function bigFourBoard(m, opts) {
  opts = opts || {};
  var order = ['united', 'american', 'delta', 'southwest'];
  var list = order.map(function (k) { return m.A.scoreAirline(k); }).filter(Boolean)
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      /* Same tie-break as A.rankAirlines(): fitted coverage, most-resolved
         fleet first, before falling back to name. Keeps this board and the
         full 18 agreeing about what a tied score means even though this list
         is picked by key rather than read off m.ranked. */
      var bs = fitShare(b), as = fitShare(a);
      bs = bs === null ? 1 : bs; as = as === null ? 1 : as;
      if (bs !== as) return bs - as;
      return a.name.localeCompare(b.name);
    });
  var ak = m.A.scoreAirline('alaska'), jb = m.A.scoreAirline('jetblue');
  /* The worked example under the board reads United's row back to the reader,
     with every figure pulled from the same objects the row itself prints —
     the ledger's next-gen pair and the segment split — so the explanation can
     never drift from the cells it explains. */
  var u = m.A.scoreAirline('united');
  var lead = '';
  if (u && u.ledger && u.ledger.known && u.nextGenSplit && u.nextGenSplit.state === 'value') {
    var uN = u.ledger.rows.reduce(function (s, r) { return s + (r.nextGen ? r.n : 0); }, 0);
    var sMn = u.nextGenSplit.mainline, sRg = u.nextGenSplit.regional;
    lead = '    <div><span class="bf-l">Reading United’s row</span><p>Next-gen odds count ' +
      'aircraft with a published system: ' + num(uN) + ' of ' + num(u.ledger.known) + ' is the ' +
      u.nextGenScore + '. Mainline and regional count their whole segments, ' + num(sMn.of) +
      ' + ' + num(sRg.of) + ' = ' + num(sMn.of + sRg.of) + ' aircraft, so ' + sMn.pct + '% and ' +
      sRg.pct + '% sit on a bigger base and do not average to ' + u.nextGenScore + '.</p></div>\n';
  }
  /* The column guide reads as a control: a bordered disclosure, open by
     default, details/summary so it works with script off (round seven, note 4). */
  var colguide =
    '  <details class="colguide" id="colguide" open>\n' +
    '    <summary>What the columns mean</summary>\n' +
    '    <div class="cg-grid">\n' +
    '      <div class="cg"><b>ConnectScore <span class="ar">↓</span></b>0 to 100: what the fleet ' +
    'delivers today, weighted by system quality and whether it is free.</div>\n' +
    '      <div class="cg"><b>Next-gen odds <span class="ar">↓</span></b>Your chance of Starlink ' +
    'or Amazon Leo on a random aircraft with a published system.</div>\n' +
    '      <div class="cg"><b>Mainline / regional <span class="ar">↓</span></b>The same odds ' +
    'split by segment, each against its whole fleet.</div>\n' +
    '      <div class="cg"><b>Signed, not flying <span class="ar">↓</span></b>A deal on paper ' +
    'scores zero until the aircraft fly; the grey figure is the projection, with its date.</div>\n' +
    '    </div>\n' +
    '  </details>\n';
  return '<section class="blk">\n' +
    '  <span class="kicker">The Big 4</span>\n' +
    '  <h2>United, American, Delta, Southwest</h2>\n' +
    '  <p class="lede">The four biggest US airlines carry <b>76% of US seat capacity</b>, so we ' +
    'feature them here; the full table of the ' + m.airlineCount + ' airlines tracked is below. ' +
    '<a class="btn ghost mini" href="' + (opts.moreHref || '#full-board') + '">See all ' +
    m.airlineCount + ' ↓</a></p>\n' +
    '  <p class="micro">562 million seats · OAG · Jul 2026</p>\n' +
    colguide +
    rankBoard(opts.boardId || 'big4-board', list, { lead: lead }) +
    '  <p class="pointer">The Big 4 frame leaves out ' + esc(ak.name) + ' (next-gen ' +
    ak.nextGenScore + ', ' + num(ak.equipped || 0) + ' aircraft flying today) and ' + esc(jb.name) +
    ' (free fleetwide Viasat). Both are real picks for a wifi-first flyer.</p>\n' +
    '</section>\n\n';
}
/* All 18, same columns, same control, its own default ConnectScore order. */
function fullRankedBoard(m) {
  return '<section class="blk" id="full-board">\n' +
    '  <span class="kicker">Every airline</span>\n' +
    '  <h2>All ' + m.airlineCount + ', ranked</h2>\n' +
    rankBoard('full-board-rankb', m.ranked, { dense: true }) +
    '</section>\n\n';
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

/* THE FIT BADGE — the share of the fleet a score actually describes, shown
 * beside the score itself. A ConnectScore or next-gen number is computed over
 * `known` aircraft; when a chunk of the fleet is `unresolved` (airBaltic: 28
 * of 55, 27 unresolved) the score can read as fleetwide when it is really the
 * known slice at 100%. Same 0.99 cutoff as todayLine()'s existing fleetwide
 * test, so a reader meets one threshold everywhere, not a different one per
 * surface. Returns '' when the fleet is effectively fully resolved — this
 * never fires for a genuinely fleetwide airline like JSX or ZIPAIR. */
function fitShare(a) {
  if (!a.fleet || typeof (a.parts && a.parts.pctEquipped) !== 'number') return null;
  var share = a.parts.pctEquipped;
  return share >= 0.99 ? null : share;
}
function fitBadge(a) {
  var share = fitShare(a);
  /* No em dash in this string. It is boilerplate that fires once per partially-fitted
     airline, so a single pivot here is multiplied by however many airlines carry an
     unresolved bucket — and that count only grows as more figures are corrected honestly.
     On 26 Jul it went from 1.33 to 2.43 pivots per 1,000 on index.html purely because Air
     France gained an unresolved bucket, and the baseline was blessed rather than the string
     fixed. Same shape as llms.txt, where one separator between two fields cost 18 pivots at
     once. Keep it a full stop. */
  return share === null ? '' : ' <span class="micro fitpct" title="Share of the fleet with a ' +
    'confirmed fit. The rest is unresolved, not assumed either way">' + pctText(share) + ' fitted</span>';
}

/* THE DENOMINATOR ON THIS LINE IS `known`, NOT `fleet`, wherever the two differ.
 * United is 481 of 1,808 aircraft and 481 of 1,579 aircraft whose system the
 * tracker publishes, which is 27% and 30%. The share the next-gen number is
 * built from is the second one, so this line has to print the second denominator
 * or the card would show 30 next to an arithmetic that gives 27. It says which
 * denominator it is using rather than leaving the reader to reconcile it. */
function nextGenLine(m, a) {
  /* Guard against the SAS shape reaching this function some day (it does not
     today — SAS is not in US_MAJORS). nextGenScore 0 with nextGenSystem set
     (isNextGen(entry.system) is true) would otherwise fall into the branch
     below and print "on the whole fleet (0%)", inventing exactly the false
     zero this file exists to prevent. */
  if (a.nextGenPublished === false) {
    return 'Next-gen: count unpublished · ' + a.systemLabel + ' launched, no aircraft ' +
      'count released';
  }
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
    /* CORRECTED 2026-07-26 (Job 3 / airBaltic). This branch used to say
       "fleetwide" unconditionally, because `serviceTier` is "next-gen" once
       100% of the KNOWN fleet is next-gen — which airBaltic clears at 28 of
       28 known aircraft, even though 27 more are unresolved and the real
       fleet share is 51%. Apply the same fleetwide test the mixed/basic
       branches below already use: only claim fleetwide at >=99% of the whole
       fleet, unresolved aircraft included; otherwise say the share. */
    var fitShareNG = fitShare(a);
    bits.push(fitShareNG === null
      ? a.nextGenLabel + ' fleetwide'
      : a.nextGenLabel + ' on ' + pctText(fitShareNG) + ' of the fleet, the rest unresolved');
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
    /* the card wears the NEXT-GEN band, because the next-gen figure is the
       headline it leads with. Without a .sc-* here `.usrow .sco{color:var(--band)}`
       fell back to muted ink and seven scores drew grey. */
    return '<a class="card rv uscard ' + band(a.nextGenScore) + '" href="/airlines/' + a.key + '/">' +
      '<div class="ush"><h3>' + esc(a.name) + '</h3>' +
      '<span class="sco">' + a.nextGenScore + '</span>' +
      bandChip(a.nextGenScore) + '</div>' +
      '<p class="usng">' + esc(nextGenLine(m, a)) + '</p>' +
      '<p class="usnow">' + esc(todayLine(m, a, e)) + '</p>' +
      '<p class="uscs">ConnectScore ' + a.score + ' · ' + bandWord(a.score) + '</p></a>';
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
 * Hawaiian lands.
 *
 * ═══ WHY D OVERLAPS A/B/C ON PURPOSE ═════════════════════════════════════
 * Until 26 Jul 2026 the D row was `a.projected`, and C was `!a.instrumented`,
 * so American, Delta, Southwest and jetBlue were printed in TWO tiers at once
 * with no explanation. The table that exists to say how much we know was
 * filing four airlines under both "we counted their published fleet" and
 * "nothing is in the air". Both were true of different questions and the
 * table never said which.
 *
 * A, B and C now answer TODAY's question and stay mutually exclusive. D
 * answers the FORWARD question and its membership is airlines carrying a
 * projection with a next-gen score of zero, which is the same four. The
 * overlap is now stated in the row itself instead of being a silent bug.
 *
 * The blocker at t[5] is the reason each tier cannot climb, named per airline
 * rather than in general, because "no data available" is not a reason. */
function tierRows(m) {
  var verified = m.ranked.filter(function (a) { return a.key === 'united'; });
  var derived = m.ranked.filter(function (a) { return a.instrumented && a.key !== 'united'; });
  var coarse = m.ranked.filter(function (a) { return !a.instrumented; });
  /* D is the forward number, so an airline sits in D and in A/B/C at the same
     time by design. The membership below is every airline whose next-gen figure
     rests on an announcement: it has a projection and nothing next-gen flying. */
  var announced = m.ranked.filter(function (a) { return a.projected && !a.nextGenScore; });
  function names(list) { return list.map(function (a) { return a.name; }).join(', ') || 'none'; }
  return [
    ['A', 'Tail-verified', 'The aircraft on your flight is resolved to a registration, and that ' +
      'registration to an install record.', names(verified),
      'A number for one flight, with the sample size attached.',
      'Nothing, for United. For everyone else the blocker is that united.com prints the WiFi ' +
      'provider next to each upcoming flight and no other airline site prints that field. That ' +
      'one page is what joins a flight number to a tail to a system, and no amount of work on ' +
      'our side substitutes for it.'],
    ['B', 'Type-derived', 'The tails are verified the same way and nobody publishes which aircraft ' +
      'is scheduled onto which flight, so there is no history to count.', names(derived),
      'A number for an aircraft type. Not for a departure.',
      'alaskaair.com does not publish a per-flight WiFi provider, so the tracker reads the ' +
      'equipment type instead and takes WiFi status from the fleet programme state for that type. ' +
      'Two aircraft of the same type can differ and this tier cannot tell you which one you drew.'],
    ['C', 'Fleet-share', 'No per-tail verification exists, so the input is what the airline itself ' +
      'said publicly about how many aircraft are equipped.', names(coarse),
      'A number for an airline. Nothing narrower.',
      'A different wall per airline. Southwest publishes no registration alongside a flight, so ' +
      'there is no join to build. Delta runs four systems at once mid-retrofit and the retrofit ' +
      'crosses aircraft-type boundaries, so a type proxy there would put aircraft in the wrong ' +
      'generation, which is worse than saying nothing. jetBlue has one vendor and two hardware ' +
      'generations, and neither jetBlue nor Viasat has published which airframes carry which.'],
    ['D', 'Announced only', 'The forward number, and only the forward number. These airlines also ' +
      'appear in a row above, because what they fly today is known at that tier.', names(announced),
      'A promise with a year on it. Never a measurement.',
      'The calendar. American signed for 500-plus Airbus narrowbodies and installs start Q1 2027, ' +
      'so there is no installed base to measure yet. Its flight-to-tail half is already public, ' +
      'so it becomes a tier A candidate the week the first aircraft flies.']
  ];
}
function tierTable(m) {
  var rows = tierRows(m).map(function (t) {
    return '      <tr><td class="mono"><b>' + t[0] + '</b></td>' +
      '<td><b>' + esc(t[1]) + '</b><div class="note" style="margin-top:3px">' + esc(t[2]) +
      '</div><div class="note" style="margin-top:6px"><b>Blocked by:</b> ' + esc(t[5]) +
      '</div></td><td class="micro">' + esc(t[3]) + '</td>' +
      '<td class="hide-sm">' + esc(t[4]) + '</td></tr>';
  }).join('\n');
  return '<div class="tbl-shell rv"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Tier</th><th scope="col">What was checked</th><th scope="col">Airlines</th>' +
    '<th scope="col" class="hide-sm">What you can conclude</th></tr></thead>\n' +
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
    '    <thead><tr><th scope="col">Flown</th><th scope="col">Flight</th><th scope="col">Route</th><th scope="col">Aircraft</th><th scope="col">System</th>' +
    '<th scope="col" class="num">Down</th><th scope="col" class="num">Up</th><th scope="col" class="num">Latency</th>' +
    '<th scope="col">Reported by</th></tr></thead>\n' +
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
/* THE LABEL WRAPS ITS INPUT (Phase 1c). A label above a field is itself a
 * click target that focuses the input, and as a 17px-tall strip it failed the
 * 24/44px target floors on every form. Wrapping the control puts the whole
 * field inside the label's own box; `for` stays for explicitness, and the
 * visible caption lives in the .lt span so the input does not inherit the
 * label's uppercase microtype. */
function field(id, name, label, attrs, hint) {
  return '      <div class="ff"><label for="' + id + '"><span class="lt">' + esc(label) +
    '</span> ' +
    '<input id="' + id + '" name="' + name + '" ' + attrs +
    ' aria-describedby="e-' + name + '"></label>' +
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
    '      <div class="ff"><label for="f-system"><span class="lt">System</span> ' +
    '<select id="f-system" name="system" required aria-describedby="e-system">' +
    '<option value="">Pick one</option>' + opts + '</select></label>' +
    '<span class="fh">The captive portal usually names it.</span>' +
    '<p class="ferr" id="e-system" role="alert"></p></div>\n' +
    field('f-route', 'route', 'Route', 'type="text" spellcheck="false" placeholder="IAH-SFO"') +
    field('f-aircraft', 'aircraft', 'Aircraft type or tail',
      'type="text" spellcheck="false" placeholder="737-9 MAX or N27273"') +
    field('f-down', 'downMbps', 'Download, Mbps', 'type="text" inputmode="decimal" placeholder="143"') +
    field('f-up', 'upMbps', 'Upload, Mbps', 'type="text" inputmode="decimal" placeholder="18"') +
    field('f-lat', 'latencyMs', 'Latency, ms', 'type="text" inputmode="numeric" placeholder="52"') +
    '      <div class="ff"><label for="f-free"><span class="lt">Cost onboard</span> ' +
    '<select id="f-free" name="wasFree" aria-describedby="e-wasFree">' +
    '<option value="">Not saying</option><option value="true">It was free</option>' +
    '<option value="false">I paid for it</option></select></label>' +
    '<p class="ferr" id="e-wasFree" role="alert"></p></div>\n' +
    field('f-credit', 'credit', 'Name or handle to credit',
      'type="text" maxlength="60" placeholder="How the row should read"') +
    '      <div class="ff full"><label for="f-note"><span class="lt">Anything else worth ' +
    'knowing</span> ' +
    '<textarea id="f-note" name="note" maxlength="500" rows="3" aria-describedby="e-note" ' +
    'placeholder="How full the cabin was, what the portal charged, what broke"></textarea></label>' +
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

/* ── THE ROADMAP, UNDER THE SAME FENCE THE AIRLINES GET ───────────────────
 * Two lists. SHIPPED carries what exists, newest first, each with the date it
 * can be checked against. AHEAD carries what does not, each with the date it
 * entered that state and a confidence word, and each says plainly what it is
 * waiting on.
 *
 * WHAT THIS DOES NOT DO, AND THE REASON. ARCHETYPES.md asks every AHEAD item to
 * carry a horizon and to flip to SLIPPED past it. Not one of these items has a
 * published finish date — the two extension items are queued behind a Chrome Web
 * Store review nobody here schedules, and the instrumentation items land when a
 * tracker publishes per-tail data. So each row carries `since` (a real date) and
 * `waiting` (the real dependency), and NONE of them gets a horizon chip, which
 * is fence rule three applied rather than dodged: no horizon date, no chip. The
 * alternative was to type a quarter next to each one, and a site that fences
 * Delta's 2028 promise has no business inventing its own.
 *
 * The `slips` field is the hook for when that changes: give a row a date and it
 * flips to SLIPPED on the build after it passes, from the build date, without
 * waiting for anyone to notice. */
/* [date | null, title, body]. A NULL DATE IS NOT A MISSING DATE. It means the
 * row has no release announcement to point at and is checkable a better way: by
 * curling the endpoint or opening the page in the build in front of you. The
 * renderer prints the build date for those, which is a claim a reader can test
 * in one command. The alternative was to type a plausible day next to each one,
 * and a site that fences Delta's 2028 promise has no business doing that. */
var SHIPPED = [
  ['2026-07-28', 'Extension v2.0.0, renamed WiFi Odds for Flights', 'Cleared Chrome Web Store ' +
    'review. Everything v1.5.1 did on united.com and app.navan.com, plus alaskaair.com and Google ' +
    'Flights behind a permission you grant in the popup and off until you do, plus an 18-airline ' +
    'odds popup. Read off the listing body on approval day, not off the manifest.'],
  ['2026-07-28', 'Tail-swap Guardian', 'Shipped inside v2.0.0, not as a later release. Watches a ' +
    'booked flight for an equipment swap between booking and boarding. The state machine, the ' +
    'alarms and notifications permission and the popup UI all landed before 2.0.0 cleared review. ' +
    'Its own source still calls it a v1.6 prototype, and nobody has checked it end to end against ' +
    'a real swap yet.'],
  ['2026-07-24', 'Extension v1.5.1', 'Odds badges and a one-click odds sort on united.com and ' +
    'app.navan.com, plus the route panel. The date and the coverage were read off the Chrome Web ' +
    'Store listing body, not off the repository manifest.'],
  [null, 'The public ConnectScore API', 'Answering today: <code>GET /api/airlines</code> and ' +
    '<code>GET /api/airlines/qatar</code>. No key, CORS open, credits in every response body. ' +
    '<a href="/api/docs/">The docs →</a>'],
  [null, 'The projected score, fenced', 'A fourth number for carriers that have signed and ' +
    'published an aircraft count, under five rules a build tripwire checks on the bytes that ship. ' +
    '19 fenced units shipped in this build. <a href="/methodology/#projected">The rules →</a>'],
  [null, 'The rollout archive', 'One row per United tail, one date per install, running since the ' +
    'first install day on record. It is the only public per-tail archive of an inflight WiFi ' +
    'rollout, and every airline instrumented after this one inherits its priors. ' +
    '<a href="/united/fleet/">The floor →</a>']
];
var AHEAD = [
  ['2026-07-01', 'The next instrumented airline', 'SOFT',
    'Hawaiian is next on the list: the highest next-gen share of any US carrier, and already ' +
    'tail-verified.', 'A per-flight history to count. Verified tails are not enough on their own — ' +
    'that is the difference between tier A and tier B, and it is the whole reason Alaska stops at ' +
    'the sub-fleet.']
];
/* The public extension release and the tail-swap Guardian both moved OUT of this array
 * after the store listing cleared them (see the live doctrine beside the homepage
 * extension markup and build/extension-release.json). Leaving
 * either here after the fact would have said "still ahead" next to a SHIPPED
 * entry claiming the same thing, which is its own kind of false claim.
 *
 * A row slips when it has a published finish date (index 5) and that date has
 * passed with nothing shipped. The one row left carries no date, so this
 * returns `building` for it — and the day someone adds a date, the flip
 * happens on the next build without waiting for anyone to notice. */
function roadmapState(row, today) {
  return row[5] && row[5] < today ? 'slipped' : 'building';
}
function roadmapLists(m) {
  return '  <span class="kicker">Shipped</span>\n' +
    '  <div class="steps rm">' + SHIPPED.map(function (s) {
      /* Literal space before .micro: `.rm .step .sh` is display:flex with its
         own gap, so a whitespace text node between the flex items changes no
         pixel — without it "shipped" and the date welded into "shipped24 Jul
         2026". */
      return '<div class="step shipped rv"><div class="sh"><h3>' + s[1] + '</h3>' +
        '<span class="st">shipped</span> <span class="micro">' +
        (s[0] ? esc(H.chipDate(s[0])) : 'live in this build, ' + esc(H.chipDate(m.updated))) +
        '</span></div><p>' + s[2] + '</p></div>';
    }).join('') + '</div>\n\n' +
    '  <span class="kicker" style="margin-top:2rem">Ahead</span>\n' +
    '  <div class="steps rm">' + AHEAD.map(function (s) {
      /* Same flex-gap reasoning as SHIPPED above: the space costs no pixel
         and without it "SOFT" and the status line welded into "SOFTin this
         state since...". */
      return '<div class="step ' + roadmapState(s, m.updated) + ' rv"><div class="sh"><h3>' +
        esc(s[1]) + '</h3><span class="st">' + esc(s[2]) + '</span> ' +
        '<span class="micro">in this state since ' + esc(H.chipDate(s[0])) + '</span></div>' +
        '<p>' + esc(s[3]) + '</p>' +
        '<p class="micro" style="margin-top:.5rem">Waiting on: ' + esc(s[4]) + '</p></div>';
    }).join('') + '</div>\n';
}
/* Kept for anything that still wants the old three-state strip. */
var ROADMAP = SHIPPED.map(function (s) { return ['shipped', s[1], s[2]]; });
function roadmapSteps(limit) {
  return '<div class="steps rm">' + ROADMAP.slice(0, limit || ROADMAP.length).map(function (s) {
    return '<div class="step ' + s[0] + ' rv"><div class="sh"><h3>' + s[1] + '</h3>' +
      '<span class="st">' + s[0] + '</span></div><p>' + s[2] + '</p></div>';
  }).join('') + '</div>';
}

/* ── the flight check is GONE — round seven, 27 Jul 2026 ──────────────────
 * The hero answers with the skyline and the boards now. The check's client
 * script is deleted from assets/ with it; nothing may load that path. */

module.exports = {
  band: band, bandWord: bandWord, bandChip: bandChip, BAND_LEGEND: BAND_LEGEND,
  tierLetter: tierLetter,
  workedAnswer: workedAnswer, ladderCards: ladderCards, playbook: playbook,
  fenceBlock: fenceBlock, loopSection: loopSection, observeBlock: observeBlock,
  scorehead: scorehead,
  freeText: freeText, sysClass: sysClass, tagsFor: tagsFor,
  leaderboard: leaderboard, routePills: routePills, kpi: kpi,
  bigFourBoard: bigFourBoard, fullRankedBoard: fullRankedBoard, rankBoard: rankBoard,
  US_MAJORS: US_MAJORS, usRanked: usRanked, usStatus: usStatus, usGlance: usGlance,
  nextGenLine: nextGenLine, todayLine: todayLine, pctText: pctText, eqPhrase: eqPhrase,
  roadmapSteps: roadmapSteps, roadmapLists: roadmapLists, ROADMAP: ROADMAP,
  SHIPPED: SHIPPED, AHEAD: AHEAD,
  cls: cls, srcLine: srcLine, projected: projected, projCell: projCell, tape: tape,
  fieldTable: fieldTable, tierRows: tierRows, tierTable: tierTable,
  reportTable: reportTable, reportForm: reportForm, REPORT_SYSTEMS: REPORT_SYSTEMS,
  FREE: FREE
};
