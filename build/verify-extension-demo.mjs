import { createRequire } from "node:module";
const require = createRequire("/Users/jeremysmith/.wo-respo/");
const { chromium } = require("playwright");
const FILE = "file:///Users/jeremysmith/Projects/wifiodds/extension/index.html";
let fail = 0;
const ok = (c, m, extra) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}${extra !== undefined ? "  → " + extra : ""}`); if (!c) fail++; };
const EXPECTED_CONTROLS = ["autoplay-advances", "offscreen-pauses", "reduced-motion-settles"];
const observedControls = new Set();
const control = (name) => {
  if (process.env.DEMO_DISABLE_CONTROL !== name) observedControls.add(name);
};

const b = await chromium.launch({ headless: true, channel: "chromium" });

// ── 1. normal motion ────────────────────────────────────────────────────────
{
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on("console", m => m.type() === "error" && errs.push(m.text()));
  await p.goto(FILE);

  const cards = await p.$$(".secmap-card");
  ok(cards.length === 5, "five section cards render", cards.length);

  const hrefs = await p.$$eval(".secmap-card", a => a.map(x => x.getAttribute("href")));
  ok(JSON.stringify(hrefs) === JSON.stringify(["#s1","#s2","#s3","#s4","#s5"]), "each card links to its section", hrefs.join(","));

  const targets = await p.evaluate(hs => hs.map(h => !!document.querySelector(h)), hrefs);
  ok(targets.every(Boolean), "every card target exists in the document", JSON.stringify(targets));

  // the anchors actually move the viewport
  await p.click(".secmap-card[href='#s3']");
  await p.waitForTimeout(350);
  const y = await p.evaluate(() => Math.round(window.scrollY));
  ok(y > 200, "clicking a card scrolls to its section", "scrollY=" + y);

  // Bring the demo into view first. It deliberately pauses when less than a
  // quarter of it is on screen, so a test that leaves it at the page top is
  // measuring the pause, not the animation. That cost one failed run.
  await p.evaluate(() => document.getElementById("demo").scrollIntoView({ block: "center" }));
  await p.waitForTimeout(400);

  // the demo advances on its own
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    seen.add(await p.getAttribute("#demo", "data-stage"));
    await p.waitForTimeout(600);
  }
  ok(seen.size >= 4, "the demo advances through its stages unattended", [...seen].sort().join(","));
  control("autoplay-advances");

  // the pause is a feature, so assert it rather than trusting it
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(700);
  const parked = await p.getAttribute("#demo", "data-stage");
  await p.waitForTimeout(2600);
  ok(parked === await p.getAttribute("#demo", "data-stage"), "it pauses when scrolled out of view", "stage held at " + parked);
  control("offscreen-pauses");
  await p.evaluate(() => document.getElementById("demo").scrollIntoView({ block: "center" }));
  await p.waitForTimeout(2600);
  ok(parked !== await p.getAttribute("#demo", "data-stage"), "and resumes when scrolled back");

  // the decision card in the demo is real product markup
  // OBSERVE the driver reaching the winner stage. Forcing data-stage does not
  // repaint the slot -- the attribute is an output of paint(), not an input to
  // it -- so a forced attribute proves nothing about what the panel renders.
  let sawLoading = false, sawWinner = false;
  for (let i = 0; i < 24 && !(sawLoading && sawWinner); i++) {
    const h = await p.$eval("#demoSlot", n => n.innerHTML);
    if (/usl-decision--loading/.test(h)) sawLoading = true;
    if (/usl-decision--winner/.test(h)) sawWinner = true;
    await p.waitForTimeout(500);
  }
  ok(sawLoading, "the panel renders the product's real loading card while it checks");
  ok(sawWinner, "and the product's real winner card once it decides");

  // the sort actually moves rows
  await p.evaluate(() => document.getElementById("demo").setAttribute("data-stage", "4"));
  await p.waitForTimeout(900);
  const moved = await p.$$eval(".demo-rows .row", rs => rs.map(r => {
    const t = getComputedStyle(r).transform;
    return t === "none" ? 0 : Math.round(new DOMMatrix(t).m42);
  }));
  ok(moved.some(v => v < -20) && moved.some(v => v > 20), "rows translate when it sorts", JSON.stringify(moved));

  const winnerTop = await p.evaluate(() => {
    const rs = [...document.querySelectorAll(".demo-rows .row")];
    const tops = rs.map(r => r.getBoundingClientRect().top);
    return rs[tops.indexOf(Math.min(...tops))].classList.contains("demo-win");
  });
  ok(winnerTop, "after the sort the winning row is visually first");

  const sortedNote = await p.$eval(".demo-sorted", n => getComputedStyle(n).opacity);
  ok(Number(sortedNote) > 0.9, "the panel discloses that it sorted", "opacity=" + sortedNote);

  ok(errs.length === 0, "no console errors", errs.join(" | ") || "none");
}

// ── 2. reduced motion ───────────────────────────────────────────────────────
{
  const ctx = await b.newContext({ reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(FILE);
  const first = await p.getAttribute("#demo", "data-stage");
  await p.waitForTimeout(3200);
  const later = await p.getAttribute("#demo", "data-stage");
  ok(first === later, "reduced motion: the sequence does not run on its own", `${first} → ${later}`);
  ok(later === "4", "reduced motion: the finished state is shown, not a blank one", later);
  control("reduced-motion-settles");

  const stepsVisible = await p.$$eval(".demo-steps li", ls => ls.map(l => Number(getComputedStyle(l).opacity)));
  ok(stepsVisible.every(v => v > 0.9), "reduced motion: every written step is legible", JSON.stringify(stepsVisible));

  const metrics = await p.$eval(".demo-rows .usl-metrics", n => getComputedStyle(n).opacity);
  ok(Number(metrics) > 0.9, "reduced motion: the odds are visible without animation", metrics);
}

await b.close();
const missingControls = EXPECTED_CONTROLS.filter(name => !observedControls.has(name));
ok(missingControls.length === 0 && observedControls.size === EXPECTED_CONTROLS.length,
  `controls: expected ${EXPECTED_CONTROLS.length}, observed ${observedControls.size}`,
  missingControls.length ? `missing ${missingControls.join(", ")}` : "complete");
console.log(fail === 0 ? "\nDEMO VERIFY: PASS" : `\nDEMO VERIFY: FAIL — ${fail} check(s)`);
if (fail) console.error("A surprising result is a claim about the instrument until proven otherwise. Before filing a defect, prove the instrument is sound — with a control that is known-good, not with a second run.");
process.exit(fail === 0 ? 0 : 1);
