'use strict';

// Reconcile complete publisher surfaces without changing source membership.
// The owner requires tracker parity; disagreement is an error, not a correction.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { RULE, displayFamily } = require('./ua-membership-policy.js');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const sorted = set => [...set].sort();
const setHash = values => digest(sorted(values).join('\n') + '\n');
const familyByType = {
  'ERJ-145': ['ERJ-145', 'regional'], E175: ['E175', 'regional'], E170: ['E170', 'regional'],
  CRJ200: ['CRJ-200', 'regional'], CRJ550: ['CRJ-550', 'regional'], CRJ700: ['CRJ-700', 'regional'],
  '737-700': ['B737-700', 'narrowbody'], '737-800': ['B737-800', 'narrowbody'], '737-900': ['B737-900', 'narrowbody'],
  '737 MAX 8': ['B737-MAX8', 'narrowbody'], '737 MAX 9': ['B737-MAX9', 'narrowbody'], '737 MAX 10': ['B737-MAX10', 'narrowbody'],
  A319: ['A319', 'narrowbody'], A320: ['A320', 'narrowbody'], A321neo: ['A321', 'narrowbody'],
  '757': ['B757', 'narrowbody'], '767': ['B767', 'widebody'], '777': ['B777', 'widebody'], '787': ['B787', 'widebody'],
  'Type not listed': ['unknown', 'narrowbody']
};

