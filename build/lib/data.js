'use strict';
/* build/lib/data.js — everything derived from united/data.json + assets/airlines.js.
 *
 * GROUND TRUTH, verified 2026-07-24 and the reason this file exists:
 *
 *   • data.json `history[]` holds only 2 daily entries. The "177-day archive" is
 *     `roster[]`: 481 tails each carrying a `seen` install date — 176 distinct
 *     install days, 2025-03-14 → 2026-07-23. EVERY historical chart is derived
 *     from roster[].seen. history[] is layered on top where it exists.
 *   • roster is truth for cells/rows; fleet.types[].total is truth for grid size.
 *     Roster CRJ-550 = 94 vs types.equipped 93; A321neo 32 vs 31. Tolerated.
 *   • Σ fleet.types[].total = 1295, NOT fleet.total (1807). The types breakdown
 *     does not cover the whole fleet — 193 mainline + 319 express aircraft are
 *     un-broken-out. The hangar floor is the WHOLE fleet, so two derived
 *     "other types" panels carry that remainder: 1295 + 512 = 1807 cells.
 */

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');

function loadData() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'united', 'data.json'), 'utf8')); }
function loadAirlines() { return require(path.join(ROOT, 'assets', 'airlines.js')); }

/* ── date helpers (all UTC, all ISO yyyy-mm-dd strings) ──────────────────── */
function toDate(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function toIso(d) { return d.toISOString().slice(0, 10); }
function addDays(iso, n) { var d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
function dayDiff(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
/* Monday-start ISO week */
function weekStart(iso) { var d = toDate(iso); return addDays(iso, -((d.getUTCDay() + 6) % 7)); }
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyDate(iso) { var p = iso.split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
function shortMonth(iso) { var p = iso.split('-'); return MON[+p[1] - 1] + (p[1] === '01' ? " '" + p[0].slice(2) : ''); }
function num(n) { return Number(n).toLocaleString('en-US'); }

/* ── the derived model ───────────────────────────────────────────────────── */
function build() {
  var D = loadData();
  var A = loadAirlines();
  var roster = (D.roster || []).slice();
  var hist = (D.history || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  /* installs by date, and the distinct-day count that IS the archive */
  var byDate = {};
  roster.forEach(function (r) { (byDate[r.seen] = byDate[r.seen] || []).push(r); });
  var installDays = Object.keys(byDate).sort();
  var firstDay = installDays[0];
  var lastDay = installDays[installDays.length - 1];

  /* cumulative mainline/express series, one point per date that CHANGES (plus
   * the endpoints). Straight lines between change points = the exact cumulative
   * curve, at ~180 points per series instead of 497. */
  var ml = 0, ex = 0, series = [];
  series.push({ d: firstDay, ml: 0, ex: 0 });
  installDays.forEach(function (day) {
    byDate[day].forEach(function (r) { if (r.fleet === 'express') ex++; else ml++; });
    series.push({ d: day, ml: ml, ex: ex });
  });
  /* The terminal point is always `now`: fleet.mainline/express.equipped, which is
   * what every KPI card on the page shows. Anchoring the curve there is why the
   * chart's end labels and the KPI strip can never disagree. */
  if (series[series.length - 1].d !== D.updated) series.push({ d: D.updated, ml: 0, ex: 0 });
  series[series.length - 1].ml = D.fleet.mainline.equipped;
  series[series.length - 1].ex = D.fleet.express.equipped;

  /* last 10 ISO weeks of install pace */
  var wkNow = weekStart(D.updated), weeks = [];
  for (var i = 9; i >= 0; i--) {
    var ws = addDays(wkNow, -7 * i);
    var we = addDays(ws, 6);
    var n = roster.filter(function (r) { return r.seen >= ws && r.seen <= we; }).length;
    weeks.push({ start: ws, end: we, n: n, partial: i === 0 });
  }

  /* ── hangar-floor panels ─────────────────────────────────────────────── */
  var rosterByType = {};
  roster.forEach(function (r) { (rosterByType[r.type] = rosterByType[r.type] || []).push(r); });
  Object.keys(rosterByType).forEach(function (t) {
    rosterByType[t].sort(function (a, b) {
      return a.seen < b.seen ? -1 : a.seen > b.seen ? 1 : (a.tail < b.tail ? -1 : 1);
    });
  });

  var panels = (D.fleet.types || []).map(function (t) {
    var tails = rosterByType[t.type] || [];
    return {
      type: t.type, seg: t.seg, total: t.total,
      tails: tails.slice(0, t.total),                 /* roster is truth for cells */
      equipped: Math.min(tails.length, t.total),      /* grid size caps it */
      derived: false
    };
  });

  /* the remainder the tracker does not break out, so the floor is the whole fleet */
  ['mainline', 'express'].forEach(function (seg) {
    var listed = panels.reduce(function (a, p) { return a + (p.seg === seg ? p.total : 0); }, 0);
    var rest = (D.fleet[seg] ? D.fleet[seg].total : 0) - listed;
    if (rest > 0) {
      panels.push({
        type: 'Other ' + seg + ' types', seg: seg, total: rest,
        tails: [], equipped: 0, derived: true
      });
    }
  });

  panels.sort(function (a, b) {
    var pa = a.equipped / a.total, pb = b.equipped / b.total;
    if (pb !== pa) return pb - pa;
    return b.total - a.total;
  });
  var cells = panels.reduce(function (a, p) { return a + p.total; }, 0);
  var litCells = panels.reduce(function (a, p) { return a + p.equipped; }, 0);

  /* ── registry rows, newest install first ─────────────────────────────── */
  var registry = roster.slice().sort(function (a, b) {
    return a.seen < b.seen ? 1 : a.seen > b.seen ? -1 : (a.tail < b.tail ? -1 : 1);
  }).map(function (r) {
    return {
      tail: r.tail, type: r.type, fleet: r.fleet, seen: r.seen,
      days: dayDiff(r.seen, D.updated),
      epoch: Math.round(toDate(r.seen).getTime() / 86400000)
    };
  });
  var typeCounts = {};
  roster.forEach(function (r) { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });

  /* ── odds movers (empty today — every consumer must handle that) ─────── */
  var movers = [];
  hist.slice().reverse().slice(0, 7).forEach(function (h) {
    var m = (h.moved || []).filter(Boolean);
    if (m.length) movers.push({ date: h.date, rows: m });
  });
  var newTails = [];
  hist.slice().reverse().forEach(function (h) {
    (h.newTails || []).forEach(function (t) {
      if (newTails.length < 12) newTails.push({ tail: t, date: h.date });
    });
  });

  /* ── KPI numbers ─────────────────────────────────────────────────────── */
  var F = D.fleet;
  var todayDelta = hist.length >= 2
    ? hist[hist.length - 1].equipped - hist[hist.length - 2].equipped : null;
  var remainingMainline = F.mainline.total - F.mainline.equipped;
  var weeksLeft = F.mainlinePacePerWeek > 0 ? remainingMainline / F.mainlinePacePerWeek : null;
  var etaIso = weeksLeft ? addDays(D.updated, Math.round(weeksLeft * 7)) : null;
  var etaLabel = etaIso ? (function () {
    var m = +etaIso.slice(5, 7);
    return (m <= 4 ? 'early ' : m <= 8 ? 'mid-' : 'late ') + etaIso.slice(0, 4);
  })() : null;

  return {
    D: D, A: A,
    updated: D.updated,
    source: D.source || '',
    fleet: F,
    sharePct: Math.round(F.equipped / F.total * 100),
    mainlinePct: Math.round(F.mainline.equipped / F.mainline.total * 100),
    expressPct: Math.round(F.express.equipped / F.express.total * 100),
    todayDelta: todayDelta,
    etaLabel: etaLabel,
    weeksLeft: weeksLeft ? Math.round(weeksLeft) : null,
    archiveDays: installDays.length,
    firstDay: firstDay, lastDay: lastDay,
    spanDays: dayDiff(firstDay, D.updated),
    series: series, weeks: weeks,
    weeksTotal: weeks.reduce(function (a, w) { return a + w.n; }, 0),
    panels: panels, cells: cells, litCells: litCells,
    registry: registry, typeCounts: typeCounts,
    movers: movers, newTails: newTails,
    leaderboard: (D.leaderboard || []).slice(0, 6),
    routeCount: Object.keys(D.routeCache || {}).length,
    leaderboardCount: (D.leaderboard || []).length,
    airlineCount: Object.keys(A.WIFI_AIRLINES).length,
    ranked: A.rankAirlines()
  };
}

module.exports = {
  build: build, loadData: loadData, loadAirlines: loadAirlines,
  toIso: toIso, addDays: addDays, dayDiff: dayDiff, weekStart: weekStart,
  prettyDate: prettyDate, shortMonth: shortMonth, num: num, toDate: toDate
};
