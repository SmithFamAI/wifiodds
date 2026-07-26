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
 * masthead nav that is byte-identical everywhere, plus an optional per-airline
 * subnav. If a page needs a different global nav, the nav is wrong, not the page.
 *
 * The chrome here is The Forecast, ported from public/wifiodds-fable/ in the
 * websites repo. The spec is ARCHETYPES.md; where this file and that file
 * disagree, that file wins. The pieces it fixes: the sky rule at the top edge of
 * every page, the masthead (orbit mark, serif wordmark, nav, theme switch,
 * datechip), crumbs below the header on every page under the homepage, the
 * footer with its unaffiliated line and its theme sentence, and the extension
 * banner, which is homepage-only and appears nowhere else on the site. */

var ORIGIN = 'https://wifiodds.com';
var EXT = 'https://chromewebstore.google.com/detail/starlink-odds-for-united/ojpladpffbibebedfbcgbhckajbnijec';
var REPO = 'https://github.com/jeremyinthebay/united-starlink-companion';
/* What the store serves TODAY, not what is in review. The banner prints it, so
 * a stale value here is a wrong claim on the homepage. build/lib/pages.js also
 * carries this string in its extension section; when the store ships a new
 * build, both move. */
var EXT_VERSION = '1.5.1';

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

/* ── THE ORBIT MARK ────────────────────────────────────────────────────────
 * A ring at 22 degrees, a body on it, a satellite riding it. It is the site's
 * one picture and it means what the site is about: something in orbit, over
 * something in the air. It reads at 16 pixels and at poster size, so it is the
 * favicon, the masthead lockup and the OG image, all one drawing.
 *
 * It is SKY, because the mark is chrome. It is never green, amber or clay —
 * those belong to numbers. The waffle it replaced took the green end of the
 * score arc for its lit cells, which was a logo wearing a band, and the whole
 * point of the two-owner rule is that it does not get to do that. The waffle
 * itself survives on /united/fleet/, where each lit cell IS a count.
 *
 * The favicon is an inline data URI so it costs no request. It carries the
 * sky-deep ground and a white mark, since a favicon has no CSS to inherit from
 * and must survive on both a light and a dark browser chrome. Regenerate the OG
 * image with `python3 build/make-brand.py og`; it draws the same mark from the
 * same tokens. */
var FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
  "viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%2322455f'/%3E" +
  "%3Cellipse cx='16' cy='16' rx='11' ry='4.6' fill='none' stroke='%23fff' " +
  "stroke-width='2' transform='rotate(-22 16 16)'/%3E" +
  "%3Ccircle cx='16' cy='16' r='5.2' fill='%23fff'/%3E" +
  "%3Ccircle cx='26.2' cy='11.9' r='2.3' fill='%23fff'/%3E%3C/svg%3E";

/* The masthead lockup. Drawn in currentColor and coloured by `.wordmark .mk` in
 * site.css, so it follows --sky in both themes. It is inline SVG in the
 * document, which is why the custom property resolves at all — inside an <img>
 * it would silently fall back to black. */
var MARK_SVG = '<svg class="mk" viewBox="0 0 32 32" width="17" height="17" ' +
  'aria-hidden="true" focusable="false">' +
  '<ellipse cx="16" cy="16" rx="11" ry="4.6" fill="none" stroke="currentColor" ' +
  'stroke-width="2" transform="rotate(-22 16 16)"/>' +
  '<circle cx="16" cy="16" r="5.2" fill="currentColor"/>' +
  '<circle cx="26.2" cy="11.9" r="2.3" fill="currentColor"/></svg>';

