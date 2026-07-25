#!/usr/bin/env node
/* build/prerender.js — wifiodds.com build step. Zero dependencies, CommonJS.
 *
 *     node build/prerender.js
 *
 * The site is real static files (no SPA, no shell to hydrate), so there is
 * nothing to prerender yet. What this does today:
 *
 *   1. Asserts every public route actually exists on disk. A missing file here
 *      is the failure mode that ships a 404 to production, and Cloudflare Pages
 *      will not tell you — so we fail the build instead.
 *   2. Emits sitemap.xml and robots.txt for those routes.
 *   3. Takes <lastmod> from united/data.json's `updated` field, so the daily
 *      data commit moves the sitemap date too.
 *
 * When per-airline pages start being generated from a shared shell (the
 * points-compass pattern), the route table below is where that starts: give a
 * route a `headBlock`/`contentHtml` and write the file, exactly as
 * points-compass/build/prerender.js does. Deliberately NOT copied from there:
 * the SEO:START/END marker surgery and the #view-* injection, which only make
 * sense for a single-shell SPA.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var ORIGIN = 'https://wifiodds.com';

/* Public, indexable routes. `file` is the real file Cloudflare Pages serves. */
var ROUTES = [
  { url: '/',                 file: 'index.html',                changefreq: 'weekly', priority: '1.0' },
  { url: '/united/',          file: 'united/index.html',         changefreq: 'daily',  priority: '0.9' },
  { url: '/alaska/',          file: 'alaska/index.html',         changefreq: 'weekly', priority: '0.8' },
  { url: '/united/history/',  file: 'united/history/index.html', changefreq: 'daily',  priority: '0.6' },
  { url: '/privacy.html',     file: 'privacy.html',              changefreq: 'yearly', priority: '0.3' }
];

/* Non-route files the site cannot work without. Cheap tripwire for a bad copy. */
var REQUIRED = [
  'united/data.json',
  'assets/airlines.js',
  'assets/og.png',
  'assets/selectors.json'
];

function abs(p) { return path.join(ROOT, p); }
function read(p) { return fs.readFileSync(abs(p), 'utf8'); }
function write(p, body) {
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), body);
}
function exists(p) { try { return fs.statSync(abs(p)).isFile(); } catch (e) { return false; } }

/* data.json's `updated` is an ISO date already ("2026-07-24"); fall back to
 * today rather than emitting an invalid <lastmod>. */
function lastmod() {
  try {
    var d = JSON.parse(read('united/data.json'));
    if (typeof d.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.updated)) return d.updated;
  } catch (e) { /* fall through */ }
  return new Date().toISOString().slice(0, 10);
}

function buildSitemap(mod) {
  var urls = ROUTES.map(function (r) {
    return '  <url><loc>' + ORIGIN + r.url + '</loc><lastmod>' + mod +
      '</lastmod><changefreq>' + r.changefreq + '</changefreq><priority>' + r.priority + '</priority></url>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n</urlset>\n';
}

function buildRobots() {
  var agents = ['*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web',
                'PerplexityBot', 'Google-Extended'];
  return ['# robots.txt for wifiodds.com',
    '# Standard crawlers and the AI answer-engine crawlers are all welcome:',
    '# ConnectScore is meant to be quoted, as long as the data credits come with it',
    '# (unitedstarlinktracker.com / alaskastarlinktracker.com by @martinamps).',
    ''].concat(
    agents.map(function (a) { return 'User-agent: ' + a + '\nAllow: /\n'; })
  ).concat(['Sitemap: ' + ORIGIN + '/sitemap.xml', '']).join('\n');
}

function main() {
  var missing = [];
  ROUTES.forEach(function (r) { if (!exists(r.file)) missing.push(r.file + '  (route ' + r.url + ')'); });
  REQUIRED.forEach(function (f) { if (!exists(f)) missing.push(f + '  (required asset)'); });
  if (missing.length) {
    console.error('Build FAILED — files missing from the deploy:');
    missing.forEach(function (m) { console.error('  ' + m); });
    process.exit(1);
  }

  var mod = lastmod();
  write('sitemap.xml', buildSitemap(mod));
  write('robots.txt', buildRobots());

  console.log('wifiodds build OK. lastmod=' + mod + ' (from united/data.json)');
  console.log('Routes verified (' + ROUTES.length + '):');
  ROUTES.forEach(function (r) { console.log('  ' + r.url + '  <-  ' + r.file); });
  console.log('Wrote: sitemap.xml, robots.txt');
}

main();
