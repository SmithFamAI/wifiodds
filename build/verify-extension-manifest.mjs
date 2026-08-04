import { createRequire } from "node:module";
const playwrightRequire = createRequire("/Users/jeremysmith/.wo-respo/");
const localRequire = createRequire(import.meta.url);
const { chromium } = playwrightRequire("playwright");
const release = localRequire("./extension-release.json");

const FILE = "file:///Users/jeremysmith/Projects/wifiodds/extension/index.html" +
  (process.env.DEMO_DISABLE_DRIVER ? "?disableDriver=1" : "");
let fail = 0;
const ok = (condition, message, extra) => {
  console.log(`  ${condition ? "ok  " : "FAIL"}  ${message}${extra !== undefined ? "  → " + extra : ""}`);
  if (!condition) fail++;
};
const EXPECTED_CONTROLS = [
  "manifest-parity", "autoplay-advances", "host-switches", "unavailable-state",
  "offscreen-pauses", "reduced-motion-settles"
];
const observedControls = new Set();
const control = (name) => {
  if (process.env.DEMO_DISABLE_CONTROL !== name) observedControls.add(name);
};

let featureIds = release.allowedFeatureClaims.map(feature => feature.id);
if (process.env.DEMO_MUTATE_MANIFEST === "missing") featureIds = featureIds.concat("known-bad-missing-feature");
const hostIds = release.hosts.map(host => host.id);
const browser = await chromium.launch({ headless: true, channel: "chromium" });

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  await page.goto(FILE);

  const sectionOrder = await page.$$eval("main > section[id]", sections => sections.map(section => section.id));
  ok(JSON.stringify(sectionOrder) === JSON.stringify([
    "hero", "how", "hosts", "whats-new", "features", "demos", "silent", "install"
  ]), "the eight-section information architecture renders in order", sectionOrder.join(","));

  for (const id of featureIds) {
    const counts = await page.evaluate(featureId => ({
      link: document.querySelectorAll(`[data-feature-link="${featureId}"]`).length,
      section: document.querySelectorAll(`[data-feature-section="${featureId}"]`).length,
      frame: document.querySelectorAll(`[data-demo][data-feature="${featureId}"]`).length,
      coverage: document.querySelectorAll(`[data-feature-coverage="${featureId}"]`).length,
      fallback: document.querySelectorAll(`[data-feature-section="${featureId}"] ol.demo-steps`).length
    }), id);
    ok(Object.values(counts).every(count => count === 1), `${id}: one link, section, frame, coverage row and fallback`, JSON.stringify(counts));
    if (counts.link === 1) {
      const href = await page.getAttribute(`[data-feature-link="${id}"]`, "href");
      ok(href === `#f-${id}`, `${id}: index link targets its chapter`, href);
      const cells = await page.$$eval(`[data-feature-coverage="${id}"] [data-host-cell]`, nodes =>
        nodes.map(node => node.getAttribute("data-host-cell")));
      ok(JSON.stringify(cells) === JSON.stringify(hostIds), `${id}: coverage row matches all manifest hosts`, cells.join(","));
      const fallbackVisible = await page.$$eval(`[data-feature-section="${id}"] ol.demo-steps li`, nodes =>
        nodes.length === 5 && nodes.every(node => {
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        }));
      ok(fallbackVisible, `${id}: five ordered fallback steps remain visibly rendered`);
    }
  }
  control("manifest-parity");

  for (const id of release.allowedFeatureClaims.map(feature => feature.id)) {
    const selector = `[data-demo][data-feature="${id}"]`;
    await page.$eval(selector, node => node.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    const first = await page.getAttribute(selector, "data-stage");
    await page.waitForTimeout(1900);
    const later = await page.getAttribute(selector, "data-stage");
    ok(first !== later, `${id}: its own visible demo advances`, `${first} → ${later}`);
  }
  control("autoplay-advances");

  const sort = "[data-feature-section=\"sort\"]";
  await page.click(`${sort} [data-demo-host="google"]`);
  const googleSort = await page.$eval(sort, chapter => ({
    host: chapter.querySelector("[data-demo]").getAttribute("data-host"),
    offered: chapter.querySelector("[data-demo]").getAttribute("data-offered"),
    behavior: chapter.querySelector("[data-host-behavior]").textContent,
    limitDisplay: getComputedStyle(chapter.querySelector("[data-limit-state]")).display
  }));
  ok(googleSort.host === "google" && googleSort.behavior.includes("Google Flights"),
    "host switch changes the live feature state", JSON.stringify(googleSort));
  control("host-switches");
  ok(googleSort.offered === "false" && googleSort.limitDisplay !== "none" &&
    googleSort.behavior.startsWith("Not offered here."),
    "Google sorting is a first-class not-offered state", JSON.stringify(googleSort));
  const route = "[data-feature-section=\"route\"]";
  await page.click(`${route} [data-demo-host="google"]`);
  const routeOffered = await page.getAttribute(`${route} [data-demo]`, "data-offered");
  ok(routeOffered === "false", "Google route panel also renders as not offered", routeOffered);
  control("unavailable-state");

  const parkedSelector = "[data-demo][data-feature=\"rows\"]";
  await page.$eval(parkedSelector, node => node.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(300);
  const parked = await page.getAttribute(parkedSelector, "data-stage");
  await page.waitForTimeout(2100);
  ok(parked === await page.getAttribute(parkedSelector, "data-stage"),
    "a demo pauses while outside the viewport", parked);
  control("offscreen-pauses");

  ok(errors.length === 0, "normal motion: no console errors", errors.join(" | ") || "none");
  await context.close();
}

{
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 440, height: 956 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  await page.goto(FILE);
  const settled = await page.$$eval("[data-demo]", frames => frames.map(frame => frame.getAttribute("data-stage")));
  await page.waitForTimeout(2100);
  const later = await page.$$eval("[data-demo]", frames => frames.map(frame => frame.getAttribute("data-stage")));
  ok(settled.length === release.allowedFeatureClaims.length && settled.every(stage => stage === "4") &&
    JSON.stringify(settled) === JSON.stringify(later),
    "reduced motion: every feature starts and stays settled", settled.join(","));
  const stepsVisible = await page.$$eval(".demo-steps li", nodes => nodes.every(node => {
    const style = getComputedStyle(node);
    return Number(style.opacity) > 0.9 && style.display !== "none" && style.visibility !== "hidden";
  }));
  ok(stepsVisible, "reduced motion: every ordered fallback step is legible");
  const controls = await page.$$eval("[data-demo-play]", buttons => buttons.map(button => ({
    disabled: button.disabled, text: button.textContent
  })));
  ok(controls.every(button => button.disabled && button.text.includes("settled")),
    "reduced motion: controls describe the settled state", JSON.stringify(controls));
  ok(errors.length === 0, "reduced motion: no console errors", errors.join(" | ") || "none");
  control("reduced-motion-settles");
  await context.close();
}

await browser.close();
const missingControls = EXPECTED_CONTROLS.filter(name => !observedControls.has(name));
ok(missingControls.length === 0 && observedControls.size === EXPECTED_CONTROLS.length,
  `controls: expected ${EXPECTED_CONTROLS.length}, observed ${observedControls.size}`,
  missingControls.length ? `missing ${missingControls.join(", ")}` : "complete");
console.log(fail === 0 ? "\nEXTENSION MANIFEST VERIFY: PASS" : `\nEXTENSION MANIFEST VERIFY: FAIL — ${fail} check(s)`);
if (fail) console.error("A surprising result is a claim about the instrument until proven otherwise. Before filing a defect, prove the instrument is sound — with a control that is known-good, not with a second run.");
process.exit(fail === 0 ? 0 : 1);
