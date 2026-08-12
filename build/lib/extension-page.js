'use strict';

var RELEASE = require('./release');

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function hostMatrix() {
  var columns = [
    ['perFlight', 'Flight odds'],
    ['carrierFallback', 'Airline score'],
    ['autoSort', 'Automatic sorting'],
    ['prioritize', 'Move best flight'],
    ['routePanel', 'Route summary'],
    ['guardian', 'Trip Guardian']
  ];
  return '<div class="host-matrix" role="region" aria-label="Booking-site feature coverage" tabindex="0">' +
    '<table><caption class="visually-hidden">WiFi Odds features on each supported booking site</caption>' +
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
  return '<p class="release-version">Chrome Web Store version ' + esc(RELEASE.version) +
    ' · released ' + esc(RELEASE.storePublishedOn) + '</p><div class="release-list">' +
    RELEASE.highlights.map(function (highlight) {
      return '<article class="release-row" data-release-highlight="' + esc(highlight.id) + '">' +
        '<div><span class="release-label">New feature</span><h3>' + esc(highlight.home) + '</h3></div>' +
        '<div><span class="release-label">What it does</span><p>' + esc(highlight.full) +
        '</p></div></article>';
    }).join('') + '</div>';
}

function featureIndex() {
  return '<nav class="feature-index" aria-label="Extension feature index">' +
    RELEASE.allowedFeatureClaims.map(function (feature, i) {
      return '<a class="feature-index-card" data-feature-link="' + esc(feature.id) + '" href="#f-' +
        esc(feature.id) + '"><span class="chapter-n">' + String(i + 1).padStart(2, '0') +
        '</span><b>' + esc(feature.title) + '</b></a>';
    }).join('') + '</nav>';
}

function demoScene(feature) {
  var visuals = {
    rows: ['Flight row', 'NEXT-GEN and STREAMING labels'],
    decision: ['Best WiFi choice', 'Recommendation or a “not enough data” message'],
    sort: ['Flight results', 'New order with Keep site order'],
    route: ['DEN → SFO route summary', 'Flights with scores and flights without them'],
    guardian: ['Trip Guardian', 'Aircraft assignment and update'],
    popup: ['Extension popup', 'Site access and airline lookup']
  };
  var visual = visuals[feature.id];
  var labels = feature.steps.map(function (step, i) {
    return '<div class="frame-state" data-frame-stage="' + i + '"><span>Step ' + (i + 1) +
      ' of 5</span><strong>' + esc(step) + '</strong></div>';
  }).join('');
  return '<div class="feature-frame" data-demo data-demo-frame="' + esc(feature.id) + '" ' +
    'data-feature="' + esc(feature.id) + '" data-stage="0" data-host="united" data-offered="true">' +
    '<div class="frame-chrome"><i></i><i></i><i></i><span data-frame-host>united.com</span></div>' +
    '<div class="frame-body"><div class="replica-row"><div><b>' + esc(visual[0]) + '</b><span>' +
    esc(visual[1]) + '</span></div><span class="replica-metric">Example</span></div>' +
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
      esc(feature.id) + '"><header><div><span class="eyebrow">Example ' + (i + 1) + ' of ' +
      RELEASE.allowedFeatureClaims.length + '</span><h3>' + esc(feature.title) + '</h3></div>' +
      '<button class="demo-play" type="button" data-demo-play ' +
      'aria-pressed="false">Pause demo</button></header><div class="host-tabs" role="group" ' +
      'aria-label="Show ' + esc(feature.title) + ' by booking site">' + buttons + '</div><div class="demo-grid">' +
      demoScene(feature) + '<div class="demo-copy"><p class="host-behavior" data-host-behavior>' +
      esc(feature.behaviors.united) + '</p><p class="evidence-ceiling"><b>What it can tell you</b>' +
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
    ['row-probability', 'Per-flight odds', 'The tracker has dated history for this United or Alaska flight. WiFi Odds can compare it after the sample and confidence checks pass.'],
    ['row-fleet', 'Airline-wide score', 'The booking page does not provide supported flight history. WiFi Odds labels the airline-wide Streaming score so you do not mistake it for this flight’s odds.'],
    ['row-partial', 'Part of the fleet has data', 'The published score covers a named part of the fleet. WiFi Odds shows that limit and leaves the remaining aircraft unknown.'],
    ['row-no-history', 'No usable history', 'The tracker did not return enough history. WiFi Odds shows unknown, does not use 0%, and leaves the row out of the ranking.'],
    ['row-loading', 'Lookup in progress', 'WiFi Odds shows a loading message while it waits for the tracker.'],
    ['row-error', 'Lookup unavailable', 'The tracker request failed. WiFi Odds keeps the booking site’s order and identifies the lookup error.'],
    ['row-not-flight', 'No flight number', 'The booking page did not provide an operating flight number. WiFi Odds can show an airline-wide score, but it cannot rank the row as a known flight.']
  ];
  var decisionStates = [
    ['decision-winner', 'Best WiFi choice', 'WiFi Odds recommends a flight after it finds at least two scored options, an eight-point lead, and medium or high tracker confidence.'],
    ['decision-confirmed', 'Aircraft confirmed', 'The airline has published the aircraft assignment for the travel date. WiFi Odds shows that assignment next to the historical estimate.'],
    ['decision-close', 'No clear winner: close scores', 'The leading flights are less than eight points apart. WiFi Odds shows both estimates without recommending one.'],
    ['decision-low-confidence', 'No clear winner: limited history', 'One flight leads, but the tracker confidence is too low for a recommendation.'],
    ['decision-single', 'Not enough flights to compare', 'One supported flight has a usable score. WiFi Odds leaves the other flights unscored and keeps their order.'],
    ['decision-loading', 'Comparison in progress', 'WiFi Odds waits for the tracker before it shows a recommendation or a no-data message.'],
    ['decision-unavailable', 'Comparison unavailable', 'A tracker request failed. WiFi Odds identifies the error and leaves the page order unchanged.'],
    ['decision-no-data', 'No comparison available', 'The tracker returned no direct-flight history for the route. WiFi Odds keeps the flights unscored.']
  ];
  function group(title, states) {
    return '<h3>' + esc(title) + '</h3>' + states.map(function (state) {
      return '<details id="' + esc(state[0]) + '"><summary>' + esc(state[1]) + '</summary><p>' +
        esc(state[2]) + '</p><p class="reference-meta">Verified product behavior · source: ' +
        'extension release commit ' + esc(RELEASE.extensionCommit.slice(0, 8)) + ' · checked ' +
        esc(RELEASE.storePublishedOn) + '</p></details>';
    }).join('');
  }
  return '<div class="reference-shell">' + group('Messages shown on flight rows', rowStates) +
    group('Messages shown in the Best WiFi choice panel', decisionStates) + '</div>';
}

module.exports = {
  hostMatrix: hostMatrix,
  whatsNew: whatsNew,
  featureIndex: featureIndex,
  featureDemos: featureDemos,
  scriptData: scriptData,
  referenceMarkup: referenceMarkup
};
