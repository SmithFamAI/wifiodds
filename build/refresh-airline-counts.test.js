#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('./refresh-airline-counts.js');

const alaska = '<script type="application/ld+json">{"dateModified":"2026-08-05T12:00:00Z"}</script>' +
  '<p>As of August 5, 2026, 99 of 350 Alaska Airlines aircraft (28%) have Starlink WiFi installed</p>';
const hub = '<a href="/airlines/hawaiian">Hawaiian Airlines</a><span>42</span><span> of 61 aircraft equipped</span>' +
  '<a href="/airlines/alaska">Alaska Airlines</a><span>99</span><span> of 350 aircraft equipped</span>' +
  '<script type="application/ld+json">{"dateModified":"2026-08-05T12:00:00Z"}</script>';

const parsed = R.parseTrackerPages(alaska, hub);
assert.deepStrictEqual(parsed.alaska, { equipped: 99, total: 350, asOf: '2026-08-05' });
assert.deepStrictEqual(parsed.hawaiian, { equipped: 42, total: 61, asOf: '2026-08-05' });
assert.throws(function () { R.parseTrackerPages(alaska, hub.replace('99</span><span> of 350', '100</span><span> of 350')); }, /sources disagree/);
assert.throws(function () { R.validateMove('alaska', { equipped: 99, total: 350 }, { equipped: 99, total: 351 }); }, /denominator changed/);
assert.throws(function () { R.validateMove('alaska', { equipped: 99, total: 350 }, { equipped: 98, total: 350 }); }, /outside/);
assert.throws(function () { R.validateMove('alaska', { equipped: 99, total: 350 }, { equipped: 110, total: 350 }); }, /outside/);

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'airlines.js'), 'utf8');
const moved = R.updateEntry(source, 'alaska', { equipped: 100, total: 350, asOf: '2026-08-05' });
assert.strictEqual(moved.changed, true);
assert.match(moved.source, /system: "starlink", equipped: 100, fleet: 350/);
assert.match(moved.source, /\{ system: "2ku", n: 239/);
assert.match(moved.source, /note: "100 of 350 mainline/);

const unchanged = R.updateEntry(source, 'hawaiian', { equipped: 42, total: 61, asOf: '2099-01-01' });
assert.strictEqual(unchanged.changed, false);
assert.strictEqual(unchanged.source, source, 'an unchanged figure must not advance its source date');

console.log('refresh-airline-count controls: 9 passed');
