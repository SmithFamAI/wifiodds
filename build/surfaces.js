'use strict';
/* build/surfaces.js — writes SURFACES.md from build/routes.js.
 *
 * Three documents cited SURFACES.md as authoritative and no such file existed
 * in this repo (WIFIODDS-BOOT.md, wifiodds-aligned-plan.md and
 * wifiodds-data-program-brief.md; NEXT-STEPS.md and wifiodds-master-plan.md
 * both filed it as a defect). Generating it beats writing it: a hand-authored
 * inventory of 31 routes drifts from ROUTES within a week, which is the same
 * failure the `hand` route kind already caused once in this repo.
 *
 * EVERY COLUMN IS STRUCTURAL. No byte counts, no word counts, no build clock,
 * nothing baked from data.json — those move on the daily refresh and would
 * churn this file every morning for no reason. It changes when the route table
 * changes, which is the only time anybody should look at it.
 *
 * The one derived-from-disk column is <title>, read out of the built HTML. That
 * is deliberate: a route whose title is empty or missing is a real defect and
 * this is where it shows up.
 *
 * NAME COLLISION, worth knowing before you go looking. There is a different
 * SURFACES.md in ~/Projects/united-starlink-companion. That one ranks BOOKING
 * surfaces for the extension (united.com, Navan, Google Flights, and the
 * unbuilt ones behind them). This one lists the pages of this website. Neither
 * is a copy of the other and neither should grow into one. */

var fs = require('fs');
var path = require('path');
var R = require('./routes.js');

var ROOT = path.join(__dirname, '..');

function titleOf(file) {
  try {
    var html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    var m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) return '(no <title>)';
    /* The titles ship HTML-escaped. Inside a fenced block that is just noise, so
       decode the four entities the generator emits. */
    var t = m[1].replace(/\s+/g, ' ').trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    return t || '(empty <title>)';
  } catch (e) {
    return '(not built)';
  }
}

/* Chrome Web Store links per built page. The ship policy fixes the extension's
 * pitch inventory at four surfaces — the sitewide masthead link, the homepage
 * banner, the homepage companion half, and United's #plugin block — so a page
 * that starts carrying more links than it did is the thing worth seeing.
 *
 * This counts LINKS, not pitches. The masthead puts one on every page, so the
 * useful signal is the pages carrying more than one. */
function storeLinks() {
  var out = [];
  R.ROUTES.concat(R.UNLISTED).forEach(function (r) {
    var n = 0;
    try {
      var html = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
      n = (html.match(/chromewebstore\.google\.com/g) || []).length;
    } catch (e) { return; }
    if (n > 1) out.push({ url: r.url, n: n });
  });
  return out;
}

/* The JSON endpoints. They are Cloudflare Pages Functions computed per request,
 * so there is no file on disk for the drift guard to find and nothing for the
 * sitemap to list — see the header of routes.js for why adding them to ROUTES
 * would make the build assert files that must never exist. Reading the
 * directory keeps this list honest without putting them in the route table. */
function apiRoutes() {
  var dir = path.join(ROOT, 'functions', 'api');
  var out = [];
  (function walk(d, prefix) {
    var entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    entries.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    entries.forEach(function (e) {
      if (e.isDirectory()) return walk(path.join(d, e.name), prefix + '/' + e.name);
      if (!/\.js$/.test(e.name)) return;
      var base = e.name.replace(/\.js$/, '');
      var seg = base === 'index' ? '' : '/' + base.replace(/^\[(.+)\]$/, '{$1}');
      out.push({ url: '/api' + prefix + seg, file: 'functions/api' + prefix + '/' + e.name });
    });
  }(dir, ''));
  return out;
}

/* Column-aligned inside a fenced block, NOT a markdown table, and that is a
 * deliberate choice with a reason.
 *
 * The inventory reproduces 30 page <title>s verbatim, and this site's titles use
 * em dashes. In a markdown table the slop linter reads those as the file's own
 * prose and scores it at 49 pivots per 1,000 words against a bar of 5 — a file
 * that is 80% quoted data would be permanently blocked by punctuation it did not
 * write. The linter strips fenced blocks, so fencing the data says the true
 * thing: these are values, and the prose around them is what should be scored.
 * Blessing a baseline would have hidden the same problem instead of fixing it. */
