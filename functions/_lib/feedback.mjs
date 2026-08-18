/* functions/_lib/feedback.mjs — product feedback intake.
 *
 * POST /api/feedback stores one row. GET /api/feedback/feed is the JSON the
 * Danger board polls. Neither path is /api/report (in-flight WiFi reports).
 *
 * Bindings the Pages project has to attach, by name:
 *   FEEDBACK_DB          D1  wifiodds-feedback
 *   FEEDBACK_SHOTS       R2  wifiodds-feedback-shots
 * Secrets:
 *   FEEDBACK_FEED_TOKEN  Bearer token for the feed and screenshot fetch
 *   FEEDBACK_IP_SALT     hourly rate-limit hash (falls back to REPORT_IP_SALT)
 *   RESEND_API_KEY       only used if the submitter asked for a copy
 *   RESEND_FROM          verified sender, same condition
 *
 * A copy goes to the submitter only when they ticked that box. The feed is how
 * new rows show up.
 */

import { DOCS, ORIGIN, SOURCES, json } from './api.mjs';
import { HONEYPOT, RATE_CAP, clientAddress, guardPost, hashClientId, hourStamp,
  parseBody } from './reports.mjs';

export const FEEDBACK_RATE_CAP = RATE_CAP;
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
export const MAX_MESSAGE = 8000;
export const MAX_NAME = 80;
export const MAX_EMAIL = 254;
export const MAX_SHOTS = 5;
export const MAX_SHOT_BYTES = 2 * 1024 * 1024;
export const SHOT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export const SQL = {
  selectBucket: 'SELECT seen, cap FROM rate_buckets WHERE ip_hash = ?',
  insertBucket: 'INSERT INTO rate_buckets (ip_hash, seen, cap) VALUES (?, 1, ?)',
  bumpBucket: 'UPDATE rate_buckets SET seen = seen + 1 WHERE ip_hash = ?',
  insertRow: 'INSERT INTO submissions (id, created_at, status, name, email, message, ' +
    'send_copy, allow_followup, copy_sent, screenshots_json, ip_hash) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  getRow: 'SELECT * FROM submissions WHERE id = ?',
  listRows: 'SELECT * FROM submissions ORDER BY created_at DESC LIMIT 100',
  countByStatus: 'SELECT status, COUNT(*) AS n FROM submissions GROUP BY status',
  setStatus: 'UPDATE submissions SET status = ? WHERE id = ?',
  setCopySent: 'UPDATE submissions SET copy_sent = 1 WHERE id = ?'
};

