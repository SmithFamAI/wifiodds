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
var EXT = 'https://chromewebstore.google.com/detail/wifi-odds-for-flights/ojpladpffbibebedfbcgbhckajbnijec';
/* Two repositories, two links. `REPO` used to be the only one and it pointed at
   the EXTENSION, under a footer label that said "Open source" — so a reader
   following it from a page about the website landed in the browser-extension
   tree. The extension repo also still carries its pre-rename name, which is
   agreed to change once the store accepts 2.0.0; when it does, only this
   constant moves. */
var REPO_SITE = 'https://github.com/jeremyinthebay/wifiodds';
var REPO_EXT = 'https://github.com/jeremyinthebay/united-starlink-companion';
var REPO = REPO_SITE;
/* What the store serves TODAY, not what is in review. The banner prints it, so
 * a stale value here is a wrong claim on the homepage. build/lib/pages.js also
 * carries this string in its extension section; when the store ships a new
 * build, both move. */
var EXT_VERSION = '2.0.0'; /* cleared review 2026-07-28; verified by listing body, not the manifest */

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
/* THE NEW LOGO (round 15 design handoff, 28 Jul 2026). Satellite + airplane +
 * odds-ring, replacing the plain orbit-ellipse mark. Source art:
 * uploads/option-satellite-main-airplane-v4.svg; Codex's nav treatment in
 * design-competition/interior-system-v1.html is "option (a)" — the artwork
 * without its 1024px background tile, at a 20px glyph size. The favicon KEEPS
 * the tile (it needs its own background, having no page to sit on) and is a
 * static two-colour rendering, because a data-URI favicon has no CSS context
 * for currentColor or a custom property to resolve against. */
var FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
  "viewBox='128 128 768 768'%3E%3Cdefs%3E%3ClinearGradient id='fnRamp' x1='270' y1='700' " +
  "x2='754' y2='700' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%2329d8ff'/%3E" +
  "%3Cstop offset='1' stop-color='%23926cff'/%3E%3C/linearGradient%3E%3C/defs%3E" +
  "%3Crect x='128' y='128' width='768' height='768' rx='160' fill='%23050505'/%3E" +
  "%3Cpath d='M292 700A320 320 0 1 1 732 700' fill='none' stroke='url(%23fnRamp)' " +
  "stroke-width='68' stroke-linecap='round'/%3E" +
  "%3Cg transform='translate(0 -24)'%3E" +
  "%3Crect x='267' y='405' width='176' height='134' rx='24' fill='url(%23fnRamp)'/%3E" +
  "%3Crect x='581' y='405' width='176' height='134' rx='24' fill='url(%23fnRamp)'/%3E" +
  "%3Cpath d='M443 472h35M546 472h35' stroke='%23f7f7f8' stroke-width='24' stroke-linecap='round'/%3E" +
  "%3Crect x='466' y='362' width='92' height='220' rx='38' fill='%23f7f7f8'/%3E" +
  "%3Ccircle cx='512' cy='472' r='31' fill='url(%23fnRamp)'/%3E" +
  "%3Cpath d='M449 300Q512 341 575 300Q563 251 512 251Q461 251 449 300Z' fill='url(%23fnRamp)'/%3E" +
  "%3C/g%3E" +
  "%3Cpath d='M512 612C499 612 492 625 489 645L480 704L410 747C399 754 393 765 393 779L478 754" +
  "L483 807L457 829V846L512 831L567 846V829L541 807L546 754L631 779C631 765 625 754 614 747" +
  "L544 704L535 645C532 625 525 612 512 612Z' fill='%23f7f7f8'/%3E%3C/svg%3E";

/* The masthead/footer lockup. The ring, solar panels and dish take the brand
 * gradient (fixed cyan → violet — a brand mark is allowed the colour a chart
 * line is not, and the V5 pivot already put this exact gradient on the
 * homepage's own pill and connect-brand chip). The satellite body, its
 * antenna bar and the airplane silhouette are `currentColor`, so they still
 * follow `.wordmark .mk{color:var(--sky)}` and stay legible in both themes —
 * a fixed near-white body was legible on interior-system-v1's permanently
 * dark ground but would nearly vanish on this site's light paper.
 *
 * It is a FUNCTION, not a constant, because the gradient needs an `id` and
 * the mark is drawn twice per page (masthead, footer); two elements sharing
 * one `id` is invalid markup, so each call site passes its own suffix. */