function fenced(rows) {
  var w = [];
  rows.forEach(function (r) {
    r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); });
  });
  var body = rows.map(function (r) {
    return r.map(function (c, i) {
      return i === r.length - 1 ? String(c) : String(c).padEnd(w[i]);
    }).join('  ').replace(/\s+$/, '');
  }).join('\n');
  return '```\n' + body + '\n```';
}

function build() {
  var L = [];
  var p = function (s) { L.push(s === undefined ? '' : s); };

  p('# Surfaces');
  p('');
  p('Every page this site serves. Generated by `build/surfaces.js` from');
  p('`build/routes.js` on every run of `node build/prerender.js`, so it cannot drift');
  p('from what actually ships. Do not hand-edit it: the next build overwrites you.');
  p('');
  p('Three docs cite this file as authoritative and it did not exist until 26 Jul 2026.');
  p('It is not the same file as `SURFACES.md` in `~/Projects/united-starlink-companion`,');
  p('which ranks booking sites for the extension.');
  p('');

  p('## Public routes');
  p('');
  p('All ' + R.ROUTES.length + ' of them are in `sitemap.xml`. `url` is the path Cloudflare');
  p('serves; `file` is what lands on disk. Those differ in exactly one row.');
  p('');
  p('`tmpl` names a file in `build/templates/` holding that page\'s unique content. A');
  p('dash means the page is assembled entirely in `build/lib/`. Every route is');
  p('generated, and the build fails on any served `.html` that is not listed here.');
  p('');
  p(fenced([['url', 'file', 'tmpl', 'freq', 'pri', 'title']].concat(
    R.ROUTES.map(function (r) {
      return [r.url, r.file, r.tmpl || '-', r.changefreq, r.priority, titleOf(r.file)];
    }))));
  p('');

  p('## Served but not listed');
  p('');
  p('Cloudflare Pages serves this for any unmatched path. It is deliberately absent');
  p('from `sitemap.xml`.');
  p('');
  p(fenced([['url', 'file', 'title']].concat(
    R.UNLISTED.map(function (r) { return [r.url, r.file, titleOf(r.file)]; }))));
  p('');

  var api = apiRoutes();
  p('## JSON endpoints');
  p('');
  p('Pages Functions, computed per request. There is no file on disk and nothing for');
  p('the sitemap. They are deliberately absent from `ROUTES`: putting them there would');
  p('make the build assert files that must never exist. `/api/docs/` is the one `/api`');
  p('path that IS a page. It appears in the route list above instead.');
  p('');
  p(fenced([['endpoint', 'source']].concat(
    api.map(function (r) { return [r.url, r.file]; }))));
  p('');

  p('## Files the site cannot work without');
  p('');
  p('The build fails if one of these is missing. Each is here because losing it would');
  p('still return HTTP 200. A missing font falls back silently to three different faces');
  p('across three platforms. A missing `flightcheck.js` leaves the hero form sitting');
  p('there doing nothing. `build/routes.js` carries the reasoning per file.');
  p('');
  R.REQUIRED.forEach(function (f) { p('- `' + f + '`'); });
  p('');

  var links = storeLinks();
  p('## Chrome Web Store links');
  p('');
  p('The masthead puts one link on every page, so only the pages carrying more are');
  p('listed. The ship policy fixes the pitch inventory at four surfaces: the masthead');
  p('sitewide, the homepage banner, the homepage companion half, and United\'s');
  p('`#plugin` block. Alaska\'s was removed on 25 Jul 2026.');
  p('');
  p('These are link counts. They run higher than four for that reason. Read a change');
  p('in one as a prompt to go look. Read the total as nothing at all.');
  p('');
  if (!links.length) {
    p('No page carries more than the masthead link.');
  } else {
    p(fenced([['url', 'links']].concat(
      links.map(function (r) { return [r.url, String(r.n)]; }))));
  }
  p('');

  return L.join('\n');
}

module.exports = { build: build, apiRoutes: apiRoutes };

/* Runnable on its own for a quick look: node build/surfaces.js */
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'SURFACES.md'), build());
  console.log('wrote SURFACES.md · ' + R.ROUTES.length + ' routes · ' +
    apiRoutes().length + ' endpoints');
}
