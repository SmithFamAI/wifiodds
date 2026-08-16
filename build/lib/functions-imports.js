'use strict';
/* Resolve relative import specs under functions/ the way wrangler/esbuild does:
 * from the file's directory, then ask whether the result still sits inside
 * functions/. The production Pages failure on 5d0a424 was three extra `../`
 * segments that walked past functions/ to a repo-root `_lib/` that does not
 * exist. node --check does not resolve imports, so it never saw that. */

var fs = require('fs');
var path = require('path');

var FROM_SPEC = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;

function walkModules(dir, out) {
  out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    var p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkModules(p, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(p);
  });
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function relativeSpecs(src) {
  var code = stripComments(src);
  var specs = [];
  var match;
  var re = new RegExp(FROM_SPEC.source, 'g');
  while ((match = re.exec(code))) {
    if (match[1].charAt(0) === '.') specs.push(match[1]);
  }
  return specs;
}

function posixRel(fromDir, toPath) {
  return path.relative(fromDir, toPath).split(path.sep).join('/');
}

function explainSpec(fromFile, spec, functionsRoot) {
  functionsRoot = path.resolve(functionsRoot);
  fromFile = path.resolve(fromFile);
  if (!spec || spec.charAt(0) !== '.') {
    return { ok: true, spec: spec, skipped: 'non-relative' };
  }
  var resolved = path.resolve(path.dirname(fromFile), spec);
  var rel = posixRel(functionsRoot, resolved);
  if (rel === '..' || rel.indexOf('../') === 0 || path.isAbsolute(rel)) {
    return {
      ok: false,
      spec: spec,
      resolved: resolved,
      why: 'walks out of functions/ to ' + rel
    };
  }
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      spec: spec,
      resolved: resolved,
      why: 'target does not exist: ' + rel
    };
  }
  return { ok: true, spec: spec, resolved: resolved, within: rel };
}

function checkTree(functionsRoot) {
  functionsRoot = path.resolve(functionsRoot);
  var problems = [];
  walkModules(functionsRoot).forEach(function (file) {
    var relFile = posixRel(functionsRoot, file);
    relativeSpecs(fs.readFileSync(file, 'utf8')).forEach(function (spec) {
      var result = explainSpec(file, spec, functionsRoot);
      if (!result.ok) {
        problems.push({
          file: relFile,
          spec: spec,
          resolved: result.resolved,
          why: result.why
        });
      }
    });
  });
  return problems;
}

var FEEDBACK_BINDINGS = [
  'api/feedback/index.js',
  'api/feedback/ack.js',
  'api/feedback/feed.js',
  'api/feedback/shot/[id].js'
];

function checkFeedbackBindings(functionsRoot) {
  functionsRoot = path.resolve(functionsRoot);
  var expected = path.resolve(functionsRoot, '_lib', 'feedback.mjs');
  var problems = [];
  FEEDBACK_BINDINGS.forEach(function (rel) {
    var file = path.join(functionsRoot, rel);
    if (!fs.existsSync(file)) {
      problems.push({ file: rel, why: 'feedback route binding is missing' });
      return;
    }
    var specs = relativeSpecs(fs.readFileSync(file, 'utf8'));
    if (specs.length !== 1) {
      problems.push({
        file: rel,
        why: 'expected one relative import, got ' + specs.length,
        specs: specs
      });
      return;
    }
    var result = explainSpec(file, specs[0], functionsRoot);
    if (!result.ok) {
      problems.push({
        file: rel,
        spec: specs[0],
        resolved: result.resolved,
        why: result.why
      });
      return;
    }
    if (path.resolve(result.resolved) !== expected) {
      problems.push({
        file: rel,
        spec: specs[0],
        resolved: result.resolved,
        why: 'must resolve to functions/_lib/feedback.mjs'
      });
    }
  });
  return problems;
}

module.exports = {
  FEEDBACK_BINDINGS: FEEDBACK_BINDINGS,
  walkModules: walkModules,
  relativeSpecs: relativeSpecs,
  explainSpec: explainSpec,
  checkTree: checkTree,
  checkFeedbackBindings: checkFeedbackBindings
};
