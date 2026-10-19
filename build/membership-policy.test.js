'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { RULE, membershipGate, validatePolicy, disclosure, assertRelease } = require('../scripts/ua-membership-policy.js');
const { reconcileMembership } = require('../scripts/reconcile-ua-membership.js');
const { plausibilityGate } = require('../scripts/update-unitedstarlink.js');
const baseline = fs.readFileSync(__dirname + '/../test/fixtures/ua-baseline-20261015.json');
const source = require('../test/fixtures/ua-membership-20261019.json');
const now = Date.parse('2026-10-19T15:15:00.000Z');
function inputs() {
  const api = { lastUpdated: source.sourceTimestamp, totalCount: source.rawRows.length,
    starlinkPlanes: structuredClone(source.equipped), fleetStats: structuredClone(source.fleetStats), flightsByTail: {} };
  const registry = '<script>' + JSON.stringify({ dateModified: api.lastUpdated }) + '</script>' +
    source.rawRows.map(([tail,type,status,cls]) => `<a id="t-${tail}" title="${type} · ${tail} · ${status}" class="${cls}"></a>`).join('');
  return { api, summary: structuredClone(source.summary), registry };
}
function candidate() { const f=inputs(); return reconcileMembership(f.api,f.summary,f.registry,now); }
function args() { return { baselineBytes:baseline,data:JSON.parse(baseline), newEq:645,newTot:1678,today:'2026-10-19',
  provenance:candidate().provenance, gateFn:plausibilityGate, now,
  request:RULE.request, evidence:{ approvalId:RULE.approvalId, faa:{...require('../scripts/ua-membership-hold.json').evidence,
    observedAt:'2026-10-19T15:10:00.000Z',responseSha256:'a'.repeat(64)} } }; }
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
function rejects(change,pattern){const a=args();change(a);assert.throws(()=>membershipGate(a),pattern);}
test('exact approval accepts only the sole unhealed denominator flag',()=>{const a=args();const g=membershipGate(a);assert.equal(g.flags.length,0);assert.equal(a.data.fleet.total,1678);assert.equal(a.data.fleet.rebaseline.approvalId,RULE.approvalId);});
test('without explicit request original denominator flag remains',()=>{const a=args();delete a.request;assert.equal(membershipGate(a).flags.length,1);assert(!a.data.fleet.rebaseline || a.data.fleet.rebaseline.approvalId!==RULE.approvalId);});
test('an arbitrary legacy ruling cannot broaden approval',()=>rejects(a=>a.request='645/1678:anything',/exact approved request/));
test('baseline bytes must match the accepted artifact',()=>rejects(a=>a.baselineBytes=Buffer.concat([baseline,Buffer.from(' ')]),/baseline bytes/));
test('baseline object must match those bytes',()=>rejects(a=>delete a.data.fleet.published,/baseline object/));
test('secondary flags cannot be cleared by a rebaseline early return',()=>rejects(a=>a.gateFn=(...x)=>{const g=plausibilityGate(...x);g.flags.push('missing publisher');return g;},/sole reviewed denominator flag/));
test('healed measurements cannot use approval',()=>rejects(a=>a.gateFn=(...x)=>({...plausibilityGate(...x),healed:true}),/sole reviewed denominator flag/));
test('zero or lookalike flags cannot consume approval',()=>{rejects(a=>a.gateFn=()=>({flags:[],healed:false}),/sole reviewed denominator flag/);rejects(a=>a.gateFn=()=>({flags:['1675 to 1678'],healed:false}),/sole reviewed denominator flag/);});
for(const key of ['rawMembershipSha256','membershipSha256','equippedSha256'])test('binds '+key,()=>rejects(a=>a.provenance[key]='b'.repeat(64),/approved population/));
test('exact raw and corrected pairs are bound',()=>{rejects(a=>{a.provenance.raw.total++;a.provenance.corrected.total++;},/approved population/);rejects(a=>a.newEq++,/approved pair/);});
test('another excluded tail is rejected',()=>rejects(a=>a.provenance.excludedTails.push('N37484'),/exact N63571/));
test('deadline is exclusive and cannot move',()=>{rejects(a=>a.now=Date.parse(RULE.initialDeadline),/acceptance window/);rejects(a=>a.now=Date.parse(RULE.approvedAt)-1,/acceptance window/);});
test('fresh FAA observation must follow approval and precede execution',()=>{rejects(a=>a.evidence.faa.observedAt=RULE.evidenceObservedAt,/fresh FAA/);rejects(a=>a.evidence.faa.observedAt='2026-10-19T15:16:00Z',/fresh FAA/);rejects(a=>delete a.evidence,/FAA evidence/);});
test('FAA identity and nonempty response hash are required',()=>{rejects(a=>a.evidence.faa.serial='other',/FAA identity/);rejects(a=>a.evidence.faa.responseSha256='0'.repeat(64),/FAA response hash/);});
test('source freshness is checked at acceptance too',()=>rejects(a=>a.provenance.sourceTimestamp='2026-10-19T12:00:00Z',/source freshness/));
test('fixed hold expiry cannot be extended',()=>rejects(a=>a.provenance.expiresAt='2026-10-27T14:20:41.605Z',/fixed hold/));
test('hold expiry rejects correction and valid earlier time passes',()=>{const p=candidate().provenance;validatePolicy(p,now);assert.throws(()=>validatePolicy(p,Date.parse(RULE.holdExpiry)),/expired/);});
test('ordinary later refresh does not replay initial approval',()=>{const a=args();delete a.request;a.data.fleet.total=1678;a.data.fleet.mainline.total=1165;a.newEq=646;a.now=Date.parse('2026-10-21T15:00:00Z');assert.equal(membershipGate(a).flags.length,0);a.newTot=1679;assert(membershipGate(a).flags.some(x=>x.includes('denominator')));});
test('actual same-count roster swap changes the computed approved set',()=>{const f=inputs();f.registry=f.registry.replaceAll('N37484','N999ZZ');const p=reconcileMembership(f.api,f.summary,f.registry,now).provenance;rejects(a=>a.provenance=p,/approved population/);});
test('disclosure distinguishes corrected numbers, raw badge and uncertainty',()=>{const t=disclosure(candidate().provenance);for(const x of ['645/1,678','645/1,679','N63571','October 26','B787','unresolved'])assert(t.includes(x),x);});
test('test fixtures never grant production access or a real FAA observation',()=>{assert(source.fixtureNotice.includes('Never live execution evidence'));assert.equal(args().evidence.faa.responseSha256,'a'.repeat(64));});

