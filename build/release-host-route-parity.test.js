#!/usr/bin/env node
'use strict';
/* Planted defects for the host-matrix / route-demo parity guard.
 *
 * The live ledger must load. Then four known-bad mutations must be REJECTED,
 * including the A4 hole: routePanel Yes next to "No separate route summary…"
 * with no "Not offered here." prefix. Watching validate() succeed on the
 * current file does not prove it can fail. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var validate = require('./lib/release').validate;
var LEDGER = path.join(__dirname, 'extension-release.json');

function loadLedger() {
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

function hostOf(release, id) {
  var found = null;
  release.hosts.forEach(function (host) {
    if (host.id === id) found = host;
  });
  assert.ok(found, 'missing host ' + id);
  return found;
}

function routeBehaviors(release) {
  var found = null;
  release.allowedFeatureClaims.forEach(function (feature) {
    if (feature.id === 'route') found = feature.behaviors;
  });
  assert.ok(found, 'missing route feature');
  return found;
}

function reject(name, mutate) {
  var release = loadLedger();
  mutate(release);
  var threw = false;
  try {
    validate(release);
  } catch (err) {
    threw = true;
    assert.ok(/routePanel/.test(err.message),
      name + ' must fail on routePanel/behavior meaning, got: ' + err.message);
  }
  if (!threw) {
    throw new Error('FAIL ' + name + ': planted route-parity defect escaped');
  }
  process.stdout.write('REJECT ' + name + '\n');
}

validate(loadLedger());
process.stdout.write('PASS clean: live ledger routePanel matches route-behavior meaning\n');

reject('A4 denial-without-prefix', function (release) {
  hostOf(release, 'united').routePanel = 'Yes';
  routeBehaviors(release).united = 'No separate route summary is shown on United.';
});

reject('united Yes + old denial sentence', function (release) {
  hostOf(release, 'united').routePanel = 'Yes';
  routeBehaviors(release).united =
    'United pages use the flight labels and Best WiFi choice instead of a separate route summary.';
});

reject('united No + affirming sentence', function (release) {
  hostOf(release, 'united').routePanel = 'No';
});

reject('google Yes + Not offered here', function (release) {
  hostOf(release, 'google').routePanel = 'Yes';
});

process.stdout.write('release-host-route-parity: 1 PASS, 4 REJECT\n');
