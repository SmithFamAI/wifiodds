'use strict';
/* build/lib/reel.js — the extension demo on the homepage. ONE sequence, FOUR
 * captions, TWO real screenshots.
 *
 * ═══ WHY THIS REPLACED THE OLD REEL — READ BEFORE "IMPROVING" IT ═══════════
 * What was here until now: `united/assets/plugin-carousel.html`, 883 lines of
 * hand-built CSS that DREW a fake united.com and a fake Navan out of divs, in
 * four scenes, two of which showed the same trick twice (scene 2 sorted a fake
 * United list; scene 3 sorted a fake Navan list). It was beautiful and it was a
 * drawing. Two problems, and the second one is the real one:
 *
 *   1. It promised a UI that does not exist byte-for-byte, on pages we do not
 *      control. united.com redesigns; the drawing does not, so the drawing
 *      silently becomes a claim about a page that no longer looks like that.
 *   2. We already had the truth on disk. `store-assets/screenshot-united-…png`
 *      and `…-navan-…png` are REAL captures of the extension running on the real
 *      sites — the same images the Chrome Web Store listing ships. Drawing a
 *      replica of a photograph you already own is the same class of mistake as
 *      verifying a deploy with a status code: it looks like evidence and it is
 *      not.
 *
 * So: the two real PNGs, one stage, and four captions that pan/zoom across them
 * — search → odds → sort → guard. Nothing is illustrated; every pixel of the
 * product in this section was photographed.
 *
 * ═══ THE THREE CONTRACTS THIS FILE KEEPS ══════════════════════════════════
 * 1. NO-JS STATIC FIRST FRAME. Step 1 ships `is-active` in the MARKUP and step 1
 *    is deliberately the un-zoomed full frame, so with JS off you get a real
 *    screenshot at 1:1 and all four captions as readable text. Nothing is
 *    hidden behind a script, and there are no dead controls: the prev/next
 *    buttons are `.needs-js`, and the caption strip only becomes clickable when
 *    the script arms it (it adds role/tabindex itself).
 * 2. REDUCED MOTION. `prefers-reduced-motion: reduce` kills the transitions in
 *    CSS, and the script refuses to auto-advance. Manual stepping still works —
 *    "reduce" means do not move on your own, not "break the control".
 * 3. NO THIRD-PARTY BYTES. Two <img> tags at root-absolute /assets/ paths. The
 *    acceptance suite fails on any external subresource; keep it that way.
 *
 * The zoom targets below are COORDINATES IN A 1280×800 IMAGE expressed as a
 * transform-origin percentage plus a scale. If either screenshot is ever
 * recaptured at a different layout, these four numbers are what needs revisiting
 * — and assertShots() will not catch that, because a wrong crop is still a valid
 * file. Look at the four frames after replacing a shot. */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');

/* The real captures. Both are 1280×800 PNGs of the extension running live. */
var SHOTS = {
  united: {
    src: '/assets/shot-united-1280x800.png',
    file: 'assets/shot-united-1280x800.png',
    alt: 'A real united.com search for DEN to SFO. The extension has added a green “49%” Starlink ' +
      'odds badge to the 11:17 AM flight and a blue “44%” badge to the 7:25 PM flight, and its ' +
      'route panel is open at the lower right listing every flight on the route by odds.'
  },
  navan: {
    src: '/assets/shot-navan-1280x800.png',
    file: 'assets/shot-navan-1280x800.png',
    alt: 'The same route inside Navan Business Travel, with odds badges on four United flights and ' +
      'the extension’s panel open showing a “Sort page by Starlink odds” button.'
  }
};

/* search → odds → sort → guard. Four steps, one sequence.
 *   z  scale applied to the shot
 *   ox/oy  transform-origin, in % of the 1280×800 frame — the point the zoom
 *          keeps still. Step 1 is z:1, which is why it is the safe no-JS frame. */
