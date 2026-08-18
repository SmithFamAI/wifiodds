#!/usr/bin/env node
'use strict';
/* Guards for /airlines/ and /airlines/{key}/. These routes are independent of
 * the homepage screenshot lane: this file does not open a browser, and it does
 * not read rank-card CSS beyond asserting the homepage template still owns it. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var R = require('./routes.js');
var A = require('../assets/airlines.js');
var RELEASE = require('./extension-release.json');

var LOCKED_KEYS = ['united', 'alaska', 'jsx', 'airbaltic', 'zipair', 'westjet',
  'airfrance', 'hawaiian', 'qatar', 'sas', 'emirates', 'virginatlantic',
  'aircanada', 'britishairways', 'southwest', 'american', 'delta', 'jetblue'];

function htmlOf(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function visible(html) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function figureBlock(html, name) {
  var token = 'data-figure-block="' + name + '"';
  var i = html.indexOf(token);
  assert.ok(i !== -1, name + ' figure block is present');
  var open = html.lastIndexOf('<', i);
  var tag = /^<([a-zA-Z0-9]+)\b/.exec(html.slice(open));
  assert.ok(tag, name + ' opening tag');
  var re = new RegExp('</?' + tag[1] + '\\b[^>]*>', 'gi');
  var slice = html.slice(open);
  var depth = 0;
  var end = -1;
  var m;
  while ((m = re.exec(slice))) {
    if (m[0].charAt(1) === '/') {
      depth -= 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    } else if (!/\/>$/.test(m[0])) {
      depth += 1;
    }
  }
  assert.ok(end > 0, name + ' closing tag');
  return visible(slice.slice(0, end));
}

function nextGenStat(html) {
  return figureBlock(html, 'nextgen');
}

function sectionIds(html) {
  var ids = [];
  var re = /<section\b[^>]*\bid="([^"]+)"/g;
  var m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}

assert.strictEqual(RELEASE.version, '3.1.1', 'Live Store version stays 3.1.1');
assert.deepStrictEqual(R.AIRLINE_KEYS, LOCKED_KEYS, 'AIRLINE_KEYS match the 18 lock keys');

var dirRoute = R.ROUTES.filter(function (r) { return r.url === '/airlines/'; })[0];
assert.ok(dirRoute, 'directory is in ROUTES as /airlines/');
assert.strictEqual(dirRoute.file, 'airlines/index.html');
assert.ok(fs.existsSync(path.join(ROOT, dirRoute.file)), 'directory HTML exists');
assert.ok(R.ROUTES.every(function (r) { return r.url.indexOf('/airline/') !== 0; }),
  'no singular /airline/ route remains');

LOCKED_KEYS.forEach(function (key) {
  var route = R.ROUTES.filter(function (r) { return r.url === '/airlines/' + key + '/'; })[0];
  assert.ok(route, key + ' is in ROUTES as /airlines/' + key + '/');
  assert.strictEqual(route.file, 'airlines/' + key + '/index.html');
  assert.ok(fs.existsSync(path.join(ROOT, route.file)), key + ' HTML exists');
});

var sitemap = htmlOf('sitemap.xml');
assert.ok(sitemap.indexOf('https://wifiodds.com/airlines/') !== -1, 'sitemap lists /airlines/');
LOCKED_KEYS.forEach(function (key) {
  assert.ok(sitemap.indexOf('https://wifiodds.com/airlines/' + key + '/') !== -1,
    'sitemap lists /airlines/' + key + '/');
  assert.ok(sitemap.indexOf('https://wifiodds.com/airline/' + key + '/') === -1,
    'sitemap does not list singular /airline/' + key + '/');
});

var redirects = htmlOf('_redirects');
assert.ok(!/^\/airlines\/\s+\/\s+301/m.test(redirects),
  '_redirects does not 301 /airlines/ home');
assert.ok(!/^\/airlines\/\*\s+\/\s+301/m.test(redirects),
  '_redirects does not 301 /airlines/* home');
['/united/', '/alaska/', '/race/', '/systems/'].forEach(function (p) {
  assert.ok(new RegExp('^' + p.replace(/\//g, '\\/') + '\\s+/\\s+301', 'm').test(redirects),
    '_redirects still 301s ' + p);
});
assert.ok(fs.existsSync(path.join(ROOT, 'united', 'data.json')),
  'united/data.json stays on disk');

var directory = htmlOf('airlines/index.html');
var dirText = visible(directory);
assert.ok(dirText.indexOf('ConnectScore') === -1, 'directory does not revive ConnectScore');
/* 17 Aug 2026 owner FINDINGS: the PR 25 h1.ph clamp is VOID as the visual
 * lock — a matched font-size is not a matched page top. The lock is the
 * shared heroV2 band from /methodology/ and /technology/: the 72px grid,
 * the right-edge glow, the glowing-dot kicker, and a sentence headline
 * whose last phrase carries the cyan-to-violet text gradient. Bind to the
 * include and to each page's own sentence; the old bare word titles must
 * stay gone. */
