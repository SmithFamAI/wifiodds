#!/usr/bin/env node
/* build/slop-gate.js — the prose ratchet. ZERO dependencies, CommonJS.
 *
 *     node build/slop-gate.js                 check the built pages (prerender calls this)
 *     node build/slop-gate.js --staged        check staged .md/.html/.txt (the pre-commit hook)
 *     node build/slop-gate.js --bless [path]  raise a baseline on purpose
 *     node build/slop-gate.js --json          machine-readable
 *
 * A copy rides in ~/websites/scripts/slop-gate.js, beside that repo's copy of
 * slop-check.js. The two are byte-identical on purpose, the same way the two
 * copies of slop-check.js are.
 *
 * ===========================================================================
 * WHY A RATCHET AND NOT A THRESHOLD
 *
 * A flat `--max-signature N` has exactly two settings. Put N below the site's
 * current worst page and the build stops today, on prose nobody is being asked
 * to fix. Put N above it and every new page is free to write itself right up to
 * the ceiling. Neither one makes anything better tomorrow than it is today.
 *
 * So the baseline is per page and it is committed: build/slop-baseline.json.
 * Three rules, and they are the whole design.
 *
 *   1. A page may not get WORSE than its own recorded number.  Existing debt is
 *      grandfathered. Nobody is blocked by prose they did not write.
 *   2. When a page gets BETTER the baseline is rewritten DOWN, automatically, in
 *      the same run.  The improvement becomes the new ceiling, so the page can
 *      never quietly slide back to where it was.
 *   3. A page with no baseline at all is NEW, and a new page carries no debt, so
 *      it is held to the published targets instead (below).
 *
 * Bootstrapping, if build/slop-baseline.json is ever lost: `node
 * build/slop-gate.js --bless` records every surface at what it scores today and
 * prints the debt it just wrote down. That is the one moment the ratchet is
 * allowed to accept the site as it stands, which is why it prints a list.
 *
 * ===========================================================================
 * WHAT IS COMPARED, AND WHY IT IS COUNTS AND NOT RATES
 *
 * This is the part that lets the gate fail an unattended build safely, so it is
 * worth being precise about.
 *
 * slop-check reports LLM-signature and Cliche as points per 100 words. The rate
 * is the right number to READ. It is the wrong number to GATE, because the
 * denominator moves on its own: the United roster grows every morning and
 * /united/fleet/ gets longer, which changes the rate without anybody writing a
 * word. So the gate compares the RAW WEIGHTED POINTS — the numerator — and only
 * prints the rate.
 *
 * Data changes the denominator. Only prose changes the numerator.
 *
 * Pivot punctuation is the exception and it is deliberate. Em dash density is
 * the single worst tell this site ever shipped (19.4 per 1,000 words on the live
 * homepage in July 2026, against a human mean of 3.23), and slop-check only
 * scores it above 5 per 1,000 — so a page drifting from 1.4 to 4.9 would move
 * zero points and pass a points-only gate. That is the exact regression this
 * file exists to stop, so pivot density is gated on the RATE, with a tolerance
 * measured against real data movement below.
 *
 * ===========================================================================
 * THE TOLERANCES, AND THE MEASUREMENTS BEHIND THEM
 *
 *   llmPoints     +0.20    clichePoints  +0.20
 *   unsub         +0       pivotPer1000  +1.00
 *
 * Measured on this repo, 25 Jul 2026, 32 surfaces (30 routes + 404 + llms.txt):
 *
 *   Change                                    largest movement seen
 *   ---------------------------------------   ------------------------------
 *   united/data.json  +7 equipped, +3 fleet    0.000 on every metric, every page
 *   united/data.json  +150 roster tails,       llmPoints 0.000, clichePoints
 *     +150 equipped, +22 fleet, date moved     0.000, unsub 0, pivot -0.34
 *     forward 3 months (≈ a full quarter of      (an IMPROVEMENT, on the one page
 *     unattended daily pulls, applied at once)   that grew: /united/fleet/)
 *
 * So the largest data-driven movement in a quarter of simulated daily refreshes
 * was 0.000 weighted points and 0.34 on a pivot rate, in the safe direction.
 *
 * 0.20 points sits far above that and below anything worth catching: a full
 * structural tell is 1.00, a trailing participle 1.20, a new lexical family 0.42
 * at minimum, a multiword bundle 0.25, a generic subhead 0.40. Nothing a writer
 * can add scores under 0.20 except a second hit inside a family that already
 * counted, which by design is worth zero.
 *
 * 1.00 per 1,000 words on pivots is three times the worst data movement measured
 * and is dwarfed by any real regression: the July homepage would have failed
 * this by +18.
 *
 * One more guard sits under the pivot rate, because that same measurement found
 * the only place data CAN move a gated number: /united/fleet/ fell from 1.71 to
 * 1.37 per 1,000 words when the roster grew, with nobody removing a dash. A
 * rate that improves because the page got longer must not tighten the ceiling,
 * or the data would eventually cross a line the data itself drew. So the stored
 * `pivotUnits` count is what decides whether an improvement is real, and the
 * rate ratchets down only when the count of dashes actually fell.
 *
 * `unsub` gets no tolerance because it is an integer count of claims with no
 * source, date or link within 260 characters. One more of those is one more of
 * those. It is the metric with the most theoretical data coupling — its patterns
 * need digits — so it is the one worth watching if this ever misfires; it did
 * not move in either experiment above.
 *
 * ===========================================================================
 * FAIL OR WARN WHEN NOBODY IS WATCHING. IT FAILS. HERE IS THE ARGUMENT.
 *
 * `node build/prerender.js` runs unattended at 04:32 and on every Cloudflare
 * Pages push. reconcileUnited() above it is a reconcile rather than a tripwire
 * precisely because its input — United's fleet count — moves by itself
 * overnight, so a hard failure there would have taken the deploy down the first
 * morning United gained a tail. That lesson is real and it does not transfer
 * here, for one reason:
 *
 *   THE INPUT TO THIS GATE DOES NOT MOVE BY ITSELF.
 *
 * The prose comes from build/lib/*.js and build/templates/*. The 04:32 task
 * rewrites united/data.json and nothing else. Numbers change; sentences do not.
 * That is not a hope, it is the measurement in the table above: a simulated
 * quarter of daily pulls moved every scored metric by exactly zero.
 *
 * For this gate to fail at 04:32, somebody would have to have committed a copy
 * change that day — in which case failing is the entire point, and the failure
 * is attributable to that commit rather than to the data.
 *
 * The gate is also self-healing in the reconcileUnited sense: an improvement is
 * written back to the baseline rather than reported and forgotten, and the run
 * says so and tells you to stage the file. It heals down, it only ever fails up.
 *
 * If it does misfire, `SLOP_GATE=warn` downgrades every failure to a warning for
 * one run. That is an emergency valve, the same shape as `git commit
 * --no-verify`. The scheduled task does not set it and must not.
 *
 * ===========================================================================
 * PUBLISHED TARGETS FOR SOMETHING GENUINELY NEW
 *
 * "New" means created by this change, not merely unmeasured. A doc that has been
 * in the repo for a year is pre-existing prose: the first time it is touched it
 * is recorded at whatever it scores and grandfathered like everything else,
 * because blocking somebody over writing they inherited is how a hook gets
 * uninstalled. In build mode every surface is generated, so a surface with no
 * baseline really is a route that did not exist before.
 *
 * Something genuinely new has no debt to inherit, so it meets the numbers
 * already written down rather than whatever it happens to score.
 *
 *   built site pages   LLM-signature < 0.50 / 100w   pivot < 5.0 / 1000w
 *                      (WIFIODDS-BOOT.md, "targets for any page that ships")
 *   staged documents   LLM-signature < 3.00 / 100w   pivot < 5.0 / 1000w
 *                      (WRITING-STYLE.md §8 "under 3 is fine", §6 "flag at 5")
 *
 * The two LLM numbers differ because the two things differ. Site copy is the
 * product and has a published target. A brief is working prose and gets the
 * style guide's own band boundary.
 *
 * And two rules apply to every file, baselined or not, because they are verbatim
 * model output rather than a matter of degree: chat residue ("I hope this
 * helps", "Certainly!") and model markup leakage (contentReference, oaicite,
 * [cite: 12]). Those are never grandfathered.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var SC = require('./slop-check.js');

var ROOT = path.join(__dirname, '..');

/* Tolerances live HERE, in code, and not in the baseline file. The baseline
 * holds measurements only. Widening the gate should require editing the gate. */
