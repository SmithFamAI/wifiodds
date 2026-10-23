#!/usr/bin/env node
'use strict';

// These controls exercise the real updater in a disposable directory. The only
// replacement is its network boundary; no fixture can publish or reach a host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-membership-'));
const sourceTime = '2026-10-19T14:13:25.368Z';
const now = '2026-10-19T14:30:00.000Z';
const baseline = {
  updated: '2026-10-15', measurementAsOf: '2026-10-15',
  fleet: { equipped: 1, total: 3, last30: 10, types: [],
    mainline: { equipped: 1, total: 2 }, express: { equipped: 0, total: 1 },
    published: { url: 'https://ir.united.com/fixture', equipped: 1, total: 3 } },
  history: [{ date: '2026-10-15', equipped: 1, total: 3 }],
  routes: {}, routeCache: {}, roster: [], leaderboard: []
};
function fixture() {
  const api = { totalCount: 4, lastUpdated: sourceTime,
    fleetStats: { mainline: { total: 3, starlink: 1, unverified: 1 },
      express: { total: 1, starlink: 1, unverified: 0 } },
    starlinkPlanes: [
      { TailNumber: 'N34571', Aircraft: 'Airbus A321neo', fleet: 'mainline', DateFound: '2026-10-16' },
      { TailNumber: 'N100EX', Aircraft: 'E175', fleet: 'express', DateFound: '2026-10-10' }
    ], flightsByTail: {} };
  const sum = { generatedAt: now, airlines: [{ code: 'UA', total: 4, installed: 2, families: [
    { family: 'A321', body: 'narrowbody', total: 1, installed: 1 },
    { family: 'B737-MAX9', body: 'narrowbody', total: 1, installed: 0 },
    { family: 'E175', body: 'regional', total: 1, installed: 1 },
    { family: 'unknown', body: 'narrowbody', total: 1, installed: 0 }
  ] }] };
  const rows = [
    ['N34571', 'A321neo', 'Starlink', 'tail-sl'],
    ['N100EX', 'E175', 'Starlink', 'tail-sl'],
    ['N37484', '737 MAX 9', 'Not checked yet', 'tail-dim'],
    ['N63571', 'Type not listed', 'Not checked yet', 'tail-dim']
  ];
  return { api, sum, rows, sourceTime };
}
function html(f) {
  return '<script type="application/ld+json">' + JSON.stringify({ dateModified: f.sourceTime }) + '</script>' +
    f.rows.map(([tail, type, status, cls]) => `<a id="t-${tail}" title="${type} · ${tail} · ${status}" class="${cls}"></a>`).join('');
}
function run(f = fixture(), time = now, before = baseline, advanceClock = false) {
  const dataPath = path.join(work, 'data.json');
  const bytes = JSON.stringify(before);
  fs.writeFileSync(dataPath, bytes);
  const headline=f.headline || `<title>United Starlink Tracker: ${f.api.starlinkPlanes.length} of ${f.api.totalCount} Planes Have Starlink</title><meta content="United planes (${Math.floor(100*f.api.starlinkPlanes.length/f.api.totalCount)}%) have Starlink">`+JSON.stringify({dateModified:f.api.lastUpdated});
  const input = { api: f.api, sum: f.sum, registry: html(f), headline };
  const inputPath = path.join(work, 'network.json');
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const preload = path.join(work, 'network.cjs');
  fs.writeFileSync(preload, `
const fs=require('node:fs');
const input=JSON.parse(fs.readFileSync(process.env.TEST_INPUT));
const NativeDate=Date;
let clock=NativeDate.parse(process.env.TEST_NOW);
global.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} };
if(process.env.TEST_CLOCK_ADVANCE==='true')global.setTimeout=(fn,ms)=>{clock+=ms;queueMicrotask(fn);};
global.fetch=async url=>{
 const p=new URL(url).pathname;
 const values={'/':input.headline,'/api/data':input.api,'/api/fleet-summary':input.sum,'/fleet':input.registry,'/routes':'','/api/plan-route':{},'/mcp':{}};
 if(!Object.hasOwn(values,p))throw new Error('Unexpected network request '+p);
 return {ok:true,status:200,json:async()=>structuredClone(values[p]),text:async()=>typeof values[p]==='string'?values[p]:JSON.stringify(values[p])};
};
`);
  const env = { ...process.env, TEST_INPUT: inputPath, TEST_NOW: time, TEST_CLOCK_ADVANCE: String(advanceClock), WIFIODDS_UNITED_DATA_FILE: dataPath };
  for (const key of Object.keys(env)) if (key.startsWith('WIFIODDS_REBASELINE')) delete env[key];
  const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/update-unitedstarlink.js'), '--max-cache-routes', '1'],
    { env, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return { ...result, data: JSON.parse(fs.readFileSync(dataPath)), unchanged: fs.readFileSync(dataPath, 'utf8') === bytes };
}
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
try {
  test('real updater waits once for a bounded summary lead before unchanged checks', () => {
    const f=fixture();f.sum.generatedAt=new Date(Date.parse(now)+622).toISOString();
    const r=run(f,now,baseline,true);assert.equal(r.status,0,r.stderr);
    assert.equal(r.data.fleet.total,4);assert(r.stdout.includes('"waitMs":622'));
    assert(r.stdout.includes('"evaluatedAt":'+(Date.parse(now)+622)));
  });
  test('real updater retains original bytes when the clock does not catch up', () => {
    const f=fixture();f.sum.generatedAt=new Date(Date.parse(now)+622).toISOString();
    const r=run(f);assert.notEqual(r.status,0);assert(r.unchanged);
    assert.match(r.stderr,/summary generation clock/);
  });
  test('real updater does not wait for a summary beyond the capture budget', () => {
    const f=fixture();f.sum.generatedAt=new Date(Date.parse(now)+1001).toISOString();
    const r=run(f,now,baseline,true);assert.notEqual(r.status,0);assert(r.unchanged);
    assert(r.stdout.includes('"waitMs":0'));assert.match(r.stderr,/summary generation clock/);
  });
  test('retains every source member including N63571 and exact source family rows', () => {
    const r = run(); assert.equal(r.status, 0, r.stderr);
    assert.equal(r.data.fleet.total, 4, 'N63571 stays in the publisher population');
    assert.equal(r.data.fleet.equipped, 2);
    assert.equal(r.data.fleet.mainline.total, 3);
    assert.equal(r.data.fleet.express.total, 1);
    assert.equal(r.data.roster.length, 2);
    assert.deepEqual(r.data.fleet.membership.excludedTails, []);
    assert.equal(r.data.fleet.membership.raw.total, 4);
    assert.equal(r.data.fleet.membership.corrected.total, 4);
    assert.equal(r.data.fleet.types.reduce((n,x)=>n+x.total,0),4);
    assert(r.data.fleet.types.some(x=>x.type==='Type not listed' && x.total===1));
    assert.equal(r.data.tracker.lastUpdated, sourceTime);
  });
  test('accepts a coherent publisher denominator change without a bespoke baseline ruling', () => {
    const before = structuredClone(baseline); before.fleet.total = 2;
    const r = run(fixture(), now, before); assert.equal(r.status, 0, r.stderr);
    assert.equal(r.data.fleet.total, 4);
    assert.deepEqual(r.data.fleet.plausibility.flags,[]);
    assert(r.data.fleet.plausibility.sourceComparisons.some(x=>x.includes('denominator moved')));
    assert.equal(r.data.fleet.rebaseline, undefined);
  });
  test('large coherent source changes stay source values with advisory historical comparison', () => {
    const before=structuredClone(baseline);before.fleet.equipped=40;before.fleet.total=100;
    const r=run(fixture(),now,before);assert.equal(r.status,0,r.stderr);
    assert.equal(r.data.fleet.equipped,2);assert.equal(r.data.fleet.total,4);
    assert.equal(r.data.measurementAsOf,'2026-10-19');assert.equal(r.data.history.length,2);
    assert.equal(r.data.fleet.plausibility.sourceComparisons.length,2);assert.deepEqual(r.data.fleet.plausibility.flags,[]);
  });
  test('upstream removal is a no-op even after the temporary hold expires', () => {
    const f = fixture(); f.sourceTime = '2026-10-27T14:13:25.368Z'; f.api.lastUpdated = f.sourceTime;
    f.sum.generatedAt = '2026-10-27T14:30:00.000Z';
    f.rows = f.rows.filter(row => row[0] !== 'N63571');
    f.api.totalCount = 3; f.api.fleetStats.mainline.total = 2;
    const ua = f.sum.airlines[0]; ua.total = 3; ua.families = ua.families.filter(row => row.family !== 'unknown');
    const r = run(f, f.sum.generatedAt); assert.equal(r.status, 0, r.stderr);
    assert.equal(r.data.fleet.total, 3);
    assert.deepEqual(r.data.fleet.membership.excludedTails, []);
    assert.equal(r.data.fleet.membership.holdId, undefined);
  });
  const invalid = [
    ['public headline disagreement', f => { f.headline='<title>United Starlink Tracker: 2 of 99 Planes Have Starlink</title>'; }],
    ['stale source', f => { f.api.lastUpdated = '2026-10-19T10:00:00.000Z'; }],
    ['future source', f => { f.api.lastUpdated = '2026-10-20T14:00:00.000Z'; }],
    ['future summary', f => { f.sum.generatedAt = '2026-10-20T14:00:00.000Z'; }],
    ['registry observation mismatch', f => { f.sourceTime = '2026-10-19T14:12:00.000Z'; }],
    ['duplicate registry tail', f => { f.rows.push(f.rows[0]); }],
    ['missing registry member', f => { f.rows.pop(); }],
    ['equipped membership mismatch', f => { f.api.starlinkPlanes[0].TailNumber = 'N999ZZ'; }],
    ['segment disagreement', f => { f.api.fleetStats.mainline.total++; }],
    ['invalid source percentage', f => { f.sum.airlines[0].families[0].percentage = '100'; }],
    ['family disagreement', f => { f.sum.airlines[0].families[0].total++; }],
    ['balanced family corruption', f => { f.sum.airlines[0].families[0].total++; f.sum.airlines[0].families[1].total--; }],
    ['balanced equipped family corruption', f => { f.sum.airlines[0].families[0].installed--; f.sum.airlines[0].families[1].installed++; }],
    ['aliased held flight evidence', f => { f.api.flightsByTail[' N63571 '] = [{ FlightNumber: 'UA123' }]; }],
    ['lowercase held flight evidence', f => { f.api.flightsByTail.n63571 = [{ FlightNumber: 'UA123' }]; }],
    ['balanced equipped segment relabel', f => { f.api.starlinkPlanes[0].fleet = 'express'; f.api.starlinkPlanes[1].fleet = 'mainline'; }],
    ['held aircraft type change', f => { f.rows[3][1] = '737 MAX 9'; }],
    ['malformed held aircraft flight evidence', f => { f.api.flightsByTail.N63571 = {}; }],
    ['unknown membership change', f => { f.rows[2][1] = 'Type not listed'; }],
    ['duplicate airline', f => { f.sum.airlines.push(structuredClone(f.sum.airlines[0])); }]
  ];
  for (const [name, change] of invalid) test(name + ' rejects before writing', () => {
    const f = fixture(); change(f); const r = run(f);
    assert.notEqual(r.status, 0, name); assert(r.unchanged, name + ' overwrote prior data');
  });
  test('superseded hold expiry does not alter or reject the publisher population', () => {
    const f = fixture(); f.sourceTime = '2026-10-27T14:13:25.368Z'; f.api.lastUpdated = f.sourceTime;
    f.sum.generatedAt = '2026-10-27T14:30:00.000Z';
    const r = run(f, f.sum.generatedAt);
    assert.equal(r.status,0,r.stderr);assert.equal(r.data.fleet.total,4);assert.equal(r.data.fleet.membership.expiresAt,undefined);
  });
  test('duplicate equipped tail rejects before writing', () => {
    const f = fixture(); f.api.starlinkPlanes[1] = structuredClone(f.api.starlinkPlanes[0]);
    const r = run(f); assert.notEqual(r.status, 0); assert(r.unchanged);
  });
} finally { fs.rmSync(work, { recursive: true, force: true }); }
console.log(`membership source-parity controls: ${count} passed`);
