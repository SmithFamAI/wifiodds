#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const canary = require('./verify-data-deploy.js');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wifiodds-data-canary-'));
function copy(file) {
  const out = path.join(work, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), out);
}
['united/data.json', 'index.html', 'assets/og.png'].forEach(copy);
const A = require(path.join(ROOT, 'assets/airlines.js')).WIFI_AIRLINES;
const apiPayload = {};
for (const key of ['alaska', 'hawaiian']) {
  const airline = A[key];
  const starlink = airline.segments.find(function (segment) { return segment.system === 'starlink'; });
  apiPayload[key] = { airline: { fleet: { equipped: airline.equipped, total: airline.fleet },
    segments: [{ nextGen: true, aircraft: starlink.n, asOf: starlink.as }] } };
  const file = path.join(work, 'api', 'airlines', key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(apiPayload[key]));
}

const localUnited = JSON.parse(fs.readFileSync(path.join(ROOT, 'united/data.json'), 'utf8'));
function trackerPage(equipped, total) {
  return '<meta name="description" content="' + equipped + ' of ' + total +
    ' United aircraft have Starlink today, verified against united.com.">' +
    '<p>' + equipped + '<!-- --> of<!-- --> <!-- -->' + total +
    '<!-- --> <!-- -->United Airlines<!-- --> aircraft have Starlink WiFi installed</p>';
}
function writeTracker(equipped, total) {
  fs.writeFileSync(path.join(work, 'tracker.html'), trackerPage(equipped, total));
}
writeTracker(localUnited.fleet.equipped, localUnited.fleet.total);

function dayBefore(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

assert.deepStrictEqual(
  canary.parseUnitedTrackerCount(trackerPage(523, 1817)),
  { equipped: 523, total: 1817 },
  'parser reads the tracker headline count'
);
assert.deepStrictEqual(
  canary.parseUnitedTrackerCount(
    '<p>523<!-- --> of<!-- --> <!-- -->1,817<!-- --> <!-- -->United Airlines<!-- --> aircraft have Starlink WiFi installed</p>'
  ),
  { equipped: 523, total: 1817 },
  'parser reads the comment-stripped United sentence when meta is absent'
);
assert.strictEqual(canary.unitedPagesLag({
  measurementAsOf: dayBefore(localUnited.measurementAsOf),
  fleet: { equipped: localUnited.fleet.equipped - 9, total: localUnited.fleet.total }
}, { united: localUnited }), true, 'yesterday\'s valid United file is Pages lag');
assert.strictEqual(canary.unitedPagesLag({
  measurementAsOf: localUnited.measurementAsOf,
  fleet: { equipped: localUnited.fleet.equipped + 1, total: localUnited.fleet.total }
}, { united: localUnited }), false, 'same-date wrong count is not Pages lag');

function run(expect, name, extraArgs) {
  const result = cp.spawnSync(process.execPath,
    ['build/verify-data-deploy.js', '--fixture-dir', work].concat(extraArgs || []),
    { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== expect) {
    console.error(name + ': expected exit ' + expect + ', got ' + result.status);
    console.error(result.stdout + result.stderr);
    process.exit(1);
  }
  console.log(name + ': expected exit ' + expect);
  return result;
}

function writeLagSample() {
  const lag = JSON.parse(fs.readFileSync(path.join(work, 'united', 'data.json'), 'utf8'));
  lag.measurementAsOf = dayBefore(localUnited.measurementAsOf);
  lag.updated = lag.measurementAsOf;
  lag.fleet.equipped = Math.max(0, localUnited.fleet.equipped - 9);
  const sampleFile = path.join(work, 'sample-1', 'united', 'data.json');
  fs.mkdirSync(path.dirname(sampleFile), { recursive: true });
  fs.writeFileSync(sampleFile, JSON.stringify(lag));
  const staleOg = path.join(work, 'sample-1', 'assets', 'og.png');
  fs.mkdirSync(path.dirname(staleOg), { recursive: true });
  fs.writeFileSync(staleOg, Buffer.from('stale-og-from-previous-pages-deploy'));
  return lag;
}

const lag = writeLagSample();
let result = run(0, 'lagging Pages sample of yesterday\'s united/data.json');
if (!/LAG United Pages still serving/.test(result.stdout)) {
  console.error('lagging Pages control did not report LAG:\n' + result.stdout + result.stderr);
  process.exit(1);
}
if (result.stdout.indexOf(String(lag.fleet.equipped) + '/' + lag.fleet.total) < 0) {
  console.error('lagging Pages control did not name yesterday\'s count:\n' + result.stdout);
  process.exit(1);
}

result = run(0, 'mixed lagging and current Pages samples', ['--samples', '2']);
if (!/sample 1 LAG/.test(result.stdout) || !/sample 2 PASS/.test(result.stdout)) {
  console.error('mixed-sample control missed LAG then PASS:\n' + result.stdout + result.stderr);
  process.exit(1);
}
fs.rmSync(path.join(work, 'sample-1'), { recursive: true, force: true });

writeTracker(localUnited.fleet.equipped + 1, localUnited.fleet.total);
result = run(1, 'tracker disagreement');
if (!/tracker FAIL/.test(result.stderr)) {
  console.error('tracker disagreement did not fail on the tracker:\n' + result.stdout + result.stderr);
  process.exit(1);
}
writeTracker(localUnited.fleet.equipped, localUnited.fleet.total);

const unitedFile = path.join(work, 'united', 'data.json');
const servedWrong = JSON.parse(fs.readFileSync(unitedFile, 'utf8'));
servedWrong.fleet.equipped += 1;
fs.writeFileSync(unitedFile, JSON.stringify(servedWrong));
run(1, 'same-date wrong United count');
copy('united/data.json');

const alaskaFile = path.join(work, 'api', 'airlines', 'alaska');
const alaska = JSON.parse(fs.readFileSync(alaskaFile, 'utf8'));
alaska.airline.fleet.equipped += 1;
fs.writeFileSync(alaskaFile, JSON.stringify(alaska));
run(1, 'wrong Alaska count');
fs.writeFileSync(alaskaFile, JSON.stringify(apiPayload.alaska));

run(0, 'clean fixture');

fs.rmSync(work, { recursive: true, force: true });
console.log('verify-data-deploy controls: 6 passed');
