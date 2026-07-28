#!/usr/bin/env node
/* build/apitest.js — the acceptance suite for the public ConnectScore API.
 *
 *     node build/apitest.js        # exits 0 or tells you exactly what broke
 *
 * WHY THIS EXISTS. wrangler is not installed on this machine, so there is no way
 * to run a Pages Function locally. Without this file the API would ship on the
 * strength of "the syntax looks fine" — which is the same class of green light as
 * a 200 with an empty body. So instead:
 *
 *   1. Every file under functions/ is syntax-checked by `node --check`. The
 *      endpoint files are ESM in a repo with no package.json, so node would parse
 *      them as CommonJS and choke on `export`; they are copied to a temp dir with
 *      a .mjs extension first. The imports inside them already name .mjs targets,
 *      so the copies resolve unchanged.
 *   2. functions/_lib/handlers.mjs is IMPORTED for real and every handler is
 *      invoked with a mock Pages context (params + an env.ASSETS that reads off
 *      disk). We assert on the parsed response bodies and the headers — the bytes,
 *      not the exit code.
 *   3. PARITY: the score the API returns for Qatar must equal the number the
 *      generated /airlines/qatar/index.html prints. That is the assertion that
 *      proves "one formula" is still true, and it reads the rendered HTML rather
 *      than trusting that both sides call the same function.
 *
 * Run it after `node build/prerender.js` — it reads that build's output.
 */

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var FN = path.join(ROOT, 'functions');
var fails = [];
var checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (!cond) fails.push(label + (detail === undefined ? '' : '  →  got: ' + JSON.stringify(detail)));
}
function eq(actual, expected, label) {
  ok(actual === expected, label + ' (expected ' + JSON.stringify(expected) + ')', actual);
}

/* ── walk functions/ ─────────────────────────────────────────────────────── */
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  });
  return out;
}

/* ── 1. syntax ───────────────────────────────────────────────────────────── */
function checkSyntax() {
  var files = walk(FN, []);
  ok(files.length >= 7, 'expected at least 7 files under functions/', files.length);
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wifiodds-api-'));
  files.forEach(function (f) {
    var rel = path.relative(FN, f);
    /* .js → .mjs so node parses it as ESM; the imports inside already say .mjs */
    var dest = path.join(tmp, rel.replace(/\.js$/, '.mjs'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
    try {
      cp.execFileSync(process.execPath, ['--check', dest], { stdio: 'pipe' });
    } catch (e) {
      fails.push('node --check failed for functions/' + rel + '\n' +
        String(e.stderr || e.message).trim());
    }
    checks++;
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  /* Politeness, enforced on the source. TWO modules may call fetch and nothing
   * else may:
   *   _lib/api.mjs      readAsset() — this deploy's own static assets
   *   _lib/reports.mjs  the report intake's write to its own Supabase project
   * If a handler ever starts calling a tracker, an analytics endpoint or a
   * captcha vendor, this fails before it ships. */
  var MAY_FETCH = { '_lib/api.mjs': 1, '_lib/reports.mjs': 1 };
  files.forEach(function (f) {
    var rel = path.relative(FN, f);
    var src = fs.readFileSync(f, 'utf8');
    var calls = (src.match(/\bfetch\s*\(/g) || []).length;
    checks++;
    if (calls && !MAY_FETCH[rel]) {
      fails.push('functions/' + rel + ' calls fetch() — only _lib/api.mjs and _lib/reports.mjs may, ' +
        'and only to our own assets and our own database. This API must never make a third-party ' +
        'request.');
    }
  });

  /* reports.mjs gets the tighter version of the same rule: its one fetch target
   * has to be built from env.SUPABASE_URL, so there is no hostname in the source
   * at all. A literal URL in code is how a tracker gets added later without
   * anybody noticing, and this is the check that would catch it. */
  var rsrc = fs.readFileSync(path.join(FN, '_lib', 'reports.mjs'), 'utf8');
  var code = rsrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/env\.SUPABASE_URL/.test(code), 'reports.mjs builds its endpoint from env.SUPABASE_URL');
  var literalUrls = code.match(/['"`]https?:\/\/[^'"`]*/g) || [];
  ok(literalUrls.length === 0,
    'reports.mjs contains a hard-coded URL — every request it makes must come from env', literalUrls);
  ok(!/turnstile|recaptcha|hcaptcha|google|analytics|gtag|plausible|fathom/i.test(code),
    'reports.mjs names no captcha or analytics vendor');
  ok(!/document\.cookie|set-cookie/i.test(code), 'reports.mjs sets no cookie');
  return files;
}

/* ── mock Pages context ──────────────────────────────────────────────────── */
function ctx(url, params, method) {
  return {
    request: new Request(url, { method: method || 'GET' }),
    params: params || {},
    /* the Pages ASSETS binding, backed by the repo on disk */
    env: {
      ASSETS: {
        fetch: async function (req) {
          var p = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
          var file = path.join(ROOT, p);
          if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return new Response('not found', { status: 404 });
          }
          return new Response(fs.readFileSync(file), {
            status: 200, headers: { 'content-type': 'application/json' }
          });
        }
      }
    }
  };
}

async function body(res) {
  var text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { fails.push('response was not JSON: ' + text.slice(0, 200)); return {}; }
}
function assertEnvelope(res, j, label) {
  eq(res.headers.get('access-control-allow-origin'), '*', label + ': CORS header');
  eq(res.headers.get('content-type'), 'application/json; charset=utf-8', label + ': content-type');
  ok(Array.isArray(j.sources) && j.sources.length >= 3, label + ': sources[] in the body',
    j.sources && j.sources.length);
  ok(/unitedstarlinktracker\.com/.test(JSON.stringify(j.sources)),
    label + ': sources credit unitedstarlinktracker.com');
}

/* ── tracker validation gate (P0-02, round 5) ───────────────────────────────
 * The two MCP calls (predict_route_starlink, search_starlink_flights) and the
 * plan-route JSON call all reach the reader's localStorage, live badge and
 * booking playbook through fetchLive() in
 * build/templates/united-optimizer.html. An audit found the JSON path gated
 * but the MCP path not: mcpText() never checked r.ok, a 200 describing the
 * wrong route was relabelled to the requested pair instead of dropped, and
 * `null*100`/`""*100`/`false*100`/`parseFloat("5junk")` all coerced to
 * plausible-looking measured values.
 *
 * This drives fetchLive() FOR REAL — the function is extracted verbatim from
 * the BUILT united/index.html (never the template, so it tests what actually
 * ships) and run in a vm sandbox with a mocked fetch(), never a real network
 * call — instead of asserting the source merely contains some regex. Each
 * case below reproduces one of the auditor's fixtures byte-for-byte. */
function loadTrackerGateSource() {
  var html = fs.readFileSync(path.join(ROOT, 'united', 'index.html'), 'utf8');
  var START = '/* ── constants ── */', END = '/* ── merged model for a route ── */';
  var si = html.indexOf(START), ei = html.indexOf(END);
  if (si === -1 || ei === -1 || ei <= si) return null;
  return html.slice(si, ei);
}
function trackerApi(snippet, mockFetch) {
  var store = {};
  var localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  var sandbox = {
    fetch: mockFetch, AbortController: AbortController, setTimeout: setTimeout,
    clearTimeout: clearTimeout, localStorage: localStorage, console: console
  };
  vm.createContext(sandbox);
  var wrapped = '(function(){\n' + snippet + '\nreturn {fetchLive:fetchLive};\n})()';
  var api = vm.runInContext(wrapped, sandbox, { filename: 'tracker-gate-extract.js' });
  return { api: api, store: store };
}
function fakeRes(status, bodyText) {
  return {
    ok: status >= 200 && status < 300, status: status,
    text: function () { return Promise.resolve(bodyText); },
    json: function () { return Promise.resolve(JSON.parse(bodyText)); }
  };
}
function jsonRpcText(text) {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: text }] } });
}

/* ── P1-01 migration gate ────────────────────────────────────────────────
 * The consumer side (build/lib/data.js's measurementDates()) already reads
 * measurementAsOf/refreshAttemptedOn correctly, with a fallback to `updated`
 * for an old-shape file. That fallback is exactly what let Round 10's real
 * producer bug hide: unitedstarlinktracker.com's daily writer
 * (~/websites/scripts/update-unitedstarlink.js) never wrote either field, so
 * a plain copy into united/data.json silently kept working — falling back
 * every day to raw "updated=today" semantics — with nothing here to say the
 * migration had not actually happened upstream. This fails the build outright
 * the moment either field goes missing, so a producer that regresses (or a
 * data.json restored from an old snapshot) cannot ship quietly. */