assert.ok(directory.indexOf('<section class="sitehero" data-hero>') !== -1,
  'directory opens with the shared hero include');
assert.ok(directory.indexOf('<h1>See all ' + LOCKED_KEYS.length +
  ' carriers, ranked by <span class="sh-grad">your odds of next-gen WiFi.</span></h1>') !== -1,
  'directory headline is the ranked-odds sentence, count and all, with the gradient last phrase');
assert.ok(directory.indexOf('<h1 class="ph">Airlines</h1>') === -1,
  'the bare word title is gone from the directory');
assert.ok(!/\.dir-page h1\{[^}]*font-size/.test(directory),
  'directory CSS does not override the shared title scale');
var feedback = htmlOf('feedback/index.html');
assert.ok(feedback.indexOf('<section class="sitehero" data-hero>') !== -1,
  'feedback opens with the shared hero include');
assert.ok(feedback.indexOf('<h1>Tell us what worked, what broke, and ' +
  '<span class="sh-grad">what to build next.</span></h1>') !== -1,
  'feedback headline is a sentence with the gradient last phrase');
assert.ok(feedback.indexOf('<h1 class="ph">Feedback</h1>') === -1,
  'the bare word title is gone from feedback');
[['directory', directory], ['feedback', feedback]].forEach(function (pair) {
  var which = pair[0];
  var html = pair[1];
  assert.ok(html.indexOf('background-size:72px 72px') !== -1,
    which + ' hero carries the 72px grid');
  assert.ok(html.indexOf(
    'radial-gradient(circle,rgba(41,216,255,.2),rgba(146,108,255,.09) 43%,transparent 70%)') !== -1,
    which + ' hero carries the right-edge glow');
  assert.ok(html.indexOf('.sitehero .sh-kicker i{') !== -1,
    which + ' hero kicker has the glowing dot');
  assert.ok(html.indexOf('linear-gradient(100deg,#fff 8%,#8beaff 54%,#a88cff 88%)') !== -1,
    which + ' hero carries the headline text gradient');
  /* The include's names are its own; a rule under .hero/.kicker/.lede here
   * would be site.css's to move. And the band must sit inside <main>,
   * before the width-capped wrap, or it is either a second banner landmark
   * or a column-width stripe — both are the drift this include ends. */
  assert.ok(html.indexOf('.sitehero{') !== -1 && html.indexOf('.sitehero .sh-wrap{') !== -1,
    which + ' hero CSS is scoped under .sitehero');
  var mainAt = html.indexOf('<main id="main-content">');
  var heroAt = html.indexOf('<section class="sitehero"');
  var wrapAt = html.indexOf('<div class="wrap">');
  assert.ok(mainAt !== -1 && heroAt > mainAt && (wrapAt === -1 || wrapAt > heroAt),
    which + ' hero sits inside main, before the width-capped wrap');
});
var dirSection = (/<section class="blk" id="directory"[\s\S]*?<\/section>/.exec(directory) || [''])[0];
var dirSectionText = visible(dirSection);
assert.ok(dirSection, 'directory has a directory section');
assert.ok(dirSectionText.indexOf('Next-Gen') !== -1, 'directory prints Next-Gen on each row');
assert.ok(dirSectionText.indexOf('Streaming') !== -1, 'directory prints Streaming on each row');
assert.ok(dirSection.indexOf('data-figure-block') === -1, 'directory does not reprint homepage figures');
assert.ok(directory.indexOf('class="view-switch') === -1,
  'directory has no Next-Gen/Streaming picker');
