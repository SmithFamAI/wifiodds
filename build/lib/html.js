'use strict';
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

var FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2369B3E7'/%3E%3Cstop offset='1' stop-color='%230033A0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='9' fill='url(%23g)'/%3E%3Cpath d='M9 21c3-9 11-9 14-13' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='11' cy='22' r='2.6' fill='%23fff'/%3E%3C/svg%3E";

/* Set data-theme BEFORE first paint or the dark default flashes on a light
   preference. localStorage.woTheme is the only key this site ever writes. */
var THEME_BOOT = '<script>(function(){try{var t=localStorage.getItem("woTheme");' +
  'if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>';

var MARK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round">' +
  '<path d="M4.5 10.5a11 11 0 0 1 15 0"/><path d="M7.6 14a7 7 0 0 1 8.8 0"/>' +
  '<circle cx="12" cy="18.2" r="1.5" fill="#fff" stroke="none"/></svg>';

/* ── TWO-LEVEL NAVIGATION ─────────────────────────────────────────────────
 * NAV is the GLOBAL row and is identical on every page. It must stay free of
 * anything airline-specific: with 18 airlines there is no version of "Fleet" or
 * "United" that belongs in a site-wide header. Per-airline pages get a SECOND
 * row (subnav) scoped to that airline instead. If you are tempted to add an
 * airline link here, add a SUBNAV section instead. */
var NAV = [
  ['/airlines/', 'Airlines'],
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

function topbar(here, suffix) {
  return '<div class="topbar">\n' +
    '  <a class="mark" href="/"><span class="glyph" aria-hidden="true">' + MARK_SVG + '</span>' +
    '<span class="wm">WiFi Odds' + (suffix ? ' <em>· ' + esc(suffix) + '</em>' : '') + '</span></a>\n' +
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
    '  <div class="flinks"><a href="/airlines/">Airlines</a><a href="/united/">United</a>' +
    '<a href="/united/fleet/">Fleet</a><a href="/alaska/">Alaska</a><a href="/roadmap/">Roadmap</a>' +
    '<a href="/privacy.html">Privacy</a>' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">Open source ↗</a></div>\n' +
    '  <div>Fleet data: <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">unitedstarlinktracker.com</a> ' +
    '· <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener">alaskastarlinktracker.com</a> ' +
    '(independent community trackers by @martinamps) · every other airline from public announcements, July 2026.</div>\n' +
    '  <div class="frow"><b>No accounts, no analytics, no tracking</b> — on this site or in the extension. ' +
    'The only thing stored in your browser is your light/dark choice. See the <a href="/privacy.html">privacy policy</a>.</div>\n' +
    '  <div class="frow">Data updated <b>' + esc(updated) + '</b>. ConnectScores and per-flight odds are ' +
    'historical estimates, not guarantees — aircraft assignments change until departure. WiFi Odds is an ' +
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
    '<meta property="og:image" content="' + ORIGIN + '/assets/og.png?v=2">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:image:alt" content="WiFi Odds — know before you book">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + title + '">\n' +
    '<meta name="twitter:description" content="' + desc + '">\n' +
    '<meta name="twitter:image" content="' + ORIGIN + '/assets/og.png?v=2">\n' +
    '<link rel="stylesheet" href="/assets/site.css">\n' +
    (o.extraHead || '') +
    (o.jsonld || []).map(ld).join('\n') + '\n' +
    '</head>\n<body>\n' +
    (o.preWrap || '') +
    '<div class="wrap">\n' +
    topbar(o.here, o.suffix) +
    subnav(o.section, o.canonical, o.suffix) +
    (o.crumb ? crumb(o.crumb) : '') +
    o.body +
    footer(o.updated) +
    '</div>\n' +
    (o.afterWrap || '') +
    '<script src="/assets/site.js" defer></script>\n</body>\n</html>\n';
}

module.exports = {
  ORIGIN: ORIGIN, EXT: EXT, REPO: REPO, NAV: NAV, SUBNAV: SUBNAV,
  esc: esc, ld: ld, page: page, topbar: topbar, subnav: subnav,
  crumb: crumb, credit: credit, footer: footer
};
