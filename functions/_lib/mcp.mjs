/* functions/_lib/mcp.mjs — the WiFi Odds MCP server (streamable HTTP, JSON-RPC 2.0).
 *
 * POST https://wifiodds.com/mcp   → initialize · tools/list · tools/call · ping
 *
 * WHY THIS EXISTS AT ALL. The API answers questions a developer asks. This
 * answers questions an ASSISTANT asks, on behalf of someone who is picking a
 * flight — and the difference is not the transport, it is the `instructions`
 * field returned by initialize. That field is the product: it carries the
 * decision rules (maximise working-WiFi hours, prefer the higher ConnectScore,
 * use route-history for United, never invent a per-flight number, always credit
 * the trackers). A data API with no opinion gets averaged into mush by whatever
 * model is holding it. See INSTRUCTIONS below.
 *
 * THREE RULES, same as the REST API:
 *
 * 1. ONE FORMULA, ONE IMPLEMENTATION. Every tool here is a thin wrapper around
 *    the very handlers that serve /api/** — it builds a synthetic GET context,
 *    awaits the handler's Response, and re-shapes the parsed body. There is no
 *    second copy of the scoring, the flight-number parsing, the route-history
 *    lookup or the `sources` block. If /api/score/UA212 is right, so is
 *    score_flight("UA212"), because it IS /api/score/UA212.
 *
 * 2. NO THIRD-PARTY REQUESTS. This file never calls fetch. The only network read
 *    in the whole stack is readAsset() in api.mjs, which reads this deploy's own
 *    united/data.json. build/apitest.js FAILS the build if any file under
 *    functions/ other than _lib/api.mjs so much as mentions the fetch call in
 *    source — which it enforces with a regex, so do not write the word followed
 *    by a bracket even in a comment. (It caught this very file first time.)
 *
 * 3. CREDIT TRAVELS. Every tool result carries the `sources` array in its
 *    structured payload AND a one-line credit in the human-readable text, because
 *    a model will often relay only the text.
 *
 * Files under functions/ starting with `_` are not routed by Pages: the endpoint
 * is the one-line shim at functions/mcp.js.
 */

import { airlinesAll, airlineOne, scoreFlight } from './handlers.mjs';
import { API_VERSION, ORIGIN, DOCS, SOURCES } from './api.mjs';
import { WIFI_AIRLINES } from './score.mjs';

export const SERVER_NAME = 'wifiodds';
export const SERVER_VERSION = '0.1.0';

/* Protocol revisions we can speak. We echo the client's if we know it, otherwise
 * we answer with our newest and let it decide — a hard mismatch error here would
 * break clients pinned to an older revision for no benefit, since the surface we
 * use (initialize / tools) is identical across all three. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = PROTOCOL_VERSIONS[0];

const METHODOLOGY = ORIGIN + '/methodology/';

/* ── THE PRODUCT: what an assistant is told before it asks anything ────────
 * Read this as a prompt, not as documentation. It states the user's actual goal
 * (hours of working WiFi), the default that follows from it, the tool-selection
 * rule, and the anti-patterns that make an otherwise-correct answer useless. */