const POST_HEADERS = {
  'cache-control': 'no-store',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

const FEED_HEADERS = {
  'cache-control': 'no-store',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function reply(body, status, extra) {
  return json(body, status, Object.assign({}, POST_HEADERS, extra || {}));
}

function refuse(status, code, message, extra, headers) {
  return reply(Object.assign(
    { error: { status: status, code: code, message: message }, docs: DOCS },
    extra || {},
    { sources: SOURCES }
  ), status, headers);
}

function feedReply(body, status, extra) {
  return json(body, status, Object.assign({}, FEED_HEADERS, extra || {}));
}

function feedRefuse(status, code, message, extra) {
  return feedReply(Object.assign(
    { error: { status: status, code: code, message: message } },
    extra || {}
  ), status);
}

function clean(s, max) {
  return String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asBool(raw) {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0 || raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'on';
}

export function coerceEmail(raw) {
  const s = clean(raw, MAX_EMAIL).toLowerCase();
  if (!s) return { error: 'is required.' };
  if (s.length > MAX_EMAIL) return { error: 'is longer than ' + MAX_EMAIL + ' characters.' };
  if (!/^[a-z0-9._%+'!-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) {
    return { error: 'does not look like an email address.' };
  }
  return { value: s };
}

export function normaliseFeedback(input) {
  const errors = {};
  const row = {};
  const unknown = [];
  const known = {
    message: 1, email: 1, name: 1, sendcopy: 1, allowfollowup: 1, screenshots: 1
  };
  Object.keys(input || {}).forEach(function (k) {
    if (k === HONEYPOT) return;
    const key = String(k).toLowerCase().replace(/[_-]/g, '');
    if (key === 'sendmecopy' || key === 'copy') return;
    if (!known[key] && key !== 'screenshot') unknown.push(k);
  });
  if (unknown.length) {
    errors._body = 'These fields are not part of a feedback submission: ' +
      unknown.slice(0, 8).join(', ') + '. The accepted ones are message, email, name, ' +
      'sendCopy, allowFollowup, screenshots.';
  }

  const message = input.message == null ? '' : String(input.message);
  const trimmed = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!trimmed) errors.message = 'is required.';
  else if (trimmed.length > MAX_MESSAGE) {
    errors.message = 'is ' + trimmed.length + ' characters. The cap is ' + MAX_MESSAGE + '.';
  } else row.message = trimmed;

  const email = coerceEmail(input.email);
  if (email.error) errors.email = email.error;
  else row.email = email.value;

  if (input.name != null && String(input.name).trim() !== '') {
    const name = clean(input.name, MAX_NAME);
    if (!name) errors.name = 'is empty once the whitespace comes off.';
    else if (String(input.name).trim().length > MAX_NAME) {
      errors.name = 'is longer than ' + MAX_NAME + ' characters.';
    } else row.name = name;
  }

  row.sendCopy = asBool(input.sendCopy);
  row.allowFollowup = asBool(input.allowFollowup);
  return { row: row, errors: errors, ok: Object.keys(errors).length === 0 };
}

export function wantsHtml(request) {
  const accept = String(request.headers.get('accept') || '').toLowerCase();
  const ct = String(request.headers.get('content-type') || '').toLowerCase();
  if (ct.indexOf('application/json') >= 0) return false;
  if (accept.indexOf('application/json') >= 0 && accept.indexOf('text/html') < 0) return false;
  return accept.indexOf('text/html') >= 0 ||
    ct.indexOf('multipart/form-data') >= 0 ||
    ct.indexOf('application/x-www-form-urlencoded') >= 0;
}

function htmlPage(title, body) {
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' · WiFi Odds</title>' +
    '<link rel="canonical" href="' + ORIGIN + '/feedback/">' +
    '</head><body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem">' +
    body + '</body></html>\n';
}

function htmlResponse(status, title, body) {
  return new Response(htmlPage(title, body), {
    status: status,
    headers: Object.assign({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }, POST_HEADERS)
  });
}

function secondsToNextHour(now) {
  const d = now || new Date();
  return 3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds());
}

function ipSalt(env) {
  return env.FEEDBACK_IP_SALT || env.REPORT_IP_SALT || '';
}

export function resendHost(env) {
  return env.RESEND_API_HOST || ['api', 'resend', 'com'].join('.');
}

function missingStore(env) {
  const missing = [];
  if (!env.FEEDBACK_DB) missing.push('FEEDBACK_DB');
  if (!env.FEEDBACK_SHOTS) missing.push('FEEDBACK_SHOTS');
  if (!ipSalt(env)) missing.push('FEEDBACK_IP_SALT');
  return missing;
}

function objectFromForm(fd) {
  const v = {};
  fd.forEach(function (val, k) {
    if (typeof File !== 'undefined' && val instanceof File) return;
    if (v[k] === undefined) v[k] = val;
  });
  return v;
}

async function filesFromForm(fd) {
  const out = [];
  const names = ['screenshots', 'screenshot'];
  for (let i = 0; i < names.length; i++) {
    const all = fd.getAll(names[i]);
    for (let j = 0; j < all.length; j++) {
      const f = all[j];
      if (!f || typeof f === 'string') continue;
      if (typeof File !== 'undefined' && !(f instanceof File) && !f.arrayBuffer) continue;
      if (!f.size) continue;
      out.push(f);
    }
  }
  return out;
}

export function checkShot(file) {
  const type = String(file.type || '').toLowerCase();
  if (!SHOT_TYPES[type]) {
    return { error: 'is not a JPEG, PNG, WebP, or GIF.' };
  }
  if (file.size > MAX_SHOT_BYTES) {
    return { error: 'is ' + file.size + ' bytes. The cap per file is ' + MAX_SHOT_BYTES + '.' };
  }
  const name = clean(file.name || ('screenshot.' + SHOT_TYPES[type]), 80) ||
    ('screenshot.' + SHOT_TYPES[type]);
  return { ok: true, type: type, name: name, bytes: file.size };
}

async function storeShots(bucket, submissionId, files) {
  const saved = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const chk = checkShot(file);
    if (chk.error) return { error: 'screenshots ' + chk.error };
    const id = submissionId + '-' + i;
    const key = 'shots/' + id;
    const buf = await file.arrayBuffer();
    await bucket.put(key, buf, {
      httpMetadata: { contentType: chk.type },
      customMetadata: { filename: chk.name, submission: submissionId }
    });
    saved.push({ id: id, key: key, filename: chk.name, contentType: chk.type, bytes: chk.bytes });
  }
  return { saved: saved };
}

async function sendCopy(env, row, id) {
  const key = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (!key || !from) {
    return { sent: false, why: 'The copy mailer is not configured on this deploy.' };
  }
  const host = resendHost(env);
  const endpoint = 'https://' + host + '/emails';
  const lines = [
    'This is a copy of the feedback you sent to wifiodds.com.',
    '',
    row.name ? ('Name: ' + row.name) : 'Name: (not given)',
    'Email: ' + row.email,
    row.allowFollowup ? 'You said follow-up questions by email are allowed.' : '',
    '',
    row.message,
    '',
    'Submission id: ' + id
  ].filter(function (s) { return s !== ''; });
  let res, out;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + key,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: from,
        to: [row.email],
        subject: 'Copy of your WiFi Odds feedback',
        text: lines.join('\n')
      })
    });
    out = await res.json().catch(function () { return {}; });
  } catch (e) {
    return { sent: false, why: 'The copy mailer did not answer: ' + e.message };
  }
  if (!res.ok) {
    return { sent: false, why: 'The copy mailer answered ' + res.status + '.' };
  }
  return { sent: true, id: out && out.id };
}

