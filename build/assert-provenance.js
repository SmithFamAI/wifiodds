'use strict';
/* build/assert-provenance.js — ARCHETYPES' provenance rule, made checkable.
 *
 * ARCHETYPES.md, "Provenance under every figure": *"A figure without a
 * provenance line within one screen of it is a bug. The build should fail on
 * it, the way it already fails when the United ledger rows stop summing to the
 * published score."*
 *
 * The ledger check it compares itself to is reconcileUnited(), and that one HEALS
 * and logs rather than exiting 1, because it runs unattended at 04:32. This one
 * cannot heal: the fix for a missing provenance line is a source and a date, and
 * inventing either is the worst thing anything in this repo could do. So it
 * reports, and switching it on is a separate decision made from the count.
 *
 *   node build/assert-provenance.js            report, always exit 0
 *   node build/assert-provenance.js --strict    exit 1 on any violation
 *
 * ── TWO DEFINITIONS, both arguable, both written down ──────────────────────
 *
 * A FIGURE is an element whose class list contains `stat`, `scorebox`, `tape` or
 * `tbl`. Those are the four units ARCHETYPES treats as a number the reader takes
 * away: the today-in-figures stat, the score arc, the tape, and a data table.
 *
 * Deliberately NOT a figure: a bare `.num` span. united/fleet/ carries 964 of
 * them and they are cells of one table with one provenance line, which is how
 * the archetype says a ledger should be built. Counting cells would demand 964
 * source lines and would be a different, wronger rule.
 *
 * ONE SCREEN is the nearest enclosing <section>, <article>, <aside> or <main>. A
 * pixel definition cannot be evaluated without a browser and a viewport, and
 * this repo's pages are already built as sections with a trailing `<p class=
 * "src">`. Enclosing section is the honest structural stand-in, and it is
 * stricter than a screen on a long section rather than looser, which is the
 * right way for the error to lean.
 *
 * A page with no sectioning element at all falls back to <body>, which is a weak
 * check. Those pages are counted separately in the report so the number is not
 * quietly flattering.
 */

var fs = require('fs');
var path = require('path');
var R = require('./routes.js');

var ROOT = path.join(__dirname, '..');

var FIGURE_CLASSES = ['stat', 'scorebox', 'tape', 'tbl'];
var SECTIONING = ['section', 'article', 'aside', 'main'];

function classTokens(tag) {
  var m = /\bclass\s*=\s*"([^"]*)"/i.exec(tag);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

/* Where every sectioning element starts and ends, by depth-counting the tag.
 * Regex, like everything else in this build that reads its own output — the
 * repo is dependency-free and adding a parser for one assertion is not a trade
 * worth making. It only has to understand markup this build emits. */
function containers(html) {
  var out = [];
  SECTIONING.forEach(function (name) {
    var open = new RegExp('<' + name + '\\b', 'gi');
    var m;
    while ((m = open.exec(html)) !== null) {
      var gt = html.indexOf('>', m.index);
      if (gt < 0) continue;
      var o = new RegExp('<' + name + '\\b', 'gi');
      var c = new RegExp('</' + name + '\\s*>', 'gi');
      var depth = 1, pos = gt + 1;
      while (depth > 0) {
        o.lastIndex = pos; c.lastIndex = pos;
        var a = o.exec(html), b = c.exec(html);
        if (!b) { pos = html.length; break; }
        if (a && a.index < b.index) { depth++; pos = a.index + a[0].length; }
        else { depth--; pos = b.index + b[0].length; }
      }
      out.push({ name: name, start: m.index, end: pos, tag: html.slice(m.index, gt + 1) });
    }
  });
  return out;
}

/* The tightest container holding this offset. Tightest rather than outermost:
 * an airline page nests nothing today, but a nested section later should scope
 * to itself, not to its parent. */
function enclosing(cons, at) {
  var best = null;
  cons.forEach(function (c) {
    if (at < c.start || at >= c.end) return;
    if (!best || (c.end - c.start) < (best.end - best.start)) best = c;
  });
  return best;
}

function label(tag) {
  var id = /\bid\s*=\s*"([^"]*)"/i.exec(tag);
  if (id) return '#' + id[1];
  var cls = classTokens(tag);
  return cls.length ? '.' + cls.join('.') : '(unnamed)';
}

function scanFile(file) {
  var html;
  try { html = fs.readFileSync(path.join(ROOT, file), 'utf8'); }
  catch (e) { return null; }

  var cons = containers(html);
  var res = { file: file, figures: 0, violations: [], bodyScoped: 0, sections: cons.length };

  /* Every provenance line's offset, so "is there one in this range" is a scan
     rather than a substring search that could match across a boundary. */
  var srcAt = [];
  var SRC = /<[a-zA-Z][\w-]*\b[^>]*\bclass\s*=\s*"[^"]*\bsrc\b[^"]*"/g;
  var s;
  while ((s = SRC.exec(html)) !== null) srcAt.push(s.index);

  var TAG = /<[a-zA-Z][\w-]*\b[^>]*\bclass\s*=\s*"([^"]*)"/g;
  var m;
  while ((m = TAG.exec(html)) !== null) {
    var cls = m[1].split(/\s+/).filter(Boolean);
    var isFigure = FIGURE_CLASSES.some(function (c) { return cls.indexOf(c) >= 0; });
    if (!isFigure) continue;
    res.figures++;

    var box = enclosing(cons, m.index);
    var lo = box ? box.start : 0;
    var hi = box ? box.end : html.length;
    if (!box) res.bodyScoped++;

    var covered = srcAt.some(function (at) { return at >= lo && at < hi; });
    if (!covered) {
      res.violations.push({
        cls: '.' + cls.join('.'),
        scope: box ? box.name + ' ' + label(box.tag) : 'body (no sectioning element)',
        at: m.index,
        /* The SECOND measure, and the reason the report has two numbers. The
           rule says "within one screen", and enclosing-section is a proxy that
           runs stricter than a screen: a stats block sitting immediately above a
           sourced ledger fails the proxy while passing the rule a reader would
           apply with their eyes. Rendered-word distance to the nearest source
           anywhere on the page is the looser reading. Neither is the truth;
           together they bracket it. */
        words: wordsToNearestSrc(html, m.index, srcAt),
      });
    }
  }
  return res;
}