assert.ok(directory.indexOf('class="aircard"') === -1, 'directory does not clone Big 4 cards');
assert.ok(directory.indexOf('id="airline-grid"') === -1, 'directory does not clone the homepage rank grid');
assert.ok(/max-width:\s*1440px/.test(directory), 'directory CSS names 1440');
assert.ok(/max-width:\s*390px/.test(directory), 'directory CSS names 390');
assert.ok(/min-height:78px/.test(directory), 'directory keeps Home chrome 78px');
assert.ok(/\.sitebar a\.brand[^{]*\{[^}]*text-decoration:none/.test(directory),
  'directory brand is not underlined');
assert.ok(dirText.indexOf('3.1.1') !== -1, 'directory labels live Store 3.1.1');
assert.ok(directory.indexOf('No published-system row on the live page') === -1,
  'directory cards do not print the operator leftover restnote');
assert.ok(directory.indexOf('That leftover is Unpublished, not 0.') === -1,
  'directory cards do not print leftover Unpublished copy');
assert.ok(directory.indexOf('No published-system leftovers on a live page stay Unpublished here') === -1,
  'directory closer does not print the operator leftover sentence');
assert.ok(directory.indexOf('A missing count is Unpublished, not 0.') !== -1,
  'directory keeps the traveler Unpublished-not-0 line');
function dirRow(html, key) {
  var needle = '<a class="row" href="/airlines/' + key + '/">';
  var i = html.indexOf(needle);
  assert.ok(i !== -1, key + ' has a directory row');
  var slice = html.slice(i);
  var end = slice.indexOf('</a>');
  assert.ok(end > 0, key + ' directory row closes');
  return slice.slice(0, end + 4);
}
function dirMini(row, kind) {
  var token = 'class="mini ' + kind;
  var i = row.indexOf(token);
  assert.ok(i !== -1, kind + ' mini opens');
  var open = row.lastIndexOf('<div', i);
  var slice = row.slice(open);
  var re = /<\/?div\b/g;
  var depth = 0;
  var m;
  var end = -1;
  while ((m = re.exec(slice))) {
    if (m[0].charAt(1) === '/') {
      depth -= 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    } else {
      depth += 1;
    }
  }
  assert.ok(end > 0, kind + ' mini closes');
  return slice.slice(0, end);
}
var unitedRow = dirRow(directory, 'united');
var unitedNext = dirMini(unitedRow, 'next');
var unitedStream = dirMini(unitedRow, 'stream');
assert.ok(/<strong>523<\/strong>/.test(unitedNext) && /<em>29%<\/em>/.test(unitedNext),
  'United Next-Gen is 523 / 29%');
assert.ok(/<strong>1,083<\/strong>/.test(unitedStream) && /<em>60%<\/em>/.test(unitedStream),
  'United Streaming is 1,083 / 60%');
['airfrance', 'sas'].forEach(function (key) {
  var row = dirRow(directory, key);
  var next = dirMini(row, 'next');
  assert.ok(/Unpublished/.test(next), key + ' Next-Gen is Unpublished');
  assert.ok(!/<strong>0<\/strong>/.test(next), key + ' Next-Gen is not a measured zero');
  assert.ok(/Not a measured zero/.test(next), key + ' says not a measured zero');
});
['american', 'delta', 'jetblue'].forEach(function (key) {
  var row = dirRow(directory, key);
  var next = dirMini(row, 'next');
  assert.ok(/<strong>0<\/strong>/.test(next) && /<em>0%<\/em>/.test(next),
    key + ' Next-Gen is published 0');
  assert.ok(/None flying/.test(next), key + ' Next-Gen code is None flying');
  assert.ok(!/Unpublished/.test(next), key + ' Next-Gen is not Unpublished');
});
assert.ok(directory.indexOf('class="sitebar"') !== -1, 'directory reuses the live masthead');
assert.ok(directory.indexOf('class="sitefoot" data-footer') !== -1,
  'directory carries the durable footer include');
assert.ok(directory.indexOf('href="/airlines/"') !== -1 || directory.indexOf('>Airlines<') !== -1,
  'directory names itself Airlines');
var dirNav = (/<nav id="primary-nav"[\s\S]*?<\/nav>/.exec(directory) || [''])[0];
assert.ok(/<a href="\/airlines\/"[^>]*>Airlines<\/a>/.test(dirNav),
  'directory primary nav links Airlines to /airlines/');
var dirFooter = (/<footer class="sitefoot"[\s\S]*?<\/footer>/.exec(directory) || [''])[0];
assert.ok(/<a href="\/airlines\/">Airlines<\/a>/.test(dirFooter),
  'directory footer still links Airlines to /airlines/');
var home = htmlOf('index.html');
var homeNav = (/<nav id="primary-nav"[\s\S]*?<\/nav>/.exec(home) || [''])[0];
assert.ok(/<a href="\/airlines\/">Airlines<\/a>/.test(homeNav),
  'homepage Forecast masthead links Airlines to /airlines/');
var homeFooter = (/<footer class="sitefoot"[\s\S]*?<\/footer>/.exec(home) || [''])[0];
assert.ok(/href="[^"]*\/airlines\/"[^>]*>Airlines<\/a>/.test(homeFooter),
  'homepage footer still links Airlines');