function publicRow(row, copy) {
  return {
    ok: true,
    stored: true,
    id: row.id,
    copySent: !!row.copySent,
    copyNote: copy && copy.why ? copy.why : undefined,
    whatHappensNext: row.sendCopy
      ? (row.copySent
        ? 'It is in the queue. A copy is on its way to the email you entered.'
        : 'It is in the queue. A copy could not be mailed from this deploy.')
      : 'It is in the queue. Nobody is emailed unless you asked for a copy.',
    docs: ORIGIN + '/feedback/',
    sources: SOURCES
  };
}

function formSuccessHtml(id, copySent, sendCopy) {
  const copyLine = sendCopy
    ? (copySent
      ? '<p>A copy is on its way to the email you entered.</p>'
      : '<p>A copy could not be mailed from this deploy. The submission itself was stored.</p>')
    : '<p>Nobody is emailed unless you asked for a copy.</p>';
  return htmlResponse(201, 'Feedback received',
    '<h1>Got it</h1><p>It is in the queue. Reference ' + id + '.</p>' + copyLine +
    '<p><a href="/feedback/">Back to the form</a></p>');
}

function formErrorHtml(status, message) {
  return htmlResponse(status, 'Feedback not stored',
    '<h1>Nothing was stored</h1><p>' + String(message).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    }) + '</p><p><a href="/feedback/">Back to the form</a></p>');
}

