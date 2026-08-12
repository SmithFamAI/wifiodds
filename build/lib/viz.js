'use strict';
/* build/lib/viz.js — every chart on the site, hand-rolled and emitted as inline
 * SVG / CSS grid AT BUILD TIME. No chart library, no canvas, no runtime chart
 * JS, no external request. The charts are in the HTML; JS only animates them,
 * and only when prefers-reduced-motion says yes.
 *
 * Colours are always CSS custom properties (--viz-*), never literals, so the
 * light theme re-colours every chart for free. */

var H = require('./html.js');
var DL = require('./data.js');
var esc = H.esc;

function r1(n) { return Math.round(n * 10) / 10; }

/* ── §3.4 rollout area timeline — stacked, express bottom, mainline top ──── */
function areaTimeline(m, opts) {
  opts = opts || {};
  var W = opts.w || 1060, HT = opts.h || 260;
  var PL = 44, PR = 58, PT = 16, PB = 26;
  var iw = W - PL - PR, ih = HT - PT - PB;
  var t0 = DL.toDate(m.series[0].d).getTime();
  var t1 = DL.toDate(m.updated).getTime();
  var span = Math.max(1, t1 - t0);
  var YMAX = 500;
  var x = function (iso) { return PL + (DL.toDate(iso).getTime() - t0) / span * iw; };
  var y = function (v) { return PT + ih - (v / YMAX) * ih; };

  var top = [], bot = [];
  m.series.forEach(function (p) {
    bot.push(r1(x(p.d)) + ',' + r1(y(p.ex)));
    top.push(r1(x(p.d)) + ',' + r1(y(p.ex + p.ml)));
  });
  var base = r1(PL) + ',' + r1(y(0)) + ' ' + r1(PL + iw) + ',' + r1(y(0));
  var exFill = 'M' + bot.join(' L') + ' L' + r1(PL + iw) + ',' + r1(y(0)) + ' L' + r1(PL) + ',' + r1(y(0)) + ' Z';
  var mlFill = 'M' + top.join(' L') + ' L' + bot.slice().reverse().join(' L') + ' Z';

  /* y gridlines + labels */
  var gl = '';
  for (var v = 0; v <= YMAX; v += 100) {
    gl += '<line class="gl" x1="' + PL + '" y1="' + r1(y(v)) + '" x2="' + (PL + iw) + '" y2="' + r1(y(v)) + '"/>' +
      '<text class="ax" x="' + (PL - 8) + '" y="' + r1(y(v) + 3) + '" text-anchor="end">' + v + '</text>';
  }
  /* x ticks at month starts */
  var months = [];
  var d = m.series[0].d;
  while (d <= m.updated) {
    if (d.slice(8) === '01') months.push(d);
    d = DL.addDays(d, 1);
  }
  var every = months.length > 10 ? 2 : 1;
  var xt = months.filter(function (_, i) { return i % every === 0; }).map(function (mo) {
    return '<text class="ax" x="' + r1(x(mo)) + '" y="' + (HT - 8) + '" text-anchor="middle">' +
      esc(DL.shortMonth(mo)) + '</text>';
  }).join('');

  var lastP = m.series[m.series.length - 1];
  var xe = r1(x(lastP.d));
  return '<svg class="viz" viewBox="0 0 ' + W + ' ' + HT + '" role="img" ' +
    'aria-label="Cumulative United Starlink installs since ' + esc(DL.prettyDate(m.firstDay)) +
    ': ' + lastP.ex + ' express and ' + lastP.ml + ' mainline aircraft, ' + (lastP.ex + lastP.ml) + ' total.">' +
    '<title>United Starlink rollout, ' + esc(DL.prettyDate(m.firstDay)) + ' → ' + esc(DL.prettyDate(m.updated)) +
    ' — express (green) and mainline (blue), stacked</title>' +
    gl +
    '<path class="a-ex" d="' + exFill + '"/>' +
    '<path class="a-ml" d="' + mlFill + '"/>' +
    '<path class="s-ex" d="M' + bot.join(' L') + '"/>' +
    '<path class="s-ml" d="M' + top.join(' L') + '"/>' +
    '<circle class="dot-ex" cx="' + xe + '" cy="' + r1(y(lastP.ex)) + '" r="4"/>' +
    '<circle class="dot-ml" cx="' + xe + '" cy="' + r1(y(lastP.ex + lastP.ml)) + '" r="4"/>' +
    '<text class="lbl" x="' + (xe + 8) + '" y="' + r1(y(lastP.ex) + 4) + '">' + lastP.ex + '</text>' +
    '<text class="lbl" x="' + (xe + 8) + '" y="' + r1(y(lastP.ex + lastP.ml) + 4) + '">' + lastP.ml + '</text>' +
    '<text class="lbl" x="' + (xe + 8) + '" y="' + (PT + 12) + '">' + (lastP.ex + lastP.ml) + ' total</text>' +
    xt + '<!--baseline ' + base + '--></svg>';
}

