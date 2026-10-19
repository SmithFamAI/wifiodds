'use strict';

// Evidence acquisition only. This module never runs the updater or ship path.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const UA = 'wifiodds-daily/1.0 (+https://wifiodds.com/)';
const SOURCES = Object.freeze([
  { name: 'tracker.json', url: 'https://unitedstarlinktracker.com/api/data' },
  { name: 'summary.json', url: 'https://unitedstarlinktracker.com/api/fleet-summary' },
  { name: 'registry.html', url: 'https://unitedstarlinktracker.com/fleet' },
  { name: 'faa', url: 'https://registry.faa.gov/aircraftinquiry/Search/NNumberResult?NNumberTxt=63571' }
]);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const iso = now => new Date(now()).toISOString();
const sorted = values => [...values].sort();
const tailBytes = values => sorted(values).join('\n') + '\n';
function save(out, name, bytes) {
  fs.writeFileSync(path.join(out, name), bytes, { flag: 'wx', mode: 0o600 });
}
function saveJson(out, name, value) { save(out, name, JSON.stringify(value, null, 2) + '\n'); }

function inspectSources(apiBytes, summaryBytes, registryBytes, now) {
  const api = JSON.parse(apiBytes), summary = JSON.parse(summaryBytes), html = registryBytes.toString('utf8');
  const sourceAt = Date.parse(api.lastUpdated), generatedAt = Date.parse(summary.generatedAt);
  assert(Number.isFinite(sourceAt) && sourceAt <= now && now - sourceAt <= 7200000, 'source clock is stale or invalid');
  assert(Number.isFinite(generatedAt) && generatedAt >= sourceAt && generatedAt <= now, 'summary clock is inconsistent');
  assert.deepEqual([...html.matchAll(/"dateModified"\s*:\s*"([^"]+)"/g)].map(m => m[1]), [api.lastUpdated], 'registry clock differs');
  const rows = [...html.matchAll(/<a\b[^>]*\bid="t-([A-Z0-9]+)"[^>]*>/g)].map(m => {
    const title = m[0].match(/\btitle="([^"]*)"/), cls = m[0].match(/\bclass="([^"]*)"/);
    assert(title && cls, 'registry member is malformed');
    const [type, tail, ...status] = title[1].split(' · ');
    assert.equal(tail, m[1], 'registry title and tail differ');
    const classes = cls[1].split(/\s+/);
    assert(type && type.length <= 80 && status.length >= 1 && status.every(s => s.length > 0), 'registry type or status is missing');
    assert(['tail-sl', 'tail-dim', 'tail-dim tail-pipe'].includes(cls[1]), 'registry state class is unknown');
    if (classes.includes('tail-sl')) {
      assert(status.length === 1 && ['Starlink', 'Starlink (listed, not yet verified)'].includes(status[0]), 'registry Starlink state is inconsistent');
    } else {
      assert(['No Wi-Fi', 'Not checked yet', 'Viasat', 'Panasonic', 'Thales'].includes(status[0]), 'registry non-Starlink state is unknown');
    }
    return { tail, type, status: status.join(' · '), classes };
  });
  assert(Array.isArray(api.starlinkPlanes) && api.fleetStats && Array.isArray(summary.airlines), 'source structure is malformed');
  const members = new Set(rows.map(row => row.tail));
  const planes = api.starlinkPlanes.map(row => row.TailNumber);
  assert(planes.every(tail => typeof tail === 'string' && /^[A-Z0-9]+$/.test(tail)), 'equipped tail is malformed');
  const equipped = new Set(planes);
  assert(rows.length > 0 && rows.length === members.size && equipped.size === planes.length, 'empty or duplicate membership');
  assert.deepEqual(sorted(equipped), sorted(rows.filter(row => row.classes.includes('tail-sl')).map(row => row.tail)), 'equipped sets differ');
  const airlines = summary.airlines.filter(row => row.code === 'UA');
  assert.equal(airlines.length, 1, 'UA summary is missing or duplicated');
  const ua = airlines[0], segments = ['mainline', 'express'].map(key => api.fleetStats[key]);
  for (const s of segments) assert(s && Number.isSafeInteger(s.total) && Number.isSafeInteger(s.starlink) && s.total >= s.starlink && s.starlink >= 0, 'segment counts are invalid');
  assert.equal(api.totalCount, members.size, 'API total differs from registry');
  assert.equal(ua.total, members.size, 'summary total differs from registry');
  assert.equal(ua.installed, equipped.size, 'summary equipped count differs');
  assert.equal(segments.reduce((n, s) => n + s.total, 0), members.size, 'segment totals differ');
  assert.equal(segments.reduce((n, s) => n + s.starlink, 0), equipped.size, 'segment equipped counts differ');
  return { sourceTimestamp: api.lastUpdated, summaryGeneratedAt: summary.generatedAt,
    raw: { total: members.size, equipped: equipped.size }, rows,
    members: sorted(members), equipped: sorted(equipped),
    rawMembershipSha256: sha(tailBytes(members)), equippedSha256: sha(tailBytes(equipped)),
    setHashEncoding: 'UTF-8 sorted tails, LF separated, one final LF',
    qualification: 'Acquisition evidence only; no exclusion, business-gate acceptance or release approval.' };
}

function inspectFaa(bytes) {
  const text = bytes.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  const assigned = [...text.matchAll(/\b(N[A-Z0-9]+) is (Assigned|Not Assigned)\b/gi)].map(m => [m[1].toUpperCase(), m[2].toLowerCase()]);
  assert.deepEqual(assigned, [['N63571', 'assigned']], 'FAA assigned record does not uniquely identify N63571');
  const sections = [...text.matchAll(/Aircraft Description\s+([\s\S]*?)\s+Registered Owner/g)];
  assert.equal(sections.length, 1, 'FAA aircraft description is missing or ambiguous');
  const description = sections[0][1];
  const labels = {
    serial: ['Serial Number', 'Status'], registrationStatus: ['Status', 'Manufacturer Name'],
    manufacturer: ['Manufacturer Name', 'Certificate Issue Date'], model: ['Model', 'Expiration Date'],
    aircraftType: ['Type Aircraft', 'Type Engine'], pendingNumberChange: ['Pending Number Change', 'Dealer']
  };
  const fields = {};
  for (const [key, [start, end]] of Object.entries(labels)) {
    const matches = [...description.matchAll(new RegExp('(?:^| )' + start + ' (.*?) ' + end + '(?: |$)', 'g'))];
    assert(matches.length === 1 && matches[0][1].length > 0 && matches[0][1].length <= 100, 'FAA selected field is missing or ambiguous: ' + key);
    fields[key] = matches[0][1];
  }
  return { tail: 'N63571', ...fields, registrantNamesAndAddressesOmitted: true };
}

async function boundedBody(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    assert(size <= 8 * 1024 * 1024, 'response exceeded evidence size limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function acquire(out, { fetchImpl = fetch, now = Date.now, context = {} } = {}) {
  fs.mkdirSync(out, { mode: 0o700 }); // Refuse reuse; old evidence must never get a new clock.
  const manifest = { schemaVersion: 1, startedAt: iso(now), context, client: { userAgent: UA, node: process.version },
    responses: [], success: false, publicationAttempted: false };
  const bodies = {};
  try {
    for (const source of SOURCES) {
      const url = new URL(source.url);
      // Preserve the established workflow's documented client and tracker query convention.
      if (url.hostname === 'unitedstarlinktracker.com') url.searchParams.set('cb', crypto.randomBytes(8).toString('hex'));
      const record = { name: source.name, url: url.href, requestedAt: iso(now), method: 'GET' };
      manifest.responses.push(record);
      const response = await fetchImpl(url.href, { headers: { 'User-Agent': UA }, redirect: 'manual',
        credentials: 'omit', signal: AbortSignal.timeout(25000) });
      record.status = response.status;
      record.headers = Object.fromEntries(['date', 'content-type', 'cf-ray', 'cf-cache-status', 'cache-control', 'retry-after', 'etag', 'last-modified']
        .map(key => [key, response.headers.get(key)]).filter(([, value]) => value !== null));
      const bytes = await boundedBody(response);
      record.observedAt = iso(now); record.bytes = bytes.length; record.sha256 = sha(bytes);
      if (source.name !== 'faa') save(out, source.name, bytes);
      assert(response.status === 200, 'source returned HTTP ' + response.status + ': ' + source.name);
      if (source.name === 'faa') {
        // Public repository artifacts must not include registrant names/addresses or hidden form state.
        saveJson(out, 'faa-selected.json', { ...inspectFaa(bytes), url: source.url,
          observedAt: record.observedAt, responseSha256: record.sha256 });
        record.retention = 'Selected aircraft identity only; full response hashed in memory and discarded.';
      } else bodies[source.name] = bytes;
    }
    const membership = inspectSources(bodies['tracker.json'], bodies['summary.json'], bodies['registry.html'], now());
    saveJson(out, 'membership.json', membership);
    save(out, 'membership.txt', tailBytes(membership.members));
    save(out, 'equipped.txt', tailBytes(membership.equipped));
    manifest.success = true;
  } catch (error) {
    const last = manifest.responses.at(-1);
    if (last && !last.observedAt) last.failedAt = iso(now);
    // No response content, cookies or environment values enter the log.
    manifest.error = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Acquisition or parsing failed';
  } finally {
    manifest.completedAt = iso(now);
    manifest.files = Object.fromEntries(fs.readdirSync(out).map(name => {
      const bytes = fs.readFileSync(path.join(out, name)); return [name, { bytes: bytes.length, sha256: sha(bytes) }];
    }));
    saveJson(out, 'manifest.json', manifest);
  }
  return manifest;
}

module.exports = { acquire, inspectSources, inspectFaa, SOURCES, UA };
if (require.main === module) {
  (async () => {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CLI acquisition requires the existing Actions workflow');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'manual diagnostic dispatch required');
    assert.equal(process.env.GITHUB_REPOSITORY, 'SmithFamAI/wifiodds', 'unexpected repository');
    assert(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), 'runner temp directory required');
    const out = path.join(fs.realpathSync(process.env.RUNNER_TEMP), 'wifiodds-evidence');
    const repo = fs.realpathSync(path.join(__dirname, '..'));
    assert(!out.startsWith(repo + path.sep), 'evidence must remain outside the product checkout');
    const result = await acquire(out, { context: { repository: process.env.GITHUB_REPOSITORY,
      sourceSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT } });
    console.log(result.success ? 'Diagnostic evidence retained; no data publication attempted.' : 'Diagnostic acquisition failed; inspect retained manifest.');
    if (!result.success) process.exitCode = 1;
  })().catch(() => { console.error('Diagnostic preflight failed; no acquisition performed.'); process.exitCode = 1; });
}