var TOLERANCE = {
  llmPoints: 0.20,
  clichePoints: 0.20,
  unsub: 0,
  pivotPer1000: 1.00
};

var TARGET = {
  page: { llmPer100: 0.50, pivotPer1000: 5.0 },
  doc: { llmPer100: 3.00, pivotPer1000: 5.0 }
};

/* Never grandfathered, on any file, at any score. */
var NEVER = { 'chat-residue': 1, 'model-markup-leakage': 1 };

var METRICS = [
  { key: 'llmPoints', label: 'LLM-signature points', dp: 3 },
  { key: 'clichePoints', label: 'Cliche points', dp: 3 },
  { key: 'unsub', label: 'Unsubstantiated claims', dp: 0 },
  { key: 'pivotPer1000', label: 'pivot punctuation / 1000w', dp: 2 }
];
var EXPECTED_CONTROLS = METRICS.map(function (m) { return m.key; });

function round(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }

/* ── where the baseline lives ─────────────────────────────────────────────
 * wifiodds keeps it in build/. NOTE: build/ IS publicly served — the deploy has
 * an empty output directory, so Pages publishes the repo root. That is fine for
 * a baseline file and this comment used to claim .assetsignore prevented it,
 * which was never true. A repo with no build/ (websites) keeps it at the root,
 * which is not served, because only public/ is. */
