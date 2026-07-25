'use strict';
/* build/lib/reports.js — the build's read path for reader field reports.
 *
 * It reads ONE file, assets/reports.json, which build/pull-reports.js commits.
 * There is no network call here and there must never be one: the daily refresh
 * runs unattended at 04:32 and the whole point of the split is that the build
 * cannot fail because a database was slow.
 *
 * Everything here is defensive on purpose. A missing file, a truncated file, a
 * file full of nulls — all of them return an empty set rather than throwing,
 * because a page with no field reports on it is a small loss and a build that
 * will not run is a large one.
 *
 * FIELD REPORT is not MEASURED. One reader, one flight, one speed test, and the
 * aircraft, the cell it was over and the number of people on the wifi are all
 * different from the next reader's. These numbers belong next to a name and a
 * date, never inside a ConnectScore and never averaged into a median the
 * methodology page cites. `kind` carries that label on every row.
 */

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var FILE = path.join(ROOT, 'assets', 'reports.json');

var EMPTY = {
  generated: null, count: 0, reports: [], byKey: {}, keys: [],
  present: false, kind: 'FIELD REPORT'
};

function num(v) {
  var n = Number(v);
  return typeof v === 'number' || (typeof v === 'string' && v !== '' && isFinite(n)) ? n : null;
}

function median(list) {
  var xs = list.filter(function (n) { return typeof n === 'number' && isFinite(n); })
    .sort(function (a, b) { return a - b; });
  if (!xs.length) return null;
  var mid = Math.floor(xs.length / 2);
  var m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/* Which airline a report belongs to, from its flight-number prefix, checked
 * against the same code table the scoring uses. The airline NAME the reader
 * typed is free text and is not trusted for this — "united", "United Airlines"
 * and "UAL" are all one carrier and none of them is a key. */
function keyFor(report, codeToKey) {
  var m = /^([A-Z][A-Z0-9])/.exec(String(report.flightNumber || '').toUpperCase());
  return m && codeToKey[m[1]] ? codeToKey[m[1]] : null;
}

function load(airlines) {
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return Object.assign({}, EMPTY, { why: 'assets/reports.json is missing or unreadable' });
  }
  if (!raw || !Array.isArray(raw.reports)) {
    return Object.assign({}, EMPTY, { why: 'assets/reports.json has no reports[] array' });
  }

  var A = airlines || require(path.join(ROOT, 'assets', 'airlines.js'));
  var codeToKey = {};
  Object.keys(A.WIFI_AIRLINES).forEach(function (k) {
    var c = A.WIFI_AIRLINES[k].code;
    if (c) codeToKey[String(c).toUpperCase()] = k;
  });

  var reports = raw.reports.filter(function (r) {
    return r && r.flownOn && r.airline && r.flightNumber && r.system;
  }).map(function (r) {
    return {
      id: r.id || null,
      flownOn: r.flownOn,
      airline: r.airline,
      flightNumber: String(r.flightNumber).toUpperCase(),
      route: r.route || null,
      aircraft: r.aircraft || null,
      system: r.system,
      systemLabel: (A.SYSTEM_LABEL && A.SYSTEM_LABEL[r.system]) || r.system,
      downMbps: num(r.downMbps),
      upMbps: num(r.upMbps),
      latencyMs: num(r.latencyMs),
      wasFree: typeof r.wasFree === 'boolean' ? r.wasFree : null,
      note: r.note || null,
      credit: r.credit || null,
      kind: r.kind || 'FIELD REPORT',
      key: null
    };
  }).sort(function (a, b) { return a.flownOn < b.flownOn ? 1 : a.flownOn > b.flownOn ? -1 : 0; });

  var byKey = {};
  reports.forEach(function (r) {
    r.key = keyFor(r, codeToKey);
    if (r.key) (byKey[r.key] = byKey[r.key] || []).push(r);
  });

  var downs = reports.map(function (r) { return r.downMbps; });
  return {
    generated: raw.generated || null,
    source: raw.source || null,
    means: raw.means || null,
    kind: 'FIELD REPORT',
    present: reports.length > 0,
    count: reports.length,
    reports: reports,
    byKey: byKey,
    keys: Object.keys(byKey).sort(),
    latest: reports.length ? reports[0].flownOn : null,
    earliest: reports.length ? reports[reports.length - 1].flownOn : null,
    downMedian: median(downs),
    downMin: downs.reduce(function (a, n) { return n === null ? a : (a === null || n < a ? n : a); }, null),
    downMax: downs.reduce(function (a, n) { return n === null ? a : (a === null || n > a ? n : a); }, null)
  };
}

/* Every report for one airline key, newest first. Empty array when there are
 * none — a page should render nothing rather than an empty-state apology. */
function forKey(model, key) {
  return (model && model.byKey && model.byKey[key]) || [];
}

module.exports = { load: load, forKey: forKey, median: median, FILE: FILE };
