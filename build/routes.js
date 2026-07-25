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
 * /api/docs/ is the ONLY /api path in this table, and that is on purpose: it is
 * the one /api path that is an HTML page on disk. The JSON endpoints themselves
 * (/api, /api/airlines, /api/airlines/{key}, /api/score/{flightNumber}) are
 * Cloudflare Pages Functions in functions/api/**, computed per request — there is
 * no file for the drift-guard to find and nothing for the sitemap to list. Adding
 * them to ROUTES would make the build assert files that must never exist. */

var AIRLINE_KEYS = ['united', 'alaska', 'jsx', 'airbaltic', 'zipair', 'westjet', 'airfrance',
  'hawaiian', 'qatar', 'sas', 'emirates', 'virginatlantic', 'aircanada', 'britishairways',
  'southwest', 'american', 'delta', 'jetblue'];

var ROUTES = [
  { url: '/', file: 'index.html', kind: 'gen', changefreq: 'daily', priority: '1.0' },
  { url: '/airlines/', file: 'airlines/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  /* THE RACE — every airline's rollout timeline to full next-gen. changefreq
     daily because the next-gen share in every row is re-baked from the same daily
     pull as the leaderboard; only the finish-line prose is editorial. */
  { url: '/race/', file: 'race/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  /* SYSTEMS — the evergreen hardware primer. Starlink vs Amazon Leo plus every
     system flying on the fleets we score. Monthly: satellites do not move house,
     and the carrier lists inside it are derived so they stay current anyway. */
  { url: '/systems/', file: 'systems/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.8' },
  { url: '/united/', file: 'united/index.html', kind: 'gen', tmpl: 'united-optimizer', changefreq: 'daily', priority: '0.9' },
  { url: '/united/fleet/', file: 'united/fleet/index.html', kind: 'gen', changefreq: 'daily', priority: '0.9' },
  { url: '/united/history/', file: 'united/history/index.html', kind: 'gen', tmpl: 'united-history', changefreq: 'daily', priority: '0.6' },
  { url: '/alaska/', file: 'alaska/index.html', kind: 'gen', tmpl: 'alaska-rollout', changefreq: 'weekly', priority: '0.8' },
  /* The provenance page. changefreq daily because its freshness stamp and worked
     examples are re-baked from data.json with everything else, and it is the page
     an answer engine is most likely to re-check before quoting a number. */
  { url: '/methodology/', file: 'methodology/index.html', kind: 'gen', changefreq: 'daily', priority: '0.7' },
  { url: '/roadmap/', file: 'roadmap/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.5' },
  { url: '/api/docs/', file: 'api/docs/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.5' },
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
  /* the homepage flight check. Its absence would not break a build or a 200 — the
     hero form would just sit there doing nothing, which is exactly the class of
     silent failure this list exists to catch. */
  'assets/flightcheck.js',
  'assets/og.png',
  'assets/selectors.json',
  /* the two REAL captures the homepage extension demo is built from. Their
     absence would render as broken images inside a section whose whole argument
     is "these are real screenshots" — and a 200 would still be served. */
  'assets/shot-united-1280x800.png',
  'assets/shot-navan-1280x800.png'
];

module.exports = { ROUTES: ROUTES, UNLISTED: UNLISTED, REQUIRED: REQUIRED, AIRLINE_KEYS: AIRLINE_KEYS };
