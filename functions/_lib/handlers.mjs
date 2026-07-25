/* functions/_lib/handlers.mjs — the four ConnectScore API v0 handlers.
 *
 * ALL of the logic lives here, and this file is native ESM that plain `node` can
 * import and call directly. The files under functions/api/ are one-line shims
 * that do nothing but bind a route to one of these. That split is deliberate:
 * wrangler is not installed on this machine, so the only way to TEST the API
 * before it ships is to import it from node — `build/apitest.js` does exactly
 * that, calls every handler with a mock context, and asserts on the bytes.
 * If real behaviour ever creeps into a shim it stops being testable. Don't.
 */

import { WIFI_AIRLINES } from './score.mjs';
import { TIER_METHOD_LINE, SCORE_METHOD_LINE, PROJECTION_METHOD_LINE,
  PROJECTION_CONFIDENCE } from './score.mjs';
import {
  API_VERSION, ORIGIN, DOCS, SOURCES,
  json, fail, guard, airlineJson, allAirlinesJson, parseFlight, findUnitedFlight, readAsset
} from './api.mjs';

/* ── GET /api ─────────────────────────────────────────────────────────── */
export function apiIndex(context) {
  const stop = guard(context.request);
  if (stop) return stop;
  const airlines = allAirlinesJson();
  return json({
    api: 'WiFi Odds ConnectScore API',
    version: API_VERSION,
    docs: DOCS,
    description: 'ConnectScore (0–100) for every airline we track, plus per-flight Starlink odds ' +
      'for United out of our own daily-cached route history. Free, no key, no accounts, ' +
      'CORS open to everyone. Read-only.',
    /* Imported, never typed: this string is the one in assets/airlines.js, so the
     * API index cannot describe a formula the site no longer uses. */
    method: SCORE_METHOD_LINE,
    /* Two numbers per airline, and the difference between them is the point.
     * Read both before you quote either. */
    nextGenMethod: TIER_METHOD_LINE,
    /* A third number, on `projected`, and the one a careless consumer will most
     * want to quote as if it were today. It is a share of a committed fleet, it
     * never sorts anything, and it carries its own date. */
    projectedMethod: PROJECTION_METHOD_LINE,
    projectedConfidence: PROJECTION_CONFIDENCE,
    serviceTiers: {
      'next-gen': 'Starlink or Amazon Leo across (effectively) the whole fleet.',
      streaming: 'Modern geostationary fleetwide — Viasat / 2Ku. Streams, uploads, real work.',
      basic: 'Legacy satellite service. Email and messaging.',
      mixed: 'Part next-gen, the rest streaming-class or basic.'
    },
    airlineCount: airlines.length,
    endpoints: [
      {
        path: '/api',
        returns: 'this index',
        example: ORIGIN + '/api'
      },
      {
        path: '/api/airlines',
        returns: 'every airline, best ConnectScore first',
        example: ORIGIN + '/api/airlines'
      },
      {
        path: '/api/airlines/{key}',
        returns: 'one airline; 404 JSON for an unknown key',
        keys: airlines.map(function (a) { return a.key; }),
        example: ORIGIN + '/api/airlines/qatar'
      },
      {
        path: '/api/score/{flightNumber}',
        returns: 'per-flight odds where we have route history (United), otherwise the coarse ' +
          'airline ConnectScore; 404 JSON for an untracked airline prefix',
        prefixes: airlines.map(function (a) { return a.code; }).filter(Boolean).sort(),
        example: ORIGIN + '/api/score/UA212'
      }
    ],
    caching: 'public, max-age=3600 on success; 300 on errors. Data is refreshed once a day.',
    politeness: 'This API never calls a third-party tracker or an airline. It only serves our own ' +
      'cached dataset from the same deploy. Please cache what you read and credit the sources below.',
    sources: SOURCES
  });
}

/* ── GET /api/airlines ────────────────────────────────────────────────── */
export function airlinesAll(context) {
  const stop = guard(context.request);
  if (stop) return stop;
  const airlines = allAirlinesJson();
  return json({
    count: airlines.length,
    asOf: airlines.length ? airlines[0].asOf : null,
    order: 'connectScore desc, then name',
    airlines: airlines,
    docs: DOCS,
    sources: SOURCES
  });
}

/* ── GET /api/airlines/{key} ──────────────────────────────────────────── */
export function airlineOne(context) {
  const stop = guard(context.request);
  if (stop) return stop;
  const raw = (context.params && context.params.key) || '';
  const key = String(Array.isArray(raw) ? raw[0] : raw).toLowerCase().replace(/\/+$/, '');
  const a = airlineJson(key);
  if (!a) {
    return fail(404, 'unknown_airline',
      'No airline with key "' + key + '". See `keys` for the full list.',
      { keys: Object.keys(WIFI_AIRLINES).sort() });
  }
  return json({ airline: a, docs: DOCS, sources: SOURCES });
}

