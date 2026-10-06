#!/usr/bin/env node
/**
 * update-unitedstarlink.js — daily data refresh for wifiodds.com/united/data.json
 *
 * Deterministic: all fetching/parsing/writing happens here so the scheduled agent
 * only has to run it, sanity-check the summary, verify the live site, and commit.
 *
 * Sources (all unitedstarlinktracker.com — credit where due):
 *   /                      fleet headline (equipped/total/last30, mainline, express)
 *   /fleet                 per-type counts + mainline install pace
 *   /routes                top-60 routes by scheduled Starlink departures (48h)
 *   /api/predict-flight    per-flight probability (JSON)
 *   /api/plan-route        ranked itineraries per route (JSON)
 *   /mcp                   predict_route_starlink → per-route flight ranking (text, parsed)
 *
 * Writes: public/unitedstarlink/data.json  (schema unchanged + leaderboard/routeCache)
 * Prints: one summary line per section; exits 1 on any hard failure.
 *
 * Usage: node scripts/update-unitedstarlink.js [--max-cache-routes N]
 */

const fs = require("fs");
const path = require("path");

const BASE = "https://unitedstarlinktracker.com";
const FILE = process.env.WIFIODDS_UNITED_DATA_FILE ||
  path.join(__dirname, "..", "public", "unitedstarlink", "data.json");
const MAX_CACHE_ROUTES = Number(process.argv[process.argv.indexOf("--max-cache-routes") + 1]) || 40;
const HUB_PAIRS = ["DEN-SFO","SFO-DEN","ORD-DEN","DEN-ORD","EWR-ORD","ORD-EWR","IAH-DEN","DEN-IAH",
  "EWR-SFO","SFO-EWR","ORD-SFO","SFO-ORD","IAH-ORD","ORD-IAH","EWR-IAD","IAD-EWR","DEN-LAX","LAX-DEN",
  "SFO-LAX","LAX-SFO","EWR-LAX","LAX-EWR","ORD-LAX","LAX-ORD","IAD-DEN","DEN-IAD","EWR-DEN","DEN-EWR"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, asJson) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url + (url.includes("?") ? "&" : "?") + "cb=" + Math.random().toString(36).slice(2), {
        headers: { "User-Agent": "wifiodds-daily/1.0 (+https://wifiodds.com/)" },
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asJson ? await r.json() : await r.text();
    } catch (e) {
      if (attempt === 2) throw new Error(url + " → " + e.message);
      await sleep(1500 * (attempt + 1));
    }
  }
}

async function mcpPredictRoute(origin, destination) {
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "User-Agent": "wifiodds-daily/1.0 (+https://wifiodds.com/)" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "predict_route_starlink", arguments: { origin, destination, limit: 30 } } }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { const m = t.match(/data: (.*)/); j = m ? JSON.parse(m[1]) : null; }
  const text = j?.result?.content?.[0]?.text || "";
  const flights = [];
  const re = /^\s*(UA\d+)\s+\[(\w+)\]\s+\(([A-Z]{3})-([A-Z]{3})\)\s+(\d+)%\s+\((\d+) obs · (\w+) confidence\)/gm;
  let m2;
  while ((m2 = re.exec(text))) flights.push({ fn: m2[1], seg: m2[2], prob: +m2[5], obs: +m2[6], conf: m2[7] });
  return flights;
}

// Collapse the tracker's ~14 raw type strings into the same families the fleet
// page uses, so "planes added by type" reads 737-800 / A321neo / E175 etc.
function typeFamily(s) {
  if (/CRJ-?550/i.test(s)) return "CRJ-550";
  if (/E175|ERJ-?175|Embraer/i.test(s)) return "E175";
  if (/A321/i.test(s)) return "A321neo";
  if (/A319/i.test(s)) return "A319";
  if (/A320/i.test(s)) return "A320";
  if (/MAX/i.test(s)) return "737 MAX";
  if (/737-?9|739/i.test(s)) return "737-900";
  if (/737-?8|738/i.test(s)) return "737-800";
  if (/787/i.test(s)) return "787";
  if (/777/i.test(s)) return "777";
  if (/767/i.test(s)) return "767";
  if (/757/i.test(s)) return "757";
  return s.replace(/^(Boeing|Airbus|Bombardier|Embraer)\s+/i, "");
}

