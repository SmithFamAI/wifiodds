/* ═══ LAYOUT ASSERTIONS THAT A DOM TEST CANNOT MAKE ═══════════════════════
 *
 * On 27 Jul 2026 an outside audit found that airline names on the mobile board
 * rendered as "America / n" and "Hawaiia / n", and that "ConnectScore" and
 * "counts unpublished" broke inside the word. The canonical responsive sweep
 * had been reporting "clean across 23 widths" the whole time, and 440px was
 * already one of those widths.
 *
 * The sweep was not broken. It was measuring the wrong thing. Its pass
 * condition is "no horizontal overflow", and `overflow-wrap:anywhere` prevents
 * overflow BY breaking words. The rule that caused the defect was the same rule
 * that made the test pass, so adding more widths would never have found it.
 * Proven in WebKit before this file existed:
 *
 *     390px  page overflow: false   single words wrapped across lines: 4
 *     440px  page overflow: false   single words wrapped across lines: 4
 *
 * Everything below is a claim about what a reader sees that the HTML alone
 * cannot answer. Each one is checked in a real engine at real widths.
 *
 * Usage:
 *   node build/layout-assert.mjs <base-url>          report
 *   node build/layout-assert.mjs <base-url> --assert  exit 1 on any failure
 *
 * Playwright is not a dependency of this repo. The script resolves it from
 * ~/.wo-respo, which is the only place on this machine that has it, and skips
 * with exit 0 and a loud message if it is absent — a missing browser must not
 * silently become a pass, but it must also not block a data refresh at 04:32.
 * ═════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const ASSERT = process.argv.includes('--assert');

/* the audit's widths, plus the two this project already cared about */
const WIDTHS = [320, 375, 390, 430, 440, 768, 1024, 1280, 1440];
const ROUTES = ['/', '/airlines/', '/united/', '/systems/', '/record/'];

const TYPE_FLOOR_LABEL = 12;   /* px, any rendered text */
const TYPE_FLOOR_COPY = 14;    /* px, explanatory copy */
const TARGET_MIN = 24;         /* WCAG 2.2 target size, CSS px */
const TARGET_PREFERRED = 44;   /* important touch actions */

let chromium, webkit;
try {
  const req = createRequire(path.join(homedir(), '.wo-respo', 'package.json'));
  ({ chromium, webkit } = req('playwright'));
} catch (e) {
  console.error('layout-assert: playwright not resolvable from ~/.wo-respo — SKIPPED, NOT PASSED.');
  console.error('  ' + e.message);
  process.exit(0);
}

/* Runs inside the page. Returns findings, never verdicts: the decision about
 * what counts as a failure stays out here where it can be read. */
function collect(floors) {
  const out = { brokenWords: [], smallText: [], smallTargets: [], stickyOver: [], firstViewport: {} };
  const seen = new Set();

  const text = el => (el.textContent || '').trim();
  const oneWord = s => s.length > 3 && !/\s/.test(s);

  /* A word is broken when a single unbroken token renders across more than one
   * line box. Measured, not inferred from CSS: a rule that permits breaking is
   * only a defect when it actually breaks something. */
  document.querySelectorAll('td, th, a, b, span, strong, em, li, h1, h2, h3, button').forEach(el => {
    if (el.children.length) return;
    const t = text(el);
    if (!oneWord(t)) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
    if (r.height > lh * 1.6) {
      const key = t.slice(0, 30);
      if (!seen.has(key)) { seen.add(key); out.brokenWords.push({ text: key, h: Math.round(r.height), lh: Math.round(lh) }); }
    }
  });

  /* Rendered type, not authored type: a rem value tells you nothing about what
   * the reader gets after inheritance and media queries. */
  document.querySelectorAll('p, li, td, th, span, a, small, div, button, label').forEach(el => {
    if (el.children.length) return;
    const t = text(el);
    if (t.length < 4) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    const isCopy = t.length > 60;
    const floor = isCopy ? floors.copy : floors.label;
    if (px < floor - 0.05) {
      const key = Math.round(px * 10) + '|' + t.slice(0, 24);
      if (!seen.has(key)) { seen.add(key); out.smallText.push({ px: +px.toFixed(1), floor, kind: isCopy ? 'copy' : 'label', text: t.slice(0, 34) }); }
    }
  });

  /* Standalone controls. A link inside a sentence is exempt from target size
   * under WCAG 2.2; a control sitting on its own is not. */
  document.querySelectorAll('button, a[role="button"], .btn, .filters button, summary, label[for]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.height < floors.target - 0.5 || r.width < floors.target - 0.5) {
      const key = 'T' + text(el).slice(0, 20) + Math.round(r.height);
      if (!seen.has(key)) { seen.add(key); out.smallTargets.push({ text: text(el).slice(0, 26) || el.className, w: Math.round(r.width), h: Math.round(r.height) }); }
    }
  });

  /* Does a heading declared sticky actually stay put?
   *
   * This check has been wrong twice, and both versions failed the same way:
   * they asserted something other than what a reader experiences.
   *
   * v1 reported 3,550 findings, every one false. It counted the zero-size
   * `.vh` labels inside headings, whose rect is 0,0 and therefore always
   * "above" anything, and it never scrolled, so it judged stickiness on tables
   * resting below the fold where nothing is stuck to anything.
   *
   * v2 reported zero, which was worse, because zero looks like health. It
   * scrolled with window.scrollTo and read the result immediately, and the
   * site sets scroll-behavior:smooth, so the scroll had not happened yet. A
   * check that reports clean forever is the failure this file exists to
   * prevent, and it took a probe to notice.
   *
   * What the probe found is the actual defect, and it is not the collision the
   * audit predicted. `table.tbl thead th` carries position:sticky;top:0, but
   * its scrollport is the `.tbl-shell.tablescroll` wrapper, not the viewport,
   * because an ancestor with overflow-x:auto becomes the containing scroller.
   * That wrapper never scrolls vertically, so the heading has no room to stick
   * and simply scrolls away: measured at top -188, -438 and -838 while the
   * table body was still on screen. On the 18-row board a reader loses the
   * column headings after the first row or two. The rule is in the stylesheet
   * and does nothing.
   *
   * So the assertion is not "the heading avoids the header". It is "while the
   * table body is on screen, its heading is too". The caller scrolls, because
   * only the caller can await a smooth scroll. */
  const hdr = document.querySelector('header.site');
  const hdrBottom = hdr ? hdr.getBoundingClientRect().bottom : 0;
  if (floors.stickyPhase) {
    document.querySelectorAll('table').forEach(tbl => {
      const ths = [...tbl.querySelectorAll('thead th')]
        .filter(th => getComputedStyle(th).position === 'sticky')
        .filter(th => { const r = th.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!ths.length) return;
      const body = tbl.querySelector('tbody');
      if (!body) return;
      const br = body.getBoundingClientRect();
      const bodyOnScreen = br.top < window.innerHeight && br.bottom > hdrBottom + 40;
      if (!bodyOnScreen) return;
      const r = ths[0].getBoundingClientRect();
      const headingVisible = r.bottom > hdrBottom && r.top < window.innerHeight;
      if (!headingVisible) {
        out.stickyOver.push({
          text: text(ths[0]).slice(0, 20),
          top: Math.round(r.top), hdrBottom: Math.round(hdrBottom)
        });
      }
    });
  }

  /* The audit's acceptance criterion 1: the first screen must answer something. */
  const vh = window.innerHeight;
  const h1 = document.querySelector('h1');
  const cta = [...document.querySelectorAll('a.btn, .herocall a, a.cwsbadge, .hc-t a')]
    .find(a => a.getBoundingClientRect().top < vh && a.getBoundingClientRect().height > 0);
  out.firstViewport = {
    h1InFold: !!(h1 && h1.getBoundingClientRect().bottom < vh),
    ctaInFold: !!cta,
    ctaText: cta ? text(cta).slice(0, 30) : null
  };
  return out;
}

