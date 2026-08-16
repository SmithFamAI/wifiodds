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

      const pageWidth = await page.evaluate(function () {
        return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
      });
      check(pageWidth.scroll <= pageWidth.client + 1,
        engineName + ' ' + width + ': the page does not overflow horizontally', JSON.stringify(pageWidth));
      const outerTracks = await page.locator('#airline-grid').evaluate(function (node) {
        return getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
      });
      check(outerTracks.length === 1,
        engineName + ' ' + width + ': airline leaderboard has one outer column', outerTracks.join(' | '));
      const rows = page.locator('#airline-grid .row:not([hidden])');
      check(await rows.count() === 18, engineName + ' ' + width + ': all 18 rows render');
      check(await page.locator('.view-switch, button[data-view]').count() === 0,
        engineName + ' ' + width + ': page-level Next-Gen/Streaming toggle is gone');

      const labels = await rows.locator('.who b').evaluateAll(function (nodes) {
        return nodes.map(function (node) {
          const r = node.getBoundingClientRect();
          return { text: node.textContent.trim(), client: node.clientWidth, scroll: node.scrollWidth, width: r.width };
        });
      });
      labels.forEach(function (label) {
        check(label.width > 0 && label.client > 0 && label.scroll <= label.client + 1,
          engineName + ' ' + width + ': airline identity is fully visible', JSON.stringify(label));
      });

      const dates = await page.locator('#airline-grid .row-meta .checked-date').evaluateAll(function (nodes) {
        return nodes.map(function (node) {
          const cs = getComputedStyle(node);
          return {
            text: node.textContent.trim(),
            whiteSpace: cs.whiteSpace,
            rects: node.getClientRects().length,
            height: node.getBoundingClientRect().height
          };
        });
      });
      check(dates.length === 18, engineName + ' ' + width + ': every rank card has one visible checked date', String(dates.length));
      dates.forEach(function (d) {
        check(d.whiteSpace === 'nowrap',
          engineName + ' ' + width + ': checked date is nowrap', JSON.stringify(d));
        check(d.rects === 1 && d.height > 0,
          engineName + ' ' + width + ': checked date stays one line (year and month together)', JSON.stringify(d));
        check(/^checked 2026-\d{2}$/.test(d.text),
          engineName + ' ' + width + ': checked date keeps the modelled month', d.text);
      });

      const dualFigures = await rows.evaluateAll(function (nodes) {
        return nodes.map(function (row) {
          const primary = row.querySelector('.metric.primary');
          const nextgen = row.querySelector('.odds-only b');
          const streaming = row.querySelector('[data-streaming-view="primary"]');
          const nr = nextgen && nextgen.getBoundingClientRect();
          const sr = streaming && streaming.getBoundingClientRect();
          const cs = primary && getComputedStyle(primary);
          return {
            key: row.getAttribute('data-key'),
            nextgen: nextgen ? nextgen.textContent.trim() : '',
            streaming: streaming ? streaming.textContent.trim() : '',
            flexDirection: cs ? cs.flexDirection : '',
            flexWrap: cs ? cs.flexWrap : '',
            sameRow: !!(nr && sr && Math.abs(nr.top - sr.top) < 28)
          };
        });
      });
      dualFigures.forEach(function (fig) {
        check(!!fig.nextgen && !!fig.streaming,
          engineName + ' ' + width + ': ' + fig.key + ' shows Next-Gen and Streaming', JSON.stringify(fig));
        check(fig.flexDirection === 'row' && fig.flexWrap === 'nowrap',
          engineName + ' ' + width + ': ' + fig.key + ' Next-Gen/Streaming pair is a nowrap row', JSON.stringify(fig));
        check(fig.sameRow,
          engineName + ' ' + width + ': ' + fig.key + ' keeps Streaming on the same row as Next-Gen', JSON.stringify(fig));
      });

      const published = await page.locator('#big4 [data-published-figure]:visible, #airline-grid [data-published-figure]')
        .evaluateAll(function (nodes) {
          return nodes.map(function (node) {
            const block = node.closest('[data-figure-block]');
            const evidence = block && block.querySelector('[data-figure-evidence]');
            const summary = evidence && evidence.querySelector('summary');
            const source = evidence && evidence.querySelector('.figure-source-list');
            const cs = evidence && getComputedStyle(evidence);
            const bg = evidence && getComputedStyle(block).backgroundColor;
            const ownerNode = node.closest('.row, .aircard');
            return {
              value: node.textContent.trim(),
              kind: node.getAttribute('data-published-figure'),
              owner: ownerNode ? (ownerNode.getAttribute('data-key') || ownerNode.querySelector('.airname, .who b')?.textContent.trim()) : '',
              evidence: !!evidence,
              summary: !!summary,
              source: !!source && source.textContent.trim().length > 0,
              sourceText: source ? source.textContent.trim() : '',
              text: evidence ? evidence.textContent.trim() : '',
              font: cs ? parseFloat(cs.fontSize) : 0,
              color: cs ? cs.color : '',
              background: bg || ''
            };
          });
        });
      published.forEach(function (figure) {
        check(figure.evidence && figure.summary && figure.source,
          engineName + ' ' + width + ': ' + figure.kind + ' has bound source disclosure', JSON.stringify(figure));
        check(/Modelled|Reported/.test(figure.text) && /2026-\d{2}/.test(figure.text),
          engineName + ' ' + width + ': ' + figure.kind + ' has tier and date', figure.text);
        check(figure.font >= 12,
          engineName + ' ' + width + ': evidence is at least 12px', String(figure.font));
      });
      const sourceSets = new Map();
      published.forEach(function (figure) {
        const previous = sourceSets.get(figure.owner);
        if (previous == null) sourceSets.set(figure.owner, figure.sourceText);
        else check(previous === figure.sourceText,
          engineName + ' ' + width + ': ' + figure.owner + ' disclosures use the same whole-fleet source set',
          previous + ' <> ' + figure.sourceText);
      });

      const sample = await page.locator('#airline-grid .row-meta .checked-date').first().evaluate(function (node) {
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
      });
      if (sample) check(contrast(sample.foreground, sample.background) >= 4.5,
        engineName + ' ' + width + ': checked-date contrast is at least 4.5:1', JSON.stringify(sample));

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