test('release boundary rechecks deadline, population and evidence age',()=>{
  const a=args();membershipGate(a);a.data.fleet.membership=a.provenance;
  assertRelease(a.data,RULE.request,now);
  assert.throws(()=>assertRelease(a.data,RULE.request,Date.parse(RULE.initialDeadline)),/window closed/);
  assert.throws(()=>assertRelease(a.data,RULE.request,now+7200000),/evidence expired/);
  const changed=structuredClone(a.data);changed.fleet.membership.membershipSha256='c'.repeat(64);
  assert.throws(()=>assertRelease(changed,RULE.request,now),/population changed/);
  assert.throws(()=>assertRelease(a.data,undefined,Date.parse('2026-10-21T15:00:00Z')),/exact approved request/);
  assertRelease(a.data,undefined,Date.parse('2026-10-21T15:00:00Z'),structuredClone(a.data));
  assert.throws(()=>assertRelease(a.data,undefined,now,JSON.parse(baseline)),/exact approved request/);
  const lost=structuredClone(a.data);delete lost.fleet.membership;
  assert.throws(()=>assertRelease(lost,undefined,now,structuredClone(a.data)),/unknown policy/);
  const receipt=structuredClone(a.data);receipt.fleet.rebaseline.faaConfirmation.serial='tampered';
  assert.throws(()=>assertRelease(receipt,undefined,now,structuredClone(a.data)),/receipt changed/);
});
console.log('membership policy controls: '+count+' passed');