function markSvg(idSuffix, size) {
  var gid = 'wo-mk-' + idSuffix;
  var w = size || 17;
  return '<svg class="mk" viewBox="128 128 768 768" width="' + w + '" height="' + w + '" ' +
    'aria-hidden="true" focusable="false">' +
    '<defs><linearGradient id="' + gid + '" x1="270" y1="700" x2="754" y2="700" ' +
    'gradientUnits="userSpaceOnUse"><stop stop-color="#29d8ff"/>' +
    '<stop offset="1" stop-color="#926cff"/></linearGradient></defs>' +
    '<path d="M292 700A320 320 0 1 1 732 700" fill="none" stroke="url(#' + gid + ')" ' +
    'stroke-width="68" stroke-linecap="round"/>' +
    '<g transform="translate(0 -24)">' +
    '<rect x="267" y="405" width="176" height="134" rx="24" fill="url(#' + gid + ')"/>' +
    '<rect x="581" y="405" width="176" height="134" rx="24" fill="url(#' + gid + ')"/>' +
    '<path d="M443 472h35M546 472h35" stroke="currentColor" stroke-width="24" stroke-linecap="round"/>' +
    '<rect x="466" y="362" width="92" height="220" rx="38" fill="currentColor"/>' +
    '<circle cx="512" cy="472" r="31" fill="url(#' + gid + ')"/>' +
    '<path d="M449 300Q512 341 575 300Q563 251 512 251Q461 251 449 300Z" fill="url(#' + gid + ')"/>' +
    '</g>' +
    '<path d="M512 612C499 612 492 625 489 645L480 704L410 747C399 754 393 765 393 779L478 754' +
    'L483 807L457 829V846L512 831L567 846V829L541 807L546 754L631 779C631 765 625 754 614 747' +
    'L544 704L535 645C532 625 525 612 512 612Z" fill="currentColor"/></svg>';
}

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
/* DARK IS THE DEFAULT, by Jeremy's call on 26 Jul 2026, overriding the earlier
 * follow-the-system rule. Every visitor boots dark; the switch offers light and
 * lasts until reload. The `js` class still gates .needs-js as before. */
/* ── ONE SEMANTIC SETTING. The boot code and the footer copy are both generated
 * from it, so neither can be authored into disagreement.
 *
 * The previous version derived the sentence by running a regex over the boot
 * script's source text. An auditor replaced two equivalent calls with
 * `classList.add("js","dark")`, which still boots dark, and the regex stopped
 * matching, so the footer flipped to "follows your system" and the build passed.
 * Deriving copy from the SPELLING of code recognises one way of writing the
 * behaviour, not the behaviour. `className += " dark"` would have done it too.
 *
 * There is now nothing to spell. Change DEFAULT_THEME and both the script and
 * the sentence move together. */
var DEFAULT_THEME = 'dark';           /* 'dark' | 'system' */

var THEME_BOOT = '<script>(function(){var r=document.documentElement;' +
  'r.classList.add("js");' +
  (DEFAULT_THEME === 'dark'
    ? 'r.classList.add("dark");'
    : 'if(matchMedia("(prefers-color-scheme: dark)").matches)r.classList.add("dark");') +
  '})();</script>';

/* ── the theme sentence is DERIVED from the theme code, not written beside it ──
 * The footer used to say "The page follows your system's light or dark setting"
 * while the line above added "dark" unconditionally. An auditor then broke the
 * guard I wrote for that by inventing a DIFFERENT false sentence: my check
 * pattern-matched the one lie it had seen, so a fresh one walked through.
 *
 * Pattern-matching known lies is a losing game; there are infinitely many. The
 * sentence is now chosen by reading what the boot script actually does, so the
 * copy and the behaviour cannot drift apart. Change THEME_BOOT to respect the
 * system preference and the footer rewrites itself. There is no state in which
 * this sentence is wrong, which is a better property than a test that catches
 * one way of being wrong. */