export const INSTRUCTIONS = [
  'WiFi Odds scores the odds of getting GOOD inflight WiFi. Use it whenever someone is choosing a',
  'flight, an airline, or a seat-of-the-day plan and connectivity matters to them.',
  '',
  'WHAT THE USER ACTUALLY WANTS',
  'Someone who asks about flight WiFi is trying to maximise HOURS OF WORKING WIFI, not to minimise',
  'risk in the abstract. Optimise for that. A person who installs this connector has already decided',
  'that being online matters more than the marginal convenience of the default itinerary — they will',
  'accept a different airline, a different departure time, or an extra stop to get a Starlink cabin.',
  'Say so plainly and make the trade explicit; do not hedge back toward whatever they already had.',
  '',
  'THE DEFAULT RECOMMENDATION',
  'Prefer the higher ConnectScore. It already folds together three things — how much of the fleet',
  'carries the modern system, how good that system is, and whether it is free once you are onboard —',
  'so a smaller airline that finished its rollout genuinely beats a giant one that is half done.',
  'When two options are close (within about 5 points), break the tie on: free-for-everyone over',
  'paid or loyalty-gated; then longer flight time on the better system, because the score is per',
  'flight but the value is per hour.',
  '',
  'TOOL SELECTION',
  '- The user named a flight number (UA212, AS15): call score_flight. Always.',
  '- The user named one airline: call get_airline_score.',
  '- The user is comparing, or has not chosen: call list_airline_scores once and reason over the list.',
  '  Do not call get_airline_score in a loop.',
  '',
  'UNITED IS DIFFERENT — USE IT',
  'For United flights, score_flight returns method "route-history": a real probability for THAT flight',
  'number, computed from how often recent departures of it were flown by a Starlink aircraft, with the',
  'observation count in `evidence`. Quote that number and the sample size. It is far better than the',
  'fleet-wide United score and you should say which one you are using. When the method is',
  '"airline-coarse", `prob` is null — give the airline score, state that there is no per-flight data',
  'for that carrier, and do NOT interpolate a per-flight number. Inventing precision is the one',
  'failure mode that makes this whole tool worse than nothing.',
  '',
  'CONFIDENCE TIERS — NAME THE ONE YOU ARE USING',
  '- Verified: United. Per-tail verification plus per-flight history.',
  '- Type-derived: Alaska. Tails verified, no per-flight feed — answer by aircraft type/sub-fleet.',
  '- Coarse: every other airline. A fleet-share model from public announcements. Fine for choosing an',
  '  airline, never a claim about one departure.',
  'Full method and the known limits: ' + METHODOLOGY,
  '',
  'ALWAYS SAY',
  '- The as-of date. Nothing here is live; it is a daily verified pull.',
  '- That aircraft assignments change until departure, so re-check inside 48 hours if it matters.',
  '',
  'NEVER SAY',
  '- Never call a score a guarantee, and never round a probability up into one.',
  '- Never report "no WiFi" for a low score. A low score means the GOOD system is unlikely; most of',
  '  those fleets still fly older satellite service. Say that instead.',
  '- Never blend these numbers with a review-site star rating and present the result as WiFi Odds\'.',
  '- Never suggest downloading things offline instead. The user asked to be online.',
  '- Never describe WiFi Odds, the community trackers, or the extension as official or',
  '  airline-endorsed. It is all unofficial and independent.',
  '',
  'CREDIT — NOT OPTIONAL',
  'The United and Alaska fleet numbers are verified by the independent community trackers',
  'unitedstarlinktracker.com and alaskastarlinktracker.com, both built by @martinamps. Every tool',
  'result carries a credit line and a `sources` array. Pass the credit through to the user when you',
  'quote fleet numbers or per-flight odds. If you are showing your work, cite ' + ORIGIN + '/airlines/',
  'for the leaderboard and ' + METHODOLOGY + ' for the method.'
].join('\n');

/* ── tool catalogue ─────────────────────────────────────────────────────────
 * The key enum is DERIVED from the airline table, so a newly added airline shows
 * up in tools/list with no edit here. */
const AIRLINE_KEYS = Object.keys(WIFI_AIRLINES).sort();

