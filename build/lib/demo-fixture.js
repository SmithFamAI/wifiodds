'use strict';
/* One dated demo fixture for every public surface that shows the DEN -> SFO
 * extension example. The templates contain markers, never flight figures.
 * This module owns the facts and generates both surfaces' markup. */

var FS = require('fs');
var PATH = require('path');

var FIXTURE = {
  route: { origin: 'DEN', destination: 'SFO', host: 'united.com' },
  tier: 'Tier A',
  source: 'unitedstarlinktracker.com via united.com',
  date: '31 Jul 2026',
  rows: [
    { id: 'UA2265', equipment: '737-900', odds: 53, observations: 12,
      departure: '6:00 AM', arrival: '7:41 AM', fare: 158, from: 0, to: 1 },
    { id: 'UA700', equipment: '737-800', odds: 41, observations: null,
      departure: '11:18 AM', arrival: '1:02 PM', fare: 172, from: 1, to: 2 },
    { id: 'UA1812', equipment: 'A321neo', odds: 64, observations: 12,
      departure: '1:30 PM', arrival: '3:14 PM', fare: 164, from: 2, to: 0, winner: true },
    { id: 'UA701', equipment: '737-800', odds: 36, observations: null,
      departure: '9:09 PM', arrival: '10:47 PM', fare: 181, from: 3, to: 3 }
  ],
  decisions: {
    winner: '<section class="usl-decision usl-decision--winner" data-usl-state="winner" role="status"><div class="usl-decision__top"><p class="usl-decision__kicker">Best WiFi choice</p><span class="usl-badge usl-hi">64%</span></div><h2 class="usl-decision__title">UA1812</h2><p class="usl-decision__comparison">11 points higher historical odds than UA2265</p><p class="usl-decision__evidence">12 tracked departures · Medium confidence · Historical tracker odds</p><button type="button" class="usl-decision__cta">Prioritize UA1812</button></section>',
    confirmed: '<section class="usl-decision usl-decision--winner" data-usl-state="winner" role="status"><div class="usl-decision__top"><p class="usl-decision__kicker">Best WiFi choice</p><span class="usl-badge usl-hi">68%</span></div><h2 class="usl-decision__title">UA1596</h2><p class="usl-decision__comparison">38 points higher historical odds than UA1214</p><p class="usl-decision__confirm">✓ Confirmed for 2026-08-01</p><p class="usl-decision__evidence">51 tracked departures · High confidence · Historical tracker odds</p><button type="button" class="usl-decision__cta">Prioritize UA1596</button></section>',
    close: '<section class="usl-decision usl-decision--close" data-usl-state="close" role="status"><p class="usl-decision__kicker">No clear winner</p><p class="usl-decision__comparison">Top two are 5 points apart</p><p class="usl-decision__evidence">UA700 41% · UA701 36%</p><p class="usl-decision__note">Flights stay in the booking site\'s order.</p></section>',
    lowgrade: '<section class="usl-decision usl-decision--close" data-usl-state="close" role="status"><p class="usl-decision__kicker">No clear winner</p><p class="usl-decision__comparison">The leader is based on limited history</p><p class="usl-decision__evidence">UA900 leads, but its odds are not decision-grade.</p><p class="usl-decision__note">Flights stay in the booking site\'s order.</p></section>',
    single: '<section class="usl-decision usl-decision--single" data-usl-state="single" role="status"><p class="usl-decision__kicker">Not enough to compare</p><p class="usl-decision__comparison">Only UA800 has a score</p><p class="usl-decision__evidence">55% · 42 tracked departures · Historical tracker odds</p><p class="usl-decision__note">Other flights stay unscored and in place.</p></section>',
    loading: '<section class="usl-decision usl-decision--loading" data-usl-state="loading" role="status" aria-busy="true"><p class="usl-decision__kicker">Checking this page</p><p class="usl-decision__comparison">Comparing WiFi history…</p><div class="usl-decision__skel"></div><div class="usl-decision__skel usl-decision__skel--short"></div></section>',
    unavailable: '<section class="usl-decision usl-decision--unavailable" data-usl-state="unavailable" role="status"><p class="usl-decision__kicker">Comparison unavailable</p><p class="usl-decision__comparison">We couldn\'t refresh flight odds.</p><p class="usl-decision__note">Page order is unchanged. Use ↻ to retry.</p></section>',
    nodata: '<section class="usl-decision usl-decision--no-data" data-usl-state="no-data" role="status"><p class="usl-decision__kicker">No comparison available</p><p class="usl-decision__comparison">No direct-flight Starlink history for this route yet.</p></section>'
  }
};

