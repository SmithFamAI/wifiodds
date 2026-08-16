'use strict';
/* build/lib/render.js — one function per prerendered page. Each returns a
 * complete HTML document via H.page(). */

var H = require('./html.js');
var V = require('./viz.js');
var P = require('./pages.js');
var DL = require('./data.js');
var T = require('./tmpl.js');
/* the finish lines and the hardware primer behind /race/ and /systems/, plus the
   phase derivation the homepage teaser shares with them — see build/lib/market.js
   for why this is a build-only data set and not part of assets/airlines.js */
var MK = require('./market.js');
/* published reader field reports, off the committed assets/reports.json */
var RP = require('./reports.js');
var RELEASE = require('./release.js');
var ExtensionPage = require('./extension-page.js');
/* the static route tables /united/ shows when script is off */
var NJ = require('./nojsroutes.js');
var Demo = require('./demo-fixture.js');
var HomeOrder = require('./home-order.js');
var esc = H.esc, num = DL.num;
var ORIGIN = H.ORIGIN;

var DATASET_ID = ORIGIN + '/united/fleet/#dataset';

function datasetLd(m) {
  return {
    '@context': 'https://schema.org', '@type': 'Dataset', '@id': DATASET_ID,
    name: 'United Airlines Starlink rollout archive',
    description: 'Every United Airlines aircraft confirmed to carry Starlink, with the date each tail ' +
      'was first seen equipped: ' + m.fleet.equipped + ' of ' + m.fleet.total + ' aircraft across ' +
      m.archiveDays + ' distinct install days.',
    url: ORIGIN + '/united/fleet/',
    temporalCoverage: m.firstDay + '/' + m.updated,
    dateModified: m.updated,
    keywords: ['Starlink', 'United Airlines', 'inflight WiFi', 'fleet rollout', 'aircraft registry'],
    creator: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
    isBasedOn: { '@type': 'WebSite', name: 'unitedstarlinktracker.com', url: 'https://unitedstarlinktracker.com' },
    license: 'Personal and research use; credit unitedstarlinktracker.com (@martinamps) when quoting fleet numbers.',
    distribution: [{
      '@type': 'DataDownload',
      contentUrl: ORIGIN + '/united/data.json',
      encodingFormat: 'application/json'
    }]
  };
}
/* THE SITE'S IDENTITY, and until 28 Jul 2026 the homepage had none at all.
 * Organization and WebSite existed in this file only NESTED inside other types
 * (a Dataset's `creator`, an Article's `author`), never as top-level nodes, and
 * the V5 homepage does not go through H.page() so it emitted no ld+json
 * whatsoever — measured on production: zero `application/ld+json` blocks on the
 * one page that ranks and the one page an answer engine is most likely to cite.
 * The interior routes had five types; the homepage had none.
 *
 * `@id` on both so the nested references elsewhere in this file resolve to the
 * same node rather than declaring a second, parallel organisation.
 *
 * sameAs is the two real repositories and nothing else. There is no company
 * Twitter, no LinkedIn page and no Crunchbase entry, and listing a profile that
 * does not exist is the structured-data version of inventing a figure. */
function siteLd() {
  return [{
    '@context': 'https://schema.org', '@type': 'Organization',
    '@id': ORIGIN + '/#org',
    name: 'WiFi Odds', url: ORIGIN + '/',
    logo: ORIGIN + '/assets/og.png',
    description: 'An independent, unofficial index of inflight WiFi, focused on which aircraft ' +
      'carry next-generation low-earth-orbit systems.',
    sameAs: [H.REPO_SITE, H.REPO_EXT]
  }, {
    '@context': 'https://schema.org', '@type': 'WebSite',
    '@id': ORIGIN + '/#site',
    name: 'WiFi Odds', url: ORIGIN + '/',
    publisher: { '@id': ORIGIN + '/#org' },
    inLanguage: 'en'
  }];
}

function crumbLd(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(function (it, i) {
      return { '@type': 'ListItem', position: i + 1, name: it[1], item: ORIGIN + it[0] };
    })
  };
}

/* ═══ / (V5) ═══════════════════════════════════════════════════════════
 * build/templates/home.html is the Jeremy-approved V5 mockup
 * (~/wifiodds-exchange/design-competition/codex-redesign-v5.html), kept
 * byte-for-byte except four markers this function fills in:
 *
 *   <!--HOME:HEAD_EXTRA-->   the shared <head> essentials every other route
 *                            gets from H.page() — canonical link, favicon,
 *                            og/twitter tags, the theme-boot script — copied
 *                            from the exact same H.* strings, not retyped.
 *   <!--HOME:BIG4_CARDS-->   the four Big-4 <article class="aircard"> cards.
 *   <!--HOME:BOARD_ROWS-->   all 18 <a class="row"> board entries.
 *   <!--HOME:CWS_BADGE-->    Google's own cached Chrome Web Store badge,
 *                            replacing the mockup's embedded base64 PNG.
 *
 * THIS DOES NOT CALL H.page(). The template already carries its own <body
 * data-view="nextgen">, <nav>, <main> and <footer> — H.page() would duplicate
 * every one of them, nest <main>, and drop the server-rendered data-view
 * (see GOLIVE-PLAN.md, "AMENDED after Codex validation", blocker 1). Every
 * other route keeps calling H.page() unchanged.
 *
 * ONE HELPER PER AIRLINE (homeRow / homeCard below) emits the WHOLE element —
 * visible text AND every data-* attribute — from the same model value.
 * data-bake (build/lib/tmpl.js) only ever replaces inner text, never an
 * attribute (blocker 2): a helper that baked the percentage into the text but
 * left an old default on data-odds/data-floor would pass the build and then
 * display one figure, sort by a second and fill the heat ramp to a third.
 * There is no such helper here — homeRow/homeCard are the only place either
 * number is written, in both places at once.
 *
 * BRANCH ON `published`, NEVER ON THE SCORE. Air France and SAS carry a real
 * ConnectScore (they are not zero) but `nextGenPublished === false`: their
 * Starlink count has never been published, so nextGenScore's 0 is not a
 * measurement (see nextGenPublished() in assets/airlines.js). homeRow's very
 * first line branches on that flag, before touching a single number, and the
 * unpublished branch keeps Next-Gen as unpublished and out of that rank,
 * while Streaming still prints and ranks its published 0–100 score. The
 * separate coverage evidence remains visible in both cases.
 *
 * THE STREAMING FLOOR is a metric this codebase did not previously compute:
 * the share of the WHOLE fleet (unresolved tails IN the denominator since the
 * round-18 P0-02 fix, because this is a per-flight probability and any tail can
 * be the one you draw) sitting on a system whose quality meets or beats
 * STREAMING_MIN_Q (assets/airlines.js). A segment whose quality straddles that
 * threshold (an unpublished split inside one named system, e.g. Southwest's
 * Anuvu-or-Viasat bucket) cannot be counted either way, so it counts toward
 * neither the numerator nor a false certainty — it flips floorUncertain on
 * instead, same as a genuinely unresolved aircraft count. A floor of 100 now
 * requires unresolved to be 0, so there is genuinely no headroom for a
 * remainder and the uncertainty flag is forced off there (a bare 100%, never a
 * nonsensical "≥100%"): JSX/ZIPAIR show a plain 100%, while airBaltic, with 27
 * unresolved of 55, now shows ≥51% rather than a false fleetwide 100%. */

var FS = require('fs');
var PATH = require('path');
var CRYPTO = require('crypto');

/* The exact board order the approved mockup ships with. It also happens to be
 * non-increasing in today's nextGenScore, so it doubles as a valid initial
 * sort — the client script re-sorts on load regardless, and Array#sort's
 * required stability means ties (JSX/ZIPAIR, both 100/100 today; airBaltic is
 * 51 since the round-18 P0-02 fleet-denominator fix) keep this relative order
 * after the client re-sorts, never a random one. */
var HOME_BOARD_SEED_ORDER = [
  'jsx', 'zipair', 'hawaiian', 'westjet', 'airbaltic', 'qatar', 'alaska', 'virginatlantic',
  'united', 'emirates', 'aircanada', 'britishairways', 'jetblue', 'american',
  'delta', 'southwest'
];
var HOME_UNPUBLISHED_ORDER = ['airfrance', 'sas'];
var HOME_BIG4_ORDER = ['united', 'american', 'delta', 'southwest'];

/* Insertion into build/templates/home.html is raw and unescaped, so every
 * baked value has to clear this fence before it is allowed near the page:
 * finite, defined, never NaN. An airline whose model output cannot pass this
 * fails the BUILD, not the page. */
function homeNum(x, label) {
  if (typeof x !== 'number' || !isFinite(x)) {
    throw new Error('Render.home: ' + label + ' is not a finite number (got ' + x + ')');
  }
  return x;
}
function homeStr(x, label) {
  if (typeof x !== 'string' || !x) {
    throw new Error('Render.home: ' + label + ' is not a non-empty string (got ' + JSON.stringify(x) + ')');
  }
  return x;
}

/* V5's own percentage convention: one decimal below 1% ("0.1%", Southwest's
 * single confirmed aircraft), a bare integer otherwise. Distinct from
 * pages.js's pctText(), which prints "<1%" instead — this page already shipped
 * approved with the decimal, so that is the string this keeps. */
function homeFmtPct(raw) {
  if (raw > 0 && raw < 1) return raw.toFixed(1);
  return String(Math.round(raw));
}

/* The streaming-or-better floor and its uncertainty flag. See the header
 * comment above for the full rule; this is the one and only place it is
 * computed, so a row and a Big-4 card reading the same airline can never
 * disagree. */
function homeStreamingFloor(m, a) {
  var thresh = m.A.STREAMING_MIN_Q;
  var segs = a.segments || [];
  var known = a.known || 0;
  if (!segs.length || !known) {
    /* Non-segmented model (no ledger): floor, ceiling and score already
       coincide, so there is nothing to split and nothing uncertain. */
    return { pct: homeNum(a.floor, a.key + '.floor'), uncertain: false };
  }
  var certain = 0, ambiguous = false;
  segs.forEach(function (s) {
    if (s.qMin >= thresh) certain += s.n;
    else if (s.qMax >= thresh) ambiguous = true;
  });
  /* WHOLE-FLEET DENOMINATOR, same round-18 P0-02 fix as next-gen odds: the
     streaming floor is also a "chance of drawing an aircraft that streams"
     number, so unresolved tails belong in the denominator. Dividing by `known`
     let airBaltic (28 of 28 known on Starlink, 27 unresolved) print a bare 100%
     streaming floor with the uncertainty flag forced off — an unconditional
     fleet claim on a fleet that is 51% confirmed. Over the whole fleet it is
     28/55 = 51% with the flag ON. When unresolved is 0 this is unchanged. */
  var total = known + (a.unresolved || 0);
  var pct = (certain / total) * 100;
  var uncertain = ((a.unresolved || 0) > 0 || ambiguous) && pct < 100 - 1e-9;
  return { pct: pct, uncertain: uncertain };
}

/* The four proof-block buckets for the streaming view, and the floor that sits
 * beside them. Every one of these was a hard-coded literal until now.
 *
 * WHY THIS EXISTS. Round 18 P0-01 baked the proof block's NEXT-GEN figures from
 * the model and left the STREAMING ones as literals, which nobody noticed
 * because the two views never render together. By 1 Aug 2026 the literals said
 * "≥66%" and "a 66% floor across every airline tracked here" while the Big-4
 * card directly below printed United's real floor of ≥58%. Both numbers were on
 * one page. Only one had a source.
 *
 * The 66 was never an all-airline figure. It is United's streaming share over
 * the RESOLVED denominator (1,046/1,584), which is the denominator round 18
 * P0-02 removed as wrong: unresolved tails belong in the denominator, because
 * this is a "chance of drawing an aircraft that streams" number. Over the whole
 * fleet the same airline is 1,046/1,813 = 58%. The all-airline figure, had the
 * sentence meant what it said, is 31%.
 *
 * So the literal was stale under a superseded rule AND mis-scoped in prose. It
 * is computed here now, from the same segments and the same homeStreamingFloor()
 * the cards read, so the proof block cannot disagree with the card again. */
function homeProofBuckets(m) {
  var a = m.A.scoreAirline('united');
  if (!a) throw new Error('Render.home: scoreAirline("united") returned nothing for the proof block.');
  var thresh = m.A.STREAMING_MIN_Q;
  var segs = a.segments || [];
  if (!segs.length) throw new Error('Render.home: United has no segments, so the proof block cannot be sourced.');
  var b = { nextGen: 0, streaming: 0, legacy: 0, noWifi: 0 };
  segs.forEach(function (s) {
    if (s.nextGen) b.nextGen += s.n;
    else if (s.qMin >= thresh) b.streaming += s.n;
    else if (s.qMax > 0) b.legacy += s.n;
    else b.noWifi += s.n;
  });
  b.unresolved = a.unresolved || 0;
  b.total = homeNum(m.fleet.total, 'fleet.total');
  b.streamingScore = homeNum(a.score, 'united.score');

  /* ARITHMETIC GUARD. The four buckets partition the resolved fleet, so with the
     unresolved remainder they must reconstruct the published total exactly. If a
     new system tier appears and falls through the branches above, this fires
     rather than letting a tile quietly under-count. */
  var sum = b.nextGen + b.streaming + b.legacy + b.noWifi + b.unresolved;
  if (sum !== b.total) {
    throw new Error('Render.home: proof buckets do not reconstruct the fleet — ' +
      b.nextGen + ' next-gen + ' + b.streaming + ' streaming + ' + b.legacy + ' legacy + ' +
      b.noWifi + ' no-wifi + ' + b.unresolved + ' unresolved = ' + sum + ', but fleet.total is ' +
      b.total + '. A segment tier is unclassified, or the roster and the fleet count disagree.');
  }
  /* The next-gen bucket is the same number {{P_EQUIPPED}} prints two tiles away,
     from a different path (roster vs segments). They must agree. */
  var equipped = homeNum(m.fleet.equipped, 'fleet.equipped');
  if (b.nextGen !== equipped) {
    throw new Error('Render.home: the proof block\'s next-gen bucket is ' + b.nextGen +
      ' but fleet.equipped is ' + equipped + '. The segment table and the roster disagree.');
  }

  var sf = homeStreamingFloor(m, a);
  b.floorCertain = b.nextGen + b.streaming;
  b.floorStr = (sf.uncertain ? '≥' : '') + homeStr(homeFmtPct(sf.pct), 'proof.floor') + '%';
  return b;
}

/* STALE-VALUE GUARD, run on the RENDERED page rather than on the numbers that
 * produced it. The proof block and the United Big-4 card reach the streaming
 * floor by different paths — token substitution into the template, and
 * homeCard() building markup — so comparing the two inputs proves nothing. This
 * reads both strings back out of the finished HTML.
 *
 * This is the check that would have caught "≥66%" sitting above "≥58%" on the
 * day it shipped, and it is the check that fires if the template ever goes back
 * to a literal. */
function homeAssertProofFloor(out, pb, num) {
  var scoreStr = String(pb.streamingScore);
  var proof = /<div class="proof-num">[\s\S]*?<span class="streaming-only">([^<]*)<\/span>/.exec(out);
  if (!proof) throw new Error('Render.home: the proof block streaming figure was not found in the output.');

  /* The four tiles, read back out of the finished page. The floor check below
     cannot see these, and the arithmetic guard in homeProofBuckets() only checks
     the MODEL, so without this a hard-coded tile would pass every other check —
     which is exactly how 560/407/131 survived from round 18 to 1 Aug 2026. */
  var facts = /<div class="proof-facts">([\s\S]*?)<\/div>\s*<\/div>/.exec(out);
  if (!facts) throw new Error('Render.home: the proof-facts tile block was not found in the output.');
  var tiles = facts[1].match(/<span class="streaming-only">([^<]*)<\/span>/g) || [];
  var got = tiles.map(function (t) { return t.replace(/<[^>]*>/g, '').trim(); })
    .filter(function (t) { return /^[\d,]+$/.test(t); });
  var want = [num(pb.nextGen), num(pb.streaming), num(pb.legacy), num(pb.noWifi)];
  if (got.length !== want.length || got.join('|') !== want.join('|')) {
    throw new Error('Render.home: the proof tiles rendered [' + got.join(', ') +
      '] but the model says [' + want.join(', ') +
      ']. A tile is hard-coded in build/templates/home.html instead of tokenised.');
  }
  /* Anchor on United by name, not on card order: the Big-4 order is a constant
     someone may reasonably reorder, and a guard that silently starts comparing
     against American is worse than no guard. */
  var united = out.split('<article class="aircard"').filter(function (chunk) {
    return /<span class="airname">United<\/span>/.test(chunk);
  });
  if (united.length !== 1) {
    throw new Error('Render.home: expected exactly one United Big-4 card in the output, found ' +
      united.length + '.');
  }
  var card = /<strong[^>]*class="tier-value"[^>]*>([^<]*)</.exec(united[0]);
  if (!card) throw new Error('Render.home: the United card has no streaming figure in the output.');
  var cardStr = card[1].trim();
  if (proof[1].trim() !== scoreStr) {
    throw new Error('Render.home: the proof block rendered "' + proof[1].trim() +
      '" where the model says the Streaming score is "' + scoreStr +
      '". A literal is back in build/templates/home.html.');
  }
  if (proof[1].trim() !== cardStr) {
    throw new Error('Render.home: the proof block Streaming score "' + proof[1].trim() +
      '" disagrees with the first Big-4 card, which prints "' + cardStr + '".');
  }
}

function homeRowClass(oddsScore) {
  return oddsScore >= 60 ? 'good' : oddsScore >= 40 ? 'mixed' : 'long';
}

/* The odds-only <small> label. Plain, honest, three-way — never the bespoke
 * per-airline prose the mockup shipped as a placeholder, because reproducing
 * eighteen hand-tuned captions from the model without inventing a fact none
 * of them state was not achievable this pass; see the go-live report. */
function homeOddsLabel(a) {
  if (a.nextGenScore >= 99) return 'Next-gen fleet';
  if (a.nextGenScore > 0) return 'Mixed fleet';
  return 'No next-gen aircraft yet';
}
function homeFigureSources(a) {
  var seen = Object.create(null);
  var segments = a.segments || [];
  /* Each published figure uses a whole-fleet denominator. Sources for the
   * non-qualifying and unresolved rows therefore contribute to the result too;
   * a disclosure that named only positive rows would omit denominator evidence. */
  return segments.map(function (segment) { return segment.src; }).filter(function (source) {
    var key = source && source.trim().toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  }).join('; ') || 'airline records';
}
function homeFigureEvidence(m, a, kind, id) {
  var labels = {
    nextgen: 'Next-Gen odds · Modelled',
    streaming: 'Streaming score · Modelled',
    coverage: 'Confirmed streaming coverage · Reported'
  };
  return '<div class="figure-evidence" data-figure-evidence="' + kind + '" id="' + id + '"><span>' + labels[kind] + ' · checked ' +
    esc(a.asOf || 'date unavailable') + '</span><details class="figure-sources"><summary>Sources</summary>' +
    '<p class="figure-source-list">' + esc(homeFigureSources(a)) + '</p></details></div>';
}
function homeUnknownCoverageEvidence(m, a, id) {
  return '<div class="figure-evidence" data-figure-evidence="coverage" id="' + id + '"><span>' +
    'Confirmed streaming coverage · could not verify · checked ' + esc(a.asOf || 'date unavailable') +
    '</span><details class="figure-sources"><summary>Sources checked</summary><p class="figure-source-list">' +
    esc(homeFigureSources(a)) + '</p></details></div>';
}
/* The tier-only <small> label. Only prints a number when the uncertainty is a
 * real unresolved-aircraft count; a same-known-fleet ambiguous split (no
 * unresolved aircraft, just an unpublished system mix) gets the words with no
 * percentage, because there is no fleet-count fraction to attach one to. */
function homeTierNote(a, sf) {
  if (!sf.uncertain) return '';
  var total = (a.ledger && a.ledger.total) || ((a.known || 0) + (a.unresolved || 0));
  if ((a.unresolved || 0) > 0 && total > 0) {
    return homeFmtPct((a.unresolved / total) * 100) + '% remainder unknown';
  }
  return 'remainder unknown';
}
function homeSysLabel(a) {
  var segs = a.segments || [];
  if (segs.length === 1) return segs[0].systemLabel + ' fleetwide';
  return 'Mixed systems fleet';
}

function homeRow(m, key, rank) {
  var a = m.A.scoreAirline(key);
  if (!a) throw new Error('Render.home: unknown airline key "' + key + '"');
  var dataName = esc(a.name.toLowerCase() + ' ' + (a.code || '').toLowerCase());
  var score = homeNum(a.score, key + '.score');
  var exact = homeNum(a.scoreExact, key + '.scoreExact');
  var sf = homeStreamingFloor(m, a);
  var coverage = homeStr(homeFmtPct(sf.pct), key + '.coverage');
  var coverageExact = homeNum(a.coverage, key + '.coverageExact');
  var nextGenEvidenceId = 'row-' + key + '-nextgen-evidence';
  var streamingEvidenceId = 'row-' + key + '-streaming-evidence';
  var coverageEvidenceId = 'row-' + key + '-coverage-evidence';

  if (a.nextGenPublished === false) {
    return '        <div class="row unranked" data-key="' + key + '" data-name="' + dataName +
      '" data-rankable="false" data-streaming-score="' + score + '" data-streaming-exact="' + exact +
      '" data-odds="-1" data-streaming-coverage="-1" data-streaming-coverage-exact="-1" data-streaming-rank-coverage-exact="' + coverageExact + '">' +
      '<div class="who"><b><span class="rank-text">–</span> · ' + esc(a.name) + '</b> ' +
      '<small>Starlink count unpublished</small></div>' +
      '<div class="metric primary"><div class="odds-only"><b class="unknown">unpublished</b> <small>primary</small></div>' +
      '<div class="streaming-only" data-figure-block="streaming"><b data-streaming-view="primary" ' +
      'data-published-figure="streaming" aria-describedby="' + streamingEvidenceId + '">' + score + '</b> <small>primary</small>' +
      homeFigureEvidence(m, a, 'streaming', streamingEvidenceId) + '</div></div>' +
      '<div class="metric" data-figure-block="coverage"><b class="unknown" data-streaming-coverage="unknown">could not verify</b>' +
      homeUnknownCoverageEvidence(m, a, coverageEvidenceId) + '</div></div>\n';
  }

  var odds = homeNum(a.nextGenScore, key + '.nextGenScore');
  var rowClass = homeRowClass(odds);
  var tierNote = homeTierNote(a, sf);
  var smallHtml = tierNote
    ? '<small><span class="odds-only">' + esc(homeOddsLabel(a)) + '</span> ' +
      '<span class="streaming-only">' + esc(tierNote) + '</span></small>'
    : '<small>' + esc(homeSysLabel(a)) + '</small>';

  return '        <div class="row ' + rowClass + '" data-key="' + key + '" data-name="' + dataName +
    '" data-rankable="true" data-streaming-score="' + score + '" data-streaming-exact="' + exact + '" data-odds="' + odds +
    '" data-streaming-coverage="' + coverage + '" data-streaming-coverage-exact="' + coverageExact + '" data-streaming-rank-coverage-exact="' + coverageExact + '"><div class="who"><b><span class="rank-text">' +
    String(rank).padStart(2, '0') + '</span> · ' + esc(a.name) + '</b> ' + smallHtml + '</div>' +
    '<div class="metric primary"><div class="odds-only" data-figure-block="nextgen"><b data-published-figure="nextgen" ' +
    'aria-describedby="' + nextGenEvidenceId + '">' + odds + '%</b> <small>primary</small>' +
    homeFigureEvidence(m, a, 'nextgen', nextGenEvidenceId) + '</div>' +
    '<div class="streaming-only" data-figure-block="streaming"><b data-streaming-view="primary" ' +
    'data-published-figure="streaming" aria-describedby="' + streamingEvidenceId + '">' + score + '</b> <small>primary</small>' +
    homeFigureEvidence(m, a, 'streaming', streamingEvidenceId) + '</div></div>' +
    '<div class="metric" data-figure-block="coverage"><b data-streaming-coverage="confirmed" data-published-figure="coverage" ' +
    'aria-describedby="' + coverageEvidenceId + '">' + coverage + '%</b>' +
    homeFigureEvidence(m, a, 'coverage', coverageEvidenceId) + '</div></div>\n';
}

function homeBoardRows(m) {
  var order = HomeOrder.rank(HOME_BOARD_SEED_ORDER, function (key) {
    var a = m.A.scoreAirline(key);
    return a && { odds: a.nextGenScore, connect: a.score };
  });
  var ranked = order.map(function (k, i) { return homeRow(m, k, i + 1); }).join('');
  var unranked = HOME_UNPUBLISHED_ORDER.map(function (k) { return homeRow(m, k, 0); }).join('');
  return ranked +
    '        <div class="unpublished-break"><b>Count unpublished · not ranked as zero</b> ' +
    '<span>Airlines without published counts</span></div>\n' + unranked;
}

function homeCard(m, key) {
  var a = m.A.scoreAirline(key);
  if (!a) throw new Error('Render.home: unknown Big 4 airline key "' + key + '"');
  var odds = homeNum(a.nextGenScore, key + '.nextGenScore');
  var score = homeNum(a.score, key + '.score');
  var sf = homeStreamingFloor(m, a);
  var streamStr = homeStr(homeFmtPct(sf.pct), key + '.streamStr');
  var ngCount = (a.segments || []).reduce(function (s, r) { return s + (r.nextGen ? r.n : 0); }, 0);
  var total = a.total || 0;
  var note = num(ngCount) + ' of ' + num(total) + ' aircraft next-gen today';
  var sup = key === 'united' ? '<sup>*</sup>' : '';
  var nextGenEvidenceId = 'card-' + key + '-nextgen-evidence';
  var streamingEvidenceId = 'card-' + key + '-streaming-evidence';
  var coverageEvidenceId = 'card-' + key + '-coverage-evidence';

  return '        <article class="aircard" data-nextgen="' + odds + '" data-streaming-score="' + score + '" data-streaming-exact="' +
    homeNum(a.scoreExact, key + '.scoreExact') + '" data-streaming-coverage="' + streamStr +
    '"><div class="airtop"><span class="airname">' + esc(a.name) + '</span> <span class="code">' +
    esc(a.code || '') + '</span></div>' +
    '<div class="primary-figure odds-only" data-figure-block="nextgen"><div class="primary-stat"><strong ' +
    'data-published-figure="nextgen" aria-describedby="' + nextGenEvidenceId + '">' + odds + '%' + sup + '</strong>' +
    '<span>airline<br>next-gen odds</span></div>' + homeFigureEvidence(m, a, 'nextgen', nextGenEvidenceId) + '</div>' +
    '<div class="primary-figure streaming-only" data-figure-block="streaming"><div class="primary-stat"><strong class="tier-value" ' +
    'data-streaming-view="primary" data-published-figure="streaming" aria-describedby="' + streamingEvidenceId + '">' + score + sup +
    '</strong> <span>Streaming<br>score</span></div>' + homeFigureEvidence(m, a, 'streaming', streamingEvidenceId) + '</div>' +
    '<div class="band"><i></i></div>' +
    '<div class="support" data-figure-block="coverage"><div class="support-copy"><span>Confirmed streaming coverage</span>' +
    homeFigureEvidence(m, a, 'coverage', coverageEvidenceId) + '</div> <b data-streaming-coverage="confirmed" ' +
    'data-published-figure="coverage" aria-describedby="' + coverageEvidenceId + '">' + streamStr + '%</b></div>' +
    '<p class="airnote odds-only" aria-describedby="' + nextGenEvidenceId + '">' + esc(note) + '</p></article>\n';
}

