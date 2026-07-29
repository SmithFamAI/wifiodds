'use strict';
/* build/make-og-card.js — the ONE social card, assets/og.png.
 *
 *     node build/make-og-card.js            write assets/og.png
 *     node build/make-og-card.js --html     print the HTML and stop (no Chrome)
 *
 * OPT-IN, and it must never join `node build/prerender.js`. It shells out to
 * headless Chrome; the daily build stays fast and offline-safe. Run it when the
 * card's design or its figures need to change, then commit the PNG.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM build/make-og.js ────────────────────────
 * make-og.js renders one card PER ROUTE (31 of them) in the old light/serif
 * theme, and it was never wired into the site. This writes the single shared
 * card that build/lib/html.js and Render.home actually point at. Two different
 * jobs; do not merge them.
 *
 * The card it replaced was dated 25 Jul 2026 and had gone stale in every way at
 * once: cream paper against a site that is now #050505, Source Serif against a
 * site that is now Inter, the retired orbit glyph, the headline "Will your
 * flight have WiFi that works?" from before the next-gen pivot, and ConnectScore
 * 88/48/12 as the hero figure — the number the pivot explicitly demoted. Every
 * share on iMessage, Slack, X and LinkedIn unfurled the abandoned positioning,
 * and one image serves every route, so no page shared correctly.
 *
 * ── THE RULE THAT MATTERS MOST HERE ─────────────────────────────────────────
 * NEVER READ A RAW `WIFI_AIRLINES` ENTRY FOR A NUMBER ON THIS CARD.
 *
 * `equippedPublished` and `nextGenPublished` are DERIVED FUNCTIONS in
 * assets/airlines.js, not stored fields. Read the raw entry and you get
 * `undefined` for both, plus `equipped: 0` on Air France (fleet 229) and SAS
 * (fleet 123) — the exact ambiguous state CLAUDE.md records shipping once as a
 * false, sourced-looking "0 of 123 (0%)" on a fleet with real coverage nobody
 * has published a count for. Run entries through `scoreAirline()`, which returns
 * `equipped: null` and `equippedPublished: false` for both.
 *
 * An OG card is worse than a page for this: it is quoted in feeds and previews
 * where there is nothing to click through to, and it is cached by every platform
 * that has ever seen it. A wrong number here outlives the fix.
 *
 * So the card carries exactly two figures, both of which are unambiguous and
 * both of which are asserted below before a pixel is drawn. If an assertion
 * fires, fix the data or the query — do not soften the assertion. */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var A = require('../assets/airlines.js');

var ROOT = path.join(__dirname, '..');
var CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var OUT = path.join(ROOT, 'assets', 'og.png');

/* ── the figures, and nothing that is not checked ─────────────────────────── */

var data = JSON.parse(fs.readFileSync(path.join(ROOT, 'united', 'data.json'), 'utf8'));

/* TWO POPULATIONS LIVE IN THIS FILE AND THEY MUST NOT BE MIXED. united/data.json
 * says so itself, in fleet.published.whyBothFields:
 *
 *   fleet.equipped / fleet.total        the TRACKER's population (484 / 1,807)
 *   fleet.published.equipped / .total   UNITED's own published pair (450 / 1,552)
 *
 * Both ratios are coherent within themselves. Dividing the tracker's equipped by
 * United's total overstates United's share, and it is an easy mistake because
 * both pairs sit in the same object. The card uses the TRACKER pair, which is
 * what /united/fleet/ and the homepage already print, so the card cannot
 * disagree with the pages it advertises. */
var equipped = data.fleet && data.fleet.equipped;
var fleet = data.fleet && data.fleet.total;
var airlineCount = Object.keys(A.WIFI_AIRLINES).length;

function must(cond, msg) {
  if (!cond) throw new Error('make-og-card: ' + msg + ' — refusing to draw a card with a figure ' +
    'it cannot stand behind.');
}
must(typeof equipped === 'number' && equipped > 0, 'united/data.json equipped is not a positive number (got ' + equipped + ')');
must(typeof fleet === 'number' && fleet > equipped, 'united/data.json total is not a number greater than equipped (got ' + fleet + ')');
must(airlineCount === 18, 'expected 18 airlines in WIFI_AIRLINES, found ' + airlineCount);
/* The anti-mixing tripwire. If the two pairs ever collapse into one another,
   the populations have been conflated upstream and 27% is no longer the number
   the site prints. Fails loudly rather than drawing a plausible wrong share. */
