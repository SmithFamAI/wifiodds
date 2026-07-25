/* functions/_lib/reports.mjs — POST /api/report, the field-report intake.
 *
 * Same split as handlers.mjs: all the logic is here, functions/api/report.js is a
 * one-line route binding, and build/apitest.js imports this file and calls it
 * with a mock context. wrangler is not installed, so that suite is the only way
 * this gets tested before it ships.
 *
 * FOUR RULES, and every one of them shows up in the code below rather than in a
 * comment somewhere else.
 *
 * 1. NO ACCOUNTS. There is no login, no email field, no verification step and no
 *    magic link. A reader types what they measured and presses the button.
 *
 * 2. NO TRACKING. No cookie is set, no analytics call is made, nothing about the
 *    browser is recorded. The site's budget is zero off-origin requests from the
 *    page and it stays zero: this endpoint runs server-side, and the only host it
 *    ever talks to is the Supabase project named in env.SUPABASE_URL.
 *
 * 3. NO CAPTCHA. Turnstile, reCAPTCHA and hCaptcha are all third-party scripts,
 *    so all three are out under rule 2. Rate limiting is server-side instead:
 *    sha256(salt + address + the UTC hour), stored, and capped at five per hour.
 *    The raw address is hashed in memory and never written anywhere. Because the
 *    hour is inside the digest, the stored hash is not even linkable to the same
 *    visitor an hour later.
 *
 * 4. NOTHING PUBLISHES ITSELF. The insert is a SECURITY DEFINER function whose
 *    INSERT hardcodes published = false. This file could not publish a row if it
 *    tried, and it does not have the privilege to try. A human runs the UPDATE,
 *    then build/pull-reports.js copies the published rows into a committed file.
 *
 * The one fetch() in this repo's functions/ outside _lib/api.mjs is in here, and
 * apitest.js asserts that it can only ever target env.SUPABASE_URL.
 */

import { DOCS, ORIGIN, SOURCES, json } from './api.mjs';

/* Five per hashed address per UTC hour. Enforced again inside submit_report()
 * in Postgres, so a caller who somehow reached the database directly still hits
 * the same wall. */
export const RATE_CAP = 5;

export const SYSTEMS = ['starlink', 'leo', 'viasat', 'panasonic', 'intelsat',
  'hughes', 'none', 'unsure'];

export const MAX_BODY_BYTES = 8192;
export const EARLIEST_FLIGHT = '2018-01-01';

/* The field table IS the contract. Anything not named here is rejected by name,
 * the way the MCP tool schemas set additionalProperties:false — a form posting a
 * field we silently drop is a form whose author thinks it arrived.
 *
 * `alias` exists because a hand-written form reaches for the short name. Both
 * spellings are supported and both are documented; `name` is canonical and is
 * what the response echoes back. */
export const FIELDS = [
  { name: 'flownOn',      alias: ['date', 'flownAt'],            required: true,  kind: 'date' },
  { name: 'airline',      alias: [],                             required: true,  kind: 'text', max: 60 },
  { name: 'flightNumber', alias: ['flight', 'flightNo'],         required: true,  kind: 'flight' },
  { name: 'route',        alias: [],                             required: false, kind: 'route' },
  { name: 'aircraft',     alias: ['tail', 'aircraftType'],       required: false, kind: 'text', max: 40 },
  { name: 'system',       alias: [],                             required: true,  kind: 'enum' },
  { name: 'downMbps',     alias: ['down', 'download'],           required: false, kind: 'speed' },
  { name: 'upMbps',       alias: ['up', 'upload'],               required: false, kind: 'speed' },
  { name: 'latencyMs',    alias: ['latency', 'ping'],            required: false, kind: 'latency' },
  { name: 'wasFree',      alias: ['free'],                       required: false, kind: 'bool' },
  { name: 'note',         alias: ['comment'],                    required: false, kind: 'text', max: 500 },
  { name: 'credit',       alias: ['name', 'handle'],             required: false, kind: 'text', max: 60 }
];

/* A hidden input that a person never sees and never fills. Bots fill everything.
 * This is what replaces the captcha, and it costs zero third-party requests. */
export const HONEYPOT = 'website';

/* For whoever owns functions/_lib/handlers.mjs: splice this into the endpoints
 * array in apiIndex() and the API index documents the intake. It is exported
 * rather than pasted so there is one copy of the description. */
