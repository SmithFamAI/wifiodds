# wifiodds.com

**WiFi Odds — know before you book.** A static site that answers one question:
*what are my odds of getting good WiFi on this flight?*

- **`/`** — the instant flight check, then the extension in full (real screenshots), then The Race,
  the systems teaser, and the seven US carriers scored **twice**: next-gen odds as the headline and
  today's service tier under it. See "Two numbers" below.
- **`/race/`** — every airline's rollout timeline to full next-gen: current share against the finish
  line that airline has actually announced, with a source and a date on every row. United appears as
  the fastest large retrofit, not as the subject.
- **`/systems/`** — evergreen: Starlink vs Amazon Leo head-to-head plus every system flying on the
  fleets we score, with the quality weight each one carries in the formula.
- **`/airlines/`** — all 18 ranked by **ConnectScore** (0–100), sortable, filterable.
- **`/united/`** — the full United toolkit (route optimizer, best routings, confirmed tails, trip
  planner, booking playbook, fleet pulse) plus **`/united/history/`**, the day-by-day rollout timeline.
  Reads its own `/united/data.json`, refreshed daily.
- **`/alaska/`** — Alaska's Starlink rollout: ConnectScore, fleet-by-fleet status, and where the
  per-flight odds live (the extension, on alaskaair.com).
- **`/privacy.html`** — the privacy policy the Chrome Web Store listing points at.

Ported from `smithfamai.com/unitedstarlink` (Mac-mini-hosted Caddy) in July 2026. The `/united/` page
is a near-verbatim port: its internals are live-tested, so only the head, the brand header and the
footer were touched.

## Stack

| | |
|---|---|
| Hosting | **Cloudflare Pages**, GitHub integration — push to `main` deploys, PRs get preview URLs |
| Build command | `node build/prerender.js` |
| Output directory | **repo root** (`/`) |
| Framework preset | None |
| Node | Any current LTS. **Zero dependencies** — there is no `package.json` and nothing to install |
| Excluded from the deploy | `.assetsignore` (`build/`, `*.md`, `.claude`) |

`build/prerender.js` **generates every one of the 30 served pages** and writes `sitemap.xml`,
`robots.txt`, `llms.txt` and `functions/_lib/score.mjs`. `<lastmod>` comes from `united/data.json`'s `updated` field, so the daily
data commit moves it too. The generated HTML is committed, because Pages serves the repo root.

**Never hand-edit a file listed in `build/routes.js` — the next build overwrites it.** Layout:

| | |
|---|---|
| `build/routes.js` | the route table. Source of truth for what exists publicly |
| `build/lib/html.js` | the shared chrome: one `<head>` builder, one topbar, one subnav, one footer |
| `build/lib/render.js` | one function per page |
| `build/templates/*.html` | the unique content of the four pages that are too bespoke to express in JS — chiefly `united-optimizer.html`, which holds the optimizer's ~1,400 lines of live-tested app JS/CSS **verbatim**. Templates are injected, never parsed |
| `build/lib/market.js` | the two **editorial** data sets: each airline's announced finish line (for `/race/`) and the satellite-system primer (for `/systems/`). Every row carries its source and date. Fleet numbers are never repeated here — they are read live off `airlines.js`, so a row cannot disagree with the same airline's card |
| `build/lib/reel.js` | the homepage extension demo: ONE sequence over the **two real product screenshots** in `assets/`, four captions (search → odds → sort → guard). It replaced 883 lines of hand-drawn fake united.com/Navan UI. Read its header before changing it |

Five tripwires fail the build rather than shipping quietly:

1. a route in `ROUTES` with no file on disk (the failure that silently ships a 404);
2. a served `.html` file that is **not** in `ROUTES` — the drift guard. Four pages were once
   hand-authored whole documents, each with its own stale copy of the header, and nothing caught it.
   The `EMBEDS` escape hatch is now **empty**, which is the goal state;
3. a route still marked `kind: 'hand'`. There are none left;
4. a stored `serviceTier` that disagrees with the fleet share it describes. Counts update daily, the
   tier word does not, so without this a finished fleet would print "mixed" next to "97%" forever;
5. a missing rollout row on `/race/` or a missing screenshot for the reel — a blank timeline cell
   reads as "no rollout", and a broken `<img>` inside a section arguing "these are real screenshots"
   is worse than no section.

## Two numbers, not one

Every airline is scored twice, and the difference is the point:

| | |
|---|---|
| `nextGenScore` | **the headline.** Odds of a Starlink or Amazon Leo aircraft × free-for-you. A signed-but-unflown deal contributes **zero** — Delta is 0 |
| `connectScore` | the original score. Fleet share × system quality × free-for-you, crediting streaming-class geostationary at 0.6 rather than nothing — Delta is 60 |
| `serviceTier` | what the fleet delivers **today**: `next-gen` · `streaming` · `basic` · `mixed`. `restTier` is the tier on the part that is not next-gen yet, and `"unknown"` where we have not verified it |

Delta at *next-gen 0 and ConnectScore 60* is the case that forced this: a single number let a reader
conclude "Delta's WiFi beats United's Starlink" from two figures that were each individually correct.
Both numbers are on every card, in the API, and in `llms.txt`. **The tier fields are additive** —
`scoreAirline()` returns everything it always returned, so the extension and the API stay compatible.

## The public ConnectScore API

`/api/airlines`, `/api/airlines/{key}`, `/api/score/{flightNumber}` and `/api` are **Cloudflare Pages
Functions**, not files. They deploy automatically from `functions/` alongside the static build — there
is no build change and no `wrangler.toml`.

