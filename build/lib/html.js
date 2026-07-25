'use strict';

/* ── CACHE BUSTING, and the bug that made it necessary ────────────────────
 * The Plate redesign shipped and returning visitors kept seeing the old one.
 * The stylesheet was linked as a bare `/assets/site.css` and Cloudflare serves
 * it with `cache-control: public, max-age=14400, must-revalidate` — four hours.
 * So a warm browser paired the NEW markup with the OLD stylesheet, which is a
 * worse state than either version on its own.
 *
 * curl said the deploy was fine, because curl has no cache. That is the same
 * class of false green as a 200 with an empty body: the check was not looking
 * at what a reader sees. It was caught by asking the browser for its COMPUTED
 * `--brand`, which still read #0033A0 after the colour had been retired.
 *
 * So the URL carries a content hash. Change the file, change the URL, and every
 * cache everywhere misses on the same build. Cheap, and it removes a whole
 * category of "why am I still seeing the old site". */
var _hcrypto = require('crypto');
var _hfs = require('fs');
var _hpath = require('path');
var _hcache = {};
function assetHash(rel) {
  if (_hcache[rel]) return _hcache[rel];
  var h;
  try {
    var buf = _hfs.readFileSync(_hpath.join(__dirname, '..', '..', rel));
    h = _hcrypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  } catch (e) {
    /* Never fail the build over a cache buster. A missing hash costs a stale
     * cache; a thrown error costs the deploy. */
    console.error('  cache-bust: could not hash ' + rel + ' (' + e.code + '), using the build date');
    h = String(Date.now()).slice(-8);
  }
  _hcache[rel] = h;
  return h;
}
/* build/lib/html.js — the shared shell every prerendered page is poured into.
 * One <head> builder, one credit strip, one footer, and TWO nav rows: a global
 * topnav that is byte-identical everywhere, plus an optional per-airline subnav.
 * If a page needs a different global nav, the nav is wrong, not the page. */

var ORIGIN = 'https://wifiodds.com';
var EXT = 'https://chromewebstore.google.com/detail/starlink-odds-for-united/ojpladpffbibebedfbcgbhckajbnijec';
var REPO = 'https://github.com/jeremyinthebay/united-starlink-companion';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
/* JSON-LD goes inside a <script>, so the only dangerous sequence is `</` */
function ld(obj) {
  return '<script type="application/ld+json">' +
    JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
}

/* ── THE WAFFLE MARK ───────────────────────────────────────────────────────
 * The hangar-floor waffle is the one picture on this site that is ours: a grid
 * of cells, most of them dim, a band of them lit. It means the same thing at 16
 * pixels as it does at full width on /united/fleet/ — this is the fleet, and
 * this much of it is flying. So it is also the logo, the favicon and the OG
 * image, and the old rounded-square wifi arc in United's blue-to-sky gradient
 * is gone. There is no house colour any more; the lit cells take the green end
 * of the score arc because that is what a lit cell is.
 *
 * The favicon is an inline data URI so it costs no request. Sixteen pixels, a
 * 4×4 grid: the bottom row and one cell above it are lit, which is roughly
 * where the industry actually is. Regenerate the OG image with
 * `python3 build/make-brand.py og`; it draws the same mark from the same
 * tokens. */
function _cell(x, y) {
  return "%3Crect x='" + x + "' y='" + y + "' width='2.5' height='2.5'/%3E";
}
var FAVICON = (function () {
  var col = [2, 5.5, 9, 12.5], dim = '', lit = '';
  col.forEach(function (x) { dim += _cell(x, 2) + _cell(x, 5.5); });
  [5.5, 9, 12.5].forEach(function (x) { dim += _cell(x, 9); });
  lit += _cell(2, 9);
  col.forEach(function (x) { lit += _cell(x, 12.5); });
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E" +
    "%3Crect width='16' height='16' fill='%230a0c0d'/%3E" +
    "%3Cg fill='%23444d50'%3E" + dim + "%3C/g%3E" +
    "%3Cg fill='%233fcf8e'%3E" + lit + "%3C/g%3E%3C/svg%3E";
})();

