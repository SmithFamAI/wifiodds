'use strict';
/* build/lib/render.js — one function per prerendered page. Each returns a
 * complete HTML document via H.page(). */

var H = require('./html.js');
var V = require('./viz.js');
var P = require('./pages.js');
var DL = require('./data.js');
var T = require('./tmpl.js');
var esc = H.esc, num = DL.num;
var ORIGIN = H.ORIGIN;

var DATASET_ID = ORIGIN + '/united/fleet/#dataset';

function datasetLd(m) {
  return {
    '@context': 'https://schema.org', '@type': 'Dataset', '@id': DATASET_ID,
    name: 'United Airlines Starlink rollout archive',
    description: 'Every United Airlines aircraft confirmed to carry Starlink, with the date each tail ' +
      'was first seen equipped: ' + m.fleet.equipped + ' of ' + m.fleet.total + ' aircraft across ' +
      m.archiveDays + ' distinct install days.',
    url: ORIGIN + '/united/fleet/',
    temporalCoverage: m.firstDay + '/' + m.updated,
    dateModified: m.updated,
    keywords: ['Starlink', 'United Airlines', 'inflight WiFi', 'fleet rollout', 'aircraft registry'],
    creator: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
    isBasedOn: { '@type': 'WebSite', name: 'unitedstarlinktracker.com', url: 'https://unitedstarlinktracker.com' },
    license: 'Personal and research use; credit unitedstarlinktracker.com (@martinamps) when quoting fleet numbers.',
    distribution: [{
      '@type': 'DataDownload',
      contentUrl: ORIGIN + '/united/data.json',
      encodingFormat: 'application/json'
    }]
  };
}
function crumbLd(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(function (it, i) {
      return { '@type': 'ListItem', position: i + 1, name: it[1], item: ORIGIN + it[0] };
    })
  };
}

/* ═══ / ═════════════════════════════════════════════════════════════════ */
function home(m) {
  var eq = m.fleet.equipped;
  var delta = m.todayDelta !== null && m.todayDelta > 0
    ? '<span class="up">+' + m.todayDelta + ' today</span>' : 'confirmed United tails';
  var body =
    '<header class="hero">\n' +
    '  <span class="kicker"><span class="dot"></span>ConnectScore · updated ' + esc(m.updated) + '</span>\n' +
    '  <h1>Know your WiFi odds<span class="tag">before you book.</span></h1>\n' +
    '  <p class="lede">Inflight WiFi is a lottery: same airline, same route, and one aircraft has ' +
    '<b>Starlink</b> while the next has a satellite dish from 2012. <b>ConnectScore</b> turns each ' +
    'airline’s fleet rollout into one number from 0 to 100 — your odds of getting the good system, and ' +
    'whether it’s free once you’re on it. For <b>United</b> and <b>Alaska</b> we go a level deeper: ' +
    'per-flight odds, right on the booking page.</p>\n' +
    '  <div class="cta-row"><a class="btn" href="/airlines/">Check an airline →</a>' +
    '<a class="btn ghost" href="' + H.EXT + '" target="_blank" rel="noopener">Get the extension ↗</a></div>\n' +
    '  <div class="microlinks">' +
    '<a href="/united/fleet/">The United hangar floor →</a>' +
    '<a href="/roadmap/">Roadmap →</a>' +
    '<a href="' + H.REPO + '" target="_blank" rel="noopener">Open source ↗</a></div>\n' +
    '</header>\n\n' +
    '<div class="chips">' +
    P.kpi(num(eq), 'United aircraft equipped', delta, 'hero-kpi glow') +
    P.kpi(m.sharePct + '%', 'Of the United fleet', 'of ' + num(m.fleet.total) + ' aircraft') +
    P.kpi(String(m.airlineCount), 'Airlines tracked', 'one ConnectScore each') +
    P.kpi(String(m.archiveDays), 'Days of install history', 'since ' + esc(DL.shortMonth(m.firstDay)) + ' 2025') +
    '</div>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>ConnectScore leaderboard</h2>' +
    '<span class="sub">top 8 of ' + m.airlineCount + '</span>' +
    '<a class="more" href="/airlines/">all ' + m.airlineCount + ' airlines →</a></div>\n' +
    '  <p class="sec-lede">Best odds of good WiFi first. The score credits only the modern high-speed ' +
    'system (Starlink, Amazon Leo) at full weight — legacy satellite service counts for less, and ' +
    'signed-but-not-yet-flying deals count zero until the hardware is in the air.</p>\n' +
    P.leaderboard(m, 8) +
    '  <p class="tblcap">' + esc(m.A.SCORE_METHOD_LINE) + '</p>\n' +
    '</section>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>The United rollout, three ways</h2>' +
    '<span class="sub">' + m.archiveDays + ' install days baked at build time</span></div>\n' +
    '  <div class="grid3">\n' +
    '    <a class="card rv" href="/united/fleet/"><h3>Rollout curve</h3>' + V.spark(m) +
    '<p>' + num(eq) + ' aircraft equipped since ' + esc(DL.prettyDate(m.firstDay)) +
    ' — express first, mainline catching up.</p><span class="go">See the timeline →</span></a>\n' +
    '    <a class="card rv" href="/united/fleet/"><h3>Hangar floor</h3>' + V.miniWaffle(m) +
    '<p>One cell per 10 aircraft · <b>' + num(eq) + ' of ' + num(m.fleet.total) + '</b> equipped (' +
    m.sharePct + '%). The full floor is one cell per aircraft.</p>' +
    '<span class="go">Open all ' + num(m.cells) + ' cells →</span></a>\n' +
    '    <div class="card rv"><h3>Busiest Starlink routes</h3>' + P.routePills(m) +
    '<p class="note">' + m.leaderboardCount + '-route leaderboard · ' + m.routeCount +
    ' cached routes in the optimizer.</p>' +
    '<a class="go" href="/united/">Open the route optimizer →</a></div>\n' +
    '  </div>\n</section>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>Get the odds while you book</h2></div>\n' +
    P.extensionCta() + '</section>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>What’s coming</h2>' +
    '<a class="more" href="/roadmap/">full roadmap →</a></div>\n' + P.roadmapSteps(3) + '</section>\n\n';
  body +=
    '<section class="blk">\n  <div class="sec-h"><h2>How ConnectScore works</h2><span class="sub">0–100</span></div>\n' +
    '  <div class="panel"><p style="font-family:var(--mono);font-size:14.5px;color:var(--ink)">' +
    'ConnectScore = P(connectivity) × system quality × free-for-you</p>' +
    '<div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div></div>\n</section>\n\n' +
    H.credit('all');

  return H.page({
    title: 'WiFi Odds — every airline’s inflight WiFi, scored',
    desc: 'ConnectScore for ' + m.airlineCount + ' airlines plus per-flight Starlink odds for United ' +
      'and Alaska. ' + num(eq) + ' of ' + num(m.fleet.total) + ' United aircraft equipped. Free, unofficial, no tracking.',
    canonical: '/', here: '/', updated: m.updated,
    body: body,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'WebSite', '@id': ORIGIN + '/#website',
        name: 'WiFi Odds', url: ORIGIN + '/',
        description: 'ConnectScore: every airline’s chance of good inflight WiFi in one number, plus ' +
          'per-flight Starlink odds for United and Alaska.',
        publisher: { '@id': ORIGIN + '/#org' }
      },
      {
        '@context': 'https://schema.org', '@type': 'Organization', '@id': ORIGIN + '/#org',
        name: 'WiFi Odds', url: ORIGIN + '/', logo: ORIGIN + '/assets/og.png',
        sameAs: [H.EXT, H.REPO]
      },
      /* The extension is the thing a person can actually install, and it was
       * invisible to answer engines: the homepage described it in prose and
       * declared nothing. SoftwareApplication is the type they look for, and
       * price 0 is the fact that gets it quoted. */
      {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication',
        '@id': ORIGIN + '/#extension',
        name: 'WiFi Odds for Flights',
        applicationCategory: 'BrowserApplication',
        applicationSubCategory: 'Browser extension',
        operatingSystem: 'Chrome, Edge, Brave (Chromium)',
        url: H.EXT, installUrl: H.EXT, downloadUrl: H.EXT,
        softwareVersion: '2.0',
        description: 'Shows Starlink WiFi odds on the airline booking page itself: colour-coded badges ' +
          'on every United flight on united.com and Navan, one-click sort by odds, a live route panel, ' +
          'optional Alaska support, and the ConnectScore for all ' + m.airlineCount +
          ' airlines in the popup. No accounts, no analytics, no tracking.',
        featureList: [
          'Per-flight Starlink odds badges on united.com search results',
          'Sort a whole page of flights by WiFi odds',
          'ConnectScore for ' + m.airlineCount + ' airlines in the popup',
          'Alaska Airlines support behind an optional permission',
          'Works with no account and stores nothing but your theme choice'
        ],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isAccessibleForFree: true,
        publisher: { '@id': ORIGIN + '/#org' },
        isBasedOn: {
          '@type': 'WebSite', name: 'unitedstarlinktracker.com',
          url: 'https://unitedstarlinktracker.com'
        },
        privacyPolicy: ORIGIN + '/privacy.html'
      }
    ]
  });
}

/* ═══ /airlines/ ════════════════════════════════════════════════════════
 * The leaderboard is the page an answer engine lands on for "which airline has
 * the best wifi", and it declared only an ItemList — a ranked list of URLs with
 * no answers in it. The FAQ below fixes that, and it follows the same rule as the
 * airline pages: every Q/A is VISIBLE on the page and the JSON-LD is built from
 * the same array. No hidden markup, and nothing typed twice. */