function homeBig4Cards(m) {
  return HOME_BIG4_ORDER.map(function (k) { return homeCard(m, k); }).join('');
}

/* The shared <head> essentials, copied from the exact strings H.page() emits
 * for every other route (canonical, og/twitter, favicon, theme-boot), not
 * retyped — see H.THEME_BOOT / H.FAVICON / H.assetHash, exported from
 * html.js for exactly this caller. Title/description are new copy: the old
 * home()'s title was 'WiFi Odds · every airline's inflight WiFi, scored',
 * which the go-live checklist explicitly retires. */
function homeHeadExtra(m) {
  var title = 'WiFi Odds · your odds of next-gen WiFi';
  var desc = 'Your odds of a next-gen Starlink or Amazon Leo aircraft, next to what each fleet ' +
    'delivers today, across all ' + m.airlineCount + ' tracked airlines. Free, unofficial.';
  var url = ORIGIN + '/';
  var ogImg = ORIGIN + '/assets/og.png?v=' + H.assetHash('assets/og.png');
  return H.THEME_BOOT + '\n' +
    '<link rel="icon" href="' + H.FAVICON + '">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="WiFi Odds">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:image" content="' + ogImg + '">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:image:alt" content="WiFi Odds · what are your odds of next-gen WiFi? Starlink and Amazon Leo odds across 18 airlines.">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + esc(title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<meta name="twitter:image" content="' + ogImg + '">\n' +
    /* The homepage's structured data, added 28 Jul 2026. It had none. */
    siteLd().map(H.ld).join('\n') + '\n';
}

/* Google's own badge art, cached under assets/cws/. The branding rules are:
 * resize only, preserve the 496:150 ratio, never redraw, always link to the
 * listing, and never make the badge the largest thing on screen. This page is
 * permanently dark (fixed --bg:#050505, no
 * theme switch of its own), so it always wants the bordered art meant for a
 * dark ground, never the plain one. Kept in the template's OWN .badge-link /
 * .badge-meta markup and CSS rather than pages.js's cwswrap/cwsbadge classes,
 * which belong to a stylesheet (site.css) this page does not load. */
function homeCwsBadge() {
  return '<a class="badge-link" href="' + H.EXT + '" target="_blank" rel="noopener">' +
    '<img alt="Available in the Chrome Web Store" width="496" height="150" ' +
    'src="/assets/cws/badge-border-large.png"></a>';
}

function releaseDate(iso) {
  var p = iso.split('-');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return String(Number(p[2])) + ' ' + months[Number(p[1]) - 1] + ' ' + p[0];
}

function assertReleaseTemplateSource(tpl, label) {
  var forbidden = [RELEASE.version, RELEASE.storePublishedOn, releaseDate(RELEASE.storePublishedOn)];
  forbidden.forEach(function (literal) {
    if (tpl.indexOf(literal) !== -1) {
      throw new Error('Render.' + label + ': build/templates source hard-codes release literal "' +
        literal + '". Render release version and store date from build/extension-release.json.');
    }
  });
}

function homeReleaseMeta() {
  return '<p class="badge-meta">v' + esc(RELEASE.version) + ' · free · cleared review ' +
    esc(releaseDate(RELEASE.storePublishedOn)) + '</p>';
}

function homeReleaseWhatsNew() {
  return '<aside class="whatsnew-ticker" aria-label="What’s new in WiFi Odds version ' +
    esc(RELEASE.version) + '"><b>What’s New · v' + esc(RELEASE.version) + ' · ' +
    esc(releaseDate(RELEASE.storePublishedOn)) + '</b> ' +
    '<span>Best WiFi choice now explains when no flight wins. You can undo automatic sorting, ' +
    'and Trip Guardian keeps unconfirmed aircraft marked as unknown.</span> ' +
    '<a class="whatsnew-readmore" href="/extension/#whats-new">Read More</a></aside>';
}

function home(m) {
  var tplPath = PATH.join(__dirname, '..', 'templates', 'home.html');
  var tpl = FS.readFileSync(tplPath, 'utf8');
  assertReleaseTemplateSource(tpl, 'home');

  /* SOURCE-LEVEL TOKEN GUARD for the proof block.
   *
   * The rendered-output guards below compare values, so they only fire when a
   * hard-coded figure is WRONG. A figure re-typed as the literal it happens to
   * equal today passes every value check and then goes stale silently on the
   * next daily refresh. That is not hypothetical: 560, 407 and 131 were correct
   * counts the whole time, and the defect was that nothing would have updated
   * them. So the template is required to still be asking for the token.
   *
   * ROUND 6, auditor, 1 Aug 2026: the first version of this guard asked only
   * whether tpl.indexOf('{{P_X}}') found anything, which proves the token exists
   * SOMEWHERE in the file and nothing else. The auditor severed a visible field
   * from its token — rendered {{P_STREAMING}} replaced by today's correct 560,
   * with {{P_STREAMING}} parked in a detached comment elsewhere inside #proof —
   * and the whole gate still exited 0. Same for {{P_STREAMFLOOR}}. Reproduced
   * here before fixing: bare `ship.sh --check-only` exit 0 on both. Presence is
   * not binding, so this now checks two stronger things.
   *
   * 1. Comments are stripped before anything is examined, and a proof token
   *    found inside a comment is itself the error, named as such. A token in a
   *    comment renders nothing, so the only thing it can do is satisfy a
   *    presence check on behalf of a field that no longer asks for it.
   * 2. Each field is associated with the markup that renders IT. The token has
   *    to be the content of its own element, not merely somewhere in the file.
   *    These fragments are deliberately brittle: restyling the proof block
   *    should require saying so here, because that is the moment the binding
   *    could be dropped by accident. */
  var PROOF_FIELD_BINDING = {
    P_STREAMFLOOR: '<span class="streaming-only">{{P_STREAMFLOOR}}</span></div>',
    P_STREAMING: '<span class="streaming-only">{{P_STREAMING}}</span></b>',
    P_LEGACY: '<span class="streaming-only">{{P_LEGACY}}</span></b>',
    P_NOWIFI: '<span class="streaming-only">{{P_NOWIFI}}</span></b>'
  };
  var tplNoComments = tpl.replace(/<!--[\s\S]*?-->/g, '');
  var parkedTokens = (tpl.match(/<!--[\s\S]*?-->/g) || []).join('\n').match(/\{\{P_[A-Z0-9_]+\}\}/g);
  if (parkedTokens) {
    throw new Error('Render.home: proof token(s) ' + parkedTokens.join(', ') + ' sit inside an HTML ' +
      'comment in build/templates/home.html. A commented token renders nothing, so it cannot be ' +
      'the field; the only work it can do is satisfy a presence check while the visible figure is ' +
      'a hard-coded literal.');
  }
  Object.keys(PROOF_FIELD_BINDING).forEach(function (k) {
    var frag = PROOF_FIELD_BINDING[k];
    if (tplNoComments.indexOf(frag) === -1) {
      throw new Error('Render.home: the proof field that renders {{' + k + '}} is no longer bound ' +
        'to it. build/templates/home.html must contain, outside any comment, exactly:\n  ' + frag +
        '\nA figure re-typed as the literal it happens to equal today passes every value check on ' +
        'the day it is written and goes stale the next morning.');
    }
    var seen = tplNoComments.split('{{' + k + '}}').length - 1;
    if (seen !== 1) {
      throw new Error('Render.home: {{' + k + '}} occurs ' + seen + ' times outside comments in ' +
        'build/templates/home.html; exactly one visible binding is expected. A second copy makes ' +
        'the binding check ambiguous about which field it cleared.');
    }
  });

  /* Rule 5's fence, enforced twice: here at render time (fails the build the
     moment a key drifts) and again in build/apitest.js against the finished
     document (fails the build if the template's own row markup ever stops
     matching what this function generated). Both directions: a model key with
     no row here is exactly as wrong as a row for a key the model no longer has. */
  var modelKeys = Object.keys(m.A.WIFI_AIRLINES).slice().sort();
  var tmplKeys = HOME_BOARD_SEED_ORDER.concat(HOME_UNPUBLISHED_ORDER).slice().sort();
  if (modelKeys.length !== tmplKeys.length || modelKeys.join(',') !== tmplKeys.join(',')) {
    throw new Error('Render.home: airline key parity broken.\n  model:    [' + modelKeys.join(', ') +
      ']\n  template: [' + tmplKeys.join(', ') + ']');
  }

  var out = tpl
    .replace('<!--HOME:HEAD_EXTRA-->', homeHeadExtra(m))
    .replace('<!--HOME:BIG4_CARDS-->', homeBig4Cards(m))
    .replace('<!--HOME:BOARD_ROWS-->', homeBoardRows(m))
    .replace('<!--HOME:WHATSNEW-->', homeReleaseWhatsNew())
    .replace('<!--HOME:CWS_BADGE-->', homeCwsBadge())
    .replace('<!--HOME:RELEASE_META-->', homeReleaseMeta())
    /* round 18 P1-02: swap the homepage's own inline masthead for the one
       unified disclosure component every survivor page shares. A function
       replacement, so the SVG mark and CTA URL inside it are never scanned as
       String#replace substitution patterns. */
    .replace(/<header class="sitebar">[\s\S]*?<\/header>/, function () { return H.mastheadV2('/'); });
  if (/<header class="sitebar">\s*\n?<div class="wrap">\s*\n?\s*<nav class="nav"/.test(out)) {
    throw new Error('Render.home: the inline masthead was not replaced by the unified component.');
  }

  /* round 18 P0-01: the proof block + united-callout figures were hard-coded
     literals in the approved mockup, so the daily refresh updated the baked Big-4
     card and left "484 of 1,807 · checked 28 Jul" frozen — a false headline the
     morning after any data change, which is exactly what shipped. They are baked
     from the model now, the same source as every other number on the page. */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var dparts = String(m.updated || '').split('-');
  if (dparts.length !== 3) throw new Error('Render.home: bad m.updated date "' + m.updated + '"');
  var pb = homeProofBuckets(m);
  var proofFig = {
    P_DATE: String(Number(dparts[2])) + ' ' + MON[Number(dparts[1]) - 1] + ' ' + dparts[0],
    P_EQUIPPED: num(homeNum(m.fleet.equipped, 'fleet.equipped')),
    P_TOTAL: num(homeNum(m.fleet.total, 'fleet.total')),
    P_INSTALLDAYS: num(homeNum(m.archiveDays, 'archiveDays')),
    P_MAINLINE: num(homeNum(m.fleet.mainline.equipped, 'fleet.mainline.equipped')),
    P_REGIONAL: num(homeNum(m.fleet.express.equipped, 'fleet.express.equipped')),
    P_LAST30: num(homeNum(m.fleet.last30, 'fleet.last30')),
    P_PACE: String(homeNum(m.fleet.mainlinePacePerWeek, 'fleet.mainlinePacePerWeek')),
    /* The streaming view's four tiles and its floor. Literals until 1 Aug 2026;
       see homeProofBuckets() for what they were saying wrong. */
    P_STREAMFLOOR: String(m.A.scoreAirline('united').score),
    P_STREAMCERTAIN: num(pb.floorCertain),
    P_STREAMING: num(pb.streaming),
    P_LEGACY: num(pb.legacy),
    P_NOWIFI: num(pb.noWifi)
  };
  Object.keys(proofFig).forEach(function (k) { out = out.split('{{' + k + '}}').join(proofFig[k]); });
  if (/\{\{P_[A-Z0-9]+\}\}/.test(out)) {
    throw new Error('Render.home: an unbaked {{P_...}} proof token remains — a figure was tokenised ' +
      'in build/templates/home.html without a matching entry in proofFig.');
  }
  homeAssertProofFloor(out, pb, num);

  if (out.indexOf('<!--HOME:') !== -1) {
    throw new Error('Render.home: an unbaked HOME: marker remains in the output — a new marker was ' +
      'added to build/templates/home.html without a matching .replace() here.');
  }
  return out;
}

function recordPage(m) {
  var crumbs = [['/', 'Home'], ['/record/', 'The written record']];
  var body =
    '<header class="hero">\n' +
    '  <span class="kicker">The record view</span>\n' +
    '  <h1>The working, shown</h1>\n' +
    '  <p class="lede">The homepage draws its numbers; this page is where they show their working. ' +
    'Nothing was cut to make the board visual. It moved here, and it is the same build, from the ' +
    'same data, dated ' + esc(H.chipDate(m.updated)) + '.</p>\n' +
    '</header>\n\n' +
    '<section class="blk" id="ladder">\n' +
    '  <span class="kicker">How sure we are</span>\n' +
    '  <div class="sec-h"><h2>The confidence ladder, and the fourth number</h2>' +
    '<a class="more" href="/methodology/">the full method →</a></div>\n' +
    '  <p class="sec-lede">A 27 read off a tail record and a 27 read off a press release are ' +
    'different claims about the world. Four tiers keep them apart, every answer names its tier, and ' +
    'the forward-looking number lives behind a fence of its own.</p>\n' +
    P.ladderCards(m) +
    P.fenceBlock(m) +
    '  <p class="footnote" style="margin-top:1.2rem">Three limits hold everywhere. Tail swaps ' +
    'happen up to pushback, which is why the T-48h re-check is in every playbook. This site tracks ' +
    'aircraft, never seats. And nobody has load-tested a full cabin, so every crowding claim, from ' +
    'anyone, is inference — I think that is the largest open question in the subject.</p>\n' +
    '  <p class="prov"><b>Measured</b> · the load-test gap holds across Jang et al., ACM IMC ’25, ' +
    'Oct 2025 · Ullah et al., arXiv:2508.09839, Aug 2025 · Ookla Speedtest Intelligence, ' +
    '28 Apr 2026</p>\n' +
    '</section>\n\n' +
    '<section class="blk" id="loop">\n' +
    '  <span class="kicker">The loop</span>\n' +
    '  <h2>What the record cannot see, you can</h2>\n' +
    '  <p class="sec-lede">Fleet records stop at the cabin door. Whether the login worked, what a ' +
    'video call survived, which badge was wrong: the person in the seat is the only instrument on ' +
    'board, and this site runs no analytics to guess with. Five channels carry observations back, ' +
    'and none of them asks for your email.</p>\n' +
    P.loopSection() +
    '</section>\n';

  return H.page({
    title: 'WiFi Odds · the written record',
    desc: 'The confidence ladder, the projection fence and the observation channels behind the ' +
      'WiFi Odds board, in full.',
    canonical: '/record/', here: '/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs,
    body: body,
    jsonld: [crumbLd(crumbs)]
  });
}

/* ═══ /airlines/ ════════════════════════════════════════════════════════
 * The leaderboard is the page an answer engine lands on for "which airline has
 * the best wifi", and it declared only an ItemList — a ranked list of URLs with
 * no answers in it. The FAQ below fixes that, and it follows the same rule as the
 * airline pages: every Q/A is VISIBLE on the page and the JSON-LD is built from
 * the same array. No hidden markup, and nothing typed twice. */
function airlinesIndex(m) {
  var top3 = m.ranked.slice(0, 3);
  var starlinks = m.ranked.filter(function (a) { return a.system === 'starlink'; });
  var frees = m.ranked.filter(function (a) { return (m.A.WIFI_AIRLINES[a.key].free || '') === 'free'; });
  var ua = m.A.scoreAirline('united');
  var faqs = [
    ['Which airline has the best inflight WiFi right now?',
      top3.map(function (a, i) {
        return (i === 0 ? '' : i === top3.length - 1 ? ' then ' : ', then ') + a.name +
          ' (ConnectScore ' + a.score + '/100, ' + P.bandWord(a.score) + ')';
      }).join('') + ', as of ' + m.updated + '. ConnectScore is the chance of getting the good, ' +
      'modern system on a random flight, multiplied by whether it is free once you are onboard, so ' +
      'a small all-Starlink fleet can outrank a giant airline that is only part way through its rollout.'],
    ['Which airlines have Starlink WiFi?',
      starlinks.length + ' of the ' + m.airlineCount + ' airlines here fly Starlink on at least part of ' +
      'the fleet: ' + starlinks.map(function (a) {
        return a.name + ' (' + P.eqPhrase(a) + ')';
      }).join(', ') + '. Fleet share is what matters. Being on the list is not the same as being ' +
      'likely on your flight.'],
    ['Which airlines give inflight WiFi away free?',
      'Free for everyone onboard, no loyalty program and no purchase: ' +
      frees.map(function (a) { return a.name; }).join(', ') + '. Others are free only for members ' +
      'or only on some cabins, and that scores lower: ConnectScore multiplies the fleet share by a ' +
      'free-for-you factor instead of treating a paywalled system as the same product.'],
    ['How is ConnectScore calculated?',
      m.A.SCORE_METHOD_LINE + ' Worked example. United flies five systems, so it gets five rows: ' +
      ua.segments.map(function (r) {
        return r.systemLabel + ' ' + num(r.n) + ' aircraft at ' + r.pointsMin.toFixed(1) + ' points';
      }).join(', ') + '. Added up that is ConnectScore ' + ua.score + ', and the ' +
      ua.segments[0].systemLabel + ' row on its own is the next-gen number, ' + ua.nextGenScore +
      '. The full method, the three confidence tiers and the things it cannot see are on the ' +
      'methodology page.'],
    ['Can you tell me whether my specific flight will have Starlink?',
      'For United, yes: we hold a per-flight history and can give the odds for that flight number. ' +
      'For Alaska the tails are verified but there is no per-flight feed, so the best we can do is the ' +
      'sub-fleet. For every other airline all we have is the fleet-wide score, and we say so rather ' +
      'than inventing a number for one flight.']
  ];

  var body =
    /* THE INDEX, AND ITS VIRTUE IS BEING FAST TO LEAVE. Two sentences saying
       what the ranking is and what it is not, the table, the band legend as a
       footnote, provenance at the bottom. No answer card and no worked example:
       the row links do that work, one page down. */
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker">The board</span>\n' +
    '  <h1 class="ph">All ' + m.airlineCount + ' airlines, ranked</h1>\n' +
    '  <p class="lede">This is the chance of drawing good WiFi on a flight that has not been ' +
    'assigned an aircraft yet, sorted on what is flying today. It is not a review, and it is not a ' +
    'promise about your seat: a fleet halfway through a retrofit scores exactly halfway, so on the ' +
    'twelve carriers in the middle of one, your own departure is the question and the airline is ' +
    'only the first half of it.</p>\n' +
    '</header>\n\n' +
    P.bigFourBoard(m) +
    P.fullRankedBoard(m) +
    '<section class="blk">\n' +
    '  <p class="footnote">' + m.airlineCount + ' airlines, scores recomputed on every build, ' +
    'data eff ' + esc(H.chipDate(m.updated)) + '. ' + P.BAND_LEGEND + ' ' +
    esc(m.A.SCORE_METHOD_LINE) + ' ' + esc(m.A.SCORE_CAVEAT) +
    ' <a href="/methodology/">How much to trust each number, and the four confidence tiers →</a></p>\n' +
    '</section>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>Airline WiFi questions</h2>' +
    '<a class="more" href="/methodology/">methodology →</a></div>\n' +
    '  <div class="faq">' + faqs.map(function (f) {
      return '<div class="q rv"><h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p></div>';
    }).join('') + '</div>\n</section>\n\n' + P.srcLine('reported', 'Fleet and per-tail verification for United, Alaska and Hawaiian: unitedstarlinktracker.com and alaskastarlinktracker.com (@martinamps), ' + esc(H.plateDate(m.updated)) + '. Every other airline from public airline announcements, Jul 2026. <a href="/methodology/#credit">Full credit and citation →</a>');

  return H.page({
    title: 'Airline WiFi leaderboard — ' + m.airlineCount + ' ConnectScores',
    desc: 'Which airline has the best WiFi right now — Starlink, Amazon Leo and Viasat fleets compared ' +
      'in one sortable score. Free, unofficial, no tracking.',
    canonical: '/airlines/', here: '/airlines/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained,
    crumb: [['/', 'Home'], ['/airlines/', 'Airlines']],
    body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Airline inflight WiFi ConnectScore leaderboard',
      numberOfItems: m.ranked.length,
      itemListElement: m.ranked.map(function (a, i) {
        return {
          '@type': 'ListItem', position: i + 1, name: a.name + ' — ConnectScore ' + a.score,
          url: ORIGIN + '/airlines/' + a.key + '/'
        };
      })
    }, {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(function (f) {
        return {
          '@type': 'Question', name: f[0],
          acceptedAnswer: { '@type': 'Answer', text: f[1] }
        };
      })
    }, crumbLd([['/', 'Home'], ['/airlines/', 'Airlines']])]
  });
}

/* ── the ConnectScore ledger, the page that shows its working ─────────────
 * One row per fleet segment, and the rows add up to the published score. The
 * next-gen row is sorted to the top and labelled, because next-gen odds ARE that
 * row — the relationship is something a reader can see here instead of a second
 * number they have to take on trust.
 *
 * Where a segment names more than one possible system and the airline publishes
 * no split, the row shows both bounds and says which document would settle it.
 * build/prerender.js fails the build if these rows do not sum to the score. */
function ledgerTable(m, a) {
  if (!a.ledger) return '';
  var L = a.ledger;
  var rows = L.rows.slice().sort(function (x, y) {
    return (y.nextGen ? 1 : 0) - (x.nextGen ? 1 : 0) || y.share - x.share;
  });
  var body = rows.map(function (r) {
    var q = r.qMin === r.qMax ? r.qMin.toFixed(2) : r.qMin.toFixed(2) + ' to ' + r.qMax.toFixed(2);
    var pts = r.qMin === r.qMax ? r.pointsMin.toFixed(1)
      : r.pointsMin.toFixed(1) + ' to ' + r.pointsMax.toFixed(1);
    return '      <tr' + (r.nextGen ? ' class="instr"' : '') + '>' +
      '<td><span class="sysdot ' + P.sysClass(r.systems[0]) + '"></span><b>' + esc(r.systemLabel) +
      '</b>' + (r.nextGen ? ' <span class="badge">next-gen row</span>' : '') +
      (r.assumed ? ' <span class="badge">inferred</span>' : '') +
      (r.note ? '<div class="note" style="margin-top:3px">' + esc(r.note) + '</div>' : '') +
      /* Every row carries its own provenance chip and date. A ledger row without
         one is an assertion, and showing the working is this table's whole job. */
      P.srcLine('reported', esc(r.src) + ' · ' + esc(r.as)) + '</td>' +
      '<td class="num">' + num(r.n) + '</td>' +
      '<td class="num">' + (r.share * 100).toFixed(1) + '%</td>' +
      '<td style="width:16%;min-width:90px">' + P.tape(r.share * 100) + '</td>' +
      '<td class="num">' + q + '</td>' +
      '<td class="num">' + r.freeFactor.toFixed(2) + '</td>' +
      '<td class="num"><b>' + pts + '</b></td></tr>';
  }).join('\n');

  var unres = L.unresolved
    ? '      <tr><td><b>Not published</b>' +
      '<div class="note" style="margin-top:3px">' + esc(L.unresolvedWhy || '') + '</div></td>' +
      '<td class="num">' + num(L.unresolved) + '</td>' +
      '<td class="num"><span class="micro">out</span></td><td></td>' +
      '<td class="num"><span class="micro">out</span></td>' +
      '<td class="num"><span class="micro">out</span></td>' +
      '<td class="num"><span class="micro">excluded</span></td></tr>\n'
    : '';

  var splits = rows.filter(function (r) { return r.split; });

  return '<section class="blk" id="ledger">\n  <div class="sec-h">' +
    '<span class="sub">The ledger · ' + esc(a.resolutionLabel) + '</span>' +
    '<h2>How the ' + a.score + ' is built</h2></div>\n' +
    '  <p class="sec-lede">Every aircraft ' + esc(a.name) + ' flies, by system, priced. The rows ' +
    'add up to the published ConnectScore, and the top row on its own is the next-gen number. The ' +
    'build fails if they stop adding up.</p>\n' +
    '<div class="tbl-shell rv"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Segment</th><th scope="col" class="num">Aircraft</th><th scope="col" class="num">Share</th>' +
    '<th scope="col">Share of the fleet</th>' +
    '<th scope="col" class="num">Quality</th><th scope="col" class="num">Free</th><th scope="col" class="num">Points</th></tr></thead>\n' +
    '    <tbody>\n' + body + '\n' + unres +
    '    </tbody>\n    <tfoot><tr><td><b>ConnectScore</b>' +
    (a.hasRange ? '<div class="note" style="margin-top:3px">We publish the floor. The ceiling is ' +
      a.ceiling + ', and the gap is the part of the fleet whose split nobody has published.</div>' : '') +
    '</td><td class="num">' + num(L.known) + '</td><td class="num">100%</td>' +
    '<td></td><td></td><td></td><td class="num"><b>' +
    (a.hasRange ? a.floor + ' to ' + a.ceiling : a.floor) + '</b></td></tr>' +
    /* `nextGenPublished === false` is the Air France and SAS shape: a segmented
       fleet with unresolved aircraft whose primary system names no segment. The
       leaderboard, the API and the cards all print "count unpublished" for it.
       This row did not, and printed "0.0%" and "0" instead, two rows under a
       line that said the count was not published. An external audit found it on
       27 Jul 2026, on the live site, on both airlines.
    
       That is the SAS class the whole `equippedPublished`/`nextGenPublished`
       mechanism exists to prevent, and it survived because
       build/assert-measured-zero.js checks the shape of a DATA ENTRY and this is
       a RENDERED claim. The guard was looking one layer below the defect.
       build/apitest.js now asserts the invariant on the built bytes: if the API
       says published is false, no page may print a number for it. */
    (a.nextGenPublished === false
      ? '<tr><td>Next-gen odds, the top row on its own</td><td></td>' +
        '<td class="num"><span class="empty-state cell">count unpublished</span></td>' +
        /* `.dash` with a middle dot, not an em dash: that is the idiom the
           projected column already uses for "there is nothing to show here",
           and the prose ratchet counts an em dash as pivot punctuation even
           inside a table cell, which is the right call for a linter that
           cannot tell a cell from a sentence. */
        '<td></td><td></td><td></td><td class="num">' +
        '<span class="dash" title="' + esc(a.name + ' has not published an aircraft count') +
        '">·</span></td></tr></tfoot>\n'
      : '<tr><td>Next-gen odds, the top row on its own</td><td></td><td class="num">' +
        (a.nextGenShare * 100).toFixed(1) + '%</td><td></td><td></td><td></td>' +
        '<td class="num"><b>' + a.nextGenScore + '</b></td></tr></tfoot>\n') +
    '  </table></div>\n' +
    '  <p class="tblcap">' + num(L.known) + ' aircraft with a published system' +
    (L.unresolved ? ', plus ' + num(L.unresolved) + ' left out of the denominator instead of ' +
      'assumed into it, for ' + num(L.total) + ' in total' : '') + '. ' +
    esc(m.A.RESOLUTION_BLURB[a.resolution] || '') +
    /* Add the rows on this page and you get 48.09, not 48, because each row is
       shown to one decimal. Print the unrounded sum instead of leaving a reader
       to conclude the ledger does not add up. */
    ' Points are shown to one decimal place; the unrounded rows sum to ' +
    L.sumFloor.toFixed(2) + ', which rounds to the published ' + a.floor + '.</p>\n' +
    (splits.length
      ? '  <p class="tblcap">Unpublished splits: ' + splits.map(function (r) {
        return esc(r.systemLabel) + ' (' + num(r.n) + ' aircraft). ' + esc(r.src) +
          ' would settle it.';
      }).join(' ') + '</p>\n'
      : '') +
    '</section>\n\n';
}

