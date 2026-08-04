#!/usr/bin/env node
'use strict';

var FS = require('fs');
var PATH = require('path');
var CRYPTO = require('crypto');
var RELEASE = require('./lib/release.js');

var cssPath = PATH.join(__dirname, RELEASE.contentCss.path);
var css = FS.readFileSync(cssPath);
if (process.env.EXTENSION_CSS_MUTATE === '1') css = Buffer.concat([css, Buffer.from(' ')]);
var hash = CRYPTO.createHash('sha256').update(css).digest('hex');
if (hash !== RELEASE.contentCss.sha256) {
  console.error('extension CSS parity FAIL: expected ' + RELEASE.contentCss.sha256 + ', got ' + hash);
  console.error('A surprising result is a claim about the instrument until proven otherwise. Before filing a defect, prove the instrument is sound — with a control that is known-good, not with a second run.');
  process.exit(1);
}
console.log('extension CSS parity OK: ' + hash + ' matches the release-pinned product stylesheet');