export const TOOLS = [
  {
    name: 'get_airline_score',
    title: 'Get one airline\'s ConnectScore',
    description: 'ConnectScore (0–100) and the full WiFi picture for one airline: which system it flies, ' +
      'how much of the fleet has it, whether it is free onboard, and which confidence tier the number ' +
      'comes from. Use this when the user has named a single airline.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Airline key (the slug used in wifiodds.com URLs), e.g. "united", "qatar".',
          enum: AIRLINE_KEYS
        }
      },
      required: ['key'],
      additionalProperties: false
    }
  },
  {
    name: 'list_airline_scores',
    title: 'List every airline, best WiFi odds first',
    description: 'Every airline we score, ordered by ConnectScore descending. Call this once when the ' +
      'user is comparing airlines or has not chosen one yet — then reason over the list rather than ' +
      'calling get_airline_score repeatedly.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'score_flight',
    title: 'Score a specific flight number',
    description: 'WiFi odds for one flight number. For United this returns a per-flight probability ' +
      'from observed recent departures (method "route-history") with the sample size; for every other ' +
      'carrier it returns the fleet-wide ConnectScore with prob null (method "airline-coarse"). Always ' +
      'use this when the user gives a flight number.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: {
          type: 'string',
          description: 'Flight number, e.g. "UA212", "ua 212", "UA0212", "AS15". Case, spaces, ' +
            'hyphens and leading zeros are normalised away.'
        }
      },
      required: ['flight_number'],
      additionalProperties: false
    }
  }
];

/* ── HTTP plumbing ────────────────────────────────────────────────────────── */
function heads(extra) {
  return Object.assign({
    'content-type': 'application/json; charset=utf-8',
    /* An MCP response is a live answer to a live question. Never cache it — the
     * REST API is the cacheable surface and it says so in its own headers. */
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type, accept, authorization, mcp-session-id, ' +
      'mcp-protocol-version, last-event-id',
    'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
    'access-control-max-age': '86400',
    'x-connectscore-api': API_VERSION,
    'x-mcp-server': SERVER_NAME + '/' + SERVER_VERSION
  }, extra || {});
}

function rpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id, result: result }, null, 2) + '\n',
    { status: 200, headers: heads() });
}

/* JSON-RPC errors are transport-level: a method that does not exist, a body that
 * is not JSON. A tool that ran and had nothing to say is NOT this — that comes
 * back as a normal result with isError:true, which is what an MCP client shows to
 * the model so it can try something else. Conflating the two is why some servers
 * make a model give up on a typo. */
function rpcError(id, code, message, data) {
  const err = { code: code, message: message };
  if (data !== undefined) err.data = data;
  return new Response(JSON.stringify({
    jsonrpc: '2.0', id: id === undefined ? null : id, error: err
  }, null, 2) + '\n', { status: 200, headers: heads() });
}

/* ── calling our own REST handlers ────────────────────────────────────────
 * A synthetic GET context: the same shape Cloudflare Pages hands a Function, so
 * the handler cannot tell the difference and none of its logic is bypassed. */
async function viaHandler(handler, context, path, params) {
  const origin = new URL(context.request.url).origin;
  const inner = {
    request: new Request(new URL(path, origin).toString(), {
      method: 'GET', headers: { accept: 'application/json' }
    }),
    params: params || {},
    env: context.env
  };
  const res = await handler(inner);
  const data = await res.json();
  return { status: res.status, data: data };
}

/* ── result shaping ───────────────────────────────────────────────────────── */
const CREDIT_LINE = 'Data credit: unitedstarlinktracker.com and alaskastarlinktracker.com ' +
  '(independent community trackers by @martinamps); every other airline from public airline ' +
  'announcements. ConnectScore by WiFi Odds (' + ORIGIN + '), unofficial and not affiliated with any ' +
  'airline, SpaceX/Starlink, Amazon, Viasat, or the trackers.';

/* The tier is derived from the same two facts the site derives it from: whether a
 * verified per-tail feed exists (perFlightOdds) and whether we hold per-flight
 * history (United only, today). */
function tierOf(a) {
  if (!a) return 'Coarse';
  if (a.key === 'united') return 'Verified (per-tail verified + per-flight history)';
  if (a.perFlightOdds) return 'Type-derived (per-tail verified, no per-flight feed — go by aircraft type)';
  return 'Coarse (fleet-share model from public announcements)';
}

function freeWord(a) {
  const s = (a.free && a.free.status) || 'unknown';
  return s === 'free' ? 'free for everyone onboard'
    : s === 'loyalty-free' ? 'free for loyalty members (free to join)'
      : s === 'loyalty-tier' ? 'free only on paid status tiers'
        : s === 'partial' ? 'free on some cabins or routes'
          : s === 'paid' ? 'paid' : 'cost unconfirmed';
}