/* home teaser: single-series total sparkline, no axes */
function spark(m) {
  var W = 300, HT = 80, PB = 4;
  var t0 = DL.toDate(m.series[0].d).getTime();
  var span = Math.max(1, DL.toDate(m.updated).getTime() - t0);
  var max = m.fleet.equipped * 1.05;
  var pts = m.series.map(function (p) {
    var xx = (DL.toDate(p.d).getTime() - t0) / span * W;
    var yy = HT - PB - ((p.ml + p.ex) / max) * (HT - PB * 2);
    return r1(xx) + ',' + r1(yy);
  });
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + HT + '" role="img" aria-label="' +
    m.archiveDays + ' install days, rising to ' + m.fleet.equipped + ' equipped aircraft">' +
    '<path class="f" d="M' + pts.join(' L') + ' L' + W + ',' + HT + ' L0,' + HT + ' Z"/>' +
    '<path class="s" d="M' + pts.join(' L') + '"/></svg>';
}

/* ── §3.5 install-pace bars — last 10 ISO weeks ─────────────────────────── */
function paceBars(m) {
  var W = 1060, HT = 190, PL = 8, PB = 34, PT = 22;
  var n = m.weeks.length, gap = 14;
  var bw = (W - PL * 2 - gap * (n - 1)) / n;
  var max = Math.max.apply(null, m.weeks.map(function (w) { return w.n; })) || 1;
  var ih = HT - PT - PB;
  var bars = '', labs = '';
  m.weeks.forEach(function (w, i) {
    var h = Math.max(2, w.n / max * ih);
    var xx = PL + i * (bw + gap);
    bars += '<rect class="bar' + (w.partial ? ' partial' : '') + '" x="' + r1(xx) + '" y="' +
      r1(PT + ih - h) + '" width="' + r1(bw) + '" height="' + r1(h) + '" rx="4"><title>' +
      esc(DL.prettyDate(w.start)) + ' – ' + esc(DL.prettyDate(w.end)) + ': ' + w.n +
      (w.partial ? ' so far (week in progress)' : ' installs') + '</title></rect>';
    labs += '<text class="lbl" x="' + r1(xx + bw / 2) + '" y="' + r1(PT + ih - h - 7) +
      '" text-anchor="middle">' + w.n + '</text>' +
      '<text class="ax" x="' + r1(xx + bw / 2) + '" y="' + (HT - 16) + '" text-anchor="middle">' +
      esc(DL.shortMonth(w.start).replace(/ .*/, '')) + ' ' + (+w.start.slice(8)) + '</text>' +
      (w.partial ? '<text class="ax" x="' + r1(xx + bw / 2) + '" y="' + (HT - 4) +
        '" text-anchor="middle">partial</text>' : '');
  });
  /* A bar here is a COUNT of installs, so it wears the band, flat, from
     `.viz .bar{fill:var(--band)}` in assets/site.css. This function used to emit
     a <linearGradient id="pacegrad"> in sky and brand and fill the bars from it.
     Two things were wrong with that and only one of them was the gradient: the
     sky is chrome and does not paint numbers, and the site has no gradients at
     all. The def went unreferenced the moment the stylesheet took the fill over,
     so it is deleted rather than left as a temptation. */
  return '<svg class="viz" viewBox="0 0 ' + W + ' ' + HT + '" role="img" aria-label="Installs per week ' +
    'for the last 10 weeks: ' + m.weeks.map(function (w) { return w.n; }).join(', ') + '">' +
    bars + labs + '</svg>';
}