function airlinesIndex(m) {
  var chips = [['all', 'All (' + m.airlineCount + ')'], ['starlink', 'Starlink'],
    ['leo', 'Amazon Leo (future)'], ['legacy', 'Viasat / legacy'], ['freeall', 'Free for everyone']];

  var top3 = m.ranked.slice(0, 3);
  var starlinks = m.ranked.filter(function (a) { return a.system === 'starlink'; });
  var frees = m.ranked.filter(function (a) { return (m.A.WIFI_AIRLINES[a.key].free || '') === 'free'; });
  var ua = m.A.scoreAirline('united');
  var faqs = [
    ['Which airline has the best inflight WiFi right now?',
      top3.map(function (a, i) {
        return (i === 0 ? '' : i === top3.length - 1 ? ' then ' : ', then ') + a.name +
          ' (ConnectScore ' + a.score + '/100, ' + a.label + ')';
      }).join('') + ' — as of ' + m.updated + '. ConnectScore is the chance of getting the good, ' +
      'modern system on a random flight, multiplied by whether it is free once you are onboard, so ' +
      'a small all-Starlink fleet can outrank a giant airline that is only part way through its rollout.'],
    ['Which airlines have Starlink WiFi?',
      starlinks.length + ' of the ' + m.airlineCount + ' airlines here fly Starlink on at least part of ' +
      'the fleet: ' + starlinks.map(function (a) {
        return a.name + ' (' + (a.fleet ? num(a.equipped) + ' of ' + num(a.fleet) : 'fleetwide') + ')';
      }).join(', ') + '. Fleet share is what matters — being on the list is not the same as being ' +
      'likely on your flight.'],
    ['Which airlines give inflight WiFi away free?',
      'Free for everyone onboard, no loyalty program and no purchase: ' +
      frees.map(function (a) { return a.name; }).join(', ') + '. Others are free only for members or ' +
      'only on some cabins, which scores lower — ConnectScore multiplies the fleet share by a ' +
      'free-for-you factor rather than pretending a paywalled system is the same product.'],
    ['How is ConnectScore calculated?',
      m.A.SCORE_METHOD_LINE + ' Worked example — United: ' + num(ua.equipped) + ' of ' + num(ua.fleet) +
      ' aircraft is a ' + ua.parts.pctEquipped.toFixed(4) + ' fleet share, × ' +
      ua.parts.systemQuality.toFixed(1) + ' system quality (' + ua.systemLabel + ') × ' +
      ua.parts.freeFactor.toFixed(2) + ' free-for-you = ' + ua.parts.raw.toFixed(4) +
      ', so ConnectScore ' + ua.score + '. The full method, the three confidence tiers and the ' +
      'things it cannot see are on the methodology page.'],
    ['Can you tell me whether my specific flight will have Starlink?',
      'For United, yes: we hold a per-flight history and can give the odds for that flight number. ' +
      'For Alaska the tails are verified but there is no per-flight feed, so the honest answer is the ' +
      'sub-fleet. For every other airline all we have is the fleet-wide score, and we say so rather ' +
      'than inventing a number for one flight.']
  ];

  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <h1 class="ph">Airline WiFi leaderboard</h1>\n' +
    '  <p class="lede">All ' + m.airlineCount + ' airlines in the ConnectScore map, best odds of good ' +
    'WiFi first. Sort any column; filter by hardware or by who gives it away free.</p>\n' +
    '  <p class="note" style="margin-top:12px">' + esc(m.A.SCORE_METHOD_LINE) + '</p>\n' +
    '</header>\n\n' +
    '<section class="blk">\n' +
    '  <div class="filters needs-js" data-target="#lbTable" data-cur="all" role="group" ' +
    'aria-label="Filter airlines">' +
    chips.map(function (c, i) {
      return '<button type="button" data-f="' + c[0] + '" aria-pressed="' + (i === 0) + '">' +
        esc(c[1]) + '</button>';
    }).join('') + '</div>\n' +
    P.leaderboard(m) +
    '  <p class="tblcap"><span data-count-for="#lbTable">' + m.airlineCount + '</span> airlines shown · ' +
    'scores recomputed at build time · updated ' + esc(m.updated) + '</p>\n' +
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) +
    ' <a href="/methodology/">How much to trust each number — the three confidence tiers →</a></div>\n' +
    '  <p class="note" style="margin-top:12px">' + esc(m.A.SCORE_METHOD_LINE) + '</p>\n' +
    '</section>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>Airline WiFi questions</h2>' +
    '<a class="more" href="/methodology/">methodology →</a></div>\n' +
    '  <div class="faq">' + faqs.map(function (f) {
      return '<div class="q rv"><h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p></div>';
    }).join('') + '</div>\n</section>\n\n' + H.credit('all');

  return H.page({
    title: 'Airline WiFi leaderboard — ' + m.airlineCount + ' ConnectScores',
    desc: 'Which airline has the best WiFi right now — Starlink, Amazon Leo and Viasat fleets compared ' +
      'in one sortable score. Free, unofficial, no tracking.',
    canonical: '/airlines/', here: '/airlines/', updated: m.updated,
    crumb: [['/', 'Home'], ['/airlines/', 'Airlines']],
    body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Airline inflight WiFi ConnectScore leaderboard',
      numberOfItems: m.ranked.length,
      itemListElement: m.ranked.map(function (a, i) {
        return {
          '@type': 'ListItem', position: i + 1, name: a.name + ' — ConnectScore ' + a.score,
          url: ORIGIN + '/airlines/' + a.key + '/'
        };
      })
    }, {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(function (f) {
        return {
          '@type': 'Question', name: f[0],
          acceptedAnswer: { '@type': 'Answer', text: f[1] }
        };
      })
    }, crumbLd([['/', 'Home'], ['/airlines/', 'Airlines']])]
  });
}

/* ═══ /airlines/{key}/ ══════════════════════════════════════════════════ */
function airlinePage(m, key) {
  var e = m.A.WIFI_AIRLINES[key];
  var a = m.A.scoreAirline(key);
  var pct = Math.round(a.parts.pctEquipped * 100);
  var crumbs = [['/', 'Home'], ['/airlines/', 'Airlines'], ['/airlines/' + key + '/', a.name]];
  var fleetLine = a.fleet ? num(a.equipped) + ' of ' + num(a.fleet) + ' aircraft' : 'fleetwide coverage';
  var toolHref = key === 'united' ? '/united/' : key === 'alaska' ? '/alaska/' : null;

  /* FAQ — visible on the page AND in FAQPage JSON-LD. No hidden-markup games. */
  var faqs = [
    ['Does ' + a.name + ' have ' + a.systemLabel + ' WiFi?',
      (a.fleet
        ? a.name + ' has ' + a.systemLabel + ' on ' + num(a.equipped) + ' of its ' + num(a.fleet) +
          ' aircraft (' + pct + '%) as of ' + esc(a.asOf || m.updated) + ', so it is ' +
          (pct >= 85 ? 'close to a sure thing' : pct >= 50 ? 'better than a coin flip'
            : pct >= 20 ? 'a real possibility but not the default' : 'still unlikely on a random flight') + '.'
        : a.name + ' offers ' + a.systemLabel + ' fleetwide as of ' + esc(a.asOf || m.updated) + '.') +
      ' Its ConnectScore is ' + a.score + ' out of 100 — ' + a.label + '.'],
    ['Is ' + a.name + '’s WiFi free?', 'On ' + a.name + ' it is ' + P.freeText(e.free) +
      '. ConnectScore multiplies the fleet share by a free-for-you factor, so a paid or unconfirmed ' +
      'free claim scores lower than the same fleet given away free.'],
    ['How many ' + a.name + ' planes have ' + a.systemLabel + '?',
      (a.fleet ? num(a.equipped) + ' of ' + num(a.fleet) + ' — ' + pct + '% of the fleet.'
        : 'The whole fleet, per the airline.') +
      (a.tracker ? ' Verified tail by tail by ' + esc(a.tracker) + ' (@martinamps).'
        : ' Compiled from public airline announcements, July 2026.')]
  ];

  var body =
    '<header class="hero" style="padding-top:14px">\n' +
    '  <h1 class="ph">' + esc(a.name) + ' inflight WiFi</h1>\n' +
    '  <p class="lede">' + esc(a.note) + '</p>\n' +
    '  <div class="scorebox rv">' + V.scoreRing(a.score) +
    '<div class="sbmid"><div class="t">ConnectScore <span class="band ' + P.band(a.score) + '">' +
    esc(a.label) + '</span></div>' +
    '<div class="m">' + pct + '% of the fleet equipped × ' + a.parts.systemQuality.toFixed(1) +
    ' system quality (' + esc(a.systemLabel) + ') × ' + a.parts.freeFactor.toFixed(2) +
    ' free-for-you = ' + a.score + ' / 100</div></div>' +
    '<div style="flex:none"><a class="btn ghost" href="/airlines/">All ' + m.airlineCount +
    ' airlines →</a></div></div>\n' +
    '</header>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>Where the rollout stands</h2>' +
    '<span class="sub">as of ' + esc(a.asOf || m.updated) + '</span></div>\n' +
    '  <div class="stats">\n' +
    '    <div class="stat rv"><div class="n">' + (a.fleet ? num(a.equipped) + '<small> / ' + num(a.fleet) + '</small>' : 'Fleetwide') +
    '</div><div class="l">Aircraft equipped</div>' +
    '<span class="track"><i class="fill" style="--pct:' + pct + '%"></i></span>' +
    '<div class="d">' + pct + '% of the fleet carries ' + esc(a.systemLabel) + '.</div></div>\n' +
    '    <div class="stat rv"><div class="n" style="font-size:21px"><span class="sysdot ' +
    P.sysClass(a.system) + '"></span>' + esc(a.systemLabel) + '</div><div class="l">System</div>' +
    '<div class="d">' + (a.parts.systemQuality >= 1 ? 'Low-earth-orbit — the good stuff (quality 1.0).'
      : 'Geostationary hardware — slower, scores ' + a.parts.systemQuality.toFixed(1) + '.') + '</div></div>\n' +
    '    <div class="stat rv"><div class="n" style="font-size:21px">' + esc(P.freeText(e.free)) +
    '</div><div class="l">Cost onboard</div><div class="d">Free-for-you factor ' +
    a.parts.freeFactor.toFixed(2) + '.</div></div>\n' +
    '    <div class="stat rv"><div class="n">' + a.score + '</div><div class="l">ConnectScore</div>' +
    '<div class="d">Band: ' + esc(a.label) + ' (' + m.airlineCount + ' airlines ranked).</div></div>\n' +
    '  </div>\n' +
    (a.future ? '  <div class="callout rv" style="margin-top:16px"><h3>Signed for later — and not scored</h3>' +
      '<p>' + esc(a.name) + ' has ' + esc(a.future.system === 'leo' ? 'Amazon Leo' : a.future.system) +
      ' signed from <b>' + esc(a.future.from) + '</b>' +
      (a.future.detail ? ' (' + esc(a.future.detail) + ')' : '') + '. ConnectScore counts zero for ' +
      'hardware that is not flying yet — a deal you cannot connect to is not connectivity.</p></div>\n' : '') +
    '</section>\n\n' +
    (toolHref
      ? '<section class="blk">\n  <div class="callout rv"><h3>Per-flight odds for ' + esc(a.name) + '</h3>' +
        '<p>' + esc(a.name) + ' is instrumented: we can score the actual flight you are about to book, ' +
        'not just the fleet. ' + (key === 'united'
          ? 'The route optimizer ranks every flight on a route by live Starlink odds, and the hangar floor ' +
            'shows all ' + num(m.fleet.equipped) + ' equipped tails with their install dates.'
          : 'Odds badges appear on alaskaair.com search results once you enable the optional permission.') +
        '</p><div class="cta-row"><a class="btn" href="' + toolHref + '">' + (key === 'united'
          ? 'Open the route optimizer →' : 'Open the ' + esc(a.name) + ' rollout →') + '</a>' +
        (key === 'united'
          ? '<a class="btn ghost" href="/united/fleet/">The hangar floor →</a>' +
            '<a class="btn ghost" href="/united/history/">Day-by-day history →</a>' : '') +
        '</div></div>\n</section>\n\n'
      : '<section class="blk">\n  <div class="callout rv"><h3>How to check your ' + esc(a.name) + ' flight</h3>' +
        '<p>We cannot score an individual ' + esc(a.name) + ' flight yet — there is no verified per-tail ' +
        'feed for this fleet. Until there is: check the aircraft type on your itinerary, prefer the ' +
        'sub-fleet the airline says it converted first, and treat any single flight as ' + pct +
        '% likely. The extension shows this ConnectScore in its popup wherever you are booking.</p>' +
        '<div class="cta-row"><a class="btn" href="' + H.EXT + '" target="_blank" rel="noopener">' +
        'Add to Chrome — free ↗</a><a class="btn ghost" href="/airlines/">Compare all ' + m.airlineCount +
        ' →</a></div></div>\n</section>\n\n') +
    '<section class="blk">\n  <div class="sec-h"><h2>' + esc(a.name) + ' WiFi questions</h2></div>\n' +
    '  <div class="faq">' + faqs.map(function (f) {
      return '<div class="q rv"><h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p></div>';
    }).join('') + '</div>\n' +
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div>\n</section>\n\n' +
    H.credit(key === 'alaska' ? 'alaska' : key === 'united' ? 'united' : 'all');

  return H.page({
    title: a.name + ' WiFi — ConnectScore ' + a.score + ': ' + a.label,
    desc: (a.fleet ? num(a.equipped) + ' of ' + num(a.fleet) + ' ' + a.name + ' aircraft carry ' +
      a.systemLabel + ' (' + pct + '%). ' : a.name + ' offers ' + a.systemLabel + ' fleetwide. ') +
      'ConnectScore ' + a.score + '/100 — ' + a.label + '. ' + P.freeText(e.free) + '.',
    canonical: '/airlines/' + key + '/', here: '/airlines/', suffix: a.name,
    /* the two instrumented airlines have a multi-page section and get tabs;
       the other sixteen are a single page and get the way back, nothing more */
    section: key === 'united' ? 'united' : key === 'alaska' ? 'alaska' : 'airline',
    updated: m.updated, crumb: crumbs, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(function (f) {
        return {
          '@type': 'Question', name: f[0],
          acceptedAnswer: { '@type': 'Answer', text: f[1] }
        };
      })
    }, crumbLd(crumbs)]
  });
}

