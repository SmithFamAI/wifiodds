'use strict';
/* build/routes.js — the page list. THE source of truth for what exists publicly:
 * prerender.js writes every one of them and emits sitemap.xml from this table.
 *
 * `gen` = written by the build. EVERY route is `gen` now, and prerender.js fails
 * the build if one is not — plus it walks the repo and fails on any served .html
 * file that is not in this table. There used to be a second kind, `hand`, for the
 * four pages that were authored as whole documents (/united/, /united/history/,
 * /alaska/, /privacy.html). Each carried its own copy of the header, subnav and
 * footer, all four drifted from the generator, and nothing caught it. Their unique
 * content lives in build/templates/ now; the chrome comes from build/lib/html.js.
 * NEVER HAND-EDIT A FILE LISTED HERE — the next build overwrites it.
 *
 * /api is DELIBERATELY ABSENT. It is empty until Phase B (Supabase) and lives as
 * a roadmap item, nothing else — no placeholder page, no sitemap entry. */

var AIRLINE_KEYS = ['united', 'alaska', 'jsx', 'airbaltic', 'zipair', 'westjet', 'airfrance',
  'hawaiian', 'qatar', 'sas', 'emirates', 'virginatlantic', 'aircanada', 'britishairways',
  'southwest', 'american', 'delta', 'jetblue'];

var ROUTES = [
  { url: '/', file: 'index.html', kind: 'gen', changefreq: 'daily', priority: '1.0' },
  { url: '/airlines/', file: 'airlines/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  { url: '/united/', file: 'united/index.html', kind: 'gen', tmpl: 'united-optimizer', changefreq: 'daily', priority: '0.9' },
  { url: '/united/fleet/', file: 'united/fleet/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  { url: '/united/history/', file: 'united/history/index.html', kind: 'gen', tmpl: 'united-history', changefreq: 'daily', priority: '0.6' },
  { url: '/alaska/', file: 'alaska/index.html', kind: 'gen', tmpl: 'alaska-rollout', changefreq: 'weekly', priority: '0.8' },
  { url: '/roadmap/', file: 'roadmap/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.5' },
  { url: '/privacy.html', file: 'privacy.html', kind: 'gen', tmpl: 'privacy', changefreq: 'yearly', priority: '0.3' }
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
