'use strict';
const assert=require('node:assert/strict');
const {RULE,membershipGate,validatePolicy,assertRelease,sourceTypes}=require('../scripts/ua-membership-policy.js');
const {reconcileMembership,publishedHeadline}=require('../scripts/reconcile-ua-membership.js');
const {plausibilityGate}=require('../scripts/update-unitedstarlink.js');
const f=require('../test/fixtures/ua-membership-20261019.json');
const now=Date.parse('2026-10-19T15:15:00Z');
function source(){
 const api={lastUpdated:f.sourceTimestamp,totalCount:f.rawRows.length,starlinkPlanes:structuredClone(f.equipped),fleetStats:structuredClone(f.fleetStats),flightsByTail:{}};
 const registry=JSON.stringify({dateModified:api.lastUpdated})+f.rawRows.map(([tail,type,status,cls])=>`<a id="t-${tail}" title="${type} · ${tail} · ${status}" class="${cls}"></a>`).join('');
 return reconcileMembership(api,f.summary,registry,now).provenance;
}
function args(){return {data:{fleet:{equipped:640,total:1678,last30:50,published:{url:'https://publisher.invalid/history'},rebaseline:{historic:true}},history:[{date:'2026-10-18',equipped:640,total:1678}]},newEq:645,newTot:1679,today:'2026-10-19',provenance:source(),gateFn:plausibilityGate,now};}
function ready(){const a=args();const before=structuredClone(a.data);membershipGate(a);const d=a.data;d.fleet.membership=a.provenance;d.tracker={lastUpdated:f.sourceTimestamp,candidateMembership:structuredClone(a.provenance)};d.updated=d.measurementAsOf='2026-10-19';d.tracker.publishedHeadline={equipped:645,total:1679,percentage:38,sourceTimestamp:f.sourceTimestamp};d.fleet.types=sourceTypes(a.provenance.sourceFamilies);for(const seg of ['mainline','express']){const rows=d.fleet.types.filter(x=>x.seg===seg);d.fleet[seg]={equipped:rows.reduce((n,x)=>n+x.equipped,0),total:rows.reduce((n,x)=>n+x.total,0)};}d.knownTails=f.equipped.map(x=>x.TailNumber).sort();d.roster=d.knownTails.map(tail=>({tail}));return {d,before};}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('publisher MAX families and percentages remain separate',()=>{
 const rows=sourceTypes([{family:'B737-MAX8',body:'narrowbody',installed:3,total:123,percentage:2.4},
   {family:'B737-MAX9',body:'narrowbody',installed:35,total:183,percentage:19.1},
   {family:'B737-MAX10',body:'narrowbody',installed:0,total:1,percentage:0}]);
 assert.deepEqual(rows.map(x=>[x.type,x.equipped,x.total,x.percentage]),
   [['737 MAX 8',3,123,2.4],['737 MAX 9',35,183,19.1],['737 MAX 10',0,1,0]]);
});
test('exact unadjusted source accepted without approval override',()=>{const a=args();const receipt=structuredClone(a.data.fleet.rebaseline);const g=membershipGate(a);assert.deepEqual(g.flags,[]);assert.equal(a.data.fleet.total,1679);assert.deepEqual(a.data.fleet.rebaseline,receipt);});
test('large coherent publisher changes remain atomic and advisory',()=>{const a=args();a.data.fleet.equipped=1;a.data.fleet.total=10;const g=membershipGate(a);assert(!g.healed);assert.deepEqual(g.flags,[]);assert.equal(a.data.fleet.equipped,645);assert.equal(a.data.fleet.total,1679);assert.equal(a.data.fleet.plausibility.sourceComparisons.length,2);});
test('unqualified legacy plausibility still rejects large changes',()=>{const a=args();a.data.fleet.total=10;const g=plausibilityGate(a.data,645,1679,a.today);assert(g.healed);assert(g.flags.length);assert.equal(a.data.fleet.total,10);});
test('missing publisher remains a blocking flag',()=>{const a=args();delete a.data.fleet.published;assert(membershipGate(a).flags.some(x=>x.includes('fleet.published')));});
test('no aircraft is excluded or locally corrected',()=>{const p=source();assert.deepEqual(p.raw,{equipped:645,total:1679});assert.deepEqual(p.raw,p.corrected);assert.deepEqual(p.excludedTails,[]);assert.equal(p.rawMembershipSha256,p.membershipSha256);assert.equal(p.expiresAt,undefined);});
for(const [name,change,pattern] of [
 ['legacy exact approval',a=>a.request='645/1678:Sentinel_a86c6d9cddb48191a14825407a697f3d',/overrides/],
 ['arbitrary override',a=>a.request='645/1679:anything',/overrides/],
 ['different pair',a=>a.newTot--,/pair differs/],
 ['exclusion',a=>a.provenance.excludedTails=['N63571'],/exclusions/],
 ['adjusted counts',a=>a.provenance.corrected.total--,/adjusted counts/],
 ['adjusted membership',a=>a.provenance.membershipSha256='b'.repeat(64),/membership was adjusted/],
 ['missing hash',a=>delete a.provenance.equippedSha256,/full-set hash/],
 ['active hold',a=>a.provenance.expiresAt='2026-10-26T14:20:41.605Z',/active correction/],
 ['stale source',a=>a.now+=7200000,/two hours/],
 ['future source',a=>a.now=Date.parse(f.sourceTimestamp)-1,/two hours/]
])test(name+' rejected',()=>{const a=args();change(a);assert.throws(()=>membershipGate(a),pattern);});
test('environment override cannot affect raw parity',()=>{const old=process.env.WIFIODDS_REBASELINE;process.env.WIFIODDS_REBASELINE='645/1679:fake';try{assert.throws(()=>membershipGate(args()),/overrides/);}finally{if(old===undefined)delete process.env.WIFIODDS_REBASELINE;else process.env.WIFIODDS_REBASELINE=old;}});
test('release binds exact counts, clock, roster and preserves prior records',()=>{const {d,before}=ready();assertRelease(d,undefined,now,before);for(const change of [x=>x.fleet.total--,x=>x.fleet.mainline.total--,x=>x.fleet.types[0].total--,x=>x.tracker.publishedHeadline.percentage++,x=>x.tracker.lastUpdated='wrong',x=>x.knownTails.pop(),x=>x.roster.pop(),x=>x.fleet.rebaseline.changed=true,x=>x.history[0].total++,x=>x.fleet.published.url='changed',x=>x.fleet.plausibility.flags.push('bad')]){const bad=structuredClone(d);change(bad);assert.throws(()=>assertRelease(bad,undefined,now,before));}});
test('old hold expiry cannot block a fresh unadjusted source',()=>{const p=source();p.sourceTimestamp='2026-10-27T14:00:00Z';validatePolicy(p,Date.parse('2026-10-27T14:30:00Z'));});
test('public headline counts, percentage and clock must match',()=>{const api={totalCount:4,starlinkPlanes:[{},{}],lastUpdated:'2026-10-23T14:00:00Z'};const html='<title>United Starlink Tracker: 2 of 4 Planes Have Starlink</title><meta content="United planes (50%) have Starlink">'+JSON.stringify({dateModified:api.lastUpdated});assert.equal(publishedHeadline(html,api).percentage,50);for(const bad of [html.replace('2 of 4','2 of 5'),html.replace('50%','49%'),html.replace('14:00:00','15:00:00')])assert.throws(()=>publishedHeadline(bad,api));});
console.log('membership source parity policy controls: '+count+' passed');
