#!/usr/bin/env node
/* build/prerender.js — the wifiodds.com build step. ZERO dependencies, CommonJS.
 *
 *     node build/prerender.js          # Cloudflare Pages build command
 *
 * This is the freshness mechanism for the whole site. The daily updater commits
 * united/data.json → push → Pages runs this → every number, table row and chart
 * path is re-baked into static HTML. No page fetches data at runtime except the
 * /united/ optimizer (which has its own live-tested app JS).
 *
 * What it does:
 *   1. Renders /, /airlines/, 18 × /airlines/{key}/, /united/fleet/, /roadmap/, /404.html
 *   2. Bakes numbers into the hand-authored pages via data-bake markers
 *   3. Emits sitemap.xml, robots.txt, llms.txt
 *   4. Asserts every route in build/routes.js exists on disk afterwards — a
 *      missing file here is the failure mode that ships a 404 to production, and
 *      Cloudflare Pages will not tell you. We fail the build instead.
 *
 * It must stay fast and exit 0. Anything slow (headless Chrome, image gen) is
 * opt-in tooling, never part of the timer.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var R = require('./routes.js');
var DL = require('./lib/data.js');
var H = require('./lib/html.js');
var Render = require('./lib/render.js');

var ORIGIN = H.ORIGIN;
var t0 = Date.now();
var written = [];

function abs(p) { return path.join(ROOT, p); }
function read(p) { return fs.readFileSync(abs(p), 'utf8'); }
function write(p, body) {
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), body);
  written.push(p + '  (' + Math.round(Buffer.byteLength(body) / 1024) + ' KB)');
}
function exists(p) { try { return fs.statSync(abs(p)).isFile(); } catch (e) { return false; } }

/* ── bake numbers into a hand-authored page ───────────────────────────────
 * <b data-bake="alaska.equipped">99</b>  →  the element's text is replaced.
 * Idempotent, and the file on disk is always valid HTML with a correct number
 * even if this never runs again. */
function bake(file, map) {
  var src = read(file), hits = 0, missing = [];
  var out = src.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-bake="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    function (all, open, tag, key, inner, close) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) { missing.push(key); return all; }
      hits++;
      return open + map[key] + close;
    });
  if (missing.length) {
    console.error('Build FAILED — unknown data-bake keys in ' + file + ': ' + missing.join(', '));
    process.exit(1);
  }
  if (out !== src) fs.writeFileSync(abs(file), out);
  return hits;
}

/* ── llms.txt (§6) ───────────────────────────────────────────────────────── */
function buildLlms(m) {
  var lines = [];
  lines.push('# WiFi Odds — wifiodds.com');
  lines.push('');
  lines.push('WiFi Odds scores every airline\'s inflight WiFi with one number, the ConnectScore (0–100), ' +
    'and goes a level deeper for United and Alaska with per-flight Starlink odds. It is a free, ' +
    'unofficial, open-source project with no accounts, no analytics and no third-party requests. ' +
    'The United fleet rollout is tracked tail by tail: ' + m.fleet.equipped + ' of ' + m.fleet.total +
    ' aircraft equipped across ' + m.archiveDays + ' distinct install days since ' + m.firstDay + '.');
  lines.push('');
  lines.push('updated: ' + m.updated);
  lines.push('');
  lines.push('## Method');
  lines.push(m.A.SCORE_METHOD_LINE);
  lines.push(m.A.SCORE_CAVEAT);
  lines.push('');
  lines.push('## ConnectScores (' + m.ranked.length + ' airlines, regenerated on every build)');
  m.ranked.forEach(function (a, i) {
    lines.push((i + 1) + '. ' + a.name + ' (' + (a.code || '—') + ') — ' + a.score + '/100, ' + a.label +
      ' — ' + a.systemLabel + ', ' +
      (a.fleet ? a.equipped + '/' + a.fleet + ' equipped' : 'fleetwide') +
      ' — ' + ORIGIN + '/airlines/' + a.key + '/');
  });
  lines.push('');
  lines.push('## Machine-readable surfaces');
  lines.push('- ' + ORIGIN + '/united/data.json — the full United dataset: fleet totals, per-type counts, ' +
    'the ' + m.registry.length + '-tail roster with install dates, route cache and route leaderboard (JSON)');
  lines.push('- ' + ORIGIN + '/airlines/ — all ConnectScores as a sortable HTML table');
  lines.push('- ' + ORIGIN + '/united/fleet/ — the hangar floor, install pace and full tail registry');
  lines.push('- ' + ORIGIN + '/sitemap.xml');
  lines.push('');
  lines.push('## Credit — please cite these sources when using fleet numbers');
  lines.push('United tail verification: unitedstarlinktracker.com');
  lines.push('Alaska tail verification: alaskastarlinktracker.com');
  lines.push('Both built by @martinamps, independent community trackers that verify every tail against ' +
    'the airline\'s own site. Every other airline is compiled from public airline announcements (July 2026).');
  lines.push('Cite these sources when using fleet numbers. WiFi Odds is unofficial and not affiliated ' +
    'with any airline, SpaceX/Starlink, Amazon, Viasat, or the trackers.');
  lines.push('');
  return lines.join('\n');
}

