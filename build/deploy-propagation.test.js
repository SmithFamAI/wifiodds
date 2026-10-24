#!/usr/bin/env node
'use strict';

// Offline controls for the real deployment verifier. These synthetic snapshots
// preserve the committed public population but use fixed historical clocks;
// they are never source evidence and never write product data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const verifier = require('./verify-data-deploy.js');
const ROOT = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const sourceFile = path.join(ROOT, 'united/data.json');
const originalSource = fs.readFileSync(sourceFile);
const source = JSON.parse(originalSource);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wifiodds-propagation-'));
const priorStamp = '2026-01-02T10:00:00.000Z';
const currentStamp = '2026-01-02T11:00:00.000Z';
const newerStamp = '2026-01-02T12:00:00.000Z';
let passed = 0;

function withClock(data, stamp) {
  const value = clone(data);
  value.updated = value.measurementAsOf = stamp.slice(0, 10);
  value.tracker.lastUpdated = stamp;
  value.fleet.membership.sourceTimestamp = stamp;
  value.tracker.candidateMembership = clone(value.fleet.membership);
  value.tracker.publishedHeadline.sourceTimestamp = stamp;
  return value;
}

function snapshot(label, stamp) {
  const united = withClock(source, stamp);
  const bodies = {
    'united/data.json': Buffer.from(JSON.stringify(united)),
    'index.html': Buffer.from('<p>Known ' + label + ' homepage</p>'),
    'assets/og.png': Buffer.from('known-' + label + '-image'),
    'assets/united-starlink-badge.svg': Buffer.from('<svg>known-' + label + '-badge</svg>')
  };
  const projection = { equipped: united.fleet.equipped, total: united.fleet.total,
    membership: united.fleet.membership, source: 'https://unitedstarlinktracker.com/' };
  bodies['api/airlines/united'] = Buffer.from(JSON.stringify({ airline: { fleet: projection } }));
  const ordinary = { airline: { fleet: { equipped: 1, total: 2 },
    segments: [{ nextGen: true, aircraft: 1, asOf: '2026-01-02' }] } };
  bodies['api/airlines/alaska'] = Buffer.from(JSON.stringify(ordinary));
  bodies['api/airlines/hawaiian'] = Buffer.from(JSON.stringify(ordinary));
  const airline = { equipped: 1, fleet: 2, segments: [{ system: 'starlink', n: 1, as: '2026-01-02' }] };
  return { bodies, expected: { commit: (label === 'prior' ? 'a' : 'b').repeat(40), united,
    unitedBytes: bodies['united/data.json'], homeOrder: [], alaska: airline, hawaiian: airline,
    homeSha: hash(bodies['index.html']), ogSha: hash(bodies['assets/og.png']),
    badgeSha: hash(bodies['assets/united-starlink-badge.svg']) } };
}

const prior = snapshot('prior', priorStamp);
const current = snapshot('current', currentStamp);
const expected = { ...current.expected, prior: prior.expected };
function put(route, body) {
  const file = path.join(work, route);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
function reset(which = current) {
  for (const [route, body] of Object.entries(which.bodies)) put(route, body);
}
const run = (exp = expected) => verifier.sample('', work, exp, 1, true);
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS ' + name);
}
async function hardFailure(exp = expected) {
  let result;
  try { result = await run(exp); }
  catch (error) {
    assert(error instanceof Error);
    return; // A malformed response may throw; it still must never become lag.
  }
  assert(result.length > 0, 'wrong content must not pass');
  assert.notEqual(result.propagationLag, true, 'wrong content must not become a retry');
}
async function retryOnly() {
  const result = await run();
  assert(result.length > 0, 'older artifacts cannot prove current publication');
  assert.equal(result.propagationLag, true, 'known old/current mixture is bounded lag');
  assert.notEqual(result.invalidShape, true);
  assert.notEqual(result.denied, true);
}

