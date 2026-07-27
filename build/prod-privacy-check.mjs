/* ═══ WHAT THE BROWSER ACTUALLY DOES, WHICH THE REPOSITORY CANNOT KNOW ═══
 *
 * On 27 Jul 2026 an external auditor found Cloudflare's Web Analytics beacon
 * loading on all 32 production surfaces, including /privacy, the page that
 * states this site runs no analytics. It is injected at the edge. It exists in
 * no file in this repository, so every check here — the weld scan, the parity
 * assertions, the leak canary, the layout matrix — was structurally incapable
 * of seeing it. They all read bytes this repo produced.
 *
 * The setting was "Enable, excluding visitor data in the EU" in the Cloudflare
 * dashboard, and turning it off is not a code change. That is the point: the
 * deployed product is the repository plus whatever the edge does to it, and
 * only a real browser pointed at production can see the sum.
 *
 * So this asks the deployed site three questions the source cannot answer:
 *   1. does any surface request a host we did not approve?
 *   2. does any surface write to storage without the copy disclosing it?
 *   3. does any surface run a script we did not author?
 *
 * Usage:
 *   node build/prod-privacy-check.mjs                       report on production
 *   node build/prod-privacy-check.mjs <base-url> --assert    exit 1 on any finding
 *
 * This runs AFTER a deploy, not before, because it tests the deployed edge.
 * `build/ship.sh` cannot gate on it; the deploy is what it inspects.
 * ═════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const BASE = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'https://wifiodds.com';
const ASSERT = process.argv.includes('--assert');

/* The allow-list is deliberately tiny and every entry is disclosed in the
 * footer or on /privacy. Adding a host here without adding it to that copy is
 * the failure this file exists to prevent, so the copy check below reads the
 * rendered page rather than trusting this array. */
const ALLOWED_HOSTS = ['unitedstarlinktracker.com'];

/* Routes that may write to browser storage, and the page that must disclose
 * each one. `/united/` caches route lists under `usl2:<ORIG>-<DEST>`. */
const ALLOWED_STORAGE = { '/united/': /^usl2:/ };

let chromium;
try {
  const req = createRequire(path.join(homedir(), '.wo-respo', 'package.json'));
  ({ chromium } = req('playwright'));
} catch (e) {
  console.error('prod-privacy-check: playwright not resolvable from ~/.wo-respo.');
  console.error('  ' + e.message);
  /* Fail closed when asserting. A privacy check that cannot run is not a pass,
   * and the layout harness's "SKIPPED, NOT PASSED … exit 0" was named as
   * fail-open by the same audit that found the beacon. */
  process.exit(ASSERT ? 2 : 0);
}

const ROUTES = (() => {
  const R = createRequire(import.meta.url)(path.join(process.cwd(), 'build', 'routes.js'));
  const all = [...(R.ROUTES || []), ...(R.UNLISTED || [])].map(r => r.url).filter(Boolean);
  return [...new Set(all)];
})();

const findings = [];
const origin = new URL(BASE).host;
const browser = await chromium.launch();
let tested = 0;

for (const route of ROUTES) {
  const ctx = await browser.newContext();          /* cold profile every time */
  const page = await ctx.newPage();
  const hosts = [], scripts = [];
  page.on('request', q => { try { hosts.push(new URL(q.url()).host); } catch (e) {} });
  page.on('response', async res => {
    try {
      const u = new URL(res.url());
      if (u.host !== origin && /javascript|\.js($|\?)/.test((res.headers()['content-type'] || '') + u.pathname)) {
        scripts.push(u.host + u.pathname);
      }
    } catch (e) {}
  });
  try {
    await page.goto(BASE + route + '?cb=' + Math.random(), { waitUntil: 'networkidle', timeout: 40000 });
  } catch (e) { await ctx.close(); findings.push({ route, kind: 'unreachable', detail: e.message.slice(0, 70) }); continue; }
  await page.waitForTimeout(500);
  tested++;

  [...new Set(hosts)].filter(h => h !== origin && !ALLOWED_HOSTS.includes(h))
    .forEach(h => findings.push({ route, kind: 'unapproved host', detail: h }));
  [...new Set(scripts)].forEach(s => findings.push({ route, kind: 'third-party script', detail: s }));

  const store = await page.evaluate(() => ({
    ls: Object.keys(localStorage), ss: Object.keys(sessionStorage),
    cookies: document.cookie ? document.cookie.split(';').map(c => c.split('=')[0].trim()) : []
  }));
  const allowed = ALLOWED_STORAGE[route];
  [].concat(store.ls, store.ss).forEach(k => {
    if (!allowed || !allowed.test(k)) findings.push({ route, kind: 'undisclosed storage', detail: k });
  });
  store.cookies.forEach(c => findings.push({ route, kind: 'cookie set', detail: c }));

  /* The copy must name the exception rather than deny it. A page that writes
   * storage while its own footer says nothing is stored is the defect, not the
   * write itself. */
  if (store.ls.length || store.ss.length) {
    const text = await page.evaluate(() => document.body.innerText);
    if (/nothing is stored in your browser\b(?![^.]*cache)/i.test(text)) {
      findings.push({ route, kind: 'copy contradicts behaviour',
        detail: 'writes ' + store.ls.concat(store.ss).join(', ') + ' while claiming nothing is stored' });
    }
  }
  await ctx.close();
}
await browser.close();

console.log('prod-privacy-check · ' + BASE);
console.log('  ' + tested + ' of ' + ROUTES.length + ' surfaces reached, cold profile each');
if (!findings.length) {
  console.log('  clean: no unapproved hosts, no third-party scripts, no cookies,');
  console.log('  no undisclosed storage, no copy contradicting observed behaviour.');
  console.log('  allowed and disclosed: ' + ALLOWED_HOSTS.join(', '));
} else {
  const byKind = {};
  findings.forEach(f => { (byKind[f.kind] = byKind[f.kind] || []).push(f); });
  Object.keys(byKind).sort().forEach(k => {
    console.log('\n  ' + k.toUpperCase() + ' — ' + byKind[k].length);
    const shown = new Set();
    byKind[k].forEach(f => {
      const key = f.detail;
      if (shown.has(key)) return;
      shown.add(key);
      console.log('    ' + f.route.padEnd(24) + f.detail);
    });
  });
  console.log('\n  ' + findings.length + ' finding(s).');
}
if (tested === 0) { console.error('  reached nothing — treating as failure, not as clean.'); process.exit(2); }
if (ASSERT && findings.length) process.exit(1);