export async function submitFeedback(context) {
  const request = context.request;
  const html = wantsHtml(request);
  const stop = guardPost(request);
  if (stop) return stop;

  const env = context.env || {};
  const missing = missingStore(env);
  if (missing.length) {
    const msg = 'The feedback intake is not configured on this deploy (missing ' +
      missing.join(', ') + '). Nothing was stored. This is our problem, not yours.';
    return html ? formErrorHtml(503, msg) : refuse(503, 'intake_unconfigured', msg);
  }

  const ct = String(request.headers.get('content-type') || '');
  let parsed;
  let files = [];
  if (/multipart\/form-data/i.test(ct) || /application\/x-www-form-urlencoded/i.test(ct)) {
    let fd;
    try { fd = await request.formData(); }
    catch (e) {
      const msg = 'The body could not be read as a form.';
      return html ? formErrorHtml(400, msg) : refuse(400, 'unparseable_body', msg);
    }
    parsed = { value: objectFromForm(fd) };
    files = await filesFromForm(fd);
  } else {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      const msg = 'That body is ' + text.length + ' bytes. The cap is ' + MAX_BODY_BYTES + '.';
      return html ? formErrorHtml(413, msg) : refuse(413, 'body_too_large', msg);
    }
    parsed = parseBody(text, ct);
    if (parsed.unsupported) {
      const msg = 'Send application/json, multipart/form-data, or application/x-www-form-urlencoded. ' +
        'This request said ' + parsed.unsupported + '.';
      return html ? formErrorHtml(415, msg) : refuse(415, 'unsupported_media_type', msg);
    }
    if (parsed.error) {
      return html ? formErrorHtml(400, parsed.error) : refuse(400, 'unparseable_body', parsed.error);
    }
  }

  if (parsed.value[HONEYPOT] !== undefined && String(parsed.value[HONEYPOT]).trim() !== '') {
    const body = {
      ok: true, stored: false, id: null,
      why: 'A hidden field was filled in, which people cannot do and scripts always do. ' +
        'Nothing was stored. If you are a person seeing this, leave the field named "' +
        HONEYPOT + '" empty.',
      docs: DOCS, sources: SOURCES
    };
    return html ? htmlResponse(202, 'Feedback not stored',
      '<h1>Nothing was stored</h1><p>' + body.why + '</p><p><a href="/feedback/">Back to the form</a></p>')
      : reply(body, 202);
  }

  const check = normaliseFeedback(parsed.value);
  if (!check.ok) {
    const first = Object.keys(check.errors)[0];
    const lead = first === '_body' ? check.errors._body : first + ' ' + check.errors[first];
    const msg = Object.keys(check.errors).length === 1 ? lead
      : lead + ' (' + (Object.keys(check.errors).length - 1) + ' other field' +
        (Object.keys(check.errors).length === 2 ? '' : 's') + ' too — see `fields`)';
    return html ? formErrorHtml(400, msg)
      : refuse(400, 'invalid_feedback', msg, { fields: check.errors });
  }

  if (files.length > MAX_SHOTS) {
    const msg = 'That is ' + files.length + ' screenshots. The cap is ' + MAX_SHOTS + '.';
    return html ? formErrorHtml(400, msg) : refuse(400, 'invalid_feedback', msg,
      { fields: { screenshots: msg } });
  }
  for (let i = 0; i < files.length; i++) {
    const shot = checkShot(files[i]);
    if (shot.error) {
      const msg = 'screenshots ' + shot.error;
      return html ? formErrorHtml(400, msg) : refuse(400, 'invalid_feedback', msg,
        { fields: { screenshots: shot.error } });
    }
  }

  const now = new Date();
  const stamp = hourStamp(now);
  const ipHash = await hashClientId(clientAddress(request), ipSalt(env), stamp);

  let bucket;
  try {
    bucket = await env.FEEDBACK_DB.prepare(SQL.selectBucket).bind(ipHash).first();
  } catch (e) {
    const msg = 'The feedback store did not answer, so nothing was stored. Try again in a minute.';
    return html ? formErrorHtml(503, msg) : refuse(503, 'store_unavailable', msg + ' ' + e.message);
  }
  if (bucket && Number(bucket.seen) >= FEEDBACK_RATE_CAP) {
    const wait = secondsToNextHour(now);
    const msg = 'That is ' + bucket.seen + ' submissions from this connection in the last hour and the cap is ' +
      FEEDBACK_RATE_CAP + '. Nothing was stored. The count resets in ' + Math.ceil(wait / 60) + ' minutes.';
    return html ? formErrorHtml(429, msg) : refuse(429, 'rate_limited', msg,
      { cap: FEEDBACK_RATE_CAP, resetsInSeconds: wait },
      { 'retry-after': String(wait) });
  }

  const id = crypto.randomUUID();
  let shots = [];
  if (files.length) {
    const stored = await storeShots(env.FEEDBACK_SHOTS, id, files);
    if (stored.error) {
      return html ? formErrorHtml(400, stored.error)
        : refuse(400, 'invalid_feedback', stored.error, { fields: { screenshots: stored.error } });
    }
    shots = stored.saved;
  }

  try {
    if (bucket) {
      await env.FEEDBACK_DB.prepare(SQL.bumpBucket).bind(ipHash).run();
    } else {
      await env.FEEDBACK_DB.prepare(SQL.insertBucket).bind(ipHash, FEEDBACK_RATE_CAP).run();
    }
    await env.FEEDBACK_DB.prepare(SQL.insertRow).bind(
      id,
      now.toISOString(),
      'unread',
      check.row.name || null,
      check.row.email,
      check.row.message,
      check.row.sendCopy ? 1 : 0,
      check.row.allowFollowup ? 1 : 0,
      0,
      JSON.stringify(shots),
      ipHash
    ).run();
  } catch (e) {
    const msg = 'The feedback store refused the row and nothing was stored.';
    return html ? formErrorHtml(503, msg) : refuse(503, 'store_unavailable', msg + ' ' + e.message);
  }

  let copy = { sent: false };
  if (check.row.sendCopy) {
    copy = await sendCopy(env, check.row, id);
    if (copy.sent) {
      try { await env.FEEDBACK_DB.prepare(SQL.setCopySent).bind(id).run(); }
      catch (e) { /* row is stored; the flag is bookkeeping */ }
    }
  }

  const out = publicRow({
    id: id,
    sendCopy: check.row.sendCopy,
    copySent: !!copy.sent
  }, copy);
  return html ? formSuccessHtml(id, !!copy.sent, check.row.sendCopy) : reply(out, 201);
}

