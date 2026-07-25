'use strict';
/* build/lib/pages.js — the page bodies. Every number, row and chart path in here
 * is rendered at BUILD time, which is the whole freshness architecture: the daily
 * data.json commit triggers a Pages rebuild and every page re-bakes. Client JS
 * only sorts, filters, toggles the theme and animates. Every page works with JS
 * disabled — that is a hard acceptance criterion, not an aspiration. */

var H = require('./html.js');
var V = require('./viz.js');
var DL = require('./data.js');
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
  ['planned', 'Public ConnectScore API', '<code>GET /score/UA212/2026-08-14</code> — free, credited, rate-limited.'],
  ['shipped', 'The rollout archive', 'The daily install history grows into the industry’s rollout record; ' +
    'every new airline inherits its priors.']
];
function roadmapSteps(limit) {
  return '<div class="steps rm">' + ROADMAP.slice(0, limit || ROADMAP.length).map(function (s) {
    return '<div class="step ' + s[0] + ' rv"><div class="sh"><h3>' + s[1] + '</h3>' +
      '<span class="st">' + s[0] + '</span></div><p>' + s[2] + '</p></div>';
  }).join('') + '</div>';
}

function extensionCta() {
  return '<div class="card rv"><h3>Odds while you book</h3>' +
    '<p>Colour-coded odds badges on every United flight on united.com and Navan, one-click sort by odds, ' +
    'a live route panel, and Alaska support behind an optional permission. The ConnectScore for all ' +
    'eighteen airlines rides along in the popup.</p>' +
    '<div class="cta-row"><a class="btn" href="' + H.EXT + '" target="_blank" rel="noopener">' +
    'Add to Chrome — free ↗</a><a class="btn ghost" href="/airlines/">Check an airline →</a></div>' +
    '<p class="note" style="margin-top:12px">Free · no accounts · no tracking.</p></div>';
}

module.exports = {
  band: band, freeText: freeText, sysClass: sysClass, tagsFor: tagsFor,
  leaderboard: leaderboard, routePills: routePills, kpi: kpi,
  roadmapSteps: roadmapSteps, ROADMAP: ROADMAP, extensionCta: extensionCta,
  FREE: FREE
};