/* ── THE THEME BOOT, AND WHY IT STORES NOTHING ─────────────────────────────
 * Light is the default and dark is a media query, so the FIRST PAINT is already
 * correct with this script deleted, with JavaScript off, and on a browser that
 * never runs it. All this does is write the same answer onto <html> as a class,
 * because a class is something the switch can toggle and a media query is not.
 *
 * There is no localStorage. The old build wrote localStorage.woTheme and the
 * footer advertised it as "the only thing stored in your browser"; the spec
 * allows no storage of any kind, so the key is gone, the read is gone, and the
 * switch now lasts until you reload. That is the ceiling for cleverness here.
 *
 * It also sets html.js rather than leaving that to site.js. site.js is `defer`,
 * so it lands after the document is parsed — which meant `.needs-js` content was
 * hidden and `.no-js-only` content was VISIBLE for the first paint of every
 * page. Invisible on the old pages (a filter chip row appearing late is
 * nothing); very visible now that the homepage's above-the-fold answer box is
 * `.needs-js` and its fallback is a list of 18 airline links. One statement, in
 * the <head>, before paint. site.js still adds the class — it is idempotent, and
 * site.js must keep working if this tag is ever dropped. */
var THEME_BOOT = '<script>(function(){var r=document.documentElement;r.classList.add("js");' +
  'try{r.classList.add(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}' +
  'catch(e){}})();</script>';

/* The switch itself, wired after the button exists. It flips two classes and
 * writes nothing anywhere. If this script never runs, the button stays `hidden`
 * and the page follows the OS — which is the correct state, not a degraded one:
 * a control that cannot work should not be on screen. */
var THEME_SWITCH = '<script>(function(){var r=document.documentElement,' +
  'b=document.getElementById("themetoggle");if(!b)return;' +
  'function p(){b.textContent=r.classList.contains("dark")?"Light mode":"Dark mode";}' +
  'b.hidden=false;p();b.addEventListener("click",function(){' +
  'var d=r.classList.contains("dark");r.classList.toggle("dark",!d);' +
  'r.classList.toggle("light",d);p();});})();</script>\n';

/* ── dates ─────────────────────────────────────────────────────────────────
 * "2026-07-25" → "25 JUL 2026" (plateDate, used across build/lib/render.js in
 * source lines) and "25 Jul 2026" (chipDate, the masthead). Split the string;
 * never hand it to `new Date()`, which reads a bare ISO date as UTC midnight and
 * then prints it in the local zone, so half the planet gets the 24th. The date
 * comes from united/data.json through H.page({updated}), so the masthead cannot
 * claim a freshness the data does not have. */
var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function plateDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '').toUpperCase();
  return String(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}
function chipDate(iso) {
  var s = plateDate(iso);
  return s.replace(/\b([A-Z])([A-Z]{2})\b/, function (_, a, b) { return a + b.toLowerCase(); });
}

/* ── TWO-LEVEL NAVIGATION ─────────────────────────────────────────────────
 * NAV is the GLOBAL row and is identical on every page. It must stay free of
 * anything airline-specific: with 18 airlines there is no version of "Fleet" or
 * "United" that belongs in a site-wide header. Per-airline pages get a SECOND
 * row (subnav) scoped to that airline instead. If you are tempted to add an
 * airline link here, add a SUBNAV section instead.
 *
 * The Extension entry is a plain nav link, not a button. It used to be a `.cta`
 * block, which put an install ask in the masthead of thirty routes; the spec
 * allows exactly one pitch on this site and it is the companion half of the
 * homepage. The link keeps its `.cta` class name so nothing that targets it
 * breaks, and the class no longer means "call to action" in the CSS. */
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
    '<span class="sn-air">' + esc(s.label) + '</span>' +
    s.tabs.map(function (t) {
      return '<a class="sn-tab" href="' + t[0] + '"' +
        (t[0] === here ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
    }).join('') +
    '<a class="sn-back" href="/airlines/">All airlines →</a></nav>\n';
}

/* ── THE EXTENSION BANNER ──────────────────────────────────────────────────
 * HOMEPAGE ONLY. One strip, above the masthead, in the same sky as the rule at
 * the page's top edge, so the rule reads as the banner's top border there.
 *
 * It is wayfinding, not a pitch: it exists for the visitor who arrived only to
 * install, and it hands everyone else a jump to the companion half instead of
 * arguing with them. It carries the store link with the version the store serves
 * today, and one jump. It never grows a second sentence, and it appears on no
 * other route — page() emits it for canonical '/' and nothing else. */