function baselinePath() {
  if (process.env.SLOP_BASELINE) return path.resolve(process.env.SLOP_BASELINE);
  try {
    if (fs.statSync(path.join(ROOT, 'build')).isDirectory()) {
      return path.join(ROOT, 'build', 'slop-baseline.json');
    }
  } catch (e) { /* no build dir */ }
  return path.join(ROOT, 'slop-baseline.json');
}

var README = [
  'build/slop-baseline.json — the prose ratchet. Written by build/slop-gate.js.',
  '',
  'One entry per surface. A page may never score WORSE than the number here;',
  'when it scores better, this file is rewritten DOWN in the same run and the',
  'improvement becomes the new ceiling. That is why it is committed.',
  '',
  'llmPoints and clichePoints are RAW WEIGHTED POINTS, not per-100-word rates.',
  'Data changes the word count and therefore the rate; only prose changes the',
  'points. Gating the numerator is what makes an unattended failure safe.',
  '',
  'words and pivotUnits are NOT gated. They are bookkeeping, so the next run can',
  'tell a page that lost an em dash from a page that gained a paragraph.',
  '',
  'DO NOT hand-edit a number upward to make a build pass. Use --bless, which',
  'prints what it is raising and by how much, or fix the prose.',
  '',
  'Tolerances are in build/slop-gate.js, deliberately not in this file.'
];

function loadBaseline() {
  var p = baselinePath();
  try {
    var j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j.pages) j.pages = {};
    return j;
  } catch (e) {
    return { _readme: README, wordlist: SC.WORDLIST_VERSION, recorded: null, pages: {} };
  }
}

function saveBaseline(b) {
  b._readme = README;
  b.wordlist = SC.WORDLIST_VERSION;
  b.recorded = new Date().toISOString().slice(0, 10);
  var keys = Object.keys(b.pages).sort();
  var ordered = {};
  keys.forEach(function (k) { ordered[k] = b.pages[k]; });
  b.pages = ordered;
  fs.writeFileSync(baselinePath(), JSON.stringify(b, null, 2) + '\n');
}

/* ── measure one surface ──────────────────────────────────────────────────
 * Everything the gate compares comes out of here, so there is exactly one
 * definition of each number. */
function measure(name, source, kind) {
  var r = SC.analyze(source, { file: name, kind: kind || SC.kindOf(name) });
  var b = r.breakdown;
  var clichePoints = r.hits.reduce(function (t, h) {
    return t + (h.category === 'cliche' ? h.points : 0);
  }, 0);
  var never = r.hits.filter(function (h) { return NEVER[h.rule] && h.points > 0; });
  var pb = r.metrics.pivotBreakdown || { emDash: 0, doubleHyphen: 0, spacedHyphen: 0, commaPairs: 0 };
  return {
    words: b.wordCount,
    /* the numerator behind pivotPer1000. Not gated — it is here so the ratchet
     * can tell a page that lost a dash from a page that gained a paragraph. */
    pivotUnits: round(pb.emDash + pb.doubleHyphen + pb.spacedHyphen + 0.25 * pb.commaPairs, 2),
    llmPoints: round(b.structuralPoints + b.lexicalPoints + b.bundlePoints, 3),
    clichePoints: round(clichePoints, 3),
    unsub: r.unsubstantiated,
    pivotPer1000: r.metrics.pivotPer1000 === undefined ? 0 : r.metrics.pivotPer1000,
    /* reported, never gated — the readable form of the two points figures */
    llmPer100: r.llmSignature,
    clichePer100: r.cliche,
    _never: never,
    _worst: r.hits.filter(function (h) { return h.points > 0; }).slice(0, 3)
  };
}

/* Only the four gated numbers plus words are stored. llmPer100 is derivable and
 * would go stale against a word count that moves daily. */
function storable(m) {
  return {
    words: m.words,
    llmPoints: m.llmPoints,
    clichePoints: m.clichePoints,
    unsub: m.unsub,
    pivotPer1000: m.pivotPer1000,
    pivotUnits: m.pivotUnits
  };
}

