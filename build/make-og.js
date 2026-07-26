#!/usr/bin/env node
'use strict';
/* build/make-og.js — one Open Graph card per route.
 *
 *     node build/make-og.js [outDir]      default: /tmp/wifiodds-og
 *
 * OPT-IN TOOLING, exactly like build/make-brand.py, and it must never join
 * `node build/prerender.js`. It shells out to headless Chrome 31 times and the
 * daily build has to stay fast and offline-safe.
 *
 * WHY CHROME AND NOT PILLOW. make-brand.py rasterises assets/og.png with Pillow,
 * and Pillow will not install on this machine: Homebrew's python 3.14.6 has a
 * pyexpat built against a libexpat it does not have, so pip cannot run at all
 * (Symbol not found: _XML_SetAllocTrackerActivationThreshold). Rather than fight
 * that unattended, this renders HTML in the browser that is already installed.
 * That turns out to be the better tool anyway: the cards are laid out with the
 * site's own tokens, in the site's own self-hosted Source Serif, so a card can
 * never drift from the page it advertises the way a hand-drawn PNG would.
 *
 * NOTHING HERE INVENTS A FIGURE. An airline card prints that airline's own
 * ConnectScore, band word, equipped-of-fleet count, system and as-of date,
 * straight from assets/airlines.js. Every other route prints its own <title>
 * read off the built HTML. There is no card whose numbers are not already on the
 * page it links to.
 *
 * THIS IS NOT WIRED INTO THE SITE. build/lib/html.js still points every route at
 * the one generic /assets/og.png. Per-page cards change what a shared link looks
 * like, which is a visual change, which the ship policy says gets staged for
 * review rather than deployed unattended. Wiring it up is one edit to the two
 * og:image / twitter:image lines in html.js and it is Jeremy's call. */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var R = require('./routes.js');
var A = require('../assets/airlines.js');

var ROOT = path.join(__dirname, '..');
var OUT = path.resolve(process.argv[2] || '/tmp/wifiodds-og');
var CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* The light-theme tokens, copied from the top of assets/site.css. Copied rather
 * than parsed: the cards are rendered without the stylesheet (a file:// page
 * cannot reach it), and a broken parse should fail here rather than silently
 * produce grey cards. Dark is the site's boot default, but a social card is
 * pasted onto somebody else's white feed, so these are the light values. */
var T = {
  paper: '#fbf8f2', card: '#ffffff', ink: '#29241c', inkSoft: '#443d32',
  muted: '#6e6557', mutedStrong: '#59503f', line: '#e3dccc',
  good: '#1e7a46', mixed: '#a06400', long: '#a84b2f', zero: '#8a8177',
  sky: '#2d5a7d', skyFg: '#e9f1f7',
};
/* The band, computed the way the SITE computes it — build/lib/pages.js band()
 * and BAND_WORD, four thresholds, copied here on purpose so a change there and
 * not here shows up as a card that disagrees with its own page.
 *
 * NOT scoreAirline().cls. That field returns `usl-pct-mid`, which is the
 * EXTENSION's class vocabulary, and the first version of this file looked the
 * colour up with it. Every lookup missed, every score rendered in the default
 * muted brown, and the cards were wrong in a way that only showed up by opening
 * one. `a.label` is likewise the airlines.js word, not the site's: airlines.js
 * says "mixed" where pages.js says "long shot". The card follows the page. */
function band(s) {
  return s >= 60 ? 'sc-good' : s >= 40 ? 'sc-mix' : s >= 1 ? 'sc-long' : 'sc-no';
}
var BAND_WORD = { 'sc-good': 'good', 'sc-mix': 'mixed', 'sc-long': 'long shot', 'sc-no': 'not yet' };
var BAND_COLOUR = { 'sc-good': T.good, 'sc-mix': T.mixed, 'sc-long': T.long, 'sc-no': T.zero };

/* "2026-07" is a month. airlines.js stores it that way, so print it that way
 * rather than letting it read as a truncated day. */
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function asOfText(s) {
  var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ''));
  if (!m) return s ? String(s) : '';
  var mon = MONTHS[Number(m[2]) - 1] || m[2];
  return m[3] ? mon + ' ' + Number(m[3]) + ', ' + m[1] : mon + ' ' + m[1];
}

var SERIF = 'file://' + path.join(ROOT, 'assets', 'serif-700.woff2');
var SERIF4 = 'file://' + path.join(ROOT, 'assets', 'serif-400.woff2');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function titleOf(file) {
  try {
    var m = /<title>([\s\S]*?)<\/title>/i.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    if (!m) return '';
    return m[1].replace(/\s+/g, ' ').trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  } catch (e) { return ''; }
}