var STEPS = [
  {
    key: 'search', shot: 'united', z: 1, ox: 50, oy: 50,
    label: 'Search',
    text: 'You search united.com the way you always do. The extension adds nothing to the page ' +
      'until there are results on it, and it never touches the booking or the payment steps.'
  },
  {
    key: 'odds', shot: 'united', z: 2.1, ox: 24, oy: 88,
    label: 'Odds',
    text: 'Every result picks up its own badge: how often that flight number has actually drawn a ' +
      'Starlink aircraft. 49% here, 44% on the next one. Once the assigned tail is confirmed ' +
      'equipped the badge shows a ✓ instead of a percentage.'
  },
  {
    key: 'sort', shot: 'navan', z: 1.7, ox: 100, oy: 75,
    label: 'Sort',
    text: 'One click reorders the whole page best-odds-first, prices and times untouched, so you ' +
      'can see what the good connection actually costs you. Same panel on Navan as on united.com.'
  },
  {
    key: 'guard', shot: 'united', z: 1.8, ox: 100, oy: 100,
    label: 'Guard',
    text: 'The panel names what it cannot know yet: tails firm up around 48 hours out. Watching ' +
      'that window after you book is the Tail-swap Guardian, which is built, in test, and ships in 2.1.'
  }
];

function fail(why) {
  console.error('Build FAILED — build/lib/reel.js: ' + why);
  console.error('  The homepage extension demo is built from the two REAL screenshots in assets/.');
  console.error('  Do not substitute a drawing: see the header of build/lib/reel.js for why the');
  console.error('  hand-drawn carousel was deleted.');
  process.exit(1);
}

/* A missing screenshot would render as two broken images inside a section whose
 * entire argument is "these are real captures". Fail the build instead. */
function assertShots() {
  Object.keys(SHOTS).forEach(function (k) {
    var p = path.join(ROOT, SHOTS[k].file);
    var st;
    try { st = fs.statSync(p); } catch (e) { st = null; }
    if (!st || !st.isFile()) fail(SHOTS[k].file + ' is missing from the deploy');
    if (st.size < 20 * 1024) fail(SHOTS[k].file + ' is only ' + st.size + ' bytes — not a screenshot');
  });
}

/* ── the scoped stylesheet ────────────────────────────────────────────────
 * Everything is under `.rlc`. The palette is light-on-dark constants, not site
 * tokens, because `.extdemo` is a dark stage in BOTH themes (see site.css) —
 * inheriting --ink here would give white text on white in light mode. */
