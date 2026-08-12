/* functions/_lib/api.mjs — shared plumbing for the public WiFi Odds API v0.
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
/* The dedicated /api/docs/ HTML page was removed in the 28 Jul cut (301 to /).
   The surviving documentation surface is /methodology/, so every `docs:` field
   points there now rather than at a redirect (round 18, P1-01). */
export const DOCS = ORIGIN + '/methodology/';

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
    url: ORIGIN + '/#all',
    covers: 'every airline other than United and Alaska'
  },
  {
    name: 'WiFi Odds',
    url: ORIGIN + '/',
    covers: 'the Streaming score method itself',
    method: SCORE_METHOD_LINE,
    nextGenMethod: TIER_METHOD_LINE,
    caveat: SCORE_CAVEAT,
    citation: 'Please credit unitedstarlinktracker.com / alaskastarlinktracker.com ' +
      '(@martinamps) when re-publishing fleet numbers, and wifiodds.com for the Streaming score. ' +
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
    'x-wifiodds-api': API_VERSION,
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
 * Every field is derived, nothing is transcribed. `streamingScore` is the
 * current name for the same integer the airline's own page prints in its score
 * ring. The connectScore fields remain as deprecated compatibility aliases. */
export function airlineJson(key) {
  const e = WIFI_AIRLINES[key];
  const a = scoreAirline(key);
  if (!e || !a) return null;
  const result = {
    key: key,
    name: a.name,
    code: a.code,
    connectScore: a.score,
    band: a.label,
    /* ── round-18 P0-02: the whole-fleet recommendation contract ──────────
     *   connectScore / connectScoreLower — the published WHOLE-FLEET lower
     *     bound. Every ranking and "best" result uses this and only this.
     *   connectScoreUpper — the whole-fleet upper bound. It communicates
     *     uncertainty, never expected performance; do not sort on it.
     *   wholeFleet — total, resolved, unresolved, coverage, and the fleet
     *     evidence status (fleetwide | mixed | limited evidence).
     *   resolvedSubsetScore — the known-only diagnostic, "Among resolved
     *     aircraft". It is NOT a floor, a rank, a band, or a recommendation. A
     *     partial fleet whose resolved subset is 100 (airBaltic) still has a
     *     whole-fleet lower bound far below a fleetwide leader. */
    connectScoreLower: a.connectScoreLower,
    connectScoreUpper: a.connectScoreUpper,
    /* The UNROUNDED lower bound, so a consumer can reproduce the rank: American's
       51.036 sits above airBaltic's 50.909 even though both display 51. */
    connectScoreExact: round(a.scoreExact, 3),
    fleetStatus: a.fleetStatus,
    wholeFleet: {
      total: a.total,
      resolved: a.known,
      unresolved: a.unresolved || 0,
      coveragePct: a.coveragePct,
      lower: a.connectScoreLower,
      upper: a.connectScoreUpper,
      status: a.fleetStatus,
      source: 'wifiodds.com Streaming score, whole-fleet lower bound',
      asOf: a.asOf
    },
    resolvedSubsetScore: {
      label: 'Among resolved aircraft',
      score: a.resolvedSubsetScore,
      ceiling: a.resolvedSubsetCeiling,
      basis: a.known != null ? a.known + ' resolved aircraft, unresolved excluded' : null
    },
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
      /* False unless nextGenScore's 0 IS a false zero — see nextGenPublished()
       * in assets/airlines.js. score/system/label stay as computed (the floor
       * concept holds regardless, same as connectScore), but a consumer must
       * check this before reading share/pct as a real percentage: both are
       * null, never 0, when the count behind them was never published. This
       * is what SAS exposed 2026-07-26 — see the commit for the HTML side. */
      published: a.nextGenPublished !== false,
      system: a.nextGenSystem,
      label: a.nextGenLabel,
      share: a.nextGenPublished === false ? null : round(a.nextGenShare, 4),
      pct: a.nextGenPublished === false ? null : Math.round(a.nextGenShare * 100),
      /* ── D2: next-gen odds split by mainline vs regional fleet. United-only
       * today — see nextGenSplitFor() in assets/airlines.js for why a crosstab
       * for anyone else would be invented data.
       *   state      "value" | "no-regional-fleet" | "split-not-published" |
       *              "no-mainline-fleet". A STATE IS NOT A ZERO: mainline/
       *              regional are null whenever state is not "value".
       *   mainline / regional   { aircraft, of, pct } or null. */
      split: {
        state: a.nextGenSplit.state,
        mainline: a.nextGenSplit.mainline ? {
          aircraft: a.nextGenSplit.mainline.n,
          of: a.nextGenSplit.mainline.of,
          pct: a.nextGenSplit.mainline.pct
        } : null,
        regional: a.nextGenSplit.regional ? {
          aircraft: a.nextGenSplit.regional.n,
          of: a.nextGenSplit.regional.of,
          pct: a.nextGenSplit.regional.pct
        } : null
      }
    },
    serviceTier: a.serviceTier,
    service: {
      tier: a.serviceTier,
      label: a.serviceTierLabel,
      rest: a.restTier,
      restLabel: a.restTierLabel,
      means: a.serviceTierBlurb
    },
    /* ── ADDITIVE, v0-safe: the segmented model (July 2026).
     *   floor / ceiling — connectScore IS the floor (the whole-fleet lower
     *                     bound). ceiling rises above it when a segment names
     *                     more than one possible system with no published split,
     *                     OR when the fleet has unresolved aircraft (their share
     *                     is the gap). Quote the floor; it is what we publish.
     *   resolution      — how the segments were sourced: tail | type | systems |
     *                     announced. null for an airline still on the legacy
     *                     single-system path.
     *   segments[]      — the ledger, in the order the site prints it. The rows
     *                     sum to the floor; the build fails if they do not.
     *   unresolved      — aircraft whose system the airline does not publish.
     *                     They stay IN the whole-fleet denominator and add zero
     *                     to the lower bound, which is why known is less than
     *                     total and the score falls as coverage drops. */
    floor: a.floor,
    ceiling: a.ceiling,
    resolution: a.resolution,
    resolutionLabel: a.resolutionLabel,
    segments: a.segments ? a.segments.map(function (r) {
      return {
        systems: r.systems,
        label: r.systemLabel,
        tier: r.tier,
        aircraft: r.n,
        share: round(r.share, 4),
        quality: r.qMin === r.qMax ? r.qMin : { min: r.qMin, max: r.qMax },
        free: { status: r.free, factor: r.freeFactor },
        points: r.qMin === r.qMax ? round(r.pointsMin, 2)
          : { min: round(r.pointsMin, 2), max: round(r.pointsMax, 2) },
        nextGen: r.nextGen,
        splitPublished: !r.split,
        inferred: r.assumed,
        source: r.src,
        asOf: r.as,
        note: r.note
      };
    }) : null,
    /* null when there is nothing unresolved, rather than a zero-count object: a
     * consumer should be able to test the field, not the count inside it. */
    unresolved: a.ledger && a.unresolved
      ? { aircraft: a.unresolved, why: a.unresolvedWhy, inDenominator: true,
          /* Round-18 P0-02: unresolved aircraft ARE in the whole-fleet
             denominator. They add zero to the lower bound and their whole share
             (this fraction of 100) to the upper bound. */
          share: round((a.unresolved / a.total) || 0, 4),
          inLowerBound: 0, inUpperBound: round(((a.unresolved / a.total) || 0) * 100, 2) }
      : null,
    /* ── ADDITIVE, v0-safe: the projected score (July 2026).
     * An OBJECT or null, and deliberately NOT a sibling integer next to
     * connectScore. A consumer that wants the number has to take `horizon` and
     * `confidence` with it, which is the same fence the site renders under.
     *
     *   score       — the next-gen number this fleet would carry if the deal
     *                 lands: committed aircraft ÷ known fleet × 1.00 (LEO) ×
     *                 free-for-you. Compare it to nextGenScore, never to
     *                 connectScore, and never sort on it.
     *   horizon     — the airline's own words for when, and it never changes,
     *                 including after the date has passed.
     *   confidence  — FIRM | SOFT | SLIPPED. SLIPPED is computed from the build
     *                 date, so a missed promise labels itself.
     *   installed   — aircraft of the committed system flying TODAY. Zero for
     *                 every Amazon Leo deal, because Leo has no aircraft at all.
     *   line        — the three of them pre-composed, for a caller with one slot.
     *
     * It is a share of a committed fleet, not a measurement. Nobody has measured
     * Amazon Leo in a cabin. */
    projected: a.projected ? {
      score: a.projected.score,
      share: round(a.projected.share, 4),
      pct: Math.round(a.projected.share * 100),
      aircraft: a.projected.aircraft,
      aircraftPublished: a.projected.aircraftPublished,
      known: a.projected.known,
      system: a.projected.system,
      systemLabel: a.projected.systemLabel,
      quality: a.projected.quality,
      free: { status: a.projected.free, factor: a.projected.freeFactor },
      starts: a.projected.starts,
      by: a.projected.by,
      horizon: a.projected.horizon,
      horizonEnd: a.projected.horizonEnd,
      horizonPassed: a.projected.horizonPassed,
      installed: a.projected.installed,
      confidence: a.projected.confidence,
      confidenceMeans: a.projected.confidenceMeans,
      slipped: a.projected.slipped,
      parts: a.projected.parts,
      line: a.projected.line,
      basis: a.projected.basis,
      means: a.projected.means,
      source: a.projected.src,
      asOf: a.projected.as,
      note: a.projected.note
    } : null,
    system: { key: a.system, label: a.systemLabel, quality: a.parts.systemQuality },
    free: { status: e.free || 'unknown', factor: a.parts.freeFactor },
    fleet: {
      equipped: a.equipped,
      total: a.fleet,
      known: a.known,
      /* Mirrors nextGen.published above: false is the SAS shape, and
       * equippedShare/equippedPct are null rather than 0 in that case, same
       * as `equipped` itself. Math.round(null * 100) is 0 in JS — the exact
       * silent path that put "(0%)" on the rendered SAS page until this was
       * caught. A consumer must check this field before trusting the pct. */
      equippedPublished: a.equippedPublished !== false,
      equippedShare: a.equippedPublished === false ? null : round(a.parts.pctEquipped, 4),
      equippedPct: a.equippedPublished === false ? null : Math.round(a.parts.pctEquipped * 100),
      basis: a.fleet ? 'tail-counts' : 'fleetwide-coverage'
    },
    perFlightOdds: a.instrumented,
    tracker: a.tracker,
    future: a.future,
    note: a.note,
    asOf: a.asOf
    /* the per-airline `url` (/airlines/<key>/) was dropped in the 28 Jul cut:
       those pages are gone, so a machine client would have followed a 301 to an
       unrelated home page. Their data is this very object (round 18, P1-01). */
  };
  /* Keep the v0 contract byte-for-byte equivalent for existing clients. These
   * are aliases of the values already published above, never a second scoring
   * calculation or a coverage percentage. */
  result.streamingScore = result.connectScore;
  result.streamingScoreLower = result.connectScoreLower;
  result.streamingScoreUpper = result.connectScoreUpper;
  result.streamingScoreExact = result.connectScoreExact;
  return result;
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
