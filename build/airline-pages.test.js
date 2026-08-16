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

function nextGenStat(html) {
  var m = /data-figure-block="nextgen"[\s\S]*?<\/div>\s*<\/div>/.exec(html);
  assert.ok(m, 'next-gen stat block is present');
  return visible(m[0]);
}

function sectionIds(html) {
  var ids = [];
  var re = /<section class="blk" id="([^"]+)"/g;
  var m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}

assert.strictEqual(RELEASE.version, '3.0.2', 'Live Store version stays 3.0.2');
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
assert.ok(directory.indexOf('class="sitebar"') !== -1, 'directory reuses the live masthead');
assert.ok(directory.indexOf('<footer class="site">') !== -1, 'directory reuses the live footer');
assert.ok(directory.indexOf('href="/airlines/"') !== -1 || directory.indexOf('>Airlines<') !== -1,
  'directory names itself Airlines');
LOCKED_KEYS.forEach(function (key) {
  var scored = A.scoreAirline(key);
  assert.ok(directory.indexOf('href="/airlines/' + key + '/"') !== -1,
    'directory links to /airlines/' + key + '/');
  assert.ok(dirText.indexOf(scored.name) !== -1, 'directory names ' + scored.name);
});

LOCKED_KEYS.forEach(function (key) {
  var html = htmlOf('airlines/' + key + '/index.html');
  var scored = A.scoreAirline(key);
  var text = visible(html);
  assert.ok(html.indexOf('<h1 class="ph">' + scored.name + '</h1>') !== -1,
    key + ' prints the airline name as the page heading');
  assert.ok(/href="\/(#all)?"/.test(html), key + ' links back to the homepage');
  assert.ok(html.indexOf('href="/airlines/"') !== -1, key + ' links to the directory');
  assert.ok(html.indexOf('data-date="as_of"') !== -1, key + ' splits as_of');
  assert.ok(html.indexOf('data-date="checked_at"') !== -1, key + ' splits checked_at');
  assert.ok(text.indexOf('ConnectScore') === -1,
    key + ' does not revive the ConnectScore label');
  assert.ok(html.indexOf('class="sitebar"') !== -1, key + ' reuses the live masthead');
  assert.ok(html.indexOf('<footer class="site">') !== -1, key + ' reuses the live footer');
  assert.ok(html.indexOf('href="/airlines/"') !== -1, key + ' footer/directory link is present');
  assert.ok(!/\bhonest/i.test(text), key + ' does not use honest as product voice');
  var footnote = /class="footnote">([^<]+)/.exec(html);
  assert.ok(footnote, key + ' has a footnote');
  assert.ok(!/\.\s+[a-z]/.test(footnote[1]),
    key + ' footnote does not start the free-status sentence in lowercase');
  assert.deepStrictEqual(sectionIds(html).slice(0, 3),
    ['snapshot', 'tech-on-board', 'rollout'],
    key + ' section order is snapshot, tech on board, rollout');

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
assert.ok(/unitedstarlinktracker\.com/.test(united),
  'United names the public tracker it follows');
assert.ok(/Mainline/.test(united) && /Regional/.test(united),
  'United prints the published mainline/regional Starlink split');

var alaska = htmlOf('airlines/alaska/index.html');
assert.ok(/alaskastarlinktracker\.com/.test(alaska),
  'Alaska names the public tracker it follows');

var homeCss = htmlOf(path.join('build', 'templates', 'home.html'));
assert.ok(/\.row\{display:grid/.test(homeCss),
  'homepage rank-row CSS still lives on the homepage template, not in this lane');

assert.ok(!fs.existsSync(path.join(ROOT, 'airline')),
  'singular /airline/ tree is gone from disk');

console.log('airline-pages: /airlines/ directory + ' + LOCKED_KEYS.length +
  ' routes; unpublished stays Unpublished');
