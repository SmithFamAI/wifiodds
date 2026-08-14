'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var release = require('./extension-release.json');

var rendered = fs.readFileSync(path.join(__dirname, '..', 'extension', 'index.html'), 'utf8');
release.allowedFeatureClaims.forEach(function (feature) {
  var matches = rendered.split(feature.question).length - 1;
  assert.strictEqual(matches, 1, feature.id + ' question must render exactly once');
});

process.stdout.write('extension feature questions: PASS\n');