assert.strictEqual((home.match(/<a class="row /g) || []).length, LOCKED_KEYS.length,
  'homepage rank list has one anchor row per lock key');
assert.ok(!/<div class="row /.test(home), 'homepage rank rows are anchors, not inert divs');
assert.strictEqual((home.match(/<a class="aircard"/g) || []).length, 4,
  'homepage Big 4 cards are anchors');
assert.ok(!/<article class="aircard"/.test(home), 'homepage Big 4 cards are anchors, not articles');
['united', 'american', 'delta', 'southwest'].forEach(function (key) {
  assert.ok(home.indexOf('<a class="aircard" href="/airlines/' + key + '/"') !== -1,
    'homepage Big 4 ' + key + ' card links to /airlines/' + key + '/');
});
LOCKED_KEYS.forEach(function (key) {
  var scored = A.scoreAirline(key);
  assert.ok(directory.indexOf('href="/airlines/' + key + '/"') !== -1,
    'directory links to /airlines/' + key + '/');
  assert.ok(dirText.indexOf(scored.name) !== -1, 'directory names ' + scored.name);
  assert.ok(new RegExp('<a class="row [^"]+" href="/airlines/' + key + '/"').test(home),
    'homepage rank row for ' + key + ' is an anchor to /airlines/' + key + '/');
});

LOCKED_KEYS.forEach(function (key) {
  var html = htmlOf('airlines/' + key + '/index.html');
  var scored = A.scoreAirline(key);
  var text = visible(html);
  assert.ok(html.indexOf('<h1 class="ph">' + scored.name + '</h1>') !== -1,
    key + ' prints the airline name as the page heading');
  assert.ok(/href="\/(#all)?"/.test(html), key + ' links back to the homepage');
  assert.ok(html.indexOf('href="/airlines/"') !== -1, key + ' links to the directory');
  assert.ok(/<nav id="primary-nav"[\s\S]*?<a href="\/airlines\/"[^>]*>Airlines<\/a>/.test(html),
    key + ' primary nav links Airlines to /airlines/');
  assert.ok(html.indexOf('data-date="as_of"') !== -1, key + ' splits as_of');
  assert.ok(html.indexOf('data-date="checked_at"') !== -1, key + ' splits checked_at');
  assert.ok(html.indexOf('Data current as of') !== -1, key + ' puts as_of beside snapshot figures');
  assert.ok(!/\bRanked \d+ of \d+\b/.test(text), key + ' does not print a rank sentence');
  assert.ok(text.indexOf('Not ranked on next-gen odds') === -1,
    key + ' does not print an unpublished rank sentence');
  assert.ok(html.indexOf('Data effective') === -1,
    key + ' does not present the check day as Data effective');
  assert.ok(text.indexOf('ConnectScore') === -1,
    key + ' does not revive the ConnectScore label');
  assert.ok(html.indexOf('class="sitebar"') !== -1, key + ' reuses the live masthead');
  assert.ok(html.indexOf('class="sitefoot" data-footer') !== -1,
    key + ' carries the durable footer include');
  assert.ok(html.indexOf('href="/airlines/"') !== -1, key + ' footer/directory link is present');
  assert.ok(!/\bhonest/i.test(text), key + ' does not use honest as product voice');
  var footnote = /class="footnote">([^<]+)/.exec(html);
  assert.ok(footnote, key + ' has a footnote');
  assert.ok(!/\.\s+[a-z]/.test(footnote[1]),
    key + ' footnote does not start the free-status sentence in lowercase');
  assert.deepStrictEqual(sectionIds(html).slice(0, 3),
    ['what', 'rest', 'rollout'],
    key + ' section order is what, rest of fleet, rollout');

  if (scored.nextGenPublished === false) {
    var ng = nextGenStat(html);
    assert.ok(/Unpublished/.test(ng), key + ' next-gen field says Unpublished');
    assert.ok(!/\d+\s*%/.test(ng), key + ' next-gen field does not print a percent');
    assert.ok(!/\b0\b/.test(ng), key + ' next-gen field does not print a sourced-looking zero');
  } else {
    assert.ok(nextGenStat(html).indexOf(String(scored.nextGenScore) + '%') !== -1,
      key + ' next-gen field prints the published odds');
  }
});

['airfrance', 'sas'].forEach(function (key) {
  var html = htmlOf('airlines/' + key + '/index.html');
  assert.strictEqual(A.scoreAirline(key).nextGenPublished, false,
    key + ' next-gen stays unpublished in the model');
  assert.ok(/Unpublished/.test(nextGenStat(html)),
    key + ' Next-Gen renders Unpublished');
});

var united = htmlOf('airlines/united/index.html');
var unitedAsOf = A.scoreAirline('united').asOf;
var unitedChecked = JSON.parse(htmlOf('united/data.json')).updated;
assert.ok(/unitedstarlinktracker\.com/.test(united),
  'United names the public tracker it follows');
assert.ok(/Mainline/.test(united) && /Regional/.test(united),
  'United prints the published mainline/regional Starlink split');
assert.ok(unitedAsOf && unitedChecked && unitedAsOf !== unitedChecked,
  'control: United as_of and checked_at are different dates');
assert.ok(united.indexOf('Data current as of <b data-date="as_of">' + unitedAsOf + '</b>') !== -1,
  'United snapshot as_of is the airline fact date, not the check day');
assert.ok(united.indexOf('data-date="checked_at">' + unitedChecked) !== -1,
  'United checked_at is the job date');
assert.ok(!new RegExp('published_at ' + unitedChecked).test(united),
  'United does not copy the check day into published_at');
assert.ok(united.indexOf('data-date="published_at">' + unitedChecked) === -1,
  'United does not mark the check day as published_at');
assert.ok(!/Starlink[\s\S]{0,280}published_at/.test(united),
  'United Starlink row does not label a date published_at');
var unitedNg = figureBlock(united, 'nextgen');
var unitedStream = figureBlock(united, 'streaming');
assert.ok(/523/.test(unitedNg) && /29%/.test(unitedNg),
  'United Next-Gen prints 523 and 29% on the same card');
assert.ok(/1,?083/.test(unitedStream) && /60%/.test(unitedStream),
  'United Streaming prints 1,083 and 60% on the same card');
assert.ok(united.indexOf('data-figure-block="viasat"') === -1,
  'United has no Viasat figure block');
assert.ok(!/<span class="card-name">Viasat<\/span>/.test(united),
  'United has no Viasat hero card');
var unitedRest = (/id="rest"[\s\S]*?<\/section>/.exec(united) || [''])[0];
assert.ok(/407/.test(unitedRest) && /131/.test(unitedRest) && /196/.test(unitedRest),
  'United rest-of-fleet prints 407 / 131 / 196');
assert.ok(/22%/.test(unitedRest) && /7%/.test(unitedRest) && /11%/.test(unitedRest),
  'United rest-of-fleet prints 22% / 7% / 11%');
assert.ok(/182 \/ 1,144/.test(united) && /341 \/ 673/.test(united),
  'United rollout prints 182 / 1,144 and 341 / 673');

var alaska = htmlOf('airlines/alaska/index.html');
assert.ok(/alaskastarlinktracker\.com/.test(alaska),
  'Alaska names the public tracker it follows');

['alaska', 'delta', 'southwest', 'american', 'jetblue', 'emirates', 'aircanada',
  'britishairways', 'jsx', 'zipair', 'hawaiian', 'virginatlantic'].forEach(function (key) {
  var html = htmlOf('airlines/' + key + '/index.html');
  assert.ok(html.indexOf('class="rest-row unknown-row"') === -1,
    key + ' sourced fleet with no unresolved tails does not print unknown 0/0%');
});
var unitedUnknown = (/class="rest-row unknown-row"[\s\S]*?<\/div>\s*<\/div>/.exec(united) || [''])[0];
assert.ok(unitedUnknown.indexOf('class="rest-row unknown-row"') !== -1,
  'United keeps the unknown row when unresolved is 196');
assert.ok(/196/.test(unitedUnknown) && /11%/.test(unitedUnknown),
  'United unknown row still prints 196 / 11%');
['airfrance', 'sas', 'westjet', 'airbaltic', 'qatar'].forEach(function (key) {
  var html = htmlOf('airlines/' + key + '/index.html');
  assert.ok(html.indexOf('class="rest-row unknown-row"') !== -1,
    key + ' keeps the unknown row when unresolved is above zero');
});

var sasPage = htmlOf('airlines/sas/index.html');
var sasScore = A.scoreAirline('sas');
assert.strictEqual(sasScore.score, 0, 'SAS Streaming stays the published 0');
assert.ok(nextGenStat(sasPage).indexOf('Unpublished') !== -1);
var sasStream = figureBlock(sasPage, 'streaming');
assert.ok(sasStream.indexOf('0') !== -1,
  'SAS Streaming 0 is still printed');

var homeCss = htmlOf(path.join('build', 'templates', 'home.html'));
assert.ok(/\.row\{display:grid/.test(homeCss),
  'homepage rank-row CSS still lives on the homepage template, not in this lane');

assert.ok(!fs.existsSync(path.join(ROOT, 'airline')),
  'singular /airline/ tree is gone from disk');

console.log('airline-pages: /airlines/ directory + ' + LOCKED_KEYS.length +
  ' routes; unpublished stays Unpublished');