function airlineLine(a) {
  return a.name + ' (' + (a.code || '—') + ') — ConnectScore ' + a.connectScore + '/100, ' + a.band +
    ' · ' + a.system.label + ' on ' +
    (a.fleet.total ? a.fleet.equipped + ' of ' + a.fleet.total + ' aircraft (' + a.fleet.equippedPct + '%)'
      : 'the fleet (no tail counts published)') +
    ' · ' + freeWord(a) + ' · confidence: ' + tierOf(a);
}

/* A tool result carries the same answer twice on purpose: `structuredContent` for
 * a client that will parse it, and a text block for a model that will only read
 * the prose. The credit is in BOTH, because the text is what gets relayed. */
function toolOk(text, structured) {
  return {
    content: [{ type: 'text', text: text }],
    structuredContent: structured,
    isError: false
  };
}
function toolErr(text) {
  return { content: [{ type: 'text', text: text }], isError: true };
}

/* ── the three tools ──────────────────────────────────────────────────────── */
async function toolGetAirlineScore(context, args) {
  const key = String((args && args.key) || '').toLowerCase().trim();
  if (!key) {
    return toolErr('get_airline_score needs a `key`. Valid keys: ' + AIRLINE_KEYS.join(', ') + '.');
  }
  const out = await viaHandler(airlineOne, context, '/api/airlines/' + encodeURIComponent(key), { key: key });
  if (out.status !== 200 || !out.data.airline) {
    return toolErr('No airline with key "' + key + '". Valid keys: ' + AIRLINE_KEYS.join(', ') +
      '. (Ask for a name and map it to a key rather than guessing.)');
  }
  const a = out.data.airline;
  const text = [
    airlineLine(a),
    '',
    a.note || '',
    'As of ' + a.asOf + '. Page: ' + a.url + ' · method: ' + METHODOLOGY,
    a.key === 'united'
      ? 'This fleet has per-flight history — if the user has a flight number, call score_flight for a ' +
        'much better answer than this fleet-wide figure.'
      : a.perFlightOdds
        ? 'Tails are verified for this fleet but there is no per-flight feed: answer by aircraft type, ' +
          'not by flight number.'
        : 'No per-flight data exists for this carrier. Do not produce a number for a single flight.',
    a.future ? 'Signed for later and NOT scored: ' + (a.future.system === 'leo' ? 'Amazon Leo' : a.future.system) +
      ' from ' + a.future.from + '. Hardware that is not flying yet counts zero.' : '',
    '',
    CREDIT_LINE
  ].filter(Boolean).join('\n');
  return toolOk(text, {
    airline: a,
    confidenceTier: tierOf(a),
    methodology: METHODOLOGY,
    docs: DOCS,
    sources: out.data.sources || SOURCES
  });
}

async function toolListAirlineScores(context) {
  const out = await viaHandler(airlinesAll, context, '/api/airlines');
  const list = out.data.airlines || [];
  const text = [
    'All ' + list.length + ' airlines, best WiFi odds first (as of ' + (out.data.asOf || 'the latest pull') + '):',
    '',
    list.map(function (a, i) { return (i + 1) + '. ' + airlineLine(a); }).join('\n'),
    '',
    'Prefer the higher ConnectScore. Within ~5 points, break the tie on free-for-everyone first, then ' +
    'on more hours in the air on the better system.',
    'Leaderboard: ' + ORIGIN + '/airlines/ · method: ' + METHODOLOGY,
    '',
    CREDIT_LINE
  ].join('\n');
  return toolOk(text, {
    count: list.length,
    asOf: out.data.asOf || null,
    order: out.data.order || 'connectScore desc, then name',
    airlines: list.map(function (a) {
      return Object.assign({ confidenceTier: tierOf(a) }, a);
    }),
    methodology: METHODOLOGY,
    docs: DOCS,
    sources: out.data.sources || SOURCES
  });
}