/* ── the comparison ───────────────────────────────────────────────────────── */
function compare(name, now, was, targets, holdToTargets) {
  var out = { name: name, now: now, was: was, fails: [], improved: [], isNew: !was };

  now._never.forEach(function (h) {
    out.fails.push({
      metric: h.rule,
      msg: h.rule === 'chat-residue'
        ? 'chat transcript in shipped copy: ' + JSON.stringify(h.match.slice(0, 70))
        : 'verbatim model markup in shipped copy: ' + JSON.stringify(h.match.slice(0, 70)),
      fix: 'delete it. This one is never grandfathered and there is no baseline that excuses it.'
    });
  });

  if (!was) {
    /* Not created by this change, just not measured before. Pre-existing prose
     * is grandfathered at whatever it scores today, exactly like a page that
     * already had a baseline. Nobody is blocked by writing they inherited. */
    if (!holdToTargets) return out;
    if (now.llmPer100 > targets.llmPer100) {
      out.fails.push({
        metric: 'llmPer100',
        msg: 'new surface, LLM-signature ' + now.llmPer100 + ' / 100 words is above the published target of ' + targets.llmPer100,
        fix: 'edit it down, or --bless it and own the debt in writing'
      });
    }
    if (now.pivotPer1000 > targets.pivotPer1000) {
      out.fails.push({
        metric: 'pivotPer1000',
        msg: 'new surface, pivot punctuation ' + now.pivotPer1000 + ' / 1000 words is above the published target of ' + targets.pivotPer1000 + ' (human mean 3.23)',
        fix: 'end the sentences. Do not delete every dash: zero is a Llama signature.'
      });
    }
    return out;
  }

  METRICS.forEach(function (M) {
    var a = was[M.key];
    if (typeof a !== 'number') return;
    var b = now[M.key];
    var tol = TOLERANCE[M.key];
    var delta = round(b - a, M.dp);
    if (b > a + tol) {
      out.fails.push({
        metric: M.key,
        msg: M.label + ' ' + round(a, M.dp) + ' → ' + round(b, M.dp) + '  (+' + delta +
          ', tolerance +' + tol + ')',
        fix: fixFor(M.key)
      });
    } else if (b < a - 0.0005) {
      /* Ratchet DOWN only on an improvement the writer made. pivotPer1000 is a
       * rate, and the roster growing every morning lowers it without anybody
       * removing a dash — measured: /united/fleet/ fell from 1.71 to 1.37 on a
       * simulated quarter of daily pulls. Tightening the ceiling on that would
       * hand the data a number it could later cross on its own, which is the one
       * way this gate could fire unattended. So the rate ratchets only when the
       * pivot COUNT also fell. */
      if (M.key === 'pivotPer1000' && typeof was.pivotUnits === 'number' &&
          !(now.pivotUnits < was.pivotUnits - 0.0005)) return;
      out.improved.push({ metric: M.key, from: round(a, M.dp), to: round(b, M.dp) });
    }
  });
  return out;
}

function checkerPath() {
  var p = path.relative(ROOT, path.join(__dirname, 'slop-check.js'));
  return p.indexOf('..') === 0 ? path.join(__dirname, 'slop-check.js') : p;
}

function fixFor(key) {
  if (key === 'llmPoints') return 'a scored tell was added. Run: node ' + checkerPath() + ' <file> -v';
  if (key === 'clichePoints') return 'marketing or banned-word copy was added. Run: node ' + checkerPath() + ' <file> -v';
  if (key === 'unsub') return 'a figure shipped with no source, date or link within 260 characters. Add the source.';
  return 'em dashes and mid-sentence pivots went up. End the sentence instead.';
}

/* ── the two input sets ───────────────────────────────────────────────────── */

/* Built pages. Driven off build/routes.js so a new route is picked up without
 * anybody remembering to add it here, plus llms.txt, which is hand-written prose
 * inside prerender.js and is read by answer engines. */
function builtSurfaces() {
  var R;
  try { R = require('./routes.js'); } catch (e) { return []; }
  var files = R.ROUTES.concat(R.UNLISTED || []).map(function (r) { return r.file; });
  files.push('llms.txt');
  var out = [];
  files.forEach(function (f) {
    var abs = path.join(ROOT, f);
    var src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch (e) { return; } // prerender already asserts existence
    out.push({ name: f, source: src, kind: SC.kindOf(f) });
  });
  return out;
}

var TEXT_EXT = /\.(md|markdown|html?|txt)$/i;

/* Staged blobs, read out of the index rather than the worktree — the commit is
 * what ships, not whatever happens to be saved. */