var THEME_SENTENCE = DEFAULT_THEME === 'dark'
  ? 'The page is dark by default, whatever your system is set to. The switch in the header ' +
    'lasts until you reload, and nothing about your choice is stored.'
  : 'The page follows your system’s light or dark setting. The switch in the header ' +
    'lasts until you reload, and nothing about your choice is stored.';

/* The switch itself, wired after the button exists. It flips two classes and
 * writes nothing anywhere. If this script never runs, the button stays `hidden`
 * and the page stays dark — a control that cannot work should not be on
 * screen. */
/* The label says what clicking DOES, not what the state is, because "Light
 * mode" as a label reads as a caption to half the people who meet it. */
var THEME_SWITCH = '<script>(function(){var r=document.documentElement,' +
  'b=document.getElementById("themetoggle");if(!b)return;' +
  'function p(){var d=r.classList.contains("dark");' +
  'b.innerHTML=d?"\\u2600\\uFE0E <u>Switch to light</u>":"\\u263D <u>Switch to dark</u>";}' +
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
 * The Extension entry is a plain nav link to the homepage's companion section,
 * not a store link: the store surfaces are Google's badge, twice on the
 * homepage, plus United's #plugin block, and the masthead is not one of them. */
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

/* THE EXTENSION BANNER IS GONE — round seven, 27 Jul 2026. It was a full-width
 * strip above the masthead that pitched before the page had said anything; do
 * not bring THAT back. The masthead's own `.pill` CTA (added in the round 15
 * interior port, 28 Jul 2026) is a different thing — a single compact link in
 * the nav row, the same shape as the homepage's `.pill.primary`, not a strip.
 * The sitewide store surface is now: the homepage's two badges, United's
 * #plugin block, and this one masthead pill, present on every page. */

/* THE MASTHEAD, and it is on every page.
 *
 *     ◉ WiFi Odds    Airlines  The Race  Roadmap  Extension  [Add to Chrome]  [Dark mode]
 *     Inflight WiFi as a forecast · figures checked daily · this build 25 Jul 2026
 *
 * New logo mark, sans wordmark, nav, the CTA pill, the theme switch, then the
 * datechip on its own line — ported from design-competition/interior-system-v1.html
 * (round 15). The datechip is what the approach-plate strip used to be, said the
 * way a person says it: what this site is, how often it is checked, and the date
 * of the build in front of you. The date is `updated` from the build data. If
 * you ever find yourself typing a month name in here, stop.
 *
 * The switch ships `hidden` and the inline script at the foot of the page
 * reveals it. Its title text is deliberate down to the last clause — it is the
 * only place a reader is told that the choice is not stored. */
/* wasRetained/refreshAttemptedOn (P1-01): when the daily refresh healed an
 * implausible pull by keeping the prior verified count, `updated` is that
 * count's real measurement date, not today. "this build DATE" read as an
 * unqualified freshness claim over a value that was not in fact re-measured
 * today, so on a retained day the chip has to say both: the pipeline ran
 * today, and the number in front of you is still the older one. */
