#!/usr/bin/env node
'use strict';
/* README, privacy §7, and /extension/ customer copy must match live Store 3.0.2.
 *
 * Privacy grant kinds and extension Streaming copy already shipped. This file
 * keeps them from drifting, and it rejects a README that still sells the
 * retired encyclopedia (ConnectScore ranking, /united/ HTML toolkit, 3.1.1 as
 * live, keyword-stuffed brand lists). Watching the current files pass does not
 * prove the guard can fail. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var privacyPermissions = require('./lib/privacy-permissions');

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function renderedText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reject(name, fn, expect) {
  var threw = false;
  var message = '';
  try {
    fn();
  } catch (err) {
    threw = true;
    message = err.message || String(err);
  }
  if (!threw) throw new Error('FAIL ' + name + ': planted live-product defect escaped');
  assert.ok(expect.test(message),
    name + ' must fail matching ' + expect + ', got: ' + message);
  process.stdout.write('REJECT ' + name + '\n');
}

function fail(label, message) {
  throw new Error((label || 'live product') + ': ' + message);
}

function validateReadme(text, label) {
  label = label || 'README';
  if (!/\b3\.0\.2\b/.test(text)) fail(label, 'must name live Store 3.0.2');
  if (/\b3\.1\.1\b/.test(text)) fail(label, 'must not name 3.1.1 as live');
  if (/know before you book/i.test(text)) fail(label, 'must not restore the retired slogan');
  if (/smithfamai\.com\/unitedstarlink/.test(text) &&
      !/retired/.test(text)) {
    fail(label, 'must not present smithfamai.com/unitedstarlink as the live product URL');
  }
  if (/\*\*`\/united\/`\*\*/.test(text) ||
      /the full United toolkit/.test(text) ||
      /\/united\/` — the full United/.test(text)) {
    fail(label, 'must not sell the retired /united/ HTML toolkit as a live page');
  }
  if (/ranked by \*\*ConnectScore\*\*/.test(text) ||
      /all 18 ranked by \*\*ConnectScore\*\*/.test(text)) {
    fail(label, 'must not rank airlines by ConnectScore as the customer name');
  }
  if (!/Streaming score/.test(text)) fail(label, 'must name Streaming score');
  if (!/labels only/.test(text) && !/labels-only/.test(text)) {
    fail(label, 'must say Google Flights is labels only');
  }
  if (!/Best WiFi/.test(text)) fail(label, 'must name Best WiFi');
  if (!/refuses/.test(text) && !/cannot pick a winner/.test(text) &&
      !/If those checks fail/.test(text)) {
    fail(label, 'must say Best WiFi refuses a thin lead');
  }
  ['United', 'Alaska', 'Navan'].forEach(function (host) {
    if (text.indexOf(host) === -1) fail(label, 'must name ' + host);
  });
  if (/Delta,\s*American,\s*Southwest/.test(text) ||
      /Emirates,\s*Qatar,\s*jetBlue/.test(text)) {
    fail(label, 'must not dump a keyword-stuffed airline brand list');
  }
}

validateReadme(load('README.md'), 'README');
process.stdout.write('PASS clean: README matches live 3.0.2 product\n');
validateReadme(load('STORE.md'), 'STORE.md');
process.stdout.write('PASS clean: STORE.md matches live 3.0.2 product\n');

privacyPermissions.validate(load('build/templates/privacy.html'), 'privacy template');
privacyPermissions.validate(load('privacy.html'), 'privacy.html');
process.stdout.write('PASS clean: privacy §7 matches 3.0.2 grant kinds including optional Google\n');

var extensionTemplate = load('build/templates/extension-v3.html');
var extensionPage = load('extension/index.html');
if (extensionTemplate.indexOf('ConnectScore') !== -1) {
  fail('extension template', 'customer template still names ConnectScore');
}
if (renderedText(extensionPage).indexOf('ConnectScore') !== -1) {
  fail('extension page', 'customer-facing /extension/ copy still names ConnectScore');
}
if (renderedText(extensionPage).indexOf('Streaming score') === -1) {
  fail('extension page', 'customer-facing /extension/ copy must name Streaming score');
}
process.stdout.write('PASS clean: /extension/ customer copy uses Streaming, not ConnectScore\n');

var liveReadme = load('README.md');

reject('retired slogan', function () {
  validateReadme(liveReadme.replace('A static site plus',
    '**WiFi Odds — know before you book.** A static site plus'), 'slogan');
}, /retired slogan/);

reject('3.1.1 as live', function () {
  validateReadme(liveReadme + '\nChrome Web Store version 3.1.1 is live.\n', 'version');
}, /3\.1\.1/);

reject('ConnectScore ranking', function () {
  validateReadme(liveReadme.replace(
    '`/airlines/` | `airlines/index.html` | Compact A-Z directory of the tracked carriers',
    '`/airlines/` | `airlines/index.html` | all 18 ranked by **ConnectScore** (0–100)'),
    'ranking');
}, /ConnectScore/);

reject('retired United toolkit', function () {
  validateReadme(liveReadme.replace(
    'The `/united/` HTML page is gone.',
    '**`/united/`** — the full United toolkit (route optimizer, best routings). The `/united/` HTML page is gone.'),
    'united');
}, /united\/ HTML toolkit/);

reject('keyword-stuffed brand list', function () {
  validateReadme(liveReadme.replace(
    'The overlay scores United, Alaska, and Navan search results.',
    'The overlay scores United, Alaska, Navan, Delta, American, Southwest, Emirates, Qatar, jetBlue search results.'),
    'brands');
}, /keyword-stuffed/);

process.stdout.write('readme-live-product: 4 PASS, 5 REJECT\n');
