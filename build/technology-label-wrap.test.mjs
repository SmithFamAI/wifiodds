/* Browser contract for the Technology comparison labels at the narrowest
 * supported widths. A complete label must stay on one rendered text line. */
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
  console.error('technology-label-wrap: Playwright is unavailable: ' + error.message);
  process.exit(2);
}

const root = process.cwd();
const widths = [320, 321, 375];
const mutation = process.env.TECH_LABEL_MUTATION || '';
const server = createServer(async function (request, response) {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const rel = url.pathname === '/technology/' ? 'technology/index.html' :
      url.pathname.replace(/^\//, '');
    if (!rel || rel.includes('..')) throw new Error('unsafe path');
    const body = await readFile(path.join(root, rel));
    response.statusCode = 200;
    response.setHeader('content-type', rel.endsWith('.css') ? 'text/css' :
      rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;

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
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await page.goto(base + '/technology/', { waitUntil: 'load' });
        if (mutation === 'narrow-tier-column') {
          await page.addStyleTag({ content:
            '@media(max-width:900px){#p-map .mbar{grid-template-columns:92px 1fr!important}}' });
        }
        const result = await page.evaluate(function () {
          const labels = [...document.querySelectorAll('#p-map .mtier.st')].map(function (el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const lines = new Set([...range.getClientRects()]
              .filter(rect => rect.width > 0 && rect.height > 0)
              .map(rect => Math.round(rect.top * 10) / 10));
            range.detach();
            const rect = el.getBoundingClientRect();
            return {
              text: (el.textContent || '').trim(),
              lines: lines.size,
              width: +rect.width.toFixed(1),
              scrollWidth: el.scrollWidth
            };
          });
          return {
            labels,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        });
        check(result.labels.length === 4,
          `${engineName} ${width}: all four Streaming-class labels are rendered`,
          String(result.labels.length));
        result.labels.forEach(function (label, index) {
          check(label.text === 'Streaming-class' && label.lines === 1,
            `${engineName} ${width}: label ${index + 1} stays complete on one line`,
            JSON.stringify(label));
        });
        check(result.overflow <= 1,
          `${engineName} ${width}: repair creates no page overflow`, String(result.overflow));
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  console.error('technology label-wrap checks FAILED: ' + failures.length + ' of ' + checks);
  failures.forEach(failure => console.error('  ' + failure));
  process.exit(1);
}
console.log('technology label-wrap checks PASS: ' + checks +
  ' checks across 3 narrow widths and 2 engines');