var SHELL = function (inner) {
  return '<!doctype html><meta charset="utf-8"><style>' +
    '@font-face{font-family:S;src:url("' + SERIF + '") format("woff2");font-weight:700}' +
    '@font-face{font-family:S;src:url("' + SERIF4 + '") format("woff2");font-weight:400}' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{width:1200px;height:630px;background:' + T.paper + ';color:' + T.ink + ';' +
    'font-family:system-ui,-apple-system,sans-serif;overflow:hidden}' +
    '.card{width:1200px;height:630px;padding:64px 72px;display:flex;flex-direction:column;' +
    'justify-content:space-between;border-top:14px solid ' + T.sky + '}' +
    '.mast{font:600 22px system-ui;letter-spacing:.14em;text-transform:uppercase;color:' + T.sky + '}' +
    '.foot{font:400 22px system-ui;color:' + T.muted + ';display:flex;justify-content:space-between}' +
    '.h{font-family:S;font-weight:700;line-height:1.06;letter-spacing:-.015em}' +
    '.say{font-family:S;font-weight:400;font-size:30px;line-height:1.35;color:' + T.inkSoft + ';max-width:900px}' +
    '.score{font-family:S;font-weight:700;font-size:210px;line-height:.86;letter-spacing:-.03em}' +
    '.bandw{font:600 26px system-ui;letter-spacing:.16em;text-transform:uppercase}' +
    '.row{display:flex;align-items:flex-end;gap:44px}' +
    '.meta{font:400 27px system-ui;color:' + T.mutedStrong + ';line-height:1.5}' +
    '.rule{height:1px;background:' + T.line + ';margin:26px 0}' +
    '</style><div class="card">' + inner + '</div>';
};

/* An airline card. Every figure on it is that airline's own entry. */
function airlineCard(key) {
  var a = A.scoreAirline(key);
  var b = band(a.score);
  var colour = BAND_COLOUR[b];
  var word = BAND_WORD[b];
  var fleet = a.fleet ? a.equipped.toLocaleString('en-US') + ' of ' +
    a.fleet.toLocaleString('en-US') + ' aircraft' : 'fleetwide';
  var asOf = asOfText(a.asOf);
  return SHELL(
    '<div class="mast">WiFi Odds</div>' +
    '<div>' +
      '<div class="h" style="font-size:62px">' + esc(a.name) + '</div>' +
      '<div class="rule"></div>' +
      '<div class="row">' +
        '<div><div class="score" style="color:' + colour + '">' + a.score + '</div>' +
        '<div class="bandw" style="color:' + colour + '">' + esc(word) + '</div></div>' +
        '<div class="meta" style="padding-bottom:16px">' +
          esc(a.systemLabel) + '<br>' + esc(fleet) +
          (asOf ? '<br>as of ' + esc(asOf) : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="foot"><span>ConnectScore &middot; odds of the good satellite wifi</span>' +
    '<span>wifiodds.com</span></div>');
}

/* Every other route. The headline is the page's own <title>, so a card cannot
 * say something the page does not. */
function routeCard(r) {
  var t = titleOf(r.file) || r.url;
  var parts = t.split(/\s+[·—]\s+/);
  var head = parts.length > 1 && /^WiFi Odds/i.test(parts[0])
    ? parts.slice(1).join(' · ') : t;
  var size = head.length > 64 ? 46 : head.length > 40 ? 56 : 66;
  return SHELL(
    '<div class="mast">WiFi Odds</div>' +
    '<div>' +
      '<div class="h" style="font-size:' + size + 'px">' + esc(head) + '</div>' +
      '<div class="rule"></div>' +
      '<div class="say">' + esc(r.url) + '</div>' +
    '</div>' +
    '<div class="foot"><span>Every airline&rsquo;s inflight WiFi, scored</span>' +
    '<span>wifiodds.com</span></div>');
}

function slug(url) {
  var s = url.replace(/^\//, '').replace(/\/$/, '').replace(/[^a-zA-Z0-9]+/g, '-');
  return s || 'home';
}

function main() {
  if (!fs.existsSync(CHROME)) {
    console.error('make-og: no Chrome at ' + CHROME);
    console.error('  This needs a headless browser. Nothing else on this machine can');
    console.error('  rasterise the cards: Pillow will not install (see the header).');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  var work = path.join(OUT, '_html');
  fs.mkdirSync(work, { recursive: true });

  var made = [];
  R.ROUTES.forEach(function (r) {
    var html = r.airline ? airlineCard(r.airline) : routeCard(r);
    var name = slug(r.url);
    var hp = path.join(work, name + '.html');
    var pp = path.join(OUT, name + '.png');
    fs.writeFileSync(hp, html);
    cp.execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--screenshot=' + pp, '--window-size=1200,630', 'file://' + hp,
    ], { stdio: 'ignore' });
    var kb = Math.round(fs.statSync(pp).size / 1024);
    made.push({ url: r.url, png: name + '.png', kb: kb, airline: r.airline || '' });
    console.log('  ' + String(kb + ' KB').padStart(7) + '  ' + name + '.png   ' + r.url);
  });

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(made, null, 1));
  console.log('\nmake-og: ' + made.length + ' cards in ' + OUT);
  console.log('  NOT wired into the site. build/lib/html.js still points every route at');
  console.log('  /assets/og.png. Changing that is a visual change and needs review.');
  return made;
}

module.exports = { airlineCard: airlineCard, routeCard: routeCard, slug: slug, main: main };
if (require.main === module) main();
