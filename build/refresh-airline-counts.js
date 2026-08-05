#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AIRLINES_FILE = path.join(ROOT, 'assets', 'airlines.js');
const UA = 'wifiodds-daily/1.0 (+https://wifiodds.com/)';

function text(html) {
  return String(html)
    .replace(/<!--\s*-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#x27|apos);/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoDate(html, label) {
  const m = String(html).match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  if (!m) throw new Error(label + ': dateModified is missing');
  return m[1];
}

function countPair(value, label) {
  const m = value.match(/([\d,]+)\s+of\s+([\d,]+)\s+(?:Alaska Airlines\s+)?aircraft\s+(?:\([^)]*\)\s+)?(?:have Starlink WiFi installed|equipped)/i);
  if (!m) throw new Error(label + ': equipped/total count is missing');
  const equipped = Number(m[1].replace(/,/g, ''));
  const total = Number(m[2].replace(/,/g, ''));
  if (!Number.isInteger(equipped) || !Number.isInteger(total) || equipped < 0 || total <= 0 || equipped > total) {
    throw new Error(label + ': invalid count ' + equipped + '/' + total);
  }
  return { equipped, total };
}

function hubSection(html, key, nextKey) {
  const startToken = 'href="/airlines/' + key + '"';
  const start = html.indexOf(startToken);
  if (start < 0) throw new Error('airlines hub: ' + key + ' section is missing');
  const end = nextKey ? html.indexOf('href="/airlines/' + nextKey + '"', start + startToken.length) : html.length;
  if (end < 0) throw new Error('airlines hub: cannot bound ' + key + ' section');
  return html.slice(start, end);
}

function parseTrackerPages(alaskaHtml, hubHtml) {
  const alaskaDedicated = countPair(text(alaskaHtml), 'Alaska tracker');
  const hawaiian = countPair(text(hubSection(hubHtml, 'hawaiian', 'alaska')), 'Hawaiian hub');
  const alaskaHub = countPair(text(hubSection(hubHtml, 'alaska')), 'Alaska hub');
  if (alaskaDedicated.equipped !== alaskaHub.equipped || alaskaDedicated.total !== alaskaHub.total) {
    throw new Error('Alaska sources disagree: dedicated ' + alaskaDedicated.equipped + '/' + alaskaDedicated.total +
      ', hub ' + alaskaHub.equipped + '/' + alaskaHub.total);
  }
  return {
    alaska: { ...alaskaDedicated, asOf: isoDate(alaskaHtml, 'Alaska tracker') },
    hawaiian: { ...hawaiian, asOf: isoDate(hubHtml, 'airlines hub') }
  };
}

function entryBounds(source, key) {
  const start = source.indexOf('  ' + key + ': {');
  if (start < 0) throw new Error('airlines.js: ' + key + ' entry is missing');
  const end = source.indexOf('\n  },', start);
  if (end < 0) throw new Error('airlines.js: ' + key + ' entry is unterminated');
  return { start, end, body: source.slice(start, end) };
}

function currentCounts(body, key) {
  const m = body.match(/system:\s*"starlink",\s*equipped:\s*(\d+),\s*fleet:\s*(\d+)/);
  if (!m) throw new Error('airlines.js: ' + key + ' headline count is missing');
  return { equipped: Number(m[1]), total: Number(m[2]) };
}

function validateMove(key, current, next) {
  if (next.total !== current.total) {
    throw new Error(key + ': denominator changed ' + current.total + ' -> ' + next.total + '; owner review required');
  }
  const delta = next.equipped - current.equipped;
  if (delta < 0 || delta > 10) {
    throw new Error(key + ': equipped changed ' + current.equipped + ' -> ' + next.equipped +
      '; outside the accepted daily range of 0..10');
  }
  return delta;
}

function replaceOnce(value, re, replacement, label) {
  const matches = value.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
  if (matches.length !== 1) throw new Error(label + ': expected one anchor, found ' + matches.length);
  return value.replace(re, replacement);
}

function updateEntry(source, key, next) {
  const bounds = entryBounds(source, key);
  const current = currentCounts(bounds.body, key);
  const delta = validateMove(key, current, next);
  if (delta === 0) return { source, changed: false, current, next };

  let body = bounds.body;
  body = replaceOnce(body, /asOf:\s*"\d{4}-\d{2}"/, 'asOf: "' + next.asOf.slice(0, 7) + '"', key + ' asOf');
  body = replaceOnce(body, /system:\s*"starlink",\s*equipped:\s*\d+,\s*fleet:\s*\d+/,
    'system: "starlink", equipped: ' + next.equipped + ', fleet: ' + next.total, key + ' headline');
  body = replaceOnce(body, /\{ system:\s*"starlink",\s*n:\s*\d+,\s*free:\s*"free",\s*as:\s*"[\d-]+"/,
    '{ system: "starlink", n: ' + next.equipped + ', free: "free", as: "' + next.asOf + '"', key + ' segment');

  if (key === 'alaska') {
    const atg = /\{ system:\s*"atg",\s*n:\s*(\d+)/.exec(body);
    if (!atg) throw new Error('alaska: ATG segment is missing');
    const legacy = next.total - next.equipped - Number(atg[1]);
    if (legacy < 0) throw new Error('alaska: derived 2Ku count is negative');
    body = replaceOnce(body, /\{ system:\s*"2ku",\s*n:\s*\d+/, '{ system: "2ku", n: ' + legacy, 'alaska 2Ku segment');
    body = replaceOnce(body, /note:\s*"\d+ of \d+ mainline/, 'note: "' + next.equipped + ' of ' + next.total + ' mainline', 'alaska note');
  } else if (key === 'hawaiian') {
    const none = next.total - next.equipped;
    body = replaceOnce(body, /\{ system:\s*"none",\s*n:\s*\d+/, '{ system: "none", n: ' + none, 'hawaiian none segment');
    body = replaceOnce(body, /note:\s*"\d+ of \d+\./, 'note: "' + next.equipped + ' of ' + next.total + '.', 'hawaiian note');
  }

  return {
    source: source.slice(0, bounds.start) + body + source.slice(bounds.end),
    changed: true,
    current,
    next
  };
}

async function fetchPage(url) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), {
    headers: { 'user-agent': UA }, redirect: 'follow'
  });
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  return res.text();
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const alaskaPath = arg('--alaska-html');
  const hubPath = arg('--hub-html');
  const alaskaHtml = alaskaPath ? fs.readFileSync(alaskaPath, 'utf8') : await fetchPage('https://alaskastarlinktracker.com/');
  const hubHtml = hubPath ? fs.readFileSync(hubPath, 'utf8') : await fetchPage('https://airlinestarlinktracker.com/airlines');
  const counts = parseTrackerPages(alaskaHtml, hubHtml);
  let source = fs.readFileSync(AIRLINES_FILE, 'utf8');
  const alaska = updateEntry(source, 'alaska', counts.alaska); source = alaska.source;
  const hawaiian = updateEntry(source, 'hawaiian', counts.hawaiian); source = hawaiian.source;
  if (alaska.changed || hawaiian.changed) {
    const tmp = AIRLINES_FILE + '.tmp';
    fs.writeFileSync(tmp, source);
    fs.renameSync(tmp, AIRLINES_FILE);
  }
  console.log(JSON.stringify({ alaska: { ...counts.alaska, changed: alaska.changed },
    hawaiian: { ...counts.hawaiian, changed: hawaiian.changed } }));
}

module.exports = { parseTrackerPages, updateEntry, validateMove };
if (require.main === module) main().catch(function (error) {
  console.error('refresh-airline-counts: ' + error.message);
  process.exit(1);
});