/* Set data-theme BEFORE first paint or the dark default flashes on a light
   preference. localStorage.woTheme is the only key this site ever writes.
 *
 * It also sets html.js here rather than leaving that to site.js. site.js is
 * `defer`, so it lands after the document is parsed — which meant `.needs-js`
 * content was hidden and `.no-js-only` content was VISIBLE for the first paint of
 * every page. Invisible on the old pages (a filter chip row appearing late is
 * nothing); very visible now that the homepage's above-the-fold answer box is
 * `.needs-js` and its fallback is a list of 18 airline links. One statement, in
 * the <head>, before paint. site.js still adds the class — it is idempotent, and
 * site.js must keep working if this tag is ever dropped. */
var THEME_BOOT = '<script>(function(){var r=document.documentElement;r.classList.add("js");' +
  'try{var t=localStorage.getItem("woTheme");' +
  'if(t==="light"||t==="dark")r.setAttribute("data-theme",t);}catch(e){}})();</script>';

/* The header lockup: 24 cells, 7 lit. currentColor for the dim ones so the mark
 * follows the ink in both themes; var(--good) for the lit band so it follows the
 * score arc. Both are inline SVG in the document, so the custom property
 * resolves — this would silently fall back to black in an <img>. */
var MARK_SVG = (function () {
  var xs = [0, 4.6, 9.2, 13.8, 18.4, 23], dim = '', lit = '';
  function r(x, y) { return '<rect x="' + x + '" y="' + y + '" width="3" height="3"/>'; }
  xs.forEach(function (x) { dim += r(x, 0) + r(x, 4.6); });
  xs.slice(1).forEach(function (x) { dim += r(x, 9.2); });
  lit += r(0, 9.2);
  xs.forEach(function (x) { lit += r(x, 13.8); });
  return '<svg width="26" height="17" viewBox="0 0 26 17" aria-hidden="true" focusable="false">' +
    '<g fill="currentColor" opacity=".55">' + dim + '</g>' +
    '<g fill="var(--good)">' + lit + '</g></svg>';
})();

/* ── the plate header strip date ───────────────────────────────────────────
 * "2026-07-25" → "25 JUL 2026". Split the string; never hand it to `new Date()`,
 * which reads a bare ISO date as UTC midnight and then prints it in the local
 * zone, so half the planet gets the 24th. The date comes from united/data.json
 * through H.page({updated}), so the strip cannot claim a freshness the data does
 * not have. */
