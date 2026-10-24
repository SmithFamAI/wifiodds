'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { reconcileMembership } = require('../scripts/reconcile-ua-membership.js');
const { verifyMembershipSource, sample } = require('./verify-data-deploy.js');
const f = require('../test/fixtures/ua-membership-20261019.json');
const now = Date.parse('2026-10-19T15:15:00Z');
const api = {lastUpdated:f.sourceTimestamp,totalCount:f.rawRows.length,starlinkPlanes:f.equipped,fleetStats:f.fleetStats,flightsByTail:{}};
const registry = JSON.stringify({dateModified:api.lastUpdated}) + f.rawRows.map(([tail,type,status,cls])=>`<a id="t-${tail}" title="${type} · ${tail} · ${status}" class="${cls}"></a>`).join('');
const p = reconcileMembership(api,f.summary,registry,now).provenance;
const data = {measurementAsOf:'2026-10-19',tracker:{lastUpdated:api.lastUpdated},fleet:{equipped:645,total:1679,membership:p}};
let n=0;
function test(name, fn) { fn(); n++; console.log('PASS '+name); }
function verify(d=data,r=registry,t={equipped:645,total:1679},clock=now){return verifyMembershipSource(d,t,{api,summary:f.summary,registry:r},clock);}
test('derives unchanged population from complete raw source',()=>assert.equal(verify().corrected.total,1679));
test('same-count roster swap cannot launder copied hashes',()=>assert.throws(()=>verify(data,registry.replaceAll('N37484','N999ZZ')),/provenance/));
test('wrong raw headline is rejected',()=>assert.throws(()=>verify(data,registry,{equipped:645,total:1678}),/raw tracker/));
test('claimed correction is rejected',()=>{const d=structuredClone(data);d.fleet.membership.excludedTails=['N63571'];assert.throws(()=>verify(d),/exclusions/);});
test('wrong accepted source clock is rejected',()=>{const d=structuredClone(data);d.tracker.lastUpdated='2026-10-19T14:00:00Z';assert.throws(()=>verify(d),/source clock/);});
test('stale source fails',()=>assert.throws(()=>verify(data,registry,undefined,now+7200000),/two hours/));
test('ordinary exact equality stays required',()=>{const d=structuredClone(data);delete d.fleet.membership;assert.equal(verifyMembershipSource(d,{equipped:645,total:1679}),null);assert.throws(()=>verifyMembershipSource(d,{equipped:645,total:1678}),/tracker count/);});
test('malformed metadata does not fall back to ordinary equality',()=>{const d=structuredClone(data);d.fleet.membership={raw:{equipped:645,total:1679}};assert.throws(()=>verifyMembershipSource(d,{equipped:645,total:1679}),/metadata/);});
async function main(){
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'wifiodds-membership-canary-'));
  const put=(r,b)=>{const out=path.join(work,r);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);};
  const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
  const home='<p>fixture disclosure</p>', badge='<svg>raw tracker</svg>', og='fixture image';
  const airline={equipped:1,fleet:2,segments:[{system:'starlink',n:1,as:'2026-10-19'}]};
  const ordinaryApi={airline:{fleet:{equipped:1,total:2},segments:[{nextGen:true,aircraft:1,asOf:'2026-10-19'}]}};
  const unitedApi={airline:{fleet:{equipped:645,total:1679,membership:p,source:'unitedstarlinktracker.com'}}};
  put('united/data.json',JSON.stringify(data));put('index.html',home);put('assets/og.png',og);put('assets/united-starlink-badge.svg',badge);
  put('api/airlines/alaska',JSON.stringify(ordinaryApi));put('api/airlines/hawaiian',JSON.stringify(ordinaryApi));put('api/airlines/united',JSON.stringify(unitedApi));
  const expected={united:data,unitedBytes:Buffer.from(JSON.stringify(data)),alaska:airline,hawaiian:airline,homeOrder:[],homeSha:hash(home),ogSha:hash(og),badgeSha:hash(badge)};
  const run=()=>sample('',work,expected,1,true);
  try {
    assert.deepEqual(await run(),[]);n++;console.log('PASS strict complete current bodies');
    const lag=structuredClone(data);lag.measurementAsOf='2026-10-15';put('united/data.json',JSON.stringify(lag));
    const unprovenLag=await run();
    assert(unprovenLag.length>0 && !unprovenLag.propagationLag);n++;console.log('PASS older content without a pinned prior artifact is a hard failure');
    put('api/airlines/united',JSON.stringify({airline:{fleet:{equipped:-1,total:0}}}));
    assert.equal((await run()).invalidShape,true);n++;console.log('PASS impossible API counts are defects even with lag');
    put('api/airlines/united',JSON.stringify(unitedApi));
    put('united/data.json',JSON.stringify(data));
    for(const [route,wrong,good,term] of [['assets/united-starlink-badge.svg','changed',badge,'badge'],['index.html','missing disclosure',home,'homepage'],['api/airlines/united',JSON.stringify({airline:{fleet:{equipped:645,total:1679}}}),JSON.stringify(unitedApi),'membership']]){
      put(route,wrong);assert((await run()).some(x=>x.includes(term)),route);put(route,good);n++;console.log('PASS rejects mismatched '+route);
    }
  } finally {fs.rmSync(work,{recursive:true,force:true});}
  console.log('membership verifier controls: '+n+' passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