export const REPORT_ENDPOINT = {
  path: '/api/report',
  method: 'POST',
  returns: 'stores one in-flight speed report, unpublished, for a human to review',
  accepts: FIELDS.map(function (f) { return f.name + (f.required ? ' (required)' : ''); }),
  example: ORIGIN + '/api/report'
};

/* ── responses ─────────────────────────────────────────────────────────────
 * Same envelope and same CORS as the read endpoints: sources[] in every body,
 * docs, `access-control-allow-origin: *`. Two differences, both deliberate —
 * no-store instead of a cache TTL, and POST in the allowed methods. */
const POST_HEADERS = {
  'cache-control': 'no-store',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function reply(body, status, extra) {
  return json(body, status, Object.assign({}, POST_HEADERS, extra || {}));
}

/* The shape fail() builds in api.mjs, rebuilt here because fail() cannot take
 * response headers and a POST must not be cached for five minutes. */
function refuse(status, code, message, extra, headers) {
  return reply(Object.assign(
    { error: { status: status, code: code, message: message }, docs: DOCS },
    extra || {},
    { sources: SOURCES }
  ), status, headers);
}

export function guardPost(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: Object.assign({
        'access-control-allow-origin': '*',
        'access-control-max-age': '86400'
      }, POST_HEADERS)
    });
  }
  if (request.method !== 'POST') {
    return refuse(405, 'method_not_allowed',
      request.method + ' is not supported here. Send a report with POST and a JSON body. ' +
      'The read endpoints under /api are GET.');
  }
  return null;
}

/* ── parsing ───────────────────────────────────────────────────────────────
 * JSON is canonical. urlencoded is accepted too, so a plain <form method="post">
 * with no JavaScript at all reaches the same code — which matters on a site that
 * ships no third-party script and should keep working without its own. */
export function parseBody(text, contentType) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'application/json' || ct === 'text/json') {
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { error: 'The body parsed, but it is not a JSON object.' };
      }
      return { value: v };
    } catch (e) {
      return { error: 'The body is not valid JSON: ' + e.message };
    }
  }
  if (ct === 'application/x-www-form-urlencoded') {
    const p = new URLSearchParams(text);
    const v = {};
    p.forEach(function (val, k) { v[k] = val; });
    return { value: v };
  }
  return { unsupported: ct || '(none)' };
}

/* ── field coercion ────────────────────────────────────────────────────── */
function clean(s, max) {
  /* control characters out, runs of whitespace collapsed, then trimmed and cut */
  return String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isoToday(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

function coerceDate(raw, today) {
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { error: 'needs to look like 2026-07-11 (four-digit year, month, day).' };
  }
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return { error: '"' + s + '" is not a real date.' };
  }
  if (s > today) return { error: 'is in the future. Report the flight after you take it.' };
  if (s < EARLIEST_FLIGHT) {
    return { error: 'is before ' + EARLIEST_FLIGHT + '. Nothing that old tells us much about ' +
      'what is flying now.' };
  }
  return { value: s };
}

/* Same shape rule as parseFlight() in api.mjs, and the same normalised output,
 * so a report stored as UA212 matches what /api/score/ua-212 answers about. */
function coerceFlight(raw) {
  const s = String(raw).toUpperCase().replace(/[\s\-_./]/g, '');
  const m = /^([A-Z][A-Z0-9])0*(\d{1,4})[A-Z]?$/.exec(s);
  if (!m) {
    return { error: 'does not look like a flight number. Expected an airline code and up to four ' +
      'digits, e.g. UA212 or AS15.' };
  }
  return { value: m[1] + String(parseInt(m[2], 10)) };
}

function coerceRoute(raw) {
  const s = String(raw).toUpperCase().replace(/[‐-―\/→]/g, '-')
    .replace(/\s+TO\s+/g, '-').replace(/\s+/g, '');
  const m = /^([A-Z]{3})-([A-Z]{3})$/.exec(s);
  if (!m) return { error: 'needs two three-letter airport codes, e.g. DFW-IAH.' };
  if (m[1] === m[2]) return { error: 'has the same airport at both ends.' };
  return { value: m[1] + '-' + m[2] };
}

function coerceNumber(raw, lo, hi, unit, whole) {
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return { error: 'is not a number.' };
  } else if (!/^-?\d+(\.\d+)?$/.test(String(raw).trim())) {
    return { error: '"' + clean(raw, 20) + '" is not a number.' };
  }
  let n = Number(raw);
  if (whole) {
    if (Math.round(n) !== n) return { error: 'has to be a whole number of ' + unit + '.' };
  } else {
    n = Math.round(n * 100) / 100;
  }
  if (n < lo || n > hi) {
    return { error: 'is ' + n + ' ' + unit + '. Reports have to land between ' + lo + ' and ' +
      hi + ' ' + unit + ' — anything outside that is a typo or a broken speed test.' };
  }
  return { value: n };
}

