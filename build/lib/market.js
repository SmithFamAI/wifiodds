'use strict';
/* build/lib/market.js — the two EDITORIAL data sets behind /race/ and /systems/.
 *
 * ═══ WHY THIS IS NOT IN assets/airlines.js ═════════════════════════════════
 * airlines.js is a byte-copy of the browser extension's own airlines.js (README,
 * "Change one, change the other") and it is imported by the public API. Anything
 * added there has to be worth carrying in both. Rollout prose and a satellite
 * hardware primer are page CONTENT: the extension will never render them and the
 * API will never return them. They live here, where only the build reads them.
 *
 * ═══ PROVENANCE — every claim below, and where it came from ════════════════
 * Two sources, both already on this machine, both dated:
 *   1. `assets/airlines.js` — the per-airline `note` and `future` fields, which
 *      carry the fleet counts and the announcement dates. asOf 2026-07.
 *   2. `~/websites/unitedstarlink-2.0-vision.md` §1 "Market ground truth
 *      (verified July 2026)" — the industry totals (46 airline programs: 4 fully
 *      deployed, 17 actively installing, 25 signed), the American/Delta/JetBlue
 *      deal dates, the Emirates and Alaska completion targets, the British
 *      Airways pause, and the "Starlink is 100+ Mbps on paper, 20–80 real-world"
 *      figure. Each of those was link-verified the week it was written.
 * NOTHING here was researched fresh, and nothing here is a number this project
 * derived itself. Where neither source gives a completion date, the row says so
 * — `target: null` renders as "no public completion date", not as a guess. That
 * is the same rule as `prob: null` in the API.
 *
 * Fleet counts are NEVER repeated here. They are read live off airlines.js at
 * render time, so a row in the timeline cannot disagree with the same airline's
 * card on the homepage. If you find yourself typing "481" into this file, stop.
 */

/* asOf travels with the data onto the page, per the citation rule. */
var AS_OF = '2026-07';
var VERIFIED = 'July 2026';

/* Industry totals — vision doc §1, sourced there to starlinkflights.com's
 * 46-airline status list. Ours is the scored subset, not the whole market, and
 * the page says so rather than implying we track all 46. */
var INDUSTRY = {
  asOf: AS_OF,
  programs: 46,
  deployed: 4,
  installing: 17,
  signed: 25,
  source: 'starlinkflights.com’s 46-airline status list, via our own market review, ' + VERIFIED
};

/* ── the finish lines ──────────────────────────────────────────────────────
 * key → { target, detail, source }
 *   target  the airline's own published completion commitment, verbatim in
 *           substance. null when neither source has one — rendered as "no public
 *           completion date", which is a fact about the airline, not about us.
 *   detail  what the two sources actually say. No fleet numbers: those come from
 *           airlines.js at render time.
 */