/* ═══ /airlines/{key}/ ══════════════════════════════════════════════════ */
function airlinePage(m, key) {
  var e = m.A.WIFI_AIRLINES[key];
  var a = m.A.scoreAirline(key);
  /* a.equippedPublished === false is the SAS shape: a segmented entry with
     unresolved aircraft and no segment naming the primary system, so there is
     no real equipped count to turn into a percentage — see
     equippedPublished() in assets/airlines.js. pct stays null rather than 0
     so nothing downstream on this page can round null*100 into a false "0%". */
  var pct = a.equippedPublished === false ? null : Math.round(a.parts.pctEquipped * 100);
  var crumbs = [['/', 'Home'], ['/airlines/', 'Airlines'], ['/airlines/' + key + '/', a.name]];
  var fleetLine = !a.fleet ? 'fleetwide coverage'
    : a.equippedPublished === false ? num(a.fleet) + ' aircraft, count unpublished'
      : num(a.equipped) + ' of ' + num(a.fleet) + ' aircraft';
  var toolHref = key === 'united' ? '/united/' : key === 'alaska' ? '/alaska/' : null;
  var reports = RP.forKey(m.reports, key);

  /* FAQ — visible on the page AND in FAQPage JSON-LD. No hidden-markup games. */
  var faqs = [
    ['Does ' + a.name + ' have ' + a.systemLabel + ' WiFi?',
      (!a.fleet
        ? a.name + ' offers ' + a.systemLabel + ' fleetwide as of ' + esc(a.asOf || m.updated) + '.'
        : a.equippedPublished === false
          ? a.name + ' has launched ' + a.systemLabel + ', but has not published how many of its ' +
            num(a.fleet) + ' aircraft carry it as of ' + esc(a.asOf || m.updated) + '.'
          : a.name + ' has ' + a.systemLabel + ' on ' + num(a.equipped) + ' of its ' + num(a.fleet) +
            ' aircraft (' + pct + '%) as of ' + esc(a.asOf || m.updated) + ', so it is ' +
            (pct >= 85 ? 'close to a sure thing' : pct >= 50 ? 'better than a coin flip'
              : pct >= 20 ? 'a real possibility but not the default' : 'still unlikely on a random flight') + '.') +
      ' Its ConnectScore is ' + a.score + ' out of 100, in the ' + P.bandWord(a.score) + ' band.'],
    ['Is ' + a.name + '’s WiFi free?', 'On ' + a.name + ' it is ' + P.freeText(e.free) +
      '. ConnectScore multiplies the fleet share by a free-for-you factor, so a paid or unconfirmed ' +
      'free claim scores lower than the same fleet given away free.'],
    ['How many ' + a.name + ' planes have ' + a.systemLabel + '?',
      (!a.fleet ? 'The whole fleet, per the airline.'
        : a.equippedPublished === false
          ? a.name + ' has not published a count. ' + num(a.fleet) + ' aircraft total' +
            (a.unresolved ? ', ' + num(a.unresolved) + ' of them unresolved' : '') + '.'
          : num(a.equipped) + ' of ' + num(a.fleet) + ', or ' + pct + '% of the fleet.') +
      (a.tracker ? ' Verified tail by tail by ' + esc(a.tracker) + ' (@martinamps).'
        : ' Compiled from public airline announcements, July 2026.')]
  ];

  /* ═══ THE AIRLINE ARCHETYPE, IN ITS FIXED ORDER ══════════════════════════
   * scorehead · today in figures · the ledger · the playbook · one context
   * section · the report block. A section with no data behind it may be cut. The
   * order may not change, and a new section type belongs in ARCHETYPES.md before
   * it belongs here.
   *
   * THE SAY-SENTENCE IS TIER-SHAPED. What this page is allowed to claim about
   * one flight is decided by how the number was derived, so the sentence that
   * speaks to the reader says which tier they are standing on rather than
   * leaving it to a footnote. */
  var tier = P.tierLetter(a);
  var rank = m.ranked.findIndex(function (x) { return x.key === key; }) + 1;
  var tierSay = tier === 'A'
    ? 'This is the one fleet anywhere where the aircraft on your flight resolves to a registration ' +
      'and the registration to an install record, so the odds here go down to the departure.'
    : tier === 'B'
      ? 'The tails are verified one by one and nobody publishes which one is scheduled onto which ' +
        'departure, so this page answers by aircraft type and stops there.'
      : tier === 'D'
        ? 'Nobody publishes per-tail data for this fleet, so this is a number about the airline and ' +
          'nothing narrower. The signed deal below counts zero until hardware flies.'
        : 'Nobody publishes per-tail data for this fleet, so this is a number about the airline and ' +
          'nothing narrower.';
  var say = esc(a.name) + ' scores <b>' + a.score + ' out of 100</b>, which is ' +
    P.bandWord(a.score) + ', and sits ' + rank + ' of ' + m.airlineCount + ' on the board. ' +
    tierSay;
  var mathLine = a.ledger
    ? a.ledger.rows.length + ' fleet segments over ' + num(a.known) +
      ' aircraft with a published system, added up = ' + a.score + ' / 100' +
      (a.hasRange ? ' (ceiling ' + a.ceiling + ')' : '')
    : pct + '% of the fleet equipped × ' + a.parts.systemQuality.toFixed(2) +
      ' system quality (' + esc(a.systemLabel) + ') × ' + a.parts.freeFactor.toFixed(2) +
      ' free-for-you = ' + a.score + ' / 100';

  var body =
    '<header class="hero" style="padding-top:14px">\n' +
    '  <span class="kicker">The forecast · tier ' + tier + '</span>\n' +
    '  <h1 class="ph">' + esc(a.name) + ' inflight WiFi</h1>\n' +
    /* THE BAND CLASS ON .scorebox IS LOAD-BEARING. V.scoreRing() draws its arc in
       var(--band), and site.css falls the whole box back to plain ink while no
       .sc-* is on it — which is what shipped on all eighteen pages. One class,
       and the ring, the big figure and the chip all agree with the number. */
    P.scorehead(m, a, rank, V.scoreRing(a.score), say,
      esc(a.resolutionLabel) + ' · ' + mathLine) +
    '  <p class="prov">' + (a.tracker
      ? '<b>Reported</b> · per-tail verification from <a href="https://' + esc(a.tracker) +
        '" target="_blank" rel="noopener">' + esc(a.tracker) + '</a> (@martinamps), ' +
        esc(H.plateDate(m.updated))
      : '<b>Reported</b> · fleet state compiled from public ' + esc(a.name) +
        ' announcements, Jul 2026') +
    ' · quality weights from Ookla Speedtest Intelligence, 28 Apr 2026</p>\n' +
    '  <p class="lede">' + esc(a.note) + '</p>\n' +
    '</header>\n\n' +
    '<section class="blk">\n  <span class="kicker">Today in figures</span>\n' +
    '  <div class="sec-h"><h2>Where the rollout stands</h2>' +
    '<span class="sub">as of ' + esc(a.asOf || m.updated) + '</span></div>\n' +
    '  <div class="stats">\n' +
    '    <div class="stat rv"><div class="n">' + (!a.fleet ? 'Fleetwide'
      : a.equippedPublished === false ? 'Unpublished'
        : num(a.equipped) + '<small> / ' + num(a.fleet) + '</small>') +
    '</div><div class="l">Aircraft equipped</div>' +
    (a.equippedPublished === false ? ''
      : '<span class="track"><i class="fill" style="--pct:' + pct + '%"></i></span>') +
    '<div class="d">' + (a.equippedPublished === false
      ? esc(a.name) + ' has not said how many of its ' + num(a.fleet) + ' aircraft carry ' +
        esc(a.systemLabel) + '.'
      : pct + '% of the fleet carries ' + esc(a.systemLabel) + '.') + '</div></div>\n' +
    '    <div class="stat rv"><div class="n" style="font-size:21px"><span class="sysdot ' +
    P.sysClass(a.system) + '"></span>' + esc(a.systemLabel) + '</div><div class="l">System</div>' +
    '<div class="d">' + (a.parts.systemQuality >= 1
      ? 'Low-earth orbit, which is the ceiling of the quality scale at 1.00.'
      : 'Geostationary hardware. Slower, and it scores ' + a.parts.systemQuality.toFixed(2) +
        ' out of 1.00.') + '</div></div>\n' +
    '    <div class="stat rv"><div class="n" style="font-size:21px">' + esc(P.freeText(e.free)) +
    '</div><div class="l">Cost onboard</div><div class="d">Free-for-you factor ' +
    a.parts.freeFactor.toFixed(2) + '.</div></div>\n' +
    '    <div class="stat rv"><div class="n">' + a.score + '</div><div class="l">ConnectScore</div>' +
    '<div class="d">Band: ' + P.bandWord(a.score) + ' (' + m.airlineCount + ' airlines ranked).</div></div>\n' +
    '  </div>\n' +
    (a.future ? '  <div class="callout rv" style="margin-top:16px">' +
      '<h3>Signed for later, and scored zero</h3>' +
      '<p>' + esc(a.name) + ' has ' + esc(a.future.system === 'leo' ? 'Amazon Leo' : a.future.system) +
      ' signed from <b>' + esc(a.future.from) + '</b>' +
      (a.future.detail ? ' (' + esc(a.future.detail) + ')' : '') + '. ConnectScore counts zero for ' +
      'hardware that is not flying yet, because a deal you cannot connect to is not connectivity.</p>' +
      '</div>\n' : '') +
    /* THE FENCED UNIT, and it is its own block so that a carrier with a
       projection but no `future` entry still gets it. Southwest is that case:
       one aircraft is already flying Starlink, so it has no "signed for later"
       deal, and it does have a published 300-by-year-end commitment.
       P.projected() is the only renderer on the site; see the contract in
       build/lib/pages.js and the tripwire in build/prerender.js. */
    (a.projected
      ? '  <div class="callout rv" style="margin-top:16px"><h3>What the signed count would be ' +
        'worth</h3>' +
        '<p style="margin-top:10px">' + P.projected(a) + '</p>' +
        /* The source sits IMMEDIATELY under the figure, not under the paragraph
           that explains it. A date three paragraphs away is not attached to the
           number a reader is looking at. */
        P.srcLine('reported', esc(a.projected.src) + ', ' +
          esc(H.plateDate(a.projected.as)) + '.') +
        '<p style="margin-top:10px">That is the next-gen number this fleet would carry if the deal ' +
        'lands as announced: ' + esc(a.projected.basis) + '. ' + esc(a.projected.means) +
        ' It is grey by rule, it sorts nothing, and it never appears without the date beside it. ' +
        '<a href="/race/#projected">All four projections, and the rules →</a></p></div>\n'
      : '') +
    '</section>\n\n' +
    ledgerTable(m, a) +
    P.playbook(m, a) +
    /* ── ONE context section, and only one. What it is depends on whether this
     * fleet has a tool behind it. The version this replaced ended sixteen of the
     * eighteen pages with a "Add to Chrome, free ↗" button — an install ask on
     * sixteen routes, which is the scattered pitch the spec allows exactly one
     * of and which no linter would ever catch. The masthead keeps its quiet
     * Extension link and that is the whole allowance. */
    (toolHref
      ? '<section class="blk">\n  <span class="kicker">Deeper</span>\n' +
        '  <h2>Per-flight odds for ' + esc(a.name) + '</h2>\n' +
        '  <p class="sec-lede">' + (key === 'united'
          ? 'The route optimizer ranks every departure on a route by its own Starlink history \u2014 ' +
            'a two-hour-later flight is often a different answer entirely. The hangar floor shows ' +
            'all ' + num(m.fleet.equipped) + ' equipped tails with the day each one was first seen ' +
            'equipped.'
          : 'The rollout page breaks this fleet down by sub-fleet, which is as narrow as verified ' +
            'tails get without a per-flight feed to count.') + '</p>\n' +
        '  <div class="cta-row"><a class="btn" href="' + toolHref + '">' + (key === 'united'
          ? 'Open the route optimizer →' : 'Open the ' + esc(a.name) + ' rollout →') + '</a>' +
        (key === 'united'
          ? '<a class="btn ghost" href="/united/fleet/">The hangar floor →</a>' +
            '<a class="btn ghost" href="/united/history/">Day-by-day history →</a>' : '') +
        '</div>\n</section>\n\n'
      : '') +
    '<section class="blk">\n  <div class="sec-h"><h2>' + esc(a.name) + ' WiFi questions</h2></div>\n' +
    '  <div class="faq">' + faqs.map(function (f) {
      return '<div class="q rv"><h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p></div>';
    }).join('') + '</div>\n' +
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div>\n</section>\n\n' +
    /* Reader field reports for THIS carrier, if any are published. FIELD REPORT
       is not MEASURED: one reader, one flight, one speed test, and none of it
       has ever moved a ConnectScore. See build/lib/reports.js. */
    (reports.length
      ? '<section class="blk">\n  <div class="sec-h">' +
        '<span class="sub">Field reports · ' + reports.length + '</span>' +
        '<h2>Speed tests from people who were on the aircraft</h2>' +
        '<a class="more" href="/methodology/#field">send one →</a></div>\n' +
        '  <p class="sec-lede">These sit beside the score and never inside it. One person on one ' +
        'flight is a data point about that flight, so every row is attributed and dated and you ' +
        'can weigh it yourself.</p>\n' +
        P.reportTable(reports) +
        P.srcLine('field', 'Reader submissions, reviewed by a person before publication. ' +
          'Nothing here feeds the ConnectScore.') +
        '</section>\n\n'
      : '') +
    /* THE REPORT BLOCK, last thing on the page and never above the content it
       asks about. The sentence names what the record cannot see for THIS fleet
       and what thirty seconds from the reader adds. It does not thank in advance
       and it does not promise a reply. */
    P.observeBlock((a.tracker
      ? 'The ledger sees installs, and installs stop at the cabin door. If you flew ' +
        esc(a.name) + ' this month, thirty seconds here is a data point nobody else has.'
      : 'Everything on this page comes from what ' + esc(a.name) + ' has published about its own ' +
        'fleet. Nobody has published what it was like in the seat. If you flew ' + esc(a.name) +
        ' this month, thirty seconds here is a data point nobody else has.'), 'a' + esc(key)) +
    /* CREDIT: a plain source line with a date, the same shape as any other
       citation on the site. The one substantial acknowledgement of @martinamps
       lives at /methodology/#credit and nowhere else. */
    P.srcLine('reported', (a.tracker
      ? 'Fleet and per-tail verification: <a href="https://' + esc(a.tracker) + '" target="_blank" ' +
        'rel="noopener">' + esc(a.tracker) + '</a> (@martinamps), ' + esc(H.plateDate(m.updated)) + '.'
      : 'Fleet state compiled from public ' + esc(a.name) + ' announcements, Jul 2026.') +
      ' Quality weights: Ookla Speedtest Intelligence, 28 Apr 2026. ' +
      '<a href="/methodology/#credit">Full credit and citation →</a>');

  return H.page({
    /* The em dash here is load-bearing: build/apitest.js parses this title with
       /<title>Qatar Airways WiFi — ConnectScore (\d+):/ to prove the rendered
       score and the API agree. Change the separator and the parity check stops
       finding a number at all. */
    title: a.name + ' WiFi — ConnectScore ' + a.score + ': ' + P.bandWord(a.score),
    desc: (!a.fleet ? a.name + ' offers ' + a.systemLabel + ' fleetwide. '
      : a.equippedPublished === false
        ? a.name + ' has launched ' + a.systemLabel + ' but has not published an aircraft count (' +
          num(a.fleet) + ' aircraft fleet). '
        : num(a.equipped) + ' of ' + num(a.fleet) + ' ' + a.name + ' aircraft carry ' +
          a.systemLabel + ' (' + pct + '%). ') +
      'ConnectScore ' + a.score + '/100, in the ' + P.bandWord(a.score) + ' band. ' + P.freeText(e.free) + '.',
    canonical: '/airlines/' + key + '/', here: '/airlines/', suffix: a.name,
    /* the two instrumented airlines have a multi-page section and get tabs;
       the other sixteen are a single page and get the way back, nothing more */
    section: key === 'united' ? 'united' : key === 'alaska' ? 'alaska' : 'airline',
    updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(function (f) {
        return {
          '@type': 'Question', name: f[0],
          acceptedAnswer: { '@type': 'Answer', text: f[1] }
        };
      })
    }, crumbLd(crumbs)]
  });
}

/* ═══ /united/fleet/ ════════════════════════════════════════════════════ */
function fleetPage(m) {
  var crumbs = [['/', 'Home'], ['/united/', 'United'], ['/united/fleet/', 'Fleet']];
  var delta = m.todayDelta !== null && m.todayDelta > 0
    ? '<span class="up">+' + m.todayDelta + ' today</span>' : 'confirmed tails in the roster';

  /* registry rows — 481 of them, newest install first */
  var reg = m.registry.map(function (r) {
    return '      <tr data-f="' + r.fleet + ' ' + esc(r.type) + '" data-q="' + esc(r.tail) + '">' +
      '<td class="mono"><b>' + esc(r.tail) + '</b></td>' +
      '<td data-s="' + esc(r.type) + '">' + esc(r.type) + '</td>' +
      '<td data-s="' + r.fleet + '"><span class="badge ' + r.fleet + '">' + r.fleet + '</span></td>' +
      '<td class="num" data-s="' + r.epoch + '">' + esc(DL.prettyDate(r.seen)) + '</td>' +
      '<td class="num" data-s="' + r.days + '">' + num(r.days) + '</td></tr>';
  }).join('\n');

  var typeChips = Object.keys(m.typeCounts).sort(function (a, b) {
    return m.typeCounts[b] - m.typeCounts[a];
  }).map(function (t) {
    return '<button type="button" data-f="' + esc(t) + '" aria-pressed="false">' + esc(t) +
      ' (' + m.typeCounts[t] + ')</button>';
  }).join('');

  var moversHtml = m.movers.length
    ? '<div class="movers">' + m.movers.map(function (d) {
        /* .mover is display:flex with a gap, so this space changes no pixel --
           without it the date and the row text welded, e.g. "Jul 27, 2026UA2123 39%...". */
        return '<div class="mover"><span class="fn">' + esc(DL.prettyDate(d.date)) + '</span> ' +
          '<span>' + d.rows.map(esc).join(' · ') + '</span></div>';
      }).join('') + '</div>'
    : '<div class="steady">No odds movement recorded yet — daily tracking started ' +
      esc(DL.prettyDate(m.D.history[0].date)) + ', and the mover log fills in from the first day two ' +
      'consecutive snapshots disagree. The install history below already goes back to ' +
      esc(DL.prettyDate(m.firstDay)) + '.</div>';
  var newTailsHtml = m.newTails.length
    ? '<p style="margin-top:12px">' + m.newTails.map(function (t) {
        return '<span class="pill add">' + esc(t.tail) + '</span>';
      }).join('') + '</p>'
    : '';

  var body =
    '<header class="hero" style="padding-top:14px">\n' +
    '  <h1 class="ph">United’s Starlink rollout, tail by tail</h1>\n' +
    '  <p class="lede">Every United aircraft confirmed to carry Starlink, with the day it was first seen ' +
    'equipped — <b>' + num(m.fleet.equipped) + '</b> tails across <b>' + m.archiveDays + '</b> install ' +
    'days since ' + esc(DL.prettyDate(m.firstDay)) + '. All of it is baked into this page at build time, ' +
    'so it reads the same with JavaScript switched off.</p>\n' +
    '</header>\n\n' + P.srcLine('reported', 'Every United figure on this page comes from <a href="https://unitedstarlinktracker.com" target="_blank" rel="noopener">unitedstarlinktracker.com</a> (@martinamps), which verifies each tail against united.com. Data eff ' + esc(H.plateDate(m.updated)) + '. <a href="/methodology/#credit">Full credit and citation →</a>') + '\n' +
    '<div class="chips">' +
    P.kpi(num(m.fleet.equipped), 'Equipped', delta, 'hero-kpi glow') +
    P.kpi(m.sharePct + '%', 'Fleet share', 'of ' + num(m.fleet.total) + ' aircraft') +
    P.kpi(num(m.fleet.last30), 'Last 30 days', 'new installs') +
    P.kpi(String(m.fleet.mainlinePacePerWeek), 'Mainline pace / week', 'straight-line finish for the ' +
      'remaining ' + num(m.fleet.mainline.total - m.fleet.mainline.equipped) + ' mainline jets: ~' +
      esc(m.etaLabel) + ' at this pace') +
    '</div>\n' +
    '<div class="chips" style="margin-top:0">' +
    '<div class="chip rv" style="grid-column:span 2"><div class="n">' + num(m.fleet.mainline.equipped) +
    '<small> / ' + num(m.fleet.mainline.total) + '</small></div><div class="l">Mainline</div>' +
    '<span class="track"><i class="fill ml" style="--pct:' + m.mainlinePct + '%"></i></span>' +
    '<div class="d">' + m.mainlinePct + '% — the long half of the rollout.</div></div>' +
    '<div class="chip rv" style="grid-column:span 2"><div class="n">' + num(m.fleet.express.equipped) +
    '<small> / ' + num(m.fleet.express.total) + '</small></div><div class="l">Express</div>' +
    '<span class="track"><i class="fill ex" style="--pct:' + m.expressPct + '%"></i></span>' +
    '<div class="d">' + m.expressPct + '% — regional jets went first and are nearly done.</div></div>' +
    '</div>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The rollout curve</h2>' +
    '<span class="sub">' + esc(DL.prettyDate(m.firstDay)) + ' → ' + esc(DL.prettyDate(m.updated)) +
    ' · ' + m.spanDays + ' days</span></div>\n' +
    /* .legend is display:flex with a gap, so these spaces change no pixel --
       without them "Express" ran into "Mainline" and "Mainline" into "Stacked". */
    '  <div class="legend"><span><i class="ex"></i>Express</span> <span><i class="ml"></i>Mainline</span> ' +
    '<span>Stacked — the top line is the fleet total</span></div>\n' +
    '  <div class="panel">' + V.areaTimeline(m) + '</div>\n' +
    '  <p class="tblcap">Derived from ' + num(m.fleet.equipped) + ' roster install dates; today’s point ' +
    'is the audited daily snapshot. <a href="/united/history/">Day-by-day log →</a></p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Install pace</h2>' +
    '<span class="sub">last 10 weeks</span></div>\n' +
    '  <div class="panel">' + V.paceBars(m) + '</div>\n' +
    '  <p class="tblcap">' + m.weeksTotal + ' aircraft added in the last 10 weeks · recent mainline pace ' +
    '~' + m.fleet.mainlinePacePerWeek + '/wk. The current week is partial.</p>\n' +
    '  <div class="panel rv" style="margin-top:14px"><div class="micro">United’s public commitments</div>' +
    '<ul class="tgts">' + (m.fleet.targets || []).map(function (t) {
      return '<li>' + esc(t) + '</li>';
    }).join('') + '</ul></div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Hangar Floor</h2>' +
    '<span class="sub">' + num(m.cells) + ' cells · one per aircraft</span></div>\n' +
    '  <p class="sec-lede">One panel per fleet type, most-complete first: the walls of light are finished, ' +
    'the walls of dark have not started. Within a panel the lit cells are in <b>install order</b>, oldest ' +
    'first — hover one for its tail number and install date. Unequipped aircraft are anonymous because the ' +
    'roster only lists tails that are done, and that is fine: this reads as “installed so far, in order”.</p>\n' +
    '  <div class="legend"><span><i class="eq"></i>Equipped (' + num(m.litCells) + ')</span>' +
    '<span><i class="no"></i>Not yet (' + num(m.cells - m.litCells) + ')</span></div>\n' +
    '  <div class="hangar">\n' + V.waffle(m) + '\n  </div>\n' +
    '  <p class="tblcap">Grid sizes come from fleet.types[].total; lit cells come from the roster. ' +
    'The two “other types” panels carry the ' +
    num(m.panels.reduce(function (a, p) { return a + (p.derived ? p.total : 0); }, 0)) +
    ' aircraft the tracker does not ' +
    'break out by type, so the floor is the whole ' + num(m.fleet.total) + '-aircraft fleet.</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Odds movers</h2>' +
    '<span class="sub">from the daily snapshots</span></div>\n  ' + moversHtml + newTailsHtml + '\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Tail registry</h2>' +
    '<span class="sub">' + num(m.registry.length) + ' equipped tails</span></div>\n' +
    '  <div class="filters needs-js" data-target="#regTable" data-cur="all" role="group" ' +
    'aria-label="Filter tails">' +
    '<button type="button" data-f="all" aria-pressed="true">All (' + num(m.registry.length) + ')</button>' +
    '<button type="button" data-f="mainline" aria-pressed="false">Mainline (' +
    num(m.fleet.mainline.equipped) + ')</button>' +
    '<button type="button" data-f="express" aria-pressed="false">Express (' +
    num(m.fleet.express.equipped) + ')</button>' + typeChips + '</div>\n' +
    '  <div class="srch needs-js"><label class="micro" for="tailq">Find a tail</label>' +
    '<input id="tailq" type="search" data-target="#regTable" placeholder="N68811" ' +
    'autocomplete="off" spellcheck="false"></div>\n' +
    '  <div class="tbl-shell"><table class="tbl" id="regTable">\n' +
    '    <thead><tr><th scope="col" data-k="tail">Tail</th><th scope="col" data-k="type">Type</th><th scope="col" data-k="fleet">Fleet</th>' +
    '<th scope="col" data-k="seen" data-t="num" aria-sort="descending">Installed</th>' +
    '<th scope="col" data-k="days" data-t="num">Days live</th></tr></thead>\n    <tbody>\n' + reg +
    '\n    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap"><span data-count-for="#regTable">' + num(m.registry.length) + '</span> equipped ' +
    'tails · updated ' + esc(m.updated) + ' · data: unitedstarlinktracker.com</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Busiest Starlink routes</h2>' +
    '<span class="sub">next 48 hours</span></div>\n  ' + P.routePills(m) +
    '\n  <p class="tblcap">From the ' + m.leaderboardCount + '-route leaderboard in today’s pull. ' +
    '<a href="/united/">Rank every flight on your route →</a></p>\n</section>\n\n' +
    P.observeBlock('This registry knows which aircraft were fitted and when. It does not know what ' +
      'the connection did on any of them. If you flew a tail listed above, thirty seconds here is a ' +
      'data point nobody else has.', 'fleet');

  return H.page({
    title: 'United Starlink fleet — every equipped tail, live',
    desc: num(m.fleet.equipped) + ' of ' + num(m.fleet.total) + ' United aircraft equipped: the hangar ' +
      'floor, the install pace, and the full tail registry with install dates. Data by unitedstarlinktracker.com.',
    canonical: '/united/fleet/', here: '/united/fleet/', suffix: 'United',
    section: 'united',
    updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs, body: body,
    jsonld: [datasetLd(m), crumbLd(crumbs)]
  });
}