function readToken(request) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (m) return m[1];
  try { return new URL(request.url).searchParams.get('token') || ''; }
  catch (e) { return ''; }
}

function guardFeedAuth(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: Object.assign({
        'access-control-allow-origin': '*',
        'access-control-max-age': '86400'
      }, FEED_HEADERS)
    });
  }
  const expected = env.FEEDBACK_FEED_TOKEN;
  if (!expected) {
    return feedRefuse(503, 'feed_unconfigured',
      'The feedback feed is not configured on this deploy (missing FEEDBACK_FEED_TOKEN).');
  }
  const got = readToken(request);
  if (!got || got !== expected) {
    return feedRefuse(401, 'unauthorized',
      'Send Authorization: Bearer <token>, or ?token= on the query string.');
  }
  return null;
}

function countsFromRows(groups) {
  const map = { unread: 0, waiting: 0, read: 0 };
  (groups || []).forEach(function (g) {
    map[g.status] = Number(g.n) || 0;
  });
  return {
    unread: map.unread || 0,
    waiting: (map.unread || 0) + (map.waiting || 0)
  };
}

function itemFromRow(r) {
  let shots = [];
  try { shots = JSON.parse(r.screenshots_json || '[]'); }
  catch (e) { shots = []; }
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    name: r.name || null,
    email: r.email,
    message: r.message,
    sendCopy: !!r.send_copy,
    allowFollowup: !!r.allow_followup,
    copySent: !!r.copy_sent,
    screenshots: shots.map(function (s) {
      return {
        id: s.id,
        filename: s.filename,
        contentType: s.contentType,
        bytes: s.bytes,
        url: ORIGIN + '/api/feedback/shot/' + encodeURIComponent(s.id)
      };
    })
  };
}