var ROLLOUT = {
  united: {
    target: '500+ mainline by end-2026, ~800 aircraft in total',
    detail: 'All 300-plus two-cabin regional jets were finished in February 2026, and United ran a ' +
      'Super Bowl ad about it. This is a mass-market amenity now, not an avgeek curiosity. Mainline ' +
      'is the long half and the one still moving daily.',
    source: 'United PR / Simple Flying, ' + VERIFIED
  },
  alaska: {
    target: 'full completion targeted end-2027',
    detail: 'Free for everyone onboard. The E175 regional fleet is done and the mainline 737s are ' +
      'the work in front; the ex-Hawaiian A330s and A321neos are counted under Hawaiian here.',
    source: 'Alaska Airlines PR, ' + VERIFIED
  },
  hawaiian: {
    target: 'widebody fit nearly complete',
    detail: 'The highest next-gen share of any US carrier, and it went from no wifi at all straight ' +
      'to Starlink in 2024, having never had Viasat. The 19 Boeing 717s flying about 150 ' +
      'interisland departures a day have never carried connectivity, and Alaska Air Group has said ' +
      'twice that they never will. Inherited into the Alaska group, which is why the two entries ' +
      'have to be read together rather than added up.',
    source: 'airlinestarlinktracker.com, ' + VERIFIED
  },
  jsx: {
    target: 'complete',
    detail: 'The first airline anywhere to finish a Starlink rollout. Every aircraft, free onboard.',
    source: 'starlinkflights.com list, ' + VERIFIED
  },
  airbaltic: {
    target: 'complete',
    detail: 'The entire A220 fleet, and the first European airline to complete a Starlink fit.',
    source: 'starlinkflights.com list, ' + VERIFIED
  },
  zipair: {
    target: 'complete',
    detail: 'Every 787 in the fleet, free onboard.',
    source: 'starlinkflights.com list, ' + VERIFIED
  },
  westjet: {
    target: 'mainline install all but finished; no plan announced for Encore',
    detail: 'The 737 and 787 fleet is a handful of aircraft short of done, and it was the fastest ' +
      'install of any fleet above a hundred aircraft in this set. WestJet Encore is the asterisk: ' +
      '39 Q400s, about a fifth of what a WS flight number can put you on, with no connectivity of ' +
      'any kind and nothing announced.',
    source: 'starlinkflights.com tracker + WestJet Encore fleet list, ' + VERIFIED
  },
  airfrance: {
    target: null,
    detail: 'Three quarters of the fleet done and free for every Flying Blue member. No public ' +
      'completion date, but the pace has been steady enough that the remaining quarter is the ' +
      'shorter part of the story.',
    source: 'starlinkflights.com tracker, ' + VERIFIED
  },
  qatar: {
    target: null,
    detail: 'Free for every passenger in every cabin with no sign-up at all, the most generous ' +
      'access policy in this set, on a fleet that is more than half converted.',
    source: 'OMAAT, ' + VERIFIED
  },
  sas: {
    target: null,
    detail: 'About half the fleet, still installing. Free for EuroBonus members (free to join) since ' +
      '24 March 2026.',
    source: 'SAS / Business Travel News Europe, ' + VERIFIED
  },
  emirates: {
    target: 'full widebody fleet by mid-2027; 150 aircraft targeted by end-2026',
    detail: 'An early retrofit on an all-widebody fleet, which is the slowest kind of aircraft to take ' +
      'out of service, so the target is aggressive for the fleet type.',
    source: 'Gulf News / OMAAT, ' + VERIFIED
  },
  virginatlantic: {
    target: null,
    detail: 'Launched 1 May 2026, free for Flying Club members (free to join). Early, and a small ' +
      'fleet, so each install moves the share noticeably.',
    source: 'OMAAT / Virgin Atlantic, ' + VERIFIED
  },
  aircanada: {
    target: null,
    detail: 'Just started, Q400 regionals first. The Canadian market has no per-flight tool at all ' +
      'today, which is exactly the gap instrumenting an airline early is for.',
    source: 'seatwifi.com / Runway Girl, June 2026',
  },
  britishairways: {
    target: 'PAUSED for summer 2026',
    detail: 'The only rollout in this set that has stopped. Five aircraft were fitted and then the ' +
      'programme was paused over the peak season; free for every customer in every cabin once fitted. ' +
      'A paused rollout is the case a fleet-share number describes worst, so read the date, not just ' +
      'the percentage.',
    source: 'OMAAT / BA mediacentre, ' + VERIFIED
  },
  southwest: {
    target: 'ramping through summer 2026',
    detail: 'The largest single-fleet retrofit anyone has committed to. At any believable install ' +
      'rate this fleet takes years, which makes Southwest the biggest future odds market in the ' +
      'world, and the one where a fleet-average number will be least useful for longest.',
    source: 'Southwest / starlinkflights.com tracker, ' + VERIFIED
  },
  american: {
    target: 'installs begin Q1 2027',
    detail: 'Starlink on 500-plus Airbus narrowbodies, announced 26 May 2026, free for AAdvantage ' +
      'members. The Boeing fleet stays Viasat under the current deal, so unlike United, American’s ' +
      'odds may never converge on 100%, and aircraft type will matter on every AA booking ' +
      'indefinitely. Free Viasat/Intelsat covers about 90% of the fleet meanwhile.',
    source: 'Via Satellite / AA newsroom, 26 May 2026'
  },
  delta: {
    target: 'Amazon Leo from 2028',
    detail: 'Signed 31 March 2026 for 500 aircraft, the biggest bet against Starlink in the market. ' +
      'Nothing is flying, so the next-gen number is 0 and stays 0 until hardware is in the air. Delta ' +
      'Sync (Viasat and Hughes) is free for SkyMiles members on 1,150-plus aircraft meanwhile, and it ' +
      'is genuinely streaming-class. That is why Delta’s ConnectScore is high while its next-gen ' +
      'odds are zero. It is not quite fleetwide: the 80 Boeing 717s had their legacy wifi switched ' +
      'off in May 2026 and are waiting on the Hughes retrofit, and transpacific widebodies come ' +
      'online in fall 2026.',
    source: 'Delta News Hub, 31 March 2026 · AeroXplorer / Simple Flying on the 717 gap'
  },
  jetblue: {
    target: 'Amazon Leo from 2027',
    detail: 'Amazon Leo’s first airline, a year ahead of Delta. Free Fly-Fi (Viasat) on every ' +
      'aircraft until then, in two generations: the A220s and A321neo/LRs carry ViaSat-2, ' +
      'while most A320 and A321ceo airframes still run the original 2013-era ViaSat-1 kit, which is ' +
      'exactly the sub-fleet Leo is slated to replace first. If Leo delivers on schedule this is the ' +
      'first fleet where the two low-earth-orbit systems can be compared in service.',
    source: 'CNBC, September 2025 · Viasat newsroom on the A220/A321neo fit'
  }
};