/* ═══ /united/fleet/ ════════════════════════════════════════════════════ */
function fleetPage(m) {
  var crumbs = [['/', 'Home'], ['/united/', 'United'], ['/united/fleet/', 'Fleet']];
  var delta = m.todayDelta !== null && m.todayDelta > 0
    ? '<span class="up">+' + m.todayDelta + ' today</span>' : 'confirmed tails in the roster';

  /* registry rows — 481 of them, newest install first */
  var reg = m.registry.map(function (r) {
    return '      <tr data-f="' + r.fleet + ' ' + esc(r.type) + '" data-q="' + esc(r.tail) + '">' +
      '<td class="mono"><b>' + esc(r.tail) + '</b></td>' +
      '<td data-s="' + esc(r.type) + '">' + esc(r.type) + '</td>' +
      '<td data-s="' + r.fleet + '"><span class="badge ' + r.fleet + '">' + r.fleet + '</span></td>' +
      '<td class="num" data-s="' + r.epoch + '">' + esc(DL.prettyDate(r.seen)) + '</td>' +
      '<td class="num" data-s="' + r.days + '">' + num(r.days) + '</td></tr>';
  }).join('\n');

  var typeChips = Object.keys(m.typeCounts).sort(function (a, b) {
    return m.typeCounts[b] - m.typeCounts[a];
  }).map(function (t) {
    return '<button type="button" data-f="' + esc(t) + '" aria-pressed="false">' + esc(t) +
      ' (' + m.typeCounts[t] + ')</button>';
  }).join('');

  var moversHtml = m.movers.length
    ? '<div class="movers">' + m.movers.map(function (d) {
        return '<div class="mover"><span class="fn">' + esc(DL.prettyDate(d.date)) + '</span>' +
          '<span>' + d.rows.map(esc).join(' · ') + '</span></div>';
      }).join('') + '</div>'
    : '<div class="steady">No odds movement recorded yet — daily tracking started ' +
      esc(DL.prettyDate(m.D.history[0].date)) + ', and the mover log fills in from the first day two ' +
      'consecutive snapshots disagree. The install history below already goes back to ' +
      esc(DL.prettyDate(m.firstDay)) + '.</div>';
  var newTailsHtml = m.newTails.length
    ? '<p style="margin-top:12px">' + m.newTails.map(function (t) {
        return '<span class="pill add">' + esc(t.tail) + '</span>';
      }).join('') + '</p>'
    : '';

  var body =
    '<header class="hero" style="padding-top:14px">\n' +
    '  <h1 class="ph">United’s Starlink rollout, tail by tail</h1>\n' +
    '  <p class="lede">Every United aircraft confirmed to carry Starlink, with the day it was first seen ' +
    'equipped — <b>' + num(m.fleet.equipped) + '</b> tails across <b>' + m.archiveDays + '</b> install ' +
    'days since ' + esc(DL.prettyDate(m.firstDay)) + '. All of it is baked into this page at build time, ' +
    'so it reads the same with JavaScript switched off.</p>\n' +
    '</header>\n\n' + H.credit('united') + '\n' +
    '<div class="chips">' +
    P.kpi(num(m.fleet.equipped), 'Equipped', delta, 'hero-kpi glow') +
    P.kpi(m.sharePct + '%', 'Fleet share', 'of ' + num(m.fleet.total) + ' aircraft') +
    P.kpi(num(m.fleet.last30), 'Last 30 days', 'new installs') +
    P.kpi(String(m.fleet.mainlinePacePerWeek), 'Mainline pace / week', 'straight-line finish for the ' +
      'remaining ' + num(m.fleet.mainline.total - m.fleet.mainline.equipped) + ' mainline jets: ~' +
      esc(m.etaLabel) + ' at this pace') +
    '</div>\n' +
    '<div class="chips" style="margin-top:0">' +
    '<div class="chip rv" style="grid-column:span 2"><div class="n">' + num(m.fleet.mainline.equipped) +
    '<small> / ' + num(m.fleet.mainline.total) + '</small></div><div class="l">Mainline</div>' +
    '<span class="track"><i class="fill ml" style="--pct:' + m.mainlinePct + '%"></i></span>' +
    '<div class="d">' + m.mainlinePct + '% — the long half of the rollout.</div></div>' +
    '<div class="chip rv" style="grid-column:span 2"><div class="n">' + num(m.fleet.express.equipped) +
    '<small> / ' + num(m.fleet.express.total) + '</small></div><div class="l">Express</div>' +
    '<span class="track"><i class="fill ex" style="--pct:' + m.expressPct + '%"></i></span>' +
    '<div class="d">' + m.expressPct + '% — regional jets went first and are nearly done.</div></div>' +
    '</div>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The rollout curve</h2>' +
    '<span class="sub">' + esc(DL.prettyDate(m.firstDay)) + ' → ' + esc(DL.prettyDate(m.updated)) +
    ' · ' + m.spanDays + ' days</span></div>\n' +
    '  <div class="legend"><span><i class="ex"></i>Express</span><span><i class="ml"></i>Mainline</span>' +
    '<span>Stacked — the top line is the fleet total</span></div>\n' +
    '  <div class="panel">' + V.areaTimeline(m) + '</div>\n' +
    '  <p class="tblcap">Derived from ' + num(m.fleet.equipped) + ' roster install dates; today’s point ' +
    'is the audited daily snapshot. <a href="/united/history/">Day-by-day log →</a></p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Install pace</h2>' +
    '<span class="sub">last 10 weeks</span></div>\n' +
    '  <div class="panel">' + V.paceBars(m) + '</div>\n' +
    '  <p class="tblcap">' + m.weeksTotal + ' aircraft added in the last 10 weeks · recent mainline pace ' +
    '~' + m.fleet.mainlinePacePerWeek + '/wk. The current week is partial.</p>\n' +
    '  <div class="panel rv" style="margin-top:14px"><div class="micro">United’s public commitments</div>' +
    '<ul class="tgts">' + (m.fleet.targets || []).map(function (t) {
      return '<li>' + esc(t) + '</li>';
    }).join('') + '</ul></div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Hangar Floor</h2>' +
    '<span class="sub">' + num(m.cells) + ' cells · one per aircraft</span></div>\n' +
    '  <p class="sec-lede">One panel per fleet type, most-complete first: the walls of light are finished, ' +
    'the walls of dark have not started. Within a panel the lit cells are in <b>install order</b>, oldest ' +
    'first — hover one for its tail number and install date. Unequipped aircraft are anonymous because the ' +
    'roster only lists tails that are done, and that is fine: this reads as “installed so far, in order”.</p>\n' +
    '  <div class="legend"><span><i class="eq"></i>Equipped (' + num(m.litCells) + ')</span>' +
    '<span><i class="no"></i>Not yet (' + num(m.cells - m.litCells) + ')</span></div>\n' +
    '  <div class="hangar">\n' + V.waffle(m) + '\n  </div>\n' +
    '  <p class="tblcap">Grid sizes come from fleet.types[].total; lit cells come from the roster. ' +
    'The two “other types” panels carry the ' +
    num(m.panels.reduce(function (a, p) { return a + (p.derived ? p.total : 0); }, 0)) +
    ' aircraft the tracker does not ' +
    'break out by type, so the floor is the whole ' + num(m.fleet.total) + '-aircraft fleet.</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Odds movers</h2>' +
    '<span class="sub">from the daily snapshots</span></div>\n  ' + moversHtml + newTailsHtml + '\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Tail registry</h2>' +
    '<span class="sub">' + num(m.registry.length) + ' equipped tails</span></div>\n' +
    '  <div class="filters needs-js" data-target="#regTable" data-cur="all" role="group" ' +
    'aria-label="Filter tails">' +
    '<button type="button" data-f="all" aria-pressed="true">All (' + num(m.registry.length) + ')</button>' +
    '<button type="button" data-f="mainline" aria-pressed="false">Mainline (' +
    num(m.fleet.mainline.equipped) + ')</button>' +
    '<button type="button" data-f="express" aria-pressed="false">Express (' +
    num(m.fleet.express.equipped) + ')</button>' + typeChips + '</div>\n' +
    '  <div class="srch needs-js"><label class="micro" for="tailq">Find a tail</label>' +
    '<input id="tailq" type="search" data-target="#regTable" placeholder="N68811" ' +
    'autocomplete="off" spellcheck="false"></div>\n' +
    '  <div class="tbl-shell"><table class="tbl" id="regTable">\n' +
    '    <thead><tr><th data-k="tail">Tail</th><th data-k="type">Type</th><th data-k="fleet">Fleet</th>' +
    '<th data-k="seen" data-t="num" aria-sort="descending">Installed</th>' +
    '<th data-k="days" data-t="num">Days live</th></tr></thead>\n    <tbody>\n' + reg +
    '\n    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap"><span data-count-for="#regTable">' + num(m.registry.length) + '</span> equipped ' +
    'tails · updated ' + esc(m.updated) + ' · data: unitedstarlinktracker.com</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Busiest Starlink routes</h2>' +
    '<span class="sub">next 48 hours</span></div>\n  ' + P.routePills(m) +
    '\n  <p class="tblcap">From the ' + m.leaderboardCount + '-route leaderboard in today’s pull. ' +
    '<a href="/united/">Rank every flight on your route →</a></p>\n</section>\n';

  return H.page({
    title: 'United Starlink fleet — every equipped tail, live',
    desc: num(m.fleet.equipped) + ' of ' + num(m.fleet.total) + ' United aircraft equipped: the hangar ' +
      'floor, the install pace, and the full tail registry with install dates. Data by unitedstarlinktracker.com.',
    canonical: '/united/fleet/', here: '/united/fleet/', suffix: 'United',
    section: 'united',
    updated: m.updated, crumb: crumbs, body: body,
    jsonld: [datasetLd(m), crumbLd(crumbs)]
  });
}

