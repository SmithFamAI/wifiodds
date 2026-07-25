#!/usr/bin/env node
/* build/pull-reports.js — copy the PUBLISHED field reports into a committed file.
 *
 *     node build/pull-reports.js              # pull, write assets/reports.json
 *     node build/pull-reports.js --dry-run    # show what would change, write nothing
 *     node build/pull-reports.js --strict     # exit 1 if the pull fails
 *     node build/pull-reports.js --allow-empty
 *
 * WHY THIS EXISTS AS A SEPARATE STEP. The site is prerendered: no page fetches
 * anything at runtime, so the reports have to be on disk before the build reads
 * them. The obvious shortcut is for prerender.js to query Supabase directly, and
 * that is the one thing this must not do. The daily refresh runs unattended at
 * 04:32 and every dependency it gains is a new way for it to fail in the dark.
 * So the network call lives here, the build reads a file, and the two are only
 * coupled by that file.
 *
 * THE FAILURE MODE IS DELIBERATE. If Supabase is unreachable this prints a loud
 * warning, leaves the committed file exactly as it was, and exits 0 — because
 * the daily task probably chains `pull-reports && prerender`, and yesterday's
 * reports are a much better outcome than a build that does not run. Pass
 * --strict when you are running it by hand and want to know.
 *
 * It also refuses to overwrite a non-empty file with zero rows unless you pass
 * --allow-empty. A pull that succeeds and returns nothing (wrong key, wrong
 * project, someone unpublished everything) would otherwise blank the section
 * silently, which is the same class of bug as a 200 with an empty body.
 *
 * Credentials: SUPABASE_URL and SUPABASE_ANON_KEY, from the environment or from
 * a .env file at the repo root (gitignored). The key is the publishable one —
 * it can read published rows and literally nothing else, which is the whole
 * point of the row-level policy behind it.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'assets', 'reports.json');

var argv = process.argv.slice(2);
var DRY = argv.indexOf('--dry-run') >= 0;
var STRICT = argv.indexOf('--strict') >= 0;
var ALLOW_EMPTY = argv.indexOf('--allow-empty') >= 0;

/* ── credentials ───────────────────────────────────────────────────────── */
function loadEnv() {
  var env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY };
  var f = path.join(ROOT, '.env');
  if (fs.existsSync(f)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach(function (line) {
      var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) return;
      var v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!env[m[1]]) env[m[1]] = v;
    });
  }
  return env;
}

function readCommitted() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch (e) { return null; }
}

function keep(why) {
  var had = readCommitted();
  console.error('REPORTS PULL FAILED — ' + why);
  console.error('  Nothing was written. assets/reports.json is unchanged: ' +
    (had ? had.count + ' report' + (had.count === 1 ? '' : 's') + ', pulled ' + had.generated
         : 'the file does not exist yet, so the build will render no reports'));
  console.error('  The build does not need this script. `node build/prerender.js` still works.');
  process.exit(STRICT ? 1 : 0);
}

/* ── the shape the build reads ─────────────────────────────────────────── */
function toReport(r) {
  return {
    id: r.id,
    flownOn: r.flown_on,
    airline: r.airline,
    flightNumber: r.flight_number,
    route: r.route,
    aircraft: r.aircraft,
    system: r.system,
    downMbps: r.down_mbps === null ? null : Number(r.down_mbps),
    upMbps: r.up_mbps === null ? null : Number(r.up_mbps),
    latencyMs: r.latency_ms,
    wasFree: r.was_free,
    note: r.note,
    credit: r.credit,
    kind: r.kind,
    publishedAt: r.published_at
  };
}

async function main() {
  var env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    keep('SUPABASE_URL / SUPABASE_ANON_KEY are not set (environment or .env at the repo root).');
  }
  var url = String(env.SUPABASE_URL).replace(/\/+$/, '') +
    '/rest/v1/field_reports?select=*&order=flown_on.desc';

  var rows;
  try {
    var res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
        accept: 'application/json'
      }
    });
    if (!res.ok) keep('the store answered ' + res.status + ' ' + res.statusText + '.');
    rows = await res.json();
  } catch (e) {
    keep('the store did not answer: ' + e.message);
  }
  if (!Array.isArray(rows)) keep('the store answered something that is not a list of rows.');

  var had = readCommitted();
  if (!rows.length && had && had.count && !ALLOW_EMPTY) {
    keep('the pull succeeded and returned ZERO published rows, but the committed file has ' +
      had.count + '. Refusing to blank it. Pass --allow-empty if that is really what you want.');
  }

  var body = {
    generated: new Date().toISOString(),
    source: 'supabase field_reports view (published rows only)',
    kind: 'FIELD REPORT',
    means: 'One reader, one flight, one speed test. Field reports are not the measured medians ' +
      'the methodology page cites and they are never mixed into a ConnectScore.',
    count: rows.length,
    reports: rows.map(toReport)
  };
  var text = JSON.stringify(body, null, 2) + '\n';

  if (DRY) {
    console.log('pull-reports --dry-run: ' + rows.length + ' published report' +
      (rows.length === 1 ? '' : 's') + ', ' + Buffer.byteLength(text) + ' bytes, not written.');
    rows.map(toReport).forEach(function (r) {
      console.log('    ' + r.flownOn + '  ' + r.airline + ' ' + r.flightNumber + '  ' +
        r.system + '  ' + (r.downMbps === null ? '—' : r.downMbps + ' Mbps down') +
        '  ' + (r.credit || 'uncredited'));
    });
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log('pull-reports OK — ' + rows.length + ' published report' +
    (rows.length === 1 ? '' : 's') + ' → assets/reports.json (' + Buffer.byteLength(text) + ' bytes)');
  if (had) console.log('  was ' + had.count + ', pulled ' + had.generated);
  console.log('  Commit assets/reports.json. The build reads the file, never the database.');
}

main().catch(function (e) {
  keep('the script threw: ' + (e && e.stack || e));
});