/* ── the hardware ──────────────────────────────────────────────────────────
 * `q` is not typed here — it is read out of A.SYSTEM_QUALITY at render time, so
 * the primer and the scoring weights cannot drift apart. `key` is the same key
 * airlines.js uses for `system`, which is also how the carrier column is derived.
 *
 * SPEED is the one column where honesty costs the most and matters the most. The
 * published figure and the in-cabin figure are different numbers for every one of
 * these systems, and we quote the second where a source exists for it.
 */
var SYSTEMS = [
  {
    key: 'starlink', operator: 'SpaceX', nextGen: true,
    orbit: 'Low-earth orbit, ~550 km',
    how: 'An electronically-steered flat-panel antenna on the crown of the aircraft talks to whichever ' +
      'of thousands of satellites is overhead, and the satellites relay between themselves by laser. ' +
      'Nothing mechanical has to swing to track a bird.',
    speed: '100+ Mbps advertised; roughly 20–80 Mbps in the cabin in practice, and tens of ' +
      'milliseconds of latency rather than hundreds.',
    reliability: 'Gate to gate, including mid-ocean and high-latitude routes where geostationary ' +
      'coverage thins out. Degrades with a full cabin like anything else.',
    price: 'Free on every carrier in this set that has it, sometimes gated behind a free-to-join ' +
      'loyalty programme.',
    verdict: 'The reference case. Streams, uploads, real work.'
  },
  {
    key: 'leo', operator: 'Amazon', nextGen: true,
    orbit: 'Low-earth orbit',
    how: 'The same physics class as Starlink: a large low-orbit constellation and a flat-panel ' +
      'aircraft antenna. Formerly Project Kuiper.',
    speed: 'No in-cabin measurement exists, because it is not flying on a passenger aircraft yet. We ' +
      'will not publish a number for it until there is one to publish.',
    reliability: 'Unproven in service. JetBlue is first, from 2027; Delta follows on 500 aircraft ' +
      'from 2028.',
    price: 'Announced as free on both launch carriers.',
    verdict: 'Scored as next-gen quality, and as ZERO odds on every airline until hardware flies.'
  },
  {
    key: 'viasat', operator: 'Viasat', nextGen: false,
    orbit: 'Geostationary, 35,786 km',
    how: 'One very large satellite parked over the equator, painting spot beams down onto the route ' +
      'network. The aircraft antenna points at a fixed spot in the sky.',
    speed: 'Streaming-class: enough for video, uploads and a working session. The distance costs you ' +
      'roughly half a second of round-trip lag no matter how much bandwidth is available.',
    reliability: 'Coverage thins at high latitude and over open ocean, and a full cabin on a popular ' +
      'route feels it. Delta Sync and American’s free WiFi are both this.',
    price: 'Free for members on American, Delta and jetBlue.',
    verdict: 'The working middle. Streams, uploads, real work, with lag on every round trip.'
  },
  {
    key: '2ku', operator: 'Intelsat / Gogo', nextGen: false,
    orbit: 'Geostationary',
    how: 'Two Ku-band antennas under a low-profile radome, an older generation of the same ' +
      'geostationary idea.',
    speed: 'Streaming-class on a good day, noticeably less on a busy one.',
    reliability: 'Widely fitted and well understood; the weak link is capacity per aircraft, not ' +
      'coverage.',
    price: 'Varies by carrier; often paid or loyalty-gated.',
    verdict: 'Same weight as Viasat in the score. Same lag, less headroom.'
  },
  {
    key: 'panasonic', operator: 'Panasonic Avionics', nextGen: false,
    orbit: 'Geostationary',
    how: 'The previous generation of Ku-band service, mechanically-steered on many installations.',
    speed: 'Email, messaging, a web page if you are patient. Not a working connection.',
    reliability: 'Predictably poor rather than unpredictable. It is the fleet remainder on carriers ' +
      'whose "free WiFi" announcement excluded the widebodies.',
    price: 'Usually paid, and usually not worth it.',
    verdict: 'Basic. The tier a fleet-average score hides if you only read one number.'
  },
  {
    /* Its own weight rather than a share of the legacy GEO bucket, because the
       two are unlike in opposite directions and averaging them loses both facts.
       Alaska's eleven 737-700s are the only aircraft in this data set flying it. */
    key: 'atg', operator: 'Gogo', nextGen: false,
    orbit: 'None. Ground towers, pointed up',
    how: 'An antenna under the fuselage talks to a network of cell towers on the ground. No satellite ' +
      'is involved, which is why it stops at the coastline.',
    speed: '0.1 to 0.8 Mbps per device, an order of magnitude below legacy satellite. Latency is ' +
      '260 to 310 ms against geostationary’s 750, and three quarters of measured tests lose no ' +
      'packets at all.',
    reliability: 'Steady over the continental US and absent everywhere else.',
    price: 'Paid.',
    verdict: 'Messaging and email feel fine. Streaming is not possible. Two systems can both score ' +
      'around 0.2 and be nothing alike, and this is the pair.'
  }
];