/* ═══ /roadmap/ ═════════════════════════════════════════════════════════ */
function roadmapPage(m) {
  var crumbs = [['/', 'Home'], ['/roadmap/', 'Roadmap']];
  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <h1 class="ph">What’s next for WiFi Odds</h1>\n' +
    '  <p class="lede">Everything below is either built, being built, or honestly labelled as neither. ' +
    'The ordering is by usefulness, not by how impressive it sounds in a changelog.</p>\n' +
    '</header>\n\n' +
    '<section class="blk">\n' + P.roadmapSteps() + '\n' +
    '  <p class="note" style="margin-top:20px">No dates promised. Built by one person and a very ' +
    'patient AI.</p>\n</section>\n\n' +
    '<section class="blk">\n  <div class="sec-h"><h2>Already shipped</h2></div>\n' +
    '  <div class="grid3">' +
    '<div class="card rv"><h3>The route optimizer</h3><p>' + m.routeCount + ' cached United routes, ' +
    'every flight ranked by live Starlink odds, connection-aware.</p>' +
    '<a class="go" href="/united/">Open it →</a></div>' +
    '<div class="card rv"><h3>The hangar floor</h3><p>All ' + num(m.fleet.equipped) + ' equipped tails, ' +
    'the ' + m.archiveDays + '-day install archive, and the full registry.</p>' +
    '<a class="go" href="/united/fleet/">Open it →</a></div>' +
    '<div class="card rv"><h3>' + m.airlineCount + ' ConnectScores</h3><p>One number per airline, ' +
    'recomputed on every build, quotable with credit.</p>' +
    '<a class="go" href="/airlines/">Open it →</a></div></div>\n</section>\n\n' +
    H.credit('all');
  return H.page({
    title: 'What’s next for WiFi Odds',
    desc: 'Tail-swap Guardian, more airlines in rollout order, a PWA — and the free public ConnectScore ' +
      'API, which is live now. No dates promised.',
    canonical: '/roadmap/', here: '/roadmap/', updated: m.updated, crumb: crumbs, body: body,
    jsonld: [crumbLd(crumbs)]
  });
}

/* ═══ /methodology/ ══════════════════════════════════════════════════════
 * The provenance page. It exists because "ConnectScore 27" is a number with no
 * error bars attached, and every serious reader — a redditor, a journalist, an
 * answer engine deciding whether to quote us — asks the same three questions:
 * where did this come from, how sure are you, and what can't you see. Answering
 * them in public is cheaper than being asked, and it is the page that gets
 * linked to.
 *
 * THE TIER SPLIT IS DERIVED, NOT TYPED. `instrumented` in assets/airlines.js is
 * the flag, and United is the only fleet with a per-flight route history in
 * data.json — so Verified/Type-derived/Coarse fall out of the data rather than
 * out of a hand-maintained list that would rot the day Hawaiian lands.
 *
 * Every number below comes from m. If you find yourself typing a figure into
 * this page, that is the bug. */
