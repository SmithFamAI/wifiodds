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
  json, fail, guard, airlineJson, allAirlinesJson
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
        retired: '2026-07-26',
        returns: '410 Gone. A flight number with no date answers "what usually happens on this ' +
          'route," not "will MY flight have it." For United, the per-tail source of truth is ' +
          'https://unitedstarlinktracker.com — check-flight/{flightNumber}/{date} there answers a ' +
          'specific departure. The WiFi Odds browser extension reads the flight and date off the ' +
          'airline\'s own booking page and answers the same way. Use /api/airlines/{key} here for ' +
          'the fleet-wide figure.',
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

/* ── GET /api/score/{flightNumber} — RETIRED 2026-07-26 (spec D7) ──────────
 * This endpoint took a flight number with no date and answered "what usually
 * happens on this route," which is not the question a traveller with a booked
 * seat is actually asking — that needs a date, and this endpoint never took
 * one. The deterministic per-flight answer is the WiFi Odds browser
 * extension's job: it runs on united.com, Navan, alaskaair.com and Google
 * Flights, where the flight AND the date are already on the page, so it needs
 * no proxy and no scraping. 410, not 404: this was a documented public
 * endpoint and a reader who bookmarked it deserves to be told where the
 * answer went, not a bare "not found." get_airline_score / GET
 * /api/airlines/{key} is unaffected — the fleet-wide figure was never this
 * endpoint's job either. */
export function scoreFlightGone(context) {
  const stop = guard(context.request);
  if (stop) return stop;
  return fail(410, 'endpoint_retired',
    'GET /api/score/{flightNumber} was retired 2026-07-26. A flight number with no date only ever ' +
    'answered "what usually happens on this route," not "will MY flight have it." For a real ' +
    'per-flight answer, check https://unitedstarlinktracker.com/check-flight/{flightNumber}/{date} ' +
    '(United) or install the WiFi Odds browser extension, which reads the flight and date off the ' +
    'airline\'s own booking page. For the fleet-wide figure, use GET /api/airlines/{key}.',
    { retiredAt: '2026-07-26', useInstead: ORIGIN + '/api/airlines/{key}',
      handoff: 'https://unitedstarlinktracker.com', docs: DOCS });
}
