#!/usr/bin/env node
'use strict';

/* The footer twin of homepage-header-copy.test.js, and the same two-layer
 * shape for the same reason: 322dfc4 / 8f9f2e2 shipped a generator fix the
 * built pages never got, so emitter-only tests are how a repair fails to
 * reach a reader. Layer one checks the include itself; layer two sweeps every
 * built HTML file a reader can be served. */

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var H = require('./lib/html.js');
var R = require('./routes.js');

var v2 = H.footerV2('2026-08-17');
var page = H.page({title:'t',desc:'d',canonical:'/404.html',here:'/',updated:'2026-08-17'});

var LINKS = [
  ['/methodology/', 'Methodology'],
  ['/technology/', 'Technology'],
  ['/airlines/', 'Airlines'],
  ['/feedback/', 'Feedback'],
  ['/privacy', 'Privacy']
];

function footOf(html, label) {
  var m = /<footer class="sitefoot"[\s\S]*?<\/footer>/.exec(html);
  assert.ok(m, label + ' contains the sitefoot footer element');
  return m[0];
}

function checkHtml(html, label) {
  assert.ok(html.indexOf('class="sitefoot" data-footer') !== -1,
    label + ' contains class="sitefoot" data-footer');
  assert.ok(html.indexOf('class="sf-wrap"') !== -1, label + ' inner wrapper is class="sf-wrap"');
  assert.ok(html.indexOf('class="wrap sf"') === -1, label + ' does not contain class="wrap sf"');
  assert.ok(html.indexOf('<footer class="site">') === -1,
    label + ' does not contain classic <footer class="site">');
  assert.ok(html.indexOf('<footer class="footer">') === -1,
    label + ' does not contain a page-local <footer class="footer">');
  var foot = footOf(html, label);
  LINKS.forEach(function (l) {
    assert.ok(foot.indexOf('<a href="' + l[0] + '">' + l[1] + '</a>') !== -1,
      label + ' footer links ' + l[1] + ' to ' + l[0]);
  });
  /* The three disclosure fences ride on every copy. They are fences, not
   * decoration; live Home's shorter fine print was not a licence to cut them. */
  assert.ok(foot.indexOf('unitedstarlinktracker.com') !== -1 &&
    foot.indexOf('alaskastarlinktracker.com') !== -1 && foot.indexOf('@martinamps') !== -1,
    label + ' keeps the tracker-credit fence');
  assert.ok(foot.indexOf('unaffiliated with any airline, SpaceX, Amazon, Viasat, or the trackers') !== -1,
    label + ' keeps the unofficial fence');
  assert.ok(foot.indexOf('No accounts, no analytics') !== -1,
    label + ' keeps the no-accounts / extension-storage fence');
  /* What must NOT ride: owner identity (the repo-source row's hrefs were
   * personal github.com/jeremyinthebay URLs), the theme sentence (no built
   * page ships the switch it describes), and the retired score label. */
  assert.ok(foot.indexOf('jeremyinthebay') === -1, label + ' footer carries no owner URL');
  assert.ok(foot.indexOf('Site source') === -1 && foot.indexOf('Extension source') === -1,
    label + ' footer has no repository-source row');
  assert.ok(foot.indexOf('lasts until you reload') === -1, label + ' footer has no theme sentence');
  assert.ok(foot.indexOf('ConnectScore') === -1, label + ' footer does not print ConnectScore');
}

checkHtml(v2, 'footerV2');
checkHtml(page, 'page');

/* The include's own <style> is the LAST style block footerV2 emits; the
 * emitter output has exactly one. */
var styleStart = v2.indexOf('<style>');
var styleEnd = v2.indexOf('</style>');
assert.ok(styleStart !== -1 && styleEnd > styleStart, 'footerV2 emits its style tag');
var css = v2.slice(styleStart, styleEnd);
/* The PR 19 repair, scoped to this component, byte-literal: site.css says
 * a{color:var(--link);text-decoration:underline} and its a:hover ties a bare
 * component selector at (0,1,1), so source order is not a fence. */
assert.ok(css.indexOf('.sitefoot a{color:inherit;text-decoration:none}') !== -1,
  'FOOTER_CSS carries the scoped Home link reset');
assert.ok(css.indexOf('.sitefoot a:hover{text-decoration:none}') !== -1,
  'FOOTER_CSS carries the scoped hover reset');
/* Self-owned geometry, same defence as .mh-wrap: Home's wrap formula as
 * literals on a class nothing else styles. A var(--max) read here would be a
 * page-settable input into the band's position — the /extension/ leak. */
assert.ok(css.indexOf('.sitefoot .sf-wrap{') !== -1, 'FOOTER_CSS styles the unique wrapper class');
assert.ok(css.indexOf('width:min(1240px,calc(100% - 48px));margin:auto') !== -1,
  'the wrapper carries Home\'s own width/margin formula as literals');
assert.ok(css.indexOf('var(--max') === -1, 'footer geometry reads no page-settable --max token');
assert.ok(css.indexOf('.sitefoot,.sitefoot *{box-sizing:border-box}') !== -1,
  'FOOTER_CSS fences box-sizing');
assert.ok(css.indexOf('outline:3px solid var(--cyan') !== -1,
  'footer links keep the visible focus outline');

/* The retained-day contract, same as classic footer(): a healed pull carries
 * both dates, because "updated" alone would claim a re-measurement that did
 * not happen. */
assert.ok(H.footerV2('2026-08-16', '2026-08-16', false).indexOf('Data updated <b>2026-08-16</b>') !== -1,
  'a clean day prints Data updated');
var retained = H.footerV2('2026-08-15', '2026-08-16', true);
assert.ok(retained.indexOf('Checked <b>2026-08-16</b>') !== -1 &&
  retained.indexOf('data as of <b>2026-08-15</b>') !== -1,
  'a retained day prints both dates');

/* page() places the band OUTSIDE .wrap: Home's footer is full-bleed with its
 * own inner wrapper, and the old H.page() nested footer.site inside the page
 * column — the layout split the include exists to end. */
assert.ok(page.indexOf('</main>\n</div>\n<footer class="sitefoot" data-footer>') !== -1,
  'page() emits the footer after .wrap closes, not inside it');

/* Built pages are tracked files and can drift from the generator when a
 * commit skips the rebuild. Sweep what would actually be served. */
var root = path.join(__dirname, '..');
var swept = 0;
R.ROUTES.concat(R.UNLISTED).forEach(function (r) {
  if (!r.file || r.file.slice(-5) !== '.html') return;
  var body = fs.readFileSync(path.join(root, r.file), 'utf8');
  checkHtml(body, r.file);
  assert.ok(body.indexOf('.sitefoot a{color:inherit;text-decoration:none}') !== -1,
    r.file + ' carries the scoped link reset');
  assert.ok(body.indexOf('.sitefoot a:hover{text-decoration:none}') !== -1,
    r.file + ' carries the scoped hover reset');
  assert.ok(body.indexOf('class="ftop"') === -1 && body.indexOf('class="flinks"') === -1 &&
    body.indexOf('class="frow"') === -1, r.file + ' has no classic footer row markup');
  assert.ok(/Data updated <b>|data as of <b>/.test(footOf(body, r.file)),
    r.file + ' footer carries the data date line');
  swept++;
});
assert.ok(swept >= 26, 'swept ' + swept + ' built pages; expected at least 26');

console.log('homepage-footer-copy: passed (' + swept + ' built pages swept)');
