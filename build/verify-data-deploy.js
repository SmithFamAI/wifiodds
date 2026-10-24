#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { reconcileMembership, settleMembershipCapture } = require('../scripts/reconcile-ua-membership.js');
const { validatePolicy, disclosure, assertRelease } = require('../scripts/ua-membership-policy.js');

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

// A pinned Git artifact supplies prior fingerprints; served content never supplies
// its own proof. Historical validation checks structure at the recorded instant,
// while main() still validates the target against fresh complete upstream data.
function sourceClock(data, now = Date.now()) {
  const value = data && data.tracker && data.tracker.lastUpdated;
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'source clock must be canonical UTC');
  const time = Date.parse(value);
  assert(Number.isFinite(time) && new Date(time).toISOString() === value && time <= now, 'source clock is invalid or future');
  assert.equal(data.fleet && data.fleet.membership && data.fleet.membership.sourceTimestamp, value, 'membership clock differs');
  assert.equal(data.measurementAsOf, value.slice(0, 10), 'measurement date differs');
  assert.equal(data.updated, data.measurementAsOf, 'updated date differs');
  return time;
}
function priorEligible(prior, expected, now = Date.now()) {
  try {
    assert(prior && /^[a-f0-9]{40}$/.test(prior.commit), 'pinned prior commit required');
    const previousAt = sourceClock(prior.united, now);
    const targetAt = sourceClock(expected.united, now);
    assert(previousAt < targetAt, 'prior must be strictly older');
    assertRelease(prior.united, undefined, previousAt);
    assertRelease(expected.united, undefined, targetAt);
    assert.deepEqual(json(prior.unitedBytes, 'prior United data'), prior.united);
    for (const key of ['homeSha','badgeSha','ogSha']) assert(/^[a-f0-9]{64}$/.test(prior[key]), 'missing prior fingerprint');
    return true;
  } catch { return false; }
}
function readPriorExpected(commit, expected, root = ROOT) {
  assert(/^[a-f0-9]{40}$/.test(commit), '--prior-commit must be an immutable full SHA');
  cp.execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {cwd:root, stdio:['ignore','pipe','pipe']});
  const read = file => cp.execFileSync('git', ['show', commit + ':' + file], {cwd:root, maxBuffer:8*1024*1024, stdio:['ignore','pipe','pipe']});
  const unitedBytes = read('united/data.json');
  const prior = {commit, unitedBytes, united:json(unitedBytes,'prior United data'),
    homeSha:sha(read('index.html')), badgeSha:sha(read('assets/united-starlink-badge.svg')), ogSha:sha(read('assets/og.png'))};
  // A no-op refresh or implementation-only deploy has an equal source clock.
  // Retain the fingerprints for evidence, but it cannot qualify as older data.
  sourceClock(prior.united);
  assertRelease(prior.united, undefined, sourceClock(prior.united));
  return prior;
}
function sameUnitedApi(body, data) {
  try {
    const fleet = (json(body, 'United API').airline || {}).fleet || {};
    assert.equal(fleet.equipped, data.fleet.equipped);
    assert.equal(fleet.total, data.fleet.total);
    assert.deepEqual(fleet.membership || null, data.fleet.membership || null);
    return true;
  } catch { return false; }
}
function knownPropagation(values, expected) {
  const prior = expected.prior;
  if (!priorEligible(prior, expected)) return false;
  const hashes = [[0,sha(expected.unitedBytes),sha(prior.unitedBytes)],
    [3,expected.homeSha,prior.homeSha],[4,expected.ogSha,prior.ogSha],[6,expected.badgeSha,prior.badgeSha]];
  if (!hashes.every(([i,current,previous]) => [current,previous].includes(sha(values[i].body)))) return false;
  if (!sameUnitedApi(values[5].body, expected.united) && !sameUnitedApi(values[5].body, prior.united)) return false;
  // Other airlines retain their existing strict current-data requirements.
  const other = [];
  checkApi(other, 'alaska', values[1].body, expected.alaska);
  checkApi(other, 'hawaiian', values[2].body, expected.hawaiian);
  return other.length === 0;
}
function evidenceDirectory(value) {
  if (!value) return null;
  const dest = path.resolve(value);
  const parent = fs.realpathSync(path.dirname(dest));
  const resolved = path.join(parent,path.basename(dest));
  const site = fs.realpathSync(ROOT);
  assert(resolved !== site && !resolved.startsWith(site + path.sep), 'evidence must stay outside the site root');
  fs.mkdirSync(resolved, {mode:0o700}); // exclusive: never overwrite a prior attempt
  return resolved;
}
function retainResponses(dir, prefix, routes, values, startedAt) {
  if (!dir) return;
  const receipt = {startedAt, observedAt:new Date().toISOString(), routes:[]};
  values.forEach((value,i) => {
    const name = prefix + '-' + i + '.body';
    if (value.body) fs.writeFileSync(path.join(dir,name), value.body, {mode:0o600,flag:'wx'});
    receipt.routes.push({route:routes[i],status:value.status || null,error:value.error || null,
      file:value.body ? name : null,sha256:value.body ? sha(value.body) : null,
      startedAt:value.startedAt || startedAt,observedAt:value.observedAt || receipt.observedAt});
  });
  fs.writeFileSync(path.join(dir,prefix + '.json'), JSON.stringify(receipt,null,2)+'\n', {mode:0o600,flag:'wx'});
}