function coerceBool(raw) {
  if (typeof raw === 'boolean') return { value: raw };
  const s = String(raw).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on', 'free'].indexOf(s) >= 0) return { value: true };
  if (['false', 'no', 'n', '0', 'off', 'paid'].indexOf(s) >= 0) return { value: false };
  return { error: 'has to be true or false.' };
}

/* ── the whole record ──────────────────────────────────────────────────────
 * Pure: no clock, no network, no environment. `today` is passed in so the
 * future-date rule can be tested against a fixed day. Returns the row the RPC
 * wants, or a field-by-field map of what is wrong with it. */
export function normaliseReport(input, today) {
  const errors = {};
  const row = {};
  const canon = {};
  FIELDS.forEach(function (f) {
    canon[f.name.toLowerCase()] = f;
    f.alias.forEach(function (a) { canon[a.toLowerCase()] = f; });
  });

  /* unknown keys are named, not ignored */
  const unknown = [];
  const got = {};
  Object.keys(input).forEach(function (k) {
    if (k === HONEYPOT) return;
    const f = canon[k.toLowerCase()];
    if (!f) { unknown.push(k); return; }
    const v = input[k];
    if (v === null || v === undefined || String(v).trim() === '') return;
    if (Object.prototype.hasOwnProperty.call(got, f.name)) {
      errors[f.name] = 'was sent twice under two names. Pick one.';
      return;
    }
    got[f.name] = v;
  });
  if (unknown.length) {
    errors._body = 'These fields are not part of a report: ' + unknown.slice(0, 8).join(', ') +
      '. The accepted ones are ' + FIELDS.map(function (f) { return f.name; }).join(', ') + '.';
  }

  FIELDS.forEach(function (f) {
    const has = Object.prototype.hasOwnProperty.call(got, f.name);
    if (!has) {
      if (f.required) errors[f.name] = 'is required.';
      return;
    }
    if (errors[f.name]) return;
    const raw = got[f.name];
    let r;
    if (f.kind === 'date') r = coerceDate(raw, today);
    else if (f.kind === 'flight') r = coerceFlight(raw);
    else if (f.kind === 'route') r = coerceRoute(raw);
    else if (f.kind === 'speed') r = coerceNumber(raw, 0, 5000, 'Mbps', false);
    else if (f.kind === 'latency') r = coerceNumber(raw, 1, 5000, 'ms', true);
    else if (f.kind === 'bool') r = coerceBool(raw);
    else if (f.kind === 'enum') {
      const s = String(raw).trim().toLowerCase();
      r = SYSTEMS.indexOf(s) >= 0 ? { value: s }
        : { error: '"' + clean(raw, 20) + '" is not one of ' + SYSTEMS.join(', ') + '.' };
    } else {
      const s = clean(raw, f.max);
      r = s.length ? { value: s } : { error: 'is empty once the whitespace comes off.' };
      if (!r.error && String(raw).length > f.max) {
        r = { error: 'is ' + String(raw).length + ' characters. The cap is ' + f.max + '.' };
      }
    }
    if (r.error) errors[f.name] = r.error;
    else row[f.name] = r.value;
  });

  /* A report with no measurement in it is a note, not a report. The exception is
   * the one that matters most to a reader: the aircraft had no wifi at all. */
  if (!errors.system && row.system && row.system !== 'none' &&
      row.downMbps === undefined && row.upMbps === undefined && row.latencyMs === undefined) {
    errors._body = 'A report needs at least one measurement: downMbps, upMbps or latencyMs. ' +
      'Send system "none" if the aircraft had no wifi to measure.';
  }

  return { row: row, errors: errors, ok: Object.keys(errors).length === 0 };
}

/* ── the hashed address ────────────────────────────────────────────────────
 * The address goes into a digest and nothing else. It is never logged, never
 * echoed, never stored. The UTC hour is part of the input, so the hash rolls
 * every hour on its own and two hours of the same visitor cannot be joined. */
export function hourStamp(now) {
  return (now || new Date()).toISOString().slice(0, 13);
}

