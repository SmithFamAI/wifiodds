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

  /* Politeness, enforced on the source: the ONLY module allowed to call fetch is
   * api.mjs (readAsset, which reads this deploy's own assets). If a handler ever
   * starts calling a tracker, this fails before it ships. */
  files.forEach(function (f) {
    var rel = path.relative(FN, f);
    var src = fs.readFileSync(f, 'utf8');
    var calls = (src.match(/\bfetch\s*\(/g) || []).length;
    checks++;
    if (calls && rel !== '_lib/api.mjs') {
      fails.push('functions/' + rel + ' calls fetch() — only _lib/api.mjs may, and only for our own ' +
        'assets. This API must never make a third-party request.');
    }
  });
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
  });
  /* the two shapes of fleet data, both covered */
  eq(all.airlines.filter(function (a) { return a.fleet.basis === 'fleetwide-coverage'; }).length, 2,
    'exactly two airlines are fleetwide-coverage (Delta, jetBlue)');

  /* ── GET /api/airlines/{key} ── */
  res = await H.airlineOne(ctx('https://wifiodds.com/api/airlines/qatar', { key: 'qatar' }));
  var qr = await body(res);
  eq(res.status, 200, '/api/airlines/qatar status');
  assertEnvelope(res, qr, '/api/airlines/qatar');
  eq(qr.airline.key, 'qatar', 'qatar key');
  eq(qr.airline.fleet.equipped, 140, 'qatar equipped');
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

  /* ── GET /api/score/{flightNumber} ── */
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/UA212', { flight: 'UA212' }));
  var s = await body(res);
  eq(res.status, 200, '/api/score/UA212 status');
  assertEnvelope(res, s, '/api/score/UA212');
  eq(s.flight, 'UA212', 'UA212 flight echo');
  eq(s.airline.key, 'united', 'UA212 → united');
  eq(s.method, 'route-history', 'UA212 method');
  eq(s.prob, 47, 'UA212 prob comes from the cached route history');
  eq(s.evidence.route, 'LAX-ORD', 'UA212 evidence route');
  eq(s.evidence.observations, 20, 'UA212 evidence observations');
  eq(s.connectScore, A.scoreAirline('united').score, 'UA212 carries the coarse United score too');

  /* normalisation: all four spellings must land on the same answer */
  for (var v of ['ua212', 'UA 212', 'ua-212', 'UA0212']) {
    res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/x', { flight: v }));
    var n = await body(res);
    eq(n.flight, 'UA212', 'normalised "' + v + '"');
    eq(n.prob, 47, 'normalised "' + v + '" prob');
  }

  /* a United flight we have no history for — coarse, and prob must be null, not 0 */
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/UA9999', { flight: 'UA9999' }));
  var cold = await body(res);
  eq(res.status, 200, 'UA9999 status');
  eq(cold.method, 'airline-coarse', 'UA9999 method');
  eq(cold.prob, null, 'UA9999 prob is null, never a guess');
  eq(cold.connectScore, A.scoreAirline('united').score, 'UA9999 coarse score');

  /* Alaska: known prefix, no per-flight feed */
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/AS15', { flight: 'AS15' }));
  var as = await body(res);
  eq(res.status, 200, 'AS15 status');
  assertEnvelope(res, as, 'AS15');
  eq(as.flight, 'AS15', 'AS15 flight echo');
  eq(as.airline.key, 'alaska', 'AS15 → alaska');
  eq(as.method, 'airline-coarse', 'AS15 method');
  eq(as.prob, null, 'AS15 prob is null');
  eq(as.connectScore, A.scoreAirline('alaska').score, 'AS15 coarse score');

  /* Hawaiian, and a two-character code with a digit in it */
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/HA50', { flight: 'HA50' }));
  eq((await body(res)).airline.key, 'hawaiian', 'HA50 → hawaiian');
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/B6123', { flight: 'B6123' }));
  var b6 = await body(res);
  eq(b6.airline.key, 'jetblue', 'B6123 → jetblue');
  eq(b6.airline.fleet.basis, 'fleetwide-coverage', 'jetblue is fleetwide-coverage');

  /* unknown prefix → 404 JSON */
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/XX999', { flight: 'XX999' }));
  var xx = await body(res);
  eq(res.status, 404, 'XX999 → 404');
  eq(xx.error.code, 'unknown_airline_prefix', 'XX999 error code');
  eq(xx.flight, 'XX999', 'XX999 flight echo');
  assertEnvelope(res, xx, 'XX999');

  /* not a flight number at all → 400, still JSON */
  res = await H.scoreFlight(ctx('https://wifiodds.com/api/score/hello', { flight: 'hello' }));
  var bad = await body(res);
  eq(res.status, 400, 'garbage → 400');
  eq(bad.error.code, 'unparseable_flight', 'garbage error code');

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
   * that they return the SAME numbers — a per-flight probability that disagrees
   * with /api/score/ would mean there are two implementations again. */
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
  [/HOURS OF WORKING WIFI/, /Prefer the higher ConnectScore/, /route-history/, /Never/,
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
  eq(tl.j.result.tools.length, 3, 'MCP exposes exactly 3 tools');
  eq(tl.j.result.tools.map(function (t) { return t.name; }).sort().join(','),
    'get_airline_score,list_airline_scores,score_flight', 'MCP tool names');
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

  /* tools/call score_flight — United, the Verified tier */
  var t3 = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'score_flight', arguments: { flight_number: 'ua 212' } } });
  var r3 = t3.j.result;
  assertToolResult(r3, 'score_flight(UA212)');
  eq(r3.structuredContent.flight, 'UA212', 'score_flight normalises the flight number');
  eq(r3.structuredContent.prob, s.prob, 'PARITY: MCP score_flight prob equals /api/score/UA212');
  eq(r3.structuredContent.method, 'route-history', 'UA212 keeps its route-history method');
  ok(/Verified/.test(r3.structuredContent.confidenceTier), 'UA212 is the Verified tier');
  ok(r3.content[0].text.indexOf(String(s.prob) + '%') >= 0,
    'the per-flight probability is in the text, not only the structured payload');
  ok(/change until departure/.test(r3.content[0].text),
    'the tail-swap caveat rides along with every per-flight answer');

  /* score_flight — no per-flight feed: prob must stay null in the payload AND the
     text must not contain an invented number */
  var t4 = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'score_flight', arguments: { flight_number: 'AS15' } } });
  var r4 = t4.j.result;
  eq(r4.structuredContent.prob, null, 'AS15 prob is null, never a guess');
  eq(r4.structuredContent.method, 'airline-coarse', 'AS15 method');
  ok(/do not turn this/i.test(r4.content[0].text), 'AS15 text tells the model not to invent precision');

  /* score_flight — an airline we do not track at all */
  var t5 = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'score_flight', arguments: { flight_number: 'XX999' } } });
  eq(t5.j.result.isError, true, 'XX999 → isError:true');
  ok(/do not track/i.test(t5.j.result.content[0].text), 'XX999 says we do not track it');

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
  eq(rendered[0], 58, 'the rendered /airlines/qatar/ page shows 58');
  eq(qr.airline.connectScore, rendered[0],
    'PARITY: the API score for qatar equals the score rendered on /airlines/qatar/');
  eq(qr.airline.connectScore, 58, 'PARITY: the API score for qatar is 58');

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
  ok(docs.indexOf('/api/score/{flightNumber}') !== -1, '/api/docs/ documents the score endpoint');
  ok(/href="\/api\/docs\/"/.test(docs), '/api/docs/ is linked from the shared footer');

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
  console.log('  /api/score/UA212: prob ' + s.prob + '% via ' + s.method + ' (' + s.evidence.route +
    ', ' + s.evidence.observations + ' obs) · /api/score/AS15: ' + as.method + ', prob ' + as.prob);
}

main().catch(function (e) {
  console.error('API acceptance CRASHED: ' + (e && e.stack || e));
  process.exit(1);
});