var pub = (data.fleet && data.fleet.published) || {};
must(pub.total !== fleet,
  'the tracker population and United\'s published total are now identical (' + fleet + ') — ' +
  'united/data.json says they describe different populations, so one of them is wrong');

/* Cross-check against the SCORED entry, never the raw one. United is not one of
 * the unpublished-count airlines, so this must agree; if it ever stops agreeing,
 * the two sources have drifted and the card is the wrong place to find that out. */
var unitedScored = A.scoreAirline('united');
must(unitedScored.equippedPublished === true,
  'United now reports equippedPublished false — the card must not print a count for it');
must(unitedScored.equipped === equipped,
  'scoreAirline("united").equipped (' + unitedScored.equipped + ') disagrees with united/data.json (' + equipped + ')');

var pct = Math.round(equipped / fleet * 100);
var asOf = data.updated;
must(/^\d{4}-\d{2}-\d{2}$/.test(asOf), 'united/data.json updated is not an ISO date (got ' + asOf + ')');

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function human(iso) {
  var p = iso.split('-');
  return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
}
function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/* ── the card ─────────────────────────────────────────────────────────────── */

/* V5 tokens, copied not parsed: this renders as a file:// page that cannot reach
 * assets/site.css, and a silently-failed parse producing a grey card is worse
 * than a copy that has to be updated deliberately. */
var T = {
  bg: '#050505', panel: '#0d0d0f', line: '#26262c',
  ink: '#f7f7f8', soft: '#b9b9c1', muted: '#85858e',
  cyan: '#29d8ff', violet: '#926cff', good: '#54f09b'
};

/* The mark, identical geometry to H.markSvg() in build/lib/html.js. Copied for
 * the same file:// reason; if the logo changes, change it in both or the card
 * advertises a brand the site no longer uses. */
function mark(px) {
  return '<svg viewBox="128 128 768 768" width="' + px + '" height="' + px + '" aria-hidden="true">' +
    '<defs><linearGradient id="ogr" x1="270" y1="700" x2="754" y2="700" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="' + T.cyan + '"/><stop offset="1" stop-color="' + T.violet + '"/></linearGradient></defs>' +
    '<path d="M292 700A320 320 0 1 1 732 700" fill="none" stroke="url(#ogr)" stroke-width="68" stroke-linecap="round"/>' +
    '<g transform="translate(0 -24)">' +
    '<rect x="267" y="405" width="176" height="134" rx="24" fill="url(#ogr)"/>' +
    '<rect x="581" y="405" width="176" height="134" rx="24" fill="url(#ogr)"/>' +
    '<path d="M443 472h35M546 472h35" stroke="' + T.ink + '" stroke-width="24" stroke-linecap="round"/>' +
    '<rect x="466" y="362" width="92" height="220" rx="38" fill="' + T.ink + '"/>' +
    '<circle cx="512" cy="472" r="31" fill="url(#ogr)"/>' +
    '<path d="M449 300Q512 341 575 300Q563 251 512 251Q461 251 449 300Z" fill="url(#ogr)"/></g>' +
    '<path d="M512 612C499 612 492 625 489 645L480 704L410 747C399 754 393 765 393 779L478 754' +
    'L483 807L457 829V846L512 831L567 846V829L541 807L546 754L631 779C631 765 625 754 614 747' +
    'L544 704L535 645C532 625 525 612 512 612Z" fill="' + T.ink + '"/></svg>';
}