var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function plateDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '').toUpperCase();
  return String(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

/* ── TWO-LEVEL NAVIGATION ─────────────────────────────────────────────────
 * NAV is the GLOBAL row and is identical on every page. It must stay free of
 * anything airline-specific: with 18 airlines there is no version of "Fleet" or
 * "United" that belongs in a site-wide header. Per-airline pages get a SECOND
 * row (subnav) scoped to that airline instead. If you are tempted to add an
 * airline link here, add a SUBNAV section instead. */
var NAV = [
  ['/airlines/', 'Airlines'],
  /* /race/ earns a global slot because it is the one page that is about the whole
     industry rather than one carrier — it replaced a homepage section that was
     three views of United. /systems/ deliberately does NOT get one: it is
     evergreen reference reached from the footer, the homepage teaser and /race/,
     and a four-item nav plus the CTA is already the mobile limit. */
  ['/race/', 'The Race'],
  ['/roadmap/', 'Roadmap']
];

/* Airline sections. Key = section id passed as page({section:…}); the active tab
 * is decided by canonical, so a page never has to name itself twice. */
var SUBNAV = {
  united: {
    label: 'United',
    tabs: [
      ['/airlines/united/', 'Overview'],
      ['/united/', 'Route optimizer'],
      ['/united/fleet/', 'Fleet'],
      ['/united/history/', 'History']
    ]
  },
  alaska: {
    label: 'Alaska',
    tabs: [
      ['/airlines/alaska/', 'Overview'],
      ['/alaska/', 'Rollout']
    ]
  }
};

/* section: 'united' | 'alaska' | 'airline' (the 16 single-page airlines) */
function subnav(section, here, label) {
  if (!section) return '';
  var s = SUBNAV[section];
  if (!s) {
    /* single-page airline — no tabs to offer, just the way back */
    return '<nav class="subnav lone" aria-label="Airline">' +
      '<a class="sn-back" href="/airlines/">← All airlines</a>' +
      (label ? '<span class="sn-air">' + esc(label) + '</span>' : '') + '</nav>\n';
  }
  return '<nav class="subnav" aria-label="' + esc(s.label) + ' pages">' +
    '<span class="sn-air">' + esc(s.label) + ' ·</span>' +
    s.tabs.map(function (t) {
      return '<a class="sn-tab" href="' + t[0] + '"' +
        (t[0] === here ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
    }).join('') +
    '<a class="sn-back" href="/airlines/">All airlines →</a></nav>\n';
}

/* THE PLATE HEADER STRIP, and it is on every page.
 *
 *     WIFI ODDS · CONNECTSCORE · DATA EFF 25 JUL 2026 · AMDT DAILY
 *
 * Read it as one line: the wordmark is the first field of the strip, not a logo
 * sitting next to it. That is the approach-plate header idiom, where the chart
 * tells you what it is, what it measures, the date it is effective and how often
 * it is amended, before it tells you anything else. The date is `updated` from
 * the build data. If you ever find yourself typing a month name in here, stop. */
function topbar(here, suffix, updated) {
  return '<div class="topbar">\n' +
    '  <a class="mark" href="/"><span class="glyph" aria-hidden="true">' + MARK_SVG + '</span>' +
    '<span class="wm">WiFi Odds' + (suffix ? ' <em>· ' + esc(suffix) + '</em>' : '') + '</span></a>\n' +
    '  <p class="stripmeta">ConnectScore · Data eff <b>' + esc(plateDate(updated)) +
    '</b> · Amdt daily</p>\n' +
    '  <nav class="topnav" aria-label="Main">\n' +
    NAV.map(function (n) {
      return '    <a href="' + n[0] + '"' + (n[0] === here ? ' aria-current="page"' : '') + '>' + n[1] + '</a>\n';
    }).join('') +
    '    <a class="cta" href="' + EXT + '" target="_blank" rel="noopener">Get the extension</a>\n' +
    '  </nav>\n' +
    '  <button class="tt" type="button" aria-label="Switch theme" title="Switch theme">☽</button>\n' +
    '</div>\n';
}

function crumb(items) {
  if (!items || !items.length) return '';
  var out = items.map(function (it, i) {
    var last = i === items.length - 1;
    return last ? '<span aria-current="page">' + esc(it[1]) + '</span>'
      : '<a href="' + it[0] + '">' + esc(it[1]) + '</a>';
  });
  return '<nav class="crumb" aria-label="Breadcrumb">' + out.join('<span class="sep">→</span>') + '</nav>\n';
}

/* The credit strip. Non-negotiable on every data page — above the fold there,
   in the footer everywhere else. */
function credit(which) {
  var body;
  if (which === 'alaska') {
    body = 'Every Alaska figure here comes from <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener"><b>alaskastarlinktracker.com</b></a>, ' +
      'the independent community tracker built by <b>@martinamps</b>, which verifies each tail against Alaska’s own site. ' +
      'All credit for the data goes to them — visit for live per-tail status and much more ↗.';
  } else if (which === 'united') {
    body = 'Fleet verification comes from <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener"><b>unitedstarlinktracker.com</b></a>, ' +
      'the independent community tracker built by <b>@martinamps</b>, which verifies every United tail against united.com. ' +
      'All credit for the data goes to them — visit for live per-tail status and much more ↗.';
  } else {
    body = 'Fleet verification for the instrumented airlines comes from the independent community trackers ' +
      '<a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener"><b>unitedstarlinktracker.com</b></a> and ' +
      '<a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener"><b>alaskastarlinktracker.com</b></a>, built by <b>@martinamps</b>. ' +
      'All credit for that data goes to them ↗. Every other airline is compiled from public airline announcements (July 2026).';
  }
  return '<div class="credit"><span class="cb">DATA CREDIT</span><span class="cbody">' + body +
    ' WiFi Odds is unofficial and not affiliated with any airline, SpaceX/Starlink, Amazon, Viasat, or the trackers.</span></div>\n';
}

function footer(updated) {
  return '<footer>\n' +
    '  <div class="flinks"><a href="/airlines/">Airlines</a><a href="/race/">The Race</a>' +
    '<a href="/systems/">Systems</a><a href="/united/">United</a>' +
    '<a href="/united/fleet/">Fleet</a><a href="/alaska/">Alaska</a><a href="/roadmap/">Roadmap</a>' +
    /* Methodology is linked from the FOOTER and from the leaderboard's caveat, not
       from the global topnav: NAV stays two items plus the CTA, and a provenance
       page is something a reader goes looking for rather than something that
       needs to compete with "Airlines" on every screen. */
    '<a href="/methodology/">Methodology</a>' +
    '<a href="/api/docs/">API</a><a href="/privacy.html">Privacy</a>' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">Open source ↗</a></div>\n' +
    '  <div>Fleet data: <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">unitedstarlinktracker.com</a> ' +
    '· <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener">alaskastarlinktracker.com</a> ' +
    '(independent community trackers by @martinamps) · every other airline from public announcements, July 2026.</div>\n' +
    '  <div class="frow"><b>No accounts, no analytics, no tracking</b> on this site or in the extension. ' +
    'The only thing stored in your browser is your light/dark choice. See the <a href="/privacy.html">privacy policy</a>.</div>\n' +
    '  <div class="frow">Data updated <b>' + esc(updated) + '</b>. ConnectScores and per-flight odds are ' +
    'historical estimates, not guarantees. Aircraft assignments change until departure. WiFi Odds is an ' +
    'unofficial, free, open-source project. 🛰️</div>\n' +
    '</footer>\n';
}

/* opts: {title, desc, canonical, here, suffix, section, crumb, jsonld[], body,
 *        extraHead, preWrap, afterWrap}
 *
 * preWrap / afterWrap exist for the template-backed pages (build/lib/tmpl.js):
 *   preWrap   — sits between <body> and <div class="wrap">. /united/ puts its
 *               starfield <canvas id="stars"> there, outside the column.
 *   afterWrap — sits after </div>, BEFORE /assets/site.js. That ordering is
 *               load-bearing: /united/ and /united/history/ ship inline app
 *               scripts that must run before the shared shell script, exactly as
 *               they did when those pages were hand-authored. */
function page(o) {
  var title = esc(o.title);
  var desc = esc(o.desc);
  var url = ORIGIN + o.canonical;
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n' +
    THEME_BOOT + '\n' +
    '<link rel="icon" href="' + FAVICON + '">\n' +
    '<title>' + title + '</title>\n' +
    '<meta name="description" content="' + desc + '">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="WiFi Odds">\n' +
    '<meta property="og:title" content="' + title + '">\n' +
    '<meta property="og:description" content="' + desc + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:image" content="' + ORIGIN + '/assets/og.png?v=3">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:image:alt" content="WiFi Odds — know before you book">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + title + '">\n' +
    '<meta name="twitter:description" content="' + desc + '">\n' +
    '<meta name="twitter:image" content="' + ORIGIN + '/assets/og.png?v=3">\n' +
    /* B612, self-hosted. The two regular faces are preloaded because they are on
     * the critical path for the first screen and the heading and every numeral
     * are set in them; the bolds can arrive with the stylesheet. `crossorigin` is
     * required even same-origin — a font preload without it is fetched twice.
     * Nothing here, and nothing in site.css, points at a third party. */
    '<link rel="preload" href="/assets/b612-400.woff2" as="font" type="font/woff2" crossorigin>\n' +
    '<link rel="preload" href="/assets/b612mono-400.woff2" as="font" type="font/woff2" crossorigin>\n' +
    '<link rel="stylesheet" href="/assets/site.css?v=' + assetHash('assets/site.css') + '">\n' +
    (o.extraHead || '') +
    (o.jsonld || []).map(ld).join('\n') + '\n' +
    '</head>\n<body>\n' +
    (o.preWrap || '') +
    '<div class="wrap">\n' +
    topbar(o.here, o.suffix, o.updated) +
    subnav(o.section, o.canonical, o.suffix) +
    (o.crumb ? crumb(o.crumb) : '') +
    o.body +
    footer(o.updated) +
    '</div>\n' +
    (o.afterWrap || '') +
    '<script src="/assets/site.js?v=' + assetHash('assets/site.js') + '" defer></script>\n</body>\n</html>\n';
}

module.exports = {
  ORIGIN: ORIGIN, EXT: EXT, REPO: REPO, NAV: NAV, SUBNAV: SUBNAV,
  esc: esc, ld: ld, page: page, topbar: topbar, subnav: subnav,
  crumb: crumb, credit: credit, footer: footer,
  plateDate: plateDate, MARK_SVG: MARK_SVG, FAVICON: FAVICON
};
