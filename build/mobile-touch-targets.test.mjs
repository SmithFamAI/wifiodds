/* Real-browser phone target contract for active routes.
 *
 * Navigation and standalone links need a 44 by 44 CSS-pixel hit area at the two
 * phone widths this project supports. Links inside prose keep the WCAG spacing
 * exception and are not inflated into buttons. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const req = createRequire(path.join(homedir(), '.wo-respo', 'package.json'));
let chromium, webkit;
try {
  ({ chromium, webkit } = req('playwright'));
} catch (error) {
  console.error('mobile-touch-targets: Playwright is unavailable: ' + error.message);
  process.exit(2);
}

const root = process.cwd();
const widths = [375, 390, 440];
const routes = ['/', '/methodology/', '/technology/', '/extension/', '/feedback/', '/privacy'];
const routeFiles = new Map([
  ['/', 'index.html'],
  ['/methodology/', 'methodology/index.html'],
  ['/technology/', 'technology/index.html'],
  ['/extension/', 'extension/index.html'],
  ['/feedback/', 'feedback/index.html'],
  ['/privacy', 'privacy.html']
]);
const mutation = process.env.MOBILE_TARGET_MUTATION || '';

const server = createServer(async function (request, response) {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const rel = routeFiles.get(url.pathname) || url.pathname.replace(/^\//, '');
    if (!rel || rel.includes('..')) throw new Error('unsafe path');
    const body = await readFile(path.join(root, rel));
    response.statusCode = 200;
    response.setHeader('content-type', rel.endsWith('.css') ? 'text/css' :
      rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.svg') ? 'image/svg+xml' :
      rel.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    response.end(body);
  } catch (error) {
    response.statusCode = 404;
    response.end('not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = 'http://127.0.0.1:' + address.port;

let checks = 0;
const failures = [];
function check(ok, label, detail) {
  checks += 1;
  if (!ok) failures.push(label + (detail ? ' :: ' + detail : ''));
}

try {
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of widths) {
        for (const route of routes) {
          const page = await browser.newPage({ viewport: { width, height: 956 } });
          await page.goto(base + route, { waitUntil: 'load' });
          if (mutation === 'footer-nav-shrink') {
            await page.addStyleTag({ content:
              'footer .sitefoot-brand,footer .sitefoot-links>a{min-width:0!important;min-height:0!important;padding:0!important}' });
          }
          if (mutation === 'feature-tour-shrink') {
            await page.addStyleTag({ content:
              '.badge-meta a{display:inline!important;min-width:0!important;min-height:0!important;padding:0!important}' });
          }
          const result = await page.evaluate(function () {
            function visible(el) {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
            }
            function record(el, kind) {
              const r = el.getBoundingClientRect();
              return {
                kind,
                text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
                width: +r.width.toFixed(1),
                height: +r.height.toFixed(1)
              };
            }

            const footerTargets = [...document.querySelectorAll(
              'footer .sitefoot-brand, footer .sitefoot-links>a'
            )].filter(visible).map(el => record(el, 'footer navigation'));

            const privacyStandalone = location.pathname === '/privacy'
              ? [...document.querySelectorAll('main a[href]')].filter(visible).filter(function (el) {
                  const cs = getComputedStyle(el);
                  const parent = el.parentElement;
                  const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
                  const parentText = parent ? (parent.textContent || '').replace(/\s+/g, ' ').trim() : '';
                  const insideSentence = cs.display === 'inline' && parentText.length > own.length + 12;
                  return !insideSentence;
                }).map(el => record(el, 'privacy standalone'))
              : [];

            const homepageFeatureTour = location.pathname === '/'
              ? [...document.querySelectorAll('.badge-meta a[href="/extension/"]')]
                  .filter(visible).map(el => record(el, 'homepage feature tour'))
              : [];

            return {
              targets: footerTargets.concat(privacyStandalone, homepageFeatureTour),
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
          });

          check(result.targets.length > 0,
            `${engineName} ${width} ${route}: at least one scoped target was measured`);
          result.targets.forEach(function (target) {
            check(target.width >= 43.5 && target.height >= 43.5,
              `${engineName} ${width} ${route}: ${target.kind} meets 44 by 44`, JSON.stringify(target));
          });
          check(result.overflow <= 1,
            `${engineName} ${width} ${route}: target repair creates no page overflow`, String(result.overflow));
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  console.error('mobile touch-target checks FAILED: ' + failures.length + ' of ' + checks);
  failures.forEach(failure => console.error('  ' + failure));
  process.exit(1);
}
console.log('mobile touch-target checks PASS: ' + checks +
  ' checks across 5 routes, 3 phone widths, and 2 engines');
