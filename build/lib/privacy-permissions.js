'use strict';
/* Customer-facing /privacy §7 must match live Store 3.0.2 manifest
 * 99f6b0b91a06a94e71a98ae458e22142513ff70b. Chrome grant kinds are not the
 * same thing as data flows named in §2. */

function fail(label, message) {
  throw new Error((label || 'privacy permissions') + ': ' + message);
}

function strip(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function permissionTable(html) {
  var match = /<table class="perms">([\s\S]*?)<\/table>/.exec(html);
  if (!match) fail('privacy permissions', 'missing table.perms');
  return match[1];
}

function parseRows(html) {
  var table = permissionTable(html);
  var rows = [];
  var re = /<tr>\s*<td class="mono">([\s\S]*?)<\/td>\s*<td class="kind">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
  var m;
  while ((m = re.exec(table))) {
    rows.push({
      permission: strip(m[1]),
      kind: strip(m[2]),
      why: strip(m[3])
    });
  }
  if (!rows.length) fail('privacy permissions', 'table.perms has no three-column rows');
  return rows;
}

function rowOf(rows, permission) {
  var found = null;
  rows.forEach(function (row) {
    if (row.permission === permission) found = row;
  });
  return found;
}

function requireRow(rows, permission, kind, whyNeedles, label) {
  var row = rowOf(rows, permission);
  if (!row) fail(label, 'missing permission ' + permission);
  if (row.kind !== kind) {
    fail(label, permission + ' kind is ' + JSON.stringify(row.kind) +
      ', expected ' + JSON.stringify(kind));
  }
  (whyNeedles || []).forEach(function (needle) {
    if (row.why.indexOf(needle) === -1) {
      fail(label, permission + ' reason does not name ' + JSON.stringify(needle));
    }
  });
  return row;
}

function validate(html, label) {
  label = label || 'privacy permissions';
  var rows = parseRows(html);
  var names = rows.map(function (row) { return row.permission; });
  var forbidden = names.filter(function (name) {
    return /alaskastarlinktracker\.com|wifiodds\.com/.test(name);
  });
  if (forbidden.length) {
    fail(label, 'lists undeclared host as a Chrome permission: ' + forbidden.join(', '));
  }

  requireRow(rows, 'united.com', 'content_scripts, always', ['United'], label);
  requireRow(rows, 'www.united.com', 'content_scripts, always', ['www'], label);
  requireRow(rows, 'app.navan.com', 'content_scripts, always', ['Navan'], label);
  requireRow(rows, 'alaskaair.com', 'optional grant', ['Optional'], label);
  requireRow(rows, 'www.alaskaair.com', 'optional grant', ['optional Alaska'], label);
  requireRow(rows, 'www.google.com', 'optional grant',
    ['Optional', '/travel/flights', 'usl-dyn-gflights', 'www.google.com/travel/*'], label);
  requireRow(rows, 'unitedstarlinktracker.com', 'host_permissions',
    ['host_permissions', 'United tracker'], label);
  requireRow(rows, 'storage', 'permissions', ['Guard'], label);
  requireRow(rows, 'activeTab', 'permissions', ['popup'], label);
  requireRow(rows, 'scripting', 'permissions',
    ['usl-dyn-alaska', 'usl-dyn-gflights', 'www.google.com/travel/*'], label);
  requireRow(rows, 'alarms', 'permissions',
    ['uslTripCheck', '180 minutes', 'selector'], label);
  requireRow(rows, 'notifications', 'permissions',
    ['Guard', 'post-flight'], label);

  var hostPerms = rows.filter(function (row) { return row.kind === 'host_permissions'; });
  if (hostPerms.length !== 1 || hostPerms[0].permission !== 'unitedstarlinktracker.com') {
    fail(label, 'host_permissions must be unitedstarlinktracker.com only');
  }

  ['united.com', 'www.united.com', 'app.navan.com'].forEach(function (name) {
    var row = rowOf(rows, name);
    if (row.why.toLowerCase().indexOf('not a host_permissions') === -1) {
      fail(label, name + ' must say it is not a host_permissions origin');
    }
  });

  return rows;
}

module.exports = {
  parseRows: parseRows,
  validate: validate
};