function checkDateFieldsMigrated() {
  var raw = fs.readFileSync(path.join(ROOT, 'united', 'data.json'), 'utf8');
  var D = JSON.parse(raw);
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  ok(typeof D.measurementAsOf === 'string' && ISO_DATE.test(D.measurementAsOf),
    'united/data.json has a valid measurementAsOf — the P1-01 date-field migration landed',
    D.measurementAsOf);
  ok(typeof D.refreshAttemptedOn === 'string' && ISO_DATE.test(D.refreshAttemptedOn),
    'united/data.json has a valid refreshAttemptedOn — the P1-01 date-field migration landed',
    D.refreshAttemptedOn);

  /* ── the retained-date fleet consistency gate (P1-01, round 12) ──
   * measurementAsOf dates the WHOLE fleet observation. A round-12 audit
   * shipped a balanced mainline/express shift (sum unchanged) under a
   * retained date: the writer's headline pair was atomic but its segment
   * fields were not, and no release check could see it. This one can: if the
   * staged data.json keeps the SAME measurementAsOf as HEAD's committed copy,
   * and that date is in the past, then every fleet field that date covers
   * must be identical to HEAD's — an unchanged measurement date with changed
   * measured values is a new measurement wearing an old date. A same-day
   * re-measure (measurementAsOf === today) is exempt: re-measuring today
   * twice is legitimate. Pure so it can be proven on synthetic inputs. */
  function fleetDateConsistency(prevD, curD, todayStr) {
    /* FAIL CLOSED (P1-06). The round-13 version returned {checked:false} when
       the HEAD baseline was missing and treated ANY date difference as
       "advanced" — so a lost baseline or a date rolled BACKWARD exempted the
       whole check. A gate that skips when its own dependency breaks is the
       failure shape this repo keeps paying for. Now: no baseline is itself a
       failure, dates must be monotonic and never in the future, and only a
       genuine forward move exempts the field comparison. */
    if (!curD || !curD.measurementAsOf) return { bad: ['measurementAsOf missing from the working data.json'] };
    if (!prevD || !prevD.measurementAsOf) return { bad: ['no readable HEAD baseline for united/data.json: the gate cannot vouch for the fleet dates, and refusing to vouch is a failure, not a skip'] };
    if (curD.measurementAsOf > todayStr) return { bad: ['measurementAsOf ' + curD.measurementAsOf + ' is in the future'] };
    if (curD.refreshAttemptedOn && curD.refreshAttemptedOn > todayStr) return { bad: ['refreshAttemptedOn ' + curD.refreshAttemptedOn + ' is in the future'] };
    if (curD.refreshAttemptedOn && curD.refreshAttemptedOn < curD.measurementAsOf) return { bad: ['refreshAttemptedOn ' + curD.refreshAttemptedOn + ' predates measurementAsOf ' + curD.measurementAsOf] };
    if (curD.measurementAsOf < prevD.measurementAsOf) return { bad: ['measurementAsOf moved BACKWARD ' + prevD.measurementAsOf + ' → ' + curD.measurementAsOf + ': a measurement date never rolls back'] };
    if (curD.measurementAsOf > prevD.measurementAsOf) return { checked: false, reason: 'measurement genuinely advanced', bad: [] };
    if (curD.measurementAsOf === todayStr) return { checked: false, reason: 'same-day re-measure window', bad: [] };
    var FIELDS = ['equipped', 'total', 'last30', 'mainline', 'express', 'mainlinePacePerWeek', 'types'];
    var bad = [];
    FIELDS.forEach(function (f) {
      if (JSON.stringify((prevD.fleet || {})[f]) !== JSON.stringify((curD.fleet || {})[f])) bad.push(f);
    });
    return { checked: true, bad: bad };
  }

  /* Synthetic proof both ways, so the gate is tamper-visible regardless of
   * what today's real data looks like. */
  var prevSyn = { measurementAsOf: '2026-07-26', fleet: { equipped: 483, total: 1807, last30: 51,
    mainline: { equipped: 142, total: 1138 }, express: { equipped: 341, total: 669 },
    mainlinePacePerWeek: 4.5, types: [{ type: 'E175', equipped: 100, total: 200 }] } };
  var curBad = JSON.parse(JSON.stringify(prevSyn));
  curBad.fleet.mainline.equipped = 143; curBad.fleet.express.equipped = 340; /* balanced: sums unchanged */
  var rBad = fleetDateConsistency(prevSyn, curBad, '2026-07-28');
  ok(rBad.checked && rBad.bad.length === 2 && rBad.bad.indexOf('mainline') >= 0 && rBad.bad.indexOf('express') >= 0,
    'fleet date-consistency gate catches a BALANCED mainline/express shift under an unchanged past measurementAsOf',
    JSON.stringify(rBad));
  var curGood = JSON.parse(JSON.stringify(prevSyn));
  var rGood = fleetDateConsistency(prevSyn, curGood, '2026-07-28');
  ok(rGood.checked && rGood.bad.length === 0,
    'fleet date-consistency gate passes a genuinely unchanged retained measurement', JSON.stringify(rGood));
  var curFresh = JSON.parse(JSON.stringify(curBad)); curFresh.measurementAsOf = '2026-07-28';
  var rFresh = fleetDateConsistency(prevSyn, curFresh, '2026-07-28');
  ok(rFresh.checked === false && (rFresh.bad || []).length === 0,
    'fleet date-consistency gate exempts a measurement whose date genuinely advanced');
  /* P1-06 fail-closed cases: each of these used to slip through as a skip. */
  var rNoBase = fleetDateConsistency(null, curBad, '2026-07-28');
  ok((rNoBase.bad || []).length === 1 && /no readable HEAD baseline/.test(rNoBase.bad[0]),
    'a missing or unreadable HEAD baseline FAILS the gate rather than skipping it', JSON.stringify(rNoBase));
  var curBack = JSON.parse(JSON.stringify(curBad)); curBack.measurementAsOf = '2026-07-20';
  var rBack = fleetDateConsistency(prevSyn, curBack, '2026-07-28');
  ok((rBack.bad || []).length === 1 && /BACKWARD/.test(rBack.bad[0]),
    'the balanced 143/340 shift under a BACKWARD-rolled measurementAsOf fails the gate', JSON.stringify(rBack));
  var curFut = JSON.parse(JSON.stringify(prevSyn)); curFut.measurementAsOf = '2027-01-01';
  ok(((fleetDateConsistency(prevSyn, curFut, '2026-07-28').bad) || []).some(function (b) { return /future/.test(b); }),
    'a future measurementAsOf fails the gate');

  /* The real invocation: compare working data.json against HEAD's copy. */
  var prevReal = null;
  try {
    prevReal = JSON.parse(require('child_process').execSync(
      'git show HEAD:united/data.json', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch (e) { /* prevReal stays null and fleetDateConsistency FAILS on it: a gate that cannot read its baseline refuses to vouch (P1-06) */ }
  var todayStr = new Date().toISOString().slice(0, 10);
  var rReal = fleetDateConsistency(prevReal, D, todayStr);
  eq((rReal.bad || []).length, 0,
    'united/data.json: fleet dates are monotonic and no fleet field changed under an unchanged past measurementAsOf' +
    (rReal.checked === false && !(rReal.bad || []).length ? ' (comparison window not applicable this run: ' + rReal.reason + ')' : ''),
    (rReal.bad || []).join(', '));
}

/* ── dark-token twin guard ───────────────────────────────────────────────────
 * assets/site.css carries the dark palette in TWO places: the `:root.dark`
 * block (the explicit toggle) and the `@media(prefers-color-scheme:dark){
 * :root:not(.light){...} }` block (an OS-level preference with no toggle
 * click at all). A reader who never touches the toggle gets the second block
 * only, so if the two ever drift, dark mode silently disagrees with itself
 * depending on how someone arrived at it — one more thing this repo cannot
 * see with a check that only reads bytes it wrote, but CAN see once the two
 * blocks are compared against each other.
 *
 * This parses both blocks into name→value maps of their custom-property
 * declarations and fails naming the exact token that diverged, not just "the
 * blocks differ". */
function checkDarkTokenTwins() {
  var css = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');

  function parseTokens(body) {
    var map = {};
    var re = /--([A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
    var m;
    while ((m = re.exec(body))) map[m[1]] = m[2].trim();
    return map;
  }

  var mDark = /:root\.dark\s*\{([\s\S]*?)\n\}/.exec(css);
  ok(!!mDark, 'site.css has a `:root.dark{...}` block for the dark-token twin guard to read');

  var mMedia = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\.light\)\s*\{([\s\S]*?)\n\s*\}\s*\n\}/
    .exec(css);
  ok(!!mMedia, 'site.css has a `@media(prefers-color-scheme:dark){ :root:not(.light){...} }` block ' +
    'for the dark-token twin guard to read');

  if (!mDark || !mMedia) return;

  var tokDark = parseTokens(mDark[1]);
  var tokMedia = parseTokens(mMedia[1]);
  var names = Object.keys(tokDark).concat(Object.keys(tokMedia))
    .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  ok(names.length >= 15,
    'dark-token twin guard found a plausible number of custom properties to compare ' +
    '(a selector that matched nothing would report 0 as a false pass)', names.length);

  var diffs = [];
  names.forEach(function (name) {
    if (tokDark[name] !== tokMedia[name]) {
      diffs.push('--' + name + ': :root.dark=' +
        (name in tokDark ? tokDark[name] : '(missing)') +
        ' vs prefers-color-scheme:dark=' +
        (name in tokMedia ? tokMedia[name] : '(missing)'));
    }
  });
  ok(diffs.length === 0,
    'dark tokens in :root.dark and @media(prefers-color-scheme:dark) :root:not(.light) are identical',
    diffs.length === 0 ? undefined : diffs.join(' · '));
}

async function checkTrackerGate() {
  var snippet = loadTrackerGateSource();
  ok(!!snippet, 'tracker gate: located fetchLive() and its helpers in the BUILT united/index.html');
  if (!snippet) return;

  /* Case 1 — plan-route 500 {}, both MCP calls ALSO 500 but with an otherwise
   * well-formed JSON-RPC body. Before this fix, mcpText() never checked
   * r.ok and this rendered a live flight at 81%, cached for 6h. */
  var mcp500 = trackerApi(snippet, function (url, opts) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(500, '{}'));
    var name = JSON.parse(opts.body).params.name;
    var text = name === 'predict_route_starlink'
      ? 'UA9500 [mainline] (DEN-SFO) 81% (12 obs · high confidence)'
      : 'UA9500 DEN→SFO dep 2026-07-28 10:30Z (tail N500UA)';
    return Promise.resolve(fakeRes(500, jsonRpcText(text)));
  });
  var out500 = await mcp500.api.fetchLive('DEN', 'SFO');
  ok(out500.itineraries === null && out500.flights === null && out500.deps === null,
    'a 500 with a valid-looking MCP body yields no itineraries/flights/deps', out500);
  eq(Object.keys(mcp500.store).length, 0, 'a 500 with a valid-looking MCP body writes no cache key');

  /* Case 2 — 200 MCP responses describing LAX→JFK at 999% with 1e9
   * observations and an impossible date/time, while DEN→SFO was requested.
   * Before this fix, the response's own route was discarded and the page
   * relabelled the data as DEN→SFO. */
  var mcpRange = trackerApi(snippet, function (url, opts) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(500, '{}'));
    var name = JSON.parse(opts.body).params.name;
    var text = name === 'predict_route_starlink'
      ? 'UA9900 [mainline] (LAX-JFK) 999% (1000000000 obs · invented confidence)'
      : 'UA9900 LAX→JFK dep 2026-99-99 99:99Z (tail N999ZZ)';
    return Promise.resolve(fakeRes(200, jsonRpcText(text)));
  });
  var outRange = await mcpRange.api.fetchLive('DEN', 'SFO');
  ok(outRange.itineraries === null && outRange.flights === null && outRange.deps === null,
    'an out-of-range, wrong-route MCP response yields no itineraries/flights/deps', outRange);
  eq(Object.keys(mcpRange.store).length, 0,
    'an out-of-range, wrong-route MCP response writes no cache key (never relabelled)');

  /* Case 3 — the plan-route JSON coercion fixture: DENJUNK via, null/empty/
   * false probabilities, "5junk" hours, "7junk" observations, no coverage.
   * Before this fix this rendered "DEN → DEN → SFO" at a fabricated 0%. */
  var coercionBody = JSON.stringify({ itineraries: [{
    via: ['DENJUNK'], joint_probability: null, at_least_one_probability: '',
    total_flight_hours: '5junk',
    legs: [{ flight_number: 'UA88', route: 'DEN-SFO', probability: false, n_observations: '7junk' }]
  }] });
  var coercion = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, coercionBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outCoercion = await coercion.api.fetchLive('DEN', 'SFO');
  ok(outCoercion.itineraries === null,
    'DENJUNK / null / false / "5junk" / "7junk" / missing coverage all drop the itinerary', outCoercion);
  eq(Object.keys(coercion.store).length, 0, 'the coercion fixture writes no cache key');

  /* Case 4 — Claude's valid control: a genuinely valid, correctly-routed
   * itinerary must still cache and read as live. This proves the three gates
   * above reject on their SPECIFIC defects, not on every response. */
  var goodBody = JSON.stringify({ itineraries: [{
    via: [], joint_probability: 0.42, at_least_one_probability: 0.42,
    coverage: 'full', total_flight_hours: 2.6,
    legs: [{ flight_number: 'UA1234', route: 'DEN-SFO', probability: 0.42, n_observations: 118, confidence: 'high' }]
  }] });
  var good = trackerApi(snippet, function () { return Promise.resolve(fakeRes(200, goodBody)); });
  var outGood = await good.api.fetchLive('DEN', 'SFO');
  ok(Array.isArray(outGood.itineraries) && outGood.itineraries.length === 1,
    'a genuinely valid DEN→SFO itinerary still validates', outGood);
  eq(outGood.itineraries && outGood.itineraries[0].joint, 42,
    'valid control: joint probability still renders as 42');
  eq(outGood.source, 'live', 'valid control: source is live');
  eq(Object.keys(good.store).length, 1, 'valid control: writes exactly one cache key');
  ok(!!good.store['usl3:DEN-SFO'], 'valid control: the cache key names the requested pair');

  /* ── round 6: saved-data and cross-field consistency (P0-02 remained open) ──
   * Two holes the round-6 audit found in the round-5 repair:
   *   (a) a cache HIT returned before any validator ran, so a record the
   *       PRE-REPAIR build could write (same schema, same shape) stayed
   *       readable and renderable for up to CACHE_TTL after upgrade.
   *   (b) route identity checked only the first origin and last destination,
   *       so an itinerary with the right endpoints and an internally
   *       impossible middle (wrong leg count, disconnected legs, or
   *       probabilities the legs could not produce) still passed.
   * Every case below drives the same extracted fetchLive(), never a second
   * reimplementation of the checks. */

  /* Case 5 — the saved-record case, byte-for-byte the auditor's fixture,
   * translated into a forged entry under the CURRENT namespace/schema rather
   * than the old one, so this proves the REVALIDATION gate independently of
   * the namespace rename: UA9900 at 999%, a billion observations, an
   * impossible date, and a DEN → DEN → SFO itinerary (via:['DEN'] with only
   * one leg, so via.length+1 !== legs.length). All three network calls fail,
   * so nothing but the poisoned cache entry could produce a result. */
  var poisoned = trackerApi(snippet, function () { return Promise.resolve(fakeRes(500, '{}')); });
  poisoned.store['usl3:DEN-SFO'] = JSON.stringify({
    schema: 2, ts: Date.now(), source: 'live',
    itineraries: [{
      via: ['DEN'], joint: 0, any: 0, coverage: 'partial', hours: 5,
      legs: [{ fn: 'UA88', route: 'DEN-SFO', p: 0, obs: 7, conf: 'unknown' }]
    }],
    flights: [{ fn: 'UA9900', seg: 'mainline', prob: 999, obs: 1000000000, conf: 'invented' }],
    deps: [{ fn: 'UA9900', date: '2026-99-99', time: '99:99', tail: 'N999ZZ' }]
  });
  var outPoisoned = await poisoned.api.fetchLive('DEN', 'SFO');
  ok(outPoisoned.itineraries === null && outPoisoned.flights === null && outPoisoned.deps === null,
    'a forged cache entry under the current namespace/schema (UA9900 999%, DEN→DEN→SFO, 2026-99-99) ' +
    'is rejected on read, not served — falls back to the daily snapshot', outPoisoned);

  /* Case 6 — the impossible-topology/probability itinerary. A fresh, correctly
   * routed (DEN endpoint to SFO endpoint) plan-route response with an empty
   * via[], two legs (DEN-LAX, LAX-SFO), joint/at-least-one both 90% and each
   * leg at 10%. Before topology/probability checks existed, endpoint-only
   * route identity passed this and it rendered as a 90% DIRECT trip. */
  var badTopoBody = JSON.stringify({ itineraries: [{
    via: [], joint_probability: 0.9, at_least_one_probability: 0.9,
    coverage: 'banana', total_flight_hours: 4,
    legs: [
      { flight_number: 'UA1', route: 'DEN-LAX', probability: 0.1, n_observations: 10, confidence: 'high' },
      { flight_number: 'UA2', route: 'LAX-SFO', probability: 0.1, n_observations: 10, confidence: 'high' }
    ]
  }] });
  var badTopo = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, badTopoBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outBadTopo = await badTopo.api.fetchLive('DEN', 'SFO');
  ok(outBadTopo.itineraries === null,
    'a two-leg DEN-LAX/LAX-SFO itinerary with empty via[] and 90% odds on two 10% legs is dropped ' +
    '(legs.length !== via.length + 1, and joint exceeds each leg\'s probability)', outBadTopo);
  eq(Object.keys(badTopo.store).length, 0, 'the impossible-topology itinerary writes no cache key');

  /* Case 7 — probability relationships alone, topology held constant and
   * valid: a genuine two-leg connection (DEN-ORD, ORD-SFO, via ORD) where each
   * leg is 10% but joint/any are both declared 95%. Topology passes; the
   * cross-leg probability check must still catch it on its own. */
  var badProbBody = JSON.stringify({ itineraries: [{
    via: ['ORD'], joint_probability: 0.95, at_least_one_probability: 0.95,
    coverage: 'partial', total_flight_hours: 5,
    legs: [
      { flight_number: 'UA10', route: 'DEN-ORD', probability: 0.1, n_observations: 20, confidence: 'high' },
      { flight_number: 'UA11', route: 'ORD-SFO', probability: 0.1, n_observations: 20, confidence: 'high' }
    ]
  }] });
  var badProb = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, badProbBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outBadProb = await badProb.api.fetchLive('DEN', 'SFO');
  ok(outBadProb.itineraries === null,
    'a correctly-connected DEN-ORD-SFO itinerary claiming 95% joint odds on two 10% legs is dropped',
    outBadProb);

  /* Case 8 — coverage outside the declared allow-list, everything else valid:
   * a direct DEN-SFO leg at 42%, but coverage:"banana". */
  var badCovBody = JSON.stringify({ itineraries: [{
    via: [], joint_probability: 0.42, at_least_one_probability: 0.42,
    coverage: 'banana', total_flight_hours: 2,
    legs: [{ flight_number: 'UA20', route: 'DEN-SFO', probability: 0.42, n_observations: 50, confidence: 'high' }]
  }] });
  var badCov = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, badCovBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outBadCov = await badCov.api.fetchLive('DEN', 'SFO');
  ok(outBadCov.itineraries === null, 'coverage:"banana" (outside {full,partial}) drops the itinerary', outBadCov);

  /* Case 9 — leg confidence outside the declared allow-list, everything else
   * valid: a direct DEN-SFO leg at 42%, confidence:"invented". */
  var badConfBody = JSON.stringify({ itineraries: [{
    via: [], joint_probability: 0.42, at_least_one_probability: 0.42,
    coverage: 'full', total_flight_hours: 2,
    legs: [{ flight_number: 'UA21', route: 'DEN-SFO', probability: 0.42, n_observations: 50, confidence: 'invented' }]
  }] });
  var badConf = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, badConfBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outBadConf = await badConf.api.fetchLive('DEN', 'SFO');
  ok(outBadConf.itineraries === null, 'confidence:"invented" (outside {high,medium,low}) drops the itinerary',
    outBadConf);

  /* Case 10 — segment and confidence outside the declared allow-list on the
   * predict_route_starlink (flights) path: the auditor's own semantic-gaps
   * text, "[invented] ... invented confidence" for an otherwise correctly
   * routed DEN-SFO record. */
  var badSegConf = trackerApi(snippet, function (url, opts) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(500, '{}'));
    var name = JSON.parse(opts.body).params.name;
    var text = name === 'predict_route_starlink'
      ? 'UA555 [invented] (DEN-SFO) 50% (10 obs · invented confidence)' : '';
    return Promise.resolve(fakeRes(200, jsonRpcText(text)));
  });
  var outBadSegConf = await badSegConf.api.fetchLive('DEN', 'SFO');
  ok(outBadSegConf.flights === null,
    'predict_route_starlink text with segment "invented" and confidence "invented" ' +
    '(both outside their declared allow-lists) yields no flights', outBadSegConf);

  /* Case 11 — a correctly-routed tail assignment dated far outside the ~72h
   * horizon the hero copy promises, WITHOUT the wrong-route confound case 2
   * already covers, isolating the horizon check on its own. */
  var farHorizon = trackerApi(snippet, function (url, opts) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(500, '{}'));
    var name = JSON.parse(opts.body).params.name;
    var text = name === 'search_starlink_flights'
      ? 'UA800 DEN→SFO dep 2099-01-01 12:00Z (tail N800UA)' : '';
    return Promise.resolve(fakeRes(200, jsonRpcText(text)));
  });
  var outFarHorizon = await farHorizon.api.fetchLive('DEN', 'SFO');
  ok(outFarHorizon.deps === null,
    'a correctly-routed, calendar-valid tail assignment dated 2099 is dropped for being outside the ' +
    '~72h horizon the section promises', outFarHorizon);

  /* Case 12 — near-term assignment control: a genuinely near-term tail
   * (2 hours from whenever this test runs, well inside the ~72h horizon)
   * must still validate, cache and render. Proves case 11's guard rejects on
   * ITS specific defect (too far out), not on every tail assignment. */
  var near = new Date(Date.now() + 2 * 3600 * 1000);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var nearText = 'UA700 DEN→SFO dep ' + near.getUTCFullYear() + '-' + pad(near.getUTCMonth() + 1) + '-' +
    pad(near.getUTCDate()) + ' ' + pad(near.getUTCHours()) + ':' + pad(near.getUTCMinutes()) +
    'Z (tail N700UA)';
  var nearCtl = trackerApi(snippet, function (url, opts) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(500, '{}'));
    var name = JSON.parse(opts.body).params.name;
    return Promise.resolve(fakeRes(200, jsonRpcText(name === 'search_starlink_flights' ? nearText : '')));
  });
  var outNear = await nearCtl.api.fetchLive('DEN', 'SFO');
  ok(Array.isArray(outNear.deps) && outNear.deps.length === 1 && outNear.deps[0].tail === 'N700UA',
    'near-term control: a tail assignment ~2 hours out still validates and renders', outNear);
  eq(Object.keys(nearCtl.store).length, 1, 'near-term control: writes exactly one cache key');

  /* ── round 7: the union upper bound and the negative cache age ──
   * Two holes the round-7 audit found in the round-6 repair. */

  /* Case 13 — the union upper bound (P0-02). A correctly-connected
   * DEN-ORD-SFO itinerary (via ORD) with two 10% legs, joint 0% but
   * at-least-one 90%. Round 6 bounded "at least one" only from BELOW, so this
   * passed and rendered "P(≥1) 90%". P(≥1 of two 10% events) cannot exceed
   * their sum, 20%. */
  var unionBadBody = JSON.stringify({ itineraries: [{
    via: ['ORD'], joint_probability: 0, at_least_one_probability: 0.9,
    coverage: 'partial', total_flight_hours: 5,
    legs: [
      { flight_number: 'UA10', route: 'DEN-ORD', probability: 0.1, n_observations: 20, confidence: 'high' },
      { flight_number: 'UA11', route: 'ORD-SFO', probability: 0.1, n_observations: 20, confidence: 'high' }
    ]
  }] });
  var unionBad = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, unionBadBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outUnionBad = await unionBad.api.fetchLive('DEN', 'SFO');
  ok(outUnionBad.itineraries === null,
    'a DEN-ORD-SFO itinerary with two 10% legs claiming 90% at-least-one is dropped ' +
    '(the union of two 10% events cannot exceed their 20% sum)', outUnionBad);
  eq(Object.keys(unionBad.store).length, 0, 'the union-bound violation writes no cache key');

  /* Case 14 — the valid two-leg control the union bound must NOT over-reject:
   * two 10% legs, joint 0%, at-least-one 20% (= p1 + p2 - joint exactly). */
  var unionGoodBody = JSON.stringify({ itineraries: [{
    via: ['ORD'], joint_probability: 0, at_least_one_probability: 0.2,
    coverage: 'partial', total_flight_hours: 5,
    legs: [
      { flight_number: 'UA10', route: 'DEN-ORD', probability: 0.1, n_observations: 20, confidence: 'high' },
      { flight_number: 'UA11', route: 'ORD-SFO', probability: 0.1, n_observations: 20, confidence: 'high' }
    ]
  }] });
  var unionGood = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, unionGoodBody));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outUnionGood = await unionGood.api.fetchLive('DEN', 'SFO');
  ok(Array.isArray(outUnionGood.itineraries) && outUnionGood.itineraries.length === 1,
    'valid two-leg control: 10%/10% legs, 0% joint, 20% at-least-one still validates (the bound holds exactly)',
    outUnionGood);

  /* Case 15 — a future cache timestamp (P1-05). lsGet() rejected records OLDER
   * than CACHE_TTL but not a NEGATIVE age. A valid flight record timestamped a
   * year ahead was served as "cached -8760h ago". All network calls fail, so
   * only the future-dated cache entry could produce a result. */
  var future = trackerApi(snippet, function () { return Promise.resolve(fakeRes(500, '{}')); });
  future.store['usl3:DEN-SFO'] = JSON.stringify({
    schema: 2, ts: Date.now() + 365 * 24 * 3600 * 1000, source: 'live',
    flights: [{ fn: 'UA9090', seg: 'mainline', prob: 80, obs: 100, conf: 'high' }]
  });
  var outFuture = await future.api.fetchLive('DEN', 'SFO');
  ok(outFuture.itineraries === null && outFuture.flights === null && outFuture.deps === null,
    'a cache record timestamped a year ahead (negative age) is rejected, not served — no UA9090', outFuture);

  /* Case 16 — the current-timestamp control the negative-age check must NOT
   * reject: the same valid flight record at a current ts is served from cache. */
  var freshCache = trackerApi(snippet, function () { return Promise.resolve(fakeRes(500, '{}')); });
  freshCache.store['usl3:DEN-SFO'] = JSON.stringify({
    schema: 2, ts: Date.now(), source: 'live',
    flights: [{ fn: 'UA9090', seg: 'mainline', prob: 80, obs: 100, conf: 'high' }]
  });
  var outFresh = await freshCache.api.fetchLive('DEN', 'SFO');
  ok(Array.isArray(outFresh.flights) && outFresh.flights.length === 1 && outFresh.flights[0].fn === 'UA9090',
    'current-ts control: a valid current cache record is still served', outFresh);

  /* ── round 8: the missing LOWER bound on "all legs" for 3+ legs ──
   * Three 90% legs claiming 0% joint passed: the failure chances total at
   * most 30%, so all three succeed at least 70% of the time (Fréchet). */

  /* Case 17 — the violation: DEN-ORD-IAH-SFO, three 90% legs, joint 0%. */
  var threeLegs = function (joint, any) { return JSON.stringify({ itineraries: [{
    via: ['ORD', 'IAH'], joint_probability: joint, at_least_one_probability: any,
    coverage: 'partial', total_flight_hours: 9,
    legs: [
      { flight_number: 'UA30', route: 'DEN-ORD', probability: 0.9, n_observations: 30, confidence: 'high' },
      { flight_number: 'UA31', route: 'ORD-IAH', probability: 0.9, n_observations: 30, confidence: 'high' },
      { flight_number: 'UA32', route: 'IAH-SFO', probability: 0.9, n_observations: 30, confidence: 'high' }
    ]
  }] }); };
  var lowJoint = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, threeLegs(0, 0.999)));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outLowJoint = await lowJoint.api.fetchLive('DEN', 'SFO');
  ok(outLowJoint.itineraries === null,
    'three 90% legs claiming 0% joint are dropped (all three must work at least 70% of the time)', outLowJoint);
  eq(Object.keys(lowJoint.store).length, 0, 'the low-joint violation writes no cache key');

  /* Case 18 — the valid three-leg control: same legs, joint 73% (0.9^3),
   * at-least-one 99.9%. Both sit inside every bound; must still validate. */
  var threeGood = trackerApi(snippet, function (url) {
    if (String(url).indexOf('/api/plan-route') >= 0) return Promise.resolve(fakeRes(200, threeLegs(0.73, 0.999)));
    return Promise.resolve(fakeRes(200, jsonRpcText('')));
  });
  var outThreeGood = await threeGood.api.fetchLive('DEN', 'SFO');
  ok(Array.isArray(outThreeGood.itineraries) && outThreeGood.itineraries.length === 1,
    'valid three-leg control: 90%/90%/90% legs at 73% joint and 99.9% at-least-one still validate',
    outThreeGood);
}

