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

/* ── THE HALF MARK, AND THE SEAM ──────────────────────────────────────────
 * The homepage runs in two named halves and the reader is told where the join
 * is. First half · The record. Second half · The companion. The second one gets
 * a 4px sky rule along its top edge — the same rule the page opens on — because
 * the spec asks for a seam a reader can see rather than a heading they have to
 * infer.
 *
 * The geometry moved to assets/site.css on 25 Jul 2026, which is what the note
 * that used to sit here asked for. It had to move: an inline style beats a
 * stylesheet rule, so the 390px media query that hides the FIRST halfmark could
 * not reach it while the geometry lived on the element. The SECOND one stays
 * visible at every width, because it is a real mid-page seam and the extension
 * banner's jump link targets it. */
function halfmark(n, name, desc, id) {
  return '<div class="halfmark' + (n === 2 ? ' seam' : '') + '" id="' + esc(id) + '">' +
    '<span class="kicker n" style="margin:0">' + esc(n === 1 ? 'First half' : 'Second half') +
    '</span><strong style="font-family:var(--serif);font-size:1.05rem">' + esc(name) + '</strong>' +
    '<span class="note" style="color:var(--muted)">' + esc(desc) + '</span></div>\n\n';
}

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
    '    <div class="ffgrid">\n' +
    '      <div class="ff"><label for="' + p + '-air">Airline</label>' +
    '<input id="' + p + '-air" name="airline" type="text" required maxlength="60"></div>\n' +
    '      <div class="ff"><label for="' + p + '-fn">Flight number</label>' +
    '<input id="' + p + '-fn" name="flightNumber" type="text" required spellcheck="false" ' +
    'autocapitalize="characters" placeholder="UA2402"></div>\n' +
    '      <div class="ff"><label for="' + p + '-on">Date you flew</label>' +
    '<input id="' + p + '-on" name="flownOn" type="date" required></div>\n' +
    '      <div class="ff"><label for="' + p + '-sys">System</label>' +
    '<select id="' + p + '-sys" name="system" required><option value="">Pick one</option>' +
    opts + '</select><span class="fh">The captive portal usually names it.</span></div>\n' +
    '      <div class="ff full"><label for="' + p + '-note">What happened, or what we got wrong' +
    '</label><textarea id="' + p + '-note" name="note" maxlength="500" rows="3" ' +
    'placeholder="Whether the login worked, what a call survived, which badge was wrong"></textarea>' +
    '</div>\n' +
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
      return '    <li><span class="tag">' + esc(mv[0]) + '</span><b>' + esc(mv[1]) + '</b>' +
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
function fieldTable(m) {
  /* THE BOARD IS DRAWN NOW, Jeremy's pivot of 26 Jul 2026: every row carries a
   * fill bar whose length is the score and whose colour is the band, so the
   * table reads at a glance like a departures board. The tier letter stays (it
   * is provenance), the projection chip keeps every fence attribute, and the
   * score is still printed as a number beside its bar — the bar is a drawing OF
   * the number, never a replacement for it. */
  var rows = m.ranked.map(function (a, i) {
    var ph = MK.phaseOf(m.A, a);
    var ng = a.nextGenScore;
    return '      <tr data-f="' + ph + '">' +
      '<td class="rank">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</td>' +
      '<td><a class="aname" href="/airlines/' + a.key + '/">' + esc(a.name) +
      '<span class="code">' + esc(a.code || '') + '</span></a></td>' +
      '<td class="num ' + band(a.score) + '"><span class="sco">' + a.score + '</span> ' +
      bandChip(a.score) + '</td>' +
      /* the bar is a drawing of the number; the chip word beside the number is
         the non-colour signal, so a reader who cannot tell green from clay
         still gets the band. */
      '<td class="barcell"><span class="scobar"><i class="fill ' + band(a.score) +
      '" style="width:' + a.score + '%"></i></span></td>' +
      /* the tier letter is a CATEGORY — provenance, not score — so it stays ink */
      '<td class="micro">' + tierLetter(a) + '</td>' +
      '<td class="num ' + band(ng) + '"><span class="sco" style="font-size:1rem">' + ng +
      '</span></td>' +
      '<td class="micro phz">' + esc(MK.PHASE_LABEL[ph]) + '</td>' +
      '<td class="num">' + (a.projected ? projected(a) : '<span class="dash">&middot;</span>') +
      '</td></tr>';
  }).join('\n');

  return '<div class="tbl-shell tablescroll rv"><table class="tbl board">\n' +
    '    <thead><tr><th>#</th><th>Airline</th><th class="num">ConnectScore</th>' +
    '<th class="barcell"><span class="visually-hidden">Score drawn as a bar</span></th>' +
    '<th>Tier</th><th class="num">Next-gen odds</th><th>Rollout</th>' +
    '<th class="num">Projected · grey, never sorts</th></tr></thead>\n' +
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
      '<td class="' + band(a.score) + '" data-s="' + a.score + '"><span class="sco">' + a.score +
      '</span> ' + bandChip(a.score) + '</td>' +
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
  ['2026-07-24', 'Extension v1.5.1', 'Odds badges and a one-click odds sort on united.com and ' +
    'app.navan.com, plus the route panel. The date and the coverage are read off the Chrome Web ' +
    'Store listing body, not off the repository manifest, which is already at 2.0.0.'],
  [null, 'The public ConnectScore API', 'Answering today: <code>GET /api/airlines</code>, ' +
    '<code>GET /api/airlines/qatar</code> and <code>GET /api/score/UA212</code>. No key, CORS ' +
    'open, credits in every response body. <a href="/api/docs/">The docs →</a>'],
  [null, 'The projected score, fenced', 'A fourth number for carriers that have signed and ' +
    'published an aircraft count, under five rules a build tripwire checks on the bytes that ship. ' +
    '19 fenced units shipped in this build. <a href="/methodology/#projected">The rules →</a>'],
  [null, 'The rollout archive', 'One row per United tail, one date per install, running since the ' +
    'first install day on record. It is the only public per-tail archive of an inflight WiFi ' +
    'rollout, and every airline instrumented after this one inherits its priors. ' +
    '<a href="/united/fleet/">The floor →</a>']
];
var AHEAD = [
  ['2026-07-24', 'Extension v2.0.0', 'SOFT',
    'alaskaair.com and Google Flights behind permissions you grant yourself, and every ConnectScore ' +
    'in the popup.', 'Chrome Web Store review. Submitted 24 Jul 2026; the queue is not ours to date.'],
  ['2026-07-24', 'Tail-swap Guardian', 'SOFT',
    'Watches a booked flight for an equipment swap between booking and boarding.',
    'Extension 2.1, which follows 2.0.0 out of review. Built and in test, in no store build.'],
  ['2026-07-01', 'The next instrumented airline', 'SOFT',
    'Hawaiian is next on the list: the highest next-gen share of any US carrier, and already ' +
    'tail-verified.', 'A per-flight history to count. Verified tails are not enough on their own — ' +
    'that is the difference between tier A and tier B, and it is the whole reason Alaska stops at ' +
    'the sub-fleet.']
];
/* A row slips when it has a published finish date (index 5) and that date has
 * passed with nothing shipped. No row carries one today, so this returns
 * `building` for all three — and the day someone adds a date, the flip happens
 * on the next build without waiting for anyone to notice. */