function datechipText(updated, refreshAttemptedOn, wasRetained) {
  if (!wasRetained || !refreshAttemptedOn) {
    return 'Inflight WiFi as a forecast · figures checked daily · this build <b>' +
      esc(chipDate(updated)) + '</b>';
  }
  return 'Inflight WiFi as a forecast · figures checked daily · checked <b>' +
    esc(chipDate(refreshAttemptedOn)) + '</b> · data as of <b>' + esc(chipDate(updated)) + '</b>';
}
function masthead(here, suffix, updated, refreshAttemptedOn, wasRetained) {
  return '<header class="site">\n' +
    '  <div class="wrap masthead">\n' +
    '    <a class="wordmark" href="/">' + markSvg('mh') + 'WiFi&nbsp;Odds' +
    (suffix ? ' <em>· ' + esc(suffix) + '</em>' : '') + '</a>\n' +
    /* The phone menu is a checkbox and a label, so it opens with script off.
       The checkbox sits before the nav because the CSS reaches the menu with
       .nav-cb:checked~nav — keep the sibling order or the hamburger dies. */
    '    <input type="checkbox" id="nav-open" class="nav-cb" aria-label="Menu">\n' +
    '    <label class="nav-btn" for="nav-open"><span class="h" aria-hidden="true">&#9776;</span>' +
    '<span class="x" aria-hidden="true">&#10005;</span><span class="vh">Menu</span></label>\n' +
    '    <nav aria-label="Main">\n' +
    NAV.map(function (n) {
      return '      <a href="' + n[0] + '"' + (n[0] === here ? ' aria-current="page"' : '') + '>' + n[1] + '</a>\n';
    }).join('') +
    /* The Extension link points at the homepage's own #extension section (its
       id as of the 28 Jul interior port — verified live; the old #companion
       anchor no longer exists there). The pill beside it is the ONE new store
       pitch this port adds to the masthead, matching the homepage's own
       `.pill.primary`; its href is EXT, never a literal store URL, so a
       store-side path change only has to be fixed in that one constant. */
    '      <a href="/#extension">Extension</a>\n' +
    '      <a class="pill" href="' + EXT + '" target="_blank" rel="noopener">Add to Chrome</a>\n' +
    '    </nav>\n' +
    '    <button class="themetoggle" id="themetoggle" type="button" hidden\n' +
    '      title="Dark by default. The switch lasts until you reload; nothing is stored."></button>\n' +
    '    <div class="datechip">' + datechipText(updated, refreshAttemptedOn, wasRetained) + '</div>\n' +
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
  /* Literal space between the two spans: .credit is display:flex and .cb/
     .cbody are flex items (site.css), so a whitespace text node between them
     is not rendered as a box and changes no pixel — without it "DATA CREDIT"
     and the body text welded into "CREDITFleet" etc. */
  return '<div class="credit"><span class="cb">DATA CREDIT</span> <span class="cbody">' + body +
    ' WiFi Odds is unofficial and not affiliated with any airline, SpaceX/Starlink, Amazon, Viasat, or the trackers.</span></div>\n';
}

/* The footer: nav, the source line, the unaffiliated line, and the theme
 * sentence. That last one is not boilerplate. The site stores nothing at all
 * now, so the reader is told what the switch does and what happens to their
 * choice, in one sentence, on every page. The old copy said "the only thing
 * stored in your browser is your light/dark choice" — that key is gone, and a
 * footer that still claimed it would be the site lying about its own storage on
 * thirty routes. */
