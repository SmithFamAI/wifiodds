/* airlines.js — static WiFi ConnectScore map (v2.0)
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVENANCE — this file is a COPY of the browser extension's
 * `extension/airlines.js` (repo: jeremyinthebay/united-starlink-companion,
 * branch bridge-1.6). That file is the single source of truth for now; this
 * copy exists so wifiodds.com can render the same scores without depending on
 * the extension repo. If you change one, change the other — until the
 * `airlines` table in Supabase replaces both (Phase B of
 * wifiodds-infrastructure-plan.md). The site loads it as a plain classic
 * script: the top-level consts below become globals for the inline page
 * scripts, and the module.exports guard at the bottom is a no-op in a browser.
 * ═══════════════════════════════════════════════════════════════════════════
 * A plain classic script (loaded by popup.html BEFORE popup.js) that defines
 * one global const WIFI_AIRLINES plus pure scoring helpers. It makes NO network
 * calls and touches no chrome.* API — it is a frozen snapshot of what was true
 * in July 2026, so it can be unit-tested straight from node.
 *
 * ConnectScore (0–100) = P(connectivity) × systemQuality × freeFactor
 *
 *   P(connectivity)  share of the fleet actually carrying the system
 *   systemQuality    Starlink / Amazon Leo 1.0 · Viasat / 2Ku 0.6 · legacy GEO 0.3
 *   freeFactor       free-for-all or free-with-a-free-loyalty-program 1.0 ·
 *                    paid loyalty tier / partial / unconfirmed 0.85 · paid 0.7
 *
 * Mixed fleets blend: pct × 1.0 × starlinkFree + (1 − pct) × legacyQ × legacyFree.
 * No airline in the July 2026 set actually needs the blend (American, Delta and
 * jetBlue are pure-legacy today, with signed LEO deals that are NOT scored), but
 * the machinery is here and exercised by tests — American becomes the mixed case
 * the moment its Airbus Starlink installs start in 2027.
 *
 * DELIBERATE OMISSION — a Starlink carrier's score credits ONLY the Starlink
 * fleet. Legacy GEO wifi on the rest of those fleets is not modelled, because the
 * numbers for it are not in this data set and the score is meant to answer "what
 * are my odds of the good wifi", not "is there any wifi at all". That is why
 * Southwest (1 of 803 Starlink) scores near zero despite having fleetwide legacy
 * service. See SCORE_CAVEAT, which the popup shows as a tooltip.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE-TIER READING (added Jul 2026) — TWO NUMBERS, NEVER ONE
 *
 * The single ConnectScore above answers "what are my odds of the GOOD system".
 * It is the right headline and it is also, on its own, misleading in one specific
 * direction: Delta scores 52 on free near-fleetwide Viasat and United 27 on a
 * quarter-finished Starlink fleet, so a reader who skims one number concludes
 * Delta has better WiFi than United's Starlink. Both facts are true; the
 * comparison is not the one the reader thinks they are making.
 *
 * So every surface now shows the fleet TWICE:
 *
 *   nextGenScore  the headline. Odds of a NEXT-GEN system — Starlink or Amazon
 *                 Leo, the only two low-earth-orbit products flying — times
 *                 free-for-you. Delta is 0 here. A signed deal is still zero.
 *   serviceTier   what the fleet actually delivers TODAY, in three words:
 *                   next-gen   — LEO across (effectively) the whole fleet
 *                   streaming  — modern GEO fleetwide: Viasat / 2Ku, e.g. Delta
 *                                Sync. Streams, uploads, real work.
 *                   basic      — legacy Panasonic / Ku. Email and messaging.
 *                   mixed      — part of the fleet is next-gen, the rest is one
 *                                of the two above (United: "Starlink 27%, rest
 *                                streaming-class or basic")
 *   restTier      the tier on the part of the fleet that is NOT next-gen yet.
 *                 "unknown" is honest and common: we have verified next-gen tail
 *                 counts, not a verified inventory of everyone's old hardware, so
 *                 it renders as "streaming-class or basic" rather than a guess.
 *
 * Both fields are DATA, not prose: the wording lives in the site/popup, the keys
 * live here, and build/prerender.js fails the build if a stored serviceTier
 * disagrees with the fleet share it is supposed to describe.
 *
 * We do not promise video calls anywhere. "Streams, uploads, real work" is the
 * claim the hardware supports; a Zoom call at 35,000 feet over a full cabin is
 * not something this data set can honestly underwrite.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WIFI_AIRLINES = {
  /* ── instrumented: the extension can show real per-flight odds for these ── */
  united: {
    name: "United", code: "UA", asOf: "2026-07",
    system: "starlink", equipped: 481, fleet: 1807, free: "loyalty-free",
    instrumented: true, tracker: "unitedstarlinktracker.com",
    serviceTier: "mixed", restTier: "unknown",
    note: "481 of 1,807 aircraft — free for MileagePlus members. Odds swing a lot by route and aircraft type.",
  },
  alaska: {
    name: "Alaska", code: "AS", asOf: "2026-07",
    system: "starlink", equipped: 99, fleet: 350, free: "free",
    instrumented: true, tracker: "alaskastarlinktracker.com",
    serviceTier: "mixed", restTier: "unknown",
    note: "99 of 350 mainline + regional and installing fast; the ex-Hawaiian widebodies are counted under Hawaiian.",
  },

  /* ── Starlink, no per-flight instrumentation ── */
  jsx: {
    name: "JSX", code: "XE", asOf: "2026-07",
    system: "starlink", equipped: 75, fleet: 75, free: "free",
    serviceTier: "next-gen", restTier: null,
    note: "Every aircraft in the fleet — the first airline anywhere to finish its Starlink rollout.",
  },
  airbaltic: {
    name: "airBaltic", code: "BT", asOf: "2026-07",
    system: "starlink", equipped: 55, fleet: 55, free: "free",
    serviceTier: "next-gen", restTier: null,
    note: "Entire A220 fleet equipped — the first European airline to complete a Starlink fit.",
  },
  zipair: {
    name: "ZIPAIR", code: "ZG", asOf: "2026-07",
    system: "starlink", equipped: 9, fleet: 9, free: "free",
    serviceTier: "next-gen", restTier: null,
    note: "All nine 787s equipped, free onboard.",
  },
  westjet: {
    name: "WestJet", code: "WS", asOf: "2026-07",
    system: "starlink", equipped: 151, fleet: 159, free: "free",
    serviceTier: "next-gen", restTier: "unknown",
    note: "151 of 159 — fleetwide install all but finished.",
  },
  airfrance: {
    name: "Air France", code: "AF", asOf: "2026-07",
    system: "starlink", equipped: 172, fleet: 229, free: "free",
    serviceTier: "mixed", restTier: "unknown",
    note: "172 of 229 done and free for all Flying Blue members.",
  },
  hawaiian: {
    name: "Hawaiian", code: "HA", asOf: "2026-07",
    system: "starlink", equipped: 42, fleet: 61, free: "free",
    tracker: "airlinestarlinktracker.com",
    serviceTier: "mixed", restTier: "unknown",
    note: "42 of 61 — the widebody fit is nearly complete, the best Starlink odds of any US carrier.",
  },
  qatar: {
    name: "Qatar Airways", code: "QR", asOf: "2026-07",
    system: "starlink", equipped: 140, fleet: 241, free: "free",
    serviceTier: "mixed", restTier: "unknown",
    note: "140 of 241 fitted with Starlink; free for every passenger in every cabin, no sign-up (OMAAT, Jul 2026).",
  },
  sas: {
    name: "SAS", code: "SK", asOf: "2026-07",
    system: "starlink", equipped: 60, fleet: 123, free: "loyalty-free",
    serviceTier: "mixed", restTier: "unknown",
    note: "About half the fleet equipped and still installing; free for EuroBonus members (free to join) since 2026-03-24 (SAS/Business Travel News Europe).",
  },
  emirates: {
    name: "Emirates", code: "EK", asOf: "2026-07",
    system: "starlink", equipped: 36, fleet: 232, free: "free",
    serviceTier: "mixed", restTier: "unknown",
    note: "36 of 232 so far, free onboard — the widebody retrofit is early.",
  },
  virginatlantic: {
    name: "Virgin Atlantic", code: "VS", asOf: "2026-07",
    system: "starlink", equipped: 12, fleet: 43, free: "loyalty-free",
    serviceTier: "mixed", restTier: "unknown",
    note: "12 of 43 aircraft; free for Flying Club members (free to join) since launch 2026-05-01 (OMAAT/Virgin Atlantic).",
  },
  aircanada: {
    name: "Air Canada", code: "AC", asOf: "2026-07",
    system: "starlink", equipped: 12, fleet: 216, free: "loyalty-free",
    serviceTier: "mixed", restTier: "unknown",
    note: "Just started — 12 Q400s equipped out of 216; free for Aeroplan members (free to join), per seatwifi.com/Runway Girl, Jun 2026.",
  },
  britishairways: {
    name: "British Airways", code: "BA", asOf: "2026-07",
    system: "starlink", equipped: 5, fleet: 261, free: "free",
    serviceTier: "mixed", restTier: "unknown",
    note: "Rollout paused summer 2026 — only 5 aircraft equipped; free for every customer in every cabin once fitted (BA mediacentre, Mar 2026 launch).",
  },
  southwest: {
    name: "Southwest", code: "WN", asOf: "2026-07",
    /* fleet: 803 Boeing 737s as of Dec 31 2025, read verbatim from Southwest's
       FY2025 10-K (filed 2026-02-05). The 817 previously here was the Dec 31
       2023 figure and had gone stale. Third-party trackers still quote 817. */
    system: "starlink", equipped: 1, fleet: 803, free: "loyalty-free",
    serviceTier: "mixed", restTier: "unknown",
    note: "First Starlink aircraft (N8543Z) entered service 2026-06-22; Southwest targets 300+ of 803 by year-end. Free for Rapid Rewards members. Legacy wifi on the rest of the fleet is not scored.",
  },

  /* ── legacy GEO today, LEO signed for later (future deals are NOT scored) ── */
  american: {
    name: "American", code: "AA", asOf: "2026-07",
    system: "viasat", equipped: 890, fleet: 989, free: "free",
    future: { system: "starlink", from: "2027-Q1", detail: "500+ Airbus aircraft signed" },
    /* the only entry with a KNOWN rest tier: AA's free Viasat/Intelsat covers ~90%
       of the fleet and the Panasonic widebodies are explicitly excluded from it */
    serviceTier: "streaming", restTier: "basic",
    note: "Free Viasat/Intelsat on ~90% of the fleet today. Airbus-only Starlink from 2027 — Boeing stays Viasat.",
  },
  delta: {
    name: "Delta", code: "DL", asOf: "2026-07",
    /* CORRECTED 2026-07-25. coverage was 1.0 ("streaming-class fleetwide"),
       which is not true today. Delta's own two public data points bound it:
         · 2025-12-08 — "1,000+ Sync-equipped aircraft, >75% of the entire
           fleet"  ⇒ total fleet ≈ 1,330
         · 2026-03-31 press release — "more than 1,150 aircraft"
       1,150 / ~1,330 ≈ 0.86. The uncovered ~14% is real and specific:
         · the 80 Boeing 717s, whose legacy Intelsat/Gogo units Delta
           DEACTIVATED in May 2026 ahead of the Hughes Fusion retrofit — most
           are flying with NO wifi at all through the summer 2026 schedule
         · A330/A350 transpacific service, which Delta says comes online
           "fall 2026" — i.e. not live as of this date
       Delta's modern service is Viasat AND Hughes, not Viasat alone. */
    system: "viasat", coverage: 0.86, free: "free",
    future: { system: "leo", from: "2028", detail: "Amazon Leo signed for 500 aircraft" },
    serviceTier: "streaming", restTier: "basic",
    note: "Delta Sync (Viasat + Hughes) on 1,150+ aircraft, free for SkyMiles members — but not fleetwide: the 80 Boeing 717s lost their legacy wifi in May 2026 awaiting the Hughes retrofit, and transpacific widebodies come online fall 2026. Amazon Leo lands on 500 aircraft from 2028.",
  },
  jetblue: {
    name: "jetBlue", code: "B6", asOf: "2026-07",
    /* coverage stays 1.0 — every one of the 291 aircraft (129 A320, 101 A321,
       61 A220 as of 2026-03-31, per JetBlue's Q1 8-K) carries Viasat Ka-band
       Fly-Fi. What the old copy hid is that there are TWO HARDWARE
       GENERATIONS: the A220-300s and A321neo/LRs shipped with ViaSat-2, while
       most A320/A321ceo airframes still run the original ~2013 ViaSat-1 kit.
       A "Phase 2" refresh has moved an unpublished subset of A320s to
       ViaSat-2, so no hard per-type count is citable — hence "most", not a
       number. The E190s (the one sub-fleet with patchy Fly-Fi) were fully
       retired 2025-09-10. Amazon Leo from 2027 explicitly targets the
       first-gen kit first. */
    system: "viasat", coverage: 1.0, free: "free",
    future: { system: "leo", from: "2027", detail: "Amazon Leo" },
    serviceTier: "streaming", restTier: null,
    note: "Free “Fly-Fi” Viasat on every aircraft, but two hardware generations: the A220s and A321neo/LRs carry the faster ViaSat-2, while most A320/A321ceo airframes still run the original ViaSat-1. Amazon Leo arrives 2027, first-gen aircraft first.",
  },
};

