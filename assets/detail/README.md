# assets/detail — 1:1 crops of the real extension captures

## Why these exist

`assets/shot-united-1280x800.png` and `assets/shot-navan-1280x800.png` are real captures of the
store build on united.com and Navan. They are **1280 × 800**. The homepage was rendering one of them
across a slot about **1,850 CSS px** wide, which on a Retina display is roughly a **2.9× upscale** —
that is the entire reason the carousel looked blurry. It was never a compression problem. The source
was simply too small for the slot it was put in.

There are two fixes, and they are independent:

| Fix | Status |
|---|---|
| **Stop upscaling.** Show detail crops at, or below, their native pixel size | **Done — these files** |
| **Recapture the full shots at 2×** (2560 × 1600) so a full-width frame can also be sharp | **Blocked — needs Jeremy** |

## The crops

Cut from `shot-united-1280x800.png` with `sips`, no resampling — every pixel is original.

| File | Size | What it shows |
|---|---|---|
| `crop-panel.png` | 292 × 348 | The floating route panel: five flights by odds, the greyed-out `UA1450 · not in results`, the connection row at 98%, and the honest 48-hour caveat |
| `crop-badge.png` | 344 × 152 | One united.com result row with the green `49%` badge sitting in it — the single clearest picture of what the extension does |
| `crop-sort.png` | 276 × 52 | The sort control and the "keep sorted when the page updates" checkbox |

**Display them at native size or smaller.** `crop-panel.png` at `width:292px` is pin sharp;
at `width:600px` it is the same blur we started with. If a layout needs them larger, the
answer is the 2× recapture below, not CSS.

## The 2× recapture (needs a logged-in session, so it needs Jeremy)

Both captures show a real united.com search as a signed-in user, with the unpacked extension loaded.
Neither can be reproduced headlessly or unattended. To redo them:

1. Chrome, real profile, **unpacked** extension loaded, store copy disabled (house rule).
2. Set the device pixel ratio to 2 before capturing — DevTools ▸ ⋮ ▸ *Capture screenshot* respects
   the device toolbar, so set the device toolbar to **1280 × 800 at DPR 2** and capture. That yields
   a 2560 × 1600 file that downsamples cleanly into any slot.
3. Search **DEN → SFO, Aug 12**, one adult, and wait for the panel to settle.
4. **PII:** the account name renders as `Hi, Alex` in the header. Keep that — `Alex Morgan` is the
   agreed redaction. Check the header, the profile menu, and any autofilled traveller name.
5. Save as `assets/shot-united-2560x1600.png`, then re-cut these crops at 2× with the same offsets
   doubled:

   ```
   sips -c 696 584 --cropOffset  896 1960 shot-united-2560x1600.png --out detail/crop-panel.png
   sips -c 304 688 --cropOffset  936  276 shot-united-2560x1600.png --out detail/crop-badge.png
   sips -c 104 552 --cropOffset 1292 1972 shot-united-2560x1600.png --out detail/crop-sort.png
   ```

6. The same capture feeds the **v2.0.0 Chrome Web Store listing** (1280 × 800 required there, so
   downsample the 2× file rather than re-shooting). One capture session, two uses.

Repeat for Navan (`app.navan.com`, same route).
