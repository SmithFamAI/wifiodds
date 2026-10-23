#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { reconcileMembership, settleMembershipCapture } = require('../scripts/reconcile-ua-membership.js');
const { validatePolicy, disclosure } = require('../scripts/ua-membership-policy.js');

const ROOT = path.resolve(__dirname, '..');
const TRACKER_ORIGIN = 'https://unitedstarlinktracker.com';

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
  return Array.from(String(html).matchAll(/class="row [^"]*"[^>]*data-key="([a-z]+)"[^>]*data-rankable="true"/g), function (m) { return m[1]; });
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
    homeSha: sha(home),
    badgeSha: sha(fs.readFileSync(path.join(ROOT, 'assets/united-starlink-badge.svg'))),
    ogSha: sha(fs.readFileSync(path.join(ROOT, 'assets/og.png')))
  };
}

/* Owner ruling 16 Aug 2026: unitedstarlinktracker.com is the United number.
   A lagging Cloudflare Pages sample of yesterday's /united/data.json is not
   a failed deploy and must not by itself trigger revert. Reckless remains
   publishing a count the tracker does not support. */
function parseUnitedTrackerCount(html) {
  const source = String(html);
  const meta = source.match(/<meta\s+name=["']description["']\s+content=["']([\d,]+)\s+of\s+([\d,]+)\s+United aircraft have Starlink today/i);
  const pair = meta || source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#x27|apos);/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .match(/([\d,]+)\s+of\s+([\d,]+)\s+United(?: Airlines)? aircraft[\s\S]{0,120}have Starlink/i);
  if (!pair) throw new Error('United tracker count is missing');
  const equipped = Number(pair[1].replace(/,/g, ''));
  const total = Number(pair[2].replace(/,/g, ''));
  if (!Number.isInteger(equipped) || !Number.isInteger(total) || equipped < 0 || total <= 0 || equipped > total) {
    throw new Error('United tracker count is invalid: ' + equipped + '/' + total);
  }
  return { equipped: equipped, total: total };
}

