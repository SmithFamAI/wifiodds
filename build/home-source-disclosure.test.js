#!/usr/bin/env node
'use strict';

// Homepage figure-source disclosures must name exactly the source strings the
// API publishes in segments[].source. On 19 Oct 2026 recovery 39326591174 failed
// six apitest checks because the API qualified corrected-population sources and
// the renderer still printed raw segment.src. Baseline builds never exercise a
// membership correction, so this runs the corrected branch in memory. Nothing
// here builds, writes a product file, or reaches the network.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const DL = require(path.join(root, 'build/lib/data.js'));
const Render = require(path.join(root, 'build/lib/render.js'));
const A = require(path.join(root, 'assets/airlines.js'));

const PREFIX = 'WiFiOdds corrected tracker population; see fleet.membership disclosure. Raw source: ';
const kinds = ['nextgen', 'streaming', 'coverage'];
const ids = kinds.map(k => 'row-united-' + k + '-evidence').concat(kinds.map(k => 'card-united-' + k + '-evidence'));
function listed(home, id) {
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('id="' + safe + '"[\\s\\S]*?<p class="figure-source-list">([\\s\\S]*?)<\\/p>').exec(home);
  return m ? m[1] : null;
}
// Same derivation build/apitest.js applies to the API body.
function expected(a) {
  const seen = Object.create(null);
  return a.segments.map(s => s.source).filter(s => {
    const k = s && s.trim().toLowerCase();
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  }).map(s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])))
    .join('; ') || 'airline records';
}

let count = 0;
function test(name, fn) { return Promise.resolve(fn()).then(() => { count++; console.log('PASS ' + name); }); }

(async () => {
  global.fetch = () => { throw new Error('Network forbidden in source-disclosure controls'); };
  const score = await import(pathToFileURL(path.join(root, 'functions/_lib/score.mjs')).href);
  const api = await import(pathToFileURL(path.join(root, 'functions/_lib/api.mjs')).href);
  const before = JSON.stringify(A.WIFI_AIRLINES.united);
  const beforeScore = JSON.stringify(score.WIFI_AIRLINES.united);
  function setMembership(m) {
    A.WIFI_AIRLINES.united.membership = structuredClone(m);
    score.WIFI_AIRLINES.united.membership = structuredClone(m);
  }
  function compare() {
    const home = Render.home(DL.build());
    const want = expected(api.airlineJson('united'));
    return ids.map(id => ({ id, got: listed(home, id), want }));
  }
  try {
    await test('baseline: page sources equal API sources and stay unqualified', () => {
      const rows = compare();
      rows.forEach(r => assert.equal(r.got, r.want, r.id));
      rows.forEach(r => assert(!r.got.includes(PREFIX.trim()), r.id + ' must not be qualified without a correction'));
    });
    await test('empty exclusion list stays unqualified', () => {
      setMembership({ excludedTails: [] });
      compare().forEach(r => { assert.equal(r.got, r.want, r.id); assert(!r.got.includes('Raw source:'), r.id); });
    });
    await test('active correction: all six United disclosures equal the qualified API sources', () => {
      setMembership({ excludedTails: ['N63571'] });
      const rows = compare();
      rows.forEach(r => assert.equal(r.got, r.want, r.id));
      const raw = JSON.parse(before).segments.map(s => s.src);
      raw.forEach(src => assert(rows[0].got.includes(PREFIX + src.replace(/&/g, '&amp;')), 'qualified raw source present: ' + src));
    });
    await test('active correction qualifies once, never twice', () => {
      setMembership({ excludedTails: ['N63571'] });
      compare().forEach(r => assert(!r.got.includes(PREFIX + PREFIX), r.id));
      const occurrences = compare()[0].got.split('Raw source: ').length - 1;
      assert.equal(occurrences, new Set(JSON.parse(before).segments.map(s => s.src.trim().toLowerCase()).filter(Boolean)).size);
    });
    await test('correction does not qualify any other airline', () => {
      setMembership({ excludedTails: ['N63571'] });
      const home = Render.home(DL.build());
      Object.keys(A.WIFI_AIRLINES).filter(k => k !== 'united').forEach(k => {
        const got = listed(home, 'row-' + k + '-streaming-evidence');
        if (got !== null) assert(!got.includes('Raw source:'), k);
      });
    });
    await test('escaping and complete-source-set semantics hold under correction', () => {
      setMembership({ excludedTails: ['N63571'] });
      // Relabel one existing segment so counts and proof buckets are untouched.
      const segs = A.WIFI_AIRLINES.united.segments;
      const scoreSegs = score.WIFI_AIRLINES.united.segments;
      const last = segs.length - 1;
      const original = segs[last].src, originalScore = scoreSegs[last].src;
      const extra = 'fixture <a&b> "quoted" source';
      segs[last].src = extra;
      scoreSegs[last].src = extra;
      try {
        const rows = compare();
        rows.forEach(r => assert.equal(r.got, r.want, r.id));
        assert(rows[0].got.includes(PREFIX + 'fixture &lt;a&amp;b&gt; &quot;quoted&quot; source'));
      } finally {
        segs[last].src = original;
        scoreSegs[last].src = originalScore;
      }
    });
    await test('instrument control: an unqualified page is rejected under correction', () => {
      setMembership({ excludedTails: ['N63571'] });
      const home = Render.home(DL.build());
      const want = expected(api.airlineJson('united'));
      const unqualified = want.split(PREFIX).join('');
      const bad = home.split(want).join(unqualified);
      assert.notEqual(bad, home);
      ids.forEach(id => assert.notEqual(listed(bad, id), want, id));
    });
  } finally {
    Object.keys(A.WIFI_AIRLINES.united).forEach(k => delete A.WIFI_AIRLINES.united[k]);
    Object.assign(A.WIFI_AIRLINES.united, JSON.parse(before));
    Object.keys(score.WIFI_AIRLINES.united).forEach(k => delete score.WIFI_AIRLINES.united[k]);
    Object.assign(score.WIFI_AIRLINES.united, JSON.parse(beforeScore));
  }
  console.log(count + ' source-disclosure controls passed');
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
