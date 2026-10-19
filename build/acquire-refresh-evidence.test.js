'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { acquire, inspectSources, inspectFaa, SOURCES, UA } = require('./acquire-refresh-evidence');
const now = Date.parse('2026-10-19T20:00:00.000Z');
const stamp = '2026-10-19T19:25:56.232Z';
const faa = '<h1>N63571 is Assigned</h1><h2>Aircraft Description</h2>' +
  '<div>Serial Number RX8-3127 Status Valid Manufacturer Name AEROSTAR INTERNATIONAL INC Certificate Issue Date 08/26/2024 ' +
  'Model RX 8 Expiration Date 08/31/2031 Type Aircraft Balloon Type Engine None Pending Number Change None Dealer No</div>' +
  '<h2>Registered Owner</h2><div>PRIVATE REGISTRANT ADDRESS</div><input name="secret" value="HIDDEN FORM STATE">';
function sources() {
  return {
    api: { totalCount: 3, lastUpdated: stamp, fleetStats: { mainline: { total: 3, starlink: 1 }, express: { total: 0, starlink: 0 } }, starlinkPlanes: [{ TailNumber: 'N100AA' }] },
    summary: { generatedAt: '2026-10-19T19:26:00.000Z', airlines: [{ code: 'UA', total: 3, installed: 1 }] },
    registry: `<script>{"dateModified":"${stamp}"}</script><a id="t-N100AA" title="737 · N100AA · Starlink" class="tail-sl"></a>` +
      '<a id="t-N37484" title="737 MAX 9 · N37484 · Not checked yet" class="tail-dim"></a>' +
      '<a id="t-N63571" title="Type not listed · N63571 · Not checked yet" class="tail-dim"></a>'
  };
}
function inspect(s) { return inspectSources(Buffer.from(JSON.stringify(s.api)), Buffer.from(JSON.stringify(s.summary)), Buffer.from(s.registry), now); }
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-acquire-'));
async function simulate({ badStatus, failAt = 0, mutate, brokenFaa, throwAt, oversizedAt } = {}) {
  const s = sources(); if (mutate) mutate(s);
  const bytes = [JSON.stringify(s.api), JSON.stringify(s.summary), s.registry, brokenFaa === undefined ? faa : brokenFaa];
  const calls = [], out = path.join(work, 'run-' + cryptoId());
  const result = await acquire(out, { now: () => now, context: { fixture: true }, fetchImpl: async (url, options) => {
    const i = calls.length; calls.push({ url, options });
    assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { 'User-Agent': UA });
    if (i === throwAt) throw new Error('SECRET EXCEPTION CONTENT');
    return new Response(i === oversizedAt ? Buffer.alloc(8 * 1024 * 1024 + 1) : bytes[i], {
      status: i === failAt && badStatus ? badStatus : 200,
      headers: { 'cf-ray': 'fixture-ray', 'set-cookie': 'SECRET COOKIE' }
    });
  } });
  return { result, out, calls, bytes };
}
function cryptoId() { return require('node:crypto').randomBytes(8).toString('hex'); }
(async () => {
  await test('complete cohort retains exact source bodies, sets and selected FAA facts', async () => {
    const r = await simulate(); assert.equal(r.result.success, true); assert.equal(r.calls.length, 4);
    for (let i = 0; i < 3; i++) assert.equal(fs.readFileSync(path.join(r.out, SOURCES[i].name), 'utf8'), r.bytes[i]);
    const m = JSON.parse(fs.readFileSync(path.join(r.out, 'membership.json')));
    assert.deepEqual(m.raw, { total: 3, equipped: 1 }); assert(m.members.includes('N63571')); assert(m.members.includes('N37484'));
    assert.equal(fs.readFileSync(path.join(r.out, 'membership.txt'), 'utf8'), 'N100AA\nN37484\nN63571\n');
    const f = JSON.parse(fs.readFileSync(path.join(r.out, 'faa-selected.json')));
    assert.equal(f.serial, 'RX8-3127'); assert.equal(f.aircraftType, 'Balloon');
    assert.equal(f.responseSha256, r.result.responses[3].sha256);
    const retained = fs.readdirSync(r.out).map(n => fs.readFileSync(path.join(r.out, n), 'utf8')).join('');
    for (const privateText of ['PRIVATE REGISTRANT', 'HIDDEN FORM STATE', 'SECRET COOKIE']) assert(!retained.includes(privateText));
    assert.equal(r.result.publicationAttempted, false);
  });
  for (const status of [301, 403, 429, 500]) await test('HTTP ' + status + ' stops without retries or redirects and retains receipt', async () => {
    const r = await simulate({ badStatus: status }); assert.equal(r.result.success, false); assert.equal(r.calls.length, 1);
    assert.equal(r.result.responses[0].status, status); assert.equal(fs.readFileSync(path.join(r.out, 'tracker.json'), 'utf8'), r.bytes[0]);
    assert(fs.existsSync(path.join(r.out, 'manifest.json'))); assert(!fs.existsSync(path.join(r.out, 'membership.json')));
  });
  await test('network errors retain bounded metadata without exception contents', async () => {
    const r = await simulate({ throwAt: 1 }); assert.equal(r.result.success, false); assert.equal(r.calls.length, 2);
    assert(!JSON.stringify(r.result).includes('SECRET')); assert(fs.existsSync(path.join(r.out, 'tracker.json')));
  });
  await test('oversized body fails with metadata and no later requests', async () => {
    const r = await simulate({ oversizedAt: 0 }); assert.equal(r.result.success, false); assert.equal(r.calls.length, 1);
  });
  const invalid = [
    ['stale API', s => { s.api.lastUpdated = '2026-10-19T10:00:00Z'; }],
    ['future API', s => { s.api.lastUpdated = '2026-10-20T10:00:00Z'; }],
    ['future summary', s => { s.summary.generatedAt = '2026-10-20T10:00:00Z'; }],
    ['old summary', s => { s.summary.generatedAt = '2026-10-19T10:00:00Z'; }],
    ['different registry clock', s => { s.registry = s.registry.replace(stamp, '2026-10-19T19:25:57.232Z'); }],
    ['duplicate member', s => { s.registry += '<a id="t-N63571" title="Type not listed · N63571 · Not checked yet" class="tail-dim"></a>'; }],
    ['duplicate equipped', s => { s.api.starlinkPlanes.push(s.api.starlinkPlanes[0]); }],
    ['equipped outside registry', s => { s.api.starlinkPlanes[0].TailNumber = 'N999AA'; }],
    ['string total', s => { s.api.totalCount = '3'; }],
    ['negative segment', s => { s.api.fleetStats.express.total = -1; }],
    ['summary total mismatch', s => { s.summary.airlines[0].total = 4; }],
    ['duplicate UA', s => { s.summary.airlines.push(s.summary.airlines[0]); }],
    ['registry equipped mismatch', s => { s.registry = s.registry.replace('tail-sl', 'tail-dim'); }]
    ,['missing type', s => { s.registry = s.registry.replace('Type not listed ·', ' ·'); }]
    ,['missing status', s => { s.registry = s.registry.replace('N63571 · Not checked yet', 'N63571 · '); }]
    ,['unknown state class', s => { s.registry = s.registry.replace('class="tail-dim"', 'class="tail-unknown-state"'); }]
    ,['unknown Wi-Fi state', s => { s.registry = s.registry.replace('Not checked yet', 'Unrecognized Wi-Fi'); }]
  ];
  for (const [name, change] of invalid) await test(name + ' cannot qualify evidence', () => { const s = sources(); change(s); assert.throws(() => inspect(s)); });
  await test('invalid cohort retains original raw bodies and exits failed', async () => {
    const r = await simulate({ mutate: s => { s.api.totalCount++; } }); assert.equal(r.result.success, false);
    assert(fs.existsSync(path.join(r.out, 'registry.html'))); assert(!fs.existsSync(path.join(r.out, 'membership.json')));
  });
  for (const html of [faa.replace('N63571', 'N000AA'), faa.replace('Aircraft Description', 'Challenge'), faa.replace('RX8-3127', ''), '<html>Verify you are human</html>']) {
    await test('FAA wrong identity, missing section, missing field or challenge fails closed', async () => {
      assert.throws(() => inspectFaa(Buffer.from(html))); const r = await simulate({ brokenFaa: html });
      assert.equal(r.result.success, false); assert(!fs.existsSync(path.join(r.out, 'faa-selected.json')));
      assert.equal(r.result.responses[3].status, 200); assert(r.result.responses[3].sha256);
    });
  }
  for (const html of [faa.replace('N63571', 'N99999') + '<p>Previous search: N63571</p>', '<h1>N99999 is Assigned</h1>' + faa]) {
    await test('incidental N63571 mention or multiple assigned records cannot bind FAA identity', async () => {
      const r = await simulate({ brokenFaa: html }); assert.equal(r.result.success, false);
      assert(!fs.existsSync(path.join(r.out, 'faa-selected.json')));
    });
  }
  await test('existing output directory cannot overwrite old evidence', async () => {
    const r = await simulate(); const before = fs.readFileSync(path.join(r.out, 'manifest.json'));
    await assert.rejects(acquire(r.out, { fetchImpl: () => { throw new Error('must not fetch'); } }));
    assert.deepEqual(fs.readFileSync(path.join(r.out, 'manifest.json')), before);
  });
  await test('CLI refuses accidental local acquisition', () => {
    const env = { ...process.env }; delete env.GITHUB_ACTIONS;
    const r = spawnSync(process.execPath, [path.join(__dirname, 'acquire-refresh-evidence.js')], { env, encoding: 'utf8' });
    assert.equal(r.status, 1); assert(r.stderr.includes('preflight failed'));
  });
  await test('diagnostic workflow is read-only, manual, isolated, retained and mutually exclusive', () => {
    const yaml = fs.readFileSync(path.join(__dirname, '../.github/workflows/daily-data.yml'), 'utf8');
    const diagnostic = yaml.split('  diagnostic:\n')[1].split('\n  refresh:\n')[0];
    assert(diagnostic.includes("if: ${{ github.event_name == 'workflow_dispatch' && inputs.diagnostic_only }}"));
    assert(yaml.includes("if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.diagnostic_only) }}"));
    assert(diagnostic.includes('permissions:\n      contents: read')); assert(diagnostic.includes('persist-credentials: false'));
    assert(diagnostic.includes('if: ${{ always() }}')); assert(diagnostic.includes('retention-days: 1'));
    assert(diagnostic.includes('path: ${{ runner.temp }}/wifiodds-evidence'));
    const commands = [...diagnostic.matchAll(/\brun: (.*)/g)].map(m => m[1]);
    assert.deepEqual(commands, ['node build/acquire-refresh-evidence.js']);
    assert(!/secrets\.|WIFIODDS_REBASELINE|git push|ship\.sh|daily-refresh\.sh/.test(diagnostic));
    assert(yaml.includes("cron: '10 13 * * *'")); assert(yaml.includes('group: daily-data\n  cancel-in-progress: false'));
  });
  console.log('PASS ' + count + ' diagnostic acquisition controls');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(work, { recursive: true, force: true }));
