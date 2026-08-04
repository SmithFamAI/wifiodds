'use strict';

var RELEASE = require('./release');

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function hostMatrix() {
  var columns = [
    ['perFlight', 'Per-flight odds'],
    ['carrierFallback', 'Carrier fallback'],
    ['autoSort', 'Auto-sort'],
    ['prioritize', 'Prioritize'],
    ['routePanel', 'Route panel'],
    ['guardian', 'Guardian']
  ];
  return '<div class="host-matrix" role="region" aria-label="Booking-site feature coverage" tabindex="0">' +
    '<table><caption class="visually-hidden">What WiFi Odds can do on each supported booking site</caption>' +
    '<thead><tr><th scope="col">Booking site</th>' +
    columns.map(function (column) { return '<th scope="col">' + esc(column[1]) + '</th>'; }).join('') +
    '</tr></thead><tbody>' + RELEASE.hosts.map(function (host) {
      return '<tr><th scope="row"><b>' + esc(host.name) + '</b><span>' + esc(host.hostname) +
        '</span></th>' + columns.map(function (column) {
          var value = host[column[0]];
          var no = /^(never|not offered|no$|host order)/i.test(value);
          return '<td class="' + (no ? 'matrix-limit' : 'matrix-yes') + '">' + esc(value) + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
}

function whatsNew() {
  return '<div class="release-grid">' + RELEASE.highlights.map(function (highlight, i) {
    return '<article class="release-card" data-release-highlight="' + esc(highlight.id) + '">' +
      '<span class="chapter-n">0' + (i + 1) + '</span><h3>' + esc(highlight.home) + '</h3><p>' +
      esc(highlight.full) + '</p><p class="release-where">Shipped in Chrome Web Store v' +
      esc(RELEASE.version) + '</p></article>';
  }).join('') + '</div><p class="quiet-note"><b>Behaviour change:</b> a supported single-airline ' +
    'page can now sort automatically. The page always says when it moved rows and offers ' +
    '<em>Keep site order</em>.</p>';
}

function featureIndex() {
  return '<nav class="feature-index" aria-label="Extension feature index">' +
    RELEASE.allowedFeatureClaims.map(function (feature, i) {
      return '<a class="feature-index-card" data-feature-link="' + esc(feature.id) + '" href="#f-' +
        esc(feature.id) + '"><span class="chapter-n">' + String(i + 1).padStart(2, '0') +
        '</span><b>' + esc(feature.title) + '</b><span>' + esc(feature.question) + '</span><small>' +
        esc(feature.ceiling) + '</small></a>';
    }).join('') + '</nav>';
}

function demoScene(feature) {
  var visuals = {
    rows: ['Flight row', 'NEXT-GEN and STREAMING labels'],
    decision: ['Decision panel', 'Winner or grounded refusal'],
    sort: ['Captured site order', 'Move, disclose, and undo'],
    route: ['DEN → SFO route panel', 'Supported rows and coverage boundary'],
    guardian: ['Trip Guardian', 'Assignment state and grounded update'],
    popup: ['Extension popup', 'Host access and manual lookup']
  };
  var visual = visuals[feature.id];
  var labels = feature.steps.map(function (step, i) {
    return '<div class="frame-state" data-frame-stage="' + i + '"><span>Stage ' + (i + 1) +
      ' of 5</span><strong>' + esc(step) + '</strong></div>';
  }).join('');
  return '<div class="feature-frame" data-demo data-demo-frame="' + esc(feature.id) + '" ' +
    'data-feature="' + esc(feature.id) + '" data-stage="0" data-host="united" data-offered="true">' +
    '<div class="frame-chrome"><i></i><i></i><i></i><span data-frame-host>united.com</span></div>' +
    '<div class="frame-body"><div class="replica-row"><div><b>' + esc(visual[0]) + '</b><span>' +
    esc(visual[1]) + '</span></div><span class="replica-metric">Live</span></div>' +
    '<div class="limit-state" data-limit-state><b>Not offered here</b><span></span></div>' +
    labels + '</div></div>';
}

function featureDemos() {
  return RELEASE.allowedFeatureClaims.map(function (feature, i) {
    var coverage = RELEASE.hosts.map(function (host) {
      return '<span class="host-coverage-cell" data-host-cell="' + esc(host.id) + '"><b>' +
        esc(host.name) + '</b>' + esc(feature.behaviors[host.id]) + '</span>';
    }).join('');
    var buttons = RELEASE.hosts.map(function (host, hostIndex) {
      return '<button type="button" data-demo-host="' + esc(host.id) + '" aria-pressed="' +
        (hostIndex === 0 ? 'true' : 'false') + '">' + esc(host.name) + '</button>';
    }).join('');
    return '<article class="feature-chapter" id="f-' + esc(feature.id) + '" data-feature-section="' +
      esc(feature.id) + '"><header><div><span class="eyebrow">Demo ' + (i + 1) + ' of ' +
      RELEASE.allowedFeatureClaims.length + '</span><h3>' + esc(feature.title) + '</h3><p>' +
      esc(feature.question) + '</p></div><button class="demo-play" type="button" data-demo-play ' +
      'aria-pressed="false">Pause demo</button></header><div class="host-tabs" role="group" ' +
      'aria-label="Show ' + esc(feature.title) + ' by booking site">' + buttons + '</div><div class="demo-grid">' +
      demoScene(feature) + '<div class="demo-copy"><p class="host-behavior" data-host-behavior>' +
      esc(feature.behaviors.united) + '</p><p class="evidence-ceiling"><b>Evidence ceiling</b>' +
      esc(feature.ceiling) + '</p><ol class="demo-steps" data-demo-fallback>' +
      feature.steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') +
      '</ol></div></div><div class="host-coverage-row" data-feature-coverage="' + esc(feature.id) + '">' +
      coverage + '</div></article>';
  }).join('\n');
}

function scriptData() {
  var hostnames = {};
  RELEASE.hosts.forEach(function (host) { hostnames[host.id] = host.hostname; });
  var behaviors = {};
  RELEASE.allowedFeatureClaims.forEach(function (feature) { behaviors[feature.id] = feature.behaviors; });
  return 'const EXTENSION_DEMO_DATA = ' + JSON.stringify({ hostnames: hostnames, behaviors: behaviors }) + ';';
}

function referenceMarkup() {
  var rowStates = [
    ['row-probability', 'Per-flight probability', 'A dated UA or AS flight history is available. It may enter a comparison when the sample and confidence gates also pass.'],
    ['row-fleet', 'Carrier fleet fallback', 'No supported flight-level history is exposed. The row may show a labelled carrier measure, but it may not masquerade as this flight’s odds.'],
    ['row-partial', 'Partial fleet coverage', 'The published fleet measure covers only a named part of the fleet. The coverage boundary stays visible and unknown aircraft remain unknown.'],
    ['row-no-history', 'No usable history', 'The tracker answered without a usable sample. The extension says unknown, never 0%, and the row cannot rank.'],
    ['row-loading', 'Lookup in progress', 'A temporary loading state appears while the request is genuinely pending. It cannot sit beside a terminal claim.'],
    ['row-error', 'Lookup unavailable', 'The request failed. That is not the same as the tracker reporting no history, so the page order stays unchanged.'],
    ['row-not-flight', 'No operating flight number', 'No flight-specific value is invented. A clearly labelled carrier measure may appear, but it cannot rank this row as a known flight.']
  ];
  var decisionStates = [
    ['decision-winner', 'Best WiFi choice', 'At least two scored flights, a lead of eight points or more, and high or medium tracker confidence clear the recommendation gate.'],
    ['decision-confirmed', 'Winner with confirmed aircraft', 'The airline’s exact-date aircraft assignment appears as a separate grounded fact and can override historical route odds.'],
    ['decision-close', 'No clear winner: close gap', 'The leading flights sit inside the decision floor, so both values remain visible and nobody is crowned.'],
    ['decision-low-confidence', 'No clear winner: limited history', 'A numerical lead exists but its evidence is not decision-grade, so the extension refuses to recommend.'],
    ['decision-single', 'Not enough to compare', 'Only one supported flight has a usable score. Other flights stay unscored and in the booking site’s order.'],
    ['decision-loading', 'Comparison in progress', 'The decision panel is waiting on real lookups and exposes no terminal claim.'],
    ['decision-unavailable', 'Comparison unavailable', 'A request failed. The panel distinguishes that outage from a real no-history answer and leaves order unchanged.'],
    ['decision-no-data', 'No comparison available', 'The tracker answered with no direct-flight history for the route. Unknown is not converted to zero.']
  ];
  function group(title, states) {
    return '<h3>' + esc(title) + '</h3>' + states.map(function (state) {
      return '<details id="' + esc(state[0]) + '"><summary>' + esc(state[1]) + '</summary><p>' +
        esc(state[2]) + '</p><p class="reference-meta">Tier: measured product behaviour · source: ' +
        'extension release commit ' + esc(RELEASE.extensionCommit.slice(0, 8)) + ' · source date: ' +
        esc(RELEASE.storePublishedOn) + '</p></details>';
    }).join('');
  }
  return '<div class="reference-shell">' + group('Seven flight-row states', rowStates) +
    group('Eight decision outcomes', decisionStates) + '</div>';
}

module.exports = {
  hostMatrix: hostMatrix,
  whatsNew: whatsNew,
  featureIndex: featureIndex,
  featureDemos: featureDemos,
  scriptData: scriptData,
  referenceMarkup: referenceMarkup
};