function unitedPagesLag(served, expected) {
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

async function readTracker(fixture, trackerPath) {
  if (trackerPath) {
    if (!fs.existsSync(trackerPath)) throw new Error('tracker fixture missing: ' + trackerPath);
    return parseUnitedTrackerCount(fs.readFileSync(trackerPath, 'utf8'));
  }
  if (fixture) {
    const file = path.join(fixture, 'tracker.html');
    if (!fs.existsSync(file)) throw new Error('fixture missing tracker.html');
    return parseUnitedTrackerCount(fs.readFileSync(file, 'utf8'));
  }
  const response = await get(TRACKER_ORIGIN, null, '/', 0);
  if (response.error) throw new Error('United tracker: ' + response.error);
  if (!response.ok) throw new Error('United tracker: HTTP ' + response.status);
  return parseUnitedTrackerCount(response.body.toString('utf8'));
}

function verifyMembershipSource(data, tracker, source, now = Date.now()) {
  const p = data.fleet.membership;
  if (!p) {
    assert.deepEqual(tracker, {equipped:data.fleet.equipped,total:data.fleet.total}, 'tracker count differs from artifact');
    return null;
  }
  assert(Array.isArray(p.excludedTails) && p.raw && p.corrected, 'membership metadata is malformed');
  validatePolicy(p,now);
  assert(source && source.api && source.summary && typeof source.registry === 'string', 'complete membership source required');
  const derived = reconcileMembership(source.api,source.summary,source.registry,now).provenance;
  assert.deepEqual(p,derived,'accepted membership provenance differs from complete source');
  assert.deepEqual(tracker,derived.raw,'raw tracker headline differs from complete source');
  assert.deepEqual(derived.corrected,{equipped:data.fleet.equipped,total:data.fleet.total},'source count differs from artifact');
  assert.equal(data.tracker && data.tracker.lastUpdated,derived.sourceTimestamp,'accepted source clock differs');
  if (p.excludedTails.length) assert.equal(p.disclosure,disclosure(p),'correction disclosure differs');
  return derived;
}

async function readMembershipSource(fixture) {
  const routes=['/api/data','/api/fleet-summary','/fleet'];
  // Sequential: a denied request stops the remaining source reads.
  const values=[];
  for (const route of routes) {
    const result=await get(TRACKER_ORIGIN,fixture && path.join(fixture,'tracker-source'),route,0);
    if(result.error || !result.ok) throw new Error('membership source '+route+': '+(result.error || 'HTTP '+result.status));
    values.push(result.body);
  }
  return {api:json(values[0],'source API'),summary:json(values[1],'source summary'),registry:values[2].toString('utf8')};
}

async function verifyCapturedMembershipSource(data, tracker, source, timing) {
  if (!source) return verifyMembershipSource(data, tracker, source);
  const capture = await settleMembershipCapture(source.api, source.summary, timing);
  console.log('membership capture clock: ' + JSON.stringify(capture));
  return verifyMembershipSource(data, tracker, source, capture.evaluatedAt);
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
async function sample(base, fixture, expected, n, requireCurrent = false) {
  const routes = ['/united/data.json', '/api/airlines/alaska', '/api/airlines/hawaiian', '/', '/assets/og.png'];
  if(requireCurrent) routes.push('/api/airlines/united','/assets/united-starlink-badge.svg');
  const values = await Promise.all(routes.map(function (route) { return get(base, fixture, route, n); }));
  const fails = [];
  values.forEach(function (value, i) {
    if (value.error) fails.push(routes[i] + ': ' + value.error);
    else if (!value.ok) fails.push(routes[i] + ': HTTP ' + value.status);
  });
  if (fails.length) {
    fails.denied=values.some(value=>value.status===401 || value.status===403);
    return fails;
  }

  const servedUnited = json(values[0].body, 'served United data');
  if (unitedPagesLag(servedUnited, expected)) {
    console.log('sample ' + n + ' LAG United Pages still serving ' +
      servedUnited.fleet.equipped + '/' + servedUnited.fleet.total +
      ' as of ' + (servedUnited.measurementAsOf || servedUnited.updated) +
      '; reviewed artifact is ' + expected.united.fleet.equipped + '/' +
      expected.united.fleet.total + ' as of ' + expected.united.measurementAsOf);
    if(!requireCurrent) return [];
    fails.propagationLag=true;
    fails.push('propagation lag: current-data recovery is not verified');
  }
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
  if(requireCurrent) {
    if(sha(values[3].body)!==expected.homeSha) fails.push('homepage bytes differ from the reviewed artifact');
    if(sha(values[6].body)!==expected.badgeSha) fails.push('raw badge bytes differ from the reviewed artifact');
    const fleet=(json(values[5].body,'United API').airline || {}).fleet || {};
    if(fleet.equipped!==expected.united.fleet.equipped || fleet.total!==expected.united.fleet.total) fails.push('United API count differs');
    try {assert.deepEqual(fleet.membership || null,expected.united.fleet.membership || null);}
    catch {fails.push('United API membership disclosure differs');}
    const p=expected.united.fleet.membership;
    if(p && p.excludedTails.length && !String(fleet.source).includes('WiFiOdds corrected tracker population')) fails.push('United API source attribution is unqualified');
    // A physically impossible API count is a defect, not older valid content.
    for(const i of [1,2,5]) {
      const f=(json(values[i].body,'airline API').airline || {}).fleet || {};
      if(!Number.isSafeInteger(f.equipped) || !Number.isSafeInteger(f.total) || f.equipped<0 || f.total<=0 || f.equipped>f.total) {
        fails.invalidShape=true;
        fails.push(routes[i]+': invalid fleet count shape');
      }
    }
  }
  return fails;
}
async function main() {
  const base = arg('--base-url', 'https://wifiodds.com');
  const fixture = arg('--fixture-dir', null);
  const trackerPath = arg('--tracker-html', null);
  const samples = Number(arg('--samples', fixture ? '1' : '4'));
  if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a positive integer');
  const expected = localExpected();
  const tracker = await readTracker(fixture, trackerPath);
  const source=expected.united.fleet.membership ? await readMembershipSource(fixture) : undefined;
  try {await verifyCapturedMembershipSource(expected.united,tracker,source);}
  catch(error) {
    console.error('tracker FAIL '+error.message);
    process.exit(1);
  }
  const requireCurrent=process.argv.includes('--require-current') || !!expected.united.fleet.membership;
  console.log('tracker PASS raw ' + tracker.equipped + '/' + tracker.total + '; reviewed '+expected.united.fleet.equipped+'/'+expected.united.fleet.total);
  let failed = 0;
  let onlyLag = true, denied = false;
  for (let i = 1; i <= samples; i++) {
    const failures = await sample(base, fixture, expected, i, requireCurrent);
    if (failures.length) {
      failed++;
      onlyLag=onlyLag && !!failures.propagationLag && !failures.invalidShape;
      denied=denied || !!failures.denied;
      failures.forEach(function (failure) { console.error('sample ' + i + ' FAIL ' + failure); });
    } else {
      console.log('sample ' + i + ' PASS');
    }
    if (!fixture && i < samples) await new Promise(function (resolve) { setTimeout(resolve, 3000); });
  }
  if (failed) process.exit(denied ? 2 : onlyLag ? 3 : 1);
  console.log('verify-data-deploy: ' + samples + ' sample(s) accepted; source policy verified' + (requireCurrent ? '; current JSON/API/badge/homepage bodies match' : '; propagation lag may remain'));
}

module.exports = { rowOrder, parseUnitedTrackerCount, unitedPagesLag, verifyMembershipSource, verifyCapturedMembershipSource, sample };
if (require.main === module) main().catch(function (error) {
  console.error('verify-data-deploy: ' + error.message);
  process.exit(2);
});
