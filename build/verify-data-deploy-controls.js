#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wifiodds-data-canary-'));
function copy(file) {
  const out = path.join(work, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), out);
}
['united/data.json', 'index.html', 'assets/og.png'].forEach(copy);
const A = require(path.join(ROOT, 'assets/airlines.js')).WIFI_AIRLINES;
for (const key of ['alaska', 'hawaiian']) {
  const airline = A[key];
  const starlink = airline.segments.find(function (segment) { return segment.system === 'starlink'; });
  const payload = { airline: { fleet: { equipped: airline.equipped, total: airline.fleet },
    segments: [{ nextGen: true, aircraft: starlink.n, asOf: starlink.as }] } };
  const file = path.join(work, 'api', 'airlines', key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
}
function run(expect, name) {
  const result = cp.spawnSync(process.execPath, ['build/verify-data-deploy.js', '--fixture-dir', work],
    { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== expect) {
    console.error(name + ': expected exit ' + expect + ', got ' + result.status);
    console.error(result.stdout + result.stderr);
    process.exit(1);
  }
  console.log(name + ': expected exit ' + expect);
}
run(0, 'clean fixture');

const unitedFile = path.join(work, 'united', 'data.json');
const united = JSON.parse(fs.readFileSync(unitedFile, 'utf8'));
united.refreshAttemptedOn = united.measurementAsOf;
united.measurementAsOf = '1999-01-01';
fs.writeFileSync(unitedFile, JSON.stringify(united));
run(1, 'stale United measurement with fresh attempt date');
copy('united/data.json');

const alaskaFile = path.join(work, 'api', 'airlines', 'alaska');
const alaska = JSON.parse(fs.readFileSync(alaskaFile, 'utf8'));
alaska.airline.fleet.equipped += 1;
fs.writeFileSync(alaskaFile, JSON.stringify(alaska));
run(1, 'wrong Alaska count');

fs.rmSync(work, { recursive: true, force: true });
console.log('verify-data-deploy controls: 3 passed');