/* ═══ /race/ ═════════════════════════════════════════════════════════════
 * THE RACE. Eighteen airlines, one question: when does this fleet finish?
 *
 * This page exists because the homepage had a slot called "The United rollout,
 * three ways" — three visualisations of ONE airline, on a site that claims to
 * score eighteen. The rollout story is genuinely the most interesting thing in
 * this data, and it is not a United story: it is a race, with a leader, a pause
 * (British Airways), a fleet nobody can finish quickly (Southwest), and a
 * counter-camp that has not started (Delta and jetBlue on Amazon Leo). United
 * appears here as the FASTEST RETROFIT, which is a claim about the race — not as
 * the subject.
 *
 * Everything numeric is read from airlines.js and data.json at render time.
 * build/lib/market.js supplies only the finish lines and the prose, with the
 * source and date attached to each row. */
/* ── THE FOUR PROJECTIONS, AND THE FENCE AROUND THEM ──────────────────────
 * /race/ is the natural home for this: it is the page about what has not
 * happened yet. The number is the next-gen odds a fleet WOULD carry if the
 * announced deal lands as announced, and the risk is that a reader sees 51 next
 * to a measured 54 and concludes American is about the same either way.
 *
 * So the unit is never split. P.projected() is the only renderer, the class is
 * grey outline, the horizon phrase and the confidence word ride inside the same
 * element, and build/prerender.js walks the built bytes and fails the build on
 * anything that breaks that. The `basis` and `means` strings come from
 * assets/airlines.js, so the arithmetic on this page is the arithmetic the
 * number came from. */
function projectionsSection(m) {
  var proj = m.ranked.filter(function (a) { return a.projected; })
    .sort(function (a, b) { return b.projected.score - a.projected.score; });
  if (!proj.length) return '';

  var cards = proj.map(function (a) {
    var p = a.projected;
    return '    <div class="card rv"><h3>' + esc(a.name) + '</h3>' +
      '<p style="margin:6px 0 8px">' + P.projected(a) + '</p>' +
      P.srcLine('reported', esc(p.src) + ', ' + esc(H.plateDate(p.as)) + '.') +
      '<p style="margin-top:10px"><b>' + esc(p.basis) + '</b></p>' +
      '<p>' + esc(p.means) + ' Today it scores next-gen <b>' + a.nextGenScore +
      '</b> and ConnectScore <b>' + a.score + '</b>, and those are the two numbers that describe ' +
      'the flight you can book this month.</p></div>';
  }).join('\n');

  var rules = [
    ['It never sorts anything', 'Every table on this site ranks on what is flying today. The ' +
      'projected column says "does not sort" in its own header, and its header carries no sort key ' +
      'for the client script to find.'],
    ['It never takes the score arc', 'Green, amber and red mean measured. A projection is grey ' +
      'outline on every surface, including the API render hints and the extension badge.'],
    ['It never appears without its date', 'The value, the horizon phrase and the confidence word ' +
      'are one element. There is no bare projected integer anywhere in the model, on any page, or ' +
      'in any API response, by design.'],
    ['It carries its confidence label', 'FIRM means the aircraft count and the date are both ' +
      'published. SOFT means one of the two is secondary reporting.'],
    ['A missed date is louder than a met one', 'When the horizon passes with nothing installed the ' +
      'figure flips to SLIPPED, takes a hatched ground, and keeps showing the date that was ' +
      'promised. That flip is computed from the build date, so it does not wait for anyone to ' +
      'notice. No carrier is in that state today.']
  ].map(function (r) {
    return '<div class="q rv"><h3>' + esc(r[0]) + '</h3><p>' + esc(r[1]) + '</p></div>';
  }).join('');

  return '<section class="blk" id="projected">\n  <div class="sec-h">' +
    '<h2>The four signed deals, and what they would be worth</h2>' +
    '<span class="sub">projected, and fenced</span>' +
    '<a class="more" href="/methodology/#projected">the five rules →</a></div>\n' +
    '  <p class="sec-lede">A signed deal scores zero on today’s odds and always will, because ' +
    'nothing is flying. Readers still want to know what the signature is worth, so there is a ' +
    'fourth number for it. Adding it was the riskiest change on this site: a forward-looking figure ' +
    'sitting beside a measured one gets read as measured. The five rules below are what stop ' +
    'that, and a build tripwire enforces every one of them on the bytes that ship.</p>\n' +
    '  <div class="panel"><p class="mono" style="font-size:14px;color:var(--ink)">' +
    'projected next-gen odds = committed aircraft ÷ the known-fleet denominator × 1.00 low-earth ' +
    'orbit × free-for-you<br>horizon = the announced start, and the completion date where one is ' +
    'published</p></div>\n' +
    '  <div class="grid2" style="margin-top:16px">\n' + cards + '\n  </div>\n' +
    '  <div class="faq" style="margin-top:20px">' + rules + '</div>\n' +
    '  <p class="tblcap">Only a published aircraft count enters the numerator. Amazon’s ' +
    '&ldquo;hundreds more over time&rdquo; on the Delta deal is not counted.</p>\n' +
    '</section>\n\n';
}

function racePage(m) {
  var crumbs = [['/', 'Home'], ['/race/', 'The Race']];

  /* Every scored airline must have a finish-line row, or the table quietly ships
     with holes in it. Fail the build instead — same rule as a missing route. */
  var noRow = Object.keys(m.A.WIFI_AIRLINES).filter(function (k) { return !MK.ROLLOUT[k]; });
  if (noRow.length) {
    console.error('Build FAILED — /race/ has no rollout row for: ' + noRow.join(', '));
    console.error('  Add them to ROLLOUT in build/lib/market.js, with a source and a date. A blank');
    console.error('  cell in a timeline reads as "no rollout", which is a different claim entirely.');
    process.exit(1);
  }

  /* ranked by how much of the fleet is next-gen TODAY — the honest race order.
     Ties break on the fuller fleet, so a 100%-of-9-aircraft airline does not
     outrank a 100%-of-159 one by alphabet. */
  var race = m.ranked.slice().sort(function (a, b) {
    if (b.nextGenShare !== a.nextGenShare) return b.nextGenShare - a.nextGenShare;
    if ((b.fleet || 0) !== (a.fleet || 0)) return (b.fleet || 0) - (a.fleet || 0);
    return a.name.localeCompare(b.name);
  });
  var phases = { done: [], installing: [], signed: [], none: [] };
  race.forEach(function (a) { phases[MK.phaseOf(m.A, a)].push(a); });

  function pctText(a) {
    var raw = a.nextGenShare * 100;
    return raw > 0 && raw < 1 ? '<1%' : Math.round(raw) + '%';
  }

  var rows = race.map(function (a) {
    var R = MK.ROLLOUT[a.key];
    var ph = MK.phaseOf(m.A, a);
    var target = R.target
      ? esc(R.target)
      : '<span style="color:var(--faint)">no public completion date</span>';
    return '      <tr data-f="' + ph + '" data-q="' + esc((a.name + ' ' + (a.code || '')).toLowerCase()) +
      '">' +
      '<td><a class="aname" href="/airlines/' + a.key + '/">' + esc(a.name) +
      '<span class="code">' + esc(a.code || '') + '</span></a></td>' +
      '<td data-s="' + a.nextGenShare.toFixed(4) + '">' +
      (a.nextGenSystem
        ? '<span class="sysdot ' + P.sysClass(a.nextGenSystem) + '"></span><b>' + pctText(a) + '</b> ' +
          '<span style="color:var(--faint)">' + esc(a.nextGenLabel) + '</span>' +
          (a.fleet ? '<span class="track mini"><i class="fill" style="--pct:' +
            Math.round(a.nextGenShare * 100) + '%"></i></span>' : '')
        : '<b>0%</b> <span style="color:var(--faint)">none flying</span>') +
      '</td>' +
      '<td data-s="' + esc(a.serviceTier) + '">' + esc(a.serviceTierLabel) +
      (a.restTierLabel ? '<span style="color:var(--faint)"> · rest ' + esc(a.restTierLabel) + '</span>' : '') +
      '</td>' +
      '<td data-s="' + esc(R.target || 'zzz') + '">' + target + '</td>' +
      /* THE FENCED UNIT. No data-k on this column's <th>, so the client sorter
         cannot reach it; the header says so in words as well. */
      '<td>' + P.projCell(a, ph === 'done' ? 'Rollout complete' : 'Nothing signed') +
      (a.projected ? '<div class="micro" style="margin-top:5px">Announced ' +
        esc(H.plateDate(a.projected.as)) + '</div>' : '') + '</td>' +
      '<td class="note hide-sm">' + esc(R.detail) + ' <span style="color:var(--faint)">· ' +
      esc(R.source) + '</span></td></tr>';
  }).join('\n');

  var chips = [['done', 'Finished'], ['installing', 'Installing'], ['signed', 'Signed only'],
    ['all', 'All ' + m.airlineCount]];

  var leader = phases.installing[0] || race[0];
  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker"><span class="dot"></span>The Race · data as of ' + esc(m.updated) + '</span>\n' +
    '  <h1 class="ph">The race to next-gen inflight WiFi</h1>\n' +
    '  <p class="lede">Every airline we score, ordered by how much of its fleet is flying <b>Starlink ' +
    'or Amazon Leo today</b>, with the finish line each one has committed to in public. ' +
    phases.done.length + ' fleets are done. ' + phases.installing.length + ' are mid-retrofit, which ' +
    'is the only phase where per-flight odds mean anything. ' + phases.signed.length + ' have signed ' +
    'for hardware that is not in the air, and those score zero here until it is.</p>\n' +
    '  <div class="microlinks"><a href="/systems/">Starlink vs Amazon Leo →</a>' +
    '<a href="/airlines/">The full leaderboard →</a><a href="/methodology/">How we know →</a></div>\n' +
    '</header>\n\n' +
    P.srcLine('reported', 'Fleet counts: unitedstarlinktracker.com and alaskastarlinktracker.com ' +
      '(@martinamps), ' + esc(H.plateDate(m.updated)) + '. Finish lines and committed aircraft ' +
      'counts from the airlines\' own announcements, dated in the last column of the table.') + '\n' +

    '<div class="chips">' +
    P.kpi(String(phases.done.length), 'Fleets finished', 'next-gen on 90%+ of the fleet') +
    P.kpi(String(phases.installing.length), 'Mid-retrofit', 'the messy middle, where odds matter') +
    P.kpi(String(phases.signed.length), 'Signed, not flying', 'scored zero until hardware is up') +
    P.kpi(String(MK.INDUSTRY.programs), 'Airline programs industry-wide', MK.INDUSTRY.deployed +
      ' deployed · ' + MK.INDUSTRY.installing + ' installing · ' + MK.INDUSTRY.signed + ' signed') +
    '</div>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Every finish line</h2>' +
    '<span class="sub">next-gen share today, and the date the airline has committed to</span>' +
    '<a class="more" href="/systems/">what the hardware actually is →</a></div>\n' +
    '  <p class="sec-lede">Read the two middle columns together. <b>Next-gen today</b> is the odds of ' +
    'drawing a low-earth-orbit aircraft on a flight that has not been assigned one yet. <b>Today’s ' +
    'tier</b> is what you get on the rest of the fleet, which is the part a single score hides: ' +
    'streaming-class is a working connection with lag, basic is email and messaging, and the two are ' +
    'not interchangeable on a four-hour transcon.</p>\n' +
    '  <div class="filters needs-js" data-target="#raceTable" data-cur="all" role="group" ' +
    'aria-label="Filter by rollout phase">' +
    chips.map(function (c, i) {
      return '<button type="button" data-f="' + c[0] + '" aria-pressed="' +
        (c[0] === 'all') + '">' + esc(c[1]) + '</button>';
    }).join('') + '</div>\n' +
    '  <div class="tbl-shell rv"><table class="tbl" id="raceTable">\n' +
    '    <thead><tr><th scope="col" data-k="name">Airline</th>' +
    '<th scope="col" data-k="ng" data-t="num" aria-sort="descending">Next-gen today</th>' +
    '<th scope="col" data-k="tier">Today’s tier</th><th scope="col" data-k="target">Finish line</th>' +
    '<th scope="col">Projected · does not sort</th>' +
    '<th scope="col" class="hide-sm">What we know · source</th></tr></thead>\n    <tbody>\n' + rows +
    '\n    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap"><span data-count-for="#raceTable">' + m.airlineCount + '</span> airlines · ' +
    'fleet counts as of ' + esc(m.updated) + ' · finish lines from public announcements, ' +
    esc(MK.VERIFIED) + ' · nothing here is fetched live.</p>\n' +
    '  <div class="caveat">' + esc(m.A.TIER_METHOD_LINE) + '</div>\n' +
    '</section>\n\n' +

    projectionsSection(m) +

    /* ── chapter one: United. The deep-dive that used to headline the homepage,
     * repositioned as what it actually is — the leading entry in a race, and the
     * only fleet in the world instrumented tail by tail. */
    '<section class="blk">\n  <div class="sec-h"><h2>Chapter one: United, the fastest retrofit</h2>' +
    '<span class="sub">' + m.archiveDays + ' install days on record, verified daily</span>' +
    '<a class="more" href="/united/fleet/">the whole fleet →</a></div>\n' +
    '  <p class="sec-lede">United is not the biggest next-gen share in the table and it is the fastest ' +
    'moving large fleet in it: ' + num(m.fleet.equipped) + ' aircraft since ' +
    esc(DL.prettyDate(m.firstDay)) + ', express first, mainline catching up. It is also the only fleet ' +
    'anywhere with a public per-tail archive. That is why United is where the per-flight odds come ' +
    'from, and why every other airline’s curve gets read against this one.</p>\n' +
    '  <div class="chips" style="margin:14px 0 16px">' +
    P.kpi(num(m.fleet.equipped), 'United aircraft equipped', 'verified tail by tail') +
    P.kpi(m.sharePct + '%', 'Of the United fleet', 'of ' + num(m.fleet.total) + ' aircraft') +
    P.kpi(String(m.archiveDays), 'Days of install history', 'since ' +
      esc(DL.shortMonth(m.firstDay)) + ' 2025') +
    P.kpi(String(m.fleet.mainlinePacePerWeek), 'Mainline pace / week', 'straight-line finish ~' +
      esc(m.etaLabel) + ' at this pace') +
    '</div>\n' +
    '  <div class="grid3">\n' +
    '    <a class="card rv" href="/united/fleet/"><h3>Rollout curve</h3>' + V.spark(m) +
    '<p>' + num(m.fleet.equipped) + ' aircraft equipped since ' + esc(DL.prettyDate(m.firstDay)) +
    '. This is the shape every other fleet in the table gets compared against.</p>' +
    '<span class="go">See the timeline →</span></a>\n' +
    '    <a class="card rv" href="/united/fleet/"><h3>Hangar floor</h3>' + V.miniWaffle(m) +
    '<p>One cell per 10 aircraft · <b>' + num(m.fleet.equipped) + ' of ' + num(m.fleet.total) +
    '</b> equipped (' + m.sharePct + '%). The full floor is one cell per aircraft.</p>' +
    '<span class="go">Open all ' + num(m.cells) + ' cells →</span></a>\n' +
    '    <div class="card rv"><h3>Busiest Starlink routes</h3>' + P.routePills(m) +
    '<p class="note">' + m.leaderboardCount + '-route leaderboard · ' + m.routeCount +
    ' cached routes in the optimizer.</p>' +
    '<a class="go" href="/united/">Open the route optimizer →</a></div>\n' +
    '  </div>\n' +
    '  <p class="tblcap">Alaska is instrumented too, one tier down: verified tails, no per-flight feed. ' +
    '<a href="/alaska/">Alaska’s rollout →</a> · <a href="/methodology/">why that is a different ' +
    'kind of answer →</a></p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>What the race decides</h2>' +
    '<span class="sub">three things worth knowing before you book</span></div>\n' +
    '  <div class="faq">\n' +
    '    <div class="q rv"><h3>A paused rollout is worse than a slow one</h3><p>British Airways fitted ' +
    'five aircraft and stopped for the summer. A fleet-share percentage cannot tell you that on its ' +
    'own, because the number just looks small either way. The date next to it is the part that ' +
    'matters, which is why every row above carries one.</p></div>\n' +
    '    <div class="q rv"><h3>Some fleets will never finish</h3><p>American signed Starlink for 500+ ' +
    'Airbus aircraft; the Boeing fleet stays on Viasat under the current deal. So American’s odds may ' +
    'never converge on 100%, and the aircraft type on your itinerary will keep mattering there long ' +
    'after United’s stops mattering. Southwest is the other version of this: 817 aircraft is years of ' +
    'work at any believable rate.</p></div>\n' +
    '    <div class="q rv"><h3>A signed deal is not a connection</h3><p>Delta and jetBlue picked Amazon ' +
    'Leo, from 2028 and 2027. Both score <b>0</b> for next-gen odds today and both have genuinely ' +
    'good, free, streaming-class Viasat right now. Those two facts are not in tension. They are the ' +
    'reason this site shows two numbers instead of one. <a href="/systems/">Starlink vs Amazon Leo, ' +
    'compared →</a></p></div>\n' +
    '  </div>\n</section>\n\n' +
    P.observeBlock('Every row above is a fleet count and a published date \u2014 none of it says ' +
      'what the connection did once the door closed. If you flew any of these airlines this month, thirty ' +
      'seconds here is a data point nobody else has.', 'race') +
    P.srcLine('reported', 'Fleet and per-tail verification for United, Alaska and Hawaiian: unitedstarlinktracker.com and alaskastarlinktracker.com (@martinamps), ' + esc(H.plateDate(m.updated)) + '. Every other airline from public airline announcements, Jul 2026. <a href="/methodology/#credit">Full credit and citation →</a>');

  return H.page({
    title: 'The race to next-gen inflight WiFi · every airline’s rollout timeline',
    desc: 'Which airlines are finished, which are mid-retrofit and which have only signed: next-gen ' +
      'fleet share plus the public finish line for ' + m.airlineCount + ' airlines, with United as the ' +
      'fastest large retrofit. Updated ' + m.updated + '.',
    canonical: '/race/', here: '/race/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Airline next-gen inflight WiFi rollout race',
      description: 'Airlines ordered by the share of the fleet flying Starlink or Amazon Leo today.',
      numberOfItems: race.length,
      itemListElement: race.map(function (a, i) {
        return {
          '@type': 'ListItem', position: i + 1,
          name: a.name + ' — ' + Math.round(a.nextGenShare * 100) + '% next-gen, ' +
            (MK.ROLLOUT[a.key].target || 'no public completion date'),
          url: ORIGIN + '/airlines/' + a.key + '/'
        };
      })
    }, crumbLd(crumbs)]
  });
}

/* ═══ /systems/ ══════════════════════════════════════════════════════════
 * The evergreen page. Fleet counts change daily; how a satellite works does not,
 * and "is Starlink actually better than what Delta has" is the question underneath
 * every score on this site. It is also the page that has to be most careful: the
 * honest answer for Amazon Leo is "nobody has measured it in a cabin yet", and
 * saying so is worth more than a plausible number would be.
 *
 * The quality weights in the table are read out of A.SYSTEM_QUALITY, not typed, so
 * the primer and the scoring cannot disagree. */
