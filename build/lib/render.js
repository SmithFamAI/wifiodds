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
      }
    ]
  });
}

/* ═══ /airlines/ ════════════════════════════════════════════════════════ */
function airlinesIndex(m) {
  var chips = [['all', 'All (' + m.airlineCount + ')'], ['starlink', 'Starlink'],
    ['leo', 'Amazon Leo (future)'], ['legacy', 'Viasat / legacy'], ['freeall', 'Free for everyone']];
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
    '  <div class="caveat">' + esc(m.A.SCORE_CAVEAT) + '</div>\n' +
    '  <p class="note" style="margin-top:12px">' + esc(m.A.SCORE_METHOD_LINE) + '</p>\n' +
    '</section>\n\n' + H.credit('all');

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
    desc: 'Tail-swap Guardian, more airlines in rollout order, a PWA, and a free public ConnectScore API. ' +
      'No dates promised.',
    canonical: '/roadmap/', here: '/roadmap/', updated: m.updated, crumb: crumbs, body: body,
    jsonld: [crumbLd(crumbs)]
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
  fleetPage: fleetPage, roadmapPage: roadmapPage, notFound: notFound,
  unitedOptimizer: unitedOptimizer, unitedHistory: unitedHistory,
  alaskaRollout: alaskaRollout, privacyPage: privacyPage,
  datasetLd: datasetLd, crumbLd: crumbLd, DATASET_ID: DATASET_ID
};