/* ── scoring constants ───────────────────────────────────────────────────── */
const SYSTEM_QUALITY = {
  starlink: 1.0,
  leo: 1.0,          // Amazon Leo (ex-Kuiper) — same LEO class as Starlink
  viasat: 0.6,
  "2ku": 0.6,        // Intelsat/Gogo 2Ku
  intelsat: 0.6,
  geo: 0.3,          // legacy GEO
  panasonic: 0.3,
  none: 0,
};

const FREE_FACTOR = {
  free: 1.0,               // free for everyone onboard
  "loyalty-free": 1.0,     // free with a free-to-join loyalty program
  "loyalty-tier": 0.85,    // free only on a paid status tier
  partial: 0.85,           // free on some cabins/routes only
  unknown: 0.85,           // not confirmed free in this data set — never assumed
  paid: 0.7,
};

/* ── the three-tier reading ───────────────────────────────────────────────
 * NEXT_GEN_SYSTEMS is derived-by-hand from SYSTEM_QUALITY on purpose: "quality
 * 1.0" and "low-earth orbit" happen to coincide today, but they are different
 * claims, and if a future GEO product ever earned 1.0 it still would not be
 * next-gen. Keep the list explicit. */
const NEXT_GEN_SYSTEMS = { starlink: true, leo: true };

