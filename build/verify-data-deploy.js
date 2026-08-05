#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function json(value, label) {
  try { return JSON.parse(value.toString('utf8')); }
  catch (error) { throw new Error(label + ': invalid JSON: ' + error.message); }
}
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function rowOrder(html) {
  return Array.from(String(html).matchAll(/class="row [^"]*" data-key="([a-z]+)"[^>]*data-rankable="true"/g), function (m) { return m[1]; });
}
function localExpected() {
  const unitedBytes = fs.readFileSync(path.join(ROOT, 'united/data.json'));
  const united = json(unitedBytes, 'local United data');
  const A = require(path.join(ROOT, 'assets/airlines.js')).WIFI_AIRLINES;
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = rowOrder(home);
  if (!united.measurementAsOf || !Number.isInteger(united.fleet.equipped) || !Number.isInteger(united.fleet.total)) {
    throw new Error('local United data lacks measurementAsOf or fleet counts');
  }
  if (order.length !== 16) throw new Error('local homepage has ' + order.length + ' ranked rows; expected 16');
  return {
    unitedBytes, united,
    alaska: A.alaska, hawaiian: A.hawaiian,
    homeOrder: order,
    ogSha: sha(fs.readFileSync(path.join(ROOT, 'assets/og.png')))
  };
}
async function get(base, fixture, route, sample) {
  if (fixture) {
    const rel = route === '/' ? 'index.html' : route.replace(/^\//, '');
    const sampleFile = path.join(fixture, 'sample-' + sample, rel);
    const file = fs.existsSync(sampleFile) ? sampleFile : path.join(fixture, rel);
    if (!fs.existsSync(file)) return { error: 'fixture missing: ' + file };
    return { ok: true, status: 200, body: fs.readFileSync(file) };
  }
  const url = base.replace(/\/$/, '') + route + (route.includes('?') ? '&' : '?') + 'cb=' + crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 20000);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal,
      headers: { 'user-agent': 'wifiodds-data-canary/1.0' } });
    return { ok: response.ok, status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { error: error.message };
  } finally { clearTimeout(timer); }
}
function checkApi(fails, key, body, expected) {
  let payload;
  try { payload = json(body, key + ' API'); }
  catch (error) { fails.push(error.message); return; }
  const airline = payload.airline || {};
  const fleet = airline.fleet || {};
  if (fleet.equipped !== expected.equipped) fails.push(key + ' equipped=' + fleet.equipped + ', expected ' + expected.equipped);
  if (fleet.total !== expected.fleet) fails.push(key + ' total=' + fleet.total + ', expected ' + expected.fleet);
  const localStarlink = (expected.segments || []).find(function (segment) { return segment.system === 'starlink'; });
  const liveStarlink = (airline.segments || []).find(function (segment) { return segment.nextGen === true; });
  if (!localStarlink || !liveStarlink || liveStarlink.aircraft !== localStarlink.n) {
    fails.push(key + ' Starlink segment disagrees with local data');
  }
  if (!localStarlink || !liveStarlink || liveStarlink.asOf !== localStarlink.as) {
    fails.push(key + ' source date=' + (liveStarlink && liveStarlink.asOf) + ', expected ' + (localStarlink && localStarlink.as));
  }
}
async function sample(base, fixture, expected, n) {
  const routes = ['/united/data.json', '/api/airlines/alaska', '/api/airlines/hawaiian', '/', '/assets/og.png'];
  const values = await Promise.all(routes.map(function (route) { return get(base, fixture, route, n); }));
  const fails = [];
  values.forEach(function (value, i) {
    if (value.error) fails.push(routes[i] + ': ' + value.error);
    else if (!value.ok) fails.push(routes[i] + ': HTTP ' + value.status);
  });
  if (fails.length) return fails;

  const servedUnited = json(values[0].body, 'served United data');
  if (sha(values[0].body) !== sha(expected.unitedBytes)) fails.push('United body differs from the reviewed artifact');
  if (servedUnited.fleet.equipped !== expected.united.fleet.equipped || servedUnited.fleet.total !== expected.united.fleet.total) {
    fails.push('United count=' + servedUnited.fleet.equipped + '/' + servedUnited.fleet.total + ', expected ' +
      expected.united.fleet.equipped + '/' + expected.united.fleet.total);
  }
  if (servedUnited.measurementAsOf !== expected.united.measurementAsOf) {
    fails.push('United measurementAsOf=' + servedUnited.measurementAsOf + ', expected ' + expected.united.measurementAsOf);
  }
  checkApi(fails, 'alaska', values[1].body, expected.alaska);
  checkApi(fails, 'hawaiian', values[2].body, expected.hawaiian);
  const liveOrder = rowOrder(values[3].body.toString('utf8'));
  if (liveOrder.join(',') !== expected.homeOrder.join(',')) {
    fails.push('homepage order=' + liveOrder.join(',') + ', expected ' + expected.homeOrder.join(','));
  }
  if (sha(values[4].body) !== expected.ogSha) fails.push('social image bytes differ from the reviewed artifact');
  return fails;
}
async function main() {
  const base = arg('--base-url', 'https://wifiodds.com');
  const fixture = arg('--fixture-dir', null);
  const samples = Number(arg('--samples', fixture ? '1' : '4'));
  if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a positive integer');
  const expected = localExpected();
  let failed = 0;
  for (let i = 1; i <= samples; i++) {
    const failures = await sample(base, fixture, expected, i);
    if (failures.length) {
      failed++;
      failures.forEach(function (failure) { console.error('sample ' + i + ' FAIL ' + failure); });
    } else console.log('sample ' + i + ' PASS');
    if (!fixture && i < samples) await new Promise(function (resolve) { setTimeout(resolve, 3000); });
  }
  if (failed) process.exit(1);
  console.log('verify-data-deploy: ' + samples + ' sample(s) match the reviewed build');
}

module.exports = { rowOrder };
if (require.main === module) main().catch(function (error) {
  console.error('verify-data-deploy: ' + error.message);
  process.exit(2);
});