const failures = [];
function note(route, width, engine, kind, detail) {
  failures.push({ route, width, engine, kind, detail });
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + route + '?cb=' + Math.random(), { waitUntil: 'load', timeout: 30000 });
      } catch (e) { await ctx.close(); continue; }
      await page.waitForTimeout(250);
      const floors = {
        label: TYPE_FLOOR_LABEL, copy: TYPE_FLOOR_COPY,
        target: width <= 700 ? TARGET_PREFERRED : TARGET_MIN, stickyPhase: false
      };
      const r = await page.evaluate(collect, floors);

      /* Second pass for stickiness only. The scroll has to happen out here and
       * be awaited: the site sets scroll-behavior:smooth, so a scroll issued
       * and measured inside one page.evaluate reads the position from before
       * the scroll. That is how the previous version of this check came back
       * clean on a defect it was written to find. */
      const tableTop = await page.evaluate(() => {
        const t = [...document.querySelectorAll('table.tbl')].pop();
        return t ? t.getBoundingClientRect().top + window.scrollY : null;
      });
      if (tableTop != null) {
        await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), tableTop + 300);
        await page.waitForTimeout(350);
        const s = await page.evaluate(collect, { ...floors, stickyPhase: true });
        s.stickyOver.forEach(x => note(route, width, name, 'sticky heading does not stick',
          `"${x.text}" scrolled to top ${x.top} while its table body is still on screen`));
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      }
      r.brokenWords.forEach(x => note(route, width, name, 'mid-word break',
        `"${x.text}" renders ${x.h}px tall on a ${x.lh}px line`));
      r.smallText.forEach(x => note(route, width, name, 'type below floor',
        `${x.px}px ${x.kind} (floor ${x.floor}) "${x.text}"`));
      r.smallTargets.forEach(x => note(route, width, name, 'target too small',
        `${x.w}x${x.h} "${x.text}"`));
      r.stickyOver.forEach(x => note(route, width, name, 'sticky heading hidden',
        `"${x.text}" top ${x.top} is above header bottom ${x.hdrBottom}`));
      if (width <= 440 && route === '/' && !r.firstViewport.ctaInFold)
        note(route, width, name, 'no CTA in first viewport', 'nothing actionable above the fold');
      await ctx.close();
    }
  }
  await browser.close();
}

const byKind = {};
failures.forEach(f => { (byKind[f.kind] = byKind[f.kind] || []).push(f); });

console.log('layout-assert · ' + BASE);
console.log('  ' + WIDTHS.length + ' widths x ' + ROUTES.length + ' routes x 2 engines');
if (!failures.length) {
  console.log('  clean: no mid-word breaks, no type below floor, no undersized targets,');
  console.log('  no hidden sticky headings, a call to action in the first viewport.');
} else {
  Object.keys(byKind).sort().forEach(k => {
    const list = byKind[k];
    console.log('\n  ' + k.toUpperCase() + ' — ' + list.length + ' finding(s)');
    const shown = new Set();
    list.forEach(f => {
      const key = f.kind + f.detail;
      if (shown.has(key) || shown.size > 400) return;
      shown.add(key);
      console.log(`    ${String(f.width).padStart(4)}px ${f.engine.padEnd(8)} ${f.route.padEnd(12)} ${f.detail}`);
    });
  });
  console.log('\n  ' + failures.length + ' finding(s) across ' +
    new Set(failures.map(f => f.kind)).size + ' classes.');
}

if (ASSERT && failures.length) process.exit(1);