function stagedSurfaces() {
  var listed;
  try {
    listed = cp.execSync('git diff --cached --name-only --diff-filter=ACM -z', {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
    });
  } catch (e) {
    return { error: 'git diff --cached failed: ' + e.message, surfaces: [], skipped: [] };
  }
  var files = listed.split('\0').filter(Boolean).filter(function (f) { return TEXT_EXT.test(f); });

  /* Which of them are being ADDED, as opposed to edited. The distinction is the
   * whole difference between a hook people keep and a hook people uninstall: a
   * doc that has been in the repo for a year is pre-existing prose and gets
   * grandfathered at whatever it scores the first time it is touched. Only a
   * file this commit CREATES has no debt to inherit, so only that one has to
   * meet the published targets. */
  var addedSet = {};
  try {
    cp.execSync('git diff --cached --name-only --diff-filter=A -z', {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
    }).split('\0').filter(Boolean).forEach(function (f) { addedSet[f] = 1; });
  } catch (e) { /* first commit in a repo: treat everything as pre-existing */ }

  var ignore = loadSlopIgnore();
  var skipped = [];
  var out = [];
  files.forEach(function (f) {
    if (ignore.some(function (re) { return re.test(f); })) { skipped.push(f); return; }
    var src;
    try {
      src = cp.execSync('git show :' + shellQuote(f), {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
      });
    } catch (e) { return; }
    out.push({ name: f, source: src, kind: SC.kindOf(f), createdHere: !!addedSet[f] });
  });
  return { surfaces: out, skipped: skipped };
}

function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/* ── .slopignore ──────────────────────────────────────────────────────────
 * One glob per line, # for comments. This is how generated output, verbatim
 * agent reports and other people's drafts stay out of the hook without the hook
 * needing to know which repo it is in. */
function loadSlopIgnore() {
  var txt;
  try { txt = fs.readFileSync(path.join(ROOT, '.slopignore'), 'utf8'); } catch (e) { return []; }
  return txt.split('\n').map(function (l) { return l.trim(); })
    .filter(function (l) { return l && l[0] !== '#'; })
    .map(globToRegex);
}

function globToRegex(glob) {
  var re = '';
  for (var i = 0; i < glob.length; i++) {
    var c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i += 1; if (glob[i + 1] === '/') i += 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.indexOf(c) !== -1) re += '\\' + c;
    else re += c;
  }
  /* a trailing / means "everything under here" */
  if (glob[glob.length - 1] === '/') re += '.*';
  return new RegExp('^' + re + '$');
}

/* ── the run ──────────────────────────────────────────────────────────────── */

/**
 * opts.mode      'build' (default) | 'staged'
 * opts.bless     true, or an array of paths to bless
 * opts.write     write baseline changes to disk (default true)
 * opts.label     what to call the surfaces in the output
 * Returns { ok, fails, results, ratcheted, added, blessed, ms }
 */
