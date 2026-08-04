'use strict';
/* The store listing can lag the extension manifest, so public site copy reads
 * this owner-admitted ledger instead of the extension worktree. The build can
 * validate the record and bind every projection to it; it cannot call the
 * Chrome Web Store to decide what is live. */
var raw = require('../extension-release.json');

function fail(message) {
  throw new Error('extension-release.json: ' + message);
}

function validate(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) fail('record must be an object');
  if (!/^\d+\.\d+\.\d+$/.test(release.version || '')) fail('version must be a semantic version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.storePublishedOn || '') ||
      isNaN(Date.parse(release.storePublishedOn + 'T00:00:00Z'))) {
    fail('storePublishedOn must be a real YYYY-MM-DD date');
  }
  if (!/^[0-9a-f]{40}$/.test(release.extensionCommit || '')) {
    fail('extensionCommit must be a full 40-character commit SHA');
  }
  if (typeof release.submissionEvidence !== 'string' || !release.submissionEvidence.trim()) {
    fail('submissionEvidence must name the owner-verified record');
  }
  if (!Array.isArray(release.highlights) || !release.highlights.length) {
    fail('highlights must be a non-empty ordered array');
  }
  var ids = Object.create(null);
  release.highlights.forEach(function (h, i) {
    if (!h || typeof h !== 'object') fail('highlights[' + i + '] must be an object');
    ['id', 'home', 'full'].forEach(function (key) {
      if (typeof h[key] !== 'string' || !h[key].trim()) fail('highlights[' + i + '].' + key + ' is required');
    });
    if (!/^[a-z][a-z0-9-]*$/.test(h.id)) fail('highlights[' + i + '].id must be a stable slug');
    if (ids[h.id]) fail('duplicate highlight id ' + h.id);
    ids[h.id] = true;
  });
  if (!Array.isArray(release.hosts) || release.hosts.length !== 4) {
    fail('hosts must contain the four shipped booking surfaces');
  }
  var hostIds = Object.create(null);
  release.hosts.forEach(function (host, i) {
    if (!host || typeof host !== 'object') fail('hosts[' + i + '] must be an object');
    ['id', 'name', 'hostname', 'perFlight', 'carrierFallback', 'autoSort', 'prioritize',
      'routePanel', 'guardian'].forEach(function (key) {
      if (typeof host[key] !== 'string' || !host[key].trim()) fail('hosts[' + i + '].' + key + ' is required');
    });
    if (!/^[a-z][a-z0-9-]*$/.test(host.id) || hostIds[host.id]) fail('host ids must be unique stable slugs');
    hostIds[host.id] = true;
  });
  if (!Array.isArray(release.allowedFeatureClaims) || release.allowedFeatureClaims.length !== 6) {
    fail('allowedFeatureClaims must contain the six shipped public capabilities');
  }
  var featureIds = Object.create(null);
  release.allowedFeatureClaims.forEach(function (feature, i) {
    if (!feature || typeof feature !== 'object') fail('allowedFeatureClaims[' + i + '] must be an object');
    ['id', 'title', 'question', 'ceiling'].forEach(function (key) {
      if (typeof feature[key] !== 'string' || !feature[key].trim()) fail('allowedFeatureClaims[' + i + '].' + key + ' is required');
    });
    if (!/^[a-z][a-z0-9-]*$/.test(feature.id) || featureIds[feature.id]) {
      fail('feature ids must be unique stable slugs');
    }
    featureIds[feature.id] = true;
    if (!Array.isArray(feature.steps) || feature.steps.length !== 5 ||
        feature.steps.some(function (step) { return typeof step !== 'string' || !step.trim(); })) {
      fail('allowedFeatureClaims[' + i + '].steps must contain five visible ordered states');
    }
    if (!feature.behaviors || typeof feature.behaviors !== 'object') fail('allowedFeatureClaims[' + i + '].behaviors is required');
    Object.keys(hostIds).forEach(function (hostId) {
      if (typeof feature.behaviors[hostId] !== 'string' || !feature.behaviors[hostId].trim()) {
        fail('allowedFeatureClaims[' + i + '].behaviors.' + hostId + ' is required');
      }
    });
    if (Object.keys(feature.behaviors).sort().join(',') !== Object.keys(hostIds).sort().join(',')) {
      fail('allowedFeatureClaims[' + i + '].behaviors must match the host manifest exactly');
    }
  });
  return release;
}

module.exports = validate(raw);
module.exports.validate = validate;
