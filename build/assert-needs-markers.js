'use strict';
/* A factual hole should be cheap to write and impossible to deploy. Authors may
 * leave a marker shaped like two opening brackets + NEEDS: + the missing fact;
 * this guard names every surviving file, line and marker text. */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SCAN_EXT = /\.(?:css|html|js|json|mjs|txt|xml)$/;
var SKIP_DIR = { '.git': 1, 'dist': 1, 'node_modules': 1 };
var OPEN = '[[';
var PREFIX = OPEN + 'NEEDS:';

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.isDirectory() && SKIP_DIR[entry.name]) return;
    var abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (SCAN_EXT.test(entry.name)) out.push(abs);
  });
  return out;
}

function scanText(file, text) {
  var hits = [];
  String(text).split(/\r?\n/).forEach(function (line, i) {
    var from = 0;
    while ((from = line.indexOf(PREFIX, from)) !== -1) {
      var end = line.indexOf(']]', from + PREFIX.length);
      var marker = end === -1 ? line.slice(from) : line.slice(from, end + 2);
      hits.push({ file: file, line: i + 1, text: marker });
      from += PREFIX.length;
    }
  });
  return hits;
}

function scan(root) {
  var hits = [];
  walk(root || ROOT, []).forEach(function (file) {
    var rel = path.relative(root || ROOT, file);
    hits = hits.concat(scanText(rel, fs.readFileSync(file, 'utf8')));
  });
  return hits;
}

function run() {
  var EXPECTED_CONTROL_FAILURES = 1;
  var control = scanText('control/unfinished-copy.html',
    '<p>' + OPEN + 'NEEDS: publisher, source, tier and date' + ']]</p>');
  var observed = control.length;
  if (observed !== EXPECTED_CONTROL_FAILURES) {
    console.error('NEEDS guard CONTROL FAILED: expected ' + EXPECTED_CONTROL_FAILURES +
      ' control failure, observed ' + observed + '. The instrument is void.');
    process.exit(1);
  }

  var hits = scan(ROOT);
  if (hits.length) {
    console.error('Build FAILED — unresolved factual hole marker(s) reached the deploy:');
    hits.forEach(function (hit) {
      console.error('  ' + hit.file + ':' + hit.line + '  ' + hit.text);
    });
    console.error('Replace each hole with sourced copy or write "no source found"; never invent the fact.');
    process.exit(1);
  }
  console.log('  needs-marker guard OK — controls: expected ' + EXPECTED_CONTROL_FAILURES +
    ', observed ' + observed + '; unresolved markers: 0');
  return { expected: EXPECTED_CONTROL_FAILURES, observed: observed, unresolved: 0 };
}

if (require.main === module) run();
module.exports = { run: run, scan: scan, scanText: scanText };