function confirmationBlock() {
  const lines = fs.readFileSync(path.join(ROOT, '.github/workflows/daily-data.yml'), 'utf8').split('\n');
  const start = lines.findIndex(line => /- name: Confirm current reviewed JSON/.test(line));
  assert(start >= 0, 'confirmation step remains present');
  const runAt = lines.findIndex((line, i) => i > start && /^        run: \|/.test(line));
  assert(runAt > start);
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    if (lines[i] && !/^          /.test(lines[i])) break;
    body.push(lines[i].slice(10));
  }
  assert(body.length > 0);
  return body.join('\n').replace(/\$\{\{\s*github\.sha\s*\}\}/g, 'a'.repeat(40))
    .replace(/\$\{\{\s*runner\.temp\s*\}\}/g, work);
}

function loopControl(mode, expectedStatus, expectedAttempts) {
  const bin = path.join(work, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const count = path.join(work, 'attempt-count');
  fs.writeFileSync(count, '0');
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n' +
    'n=$(cat "$TEST_ATTEMPTS")\nn=$((n+1))\nprintf "%s" "$n" > "$TEST_ATTEMPTS"\n' +
    'case "$TEST_MODE" in\n' +
    '  eventual) [ "$n" -lt 3 ] && exit 3; exit 0;;\n' +
    '  hard) exit 1;;\n  denied) exit 2;;\n  lag) exit 3;;\n  *) exit 9;;\nesac\n', { mode: 0o700 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "%s\\n" "' + 'b'.repeat(40) + '"\n', { mode: 0o700 });
  const result = cp.spawnSync('/bin/bash', ['-e', '-c', confirmationBlock()], {
    cwd: work, encoding: 'utf8', timeout: 8000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      TEST_MODE: mode, TEST_ATTEMPTS: count, RUNNER_TEMP: work, GITHUB_SHA: 'a'.repeat(40) }
  });
  assert.equal(result.error, undefined, 'bounded confirmation loop must terminate');
  assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
  assert.equal(Number(fs.readFileSync(count, 'utf8')), expectedAttempts,
    'actual workflow loop executes only the allowed number of verifier attempts');
}

async function main() {
  for (const key of ['sourceClock', 'priorEligible', 'readPriorExpected', 'sample'])
    assert.equal(typeof verifier[key], 'function', key + ' contract is available');
  await test('canonical same-day clocks and complete prior artifact qualify', () => {
    assert.equal(verifier.sourceClock(prior.expected.united), Date.parse(priorStamp));
    assert.equal(verifier.sourceClock(current.expected.united), Date.parse(currentStamp));
    assert.equal(verifier.priorEligible(prior.expected, expected), true);
  });
  for (const stamp of [undefined, '', 'not-a-clock', '2026-01-02',
    '2026-01-02T10:00:00Z', '2026-01-02T10:00:00.000+00:00',
    '2026-02-30T10:00:00.000Z', '2999-01-02T10:00:00.000Z']) {
    await test('rejects malformed or future timestamp ' + String(stamp), () => {
      const data = clone(prior.expected.united);
      data.tracker.lastUpdated = data.fleet.membership.sourceTimestamp = stamp;
      assert.throws(() => verifier.sourceClock(data));
      const candidate = { ...prior.expected, united: data, unitedBytes: Buffer.from(JSON.stringify(data)) };
      assert.equal(verifier.priorEligible(candidate, expected), false);
    });
  }
  await test('clock disagreement and impossible dates do not qualify', () => {
    const data = clone(prior.expected.united);
    data.fleet.membership.sourceTimestamp = currentStamp;
    assert.throws(() => verifier.sourceClock(data));
    data.fleet.membership.sourceTimestamp = priorStamp;
    data.measurementAsOf = '2026-01-01';
    assert.throws(() => verifier.sourceClock(data));
  });
  await test('equal and newer known snapshots are never propagation evidence', () => {
    assert.equal(verifier.priorEligible(current.expected, expected), false);
    assert.equal(verifier.priorEligible(snapshot('newer', newerStamp).expected, expected), false);
  });
  await test('corrupted prior bytes, count, membership and missing fingerprints reject', () => {
    assert.equal(verifier.priorEligible({ ...prior.expected, unitedBytes: Buffer.from('{}') }, expected), false);
    for (const key of ['commit', 'homeSha', 'ogSha', 'badgeSha']) {
      const bad = { ...prior.expected }; delete bad[key];
      assert.equal(verifier.priorEligible(bad, expected), false, key);
    }
    for (const mutate of [data => { data.fleet.equipped++; }, data => { data.fleet.membership.membershipSha256 = 'f'.repeat(64); }]) {
      const data = clone(prior.expected.united); mutate(data);
      assert.equal(verifier.priorEligible({ ...prior.expected, united: data,
        unitedBytes: Buffer.from(JSON.stringify(data)) }, expected), false);
    }
  });
  await test('prior reader rejects symbolic refs and nonexistent immutable commits', () => {
    assert.throws(() => verifier.readPriorExpected('HEAD', expected, ROOT));
    assert.throws(() => verifier.readPriorExpected('0'.repeat(40), expected, ROOT));
  });
  await test('prior reader fingerprints immutable Git bytes without running prior code', () => {
    const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const read = route => cp.execFileSync('git', ['show', commit + ':' + route], { cwd: ROOT });
    const retained = verifier.readPriorExpected(commit, { united: source }, ROOT);
    assert.equal(retained.commit, commit);
    assert.deepEqual(retained.unitedBytes, read('united/data.json'));
    assert.deepEqual(retained.united, JSON.parse(read('united/data.json')));
    assert.equal(retained.homeSha, hash(read('index.html')));
    assert.equal(retained.ogSha, hash(read('assets/og.png')));
    assert.equal(retained.badgeSha, hash(read('assets/united-starlink-badge.svg')));
  });
  await test('exact current artifacts pass', async () => { reset(); assert.deepEqual(await run(), []); });
  await test('known older same-day snapshot is retry-only', async () => { reset(prior); await retryOnly(); });
  await test('old JSON with current other bodies is retry-only', async () => {
    reset(); put('united/data.json', prior.bodies['united/data.json']); await retryOnly();
  });
  await test('current JSON with old image and homepage is retry-only', async () => {
    reset(); for (const route of ['index.html', 'assets/og.png']) put(route, prior.bodies[route]); await retryOnly();
  });
  await test('current JSON with known old API provenance is retry-only', async () => {
    reset(); put('api/airlines/united', prior.bodies['api/airlines/united']); await retryOnly();
  });
  await test('old content without independent prior proof hard-fails', async () => {
    reset(prior); await hardFailure(current.expected);
  });
  for (const route of ['index.html', 'assets/og.png', 'assets/united-starlink-badge.svg']) {
    await test('unknown ' + route + ' is not hidden by old JSON', async () => {
      reset(prior); put(route, Buffer.from('unrelated-corrupt-body')); await hardFailure();
    });
  }
  await test('unknown same-clock JSON is not a known previous artifact', async () => {
    reset(prior); const data = clone(prior.expected.united); data.unreviewed = true;
    put('united/data.json', JSON.stringify(data)); await hardFailure();
  });
  await test('newer same-day served JSON hard-fails', async () => {
    reset(); put('united/data.json', snapshot('newer', newerStamp).bodies['united/data.json']); await hardFailure();
  });
  await test('served malformed timestamps cannot hide as propagation', async () => {
    reset(prior); const data = clone(prior.expected.united);
    data.tracker.lastUpdated = data.fleet.membership.sourceTimestamp = '2026-02-30T10:00:00.000Z';
    put('united/data.json', JSON.stringify(data)); await hardFailure();
  });
  await test('wrong United count and membership hard-fail with otherwise old content', async () => {
    for (const mutate of [fleet => { fleet.equipped++; }, fleet => { fleet.membership.equippedSha256 = 'f'.repeat(64); }]) {
      reset(prior); const api = JSON.parse(prior.bodies['api/airlines/united']); mutate(api.airline.fleet);
      put('api/airlines/united', JSON.stringify(api)); await hardFailure();
    }
  });
  await test('wrong Alaska and Hawaiian counts cannot be hidden by known United lag', async () => {
    for (const route of ['api/airlines/alaska', 'api/airlines/hawaiian']) {
      reset(prior); const api = JSON.parse(prior.bodies[route]); api.airline.fleet.equipped = 2;
      put(route, JSON.stringify(api)); await hardFailure();
    }
  });
  for (const status of [401, 403]) {
    await test('HTTP ' + status + ' remains denial, never propagation', async () => {
      const originalFetch = global.fetch;
      global.fetch = async url => {
        const route = new URL(url).pathname;
        const rel = route === '/' ? 'index.html' : route.slice(1);
        const denied = route === '/united/data.json';
        return { ok: !denied, status: denied ? status : 200,
          arrayBuffer: async () => denied ? Buffer.from('denied') : prior.bodies[rel] };
      };
      try {
        const failures = await verifier.sample('https://fixture.invalid', null, expected, 1, true);
        assert(failures.length > 0); assert.equal(failures.denied, true);
        assert.notEqual(failures.propagationLag, true);
      } finally { global.fetch = originalFetch; }
    });
  }
  await test('eventual exact current response is required after lag', async () => {
    reset(prior); await retryOnly(); reset(); assert.deepEqual(await run(), []);
  });
  await test('raw verification evidence binds actual bodies, status, clocks and hashes', async () => {
    assert.equal(typeof verifier.evidenceDirectory, 'function');
    const evidence = verifier.evidenceDirectory(path.join(work, 'retained-evidence'));
    reset(prior);
    const failures = await verifier.sample('', work, expected, 1, true, evidence);
    assert.equal(failures.propagationLag, true);
    const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'sample-1.json')));
    assert.equal(receipt.routes.length, 7);
    assert(Number.isFinite(Date.parse(receipt.startedAt)));
    assert(Date.parse(receipt.observedAt) >= Date.parse(receipt.startedAt));
    for (const row of receipt.routes) {
      const rel = row.route === '/' ? 'index.html' : row.route.slice(1);
      const body = fs.readFileSync(path.join(evidence, row.file));
      assert.deepEqual(body, prior.bodies[rel]);
      assert.equal(row.status, 200);
      assert.equal(row.sha256, hash(body));
      assert(Number.isFinite(Date.parse(row.startedAt)));
      assert(Date.parse(row.observedAt) >= Date.parse(row.startedAt));
      assert.equal(fs.statSync(path.join(evidence, row.file)).mode & 0o777, 0o600);
    }
    assert.equal(fs.statSync(evidence).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(evidence, 'sample-1.json')).mode & 0o777, 0o600);
    const before = fs.readFileSync(path.join(evidence, 'sample-1.json'));
    await assert.rejects(() => verifier.sample('', work, expected, 1, true, evidence), /EEXIST/);
    assert.deepEqual(fs.readFileSync(path.join(evidence, 'sample-1.json')), before);
  });
  await test('evidence destinations cannot overwrite prior evidence or enter the public tree', () => {
    assert.throws(() => verifier.evidenceDirectory(work), /EEXIST/);
    const inside = path.join(ROOT, '.propagation-evidence-control');
    assert.equal(fs.existsSync(inside), false);
    assert.throws(() => verifier.evidenceDirectory(inside), /outside/);
    assert.equal(fs.existsSync(inside), false);
  });
  await test('actual confirmation loop retries only lag and stops on exact success', () => loopControl('eventual', 0, 3));
  await test('actual confirmation loop stops immediately for hard mismatch', () => loopControl('hard', 1, 1));
  await test('actual confirmation loop stops immediately for denial', () => loopControl('denied', 2, 1));
  await test('actual confirmation loop exhausts its fixed budget without success', () => loopControl('lag', 1, 30));
  assert.deepEqual(fs.readFileSync(sourceFile), originalSource, 'fixtures never change product data');
  console.log('deployment propagation controls: ' + passed + ' passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(work, { recursive: true, force: true }));