/* Which of our scored airlines fly a given system today. Derived, never typed. */
function carriersOf(A, key) {
  return Object.keys(A.WIFI_AIRLINES)
    .filter(function (k) { return A.WIFI_AIRLINES[k].system === key; })
    .map(function (k) { return A.scoreAirline(k); })
    .sort(function (a, b) { return b.nextGenScore - a.nextGenScore || a.name.localeCompare(b.name); });
}

/* Airlines that have SIGNED this system but are not flying it. The distinction is
 * the whole editorial point of the page, so it gets its own function. */
function signedFor(A, key) {
  return Object.keys(A.WIFI_AIRLINES)
    .filter(function (k) {
      var f = A.WIFI_AIRLINES[k].future;
      return f && f.system === key;
    })
    .map(function (k) { return A.scoreAirline(k); })
    .sort(function (a, b) { return String(a.future.from).localeCompare(String(b.future.from)); });
}

/* done | installing | signed | none — derived from the fleet share, so an airline
 * moves phase on the build after the data moves, not when someone remembers. */
function phaseOf(A, a) {
  if (a.nextGenShare >= A.NEXT_GEN_DONE) return 'done';
  if (a.nextGenShare > 0) return 'installing';
  return a.future ? 'signed' : 'none';
}

var PHASE_LABEL = {
  done: 'Finished',
  installing: 'Installing now',
  signed: 'Signed, nothing flying',
  none: 'No next-gen deal'
};

module.exports = {
  AS_OF: AS_OF, VERIFIED: VERIFIED, INDUSTRY: INDUSTRY,
  ROLLOUT: ROLLOUT, SYSTEMS: SYSTEMS,
  carriersOf: carriersOf, signedFor: signedFor,
  phaseOf: phaseOf, PHASE_LABEL: PHASE_LABEL
};