export async function hashClientId(address, salt, stamp) {
  const bytes = new TextEncoder().encode(salt + '|' + address + '|' + stamp);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.prototype.map.call(new Uint8Array(digest), function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

export function clientAddress(request) {
  const h = request.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  /* Behind Cloudflare this cannot happen. If it somehow does, everyone shares one
   * bucket and the cap applies to all of them together, which fails toward fewer
   * rows rather than toward an unlimited firehose. */
  return 'no-address';
}

function secondsToNextHour(now) {
  const d = now || new Date();
  return 3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds());
}

/* ── the handler ───────────────────────────────────────────────────────── */
export async function submitReport(context) {
  const stop = guardPost(context.request);
  if (stop) return stop;

  const env = context.env || {};
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'REPORT_IP_SALT']
    .filter(function (k) { return !env[k]; });
  if (missing.length) {
    return refuse(503, 'intake_unconfigured',
      'The report intake is not configured on this deploy (missing ' + missing.join(', ') +
      '). Nothing was stored. This is our problem, not yours.');
  }

  const text = await context.request.text();
  if (text.length > MAX_BODY_BYTES) {
    return refuse(413, 'body_too_large',
      'That body is ' + text.length + ' bytes. The cap is ' + MAX_BODY_BYTES + '.');
  }
  const parsed = parseBody(text, context.request.headers.get('content-type'));
  if (parsed.unsupported) {
    return refuse(415, 'unsupported_media_type',
      'Send application/json (or application/x-www-form-urlencoded from a plain form). ' +
      'This request said ' + parsed.unsupported + '.');
  }
  if (parsed.error) return refuse(400, 'unparseable_body', parsed.error);

  /* The honeypot. A filled hidden field means a script, so nothing is stored —
   * and the response says so rather than pretending the row went in. */
  if (parsed.value[HONEYPOT] !== undefined && String(parsed.value[HONEYPOT]).trim() !== '') {
    return reply({
      ok: true, stored: false, published: false, id: null,
      why: 'A hidden field was filled in, which people cannot do and scripts always do. ' +
        'Nothing was stored. If you are a person seeing this, leave the field named "' +
        HONEYPOT + '" empty.',
      docs: DOCS, sources: SOURCES
    }, 202);
  }

  const now = new Date();
  const check = normaliseReport(parsed.value, isoToday(now));
  if (!check.ok) {
    const first = Object.keys(check.errors)[0];
    const lead = first === '_body' ? check.errors._body : first + ' ' + check.errors[first];
    return refuse(400, 'invalid_report',
      Object.keys(check.errors).length === 1 ? lead
        : lead + ' (' + (Object.keys(check.errors).length - 1) + ' other field' +
          (Object.keys(check.errors).length === 2 ? '' : 's') + ' too — see `fields`)',
      { fields: check.errors });
  }

  const ipHash = await hashClientId(clientAddress(context.request), env.REPORT_IP_SALT,
    hourStamp(now));

  const payload = Object.assign({}, check.row, { ipHash: ipHash });
  const endpoint = String(env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/rpc/submit_report';

  let res, out;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ p: payload })
    });
    out = await res.json();
  } catch (e) {
    return refuse(503, 'store_unavailable',
      'The report store did not answer, so nothing was stored. Try again in a minute: ' + e.message);
  }
  if (!res.ok) {
    return refuse(503, 'store_unavailable',
      'The report store answered ' + res.status + ' and nothing was stored.');
  }

  if (out && out.ok === false && out.code === 'rate_limited') {
    const wait = secondsToNextHour(now);
    return refuse(429, 'rate_limited',
      'That is ' + out.seen + ' reports from this connection in the last hour and the cap is ' +
      out.cap + '. Nothing was stored. The count resets in ' + Math.ceil(wait / 60) +
      ' minutes. If you have that many flights to report, mail them instead.',
      { cap: out.cap, resetsInSeconds: wait },
      { 'retry-after': String(wait) });
  }
  if (!out || out.ok !== true || !out.id) {
    return refuse(422, 'rejected',
      'The report store refused the row and nothing was stored' +
      (out && out.message ? ': ' + out.message : '.'));
  }

  return reply({
    ok: true,
    stored: true,
    id: out.id,
    published: false,
    kind: 'FIELD REPORT',
    report: check.row,
    remaining: out.remaining,
    whatHappensNext: 'It is in the queue and nothing on the site changes yet. Someone reads it, ' +
      'publishes it if it holds up, and the next build copies the published reports onto the ' +
      'pages. Field reports are labelled FIELD REPORT and are kept separate from the measured ' +
      'medians the methodology page cites.',
    docs: DOCS,
    sources: SOURCES
  }, 201);
}
