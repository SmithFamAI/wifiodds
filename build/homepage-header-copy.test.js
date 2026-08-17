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
  assert.ok(html.indexOf('class="wrap mh"') !== -1, label + ' inner wrapper is class="wrap mh"');
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

/* Built pages are tracked files and can drift from the generator when a commit
 * skips the rebuild — that exact shape shipped on this branch: the generator
 * gained the reset while every built page kept the old bar, so the fix never
 * reached a reader. Sweep what would actually be served, not only the emitter. */
var root = path.join(__dirname, '..');
var swept = 0;
R.ROUTES.concat(R.UNLISTED).forEach(function (r) {
  if (!r.file || r.file.slice(-5) !== '.html') return;
  var body = fs.readFileSync(path.join(root, r.file), 'utf8');
  assert.ok(body.indexOf('.sitebar a{color:inherit;text-decoration:none}') !== -1,
    r.file + ' carries the scoped link reset');
  assert.ok(body.indexOf('.sitebar a:hover{text-decoration:none}') !== -1,
    r.file + ' carries the scoped hover reset');
  assert.ok(body.indexOf('class="wrap mh"') !== -1, r.file + ' uses class="wrap mh"');
  assert.ok(body.indexOf('class="wrap masthead"') === -1, r.file + ' does not use class="wrap masthead"');
  swept++;
});
assert.ok(swept >= 26, 'swept ' + swept + ' built pages; expected at least 26');

console.log('homepage-header-copy: passed (' + swept + ' built pages swept)');
