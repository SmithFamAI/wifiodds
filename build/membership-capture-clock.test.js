'use strict';
const assert = require('node:assert/strict');
const { reconcileMembership, settleMembershipCapture } = require('../scripts/reconcile-ua-membership.js');
const { verifyCapturedMembershipSource } = require('./verify-data-deploy.js');
const fixture = require('../test/fixtures/ua-membership-20261019.json');
const initial = Date.parse('2026-10-19T20:56:19.525Z');
let count = 0;

function input({ lead = 622, sourceAge = 30 * 60000, change = () => {} } = {}) {
  const api = { lastUpdated: new Date(initial - sourceAge).toISOString(), totalCount: fixture.rawRows.length,
    starlinkPlanes: structuredClone(fixture.equipped), fleetStats: structuredClone(fixture.fleetStats), flightsByTail: {} };
  const summary = structuredClone(fixture.summary);
  summary.generatedAt = new Date(initial + lead).toISOString();
  const source = { api, summary, registry: JSON.stringify({ dateModified: api.lastUpdated }) + fixture.rawRows
    .map(([tail,type,status,cls]) => `<a id="t-${tail}" title="${type} · ${tail} · ${status}" class="${cls}"></a>`).join('') };
  change(source);
  return source;
}
async function run(options = {}) {
  const source = input(options), original = JSON.stringify(source), waits = [];
  let clock = initial;
  const timing = { now: () => clock, wait: async ms => { waits.push(ms); clock += options.advance === undefined ? ms : options.advance; } };
  const capture = await settleMembershipCapture(source.api, source.summary, timing);
  let result, error;
  try { result = reconcileMembership(source.api, source.summary, source.registry, capture.evaluatedAt); }
  catch (e) { error = e; }
  assert.equal(JSON.stringify(source), original, 'capture settling rewrote source evidence');
  return { source, capture, waits, result, error, timing };
}
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
async function main() {
  await test('observed 622ms lead waits once then passes the unchanged gate', async () => {
    const r = await run(); assert.ifError(r.error); assert.deepEqual(r.waits,[622]);
    assert.equal(r.capture.receivedAt,initial); assert.equal(r.capture.evaluatedAt,initial+622);
    assert.deepEqual(r.result.provenance.corrected,{equipped:645,total:1679});
  });
  for (const lead of [-1,0]) await test('nonfuture summary '+lead+'ms needs no wait',async()=>{
    const r=await run({lead});assert.ifError(r.error);assert.deepEqual(r.waits,[]);
  });
  for (const lead of [1,1000]) await test('exact bounded lead '+lead+'ms waits once',async()=>{
    const r=await run({lead});assert.ifError(r.error);assert.deepEqual(r.waits,[lead]);
  });
  await test('1001ms lead is rejected without waiting or changing a threshold',async()=>{
    const r=await run({lead:1001});assert.match(r.error.message,/summary generation clock/);assert.deepEqual(r.waits,[]);
  });
  for (const [name,change,pattern] of [
    ['missing summary',s=>{delete s.summary.generatedAt;},/summary generation clock/],
    ['invalid summary',s=>{s.summary.generatedAt='invalid';},/summary generation clock/],
    ['summary before API',s=>{s.summary.generatedAt=new Date(Date.parse(s.api.lastUpdated)-1).toISOString();},/summary generation clock/],
    ['invalid API',s=>{s.api.lastUpdated='invalid';},/source must be dated/]
  ]) await test(name+' remains rejected without waiting',async()=>{
    const r=await run({change});assert.match(r.error.message,pattern);assert.deepEqual(r.waits,[]);
  });
  for (const [name,sourceAge] of [['future API',-1],['stale API',7200001]]) await test(name+' is ineligible for capture waiting',async()=>{
    const r=await run({sourceAge});assert.match(r.error.message,/source must be dated/);assert.deepEqual(r.waits,[]);
  });
  for (const [name,advance] of [['nonadvancing clock',0],['early timer',621],['backward clock',-1]]) await test(name+' fails after the only wait',async()=>{
    const r=await run({advance});assert.match(r.error.message,/summary generation clock/);assert.deepEqual(r.waits,[622]);
  });
  await test('source that becomes stale during waiting is rejected',async()=>{
    const r=await run({sourceAge:7200000-100});assert.match(r.error.message,/source must be dated/);assert.deepEqual(r.waits,[622]);
  });
  await test('delayed timer cannot exceed the monotonic one-second budget',async()=>{
    const source=input();let clock=initial,elapsed=0;
    await assert.rejects(settleMembershipCapture(source.api,source.summary,{now:()=>clock,monotonic:()=>elapsed,
      wait:async()=>{clock+=1001;elapsed+=1001;}}),/capture wait exceeded one-second budget/);
  });
  await test('membership corruption still fails after a valid clock wait',async()=>{
    const r=await run({change:s=>{s.api.totalCount++;}});assert(r.error);assert.deepEqual(r.waits,[622]);
  });
  await test('deployment verifier uses capture settling and full strict source checks',async()=>{
    const source=input();const provenance=reconcileMembership(source.api,source.summary,source.registry,initial+622).provenance;
    const data={tracker:{lastUpdated:source.api.lastUpdated},fleet:{equipped:645,total:1679,membership:provenance}};
    let clock=initial;const waits=[];
    const result=await verifyCapturedMembershipSource(data,{equipped:645,total:1679},source,{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
    assert.deepEqual(result,provenance);assert.deepEqual(waits,[622]);
    clock=initial;waits.length=0;
    await assert.rejects(verifyCapturedMembershipSource(data,{equipped:645,total:1679},source,{now:()=>clock,wait:async ms=>{waits.push(ms);}}),/summary generation clock/);
    assert.deepEqual(waits,[622]);
  });
  console.log('membership capture clock controls: '+count+' passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
