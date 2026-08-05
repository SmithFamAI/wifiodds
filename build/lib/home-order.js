'use strict';

/* Keep the approved visual order only as a tie-break seed. The displayed
 * values decide the primary order on every build. */
function rank(keys, scoreFor) {
  return keys.map(function (key, index) {
    var score = scoreFor(key);
    if (!score || !Number.isFinite(score.odds) || !Number.isFinite(score.connect)) {
      throw new Error('home-order: missing finite scores for ' + key);
    }
    return { key: key, index: index, odds: score.odds, connect: score.connect };
  }).sort(function (a, b) {
    return b.odds - a.odds || b.connect - a.connect || a.index - b.index;
  }).map(function (row) { return row.key; });
}

module.exports = { rank: rank };