function systemsPage(m) {
  var crumbs = [['/', 'Home'], ['/systems/', 'Systems']];
  var A = m.A;

  var sl = MK.carriersOf(A, 'starlink');
  var leoSigned = MK.signedFor(A, 'leo');
  var slEquipped = sl.reduce(function (t, a) { return t + (a.equipped || 0); }, 0);
  var slFleet = sl.reduce(function (t, a) { return t + (a.fleet || 0); }, 0);

  function carrierPills(list, cls) {
    if (!list.length) return '<span class="note">none in this set</span>';
    return list.map(function (a) {
      return '<a class="pill' + (cls ? ' ' + cls : '') + '" href="/airlines/' + a.key + '/">' +
        esc(a.name) + '</a>';
    }).join('');
  }

  /* head-to-head: the same eight questions asked of both LEO systems.
   * DIRECTIONAL INTELLIGENCE, and the rule that makes it usable: every figure
   * carries its class (VENDOR CLAIM / MEASURED / REPORTED), its source and its
   * date. Amazon Leo's whole column is a spec sheet, and the chips say so on
   * every row so a reader cannot mistake a promise for a measurement. */
  var vs = [
    ['Flying on a passenger aircraft today',
      'Yes. ' + sl.length + ' of the ' + m.airlineCount + ' airlines here, ' + num(slEquipped) +
      ' aircraft in this set alone. ' + P.cls('reported'),
      'No. Not one passenger aircraft, anywhere. ' + P.cls('reported')],
    ['Advertised per-aircraft speed',
      'Up to 250 Mbps on United, 350 on airBaltic, 500 on Qatar, from two radomes. ' +
      P.cls('vendor'),
      'Up to 1 Gbps down and 400 Mbps up simultaneously, from one antenna. On paper that is an ' +
      'order of magnitude more upload, and a single-day install. ' + P.cls('vendor')],
    ['What a passenger has actually measured',
      'Per-device medians of 64 to 85 Mbps in two peer-reviewed studies; per-airline medians of ' +
      '152 to 320 Mbps at Ookla. The two disagree by a factor of two to five and nobody has ' +
      'explained why. ' + P.cls('measured'),
      'Nothing. Zero aircraft, so zero measurements. Every Leo number in circulation is a spec ' +
      'sheet. ' + P.cls('measured')],
    ['Constellation deployed',
      'Over 8,000 satellites operational. ' + P.cls('reported'),
      'About 390 to 400 of a planned 3,232, which is roughly an eighth. ' + P.cls('reported')],
    ['Airlines committed',
      MK.INDUSTRY.programs + ' programs industry-wide: ' + MK.INDUSTRY.deployed + ' fully deployed, ' +
      MK.INDUSTRY.installing + ' installing, ' + MK.INDUSTRY.signed + ' signed (' + MK.VERIFIED + ').',
      leoSigned.map(function (a) {
        return a.name + ' (' + a.future.from + (a.future.detail ? ', ' + a.future.detail : '') + ')';
      }).join('; ') + '.'],
    ['First in service',
      'JSX finished its entire fleet before anyone else started.',
      'jetBlue, from 2027, a year ahead of Delta’s 500 aircraft.'],
    ['How ConnectScore treats it',
      'System quality ' + A.SYSTEM_QUALITY.starlink.toFixed(2) + ', which is the ceiling.',
      'System quality ' + A.SYSTEM_QUALITY.leo.toFixed(2) + ' when it flies, and a next-gen score of ' +
      '<b>zero</b> on every airline until then. A deal you cannot connect to is not connectivity.'],
    ['What would change our mind',
      'A fleet finishing: once a carrier is at 97% the odds question dies of success and the ' +
      'interesting number becomes speed on the day.',
      'The first jetBlue aircraft in service. That is the day Leo stops being a press release in this ' +
      'data set and starts being a number.']
  ];

  var sysRows = MK.SYSTEMS.map(function (s) {
    var q = A.systemQuality(s.key);
    var carriers = MK.carriersOf(A, s.key);
    var signed = MK.signedFor(A, s.key);
    return '      <tr data-f="' + (s.nextGen ? 'nextgen' : 'legacy') + '">' +
      '<td><span class="sysdot ' + P.sysClass(s.key) + '"></span><b>' +
      esc(A.SYSTEM_LABEL[s.key] || s.key) + '</b>' +
      '<div class="note" style="margin-top:3px">' + esc(s.operator) + ' · ' + esc(s.orbit) + '</div></td>' +
      '<td>' + esc(s.how) + '</td>' +
      '<td>' + esc(s.speed) + '</td>' +
      '<td>' + esc(s.reliability) + '</td>' +
      /* the span is the measurable line box: a cell's own box is its row's
         height, so a one-word "Paid." beside three lines of prose measured
         as a 264px-tall word to the layout assert */
      '<td><span>' + esc(s.price) + '</span></td>' +
      '<td class="num" data-s="' + q + '"><b>' + q.toFixed(2) + '</b></td>' +
      '<td class="hide-sm">' +
      (carriers.length ? carriers.map(function (a) { return esc(a.name); }).join(', ')
        : '<span class="micro">none in this set</span>') +
      (signed.length ? '<div class="note" style="margin-top:4px">signed: ' +
        signed.map(function (a) { return esc(a.name) + ' ' + esc(a.future.from); }).join(', ') +
        '</div>' : '') +
      '</td></tr>';
  }).join('\n');

  var faqs = [
    ['Is Starlink actually better than Delta’s WiFi, or is that just marketing?',
      'Both things are true and they answer different questions. Delta Sync is free, fleetwide, and ' +
      'genuinely streaming-class, so you can work on it. Starlink is a low-earth-orbit system roughly ' +
      '60 times closer to the aircraft than a geostationary satellite, so the lag is tens of ' +
      'milliseconds instead of about half a second, and it keeps working mid-ocean and at high ' +
      'latitude where geostationary coverage thins out. If your flight is four hours of real work, ' +
      'the difference is noticeable. If it is email and a film, it is not.'],
    ['What is Amazon Leo, and does any airline have it?',
      'Amazon Leo is Amazon’s low-earth-orbit constellation, formerly Project Kuiper, and the same ' +
      'physics class as Starlink. No passenger aircraft is flying it yet. jetBlue is first, from ' +
      '2027; Delta signed for 500 aircraft from 2028. Because nothing is in the air, both airlines ' +
      'score zero for next-gen odds on this site, and we publish no speed figure for Leo anywhere. ' +
      'There is no in-cabin measurement to publish.'],
    ['Why does “free WiFi” not tell you whether it is good?',
      'Because the two are unrelated. American launched free WiFi across about 90% of its fleet in ' +
      'January 2026, and it is Viasat and Intelsat: streaming-class, geostationary, with the ' +
      'widebodies on older Panasonic hardware left out of the offer entirely. Free and fast are ' +
      'separate axes, which is why ConnectScore multiplies them instead of picking one.'],
    ['Which system will my flight have?',
      'That depends on the aircraft, not the airline, which is the whole problem. For United we hold ' +
      'a per-tail archive and can give you the odds for your actual flight number. For every other ' +
      'carrier all we have is the fleet share plus the aircraft type on your itinerary. The ' +
      'race page has each fleet’s current split and its finish line.'],
    ['Does more bandwidth fix the lag?',
      'No, and this is the one piece of physics worth knowing. A geostationary satellite sits 35,786 ' +
      'km up; the round trip is about half a second no matter how fast the link is. Low-earth orbit ' +
      'is roughly 550 km, so the delay is tens of milliseconds. Bandwidth decides whether video ' +
      'streams; distance decides whether the connection feels alive.']
  ];

  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker"><span class="dot"></span>Systems · evergreen · reviewed ' +
    esc(MK.VERIFIED) + '</span>\n' +
    '  <h1 class="ph">Inflight WiFi systems, compared</h1>\n' +
    '  <p class="lede">Every score on this site rests on one distinction: <b>low-earth orbit or ' +
    'geostationary</b>. This page is that distinction in full. Starlink against Amazon Leo head to ' +
    'head, then every system flying on the airlines we track, with what each one does in the cabin, ' +
    'what it costs, and the weight it carries in ConnectScore.</p>\n' +
    '  <div class="microlinks"><a href="/race/">The rollout race →</a>' +
    '<a href="/airlines/">The leaderboard →</a><a href="/methodology/">The formula →</a></div>\n' +
    '</header>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Starlink vs Amazon Leo</h2>' +
    '<span class="sub">the two low-earth-orbit camps</span></div>\n' +
    '  <p class="sec-lede">These are the only two systems this site treats as next-gen, they are ' +
    'technically the same idea, and exactly one of them is carrying passengers. That asymmetry is the ' +
    'single most important fact on this page, and it is why Delta’s next-gen score is 0 while its ' +
    'ConnectScore is one of the highest here.</p>\n' +
    '  <div class="tbl-shell rv"><table class="tbl">\n' +
    '    <thead><tr><th scope="col"></th>' +
    '<th scope="col"><span class="sysdot starlink"></span>Starlink <span class="note">SpaceX</span></th>' +
    '<th scope="col"><span class="sysdot leo"></span>Amazon Leo <span class="note">Amazon, ex-Kuiper</span></th>' +
    '</tr></thead>\n    <tbody>\n' +
    vs.map(function (r) {
      return '      <tr><td><b>' + esc(r[0]) + '</b></td><td>' + r[1] + '</td><td>' + r[2] +
        '</td></tr>';
    }).join('\n') +
    '\n    </tbody>\n  </table></div>\n' +
    P.srcLine('vendor', 'Starlink per-aircraft figures: United, airBaltic and Qatar Airways ' +
      'statements, 2025 to 2026. Amazon Leo antenna specification: ' +
      '<a href="https://www.aboutamazon.com/news/amazon-leo/amazon-leo-aviation-antenna-gigabit-wifi" ' +
      'target="_blank" rel="noopener">Amazon, 13 Apr 2026</a>.') +
    P.srcLine('measured', 'Per-device medians: Jang et al., ACM IMC ’25, and Ullah et al., ' +
      'arXiv:2508.09839, Aug 2025. Per-airline medians: Ookla Speedtest Intelligence, ' +
      '30 Jun 2025 and 28 Apr 2026. Constellation counts: GeekWire and Via Satellite, ' +
      '2 to 8 Jul 2026, against the FCC licence for 3,232.') +
    '  <p class="tblcap"><a href="/methodology/#measured">Why the measured numbers disagree by two ' +
    'to five times, and the ten mechanisms behind it →</a></p>\n' +
    '  <div class="grid3" style="margin-top:16px">\n' +
    '    <div class="card rv"><h3>Flying Starlink today</h3><p>' +
    carrierPills(sl) + '</p><p class="note">' + num(slEquipped) + ' of ' + num(slFleet) +
    ' aircraft across those fleets, as of ' + esc(m.updated) + '.</p></div>\n' +
    '    <div class="card rv"><h3>Signed for Amazon Leo</h3><p>' +
    carrierPills(leoSigned, 'soon') + '</p><p class="note">Zero aircraft in service. Both fleets run ' +
    'free streaming-class Viasat until the hardware arrives.</p></div>\n' +
    '    <div class="card rv"><h3>Why the gap matters</h3><p>A signed deal changes nothing about the ' +
    'flight you are booking this month. It changes a great deal about the one you book in 2028. ' +
    'That is why the race page tracks both, and why neither number is allowed to stand in for the ' +
    'other.</p><a class="go" href="/race/">The rollout race →</a></div>\n' +
    '  </div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Every system, end to end</h2>' +
    '<span class="sub">how it works · what it does · what it weighs</span></div>\n' +
    '  <p class="sec-lede">The last column is the multiplier this system contributes to ConnectScore. ' +
    'It is read straight out of the scoring table rather than typed here, so the primer and the ' +
    'formula cannot drift apart.</p>\n' +
    '  <div class="tbl-shell rv"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">System</th><th scope="col">How it works</th><th scope="col">Real-world speed</th>' +
    '<th scope="col">Reliability</th><th scope="col">Price onboard</th><th scope="col" data-t="num">Quality</th>' +
    '<th scope="col" class="hide-sm">Airlines here</th></tr></thead>\n    <tbody>\n' + sysRows +
    '\n    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap">Quality weights from the ConnectScore table · carrier lists derived from the ' +
    'same airline data as every other page · fleet counts as of ' + esc(m.updated) + '.</p>\n' +
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The questions people actually ask</h2>' +
    '<a class="more" href="/methodology/">methodology →</a></div>\n' +
    '  <div class="faq">' + faqs.map(function (f) {
      return '<div class="q rv"><h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p></div>';
    }).join('') + '</div>\n</section>\n\n' +
    P.observeBlock('Every speed on this page was measured by somebody with a laptop at 35,000 feet. ' +
      'The measured column is thin because that is a hard test to run \u2014 and one more reading on ' +
      'a system nobody has published lately moves it further than anything I can write here.',
      'sys') +
    P.srcLine('reported', 'Fleet and per-tail verification for United, Alaska and Hawaiian: unitedstarlinktracker.com and alaskastarlinktracker.com (@martinamps), ' + esc(H.plateDate(m.updated)) + '. Every other airline from public airline announcements, Jul 2026. <a href="/methodology/#credit">Full credit and citation →</a>');

  return H.page({
    title: 'Inflight WiFi systems compared — Starlink vs Amazon Leo vs Viasat',
    desc: 'Starlink and Amazon Leo head to head, plus every inflight WiFi system flying on the ' +
      'airlines we track: how each one works, real-world cabin speed, reliability, price and the ' +
      'weight it carries in ConnectScore. Reviewed ' + MK.VERIFIED + '.',
    canonical: '/systems/', here: '/systems/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(function (f) {
        return {
          '@type': 'Question', name: f[0],
          acceptedAnswer: { '@type': 'Answer', text: f[1] }
        };
      })
    }, {
      '@context': 'https://schema.org', '@type': 'TechArticle',
      headline: 'Inflight WiFi systems compared: Starlink, Amazon Leo, Viasat, 2Ku, Panasonic',
      url: ORIGIN + '/systems/',
      dateModified: m.updated,
      description: 'Low-earth orbit against geostationary: how each inflight WiFi system works, what ' +
        'it delivers in the cabin, and how ConnectScore weights it.',
      author: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      publisher: { '@id': ORIGIN + '/#org' },
      about: 'Inflight satellite connectivity systems'
    }, crumbLd(crumbs)]
  });
}

/* ═══ /roadmap/ ═════════════════════════════════════════════════════════ */
function roadmapPage(m) {
  var crumbs = [['/', 'Home'], ['/roadmap/', 'Roadmap']];
  /* ═══ THE ONE PAGE ABOUT THIS PROJECT, UNDER ITS OWN FENCE ════════════════
   * Two lists, SHIPPED and AHEAD, both from P.roadmapLists(). A site that fences
   * Delta's 2028 promise while its own promises float would deserve the reader's
   * doubt, so every AHEAD row carries the date it entered that state and says
   * what it is waiting on. None of them gets a horizon chip, because none of
   * them has a published finish date — that is fence rule three applied to us.
   * See the header above SHIPPED in build/lib/pages.js for the whole argument. */
  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker">The roadmap</span>\n' +
    '  <h1 class="ph">What has shipped, and what has not</h1>\n' +
    '  <p class="lede">The one page here about this project instead of about an airline. ' +
    'Shipped things carry the date they can be checked against. The rest carry the date they ' +
    'entered the state they are in, a confidence word, and the thing they are actually waiting ' +
    'on.</p>\n' +
    '</header>\n\n' +
    '<section class="blk">\n' + P.roadmapLists(m) + '\n' +
    '  <p class="footnote" style="margin-top:1.4rem">No row above carries a horizon date, and that ' +
    'is deliberate. The extension items are queued behind a Chrome Web Store review nobody here ' +
    'schedules, and the instrumentation item lands when a tracker publishes a per-flight history. ' +
    'The airlines on this site are fenced by the rule that a projection with no date gets no chip, ' +
    'and the same rule applies to me. <a href="/methodology/#projected">The five rules →</a></p>\n' +
    '</section>\n\n' +
    '<section class="blk">\n  <span class="kicker">Live now</span>\n' +
    '  <h2>The three things you can open today</h2>\n' +
    '  <div class="grid3">' +
    '<div class="card rv"><h3>The route optimizer</h3><p>' + m.routeCount + ' cached United routes, ' +
    'every departure ranked by its own Starlink history, connection-aware.</p>' +
    '<a class="go" href="/united/">Open it →</a></div>' +
    '<div class="card rv"><h3>The hangar floor</h3><p>All ' + num(m.fleet.equipped) + ' equipped tails, ' +
    'the ' + m.archiveDays + '-day install archive, and the full registry.</p>' +
    '<a class="go" href="/united/fleet/">Open it →</a></div>' +
    '<div class="card rv"><h3>' + m.airlineCount + ' ConnectScores</h3><p>One number per airline, ' +
    'recomputed on every build, quotable with credit.</p>' +
    '<a class="go" href="/airlines/">Open it →</a></div></div>\n</section>\n\n' +
    P.srcLine('reported', 'Fleet and per-tail verification for United, Alaska and Hawaiian: unitedstarlinktracker.com and alaskastarlinktracker.com (@martinamps), ' + esc(H.plateDate(m.updated)) + '. Every other airline from public airline announcements, Jul 2026. <a href="/methodology/#credit">Full credit and citation →</a>');
  return H.page({
    title: 'WiFi Odds roadmap — what shipped, and what has not',
    desc: 'Shipped with dates: extension v2.0.0, the tail-swap Guardian, the public ConnectScore ' +
      'API, the fenced projected score, the per-tail rollout archive. Ahead, with what it is ' +
      'waiting on: the next instrumented airline.',
    canonical: '/roadmap/', here: '/roadmap/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs, body: body,
    jsonld: [crumbLd(crumbs)]
  });
}

/* ═══ /methodology/, THE GENERATOR THAT NO LONGER SHIPS ═══════════════════
 * SUPERSEDED on 28 Jul 2026 by methodologyPage() further down, which pours the
 * approved Codex document (build/templates/methodology.html) through the same
 * whole-document path as Render.home(). Nothing writes this one any more.
 *
 * It is KEPT, not deleted, and the reason is not sentiment: every figure below
 * is derived from `m` — the tier split, the worked example, the freshness
 * stamp — and the new document states its method in prose without those live
 * numbers. If the next round asks for a baked figure back on that page, this
 * is where the derivation already exists, correct and dated. Deleting it would
 * mean rebuilding arithmetic that is already known-good.
 *
 * It has NO route and NO caller. Wire it to nothing without saying so out loud.
 *
 * The original header follows, unchanged:
 *
 * The provenance page. It exists because "ConnectScore 27" is a number with no
 * error bars attached, and every serious reader — a redditor, a journalist, an
 * answer engine deciding whether to quote us — asks the same three questions:
 * where did this come from, how sure are you, and what can't you see. Answering
 * them in public is cheaper than being asked, and it is the page that gets
 * linked to.
 *
 * THE TIER SPLIT IS DERIVED, NOT TYPED. `instrumented` in assets/airlines.js is
 * the flag, and United is the only fleet with a per-flight route history in
 * data.json — so Verified/Type-derived/Coarse fall out of the data rather than
 * out of a hand-maintained list that would rot the day Hawaiian lands.
 *
 * Every number below comes from m. If you find yourself typing a figure into
 * this page, that is the bug. */
