'use strict';

var assert = require('assert');
var FS = require('fs');
var PATH = require('path');

var root = PATH.join(__dirname, '..');
var home = FS.readFileSync(PATH.join(root, 'build', 'templates', 'home.html'), 'utf8');

assert.ok(
  /<div class="browser extension-showcase" role="region" aria-label="How WiFi Odds works on booking pages">/.test(home),
  'the homepage booking-page demonstration must expose its label through a named region'
);
assert.strictEqual(
  /<div class="browser extension-showcase" aria-label=/.test(home),
  false,
  'a generic browser div must not carry a silently ignored aria-label'
);

console.log('generic-div ARIA-name controls: 2 passed');
