#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var H = require('./lib/html.js');
var R = require('./routes.js');

var v2 = H.mastheadV2('/');
var page = H.page({title:'t',desc:'d',canonical:'/404.html',here:'/',updated:'2026-08-17'});

function checkHtml(html, label) {
  assert.ok(html.indexOf('class="sitebar" data-masthead') !== -1, label + ' contains class="sitebar" data-masthead');
  assert.ok(html.indexOf('class="mh-wrap"') !== -1, label + ' inner wrapper is class="mh-wrap"');
  assert.ok(html.indexOf('class="wrap mh"') === -1, label + ' does not contain class="wrap mh"');
  assert.ok(html.indexOf('class="wrap masthead"') === -1, label + ' does not contain class="wrap masthead"');
}

checkHtml(v2, 'mastheadV2');
checkHtml(page, 'page');

var styleStart = page.indexOf('<style>');
var styleEnd = page.indexOf('</style>');
assert.ok(styleStart !== -1 && styleEnd > styleStart, 'page emits a style tag');
var css = page.slice(styleStart, styleEnd);
assert.ok(css.indexOf('min-height:78px') !== -1, 'CSS includes min-height:78px');
assert.ok(css.indexOf('text-transform:none') !== -1, 'CSS includes text-transform:none');
assert.ok(css.indexOf('text-decoration:none') !== -1, 'CSS includes text-decoration:none');
assert.ok(css.indexOf('.masthead nav a') === -1, 'style tag does not include .masthead nav a');
assert.ok(v2.indexOf('text-transform:uppercase') === -1, 'mastheadV2 HTML must not include text-transform:uppercase');

/* PR 19: interior pages load assets/site.css, whose global
 * `a{text-decoration:underline}` restyled the copied bar. The bar must carry
 * Home's own link reset, scoped, and must not rely on site.css for any of it.
 * The :hover reset is asserted separately because site.css `a:hover` ties
 * `.sitebar a` on specificity and only source order breaks the tie. */
assert.ok(css.indexOf('.sitebar a{color:inherit;text-decoration:none}') !== -1,
  'CSS carries the scoped Home link reset .sitebar a{color:inherit;text-decoration:none}');
assert.ok(css.indexOf('.sitebar a:hover{text-decoration:none}') !== -1,
  'CSS carries the scoped hover reset .sitebar a:hover{text-decoration:none}');
assert.ok(css.indexOf('min-height:44px;text-decoration:none') !== -1,
  'primary-nav links carry their own text-decoration:none');

/* 17 Aug 2026 placement lock. The bar owns its own geometry: Home's wrap
 * formula as literals on the unique wrapper class, so no page's .wrap,
 * --max token, .pill margin, or body border can move brand/nav/pill.
 * The var(--max) assertion is the token leak that let /extension/ pull the
 * bar 18.5px: a custom property read is a page-settable input, and the
 * geometry must have none. (Colour tokens stay page-settable on purpose —
 * the same bar sits on dark content pages and on Privacy.) */
assert.ok(css.indexOf('.sitebar .mh-wrap{') !== -1, 'CSS styles the unique wrapper class');
assert.ok(css.indexOf('width:min(1240px,calc(100% - 48px));margin:auto') !== -1,
  'the wrapper carries Home\'s own width/margin formula as literals');
assert.ok(css.indexOf('var(--max') === -1, 'geometry reads no page-settable --max token');
assert.ok(css.indexOf('html body{border-top:0}') !== -1,
  'CSS retires site.css\'s 4px body border on bar pages (offsetTop 4 vs Home 0)');
assert.ok(css.indexOf('.sitebar,.sitebar *{box-sizing:border-box}') !== -1,
  'CSS fences box-sizing');
assert.ok(css.indexOf('margin:0;padding:0 18px;border:0') !== -1,
  'pill fences the margin site.css .pill would otherwise supply');

/* 17 Aug 2026 chip kill. The visible Home→ trail under the bar is gone
 * from every route; BreadcrumbList JSON-LD (passed via jsonld) stays. The
 * "Data effective" chip is gone too (owner GO: kill Date effective chip,
 * not header include). */
var crumbPage = H.page({title:'t',desc:'d',canonical:'/airlines/',here:'/airlines/',
  updated:'2026-08-17', crumb:[['/', 'Home'], ['/airlines/', 'Airlines']]});
assert.ok(crumbPage.indexOf('<nav class="crumb"') === -1,
  'a crumb route renders no visible breadcrumb');
assert.ok(crumbPage.indexOf('Data effective') === -1,
  'a crumb route with updated has no Data effective chip');
assert.ok(crumbPage.indexOf('ph-top') === -1,
  'a crumb route with updated has no ph-top row');
var noChipPage = H.page({title:'t',desc:'d',canonical:'/airlines/sas/',here:'/airlines/',
  updated:'2026-08-17', asofChip:false, crumb:[['/', 'Home'], ['SAS', 'SAS']]});
assert.ok(noChipPage.indexOf('<nav class="crumb"') === -1 &&
  noChipPage.indexOf('ph-top') === -1,
  'a crumb route with asofChip:false renders neither trail nor row');

/* Built pages are tracked files and can drift from the generator when a commit
 * skips the rebuild — that exact shape shipped on PR 19: the generator gained
 * the reset while every built page kept the old bar, so the fix never reached
 * a reader. Sweep what would actually be served, not only the emitter. */
var root = path.join(__dirname, '..');
var swept = 0;
R.ROUTES.concat(R.UNLISTED).forEach(function (r) {
  if (!r.file || r.file.slice(-5) !== '.html') return;
  var body = fs.readFileSync(path.join(root, r.file), 'utf8');
  assert.ok(body.indexOf('.sitebar a{color:inherit;text-decoration:none}') !== -1,
    r.file + ' carries the scoped link reset');
  assert.ok(body.indexOf('.sitebar a:hover{text-decoration:none}') !== -1,
    r.file + ' carries the scoped hover reset');
  assert.ok(body.indexOf('class="mh-wrap"') !== -1, r.file + ' uses class="mh-wrap"');
  assert.ok(body.indexOf('width:min(1240px,calc(100% - 48px));margin:auto') !== -1,
    r.file + ' carries the self-owned bar geometry');
  assert.ok(body.indexOf('html body{border-top:0}') !== -1,
    r.file + ' carries the body border retirement');
  assert.ok(body.indexOf('class="wrap mh"') === -1, r.file + ' does not use class="wrap mh"');
  assert.ok(body.indexOf('class="wrap masthead"') === -1, r.file + ' does not use class="wrap masthead"');
  assert.ok(body.indexOf('<nav class="crumb"') === -1, r.file + ' renders no visible breadcrumb');
  assert.ok(body.indexOf('Data effective') === -1, r.file + ' has no Data effective chip');
  assert.ok(body.indexOf('<div class="ph-top">') === -1, r.file + ' has no ph-top row');
  swept++;
});
assert.ok(swept >= 26, 'swept ' + swept + ' built pages; expected at least 26');

console.log('homepage-header-copy: passed (' + swept + ' built pages swept)');