function reconcileMembership(rawApi, rawSummary, registry, now = Date.now()) {
  const api = clone(rawApi), summary = clone(rawSummary);
  const observed = Date.parse(api.lastUpdated);
  assert(Number.isFinite(observed) && observed <= now && now - observed <= 2 * 3600000,
    'membership: source must be dated within the last two hours');
  const generated = Date.parse(summary.generatedAt);
  assert(Number.isFinite(generated) && generated >= observed && generated <= now && now - generated <= 2 * 3600000,
    'membership: summary generation clock is inconsistent');
  const dates = [...registry.matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(dates, [api.lastUpdated], 'membership: registry and API observations differ');
  const rows = [...registry.matchAll(/<a\b[^>]*\bid="t-([A-Z0-9]+)"[^>]*>/g)].map(m => {
    const title = m[0].match(/\btitle="([^"]*)"/);
    const cls = m[0].match(/\bclass="([^"]*)"/);
    assert(title && cls, 'membership: malformed registry member');
    const [type, tail, ...status] = title[1].split(' · ');
    assert.equal(tail, m[1], 'membership: registry title/tail mismatch');
    return { tail, type, status: status.join(' · '), classes: cls[1].split(/\s+/) };
  });
  assert(Array.isArray(api.starlinkPlanes) && api.fleetStats && api.flightsByTail &&
    typeof api.flightsByTail === 'object' && !Array.isArray(api.flightsByTail), 'membership: malformed API');
  for (const key of Object.keys(api.flightsByTail)) {
    assert(/^[A-Z0-9]+$/.test(key), 'membership: noncanonical flight tail key; review rather than rename');
    assert(Array.isArray(api.flightsByTail[key]), 'membership: malformed flight evidence');
  }
  const members = new Set(rows.map(row => row.tail));
  assert(rows.length > 0 && members.size === rows.length, 'membership: empty or duplicate registry');
  const equipped = new Set(api.starlinkPlanes.map(row => row.TailNumber));
  assert.equal(equipped.size, api.starlinkPlanes.length, 'membership: duplicate equipped tail');
  assert.deepEqual(sorted(equipped), sorted(new Set(rows.filter(row => row.classes.includes('tail-sl')).map(row => row.tail))),
    'membership: registry/API equipped sets disagree');
  for (const tail of equipped) assert(members.has(tail), 'membership: equipped tail outside registry');
  assert(Array.isArray(summary.airlines), 'membership: missing airline summary');
  const uaRows = summary.airlines.filter(row => row.code === 'UA');
  assert.equal(uaRows.length, 1, 'membership: expected exactly one UA summary');
  const ua = uaRows[0];
  assert(Array.isArray(ua.families) && new Set(ua.families.map(row => row.family)).size === ua.families.length,
    'membership: duplicate or missing families');
  for (const row of [...ua.families, ua]) {
    assert(Number.isSafeInteger(row.total) && Number.isSafeInteger(row.installed) && row.total >= row.installed && row.installed >= 0,
      'membership: invalid family/airline counts');
    assert(row.percentage == null || (typeof row.percentage==='number' && Number.isFinite(row.percentage) && row.percentage>=0 && row.percentage<=100), 'membership: invalid source percentage');
  }
  const segments = api.fleetStats;
  for (const name of ['mainline', 'express']) {
    const segment = segments[name];
    assert(segment && Number.isSafeInteger(segment.total) && Number.isSafeInteger(segment.starlink) &&
      segment.total >= segment.starlink && segment.starlink >= 0, 'membership: invalid segment');
    assert.equal(api.starlinkPlanes.filter(row => row.fleet === name).length, segment.starlink,
      'membership: equipped segment count differs');
  }
  assert.equal(api.totalCount, rows.length, 'membership: full registry/total mismatch');
  assert.equal(ua.total, rows.length, 'membership: summary/registry mismatch');
  assert.equal(ua.installed, equipped.size, 'membership: summary/equipped mismatch');
  assert.equal(segments.mainline.total + segments.express.total, rows.length, 'membership: segment total mismatch');
  assert.equal(segments.mainline.starlink + segments.express.starlink, equipped.size, 'membership: segment equipped mismatch');
  assert.equal(sum(ua.families, 'total'), ua.total, 'membership: family total mismatch');
  assert.equal(sum(ua.families, 'installed'), ua.installed, 'membership: family equipped mismatch');
  const byTail = new Map(rows.map(row => [row.tail, row]));
  const registryFamilies = new Map();
  for (const row of rows) {
    const mapped = familyByType[row.type];
    assert(mapped, 'membership: unrecognized registry type ' + row.type);
    const [family, body] = mapped;
    const stats = registryFamilies.get(family) || { family, body, total: 0, installed: 0 };
    stats.total++; if (equipped.has(row.tail)) stats.installed++;
    registryFamilies.set(family, stats);
  }
  assert.deepEqual([...registryFamilies.keys()].sort(), ua.families.map(row => row.family).sort(),
    'membership: registry and summary family sets differ');
  for (const family of ua.families) {
    const counted = registryFamilies.get(family.family);
    for (const key of ['total', 'installed', 'body']) assert.equal(family[key], counted[key],
      'membership: registry family ' + family.family + ' disagrees on ' + key);
  }
  for (const plane of api.starlinkPlanes) {
    const body = familyByType[byTail.get(plane.TailNumber).type][1];
    assert.equal(plane.fleet, body === 'regional' ? 'express' : 'mainline',
      'membership: equipped tail segment differs from registry');
  }
  const regional = ua.families.filter(row => row.body === 'regional');
  assert.equal(sum(regional, 'total'), segments.express.total, 'membership: regional population mismatch');
  assert.equal(sum(regional, 'installed'), segments.express.starlink, 'membership: regional equipped mismatch');

  const raw = { equipped: equipped.size, total: rows.length };
  const rosterTypes=Object.fromEntries([...equipped].map(tail=>[tail,displayFamily(familyByType[byTail.get(tail).type][0])]));
  const result = { api, summary, rosterTypes, provenance: {
    policyId: RULE.id,
    sourceTimestamp: api.lastUpdated, registrySource: 'https://unitedstarlinktracker.com/fleet',
    raw, corrected: clone(raw), excludedTails: [],
    rawMembershipSha256: setHash(members), membershipSha256: setHash(members),
    equippedSha256: setHash(equipped),
    setHashEncoding: 'UTF-8 sorted tails, LF separated, one final LF',
    listedNotVerifiedTails: rows.filter(row => equipped.has(row.tail) && /not yet verified/i.test(row.status)).map(row => row.tail).sort(),
    sourcePercentages: { summary: ua.percentage ?? null,
      mainline: segments.mainline.percentage ?? null, express: segments.express.percentage ?? null },
    sourceFamilies: clone(ua.families)
  } };
  return result;
}
// The public headline is a separate publisher surface. A coherent API must not
// silently replace a disagreeing site headline, percentage or source date.
function publishedHeadline(html,api) {
  const text=String(html).replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const pair=String(html).match(/<title>United Starlink Tracker: ([\d,]+) of ([\d,]+) Planes Have Starlink<\/title>/i);
  assert(pair,'membership: public headline missing');
  const equipped=Number(pair[1].replace(/,/g,'')),total=Number(pair[2].replace(/,/g,''));
  assert.equal(equipped,api.starlinkPlanes.length,'membership: public headline equipped differs');
  assert.equal(total,api.totalCount,'membership: public headline total differs');
  const date=[...String(html).matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)].map(m=>m[1]);
  assert(date.length && date.every(x=>x===api.lastUpdated),'membership: public headline clock differs');
  const pct=String(html).match(/United planes \((\d+)%\) have Starlink/i);
  assert(pct && Number(pct[1])===Math.floor(100*equipped/total),'membership: public headline percentage differs');
  return {equipped,total,percentage:Number(pct[1]),sourceTimestamp:api.lastUpdated,
    source:'https://unitedstarlinktracker.com/'};
}
// A retained Actions acquisition showed the summary's server clock 622 ms
// ahead of the runner after all three bodies arrived. Wait once for a small
// lead to elapse; never adjust a source clock or loosen the strict gate above.
async function settleMembershipCapture(api, summary, { now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  monotonic = () => performance.now() } = {}) {
  const receivedAt = now();
  const sourceAt = Date.parse(api && api.lastUpdated);
  const generatedAt = Date.parse(summary && summary.generatedAt);
  const lead = generatedAt - receivedAt;
  const waitMs = Number.isFinite(sourceAt) && sourceAt <= receivedAt &&
    receivedAt - sourceAt <= 7200000 && Number.isFinite(generatedAt) &&
    generatedAt >= sourceAt && lead > 0 && lead <= 1000 ? lead : 0;
  let waitElapsedMs = 0;
  if (waitMs) {
    const started = monotonic();
    await wait(waitMs);
    waitElapsedMs = monotonic() - started;
  }
  const evaluatedAt = now();
  const capture = { receivedAt, evaluatedAt, waitMs, waitElapsedMs,
    sourceTimestamp: Number.isFinite(sourceAt) ? new Date(sourceAt).toISOString() : null,
    summaryGeneratedAt: Number.isFinite(generatedAt) ? new Date(generatedAt).toISOString() : null };
  assert(Number.isFinite(waitElapsedMs) && waitElapsedMs >= 0 && waitElapsedMs <= 1000,
    'membership: capture wait exceeded one-second budget: ' + JSON.stringify(capture));
  return capture;
}
module.exports = { reconcileMembership, settleMembershipCapture, publishedHeadline };
