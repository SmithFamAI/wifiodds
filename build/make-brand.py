#!/usr/bin/env python3
"""build/make-brand.py — the binary assets, and where they come from.

    python3 build/make-brand.py fonts    # assets/serif-400.woff2, serif-700.woff2
    python3 build/make-brand.py og       # assets/og.png
    python3 build/make-brand.py all

OPT-IN TOOLING. This is not part of `node build/prerender.js` and it must never
be: it downloads a font and rasterises a 1200x630 PNG, and the daily build has to
stay fast and offline-safe. Run it by hand when the mark or the typeface changes,
commit the output, and that is the last time the network is involved. Nothing the
browser loads comes from anywhere but wifiodds.com.

    pip3 install fonttools brotli pillow

FONTS. Two faces, one family, about 38 KB. Source Serif 4 (Frank Grießhammer,
Adobe, SIL Open Font License) carries the speaking voice: headings, the
say-sentence, the wordmark and every large figure. The reporting voice — tables,
labels, provenance, micro-caps — stays on system-ui, which costs nothing and is
already hinted for the reader's own OS at the 12 to 14px sizes that voice lives
at. The reasoning is written out at the top of assets/site.css.

The upstream file is a two-axis variable font (wght 200-900, opsz 8-60). It is
instanced here to two static weights rather than shipped variable: 38 KB across
two files against 49 KB for one variable file, with real 400 and 700 outlines
instead of interpolated ones. The optical size is pinned per weight, 14 for the
400 that sets the say-sentence and 20 for the 700 that sets headings.

Source Serif's default figures are already tabular — all ten digits measure 529
units — so a numeral does not change width when it changes value, which is the
one thing the old B612 Mono was carrying. Nothing on the site needs a mono
webfont to keep that, and the licence travels in assets/SourceSerif4-OFL.txt as
the OFL requires.

The UNICODES list below was not guessed. It is Latin, plus the characters found
by counting every non-ASCII codepoint in the built HTML. If you add a glyph to
the copy and it renders in a fallback face, that is what this list is missing.

OG IMAGE. The paper ground, the sky rule and the orbit mark, drawn from the same
tokens as assets/site.css and set in the same Source Serif that the page uses.
Deliberately dateless: an OG image is cached by every scraper that ever saw it,
so a date baked into one is a promise the file cannot keep. The date lives in the
masthead on the page, where it is regenerated daily.
"""

import io
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')

# The OFL upstream, pinned to a path rather than a release tag so a rerun is
# reproducible against whatever google/fonts main holds. Re-run and re-commit
# when you want a newer cut; never fetch at build time.
SRC = ('https://raw.githubusercontent.com/google/fonts/main/ofl/sourceserif4/'
       'SourceSerif4%5Bopsz%2Cwght%5D.ttf')
OFL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourceserif4/OFL.txt'

# name -> (opsz, wght). opsz is pinned per weight: the 400 sets running text at
# 16 to 19px, the 700 sets headings from 20px to 48px.
FACES = {
    'serif-400': (14, 400),
    'serif-700': (20, 700),
}

UNICODES = ','.join([
    'U+0020-007E', 'U+00A0-00FF', 'U+0131', 'U+0152-0153', 'U+02C6', 'U+02DC',
    'U+0394', 'U+03A3', 'U+03A9', 'U+03BC', 'U+03C0',          # Sigma in the API docs
    'U+2010', 'U+2013-2014', 'U+2018-201A', 'U+201C-201E',     # dashes and quotes
    'U+2020-2022', 'U+2026', 'U+2030', 'U+2032-2033', 'U+2039-203A',
    'U+2044', 'U+2074', 'U+20AC', 'U+2122',
    'U+2190-2199', 'U+21C4-21C5', 'U+21CC', 'U+21D5',           # arrows, incl. the sort glyph
    'U+2212', 'U+221A', 'U+221E', 'U+2248', 'U+2260', 'U+2264-2265',
    'U+25B2', 'U+25BC', 'U+25BE', 'U+25CE', 'U+25CF', 'U+2605', 'U+2713',
    'U+FB01-FB02', 'U+FFFD',
])
# tnum and lnum are kept even though the defaults are already lining and
# tabular, so that a font-variant-numeric declaration has something to bind to.
FEATURES = 'kern,liga,ccmp,calt,case,tnum,lnum'
BUDGET = 60 * 1024

# the Fable tokens, straight from assets/site.css :root
PAPER = (0xfb, 0xf8, 0xf2)
PANEL = (0xf4, 0xee, 0xe2)
INK = (0x29, 0x24, 0x1c)
INK_SOFT = (0x44, 0x3d, 0x32)
MUTED = (0x6e, 0x65, 0x57)
LINE = (0xe3, 0xda, 0xca)
SKY = (0x2d, 0x5a, 0x7d)
SKY_DEEP = (0x22, 0x45, 0x5f)
SKY_FG = (0xe9, 0xf1, 0xf7)
GOOD = (0x1e, 0x7a, 0x46)
MIXED = (0xa0, 0x64, 0x00)
LONG = (0xa8, 0x4b, 0x2f)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'wifiodds-build/1'})
    return urllib.request.urlopen(req, timeout=60).read()


