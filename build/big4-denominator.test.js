#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Data = require('./lib/data.js');
var Render = require('./lib/render.js');

var html = Render.home(Data.build());
var united = html.match(/<article class="aircard"[\s\S]*?<span class="airname">United<\/span>[\s\S]*?<\/article>/);

assert.ok(united, 'United Big-4 card renders');
assert.match(united[0], /<strong>28%<sup>\*<\/sup><\/strong>[\s\S]*?513 of 1,815 aircraft next-gen today/,
  'United card uses the whole-fleet denominator that reconstructs its 28% next-gen odds');
assert.doesNotMatch(united[0], /513 of 1,611 aircraft next-gen today/,
  'United resolved-subset denominator is not presented as its fleet size');
assert.match(fs.readFileSync(path.join(__dirname, 'ship.sh'), 'utf8'), /node build\/big4-denominator\.test\.js/,
  'release gate runs the Big-4 denominator control');

console.log('Big-4 denominator controls: 3 passed');