function extbar() {
  return '<div class="extbar" role="navigation" aria-label="Extension shortcuts">\n' +
    '  <div class="wrap">\n' +
    '    <span class="q">Here for the Chrome extension?</span>\n' +
    '    <a class="store" href="' + EXT + '" target="_blank" rel="noopener">Grab v' +
    esc(EXT_VERSION) + ' from the Chrome Web Store</a>\n' +
    '    <a class="jump" href="#extension">or jump to what it does</a>\n' +
    '  </div>\n</div>\n';
}

/* THE MASTHEAD, and it is on every page.
 *
 *     ◉ WiFi Odds        Airlines  The Race  Roadmap  Extension   [Dark mode]
 *     Inflight WiFi as a forecast · figures checked daily · this build 25 Jul 2026
 *
 * Orbit mark, serif wordmark, nav, the theme switch, then the datechip on its
 * own line. The datechip is what the approach-plate strip used to be, said the
 * way a person says it: what this site is, how often it is checked, and the date
 * of the build in front of you. The date is `updated` from the build data. If
 * you ever find yourself typing a month name in here, stop.
 *
 * The switch ships `hidden` and the inline script at the foot of the page
 * reveals it. Its title text is deliberate down to the last clause — it is the
 * only place a reader is told that the choice is not stored. */