function methodologyPageLegacy(m) {
  var crumbs = [['/', 'Home'], ['/methodology/', 'Methodology']];
  var ua = m.A.scoreAirline('united');
  var al = m.A.scoreAirline('alaska');

  /* per-flight history exists only where we cache routes, i.e. United today */
  var verified = m.ranked.filter(function (a) { return a.key === 'united'; });
  var derived = m.ranked.filter(function (a) { return a.instrumented && a.key !== 'united'; });
  var coarse = m.ranked.filter(function (a) { return !a.instrumented; });
  function names(list) { return list.map(function (a) { return a.name; }).join(', '); }

  /* a REAL worked per-flight example, pulled out of today's route cache */
  var ex = (function () {
    var rk = Object.keys(m.D.routes || {});
    for (var i = 0; i < rk.length; i++) {
      var r = m.D.routes[rk[i]];
      var f = (r.flights || []).filter(function (x) {
        return typeof x.prob === 'number' && typeof x.obs === 'number';
      }).sort(function (a, b) { return b.obs - a.obs; })[0];
      if (f) return { route: rk[i], label: r.label || rk[i], f: f };
    }
    var ck = Object.keys(m.D.routeCache || {});
    for (var j = 0; j < ck.length; j++) {
      var g = (m.D.routeCache[ck[j]].flights || [])[0];
      if (g) return { route: ck[j], label: ck[j], f: g };
    }
    return null;
  })();

  /* ── SCOPED CSS ─────────────────────────────────────────────────────────
   * Two components the design system has no rule for yet: the worked-example
   * block and the field-report form. Everything else on this page is built out
   * of primitives that live in assets/site.css, which is the file this page is
   * not allowed to touch.
   *
   * The old `.tiers` card set used its own green / amber / grey dots. That broke
   * the one colour rule (colour means score band), so the ladder is a ruled
   * table now and those three hues are gone. */
  var css = '<style>\n' +
    '.wex{background:var(--bg-inset);border:1px solid var(--rule);padding:14px 16px;' +
    'font-family:var(--mono);font-size:13.5px;line-height:1.7;color:var(--ink-2);' +
    'overflow-x:auto;margin-top:12px;white-space:pre-wrap}\n' +
    '.wex b{color:var(--ink);font-weight:700}\n' +
    '.wex .r{color:var(--ink);font-weight:700}\n' +
    '.blk h3.apih{font-size:17px;font-weight:700;margin-top:26px}\n' +
    /* the intake form */
    '.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}\n' +
    '.frm{margin-top:16px;border:1px solid var(--rule);background:var(--bg-panel);padding:18px 20px}\n' +
    '.ffgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 16px}\n' +
    '@media(max-width:820px){.ffgrid{grid-template-columns:repeat(2,1fr)}}\n' +
    '@media(max-width:520px){.ffgrid{grid-template-columns:1fr}}\n' +
    '.ff{display:flex;flex-direction:column;min-width:0}\n' +
    '.ff.full{grid-column:1/-1}\n' +
    '.ff label{font:700 9.5px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;' +
    'color:var(--ink-3);margin-bottom:6px}\n' +
    '.ff input,.ff select,.ff textarea{background:var(--bg-inset);color:var(--ink);' +
    'border:1px solid var(--rule-2);border-radius:0;padding:10px 12px;font:400 14px/1.4 var(--sans);' +
    'width:100%;min-width:0}\n' +
    '.ff input,.ff select{font-family:var(--mono);letter-spacing:.04em}\n' +
    '.ff textarea{font-family:var(--sans);resize:vertical}\n' +
    '.ff input:focus,.ff select:focus,.ff textarea:focus{outline:none;border-color:var(--ink-2)}\n' +
    '.ff .fh{font-size:11.5px;color:var(--ink-3);margin-top:5px}\n' +
    '.ferr{font:700 11.5px/1.5 var(--mono);color:var(--low);margin-top:5px}\n' +
    '.ferr:empty{display:none}\n' +
    '.frm .ff.bad input,.frm .ff.bad select,.frm .ff.bad textarea{border-color:var(--low)}\n' +
    '.frm-top{margin:0 0 12px}\n' +
    '.frm-ft{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-top:18px;' +
    'padding-top:14px;border-top:1px solid var(--rule)}\n' +
    '.frm-ft p{flex:1 1 380px;max-width:70ch}\n' +
    '.frm-ok{font-size:14px;color:var(--good);margin-top:14px}\n' +
    '.frm-ok:empty{display:none}\n' +
    '</style>\n';

  /* ── the progressive-enhancement layer for the intake ────────────────────
   * With this script blocked the form still posts: it is a real
   * <form method="post" action="/api/report"> and the endpoint accepts
   * urlencoded bodies for exactly that reason. What the script buys is the
   * error placement. `error.fields` comes back as {fieldName: reason}, and each
   * reason lands in the <p class="ferr" id="e-{field}"> beside its own input
   * instead of replacing the page with a JSON dump.
   * No third-party bytes: this is inline, same-origin, and posts nowhere else. */
  var formJs = '<script>\n(function(){"use strict";\n' +
    'var f=document.getElementById("rform");if(!f||!window.fetch)return;\n' +
    'var ok=document.getElementById("rform-ok");\n' +
    'function clear(){var e=f.querySelectorAll(".ferr");for(var i=0;i<e.length;i++)e[i].textContent="";\n' +
    'var b=f.querySelectorAll(".ff.bad");for(var j=0;j<b.length;j++)b[j].classList.remove("bad");}\n' +
    'function show(k,msg){var el=document.getElementById("e-"+k);\n' +
    'if(!el){el=document.getElementById("e-_body");}\n' +
    'if(!el)return;el.textContent=(k==="_body"?"":k+" ")+msg;\n' +
    'var w=el.closest?el.closest(".ff"):null;if(w)w.classList.add("bad");}\n' +
    'f.addEventListener("submit",function(ev){\n' +
    'ev.preventDefault();clear();ok.textContent="";\n' +
    'var d={},fd=new FormData(f);fd.forEach(function(v,k){if(String(v).length)d[k]=v;});\n' +
    'var btn=f.querySelector("button[type=submit]");if(btn)btn.disabled=true;\n' +
    'fetch("/api/report",{method:"POST",headers:{"content-type":"application/json"},\n' +
    'body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){return [r.status,j];});})\n' +
    '.then(function(p){var st=p[0],j=p[1];\n' +
    'if(st>=200&&st<300){f.reset();ok.textContent="Thank you. It is stored unpublished and a person '+
    'reads it before it appears on this page.";return;}\n' +
    'var fl=j&&j.error&&j.error.fields;\n' +
    'if(fl){for(var k in fl){if(Object.prototype.hasOwnProperty.call(fl,k))show(k,fl[k]);}}\n' +
    'else{show("_body",(j&&j.error&&j.error.message)||"That did not go through. Try again in a moment.");}\n' +
    '}).catch(function(){show("_body","That did not go through. Try again in a moment.");})\n' +
    '.then(function(){if(btn)btn.disabled=false;});\n' +
    '});})();\n</script>\n';

  var reps = m.reports || { reports: [], count: 0, present: false };

  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker"><span class="dot"></span>Methodology · data eff ' +
    esc(H.plateDate(m.updated)) + '</span>\n' +
    '  <h1 class="ph">How WiFi Odds knows what it knows</h1>\n' +
    '  <p class="lede">Every number on this site is verified tail by tail by an independent ' +
    'community tracker, derived from an aircraft type, or modelled from what an airline said in ' +
    'public. The page says which. Below: the confidence tiers, the formula with a worked example, ' +
    'the fence around the projected number, the three measurements of Starlink speed that disagree ' +
    'with each other, what the score cannot see, and who the data belongs to.</p>\n' +
    '  <div class="microlinks"><a href="#measured">Promised against measured →</a>' +
    '<a href="#field">Field reports →</a><a href="#credit">Credit →</a>' +
    '<a href="/api/docs/">The API →</a></div>\n' +
    '</header>\n\n' +

    '<div class="chips">' +
    P.kpi(esc(H.plateDate(m.updated)), 'Data effective', 'refreshed daily, re-baked on every build') +
    P.kpi(num(m.registry.length), 'Verified United tails', 'each with its install date') +
    P.kpi(String(m.archiveDays), 'Install days on record', 'since ' + esc(DL.prettyDate(m.firstDay))) +
    P.kpi(String(m.airlineCount), 'Airlines scored', verified.length + ' verified · ' +
      derived.length + ' type-derived · ' + coarse.length + ' coarse') +
    '</div>\n\n' +

    /* ── §1 the ladder ──────────────────────────────────────────────────── */
    '<section class="blk" id="tiers">\n  <div class="sec-h">' +
    '<span class="sub">§1 · The instrumentation ladder</span>' +
    '<h2>How much we actually know, per airline</h2></div>\n' +
    '  <p class="sec-lede">The tier is not a disclaimer under the answer, it is part of the answer. ' +
    'A 27 read off a tail record and a 27 read off a fleet percentage are different claims about the ' +
    'world, and blurring them is the most misleading thing this site could do. The API names the ' +
    'tier every response came from. So does the extension.</p>\n' +
    P.tierTable(m) +
    '  <p class="tblcap">The build derives the split from the data on every run. An ' +
    'airline moves up the moment a verified per-tail feed exists for it, and these lists re-sort ' +
    'themselves. Hawaiian is next. Rows A, B and C answer what is flying today and an airline ' +
    'appears in exactly one of them; row D answers what an airline has promised, so the four ' +
    'names in it are also somewhere above.</p>\n' +
    P.srcLine('reported', 'Tier A and B source data: unitedstarlinktracker.com and ' +
      'alaskastarlinktracker.com, ' + esc(H.plateDate(m.updated)) + '. Tier C: public airline ' +
      'announcements, Jul 2026. Blockers: the two trackers’ own methodology pages for A and B; ' +
      'American’s Starlink release, news.aa.com, 26 May 2026, for D.') +
    '</section>\n\n' +

    /* ── §2 the formula ─────────────────────────────────────────────────── */
    '<section class="blk" id="formula">\n  <div class="sec-h">' +
    '<span class="sub">§2 · The scoring system</span>' +
    '<h2>The formula, worked through</h2></div>\n' +
    '  <p class="sec-lede">ConnectScore answers one question: <b>what is the wifi likely to be on a ' +
    'flight I have not been assigned an aircraft for yet, and is it free once I am on it?</b> A ' +
    'fleet is a list of segments. Each segment is a count of aircraft, a system and a price, and ' +
    'the score is the sum of the segments.</p>\n' +
    '  <div class="wex">ConnectScore = Σ <b>segment share</b> × <b>system quality</b> × ' +
    '<b>free-for-you</b> × 100</div>\n' +
    '  <div class="grid3" style="margin-top:16px">\n' +
    '    <div class="card"><h3>Segment share</h3><p>Aircraft in the segment ÷ aircraft with a ' +
    'published system. Where an airline does not say what is flying on part of its fleet, those ' +
    'aircraft are left out of the denominator instead of being assumed into it, and every airline ' +
    'page prints how many that was. Where an airline publishes no counts at all and only says ' +
    '&ldquo;fleetwide&rdquo;, a stated coverage fraction is used and the basis is reported as ' +
    '<span class="mono">fleetwide-coverage</span>.</p></div>\n' +
    '    <div class="card"><h3>System quality</h3><p>Anchored to Ookla’s 2H 2025 provider medians ' +
    'and tenth percentiles. Starlink and Amazon Leo score ' +
    m.A.SYSTEM_QUALITY.starlink.toFixed(2) + '; Starlink’s tenth percentile of 63.71 Mbps beats ' +
    'every rival’s median. Viasat, 2Ku, Hughes and Thales score ' +
    m.A.SYSTEM_QUALITY.viasat.toFixed(2) + '. Panasonic, Inmarsat and the rest of legacy Ku score ' +
    m.A.SYSTEM_QUALITY.geo.toFixed(2) + ', because their slow decile runs 1.06 to 1.58 Mbps. Gogo ' +
    'ATG-4 gets its own ' + m.A.SYSTEM_QUALITY.atg.toFixed(2) + ': far worse throughput than legacy ' +
    'satellite, far better latency and loss. No connectivity at all scores zero, and six carriers ' +
    'here have aircraft in that row.</p>' +
    P.srcLine('measured', 'Ookla Speedtest Intelligence, 28 Apr 2026, covering 2H 2025. The ' +
      'weights are ours; the arithmetic behind them is in the API.') + '</div>\n' +
    '    <div class="card"><h3>Free-for-you</h3><p>Free for everyone, or free with a free loyalty ' +
    'signup, scores ' + m.A.FREE_FACTOR.free.toFixed(2) + '. A paid status tier, a partial rollout ' +
    'or an unconfirmed claim scores ' + m.A.FREE_FACTOR['loyalty-tier'].toFixed(2) + '. Paid scores ' +
    m.A.FREE_FACTOR.paid.toFixed(2) + '. Working WiFi you have to buy at 35,000 feet is not the ' +
    'same product as working WiFi you just connect to.</p></div>\n' +
    '  </div>\n' +
    '  <h3 class="apih">Worked example: ' + esc(ua.name) + ', every aircraft it flies</h3>\n' +
    '  <div class="wex">' +
    ua.segments.map(function (r) {
      return (r.systemLabel + '            ').slice(0, 12) + num(r.n).padStart(6) + '  ' +
        (r.share * 100).toFixed(1).padStart(5) + '% × quality <b>' + r.qMin.toFixed(2) +
        '</b> × free <b>' + r.freeFactor.toFixed(2) + '</b> = <b>' + r.pointsMin.toFixed(1) + '</b>';
    }).join('\n') + '\n' +
    'not published' + num(ua.unresolved).padStart(5) + '   left out of the denominator\n\n' +
    'ConnectScore = <span class="r">' + ua.score + ' (' + P.bandWord(ua.score) + ')</span>, ' +
    'next-gen odds = <span class="r">' + ua.nextGenScore + '</span>, which is the ' +
    esc(ua.segments[0].systemLabel) + ' row on its own</div>\n' +
    '  <p class="tblcap">Those are the live numbers, generated at build time by the same function ' +
    'the API and the extension call. The 131-aircraft zero row is the part a single fleet-share ' +
    'number hides: it does not shrink as installs proceed, it shrinks when those aircraft retire. ' +
    '<a href="/airlines/united/">The same ledger on United’s page →</a></p>\n' +
    (ex ? '  <h3 class="apih">Worked example: one flight, from the Verified tier</h3>\n' +
      '  <div class="wex">flight   = <b>' + esc(ex.f.fn) + '</b>' +
      (ex.f.dep ? '  (' + esc(ex.f.dep) + ' departure)' : '') + '\n' +
      'route    = ' + esc(ex.label) + '\n' +
      'observed = ' + ex.f.obs + ' recent departures of that flight number' +
      (ex.f.aircraft ? '\naircraft = ' + esc(ex.f.aircraft) : '') + '\n\n' +
      'equipped on <b>' + ex.f.prob + '%</b> of those ' + ex.f.obs + ' departures → ' +
      '<span class="r">per-flight odds ' + ex.f.prob + '%</span>, confidence ' +
      esc(ex.f.conf || 'n/a') + '</div>\n' +
      '  <p class="tblcap">This is what the Verified tier buys you, and why the fleet-wide ' +
      ua.score + ' is the wrong number to quote for a specific flight in either direction. ' +
      'Confidence is the sample size: low under 10 observations, medium 10 to 15, high 16 or more. ' +
      '<a href="/united/">Rank a whole route →</a></p>\n' : '') +
    '</section>\n\n' +

    /* ── §3 the projected score. The rules live on /race/ in full; this is the
     *    method half, and it is what /race/ links back to. */
    '<section class="blk" id="projected">\n  <div class="sec-h">' +
    '<span class="sub">§3 · The projected score</span>' +
    '<h2>The fourth number, and the five rules it obeys</h2>' +
    '<a class="more" href="/race/#projected">all four projections →</a></div>\n' +
    '  <p class="sec-lede">' + esc(m.A.PROJECTION_METHOD_LINE) + '</p>\n' +
    '  <div class="grid2" style="margin-top:16px">\n' +
    '    <div class="card"><h3>FIRM</h3><p style="margin:6px 0 10px">' +
    P.projected(m.A.scoreAirline('american')) + '</p>' +
    '<p>Signed, aircraft count published, date published. American committed 500-plus Airbus ' +
    'narrowbodies out of 989 with a published system, with installs from the first quarter of ' +
    '2027.</p>' + P.srcLine('reported', 'Runway Girl Network, 26 May 2026.') + '</div>\n' +
    '    <div class="card"><h3>SOFT</h3><p style="margin:6px 0 10px">' +
    P.projected(m.A.scoreAirline('jetblue')) + '</p>' +
    '<p>Signed, and one of the count or the date rests on secondary reporting. JetBlue’s ' +
    'roughly-a-quarter figure comes from trade reporting of which sub-fleet gets it first, and two ' +
    'sources disagree about the denominator.</p>' +
    P.srcLine('reported', 'JetBlue press release, 4 Sep 2025; sub-fleet detail from trade ' +
      'reporting.') + '</div>\n' +
    '  </div>\n' +
    '  <p class="tblcap">SLIPPED is the third state. When a horizon passes with nothing installed ' +
    'the figure takes a hatched ground, greys further, and keeps showing the date that was missed. ' +
    'Nothing is quietly rolled forward. That flip is computed from the build date, so it does not ' +
    'wait for anyone to notice, and the build asks every projection what it becomes the day after ' +
    'its own horizon and fails if the answer is anything else. No carrier is slipped today, which ' +
    'is why there is no live example of it on this page.</p>\n' +
    '</section>\n\n' +

    /* ── §4 PROMISED AGAINST MEASURED ───────────────────────────────────────
     * The most interesting fact in this subject is that the serious
     * measurements disagree with each other by two to five times and nobody has
     * explained why. Anyone quoting one of them without the others is picking a
     * number. All three, with their methods, or none. */
    '<section class="blk" id="measured">\n  <div class="sec-h">' +
    '<span class="sub">§4 · Promised against measured</span>' +
    '<h2>Three credible measurements of the same thing, two to five times apart</h2></div>\n' +
    '  <p class="sec-lede">Every score here rests on the claim that low-earth orbit is better than ' +
    'geostationary, and it is. What the record does not support is any single Starlink speed ' +
    'number. Three sources published a method, and they disagree by a factor of two to five. We ' +
    'publish all three and we do not know which one describes your seat.</p>\n' +
    '  <div class="chips" style="margin:0 0 8px">' +
    P.kpi('85.2', 'Per-device median, Mbps', 'IQR 60.2 · minimum observed 18.6 · 88 Starlink tests ' +
      'across 25 flights and 7 airlines, on rooted handsets running an open testbed') +
    P.kpi('64 to 65', 'Per-device median, Mbps', 'the only two flights in the literature where ' +
      'cabin load was recorded, both nearly full. The same terminal on a rooftop in Pisa did 188') +
    P.kpi('152 to 320', 'Per-airline median, Mbps', 'crowdsourced and self-selected. Q1 2025 all ' +
      'Starlink, then 2H 2025 United. People run a speed test when the wifi feels notable') +
    P.kpi('21×', 'Inside one airline', 'Ookla measured United under three provider labels in 2H ' +
      '2025: Starlink 319.99 Mbps, Intelsat 56.48, Inmarsat 15.34. Those are Ookla’s names for ' +
      'the networks, not United’s names for its equipment, and the callout below works through ' +
      'the difference') +
    '</div>\n' +
    P.srcLine('measured', 'Jang, Varvello, Raman and Zaki, ACM IMC ’25, 28 to 31 Oct 2025 · ' +
      'Ullah, Borgianni, Kokkinen, Anttonen and Giordano, arXiv:2508.09839, Aug 2025 · ' +
      'Ookla Speedtest Intelligence, 30 Jun 2025 and 28 Apr 2026.') +
    '  <div class="grid2" style="margin-top:20px">\n' +
    '    <div class="card"><h3>What Amazon Leo promises</h3>' +
    '<p>Up to 1 Gbps down and 400 Mbps up simultaneously, from one antenna per aircraft where ' +
    'Starlink needs two radomes, installed in a single day. On paper Leo wins on upload by an ' +
    'order of magnitude and on install simplicity.</p>' +
    '<p>In the air it has zero aircraft and roughly an eighth of a constellation: about 390 to 400 ' +
    'satellites of a planned 3,232. No passenger has measured any of it, which is why there is no ' +
    'Leo speed figure anywhere on this site.</p>' +
    P.srcLine('vendor', 'Amazon Leo aviation antenna announcement, 13 Apr 2026. Constellation ' +
      'count: GeekWire and Via Satellite, 2 to 8 Jul 2026, against the FCC licence for 3,232.') +
    '</div>\n' +
    '    <div class="card"><h3>Latency is physics, not tuning</h3>' +
    '<p>Starlink: 90% of 322 traceroutes under 40 ms. Geostationary, from the same 2025 study: ' +
    'over 99% of 949 traceroutes above 550 ms. Geostationary orbit is 35,786 km up, so the round ' +
    'trip alone costs about 477 ms at the speed of light before anything processes a packet. No ' +
    'amount of bandwidth closes that while the satellite stays where it is.</p>' +
    P.srcLine('measured', 'Jang et al., ACM IMC ’25. Orbital altitude is a definition, not ' +
      'a measurement.') + '</div>\n' +
    '  </div>\n' +
    '  <div class="callout" style="margin-top:18px"><h3>The variable nobody tracks: the box in the ' +
    'ceiling</h3><p>Ookla’s sample was 81% Wi-Fi 5 aircraft, 11% Wi-Fi 6 and 8% Wi-Fi 4, with no ' +
    'Wi-Fi 7 at all. Holding the satellite constant, Starlink’s median rose 24% from Wi-Fi 5 to ' +
    'Wi-Fi 6, from 140.35 to 173.86 Mbps. Viasat’s tenth-percentile floor more than doubled over ' +
    'the same step, from 11.15 to 25.64. Consistency by generation runs 14.9%, then 28.8%, then ' +
    '56.9%. A Wi-Fi 4 access point shared by 180 people gives out long before the satellite link ' +
    'does, and almost no consumer-facing site records which one your aircraft has.</p>' +
    P.srcLine('measured', 'Ookla Speedtest Intelligence, 28 Apr 2026. Consistency is Ookla’s own ' +
      'metric: the share of samples clearing 25 Mbps down and 3 Mbps up together.') + '</div>\n' +

    /* Added 2026-07-26. Ookla and Martin's tracker name United's non-Starlink
     * fleet differently and the site had been printing Ookla's labels as if
     * they were United's equipment list. Every claim below was read off the
     * source page rather than taken from a summary. */
    '  <div class="callout" style="margin-top:18px"><h3>Two vocabularies for the same aeroplane, ' +
    'and we cannot join them</h3>' +
    '<p>Ookla files United’s non-Starlink flying under Intelsat and Inmarsat. The per-tail tracker ' +
    'we use files it under Viasat, Panasonic and Thales. Both are reading real data. They are ' +
    'naming different layers of the same stack, and we could not build a mapping between them ' +
    'that a source would license, so we have not built one.</p>' +
    '<p>Ookla says in the article itself that its data cannot isolate a specific aeroplane and ' +
    'that its provider names come out of Speedtest samples. Its taxonomy mixes satellite operators ' +
    'with the integrators who resell them: it notes that Panasonic Avionics runs no satellites of ' +
    'its own and buys capacity from Eutelsat OneWeb and Spacesail, and that Viasat and Inmarsat ' +
    'still appear as two providers three years after Viasat bought Inmarsat. Intelsat has owned ' +
    'the old Gogo commercial aviation business since December 2020 and has belonged to SES since ' +
    'July 2025. A label there is a network, and a network can outlive the company on the invoice.</p>' +
    '<p>The tracker reads the WiFi provider united.com prints against each upcoming flight, so it ' +
    'speaks United’s vocabulary, tail by tail. That vocabulary splits one network across two names ' +
    'of its own: the 35 Thales aircraft are Thales as prime integrator on Viasat’s Ka network, ' +
    'which is how Viasat’s own chief executive described the arrangement to analysts in 2018.</p>' +
    '<p>Here is the part neither story covers. United’s row in Ookla’s airline chart carries a ' +
    'Starlink bar, an Intelsat bar and an Inmarsat bar, and no Viasat bar and no Panasonic bar at ' +
    'all. Those two are the largest non-Starlink fleets United flies, 525 and 407 tails on the ' +
    'tracker’s count. We have no source that reconciles that, and we found no evidence that United ' +
    'operates any Inmarsat system. The ledger uses the tracker because it resolves to a tail and ' +
    'because it is the airline’s own naming; Ookla appears on this site as speeds, never as fleet ' +
    'composition.</p>' +
    P.srcLine('measured', 'Ookla Speedtest Intelligence, 28 Apr 2026, chart series read directly · ' +
      'unitedstarlinktracker.com/fleet, 26 Jul 2026 · Mark Dankberg on Viasat’s FQ3 2018 earnings ' +
      'call, via Runway Girl Network, 9 Feb 2018 · Gogo’s sale of Commercial Aviation to Intelsat, ' +
      '1 Dec 2020 · SES completes Intelsat acquisition, 17 Jul 2025.') + '</div>\n' +
    '</section>\n\n' +

    /* ── §5 MECHANICS. Why the same hardware gives 220 and 12. ─────────────── */
    '<section class="blk" id="variance">\n  <div class="sec-h">' +
    '<span class="sub">§5 · Mechanics</span>' +
    '<h2>Why one passenger gets 220 Mbps and the passenger beside them gets 12</h2></div>\n' +
    '  <p class="sec-lede">Roughly in order of how much variance each one explains. Every ' +
    'mechanism below is measured somewhere, and the last of them can differ between two phones in ' +
    'the same row.</p>\n' +
    '  <div class="faq">\n' +
    '    <div class="q rv"><h3>1. Which satellite network the aircraft is actually on</h3>' +
    '<p>The largest factor and the least visible from a booking page. Inside United’s own fleet: ' +
    '320 Mbps against 56 against 15. Two aircraft in the same livery on the same route, 21 times ' +
    'apart. Any per-airline score that does not decompose by sub-fleet describes no actual ' +
    'aircraft, which is why the ledger on every airline page does.</p>' +
    P.srcLine('measured', 'Ookla, 28 Apr 2026.') + '</div>\n' +
    '    <div class="q rv"><h3>2. The onboard router generation</h3><p>Measured, and tracked almost ' +
    'nowhere. Wi-Fi 4 to Wi-Fi 6 more than doubles Viasat’s floor and adds 24% to Starlink’s ' +
    'median. Eight per cent of the sampled fleet is still Wi-Fi 4.</p>' +
    P.srcLine('measured', 'Ookla, 28 Apr 2026.') + '</div>\n' +
    '    <div class="q rv"><h3>3. Satellite health</h3><p>ViaSat-3 F1 suffered a reflector ' +
    'deployment failure and is estimated to deliver 5 to 10% of its design throughput. Every US ' +
    'Viasat measurement in existence was taken through that satellite, including the ones behind ' +
    'our own 0.55 quality weight. F2 has finished unfolding and is waiting for the FCC to ' +
    'authorise it; F3 is expected in service in August or September 2026. Re-measuring Viasat ' +
    'after those two go live is the single most valuable future data point for this site.</p>' +
    P.srcLine('reported', 'Runway Girl Network, 10 Feb 2026 and 11 Jul 2026.') + '</div>\n' +
    '    <div class="q rv"><h3>4. Beam capacity, and how many aircraft share it</h3>' +
    '<p>Geostationary systems use spot beams, commonly 60 to 80 per satellite, each with fixed ' +
    'capacity shared by everyone underneath it: aircraft, ships and, for Viasat, homes. Busy ' +
    'corridors like the North Atlantic and the Los Angeles to New York transcon put many aircraft ' +
    'under one beam in the same hour. Low orbit has the same problem in a different shape, because ' +
    'the cells move and the corridor does not.</p></div>\n' +
    '    <div class="q rv"><h3>5. The airline’s bandwidth purchase, and per-device shaping</h3>' +
    '<p>Airlines buy committed capacity and no airline publishes what it bought, so two aircraft ' +
    'with identical antennas can be provisioned differently. Ullah’s team hypothesised that the ' +
    'onboard router caps each device so the aircraft total is shared fairly. If that is right, the ' +
    'answer to &ldquo;does it slow down when the cabin is full&rdquo; is that it was already ' +
    'limited, all the time. They labelled it a hypothesis and so do we.</p>' +
    P.srcLine('measured', 'Ullah et al., arXiv:2508.09839, Aug 2025 for the 65 Mbps ceiling. The ' +
      'explanation is their hypothesis and is unconfirmed.') + '</div>\n' +
    '    <div class="q rv"><h3>6. Altitude</h3><p>Uplink measured 33 Mbps above 17,000 feet and 20 ' +
    'Mbps below it. The likely cause is a regulator forcing transmit power down near the ground to ' +
    'protect terrestrial networks. If that is the mechanism, a slower uplink at low altitude is ' +
    'permanent by design and not a defect.</p>' +
    P.srcLine('measured', 'Ullah et al., arXiv:2508.09839, Aug 2025.') + '</div>\n' +
    '    <div class="q rv"><h3>7. The 15-second handover cycle</h3><p>Geoff Huston at APNIC Labs ' +
    'measured Starlink reassigning the terminal on a regular 15-second cycle, with loss events ' +
    'clustering at switchover, spikes of 30 to 50 ms, and a packet drop rate of 1 to 2% unrelated ' +
    'to congestion. His phrase for it: from the perspective of the TCP protocol, Starlink ' +
    'represents an unusually hostile link environment.</p>' +
    P.srcLine('measured', 'Geoff Huston, APNIC Labs, 17 May 2024.') + '</div>\n' +
    '    <div class="q rv"><h3>8. Your own device’s congestion control</h3><p>On the same link, BBR ' +
    'achieved 98 to 105 Mbps median goodput where Cubic managed 15.4 to 27.2 and Vegas under 5. ' +
    'Because Starlink’s loss is not congestion, loss-based algorithms misread it and back off. Two ' +
    'passengers in adjacent seats can differ several-fold from their operating systems alone.</p>' +
    P.srcLine('measured', 'Jang et al., ACM IMC ’25.') + '</div>\n' +
    '    <div class="q rv"><h3>9. DNS filtering putting you in the wrong city</h3><p>All six ' +
    'Starlink flights in the peer-reviewed sample resolved through CleanBrowsing, which has around ' +
    '50 anycast locations and so frequently answers from a distant one. That inflated latency to ' +
    'Google and Facebook by 1.2 times in Frankfurt and 4.6 times in Doha. In the slowest cases DNS ' +
    'resolution accounted for 74% of total download time.</p>' +
    P.srcLine('measured', 'Jang et al., ACM IMC ’25.') + '</div>\n' +
    '    <div class="q rv"><h3>10. There is no service level agreement anywhere in this industry</h3>' +
    '<p>Michael Wildes, writing about business aviation retrofits, put it better than we could: ' +
    'there is no public aircraft-specific SLA on any route, the published performance numbers are ' +
    'network-level averages, they include the dish on a roof in Akron and the dish on a sailboat ' +
    'off Sardinia, and a marketing average is not a contract.</p>' +
    P.srcLine('reported', 'Michael Wildes, GlobalAir.com, 29 May 2026.') + '</div>\n' +
    '  </div>\n' +
    '  <div class="callout" style="margin-top:18px"><h3>One flight, one device, one session</h3>' +
    '<p>Alaska AS894, 22 July 2026. Eight tests over five and a half hours on the same phone in ' +
    'the same session: 3.8 on the ground, then 44.0, 54.1, 67.4, 78.9, 82.6, 84.7 and 130.6 Mbps. ' +
    'Latency went 51, 60, 60, 76, 99, 112, 157, 171 ms. A threefold spread in throughput and a ' +
    '3.4-fold spread in latency inside one flight. That flight averaged 68.3 Mbps against the host ' +
    'site’s own headline average of 193.2, which is what selection bias looks like when you can ' +
    'see both numbers at once. It is the best argument on this page for why a single screenshot ' +
    'proves nothing.</p>' +
    P.srcLine('field', 'starlinkflights.com community speed results, read 25 Jul 2026. ' +
      'Self-selected submissions; the aggregate is treated as anecdote.') + '</div>\n' +
    '</section>\n\n' +

    /* ── §6 COUNTER-EVIDENCE. The four things that cut against us. ─────────── */
    '<section class="blk" id="counter">\n  <div class="sec-h">' +
    '<span class="sub">§6 · Counter-evidence</span>' +
    '<h2>What a hostile reader would use against us</h2></div>\n' +
    '  <p class="sec-lede">On measured speed Starlink wins every published comparison. I looked ' +
    'hard for a speed test that came back bad on a Starlink aircraft and found none, which is ' +
    'exactly why it is our job to publish the four things that cut the other way.</p>\n' +
    '  <div class="faq">\n' +
    '    <div class="q rv"><h3>The whole Starlink network went down for about two and a half ' +
    'hours</h3><p>24 July 2025. SpaceX vice president Michael Nicolls gave the cause as a failure ' +
    'of key internal software services operating the core network. NetBlocks measured global ' +
    'connectivity at 16% of normal. Flightradar24 lost around 5% of its data feeds and warned of ' +
    'reduced coverage. A fleet that has standardised on one constellation goes to zero at the same ' +
    'moment, which is the concrete version of the argument Starlink’s competitors make.</p>' +
    P.srcLine('reported', 'Runway Girl Network, 25 Jul 2025. Search results frequently re-date ' +
      'this as a 2026 outage. There was no network-wide 2026 outage in any source we could verify.') +
    '</div>\n' +
    '    <div class="q rv"><h3>An airline admitting a gap in its own product</h3><p>Cathay Pacific, ' +
    'writing about its own inflight wifi: there are no commercial satellites over the polar ' +
    'regions that airlines can use, so flights to North America’s east coast lose service, and the ' +
    'outage can vary between one and three hours. Cathay is building a portal warning for the ' +
    'drop-out zones. An admission against interest is the strongest evidence in this whole file.</p>' +
    P.srcLine('reported', 'Cathay Pacific, “Better connected: how inflight Wi-Fi works”, updated ' +
      '31 Mar 2026.') + '</div>\n' +
    '    <div class="q rv"><h3>Starlink aviation filters your DNS</h3><p>Every Starlink flight in ' +
    'the peer-reviewed sample resolved through CleanBrowsing, a filtering resolver, which inflated ' +
    'latency to major sites by 1.2 to 4.6 times depending on which anycast city answered. This is ' +
    'the hardest evidence available that inflight networks manipulate traffic, and it is on the ' +
    'provider that wins every speed comparison.</p>' +
    P.srcLine('measured', 'Jang et al., ACM IMC ’25.') + '</div>\n' +
    '    <div class="q rv"><h3>Every US Viasat measurement was taken on a crippled satellite</h3>' +
    '<p>ViaSat-3 F1 delivers an estimated 5 to 10% of design throughput and it is what powers the ' +
    'mainland routes people have been testing. Until F2 and F3 are live, every Viasat number on ' +
    'this site, our ' + m.A.SYSTEM_QUALITY.viasat.toFixed(2) + ' quality weight included, is ' +
    'measured against hardware that failed to unfold.</p>' +
    P.srcLine('reported', 'Runway Girl Network, 10 Feb 2026 and 11 Jul 2026.') + '</div>\n' +
    '  </div>\n' +
    '  <div class="caveat" style="margin-top:16px">Free wifi does get congested at scale, and it ' +
    'is happening now, on Viasat and Panasonic. Viasat’s aviation president Don Buchman said on ' +
    'the record that there was not as much capacity on orbit as planned. Whether Starlink hits the ' +
    'same wall going from hundreds of aircraft to thousands is open, and nobody has published ' +
    'evidence either way. ' + P.cls('reported') + ' The Points Guy, 2 Jul 2026.</div>\n' +
    '</section>\n\n' +

    /* ── §7 FIELD REPORTS + INTAKE ─────────────────────────────────────────── */
    '<section class="blk" id="field">\n  <div class="sec-h">' +
    '<span class="sub">§7 · Field reports</span>' +
    '<h2>Speed tests from people who were on the aircraft</h2></div>\n' +
    '  <p class="sec-lede">These sit beside the measured medians above and never inside them. One ' +
    'person on one flight is a data point about that flight, and no field report has ever moved a ' +
    'ConnectScore. Every row is attributed and dated so you can weigh it yourself.</p>\n' +
    (reps.present
      ? P.reportTable(reps.reports, 'Published field reports · newest first · ' + reps.count +
          ' of them') +
        '  <p class="tblcap">' + esc(reps.means || '') + ' Submitted through the form below and ' +
        'reviewed by a person before publication. Rows we cannot tie to a real flight get ' +
        'dropped.</p>\n' +
        P.srcLine('field', 'Reader submissions, ' +
          esc(reps.earliest || '') + ' to ' + esc(reps.latest || '') +
          '. Median download across the set: ' + (reps.downMedian === null ? 'not computable'
            : reps.downMedian + ' Mbps') + '.')
      : '  <div class="steady">Nothing published yet. The first report through the form below ' +
        'appears here once a person has checked it.</div>\n') +
    '  <h3 class="apih">Send us a reading</h3>\n' +
    '  <p class="sec-lede">If you ran a speed test in the air, the flight number and the date are ' +
    'what make it useful. The form works with JavaScript switched off; with it on, anything wrong ' +
    'comes back next to the field it belongs to.</p>\n' +
    P.reportForm(m) +
    '</section>\n\n' +

    /* ── §8 WHAT WE CANNOT KNOW ────────────────────────────────────────────── */
    '<section class="blk" id="limits">\n  <div class="sec-h">' +
    '<span class="sub">§8 · The limits</span>' +
    '<h2>What we cannot know</h2></div>\n' +
    '  <p class="sec-lede">These are real limits, not hedges. If one of them applies to your ' +
    'flight, no number on this site can fix it, so here they are in plain language with what to do ' +
    'instead.</p>\n' +
    '  <div class="faq">\n' +
    '    <div class="q rv"><h3>Tail swaps inside the last 48 hours</h3><p>Airlines reassign ' +
    'aircraft until departure for maintenance, weather, crew, or a broken jet somewhere else. Our ' +
    'per-flight odds are a <b>history</b> of what has flown that flight number, not a booking of ' +
    'what will. A flight with 80% odds can still board the one unequipped aircraft in the ' +
    'sub-fleet. Re-check the day before, which is what the extension’s Tail-swap Guardian is ' +
    'for.</p></div>\n' +
    '    <div class="q rv"><h3>Airlines with no per-tail feed</h3><p>' + coarse.length + ' of the ' +
    m.airlineCount + ' airlines here have no public, verifiable list of which aircraft are ' +
    'equipped. For those we can only model the fleet share and we will not pretend to more. If you ' +
    'need certainty on one of those carriers, the aircraft type on your itinerary plus whatever ' +
    'the airline said about which sub-fleet it converted first is better information than our ' +
    'score.</p></div>\n' +
    '    <div class="q rv"><h3>Nobody has tested throughput against cabin load</h3><p>Not either ' +
    'peer-reviewed team, not Ookla, not one journalist. Every claim about a full cabin runs on ' +
    'inference, in both directions. I think that is the largest open question in the subject, and ' +
    'the fact that it is still open after two peer-reviewed studies is worth saying out loud.</p>' +
    P.srcLine('measured', 'Reviewed against Jang et al., ACM IMC ’25; Ullah et al., ' +
      'arXiv:2508.09839, Aug 2025; Ookla, 28 Apr 2026.') + '</div>\n' +
    '    <div class="q rv"><h3>No airline publishes what bandwidth it bought</h3><p>Two aircraft ' +
    'with identical antennas can be provisioned differently and there is no way in from outside. ' +
    'The industry is moving toward least-cost routing across multiple orbits, which will bury it ' +
    'one layer deeper still.</p></div>\n' +
    '    <div class="q rv"><h3>Paid tiers and free-wifi policy changes</h3><p>The free-for-you ' +
    'factor is a snapshot of a commercial decision, and those change with a press release and no ' +
    'notice. Cabin-level throttling and free-messaging-only tiers are not modelled at all. Treat ' +
    'the free column as what was true in July 2026, and the airline’s own page as authoritative on ' +
    'price.</p></div>\n' +
    '    <div class="q rv"><h3>Actual speed on the day</h3><p>We score the <b>hardware and the ' +
    'policy</b>, never the throughput. Everything in §5 above is a reason the same aircraft gives ' +
    'two passengers different answers. ConnectScore is the chance of getting the good system. It ' +
    'is not a bandwidth guarantee and it is not a promise that any wifi at all will be ' +
    'working.</p></div>\n' +
    '    <div class="q rv"><h3>Amazon Leo has never been measured by a passenger</h3><p>Zero ' +
    'aircraft carry it, so every Leo figure on this site is a specification and is labelled as ' +
    'one. That is also why two airlines score next-gen zero while holding signed Leo deals.</p>' +
    '</div>\n' +
    '    <div class="q rv"><h3>The gap our own caveat names</h3><p>' + esc(m.A.SCORE_CAVEAT) +
    ' Until July 2026 the score counted only the next-gen part of a fleet and dropped the rest, so ' +
    'Southwest read 0 on 803 aircraft that mostly do have wifi. The segmented model credits older ' +
    'service at what it measures, which is why Southwest now reads ' +
    m.A.scoreAirline('southwest').floor + ' to ' + m.A.scoreAirline('southwest').ceiling +
    ' instead of nothing. The width of that range is the finding: nobody has published which of ' +
    'those 802 aircraft carry which system.</p></div>\n' +
    '  </div>\n</section>\n\n' +

    /* ── §9 FRESHNESS ──────────────────────────────────────────────────────── */
    '<section class="blk" id="freshness">\n  <div class="sec-h">' +
    '<span class="sub">§9 · Data freshness</span>' +
    '<h2>Where every input comes from, and how often</h2></div>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Input</th><th scope="col">Source</th><th scope="col">Cadence</th><th scope="col">Last refresh</th></tr></thead>\n' +
    '    <tbody>\n' +
    '      <tr><td>United fleet and per-tail roster</td><td>unitedstarlinktracker.com</td>' +
    '<td>pulled daily</td><td class="mono">' + esc(m.updated) + '</td></tr>\n' +
    '      <tr><td>United per-flight route history</td>' +
    '<td>unitedstarlinktracker.com check-flight pages</td>' +
    '<td>daily, ' + m.routeCount + ' cached routes</td><td class="mono">' + esc(m.updated) +
    '</td></tr>\n' +
    '      <tr><td>Alaska fleet</td><td>alaskastarlinktracker.com</td><td>pulled daily</td>' +
    '<td class="mono">' + esc(al.asOf || m.updated) + '</td></tr>\n' +
    '      <tr><td>The other ' + coarse.length + ' airlines</td>' +
    '<td>public airline announcements</td><td>reviewed by hand</td>' +
    '<td class="mono">July 2026</td></tr>\n' +
    '      <tr><td>Reader field reports</td><td>the form in §7, published by a person</td>' +
    '<td>committed to assets/reports.json</td><td class="mono">' +
    esc((reps.generated || m.updated).slice(0, 10)) + '</td></tr>\n' +
    '      <tr><td>Measured speed and latency figures</td>' +
    '<td>two peer-reviewed studies and Ookla</td><td>as published</td>' +
    '<td class="mono">2025 to 2026</td></tr>\n' +
    '      <tr><td>Every page, score and chart on this site</td><td>this build</td>' +
    '<td>re-baked on every data commit</td><td class="mono">' + esc(m.updated) + '</td></tr>\n' +
    '    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap">Nothing on wifiodds.com is fetched live. The daily pull commits ' +
    '<a href="/united/data.json">united/data.json</a>, that commit rebuilds every page, and the ' +
    'ConnectScore API reads the same file out of the same deploy. The page, the API and the ' +
    'extension cannot disagree with each other. If the date above is stale, the data is stale ' +
    'everywhere at once and visibly, instead of in one surface quietly.</p>\n' +
    '</section>\n\n' +

    /* ── §10 CREDIT. THE ONE SUBSTANTIAL ACKNOWLEDGEMENT ON THE SITE. ────────
     * Everywhere else a tracker figure carries a plain source line with a date,
     * exactly like any other citation. This is the exception, and it is the
     * exception on purpose: without those two sites the top of our ladder is
     * empty. Do not add a second credit panel to another page. */
    '<section class="blk" id="credit">\n  <div class="sec-h">' +
    '<span class="sub">§10 · Credit</span>' +
    '<h2>The tail data, and the tier model, are @martinamps’ work</h2></div>\n' +
    '  <p class="sec-lede">Tier A exists on this site because of two sites built and maintained ' +
    'by <b>@martinamps</b>: <a href="https://unitedstarlinktracker.com" target="_blank" ' +
    'rel="noopener">unitedstarlinktracker.com</a> and <a href="https://alaskastarlinktracker.com" ' +
    'target="_blank" rel="noopener">alaskastarlinktracker.com</a>. Between them they cover United, ' +
    'Alaska and Hawaiian, which is every carrier on our board where a flight can be resolved to a ' +
    'specific aircraft and that aircraft to an install record. Take those two sites away and the ' +
    'top tier of this one is empty.</p>\n' +
    '  <p class="sec-lede">The Verified, Reported and Predicted tier model that our own ladder is ' +
    'built on is his design as well. He put the data and the model out for anyone to use, and we ' +
    'are using both. Thank you.</p>\n' +
    H.credit('all') +
    '  <h3 class="apih">Citing this</h3>\n' +
    '  <p class="sec-lede">Quote the numbers freely, including in an article or an AI answer. The ' +
    'one condition is that the credit travels with them, because the fleet verification is not ' +
    'ours.</p>\n' +
    '  <div class="wex">ConnectScore and per-flight odds: WiFi Odds (wifiodds.com), data as of ' +
    esc(m.updated) + '.\n' +
    'United tail verification: unitedstarlinktracker.com (@martinamps).\n' +
    'Alaska tail verification: alaskastarlinktracker.com (@martinamps).\n' +
    'All other airlines: public airline announcements, July 2026.</div>\n' +
    '  <p class="tblcap">Every API response carries the same credits in a ' +
    '<span class="mono">sources</span> array so they cannot get separated from the data. ' +
    'Everywhere else on this site a figure from those trackers carries a plain source line with a ' +
    'date, the same as any other citation. <a href="/api/docs/">API docs →</a> · ' +
    '<a href="/llms.txt">llms.txt →</a></p>\n' +
    '</section>\n';

  return H.page({
    title: 'Methodology · how ConnectScore is calculated, and what it cannot see',
    desc: 'The full WiFi Odds method: three confidence tiers, the ConnectScore formula worked ' +
      'through with live numbers, the fence around the projected score, the three published ' +
      'measurements of Starlink speed that disagree by two to five times, reader field reports, ' +
      'and what the score cannot know.',
    canonical: '/methodology/', here: '/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs,
    extraHead: css, body: body, afterWrap: formJs,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'TechArticle',
      headline: 'How ConnectScore is calculated, and what it cannot see',
      url: ORIGIN + '/methodology/',
      dateModified: m.updated,
      description: 'The confidence tiers, the ConnectScore formula with a worked example, the ' +
        'projected-score fencing rules, promised against measured inflight speed, reader field ' +
        'reports, the known limits and the citation block for WiFi Odds.',
      author: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      publisher: { '@id': ORIGIN + '/#org' },
      isPartOf: { '@type': 'WebSite', name: 'WiFi Odds', url: ORIGIN + '/' },
      about: 'Inflight WiFi ConnectScore methodology and data provenance',
      citation: ['https://unitedstarlinktracker.com', 'https://alaskastarlinktracker.com',
        'https://danielja.ng/publications/geoToLeo_imc_2025.pdf', 'https://arxiv.org/abs/2508.09839']
    }, crumbLd(crumbs)]
  });
}