function methodologyPage(m) {
  var crumbs = [['/', 'Home'], ['/methodology/', 'Methodology']];
  var ua = m.A.scoreAirline('united');
  var al = m.A.scoreAirline('alaska');

  /* per-flight history exists only where we cache routes, i.e. United today */
  var verified = m.ranked.filter(function (a) { return a.key === 'united'; });
  var derived = m.ranked.filter(function (a) { return a.instrumented && a.key !== 'united'; });
  var coarse = m.ranked.filter(function (a) { return !a.instrumented; });
  function names(list) { return list.map(function (a) { return a.name; }).join(', '); }

  /* a REAL worked per-flight example, pulled out of today's route cache */
  var ex = (function () {
    var rk = Object.keys(m.D.routes || {});
    for (var i = 0; i < rk.length; i++) {
      var r = m.D.routes[rk[i]];
      var f = (r.flights || []).filter(function (x) {
        return typeof x.prob === 'number' && typeof x.obs === 'number';
      }).sort(function (a, b) { return b.obs - a.obs; })[0];
      if (f) return { route: rk[i], label: r.label || rk[i], f: f };
    }
    var ck = Object.keys(m.D.routeCache || {});
    for (var j = 0; j < ck.length; j++) {
      var g = (m.D.routeCache[ck[j]].flights || [])[0];
      if (g) return { route: ck[j], label: ck[j], f: g };
    }
    return null;
  })();

  var tiers = [
    ['tier-v', 'Verified', 'Tracker-verified, tail by tail, with a per-flight history',
      names(verified) || '—',
      'Every equipped aircraft is confirmed against united.com by <a href="https://unitedstarlinktracker.com" ' +
      'target="_blank" rel="noopener">unitedstarlinktracker.com</a>, and we additionally cache how often ' +
      'each tracked flight number has actually been flown by an equipped aircraft. That is the only tier ' +
      'where we will quote odds for <b>your specific flight</b>, and the API labels it ' +
      '<span class="mono">method: "route-history"</span> with the observation count attached.',
      'A number for one flight, with a sample size.'],
    ['tier-d', 'Type-derived', 'Tails verified, but no per-flight feed exists',
      names(derived) || '—',
      'The roster is verified the same way, by <a href="https://alaskastarlinktracker.com" target="_blank" ' +
      'rel="noopener">alaskastarlinktracker.com</a> — but nobody publishes which aircraft is scheduled ' +
      'onto which Alaska flight, so there is no history to count. The honest answer is the sub-fleet: the ' +
      'E175 regional fleet is finished and a mainline 737 mostly is not, so the aircraft type on your ' +
      'itinerary tells you far more than the fleet average does.',
      'A number for an aircraft type, not a flight.'],
    ['tier-c', 'Coarse', 'A fleet-share model built from public announcements',
      coarse.length + ' airlines — ' + names(coarse),
      'No per-tail verification exists for these fleets, so the input is what the airline itself has ' +
      'said publicly about how many aircraft are equipped, as of July 2026. Good enough to choose an ' +
      'airline; not good enough to say anything about one departure. The API labels every one of these ' +
      '<span class="mono">method: "airline-coarse"</span> and returns <span class="mono">prob: null</span> ' +
      'rather than a number we would have had to invent.',
      'A number for an airline. Nothing narrower.']
  ];

  var css = '<style>\n' +
    '.tiers{display:grid;gap:14px;margin-top:14px}\n' +
    '@media(min-width:900px){.tiers{grid-template-columns:repeat(3,1fr)}}\n' +
    '.tier{border:1px solid var(--edge);border-radius:var(--r-md);padding:16px;background:var(--field-bg)}\n' +
    '.tier .tn{display:flex;align-items:center;gap:8px;font-weight:800;font-size:17px;color:var(--ink)}\n' +
    '.tier .td{font-size:13px;color:var(--faint);margin-top:2px}\n' +
    '.tier .tw{font-family:var(--mono);font-size:12.5px;color:var(--accent);margin:10px 0 8px}\n' +
    '.tier p{font-size:14px;line-height:1.6;margin:8px 0 0}\n' +
    '.tier .tg{margin-top:12px;padding-top:10px;border-top:1px solid var(--edge);font-size:13px;' +
    'color:var(--body)}\n' +
    '.tier .tg b{color:var(--ink)}\n' +
    '.tdot{width:10px;height:10px;border-radius:50%;flex:none}\n' +
    '.tier-v .tdot{background:#3ddc84}.tier-d .tdot{background:#f5c451}.tier-c .tdot{background:#8a93a6}\n' +
    '.wex{background:var(--field-bg);border:1px solid var(--edge);border-radius:var(--r-md);' +
    'padding:14px 16px;font-family:var(--mono);font-size:13.5px;line-height:1.7;color:var(--body);' +
    'overflow-x:auto;margin-top:12px}\n' +
    '.wex b{color:var(--accent)}\n' +
    '.wex .r{color:var(--ink);font-weight:700}\n' +
    '.blk h3.apih{font-size:17px;font-weight:800;margin-top:26px}\n' +
    '</style>\n';

  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker"><span class="dot"></span>Methodology · data as of ' + esc(m.updated) + '</span>\n' +
    '  <h1 class="ph">How WiFi Odds knows what it knows</h1>\n' +
    '  <p class="lede">Every number on this site is either verified tail by tail by an independent ' +
    'community tracker, derived from an aircraft type, or modelled from what an airline said publicly — ' +
    'and we label which. This page is the whole method: the three confidence tiers, the formula with a ' +
    'worked example, what the score <b>cannot</b> see, and how fresh the data is.</p>\n' +
    '  <div class="microlinks"><a href="/airlines/">The leaderboard →</a>' +
    '<a href="/api/docs/">The API →</a><a href="/llms.txt">llms.txt →</a></div>\n' +
    '</header>\n\n' + H.credit('all') + '\n' +

    '<div class="chips">' +
    P.kpi(esc(m.updated), 'Data as of', 'refreshed daily, re-baked on every build') +
    P.kpi(num(m.registry.length), 'Verified United tails', 'each with its install date') +
    P.kpi(String(m.archiveDays), 'Install days on record', 'since ' + esc(DL.prettyDate(m.firstDay))) +
    P.kpi(String(m.airlineCount), 'Airlines scored', verified.length + ' verified · ' +
      derived.length + ' type-derived · ' + coarse.length + ' coarse') +
    '</div>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The three confidence tiers</h2>' +
    '<span class="sub">say which one you are quoting</span></div>\n' +
    '  <p class="sec-lede">The tiers are not a disclaimer, they are part of the answer. A ConnectScore ' +
    'from the Coarse tier and a per-flight probability from the Verified tier are different kinds of ' +
    'claim, and blurring them is the single most misleading thing this site could do. The API says which ' +
    'tier every response came from; so does the extension.</p>\n' +
    '  <div class="tiers">' + tiers.map(function (t) {
      return '<div class="tier ' + t[0] + ' rv"><div class="tn"><span class="tdot"></span>' + t[1] +
        '</div><div class="td">' + t[2] + '</div><div class="tw">' + esc(t[3]) + '</div><p>' + t[4] +
        '</p><div class="tg">What you can conclude: <b>' + t[5] + '</b></div></div>';
    }).join('') + '</div>\n' +
    '  <p class="tblcap">The split is derived from the data, not maintained by hand: an airline moves up ' +
    'a tier the moment a verified per-tail feed exists for it, and the build re-sorts these lists ' +
    'automatically. That is the plan for Hawaiian next.</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The formula, worked through</h2>' +
    '<span class="sub">nothing here is typed by hand</span></div>\n' +
    '  <p class="sec-lede">ConnectScore answers one question — <b>what are the odds I get the good ' +
    'system, and is it free once I am on it?</b> Three factors, multiplied, rounded to an integer ' +
    'from 0 to 100:</p>\n' +
    '  <div class="wex">ConnectScore = <b>fleet share</b> × <b>system quality</b> × ' +
    '<b>free-for-you</b> × 100</div>\n' +
    '  <div class="grid3" style="margin-top:16px">\n' +
    '    <div class="card"><h3>Fleet share</h3><p>Equipped aircraft ÷ total aircraft, from the verified ' +
    'roster where one exists and from the airline’s own published counts otherwise. Where an airline ' +
    'publishes no tail counts at all (only “fleetwide”), a stated coverage fraction is used and the ' +
    'basis is reported as <span class="mono">fleetwide-coverage</span>.</p></div>\n' +
    '    <div class="card"><h3>System quality</h3><p>Starlink and Amazon Leo score ' +
    m.A.SYSTEM_QUALITY.starlink.toFixed(1) + '. Viasat and 2Ku score ' +
    m.A.SYSTEM_QUALITY.viasat.toFixed(1) + '. Older geostationary hardware scores ' +
    m.A.SYSTEM_QUALITY.geo.toFixed(1) + '. Low-earth-orbit is a different product from a satellite ' +
    'dish pointed at the equator, and pretending otherwise would flatten the only distinction that ' +
    'matters onboard.</p></div>\n' +
    '    <div class="card"><h3>Free-for-you</h3><p>Free for everyone, or free with a free loyalty ' +
    'signup, scores ' + m.A.FREE_FACTOR.free.toFixed(2) + '. A paid status tier, a partial rollout or ' +
    'an unconfirmed claim scores ' + m.A.FREE_FACTOR['loyalty-tier'].toFixed(2) + '. Paid scores ' +
    m.A.FREE_FACTOR.paid.toFixed(2) + '. Working WiFi you have to buy at 35,000 feet is not the same ' +
    'product as working WiFi you just connect to.</p></div>\n' +
    '  </div>\n' +
    '  <h3 class="apih" style="margin-top:26px">Worked example — ' + esc(ua.name) +
    ', the whole airline</h3>\n' +
    '  <div class="wex">' +
    'fleet share  = ' + num(ua.equipped) + ' equipped ÷ ' + num(ua.fleet) + ' aircraft = <b>' +
    ua.parts.pctEquipped.toFixed(4) + '</b>\n' +
    'system       = ' + esc(ua.systemLabel) + ' → quality <b>' + ua.parts.systemQuality.toFixed(1) +
    '</b>\n' +
    'cost onboard = ' + esc(P.freeText(m.A.WIFI_AIRLINES.united.free)) + ' → free-for-you <b>' +
    ua.parts.freeFactor.toFixed(2) + '</b>\n\n' +
    ua.parts.pctEquipped.toFixed(4) + ' × ' + ua.parts.systemQuality.toFixed(1) + ' × ' +
    ua.parts.freeFactor.toFixed(2) + ' = ' + ua.parts.raw.toFixed(4) +
    ' → <span class="r">ConnectScore ' + ua.score + ' (' + esc(ua.label) + ')</span></div>\n' +
    '  <p class="tblcap">Those are the live numbers, generated at build time by the same function the ' +
    'API and the extension call. <a href="/airlines/united/">Same figure on United’s page →</a></p>\n' +
    (ex ? '  <h3 class="apih" style="margin-top:26px">Worked example — one flight, from the Verified ' +
      'tier</h3>\n' +
      '  <div class="wex">flight   = <b>' + esc(ex.f.fn) + '</b>' +
      (ex.f.dep ? '  (' + esc(ex.f.dep) + ' departure)' : '') + '\n' +
      'route    = ' + esc(ex.label) + '\n' +
      'observed = ' + ex.f.obs + ' recent departures of that flight number' +
      (ex.f.aircraft ? '\naircraft = ' + esc(ex.f.aircraft) : '') + '\n\n' +
      'equipped on <b>' + ex.f.prob + '%</b> of those ' + ex.f.obs + ' departures → ' +
      '<span class="r">per-flight odds ' + ex.f.prob + '%</span>, confidence ' +
      esc(ex.f.conf || 'n/a') + '</div>\n' +
      '  <p class="tblcap">This is what the Verified tier buys you, and why the fleet-wide ' + ua.score +
      ' is the wrong number to quote for a specific flight in either direction. Confidence is the sample ' +
      'size: low under 10 observations, medium 10–15, high 16 or more. ' +
      '<a href="/united/">Rank a whole route →</a></p>\n' : '') +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>What we can’t know</h2>' +
    '<span class="sub">the honest list</span></div>\n' +
    '  <p class="sec-lede">These are real limits, not hedges. If one of them applies to your flight, no ' +
    'number on this site can fix it — so here they are in plain language, with what to do instead.</p>\n' +
    '  <div class="faq">\n' +
    '    <div class="q rv"><h3>Tail swaps inside the last 48 hours</h3><p>Airlines reassign aircraft ' +
    'until departure — for maintenance, weather, crew, a broken jet somewhere else. Our per-flight odds ' +
    'are a <b>history</b> of what has flown that flight number, not a booking of what will. A flight with ' +
    '80% odds can still board the one unequipped aircraft in the sub-fleet. Re-check the day before, ' +
    'which is exactly what the extension’s Tail-swap Guardian is for.</p></div>\n' +
    '    <div class="q rv"><h3>Airlines with no per-tail feed</h3><p>' + coarse.length + ' of the ' +
    m.airlineCount + ' airlines here have no public, verifiable list of which aircraft are equipped. ' +
    'For those we can only model the fleet share, and we will not pretend to more. If you need certainty ' +
    'on one of those carriers, the aircraft type on your itinerary plus whatever the airline said about ' +
    'which sub-fleet it converted first is genuinely better information than our score.</p></div>\n' +
    '    <div class="q rv"><h3>Paid tiers and free-WiFi policy changes</h3><p>The free-for-you factor is ' +
    'a snapshot of a commercial decision, and those change with a press release and no notice — a free ' +
    'system can acquire a paywall, or a loyalty requirement can be dropped, weeks before we notice. ' +
    'Cabin-level throttling and “free messaging only” tiers are not modelled at all. Treat the free ' +
    'column as “what was true in July 2026”, and the airline’s own page as authoritative on price.</p></div>\n' +
    '    <div class="q rv"><h3>Actual speed on the day</h3><p>We score the <b>hardware and the ' +
    'policy</b>, never the throughput. A full Starlink cabin over the Atlantic is a different experience ' +
    'from an empty one over Kansas, and nothing here measures that. ConnectScore is the chance of ' +
    'getting the good system — not a bandwidth guarantee, and not a promise that any WiFi at all will ' +
    'be working.</p></div>\n' +
    '    <div class="q rv"><h3>The gap our own caveat names</h3><p>' + esc(m.A.SCORE_CAVEAT) +
    ' That is deliberate: the question being answered is “what are my odds of the good WiFi”, not “is ' +
    'there any WiFi at all”. It is why an airline with fleetwide legacy service can score near zero.</p></div>\n' +
    '  </div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Data freshness</h2>' +
    '<span class="sub">every figure on this page is from ' + esc(m.updated) + '</span></div>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th>Input</th><th>Source</th><th>Cadence</th><th>Last refresh</th></tr></thead>\n' +
    '    <tbody>\n' +
    '      <tr><td>United fleet + per-tail roster</td><td>unitedstarlinktracker.com</td>' +
    '<td>pulled daily</td><td class="mono">' + esc(m.updated) + '</td></tr>\n' +
    '      <tr><td>United per-flight route history</td><td>unitedstarlinktracker.com check-flight pages</td>' +
    '<td>daily, ' + m.routeCount + ' cached routes</td><td class="mono">' + esc(m.updated) + '</td></tr>\n' +
    '      <tr><td>Alaska fleet</td><td>alaskastarlinktracker.com</td><td>pulled daily</td>' +
    '<td class="mono">' + esc(al.asOf || m.updated) + '</td></tr>\n' +
    '      <tr><td>The other ' + coarse.length + ' airlines</td><td>public airline announcements</td>' +
    '<td>reviewed by hand</td><td class="mono">July 2026</td></tr>\n' +
    '      <tr><td>Every page, score and chart on this site</td><td>this build</td>' +
    '<td>re-baked on every data commit</td><td class="mono">' + esc(m.updated) + '</td></tr>\n' +
    '    </tbody>\n  </table></div>\n' +
    '  <p class="tblcap">Nothing on wifiodds.com is fetched live. The daily pull commits ' +
    '<a href="/united/data.json">united/data.json</a>, that commit rebuilds every page, and the ' +
    'ConnectScore API reads the same file out of the same deploy — so the page, the API and the ' +
    'extension cannot disagree with each other. If the date above is stale, the data is stale ' +
    'everywhere at once, visibly, rather than in one surface quietly.</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Citing this</h2>' +
    '<span class="sub">please do</span></div>\n' +
    '  <p class="sec-lede">Quote the numbers freely, including in an article or an AI answer. The one ' +
    'condition is that the credit travels with them, because the fleet verification is not ours.</p>\n' +
    '  <div class="wex">ConnectScore and per-flight odds: WiFi Odds (wifiodds.com), data as of ' +
    esc(m.updated) + '.\n' +
    'United tail verification: unitedstarlinktracker.com (@martinamps).\n' +
    'Alaska tail verification: alaskastarlinktracker.com (@martinamps).\n' +
    'All other airlines: public airline announcements, July 2026.</div>\n' +
    '  <p class="tblcap">Every API response carries the same credits in a ' +
    '<span class="mono">sources</span> array so they cannot get separated from the data. ' +
    '<a href="/api/docs/">API docs →</a> · <a href="/llms.txt">llms.txt →</a></p>\n' +
    '</section>\n\n' + H.credit('all');

  return H.page({
    title: 'Methodology — how ConnectScore is calculated, and what it can’t see',
    desc: 'The full WiFi Odds method: three confidence tiers (verified per-tail, type-derived, coarse ' +
      'fleet-share), the ConnectScore formula worked through with live numbers, what the score cannot ' +
      'know, data freshness and how to cite it.',
    canonical: '/methodology/', here: '/', updated: m.updated, crumb: crumbs,
    extraHead: css, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'TechArticle',
      headline: 'How ConnectScore is calculated, and what it cannot see',
      url: ORIGIN + '/methodology/',
      dateModified: m.updated,
      description: 'The confidence tiers, the ConnectScore formula with a worked example, the known ' +
        'limits, the refresh cadence and the citation block for WiFi Odds.',
      author: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      publisher: { '@id': ORIGIN + '/#org' },
      isPartOf: { '@type': 'WebSite', name: 'WiFi Odds', url: ORIGIN + '/' },
      about: 'Inflight WiFi ConnectScore methodology and data provenance',
      citation: ['https://unitedstarlinktracker.com', 'https://alaskastarlinktracker.com']
    }, crumbLd(crumbs)]
  });
}