async function toolScoreFlight(context, args) {
  const asked = String((args && args.flight_number) || '').trim();
  if (!asked) {
    return toolErr('score_flight needs a `flight_number`, e.g. "UA212". If the user has not given one, ' +
      'call list_airline_scores or get_airline_score instead.');
  }
  const out = await viaHandler(scoreFlight, context, '/api/score/' + encodeURIComponent(asked),
    { flight: asked });
  const d = out.data;

  if (out.status !== 200 || d.error) {
    const e = d.error || {};
    /* An unknown prefix or an unparseable string is a TOOL error, not a protocol
     * error: the model should be told what went wrong and be free to retry. */
    return toolErr((e.message || 'Could not score "' + asked + '".') +
      (e.code === 'unknown_airline_prefix'
        ? ' We do not track that carrier at all, so there is no score for it — say so rather than ' +
          'estimating. Airlines we do track: ' + AIRLINE_KEYS.join(', ') + '.'
        : e.code === 'unparseable_flight'
          ? ' Expected an airline code plus up to four digits, e.g. UA212.'
          : ''));
  }

  const a = d.airline || {};
  const lines = [];
  if (d.method === 'route-history' && d.prob !== null) {
    const ev = d.evidence || {};
    lines.push(d.flight + ' — per-flight Starlink odds ' + d.prob + '%' +
      (ev.observations ? ' from ' + ev.observations + ' recent observed departures' : '') +
      (ev.confidence ? ' (confidence: ' + ev.confidence + ')' : '') + '.');
    if (ev.routeLabel || ev.route) lines.push('Route: ' + (ev.routeLabel || ev.route) + '.');
    if (ev.aircraft) lines.push('Usually flown by: ' + ev.aircraft + '.');
    if (ev.departure) lines.push('Departure: ' + ev.departure + '.');
    lines.push('Confidence tier: Verified — this is a real probability for this flight number, not the ' +
      'fleet average. Quote the ' + d.prob + '% and the sample size, not United\'s fleet-wide ' +
      a.connectScore + '.');
  } else {
    lines.push(d.flight + ' — no per-flight data. ' + (a.name || 'This airline') +
      '\'s fleet-wide ConnectScore is ' + d.connectScore + '/100.');
    lines.push('Confidence tier: ' + tierOf(a) + '. `prob` is null on purpose — do not turn this ' +
      'airline-level number into a claim about this departure.');
  }
  if (d.interpretation) lines.push('', d.interpretation);
  lines.push('', 'Aircraft assignments change until departure — a tail swap inside 48 hours can undo ' +
    'any of this. As of ' + (d.asOf || a.asOf) + '. More: ' + (d.moreDetail || a.url) +
    ' · method: ' + METHODOLOGY);
  lines.push('', CREDIT_LINE);

  return toolOk(lines.join('\n'), {
    flight: d.flight,
    prob: d.prob,
    connectScore: d.connectScore,
    method: d.method,
    confidenceTier: d.method === 'route-history' ? 'Verified (per-flight route history)' : tierOf(a),
    evidence: d.evidence || null,
    airline: a,
    asOf: d.asOf || null,
    methodology: METHODOLOGY,
    docs: DOCS,
    sources: d.sources || SOURCES
  });
}

async function callTool(context, name, args) {
  if (name === 'get_airline_score') return toolGetAirlineScore(context, args);
  if (name === 'list_airline_scores') return toolListAirlineScores(context);
  if (name === 'score_flight') return toolScoreFlight(context, args);
  return null; /* unknown tool → -32602, handled by the caller */
}