/* Rendered words between a figure and the closest provenance line on the page.
 * Tags and script/style stripped, so this counts what a reader scrolls past
 * rather than bytes of markup. A screen of this site at 390px is roughly 120
 * rendered words; on a desktop viewport it is nearer 250. The report buckets
 * against 250 and says so. */
function renderedWords(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .split(/\s+/).filter(Boolean).length;
}
function wordsToNearestSrc(html, at, srcAt) {
  if (!srcAt.length) return Infinity;
  var best = Infinity;
  srcAt.forEach(function (s) {
    var lo = Math.min(s, at), hi = Math.max(s, at);
    var n = renderedWords(html.slice(lo, hi));
    if (n < best) best = n;
  });
  return best;
}

/* quiet: one summary line, for prerender.js. The build already prints 40 lines
 * and a report nobody reads is worse than a number they do. */
function run(strict, quiet) {
  var files = R.ROUTES.concat(R.UNLISTED).map(function (r) { return r.file; });
  var totalFigures = 0, totalViolations = 0, totalBodyScoped = 0;
  var byFile = [];

  files.forEach(function (f) {
    var r = scanFile(f);
    if (!r) return;
    totalFigures += r.figures;
    totalViolations += r.violations.length;
    totalBodyScoped += r.bodyScoped;
    if (r.violations.length) byFile.push(r);
  });

  if (!quiet) {
    console.log('provenance assertion — ARCHETYPES "a figure without a provenance line');
    console.log('  within one screen of it is a bug"');
    console.log('  figure = an element classed stat, scorebox, tape or tbl');
    console.log('  one screen = the nearest enclosing section/article/aside/main');
    console.log('');
    console.log('  ' + totalFigures + ' figures across ' + files.length + ' built routes');
    console.log('  ' + totalViolations + ' with no provenance line in the enclosing section');
    console.log('  ' + totalBodyScoped + ' fell back to <body> scope (a weaker check than the rule wants)');
  }

  /* The looser reading, bucketed. 250 rendered words is about one desktop
     screen of this site; 120 is about one at 390px. */
  var far = [], near = [], none = [];
  byFile.forEach(function (r) {
    r.violations.forEach(function (v) {
      v.file = r.file;
      if (v.words === Infinity) none.push(v);
      else if (v.words <= 250) near.push(v);
      else far.push(v);
    });
  });
  if (quiet) {
    console.log('  provenance REPORT ONLY — ' + totalViolations + ' of ' + totalFigures +
      ' figures have no source in their section, ' + far.length +
      ' none within a screen. Not a failure: `node build/assert-provenance.js` for the list.');
    return { figures: totalFigures, violations: totalViolations, far: far.length,
      bodyScoped: totalBodyScoped };
  }

  console.log('');
  console.log('  of those ' + totalViolations + ', by distance to the nearest source anywhere on the page:');
  console.log('    ' + near.length + ' within 250 rendered words (about one desktop screen)');
  console.log('    ' + far.length + ' further than that');
  console.log('    ' + none.length + ' on a page with no provenance line at all');

  if (byFile.length) {
    console.log('');
    byFile.sort(function (a, b) { return b.violations.length - a.violations.length; });
    byFile.forEach(function (r) {
      console.log('  ' + r.file + '  (' + r.violations.length + ' of ' + r.figures + ')');
      var seen = {}, dist = {};
      r.violations.forEach(function (v) {
        var k = v.cls + ' in ' + v.scope;
        seen[k] = (seen[k] || 0) + 1;
        dist[k] = Math.min(dist[k] === undefined ? Infinity : dist[k], v.words);
      });
      Object.keys(seen).sort().forEach(function (k) {
        console.log('      ' + seen[k] + 'x  ' + k +
          '   nearest source ' + (dist[k] === Infinity ? 'none on page' : dist[k] + 'w'));
      });
    });
  }

  /* The actionable list. These fail BOTH readings, so no argument about where a
     screen ends rescues them: the figure ships and the nearest source is more
     than a screen away in rendered text. */
  if (far.length) {
    console.log('');
    console.log('  fail both readings — these are the ones to fix:');
    far.sort(function (a, b) { return b.words - a.words; });
    far.forEach(function (v) {
      console.log('    ' + String(v.words + 'w').padStart(7) + '  ' + v.file + '  ' +
        v.cls + ' in ' + v.scope);
    });
  }

  if (strict && totalViolations) {
    console.error('');
    console.error('Build FAILED — ' + totalViolations + ' figures ship without a provenance line.');
    console.error('  There is no automatic fix. A provenance line is a source and a date, and');
    console.error('  this build may never invent either. Add the line, or move the figure into');
    console.error('  a section that already carries one.');
    process.exit(1);
  }
  return { figures: totalFigures, violations: totalViolations, bodyScoped: totalBodyScoped };
}

module.exports = { run: run, scanFile: scanFile };

if (require.main === module) {
  run(process.argv.indexOf('--strict') >= 0);
}