function esc(s) {
  return String(s).replace(/[&<>\"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function displayId(id) { return id.replace(/^([A-Z]{2})(\d+)$/, '$1 $2'); }
function band(odds) { return odds >= 50 ? 'hi' : 'mid'; }
function factText(row) {
  return row.id + ' · ' + row.odds + '% · ' + FIXTURE.tier + ' · ' + FIXTURE.source + ' · ' + FIXTURE.date;
}
function fact(row) {
  return '<span class="demo-fact" data-demo-fact-id="' + row.id + '" ' +
    'style="display:block;margin-top:4px;color:#9f9fa9;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace">' +
    esc(factText(row)) + '</span>';
}
function rowById(id) {
  var row = FIXTURE.rows.filter(function (r) { return r.id === id; })[0];
  if (!row) throw new Error('DemoFixture: unknown flight id ' + id);
  return row;
}

function homeMarkup() {
  var rows = ['UA1812', 'UA2265'].map(rowById);
  return '<div class="browser" aria-label="Example extension results for DEN to SFO">' +
    '<div class="chrome"><i></i><i></i><i></i><span>united.com · DEN → SFO</span></div>' +
    '<div class="route"><div class="extension-brand"><span class="mini-mark">WO</span>' +
    '<span><b>WiFi Odds</b> <small>Next-gen mode</small></span><span class="extension-live">LIVE</span></div>' +
    '<div class="route-head"><b>Best next-gen odds on this route</b> <span>2 flights shown</span></div>' +
    rows.map(function (r, i) {
      return '<div class="flight"><div><div class="times"><b>' + r.departure + '</b><i></i><b>' +
        r.arrival + '</b></div><small>United · ' + displayId(r.id) + ' · nonstop</small>\n' + fact(r) +
        '</div><span class="odds' + (i ? ' alt' : '') + '">' + r.odds + '%</span></div>';
    }).join('') +
    '<button class="sort-btn" type="button">Sort page by next-gen odds</button>' +
    '<div class="privacy"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
    'Your booking and payment pages are never touched.</div></div></div>';
}

function extensionRow(r) {
  return '<div class="row' + (r.winner ? ' demo-win' : '') + '" data-from="' + r.from +
    '" data-to="' + r.to + '"><div class="rl"><div class="fn">' + displayId(r.id) +
    ' <span class="mut">· ' + r.equipment + '</span></div><div class="mrow"><span class="usl-metrics" ' +
    'data-ng-state="prob"><span class="usl-ng usl-ng--prob"><span class="usl-ng__label">NEXT-GEN</span> ' +
    '<span class="usl-ng__value usl-badge usl-' + band(r.odds) + '">' + r.odds + '%</span>' +
    (r.observations ? ' <span class="usl-ng__sub">' + r.observations + ' tracked</span>' : '') +
    '</span></span></div>\n' + fact(r) + '</div><div class="fare"><div class="fl">Economy</div>' +
    '<div class="fp">$' + r.fare + '</div></div></div>';
}
function extensionRowsMarkup() { return FIXTURE.rows.map(extensionRow).join('\n          '); }
function extensionScriptMarkup() {
  return 'const DEMO_FIXTURE = ' + JSON.stringify(FIXTURE) + ';\nconst DH = DEMO_FIXTURE.decisions;';
}

function collectFacts(html, label) {
  var found = {};
  var re = /<span class="demo-fact" data-demo-fact-id="([^"]+)"[^>]*>([^<]+)<\/span>/g;
  var m;
  while ((m = re.exec(html))) {
    if (found[m[1]]) throw new Error('DemoFixture guard: ' + label + ' renders ' + m[1] + ' more than once');
    found[m[1]] = m[2];
  }
  return found;
}
function assertRenderedParity(homeHtml, extensionHtml) {
  var home = collectFacts(homeHtml, 'homepage');
  var extension = collectFacts(extensionHtml, 'extension page');
  var expected = ['UA1812', 'UA2265'];
  expected.forEach(function (id) {
    var want = esc(factText(rowById(id)));
    if (!home[id] || !extension[id]) {
      throw new Error('DemoFixture guard: shared flight ' + id + ' is missing from ' +
        (!home[id] ? 'homepage' : 'extension page'));
    }
    if (home[id] !== extension[id] || home[id] !== want) {
      throw new Error('DemoFixture guard: shared flight ' + id + ' diverged.\n  home:      ' + home[id] +
        '\n  extension: ' + extension[id] + '\n  fixture:   ' + want);
    }
  });
  if (Object.keys(home).sort().join(',') !== expected.sort().join(',')) {
    throw new Error('DemoFixture guard: homepage shared-flight set drifted: ' + Object.keys(home).join(', '));
  }
  return expected.length;
}

module.exports = {
  FIXTURE: FIXTURE,
  homeMarkup: homeMarkup,
  extensionRowsMarkup: extensionRowsMarkup,
  extensionScriptMarkup: extensionScriptMarkup,
  assertRenderedParity: assertRenderedParity
};

if (require.main === module) {
  var root = PATH.join(__dirname, '..', '..');
  var home = FS.readFileSync(PATH.join(root, 'index.html'), 'utf8');
  var extension = FS.readFileSync(PATH.join(root, 'extension', 'index.html'), 'utf8');
  if (process.argv.indexOf('--control') !== -1) {
    extension = extension.replace('UA1812 · 64% · Tier A', 'UA1812 · 63% · Tier A');
  }
  var checked = assertRenderedParity(home, extension);
  console.log('demo-fixture guard OK: ' + checked + ' shared flights carry byte-identical figure, tier, source and date');
}
