/* ═══ A ZERO HAS TO BE MEASURED, OR THE BUILD STOPS ═══════════════════════
 *
 * On 26 Jul 2026 SAS carried an unsourced Starlink count of 60. Removing it
 * meant writing `equipped: 0`, and the site then published:
 *
 *     "0 of 123 SAS aircraft carry Starlink (0%)"
 *
 * two scroll-lengths from its own note saying Starlink launched at SAS on
 * 24 Mar 2026. Deleting a wrong number is substitution, not subtraction. In a
 * system where every field renders, an absent value becomes a rendered zero,
 * and zero is the more definite claim: it says somebody counted and found
 * none. Nobody had counted.
 *
 * `equippedPublished()` and `nextGenPublished()` in assets/airlines.js exist to
 * catch that, and today they do. They DERIVE the answer from fleet shape:
 * a segmented entry with unresolved aircraft whose primary system names no
 * segment is unpublished. That derivation is doing real work, and it is also
 * the whole defence. An entry that is not segmented, or has no unresolved
 * aircraft, gets `published = true` and a bare `equipped: 0` prints as a
 * confirmed zero with nothing in the way.
 *
 * So the derivation is the mechanism for the shapes it covers, and this file is
 * the mechanism for the shapes it does not. The rule:
 *
 *     A count of exactly 0 is a build failure unless the entry either
 *     (a) derives to unpublished, so nothing prints a number at all, or
 *     (b) carries an explicit `zeroIsMeasured: true`, which is an author
 *         saying out loud that somebody counted and found none.
 *
 * `zeroIsMeasured` is not a suppression flag. It is a claim, and it belongs
 * next to a source and a date like every other claim on this site.
 *
 * Verified to fail when tampered: see the tamper block in the module footer.
 * ═════════════════════════════════════════════════════════════════════════ */

var A = require('../assets/airlines.js');

/* Fields whose 0 is a published claim about the world. `fleet` is here because
 * a fleet of 0 makes every percentage on the entry a division by zero that the
 * clamp quietly turns into 0 as well. */
var COUNT_FIELDS = ['equipped', 'fleet', 'coverage'];

function published(entry) {
  /* pctEquipped returns null, never 0, exactly when the count is unpublished.
   * Reading it rather than re-implementing equippedPublished() keeps this guard
   * honest: if the derivation is ever loosened, this guard loosens with it and
   * cannot silently claim a coverage it no longer has. */
  return A.pctEquipped(entry) !== null;
}

function findViolations() {
  var out = [];
  Object.keys(A.WIFI_AIRLINES).forEach(function (key) {
    var e = A.WIFI_AIRLINES[key];
    if (e.zeroIsMeasured === true) return;

    COUNT_FIELDS.forEach(function (f) {
      if (e[f] !== 0) return;
      if (!published(e)) return;          // nothing renders a number, so no claim
      out.push({
        key: key, field: f,
        why: 'renders as a confirmed zero: pctEquipped() returns a number, not null'
      });
    });

    (e.segments || []).forEach(function (s, i) {
      if (s && s.n === 0) {
        out.push({
          key: key, field: 'segments[' + i + '].n',
          why: 'a segment of 0 aircraft counts toward the denominator as measured'
        });
      }
    });

    if (e.nextGenSplit && typeof e.nextGenSplit === 'object') {
      ['mainline', 'regional'].forEach(function (side) {
        var v = e.nextGenSplit[side];
        if (v && v.n === 0 && v.of > 0) {
          out.push({
            key: key, field: 'nextGenSplit.' + side + '.n',
            why: 'prints "0 of ' + v.of + '" as a counted result'
          });
        }
      });
    }
  });
  return out;
}

/* Proves the guard can fail before anyone trusts it passing. Injects a bare
 * zero into a clone of each shape the guard claims to cover and demands a
 * violation back; then injects zeroIsMeasured and demands silence. Runs on
 * every build, costs microseconds, and means a pass is evidence rather than
 * an absence of evidence. */
function selfTest() {
  var key = Object.keys(A.WIFI_AIRLINES).find(function (k) {
    return published(A.WIFI_AIRLINES[k]) && A.WIFI_AIRLINES[k].equipped > 0;
  });
  if (!key) return ['self-test could not find a published entry to tamper'];

  /* Compare against the tree as it stands, not against zero. An earlier version
   * asserted `findViolations().length === 0` after restoring, which is only
   * true when the data is already clean. Tamper a second entry by hand and this
   * guard failed with "the self-test is mutating shared state" instead of
   * naming the entry at fault: a real failure reported as the wrong failure,
   * which is worse than no report. The baseline is the control. */
  var mine = function (v) { return v.key === key; };
  var baseline = JSON.stringify(findViolations().filter(function (v) { return !mine(v); }));
  var e = A.WIFI_AIRLINES[key];
  var realEquipped = e.equipped;
  var errs = [];

  e.equipped = 0;
  if (!findViolations().some(mine)) {
    errs.push('tampering ' + key + '.equipped to 0 produced NO violation for ' + key +
      ' — this guard does not detect the thing it was written for');
  }
  e.zeroIsMeasured = true;
  if (findViolations().some(mine)) {
    errs.push('zeroIsMeasured:true on ' + key + ' did not silence the violation — ' +
      'the escape hatch is broken and authors cannot record a real zero');
  }
  delete e.zeroIsMeasured;
  e.equipped = realEquipped;

  var after = JSON.stringify(findViolations().filter(function (v) { return !mine(v); }));
  if (after !== baseline) {
    errs.push('the self-test changed violations on OTHER entries (' + baseline +
      ' → ' + after + ') — it is mutating shared state and the run is void');
  }
  if (findViolations().some(mine)) {
    errs.push('restoring ' + key + '.equipped to ' + realEquipped + ' left it in ' +
      'violation — the self-test did not clean up after itself');
  }
  return errs;
}

function run() {
  var broken = selfTest();
  if (broken.length) {
    console.error('Build FAILED — the measured-zero guard cannot be trusted:');
    broken.forEach(function (x) { console.error('  ' + x); });
    process.exit(1);
  }

  var v = findViolations();
  if (!v.length) {
    return { checked: Object.keys(A.WIFI_AIRLINES).length, violations: 0 };
  }

  console.error('Build FAILED — a count of 0 would publish as a measured zero:');
  v.forEach(function (x) {
    console.error('  ' + x.key + '.' + x.field + ' = 0 — ' + x.why);
  });
  console.error('');
  console.error('  A zero says somebody counted and found none. If that is what');
  console.error('  happened, add `zeroIsMeasured: true` to the entry with the');
  console.error('  source and date that support it. If nobody has published a');
  console.error('  count, do not write 0: move the aircraft to unresolved so the');
  console.error('  entry derives to unpublished and the page prints');
  console.error('  "count unpublished" instead. See the header of this file.');
  process.exit(1);
}

module.exports = { run: run, findViolations: findViolations, selfTest: selfTest };

if (require.main === module) {
  var r = run();
  console.log('measured-zero guard OK — ' + r.checked + ' airlines, ' +
    r.violations + ' bare zeros.');
}
