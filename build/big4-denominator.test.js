#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Data = require('./lib/data.js');
var Render = require('./lib/render.js');

var html = Render.home(Data.build());
var united = html.match(/<article class="aircard"[\s\S]*?<span class="airname">United<\/span>[\s\S]*?<\/article>/);
var score = Data.build().A.scoreAirline('united');
var note = united && united[0].match(/<p class="airnote[^"]*"[^>]*>([\d,]+) of ([\d,]+) aircraft next-gen today<\/p>/);
var odds = united && united[0].match(/data-nextgen="(\d+)"/);
var ngCount = (score.segments || []).reduce(function (sum, segment) {
  return sum + (segment.nextGen ? segment.n : 0);
}, 0);

assert.ok(united, 'United Big-4 card renders');
assert.ok(note && odds, 'United card exposes its odds and next-gen count');
assert.strictEqual(Number(note[1].replace(/,/g, '')), ngCount,
  'United card note derives its numerator from the next-gen segments');
assert.strictEqual(Number(note[2].replace(/,/g, '')), score.total,
  'United card denominator uses the whole fleet rather than its resolved subset');
assert.strictEqual(Number(odds[1]), Math.round(ngCount / score.total * 100),
  'United card odds reconstruct from the displayed numerator and denominator');
assert.notStrictEqual(Number(note[2].replace(/,/g, '')), score.known,
  'United card does not present its resolved subset as fleet size');
assert.match(fs.readFileSync(path.join(__dirname, 'ship.sh'), 'utf8'), /node build\/big4-denominator\.test\.js/,
  'release gate runs the Big-4 denominator control');

console.log('Big-4 denominator controls: 6 passed');