function run(opts) {
  opts = opts || {};
  var t0 = Date.now();
  var mode = opts.mode || 'build';
  var write = opts.write !== false;
  var targets = mode === 'staged' ? TARGET.doc : TARGET.page;

  var input = mode === 'staged' ? stagedSurfaces() : { surfaces: builtSurfaces(), skipped: [] };
  if (input.error) {
    /* No git, no index, nothing to read. Say so and get out of the way rather
     * than blocking on a condition that has nothing to do with prose. */
    return {
      ok: true, mode: mode, note: input.error, fails: [], results: [],
      ratcheted: [], added: [], blessed: [], skipped: [],
      baselineFile: path.relative(ROOT, baselinePath()), ms: Date.now() - t0
    };
  }

  var baseline = loadBaseline();
  var wordlistDrift = (baseline.recorded && baseline.wordlist !== SC.WORDLIST_VERSION)
    ? (baseline.wordlist || 'unrecorded') : null;

  var blessSet = null;
  if (Array.isArray(opts.bless) && opts.bless.length) {
    blessSet = {};
    opts.bless.forEach(function (p) { blessSet[p.replace(/^\.\//, '')] = 1; });
  }

  var results = [], ratcheted = [], added = [], blessed = [], fails = [];
  var observedControls = {};
  EXPECTED_CONTROLS.forEach(function (name) {
    if (process.env.SLOP_DISABLE_CONTROL !== name) observedControls[name] = 1;
  });

  input.surfaces.forEach(function (s) {
    var now = measure(s.name, s.source, s.kind);
    var was = baseline.pages[s.name];
    /* In build mode every surface is generated, so one with no baseline is a
     * route that did not exist before and carries no inherited debt. In staged
     * mode only a file this commit ADDS is genuinely new. */
    var holdToTargets = mode === 'staged' ? !!s.createdHere : true;
    var c = compare(s.name, now, was, targets, holdToTargets);
    results.push(c);

    if (opts.bless === true || (blessSet && blessSet[s.name])) {
      if (was) blessed.push({ name: s.name, was: was, now: storable(now) });
      else added.push({ name: s.name, now: storable(now) });
      baseline.pages[s.name] = storable(now);
      c.fails = [];
      return;
    }

    if (c.fails.length) { fails.push(c); return; }

    if (!was) {
      added.push({ name: s.name, now: storable(now) });
      baseline.pages[s.name] = storable(now);
    } else if (c.improved.length) {
      /* RULE 2: an improvement rewrites the ceiling in the same run, so the page
       * can never quietly slide back. Only the improved metrics move; a metric
       * that sat still keeps its number. */
      var next = JSON.parse(JSON.stringify(was));
      c.improved.forEach(function (i) { next[i.metric] = now[i.metric]; });
      next.words = now.words;
      next.pivotUnits = now.pivotUnits;
      baseline.pages[s.name] = next;
      ratcheted.push(c);
    } else if (was.words !== now.words || was.pivotUnits !== now.pivotUnits) {
      /* Bookkeeping only. Neither field is gated; both are what the ratchet
       * reads next time to tell prose movement from data movement. Note that
       * this alone does NOT mark the file dirty (see `changed` below): a purely
       * data-driven word count must not make the 04:32 task commit anything, so
       * these ride along the next time a real ratchet or a new surface saves. */
      baseline.pages[s.name].words = now.words;
      baseline.pages[s.name].pivotUnits = now.pivotUnits;
    }
  });

  var missingControls = EXPECTED_CONTROLS.filter(function (name) { return !observedControls[name]; });
  if (missingControls.length) {
    fails.push({
      name: 'control registry', isNew: false, now: { _worst: [] }, was: null,
      fails: [{ metric: 'controls', msg: 'expected ' + EXPECTED_CONTROLS.length +
        ' controls, observed ' + Object.keys(observedControls).length + '; missing ' + missingControls.join(', '),
        fix: 'restore the missing control before trusting this run' }], improved: []
    });
  }

  var changed = ratcheted.length || added.length || blessed.length;
  if (write && changed && !fails.length) saveBaseline(baseline);

  return {
    ok: !fails.length, mode: mode, fails: fails, results: results,
    ratcheted: ratcheted, added: added, blessed: blessed,
    skipped: input.skipped || [], wordlistDrift: wordlistDrift,
    baselineFile: path.relative(ROOT, baselinePath()),
    ms: Date.now() - t0,
    expectedControls: EXPECTED_CONTROLS.length,
    observedControls: Object.keys(observedControls).length
  };
}

/* ── reporting ────────────────────────────────────────────────────────────
 * Same shape as the other tripwires in prerender.js: name the page, name the
 * metric, name the number, say what to do about it. */
function selfPath() {
  var p = path.relative(ROOT, __filename);
  return p.indexOf('..') === 0 ? __filename : p;
}

function reportFailure(res) {
  var L = [];
  var staged = res.mode === 'staged';
  L.push((staged ? 'Commit BLOCKED' : 'Build FAILED') + ' — the prose ratchet caught a regression:');
  res.fails.forEach(function (c) {
    c.fails.forEach(function (f) {
      L.push('  ' + c.name + (c.isNew ? '  [new surface]' : '') + '  ' + f.msg);
      L.push('      → ' + f.fix);
    });
    if (c.now._worst.length && c.fails.some(function (f) { return f.metric === 'llmPoints' || f.metric === 'clichePoints' || f.metric === 'llmPer100'; })) {
      c.now._worst.forEach(function (h) {
        L.push('      ' + String(h.points).padStart(5) + '  line ' + h.line + '  ' + h.rule + '  ' +
          String(h.match).replace(/\s+/g, ' ').slice(0, 84));
      });
    }
  });
  L.push('');
  L.push('  Existing debt is grandfathered: the baseline in ' + res.baselineFile + ' is what each');
  L.push('  surface scored last time, and one only fails by getting worse than ITSELF.');
  L.push('  The house guide is ~/websites/WRITING-STYLE.md. Fix the prose and run it again.');
  L.push('  If the metric is wrong about the file rather than the file being wrong:');
  L.push('      node ' + selfPath() + ' --bless ' + res.fails.map(function (c) { return c.name; }).join(' '));
  L.push(staged
    ? '  Genuine emergency: git commit --no-verify'
    : '  Emergency only, one run: SLOP_GATE=warn node build/prerender.js');
  return L.join('\n');
}

function reportBless(res) {
  var L = [];
  var n = res.blessed.length;
  if (!n && res.added.length) {
    L.push('slop-gate: recorded ' + res.added.length + ' surface(s) for the first time. Nothing was raised.');
    L.push('  This is the debt the site starts from. From here each one can only hold or improve.');
    var debt = res.added.filter(function (a) {
      return a.now.llmPoints > 0 || a.now.clichePoints > 0 || a.now.unsub > 0 || a.now.pivotPer1000 >= 5;
    });
    if (debt.length) {
      L.push('  Carrying debt today:');
      debt.forEach(function (a) {
        L.push('    ' + a.name + '  llmPoints ' + a.now.llmPoints + ' · cliche ' + a.now.clichePoints +
          ' · unsub ' + a.now.unsub + ' · pivot ' + a.now.pivotPer1000 + '/1000w');
      });
    }
    L.push('  ' + path.relative(ROOT, baselinePath()) + ' is committed. Stage it.');
    return L.join('\n');
  }
  L.push('slop-gate: BLESSED ' + n + ' baseline' + (n === 1 ? '' : 's') + '. This raises a ceiling. It fixes nothing.');
  res.blessed.forEach(function (b) {
    METRICS.forEach(function (M) {
      var a = b.was[M.key], c = b.now[M.key];
      if (typeof a !== 'number' || Math.abs(c - a) < 0.0005) return;
      L.push('  ' + b.name + '  ' + M.label + '  ' + round(a, M.dp) + ' → ' + round(c, M.dp) +
        (c > a ? '   (WORSE by ' + round(c - a, M.dp) + ')' : '   (better)'));
    });
  });
  if (res.added.length) {
    L.push('  plus ' + res.added.length + ' surface(s) recorded for the first time.');
  }
  L.push('');
  L.push('  Blessing should be rare and it should be argued, because nothing will ever ask');
  L.push('  you about this number again — the raised figure becomes the new floor for');
  L.push('  every future check, and the next writer inherits it without being told.');
  L.push('  Bless when the linter is wrong about the page. Rewrite when it is right.');
  L.push('  Say which one it was in the commit message.');
  return L.join('\n');
}

/* One line for prerender, plus whatever it needs to say about healing. */
function reportBuildOK(res) {
  var L = [];
  var n = res.results.length;
  L.push('  slop ratchet OK — ' + n + ' surface' + (n === 1 ? '' : 's') + ' at or below baseline in ' +
    res.ms + ' ms (' + res.baselineFile + ')');
  L.push('    controls: expected ' + res.expectedControls + ', observed ' + res.observedControls);
  res.ratcheted.forEach(function (c) {
    L.push('    ratcheted DOWN ' + c.name + ': ' +
      c.improved.map(function (i) { return i.metric + ' ' + i.from + ' → ' + i.to; }).join(', ') +
      '   (stage ' + res.baselineFile + ' with this commit)');
  });
  res.added.forEach(function (a) {
    L.push('    baselined NEW ' + a.name + ': llmPoints ' + a.now.llmPoints + ', cliche ' +
      a.now.clichePoints + ', unsub ' + a.now.unsub + ', pivot ' + a.now.pivotPer1000 +
      '/1000w   (stage ' + res.baselineFile + ' with this commit)');
  });
  if (res.wordlistDrift) {
    L.push('    NOTE: the baseline was recorded against wordlist ' + res.wordlistDrift +
      ' and slop-check is now ' + SC.WORDLIST_VERSION + '. Wordlists rot in about a year, so');
    L.push('    every number below moved for a reason that is not the writing. Re-read them,');
    L.push('    then re-bless deliberately.');
  }
  return L.join('\n');
}

/* ── the entry point prerender.js calls ───────────────────────────────────
 * Fails the build on a regression. See the header for why that is safe at
 * 04:32. SLOP_GATE=warn downgrades it for one run, and nothing scheduled sets
 * that. */
function gateBuild(opts) {
  var res = run({ mode: 'build' });
  if (!res.ok) {
    var warnOnly = process.env.SLOP_GATE === 'warn';
    console.error(reportFailure(res));
    if (!warnOnly) process.exit(1);
    console.error('  SLOP_GATE=warn is set — downgraded to a warning for this run only.');
    res.summary = '  slop ratchet WARNED (SLOP_GATE=warn) — ' + res.fails.length + ' regression(s) let through';
    return res;
  }
  res.summary = reportBuildOK(res);
  if (!opts || !opts.quiet) console.log(res.summary);
  return res;
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */
function usage() {
  process.stdout.write([
    'slop-gate — the prose ratchet. A page may not score worse than itself.',
    '',
    '  node build/slop-gate.js                  check the built pages against the baseline',
    '  node build/slop-gate.js --staged         check staged .md/.html/.txt (pre-commit hook)',
    '  node build/slop-gate.js --staged --stage-baseline',
    '                                           …and git-add the baseline if it ratcheted',
    '  node build/slop-gate.js --bless [path…]  raise baselines on purpose (all, or just these)',
    '  node build/slop-gate.js --json           machine-readable',
    '  node build/slop-gate.js --dry-run        never write the baseline file',
    '',
    '  Baseline: ' + path.relative(ROOT, baselinePath()),
    '  Tolerances live in the code, not the baseline. Env: SLOP_GATE=warn (emergency, one run).',
    ''
  ].join('\n') + '\n');
}

function main(argv) {
  var opts = { mode: 'build', bless: false, json: false, write: true };
  var blessPaths = [];
  var sawBless = false;
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--staged') opts.mode = 'staged';
    else if (a === '--stage-baseline') opts.stageBaseline = true;
    else if (a === '--bless') sawBless = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.write = false;
    else if (a === '--help' || a === '-h') { usage(); return 0; }
    else if (a[0] === '-') { process.stderr.write('unknown option: ' + a + '\n'); usage(); return 2; }
    else if (sawBless) blessPaths.push(a);
    else { process.stderr.write('unexpected argument: ' + a + '\n'); usage(); return 2; }
  }
  if (sawBless) opts.bless = blessPaths.length ? blessPaths : true;

  var res = run(opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: res.ok, mode: res.mode, ms: res.ms, baseline: res.baselineFile,
      fails: res.fails.map(function (c) {
        return { name: c.name, isNew: c.isNew, fails: c.fails, now: storable(c.now), was: c.was };
      }),
      ratcheted: res.ratcheted.map(function (c) { return { name: c.name, improved: c.improved }; }),
      added: res.added, blessed: res.blessed,
      pages: res.results.map(function (c) {
        return {
          name: c.name, words: c.now.words, llmPoints: c.now.llmPoints,
          llmPer100: c.now.llmPer100, clichePoints: c.now.clichePoints,
          clichePer100: c.now.clichePer100, unsub: c.now.unsub,
          pivotPer1000: c.now.pivotPer1000
        };
      })
    }, null, 2) + '\n');
    return res.ok ? 0 : 1;
  }

  if (sawBless) {
    var seen = {};
    res.results.forEach(function (c) { seen[c.name] = 1; });
    var unmatched = blessPaths.filter(function (p) { return !seen[p.replace(/^\.\//, '')]; });
    if (unmatched.length) {
      process.stderr.write('slop-gate: nothing to bless for ' + unmatched.join(', ') + '\n' +
        '  In build mode the name has to be a file in build/routes.js (or llms.txt).\n' +
        '  In --staged mode it has to be staged. Nothing was changed for those paths.\n');
    }
    process.stdout.write(reportBless(res) + '\n');
    return unmatched.length ? 1 : 0;
  }

  if (!res.ok) { process.stderr.write(reportFailure(res) + '\n'); return 1; }

  if (opts.mode === 'staged') {
    if (!res.results.length) {
      process.stdout.write('slop-gate: no staged .md/.html/.txt to check' +
        (res.skipped.length ? ' (' + res.skipped.length + ' skipped by .slopignore)' : '') + '\n');
      return 0;
    }
    process.stdout.write('slop-gate: ' + res.results.length + ' staged file(s) at or below baseline (' +
      res.ms + ' ms)' + (res.skipped.length ? ', ' + res.skipped.length + ' skipped by .slopignore' : '') + '\n');
    res.ratcheted.forEach(function (c) {
      process.stdout.write('  ratcheted DOWN ' + c.name + ': ' +
        c.improved.map(function (i) { return i.metric + ' ' + i.from + ' → ' + i.to; }).join(', ') + '\n');
    });
    res.added.forEach(function (a) {
      process.stdout.write('  baselined NEW ' + a.name + '\n');
    });
    if (res.ratcheted.length || res.added.length) {
      if (opts.stageBaseline) {
        /* The hook owns this one file and nothing else. Staging it is what makes
         * an improvement stick: a ratchet that is written and then left unstaged
         * is a ratchet that resets on the next checkout. */
        try {
          cp.execSync('git add ' + shellQuote(res.baselineFile), { cwd: ROOT });
          process.stdout.write('  ' + res.baselineFile + ' updated and staged with this commit.\n');
        } catch (e) {
          process.stdout.write('  ' + res.baselineFile + ' changed — `git add ' + res.baselineFile +
            '` to carry it with this commit.\n');
        }
      } else {
        process.stdout.write('  ' + res.baselineFile + ' changed — `git add ' + res.baselineFile +
          '` to carry it with this commit.\n');
      }
    }
    return 0;
  }

  process.stdout.write(reportBuildOK(res) + '\n');
  return 0;
}

module.exports = {
  run: run, gateBuild: gateBuild, measure: measure, compare: compare,
  TOLERANCE: TOLERANCE, TARGET: TARGET, baselinePath: baselinePath, main: main
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
