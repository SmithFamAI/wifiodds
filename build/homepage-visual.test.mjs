/* Real-browser regression gate for the 12 Aug 2026 homepage grid failure.
 * The generic layout sweep proved page-level overflow, but airline names still
 * collapsed to 0px at 768px. This gate measures the comparison itself. */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const req = createRequire(path.join(homedir(), '.wo-respo', 'package.json'));
let chromium, webkit;
try {
  ({ chromium, webkit } = req('playwright'));
} catch (error) {
  console.error('homepage-visual: Playwright is unavailable: ' + error.message);
  process.exit(2);
}

const quick = process.argv.includes('--quick');
const widths = quick ? [768, 1440] : [390, 440, 700, 701, 768, 980, 981, 1024, 1240, 1440];
const fileUrl = pathToFileURL(path.join(process.cwd(), 'index.html')).href;
let checks = 0;
const failures = [];

function check(condition, label, evidence = '') {
  checks += 1;
  if (!condition) failures.push(label + (evidence ? ' :: ' + evidence : ''));
}

function luminance(rgb) {
  return rgb.map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }).reduce(function (sum, v, i) { return sum + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
}
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const engines = quick ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
for (const [engineName, engine] of engines) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      await page.goto(fileUrl + '?visual-control=' + width + '#all', { waitUntil: 'load' });
      await page.locator('#all').scrollIntoViewIfNeeded();

      for (const mode of ['nextgen', 'streaming']) {
        await page.locator('.view-switch button[data-view="' + mode + '"]').first().click();
        const pageWidth = await page.evaluate(function () {
          return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
        });
        check(pageWidth.scroll <= pageWidth.client + 1,
          engineName + ' ' + width + ' ' + mode + ': the page does not overflow horizontally', JSON.stringify(pageWidth));
        const outerTracks = await page.locator('#airline-grid').evaluate(function (node) {
          return getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
        });
        check(outerTracks.length === 1,
          engineName + ' ' + width + ' ' + mode + ': airline leaderboard has one outer column', outerTracks.join(' | '));
        const rows = page.locator('#airline-grid .row:not([hidden])');
        check(await rows.count() === 18, engineName + ' ' + width + ' ' + mode + ': all 18 rows render');

        const labels = await rows.locator('.who b').evaluateAll(function (nodes) {
          return nodes.map(function (node) {
            const r = node.getBoundingClientRect();
            return { text: node.textContent.trim(), client: node.clientWidth, scroll: node.scrollWidth, width: r.width };
          });
        });
        labels.forEach(function (label) {
          check(label.width > 0 && label.client > 0 && label.scroll <= label.client + 1,
            engineName + ' ' + width + ' ' + mode + ': airline identity is fully visible', JSON.stringify(label));
        });

        const published = await page.locator('#big4 [data-published-figure]:visible, #airline-grid [data-published-figure]:visible')
          .evaluateAll(function (nodes) {
            return nodes.map(function (node) {
              const block = node.closest('[data-figure-block]');
              const evidence = block && block.querySelector('[data-figure-evidence]');
              const summary = evidence && evidence.querySelector('summary');
              const source = evidence && evidence.querySelector('.figure-source-list');
              const cs = evidence && getComputedStyle(evidence);
              const bg = evidence && getComputedStyle(block).backgroundColor;
              return {
                value: node.textContent.trim(),
                kind: node.getAttribute('data-published-figure'),
                evidence: !!evidence,
                summary: !!summary,
                source: !!source && source.textContent.trim().length > 0,
                text: evidence ? evidence.textContent.trim() : '',
                font: cs ? parseFloat(cs.fontSize) : 0,
                color: cs ? cs.color : '',
                background: bg || ''
              };
            });
          });
        published.forEach(function (figure) {
          check(figure.evidence && figure.summary && figure.source,
            engineName + ' ' + width + ' ' + mode + ': ' + figure.kind + ' has bound source disclosure', JSON.stringify(figure));
          check(/Modelled|Reported/.test(figure.text) && /2026-\d{2}/.test(figure.text),
            engineName + ' ' + width + ' ' + mode + ': ' + figure.kind + ' has tier and date', figure.text);
          check(figure.font >= 12,
            engineName + ' ' + width + ' ' + mode + ': evidence is at least 12px', String(figure.font));
        });

        const visibleEvidence = page.locator('#airline-grid [data-figure-evidence]:visible');
        const evidenceCount = await visibleEvidence.count();
        check(evidenceCount > 0, engineName + ' ' + width + ' ' + mode + ': visible evidence exists for contrast control');
        const sample = evidenceCount ? await visibleEvidence.first().evaluate(function (node) {
          function rgb(value) { return (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number); }
          let parent = node;
          let background = [5, 5, 5];
          while (parent) {
            const raw = getComputedStyle(parent).backgroundColor;
            const got = rgb(raw);
            if (got.length === 3 && !/rgba\([^)]*,\s*0\s*\)/.test(raw)) { background = got; break; }
            parent = parent.parentElement;
          }
          return { foreground: rgb(getComputedStyle(node).color), background: background };
        }) : null;
        if (sample) check(contrast(sample.foreground, sample.background) >= 4.5,
          engineName + ' ' + width + ' ' + mode + ': evidence contrast is at least 4.5:1', JSON.stringify(sample));
      }

      await page.locator('#airline-filter summary').click();
      await page.locator('#select-none').click();
      await page.locator('#select-all').click();
      check(await page.locator('#airline-grid .row:not([hidden])').count() === 18,
        engineName + ' ' + width + ': Select all restores every airline');
      await page.close();
    }

    const technology = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await technology.goto(pathToFileURL(path.join(process.cwd(), 'technology/index.html')).href, { waitUntil: 'load' });
    const hiddenFocusable = await technology.locator('[aria-hidden="true"]').evaluateAll(function (nodes) {
      return nodes.flatMap(function (node) {
        return Array.from(node.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(function (el) {
          return !el.hasAttribute('disabled') && el.tabIndex >= 0;
        }).map(function (el) { return el.outerHTML.slice(0, 180); });
      });
    });
    check(hiddenFocusable.length === 0, engineName + ': aria-hidden containers have no keyboard stops', hiddenFocusable.join(' | '));
    check(await technology.locator('#p-curtain input[type="range"]').count() === 1,
      engineName + ': Technology has one native reveal slider');
    check(await technology.locator('#p-curtain [role="slider"]').count() === 0,
      engineName + ': Technology has no duplicate custom slider');
    await technology.close();
  } finally {
    await browser.close();
  }
}

if (failures.length) {
  console.error('homepage-visual: ' + failures.length + ' of ' + checks + ' checks failed.');
  failures.slice(0, 80).forEach(function (failure) { console.error('  FAIL ' + failure); });
  if (failures.length > 80) console.error('  ... ' + (failures.length - 80) + ' more');
  process.exit(1);
}
console.log('homepage-visual: ' + checks + ' checks passed across ' + widths.length + ' widths and ' + engines.length + ' engines.');