| | |
|---|---|
| `functions/api/**/*.js` | route bindings, one line each. `[key].js` / `[flight].js` are dynamic segments |
| `functions/_lib/handlers.mjs` | **all** the logic. Kept out of the route files so plain `node` can import and test it |
| `functions/_lib/api.mjs` | response envelope, CORS, the `sources` credits, flight-number parsing, the `united/data.json` lookup |
| `functions/_lib/score.mjs` | **GENERATED — do not edit.** `build/prerender.js` re-emits `assets/airlines.js` as an ES module |
| `api/docs/index.html` | the human docs — a normal generated page, the only `/api` path in `ROUTES` |

Two rules the code enforces on itself:

- **One formula.** The score lives only in `assets/airlines.js`, which must stay a *classic* script
  (the browser loads it with a plain `<script src>`, so an `export` keyword there breaks every page).
  `prerender.js` mechanically re-emits it as `functions/_lib/score.mjs` — a verbatim copy with the
  CommonJS tail swapped for `export {}` — and fails the build if a name it re-exports has been
  renamed. Nothing is retyped, so the API cannot drift from the pages.
- **No third-party requests.** The API reads only `united/data.json` out of its own deploy via
  `env.ASSETS`. It never calls a tracker or an airline. `build/apitest.js` fails if any module other
  than `_lib/api.mjs` so much as mentions `fetch(`.

```bash
node build/prerender.js     # must run first — apitest reads its output
node build/apitest.js       # 538 checks: syntax, every handler against a mock context, and PARITY
```

PARITY now runs on both axes: the API's `connectScore` must equal the number `/airlines/qatar/`
prints, **and** its `nextGenScore` must equal the headline number on that airline's homepage card
(all seven checked). Delta reading 0 on the card and 0 from the API, while `connectScore` stays 60,
is the specific thing being protected.

`wrangler` is deliberately not installed, so there is no local Functions runtime. `apitest.js` is the
substitute: it copies each `functions/**/*.js` to a temp `.mjs` for `node --check`, imports the
handlers for real, and asserts the **parsed response bodies** — including that the score the API
returns for Qatar equals the number the generated `/airlines/qatar/index.html` actually prints. A
green light there is a light that was looking.

## Local preview

Any static file server works, but the pages use **root-absolute** paths (`/assets/airlines.js`,
`/united/`), so serve the repo root — not a subdirectory:

```bash
cd ~/Projects/wifiodds
node build/prerender.js          # optional: regenerate sitemap/robots
python3 -m http.server 8000      # or: npx serve .
```

Then open <http://localhost:8000/>. Verify by **response body**, never by status code:

```bash
curl -sS "http://localhost:8000/?cb=$RANDOM"        | grep -i '<title>'   # WiFi Odds — know before you book
curl -sS "http://localhost:8000/united/?cb=$RANDOM" | grep -i '<title>'   # WiFi Odds · United
curl -sS "http://localhost:8000/alaska/?cb=$RANDOM" | grep -c 'alaskastarlinktracker'   # > 0
```

Every number, table row and chart path is **baked at build time** — the airline leaderboard and the
Alaska ConnectScore included — so the pages read correctly with JavaScript switched off. Two pages
still render a list client-side from `united/data.json` and are the only ones allowed to say
"Loading…": `/united/` (the live route optimizer) and `/united/history/` (the 176-day day-log).

## Data pipeline

`/united/data.json` (fleet, roster, history, route cache) is regenerated by
`scripts/update-unitedstarlink.js` on the Mac mini under the `starlink-data-refresh` scheduled task.
After the cutover the task **commits into this repo**, and the push auto-deploys Pages — the mini stops
being a web server and becomes just the cron box. Nothing else in the tree is generated.

- The path is **`/united/data.json`**. `/united/index.html` fetches it as a *relative* `data.json`
  and `/united/history/index.html` as `../data.json` — don't move the file without changing both.
- Later this becomes a GitHub Action or a Supabase scheduled function (Phase B); not needed for the
  cutover.

`assets/airlines.js` is a **copy** of the extension's `extension/airlines.js`
(`jeremyinthebay/united-starlink-companion`, branch `bridge-1.6`), which stays the single source of
truth until the `airlines` table in Supabase replaces both. Change one, change the other.

> **KNOWN DIVERGENCE, deliberate and additive.** This copy is ahead of the extension's by the
> three-tier fields (`serviceTier`, `restTier`) and their helpers (`nextGenScore`, `serviceTierOf`,
> …). Nothing was removed or renamed, so the extension's popup keeps working against its own older
> copy — it simply does not show the second number yet. Fold these fields into
> `extension/airlines.js` on the next 2.0 build so the popup can lead with next-gen odds like the
> site does.

`assets/shot-united-1280x800.png` / `assets/shot-navan-1280x800.png` are the **real** store
screenshots (copies of `store-assets/screenshot-{united,navan}-1280x800.png` in the extension repo).
`build/lib/reel.js` builds the homepage demo from them and fails the build if either is missing.
The same two files feed the v2.0.0 store listing and any Reddit post — one asset set, three surfaces.

`assets/selectors.json` is the extension's remote selector manifest — it is fetched by the extension
about once a day so an airline redesign doesn't break the overlay. It is served from this site, so
**keep the path stable**: `https://wifiodds.com/assets/selectors.json`.

## Credits

Fleet verification for the two instrumented airlines comes from the independent community trackers
**[unitedstarlinktracker.com](https://unitedstarlinktracker.com)** and
**[alaskastarlinktracker.com](https://alaskastarlinktracker.com)**, built by **@martinamps**, which
check every tail against the airline's own site. All credit for that data goes to them. Every other
airline in the ConnectScore map is compiled from public airline announcements (July 2026).

WiFi Odds is unofficial, free and open source, and is not affiliated with, endorsed by, or sponsored
by any airline, Navan, SpaceX/Starlink, Amazon, Viasat, or the community trackers.