/* ═══ THE WHOLE-DOCUMENT ROUTES ══════════════════════════════════════════
 * /methodology/ and /technology/ arrive from Codex as finished documents, the
 * same way build/templates/home.html did, and they are wired the same way:
 * the file is loaded as-is and ONLY the <head> essentials are injected.
 *
 * NEITHER CALLS H.page(). The templates already carry their own <body>, <nav>,
 * <main id="main"> and <footer>; page() would wrap a second <main> around them,
 * emit a second footer, and nest one navigation inside another. That is the
 * exact fault Render.home()'s header comment records, and it is why the pair of
 * assertions below count landmarks in the finished string rather than trusting
 * that nobody adds page() back in later.
 *
 * THE TITLE AND DESCRIPTION ARE READ OFF THE TEMPLATE, not retyped here. A
 * whole-document template ships its own <title> and its own description meta;
 * copying either into this file would create a second source for one sentence,
 * and the two would disagree the first time Codex revises the document. So the
 * head injector parses them back out and feeds the same strings to the og and
 * twitter tags — one string, three places, one origin. If a template ever
 * loses either tag, that is a build failure and not a default. */
function docHead(tpl, canonical, label) {
  var t = /<title>([\s\S]*?)<\/title>/i.exec(tpl);
  var d = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(tpl);
  if (!t || !t[1].trim()) {
    throw new Error('Render.' + label + ': build/templates/ document has no <title>. The og and ' +
      'twitter tags are built from it, so there is nothing to default to.');
  }
  if (!d || !d[1].trim()) {
    throw new Error('Render.' + label + ': build/templates/ document has no <meta name="description">. ' +
      'The social card description is built from it, so there is nothing to default to.');
  }
  /* The template's own tags are already HTML-escaped in the document; H.esc()
     is applied by headEssentials(), so hand it the DECODED text or every
     ampersand doubles. Only &amp; can appear in a title this build produces. */
  function undo(s) { return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  return H.headEssentials({
    title: undo(t[1].trim()), desc: undo(d[1].trim()), canonical: canonical
  }) + '\n' + siteLd().map(H.ld).join('\n') + '\n';
}

/* One landmark of each kind, asserted on the finished bytes. This is the check
   that fires if anyone reintroduces H.page() here, or if a template is pasted
   in with the chrome duplicated. */
function assertOneDocument(out, label, marker) {
  if (out.indexOf(marker) !== -1) {
    throw new Error('Render.' + label + ': the ' + marker + ' marker is still in the output — the ' +
      'template gained a marker with no matching .replace() here.');
  }
  [['<main', 1], ['<footer', 1], ['<body', 1], ['<title>', 1]].forEach(function (pair) {
    var n = out.split(pair[0]).length - 1;
    if (n !== pair[1]) {
      throw new Error('Render.' + label + ': the built page has ' + n + ' `' + pair[0] + '` (expected ' +
        pair[1] + '). A whole-document template must not also be wrapped by H.page().');
    }
  });
  return out;
}

function wholeDocument(name, canonical, label, marker, transform) {
  var tpl = FS.readFileSync(PATH.join(__dirname, '..', 'templates', name + '.html'), 'utf8');
  if (transform) tpl = transform(tpl);
  /* round 18 P1-02: swap the template's own inline masthead (which hid the three
     location links below 900px) for the shared disclosure component, so all four
     survivor pages carry one button/ARIA contract. Function replacement keeps
     the SVG mark and CTA URL out of String#replace's substitution scanner. */
  var MAST_RE = /<header><div class="wrap"><nav class="nav" aria-label="Main navigation">[\s\S]*?<\/header>/;
  if (MAST_RE.test(tpl)) {
    tpl = tpl.replace(MAST_RE, function () { return H.mastheadV2(canonical); });
  } else {
    throw new Error('Render.' + label + ': could not find the inline masthead to replace with the ' +
      'unified component. The template structure changed.');
  }
  var head = docHead(tpl, canonical, label);
  /* FUNCTION REPLACEMENT, not a string. The injected block carries a data: URI
     favicon and an inline theme-boot script; a literal `$&` or `$'` anywhere in
     either would be read as a substitution pattern by String#replace and would
     silently paste part of the document back into its own <head>. A function
     return value is never scanned for those. */
  return assertOneDocument(tpl.replace(marker, function () { return head; }), label, marker);
}

/* ═══ /methodology/ (V1) ═════════════════════════════════════════════════
 * The provenance page, rebuilt from ~/wifiodds-exchange/design-competition/
 * methodology-v1.html. The generator it replaces is methodologyPageLegacy()
 * above — kept, unrouted, and explained there. */
function methodologyPage() {
  return wholeDocument('methodology', '/methodology/', 'methodologyPage',
    '<!--METHODOLOGY:HEAD_EXTRA-->');
}

/* ═══ /technology/ (V1) ══════════════════════════════════════════════════
 * New route, from ~/wifiodds-exchange/design-competition/technology-v1.html.
 * The evergreen explainer for what the three WiFi eras actually feel like in a
 * seat. It carries no figure from `m`, which is why it takes no argument: every
 * claim on it is prose about hardware generations, and a page that interpolates
 * nothing cannot go stale against data.json. */
function technologyPage() {
  return wholeDocument('technology', '/technology/', 'technologyPage',
    '<!--TECHNOLOGY:HEAD_EXTRA-->');
}

/* ═══ /extension/ ════════════════════════════════════════════════════════
 * The extension's own components, on a page of ours. Everything inside .xw is
 * markup the content script really emits, styled by content.css inlined
 * verbatim, so the walkthrough cannot drift from the product without the build
 * changing too — which is the whole reason it is not a set of screenshots.
 *
 * ONE DELIBERATE DIFFERENCE, and it is a defect report rather than a licence.
 * The extension writes its metric spans flush, so `NEXT-GEN` `64%` `12 tracked`
 * have the textContent "NEXT-GEN64%12 tracked" and STREAMING welds onto its own
 * value. apitest.js fails on that: it is the "37300+" fault the weld check was
 * written for, reaching a screen reader with the layout looking perfect. The
 * template puts one space at each of those 34 boundaries. All of them sit inside
 * .usl-metrics, .usl-ng or .usl-stream-line, every one display:inline-flex, and
 * a whitespace-only text node between flex items renders no box — so no pixel
 * moves and the product's own stylesheet still decides every one of them.
 *
 * That verbatim stylesheet is also why the template carries two style regimes.
 * The .usl-* rules are the product's and are untouched; the demo page's own
 * chrome is scoped under .xw, because it and the site both define .wrap, h1,
 * h2, .card, .grid, .row and .note, and unscoped they fight in both directions.
 *
 * Like technologyPage() it takes no argument: no figure on it comes from `m`.
 * The percentages are dated captures, labelled as captures on the page. */
function extensionPage() {
  return wholeDocument('extension-v3', '/extension/', 'extensionPage',
    '<!--EXTENSION:HEAD_EXTRA-->', function (tpl) {
      assertReleaseTemplateSource(tpl, 'extensionPage');
      var marker = '<!--EXTENSION:RELEASE_META-->';
      if (tpl.split(marker).length !== 3) {
        throw new Error('Render.extensionPage: expected exactly two ' + marker + ' markers.');
      }
      tpl = tpl.split(marker).join('extension v' + esc(RELEASE.version) + ' released ' +
        esc(releaseDate(RELEASE.storePublishedOn)));
      if (tpl.indexOf('<!--EXTENSION:DEMO_ROWS-->') === -1) {
        throw new Error('Render.extensionPage: missing EXTENSION:DEMO_ROWS marker');
      }
      tpl = tpl.replace('<!--EXTENSION:DEMO_ROWS-->', Demo.extensionRowsMarkup());
      var cssMarker = '<!--EXTENSION:PRODUCT_CSS-->';
      var cssPath = PATH.join(__dirname, '..', RELEASE.contentCss.path);
      var productCss = FS.readFileSync(cssPath, 'utf8');
      var productCssHash = CRYPTO.createHash('sha256').update(productCss).digest('hex');
      if (productCssHash !== RELEASE.contentCss.sha256) {
        throw new Error('Render.extensionPage: release-pinned product CSS hash mismatch. expected ' +
          RELEASE.contentCss.sha256 + ', got ' + productCssHash);
      }
      if (tpl.split(cssMarker).length !== 2) {
        throw new Error('Render.extensionPage: expected exactly one ' + cssMarker + ' marker.');
      }
      tpl = tpl.replace(cssMarker, function () { return productCss; });
      var replacements = {
        '<!--EXTENSION:HOST_MATRIX-->': ExtensionPage.hostMatrix(),
        '<!--EXTENSION:WHATS_NEW-->': ExtensionPage.whatsNew(),
        '<!--EXTENSION:FEATURE_INDEX-->': ExtensionPage.featureIndex(),
        '<!--EXTENSION:FEATURE_DEMOS-->': ExtensionPage.featureDemos(),
        '<!--EXTENSION:REFERENCE-->': ExtensionPage.referenceMarkup(),
        '<!--EXTENSION:SCRIPT_DATA-->': ExtensionPage.scriptData()
      };
      Object.keys(replacements).forEach(function (releaseMarker) {
        if (tpl.split(releaseMarker).length !== 2) {
          throw new Error('Render.extensionPage: expected exactly one ' + releaseMarker + ' marker.');
        }
        tpl = tpl.replace(releaseMarker, function () { return replacements[releaseMarker]; });
      });
      var leftovers = (tpl.match(/<!--EXTENSION:[A-Z_]+-->/g) || []).filter(function (name) {
        return name !== '<!--EXTENSION:HEAD_EXTRA-->';
      });
      if (leftovers.length) {
        throw new Error('Render.extensionPage: unmatched extension marker remains: ' + leftovers.join(', '));
      }
      /* Inline elements share one spoken/textContent phrase. Keep a literal
         separator at every generated boundary so `01` + `Flight row` cannot
         become `01Flight row` for screen readers or copied text. */
      return tpl.replace(/<\/(span|b|i|em|strong|small|code|abbr|sup|sub)><(span|b|i|em|strong|small|code|abbr|sup|sub)(\s|>)/g,
        '</$1> <$2$3');
    });
}

/* ═══ /api/docs/ ════════════════════════════════════════════════════════
 * The ONE human page in the /api namespace. Everything else under /api is a
 * Cloudflare Pages Function in functions/api/** and has no file on disk, which
 * is why this is the only /api entry in build/routes.js.
 *
 * The numbers in the worked examples are BAKED from the same scoreAirline() the
 * API calls, so a docs page that shows 58 for Qatar is showing it for the same
 * reason the API and /airlines/qatar/ do. Never type a score in here by hand. */
function apiDocs(m) {
  var crumbs = [['/', 'Home'], ['/api/docs/', 'API']];
  var qr = m.A.scoreAirline('qatar');
  var ua = m.A.scoreAirline('united');
  var keys = m.ranked.map(function (a) { return a.key; }).sort();
  var codes = m.ranked.map(function (a) { return a.code; }).filter(Boolean).sort();

  /* scoped styles: two elements the design system has no rule for yet, and a docs
     page is not a good reason to add global CSS */
  var css = '<style>\n' +
    '.apic{background:var(--field-bg);border:1px solid var(--edge);border-radius:var(--r-md);' +
    'padding:14px 16px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.55;' +
    'color:var(--body);margin-top:12px;white-space:pre}\n' +
    '.apic b{color:var(--accent);font-weight:700}\n' +
    '.apip{font-family:var(--mono);font-size:13px;color:var(--ink);font-weight:700}\n' +
    '.apiv{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:800;' +
    'letter-spacing:.6px;padding:2px 7px;border-radius:999px;border:1px solid var(--edge-strong);' +
    'color:var(--accent)}\n' +
    '.blk h3.apih{font-size:17px;font-weight:800;margin-top:26px}\n' +
    '</style>\n';

  function code(s) { return '<div class="apic">' + esc(s) + '</div>\n'; }

  var endpointRows = [
    ['GET', '/api', 'This index: every endpoint, the airline keys, the flight-number prefixes.'],
    ['GET', '/api/airlines', 'All ' + m.airlineCount + ' airlines, best Streaming score first.'],
    ['GET', '/api/airlines/{key}', 'One airline. Unknown key → 404 JSON with the list of valid keys.'],
    ['GET', '/api/score/{flightNumber}', 'RETIRED 2026-07-26. 410 Gone. A flight number with no ' +
      'date only ever answered what usually happens on the route, not whether YOUR flight has it. ' +
      'Use /api/airlines/{key}, or the WiFi Odds extension for a real per-flight answer.']
  ].map(function (r) {
    return '      <tr><td class="mono"><b>' + r[0] + '</b></td>' +
      '<td class="mono">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>';
  }).join('\n');

  var freeRows = Object.keys(P.FREE).map(function (k) {
    return '      <tr><td class="mono"><b>' + esc(k) + '</b></td>' +
      '<td class="num">' + m.A.freeFactor(k).toFixed(2) + '</td>' +
      '<td>' + esc(P.FREE[k]) + '</td></tr>';
  }).join('\n');

  var sysRows = Object.keys(m.A.SYSTEM_QUALITY).map(function (k) {
    return '      <tr><td class="mono"><b>' + esc(k) + '</b></td>' +
      '<td class="num">' + m.A.SYSTEM_QUALITY[k].toFixed(2) + '</td>' +
      '<td>' + esc(m.A.SYSTEM_LABEL[k] || '—') + '</td>' +
      '<td>' + esc(m.A.QUALITY_TIER_LABEL[m.A.SYSTEM_TIER[k]] || '') + '</td></tr>';
  }).join('\n');

  var errRows = [
    ['404', 'unknown_airline', 'No airline with that key.'],
    ['405', 'method_not_allowed', 'Read-only API. GET or HEAD.'],
    ['410', 'endpoint_retired', '/api/score/{flightNumber} only. Retired 2026-07-26, see above.']
  ].map(function (r) {
    return '      <tr><td class="mono"><b>' + r[0] + '</b></td><td class="mono">' + esc(r[1]) +
      '</td><td>' + esc(r[2]) + '</td></tr>';
  }).join('\n');

  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker"><span class="dot"></span>WiFi Odds API <span class="apiv">v0</span></span>\n' +
    '  <h1 class="ph">The WiFi Odds API</h1>\n' +
    '  <p class="lede">Every Streaming score on this site, as JSON. Free, no key, no accounts, no ' +
    'rate limit, CORS open to every origin. Read-only. Each response carries a <b>sources</b> array ' +
    'with the data credits. Please keep it attached when you re-publish.</p>\n' +
    '  <div class="microlinks"><a href="/airlines/">The same data as a table →</a>' +
    '<a href="/united/data.json">The full United dataset (JSON) →</a>' +
    '<a href="/llms.txt">llms.txt →</a></div>\n' +
    '</header>\n\n' + P.srcLine('reported', 'Fleet and per-tail verification for United, Alaska and Hawaiian: unitedstarlinktracker.com and alaskastarlinktracker.com (@martinamps), ' + esc(H.plateDate(m.updated)) + '. Every other airline from public airline announcements, Jul 2026. <a href="/methodology/#credit">Full credit and citation →</a>') + '\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Try it</h2></div>\n' +
    code('curl -s ' + ORIGIN + '/api/airlines | head -40\n' +
      'curl -s ' + ORIGIN + '/api/airlines/qatar\n' +
      'curl -s ' + ORIGIN + '/api/airlines/united') +
    '  <p class="tblcap">Responses are pretty-printed and gzipped. ' +
    'Cache-Control: public, max-age=3600 on success (the data is refreshed once a day), 300 on errors.</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Endpoints</h2>' +
    '<span class="sub">four, all GET</span></div>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Returns</th></tr></thead>\n' +
    '    <tbody>\n' + endpointRows + '\n    </tbody>\n  </table></div>\n' +

    '  <h3 class="apih">GET /api/airlines</h3>\n' +
    '  <p class="sec-lede">All ' + m.airlineCount + ' airlines, ordered by Streaming score descending. ' +
    'A tied score breaks on fitted coverage (the more of the fleet that score is actually measured ' +
    'on, the higher it ranks), then on name. Same order as the leaderboard, from the same ' +
    'function.</p>\n' +
    code('{\n' +
      '  "count": ' + m.airlineCount + ',\n' +
      '  "asOf": "' + (m.ranked[0].asOf || m.updated) + '",\n' +
      '  "order": "streamingScore desc, ties by fitted coverage then name",\n' +
      '  "airlines": [ … ' + m.airlineCount + ' objects … ],\n' +
      '  "sources": [ … ]\n' +
      '}') +

    '  <h3 class="apih">GET /api/airlines/{key}</h3>\n' +
    '  <p class="sec-lede">Keys are the slugs used in the site URLs: <span class="apip">' +
    esc(keys.join(' · ')) + '</span></p>\n' +
    code('{\n' +
      '  "airline": {\n' +
      '    "key": "qatar",\n' +
      '    "name": ' + JSON.stringify(qr.name) + ',\n' +
      '    "code": "' + qr.code + '",\n' +
      '    "streamingScore": ' + qr.score + ',\n' +
      '    "band": "' + qr.label + '",\n' +
      '    "nextGenScore": ' + qr.nextGenScore + ',\n' +
      '    "nextGen": { "score": ' + qr.nextGenScore + ', "system": "' + qr.system +
      '", "pct": ' + Math.round(qr.nextGenShare * 100) + ' },\n' +
      '    "serviceTier": "' + qr.serviceTier + '",\n' +
      '    "service": { "tier": "' + qr.serviceTier + '", "label": "' + qr.serviceTierLabel +
      '", "rest": ' + JSON.stringify(qr.restTier) + ' },\n' +
      '    "system":  { "key": "' + qr.system + '", "label": "' + qr.systemLabel + '", "quality": ' +
      qr.parts.systemQuality.toFixed(2) + ' },\n' +
      '    "free":    { "status": "free", "factor": ' + qr.parts.freeFactor.toFixed(2) + ' },\n' +
      '    "fleet":   { "equipped": ' + qr.equipped + ', "total": ' + qr.fleet + ', "equippedShare": ' +
      (Math.round(qr.parts.pctEquipped * 10000) / 10000) + ', "equippedPct": ' +
      Math.round(qr.parts.pctEquipped * 100) + ', "basis": "tail-counts" },\n' +
      '    "perFlightOdds": false,\n' +
      '    "tracker": null,\n' +
      '    "future": null,\n' +
      '    "note": "…",\n' +
      '    "asOf": "' + (qr.asOf || m.updated) + '",\n' +
      '    "url": "' + ORIGIN + '/airlines/qatar/"\n' +
      '  },\n' +
      '  "sources": [ … ]\n' +
      '}') +
    '  <p class="tblcap">Abridged, and the response carries more: <span class="mono">floor</span>, ' +
    '<span class="mono">ceiling</span>, <span class="mono">resolution</span> and the ' +
    '<span class="mono">segments[]</span> array the ledger is drawn from. ' + esc(qr.name) +
    ' really is ' + qr.score + ': ' + qr.segments.map(function (r) {
      return esc(r.systemLabel) + ' ' + num(r.n) + ' at ' + r.pointsMin.toFixed(1);
    }).join(' + ') + ' points. <a href="/airlines/qatar/">Same number on the page →</a></p>\n' +

    '  <h3 class="apih">GET /api/score/{flightNumber}, retired 2026-07-26</h3>\n' +
    '  <p class="sec-lede">Answers <b>410 Gone</b> now. It used to take a flight number with no date ' +
    'and answer "what usually happens on this route," which reads like "will MY flight have it" but ' +
    'is a different question. A route history is not a guarantee about one departure, and the real ' +
    'per-flight answer needs a date this endpoint never took.</p>\n' +
    '  <p class="sec-lede">The deterministic answer moved to the ' +
    '<a href="' + esc(H.EXT) + '">WiFi Odds browser extension →</a>, which runs on united.com, Navan, ' +
    'alaskaair.com and Google Flights. Those pages already carry the flight and the date, so it needs ' +
    'no proxy and no scraping. For United specifically, ' +
    '<span class="mono">unitedstarlinktracker.com/check-flight/{flightNumber}/{date}</span> answers ' +
    'the same way. Prefixes we used to route: <span class="apip">' + esc(codes.join(' ')) + '</span></p>\n' +
    code('$ curl -s ' + ORIGIN + '/api/score/UA212\n' +
      '{\n' +
      '  "error": { "status": 410, "code": "endpoint_retired",\n' +
      '             "message": "GET /api/score/{flightNumber} was retired 2026-07-26 …" },\n' +
      '  "useInstead": "' + ORIGIN + '/api/airlines/{key}",\n' +
      '  "handoff": "https://unitedstarlinktracker.com",\n' +
      '  "docs": "' + ORIGIN + '/api/docs/"\n' +
      '}') +
    '  <p class="tblcap">Use <span class="mono">GET /api/airlines/{key}</span> for the fleet-wide ' +
    'figure instead. <a href="/united/">Rank a whole route →</a></p>\n' +
    '</section>\n\n' +

    /* ── the two-number section. Added when the site stopped leading with a single
     * score: an API that returned only streamingScore would have let a caller
     * publish "Delta 49, United 48" and be technically correct and wrong. */
    '<section class="blk">\n  <div class="sec-h"><h2>Two numbers, not one</h2>' +
    '<span class="sub">read both before you quote either</span></div>\n' +
    '  <p class="sec-lede">Every airline object carries <b>streamingScore</b> and ' +
    '<b>nextGenScore</b>, and they answer different questions. ' + esc(m.A.TIER_METHOD_LINE) + '</p>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Field</th><th scope="col">What it is</th><th scope="col">Delta, as an example</th></tr></thead>\n' +
    '    <tbody>\n' +
    '      <tr><td class="mono"><b>nextGenScore</b></td><td>Odds of a Starlink or Amazon Leo ' +
    'aircraft × free-for-you. A signed deal contributes nothing.</td>' +
    '<td class="mono">' + m.A.scoreAirline('delta').nextGenScore + '</td></tr>\n' +
    '      <tr><td class="mono"><b>streamingScore</b></td><td>The whole fleet, segment by segment: ' +
    'share × system quality × free-for-you, added up. Credits streaming-class geostationary service ' +
    'at ' + m.A.SYSTEM_QUALITY.viasat.toFixed(2) + ' and no connectivity at 0.</td>' +
    '<td class="mono">' + m.A.scoreAirline('delta').score + '</td></tr>\n' +
    '      <tr><td class="mono"><b>serviceTier</b></td><td><span class="mono">next-gen</span> · ' +
    '<span class="mono">streaming</span> · <span class="mono">basic</span> · ' +
    '<span class="mono">mixed</span>. What the fleet delivers today. ' +
    '<span class="mono">service.rest</span> is the tier on the part that is not next-gen yet, and ' +
    '<span class="mono">"unknown"</span> where we have not verified it.</td>' +
    '<td class="mono">' + esc(m.A.scoreAirline('delta').serviceTier) + '</td></tr>\n' +
    '    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap">Delta is the case worth internalising: <b>0</b> next-gen odds and free, ' +
    'fleetwide, genuinely streaming-class Viasat. Reporting either number without the other misleads. ' +
    '<a href="/systems/">What the hardware actually does →</a> · <a href="/race/">when each fleet ' +
    'finishes →</a></p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The score, field by field</h2>' +
    '<span class="sub">nothing here is transcribed</span></div>\n' +
    '  <div class="panel"><p style="font-family:var(--mono);font-size:14.5px;color:var(--ink)">' +
    'streamingScore = Σ segments[].share × segments[].quality × segments[].free.factor, rounded. ' +
    'It is the FLOOR; ceiling is the same sum at the top of every unpublished split.</p>\n' +
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div></div>\n' +
    '  <div class="grid3" style="margin-top:16px">\n' +
    '    <div class="card"><h3>system.quality</h3><div class="tbl-shell" style="margin-top:10px">' +
    '<table class="tbl" style="min-width:0">\n' +
    '    <thead><tr><th scope="col">key</th><th scope="col">q</th><th scope="col">Label</th><th scope="col">Tier</th></tr></thead>\n    <tbody>\n' + sysRows +
    '\n    </tbody>\n  </table></div></div>\n' +
    '    <div class="card"><h3>free.status</h3><div class="tbl-shell" style="margin-top:10px">' +
    '<table class="tbl" style="min-width:0">\n' +
    '    <thead><tr><th scope="col">status</th><th scope="col">factor</th><th scope="col">Means</th></tr></thead>\n    <tbody>\n' + freeRows +
    '\n    </tbody>\n  </table></div></div>\n' +
    '    <div class="card"><h3>fleet.basis</h3><p><b>tail-counts</b>: the airline publishes equipped ' +
    'and total aircraft, so <span class="mono">equippedShare = equipped / total</span>.</p>' +
    '<p><b>fleetwide-coverage</b>: no tail counts exist (Delta, jetBlue publish only ' +
    '&ldquo;fleetwide&rdquo;), so <span class="mono">equipped</span> and <span class="mono">total</span> ' +
    'are <b>null</b> and the share comes from a stated coverage fraction.</p>' +
    '<p class="note">A future deal is never scored. <span class="mono">future</span> is reported and ' +
    'contributes zero until the hardware flies.</p></div>\n' +
    '  </div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Errors</h2>' +
    '<span class="sub">always JSON, always with sources</span></div>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Status</th><th scope="col">code</th><th scope="col">When</th></tr></thead>\n' +
    '    <tbody>\n' + errRows + '\n    </tbody>\n  </table></div>\n' +
    code('$ curl -s ' + ORIGIN + '/api/airlines/nope\n' +
      '{\n' +
      '  "error": { "status": 404, "code": "unknown_airline",\n' +
      '             "message": "No airline with key \\"nope\\" …" },\n' +
      '  "docs": "' + ORIGIN + '/api/docs/",\n' +
      '  "keys": [ … ],\n' +
      '  "sources": [ … ]\n}') +
    '</section>\n\n' +

    /* ── MCP ─────────────────────────────────────────────────────────────
     * Documented on the API page rather than on a page of its own: it is the same
     * data through a different door, and a reader who is already looking at the
     * JSON is exactly the reader who wants the connector. */
    '<section class="blk">\n  <div class="sec-h"><h2>MCP server</h2>' +
    '<span class="sub">for AI assistants</span></div>\n' +
    '  <p class="sec-lede">There is also an <b>MCP</b> endpoint, so an AI assistant can look these ' +
    'numbers up itself instead of guessing from whatever it remembers about airline WiFi. It speaks ' +
    'streamable HTTP: JSON-RPC 2.0 over <span class="apip">POST /mcp</span>, no key, no account, ' +
    'CORS open, and no session required for a single call.</p>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th scope="col">Tool</th><th scope="col">Arguments</th><th scope="col">Returns</th></tr></thead>\n' +
    '    <tbody>\n' +
    '      <tr><td class="mono"><b>get_airline_score</b></td><td class="mono">key</td>' +
    '<td>One airline: Streaming score, system, fleet share, cost onboard, and the confidence tier the ' +
    'number comes from.</td></tr>\n' +
    '      <tr><td class="mono"><b>list_airline_scores</b></td><td class="mono">none</td>' +
    '<td>All ' + m.airlineCount + ' airlines, best odds first. One call instead of eighteen.</td></tr>\n' +
    '    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap">No <span class="mono">score_flight</span> tool. Retired 2026-07-26 ' +
    'alongside <span class="mono">/api/score/{flightNumber}</span>, for the same reason: a flight ' +
    'number with no date is not the question a traveller with a booked seat is actually asking. This ' +
    'server answers at the airline level only. The ' +
    '<a href="' + esc(H.EXT) + '">browser extension →</a> has the date.</p>\n' +
    code('curl -sS -X POST ' + ORIGIN + '/mcp -H \'content-type: application/json\' \\\n' +
      '  -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'\n\n' +
      'curl -sS -X POST ' + ORIGIN + '/mcp -H \'content-type: application/json\' \\\n' +
      '  -d \'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":\n' +
      '       {"name":"get_airline_score","arguments":{"key":"united"}}}\'') +
    '  <p class="tblcap">Every tool result comes back twice: a text block for the model to relay and ' +
    'a <span class="mono">structuredContent</span> object for the client to parse. The data credits are ' +
    'in both, because the text is what usually reaches the user.</p>\n' +
    '  <div class="faq" style="margin-top:16px">\n' +
    '    <div class="q"><h3>The <span class="mono">instructions</span> field is the point</h3>' +
    '<p>What <span class="mono">initialize</span> returns is not a description of the endpoints. It ' +
    'is the decision layer: someone asking about flight WiFi is trying to maximise <b>hours of working ' +
    'WiFi</b>, so prefer the higher Streaming score, name which confidence tier you are quoting, never ' +
    'invent a per-flight number from a fleet-wide one, and always pass the credits through. A data ' +
    'endpoint with no opinion gets averaged into mush by whichever model is holding it.</p></div>\n' +
    '    <div class="q"><h3>It is the same code as the REST API</h3><p>Each tool is a thin wrapper ' +
    'around the very handler that serves <span class="mono">/api/**</span>. It builds a synthetic GET ' +
    'request and re-shapes the answer. So <span class="mono">get_airline_score("qatar")</span> and ' +
    '<span class="mono">GET /api/airlines/qatar</span> cannot disagree: they are the same call. The ' +
    'acceptance suite asserts exactly that.</p></div>\n' +
    '    <div class="q"><h3>GET returns 405, on purpose</h3><p>This server opens no server-initiated ' +
    'SSE stream, so there is nothing for a GET to subscribe to. It answers with a 405 whose <i>body</i> ' +
    'tells you the POST to make instead. A bare 405 with no bytes is the kind of unhelpful signal ' +
    'this project has been bitten by before.</p></div>\n' +
    '  </div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Using it</h2></div>\n' +
    '  <div class="faq">\n' +
    '    <div class="q"><h3>Credit is the only condition</h3><p>The fleet numbers for United and ' +
    'Alaska are not ours. They come from unitedstarlinktracker.com and alaskastarlinktracker.com, ' +
    'the independent community trackers built by @martinamps. The <span class="mono">sources</span> ' +
    'array is in every response so that the credit travels with the data. Keep it, or reproduce it ' +
    'wherever you show the numbers.</p></div>\n' +
    '    <div class="q"><h3>This API never calls anyone else</h3><p>It reads only our own cached ' +
    'dataset, from the same deploy that served this page. It does not proxy a tracker, an airline, ' +
    'or a flight-status provider, so your traffic can never become their bill. That is also why ' +
    'per-flight odds exist for United only: it is the fleet we have history for.</p></div>\n' +
    '    <div class="q"><h3>No rate limit, so please cache</h3><p>There is no key and no quota. ' +
    'Responses are cacheable for an hour and the underlying data changes once a day, so honour the ' +
    'Cache-Control header rather than polling. If it ever gets abused, a limit is the thing that ' +
    'appears first.</p></div>\n' +
    '    <div class="q"><h3>v0 means v0</h3><p>Fields may be added at any time. Anything already ' +
    'here (<span class="mono">streamingScore</span>, <span class="mono">method</span>, ' +
    '<span class="mono">prob</span>, <span class="mono">sources</span>) will not change meaning ' +
    'without the path changing to <span class="mono">/api/v1/</span>. Every response carries an ' +
    '<span class="mono">x-wifiodds-api</span> header with the version. Deprecated compatibility fields ' +
    '<span class="mono">connectScore</span>, <span class="mono">connectScoreLower</span>, ' +
    '<span class="mono">connectScoreUpper</span>, and <span class="mono">connectScoreExact</span> remain ' +
    'equal aliases during the compatibility window; <span class="mono">x-connectscore-api</span> remains too.</p></div>\n' +
    '    <div class="q"><h3>Not a guarantee</h3><p>Streaming scores and per-flight odds are historical ' +
    'estimates. Aircraft assignments change until departure, and a whole-fleet lower bound is not a ' +
    'prediction about the aircraft you are assigned.</p></div>\n' +
    '  </div>\n</section>\n';

  return H.page({
    title: 'WiFi Odds API — free airline WiFi scores as JSON',
    desc: 'The free public WiFi Odds API: every airline’s inflight Streaming score as JSON, plus ' +
      'per-flight Starlink odds for United. No key, no accounts, CORS open, credits in every response.',
    canonical: '/api/docs/', here: '/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs,
    extraHead: css, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebAPI',
      name: 'WiFi Odds API', url: ORIGIN + '/api/docs/',
      documentation: ORIGIN + '/api/docs/',
      description: 'Free, key-less JSON API for airline inflight WiFi Streaming scores and per-flight ' +
        'United Starlink odds.',
      provider: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      termsOfService: ORIGIN + '/privacy'
    }, crumbLd(crumbs)]
  });
}