/* A fleet is called next-gen once the retrofit is effectively done. 0.9 rather
 * than 1.0 because WestJet's last eight aircraft should not make the other 151
 * read as a coin flip — the numbers are shown either way. */
const NEXT_GEN_DONE = 0.9;

const SERVICE_TIER_LABEL = {
  "next-gen": "next-gen fleetwide",
  mixed: "mixed",
  streaming: "streaming-class",
  basic: "basic",
};

/* What the not-yet-converted part of the fleet gets. "unknown" is the common,
 * honest case: we have verified next-gen tail counts, not a verified inventory
 * of everybody's older hardware. */
const REST_TIER_LABEL = {
  streaming: "streaming-class",
  basic: "basic",
  unknown: "streaming-class or basic",
};

/* One sentence per tier, for the surfaces that have room. No video-call promise
 * anywhere in here — see the header. */
const SERVICE_TIER_BLURB = {
  "next-gen": "Low-earth-orbit across the fleet: streams, uploads, real work.",
  mixed: "Part of the fleet is low-earth orbit; the rest is older satellite service.",
  /* Deliberately says nothing about COVERAGE — the blurb describes the class of
     service, and how much of the fleet has it is a separate number that the
     surfaces state themselves. Saying "fleetwide" here made Delta's card claim
     something Delta's own data contradicts. */
  streaming: "Modern geostationary service — streams, uploads, real work, " +
    "with more lag than low-earth orbit.",
  basic: "Legacy satellite service — email, messaging, and not much else.",
};