/* ═══ /api/docs/ ════════════════════════════════════════════════════════
 * The ONE human page in the /api namespace. Everything else under /api is a
 * Cloudflare Pages Function in functions/api/** and has no file on disk, which
 * is why this is the only /api entry in build/routes.js.
 *
 * The numbers in the worked examples are BAKED from the same scoreAirline() the
 * API calls, so a docs page that shows 58 for Qatar is showing it for the same
 * reason the API and /airlines/qatar/ do. Never type a score in here by hand. */
function apiDocs(m) {
  var crumbs = [['/', 'Home'], ['/api/docs/', 'API']];
  var qr = m.A.scoreAirline('qatar');
  var ua = m.A.scoreAirline('united');
  var keys = m.ranked.map(function (a) { return a.key; }).sort();
  var codes = m.ranked.map(function (a) { return a.code; }).filter(Boolean).sort();

  /* scoped styles: two elements the design system has no rule for yet, and a docs
     page is not a good reason to add global CSS */
  var css = '<style>\n' +
    '.apic{background:var(--field-bg);border:1px solid var(--edge);border-radius:var(--r-md);' +
    'padding:14px 16px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.55;' +
    'color:var(--body);margin-top:12px;white-space:pre}\n' +
    '.apic b{color:var(--accent);font-weight:700}\n' +
    '.apip{font-family:var(--mono);font-size:13px;color:var(--ink);font-weight:700}\n' +
    '.apiv{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:800;' +
    'letter-spacing:.6px;padding:2px 7px;border-radius:999px;border:1px solid var(--edge-strong);' +
    'color:var(--accent)}\n' +
    '.blk h3.apih{font-size:17px;font-weight:800;margin-top:26px}\n' +
    '</style>\n';

  function code(s) { return '<div class="apic">' + esc(s) + '</div>\n'; }

  var endpointRows = [
    ['GET', '/api', 'This index: every endpoint, the airline keys, the flight-number prefixes.'],
    ['GET', '/api/airlines', 'All ' + m.airlineCount + ' airlines, best ConnectScore first.'],
    ['GET', '/api/airlines/{key}', 'One airline. Unknown key → 404 JSON with the list of valid keys.'],
    ['GET', '/api/score/{flightNumber}', 'Per-flight odds where we have route history, otherwise the ' +
      'coarse airline score. Untracked prefix → 404 JSON.']
  ].map(function (r) {
    return '      <tr><td class="mono"><b>' + r[0] + '</b></td>' +
      '<td class="mono">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>';
  }).join('\n');

  var freeRows = Object.keys(P.FREE).map(function (k) {
    return '      <tr><td class="mono"><b>' + esc(k) + '</b></td>' +
      '<td class="num">' + m.A.freeFactor(k).toFixed(2) + '</td>' +
      '<td>' + esc(P.FREE[k]) + '</td></tr>';
  }).join('\n');

  var sysRows = Object.keys(m.A.SYSTEM_QUALITY).map(function (k) {
    return '      <tr><td class="mono"><b>' + esc(k) + '</b></td>' +
      '<td class="num">' + m.A.SYSTEM_QUALITY[k].toFixed(1) + '</td>' +
      '<td>' + esc(m.A.SYSTEM_LABEL[k] || '—') + '</td></tr>';
  }).join('\n');

  var errRows = [
    ['400', 'unparseable_flight', 'The path segment is not shaped like a flight number.'],
    ['404', 'unknown_airline', 'No airline with that key.'],
    ['404', 'unknown_airline_prefix', 'The flight number parses, but we do not track that carrier.'],
    ['405', 'method_not_allowed', 'Read-only API — GET or HEAD.'],
    ['503', 'dataset_unavailable', 'The cached United dataset could not be read from this deploy. ' +
      'This should never happen; it means the deploy is broken, and we would rather say so than ' +
      'quietly hand back the coarse score as if nothing were wrong.']
  ].map(function (r) {
    return '      <tr><td class="mono"><b>' + r[0] + '</b></td><td class="mono">' + esc(r[1]) +
      '</td><td>' + esc(r[2]) + '</td></tr>';
  }).join('\n');

  var body =
    '<header class="hero" style="padding-top:18px">\n' +
    '  <span class="kicker"><span class="dot"></span>ConnectScore API <span class="apiv">v0</span></span>\n' +
    '  <h1 class="ph">The ConnectScore API</h1>\n' +
    '  <p class="lede">Every ConnectScore on this site, as JSON. Free, no key, no accounts, no ' +
    'rate limit, CORS open to every origin. Read-only. Each response carries a <b>sources</b> array ' +
    'with the data credits — please keep it attached when you re-publish.</p>\n' +
    '  <div class="microlinks"><a href="/airlines/">The same data as a table →</a>' +
    '<a href="/united/data.json">The full United dataset (JSON) →</a>' +
    '<a href="/llms.txt">llms.txt →</a></div>\n' +
    '</header>\n\n' + H.credit('all') + '\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Try it</h2></div>\n' +
    code('curl -s ' + ORIGIN + '/api/airlines | head -40\n' +
      'curl -s ' + ORIGIN + '/api/airlines/qatar\n' +
      'curl -s ' + ORIGIN + '/api/score/UA212\n' +
      'curl -s ' + ORIGIN + '/api/score/AS15') +
    '  <p class="tblcap">Responses are pretty-printed and gzipped. ' +
    'Cache-Control: public, max-age=3600 on success (the data is refreshed once a day), 300 on errors.</p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Endpoints</h2>' +
    '<span class="sub">four, all GET</span></div>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th>Method</th><th>Path</th><th>Returns</th></tr></thead>\n' +
    '    <tbody>\n' + endpointRows + '\n    </tbody>\n  </table></div>\n' +

    '  <h3 class="apih">GET /api/airlines</h3>\n' +
    '  <p class="sec-lede">All ' + m.airlineCount + ' airlines, ordered by ConnectScore descending, ' +
    'ties broken by name — the same order as the leaderboard, from the same function.</p>\n' +
    code('{\n' +
      '  "count": ' + m.airlineCount + ',\n' +
      '  "asOf": "' + (m.ranked[0].asOf || m.updated) + '",\n' +
      '  "order": "connectScore desc, then name",\n' +
      '  "airlines": [ … ' + m.airlineCount + ' objects … ],\n' +
      '  "sources": [ … ]\n' +
      '}') +

    '  <h3 class="apih">GET /api/airlines/{key}</h3>\n' +
    '  <p class="sec-lede">Keys are the slugs used in the site URLs: <span class="apip">' +
    esc(keys.join(' · ')) + '</span></p>\n' +
    code('{\n' +
      '  "airline": {\n' +
      '    "key": "qatar",\n' +
      '    "name": ' + JSON.stringify(qr.name) + ',\n' +
      '    "code": "' + qr.code + '",\n' +
      '    "connectScore": ' + qr.score + ',\n' +
      '    "band": "' + qr.label + '",\n' +
      '    "system":  { "key": "' + qr.system + '", "label": "' + qr.systemLabel + '", "quality": ' +
      qr.parts.systemQuality.toFixed(1) + ' },\n' +
      '    "free":    { "status": "free", "factor": ' + qr.parts.freeFactor.toFixed(2) + ' },\n' +
      '    "fleet":   { "equipped": ' + qr.equipped + ', "total": ' + qr.fleet + ', "equippedShare": ' +
      (Math.round(qr.parts.pctEquipped * 10000) / 10000) + ', "equippedPct": ' +
      Math.round(qr.parts.pctEquipped * 100) + ', "basis": "tail-counts" },\n' +
      '    "perFlightOdds": false,\n' +
      '    "tracker": null,\n' +
      '    "future": null,\n' +
      '    "note": "…",\n' +
      '    "asOf": "' + (qr.asOf || m.updated) + '",\n' +
      '    "url": "' + ORIGIN + '/airlines/qatar/"\n' +
      '  },\n' +
      '  "sources": [ … ]\n' +
      '}') +
    '  <p class="tblcap">Abridged. ' + esc(qr.name) + ' really is ' + qr.score + ' — ' +
    Math.round(qr.parts.pctEquipped * 100) + '% of the fleet × ' +
    qr.parts.systemQuality.toFixed(1) + ' system quality × ' + qr.parts.freeFactor.toFixed(2) +
    ' free-for-you. <a href="/airlines/qatar/">Same number on the page →</a></p>\n' +

    '  <h3 class="apih">GET /api/score/{flightNumber}</h3>\n' +
    '  <p class="sec-lede">Accepts <span class="apip">UA212</span>, <span class="apip">ua 212</span>, ' +
    '<span class="apip">UA0212</span> — case, spaces, hyphens and leading zeros are all normalised ' +
    'away. Prefixes we know: <span class="apip">' + esc(codes.join(' ')) + '</span></p>\n' +
    '  <p class="sec-lede">The <b>method</b> field is the whole point of this endpoint. It tells you ' +
    'how much to trust the number, and it is never blurred:</p>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th>method</th><th>prob</th><th>What it means</th></tr></thead>\n' +
    '    <tbody>\n' +
    '      <tr><td class="mono"><b>route-history</b></td><td class="mono">0–100</td>' +
    '<td>We found this exact flight number in our cached United route history. <b>prob</b> is the ' +
    'share of recent observations of that flight that were flown by a Starlink aircraft, with the ' +
    'observation count and confidence in <b>evidence</b>.</td></tr>\n' +
    '      <tr><td class="mono"><b>airline-coarse</b></td><td class="mono">null</td>' +
    '<td>We have no per-flight history for it, so all we can honestly offer is the airline’s ' +
    'fleet-wide ConnectScore. <b>prob</b> is <b>null</b> rather than a guess — inventing precision ' +
    'here would be the worst thing this API could do.</td></tr>\n' +
    '    </tbody>\n  </table></div>\n' +
    code('{\n' +
      '  "flight": "UA212",\n' +
      '  "airline": { "key": "united", "connectScore": ' + ua.score + ', … },\n' +
      '  "prob": 47,\n' +
      '  "connectScore": ' + ua.score + ',\n' +
      '  "method": "route-history",\n' +
      '  "evidence": { "route": "LAX-ORD", "observations": 20, "confidence": "high",\n' +
      '                "dataset": "routeCache", "cachedAt": "…" },\n' +
      '  "asOf": "' + m.updated + '",\n' +
      '  "sources": [ … ]\n' +
      '}') +
    '  <p class="tblcap">United is the only fleet with per-flight history today; ' +
    'every other prefix returns <span class="mono">airline-coarse</span>. ' +
    '<a href="/united/">Rank a whole route →</a></p>\n' +
    '</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>The score, field by field</h2>' +
    '<span class="sub">nothing here is transcribed</span></div>\n' +
    '  <div class="panel"><p style="font-family:var(--mono);font-size:14.5px;color:var(--ink)">' +
    'connectScore = fleet.equippedShare × system.quality × free.factor, rounded</p>\n' +
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div></div>\n' +
    '  <div class="grid3" style="margin-top:16px">\n' +
    '    <div class="card"><h3>system.quality</h3><div class="tbl-shell" style="margin-top:10px">' +
    '<table class="tbl" style="min-width:0">\n' +
    '    <thead><tr><th>key</th><th>q</th><th>Label</th></tr></thead>\n    <tbody>\n' + sysRows +
    '\n    </tbody>\n  </table></div></div>\n' +
    '    <div class="card"><h3>free.status</h3><div class="tbl-shell" style="margin-top:10px">' +
    '<table class="tbl" style="min-width:0">\n' +
    '    <thead><tr><th>status</th><th>factor</th><th>Means</th></tr></thead>\n    <tbody>\n' + freeRows +
    '\n    </tbody>\n  </table></div></div>\n' +
    '    <div class="card"><h3>fleet.basis</h3><p><b>tail-counts</b> — the airline publishes equipped ' +
    'and total aircraft, so <span class="mono">equippedShare = equipped / total</span>.</p>' +
    '<p><b>fleetwide-coverage</b> — no tail counts exist (Delta, jetBlue publish only ' +
    '&ldquo;fleetwide&rdquo;), so <span class="mono">equipped</span> and <span class="mono">total</span> ' +
    'are <b>null</b> and the share comes from a stated coverage fraction.</p>' +
    '<p class="note">A future deal is never scored. <span class="mono">future</span> is reported and ' +
    'contributes zero until the hardware flies.</p></div>\n' +
    '  </div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Errors</h2>' +
    '<span class="sub">always JSON, always with sources</span></div>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th>Status</th><th>code</th><th>When</th></tr></thead>\n' +
    '    <tbody>\n' + errRows + '\n    </tbody>\n  </table></div>\n' +
    code('$ curl -s ' + ORIGIN + '/api/score/XX999\n' +
      '{\n' +
      '  "error": { "status": 404, "code": "unknown_airline_prefix",\n' +
      '             "message": "We do not track airline \\"XX\\" …" },\n' +
      '  "docs": "' + ORIGIN + '/api/docs/",\n' +
      '  "flight": "XX999",\n  "prefix": "XX",\n  "prefixes": [ … ],\n' +
      '  "sources": [ … ]\n}') +
    '</section>\n\n' +

    /* ── MCP ─────────────────────────────────────────────────────────────
     * Documented on the API page rather than on a page of its own: it is the same
     * data through a different door, and a reader who is already looking at the
     * JSON is exactly the reader who wants the connector. */
    '<section class="blk">\n  <div class="sec-h"><h2>MCP server</h2>' +
    '<span class="sub">for AI assistants</span></div>\n' +
    '  <p class="sec-lede">There is also an <b>MCP</b> endpoint, so an AI assistant can look these ' +
    'numbers up itself instead of guessing from whatever it remembers about airline WiFi. It speaks ' +
    'streamable HTTP — JSON-RPC 2.0 over <span class="apip">POST /mcp</span>, no key, no account, ' +
    'CORS open, and no session required for a single call.</p>\n' +
    '  <div class="tbl-shell"><table class="tbl">\n' +
    '    <thead><tr><th>Tool</th><th>Arguments</th><th>Returns</th></tr></thead>\n' +
    '    <tbody>\n' +
    '      <tr><td class="mono"><b>get_airline_score</b></td><td class="mono">key</td>' +
    '<td>One airline: ConnectScore, system, fleet share, cost onboard, and the confidence tier the ' +
    'number comes from.</td></tr>\n' +
    '      <tr><td class="mono"><b>list_airline_scores</b></td><td class="mono">—</td>' +
    '<td>All ' + m.airlineCount + ' airlines, best odds first. One call instead of eighteen.</td></tr>\n' +
    '      <tr><td class="mono"><b>score_flight</b></td><td class="mono">flight_number</td>' +
    '<td>One flight. United returns a per-flight probability with its sample size; every other ' +
    'carrier returns the coarse airline score with <span class="mono">prob: null</span>.</td></tr>\n' +
    '    </tbody>\n  </table></div>\n' +
    code('curl -sS -X POST ' + ORIGIN + '/mcp -H \'content-type: application/json\' \\\n' +
      '  -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'\n\n' +
      'curl -sS -X POST ' + ORIGIN + '/mcp -H \'content-type: application/json\' \\\n' +
      '  -d \'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":\n' +
      '       {"name":"score_flight","arguments":{"flight_number":"UA212"}}}\'') +
    '  <p class="tblcap">Every tool result comes back twice: a text block for the model to relay and ' +
    'a <span class="mono">structuredContent</span> object for the client to parse. The data credits are ' +
    'in both, because the text is what usually reaches the user.</p>\n' +
    '  <div class="faq" style="margin-top:16px">\n' +
    '    <div class="q"><h3>The <span class="mono">instructions</span> field is the point</h3>' +
    '<p>What <span class="mono">initialize</span> returns is not a description of the endpoints — it is ' +
    'the decision layer: someone asking about flight WiFi is trying to maximise <b>hours of working ' +
    'WiFi</b>, so prefer the higher ConnectScore, use United\'s route history when there is a flight ' +
    'number, name which confidence tier you are quoting, never invent a per-flight number for a fleet ' +
    'we have no history for, and always pass the credits through. A data endpoint with no opinion gets ' +
    'averaged into mush by whichever model is holding it.</p></div>\n' +
    '    <div class="q"><h3>It is the same code as the REST API</h3><p>Each tool is a thin wrapper ' +
    'around the very handler that serves <span class="mono">/api/**</span> — it builds a synthetic GET ' +
    'request and re-shapes the answer. So <span class="mono">score_flight("UA212")</span> and ' +
    '<span class="mono">GET /api/score/UA212</span> cannot disagree: they are the same call. The ' +
    'acceptance suite asserts exactly that.</p></div>\n' +
    '    <div class="q"><h3>GET returns 405, on purpose</h3><p>This server opens no server-initiated ' +
    'SSE stream, so there is nothing for a GET to subscribe to. It answers with a 405 whose <i>body</i> ' +
    'tells you the POST to make instead — a bare 405 with no bytes is the kind of unhelpful signal this ' +
    'project has been bitten by before.</p></div>\n' +
    '  </div>\n</section>\n\n' +

    '<section class="blk">\n  <div class="sec-h"><h2>Using it</h2></div>\n' +
    '  <div class="faq">\n' +
    '    <div class="q"><h3>Credit is the only condition</h3><p>The fleet numbers for United and ' +
    'Alaska are not ours — they come from unitedstarlinktracker.com and alaskastarlinktracker.com, ' +
    'the independent community trackers built by @martinamps. The <span class="mono">sources</span> ' +
    'array is in every response so that the credit travels with the data. Keep it, or reproduce it ' +
    'wherever you show the numbers.</p></div>\n' +
    '    <div class="q"><h3>This API never calls anyone else</h3><p>It reads only our own cached ' +
    'dataset, from the same deploy that served this page. It does not proxy a tracker, an airline, ' +
    'or a flight-status provider — your traffic can never become their bill. That is also why ' +
    'per-flight odds exist for United only: it is the fleet we have history for.</p></div>\n' +
    '    <div class="q"><h3>No rate limit, so please cache</h3><p>There is no key and no quota. ' +
    'Responses are cacheable for an hour and the underlying data changes once a day, so honour the ' +
    'Cache-Control header rather than polling. If it ever gets abused, a limit is the thing that ' +
    'appears first.</p></div>\n' +
    '    <div class="q"><h3>v0 means v0</h3><p>Fields may be added at any time. Anything already ' +
    'here — <span class="mono">connectScore</span>, <span class="mono">method</span>, ' +
    '<span class="mono">prob</span>, <span class="mono">sources</span> — will not change meaning ' +
    'without the path changing to <span class="mono">/api/v1/</span>. Every response carries an ' +
    '<span class="mono">x-connectscore-api</span> header with the version.</p></div>\n' +
    '    <div class="q"><h3>Not a guarantee</h3><p>ConnectScores and per-flight odds are historical ' +
    'estimates. Aircraft assignments change until departure, and a score is the chance of getting the ' +
    'good system, not of getting any WiFi at all.</p></div>\n' +
    '  </div>\n</section>\n';

  return H.page({
    title: 'ConnectScore API — free airline WiFi scores as JSON',
    desc: 'The free public ConnectScore API: every airline’s inflight WiFi score as JSON, plus ' +
      'per-flight Starlink odds for United. No key, no accounts, CORS open, credits in every response.',
    canonical: '/api/docs/', here: '/', updated: m.updated, crumb: crumbs,
    extraHead: css, body: body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebAPI',
      name: 'WiFi Odds ConnectScore API', url: ORIGIN + '/api/docs/',
      documentation: ORIGIN + '/api/docs/',
      description: 'Free, key-less JSON API for airline inflight WiFi ConnectScores and per-flight ' +
        'United Starlink odds.',
      provider: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      termsOfService: ORIGIN + '/privacy.html'
    }, crumbLd(crumbs)]
  });
}