/* ═══ /404.html ═════════════════════════════════════════════════════════ */
/* A 404 earns ONE small joke and no second one, and it earns no pitch at all.
 * What it owes the reader is a door: the board, then the two pages people
 * actually come looking for. The flight check that used to sit here left the
 * site in round seven, so this page offers places rather than a control. */
function notFound(m) {
  var body =
    '<header class="hero">\n  <span class="kicker">404</span>\n' +
    '  <h1 class="ph" style="margin-top:.6rem">Page not found</h1>\n' +
    '  <p class="lede">The address may have changed, or the page may no longer exist.</p>\n' +
    '  <div class="btnrow" style="margin-top:1.2rem">' +
    '<a class="btn ghost mini" href="/methodology/">How WiFi Odds calculates scores →</a>' +
    '<a class="btn ghost mini" href="/technology/">The three tiers of inflight WiFi →</a>' +
    '<a class="btn ghost mini" href="/">Back to the homepage →</a></div>\n' +
    '</header>\n\n';
  return H.page({
    title: 'Page not found · WiFi Odds', desc: 'That page does not exist on wifiodds.com.',
    canonical: '/404.html', here: '/', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, body: body,
    jsonld: []
  });
}

/* ═══ THE FOUR TEMPLATE-BACKED PAGES ═══════════════════════════════════════
 * These were hand-authored whole documents until the chrome drifted (see
 * build/lib/tmpl.js for the why). Their unique content now lives verbatim in
 * build/templates/, and they come through H.page() like everything else.
 *
 * The rule for editing them: page CONTENT goes in the template file, page
 * CHROME goes in html.js. Nothing about the shared shell is expressed here.  */

/* ═══ /united/ — the route optimizer app ════════════════════════════════ */
function unitedOptimizer(m) {
  var crumbs = [['/', 'Home'], ['/airlines/united/', 'United'], ['/united/', 'Route optimizer']];
  /* The template is injected, never parsed: the ~1,400 lines of live-tested app
     JS and CSS in it are byte-identical in the output. Only the data-bake
     markers are touched — three in the no-JS stat line, and the route tables. */
  /* The tracker's daily 481/1,808 and United's own quarterly filing count two
     different populations (D1/D6: the tracker includes regional partner tails
     United does not carry in its own consolidated fleet), so this second line
     is a corroboration, never a replacement — both numbers come straight off
     united/data.json's fleet.published, which reconcileUnited() already
     refuses to build without. Nothing here is computed by dividing one
     population's numerator by the other's denominator (see whyBothFields on
     that object); pubPct is published equipped ÷ published total, full stop. */
  var pub = m.fleet.published;
  var pubPct = pub ? Math.round((pub.equipped / pub.total) * 1000) / 10 : null;
  var t = T.bake(T.load('united-optimizer'), {
    'united.equipped': num(m.fleet.equipped),
    'united.total': num(m.fleet.total),
    'site.updated': m.updated,
    'united.pub.equipped': pub ? num(pub.equipped) : '—',
    'united.pub.total': pub ? num(pub.total) : '—',
    'united.pub.pct': pub ? pubPct.toFixed(1) + '%' : '—',
    'united.pub.asof': pub ? H.chipDate(pub.asOf) : '—',
    /* The static route tables inside .no-js-only. This is the page's whole
       answer for a reader with script off, and before it existed the route
       renders zero tables and ten empty containers. See build/lib/nojsroutes.js. */
    'united.nojsroutes': NJ.block(m)
  }, 'united-optimizer');

  return H.page({
    title: 'WiFi Odds · United — Starlink Route Optimizer',
    desc: 'Pick any United route and get the best plan to land a Starlink-equipped plane — every flight ' +
      'ranked by live odds, the smartest routings, confirmed tails, and a booking playbook. Updated daily ' +
      'and on demand.',
    canonical: '/united/', here: '/', suffix: 'United', section: 'united',
    updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs,
    extraHead: t.head, preWrap: t.prewrap, body: t.body, afterWrap: t.foot,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebApplication',
      name: 'United Starlink Route Optimizer', url: ORIGIN + '/united/',
      applicationCategory: 'TravelApplication', operatingSystem: 'Any (web)',
      browserRequirements: 'Requires JavaScript for the live route search',
      description: 'Pick any United route and see every flight ranked by its live Starlink WiFi odds, ' +
        'with the best routings, confirmed equipped tails and a booking playbook.',
      isPartOf: { '@type': 'WebSite', name: 'WiFi Odds', url: ORIGIN + '/' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      creator: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      isBasedOn: { '@type': 'WebSite', name: 'unitedstarlinktracker.com', url: 'https://unitedstarlinktracker.com' }
    }, crumbLd([['/', 'Home'], ['/united/', 'United']])]
  });
}

/* ═══ /united/history/ ══════════════════════════════════════════════════ */
function unitedHistory(m) {
  var crumbs = [['/', 'Home'], ['/airlines/united/', 'United'], ['/united/history/', 'History']];
  var t = T.bake(T.load('united-history'), {
    'united.tails': num(m.registry.length),
    'united.days': String(m.archiveDays),
    'united.first': DL.prettyDate(m.firstDay),
    'united.equipped': num(m.fleet.equipped),
    'united.total': num(m.fleet.total),
    'site.updated': m.updated
  }, 'united-history');

  /* The report block is a SHARED component and this page is one of the five the
     spec puts it on. It is appended to the template body rather than typed into
     build/templates/united-history.html so there is one copy of the form, and so
     the intake's field names live in exactly one place. */
  var histBody = t.body + P.observeBlock('This log knows the day each tail was first seen ' +
    'equipped. It does not know what the connection did on any of them afterwards. If you flew a ' +
    'United aircraft this month, thirty seconds here is a data point nobody else has.', 'hist');

  return H.page({
    title: 'United Starlink install history — day by day',
    /* the day count was hard-coded at 176 while it was hand-authored; it is
       generated now, so it can never fall behind the archive again */
    desc: m.archiveDays + ' days of United Starlink install history: every tail, every aircraft type, ' +
      'and every route and odds movement since ' + DL.shortMonth(m.firstDay) + ' 2025. ' +
      'Data by unitedstarlinktracker.com.',
    canonical: '/united/history/', here: '/', suffix: 'United', section: 'united',
    updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs,
    extraHead: t.head, body: histBody, afterWrap: t.foot,
    jsonld: [datasetLd(m), crumbLd([['/', 'Home'], ['/united/', 'United'],
      ['/united/history/', 'History']])]
  });
}

/* ═══ /alaska/ ══════════════════════════════════════════════════════════ */
function alaskaRollout(m) {
  var al = m.A.scoreAirline('alaska');
  var pct = Math.round(al.parts.pctEquipped * 100);
  var crumbs = [['/', 'Home'], ['/airlines/', 'Airlines'], ['/airlines/alaska/', 'Alaska'],
    ['/alaska/', 'Rollout']];
  var t = T.bake(T.load('alaska-rollout'), {
    'alaska.score': String(al.score),
    'alaska.band': al.label,
    /* the band CLASS is baked too, or a score that crosses a threshold would keep
       the old colour while showing the new word */
    'alaska.bandpill': P.bandChip(al.score),
    'alaska.equipped': num(al.equipped),
    'alaska.fleet': num(al.fleet),
    'alaska.pct': pct + '%',
    'alaska.free': 'free for everyone onboard',
    /* Not "share × quality × free" any more: Alaska is three segments, and the
       two Gogo ones carry most of the fleet. The arithmetic on the page has to be
       the arithmetic the score came from. */
    'alaska.math': al.ledger
      ? al.segments.map(function (r) {
        return num(r.n) + ' ' + r.systemLabel + ' at ' + r.pointsMin.toFixed(1);
      }).join(' + ') + ' = ' + al.score + ' / 100'
      : pct + '% of the fleet equipped × ' + al.parts.systemQuality.toFixed(2) +
        ' system quality (' + al.systemLabel + ') × ' + al.parts.freeFactor.toFixed(2) +
        ' free-for-you = ' + al.score + ' / 100',
    'alaska.nextgen': String(al.nextGenScore),
    'site.updated': m.updated,
    'site.airlines': String(m.airlineCount)
  }, 'alaska-rollout');

  return H.page({
    /* the fleet counts used to be hard-coded in this page's meta description */
    title: 'WiFi Odds · Alaska — Starlink rollout & ConnectScore',
    desc: 'Alaska Airlines’ Starlink rollout: ' + num(al.equipped) + ' of ' + num(al.fleet) +
      ' aircraft equipped (' + pct + '%), the E175 regional fleet complete, mainline just starting. ' +
      'ConnectScore ' + al.score + '/100, free for everyone onboard, and per-flight odds on alaskaair.com. ' +
      'Fleet data from alaskastarlinktracker.com.',
    canonical: '/alaska/', here: '/', suffix: 'Alaska', section: 'alaska',
    updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained, crumb: crumbs,
    extraHead: t.head, body: t.body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        ['Does Alaska have Starlink WiFi?',
          'Yes — the whole E175 regional fleet plus the ex-Hawaiian widebodies carry Starlink, with the ' +
          'mainline 737 fleet only just starting. Alaska’s ConnectScore reflects the share of the ' +
          'combined fleet that is equipped.'],
        ['Is Alaska’s WiFi free?',
          'Yes — where Starlink is installed it is free for everyone onboard, with no loyalty program, ' +
          'tier or purchase required.'],
        ['How many Alaska planes have Starlink?',
          num(al.equipped) + ' of ' + num(al.fleet) + ' (' + pct + '%), verified tail by tail by ' +
          'alaskastarlinktracker.com (@martinamps), an independent community tracker.']
      ].map(function (f) {
        return { '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } };
      })
    }, crumbLd([['/', 'Home'], ['/airlines/', 'Airlines'], ['/alaska/', 'Alaska']])]
  });
}

/* ═══ /feedback/ ═══════════════════════════════════════════════════════ */
function feedbackPage(m) {
  var t = T.load('feedback');
  return H.page({
    title: 'Feedback · WiFi Odds',
    desc: 'Send product feedback about the WiFi Odds site or the browser extension. Message and email required. Screenshots optional.',
    canonical: '/feedback/', here: '/feedback/',
    updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained,
    mastheadV2: true,
    extraHead: t.head, body: t.body, afterWrap: t.foot,
    crumb: [['/', 'Home'], ['/feedback/', 'Feedback']],
    jsonld: [crumbLd([['/', 'Home'], ['/feedback/', 'Feedback']])]
  });
}

/* ═══ /privacy.html ═════════════════════════════════════════════════════ */
function privacyPage(m) {
  /* §4 used to bake live route-cache counts from the /united/ optimizer page.
     That page was removed on 29 Jul 2026 (301 to /), so §4 now states the
     absence of any off-origin call and there is nothing left to bake. */
  var t = T.bake(T.load('privacy'), {}, 'privacy');
  return H.page({
    title: 'Privacy Policy · WiFi Odds for Flights',
    desc: 'Privacy policy for WiFi Odds (wifiodds.com) and the WiFi Odds for Flights browser extension. ' +
      'No accounts, no analytics. The feedback form stores the message and email you submit, plus screenshots if you attach them.',
    /* The file on disk is privacy.html and routes.js keeps it that way, but
       Cloudflare serves it at /privacy and 308s the .html form to it. The
       canonical and the crumb name the URL a reader actually lands on, because
       a canonical pointing at a redirect is a canonical the crawler discards. */
    canonical: '/privacy', here: '/privacy', updated: m.updated, refreshAttemptedOn: m.refreshAttemptedOn, wasRetained: m.wasRetained,
    /* round 18 P1-02: Privacy carries the same unified disclosure masthead as the
       other survivor pages. `here` is '/privacy' — its own path — so NO primary-nav
       link is aria-current, since Privacy is not one of the nav destinations. (It
       was '/' before the Home nav link existed; '/' now matches Home and would
       wrongly mark it current here.) */
    mastheadV2: true,
    extraHead: t.head, body: t.body,
    jsonld: [crumbLd([['/', 'Home'], ['/privacy', 'Privacy']])]
  });
}

module.exports = {
  home: home, airlinesIndex: airlinesIndex, airlinePage: airlinePage,
  fleetPage: fleetPage, roadmapPage: roadmapPage, methodologyPage: methodologyPage,
  technologyPage: technologyPage,
  extensionPage: extensionPage,
  racePage: racePage, systemsPage: systemsPage,
  apiDocs: apiDocs, notFound: notFound,
  unitedOptimizer: unitedOptimizer, unitedHistory: unitedHistory,
  alaskaRollout: alaskaRollout, privacyPage: privacyPage, feedbackPage: feedbackPage,
  recordPage: recordPage,
  datasetLd: datasetLd, crumbLd: crumbLd, DATASET_ID: DATASET_ID
};