function css() {
  return '<style>\n' +
    /* THE PALETTE, AND THE ONE COLOUR THAT LEFT IT. This block is light-on-dark
       constants because .extdemo is a dark stage in BOTH themes; inheriting --ink
       would give white on white in light mode. --rlc-hi is the stage's sky and it
       paints chrome only: the active caption's rule and the nav buttons' hover.
       There was a --rlc-go:#35d07f as well, on the "Real screenshots" badge and
       nowhere else. A badge saying which build was captured is a category, not a
       count, and green on this site means a score of 60 or better. It is the
       stage's own dim ink now. */
    '.rlc{--rlc-ink:#f2e9db;--rlc-dim:#a4988a;--rlc-edge:rgba(242,233,219,.16);' +
    '--rlc-hi:#9dc2dc;color:var(--rlc-ink);font-size:14px}\n' +
    '.rlc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}\n' +
    /* 12px label floor and sentence-adjacent tracking (Phase 1c): the badge
       sat at 10.5px letterspaced caps, the where-line at 11.5px */
    '.rlc-badge{font-family:var(--mono);font-size:12px;font-weight:800;letter-spacing:.4px;' +
    'text-transform:uppercase;color:var(--rlc-dim);border:1px solid var(--rlc-edge);' +
    'border-radius:999px;padding:3px 9px}\n' +
    '.rlc-where{font-family:var(--mono);font-size:12px;color:var(--rlc-dim);margin-right:auto}\n' +
    '.rlc-nav{display:flex;gap:6px}\n' +
    /* 24px minimum target; 44px preferred on touch widths (Phase 1c) */
    '.rlc-nav button{background:rgba(242,233,219,.06);color:var(--rlc-ink);border:1px solid var(--rlc-edge);' +
    'border-radius:8px;width:32px;height:28px;min-height:24px;font-size:15px;line-height:1;cursor:pointer}\n' +
    '@media(max-width:700px){.rlc-nav button{width:44px;height:44px}}\n' +
    '.rlc-nav button:hover{border-color:var(--rlc-hi);color:var(--rlc-hi)}\n' +
    /* the stage: fixed 1280×800 aspect, the shot scaled inside it */
    '.rlc-stage{position:relative;aspect-ratio:1280/800;overflow:hidden;border-radius:12px;' +
    'border:1px solid var(--rlc-edge);background:#241f19;' +
    'box-shadow:0 14px 40px rgba(10,7,4,.45)}\n' +
    '.rlc-shot{position:absolute;inset:0;opacity:0;visibility:hidden}\n' +
    '.rlc-shot.is-active{opacity:1;visibility:visible}\n' +
    '.rlc-shot img{display:block;width:100%;height:100%;object-fit:cover;' +
    'transform:scale(var(--z,1));transform-origin:var(--ox,50%) var(--oy,50%)}\n' +
    /* the caption strip: four items, always readable, the live one lit */
    '.rlc-cl{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;' +
    'margin:12px 0 0;padding:0}\n' +
    '@media(max-width:760px){.rlc-cl{grid-template-columns:repeat(2,1fr)}}\n' +
    '@media(max-width:430px){.rlc-cl{grid-template-columns:1fr}}\n' +
    '.rlc-c{border:1px solid var(--rlc-edge);border-top:2px solid var(--rlc-edge);' +
    'border-radius:10px;padding:10px 12px;background:rgba(242,233,219,.03)}\n' +
    'html.js .rlc-c{cursor:pointer}\n' +
    '.rlc-c.is-active{border-top-color:var(--rlc-hi);background:rgba(157,194,220,.09)}\n' +
    '.rlc-ch{display:flex;align-items:center;gap:7px;font-weight:800;font-size:13.5px;' +
    'color:var(--rlc-dim)}\n' +
    '.rlc-c.is-active .rlc-ch{color:var(--rlc-ink)}\n' +
    '.rlc-n{font-family:var(--mono);font-size:12px;font-weight:800;color:#1b1713;' +
    'background:var(--rlc-dim);border-radius:5px;padding:1px 5px}\n' +
    '.rlc-c.is-active .rlc-n{background:var(--rlc-hi)}\n' +
    /* explanatory copy floor is 14px (Phase 1c): the captions and the credit
       line under the stage are sentences, not labels */
    '.rlc-c p{margin:6px 0 0;font-size:14px;line-height:1.5;color:var(--rlc-dim)}\n' +
    '.rlc-c.is-active p{color:var(--rlc-ink)}\n' +
    '.rlc-foot{margin:12px 0 0;font-size:14px;color:var(--rlc-dim)}\n' +
    /* motion, and only here. Everything above is the finished state. */
    '@media(prefers-reduced-motion:no-preference){\n' +
    '  .rlc-shot{transition:opacity .45s ease}\n' +
    '  .rlc-shot img{transition:transform 1.1s cubic-bezier(.3,.8,.3,1)}\n' +
    '  .rlc-c,.rlc-c .rlc-ch,.rlc-c p{transition:border-color .3s,background .3s,color .3s}\n' +
    '}\n' +
    '@media(prefers-reduced-motion:reduce){\n' +
    '  .rlc-shot,.rlc-shot img{transition:none}\n' +
    '}\n' +
    '</style>\n';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* ── the driver ───────────────────────────────────────────────────────────
 * Finds its own root through document.currentScript so the section can be
 * dropped into any document, refuses to double-init, and reads the zoom for each
 * step off the markup rather than carrying a second copy of the numbers. */
function script() {
  return '<script>\n' +
    '(function(){\n' +
    '  var root=document.currentScript&&document.currentScript.closest("section.rlc");\n' +
    '  if(!root||root.dataset.rlcInit)return; root.dataset.rlcInit="1";\n' +
    '  var caps=[].slice.call(root.querySelectorAll(".rlc-c"));\n' +
    '  var shots=[].slice.call(root.querySelectorAll(".rlc-shot"));\n' +
    '  if(caps.length<2)return;\n' +
    '  var idx=0,timer=null;\n' +
    '  var still=!window.matchMedia||!matchMedia("(prefers-reduced-motion: no-preference)").matches;\n' +
    '  function show(k){\n' +
    '    idx=(k+caps.length)%caps.length;\n' +
    '    var c=caps[idx],want=c.getAttribute("data-shot");\n' +
    '    caps.forEach(function(x,j){x.classList.toggle("is-active",j===idx);\n' +
    '      x.setAttribute("aria-selected",j===idx?"true":"false");});\n' +
    '    shots.forEach(function(s){\n' +
    '      var on=s.getAttribute("data-shot")===want;\n' +
    '      s.classList.toggle("is-active",on);\n' +
    '      s.setAttribute("aria-hidden",on?"false":"true");\n' +
    '      if(on){var i=s.querySelector("img");\n' +
    '        i.style.setProperty("--z",c.getAttribute("data-z"));\n' +
    '        i.style.setProperty("--ox",c.getAttribute("data-ox"));\n' +
    '        i.style.setProperty("--oy",c.getAttribute("data-oy"));}\n' +
    '    });\n' +
    '  }\n' +
    /* arm the caption strip only now — a click target that does nothing without
       JS is exactly the dead control this project keeps banning */
    '  caps.forEach(function(c,j){\n' +
    '    c.setAttribute("role","tab"); c.setAttribute("tabindex","0");\n' +
    '    c.setAttribute("aria-selected",j===0?"true":"false");\n' +
    '    c.addEventListener("click",function(){stop();show(j);});\n' +
    '    c.addEventListener("keydown",function(e){\n' +
    '      if(e.key==="Enter"||e.key===" "){e.preventDefault();stop();show(j);}});\n' +
    '  });\n' +
    '  var cl=root.querySelector(".rlc-cl"); if(cl)cl.setAttribute("role","tablist");\n' +
    '  function stop(){if(timer){clearInterval(timer);timer=null;}}\n' +
    '  function go(d){stop();show(idx+d);}\n' +
    '  var p=root.querySelector(".rlc-prev"),n=root.querySelector(".rlc-next");\n' +
    '  if(p)p.addEventListener("click",function(){go(-1);});\n' +
    '  if(n)n.addEventListener("click",function(){go(1);});\n' +
    /* auto-advance is opt-in twice: motion allowed AND the section on screen */
    '  function play(){if(still||timer)return;timer=setInterval(function(){show(idx+1);},4800);}\n' +
    '  if("IntersectionObserver" in window){\n' +
    '    new IntersectionObserver(function(es){es.forEach(function(e){\n' +
    '      if(e.isIntersecting)play(); else stop();});},{threshold:.35}).observe(root);\n' +
    '  } else { play(); }\n' +
    '  root.addEventListener("mouseenter",stop);\n' +
    '  show(0);\n' +
    '})();\n' +
    '</script>\n';
}

function section() {
  assertShots();

  var shotHtml = Object.keys(SHOTS).map(function (k, i) {
    var s = SHOTS[k];
    return '  <div class="rlc-shot' + (i === 0 ? ' is-active' : '') + '" data-shot="' + k + '"' +
      (i === 0 ? '' : ' aria-hidden="true"') + '>' +
      '<img src="' + s.src + '" width="1280" height="800" alt="' + esc(s.alt) + '"' +
      (i === 0 ? '' : ' loading="lazy"') + ' decoding="async"></div>';
  }).join('\n');

  var capHtml = STEPS.map(function (s, i) {
    return '    <li class="rlc-c' + (i === 0 ? ' is-active' : '') + '" data-shot="' + s.shot +
      '" data-z="' + s.z + '" data-ox="' + s.ox + '%" data-oy="' + s.oy + '%">' +
      '<span class="rlc-ch"><span class="rlc-n">' + (i + 1) + '</span>' + esc(s.label) + '</span>' +
      '<p>' + esc(s.text) + '</p></li>';
  }).join('\n');

  return '<section class="rlc" aria-roledescription="carousel" ' +
    'aria-label="What the extension does, in four real screenshots">\n' +
    css() +
    /* .rlc-head is display:flex with a gap, so this space changes no pixel --
       without it "v1.5.1" welded onto "united.com" as "v1.5.1united.com". */
    '  <div class="rlc-head"><span class="rlc-badge">Real screenshots · v1.5.1</span> ' +
    '<span class="rlc-where">united.com · app.navan.com</span>' +
    '<span class="rlc-nav needs-js">' +
    '<button class="rlc-prev" type="button" aria-label="Previous step">&#8249;</button>' +
    '<button class="rlc-next" type="button" aria-label="Next step">&#8250;</button></span></div>\n' +
    '  <div class="rlc-stage">\n' + shotHtml + '\n  </div>\n' +
    '  <ol class="rlc-cl">\n' + capHtml + '\n  </ol>\n' +
    '  <p class="rlc-foot">Captured on the real united.com and Navan with the store build. Nothing ' +
    'here is a mockup. The percentages in the badges are the odds the extension actually computed ' +
    'for that route.</p>\n' +
    script() +
    '</section>';
}

module.exports = { section: section, STEPS: STEPS, SHOTS: SHOTS };
