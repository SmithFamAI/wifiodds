'use strict';
/* build/routes.js — the page list. THE source of truth for what exists publicly:
 * prerender.js writes the generated ones, asserts the hand-authored ones are on
 * disk, and emits sitemap.xml from this table.
 *
 * `gen` = written by the build (never hand-edit those files).
 * `hand` = a real hand-authored file the build only verifies (and may bake
 *          numbers into via data-bake markers).
 *
 * /api is DELIBERATELY ABSENT. It is empty until Phase B (Supabase) and lives as
 * a roadmap item, nothing else — no placeholder page, no sitemap entry. */

var AIRLINE_KEYS = ['united', 'alaska', 'jsx', 'airbaltic', 'zipair', 'westjet', 'airfrance',
  'hawaiian', 'qatar', 'sas', 'emirates', 'virginatlantic', 'aircanada', 'britishairways',
  'southwest', 'american', 'delta', 'jetblue'];

var ROUTES = [
  { url: '/', file: 'index.html', kind: 'gen', changefreq: 'daily', priority: '1.0' },
  { url: '/airlines/', file: 'airlines/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  { url: '/united/', file: 'united/index.html', kind: 'hand', changefreq: 'daily', priority: '0.9' },
  { url: '/united/fleet/', file: 'united/fleet/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  { url: '/united/history/', file: 'united/history/index.html', kind: 'hand', changefreq: 'daily', priority: '0.6' },
  { url: '/alaska/', file: 'alaska/index.html', kind: 'hand', changefreq: 'weekly', priority: '0.8' },
  { url: '/roadmap/', file: 'roadmap/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.5' },
  { url: '/privacy.html', file: 'privacy.html', kind: 'hand', changefreq: 'yearly', priority: '0.3' }
];

AIRLINE_KEYS.forEach(function (k) {
  ROUTES.push({
    url: '/airlines/' + k + '/', file: 'airlines/' + k + '/index.html',
    kind: 'gen', airline: k, changefreq: 'weekly', priority: '0.7'
  });
});

/* Not in the sitemap; Cloudflare Pages serves it for any unmatched path. */
var UNLISTED = [{ url: '/404.html', file: '404.html', kind: 'gen' }];

/* Files the site cannot work without. Cheap tripwire for a bad copy. */
var REQUIRED = [
  'united/data.json',
  'assets/airlines.js',
  'assets/site.css',
  'assets/site.js',
  'assets/og.png',
  'assets/selectors.json'
];

module.exports = { ROUTES: ROUTES, UNLISTED: UNLISTED, REQUIRED: REQUIRED, AIRLINE_KEYS: AIRLINE_KEYS };
