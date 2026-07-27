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

/* ── main ────────────────────────────────────────────────────────────────── */
async function main() {
  var files = checkSyntax();

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

  /* ── PARITY, second axis: the homepage card and the API must agree about the
   * NEXT-GEN number too. Same rule, same reason — read the bytes of the page a
   * visitor gets. Delta is the case that matters: the card leads with 0 and the
   * API must return 0, on a fleet whose connectScore is 60. */
  var home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var dlCard = /Delta<\/h3><span class="sco">(\d+)<\/span>/.exec(home);
  ok(dlCard !== null, 'homepage: could not find the Delta card headline number');
  if (dlCard) {
    eq(Number(dlCard[1]), dl.nextGenScore,
      'PARITY: the Delta card headline equals the API nextGenScore');
    eq(Number(dlCard[1]), 0, 'PARITY: the Delta card headline is 0');
  }
  ok(home.indexOf('Next-gen: 0 (Amazon Leo signed, 2028)') !== -1,
    'homepage names the Leo deal on the Delta card while scoring it zero');
  /* Was `indexOf('streaming-class fleetwide')`, which was a weak assertion: it
     passed on jetBlue's card even while Delta's said something false. Assert the
     Delta line by its own text, including the coverage number. */
  ok(home.indexOf('Today: streaming-class on 86% of the fleet') !== -1,
    'homepage states Delta coverage as a share, not as "fleetwide"');
  ok(home.indexOf('streaming-class fleetwide') !== -1,
    'jetBlue, which genuinely is fleetwide, still says so');
  /* every US card's headline must equal that airline's API nextGenScore */
  var cardRe = /<h3>([^<]+)<\/h3><span class="sco">(\d+)<\/span>/g;
  var seenCards = 0, mCard;
  while ((mCard = cardRe.exec(home)) !== null) {
    var byName = all.airlines.filter(function (a) { return a.name === mCard[1]; })[0];
    if (!byName) continue;
    seenCards++;
    eq(Number(mCard[2]), byName.nextGenScore,
      'PARITY: ' + mCard[1] + ' card headline == API nextGenScore');
  }
  eq(seenCards, 7, 'PARITY: all seven US cards were checked against the API');

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
    ' / connectScore ' + dl.connectScore + ' — and the homepage card agrees (7 cards checked)');
  console.log('  projected: ' + projected.map(function (a) {
    return a.name + ' ' + a.projected.score + ' ' + a.projected.confidence;
  }).join(' · ') + ' — none sorts anything, all four carry their date');
  console.log('  POST /api/report: ' + (checks - checksBeforeIntake) + ' checks · no raw address in ' +
    'the outbound payload · published:false on every stored row · the cap is ' + RPT.RATE_CAP +
    ' per hashed address per hour · ' + loaded.count + ' published report' +
    (loaded.count === 1 ? '' : 's') + ' committed in assets/reports.json');
}

main().catch(function (e) {
  console.error('API acceptance CRASHED: ' + (e && e.stack || e));
  process.exit(1);
});