/* ═══ /404.html ═════════════════════════════════════════════════════════ */
function notFound(m) {
  var body =
    '<header class="hero">\n  <span class="kicker"><span class="dot"></span>404</span>\n' +
    '  <h1 class="ph" style="margin-top:14px">No aircraft at this gate.</h1>\n' +
    '  <p class="lede">That page does not exist. Everything on this site lives at a real path — there are ' +
    'no hash routes to mistype.</p>\n' +
    '  <div class="cta-row"><a class="btn" href="/airlines/">All ' + m.airlineCount + ' ConnectScores →</a>' +
    '<a class="btn ghost" href="/united/fleet/">The United hangar floor →</a></div>\n</header>\n\n';
  return H.page({
    title: 'Page not found — WiFi Odds', desc: 'That page does not exist on wifiodds.com.',
    canonical: '/404.html', here: '/', updated: m.updated, body: body, jsonld: []
  });
}

/* ═══ THE FOUR TEMPLATE-BACKED PAGES ═══════════════════════════════════════
 * These were hand-authored whole documents until the chrome drifted (see
 * build/lib/tmpl.js for the why). Their unique content now lives verbatim in
 * build/templates/, and they come through H.page() like everything else.
 *
 * The rule for editing them: page CONTENT goes in the template file, page
 * CHROME goes in html.js. Nothing about the shared shell is expressed here.  */