function masthead(here, suffix, updated) {
  return '<header class="site">\n' +
    '  <div class="wrap masthead">\n' +
    '    <a class="wordmark" href="/">' + MARK_SVG + 'WiFi&nbsp;Odds' +
    (suffix ? ' <em>· ' + esc(suffix) + '</em>' : '') + '</a>\n' +
    '    <nav aria-label="Main">\n' +
    NAV.map(function (n) {
      return '      <a href="' + n[0] + '"' + (n[0] === here ? ' aria-current="page"' : '') + '>' + n[1] + '</a>\n';
    }).join('') +
    '      <a class="cta" href="' + EXT + '" target="_blank" rel="noopener">Extension</a>\n' +
    '    </nav>\n' +
    '    <button class="themetoggle" id="themetoggle" type="button" hidden\n' +
    '      title="Follows your system setting by default. The switch lasts until you reload; nothing is stored."></button>\n' +
    '    <div class="datechip">Inflight WiFi as a forecast · figures checked daily · this build <b>' +
    esc(chipDate(updated)) + '</b></div>\n' +
    '  </div>\n</header>\n';
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

/* The footer: nav, the source line, the unaffiliated line, and the theme
 * sentence. That last one is not boilerplate. The site stores nothing at all
 * now, so the reader is told what the switch does and what happens to their
 * choice, in one sentence, on every page. The old copy said "the only thing
 * stored in your browser is your light/dark choice" — that key is gone, and a
 * footer that still claimed it would be the site lying about its own storage on
 * thirty routes. */
function footer(updated) {
  return '<footer class="site">\n' +
    '  <div class="flinks"><a href="/airlines/">Airlines</a><a href="/race/">The Race</a>' +
    '<a href="/systems/">Systems</a><a href="/united/">United</a>' +
    '<a href="/united/fleet/">Fleet</a><a href="/alaska/">Alaska</a><a href="/roadmap/">Roadmap</a>' +
    /* Methodology is linked from the FOOTER and from the leaderboard's caveat, not
       from the masthead: the global nav stays three items plus the Extension link,
       and a provenance page is something a reader goes looking for rather than
       something that needs to compete with "Airlines" on every screen. */
    '<a href="/methodology/">Methodology</a>' +
    '<a href="/api/docs/">API</a><a href="/privacy">Privacy</a>' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">Open source ↗</a></div>\n' +
    '  <div>Fleet data: <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">unitedstarlinktracker.com</a> ' +
    '· <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener">alaskastarlinktracker.com</a> ' +
    '(independent community trackers by @martinamps) · every other airline from public announcements, July 2026.</div>\n' +
    '  <div class="frow">Data updated <b>' + esc(updated) + '</b>. ConnectScores and per-flight odds are ' +
    'historical estimates, and aircraft assignments change until departure. WiFi Odds is unofficial and ' +
    'unaffiliated with any airline, SpaceX, Amazon, Viasat, or the trackers.</div>\n' +
    '  <div class="frow"><b>No accounts, no analytics, no tracking</b> on this site or in the extension, and ' +
    'nothing is stored in your browser. What the server keeps is on the <a href="/privacy">privacy page</a>.</div>\n' +
    '  <div class="frow">The page follows your system’s light or dark setting. The switch in the header ' +
    'lasts until you reload, and nothing about your choice is stored.</div>\n' +
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
    '<meta property="og:image" content="' + ORIGIN + '/assets/og.png?v=' + assetHash('assets/og.png') + '">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:image:alt" content="WiFi Odds — know before you book">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + title + '">\n' +
    '<meta name="twitter:description" content="' + desc + '">\n' +
    '<meta name="twitter:image" content="' + ORIGIN + '/assets/og.png?v=' + assetHash('assets/og.png') + '">\n' +
    /* Source Serif 4, self-hosted, both weights preloaded: the 700 sets the
     * heading and the 400 sets the say-sentence, and both are on the first screen
     * of every route. The reporting voice is system-ui and costs no request at
     * all. `crossorigin` is required even same-origin — a font preload without it
     * is fetched twice. Nothing here, and nothing in site.css, points at a third
     * party.
     *
     * THESE TWO URLS CARRY NO ?v= HASH, AND THAT IS DELIBERATE. A preload only
     * counts if its URL matches the @font-face `src` byte for byte, and that src
     * lives in static CSS which cannot interpolate a hash. Hashing here would
     * preload one URL and then fetch a second one — two downloads of the same
     * font on every cold load, which is worse than the stale-cache risk it would
     * be solving. Fonts change about once a redesign; when the bytes change,
     * change the FILENAME (and the three places that name it: this block,
     * assets/site.css @font-face, build/routes.js REQUIRED). */
    '<link rel="preload" href="/assets/serif-400.woff2" as="font" type="font/woff2" crossorigin>\n' +
    '<link rel="preload" href="/assets/serif-700.woff2" as="font" type="font/woff2" crossorigin>\n' +
    '<link rel="stylesheet" href="/assets/site.css?v=' + assetHash('assets/site.css') + '">\n' +
    (o.extraHead || '') +
    (o.jsonld || []).map(ld).join('\n') + '\n' +
    '</head>\n<body>\n' +
    /* The banner sits OUTSIDE .wrap and above the masthead, because it is a
       full-bleed strip of sky and the column starts under it. Homepage only. */
    (o.canonical === '/' ? extbar() : '') +
    (o.preWrap || '') +
    masthead(o.here, o.suffix, o.updated) +
    '<div class="wrap">\n' +
    subnav(o.section, o.canonical, o.suffix) +
    (o.crumb ? crumb(o.crumb) : '') +
    o.body +
    footer(o.updated) +
    '</div>\n' +
    (o.afterWrap || '') +
    THEME_SWITCH +
    '<script src="/assets/site.js?v=' + assetHash('assets/site.js') + '" defer></script>\n</body>\n</html>\n';
}

module.exports = {
  ORIGIN: ORIGIN, EXT: EXT, EXT_VERSION: EXT_VERSION, REPO: REPO,
  NAV: NAV, SUBNAV: SUBNAV,
  esc: esc, ld: ld, page: page, masthead: masthead, extbar: extbar,
  /* topbar is the old name for masthead. Kept as an alias so a caller outside
     this file cannot break on the rename; nothing in the build uses it today. */
  topbar: masthead,
  subnav: subnav, crumb: crumb, credit: credit, footer: footer,
  plateDate: plateDate, chipDate: chipDate,
  MARK_SVG: MARK_SVG, FAVICON: FAVICON
};