// Full equipped-tail roster with per-tail install ("first seen") dates — the
// authoritative source for "which specific jets went live, and when."
async function mcpListAircraft(limit = 500, fleet) {
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "User-Agent": "wifiodds-daily/1.0 (+https://wifiodds.com/)" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "list_starlink_aircraft", arguments: fleet ? { limit, fleet } : { limit } } }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { const m = t.match(/data: (.*)/); j = m ? JSON.parse(m[1]) : null; }
  const text = j?.result?.content?.[0]?.text || "";
  const roster = [];
  const re = /^(N\w+)\s+—\s+(.+?)\s+\((mainline|express),\s+.+?,\s+first seen (\d{4}-\d{2}-\d{2})\)/gm;
  let m;
  while ((m = re.exec(text))) roster.push({ tail: m[1], type: typeFamily(m[2]), fleet: m[3], seen: m[4] });
  return roster;
}

function strip(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }

/* ── THE PLAUSIBILITY GATE ───────────────────────────────────────────────────
 * Until this existed, the 04:32 refresh parsed the tracker and published
 * whatever it got. If the page changed shape or a number moved implausibly,
 * nothing noticed — the new number was internally consistent with itself, which
 * is exactly the failure mode this project keeps hitting.
 *
 * It HEALS AND LOGS and never exits non-zero. The refresh runs unattended with
 * nobody awake; a process that dies here takes the morning deploy down, which is
 * worse than the fault it found. Same doctrine as reconcileUnited(): correct
 * what you can safely correct, say so loudly, keep going.
 *
 * Both bounds are DERIVED FROM THE FILE'S OWN DATA, not picked out of the air:
 *
 *   equipped — the tracker publishes its own 30-day install total
 *     (fleet.last30, 51 on 2026-07-26). One day cannot plausibly add more
 *     aircraft than the whole preceding month did, so last30 IS the bound. It
 *     moves with the data instead of rotting. Floor of 10, so a quiet month
 *     cannot make the gate hair-trigger.
 *
 *   total — the denominator should move rarely and deliberately, so ANY change
 *     is flagged. It is only healed away (reverted) if it exceeds the largest
 *     day-over-day denominator move already in history — 1805→1807→1808→1807
 *     across 2026-07-23..26, so 3 — with a floor of 3.
 *
 * Exported so its failure can be PROVEN against a tampered copy of the input
 * rather than asserted. See scripts/test-plausibility-gate.js. */
