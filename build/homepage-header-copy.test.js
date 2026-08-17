#!/usr/bin/env node
'use strict';

var assert = require('assert');
var H = require('./lib/html.js');

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

console.log('homepage-header-copy: passed');
