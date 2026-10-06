#!/usr/bin/env node
/**
 * test-plausibility-gate.js — prove the gate in update-unitedstarlink.js can FAIL.
 *
 * A guard nobody has watched fail is not a guard. This tampers with a COPY of
 * united/data.json (never the real one), runs the REAL exported gate against it,
 * and asserts the flag fires; then runs a clean copy and asserts it does not.
 *
 * It imports plausibilityGate from the refresh script itself rather than
 * restating the logic, so a change to the gate cannot pass a test of an older
 * copy of the gate. Requiring that file does not start the refresh — the run is
 * guarded behind require.main === module.
 *
 * Usage: node scripts/test-plausibility-gate.js
 * Exit:  0 all cases behaved, 1 any case did not.
 */

const fs = require("fs");
const { plausibilityGate, DATA_FILE } = require("./update-unitedstarlink.js");

const SRC = DATA_FILE;
const TODAY = "2026-07-26";

const clean = () => JSON.parse(fs.readFileSync(SRC, "utf8"));
let failures = 0;

function run(name, tamper, newEq, newTot, expect) {
  const data = clean();
  const before = { equipped: data.fleet.equipped, total: data.fleet.total };
  if (tamper) tamper(data);
  const r = plausibilityGate(data, newEq, newTot, TODAY);
  const fired = r.flags.length > 0;
  const ok = fired === expect.fires
    && data.fleet.equipped === expect.equipped
    && data.fleet.total === expect.total;
  if (!ok) failures++;
  console.log(`\n── ${name}`);
  console.log(`   input        was ${before.equipped}/${before.total}, tracker returned ${newEq}/${newTot}`);
  console.log(`   bounds       equipped ±${r.bounds.equipped}, total ±${r.bounds.total}`);
  console.log(`   published    ${data.fleet.equipped}/${data.fleet.total}` +
    `   (expected ${expect.equipped}/${expect.total})`);
  console.log(`   flags        ${r.flags.length}`);
  r.report.forEach((l) => console.log(`     ${l}`));
  console.log(`   RESULT       ${ok ? "PASS" : "FAIL"} — expected ${expect.fires ? "the gate to fire" : "a clean pass"}`);
}

console.log("PLAUSIBILITY GATE — proving it can fail before trusting it to pass");
console.log(`source of the copy: ${SRC} (read only; never written)`);

// 1. the real numbers, untampered: today's tracker values. Must pass clean.
const live = clean();
run("control · untampered input, today's real numbers",
  null, live.fleet.equipped, live.fleet.total,
  { fires: false, equipped: live.fleet.equipped, total: live.fleet.total });

// 2. equipped jumps by more than the tracker's own 30-day install total.
run("tampered · equipped leaps far past the last30 bound",
  null, live.fleet.equipped + live.fleet.last30 + 50, live.fleet.total,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total });

// 3. a shape change on the tracker: the parse grabs the wrong number entirely.
run("tampered · parse returns a wildly wrong equipped (page changed shape)",
  null, 9, live.fleet.total,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total });

// 4. denominator moves a lot. Flagged AND healed.
run("tampered · denominator moves 255 aircraft in one night",
  null, live.fleet.equipped, live.fleet.total - 255,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total });

// 5. denominator wobbles by 1, the size it really has moved. Flagged, accepted.
run("tampered · denominator wobbles by 1 (inside the tolerance from history)",
  null, live.fleet.equipped, live.fleet.total + 1,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total + 1 });

// 5a. MIXED, direction one (round-11 audit): equipped in bounds, denominator
// rejected. The measurement is ATOMIC — both fields must be retained, or a
// numerator and denominator measured on different days publish a blended
// ratio under one date. Before the atomic fix this published the new
// equipped under the OLD measurement date.
run("tampered · MIXED: equipped acceptable, denominator rejected — both retained (atomic)",
  null, live.fleet.equipped + 1, live.fleet.total + 93,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total });

// 5b. MIXED, direction two: equipped rejected, denominator within tolerance.
// Same rule, other way round: both retained.
run("tampered · MIXED: equipped rejected, denominator acceptable — both retained (atomic)",
  null, live.fleet.equipped + 117, live.fleet.total + 1,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total });

// 6. somebody deletes the sourced figures. Flagged.
run("tampered · fleet.published deleted from the file",
  (d) => { delete d.fleet.published; }, live.fleet.equipped, live.fleet.total,
  { fires: true, equipped: live.fleet.equipped, total: live.fleet.total });

// 7. restore: back to the clean input, must be clean again.
run("restored · clean input again",
  null, live.fleet.equipped, live.fleet.total,
  { fires: false, equipped: live.fleet.equipped, total: live.fleet.total });

// 5c. BALANCED SEGMENT SHIFT under a rejected measurement (round-12 audit).
// The headline sum is unchanged (mainline +1 / express -1) but the global
// measurement was rejected, so measurementAsOf stays at the prior date. The
// whole fleet observation is atomic: after retainFleet, mainline/express/pace/
// types must all be back at their prior values, or a new measurement ships
// under an old date with every sum balancing.
{
  const { retainFleet } = require("./update-unitedstarlink.js");
  const d = clean();
  const fleetPrior = JSON.parse(JSON.stringify(d.fleet));
  const g = plausibilityGate(d, d.fleet.equipped, d.fleet.total + 93, "2099-01-01"); // reject total
  // the writer would now scrape and apply balanced segments + a new pace:
  d.fleet.mainline = { equipped: (fleetPrior.mainline.equipped || 0) + 1, total: fleetPrior.mainline.total };
  d.fleet.express = { equipped: (fleetPrior.express.equipped || 0) - 1, total: fleetPrior.express.total };
  d.fleet.mainlinePacePerWeek = (fleetPrior.mainlinePacePerWeek || 0) + 9;
  if (g.healed) retainFleet(d, fleetPrior);
  const segRestored = JSON.stringify(d.fleet.mainline) === JSON.stringify(fleetPrior.mainline) &&
    JSON.stringify(d.fleet.express) === JSON.stringify(fleetPrior.express) &&
    d.fleet.mainlinePacePerWeek === fleetPrior.mainlinePacePerWeek &&
    JSON.stringify(d.fleet.types) === JSON.stringify(fleetPrior.types);
  const plausKept = d.fleet.plausibility && d.fleet.plausibility.checkedOn === "2099-01-01";
  console.log(`\n── tampered · BALANCED mainline/express shift under a rejected measurement (atomic whole-fleet)`);
  console.log(`   healed=${g.healed} · segments restored=${segRestored} · today's gate report kept=${!!plausKept}`);
  if (!(g.healed && segRestored && plausKept)) {
    failures++;
    console.log("   RESULT       FAIL — a balanced segment change survived a retained measurement");
  } else {
    console.log("   RESULT       PASS — whole fleet observation retained, gate report kept");
  }
}

console.log(`\nRESULT: ${failures ? `${failures} case(s) behaved wrongly` : "all cases behaved as specified"}`);
process.exit(failures ? 1 : 0);