function plausibilityGate(data, newEq, newTot, today) {
  const prevEq = data.fleet.equipped, prevTot = data.fleet.total;
  const hist = data.history || [];
  const obsTotMove = hist.slice(1).reduce((mx, h, i) =>
    Math.max(mx, Math.abs((h.total || 0) - (hist[i].total || 0))), 0);
  const EQ_BOUND = Math.max(10, data.fleet.last30 || 0);
  const TOT_TOL = Math.max(3, obsTotMove);
  const flags = [];
  // healedEquipped/healedTotal (P1-01): true only when THIS field's freshly
  // scraped value was REJECTED and the prior value kept. Case 5 in
  // test-plausibility-gate.js ("denominator wobbles by 1") still pushes a flag
  // for visibility but IS accepted — that must not count as healed, so this is
  // tracked separately from flags.length rather than derived from it.
  let healedEquipped = false, healedTotal = false;

  // OWNER RE-BASELINE (one shot, explicit, exact). The hub republished its fleet
  // denominator on 2026-10-06 (1,817 → 1,675) and seven weeks without a run
  // left equipped far outside its 30-day bound. Neither is a parse error, and
  // the gate is right to refuse them unattended. The owner accepts a specific
  // pair by setting WIFIODDS_REBASELINE="<equipped>/<total>:<ruling>". The
  // override applies only when the scraped pair equals the ruled pair exactly;
  // any other value is still judged by the bounds below. The ruling is written
  // into data.fleet.rebaseline so the accepted jump is on the record.
  const rb = String(process.env.WIFIODDS_REBASELINE || "").match(/^(\d+)\/(\d+):(.+)$/);
  if (rb && +rb[1] === newEq && +rb[2] === newTot) {
    data.fleet.equipped = newEq;
    data.fleet.total = newTot;
    data.fleet.rebaseline = { on: today, from: { equipped: prevEq, total: prevTot },
      to: { equipped: newEq, total: newTot }, ruling: rb[3].trim() };
    data.fleet.plausibility = { checkedOn: today, bounds: { equipped: EQ_BOUND, total: TOT_TOL }, flags: [] };
    return { flags: [], bounds: { equipped: EQ_BOUND, total: TOT_TOL }, healed: false,
      report: [`plausibility: OWNER RE-BASELINE accepted ${prevEq}/${prevTot} → ${newEq}/${newTot} (${rb[3].trim()})`] };
  }
  const rebaselineNote = process.env.WIFIODDS_REBASELINE && !(rb && +rb[1] === newEq && +rb[2] === newTot)
    ? `rebaseline: WIFIODDS_REBASELINE is set but the tracker returned ${newEq}/${newTot}; the ruling ` +
      `does not match and was NOT applied. Normal bounds judged this run.`
    : null;

  // PASS 1 — judge each field, apply nothing yet. A round-11 audit caught the
  // per-field version of this gate publishing an ACCEPTED new equipped count
  // under the OLD measurement date because the denominator, judged
  // independently, was rejected in the same run. equipped/total are one dated
  // observation of one fleet: a ratio whose numerator and denominator were
  // measured on different days is a blend, and the doctrine is publish the
  // floor, never the blend. So the measurement is ATOMIC: judge both fields
  // first, and if EITHER is rejected, retain BOTH prior values with the prior
  // date. No field of a partially rejected measurement survives on its own.
  if (Number.isFinite(prevEq) && Math.abs(newEq - prevEq) > EQ_BOUND) {
    flags.push(`equipped moved ${prevEq} → ${newEq} (${newEq - prevEq >= 0 ? "+" : ""}${newEq - prevEq}), ` +
      `beyond the bound of ${EQ_BOUND} (max(10, last30=${data.fleet.last30})). ` +
      `HEALED: kept ${prevEq}. Either the tracker changed shape or the parse is wrong — check by hand.`);
    healedEquipped = true;
  }

  let totWobble = null;
  if (Number.isFinite(prevTot) && newTot !== prevTot) {
    const moved = Math.abs(newTot - prevTot);
    if (moved > TOT_TOL) {
      flags.push(`fleet denominator moved ${prevTot} → ${newTot} (${moved} aircraft), beyond the ` +
        `tolerance of ${TOT_TOL} drawn from history. HEALED: kept ${prevTot}. The denominator is a ` +
        `published figure, not a scraped one — see fleet.published — so it must not drift silently.`);
      healedTotal = true;
    } else {
      totWobble = `fleet denominator moved ${prevTot} → ${newTot} (within the ${TOT_TOL}-aircraft ` +
        `tolerance, so accepted). Flagged anyway: this number should move rarely and deliberately.`;
    }
  }

  // PASS 2 — apply atomically.
  const anyRejected = healedEquipped || healedTotal;
  if (anyRejected) {
    data.fleet.equipped = prevEq;
    data.fleet.total = prevTot;
    if (!healedEquipped && newEq !== prevEq) {
      flags.push(`equipped ${newEq} was measured within bounds but RETAINED at ${prevEq}: the fleet ` +
        `measurement is atomic, and its denominator was rejected this run. A numerator and denominator ` +
        `measured on different days would publish a blended ratio under a single date.`);
    }
    if (!healedTotal && newTot !== prevTot) {
      flags.push(`fleet denominator ${newTot} was measured within tolerance but RETAINED at ${prevTot}: ` +
        `the fleet measurement is atomic, and its equipped count was rejected this run.`);
    }
  } else {
    data.fleet.equipped = newEq;
    data.fleet.total = newTot;
    if (totWobble) flags.push(totWobble);
  }

  // fleet.published carries United's OWN figures with publisher, URL and date.
  // Nothing in this script writes it, so its absence means somebody deleted it.
  if (!data.fleet.published || !data.fleet.published.url) {
    flags.push("fleet.published is missing or has no url. United's own sourced fleet figures were " +
      "dropped from data.json; the page has nothing to cite. Restore it from git.");
  }

  data.fleet.plausibility = { checkedOn: today, bounds: { equipped: EQ_BOUND, total: TOT_TOL }, flags };
  const report = flags.map((f) => `PLAUSIBILITY FLAG: ${f}`);
  if (rebaselineNote) report.push(rebaselineNote);
  if (!flags.length) report.push(`plausibility: clean (equipped bound ${EQ_BOUND}, total tolerance ${TOT_TOL})`);
  // healed (P1-01): true when EITHER field's fresh measurement was rejected
  // this run. update-unitedstarlink.js's main() uses this — not flags.length —
  // to decide whether today's run gets to advance measurementAsOf/updated and
  // append a new history point, or must carry the prior measurement forward.
  return { flags, report, bounds: { equipped: EQ_BOUND, total: TOT_TOL }, healed: healedEquipped || healedTotal };
}
module.exports = { plausibilityGate, DATA_FILE: FILE };

