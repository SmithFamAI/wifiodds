#!/usr/bin/env python3
"""build/make-brand.py — the two binary assets, and where they come from.

    python3 build/make-brand.py fonts    # assets/b612*.woff2
    python3 build/make-brand.py og       # assets/og.png
    python3 build/make-brand.py all

OPT-IN TOOLING. This is not part of `node build/prerender.js` and it must never
be: it downloads fonts and rasterises a 1200x630 PNG, and the daily build has to
stay fast and offline-safe. Run it by hand when the mark or the typeface changes,
commit the output, and that is the last time the network is involved. Nothing the
browser loads comes from anywhere but wifiodds.com.

    pip3 install fonttools brotli pillow

FONTS. B612 is the typeface Airbus commissioned for cockpit display legibility,
released under the SIL Open Font License. The four faces are fetched from Google's
CDN (which is where the upstream project publishes builds), subset to Latin plus
the punctuation and symbols the site actually uses, and written as woff2 to
assets/. The licence travels with them in assets/B612-OFL.txt, which the OFL
requires. About 53 KB for all four.

The UNICODES list below was not guessed. It is Latin, plus the characters found by
counting every non-ASCII codepoint in the built HTML. If you add a glyph to the
copy and it renders in a fallback face, that is what this list is missing.

OG IMAGE. The waffle mark at 1200x630 on plate charcoal, drawn from the same
tokens as assets/site.css. Deliberately dateless: an OG image is cached by every
scraper that ever saw it, so a date baked into one is a promise the file cannot
keep. The date lives in the plate strip on the page, where it is regenerated
daily.
"""

import io
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')

# Google Fonts CSS API resolves these; pinned so a run is reproducible.
FACES = {
    'b612-400':      'https://fonts.gstatic.com/s/b612/v13/3JnySDDxiSz32jk.ttf',
    'b612-700':      'https://fonts.gstatic.com/s/b612/v13/3Jn9SDDxiSz34oWXPDA.ttf',
    'b612mono-400':  'https://fonts.gstatic.com/s/b612mono/v16/kmK_Zq85QVWbN1eW6lJl1w.ttf',
    'b612mono-700':  'https://fonts.gstatic.com/s/b612mono/v16/kmK6Zq85QVWbN1eW6lJdayv4og.ttf',
}
OFL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/b612/OFL.txt'

UNICODES = ','.join([
    'U+0020-007E', 'U+00A0-00FF', 'U+0131', 'U+0152-0153', 'U+02C6', 'U+02DC',
    'U+0394', 'U+03A3', 'U+03A9', 'U+03BC', 'U+03C0',          # Sigma in the API docs
    'U+2010', 'U+2013-2014', 'U+2018-201A', 'U+201C-201E',     # dashes and quotes
    'U+2020-2022', 'U+2026', 'U+2030', 'U+2032-2033', 'U+2039-203A',
    'U+2044', 'U+2074', 'U+20AC', 'U+2122',
    'U+2190-2199', 'U+21D5',                                    # arrows, incl. the sort glyph
    'U+2212', 'U+221A', 'U+221E', 'U+2248', 'U+2260', 'U+2264-2265',
    'U+25CE', 'U+25CF', 'U+2605', 'U+26A0', 'U+2708', 'U+2713',
    'U+FB01-FB02', 'U+FFFD',
])
FEATURES = 'kern,liga,tnum,zero,ccmp'

# the plate tokens, straight from assets/site.css :root
BG = (0x0a, 0x0c, 0x0d)
PANEL = (0x0f, 0x12, 0x14)
INK = (0xe9, 0xec, 0xec)
INK2 = (0xa3, 0xac, 0xb0)
INK3 = (0x6a, 0x73, 0x77)
RULE = (0x21, 0x28, 0x29)
RULE2 = (0x35, 0x3e, 0x41)
GOOD = (0x3f, 0xcf, 0x8e)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'wifiodds-build/1'})
    return urllib.request.urlopen(req, timeout=30).read()


def build_fonts():
    from fontTools import subset
    total = 0
    for name, url in FACES.items():
        src = os.path.join('/tmp', name + '.ttf')
        with open(src, 'wb') as fh:
            fh.write(fetch(url))
        out = os.path.join(ASSETS, name + '.woff2')
        subset.main([
            src, '--unicodes=' + UNICODES, '--layout-features=' + FEATURES,
            '--flavor=woff2', '--no-hinting', '--desubroutinize',
            '--notdef-outline', '--output-file=' + out,
        ])
        size = os.path.getsize(out)
        total += size
        print('  %-16s %6d bytes' % (os.path.basename(out), size))
    with open(os.path.join(ASSETS, 'B612-OFL.txt'), 'wb') as fh:
        fh.write(fetch(OFL))
    print('  total %d bytes (%.1f KB)' % (total, total / 1024.0))
    if total > 60 * 1024:
        print('  OVER BUDGET. 60 KB is the ceiling for all four faces.')
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


def build_og():
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    disp = ImageFont.truetype(ttf_for_pillow('b612-700'), 58)
    mono = ImageFont.truetype(ttf_for_pillow('b612mono-700'), 21)
    monol = ImageFont.truetype(ttf_for_pillow('b612mono-400'), 19)
    sub = ImageFont.truetype(ttf_for_pillow('b612-400'), 31)

    M = 64                       # the plate margin
    d.rectangle([M, M, W - M, H - M], outline=RULE2, width=1)
    for y in range(M, H - M, 26):  # the ticked margin, same as .wrap::before
        d.line([M + 3, y, M + 3, y + 1], fill=RULE2)
        d.line([W - M - 3, y, W - M - 3, y + 1], fill=RULE2)

    # header strip, the same fields as the strip on every page minus the date
    d.line([M, M + 62, W - M, M + 62], fill=RULE2)
    d.text((M + 34, M + 26), 'WIFI ODDS  ·  CONNECTSCORE  ·  AMDT DAILY', font=mono, fill=INK2)

    # the waffle, right column: 10 x 12 cells, the bottom two rows and part of a
    # third lit. Same picture as the favicon and the header lockup, at poster
    # size. The column rule to its left is the fold, not decoration.
    cols, rows, cell, gap = 10, 12, 22, 7
    span = cols * (cell + gap) - gap
    gx = W - M - 34 - span
    gy = M + 62 + (H - M - (M + 62) - (rows * (cell + gap) - gap)) // 2
    lit_from = rows - 2
    for r in range(rows):
        for c in range(cols):
            x = gx + c * (cell + gap)
            y = gy + r * (cell + gap)
            lit = r >= lit_from or (r == lit_from - 1 and c < 4)
            d.rectangle([x, y, x + cell, y + cell], fill=GOOD if lit else PANEL)
            if not lit:
                d.rectangle([x, y, x + cell, y + cell], outline=RULE, width=1)
    d.line([gx - 44, M + 62, gx - 44, H - M], fill=RULE)
    d.text((gx, gy - 32), 'LIT CELLS ARE FLYING', font=monol, fill=INK3)

    d.text((M + 34, M + 122), 'Will your flight', font=disp, fill=INK)
    d.text((M + 34, M + 190), 'have WiFi that', font=disp, fill=INK)
    d.text((M + 34, M + 258), 'works?', font=disp, fill=INK)
    d.text((M + 34, M + 346), '18 airlines scored, one', font=sub, fill=INK2)
    d.text((M + 34, M + 386), 'number each, and the', font=sub, fill=INK2)
    d.text((M + 34, M + 426), 'method that produced it.', font=sub, fill=INK2)

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
