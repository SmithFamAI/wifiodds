'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const RULE = Object.freeze({
  id: 'ua-n63571-20261019',
  approvalId: 'Sentinel_a86c6d9cddb48191a14825407a697f3d',
  request: '645/1678:Sentinel_a86c6d9cddb48191a14825407a697f3d',
  approvedAt: '2026-10-19T15:01:46Z', initialDeadline: '2026-10-20T15:01:46Z',
  holdExpiry: '2026-10-26T14:20:41.605Z', evidenceObservedAt: '2026-10-19T14:20:41.605Z',
  baselineSha256: '6bdbc1f1eb47876896a1fa9aed8d4333fd967ead9cbcd9f92751bb811f8de5a7',
  rawMembershipSha256: '0ad2498535428ed0787c5b6ff1cbfe8df2808e9987d9f35d010e785d6120e669',
  membershipSha256: '147302a88365849f8aa3ab619691c8e036307ffd16b462f4c1c15bc95f8668ab',
  equippedSha256: '91defde172152ba6923a5e217a35d7656f6a3d2d1aad30a2c3b6379e4f39469c'
});
const EXPECTED_FLAG = 'fleet denominator moved 1675 → 1678 (within the 3-aircraft tolerance, so accepted). Flagged anyway: this number should move rarely and deliberately.';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function validatePolicy(p, now = Date.now()) {
  assert(p && p.policyId === RULE.id && p.holdId === 'ua-n63571-faa-20261019', 'membership policy: unknown policy/hold');
  assert.deepEqual(p.excludedTails, ['N63571'], 'membership policy: exact N63571 exclusion required');
  assert.equal(p.expiresAt, RULE.holdExpiry, 'membership policy: fixed hold expiry changed');
  assert.equal(p.evidenceObservedAt, RULE.evidenceObservedAt, 'membership policy: fixed hold observation changed');
  assert(now >= Date.parse(p.evidenceObservedAt) && now < Date.parse(RULE.holdExpiry), 'membership policy: hold expired or not yet valid');
  assert(p.raw && p.corrected && Number.isSafeInteger(p.raw.total) && p.raw.total === p.corrected.total + 1 &&
    Number.isSafeInteger(p.raw.equipped) && p.raw.equipped === p.corrected.equipped, 'membership policy: correction arithmetic differs');
  const expected = require('./ua-membership-hold.json').evidence;
  assert.deepEqual(p.evidence, expected, 'membership policy: identity evidence differs');
  return p;
}
function withoutLegacyOverride(fn) {
  const old = process.env.WIFIODDS_REBASELINE;
  delete process.env.WIFIODDS_REBASELINE;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.WIFIODDS_REBASELINE;
    else process.env.WIFIODDS_REBASELINE = old;
  }
}
function membershipGate({ baselineBytes, data, newEq, newTot, today, provenance, gateFn, now = Date.now(), request, evidence }) {
  if (!request) return withoutLegacyOverride(() => gateFn(data, newEq, newTot, today));
  assert.equal(request, RULE.request, 'membership approval: exact approved request required');
  assert(now >= Date.parse(RULE.approvedAt) && now < Date.parse(RULE.initialDeadline), 'membership approval: outside initial acceptance window');
  assert.equal(hash(baselineBytes), RULE.baselineSha256, 'membership approval: baseline bytes changed');
  assert.deepEqual(data, JSON.parse(baselineBytes), 'membership approval: baseline object changed');
  assert.equal(newEq, 645, 'membership approval: approved pair changed');
  assert.equal(newTot, 1678, 'membership approval: approved pair changed');
  validatePolicy(provenance, now);
  assert.deepEqual(provenance.raw, { equipped: 645, total: 1679 }, 'membership approval: approved population changed');
  assert.deepEqual(provenance.corrected, { equipped: 645, total: 1678 }, 'membership approval: approved population changed');
  for (const key of ['rawMembershipSha256','membershipSha256','equippedSha256'])
    assert.equal(provenance[key], RULE[key], 'membership approval: approved population changed (' + key + ')');
  const sourceAt = Date.parse(provenance.sourceTimestamp);
  assert(Number.isFinite(sourceAt) && sourceAt <= now && now-sourceAt <= 7200000, 'membership approval: source freshness failed');
  assert(evidence && evidence.approvalId === RULE.approvalId && evidence.faa, 'membership approval: fresh FAA evidence receipt required');
  const faa = evidence.faa, observed = Date.parse(faa.observedAt);
  assert(Number.isFinite(observed) && observed >= Date.parse(RULE.approvedAt) && observed <= now && now-observed <= 7200000,
    'membership approval: fresh FAA observation required');
  assert(/^[a-f0-9]{64}$/.test(faa.responseSha256) && faa.responseSha256 !== '0'.repeat(64), 'membership approval: FAA response hash required');
  const expected = require('./ua-membership-hold.json').evidence;
  for (const key of ['url','manufacturer','model','serial','aircraftType','registrationStatus','pendingNumberChange'])
    assert.equal(faa[key], expected[key], 'membership approval: FAA identity changed (' + key + ')');
  // A supplied receipt is an operator claim; the release review must bind it to
  // the actual permitted response. It is never a substitute for that response.
  const trial = structuredClone(data);
  const ordinary = withoutLegacyOverride(() => gateFn(trial,newEq,newTot,today));
  assert(!ordinary.healed && Array.isArray(ordinary.flags) && ordinary.flags.length === 1 && ordinary.flags[0] === EXPECTED_FLAG,
    'membership approval: expected sole reviewed denominator flag without healing');
  const saved = process.env.WIFIODDS_REBASELINE;
  process.env.WIFIODDS_REBASELINE = RULE.request;
  let result;
  try { result = gateFn(data,newEq,newTot,today); } finally {
    if (saved === undefined) delete process.env.WIFIODDS_REBASELINE; else process.env.WIFIODDS_REBASELINE=saved;
  }
  assert(!result.healed && result.flags.length === 0, 'membership approval: acceptance failed');
  data.fleet.rebaseline.approvalId = RULE.approvalId;
  data.fleet.rebaseline.acceptedAt = new Date(now).toISOString();
  data.fleet.rebaseline.faaConfirmation = structuredClone(faa);
  return result;
}
function disclosure(p) {
  if (!p || !Array.isArray(p.excludedTails) || p.excludedTails.length === 0) return '';
  const pair = x => x.equipped.toLocaleString('en-US') + '/' + x.total.toLocaleString('en-US');
  return 'WiFiOdds corrected United population: ' + pair(p.corrected) + '; raw tracker: ' + pair(p.raw) +
    '. N63571 is excluded because the FAA record identifies balloon RX8-3127 (checked ' + p.evidenceObservedAt +
    '). This temporary hold expires October 26, 2026 at 14:20:41 UTC. Source snapshot: ' + p.sourceTimestamp +
    '. N37484 remains included; this does not confirm legal delivery or Starlink. The historical B787 change from 95 to 96 remains unresolved.';
}
function assertRelease(data, request, now = Date.now(), previous) {
  const p=data.fleet.membership;
  if(p && p.excludedTails && p.excludedTails.length) validatePolicy(p,now);
  const accepted=data.fleet.rebaseline;
  const prior=previous && previous.fleet && previous.fleet.rebaseline;
  const active=!!((p && p.policyId===RULE.id) || (accepted && accepted.approvalId===RULE.approvalId));
  if(active) validatePolicy(p,now);
  const alreadyPublished=!!(prior && accepted && prior.approvalId===RULE.approvalId &&
    prior.acceptedAt===accepted.acceptedAt && previous.fleet.membership && previous.fleet.membership.policyId===RULE.id);
  // A dropped environment variable cannot turn a resumed first publication
  // into an ordinary refresh. The remote baseline must already carry this
  // acceptance. A missing/stale remote ref conservatively requires the rule.
  if(!request && (!active || alreadyPublished)) {
    if(alreadyPublished) assert.deepEqual(accepted,prior,'release: published acceptance receipt changed');
    return;
  }
  assert.equal(request,RULE.request,'release: exact approved request required');
  assert(now >= Date.parse(RULE.approvedAt) && now < Date.parse(RULE.initialDeadline),'release: initial acceptance window closed');
  validatePolicy(p,now);
  assert(accepted && accepted.approvalId===RULE.approvalId,'release: exact acceptance receipt missing');
  const at=Date.parse(accepted.acceptedAt);
  assert(at >= Date.parse(RULE.approvedAt) && at <= now && at < Date.parse(RULE.initialDeadline),'release: invalid acceptance clock');
  assert.equal(data.fleet.equipped,645,'release: approved equipped count changed');
  assert.equal(data.fleet.total,1678,'release: approved total changed');
  for(const key of ['rawMembershipSha256','membershipSha256','equippedSha256']) assert.equal(p[key],RULE[key],'release: approved population changed');
  for(const [label,clock] of [['source',p.sourceTimestamp],['FAA',accepted.faaConfirmation && accepted.faaConfirmation.observedAt]]) {
    const t=Date.parse(clock);
    assert(Number.isFinite(t) && t <= now && now-t <= 7200000,'release: '+label+' evidence expired');
  }
}
module.exports = { RULE, EXPECTED_FLAG, membershipGate, validatePolicy, disclosure, assertRelease };
if(require.main===module) {
  try {
    const data=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
    let previous;
    if((data.fleet.membership && data.fleet.membership.policyId===RULE.id) ||
       (data.fleet.rebaseline && data.fleet.rebaseline.approvalId===RULE.approvalId)) {
      previous=JSON.parse(require('node:child_process').execFileSync('git',['show','origin/main:united/data.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    }
    assertRelease(data,process.env.WIFIODDS_REBASELINE,Date.now(),previous);
  }
  catch(e) {console.error('membership release guard: '+e.message);process.exitCode=1;}
}