/* ── JSON-RPC dispatch ────────────────────────────────────────────────────── */
async function dispatch(context, msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (typeof method !== 'string') {
    return rpcError(id, -32600, 'Invalid Request: no method.');
  }
  /* A notification has no id and MUST NOT be answered. */
  const isNotification = (id === undefined || id === null);

  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSIONS.indexOf(asked) >= 0 ? asked : DEFAULT_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: SERVER_NAME,
        title: 'WiFi Odds — inflight WiFi ConnectScore',
        version: SERVER_VERSION,
        websiteUrl: ORIGIN + '/'
      },
      instructions: INSTRUCTIONS
    });
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });
  /* We declare only tools. Answering these with empty lists instead of
   * -32601 costs nothing and keeps a client that probes anyway from logging an
   * error the user will ask about. */
  if (method === 'resources/list') return rpcResult(id, { resources: [] });
  if (method === 'resources/templates/list') return rpcResult(id, { resourceTemplates: [] });
  if (method === 'prompts/list') return rpcResult(id, { prompts: [] });

  if (method === 'tools/call') {
    const name = params.name;
    const result = await callTool(context, name, params.arguments || {});
    if (!result) {
      return rpcError(id, -32602, 'Unknown tool "' + name + '". Available: ' +
        TOOLS.map(function (t) { return t.name; }).join(', ') + '.');
    }
    return rpcResult(id, result);
  }

  if (isNotification || method.indexOf('notifications/') === 0) {
    return null; /* nothing to say, and saying it would be a protocol violation */
  }
  return rpcError(id, -32601, 'Method not found: ' + method + '. This server implements initialize, ' +
    'ping, tools/list and tools/call.');
}

/* ── the endpoint ─────────────────────────────────────────────────────────── */
export async function mcpRequest(context) {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: heads() });
  }

  /* Streamable HTTP allows a server that offers no server-initiated SSE stream to
   * refuse GET. We do refuse it — but with a body that tells a human who curled
   * it what to do instead, because a bare 405 with no bytes is exactly the kind
   * of unhelpful green light this project bans. */
  if (request.method === 'GET' || request.method === 'HEAD') {
    return new Response(JSON.stringify({
      server: SERVER_NAME, version: SERVER_VERSION,
      transport: 'MCP streamable HTTP (JSON-RPC 2.0 over POST). This server opens no SSE stream, so ' +
        'GET is not supported.',
      usage: 'curl -sS -X POST ' + ORIGIN + '/mcp -H "content-type: application/json" ' +
        '-d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'',
      tools: TOOLS.map(function (t) { return t.name; }),
      protocolVersions: PROTOCOL_VERSIONS,
      restApi: ORIGIN + '/api', docs: DOCS, methodology: METHODOLOGY,
      sources: SOURCES
    }, null, 2) + '\n', { status: 405, headers: heads({ allow: 'POST, OPTIONS' }) });
  }

  if (request.method !== 'POST') {
    return rpcError(null, -32600, request.method + ' is not supported. MCP requests are POST.');
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return rpcError(null, -32700, 'Parse error: the request body is not valid JSON.');
  }

  try {
    /* Batches: answer only the requests, drop the notifications. An all-notification
     * batch gets 202 with no body, per the transport spec. */
    if (Array.isArray(payload)) {
      if (!payload.length) return rpcError(null, -32600, 'Invalid Request: empty batch.');
      const out = [];
      for (const msg of payload) {
        const res = await dispatch(context, msg || {});
        if (res) out.push(JSON.parse(await res.text()));
      }
      if (!out.length) return new Response(null, { status: 202, headers: heads() });
      return new Response(JSON.stringify(out, null, 2) + '\n', { status: 200, headers: heads() });
    }

    if (!payload || typeof payload !== 'object') {
      return rpcError(null, -32600, 'Invalid Request: expected a JSON-RPC object or an array of them.');
    }
    const res = await dispatch(context, payload);
    if (!res) return new Response(null, { status: 202, headers: heads() });
    return res;
  } catch (e) {
    /* Loud, not quiet — and never a plausible-looking wrong answer. */
    return rpcError(payload && payload.id, -32603,
      'Internal error while answering: ' + (e && e.message ? e.message : String(e)));
  }
}