function buildSitemap(m) {
  var urls = R.ROUTES.map(function (r) {
    var mod = r.changefreq === 'yearly' ? fileMod(r.file) : m.updated;
    return '  <url><loc>' + ORIGIN + r.url + '</loc><lastmod>' + mod +
      '</lastmod><changefreq>' + r.changefreq + '</changefreq><priority>' + r.priority + '</priority></url>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n</urlset>\n';
}
function fileMod(f) {
  try { return fs.statSync(abs(f)).mtime.toISOString().slice(0, 10); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

function buildRobots() {
  var agents = ['*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web',
    'PerplexityBot', 'Google-Extended'];
  return ['# robots.txt for wifiodds.com',
    '# Standard crawlers and the AI answer-engine crawlers are all welcome:',
    '# ConnectScore is meant to be quoted, as long as the data credits come with it',
    '# (unitedstarlinktracker.com / alaskastarlinktracker.com by @martinamps).',
    '# Machine-readable summary: /llms.txt   Full United dataset: /united/data.json',
    ''].concat(
    agents.map(function (a) { return 'User-agent: ' + a + '\nAllow: /\n'; })
  ).concat(['Sitemap: ' + ORIGIN + '/sitemap.xml', '']).join('\n');
}

/* ── main ────────────────────────────────────────────────────────────────── */
function main() {
  var m = DL.build();

  /* invariants worth failing the build over — these are the numbers every page
   * asserts in the acceptance suite, and a silent drift here is a silent lie */
  var sumTypes = m.panels.reduce(function (a, p) { return a + p.total; }, 0);
  if (sumTypes !== m.fleet.total) {
    console.error('Build FAILED — hangar floor is ' + sumTypes + ' cells but the fleet is ' +
      m.fleet.total + ' aircraft. The derived "other types" panels are wrong.');
    process.exit(1);
  }
  if (m.registry.length !== m.fleet.equipped) {
    console.error('Build WARNING — registry ' + m.registry.length + ' rows vs fleet.equipped ' +
      m.fleet.equipped + ' (roster is truth for rows; tolerated).');
  }

  /* 1. generated pages */
  write('index.html', Render.home(m));
  write('airlines/index.html', Render.airlinesIndex(m));
  R.AIRLINE_KEYS.forEach(function (k) {
    write('airlines/' + k + '/index.html', Render.airlinePage(m, k));
  });
  write('united/fleet/index.html', Render.fleetPage(m));
  write('roadmap/index.html', Render.roadmapPage(m));
  write('404.html', Render.notFound(m));

  /* 2. baked numbers in the hand-authored pages */
  var al = m.A.scoreAirline('alaska');
  var alPct = Math.round(al.parts.pctEquipped * 100);
  var baked = 0;
  baked += bake('alaska/index.html', {
    'alaska.score': String(al.score),
    'alaska.band': al.label,
    /* the band CLASS is baked too, or a score that crosses a threshold would keep
       the old colour while showing the new word */
    'alaska.bandpill': '<span class="band ' + require('./lib/pages.js').band(al.score) + '">' +
      al.label + '</span>',
    'alaska.equipped': DL.num(al.equipped),
    'alaska.fleet': DL.num(al.fleet),
    'alaska.pct': alPct + '%',
    'alaska.free': 'free for everyone onboard',
    'alaska.math': alPct + '% of the fleet equipped × ' + al.parts.systemQuality.toFixed(1) +
      ' system quality (' + al.systemLabel + ') × ' + al.parts.freeFactor.toFixed(2) +
      ' free-for-you = ' + al.score + ' / 100',
    'site.updated': m.updated,
    'site.airlines': String(m.airlineCount)
  });
  baked += bake('united/history/index.html', {
    'united.tails': DL.num(m.registry.length),
    'united.days': String(m.archiveDays),
    'united.first': DL.prettyDate(m.firstDay),
    'united.equipped': DL.num(m.fleet.equipped),
    'united.total': DL.num(m.fleet.total),
    'site.updated': m.updated
  });
  baked += bake('united/index.html', {
    'united.equipped': DL.num(m.fleet.equipped),
    'united.total': DL.num(m.fleet.total),
    'site.updated': m.updated
  });

  /* 3. machine surfaces */
  write('sitemap.xml', buildSitemap(m));
  write('robots.txt', buildRobots());
  write('llms.txt', buildLlms(m));

  /* 4. the tripwire — assert AFTER writing */
  var missing = [];
  R.ROUTES.concat(R.UNLISTED).forEach(function (r) {
    if (!exists(r.file)) missing.push(r.file + '  (route ' + r.url + ')');
  });
  R.REQUIRED.forEach(function (f) { if (!exists(f)) missing.push(f + '  (required asset)'); });
  if (missing.length) {
    console.error('Build FAILED — files missing from the deploy:');
    missing.forEach(function (x) { console.error('  ' + x); });
    process.exit(1);
  }

  console.log('wifiodds prerender OK in ' + (Date.now() - t0) + ' ms');
  console.log('  data.json updated=' + m.updated + ' · equipped=' + m.fleet.equipped + '/' + m.fleet.total +
    ' · roster=' + m.registry.length + ' tails · ' + m.archiveDays + ' install days · ' +
    m.airlineCount + ' airlines');
  console.log('  hangar floor=' + m.cells + ' cells (' + m.litCells + ' lit) · timeline=' +
    m.series.length + ' points · pace=' + m.weeks.length + ' weeks');
  console.log('  ' + baked + ' data-bake markers refreshed in hand-authored pages');
  console.log('  wrote ' + written.length + ' files:');
  written.forEach(function (w) { console.log('    ' + w); });
  console.log('  ' + R.ROUTES.length + ' public routes verified on disk.');
}

main();