/* ═══ /united/ — the route optimizer app ════════════════════════════════ */
function unitedOptimizer(m) {
  var crumbs = [['/', 'Home'], ['/airlines/united/', 'United'], ['/united/', 'Route optimizer']];
  /* The template is injected, never parsed: the ~1,400 lines of live-tested app
     JS and CSS in it are byte-identical in the output. Only the three data-bake
     markers in the no-JS stat line are touched. */
  var t = T.bake(T.load('united-optimizer'), {
    'united.equipped': num(m.fleet.equipped),
    'united.total': num(m.fleet.total),
    'site.updated': m.updated
  }, 'united-optimizer');

  return H.page({
    title: 'WiFi Odds · United — Starlink Route Optimizer',
    desc: 'Pick any United route and get the best plan to land a Starlink-equipped plane — every flight ' +
      'ranked by live odds, the smartest routings, confirmed tails, and a booking playbook. Updated daily ' +
      'and on demand.',
    canonical: '/united/', here: '/', suffix: 'United', section: 'united',
    updated: m.updated, crumb: crumbs,
    extraHead: t.head, preWrap: t.prewrap, body: t.body, afterWrap: t.foot,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebApplication',
      name: 'United Starlink Route Optimizer', url: ORIGIN + '/united/',
      applicationCategory: 'TravelApplication', operatingSystem: 'Any (web)',
      browserRequirements: 'Requires JavaScript for the live route search',
      description: 'Pick any United route and see every flight ranked by its live Starlink WiFi odds, ' +
        'with the best routings, confirmed equipped tails and a booking playbook.',
      isPartOf: { '@type': 'WebSite', name: 'WiFi Odds', url: ORIGIN + '/' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      creator: { '@type': 'Organization', name: 'WiFi Odds', url: ORIGIN + '/' },
      isBasedOn: { '@type': 'WebSite', name: 'unitedstarlinktracker.com', url: 'https://unitedstarlinktracker.com' }
    }, crumbLd([['/', 'Home'], ['/united/', 'United']])]
  });
}

/* ═══ /united/history/ ══════════════════════════════════════════════════ */
function unitedHistory(m) {
  var crumbs = [['/', 'Home'], ['/airlines/united/', 'United'], ['/united/history/', 'History']];
  var t = T.bake(T.load('united-history'), {
    'united.tails': num(m.registry.length),
    'united.days': String(m.archiveDays),
    'united.first': DL.prettyDate(m.firstDay),
    'united.equipped': num(m.fleet.equipped),
    'united.total': num(m.fleet.total),
    'site.updated': m.updated
  }, 'united-history');

  return H.page({
    title: 'United Starlink install history — day by day',
    /* the day count was hard-coded at 176 while it was hand-authored; it is
       generated now, so it can never fall behind the archive again */
    desc: m.archiveDays + ' days of United Starlink install history: every tail, every aircraft type, ' +
      'and every route and odds movement since ' + DL.shortMonth(m.firstDay) + ' 2025. ' +
      'Data by unitedstarlinktracker.com.',
    canonical: '/united/history/', here: '/', suffix: 'United', section: 'united',
    updated: m.updated, crumb: crumbs,
    extraHead: t.head, body: t.body, afterWrap: t.foot,
    jsonld: [datasetLd(m), crumbLd([['/', 'Home'], ['/united/', 'United'],
      ['/united/history/', 'History']])]
  });
}

/* ═══ /alaska/ ══════════════════════════════════════════════════════════ */
function alaskaRollout(m) {
  var al = m.A.scoreAirline('alaska');
  var pct = Math.round(al.parts.pctEquipped * 100);
  var crumbs = [['/', 'Home'], ['/airlines/', 'Airlines'], ['/airlines/alaska/', 'Alaska'],
    ['/alaska/', 'Rollout']];
  var t = T.bake(T.load('alaska-rollout'), {
    'alaska.score': String(al.score),
    'alaska.band': al.label,
    /* the band CLASS is baked too, or a score that crosses a threshold would keep
       the old colour while showing the new word */
    'alaska.bandpill': '<span class="band ' + P.band(al.score) + '">' + al.label + '</span>',
    'alaska.equipped': num(al.equipped),
    'alaska.fleet': num(al.fleet),
    'alaska.pct': pct + '%',
    'alaska.free': 'free for everyone onboard',
    'alaska.math': pct + '% of the fleet equipped × ' + al.parts.systemQuality.toFixed(1) +
      ' system quality (' + al.systemLabel + ') × ' + al.parts.freeFactor.toFixed(2) +
      ' free-for-you = ' + al.score + ' / 100',
    'site.updated': m.updated,
    'site.airlines': String(m.airlineCount)
  }, 'alaska-rollout');

  return H.page({
    /* the fleet counts used to be hard-coded in this page's meta description */
    title: 'WiFi Odds · Alaska — Starlink rollout & ConnectScore',
    desc: 'Alaska Airlines’ Starlink rollout: ' + num(al.equipped) + ' of ' + num(al.fleet) +
      ' aircraft equipped (' + pct + '%), the E175 regional fleet complete, mainline just starting. ' +
      'ConnectScore ' + al.score + '/100, free for everyone onboard, and per-flight odds on alaskaair.com. ' +
      'Fleet data from alaskastarlinktracker.com.',
    canonical: '/alaska/', here: '/', suffix: 'Alaska', section: 'alaska',
    updated: m.updated, crumb: crumbs,
    extraHead: t.head, body: t.body,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        ['Does Alaska have Starlink WiFi?',
          'Yes — the whole E175 regional fleet plus the ex-Hawaiian widebodies carry Starlink, with the ' +
          'mainline 737 fleet only just starting. Alaska’s ConnectScore reflects the share of the ' +
          'combined fleet that is equipped.'],
        ['Is Alaska’s WiFi free?',
          'Yes — where Starlink is installed it is free for everyone onboard, with no loyalty program, ' +
          'tier or purchase required.'],
        ['How many Alaska planes have Starlink?',
          num(al.equipped) + ' of ' + num(al.fleet) + ' (' + pct + '%), verified tail by tail by ' +
          'alaskastarlinktracker.com (@martinamps), an independent community tracker.']
      ].map(function (f) {
        return { '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } };
      })
    }, crumbLd([['/', 'Home'], ['/airlines/', 'Airlines'], ['/alaska/', 'Alaska']])]
  });
}

/* ═══ /privacy.html ═════════════════════════════════════════════════════ */
function privacyPage(m) {
  var t = T.bake(T.load('privacy'), {}, 'privacy');
  return H.page({
    title: 'Privacy Policy — WiFi Odds for Flights',
    desc: 'Privacy policy for WiFi Odds (wifiodds.com) and the WiFi Odds for Flights browser extension. ' +
      'No accounts, no analytics, no tracking, and no personal data collected.',
    canonical: '/privacy.html', here: '/', updated: m.updated,
    extraHead: t.head, body: t.body,
    jsonld: [crumbLd([['/', 'Home'], ['/privacy.html', 'Privacy']])]
  });
}

module.exports = {
  home: home, airlinesIndex: airlinesIndex, airlinePage: airlinePage,
  fleetPage: fleetPage, roadmapPage: roadmapPage, methodologyPage: methodologyPage,
  apiDocs: apiDocs, notFound: notFound,
  unitedOptimizer: unitedOptimizer, unitedHistory: unitedHistory,
  alaskaRollout: alaskaRollout, privacyPage: privacyPage,
  datasetLd: datasetLd, crumbLd: crumbLd, DATASET_ID: DATASET_ID
};
