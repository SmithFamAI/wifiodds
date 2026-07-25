/* functions/_lib/api.mjs — shared plumbing for the public ConnectScore API v0.
 *
 * Cloudflare Pages Functions. Native ESM, ZERO dependencies, no build step of
 * its own: Pages bundles functions/ automatically alongside the static output of
 * `node build/prerender.js`.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. ONE FORMULA. Every score here comes from ./score.mjs, which is GENERATED
 *    from assets/airlines.js by build/prerender.js. The site pages and the API
 *    therefore cannot disagree: /airlines/qatar/ says 58 because scoreAirline
 *    ('qatar').score is 58, and this API says 58 for exactly the same reason,
 *    out of exactly the same source text. Never hand-write a coefficient here.
 *
 * 2. NO THIRD-PARTY REQUESTS. The API only ever reads our own cached data
 *    (united/data.json, served from the same deploy through env.ASSETS). It does
 *    not call unitedstarlinktracker.com, alaskastarlinktracker.com, united.com
 *    or any flight tracker. Our traffic must never become their bill — that is
 *    politeness, and it is also why every response carries `sources`.
 *
 * Files in functions/ that start with `_` are NOT routed by Pages, so this is a
 * library, not an endpoint.
 */

import { WIFI_AIRLINES, SCORE_CAVEAT, SCORE_METHOD_LINE, TIER_METHOD_LINE,
  scoreAirline, rankAirlines } from './score.mjs';

export const API_VERSION = 'v0';
export const ORIGIN = 'https://wifiodds.com';
export const DOCS = ORIGIN + '/api/docs/';

/* Success is cacheable for an hour (the data changes once a day). Errors get a
 * much shorter TTL on purpose: an unknown flight number today can be a known one
 * after tomorrow's data pull, and a 404 pinned in the edge cache for an hour
 * would keep lying after the answer changed. */
export const CACHE_OK = 'public, max-age=3600';
export const CACHE_ERR = 'public, max-age=300';

/* Credit, in every single response body. Non-negotiable: the fleet numbers are
 * not ours, and an API makes them trivially re-publishable without the page that
 * carries the credit strip. */
export const SOURCES = [
  {
    name: 'unitedstarlinktracker.com',
    url: 'https://unitedstarlinktracker.com',
    by: '@martinamps',
    covers: 'United per-tail fleet verification and per-flight Starlink history'
  },
  {
    name: 'alaskastarlinktracker.com',
    url: 'https://alaskastarlinktracker.com',
    by: '@martinamps',
    covers: 'Alaska per-tail fleet verification'
  },
  {
    name: 'Public airline announcements (July 2026)',
    url: ORIGIN + '/airlines/',
    covers: 'every airline other than United and Alaska'
  },
  {
    name: 'WiFi Odds',
    url: ORIGIN + '/',
    covers: 'the ConnectScore method itself',
    method: SCORE_METHOD_LINE,
    nextGenMethod: TIER_METHOD_LINE,
    caveat: SCORE_CAVEAT,
    citation: 'Please credit unitedstarlinktracker.com / alaskastarlinktracker.com ' +
      '(@martinamps) when re-publishing fleet numbers, and wifiodds.com for the ConnectScore. ' +
      'WiFi Odds is unofficial and not affiliated with any airline, SpaceX/Starlink, Amazon, ' +
      'Viasat, or the trackers.'
  }
];

function headers(cache, extra) {
  return Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-max-age': '86400',
    'x-connectscore-api': API_VERSION
  }, extra || {});
}

/* Pretty-printed on purpose: this is meant to be read in a terminal with curl,
 * and gzip makes the whitespace nearly free. */
export function json(body, status, extra) {
  const code = status || 200;
  return new Response(JSON.stringify(body, null, 2) + '\n', {
    status: code,
    headers: headers(code >= 400 ? CACHE_ERR : CACHE_OK, extra)
  });
}

export function fail(status, code, message, extra) {
  return json(Object.assign({
    error: { status: status, code: code, message: message },
    docs: DOCS
  }, extra || {}, { sources: SOURCES }), status);
}

/* CORS preflight + method guard. GET/HEAD only — there is nothing here to write. */
export function guard(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headers(CACHE_OK) });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return fail(405, 'method_not_allowed',
      request.method + ' is not supported. This API is read-only: GET or HEAD.');
  }
  return null;
}

function round(n, places) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

/* ── one airline, JSON ─────────────────────────────────────────────────────
 * Every field is derived, nothing is transcribed. `connectScore` is the same
 * integer the airline's own page prints in its score ring. */
