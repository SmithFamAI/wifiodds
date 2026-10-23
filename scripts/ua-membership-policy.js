'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const RULE = Object.freeze({ id: 'ua-tracker-parity-20261023',
  ownerInstruction: 'Sentinel_59cd9f9427748191b7415003be319e41',
  effectiveAt: '2026-10-23T16:43:20Z' });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const familyNames = { 'B737-700':'737-700','B737-800':'737-800','B737-900':'737-900',
  'B737-MAX8':'737 MAX','B737-MAX9':'737 MAX','B737-MAX10':'737 MAX',
  A321:'A321neo',B757:'757',B767:'767',B777:'777',B787:'787',unknown:'Type not listed' };
const displayFamily = family => familyNames[family] || family;
function sourceTypes(families) {
  const types=new Map();
  for(const f of families) {
    const type=displayFamily(f.family),seg=f.body==='regional'?'express':'mainline';
    const row=types.get(type)||{type,equipped:0,total:0,seg};
    assert.equal(row.seg,seg,'source parity: family segment conflict');
    row.equipped+=f.installed;row.total+=f.total;types.set(type,row);
  }
  return [...types.values()];
}
function validatePolicy(p, now = Date.now()) {
  assert(p && p.policyId === RULE.id, 'source parity: unknown policy');
  assert.deepEqual(p.excludedTails, [], 'source parity: exclusions are not permitted');
  assert.deepEqual(p.raw, p.corrected, 'source parity: adjusted counts are not permitted');
  assert(p.raw && Number.isSafeInteger(p.raw.total) && p.raw.total > 0 &&
    Number.isSafeInteger(p.raw.equipped) && p.raw.equipped >= 0 && p.raw.equipped <= p.raw.total,
    'source parity: invalid source counts');
  for (const key of ['rawMembershipSha256','membershipSha256','equippedSha256'])
    assert(/^[a-f0-9]{64}$/.test(p[key]), 'source parity: missing full-set hash');
  assert.equal(p.membershipSha256,p.rawMembershipSha256,'source parity: membership was adjusted');
  for (const key of ['holdId','expiresAt','evidence','evidenceObservedAt','disclosure'])
    assert(!Object.hasOwn(p,key),'source parity: active correction evidence is not permitted');
  const at=Date.parse(p.sourceTimestamp);
  assert(Number.isFinite(at) && at<=now && now-at<=7200000,'source parity: source must be within two hours');
  return p;
}
function membershipGate({data,newEq,newTot,today,provenance,gateFn,now=Date.now(),request}) {
  assert(!request && !process.env.WIFIODDS_REBASELINE,'source parity: rebaseline overrides are not permitted');
  validatePolicy(provenance,now);
  assert.deepEqual(provenance.raw,{equipped:newEq,total:newTot},'source parity: pair differs from reconciled source');
  // Numerical history comparisons remain visible, but cannot change a fully
  // reconciled publisher observation. Structural and publisher failures block.
  return gateFn(data,newEq,newTot,today,true);
}
function disclosure(p) {
  if (!p || !Array.isArray(p.excludedTails) || p.excludedTails.length === 0) return '';
  const pair = x => x.equipped.toLocaleString('en-US') + '/' + x.total.toLocaleString('en-US');
  return 'WiFiOdds corrected United population: ' + pair(p.corrected) + '; raw tracker: ' + pair(p.raw) +
    '. N63571 is excluded because the FAA record identifies balloon RX8-3127 (checked ' + p.evidenceObservedAt +
    '). This temporary hold expires October 26, 2026 at 14:20:41 UTC. Source snapshot: ' + p.sourceTimestamp +
    '. N37484 remains included; this does not confirm legal delivery or Starlink. The historical B787 change from 95 to 96 remains unresolved.';
}
function assertRelease(data,request,now=Date.now(),previous) {
  assert(!request,'source parity release: rebaseline overrides are not permitted');
  const p=validatePolicy(data.fleet.membership,now);
  assert.deepEqual(p.raw,{equipped:data.fleet.equipped,total:data.fleet.total},'source parity release: count differs');
  assert.equal(data.tracker && data.tracker.lastUpdated,p.sourceTimestamp,'source parity release: source clock differs');
  assert.deepEqual(data.tracker.candidateMembership,p,'source parity release: observation differs');
  assert.equal(data.measurementAsOf,p.sourceTimestamp.slice(0,10),'source parity release: measurement date differs');
  assert.equal(data.updated,data.measurementAsOf,'source parity release: updated date differs');
  assert(Array.isArray(data.fleet.plausibility.flags) && data.fleet.plausibility.flags.length===0,'source parity release: validation flags remain');
  assert.deepEqual(data.fleet.types,sourceTypes(p.sourceFamilies),'source parity release: type rows differ');
  for(const seg of ['mainline','express']) {
    const rows=data.fleet.types.filter(x=>x.seg===seg);
    assert.deepEqual(data.fleet[seg],{equipped:rows.reduce((n,x)=>n+x.equipped,0),total:rows.reduce((n,x)=>n+x.total,0)},'source parity release: segments differ');
  }
  assert.equal(data.fleet.types.reduce((n,x)=>n+x.total,0),p.raw.total,'source parity release: family total differs');
  assert.equal(data.fleet.types.reduce((n,x)=>n+x.equipped,0),p.raw.equipped,'source parity release: family equipped differs');
  const headline=data.tracker.publishedHeadline;
  assert(headline && headline.equipped===p.raw.equipped && headline.total===p.raw.total &&
    headline.sourceTimestamp===p.sourceTimestamp && headline.percentage===Math.floor(100*p.raw.equipped/p.raw.total),
    'source parity release: public headline differs');
  const tails=data.knownTails;
  assert(Array.isArray(tails) && tails.length===p.raw.equipped && new Set(tails).size===tails.length,'source parity release: equipped roster incomplete');
  assert.equal(hash([...tails].sort().join('\n')+'\n'),p.equippedSha256,'source parity release: equipped roster differs');
  assert.deepEqual((data.roster||[]).map(x=>x.tail).sort(),[...tails].sort(),'source parity release: roster differs');
  if(previous) {
    assert.deepEqual(data.fleet.rebaseline,previous.fleet.rebaseline,'source parity release: historical receipt changed');
    assert.deepEqual(data.fleet.published,previous.fleet.published,'source parity release: official source changed');
    assert.deepEqual(data.history.slice(0,previous.history.length),previous.history,'source parity release: history changed');
  }
}
module.exports={RULE,membershipGate,validatePolicy,disclosure,assertRelease,sourceTypes,displayFamily};
if(require.main===module) {
  try {
    const data=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
    const previous=JSON.parse(require('node:child_process').execFileSync('git',['show','origin/main:united/data.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    assertRelease(data,process.env.WIFIODDS_REBASELINE,Date.now(),previous);
  } catch(e) { console.error('membership release guard: '+e.message);process.exitCode=1; }
}