// Display names for the hardware, so the popup never has to map them itself.
const SYSTEM_LABEL = {
  starlink: "Starlink",
  leo: "Amazon Leo",
  viasat: "Viasat",
  "2ku": "2Ku",
  intelsat: "Intelsat",
  geo: "legacy GEO",
  panasonic: "Panasonic",
};

const SCORE_CAVEAT =
  "ConnectScore is the chance of getting the GOOD system, not of any wifi at all. " +
  "Legacy satellite service on the not-yet-converted part of a fleet is not credited. " +
  "Signed-but-unflown deals (AA Starlink 2027, DL/B6 Amazon Leo) score zero until they fly.";

const SCORE_METHOD_LINE =
  "ConnectScore = connectivity probability × system quality × free-for-you. " +
  "Data: unitedstarlinktracker.com · alaskastarlinktracker.com · airline announcements (Jul 2026).";

/* The headline line for the two-number reading. Deliberately says what it does
 * NOT count: a signed deal, and the older hardware on the rest of the fleet. */
const TIER_METHOD_LINE =
  "Next-gen odds = share of the fleet flying Starlink or Amazon Leo today × free-for-you. " +
  "Signed-but-unflown deals count zero. The second line is what the fleet actually " +
  "delivers today: next-gen, streaming-class, basic, or mixed.";