/* Guarded: requiring this file for the gate must NOT kick off the refresh and
   start hitting the tracker. The run only happens when node is pointed at it. */
/* ATOMIC RETENTION, whole-fleet (P1-01, round 12). The round-11 fix made the
   headline equipped/total pair atomic; a round-12 audit then shipped a
   BALANCED mainline/express change (sum unchanged) under the retained date,
   because the writer kept refreshing mainline, express, pace and type counts
   after deciding the fleet measurement was rejected. measurementAsOf dates the
   whole fleet observation, so on a healed day every field it covers reverts:
   the entire pre-run fleet object comes back, keeping only today's
   plausibility report (which documents the rejection itself). Exported so the
   test file can prove it against the balanced case. */
function retainFleet(data, fleetPrior) {
  const plaus = data.fleet && data.fleet.plausibility;
  data.fleet = JSON.parse(JSON.stringify(fleetPrior));
  if (plaus) data.fleet.plausibility = plaus;
}
module.exports.retainFleet = retainFleet;

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const summary = [];
  // Snapshot the whole dated fleet observation BEFORE anything touches it,
  // so a healed run can put all of it back (see retainFleet above).
  const fleetPrior = JSON.parse(JSON.stringify(data.fleet));

  // measurementAsOf / refreshAttemptedOn (P1-01): captured BEFORE anything in
  // this run mutates data.updated/data.measurementAsOf, so a healed/retained
  // run has the true prior value to carry forward. Falls back to the old
  // `updated` field for a data.json written before these two fields existed.
  const priorMeasurementAsOf = data.measurementAsOf || data.updated;

  // ── 1. fleet headline ───────────────────────────────
  const home = strip(await get(BASE + "/"));
  const mHead = home.match(/([\d,]+) of ([\d,]+) United Airlines aircraft \(\s*(\d+(?:\.\d+)?)\s*%\s*\) have Starlink WiFi installed\s*(?:,\s*including ([\d,]+) in the last 30 days)?/)
    || home.match(/([\d,]+) of ([\d,]+) United aircraft\s*(\d+(?:\.\d+)?)\s*%\s*have Starlink(?:\s*·\s*\+\s*([\d,]+) in the last 30 days)?/);
  if (!mHead) throw new Error("fleet headline not found on homepage");
  const num = (s) => +String(s).replace(/,/g, "");

  // ── 1a. the plausibility gate. Mutates data.fleet and returns its own flags.
  const gate = plausibilityGate(data, num(mHead[1]), num(mHead[2]), today);
  for (const line of gate.report) summary.push(line);
  // healed (P1-01): a fresh fleet measurement was NOT accepted this run
  // (equipped and/or total were rejected and the prior value kept). That
  // means today's run has nothing new to report about the fleet count itself
  // — measurementAsOf must stay at the old date and no new history point for
  // today may be appended, or the retained number would look independently
  // re-measured on a day it was not.
  const healed = gate.healed;

  if (mHead[4]) data.fleet.last30 = num(mHead[4]);
  // Old wording "Mainline 22% 265 / 1162"; 2026-10 wording "Mainline : 265 of 1,162 ( 22% )".
  const mMain = home.match(/Mainline\s+\d+\s*%\s+(\d+)\s*\/\s*(\d+)/)
    || home.match(/Mainline\s*:?\s*([\d,]+)\s+of\s+([\d,]+)\s*\(/);
  const mExp = home.match(/Express\s+\d+\s*%\s+(\d+)\s*\/\s*(\d+)/)
    || home.match(/Express\s*:?\s*([\d,]+)\s+of\s+([\d,]+)\s*\(/);
  if (mMain) data.fleet.mainline = { equipped: num(mMain[1]), total: num(mMain[2]) };
  if (mExp) data.fleet.express = { equipped: num(mExp[1]), total: num(mExp[2]) };
  if (!mMain || !mExp) throw new Error("mainline/express split not found on homepage");
  summary.push(`fleet: ${data.fleet.equipped}/${data.fleet.total}`);

  // ── 2. fleet page: pace + types ─────────────────────
  const fleet = strip(await get(BASE + "/fleet"));
  const mPace = fleet.match(/recent mainline pace of\s*~?\s*([\d.]+)\s*\/\s*week/);
  if (mPace) data.fleet.mainlinePacePerWeek = +mPace[1];
  const typePatterns = [
    // Hub wording as of 2026-10-06: "E175 252 / 252 · 100%", "CRJ550", "737-800", "A321neo", "777".
    // Older wording ("B737-800 95 / 141 67 %", "CRJ-550") still matches.
    ["CRJ-550", /CRJ-?550[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)[\s·]*(\d+)\s*%/], ["E175", /E175[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)[\s·]*(\d+)\s*%/],
    ["737-800", /B?737-800[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)[\s·]*(\d+)\s*%/], ["A321neo", /\bA321(?:neo)?\b[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)[\s·]*(\d+)\s*%/],
    ["737-900", /B?737-900[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)[\s·]*(\d+)\s*%/], ["777", /\bB?777\b[\s\S]{0,250}?(\d+)\s*\/\s*(\d+)[\s·]*(\d+)\s*%/],
  ];
  for (const t of data.fleet.types) {
    const pat = typePatterns.find(([name]) => name === t.type);
    if (!pat) continue;
    const m = fleet.match(pat[1]);
    if (m && +m[2] > 10) { t.equipped = +m[1]; t.total = +m[2]; }
  }
  // ── 2a. atomic retention across the WHOLE fleet observation (P1-01 r12).
  // Every fleet field written above (last30, mainline, express, pace, types)
  // shares measurementAsOf with the headline pair. If the gate rejected the
  // measurement, none of them may survive individually — a balanced
  // mainline/express shift under the retained date is still a new measurement
  // wearing an old date. Whole object back, today's gate report kept.
  if (healed) {
    retainFleet(data, fleetPrior);
    summary.push(`fleet sections RETAINED atomically at the ${priorMeasurementAsOf} measurement ` +
      `(mainline/express/pace/types kept; this run's fleet measurement was rejected)`);
  }
  summary.push(`pace: ~${data.fleet.mainlinePacePerWeek}/wk`);

  // ── 3. /routes → leaderboard ────────────────────────
  const routesHtml = strip(await get(BASE + "/routes"));
  const lb = [];
  const reLb = /([A-Z]{3})\s*–\s*([A-Z]{3})\s+(\d+)(?:\s*on\s*\d+\s*flight\s*s?)?\s*in\s*(\d+)\s*([hm])/g;
  let mlb;
  while ((mlb = reLb.exec(routesHtml)) && lb.length < 60)
    lb.push({ route: mlb[1] + "-" + mlb[2], departures: +mlb[3], next: mlb[4] + mlb[5] });
  if (lb.length < 10) {
    // Hub layout as of 2026-10-06: one row per pair, both directions, then the pair total and
    // the next local departure. Each direction becomes its own leaderboard entry so the
    // A-B route keys the rest of this file uses stay unchanged.
    const rePair = /([A-Z]{3})\s*⇄\s*([A-Z]{3})\s+([A-Z]{3})\s*→\s*([A-Z]{3})\s+(\d+)\s+([A-Z]{3})\s*→\s*([A-Z]{3})\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} [AP]M [A-Z]{3,4})/g;
    let mp;
    while ((mp = rePair.exec(routesHtml)) && lb.length < 60) {
      lb.push({ route: mp[3] + "-" + mp[4], departures: +mp[5], next: mp[10] });
      lb.push({ route: mp[6] + "-" + mp[7], departures: +mp[8], next: mp[10] });
    }
  }
  if (lb.length >= 10) data.leaderboard = lb;
  summary.push(`leaderboard: ${lb.length} routes`);

  // ── 4. refresh curated flights (predict-flight JSON) ─
  let refreshed = 0, moved = [];
  for (const key of Object.keys(data.routes)) {
    for (const f of data.routes[key].flights) {
      try {
        const j = await get(BASE + "/api/predict-flight?flight_number=" + f.fn, true);
        if (j && typeof j.probability === "number") {
          const p = Math.round(j.probability * 100);
          if (Math.abs(p - f.prob) >= 5) moved.push(`${f.fn} ${f.prob}%→${p}%`);
          f.prob = p; f.obs = j.n_observations ?? f.obs; f.conf = j.confidence ?? f.conf;
          refreshed++;
        }
      } catch {}
      await sleep(150);
    }
    // recompute verdicts
    const fl = data.routes[key].flights;
    const maxP = Math.max(...fl.map((f) => f.prob));
    for (const f of fl) {
      const zeroFleet = /MAX|A319|A320(?!.*neo)|757/i.test(f.aircraft);
      f.verdict = f.prob === maxP && f.prob >= 30 ? "best"
        : f.prob >= 35 ? "good"
        : f.prob >= 20 ? (zeroFleet ? "risky" : "ok")
        : "avoid";
    }
  }
  summary.push(`curated flights refreshed: ${refreshed}${moved.length ? " (moved: " + moved.join(", ") + ")" : ""}`);

  // ── 5. routeCache: plan-route + per-route flight ranking ─
  const cacheTargets = [...new Set([...HUB_PAIRS, ...(data.leaderboard || []).map((r) => r.route)])].slice(0, MAX_CACHE_ROUTES);
  data.routeCache = data.routeCache || {};
  let cached = 0;
  for (const key of cacheTargets) {
    const [o, d] = key.split("-");
    try {
      const plan = await get(`${BASE}/api/plan-route?origin=${o}&destination=${d}`, true);
      await sleep(150);
      const flights = await mcpPredictRoute(o, d);
      data.routeCache[key] = {
        ts: new Date().toISOString(),
        flights,
        itineraries: (plan.itineraries || []).slice(0, 6).map((it) => ({
          via: it.via || [], joint: +(it.joint_probability * 100).toFixed(1),
          any: +(it.at_least_one_probability * 100).toFixed(1),
          coverage: it.coverage, hours: +(+it.total_flight_hours).toFixed(1),
          legs: (it.legs || []).map((l) => ({ fn: l.flight_number, route: l.route,
            p: Math.round(l.probability * 100), obs: l.n_observations, conf: l.confidence })),
        })),
      };
      cached++;
    } catch (e) { summary.push(`routeCache SKIP ${key}: ${e.message.slice(0, 80)}`); }
    await sleep(200);
  }
  // drop cache entries older than 7 days
  for (const [k, v] of Object.entries(data.routeCache))
    if (Date.now() - Date.parse(v.ts) > 7 * 864e5) delete data.routeCache[k];
  summary.push(`routeCache: ${cached}/${cacheTargets.length} routes refreshed`);

  // ── 5b. full equipped-tail roster (authoritative) ───
  // Each tail carries its own install ("first seen") date, so the on-page
  // changelog builds a real per-day timeline of which jets went live, by type.
  try {
    // The hub's MCP caps list_starlink_aircraft at 500 per call and the fleet passed 500
    // equipped tails in September 2026, so pull each fleet separately and merge.
    const byFleet = await Promise.all([mcpListAircraft(500, "express"), mcpListAircraft(500, "mainline")]);
    const seenTail = new Set();
    const roster = byFleet.flat().filter((r) => !seenTail.has(r.tail) && seenTail.add(r.tail));
    if (roster.length >= data.fleet.equipped * 0.9) {   // sanity: near-full pull
      roster.sort((a, b) => (a.seen < b.seen ? 1 : a.seen > b.seen ? -1 : a.tail < b.tail ? -1 : 1));
      data.roster = roster;                              // newest install first
      summary.push(`roster: ${roster.length} tails (newest ${roster[0].seen})`);
    } else {
      summary.push(`roster SKIP: only ${roster.length} tails parsed (keeping prior)`);
    }
  } catch (e) { summary.push(`roster SKIP: ${e.message.slice(0, 80)}`); }

  // ── 6. history + stamp ──────────────────────────────
  // Each daily entry is a self-contained snapshot so the on-page changelog can
  // diff consecutive days without any git archaeology. We record:
  //   types      – per-type equipped counts  → "which aircraft types went live"
  //   leaderboard– {route: departures}        → "which routes gained frequency"
  //   moved      – flight prob changes (≥5pt)  → "which routes' odds improved"
  //   newTails   – tails whose install date is today, straight from the roster.
  const typeSnapshot = {};
  for (const t of data.fleet.types) typeSnapshot[t.type] = t.equipped;

  const lbSnapshot = {};
  for (const r of (data.leaderboard || [])) lbSnapshot[r.route] = r.departures;

  // real new tails: roster entries whose install date is today. (The changelog
  // draws the full timeline from data.roster; this keeps a per-day record too.)
  const newTails = (data.roster || [])
    .filter((r) => r.seen === today)
    .map((r) => `${r.tail} (${r.type})`);
  data.knownTails = (data.roster || []).map((r) => r.tail).sort();

  const snapshotFields = {
    types: typeSnapshot,
    leaderboard: lbSnapshot,
    moved,                 // e.g. ["UA1450 62%→70%"]
    newTails,              // tails installed today, from the roster
  };
  // measurementAsOf / refreshAttemptedOn (P1-01): the pipeline ATTEMPTED a
  // refresh today regardless of outcome, so refreshAttemptedOn always advances.
  // measurementAsOf only advances when the fleet count itself was a fresh,
  // accepted measurement this run (`!healed`); a healed/retained run carries
  // the prior measurement date forward instead of relabelling old data with
  // today's date. `updated` is kept equal to measurementAsOf — that is the
  // semantics the repo (build/lib/data.js) already reads it for.
  data.refreshAttemptedOn = today;
  data.measurementAsOf = healed ? priorMeasurementAsOf : today;
  data.updated = data.measurementAsOf;

  if (!healed) {
    const existing = data.history.find((h) => h.date === data.measurementAsOf);
    if (existing) {
      // backfill any fields missing on an entry written earlier today
      for (const [k, v] of Object.entries(snapshotFields))
        if (existing[k] === undefined) existing[k] = v;
    } else {
      data.history.push({ date: data.measurementAsOf, equipped: data.fleet.equipped, total: data.fleet.total,
        mainline: data.fleet.mainline.equipped, express: data.fleet.express.equipped,
        ...snapshotFields });
    }
    summary.push(`history: ${data.history.length} days${newTails.length ? ", new tails: " + newTails.join(",") : ""}`);
  } else {
    // A healed/retained day is not a new measurement — appending a same-day
    // history point here would show the exact same figure as if it had been
    // independently re-measured on the attempt date. Skip it; the last real
    // measurement's history point already carries this value.
    summary.push(`history: retained/healed measurement (kept measurementAsOf=${priorMeasurementAsOf}) — ` +
      `no new history point appended for the ${today} attempt (${data.history.length} days unchanged)`);
  }

  // ── 7. atomic write + self-check ────────────────────
  const out = JSON.stringify(data, null, 1);
  JSON.parse(out); // throws if broken
  fs.writeFileSync(FILE + ".tmp", out);
  fs.renameSync(FILE + ".tmp", FILE);
  summary.push(`wrote ${FILE} (${(out.length / 1024).toFixed(0)} KB, refreshAttemptedOn=${data.refreshAttemptedOn}, ` +
    `measurementAsOf=${data.measurementAsOf}, updated=${data.updated}, history=${data.history.length} days)`);

  console.log(summary.join("\n"));
}

if (require.main === module) {
  main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
}
