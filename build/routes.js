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
  /* Core pages plus /airlines/ and one /airlines/{key}/ page per homepage
     rank card. The 28 Jul cut 301'd those paths home; 57-v1 removes those two
     redirect rules so the files can serve. The /united/ DIRECTORY stays on
     disk because the extension reads united/data.json; only the /united/
     PAGE routes stay 301'd.
     NEVER HAND-EDIT A FILE LISTED HERE. */
  { url: '/', file: 'index.html', kind: 'gen', changefreq: 'daily', priority: '1.0' },
  { url: '/methodology/', file: 'methodology/index.html', kind: 'gen', changefreq: 'daily', priority: '0.7' },
  { url: '/technology/', file: 'technology/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.8' },
  { url: '/extension/', file: 'extension/index.html', kind: 'gen', changefreq: 'monthly', priority: '0.8' },
  { url: '/feedback/', file: 'feedback/index.html', kind: 'gen', tmpl: 'feedback', changefreq: 'yearly',
    priority: '0.5', lastmod: '2026-08-16' },
  { url: '/privacy', file: 'privacy.html', kind: 'gen', tmpl: 'privacy', changefreq: 'yearly',
    priority: '0.3', lastmod: '2026-08-16' }
];

/* Compact directory plus one HTML page per airline that already has a
   homepage rank card. Plural /airlines/{key}/ is the canonical path. Keys stay
   the same list prerender.js and functions/_lib/mcp.mjs already import. */
var AIRLINE_DIRECTORY = {
  url: '/airlines/',
  file: 'airlines/index.html',
  kind: 'gen',
  changefreq: 'daily',
  priority: '0.7'
};
var AIRLINE_ROUTES = AIRLINE_KEYS.map(function (key) {
  return {
    url: '/airlines/' + key + '/',
    file: 'airlines/' + key + '/index.html',
    kind: 'gen',
    changefreq: 'daily',
    priority: '0.6'
  };
});
ROUTES = ROUTES.concat([AIRLINE_DIRECTORY], AIRLINE_ROUTES);

/* Not in the sitemap; Cloudflare Pages serves it for any unmatched path. */
var UNLISTED = [{ url: '/404.html', file: '404.html', kind: 'gen' }];

/* Files the site cannot work without. Cheap tripwire for a bad copy. */
var REQUIRED = [
  'united/data.json',
  'assets/airlines.js',
  'assets/site.css',
  'assets/site.js',
  'assets/og.png',
  /* Google's own Chrome Web Store badge art, byte-identical to the originals.
     The homepage's two install controls are these images; a missing file
     renders as a broken image where the page's one pitch should be, behind a
     200. The medium size is kept alongside for smaller future surfaces. */
  'assets/cws/badge-plain-large.png',
  'assets/cws/badge-border-large.png',
  'assets/cws/badge-border-medium.png',
  'assets/selectors.json',
  /* the two REAL captures the homepage extension demo is built from. Their
     absence would render as broken images inside a section whose whole argument
     is "these are real screenshots" — and a 200 would still be served. */
  'assets/shot-united-1280x800.png',
  'assets/shot-navan-1280x800.png',
  /* Source Serif 4, self-hosted, the site's speaking voice. A missing face is
     the quietest possible failure: the page still returns 200, still renders,
     and silently falls back to whatever serif the device has — Charter on a Mac,
     Georgia on Windows, Noto on Android, which is three different faces and
     exactly the outcome self-hosting exists to prevent, because nobody would
     notice. The reporting voice is system-ui and has no file to lose.
     Regenerate with `python3 build/make-brand.py fonts`. */
  'assets/serif-400.woff2',
  'assets/serif-700.woff2',
  'assets/SourceSerif4-OFL.txt'
];

module.exports = { ROUTES: ROUTES, UNLISTED: UNLISTED, REQUIRED: REQUIRED, AIRLINE_KEYS: AIRLINE_KEYS };