export function airlineJson(key) {
  const e = WIFI_AIRLINES[key];
  const a = scoreAirline(key);
  if (!e || !a) return null;
  return {
    key: key,
    name: a.name,
    code: a.code,
    connectScore: a.score,
    band: a.label,
    /* ── ADDITIVE, v0-safe. Everything above and below keeps its meaning; these
     * two are the headline/today split the site now shows.
     *   nextGenScore — odds of a Starlink or Amazon Leo aircraft × free-for-you.
     *                  ZERO for a signed-but-unflown deal: Delta is 0 here and 60
     *                  in connectScore, and both numbers are correct answers to
     *                  different questions.
     *   serviceTier  — next-gen | streaming | basic | mixed: what the fleet
     *                  actually delivers today. `rest` is the tier on the part of
     *                  the fleet that is not next-gen yet; null when there is no
     *                  such part, "unknown" when we have not verified it. */
    nextGenScore: a.nextGenScore,
    nextGen: {
      score: a.nextGenScore,
      system: a.nextGenSystem,
      label: a.nextGenLabel,
      share: round(a.nextGenShare, 4),
      pct: Math.round(a.nextGenShare * 100)
    },
    serviceTier: a.serviceTier,
    service: {
      tier: a.serviceTier,
      label: a.serviceTierLabel,
      rest: a.restTier,
      restLabel: a.restTierLabel,
      means: a.serviceTierBlurb
    },
    system: { key: a.system, label: a.systemLabel, quality: a.parts.systemQuality },
    free: { status: e.free || 'unknown', factor: a.parts.freeFactor },
    fleet: {
      equipped: a.equipped,
      total: a.fleet,
      equippedShare: round(a.parts.pctEquipped, 4),
      equippedPct: Math.round(a.parts.pctEquipped * 100),
      basis: a.fleet ? 'tail-counts' : 'fleetwide-coverage'
    },
    perFlightOdds: a.instrumented,
    tracker: a.tracker,
    future: a.future,
    note: a.note,
    asOf: a.asOf,
    url: ORIGIN + '/airlines/' + key + '/'
  };
}

/* Best odds first — the same order, from the same function, as the leaderboard. */
export function allAirlinesJson() {
  return rankAirlines().map(function (a) { return airlineJson(a.key); });
}

/* ── flight numbers ───────────────────────────────────────────────────────
 * The prefix table is DERIVED from the airline map, so a newly added airline
 * gets a working /api/score/ prefix the moment its entry lands. */
export const CODE_TO_KEY = (function () {
  const m = {};
  Object.keys(WIFI_AIRLINES).forEach(function (k) {
    const c = WIFI_AIRLINES[k].code;
    if (c) m[String(c).toUpperCase()] = k;
  });
  return m;
})();

/* "ua212" · "UA 212" · "UA0212" · "AS15" · "B6123" → {code, key, number, flight}
 * null when it is not shaped like a flight number at all; key:null when the
 * shape is fine but we do not track that carrier. */
export function parseFlight(raw) {
  const s = String(raw == null ? '' : raw).toUpperCase().replace(/[\s\-_./]/g, '');
  const m = /^([A-Z][A-Z0-9])0*(\d{1,4})[A-Z]?$/.exec(s);
  if (!m) return null;
  const code = m[1];
  const number = parseInt(m[2], 10);
  return {
    code: code,
    key: CODE_TO_KEY[code] || null,
    number: number,
    flight: code + String(number)
  };
}

/* ── United per-flight odds, out of our own cached dataset ────────────────
 * data.json carries the same flight number in up to three places. Richest wins:
 *   routes[]                        — the curated routes: aircraft, departure
 *                                     time, verdict
 *   routeCache[].flights            — the 48 cached routes: prob, obs, conf
 *   routeCache[].itineraries[].legs — connection legs, the thinnest record
 * None of it is fetched live; it is all yesterday's pull, already on our disk. */
const SOURCE_RANK = { routes: 0, routeCache: 1, itinerary: 2 };

export function findUnitedFlight(data, flight) {
  const want = String(flight).toUpperCase();
  let best = null;
  function offer(c) {
    if (!c || typeof c.prob !== 'number') return;
    if (!best || SOURCE_RANK[c.source] < SOURCE_RANK[best.source]) best = c;
  }
  const routes = (data && data.routes) || {};
  Object.keys(routes).forEach(function (r) {
    ((routes[r] || {}).flights || []).forEach(function (f) {
      if (String(f.fn).toUpperCase() !== want) return;
      offer({
        source: 'routes', prob: f.prob, route: r, routeLabel: routes[r].label || null,
        aircraft: f.aircraft || null, departure: f.dep || null,
        observations: typeof f.obs === 'number' ? f.obs : null,
        confidence: f.conf || null, verdict: f.verdict || null, cachedAt: null
      });
    });
  });
  const cache = (data && data.routeCache) || {};
  Object.keys(cache).forEach(function (r) {
    const c = cache[r] || {};
    (c.flights || []).forEach(function (f) {
      if (String(f.fn).toUpperCase() !== want) return;
      offer({
        source: 'routeCache', prob: f.prob, route: r, routeLabel: null,
        aircraft: null, departure: null,
        observations: typeof f.obs === 'number' ? f.obs : null,
        confidence: f.conf || null, verdict: null, cachedAt: c.ts || null
      });
    });
    (c.itineraries || []).forEach(function (it) {
      (it.legs || []).forEach(function (l) {
        if (String(l.fn).toUpperCase() !== want) return;
        offer({
          source: 'itinerary', prob: l.p, route: l.route || r, routeLabel: null,
          aircraft: null, departure: null,
          observations: typeof l.obs === 'number' ? l.obs : null,
          confidence: l.conf || null, verdict: null, cachedAt: c.ts || null
        });
      });
    });
  });
  return best;
}

/* Read a file out of THIS deploy's static assets. env.ASSETS is the Pages
 * binding; the same-origin fetch is a fallback for a runtime that does not
 * expose it. Either way the request never leaves our own deploy — see rule 2 at
 * the top of this file. */
export async function readAsset(context, path) {
  const url = new URL(path, new URL(context.request.url).origin);
  const assets = context.env && context.env.ASSETS;
  const fetcher = assets && typeof assets.fetch === 'function'
    ? assets.fetch.bind(assets)
    : fetch;
  const res = await fetcher(new Request(url.toString(), { headers: { accept: 'application/json' } }));
  if (!res || !res.ok) {
    throw new Error('asset ' + path + ' unavailable (' + (res ? res.status : 'no response') + ')');
  }
  return res.json();
}
