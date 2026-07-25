'use strict';
/* build/lib/tmpl.js — the page-template loader.
 *
 * WHY THIS EXISTS. Four pages used to be hand-authored whole documents:
 * /united/ (the ~1,400-line live-tested optimizer app), /united/history/,
 * /alaska/ and /privacy.html. Because each carried its OWN copy of the shared
 * chrome — <head> tags, topbar, subnav, breadcrumb, footer — every change to the
 * chrome had to be made in five places, and it drifted. It had already drifted:
 * three of the four shipped og:image?v=1 while the generator emitted ?v=2, and
 * each page's footer link row was different.
 *
 * The fix is NOT to rewrite those pages. It is to keep their UNIQUE content
 * verbatim in build/templates/*.html and pour it through the same H.page()
 * wrapper as the other 23 pages. The optimizer's app JS/CSS is byte-identical
 * on the way through — a template section is injected, never parsed.
 *
 * TEMPLATE FORMAT — sections delimited by a marker line, in any order:
 *
 *     <!--@head-->      goes in <head>, after site.css  (page-scoped <style>)
 *     <!--@prewrap-->   between <body> and <div class="wrap">  (the starfield canvas)
 *     <!--@body-->      the page content, between the subnav/crumb and the footer
 *     <!--@foot-->      after </div>, BEFORE /assets/site.js  (the page's app <script>)
 *
 * Everything between one marker line and the next is preserved byte for byte,
 * including trailing newlines. There is no interpolation and no escaping: a
 * template is a slab of finished HTML.
 */

var fs = require('fs');
var path = require('path');
var DIR = path.join(__dirname, '..', 'templates');

var SECTION_RE = /<!--@([a-z]+)-->\n([\s\S]*?)(?=<!--@[a-z]+-->\n|$)/g;
var KNOWN = { head: 1, prewrap: 1, body: 1, foot: 1 };

/* load('united-optimizer') -> {head, prewrap, body, foot} (missing ones are '') */
function load(name) {
  var file = path.join(DIR, name + '.html');
  var src = fs.readFileSync(file, 'utf8');
  var out = { head: '', prewrap: '', body: '', foot: '' };
  var seen = 0, m;
  SECTION_RE.lastIndex = 0;
  while ((m = SECTION_RE.exec(src))) {
    if (!KNOWN[m[1]]) {
      throw new Error('template ' + name + ': unknown section <!--@' + m[1] + '--> ' +
        '(known: ' + Object.keys(KNOWN).join(', ') + ')');
    }
    out[m[1]] = m[2];
    seen++;
  }
  if (!seen) throw new Error('template ' + name + ': no <!--@section--> markers found');
  if (!out.body) throw new Error('template ' + name + ': empty or missing <!--@body--> section');
  return out;
}

/* ── data-bake ────────────────────────────────────────────────────────────
 * <b data-bake="alaska.equipped">99</b>  →  the element's text is replaced.
 * The marker and its default value stay in the template, so the template is
 * always readable HTML with a plausible number in it, and baking is idempotent.
 *
 * The regex closes on the FIRST matching end tag, so a wrapper element must use
 * a different tag from anything nested inside it (see alaska.bandpill: <b> wraps
 * a <span>, deliberately).
 *
 * Returns {out, hits, missing}. An unknown key is the caller's cue to fail the
 * build — a marker nobody bakes is a number that silently goes stale. */
function bakeStr(src, map) {
  var hits = 0, missing = [];
  var out = src.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-bake="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    function (all, open, tag, key, inner, close) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) { missing.push(key); return all; }
      hits++;
      return open + map[key] + close;
    });
  return { out: out, hits: hits, missing: missing };
}

/* Bake a whole template's sections at once. Throws on an unknown key. */
function bake(t, map, label) {
  var total = 0, missing = [];
  ['head', 'prewrap', 'body', 'foot'].forEach(function (k) {
    if (!t[k]) return;
    var r = bakeStr(t[k], map);
    t[k] = r.out; total += r.hits;
    r.missing.forEach(function (x) { if (missing.indexOf(x) < 0) missing.push(x); });
  });
  if (missing.length) {
    throw new Error('template ' + label + ': unknown data-bake keys: ' + missing.join(', '));
  }
  t.bakeHits = total;
  return t;
}

module.exports = { load: load, bake: bake, bakeStr: bakeStr, DIR: DIR };
