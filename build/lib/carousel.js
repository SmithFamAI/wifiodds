'use strict';
/* build/lib/carousel.js — the extension "how it works" carousel, read from the
 * ONE file that already holds it.
 *
 * WHY A LOADER AND NOT A COPY. The animated United↔Navan reel lives in
 * `united/assets/plugin-carousel.html` as a standalone promo page (it is listed
 * in EMBEDS in build/prerender.js precisely because it is not a page). Its
 * `<section class="plc">` is fully self-contained: every selector is scoped under
 * `.plc`, every custom property it reads is declared on `.plc`, and its inline
 * <script> finds its own root via `currentScript.closest("section.plc")` and
 * refuses to double-init. So it can be dropped into any document as-is.
 *
 * The homepage therefore SLICES that section out at build time rather than
 * carrying a second transcription of 850 lines of keyframes. A copy would drift;
 * three of them would drift faster. (build/templates/united-optimizer.html still
 * has its own inline copy from when /united/ was hand-authored — that is
 * pre-existing, and collapsing it onto this loader is a separate change with its
 * own verification.)
 *
 * The two asserts below are the whole contract this file cares about:
 *   1. scene 1 ships `is-active` in the MARKUP — that is the static first frame
 *      a no-JS visitor sees. Without it the section renders blank.
 *   2. a `prefers-reduced-motion` block exists — the reel must go still for
 *      anyone who asked for that.
 * If either disappears upstream the build fails here, loudly, instead of
 * shipping an empty box or an unstoppable animation. */

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', '..', 'united', 'assets', 'plugin-carousel.html');
var REL = 'united/assets/plugin-carousel.html';
var OPEN = '<section class="plc"';
var CLOSE = '</section>';

var cache = null;

function fail(why) {
  console.error('Build FAILED — ' + REL + ': ' + why);
  console.error('  The homepage extension section slices the <section class="plc"> block out of');
  console.error('  that file (see build/lib/carousel.js). Fix the source file, or fix the slice —');
  console.error('  do not paste a second copy of the carousel into a generator.');
  process.exit(1);
}

/* The whole <section class="plc"> … </section> block, verbatim: its scoped
 * <style>, its markup, and its inline <script>, in that order. */
function section() {
  if (cache) return cache;
  var src;
  try { src = fs.readFileSync(SRC, 'utf8'); }
  catch (e) { fail('cannot be read (' + e.message + ')'); }

  var a = src.indexOf(OPEN);
  var b = src.lastIndexOf(CLOSE);
  if (a < 0) fail('no `' + OPEN + '` found');
  if (b <= a) fail('no closing `' + CLOSE + '` after the section opened');
  var out = src.slice(a, b + CLOSE.length);

  if (out.indexOf('plc-s1 is-active') < 0) {
    fail('scene 1 no longer carries `is-active` in the markup, so the no-JS ' +
      'static first frame would be blank');
  }
  if (out.indexOf('prefers-reduced-motion') < 0) {
    fail('the `prefers-reduced-motion` block is gone from the scoped CSS');
  }
  if (out.indexOf('<script>') < 0 || out.indexOf('</script>') < 0) {
    fail('the inline <script> that drives the scenes is missing from the section');
  }
  cache = out;
  return out;
}

module.exports = { section: section, SRC: SRC, REL: REL };
