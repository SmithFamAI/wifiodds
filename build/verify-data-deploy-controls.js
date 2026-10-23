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
// These controls exercise the unchanged ordinary/raw-equality contract.
// Corrected-source proof has separate full-population controls. A disposable
// reviewed tree keeps this suite usable after production adopts that policy.
const reviewed = path.join(work,'reviewed');
for(const rel of ['build/verify-data-deploy.js','scripts/reconcile-ua-membership.js','scripts/ua-membership-policy.js','scripts/ua-membership-hold.json','assets/airlines.js','index.html','assets/og.png','assets/united-starlink-badge.svg','united/data.json']) {
  const dest=path.join(reviewed,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(ROOT,rel),dest);
}
const ordinary=JSON.parse(fs.readFileSync(path.join(reviewed,'united/data.json'),'utf8'));
delete ordinary.fleet.membership;
fs.writeFileSync(path.join(reviewed,'united/data.json'),JSON.stringify(ordinary));
function copy(file) {
  const out = path.join(work, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(reviewed, file), out);
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

const localUnited = ordinary;
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

// The pre-fix predicate. Same-day commits share measurementAsOf, so this
// returned false and the confirm step hard-failed on the byte check. The
// assertions below fail if unitedPagesLag() is reverted to this.
function unitedPagesLagBeforeSameDateBytes(served, expected) {
  if (!served || !served.fleet) return false;
  const asOf = served.measurementAsOf || served.updated;
  const expAsOf = expected.united && expected.united.measurementAsOf;
  if (typeof asOf !== 'string' || typeof expAsOf !== 'string' || asOf >= expAsOf) return false;
  const equipped = served.fleet.equipped;
  const total = served.fleet.total;
  if (!Number.isInteger(equipped) || !Number.isInteger(total) || total <= 0 || equipped < 0 || equipped > total) {
    return false;
  }
  return true;
}
const sameDateBytes = Buffer.from(JSON.stringify(localUnited));
const sameDateExpected = { united: localUnited, unitedBytes: sameDateBytes };
const sameDateServed = JSON.parse(sameDateBytes.toString('utf8'));
const differentBytes = Buffer.from(JSON.stringify(Object.assign(JSON.parse(sameDateBytes.toString('utf8')), { earlierSameDay: true })));
const differentServed = JSON.parse(differentBytes.toString('utf8'));
const invalidServed = JSON.parse(differentBytes.toString('utf8'));
invalidServed.fleet = { equipped: -1, total: localUnited.fleet.total };
const newerServed = JSON.parse(differentBytes.toString('utf8'));
newerServed.measurementAsOf = '2999-01-01';
const olderServed = {
  measurementAsOf: dayBefore(localUnited.measurementAsOf),
  fleet: { equipped: localUnited.fleet.equipped - 9, total: localUnited.fleet.total }
};
const requireBytes = { requireCurrent: true, servedBytes: differentBytes };
assert.strictEqual(unitedPagesLagBeforeSameDateBytes(differentServed, sameDateExpected), false,
  'self-test: old logic does not treat a same-date byte mismatch as lag');
assert.notStrictEqual(
  canary.unitedPagesLag(differentServed, sameDateExpected, requireBytes),
  unitedPagesLagBeforeSameDateBytes(differentServed, sameDateExpected),
  'self-test: same-date byte lag must fail against the old logic'
);
assert.strictEqual(canary.unitedPagesLag(olderServed, sameDateExpected), true,
  'served older date is Pages lag');
assert.strictEqual(canary.unitedPagesLag(differentServed, sameDateExpected, requireBytes), true,
  'served same date, valid shape, different bytes, --require-current is Pages lag');
assert.strictEqual(canary.unitedPagesLag(sameDateServed, sameDateExpected, {
  requireCurrent: true, servedBytes: sameDateBytes
}), false, 'served same date and identical bytes is not Pages lag');
assert.strictEqual(canary.unitedPagesLag(invalidServed, sameDateExpected, {
  requireCurrent: true, servedBytes: Buffer.from(JSON.stringify(invalidServed))
}), false, 'served same date with an invalid shape is not Pages lag');
assert.strictEqual(canary.unitedPagesLag(newerServed, sameDateExpected, {
  requireCurrent: true, servedBytes: Buffer.from(JSON.stringify(newerServed))
}), false, 'served newer date is not Pages lag');
assert.strictEqual(canary.unitedPagesLag(differentServed, sameDateExpected, {
  requireCurrent: false, servedBytes: differentBytes
}), false, 'without --require-current a same-date byte mismatch is not Pages lag');
assert.strictEqual(canary.unitedPagesLag(differentServed, sameDateExpected), false,
  'without --require-current the two-argument call is unchanged');
console.log('self-test: old same-date byte predicate is not lag; current predicate is lag');

function run(expect, name, extraArgs) {
  const result = cp.spawnSync(process.execPath,
    ['build/verify-data-deploy.js', '--fixture-dir', work].concat(extraArgs || []),
    { cwd: reviewed, encoding: 'utf8' });
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

function dayAfter(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function installCurrentRoutes() {
  fs.copyFileSync(path.join(reviewed, 'assets/united-starlink-badge.svg'), path.join(work, 'assets/united-starlink-badge.svg'));
  const unitedApi = { airline: { fleet: { equipped: localUnited.fleet.equipped, total: localUnited.fleet.total } } };
  const file = path.join(work, 'api', 'airlines', 'united');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(unitedApi));
}
function writeServedUnited(mutate) {
  const served = JSON.parse(fs.readFileSync(unitedFile, 'utf8'));
  mutate(served);
  fs.writeFileSync(unitedFile, JSON.stringify(served));
}
installCurrentRoutes();
run(0, 'require-current same-date identical bytes', ['--require-current']);

writeServedUnited(function (served) { served.earlierSameDay = true; });
result = run(3, 'require-current same-date different bytes', ['--require-current']);
if (!/LAG United Pages still serving/.test(result.stdout) || !/propagation lag/.test(result.stderr)) {
  console.error('same-date byte lag was not retried:\n' + result.stdout + result.stderr);
  process.exit(1);
}
if (result.stdout.indexOf('as of ' + localUnited.measurementAsOf) < 0) {
  console.error('same-date byte lag did not name the shared measurement date:\n' + result.stdout);
  process.exit(1);
}
copy('united/data.json');

writeServedUnited(function (served) { served.fleet.equipped = -1; });
result = run(1, 'require-current same-date invalid shape', ['--require-current']);
if (/propagation lag/.test(result.stderr) || /LAG United Pages/.test(result.stdout)) {
  console.error('invalid shape was treated as Pages lag:\n' + result.stdout + result.stderr);
  process.exit(1);
}
copy('united/data.json');

writeServedUnited(function (served) { served.measurementAsOf = dayAfter(localUnited.measurementAsOf); });
result = run(1, 'require-current newer measurement date', ['--require-current']);
if (!/United measurementAsOf=/.test(result.stderr) || /propagation lag/.test(result.stderr) || /LAG United Pages/.test(result.stdout)) {
  console.error('newer measurement date did not stay a hard failure:\n' + result.stdout + result.stderr);
  process.exit(1);
}
copy('united/data.json');

writeServedUnited(function (served) { served.earlierSameDay = true; });
result = run(1, 'same-date different bytes without --require-current');
if (/LAG United Pages/.test(result.stdout) || !/United body differs/.test(result.stderr)) {
  console.error('same-date byte mismatch without --require-current changed behavior:\n' + result.stdout + result.stderr);
  process.exit(1);
}
copy('united/data.json');

const homeFile = path.join(work, 'index.html');
const homeBytes = fs.readFileSync(homeFile);
fs.writeFileSync(homeFile, Buffer.concat([homeBytes, Buffer.from('\n')]));
result = run(1, 'require-current homepage mismatch with current United JSON', ['--require-current']);
fs.writeFileSync(homeFile, homeBytes);
if (/propagation lag/.test(result.stderr) || /LAG United Pages/.test(result.stdout) || !/homepage bytes differ/.test(result.stderr)) {
  console.error('current United JSON did not keep a homepage mismatch hard:\n' + result.stdout + result.stderr);
  process.exit(1);
}

fs.rmSync(work, { recursive: true, force: true });
console.log('verify-data-deploy controls: 12 passed');