function roadmapState(row, today) {
  return row[5] && row[5] < today ? 'slipped' : 'building';
}
function roadmapLists(m) {
  return '  <span class="kicker">Shipped</span>\n' +
    '  <div class="steps rm">' + SHIPPED.map(function (s) {
      return '<div class="step shipped rv"><div class="sh"><h3>' + s[1] + '</h3>' +
        '<span class="st">shipped</span><span class="micro">' +
        (s[0] ? esc(H.chipDate(s[0])) : 'live in this build, ' + esc(H.chipDate(m.updated))) +
        '</span></div><p>' + s[2] + '</p></div>';
    }).join('') + '</div>\n\n' +
    '  <span class="kicker" style="margin-top:2rem">Ahead</span>\n' +
    '  <div class="steps rm">' + AHEAD.map(function (s) {
      return '<div class="step ' + roadmapState(s, m.updated) + ' rv"><div class="sh"><h3>' +
        esc(s[1]) + '</h3><span class="st">' + esc(s[2]) + '</span>' +
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
    '  <span class="kicker">The one pitch on this site</span>\n' +
    '  <h2>A badge on every flight in the results</h2>\n' +
    '  <p class="sec-lede">WiFi Odds for Flights is a Chrome extension, free in the Chrome Web ' +
    'Store under that name. On a united.com or app.navan.com results page every flight picks up an ' +
    'odds badge, one click re-sorts the page by odds while prices and times stay put, and a panel ' +
    'ranks the route’s departures the way the answer card above does. No account and no tracking, ' +
    'there or here. The pictures are captures of the shipped build.</p>\n' +
    '  <div class="extdemo">\n' + C.section() + '\n  </div>\n' +
    '  <p class="prov"><b>Reported</b> · departure histories from unitedstarlinktracker.com, ' +
    esc(H.plateDate(m.updated)) + ' · badges use the board’s bands and the same numbers this site ' +
    'publishes, so when the record is wrong the badge is wrong the same way</p>\n' +
    /* State grammar, three states, no promises. The horizons live on /roadmap/,
       dated and fenced, because that is the page that owns what has not shipped. */
    '  <ul class="vstate">\n' +
    '    <li><span class="st">In the store</span> v' + esc(H.EXT_VERSION) + ' covers united.com ' +
    'and app.navan.com. A badge carries a tick once the assigned tail is confirmed equipped, and ' +
    'the percentage until then. Checked ' + esc(H.chipDate(m.updated)) + '.</li>\n' +
    '    <li><span class="st">Submitted, in review</span> v2.0.0 adds alaskaair.com and Google ' +
    'Flights, each behind a permission you grant in the popup and off until you do, plus an ' +
    m.airlineCount + '-airline odds popup. Not live until the store says so, so installing today ' +
    'gets you none of it.</li>\n' +
    '    <li><span class="st">Built, unreleased</span> Tail-swap Guardian watches a booked flight ' +
    'for an equipment swap between booking and boarding. In no store build yet; its horizon is on ' +
    '<a href="/roadmap/">the roadmap</a>, dated and fenced like everything else here.</li>\n' +
    '  </ul>\n' +
    '  <div class="cta-row"><a class="btn" href="' + H.EXT + '" target="_blank" rel="noopener">' +
    'Install v' + esc(H.EXT_VERSION) + ' from the Chrome Web Store ↗</a></div>\n' +
    '  <p class="note extfine"><b>No accounts, no analytics, no tracking.</b> It keeps your ' +
    'settings on your own machine and phones nothing home. Unofficial, and not affiliated with any ' +
    'airline, Navan, SpaceX/Starlink or the trackers.</p>\n' +
    '  <p class="src">' + cls('reported') + ' Store version and coverage read off the ' +
    '<a href="' + H.EXT + '" target="_blank" rel="noopener">Chrome Web Store listing body</a>, ' +
    '24 Jul 2026, rather than off the repository manifest, which is already at 2.0.0.</p>\n' +
    '</section>\n\n';
}

module.exports = {
  band: band, bandWord: bandWord, bandChip: bandChip, BAND_LEGEND: BAND_LEGEND,
  tierLetter: tierLetter,
  halfmark: halfmark, workedAnswer: workedAnswer, ladderCards: ladderCards, playbook: playbook,
  fenceBlock: fenceBlock, loopSection: loopSection, observeBlock: observeBlock,
  scorehead: scorehead,
  freeText: freeText, sysClass: sysClass, tagsFor: tagsFor,
  leaderboard: leaderboard, routePills: routePills, kpi: kpi,
  US_MAJORS: US_MAJORS, usRanked: usRanked, usStatus: usStatus, usGlance: usGlance,
  nextGenLine: nextGenLine, todayLine: todayLine, pctText: pctText,
  roadmapSteps: roadmapSteps, roadmapLists: roadmapLists, ROADMAP: ROADMAP,
  SHIPPED: SHIPPED, AHEAD: AHEAD,
  flightCheck: flightCheck, extensionSection: extensionSection,
  cls: cls, srcLine: srcLine, projected: projected, projCell: projCell, tape: tape,
  fieldTable: fieldTable, tierRows: tierRows, tierTable: tierTable,
  reportTable: reportTable, reportForm: reportForm, REPORT_SYSTEMS: REPORT_SYSTEMS,
  FREE: FREE
};
