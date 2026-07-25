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
 * NOTE ON THE SCORES: American, Delta and jetBlue outrank United and Alaska on
 * this row, and that is not a bug — free fleetwide Viasat scores 0.6 × 1.0 while
 * a quarter-finished Starlink fleet scores ~0.27. The status line under each name
 * says which, so nobody reads "60" as "Starlink". */
var US_MAJORS = ['american', 'delta', 'united', 'southwest', 'alaska', 'jetblue', 'hawaiian'];

/* One line per card, GENERATED from the same fields the leaderboard row used —
 * fleet share, system, free status, and any signed-but-unflown deal. Deliberately
 * not the entry's prose `note`: those run to two sentences ("…Odds swing a lot by
 * route and aircraft type.") and would wreck a seven-across grid.
 *
 * `<1%` rather than a rounded `0%` for Southwest: 1 of 817 really is one aircraft,
 * and "0%" reads as "none", which is false. */
function usStatus(m, a, e) {
  var bits = [];
  if (a.fleet) {
    var raw = a.parts.pctEquipped * 100;
    var pct = raw > 0 && raw < 1 ? '<1%' : Math.round(raw) + '%';
    bits.push(num(a.equipped) + ' of ' + num(a.fleet) + ' on ' + a.systemLabel + ' (' + pct + ')');
  } else {
    bits.push(a.systemLabel + ' fleetwide');
  }
  bits.push(freeText(e.free));
  if (a.future) {
    bits.push((m.A.SYSTEM_LABEL[a.future.system] || a.future.system) + ' from ' + a.future.from);
  }
  return bits.join(' · ');
}

/* The set, scored and ordered. ONE function, because the row and the page's
 * ItemList must not be able to disagree about either membership or order. */
function usRanked(m) {
  return US_MAJORS.map(function (k) { return m.A.scoreAirline(k); })
    .filter(Boolean)
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
}