function footer(updated, refreshAttemptedOn, wasRetained) {
  var updatedLine = (!wasRetained || !refreshAttemptedOn)
    ? 'Data updated <b>' + esc(updated) + '</b>.'
    : 'Checked <b>' + esc(refreshAttemptedOn) + '</b> · data as of <b>' + esc(updated) +
      '</b> (the refresh ran but the count itself was not re-measured that day).';
  return '<footer class="site">\n' +
    /* The brand row — interior-system-v1.html's `.footer-top`, same mark and
       wordmark as the masthead, linking home. Added above the existing link
       row, not in place of it: every href/label below is unchanged. */
    '  <a class="ftop" href="/">' + markSvg('ft') + 'WiFi&nbsp;Odds</a>\n' +
    '  <div class="flinks"><a href="/airlines/">Airlines</a><a href="/race/">The Race</a>' +
    '<a href="/systems/">Systems</a><a href="/united/">United</a>' +
    '<a href="/united/fleet/">Fleet</a><a href="/alaska/">Alaska</a><a href="/roadmap/">Roadmap</a>' +
    /* Methodology is linked from the FOOTER and from the leaderboard's caveat, not
       from the masthead: the global nav stays three items plus the Extension link,
       and a provenance page is something a reader goes looking for rather than
       something that needs to compete with "Airlines" on every screen. */
    '<a href="/methodology/">Methodology</a>' +
    '<a href="/api/docs/">API</a><a href="/privacy">Privacy</a>' +
    '<a href="' + REPO_SITE + '" target="_blank" rel="noopener">Site source ↗</a>' +
    '<a href="' + REPO_EXT + '" target="_blank" rel="noopener">Extension source ↗</a></div>\n' +
    '  <div>Fleet data: <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">unitedstarlinktracker.com</a> ' +
    '· <a href="https://alaskastarlinktracker.com" target="_blank" rel="noopener">alaskastarlinktracker.com</a> ' +
    '(independent community trackers by @martinamps) · every other airline from public announcements, July 2026.</div>\n' +
    '  <div class="frow">' + updatedLine + ' ConnectScores and per-flight odds are ' +
    'historical estimates, and aircraft assignments change until departure. WiFi Odds is unofficial and ' +
    'unaffiliated with any airline, SpaceX, Amazon, Viasat, or the trackers.</div>\n' +
    /* "nothing is stored in your browser" was false on /united/, which caches
       the route list under `usl3:<ORIG>-<DEST>` in localStorage. The privacy
       page has always disclosed that cache, so the footer contradicted the page
       it links to. An external audit found it on 27 Jul 2026 alongside the
       Cloudflare beacon, and the two are the same failure: a global claim about
       conduct that one surface does not honour.
       The sentence now says what is true everywhere and points at the exception
       rather than denying it. `build/apitest.js` asserts that any page writing
       to storage is named here. */
    '  <div class="frow"><b>No accounts, no analytics, no tracking</b> on this site or in the extension. ' +
    'Nothing about you is stored in your browser; <a href="/united/">the United route optimiser</a> ' +
    'caches the route lists it fetches, and that is the only thing this site writes. ' +
    'What the server keeps is on the <a href="/privacy">privacy page</a>.</div>\n' +
    '  <div class="frow">' + THEME_SENTENCE + '</div>\n' +
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
    /* First focusable thing on every page, and invisible until it has focus. */
    '<a class="skip" href="#main-content">Skip to content</a>\n' +
    (o.preWrap || '') +
    masthead(o.here, o.suffix, o.updated, o.refreshAttemptedOn, o.wasRetained) +
    '<div class="wrap">\n' +
    subnav(o.section, o.canonical, o.suffix) +
    /* <main> starts AFTER the subnav so the skip link actually skips the
       navigation. It also stops every page's own <header class="hero"> from
       computing to role=banner: a <header> inside <main> is not a banner, and
       without this wrapper every one of the 31 routes exposed two unlabelled
       banner landmarks. <main> has no default box styling, so this is a
       null visual diff. */
    '<main id="main-content">\n' +
    /* .ph-top pairs the breadcrumb with the page-head "as of" date chip
       (interior-system-v1.html's `.asof`) on one row, generically for every
       route that passes a crumb — no per-page rewrite needed, since `updated`
       already reaches page() for the masthead/footer datechips. A route with
       no crumb (404) gets neither, same as before. */
    (o.crumb ? '<div class="ph-top">' + crumb(o.crumb) +
      (o.updated ? '<span class="asof"><i></i>Data effective <b>' +
        esc(chipDate(o.updated)) + '</b></span>' : '') + '</div>\n' : '') +
    o.body +
    '</main>\n' +
    footer(o.updated, o.refreshAttemptedOn, o.wasRetained) +
    '</div>\n' +
    (o.afterWrap || '') +
    THEME_SWITCH +
    '<script src="/assets/site.js?v=' + assetHash('assets/site.js') + '" defer></script>\n</body>\n</html>\n';
}

module.exports = {
  ORIGIN: ORIGIN, EXT: EXT, EXT_VERSION: EXT_VERSION, REPO: REPO,
  NAV: NAV, SUBNAV: SUBNAV,
  esc: esc, ld: ld, page: page, masthead: masthead,
  /* topbar is the old name for masthead. Kept as an alias so a caller outside
     this file cannot break on the rename; nothing in the build uses it today. */
  topbar: masthead,
  subnav: subnav, crumb: crumb, credit: credit, footer: footer,
  plateDate: plateDate, chipDate: chipDate,
  MARK_SVG: markSvg, FAVICON: FAVICON,
  /* THEME_BOOT and assetHash: exported additively for Render.home(), which does
     NOT call page() (see build/lib/render.js) but still has to carry the exact
     same theme-boot script and the same cache-busted asset hashing every other
     route gets, copied rather than reimplemented so the two can never drift. */
  THEME_BOOT: THEME_BOOT, assetHash: assetHash
};