/* ── pure helpers ────────────────────────────────────────────────────────── */
function clamp01(n) {
  if (typeof n !== "number" || isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function systemQuality(system) {
  const q = SYSTEM_QUALITY[String(system || "").toLowerCase()];
  return typeof q === "number" ? q : 0.3; // unknown hardware scores as legacy GEO
}
function freeFactor(free) {
  const f = FREE_FACTOR[String(free || "").toLowerCase()];
  return typeof f === "number" ? f : 0.85;
}
// Share of the fleet carrying the primary system. equipped/fleet when both are
// known, otherwise an explicit `coverage` fraction (Delta/jetBlue publish no
// tail counts, only "fleetwide").
function pctEquipped(entry) {
  if (!entry) return 0;
  if (typeof entry.fleet === "number" && entry.fleet > 0)
    return clamp01((entry.equipped || 0) / entry.fleet);
  return clamp01(entry.coverage);
}

function labelFor(score) {
  if (score >= 85) return "excellent";
  if (score >= 60) return "good";
  if (score >= 35) return "mixed";
  if (score >= 20) return "long shot";
  if (score >= 5) return "rare";
  return "not yet";
}
// Same thresholds as the flight badges in popup.js, so the chips read the same.
function scoreClass(score) {
  if (score >= 50) return "usl-pct-hi";
  if (score >= 35) return "usl-pct-mid";
  if (score >= 20) return "usl-pct-low";
  return "usl-pct-no";
}

/* ── the three-tier helpers ───────────────────────────────────────────────
 * These are ADDITIVE. scoreEntry() and scoreAirline() keep returning every field
 * they returned before, including `score`; nothing here changes a single existing
 * number. What they add is the second axis: how much of the fleet is next-gen
 * (the headline) versus what the fleet actually delivers today (the tier). */

function isNextGen(system) {
  return NEXT_GEN_SYSTEMS[String(system || "").toLowerCase()] === true;
}

/* Share of the fleet on a next-gen system RIGHT NOW. A signed deal is not a
 * system: `future` never contributes here, which is the whole point. */
function nextGenShare(entry) {
  if (!entry || !isNextGen(entry.system)) return 0;
  return pctEquipped(entry);
}

/* The headline number: odds of drawing a next-gen aircraft, times free-for-you.
 * System quality is not a factor because next-gen IS the quality ceiling (1.0) —
 * multiplying by it would just be multiplying by one. */
function nextGenScore(entry) {
  if (!entry) return 0;
  return Math.round(clamp01(nextGenShare(entry) * freeFactor(entry.free)) * 100);
}

/* The stored tier is the answer; the derivation is the fallback AND the check.
 * build/prerender.js asserts the two agree, so a fleet that crosses the
 * threshold cannot keep a stale word next to a fresh number. */
function serviceTierOf(entry) {
  if (!entry) return "basic";
  if (entry.serviceTier) return entry.serviceTier;
  const share = nextGenShare(entry);
  if (share >= NEXT_GEN_DONE) return "next-gen";
  if (share > 0) return "mixed";
  return systemQuality(entry.system) >= 0.6 ? "streaming" : "basic";
}
function serviceTierExpected(entry) {
  const share = nextGenShare(entry);
  if (share >= NEXT_GEN_DONE) return "next-gen";
  if (share > 0) return "mixed";
  return systemQuality(entry.system) >= 0.6 ? "streaming" : "basic";
}
function serviceTierLabel(entry) {
  return SERVICE_TIER_LABEL[serviceTierOf(entry)] || serviceTierOf(entry);
}
function restTierLabel(entry) {
  const r = entry && entry.restTier;
  return r ? (REST_TIER_LABEL[r] || r) : null;
}

/* Score any entry object — the blend lives here so it can be tested against a
 * synthetic mixed fleet without inventing a fake airline in the map. */
function scoreEntry(entry) {
  if (!entry) return null;
  const p = pctEquipped(entry);
  const q = systemQuality(entry.system);
  const f = freeFactor(entry.free);
  const primary = p * q * f;

  let legacyPart = null;
  let legacy = 0;
  if (entry.legacy) {
    // Legacy can only cover what the primary system does not.
    const cov = Math.min(clamp01(entry.legacy.coverage), 1 - p);
    const lq = systemQuality(entry.legacy.system);
    const lf = freeFactor(entry.legacy.free);
    legacy = cov * lq * lf;
    legacyPart = { coverage: cov, systemQuality: lq, freeFactor: lf, contribution: legacy };
  }

  const raw = clamp01(primary + legacy);
  const score = Math.round(raw * 100);
  return {
    score,
    label: labelFor(score),
    parts: {
      pctEquipped: p,
      systemQuality: q,
      freeFactor: f,
      primary: primary,
      legacy: legacyPart,
      raw: raw,
    },
  };
}

/* scoreAirline(key) → {key, name, score, label, parts, note, …} or null. */
function scoreAirline(key) {
  const entry = WIFI_AIRLINES[key];
  if (!entry) return null;
  const s = scoreEntry(entry);
  return {
    key: key,
    name: entry.name,
    code: entry.code || null,
    system: entry.system,
    systemLabel: SYSTEM_LABEL[entry.system] || entry.system,
    score: s.score,
    label: s.label,
    cls: scoreClass(s.score),
    parts: s.parts,
    note: entry.note || "",
    equipped: typeof entry.fleet === "number" ? entry.equipped : null,
    fleet: typeof entry.fleet === "number" ? entry.fleet : null,
    instrumented: !!entry.instrumented,
    tracker: entry.tracker || null,
    future: entry.future || null,
    asOf: entry.asOf || null,
    /* ── the second axis. Every field above is unchanged; these are new. ── */
    nextGenScore: nextGenScore(entry),
    nextGenShare: nextGenShare(entry),
    nextGenSystem: isNextGen(entry.system) ? entry.system : null,
    nextGenLabel: isNextGen(entry.system) ? (SYSTEM_LABEL[entry.system] || entry.system) : null,
    serviceTier: serviceTierOf(entry),
    serviceTierLabel: serviceTierLabel(entry),
    serviceTierBlurb: SERVICE_TIER_BLURB[serviceTierOf(entry)] || "",
    restTier: entry.restTier || null,
    restTierLabel: restTierLabel(entry),
  };
}

/* Every airline, best odds first; ties break alphabetically so the order is
 * stable across runs (three carriers sit at 100). */
function rankAirlines() {
  return Object.keys(WIFI_AIRLINES)
    .map(scoreAirline)
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
}

/* node harness support; `module` is undefined in the popup, so this is a no-op
 * there and the file stays a plain classic script. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WIFI_AIRLINES, SYSTEM_QUALITY, FREE_FACTOR, SYSTEM_LABEL,
    NEXT_GEN_SYSTEMS, NEXT_GEN_DONE, SERVICE_TIER_LABEL, REST_TIER_LABEL,
    SERVICE_TIER_BLURB,
    SCORE_CAVEAT, SCORE_METHOD_LINE, TIER_METHOD_LINE,
    clamp01, systemQuality, freeFactor, pctEquipped,
    isNextGen, nextGenShare, nextGenScore,
    serviceTierOf, serviceTierExpected, serviceTierLabel, restTierLabel,
    labelFor, scoreClass, scoreEntry, scoreAirline, rankAirlines,
  };
}