async function get(base, fixture, route, sample) {
  if (fixture) {
    const rel = route === '/' ? 'index.html' : route.replace(/^\//, '');
    const sampleFile = path.join(fixture, 'sample-' + sample, rel);
    const file = fs.existsSync(sampleFile) ? sampleFile : path.join(fixture, rel);
    if (!fs.existsSync(file)) return { error: 'fixture missing: ' + file };
    return { ok: true, status: 200, body: fs.readFileSync(file) };
  }
  const startedAt = new Date().toISOString();
  const url = base.replace(/\/$/, '') + route + (route.includes('?') ? '&' : '?') + 'cb=' + crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 20000);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal,
      headers: { 'user-agent': 'wifiodds-data-canary/1.0' } });
    const body = Buffer.from(await response.arrayBuffer());
    return { ok: response.ok, status: response.status, body, startedAt, observedAt:new Date().toISOString() };
  } catch (error) {
    return { error: error.message, startedAt, observedAt:new Date().toISOString() };
  } finally { clearTimeout(timer); }
}

async function readTracker(fixture, trackerPath, evidence) {
  if (trackerPath) {
    if (!fs.existsSync(trackerPath)) throw new Error('tracker fixture missing: ' + trackerPath);
    return parseUnitedTrackerCount(fs.readFileSync(trackerPath, 'utf8'));
  }
  if (fixture) {
    const file = path.join(fixture, 'tracker.html');
    if (!fs.existsSync(file)) throw new Error('fixture missing tracker.html');
    return parseUnitedTrackerCount(fs.readFileSync(file, 'utf8'));
  }
  const startedAt = new Date().toISOString();
  const response = await get(TRACKER_ORIGIN, null, '/', 0);
  retainResponses(evidence, 'tracker-headline', ['/'], [response], startedAt);
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

async function readMembershipSource(fixture, evidence) {
  const routes=['/api/data','/api/fleet-summary','/fleet'];
  // Sequential: a denied request stops the remaining source reads.
  const values=[];
  for (const route of routes) {
    const startedAt = new Date().toISOString();
    const result=await get(TRACKER_ORIGIN,fixture && path.join(fixture,'tracker-source'),route,0);
    retainResponses(evidence, 'tracker-source-' + values.length, [route], [result], startedAt);
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
async function sample(base, fixture, expected, n, requireCurrent = false, evidence = null) {
  const routes = ['/united/data.json', '/api/airlines/alaska', '/api/airlines/hawaiian', '/', '/assets/og.png'];
  if(requireCurrent) routes.push('/api/airlines/united','/assets/united-starlink-badge.svg');
  const startedAt = new Date().toISOString();
  const values = await Promise.all(routes.map(function (route) { return get(base, fixture, route, n); }));
  retainResponses(evidence, 'sample-' + n, routes, values, startedAt);
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
  if (!requireCurrent && unitedPagesLag(servedUnited, expected)) {
    console.log('sample ' + n + ' LAG United Pages still serving ' +
      servedUnited.fleet.equipped + '/' + servedUnited.fleet.total +
      ' as of ' + (servedUnited.measurementAsOf || servedUnited.updated) +
      '; reviewed artifact is ' + expected.united.fleet.equipped + '/' +
      expected.united.fleet.total + ' as of ' + expected.united.measurementAsOf);
    return [];
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
  if (requireCurrent && fails.length && !fails.invalidShape && knownPropagation(values, expected)) {
    fails.propagationLag = true;
    fails.push('propagation lag: only pinned prior/current artifacts observed; current recovery is not verified');
  }
  return fails;
}
async function main() {
  const base = arg('--base-url', 'https://wifiodds.com');
  const fixture = arg('--fixture-dir', null);
  const trackerPath = arg('--tracker-html', null);
  const samples = Number(arg('--samples', fixture ? '1' : '4'));
  if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a positive integer');
  const evidence = evidenceDirectory(arg('--evidence-dir', null));
  const expected = localExpected();
  const priorCommit = arg('--prior-commit', null);
  if (priorCommit) expected.prior = readPriorExpected(priorCommit, expected);
  if (expected.united.fleet.membership) sourceClock(expected.united);
  if (evidence) fs.writeFileSync(path.join(evidence,'target.json'), JSON.stringify({observedAt:new Date().toISOString(),
    sourceTimestamp:expected.united.tracker && expected.united.tracker.lastUpdated,priorCommit,
    unitedSha:sha(expected.unitedBytes),homeSha:expected.homeSha,badgeSha:expected.badgeSha,ogSha:expected.ogSha},null,2)+'\n', {mode:0o600,flag:'wx'});
  const tracker = await readTracker(fixture, trackerPath, evidence);
  const source=expected.united.fleet.membership ? await readMembershipSource(fixture, evidence) : undefined;
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
    const failures = await sample(base, fixture, expected, i, requireCurrent, evidence);
    if (evidence) fs.writeFileSync(path.join(evidence,'sample-' + i + '-result.json'),JSON.stringify({observedAt:new Date().toISOString(),
      failures:[...failures],propagationLag:!!failures.propagationLag,denied:!!failures.denied,invalidShape:!!failures.invalidShape},null,2)+'\n',{mode:0o600,flag:'wx'});
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

module.exports = { sourceClock, priorEligible, readPriorExpected, evidenceDirectory, retainResponses, rowOrder, parseUnitedTrackerCount, unitedPagesLag, verifyMembershipSource, verifyCapturedMembershipSource, sample };
if (require.main === module) main().catch(function (error) {
  console.error('verify-data-deploy: ' + error.message);
  process.exit(2);
});