/* ── §3.3 Hangar Floor waffle ───────────────────────────────────────────── */
function waffle(m) {
  return m.panels.map(function (p) {
    var pct = Math.round(p.equipped / p.total * 100);
    var cells = [];
    /* equipped cells first, in install order — the cell order IS the timeline,
       which is what makes the CSS stagger read as the rollout replaying */
    var buckets = Math.max(1, p.equipped);
    p.tails.forEach(function (t, i) {
      var b = Math.min(19, Math.floor(i / buckets * 20));
      cells.push('<i class="eq d' + b + '" title="' + esc(t.tail) + ' · installed ' +
        esc(DL.prettyDate(t.seen)) + '"></i>');
    });
    for (var k = p.equipped; k < p.total; k++) cells.push('<i></i>');
    var cap = p.derived
      ? 'The tracker does not break these out by type, so they are shown unequipped — ' +
        'every confirmed install is already counted in a panel above.'
      : (p.equipped === 0 ? 'Awaiting first install.'
        : (p.equipped === p.total ? 'Wall of light: every aircraft of this type is equipped.'
          : 'Lit cells are confirmed installs in install order, oldest first.'));
    /* .hpanel-h is display:flex with a gap, so these spaces change no pixel --
       without them e.g. "CRJ-550" ran straight into "express" as "CRJ-550express". */
    return '<div class="hpanel rv">' +
      '<div class="hpanel-h"><span class="ty">' + esc(p.type) + '</span> ' +
      '<span class="badge ' + p.seg + '">' + p.seg + '</span> ' +
      '<span class="ct"><b>' + p.equipped + '</b> / ' + p.total + ' · ' + pct + '%</span></div>' +
      '<span class="track"><i class="fill ' + (p.seg === 'express' ? 'ex' : 'ml') +
      '" style="--pct:' + pct + '%"></i></span>' +
      '<p class="vh">' + esc(p.type) + ': ' + p.equipped + ' of ' + p.total +
      ' aircraft equipped with Starlink (' + pct + '%).</p>' +
      '<div class="waffle" aria-hidden="true">' + cells.join('') + '</div>' +
      '<div class="cap">' + cap + '</div></div>';
  }).join('\n');
}

/* home teaser: one cell per 10 aircraft across the WHOLE fleet */
function miniWaffle(m) {
  var total = Math.round(m.fleet.total / 10), lit = Math.round(m.fleet.equipped / 10);
  var out = '';
  for (var i = 0; i < total; i++) out += i < lit ? '<i class="eq"></i>' : '<i></i>';
  return '<div class="mini-waffle" aria-hidden="true">' + out + '</div>' +
    '<p class="vh">One cell per 10 United aircraft: ' + lit + ' of ' + total +
    ' cells lit, ' + m.fleet.equipped + ' of ' + m.fleet.total + ' aircraft equipped.</p>';
}

/* ── score ring (airline pages) ─────────────────────────────────────────── */
function scoreRing(score) {
  var R = 46, C = 2 * Math.PI * R;
  var on = C * (score / 100);
  return '<svg class="viz" width="120" height="120" viewBox="0 0 120 120" role="img" ' +
    'aria-label="Streaming score ' + score + ' out of 100">' +
    '<circle class="ring-bg" cx="60" cy="60" r="' + R + '" stroke-width="10"/>' +
    '<circle class="ring-fg" cx="60" cy="60" r="' + R + '" stroke-width="10" ' +
    'stroke-dasharray="' + r1(on) + ' ' + r1(C - on) + '" transform="rotate(-90 60 60)"/>' +
    '<text class="ring-n" x="60" y="70" text-anchor="middle" font-size="32">' + score + '</text></svg>';
}

module.exports = {
  areaTimeline: areaTimeline, spark: spark, paceBars: paceBars,
  waffle: waffle, miniWaffle: miniWaffle, scoreRing: scoreRing
};
