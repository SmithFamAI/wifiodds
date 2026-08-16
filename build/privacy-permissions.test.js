#!/usr/bin/env node
'use strict';
/* Planted defects for the /privacy §7 vs live 3.0.2 grant-kind guard.
 *
 * The live template and generated page must pass. Then known-bad mutations
 * must be REJECTED: undeclared hosts listed as permissions, a missing Google
 * optional grant, missing alarms/notifications, and a scripting reason that
 * forgets usl-dyn-gflights. Watching validate() succeed on the current file
 * does not prove it can fail. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var validate = require('./lib/privacy-permissions').validate;
var ROOT = path.join(__dirname, '..');
var TEMPLATE = path.join(ROOT, 'build', 'templates', 'privacy.html');

function load(file) {
  return fs.readFileSync(file, 'utf8');
}

function reject(name, html, expect) {
  var threw = false;
  var message = '';
  try {
    validate(html, name);
  } catch (err) {
    threw = true;
    message = err.message || String(err);
  }
  if (!threw) throw new Error('FAIL ' + name + ': planted privacy-permission defect escaped');
  assert.ok(expect.test(message),
    name + ' must fail matching ' + expect + ', got: ' + message);
  process.stdout.write('REJECT ' + name + '\n');
}

validate(load(TEMPLATE), 'privacy template');
process.stdout.write('PASS clean: privacy template §7 matches 3.0.2 grant kinds\n');

var live = load(TEMPLATE);

reject('alaska tracker as permission',
  live.replace('<tr><td class="mono">unitedstarlinktracker.com</td>',
    '<tr><td class="mono">unitedstarlinktracker.com<br>alaskastarlinktracker.com</td>'),
  /undeclared host|alaskastarlinktracker/);

reject('wifiodds.com as permission',
  live.replace(
    '<tr><td class="mono">unitedstarlinktracker.com</td><td class="kind">host_permissions</td>',
    '<tr><td class="mono">wifiodds.com</td><td class="kind">host_permissions</td>' +
    '</tr><tr><td class="mono">unitedstarlinktracker.com</td><td class="kind">host_permissions</td>'),
  /undeclared host|wifiodds\.com|host_permissions must be/);

reject('missing google optional grant',
  live.replace(/<tr><td class="mono">www\.google\.com[\s\S]*?<\/tr>\s*/, ''),
  /missing permission www\.google\.com/);

reject('missing alarms',
  live.replace(/<tr><td class="mono">alarms[\s\S]*?<\/tr>\s*/, ''),
  /missing permission alarms/);

reject('missing notifications',
  live.replace(/<tr><td class="mono">notifications[\s\S]*?<\/tr>\s*/, ''),
  /missing permission notifications/);

reject('scripting omits Google Flights registration',
  live.replace(
    'Google Flights content script (usl-dyn-gflights, www.google.com/travel/*) after each',
    'optional Alaska content script after each'),
  /usl-dyn-gflights/);

reject('alaska marked always-on content_scripts',
  live.replace(
    '<tr><td class="mono">alaskaair.com</td><td class="kind">optional grant</td>',
    '<tr><td class="mono">alaskaair.com</td><td class="kind">content_scripts, always</td>'),
  /alaskaair\.com kind/);

process.stdout.write('privacy-permissions: 1 PASS, 7 REJECT\n');