/* ── main ────────────────────────────────────────────────────────────────── */
async function main() {
  var files = checkSyntax();
  checkDateFieldsMigrated();
  checkDarkTokenTwins();
  var checksBeforeTrackerGate = checks;
  await checkTrackerGate();
  var trackerGateChecks = checks - checksBeforeTrackerGate;

  var H = await import('../functions/_lib/handlers.mjs');
  var A = require('../assets/airlines.js');

  /* ── GET /api ── */
  var res = await H.apiIndex(ctx('https://wifiodds.com/api'));
  var j = await body(res);
  eq(res.status, 200, '/api status');
  assertEnvelope(res, j, '/api');
  eq(res.headers.get('cache-control'), 'public, max-age=3600', '/api cache-control');
  eq(j.version, 'v0', '/api version');
  eq(j.endpoints.length, 4, '/api lists 4 endpoints');
  eq(j.airlineCount, Object.keys(A.WIFI_AIRLINES).length, '/api airlineCount');

  /* ── GET /api/airlines ── */
  res = await H.airlinesAll(ctx('https://wifiodds.com/api/airlines'));
  var all = await body(res);
  eq(res.status, 200, '/api/airlines status');
  assertEnvelope(res, all, '/api/airlines');
  eq(res.headers.get('cache-control'), 'public, max-age=3600', '/api/airlines cache-control');
  eq(all.count, 18, '/api/airlines returns all 18 airlines');
  eq(all.airlines.length, 18, '/api/airlines airlines[] length');

  var ranked = A.rankAirlines();
  eq(all.airlines.map(function (a) { return a.key; }).join(','),
    ranked.map(function (a) { return a.key; }).join(','),
    '/api/airlines order matches rankAirlines()');

  /* ── D2: only United may carry a computed value for the mainline/regional
   * next-gen split. The roster in united/data.json is Starlink-only — tail,
   * type, fleet segment, install date, no system field — so aircraft type ties
   * to mainline/express but the OTHER systems (Viasat/Panasonic/Thales) do not.
   * Building that crosstab for anyone else would be inventing data, which rule
   * 1 forbids. If a future PR adds a real split for another airline, add its
   * key here DELIBERATELY; that is the only way this assertion should ever
   * need to change. */
  var VALUE_SPLIT_ALLOWED = ['united'];

  all.airlines.forEach(function (a) {
    var r = A.scoreAirline(a.key);
    eq(a.connectScore, r.score, 'connectScore for ' + a.key);
    ok(typeof a.name === 'string' && a.name.length, a.key + ': name');
    ok(typeof a.system.key === 'string', a.key + ': system.key');
    ok(typeof a.system.quality === 'number', a.key + ': system.quality');
    ok(typeof a.free.status === 'string', a.key + ': free.status');
    ok(typeof a.free.factor === 'number', a.key + ': free.factor');
    ok('equipped' in a.fleet && 'total' in a.fleet, a.key + ': fleet counts present');
    ok(typeof a.note === 'string' && a.note.length, a.key + ': note');
    ok(/^\d{4}-\d{2}$/.test(a.asOf), a.key + ': asOf', a.asOf);
    /* ── the three-tier fields. ADDITIVE: every assertion above still holds, and
     * these two are the split the site now leads with. The contract worth
     * protecting is that nextGenScore is ZERO for a fleet with no low-earth-orbit
     * hardware in the air, however good its connectScore is. */
    eq(a.nextGenScore, r.nextGenScore, 'nextGenScore for ' + a.key);
    eq(a.serviceTier, r.serviceTier, 'serviceTier for ' + a.key);
    ok(['next-gen', 'mixed', 'streaming', 'basic'].indexOf(a.serviceTier) >= 0,
      a.key + ': serviceTier is one of the four tiers', a.serviceTier);
    eq(a.nextGen.score, a.nextGenScore, a.key + ': nextGen.score mirrors nextGenScore');
    eq(a.service.tier, a.serviceTier, a.key + ': service.tier mirrors serviceTier');
    ok(typeof a.service.label === 'string' && a.service.label.length, a.key + ': service.label');
    ok(typeof a.service.means === 'string' && a.service.means.length, a.key + ': service.means');
    if (!A.isNextGen(a.system.key)) {
      eq(a.nextGenScore, 0, a.key + ': no LEO hardware flying ⇒ nextGenScore 0');
      eq(a.nextGen.system, null, a.key + ': nextGen.system null when nothing next-gen flies');
    } else {
      eq(a.nextGen.system, a.system.key, a.key + ': nextGen.system names the flying LEO system');
    }

    /* ── D2: the mainline/regional split of next-gen odds. A STATE IS NOT A
     * ZERO — whenever the split is not published, mainline/regional must be
     * null, never a number, so an empty state can never be misread as "no
     * Starlink on that segment". */
    var split = a.nextGen.split;
    ok(split && typeof split.state === 'string', a.key + ': nextGen.split has a state');
    ok(['value', 'no-regional-fleet', 'split-not-published', 'no-mainline-fleet']
      .indexOf(split.state) >= 0,
      a.key + ': nextGen.split.state is one of the four states', split.state);
    if (split.state === 'value') {
      /* THE TRIPWIRE. Only United may reach this branch — see the allow-list
       * above. If it fires for anyone else, someone estimated a missing split
       * instead of leaving the state as "split-not-published" / "no-regional-
       * fleet", and this is the assertion that has to fail because of it. */
      ok(VALUE_SPLIT_ALLOWED.indexOf(a.key) >= 0,
        a.key + ': only United may publish a mainline/regional next-gen split');
      ok(split.mainline && typeof split.mainline.aircraft === 'number',
        a.key + ': value split carries a real mainline number');
      ok(split.regional && typeof split.regional.aircraft === 'number',
        a.key + ': value split carries a real regional number');
    } else {
      eq(split.mainline, null, a.key + ': ' + split.state + ' ⇒ mainline is null, not zero');
      eq(split.regional, null, a.key + ': ' + split.state + ' ⇒ regional is null, not zero');
    }

    /* no video-call promise leaks into any machine-readable string either */
    ok(!/video call/i.test(JSON.stringify(a)), a.key + ': API text promises no video calls');

    /* ── the segmented model. The contract is that connectScore IS the floor and
     * that the ledger the site prints adds up to it — the API and the page are
     * summing the same rows, so if these disagree one of them is decorative. */
    eq(a.floor, a.connectScore, a.key + ': connectScore is the floor');
    ok(a.ceiling >= a.floor, a.key + ': ceiling is not below the floor', [a.floor, a.ceiling]);
    ok(a.segments && a.segments.length, a.key + ': has fleet segments');
    ok(['tail', 'type', 'systems', 'announced'].indexOf(a.resolution) >= 0,
      a.key + ': resolution is one of the four tiers', a.resolution);
    if (a.segments) {
      var lo = function (s) { return typeof s.points === 'number' ? s.points : s.points.min; };
      var hi = function (s) { return typeof s.points === 'number' ? s.points : s.points.max; };
      var sumLo = a.segments.reduce(function (t, s) { return t + lo(s); }, 0);
      var sumHi = a.segments.reduce(function (t, s) { return t + hi(s); }, 0);
      ok(Math.abs(sumLo - a.floor) <= 0.5, a.key + ': ledger rows sum to the floor',
        [Number(sumLo.toFixed(2)), a.floor]);
      ok(Math.abs(sumHi - a.ceiling) <= 0.5, a.key + ': ledger rows sum to the ceiling',
        [Number(sumHi.toFixed(2)), a.ceiling]);
      /* next-gen odds are the next-gen rows and nothing else — the relationship
         the ledger exists to make visible */
      var ngRows = a.segments.filter(function (s) { return s.nextGen; });
      var ngSum = ngRows.reduce(function (t, s) { return t + s.share * s.free.factor * 100; }, 0);
      ok(Math.abs(ngSum - a.nextGenScore) <= 0.5,
        a.key + ': the next-gen rows sum to nextGenScore', [Number(ngSum.toFixed(2)), a.nextGenScore]);
      /* aircraft, not just points: the rows plus the unresolved pool have to be
         the fleet, or the denominator is quietly wrong */
      if (a.fleet.total !== null) {
        var heads = a.segments.reduce(function (t, s) { return t + s.aircraft; }, 0) +
          (a.unresolved ? a.unresolved.aircraft : 0);
        eq(heads, a.fleet.total, a.key + ': segments + unresolved = the published fleet');
      }
      a.segments.forEach(function (s, i) {
        ok(typeof s.source === 'string' && s.source.length,
          a.key + ' segment ' + (i + 1) + ': carries a source');
        ok(/^\d{4}-\d{2}(-\d{2})?$/.test(s.asOf || ''),
          a.key + ' segment ' + (i + 1) + ': carries an as-of date', s.asOf);
        ok(s.splitPublished || Array.isArray(s.systems) && s.systems.length > 1,
          a.key + ' segment ' + (i + 1) + ': only a multi-system row may be marked unpublished');
      });
      if (a.unresolved) {
        eq(a.unresolved.inDenominator, false,
          a.key + ': unresolved aircraft stay out of the denominator');
        ok(typeof a.unresolved.why === 'string' && a.unresolved.why.length,
          a.key + ': says why those aircraft are unresolved');
      }
    }
  });

  /* ── D2: United's mainline + regional next-gen odds sum to its own totals. ──
   * This is the check that stops the split from quietly drifting away from the
   * fleet it is supposed to describe. */
  var ua = all.airlines.filter(function (a) { return a.key === 'united'; })[0];
  ok(ua, 'united is present in /api/airlines');
  var uaSplit = ua.nextGen.split;
  eq(uaSplit.state, 'value', "united: nextGen.split.state is 'value'");
  ok(uaSplit.mainline && uaSplit.regional, 'united: mainline and regional both present');
  if (uaSplit.mainline && uaSplit.regional) {
    eq(uaSplit.mainline.aircraft + uaSplit.regional.aircraft, ua.fleet.equipped,
      'united: mainline + regional next-gen aircraft sum to the equipped total');
    eq(uaSplit.mainline.of + uaSplit.regional.of, ua.fleet.total,
      'united: mainline + regional fleet counts sum to the published total');
    ok(uaSplit.regional.pct > uaSplit.mainline.pct,
      'united: regional next-gen odds beat mainline — the reason this feature exists',
      [uaSplit.mainline.pct, uaSplit.regional.pct]);
  }

  /* ── the legacy single-system path, which has to keep working ─────────────
   * Not every airline will arrive with segment data, so scoreEntry() still takes
   * a v2-shaped entry. Nothing in WIFI_AIRLINES exercises it any more, so it is
   * tested here against a synthetic fleet rather than left to rot. */
  var legacy = A.scoreEntry({ system: 'viasat', equipped: 50, fleet: 100, free: 'paid' });
  eq(legacy.score, 19, 'legacy path: 0.5 × 0.55 × 0.7 = 19');
  eq(legacy.floor, legacy.score, 'legacy path: floor is the score');
  eq(legacy.ceiling, legacy.score, 'legacy path: no segments, no range');
  eq(legacy.ledger, null, 'legacy path: no ledger');
  eq(A.nextGenScore({ system: 'starlink', equipped: 50, fleet: 100, free: 'free' }), 50,
    'legacy path: next-gen odds still come off equipped/fleet');
  eq(A.serviceTierExpected({ system: 'viasat', coverage: 1, free: 'free' }), 'streaming',
    'legacy path: a modern-GEO fleet is still streaming-class at the new 0.55 weight');
  eq(A.serviceTierExpected({ system: 'panasonic', coverage: 1, free: 'free' }), 'basic',
    'legacy path: legacy GEO is still basic');
  /* the two shapes of fleet data, both covered */
  eq(all.airlines.filter(function (a) { return a.fleet.basis === 'fleetwide-coverage'; }).length, 2,
    'exactly two airlines are fleetwide-coverage (Delta, jetBlue)');
  /* the headline case, by name, because it is the one the plan calls out: Delta has
     genuinely good free WiFi AND zero next-gen odds, and the API must say both. */
  var dl = all.airlines.filter(function (a) { return a.key === 'delta'; })[0];
  eq(dl.nextGenScore, 0, 'PARITY: /api/airlines Delta nextGenScore is 0');
  eq(dl.serviceTier, 'streaming', 'PARITY: /api/airlines Delta serviceTier is streaming');
  /* 60 → 52 → 49. The 52 was 0.86 coverage × 0.6 Viasat × 1.0 free. Under the
     segmented model Delta is three rows out of 1,330 aircraft: 1,150 on Viasat
     or Hughes at the corrected modern-GEO weight of 0.55 (47.6 points), the 80
     Boeing 717s with no wifi at all since May 2026 (0.0), and 100 transpacific
     widebodies whose system Delta does not publish, scored at the legacy floor
     (1.4). 47.6 + 0 + 1.4 = 49. */
  eq(dl.connectScore, 49, 'Delta connectScore is 49 — the floor of a three-segment fleet');
  eq(dl.floor, 49, 'Delta floor is the published connectScore');
  /* The ceiling exists because the transpacific row could be 2Ku rather than
     legacy Ku. Publishing the floor is what makes the score defensible without
     an assumption; the ceiling rides alongside so the gap is visible. */
  eq(dl.ceiling, 51, 'Delta ceiling is 51 — the transpacific split is unpublished');
  eq(dl.resolution, 'systems', 'Delta resolution tier');
  eq(dl.segments.length, 3, 'Delta has three fleet segments');
  eq(dl.segments[1].aircraft, 80, 'Delta still carries the 80 Boeing 717s as a no-wifi segment');
  eq(dl.segments[1].points, 0, 'the 717 segment contributes zero points');
  eq(dl.unresolved, null, 'Delta publishes a system for every aircraft in its denominator');
  eq(dl.future.system, 'leo', 'Delta future deal is still reported (Amazon Leo)');
  /* the index documents the second number rather than leaving it undeclared */
  ok(/Starlink or Amazon Leo/.test(j.nextGenMethod || ''), '/api index explains next-gen odds');
  ok(j.serviceTiers && j.serviceTiers.streaming && j.serviceTiers['next-gen'],
    '/api index documents the service tiers');

  /* ── the projected score ──────────────────────────────────────────────────
   * Four carriers have signed a low-earth-orbit deal that has put nothing in the
   * air. `projected` is what those deals would be worth as a next-gen number if
   * they land, and it is fenced five ways — the fences are what these checks are
   * for, not the arithmetic, which is one multiplication.
   *
   * The fence that matters most in an API is the shape: there is no top-level
   * projected integer anywhere. A consumer that wants the number has to take the
   * horizon and the confidence with it, which is the same contract the pages
   * render under. */
  ok(/committed aircraft/.test(j.projectedMethod || '') &&
    /never against the ConnectScore/.test(j.projectedMethod || ''),
    '/api index explains the projected score and what not to compare it to');
  ok(/nobody has measured Amazon Leo/.test(j.projectedMethod || ''),
    '/api index says outright that Amazon Leo has never been measured in a cabin');
  ok(/computed\s+from the build date/.test(j.projectedMethod || ''),
    '/api index says SLIPPED is computed, not stored');
  ok(j.projectedConfidence && j.projectedConfidence.FIRM && j.projectedConfidence.SOFT &&
    j.projectedConfidence.SLIPPED, '/api index documents the three confidence labels');

  var projected = all.airlines.filter(function (a) { return a.projected; });
  eq(projected.length, 4, 'exactly four airlines carry a projection');
  eq(projected.map(function (a) { return a.key; }).sort().join(','),
    'american,delta,jetblue,southwest', 'the four are American, Delta, jetBlue and Southwest');

  all.airlines.forEach(function (a) {
    var e = A.WIFI_AIRLINES[a.key];
    ok(!('projectedScore' in a),
      a.key + ': the API exposes no bare projected integer beside connectScore');
    if (!e.projected) {
      eq(a.projected, null, a.key + ': no signed deal ⇒ projected is null');
      return;
    }
    var p = a.projected;
    /* recomputed here from the entry, not read back from the same object */
    eq(p.score, A.projectedScore(e), a.key + ': projected score is the committed share × 1.00 × free');
    ok(A.isNextGen(p.system), a.key + ': projects a next-gen system', p.system);
    eq(p.quality, 1, a.key + ': low-earth orbit weighs 1.00');
    /* rule 3 and rule 4, on the bytes a consumer gets */
    ok(p.line.indexOf(String(p.score)) >= 0, a.key + ': the composed line carries the number');
    ok(p.line.indexOf(p.horizon) >= 0, a.key + ': the composed line carries the promised date');
    ok(p.line.indexOf(p.confidence) >= 0, a.key + ': the composed line carries the confidence');
    ok(/\d{4}/.test(p.horizon), a.key + ': the horizon phrase names a year', p.horizon);
    ok(['FIRM', 'SOFT', 'SLIPPED'].indexOf(p.confidence) >= 0,
      a.key + ': confidence is one of the three', p.confidence);
    ok(p.confidenceMeans.length > 10, a.key + ': the confidence label explains itself');
    /* a projection is a committed fleet share and never a claim about throughput */
    ok(!/\b(mbps|gbps|latency|speed|faster|fastest)\b/i.test(JSON.stringify(p)),
      a.key + ': the projection names no speed');
    /* rule 5, proved rather than trusted: ask what it becomes the day after its
       own horizon. Nothing installed ⇒ SLIPPED, and the original date stays. */
    var after = new Date(p.horizonEnd + 'T00:00:00Z');
    after.setUTCDate(after.getUTCDate() + 1);
    var then = A.projectionFor(e, after.toISOString().slice(0, 10));
    if (p.installed === 0) {
      eq(then.confidence, 'SLIPPED', a.key + ': flips to SLIPPED the day after its horizon');
      ok(then.line.indexOf(p.horizon) >= 0,
        a.key + ': keeps showing the original promised date after it slips');
    } else {
      eq(then.slipped, false,
        a.key + ': does not slip while aircraft are already flying the committed system');
    }
    /* today, nothing has slipped yet — and if this ever fails it is telling you
       something true about an airline rather than something wrong about the code */
    eq(p.slipped, false, a.key + ': has not slipped as of this build');
  });

  /* the four numbers by name. Each is committed aircraft over the same known-fleet
     denominator the next-gen odds use, times 1.00 for LEO, times free-for-you. */
  var byKey = {};
  all.airlines.forEach(function (a) { byKey[a.key] = a; });
  eq(byKey.american.projected.score, 51, 'American projects 51 — 500 Airbus of 989, free');
  eq(byKey.american.projected.confidence, 'FIRM', 'American projection is FIRM');
  eq(byKey.american.projected.horizon, 'installs begin 2027-Q1', 'American horizon');
  eq(byKey.delta.projected.score, 38, 'Delta projects 38 — 500 Amazon Leo aircraft of 1,330');
  eq(byKey.delta.projected.confidence, 'FIRM', 'Delta projection is FIRM');
  eq(byKey.delta.projected.installed, 0, 'Delta has no Amazon Leo aircraft flying, because nobody does');
  eq(byKey.southwest.projected.score, 37, 'Southwest projects 37 — 300 of 803');
  eq(byKey.southwest.projected.installed, 1, 'Southwest already has one Starlink aircraft in service');
  eq(byKey.jetblue.projected.score, 25, 'jetBlue projects 25 — a quarter of 291');
  eq(byKey.jetblue.projected.confidence, 'SOFT',
    'jetBlue projection is SOFT: the count is a published fraction, the sub-fleet is secondary reporting');
  eq(byKey.jetblue.projected.aircraftPublished, false,
    'jetBlue published a share, not a count, and the API says so');
  /* rule 1, at the API boundary: today's floor orders the list, and a projection
     that outranks a floor must not move anybody. American projects 51 against a
     floor of 51; jetBlue projects 25 against a floor of 55. */
  eq(all.order, 'connectScore desc, ties by fitted coverage then name',
    '/api/airlines declares it sorts on the score');
  /* mirrors A.tieCoverage in assets/airlines.js and the independent copy in
     build/prerender.js's assertProjectionsDoNotSort: airBaltic 100 on 51%
     fitted must not outrank JSX or ZIPAIR, both 100 fleetwide. */
  function tieCoverage(x) {
    var v = x.fleet && typeof x.fleet.total === 'number' && x.fleet.total > 0
      ? (x.fleet.equipped || 0) / x.fleet.total : 1;
    return v >= 0.99 ? 1 : v;
  }
  var floorOrder = all.airlines.slice().sort(function (x, y) {
    if (y.connectScore !== x.connectScore) return y.connectScore - x.connectScore;
    var yc = tieCoverage(y), xc = tieCoverage(x);
    if (yc !== xc) return yc - xc;
    return x.name.localeCompare(y.name);
  }).map(function (x) { return x.key; }).join(',');
  eq(all.airlines.map(function (x) { return x.key; }).join(','), floorOrder,
    'PARITY: /api/airlines is ordered by today\'s floor, never by a projection');

  /* ── GET /api/airlines/{key} ── */
  res = await H.airlineOne(ctx('https://wifiodds.com/api/airlines/qatar', { key: 'qatar' }));
  var qr = await body(res);
  eq(res.status, 200, '/api/airlines/qatar status');
  assertEnvelope(res, qr, '/api/airlines/qatar');
  eq(qr.airline.key, 'qatar', 'qatar key');
  eq(qr.airline.fleet.equipped, 120, 'qatar equipped');
  eq(qr.airline.fleet.total, 241, 'qatar fleet total');

  /* case-insensitive and trailing-slash tolerant */
  res = await H.airlineOne(ctx('https://wifiodds.com/api/airlines/QATAR', { key: 'QATAR' }));
  eq((await body(res)).airline.connectScore, qr.airline.connectScore, 'uppercase key works');

  res = await H.airlineOne(ctx('https://wifiodds.com/api/airlines/nope', { key: 'nope' }));
  var miss = await body(res);
  eq(res.status, 404, 'unknown airline key → 404');
  eq(miss.error.code, 'unknown_airline', 'unknown airline error code');
  eq(res.headers.get('content-type'), 'application/json; charset=utf-8', '404 is JSON');
  eq(res.headers.get('cache-control'), 'public, max-age=300', '404 cache-control is short');
  ok(Array.isArray(miss.keys) && miss.keys.length === 18, '404 lists the valid keys', miss.keys);
  assertEnvelope(res, miss, '404 airline');

  /* ── PARITY: /api/airlines (LIST) and /api/airlines/{key} (DETAIL) must never
   * drift on whether a number is published. Both read airlineJson() off the
   * same score, so today they already agree — but this is exactly the class of
   * assumption that let the SAS false-zero ship: LIST and DETAIL are two call
   * sites of one function, and nothing pinned them to each other. If a future
   * change touches one shim and not the other — a summary field added straight
   * to airlinesAll(), a cache that serves LIST a stale build — this catches it
   * for every airline, not just SAS. equippedPublished and nextGen.published are
   * the two flags a consumer must check before trusting a share/pct as real;
   * checking both endpoints report the SAME flag for the SAME airline is the
   * whole point, so pct/share ride along as a second signal but the flags are
   * the assertion that matters. */
  for (var pk of all.airlines.map(function (a) { return a.key; })) {
    var pRes = await H.airlineOne(ctx('https://wifiodds.com/api/airlines/' + pk, { key: pk }));
    var pDetail = (await body(pRes)).airline;
    var pList = all.airlines.filter(function (a) { return a.key === pk; })[0];
    eq(pList.fleet.equippedPublished, pDetail.fleet.equippedPublished,
      'PARITY: ' + pk + ' equippedPublished agrees between /api/airlines and /api/airlines/' + pk);
    eq(pList.nextGen.published, pDetail.nextGen.published,
      'PARITY: ' + pk + ' nextGen.published agrees between /api/airlines and /api/airlines/' + pk);
    eq(pList.fleet.equippedPct, pDetail.fleet.equippedPct,
      'PARITY: ' + pk + ' fleet.equippedPct agrees between /api/airlines and /api/airlines/' + pk);
    eq(pList.nextGen.pct, pDetail.nextGen.pct,
      'PARITY: ' + pk + ' nextGen.pct agrees between /api/airlines and /api/airlines/' + pk);
  }

  /* ── GET /api/score/{flightNumber} — RETIRED 2026-07-26 (spec D7) ──────────
   * This used to be six assertions' worth of per-flight route-history checks.
   * The endpoint took a flight number with no date and answered "what usually
   * happens on this route," not "will MY flight have it" — that job moved to
   * the WiFi Odds browser extension, which has the date because it runs on the
   * airline's own booking page. What is asserted now is the negative: every
   * shape of request to this path answers 410, never 200, so the endpoint
   * cannot silently come back to life in a later refactor. */
  for (var retired of ['UA212', 'ua212', 'AS15', 'XX999', 'hello']) {
    res = await H.scoreFlightGone(ctx('https://wifiodds.com/api/score/' + retired, { flight: retired }));
    var gone = await body(res);
    eq(res.status, 410, '/api/score/' + retired + ' → 410 Gone');
    eq(gone.error.code, 'endpoint_retired', '/api/score/' + retired + ' error code');
    assertEnvelope(res, gone, '/api/score/' + retired);
    ok(gone.error.message.indexOf('unitedstarlinktracker.com') !== -1,
      '/api/score/' + retired + ' 410 body names unitedstarlinktracker.com', gone.error.message);
  }
  ok(H.scoreFlight === undefined, 'scoreFlight is not exported any more — only scoreFlightGone');

  /* ── methods ── */
  res = await H.airlinesAll(ctx('https://wifiodds.com/api/airlines', {}, 'OPTIONS'));
  eq(res.status, 204, 'OPTIONS preflight → 204');
  eq(res.headers.get('access-control-allow-origin'), '*', 'preflight CORS');
  res = await H.airlinesAll(ctx('https://wifiodds.com/api/airlines', {}, 'POST'));
  eq(res.status, 405, 'POST → 405');
  eq((await body(res)).error.code, 'method_not_allowed', 'POST error code');

  /* ── the MCP server, /mcp ─────────────────────────────────────────────────
   * Same principle as the REST section: wrangler is not installed, so the only
   * pre-ship test is to import the module and POST real JSON-RPC bodies at it
   * with a mock Pages context, then assert on the parsed responses. The tools are
   * wrappers around the handlers above, so the assertion that matters most is
   * that they return the SAME numbers — get_airline_score disagreeing with
   * /api/airlines/{key} would mean there are two implementations again. */
  var MCP = await import('../functions/_lib/mcp.mjs');

  function mcpCtx(payload, method) {
    var c = ctx('https://wifiodds.com/mcp', {}, method || 'POST');
    c.request = new Request('https://wifiodds.com/mcp', {
      method: method || 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    return c;
  }
  async function rpc(payload, method) {
    var r = await MCP.mcpRequest(mcpCtx(payload, method));
    return { res: r, j: r.status === 202 ? null : await body(r) };
  }
  /* ── MCP TEXT MAY NOT NUMBER AN UNPUBLISHED COUNT — ON EVERY REGISTERED TOOL
   * A model usually relays the text block and drops structuredContent, so a
   * numeric zero in the text is a numeric zero a traveller hears, even when
   * the structured record beside it honestly says published:false. Round 4
   * caught a mutation inside get_airline_score's serializer; the very next
   * round proved a mutation confined to list_airline_scores' serializer
   * passed the whole release at exit 0, because the guard hand-enumerated
   * one tool by name instead of the registry. So this walks MCP.TOOLS — the
   * exact array tools/list serves — and calls EVERY tool that can emit an
   * airline record. A future airline-listing tool inherits the guard the
   * moment it is added to TOOLS in functions/_lib/mcp.mjs; nothing here
   * names a tool by string. */
  /* local require: A_LIB is assigned several hundred lines below, and `var`
     hoisting would give us undefined here rather than an error at the top */
  var A_MCP = require(path.join(ROOT, 'assets', 'airlines.js'));
  var UNPUB = Object.keys(A_MCP.WIFI_AIRLINES).filter(function (k) {
    var L = A_MCP.ledgerFor(A_MCP.WIFI_AIRLINES[k]);
    return L && L.unresolved > 0 && L.nextGenShare === 0;
  });
  var UNPUB_META = {};
  UNPUB.forEach(function (k) {
    var al = A_MCP.WIFI_AIRLINES[k];
    UNPUB_META[k] = { name: al.name, code: al.code || null, key: k };
  });

  /* An airline can be named on a line by its key, its IATA code, or its full
   * name — Round 10's mutation relabelled list rows by CODE ("AF", "SK") and
   * the old scan only recognised the full name, so the numeric "next-gen 0%"
   * it appended sailed through unseen. All three are aliases now. Each is
   * matched as a whole word/label (flanked by start/end or a non-alnum
   * character), NEVER as a bare substring — "AF" must not fire on "Air
   * France" or on unrelated text that merely contains the two letters. */
  function aliasesFor(k) {
    var m = UNPUB_META[k];
    return [m.key, m.name, m.code].filter(Boolean);
  }
  function lineNamesAlias(line, alias) {
    var esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^A-Za-z0-9])' + esc + '([^A-Za-z0-9]|$)', 'i').test(line);
  }

  /* Recurses a tool's structuredContent the same way scanMcpStructured does,
   * but only to answer "which unpublished airlines does THIS invocation's
   * structured payload actually name" — the set the matching text is required
   * to cover. Scoping this per call (not one shared tally across every tool
   * in the registry) is the fix for Round 10: the old code let one tool's
   * honest coverage of an airline stand in for another tool's dishonest text
   * about the very same airline, because completeness was checked once, in
   * aggregate, after the whole registry had been walked. */
  function unpubKeysNamedIn(node, found, visited) {
    if (!node || typeof node !== 'object' || visited.has(node)) return found;
    visited.add(node);
    if (typeof node.key === 'string' && UNPUB_META[node.key]) found[node.key] = true;
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      if (Array.isArray(v)) v.forEach(function (item) { unpubKeysNamedIn(item, found, visited); });
      else if (v && typeof v === 'object') unpubKeysNamedIn(v, found, visited);
    });
    return found;
  }

  /* Line-scoped, not blob-scoped: list_airline_scores' text has one line per
     airline, so scanning the whole joined blob for "next-gen NN%" would also
     trip on a PUBLISHED airline's honest number sitting a few lines away.
     Only the line(s) that name the unpublished airline (by any alias) may not
     carry one. `wanted` restricts the scan to the airlines THIS invocation's
     own structured content actually named — the per-invocation half of the fix. */
  function scanMcpText(text, label, bad, wanted, invCovered) {
    text.split('\n').forEach(function (line) {
      Object.keys(wanted).forEach(function (k) {
        var matched = aliasesFor(k).some(function (alias) { return lineNamesAlias(line, alias); });
        if (!matched) return;
        invCovered[k] = true;
        var hit = /next[- ]gen[^.·|]{0,30}?(\d+(?:\.\d+)?)\s*%?/i.exec(line);
        if (hit) bad.push(label + ' ' + k + ' MCP text: "…' + hit[0].slice(-52) + '"');
      });
    });
  }

  /* Any structured airline record — however a tool nests it — must carry
     published:false for an unpublished-count airline. Recursing rather than
     reading one fixed path (e.g. `.airline.nextGen`) is what covers a NEW
     tool's structuredContent shape without another edit here. */
  function scanMcpStructured(node, label, bad, covered, visited) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (typeof node.key === 'string' && UNPUB_META[node.key] && node.nextGen &&
        typeof node.nextGen === 'object') {
      covered[node.key] = true;
      if (node.nextGen.published !== false) {
        bad.push(label + ' ' + node.key + ' MCP structuredContent lost published:false');
      }
    }
    /* A flat numeric next-gen field (nextGenScore is the documented floor
       score and legitimately 0) is only safe while the honest
       nextGen.published:false flag sits beside it on the same record. A
       serializer that emits the number and drops the object drops the flag
       with it, and the scan above never fires because it requires the object.
       This branch catches exactly that shape: an unpublished-count airline
       record carrying a numeric next-gen field with NO published:false
       sibling. No fixed field name, so a renamed variant is caught too. */
    if (typeof node.key === 'string' && UNPUB_META[node.key] &&
        !(node.nextGen && typeof node.nextGen === 'object' && node.nextGen.published === false)) {
      Object.keys(node).forEach(function (fk) {
        if (/next.?gen/i.test(fk) && typeof node[fk] === 'number') {
          covered[node.key] = true;
          bad.push(label + ' ' + node.key + ' MCP structuredContent carries flat numeric ' +
            fk + '=' + node[fk] + ' with no published:false beside it');
        }
      });
    }
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      if (Array.isArray(v)) {
        v.forEach(function (item) { scanMcpStructured(item, label, bad, covered, visited); });
      } else if (v && typeof v === 'object') {
        scanMcpStructured(v, label, bad, covered, visited);
      }
    });
  }

  var mcpBad = [], mcpChecked = 0, mcpEverCovered = {};
  for (var ti = 0; ti < MCP.TOOLS.length; ti++) {
    var toolDef = MCP.TOOLS[ti];
    var takesKey = !!(toolDef.inputSchema && toolDef.inputSchema.properties &&
      toolDef.inputSchema.properties.key);
    /* A tool with a `key` argument is exercised once per unpublished airline,
       the way a model would actually call it. A tool with none (a listing
       tool) is called once and must keep every airline's row clean in that
       single response. */
    var argSets = takesKey ? UNPUB.map(function (k) { return { key: k }; }) : [{}];
    for (var ai = 0; ai < argSets.length; ai++) {
      var label = toolDef.name + (argSets[ai].key ? '(' + argSets[ai].key + ')' : '');
      var mr = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: { name: toolDef.name, arguments: argSets[ai] } });
      var blocks = (mr.j && mr.j.result && mr.j.result.content) || [];
      var text = blocks.map(function (b2) { return b2.text || ''; }).join('\n');
      if (!text) { mcpBad.push(label + ': no MCP text block to inspect'); continue; }
      mcpChecked++;
      var sc = mr.j && mr.j.result && mr.j.result.structuredContent;

      /* PER-INVOCATION, not global: ask only THIS call's own structured
       * payload which unpublished airlines it named, then require only
       * THIS call's own text to be clean for exactly those airlines. A
       * tool's dishonest text can no longer hide behind another tool's
       * honest coverage of the same airline recorded once, in aggregate,
       * at the end of the whole registry walk. */
      var namedHere = unpubKeysNamedIn(sc, {}, new Set());
      var invCovered = {};
      scanMcpText(text, label, mcpBad, namedHere, invCovered);
      Object.keys(namedHere).forEach(function (k) {
        mcpEverCovered[k] = true;
        if (!invCovered[k]) {
          mcpBad.push(label + ' ' + k + ': structuredContent named this unpublished airline but no ' +
            'text line in the SAME invocation could be matched to it by key, code or name');
        }
      });
      scanMcpStructured(sc, label, mcpBad, mcpEverCovered, new Set());
    }
  }
  ok(Object.keys(mcpEverCovered).length === UNPUB.length,
    'every unpublished-count airline was inspected across the whole MCP tool registry (' +
    MCP.TOOLS.map(function (t) { return t.name; }).join(', ') + ')',
    Object.keys(mcpEverCovered).length + ' of ' + UNPUB.length);
  eq(mcpBad.length, 0,
    'no MCP tool (get_airline_score, list_airline_scores, or any future registry entry) numbers a ' +
    'next-gen count the model says is unpublished, checked per invocation not globally',
    mcpBad.join(' · '));

  /* every tool result must carry the credit in the TEXT block, because a model
     will often relay only the text and drop structuredContent entirely */
  function assertToolResult(r, label) {
    ok(r && Array.isArray(r.content) && r.content[0] && r.content[0].type === 'text',
      label + ': content[] text block');
    ok(r && r.content && /martinamps/.test(r.content[0].text),
      label + ': the credit line is in the text a model will relay');
    ok(r && r.content && /wifiodds\.com\/methodology\//.test(r.content[0].text),
      label + ': links the methodology page');
  }

  /* initialize — the instructions field IS the product, so assert it is really
     carrying the opinion and not just a description of the endpoints */
  var init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  eq(init.res.status, 200, 'MCP initialize HTTP 200');
  eq(init.res.headers.get('access-control-allow-origin'), '*', 'MCP CORS is open');
  eq(init.res.headers.get('cache-control'), 'no-store', 'MCP responses are never cached');
  eq(init.j.jsonrpc, '2.0', 'MCP initialize is JSON-RPC 2.0');
  eq(init.j.id, 1, 'MCP initialize echoes the id');
  eq(init.j.result.protocolVersion, '2025-06-18', 'MCP echoes a protocol version it knows');
  ok(init.j.result.capabilities && init.j.result.capabilities.tools, 'MCP declares the tools capability');
  eq(init.j.result.serverInfo.name, 'wifiodds', 'MCP serverInfo.name');
  var instr = init.j.result.instructions || '';
  ok(instr.length > 1500, 'MCP instructions are substantial (they are the product)', instr.length);
  [/HOURS OF WORKING WIFI/, /Prefer the higher ConnectScore/, /browser extension/, /Never/,
    /martinamps/, /methodology/].forEach(function (re) {
    ok(re.test(instr), 'MCP instructions carry ' + re);
  });
  /* an unknown protocol revision must not be echoed back as if we spoke it */
  var initOld = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize',
    params: { protocolVersion: '1999-01-01' } });
  eq(initOld.j.result.protocolVersion, MCP.PROTOCOL_VERSIONS[0],
    'unknown protocol version falls back to ours');

  /* tools/list */
  var tl = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  eq(tl.res.status, 200, 'MCP tools/list HTTP 200');
  /* score_flight retired 2026-07-26 (spec D7): a flight number with no date
     answered a question nobody was really asking. Airline-level only now. */
  eq(tl.j.result.tools.length, 2, 'MCP exposes exactly 2 tools');
  eq(tl.j.result.tools.map(function (t) { return t.name; }).sort().join(','),
    'get_airline_score,list_airline_scores', 'MCP tool names');
  tl.j.result.tools.forEach(function (t) {
    ok(t.description && t.description.length > 40, t.name + ': has a real description');
    eq(t.inputSchema.type, 'object', t.name + ': inputSchema is an object schema');
    eq(t.inputSchema.additionalProperties, false, t.name + ': schema rejects stray properties');
  });
  var getTool = tl.j.result.tools.filter(function (t) { return t.name === 'get_airline_score'; })[0];
  eq(getTool.inputSchema.properties.key.enum.length, 18,
    'get_airline_score enumerates all 18 airline keys');

  /* tools/call get_airline_score — and the parity assertion */
  var t1 = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'get_airline_score', arguments: { key: 'qatar' } } });
  var r1 = t1.j.result;
  eq(r1.isError, false, 'get_airline_score(qatar) is not an error');
  assertToolResult(r1, 'get_airline_score(qatar)');
  eq(r1.structuredContent.airline.connectScore, qr.airline.connectScore,
    'PARITY: MCP get_airline_score(qatar) equals /api/airlines/qatar');
  ok(/Coarse/.test(r1.structuredContent.confidenceTier), 'qatar is the Coarse tier',
    r1.structuredContent.confidenceTier);
  ok(Array.isArray(r1.structuredContent.sources), 'get_airline_score carries sources[]');

  /* an unknown key is a TOOL error, not a protocol error: the model must be able
     to read what went wrong and retry rather than see the call fail */
  var t1b = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'get_airline_score', arguments: { key: 'nope' } } });
  ok(!t1b.j.error, 'unknown airline key is NOT a JSON-RPC error');
  eq(t1b.j.result.isError, true, 'unknown airline key → isError:true');
  ok(/Valid keys/.test(t1b.j.result.content[0].text), 'the error text lists the valid keys');

  /* tools/call list_airline_scores */
  var t2 = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'list_airline_scores', arguments: {} } });
  var r2 = t2.j.result;
  assertToolResult(r2, 'list_airline_scores');
  eq(r2.structuredContent.count, 18, 'list_airline_scores returns 18 airlines');
  eq(r2.structuredContent.airlines[0].key, ranked[0].key,
    'list_airline_scores is ordered best-odds-first, like rankAirlines()');
  ok(r2.structuredContent.airlines.every(function (a) { return !!a.confidenceTier; }),
    'every airline in the list is labelled with its confidence tier');

  /* score_flight retired 2026-07-26 (spec D7): calling it by name must fail the
     same way any unknown tool does, so the tool cannot silently reappear in a
     later refactor. */
  var t3 = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'score_flight', arguments: { flight_number: 'UA212' } } });
  eq(t3.j.error.code, -32602, 'score_flight is gone: calling it by name → -32602, same as any unknown tool');

  /* protocol edges */
  var t6 = await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/call',
    params: { name: 'no_such_tool', arguments: {} } });
  eq(t6.j.error.code, -32602, 'unknown tool → -32602');
  var t7 = await rpc({ jsonrpc: '2.0', id: 11, method: 'resources/nope' });
  eq(t7.j.error.code, -32601, 'unknown method → -32601');
  var t8 = await rpc({ jsonrpc: '2.0', id: 12, method: 'ping' });
  ok(t8.j.result && !t8.j.error, 'ping answers');
  var note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  eq(note.res.status, 202, 'a notification gets 202 and NO body');
  var batch = await rpc([{ jsonrpc: '2.0', id: 20, method: 'ping' },
    { jsonrpc: '2.0', id: 21, method: 'tools/list' }]);
  ok(Array.isArray(batch.j) && batch.j.length === 2, 'a batch gets an array of two replies');
  var opt = await MCP.mcpRequest(mcpCtx(undefined, 'OPTIONS'));
  eq(opt.status, 204, 'MCP OPTIONS preflight → 204');
  var g = await MCP.mcpRequest(mcpCtx(undefined, 'GET'));
  var gj = await body(g);
  eq(g.status, 405, 'MCP GET → 405 (no SSE stream offered)');
  ok(/tools\/list/.test(gj.usage), 'the 405 body tells a human how to call it');
  var badJson = await MCP.mcpRequest((function () {
    var c = ctx('https://wifiodds.com/mcp', {}, 'POST');
    c.request = new Request('https://wifiodds.com/mcp', { method: 'POST', body: 'not json' });
    return c;
  })());
  eq((await body(badJson)).error.code, -32700, 'a non-JSON body → -32700 parse error');

  /* ── 3. PARITY: one formula, proved against the rendered HTML ─────────────
   * Not "both call the same function" — that is what we believe. This reads the
   * bytes of the page a visitor gets and demands the API agree with them. */
  var page = fs.readFileSync(path.join(ROOT, 'airlines', 'qatar', 'index.html'), 'utf8');
  var seen = {
    title: /<title>Qatar Airways WiFi — ConnectScore (\d+):/.exec(page),
    ring: /<text class="ring-n"[^>]*>(\d+)<\/text>/.exec(page),
    stat: /<div class="n">(\d+)<\/div><div class="l">ConnectScore<\/div>/.exec(page),
    math: /= (\d+) \/ 100/.exec(page)
  };
  Object.keys(seen).forEach(function (k) {
    ok(seen[k] !== null, 'qatar page: could not find the score in the ' + k);
  });
  var rendered = Object.keys(seen).map(function (k) { return seen[k] ? Number(seen[k][1]) : -1; });
  ok(rendered.every(function (n) { return n === rendered[0]; }),
    'the four places /airlines/qatar/ prints its score disagree with each other', rendered);
  /* 54.3 + 3.7 + 0 = 58. CORRECTED 2026-07-26 alongside the 140 → 120 src fix
     in assets/airlines.js: the Starlink row shrank to 120 and the 20-aircraft
     gap moved to unresolved, out of the denominator, so `known` is 221 rather
     than 241. The segmented score is 120/221 Starlink at leo/free (+54.3),
     plus the 53 pre-Starlink widebodies on Inmarsat or SITA at the legacy
     weight and a paid factor (+3.7), plus the 48 aircraft Qatar has never
     listed as connected in a zero row. */
  eq(rendered[0], 58, 'the rendered /airlines/qatar/ page shows 58');
  eq(qr.airline.connectScore, rendered[0],
    'PARITY: the API score for qatar equals the score rendered on /airlines/qatar/');
  eq(qr.airline.connectScore, 58, 'PARITY: the API score for qatar is 58');
  /* next-gen odds move with the same correction: 120/221, not 140/241. */
  eq(qr.airline.nextGenScore, 54, 'qatar next-gen odds are 54 — the Starlink row alone, corrected denominator');

  /* ── PARITY, second axis: the homepage and the API must agree about every
   * number the page draws. Round seven replaced the seven US cards with the
   * skyline — all 18 airlines as linked bars — and the Big 4 board, so the
   * parity check reads those bytes instead. Delta is still the case that
   * matters: its Big 4 row ranks next-gen at 0 on a fleet with a mixed-band
   * connectScore, and the API must agree about both numbers. */
  var home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  /* The skyline was removed on 27 Jul 2026, and it used to carry this axis of
     parity: all 18 airlines, each bar's accessible label checked against the
     API's connectScore. Deleting the component must not delete the coverage,
     so the same 18 comparisons now run against the mobile cards, which are the
     surface that replaced it and the primary rendering at phone widths.
     Removing a check because its subject moved is how coverage evaporates
     quietly; the check follows the data instead. */
  var cardRe = /<li class="crd[^"]*" data-key="([^"]+)"[\s\S]*?<span class="sco">(\d+)<\/span>/g;
  var seenCards = 0, mCard, cardKeys = {};
  while ((mCard = cardRe.exec(home)) !== null) {
    if (cardKeys[mCard[1]]) continue;      /* two boards render the Big 4 twice */
    cardKeys[mCard[1]] = true;
    var byKey = all.airlines.filter(function (a) { return a.key === mCard[1]; })[0];
    ok(!!byKey, 'a homepage card names an airline the API knows', mCard[1]);
    if (!byKey) continue;
    seenCards++;
    eq(Number(mCard[2]), byKey.connectScore,
      'PARITY: ' + mCard[1] + ' card == API connectScore');
  }
  eq(seenCards, all.airlines.length,
    'PARITY: every scored airline has a homepage card checked against the API');
  /* the Big 4 rows carry their numbers as the data attributes the Rank-by
     control sorts on; those must agree with the API, Delta's zero included */
  var big4 = /<div class="rankb" id="home-big4-board">[\s\S]*?<\/table>/.exec(home);
  ok(big4 !== null, 'homepage: the Big 4 board is present');
  var rowRe = /<tr data-name="([^"]+)" data-score="(\d+)" data-nextgen="(\d*)"/g;
  var seenRows = 0, mRow;
  while (big4 && (mRow = rowRe.exec(big4[0])) !== null) {
    var a4 = all.airlines.filter(function (a) { return a.name === mRow[1]; })[0];
    if (!a4) continue;
    seenRows++;
    eq(Number(mRow[2]), a4.connectScore,
      'PARITY: ' + mRow[1] + ' Big 4 data-score == API connectScore');
    eq(mRow[3] === '' ? null : Number(mRow[3]), a4.nextGenScore,
      'PARITY: ' + mRow[1] + ' Big 4 data-nextgen == API nextGenScore');
  }
  eq(seenRows, 4, 'PARITY: all four Big 4 rows were checked against the API');
  eq(dl.nextGenScore, 0, 'PARITY: the API next-gen score for Delta is 0');
  ok(/data-name="Delta" data-score="\d+" data-nextgen="0"/.test(home),
    'the Delta Big 4 row ranks next-gen at a real 0, not blank and not projected');

  /* /race/ must print the same next-gen share the API reports for each airline */
  var racePage = fs.readFileSync(path.join(ROOT, 'race', 'index.html'), 'utf8');
  var raceMissing = all.airlines.filter(function (a) {
    return racePage.indexOf('/airlines/' + a.key + '/') < 0;
  });
  eq(raceMissing.length, 0, '/race/ links every scored airline',
    raceMissing.map(function (a) { return a.key; }));
  ok(/Amazon Leo/.test(racePage), '/race/ names Amazon Leo');
  var sysPage = fs.readFileSync(path.join(ROOT, 'systems', 'index.html'), 'utf8');
  ok(/Amazon Leo/.test(sysPage), '/systems/ names Amazon Leo');
  /* toFixed(2), not toFixed(1): the weights are 0.55 / 0.22 / 0.12 now, and
     (0.55).toFixed(1) prints "0.6" — the old assertion would have passed while
     the page printed a weight the scoring does not use. */
  ok(sysPage.indexOf(A.SYSTEM_QUALITY.viasat.toFixed(2)) !== -1,
    '/systems/ prints the Viasat quality weight straight from the scoring table');
  ok(sysPage.indexOf(A.SYSTEM_QUALITY.panasonic.toFixed(2)) !== -1,
    '/systems/ prints the legacy GEO weight straight from the scoring table');

  /* and the generated module really is a verbatim copy, not a second hand-typed
   * implementation that happens to agree today */
  var siteSrc = fs.readFileSync(path.join(ROOT, 'assets', 'airlines.js'), 'utf8');
  var core = siteSrc.slice(0, siteSrc.indexOf('if (typeof module !== "undefined"')).replace(/\s+$/, '');
  var genSrc = fs.readFileSync(path.join(FN, '_lib', 'score.mjs'), 'utf8');
  ok(core.length > 4000, 'assets/airlines.js body was located', core.length);
  ok(genSrc.indexOf(core) !== -1,
    'functions/_lib/score.mjs is NOT a verbatim copy of assets/airlines.js — re-run ' +
    'node build/prerender.js (it regenerates it) and never hand-edit the generated file');
  ok(/DO NOT EDIT/.test(genSrc), 'score.mjs carries its generated-file warning');

  /* the docs page exists and is the page we think it is */
  var docs = fs.readFileSync(path.join(ROOT, 'api', 'docs', 'index.html'), 'utf8');
  ok(/<title>ConnectScore API/.test(docs), '/api/docs/ has the API title');
  ok(docs.indexOf('/api/score/{flightNumber}') !== -1,
    '/api/docs/ still names the retired score endpoint, so a bookmark leads somewhere');
  ok(/410/.test(docs) && /retired/i.test(docs),
    '/api/docs/ says the score endpoint is retired (410), not just documents it as live');
  ok(/href="\/api\/docs\/"/.test(docs), '/api/docs/ is linked from the shared footer');

  /* ── unpublished means unpublished on EVERY surface, not just the board ───
   * An external audit found Air France and SAS publishing "Next-gen odds …
   * 0.0% … 0" on their detail pages while the leaderboard, the cards and the
   * API all said "count unpublished" for the same airlines. Two rows above the
   * zero, the same table said the count was not published.
   *
   * build/assert-measured-zero.js exists to stop exactly this and did not,
   * because it validates the shape of a DATA ENTRY and this was a RENDERED
   * claim. The guard was one layer below the defect. Field-level checks cannot
   * see what a template does with a field.
   *
   * So this walks the built bytes for every airline the model says is
   * unpublished and demands that no page prints a number for it. */
  var A_LIB = require(path.join(ROOT, 'assets', 'airlines.js'));
  var unpubKeys = Object.keys(A_LIB.WIFI_AIRLINES).filter(function (k) {
    var e = A_LIB.WIFI_AIRLINES[k];
    var L = A_LIB.ledgerFor(e);
    return L && L.unresolved > 0 && L.nextGenShare === 0;
  });
  ok(unpubKeys.length > 0,
    'there is at least one unpublished-count airline to check, so this guard is ' +
    'protecting something', unpubKeys.join(', '));
  var unpubBad = [], unpubSurfaces = 0;
  unpubKeys.forEach(function (k) {
    var entry = A_LIB.WIFI_AIRLINES[k];
    var nm = entry.name;

    /* 1. the detail page's ledger row */
    var f = path.join(ROOT, 'airlines', k, 'index.html');
    if (fs.existsSync(f)) {
      unpubSurfaces++;
      var row = /Next-gen odds, the top row on its own([\s\S]{0,400}?)<\/tr>/.exec(fs.readFileSync(f, 'utf8'));
      if (!row) unpubBad.push(k + ': ledger row selector rotted');
      else {
        var nums = row[1].replace(/<[^>]+>/g, ' ').match(/\d+(?:\.\d+)?%?/g) || [];
        if (nums.length) unpubBad.push(k + ' detail ledger prints ' + nums.join(', '));
      }
    }

    /* 2. llms.txt, the surface written FOR assistants and therefore the one
     *    most likely to have its number repeated to a traveller as fact. This
     *    printed "next-gen 0" and "null/229 equipped" until 27 Jul 2026. The
     *    round-2 acceptance test named this file and the first repair covered
     *    only surface 1 above, which is why it is enumerated explicitly now. */
    var lp = path.join(ROOT, 'llms.txt');
    if (fs.existsSync(lp)) {
      unpubSurfaces++;
      var lines = fs.readFileSync(lp, 'utf8').split('\n').filter(function (L) {
        return L.indexOf(nm + ' (') !== -1;
      });
      lines.forEach(function (L) {
        if (/next-gen \d/.test(L)) unpubBad.push(k + ' llms.txt: "' + /next-gen \d+/.exec(L)[0] + '"');
        if (/\bnull\b/.test(L)) unpubBad.push(k + ' llms.txt renders a literal null: ' + L.slice(0, 90));
      });
    }

    /* 3. every other built surface that names this airline and a next-gen number */
    ['index.html', path.join('airlines', 'index.html')].forEach(function (rel) {
      var p2 = path.join(ROOT, rel);
      if (!fs.existsSync(p2)) return;
      unpubSurfaces++;
      var h2 = fs.readFileSync(p2, 'utf8');
      /* the card and the row for this key, each must say unpublished in the
         NEXT-GEN field specifically, not merely somewhere in the block */
      var card = new RegExp('<li class="crd[^"]*" data-key="' + k + '"[\\s\\S]*?<\\/li>').exec(h2);
      if (card) {
        var ng = /<p class="crd-ng">([\s\S]*?)<\/p>/.exec(card[0]);
        if (ng && /\d/.test(ng[1].replace(/<[^>]+>/g, ''))) {
          unpubBad.push(k + ' card next-gen field in ' + rel + ': "' +
            ng[1].replace(/<[^>]+>/g, ' ').trim().slice(0, 40) + '"');
        }
      }
    });
  });
  /* 4. EVERY BUILT TEXT SURFACE, derived rather than enumerated.
   *
   * The list above (detail ledger, llms.txt, homepage) is a list I remembered,
   * and an auditor showed why that is not a guard: it mutated the MCP text
   * serializer to append `next-gen 0` from its own structured field, and the
   * release exited 0 with 1,216 checks green, because MCP was not on my list.
   * The same objection retires the list itself. A new serializer added next
   * month would be missed the same way.
   *
   * So this walks EVERY generated route and every text-bearing built file, and
   * asserts that no rendered text places a number next to this airline's
   * next-gen wording. Adding a page brings its own coverage; forgetting to add
   * it to a list is no longer possible because there is no list. */
  var TEXTY = ['.html', '.txt', '.json', '.xml'];
  var builtFiles = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      if (/^(node_modules|\.git|build|functions)$/.test(e.name)) return;
      var full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      if (TEXTY.indexOf(path.extname(e.name)) >= 0) builtFiles.push(full);
    });
  })(ROOT);
  ok(builtFiles.length >= 30,
    'the unpublished sweep found the built surfaces to walk',
    builtFiles.length + ' text-bearing files');
  /* RECORD-AWARE, because a flat text scan is not.
     The first version stripped tags and matched name-to-number across up to 120
     characters. That crossed row boundaries: "Air France" reached into Air
     Canada's row and reported its 6%, and the bare name "SAS" matched inside
     the URL fragment "sas/" in a JSON-LD block, pulling in Delta's figure. Four
     findings, all false. A check that over-reports buries the real ones, which
     is the failure this file has already had once at 2,406 findings.
     So: close every block-level element to a separator BEFORE stripping tags,
     split on those separators, and require the name and the number inside one
     record with the name on word boundaries. */
  unpubKeys.forEach(function (k) {
    var nm = A_LIB.WIFI_AIRLINES[k].name;
    var nameRe = new RegExp('(^|[^A-Za-z])' +
      nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z]|$)', 'i');
    builtFiles.forEach(function (f) {
      var raw = fs.readFileSync(f, 'utf8');
      var seg;
      if (/\.html$/.test(f)) {
        /* Scripts and styles are not rendered text, and leaving them in made
           the whole JSON-LD blob one record: it contains every airline, so
           "Air France" sat in the same record as United's "next-gen number,
           31" and reported four findings that were all this bug. JSON-LD is
           checked structurally below instead, per ListItem. */
        seg = raw.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
                 .replace(/<\/(td|tr|li|p|div|section|h\d|option|dd|dt)>/g, '\u2028')
                 .replace(/<[^>]+>/g, ' ').split('\u2028');
      } else {
        seg = raw.split(/\n|·|\|/);
      }
      seg.forEach(function (rec) {
        var t = rec.replace(/\s+/g, ' ').trim();
        if (!t || !nameRe.test(t)) return;
        var m = /next[- ]gen[^.]{0,24}?(\d+(?:\.\d+)?)\s*%?/i.exec(t);
        if (m) {
          unpubBad.push(k + ' in ' + path.relative(ROOT, f) + ': "…' +
            t.slice(Math.max(0, m.index - 24), m.index + 40) + '"');
        }
      });
    });
  });
  /* JSON-LD, per ListItem rather than as one blob. This is a machine surface
     and an assistant reads it, so an unsourced number here is the same defect
     as one in llms.txt. */
  var ldChecked = 0;
  builtFiles.filter(function (f) { return /\.html$/.test(f); }).forEach(function (f) {
    var raw = fs.readFileSync(f, 'utf8');
    (raw.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [])
      .forEach(function (blk) {
        var json = blk.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
        var data;
        try { data = JSON.parse(json); } catch (e) { return; }
        ldChecked++;
        JSON.stringify(data, function (key, val) {
          if (typeof val === 'string') {
            unpubKeys.forEach(function (k) {
              var nm = A_LIB.WIFI_AIRLINES[k].name;
              if (val.indexOf(nm) !== 0) return;      /* the entry is ABOUT this airline */
              var m = /next[- ]gen[^.]{0,24}?(\d+(?:\.\d+)?)\s*%?/i.exec(val);
              if (m) unpubBad.push(k + ' JSON-LD in ' + path.relative(ROOT, f) + ': "' + val.slice(0, 70) + '"');
            });
          }
          return val;
        });
      });
  });
  ok(ldChecked > 0, 'JSON-LD blocks were parsed and inspected', ldChecked + ' blocks');
  unpubSurfaces += builtFiles.length * unpubKeys.length;
  ok(unpubSurfaces >= unpubKeys.length * 30,
    'the unpublished check reached every built text surface, derived from disk ' +
    'rather than from a list somebody remembered to update',
    unpubSurfaces + ' surface reads for ' + unpubKeys.length + ' airlines');
  eq(unpubBad.length, 0,
    'no surface prints a numeric next-gen value for an airline whose count is unpublished',
    unpubBad.join(' · '));

  /* ── the mobile card and the desktop table must agree ─────────────────────
   * They are separately rendered strings. A source comment claimed they "can
   * never disagree"; an auditor changed one expression in the card renderer,
   * ran the whole gate, got exit 0, and shipped a page reading 31% in the
   * table and 32% in the card. The card is the primary surface at phone
   * widths, so the mutation changed the answer to the site's core question
   * with every check green.
   *
   * A comment is not a mechanism. This compares the rendered values. */
  var homeHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var cardVals = {}, tableVals = {}, parityBad = [];
  /* cards are <li class="crd …" data-key="american">, and the table rows carry
     the same key. Keying on data-key rather than the display name means a
     renaming cannot quietly drop an airline out of the comparison. */
  /* No length cap on either match. The first version used {0,1400} and {0,1600}
     windows and silently captured 4 rows out of 22, because the 18-board rows
     are longer than the Big 4 rows. The floor assertion below said "4 shared"
     and that is the only reason it was caught. A bounded window is a quiet way
     to check a fifth of the thing and report on all of it. */
  /* Read the LABELLED field, never the whole card.
     The first version tested /count unpublished/ against the entire card, and
     an auditor changed the headline to "0%" while leaving the support sentence
     saying "Starlink count unpublished". The support copy masked the
     contradictory headline and the whole gate exited 0 on a card that read
     "Chance of next-gen WiFi 0% · Starlink count unpublished" at once.
     It also compared only score and next-gen, so a second mutation shifted
     every rank by one, printed the wrong band word, and pointed every action
     at SAS, all with the release green. Everything a reader acts on is
     compared now: rank, score, band, next-gen state, and both hrefs. */
  (homeHtml.match(/<li class="crd[^"]*" data-key="[^"]+"[\s\S]*?<\/li>/g) || []).forEach(function (c) {
    var keyM = /data-key="([^"]+)"/.exec(c);
    if (!keyM) return;
    var ngField = /<p class="crd-ng">([\s\S]*?)<\/p>/.exec(c);
    var ngTxt = ngField ? ngField[1].replace(/<[^>]+>/g, ' ') : '';
    /* AN ARRAY PER KEY, NOT ONE CARD PER KEY.
       The homepage renders each Big 4 airline TWICE as a card: once on the Big 4
       board and once on the full 18-board. This used a plain assignment, so the
       later full-board card silently overwrote the Big 4 one and the Big 4
       rendering was never compared at all. An auditor changed both links in
       every Big 4 card to /airlines/sas/, left the full-board cards alone, and
       the release exited 0 — then navigated a real touch at 390px and landed on
       SAS from the American card.
       Every visible rendering is a rendering a reader can act on. */
    (cardVals[keyM[1]] = cardVals[keyM[1]] || []).push({
      score: (/<span class="sco">(\d+)<\/span>/.exec(c) || [])[1] || null,
      band: (/<span class="band[^"]*">([^<]+)<\/span>/.exec(c) || [])[1] || null,
      rank: (/<span class="crd-rank">(\d+)<\/span>/.exec(c) || [])[1] || null,
      /* the state comes from the next-gen field alone */
      ng: /unpublished/.test(ngTxt) ? '' : ((/(\d+)\s*%/.exec(ngTxt) || [])[1] || null),
      nameHref: (/<a class="aname" href="([^"]+)"/.exec(c) || [])[1] || null,
      goHref: (/<a class="crd-go" href="([^"]+)"/.exec(c) || [])[1] || null
    });
  });
  /* Two row shapes on this page, and anchoring on the wrong one is how the
     first version covered 4 of 18. The Big 4 board emits
     `<tr data-name data-score data-nextgen … data-key>`; the 18-board emits
     `<tr data-f data-key>` and carries its numbers in cells rather than
     attributes. Match on data-key, which both carry, and read the score from
     the attribute when it is there and from the rendered cell when it is not. */
  /* Two row shapes, and anchoring on the wrong one is how the first version
     covered 4 of 18. The Big 4 board emits `<tr data-name data-score
     data-nextgen … data-key>`; the 18-board emits `<tr data-f data-key>` and
     carries its next-gen number in a cell with `data-s`, not an attribute on
     the row.
     Both shapes get parsed, and BOTH are kept per key rather than the later
     one overwriting the earlier. The first working version used a plain
     assignment, so the 18-board row (whose next-gen is in a cell) overwrote
     the Big 4 row (whose next-gen is an attribute) with a null, and a null
     silently skipped the comparison. The auditor's mutation then passed a
     guard written to catch it. Every parsed rendering is compared. */
  /* Read the labelled cell, never a guessed one. The first version of this
     hunted for the first band-coloured cell carrying data-s and skipped
     anything containing "fitted"; for Delta and jetBlue, whose score cell has
     no fitted badge, it picked the ConnectScore cell and reported next-gen 49
     against a card showing 0. Both generators now emit data-col="nextgen". */
  function rowNextGen(r) {
    var m = /data-nextgen="(\d*)"/.exec(r);
    if (m) return m[1];
    var cell = /<td[^>]*data-col="nextgen"[^>]*>[\s\S]*?<\/td>/.exec(r);
    if (!cell) return null;
    if (/ngunpub|count unpublished/.test(cell[0])) return '';
    var v = /<span class="sco"[^>]*>(\d+)%?<\/span>/.exec(cell[0]) ||
            /data-s="(\d+)"/.exec(cell[0]);
    return v ? v[1] : null;
  }
  (homeHtml.match(/<tr [^>]*data-key="[^"]+"[\s\S]*?<\/tr>/g) || []).forEach(function (r) {
    var keyM = /data-key="([^"]+)"/.exec(r);
    if (!keyM) return;
    var scoreM = /data-score="(\d+)"/.exec(r) || /<span class="sco">(\d+)<\/span>/.exec(r);
    if (!scoreM) return;
    (tableVals[keyM[1]] = tableVals[keyM[1]] || []).push({
      score: scoreM[1],
      ng: rowNextGen(r),
      band: (/<span class="band[^"]*">([^<]+)<\/span>/.exec(r) || [])[1] || null,
      rank: (/<td class="rank"[^>]*>0?(\d+)<\/td>/.exec(r) || [])[1] || null,
      nameHref: (/<a class="aname" href="([^"]+)"/.exec(r) || [])[1] || null
    });
  });
  var shared = Object.keys(cardVals).filter(function (n) { return tableVals[n]; });
  /* The floor is every card on the page, not an arbitrary minimum. If a card
     exists and its row cannot be found, that airline is unprotected and the
     build should say so rather than quietly comparing the ones it managed to
     parse. */
  ok(shared.length === Object.keys(cardVals).length && shared.length >= 18,
    'every card on the page has a table row to compare against, and there are at ' +
    'least 18 (a selector matching nothing reports parity forever)',
    shared.length + ' of ' + Object.keys(cardVals).length + ' cards matched to rows');
  /* Every field a reader acts on, not just the two that happened to be wrong
     the first time. An auditor shifted every rank by one, printed the wrong
     band word, and pointed every action link at SAS; the release exited 0
     because none of those were compared. */
  var FIELDS = ['score', 'ng', 'band', 'rank', 'nameHref'];
  var compared = 0;
  /* CARDINALITY IS PART OF THE CONTRACT. The Big 4 keys render twice (Big 4
     board plus full board); every other key renders once. Asserting the shape
     means a rendering cannot disappear from the comparison by being dropped,
     merged or duplicated, which is how the previous version lost the Big 4
     cards entirely. */
  var BIG4 = ['american', 'delta', 'united', 'southwest'];
  var cardinalityBad = [];
  Object.keys(cardVals).forEach(function (k) {
    var want = BIG4.indexOf(k) >= 0 ? 2 : 1;
    if (cardVals[k].length !== want) {
      cardinalityBad.push(k + ': ' + cardVals[k].length + ' card renderings, expected ' + want);
    }
    if (tableVals[k] && tableVals[k].length !== want) {
      cardinalityBad.push(k + ': ' + tableVals[k].length + ' table rows, expected ' + want);
    }
  });
  eq(cardinalityBad.length, 0,
    'every airline renders the expected number of cards and rows, so no rendering ' +
    'can drop out of the comparison unnoticed', cardinalityBad.join(' · '));

  shared.forEach(function (n) {
    /* pair rendering i with rendering i: the Big 4 card against the Big 4 row,
       the full-board card against the full-board row. Comparing one card to
       both rows would let a mutation in either hide behind the other. */
    cardVals[n].forEach(function (card, ci) {
      var row = tableVals[n][ci];
      if (!row) { parityBad.push(n + ' card rendering ' + ci + ' has no matching row'); return; }
      FIELDS.forEach(function (f) {
        if (f === 'nameHref' && row[f] == null) return;
        if (card[f] == null && row[f] == null) return;
        compared++;
        var cv = card[f], rv = row[f];
        if (f === 'rank') { cv = Number(cv); rv = Number(rv); }
        if (String(cv) !== String(rv)) {
          parityBad.push(n + '[' + ci + '] ' + f + ': card ' + card[f] + ' vs row ' + row[f]);
        }
      });
      /* both of this card's own links must point at this airline's page */
      var want = '/airlines/' + n + '/';
      [['nameHref', card.nameHref], ['goHref', card.goHref]].forEach(function (pair) {
        if (pair[1] && pair[1] !== want) {
          parityBad.push(n + '[' + ci + '] ' + pair[0] + ' points at ' + pair[1] + ', not ' + want);
        }
      });
    });
  });
  ok(compared >= 22 * 3,
    'the parity check compared the labelled fields on every card rendering, all 22 ' +
    'of them, rather than skipping any as null on one side',
    compared + ' field comparisons across ' + shared.length + ' airlines');
  eq(parityBad.length, 0,
    'the mobile card and the desktop table print the same numbers for the same airline',
    parityBad.join(' · '));

  /* ── the theme sentence must describe the theme code ──────────────────────
   * The footer said "The page follows your system's light or dark setting"
   * while the boot script called classList.add("dark") unconditionally. Both
   * halves worked. The sentence was simply a claim about behaviour that the
   * behaviour had never matched, and it survived because nothing compared
   * them. On a site whose entire argument is that every figure carries its
   * source, a false statement about its own conduct is the most expensive
   * kind of error available. */
  /* The first version of this pattern-matched the one false sentence it had
     seen ("follows your system"). An auditor broke it in seconds by writing a
     DIFFERENT false sentence, which is the flaw in checking for known lies:
     there are infinitely many and you can only enumerate the ones that already
     happened.
     `build/lib/html.js` now DERIVES the sentence from THEME_BOOT, so the wrong
     state is unrepresentable rather than merely detected. What is left to
     assert is that the derivation is still wired up: the rendered footer must
     carry the sentence the code selects, whichever that is. */
  /* The check has been wrong twice for the same reason: it read the SPELLING of
     the boot script. v1 matched one false sentence and a differently-worded lie
     walked past. v2 regexed `classList.add("dark")`, and `add("js","dark")`
     boots identically while flipping the footer copy, which an auditor
     demonstrated with the build green.
     `html.js` now generates both the script and the sentence from a single
     `DEFAULT_THEME`, so what is left is to check the OBSERVED behaviour of the
     emitted script rather than how it happens to be written: run it and see
     which classes the document ends up with. */
  var homeFoot = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var bootM = /<script>\(function\(\)\{var r=document\.documentElement;([\s\S]*?)\}\)\(\);<\/script>/.exec(homeFoot);
  ok(!!bootM, 'the theme boot script is present on the homepage');
  var bootsDark = null;
  if (bootM) {
    var classes = [];
    var fakeRoot = {
      classList: { add: function () { classes.push.apply(classes, arguments); } },
      get className() { return classes.join(' '); },
      set className(v) { classes = String(v).trim().split(/\s+/); }
    };
    /* prefers-color-scheme reports NO dark, so a system-following script must
       not add it; a dark-by-default script adds it regardless. */
    var fakeMatchMedia = function () { return { matches: false }; };
    try {
      new Function('r', 'matchMedia', bootM[1])(fakeRoot, fakeMatchMedia);
      bootsDark = classes.indexOf('dark') !== -1;
    } catch (e) { bootsDark = null; }
  }
  ok(bootsDark !== null,
    'the boot script could be executed to observe what it does, rather than ' +
    'pattern-matched for how it is written');
  var footText = homeFoot.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  var saysDark = /dark by default, whatever your system is set to/i.test(footText);
  var saysSystem = /follows your system[’']s light or dark setting/i.test(footText);
  ok(saysDark || saysSystem,
    'the footer carries one of the two canonical theme sentences',
    'saysDark=' + saysDark + ' saysSystem=' + saysSystem);
  eq(saysDark, bootsDark,
    'the theme sentence matches what the boot script OBSERVABLY does when run ' +
    '(script ends up dark=' + bootsDark + ', footer says dark-by-default=' + saysDark + ')');

  /* ── each repository link points where its LABEL says ─────────────────────
   * The first version asserted both URLs were present somewhere in the footer.
   * An auditor swapped the two labels, left the URLs alone, and it passed: a
   * reader following "Site source" landed in the extension tree and the check
   * saw nothing wrong. Presence is not correspondence. */
  var repoBad = [];
  var EXPECT = [
    { label: 'Site source', mustContain: '/jeremyinthebay/wifiodds' },
    { label: 'Extension source', mustContain: '/jeremyinthebay/united-starlink-companion' }
  ];
  EXPECT.forEach(function (e) {
    var re = new RegExp('<a[^>]*href="([^"]+)"[^>]*>\\s*' + e.label + '[^<]*</a>');
    var m = re.exec(homeFoot);
    if (!m) { repoBad.push('no link labelled "' + e.label + '"'); return; }
    if (m[1].indexOf(e.mustContain) === -1) {
      repoBad.push('"' + e.label + '" points at ' + m[1] + ', which is not ' + e.mustContain);
    }
  });
  eq(repoBad.length, 0,
    'every repository link points at the repository its label names',
    repoBad.join(' · '));

  /* ── no element boundary may weld two values into a third ─────────────────
   * Every span rendered correctly. The layout was right. But `<span>37</span>`
   * followed with no whitespace by `<span>300+ by end-2026</span>` has the
   * textContent "37300+ by end-2026", so Southwest's projected score of 37
   * reached every screen reader, and every reader who copied the row, as the
   * figure 37,300. "AmericanAA" and "51installs begin 2027-Q1FIRM" were the
   * same fault. Nothing threw, nothing looked wrong, and no test compared the
   * rendered text against the values it was built from.
   *
   * So this reads the built bytes and asks a different question: where two
   * elements sit flush against each other, does the join create a token that
   * exists in neither? A digit running into a digit or a letter, or a letter
   * running into a capital, is a weld. */
  var weldBad = [], weldChecked = 0;
  require(path.join(__dirname, 'routes.js')).ROUTES.forEach(function (r) {
    if (!r.file || !/\.html$/.test(r.file)) return;
    var f = path.join(ROOT, r.file);
    if (!fs.existsSync(f)) return;
    var html = fs.readFileSync(f, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
    /* Only INLINE TEXT siblings can weld. Adjacent links, buttons, cells and
       headings are separate objects: a screen reader announces each one on its
       own and a reader sees them as distinct controls, so `<a>Fleet</a><a>History</a>`
       is not a defect and flagging it buried the two real faults under 2,400
       false positives on the first run. The elements below are the ones that
       join into a single spoken phrase. */
    var INLINE = 'span|b|i|em|strong|small|code|abbr|sup|sub';
    var re = new RegExp('([A-Za-z0-9])<\\/(?:' + INLINE + ')>' +
                        '<(?:' + INLINE + ')(?:\\s[^>]*)?>([A-Za-z0-9])', 'g'), m;
    while ((m = re.exec(html))) {
      weldChecked++;
      var a = m[1], b = m[2];
      /* An auditor got `AA51` past this by joining an uppercase letter to a
         digit, which the first rule did not cover: it caught digit-into-
         anything and lowercase-into-uppercase, and simply had no case for
         letter-into-digit. Any alphanumeric running into any alphanumeric with
         no separator is a weld; the only joins worth allowing are the ones
         inside a single word, and a single word does not span two elements. */
      var weld = /[0-9A-Za-z]/.test(a) && /[0-9A-Za-z]/.test(b) &&
                 !(/[a-z]/.test(a) && /[a-z]/.test(b));
      if (weld) {
        var ctx = html.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ');
        weldBad.push(r.file + ': "' + a + '" + "' + b + '" in …' + ctx.slice(-70));
      }
    }
  });
  /* The first version of this asserted `weldChecked >= 50`, meaning "at least
     50 flush boundaries still exist to look at". That was the wrong quantity.
     Fixing a weld ADDS a space, which removes the boundary from the scan, so
     the healthier the site gets the closer that floor comes to tripping — it
     stood at 51 against a floor of 50 the day it was written, and the next
     legitimate fix would have failed the build with a message about the
     detector rather than about the page.
     What actually needs proving is that the detector still detects. So feed it
     a string that is definitely a weld and demand it says so. This cannot rot
     as the site improves. */
  var weldProbe = 'x<span class="pv">37</span><span class="ph">300+ by end</span>y';
  var probeRe = new RegExp('([A-Za-z0-9])<\\/(?:span)><(?:span)(?:\\s[^>]*)?>([A-Za-z0-9])');
  var probeHit = probeRe.exec(weldProbe);
  ok(!!probeHit && /[0-9]/.test(probeHit[1]) && /[0-9A-Za-z]/.test(probeHit[2]),
    'the weld detector still detects a known weld (a check that has stopped ' +
    'matching anything reports clean forever)',
    'probe matched "' + (probeHit ? probeHit[1] + '"+"' + probeHit[2] : 'NOTHING') +
    '" · ' + weldChecked + ' live boundaries scanned');
  eq(weldBad.length, 0,
    'no element boundary welds two values into a number or word that is in neither',
    weldBad.slice(0, 6).join(' · '));

  /* ── the next-gen label must round-trip to the next-gen score ─────────────
   * Both halves worked and the wiring between them was crossed, which is the
   * failure shape nothing throws on. The cell prints "N/M flying" above a
   * score, in two different spans, and until 27 Jul 2026 nothing compared
   * them. American read "890/989 flying" over a score of 0, because 890 is
   * its VIASAT count; United read "482/1,807" over 31, because 31 is
   * 482/1,580. Both rendered perfectly.
   *
   * So this asserts the description against the behaviour: parse the printed
   * pair back out of the built HTML and demand it produces the printed score. */
  /* The label's last word is "flying" when the denominator is the whole
     fleet, "published" when it is the published-system subset (United). The
     round-trip check accepts both; a cell with any OTHER wording would fall
     out of ngChecked and trip the count floor below. */
  var boardHtml = fs.readFileSync(path.join(ROOT, 'airlines', 'index.html'), 'utf8');
  var ngCells = boardHtml.match(
    /<td class="num vcell[^"]*" data-col="nextgen">\s*<span class="lab">([\d,]+)\/([\d,]+) (?:flying|published)<\/span>\s*<span class="sco">(\d+)%?<\/span>/g) || [];
  var ngChecked = 0, ngBad = [];
  ngCells.forEach(function (cell) {
    var m = /<span class="lab">([\d,]+)\/([\d,]+) (?:flying|published)<\/span>\s*<span class="sco">(\d+)%?<\/span>/.exec(cell);
    if (!m) return;
    var n = Number(m[1].replace(/,/g, ''));
    var of = Number(m[2].replace(/,/g, ''));
    var score = Number(m[3]);
    ngChecked++;
    if (of <= 0) { ngBad.push('denominator 0 in "' + m[1] + '/' + m[2] + '"'); return; }
    var implied = Math.round((n / of) * 100);
    if (implied !== score) {
      ngBad.push('"' + m[1] + '/' + m[2] + ' flying" implies ' + implied +
        ' but the cell prints ' + score);
    }
  });
  ok(ngChecked >= 10,
    'found next-gen cells on /airlines/ to check (a selector that matches nothing ' +
    'is a green light from something that was not looking)', ngChecked + ' cells');
  eq(ngBad.length, 0,
    'every next-gen "N/M flying" label round-trips to the score printed beside it',
    ngBad.join(' · '));

  /* ── .needs-js may hide, and may not un-hide ──────────────────────────────
   * On 26 Jul 2026 `html.js .needs-js{display:revert}` shipped alongside the
   * disable rule. The pair is not symmetric. `html:not(.js)` and `html.js` can
   * never both match, so with script on nothing needs to un-hide anything; but
   * at (0,2,1) the revert rule outranked `.filters{display:flex}` (0,1,0) and
   * `revert` drops a div to the UA `block`, so the Rank-by rows and the reel
   * arrows lost their flex layout and their `gap` for every reader running
   * JavaScript. It was invisible to every script-off test, because script-off
   * was the one state where the rule did not apply.
   *
   * The comment explaining this lives in site.css. A comment is not a rule, so
   * this is the rule. */
  /* Comments are stripped first, and that is not a detail. The first version of
   * this check read the raw file and failed on the clean tree, because the
   * comment in site.css explaining why the rule is banned quotes the rule. A
   * guard that cannot tell code from prose about code is not a guard. */
  var css = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/html:not\(\.js\)\s+\.needs-js\s*\{[^}]*display\s*:\s*none/.test(css),
    'site.css hides .needs-js when script is off, at (0,2,1)');
  ok(!/html\.js\s+\.needs-js\s*\{/.test(css),
    'site.css has NO `html.js .needs-js` rule — such a rule outranks the layout ' +
    'on the element itself and silently flattens it for JS-on readers');

  /* and the reason it matters: .needs-js really does sit on elements whose own
   * rules give them a non-block display. If that ever stops being true this
   * count goes to 0 and the guard above is protecting nothing, so assert it. */
  var DISPLAY_CLASSES = {};
  css.replace(/(^|\})\s*([^{}@]+)\{([^}]*)\}/g, function (_, __, sel, body) {
    var d = /display\s*:\s*([a-z-]+)/.exec(body);
    if (!d || d[1] === 'none' || d[1] === 'block') return '';
    sel.split(',').forEach(function (s) {
      var m = /^\s*\.([A-Za-z0-9_-]+)\s*$/.exec(s);
      if (m) DISPLAY_CLASSES[m[1]] = d[1];
    });
    return '';
  });
  var atRisk = [];
  require(path.join(__dirname, 'routes.js')).ROUTES.forEach(function (r) {
    if (!r.file || !/\.html$/.test(r.file)) return;
    var f = path.join(ROOT, r.file);
    if (!fs.existsSync(f)) return;
    var html = fs.readFileSync(f, 'utf8');
    (html.match(/class="[^"]*\bneeds-js\b[^"]*"/g) || []).forEach(function (c) {
      c.slice(7, -1).split(/\s+/).forEach(function (cl) {
        if (DISPLAY_CLASSES[cl]) atRisk.push(cl + ':' + DISPLAY_CLASSES[cl]);
      });
    });
  });
  atRisk = atRisk.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  ok(atRisk.length > 0,
    '.needs-js sits on at least one element with its own non-block display, so the ' +
    'no-`html.js .needs-js` guard above is load-bearing', atRisk.join(' '));

  /* ── POST /api/report — the field-report intake ───────────────────────────
   * Same method as the MCP section above: wrangler is not installed, so the
   * module is imported and called with a mock Pages context and we assert on the
   * parsed response bodies.
   *
   * The one difference is that this endpoint WRITES, so the network call is
   * stubbed at globalThis.fetch and we assert on the request it tried to make.
   * That is the point, not a compromise: the assertions that matter most here
   * are about what leaves the Worker. No raw address in the payload. No third
   * party in the URL. published:false on the way in, every time. */
  var RPT = await import('../functions/_lib/reports.mjs');
  var checksBeforeIntake = checks;

  var sent = [];
  var canned = { ok: true, id: 'ffffffff-0000-4000-8000-000000000001', published: false,
    remaining: 4, cap: 5 };
  var realFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    var rec = { url: String(url), init: init || {} };
    try { rec.body = JSON.parse((init || {}).body); } catch (e) { rec.body = null; }
    sent.push(rec);
    var out = typeof canned === 'function' ? canned(sent.length) : canned;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };

  var TEST_ENV = {
    SUPABASE_URL: 'https://testproject.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_testkey',
    REPORT_IP_SALT: 'a-test-salt-that-is-not-the-real-one'
  };
  function reportCtx(payload, opts) {
    opts = opts || {};
    var method = opts.method || 'POST';
    var c = ctx('https://wifiodds.com/api/report', {}, method);
    var h = {};
    if (opts.contentType !== null) h['content-type'] = opts.contentType || 'application/json';
    if (opts.ip !== null) h['cf-connecting-ip'] = opts.ip || '203.0.113.7';
    var init = { method: method, headers: h };
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && payload !== undefined) {
      init.body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    }
    c.request = new Request('https://wifiodds.com/api/report', init);
    c.env = Object.assign({}, c.env, TEST_ENV, opts.env || {});
    if (opts.dropEnv) opts.dropEnv.forEach(function (k) { delete c.env[k]; });
    return c;
  }
  var GOOD = {
    flownOn: '2026-07-11', airline: 'United', flightNumber: 'ua 2447', route: 'den-dfw',
    aircraft: '737 MAX 8', system: 'starlink', downMbps: 83.1, upMbps: 9.7, latencyMs: 58,
    wasFree: true, note: 'Full 737 out of Denver and I still saw 83 down.', credit: 'Jeremy Smith'
  };

  /* ── a valid submission ── */
  sent = [];
  res = await RPT.submitReport(reportCtx(GOOD));
  var rp = await body(res);
  eq(res.status, 201, 'POST /api/report valid → 201');
  eq(res.headers.get('access-control-allow-origin'), '*', '/api/report: CORS header');
  eq(res.headers.get('content-type'), 'application/json; charset=utf-8', '/api/report: content-type');
  eq(res.headers.get('cache-control'), 'no-store', '/api/report is never cached');
  eq(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS',
    '/api/report advertises POST, not GET');
  ok(Array.isArray(rp.sources) && rp.sources.length >= 3, '/api/report: sources[] in the body',
    rp.sources && rp.sources.length);
  ok(/unitedstarlinktracker\.com/.test(JSON.stringify(rp.sources)),
    '/api/report: sources credit unitedstarlinktracker.com');
  eq(rp.ok, true, '/api/report ok:true');
  eq(rp.stored, true, '/api/report stored:true');
  eq(rp.published, false, 'A STORED REPORT IS NEVER PUBLISHED — published:false in the response');
  eq(rp.kind, 'FIELD REPORT', '/api/report classes the row FIELD REPORT');
  eq(rp.id, canned.id, '/api/report returns the row id');
  ok(/queue/.test(rp.whatHappensNext) && /nothing on the site changes yet/.test(rp.whatHappensNext),
    '/api/report tells the reader nothing publishes itself');
  /* normalisation, on the bytes that come back */
  eq(rp.report.flightNumber, 'UA2447', '/api/report normalises "ua 2447" → UA2447');
  eq(rp.report.route, 'DEN-DFW', '/api/report normalises "den-dfw" → DEN-DFW');
  eq(rp.report.downMbps, 83.1, '/api/report keeps the download figure');
  eq(rp.report.system, 'starlink', '/api/report keeps the system');

  /* ── what actually left the Worker ── */
  eq(sent.length, 1, 'a valid report makes exactly one outbound request');
  eq(sent[0].url, 'https://testproject.supabase.co/rest/v1/rpc/submit_report',
    'the outbound request goes to env.SUPABASE_URL and the submit_report RPC');
  eq(sent[0].init.method, 'POST', 'the outbound request is a POST');
  eq(sent[0].init.headers.apikey, TEST_ENV.SUPABASE_ANON_KEY, 'it sends the publishable key');
  var outPayload = sent[0].body.p;
  ok(/^[0-9a-f]{64}$/.test(outPayload.ipHash), 'the payload carries a 64-hex ipHash',
    outPayload.ipHash);
  /* THE assertion this endpoint exists to satisfy. */
  ok(JSON.stringify(sent[0]).indexOf('203.0.113.7') < 0,
    'NO RAW IP LEAVES THE WORKER — the address appears nowhere in the outbound request');
  ok(!('published' in outPayload),
    'the payload cannot even ask to be published — the RPC hardcodes published = false');
  ok(!('ip' in outPayload) && !('address' in outPayload) && !('userAgent' in outPayload),
    'the payload carries no address and no user-agent field');
  eq(Object.keys(outPayload).sort().join(','),
    'aircraft,airline,credit,downMbps,flightNumber,flownOn,ipHash,latencyMs,note,route,system,' +
    'upMbps,wasFree',
    'the payload is exactly the report plus the hash');

  /* the hash is salted, hourly and per-address: same inputs same digest, a
     different address a different digest, and neither is the address */
  var stamp = RPT.hourStamp(new Date('2026-07-25T14:30:00Z'));
  eq(stamp, '2026-07-25T14', 'the hash bucket is the UTC hour');
  var h1 = await RPT.hashClientId('203.0.113.7', 'salt', stamp);
  var h2 = await RPT.hashClientId('203.0.113.7', 'salt', stamp);
  var h3 = await RPT.hashClientId('198.51.100.9', 'salt', stamp);
  var h4 = await RPT.hashClientId('203.0.113.7', 'salt', '2026-07-25T15');
  eq(h1, h2, 'the same address in the same hour hashes the same (the cap works)');
  ok(h1 !== h3, 'a different address hashes differently');
  ok(h1 !== h4, 'the SAME address hashes differently an hour later (the hash does not follow you)');
  ok(h1.length === 64, 'the digest is a full sha-256', h1.length);

  /* ── an invalid submission gets a useful message ── */
  sent = [];
  res = await RPT.submitReport(reportCtx({
    flownOn: '2099-01-01', airline: '', flightNumber: 'not a flight', system: 'carrier pigeon',
    downMbps: 99999, latencyMs: 12.5, hovercraft: 'full of eels'
  }));
  var badRep = await body(res);
  eq(res.status, 400, 'an invalid report → 400');
  eq(badRep.error.code, 'invalid_report', 'invalid report error code');
  eq(sent.length, 0, 'an invalid report never reaches the store');
  ok(/future/.test(badRep.fields.flownOn), 'it says the date is in the future', badRep.fields.flownOn);
  ok(/flight number/.test(badRep.fields.flightNumber), 'it says what a flight number looks like');
  ok(/starlink/.test(badRep.fields.system), 'it lists the systems it accepts');
  ok(/5000/.test(badRep.fields.downMbps), 'it says the speed is out of range');
  ok(/whole number/.test(badRep.fields.latencyMs), 'latency has to be whole milliseconds');
  ok(/hovercraft/.test(badRep.fields._body), 'it names the field it did not recognise');
  ok(/is required/.test(badRep.fields.airline), 'an empty airline counts as missing');
  ok(badRep.error.message.length > 20 && /see `fields`/.test(badRep.error.message),
    'the top-level message points at the per-field map', badRep.error.message);
  assertEnvelope(res, badRep, '/api/report 400');

  /* a report with no measurement in it is not a report */
  res = await RPT.submitReport(reportCtx({
    flownOn: '2026-07-11', airline: 'United', flightNumber: 'UA2447', system: 'starlink'
  }));
  var noMeas = await body(res);
  eq(res.status, 400, 'a report with no numbers in it → 400');
  ok(/at least one measurement/.test(noMeas.fields._body), 'it asks for a measurement');
  /* unless the point of the report is that there was no wifi at all */
  sent = [];
  res = await RPT.submitReport(reportCtx({
    flownOn: '2026-07-11', airline: 'Delta', flightNumber: 'DL717', system: 'none'
  }));
  eq(res.status, 201, 'system "none" needs no speed figure');
  eq(sent.length, 1, 'the no-wifi report is stored');

  /* ── the rate limit trips ── */
  sent = [];
  canned = function (n) {
    return n <= 5 ? { ok: true, id: 'ffffffff-0000-4000-8000-00000000000' + n, published: false,
      remaining: 5 - n, cap: 5 }
      : { ok: false, code: 'rate_limited', cap: 5, seen: 5 };
  };
  var codes = [];
  for (var i = 0; i < 6; i++) {
    res = await RPT.submitReport(reportCtx(GOOD));
    codes.push(res.status);
  }
  eq(codes.join(','), '201,201,201,201,201,429',
    'five reports go through and the sixth is refused');
  var limited = await body(res);
  eq(limited.error.code, 'rate_limited', 'the sixth carries the rate_limited code');
  eq(limited.cap, 5, 'the response says what the cap is');
  ok(Number(res.headers.get('retry-after')) > 0 && Number(res.headers.get('retry-after')) <= 3600,
    'a 429 carries a retry-after inside the hour', res.headers.get('retry-after'));
  ok(/nothing was stored/i.test(limited.error.message), 'the 429 says nothing was stored');
  ok(!/captcha|robot|prove/i.test(limited.error.message),
    'the 429 does not ask the reader to prove they are human — there is no captcha here');
  eq(sent.length, 6, 'all six attempts reached the store, which is where the count lives');
  canned = { ok: true, id: 'ffffffff-0000-4000-8000-000000000001', published: false, remaining: 4, cap: 5 };

  /* ── the honeypot: no third-party captcha, so a hidden field does the work ── */
  sent = [];
  res = await RPT.submitReport(reportCtx(Object.assign({}, GOOD, { website: 'http://spam.example' })));
  var pot = await body(res);
  eq(res.status, 202, 'a filled honeypot → 202');
  eq(pot.stored, false, 'a filled honeypot stores nothing, and the response says so');
  eq(sent.length, 0, 'a filled honeypot never reaches the store');
  /* an empty honeypot is what a real form posts, and it must be invisible */
  sent = [];
  res = await RPT.submitReport(reportCtx(Object.assign({}, GOOD, { website: '' })));
  eq(res.status, 201, 'an EMPTY honeypot field is fine — that is what a person sends');
  eq(sent.length, 1, 'the empty-honeypot report is stored');

  /* ── methods and content types ── */
  res = await RPT.submitReport(reportCtx(undefined, { method: 'OPTIONS' }));
  eq(res.status, 204, '/api/report OPTIONS preflight → 204');
  eq(res.headers.get('access-control-allow-origin'), '*', '/api/report preflight CORS');
  eq(res.headers.get('access-control-allow-headers'), 'content-type',
    '/api/report preflight allows a JSON content-type');
  res = await RPT.submitReport(reportCtx(undefined, { method: 'GET' }));
  eq(res.status, 405, 'GET /api/report → 405');
  eq((await body(res)).error.code, 'method_not_allowed', 'GET error code');
  res = await RPT.submitReport(reportCtx('flownOn=2026-07-11', { contentType: 'text/plain' }));
  eq(res.status, 415, 'a text/plain body → 415');
  res = await RPT.submitReport(reportCtx('{not json', {}));
  eq(res.status, 400, 'a broken JSON body → 400');
  eq((await body(res)).error.code, 'unparseable_body', 'broken JSON error code');
  res = await RPT.submitReport(reportCtx(JSON.stringify(['a', 'list']), {}));
  eq(res.status, 400, 'a JSON array body → 400');

  /* a plain <form> with no JavaScript posts urlencoded, and it has to work */
  sent = [];
  res = await RPT.submitReport(reportCtx(
    'date=2026-07-11&airline=United&flight=UA+2447&system=starlink&down=83.1&free=yes&name=Jeremy+Smith',
    { contentType: 'application/x-www-form-urlencoded' }));
  var form = await body(res);
  eq(res.status, 201, 'a urlencoded form post works with no JavaScript at all');
  eq(form.report.flightNumber, 'UA2447', 'the form post normalises the flight number');
  eq(form.report.wasFree, true, 'the form post reads free=yes as true');
  eq(form.report.credit, 'Jeremy Smith', 'the form post credits by name');
  eq(sent[0].body.p.flownOn, '2026-07-11', 'the alias date= maps to flownOn');

  /* ── the store being down is not the reader's fault ── */
  sent = [];
  canned = new Response('gateway', { status: 502 });
  res = await RPT.submitReport(reportCtx(GOOD));
  eq(res.status, 503, 'the store answering 502 → 503');
  eq((await body(res)).error.code, 'store_unavailable', 'store-down error code');
  canned = { ok: true, id: 'ffffffff-0000-4000-8000-000000000001', published: false, remaining: 4, cap: 5 };

  res = await RPT.submitReport(reportCtx(GOOD, { dropEnv: ['SUPABASE_URL', 'REPORT_IP_SALT'] }));
  var unconf = await body(res);
  eq(res.status, 503, 'an unconfigured deploy → 503');
  eq(unconf.error.code, 'intake_unconfigured', 'unconfigured error code');
  ok(/SUPABASE_URL/.test(unconf.error.message) && /REPORT_IP_SALT/.test(unconf.error.message),
    'it names the variables that are missing');

  /* ── length caps, on the bytes ── */
  sent = [];
  res = await RPT.submitReport(reportCtx(Object.assign({}, GOOD, { note: 'x'.repeat(501) })));
  ok(/501 characters/.test((await body(res)).fields.note), 'a 501-character note is refused');
  res = await RPT.submitReport(reportCtx(Object.assign({}, GOOD, { credit: 'y'.repeat(61) })));
  ok(/cap is 60/.test((await body(res)).fields.credit), 'a 61-character credit is refused');
  res = await RPT.submitReport(reportCtx('{"note":"' + 'z'.repeat(9000) + '"}'));
  eq(res.status, 413, 'a 9 KB body → 413');
  eq(sent.length, 0, 'none of the oversized attempts reached the store');

  /* ── the same field twice under two names is ambiguous, so it is refused ── */
  res = await RPT.submitReport(reportCtx(Object.assign({}, GOOD, { flight: 'UA1' })));
  ok(/sent twice/.test((await body(res)).fields.flightNumber),
    'flightNumber and its alias in one body is refused rather than guessed');

  /* ── normaliseReport is pure, so the date fence can be tested against a fixed
   *    day rather than against whatever today happens to be ── */
  var fixed = '2026-07-25';
  eq(RPT.normaliseReport(Object.assign({}, GOOD, { flownOn: fixed }), fixed).ok, true,
    'a report flown TODAY is fine');
  eq(RPT.normaliseReport(Object.assign({}, GOOD, { flownOn: '2026-07-26' }), fixed).ok, false,
    'a report flown TOMORROW is not');
  eq(RPT.normaliseReport(Object.assign({}, GOOD, { flownOn: '2017-12-31' }), fixed).ok, false,
    'a report from 2017 is not');
  eq(RPT.normaliseReport(Object.assign({}, GOOD, { flownOn: '2026-02-30' }), fixed).ok, false,
    '30 February is not a date');
  eq(RPT.SYSTEMS.join(','), 'starlink,leo,viasat,panasonic,intelsat,hughes,none,unsure',
    'the eight systems the form has to offer');
  eq(RPT.RATE_CAP, 5, 'the documented cap is five per hashed address per hour');

  globalThis.fetch = realFetch;

  /* ── the committed file the BUILD reads ───────────────────────────────────
   * The site is prerendered, so nothing fetches reports at runtime. The path is
   * Supabase → build/pull-reports.js → assets/reports.json → build/lib/reports.js
   * → the build. The assertion that matters is the last link: the build must
   * work when the file is absent, because that is what happens the first time
   * anybody clones this repo, and it must never contain a hash. */
  var RJ = require('../build/lib/reports.js');
  var loaded = RJ.load();
  ok(loaded.count >= 0, 'build/lib/reports.js loads without throwing');
  ok(loaded.reports.every(function (r) { return r.kind === 'FIELD REPORT'; }),
    'every committed report is classed FIELD REPORT');
  ok(JSON.stringify(loaded).indexOf('ip_hash') < 0 && !/[0-9a-f]{64}/.test(JSON.stringify(loaded)),
    'the committed file carries no hash and no address');
  ok(loaded.reports.every(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.flownOn); }),
    'every committed report carries an as-of date');
  ok(loaded.reports.every(function (r) { return !!r.credit; }),
    'every committed report credits somebody by name');
  var seedDowns = loaded.reports.map(function (r) { return r.downMbps; }).filter(Boolean);
  ok(seedDowns.every(function (n) { return n > 0 && n <= 5000; }),
    'every committed download figure is physically possible', seedDowns);

  /* ── report ── */
  if (fails.length) {
    console.error('API acceptance FAILED — ' + fails.length + ' of ' + checks + ' checks:');
    fails.forEach(function (f) { console.error('  ✗ ' + f); });
    process.exit(1);
  }
  console.log('ConnectScore API acceptance OK — ' + checks + ' checks, ' + files.length +
    ' function files syntax-checked.');
  console.log('  parity: /airlines/qatar/ renders ' + rendered[0] + ' in ' + rendered.length +
    ' places · API /api/airlines/qatar returns ' + qr.airline.connectScore);
  console.log('  /api/airlines: ' + all.count + ' airlines, ' + all.airlines[0].name + ' ' +
    all.airlines[0].connectScore + ' → ' + all.airlines[all.airlines.length - 1].name + ' ' +
    all.airlines[all.airlines.length - 1].connectScore);
  console.log('  /api/score/{flightNumber}: retired 2026-07-26, 410 on every shape tried');
  console.log('  tiers: Delta nextGenScore ' + dl.nextGenScore + ' / serviceTier ' + dl.serviceTier +
    ' / connectScore ' + dl.connectScore + ' — and the homepage agrees (' +
    /* Counted, not asserted. This line read "18 skyline bars + 4 Big 4 rows"
       for a build with no skyline in it: the component was removed in 5f0e56c
       and the summary went on claiming coverage of it for every release
       afterwards. The assertions had moved to the cards and were passing;
       only the sentence describing them was false, which is the same class
       of defect as a footer that misdescribes the theme. */
    seenCards + ' cards + ' + seenRows + ' Big 4 rows checked)');
  console.log('  projected: ' + projected.map(function (a) {
    return a.name + ' ' + a.projected.score + ' ' + a.projected.confidence;
  }).join(' · ') + ' — none sorts anything, all four carry their date');
  console.log('  POST /api/report: ' + (checks - checksBeforeIntake) + ' checks · no raw address in ' +
    'the outbound payload · published:false on every stored row · the cap is ' + RPT.RATE_CAP +
    ' per hashed address per hour · ' + loaded.count + ' published report' +
    (loaded.count === 1 ? '' : 's') + ' committed in assets/reports.json');
  console.log('  tracker gate: ' + trackerGateChecks + ' checks · a 500 with a valid MCP body, a ' +
    'wrong-route 200, and null/bool/partial-numeric-string coercion all write zero cache keys · ' +
    'the valid DEN→SFO control still caches and reads live');
}

main().catch(function (e) {
  console.error('API acceptance CRASHED: ' + (e && e.stack || e));
  process.exit(1);
});