/* ── GET /api/score/{flightNumber} ────────────────────────────────────────
 * Two honest answers, never blurred together:
 *
 *   method "route-history"  — we found this exact flight number in our cached
 *                             United route history, so `prob` is the odds for
 *                             THIS flight, from observations.
 *   method "airline-coarse" — we have no per-flight history for it, so all we
 *                             can offer is the airline's fleet-wide
 *                             ConnectScore. `prob` is null. Saying anything else
 *                             would be inventing precision.
 *
 * There is no third option where we go and ask a flight tracker. */
export async function scoreFlight(context) {
  const stop = guard(context.request);
  if (stop) return stop;

  const raw = (context.params && context.params.flight) || '';
  const asked = String(Array.isArray(raw) ? raw[0] : raw).replace(/\/+$/, '');
  const f = parseFlight(asked);

  if (!f) {
    return fail(400, 'unparseable_flight',
      '"' + asked + '" is not shaped like a flight number. Expected an airline code and up to ' +
      'four digits, e.g. UA212 or AS15.');
  }
  if (!f.key) {
    return fail(404, 'unknown_airline_prefix',
      'We do not track airline "' + f.code + '", so there is no ConnectScore for ' + f.flight + '.',
      { flight: f.flight, prefix: f.code, prefixes: Object.keys(WIFI_AIRLINES).map(function (k) {
        return WIFI_AIRLINES[k].code;
      }).filter(Boolean).sort() });
  }

  const airline = airlineJson(f.key);

  /* United is the only fleet with a per-flight history in this dataset. */
  if (f.key === 'united') {
    let data;
    try {
      data = await readAsset(context, '/united/data.json');
    } catch (e) {
      /* Loud, not quiet. data.json ships in this same deploy and the build asserts
       * it exists, so a failure here means the deploy is broken — answering with
       * the coarse score would hide that behind a plausible number. */
      return fail(503, 'dataset_unavailable',
        'The United dataset could not be read from this deploy: ' + e.message);
    }
    const hit = findUnitedFlight(data, f.flight);
    if (hit) {
      return json({
        flight: f.flight,
        airline: airline,
        prob: hit.prob,
        connectScore: airline.connectScore,
        method: 'route-history',
        evidence: {
          route: hit.route,
          routeLabel: hit.routeLabel,
          aircraft: hit.aircraft,
          departure: hit.departure,
          observations: hit.observations,
          confidence: hit.confidence,
          verdict: hit.verdict,
          dataset: hit.source,
          cachedAt: hit.cachedAt
        },
        interpretation: 'prob ' + hit.prob + '% is the share of recent observations of ' + f.flight +
          ' that were flown by a Starlink-equipped aircraft. connectScore ' + airline.connectScore +
          ' is the fleet-wide United figure, for comparison. Aircraft assignments change until ' +
          'departure — this is a historical estimate, not a guarantee.',
        asOf: data.updated || airline.asOf,
        moreDetail: ORIGIN + '/united/',
        docs: DOCS,
        sources: SOURCES
      });
    }
    return json({
      flight: f.flight,
      airline: airline,
      prob: null,
      connectScore: airline.connectScore,
      method: 'airline-coarse',
      evidence: null,
      interpretation: f.flight + ' is not in our cached route history, so there is no per-flight ' +
        'number for it. connectScore ' + airline.connectScore + ' is United fleet-wide: ' +
        airline.fleet.equipped + ' of ' + airline.fleet.total + ' aircraft equipped. Search the ' +
        'route at ' + ORIGIN + '/united/ to have it cached.',
      asOf: data.updated || airline.asOf,
      moreDetail: ORIGIN + '/united/',
      docs: DOCS,
      sources: SOURCES
    });
  }

  return json({
    flight: f.flight,
    airline: airline,
    prob: null,
    connectScore: airline.connectScore,
    method: 'airline-coarse',
    evidence: null,
    interpretation: 'We have no per-flight history for ' + airline.name + ' — no verified per-tail ' +
      'feed exists for this fleet yet. connectScore ' + airline.connectScore + ' is fleet-wide: ' +
      (airline.fleet.total
        ? airline.fleet.equipped + ' of ' + airline.fleet.total + ' aircraft carry ' +
          airline.system.label + ' (' + airline.fleet.equippedPct + '%)'
        : airline.system.label + ' fleetwide') +
      ', weighted by system quality and by whether it is free for you.',
    asOf: airline.asOf,
    moreDetail: airline.url,
    docs: DOCS,
    sources: SOURCES
  });
}