def build_fonts():
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    src = os.path.join('/tmp', 'sourceserif4-vf.ttf')
    if not os.path.exists(src):
        with open(src, 'wb') as fh:
            fh.write(fetch(SRC))

    total = 0
    for name, (opsz, wght) in sorted(FACES.items()):
        vf = TTFont(src)
        instancer.instantiateVariableFont(vf, {'opsz': opsz, 'wght': wght}, inplace=True)
        pinned = os.path.join('/tmp', name + '-static.ttf')
        vf.save(pinned)
        out = os.path.join(ASSETS, name + '.woff2')
        subset.main([
            pinned, '--unicodes=' + UNICODES, '--layout-features=' + FEATURES,
            '--flavor=woff2', '--no-hinting', '--desubroutinize',
            '--notdef-outline', '--output-file=' + out,
        ])
        size = os.path.getsize(out)
        total += size
        print('  %-18s %6d bytes  (opsz %d, wght %d)' % (
            os.path.basename(out), size, opsz, wght))
    with open(os.path.join(ASSETS, 'SourceSerif4-OFL.txt'), 'wb') as fh:
        fh.write(fetch(OFL))
    print('  total %d bytes (%.1f KB)' % (total, total / 1024.0))
    if total > BUDGET:
        print('  OVER BUDGET. 60 KB is the ceiling for the whole family.')
        return 1
    return 0


def ttf_for_pillow(face):
    """Pillow reads TTF, not woff2. Decompress the shipped subset back to a TTF
    in memory so the OG image is drawn with the exact glyphs the site serves."""
    from fontTools.ttLib import TTFont
    f = TTFont(os.path.join(ASSETS, face + '.woff2'))
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    buf.seek(0)
    return buf


def orbit_mark(size, colour):
    """The mark: an orbit ring at -22 degrees, a body on the ring's centre and a
    satellite on the ring. Same drawing as the favicon and the masthead, and the
    only picture this site has. Drawn oversampled and rotated, because Pillow
    cannot stroke a rotated ellipse directly."""
    from PIL import Image, ImageDraw
    s = size * 4
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = cy = s / 2.0
    rx, ry = s * 0.344, s * 0.144           # 11/32 and 4.6/32, as the SVG has it
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=colour + (255,),
              width=max(2, int(s * 0.0625)))
    layer = layer.rotate(22, resample=Image.BICUBIC, center=(cx, cy))
    d = ImageDraw.Draw(layer)
    r = s * 0.1625                           # 5.2/32
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour + (255,))
    sx, sy, sr = s * 0.819, s * 0.372, s * 0.072
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=colour + (255,))
    return layer.resize((size, size), Image.LANCZOS)


def build_og():
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # Every page opens on a rule of sky. So does the card.
    d.rectangle([0, 0, W, 13], fill=SKY_DEEP)

    disp = ImageFont.truetype(ttf_for_pillow('serif-700'), 66)
    wm = ImageFont.truetype(ttf_for_pillow('serif-700'), 34)
    sub = ImageFont.truetype(ttf_for_pillow('serif-400'), 30)
    lab = ImageFont.truetype(ttf_for_pillow('serif-700'), 20)
    fig = ImageFont.truetype(ttf_for_pillow('serif-700'), 62)

    M = 76
    mark = orbit_mark(44, SKY)
    img.paste(mark, (M, 74), mark)
    d.text((M + 58, 76), 'WiFi Odds', font=wm, fill=INK)
    d.line([M, 142, W - M, 142], fill=LINE, width=1)

    d.text((M, 186), 'Will your flight have', font=disp, fill=INK)
    d.text((M, 262), 'WiFi that works?', font=disp, fill=INK)
    d.text((M, 372), '18 airlines scored, one number each,', font=sub, fill=INK_SOFT)
    d.text((M, 412), 'and the method that produced it.', font=sub, fill=INK_SOFT)

    # The bands, right column: the three colours this site is allowed to spend on
    # a number, each wearing its own word. Nothing decorative is tinted.
    bx = W - M - 250
    d.line([bx - 54, 186, bx - 54, H - 96], fill=LINE, width=1)
    for i, (val, word, col) in enumerate((('88', 'good', GOOD),
                                          ('48', 'mixed', MIXED),
                                          ('12', 'long shot', LONG))):
        y = 190 + i * 96
        d.text((bx, y), val, font=fig, fill=col)
        d.text((bx + 106, y + 26), word, font=lab, fill=col)
    d.text((bx, 190 + 3 * 96 + 6), 'ConnectScore, 0 to 100', font=lab, fill=MUTED)

    d.rectangle([0, H - 52, W, H], fill=PANEL)
    d.line([0, H - 52, W, H - 52], fill=LINE, width=1)
    d.text((M, H - 38), 'Every figure names its source and its date.',
           font=lab, fill=MUTED)

    out = os.path.join(ASSETS, 'og.png')
    img.save(out, 'PNG', optimize=True)
    print('  og.png %d bytes (%dx%d)' % (os.path.getsize(out), W, H))
    return 0


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    rc = 0
    if what in ('fonts', 'all'):
        print('fonts:')
        rc |= build_fonts()
    if what in ('og', 'all'):
        print('og image:')
        rc |= build_og()
    sys.exit(rc)