export async function feedbackFeed(context) {
  const env = context.env || {};
  const stop = guardFeedAuth(context.request, env);
  if (stop) return stop;
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return feedRefuse(405, 'method_not_allowed',
      'GET the feed. POST /api/feedback/ack to mark a row.');
  }
  if (!env.FEEDBACK_DB) {
    return feedRefuse(503, 'intake_unconfigured', 'Missing FEEDBACK_DB.');
  }
  let rows, groups;
  try {
    rows = await env.FEEDBACK_DB.prepare(SQL.listRows).all();
    groups = await env.FEEDBACK_DB.prepare(SQL.countByStatus).all();
  } catch (e) {
    return feedRefuse(503, 'store_unavailable',
      'The feedback store did not answer: ' + e.message);
  }
  const list = (rows && (rows.results || rows)) || [];
  const counts = countsFromRows((groups && (groups.results || groups)) || []);
  return feedReply({
    kind: 'wifiodds-feedback-feed',
    generatedAt: new Date().toISOString(),
    unread: counts.unread,
    waiting: counts.waiting,
    items: list.map(itemFromRow)
  });
}

export async function ackFeedback(context) {
  const env = context.env || {};
  const stop = guardFeedAuth(context.request, env);
  if (stop) return stop;
  if (context.request.method !== 'POST') {
    return feedRefuse(405, 'method_not_allowed', 'POST a JSON body with id.');
  }
  if (!env.FEEDBACK_DB) {
    return feedRefuse(503, 'intake_unconfigured', 'Missing FEEDBACK_DB.');
  }
  const text = await context.request.text();
  const parsed = parseBody(text, context.request.headers.get('content-type') || 'application/json');
  if (parsed.error || parsed.unsupported || !parsed.value) {
    return feedRefuse(400, 'unparseable_body', parsed.error || 'Send a JSON object with id.');
  }
  const id = String(parsed.value.id || '').trim();
  if (!id) return feedRefuse(400, 'invalid_ack', 'id is required.');
  let status = String(parsed.value.status || '').trim().toLowerCase();
  if (!status) {
    const current = await env.FEEDBACK_DB.prepare(SQL.getRow).bind(id).first();
    if (!current) return feedRefuse(404, 'unknown_id', 'No submission with that id.');
    status = current.allow_followup ? 'waiting' : 'read';
  }
  if (status !== 'read' && status !== 'waiting' && status !== 'unread') {
    return feedRefuse(400, 'invalid_ack', 'status must be unread, waiting, or read.');
  }
  const current = await env.FEEDBACK_DB.prepare(SQL.getRow).bind(id).first();
  if (!current) return feedRefuse(404, 'unknown_id', 'No submission with that id.');
  await env.FEEDBACK_DB.prepare(SQL.setStatus).bind(status, id).run();
  current.status = status;
  return feedReply({ ok: true, id: id, status: status, item: itemFromRow(current) });
}

export async function getShot(context) {
  const env = context.env || {};
  const stop = guardFeedAuth(context.request, env);
  if (stop) return stop;
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return feedRefuse(405, 'method_not_allowed', 'GET a screenshot by id.');
  }
  if (!env.FEEDBACK_SHOTS) {
    return feedRefuse(503, 'intake_unconfigured', 'Missing FEEDBACK_SHOTS.');
  }
  const raw = (context.params && context.params.id) || '';
  const id = String(Array.isArray(raw) ? raw[0] : raw).replace(/\/+$/, '');
  if (!id || /[^a-zA-Z0-9._-]/g.test(id)) {
    return feedRefuse(400, 'invalid_id', 'That screenshot id is not valid.');
  }
  const obj = await env.FEEDBACK_SHOTS.get('shots/' + id);
  if (!obj) return feedRefuse(404, 'unknown_shot', 'No screenshot with that id.');
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream';
  const bytes = typeof obj.arrayBuffer === 'function' ? await obj.arrayBuffer() : obj.body;
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': type,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff'
    }
  });
}
