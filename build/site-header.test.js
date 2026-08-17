#!/usr/bin/env node
'use strict';
/* One shared Forecast header on every public page. Owner 16 Aug 2026. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var R = require('./routes.js');

var FILES = R.ROUTES.map(function (r) { return r.file; }).filter(function (f) {
  return /\.html$/.test(f);
});
if (FILES.indexOf('404.html') === -1) FILES.push('404.html');

var NAV = ['Home', 'Methodology', 'Technology', 'Airlines', 'Extension', 'Feedback'];

FILES.forEach(function (rel) {
  var html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  assert.ok(html.indexOf('<!--SITE_HEADER-->') === -1, rel + ' has no leftover header marker');
  var bars = html.match(/<header class="sitebar" data-masthead>/g) || [];
  assert.strictEqual(bars.length, 1, rel + ' has exactly one shared sitebar');
  assert.ok(!/<header class="site">/.test(html), rel + ' does not keep the classic header.site bar');
  var nav = (/<nav id="primary-nav"[\s\S]*?<\/nav>/.exec(html) || [''])[0];
  assert.ok(nav, rel + ' has #primary-nav');
  NAV.forEach(function (label) {
    var re = new RegExp('>' + label + '<');
    assert.ok(re.test(nav), rel + ' primary nav includes ' + label);
  });
  assert.ok(nav.indexOf('Add to Chrome') !== -1, rel + ' primary nav includes Add to Chrome');
  assert.ok(!/#extension/.test(nav), rel + ' Extension is the route, not a homepage anchor');
});

var four = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
var fourNav = (/<nav id="primary-nav"[\s\S]*?<\/nav>/.exec(four) || [''])[0];
assert.ok(fourNav.indexOf('aria-current="page"') === -1,
  '404 does not mark a primary-nav item current');

var src = fs.readFileSync(path.join(__dirname, 'lib/html.js'), 'utf8');
assert.ok(src.indexOf('width:min(1240px,calc(100% - 48px))') !== -1,
  'shared header pins 1240px wrap, not the page --max token');
assert.ok(/mastheadV2\(o\.here\) \+/.test(src),
  'H.page always emits mastheadV2');

console.log('site-header: ' + FILES.length + ' public HTML files share one Forecast header');
