#!/usr/bin/env node
'use strict';
/* Live functions/ relative imports must resolve inside functions/. Then the
 * exact extra-`../` specs that failed Pages on 5d0a424 must be REJECTED.
 * Watching the live tree pass does not prove the guard can fail. */

var assert = require('assert');
var path = require('path');

var F = require('./lib/functions-imports');
var ROOT = path.join(__dirname, '..');
var FN = path.join(ROOT, 'functions');
var FEEDBACK_LIB = path.resolve(FN, '_lib', 'feedback.mjs');

function reject(name, file, spec, expect) {
  var result = F.explainSpec(path.join(FN, file), spec, FN);
  if (result.ok) throw new Error('FAIL ' + name + ': planted extra ../ escaped');
  assert.ok(expect.test(result.why || ''),
    name + ' must fail matching ' + expect + ', got: ' + result.why);
  process.stdout.write('REJECT ' + name + '\n');
}

var tree = F.checkTree(FN);
assert.deepStrictEqual(tree, [], 'live functions/ relative imports stay under functions/\n' +
  tree.map(function (p) { return p.file + ' from "' + p.spec + '": ' + p.why; }).join('\n'));

var bindings = F.checkFeedbackBindings(FN);
assert.deepStrictEqual(bindings, [],
  'feedback route bindings resolve to functions/_lib/feedback.mjs\n' +
  bindings.map(function (p) { return p.file + ': ' + p.why; }).join('\n'));

F.FEEDBACK_BINDINGS.forEach(function (rel) {
  var file = path.join(FN, rel);
  var specs = F.relativeSpecs(require('fs').readFileSync(file, 'utf8'));
  assert.strictEqual(specs.length, 1, rel + ' has one relative import');
  var result = F.explainSpec(file, specs[0], FN);
  assert.ok(result.ok, rel + ' resolves: ' + (result.why || ''));
  assert.strictEqual(path.resolve(result.resolved), FEEDBACK_LIB,
    rel + ' resolves to functions/_lib/feedback.mjs');
});

process.stdout.write('PASS live functions/ relative imports stay under functions/_lib\n');

reject('ack extra ../ walks past functions/',
  'api/feedback/ack.js',
  '../../../_lib/feedback.mjs',
  /walks out of functions/);

reject('feed extra ../ walks past functions/',
  'api/feedback/feed.js',
  '../../../_lib/feedback.mjs',
  /walks out of functions/);

reject('shot extra ../ walks past functions/',
  'api/feedback/shot/[id].js',
  '../../../../_lib/feedback.mjs',
  /walks out of functions/);

reject('ack missing sibling under functions/_lib',
  'api/feedback/ack.js',
  '../../_lib/does-not-exist.mjs',
  /target does not exist/);

process.stdout.write('functions-import-resolve: 1 PASS, 4 REJECT\n');
