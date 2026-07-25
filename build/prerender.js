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
 *   1. Renders ALL 27 served pages. There are no hand-authored pages left: the
 *      four that used to be (/united/, /united/history/, /alaska/, /privacy.html)
 *      keep their unique content in build/templates/ and are poured through the
 *      same H.page() shell as everything else. See build/lib/tmpl.js for why.
 *   2. Emits sitemap.xml, robots.txt, llms.txt
 *   3. Asserts every route in build/routes.js exists on disk afterwards — a
 *      missing file here is the failure mode that ships a 404 to production, and
 *      Cloudflare Pages will not tell you. We fail the build instead.
 *   4. Asserts the reverse too: every served .html file in the repo IS a known
 *      route. That is the drift tripwire — it is how a hand-authored page with a
 *      stale copy of the header gets caught on the build that creates it, rather
 *      than six weeks later.
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
function write(p, body) {
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), body);
  written.push(p + '  (' + Math.round(Buffer.byteLength(body) / 1024) + ' KB)');
}
function exists(p) { try { return fs.statSync(abs(p)).isFile(); } catch (e) { return false; } }

/* ── the drift tripwire ───────────────────────────────────────────────────
 * Walk the deploy for .html files and demand that every one of them is a route
 * in build/routes.js. ROUTES asserts "every route has a file"; this asserts the
 * converse, "every file is a route" — which is the check that catches a NEW
 * hand-authored page carrying its own stale copy of the header, the exact drift
 * that made four pages diverge from the generator in the first place.
 *
 * A page that genuinely should not be generated belongs in ROUTES, UNLISTED, or
 * EMBEDS below — never nowhere. */
var EMBEDS = [
  /* standalone <iframe>/inline embed, not a page: no chrome, no route, no sitemap
     entry. It is included INTO /united/ from the template, so it must not be held
     to the page contract. */
  'united/assets/plugin-carousel.html'
];
/* skip dirs that Cloudflare Pages never serves (see .assetsignore / .gitignore) */
var SKIP_DIRS = { '.git': 1, 'build': 1, 'node_modules': 1, '.claude': 1 };

function walkHtml(dir, rel, out) {
  fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true }).forEach(function (e) {
    var r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS[e.name]) walkHtml(r, r, out); return; }
    if (/\.html$/.test(e.name)) out.push(r);
  });
  return out;
}

function assertNoStrayPages() {
  var known = {};
  R.ROUTES.concat(R.UNLISTED).forEach(function (r) { known[r.file] = r.url; });
  EMBEDS.forEach(function (f) { known[f] = 'embed'; });
  var stray = walkHtml('', '', []).filter(function (f) { return !known[f]; });
  if (stray.length) {
    console.error('Build FAILED — served HTML files that are not in build/routes.js:');
    stray.forEach(function (f) { console.error('  ' + f); });
    console.error('  A page nobody generates is a page whose header will drift. Add it to ROUTES');
    console.error('  (with a Render.* function and a build/templates/ file), to UNLISTED, or — if it');
    console.error('  is a standalone embed rather than a page — to EMBEDS in build/prerender.js.');
    process.exit(1);
  }
  return Object.keys(known).length;
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

  /* 1. every page. ROUTES is the table; this is the switchboard, and the two
   *    have to agree — a route with no case here fails the assert in step 4. */
  write('index.html', Render.home(m));
  write('airlines/index.html', Render.airlinesIndex(m));
  R.AIRLINE_KEYS.forEach(function (k) {
    write('airlines/' + k + '/index.html', Render.airlinePage(m, k));
  });
  write('united/fleet/index.html', Render.fleetPage(m));
  write('roadmap/index.html', Render.roadmapPage(m));
  write('404.html', Render.notFound(m));
  /* the four former hand-authored pages — content from build/templates/, chrome
     from build/lib/html.js, numbers baked from data.json at render time */
  write('united/index.html', Render.unitedOptimizer(m));
  write('united/history/index.html', Render.unitedHistory(m));
  write('alaska/index.html', Render.alaskaRollout(m));
  write('privacy.html', Render.privacyPage(m));

  /* 2. machine surfaces */
  write('sitemap.xml', buildSitemap(m));
  write('robots.txt', buildRobots());
  write('llms.txt', buildLlms(m));

  /* 3. the tripwire — assert AFTER writing, both directions */
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
  var knownHtml = assertNoStrayPages();

  /* every route must actually be generated now — no `kind: 'hand'` left */
  var hand = R.ROUTES.concat(R.UNLISTED).filter(function (r) { return r.kind !== 'gen'; });
  if (hand.length) {
    console.error('Build FAILED — routes still marked hand-authored: ' +
      hand.map(function (r) { return r.url; }).join(', '));
    process.exit(1);
  }

  console.log('wifiodds prerender OK in ' + (Date.now() - t0) + ' ms');
  console.log('  data.json updated=' + m.updated + ' · equipped=' + m.fleet.equipped + '/' + m.fleet.total +
    ' · roster=' + m.registry.length + ' tails · ' + m.archiveDays + ' install days · ' +
    m.airlineCount + ' airlines');
  console.log('  hangar floor=' + m.cells + ' cells (' + m.litCells + ' lit) · timeline=' +
    m.series.length + ' points · pace=' + m.weeks.length + ' weeks');
  console.log('  wrote ' + written.length + ' files:');
  written.forEach(function (w) { console.log('    ' + w); });
  console.log('  ' + R.ROUTES.length + ' public routes verified on disk · every one generated · ' +
    'no stray HTML (' + knownHtml + ' known .html files, incl. ' + EMBEDS.length + ' embed).');
}

main();