function html() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>\n' +
    '*{box-sizing:border-box;margin:0;padding:0}\n' +
    'html,body{width:1200px;height:630px}\n' +
    'body{background:' + T.bg + ';color:' + T.ink + ';\n' +
    "  font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;\n" +
    '  -webkit-font-smoothing:antialiased;position:relative;overflow:hidden}\n' +
    /* The same atmospheric glow the hero uses, so the card reads as the same
       surface as the page it opens. Kept well inside the frame: a blur that
       touches the edge looks like a rendering artefact in a feed thumbnail. */
    '.glow{position:absolute;right:-120px;top:-170px;width:620px;height:520px;pointer-events:none;\n' +
    '  background:radial-gradient(circle,rgba(41,216,255,.20),rgba(146,108,255,.11) 46%,transparent 70%);\n' +
    '  filter:blur(20px)}\n' +
    '.grid{position:absolute;inset:0;pointer-events:none;opacity:.5;\n' +
    '  background-image:linear-gradient(' + T.line + ' 1px,transparent 1px),\n' +
    '    linear-gradient(90deg,' + T.line + ' 1px,transparent 1px);background-size:120px 120px}\n' +
    '.pad{position:relative;height:100%;padding:62px 68px;display:flex;flex-direction:column}\n' +
    '.brand{display:flex;align-items:center;gap:15px;font-size:31px;font-weight:850;letter-spacing:-.035em}\n' +
    'h1{margin-top:44px;font-size:82px;line-height:.94;letter-spacing:-.055em;font-weight:800;max-width:15ch}\n' +
    '.grad{background:linear-gradient(100deg,' + T.cyan + ',' + T.violet + ');\n' +
    '  -webkit-background-clip:text;background-clip:text;color:transparent}\n' +
    '.lede{margin-top:26px;font-size:26px;line-height:1.4;color:' + T.soft + ';max-width:30ch;font-weight:450}\n' +
    '.foot{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:36px}\n' +
    '.proof{border-left:3px solid ' + T.cyan + ';padding-left:20px}\n' +
    '.proof b{display:block;font-size:44px;font-weight:850;letter-spacing:-.035em;\n' +
    '  font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}\n' +
    '.proof span{display:block;margin-top:6px;font-size:17px;color:' + T.muted + ';letter-spacing:.01em}\n' +
    '.stamp{text-align:right;font-size:16px;color:' + T.muted + ';line-height:1.7;letter-spacing:.02em;white-space:nowrap}\n' +
    '.stamp b{color:' + T.soft + ';font-weight:650}\n' +
    '</style></head><body>\n' +
    '<div class="grid"></div><div class="glow"></div>\n' +
    '<div class="pad">\n' +
    '  <div class="brand">' + mark(33) + '<span>WiFi Odds</span></div>\n' +
    /* The homepage's own H1, word for word. A social card that asks a different
       question from the page behind it is a bait-and-switch even when both are
       true. */
    '  <h1>What are your odds of <span class="grad">next-gen WiFi?</span></h1>\n' +
    '  <p class="lede">Starlink and Amazon Leo odds for every flight, across ' + airlineCount + ' airlines.</p>\n' +
    '  <div class="foot">\n' +
    '    <div class="proof"><b>' + commas(equipped) + ' of ' + commas(fleet) + '</b>' +
    '<span>United aircraft flying Starlink · ' + pct + '% of the fleet</span></div>\n' +
    /* THE CREDIT TRAVELS WITH THE NUMBERS. The two figures above are
       @martinamps' tracker data, not ours. The homepage footer printed 484 and
       1,807 with no attribution until 28 Jul 2026 and that was fixed; a card
       that reproduces the same figures in a feed, where there is no footer and
       nothing to click through to, has a stronger obligation, not a weaker one. */
    '    <div class="stamp"><b>wifiodds.com</b><br>Checked ' + human(asOf) +
    '<br>Fleet data: unitedstarlinktracker.com<br>Free · unofficial · no tracking</div>\n' +
    '  </div>\n' +
    '</div></body></html>\n';
}

function main() {
  var doc = html();
  if (process.argv.indexOf('--html') !== -1) { process.stdout.write(doc); return; }

  if (!fs.existsSync(CHROME)) {
    console.error('make-og-card: no Chrome at ' + CHROME + '. Run with --html and rasterise elsewhere.');
    process.exit(1);
  }
  var tmpHtml = path.join(require('os').tmpdir(), 'wifiodds-og-card.html');
  var tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'og-'));
  fs.writeFileSync(tmpHtml, doc);

  /* --hide-scrollbars matters: without it Chrome reserves gutter width and the
     card comes out 1185px wide, which every platform then letterboxes. */
  cp.execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', '--default-background-color=00000000',
    '--screenshot=' + path.join(tmpDir, 'og.png'),
    'file://' + tmpHtml
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  var made = path.join(tmpDir, 'og.png');
  if (!fs.existsSync(made)) throw new Error('make-og-card: Chrome wrote no file');
  fs.copyFileSync(made, OUT);

  var kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log('make-og-card: wrote assets/og.png (' + kb + ' KB)');
  console.log('  figures on the card: ' + commas(equipped) + ' of ' + commas(fleet) +
    ' (' + pct + '%), ' + airlineCount + ' airlines, checked ' + asOf);
  console.log('  NOTE: html.js cache-busts og.png by content hash, so the new card');
  console.log('  reaches scrapers on the next build. Platforms cache aggressively —');
  console.log('  re-scrape in each debugger if a stale preview matters.');
}

module.exports = { html: html, main: main };
if (require.main === module) main();