function usGlance(m) {
  return '  <div class="usrow">' + usRanked(m).map(function (a) {
    var e = m.A.WIFI_AIRLINES[a.key];
    return '<a class="card rv uscard" href="/airlines/' + a.key + '/">' +
      '<div class="ush"><h3>' + esc(a.name) + '</h3>' +
      '<span class="sco">' + a.score + '</span>' +
      '<span class="band ' + band(a.score) + '">' + esc(a.label) + '</span></div>' +
      '<p>' + esc(usStatus(m, a, e)) + '</p></a>';
  }).join('') + '</div>\n';
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
  ['building', 'More airlines, in rollout order', 'Hawaiian next (42 of 61 — the best US Starlink odds), ' +
    'then the near-complete fleets: WestJet, Air France, airBaltic, JSX. Each gets the United treatment ' +
    'as instrumentation lands.'],
  ['planned', 'PWA', 'Installable, offline ConnectScores, and push notifications for Guardian alerts.'],
  /* v0 is live. The status word here is read off what actually answers a curl:
     the endpoints below are real, the date-scoped variant in the original plan is
     not, so it stays out of the description rather than being implied by it. */
  ['shipped', 'Public ConnectScore API', 'Live now: <code>GET /api/airlines</code>, ' +
    '<code>GET /api/airlines/qatar</code> and <code>GET /api/score/UA212</code> — free, no key, ' +
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
    '      <p class="fchk-hint" id="fchk-hint">Any flight number — <b>UA212</b>, <b>AS15</b>, ' +
    '<b>AA1234</b> — or an airline name. Answered from our own daily-verified data, and the card ' +
    'tells you which method it used. No account, nothing stored.</p>\n' +
    '    </form>\n' +
    '    <div class="fchk-out" id="fchk-out" role="status" aria-live="polite"></div>\n' +
    '  </div>\n' +
    '  <div class="fchk-nojs no-js-only">\n' +
    '    <p class="fchk-hint">The live check needs JavaScript. Pick your airline instead — every ' +
    'page below carries the same ConnectScore, the method behind it, and how much to trust it:</p>\n' +
    '    <div class="fchk-links">' + links + '</div>\n' +
    '    <p class="fchk-hint"><a href="/airlines/">All ' + m.airlineCount +
    ' airlines, ranked →</a> · <a href="/methodology/">How we know →</a></p>\n' +
    '  </div>\n';
}

/* The compact above-the-fold plug. Deliberately ONE line and deliberately not a
 * pitch: nobody installs software from a site that has not proven value yet, so
 * the real sell is extensionSection() further down, after the check has answered
 * something. This is just a signpost to it. */
function extPlug() {
  return '  <p class="extplug"><b>Get the odds where you book</b> — free Chrome extension: ' +
    'odds badges and one-click sort on the airline’s own search results. ' +
    '<a class="extplug-go" href="' + H.EXT + '" target="_blank" rel="noopener">Add to Chrome ↗</a>' +
    '<a class="extplug-alt" href="#extension">see it work ↓</a></p>\n';
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
    '  <div class="sec-h"><h2>Get the odds where you book</h2>' +
    '<span class="sub">Chrome extension · free · v1.5.1 in the store</span>' +
    '<a class="more" href="' + H.EXT + '" target="_blank" rel="noopener">Add to Chrome ↗</a></div>\n' +
    '  <p class="sec-lede">This site answers one flight at a time. The extension answers the page ' +
    'you are already looking at: every United result picks up a colour-coded Starlink odds badge, ' +
    'and one click sorts the whole page by them — without leaving the booking flow. Below is what ' +
    'that looks like, in real screenshots rather than a mockup.</p>\n' +
    '  <div class="extdemo">\n' + C.section() + '\n  </div>\n' +
    '  <div class="grid3 extfeat">\n' +
    '    <div class="card rv"><h3>Odds badges, in the row <span class="pill live">live</span></h3>' +
    '<p>Every flight in the results gets its own badge — how often that flight number actually draws ' +
    'a Starlink aircraft, with a ✓ when the assigned tail is already confirmed. Same data, same ' +
    'honest tiers as this site.</p></div>\n' +
    '    <div class="card rv"><h3>Sort the page by odds <span class="pill live">live</span></h3>' +
    '<p>One click reorders United’s own result list best-WiFi-first, prices and times intact, so ' +
    'you can see what the good connection actually costs you. Plus a floating route panel that ' +
    'flips itself for the return leg.</p></div>\n' +
    '    <div class="card rv"><h3>Tail-swap Guardian <span class="pill soon">2.1</span></h3>' +
    '<p>Aircraft assignments change after you book. Guardian watches your booked flight from ' +
    'booking to boarding and tells you if the equipment swaps. Built and in test — not in the store ' +
    'build yet, so do not go looking for it there.</p></div>\n' +
    '  </div>\n' +
    '  <div class="extwhere"><span class="micro">Live today</span>' +
    '<span class="pill">united.com</span><span class="pill">app.navan.com</span></div>\n' +
    '  <div class="extwhere"><span class="micro">Next release</span>' +
    '<span class="pill soon">alaskaair.com <em>opt-in</em></span>' +
    '<span class="pill soon">Google Flights <em>opt-in</em></span>' +
    '<span class="pill soon">popup: all ' + m.airlineCount + ' ConnectScores</span>' +
    '<span class="pill soon">Tail-swap Guardian</span></div>\n' +
    '  <p class="note extwhy">Being straight about it: the version in the Chrome Web Store today is ' +
    '<b>1.5.1</b>, and it covers united.com and Navan. Alaska, Google Flights and the ' +
    'eighteen-airline popup are built and waiting on store review; Guardian follows in 2.1. Alaska ' +
    'and Google Flights will arrive behind an <b>optional permission</b> you grant yourself — the ' +
    'extension asks for nothing it is not using.</p>\n' +
    '  <div class="cta-row"><a class="btn" href="' + H.EXT + '" target="_blank" rel="noopener">' +
    'Add to Chrome — free ↗</a>' +
    '<a class="btn ghost" href="/privacy.html">What it can and cannot see →</a>' +
    '<a class="btn ghost" href="' + H.REPO + '" target="_blank" rel="noopener">Read the source ↗</a></div>\n' +
    '  <p class="note extfine"><b>No accounts, no analytics, no tracking</b> — it stores your ' +
    'settings locally and phones nothing home. Odds come from the same data as this site: United ' +
    'and Alaska tails verified by <a href="https://unitedstarlinktracker.com" target="_blank" ' +
    'rel="noopener">unitedstarlinktracker.com</a> and <a href="https://alaskastarlinktracker.com" ' +
    'target="_blank" rel="noopener">alaskastarlinktracker.com</a> (@martinamps); every other ' +
    'airline from public announcements. Unofficial — not affiliated with any airline, Navan, ' +
    'SpaceX/Starlink or the trackers.</p>\n' +
    '</section>\n\n';
}

module.exports = {
  band: band, freeText: freeText, sysClass: sysClass, tagsFor: tagsFor,
  leaderboard: leaderboard, routePills: routePills, kpi: kpi,
  US_MAJORS: US_MAJORS, usRanked: usRanked, usStatus: usStatus, usGlance: usGlance,
  roadmapSteps: roadmapSteps, ROADMAP: ROADMAP,
  flightCheck: flightCheck, extPlug: extPlug, extensionSection: extensionSection,
  FREE: FREE
};
