# wifiodds.com

A static site plus Cloudflare Pages Functions. It answers two different questions about inflight WiFi, and it keeps them separate:

- **Next-gen odds** are the chance of a Starlink or Amazon Leo aircraft. The Chrome extension prints this per flight when the booking page supplies a United or Alaska flight number. The homepage board prints the airline-level figure.
- **Streaming score** is a 0-100 rating of WiFi quality across an airline's whole published fleet today. It is the customer-facing name for that number.

Do not treat those as one score. A high Streaming score can sit next to sourced next-gen odds of zero. An unpublished next-gen count is unknown, not zero.

Live Chrome Web Store build is **3.0.2**. Do not describe a later store version as live.

## Public routes

`SURFACES.md` is generated from `build/routes.js` on every `node build/prerender.js` run. It is the committed list of public HTML routes. Do not hand-edit it.

| URL | File on disk | What it is |
|---|---|---|
| `/` | `index.html` | Homepage: next-gen odds and Streaming score for the tracked airlines, plus the extension pitch |
| `/methodology/` | `methodology/index.html` | How the two numbers are built, sourced, and labelled |
| `/technology/` | `technology/index.html` | Inflight WiFi systems in plain language |
| `/extension/` | `extension/index.html` | The Chrome extension, including the host matrix for 3.0.2 |
| `/privacy` | `privacy.html` | Privacy policy the Chrome Web Store listing points at |

Cloudflare Pages maps `/privacy` to `privacy.html`. That is the live URL. A plain static server that does not apply Pages pretty-URL mapping serves the same file at `/privacy.html`.

`/404.html` is served for unmatched paths. It is absent from `sitemap.xml` on purpose.

JSON endpoints live under `/api/*` as Pages Functions (no HTML file on disk):

| Endpoint | Role |
|---|---|
| `GET /api` | Index, field names, sources |
| `GET /api/airlines` | Every tracked airline, best Streaming score first |
| `GET /api/airlines/{key}` | One airline |
| `POST /api/report` | Inbound report intake |
| `GET /api/score/{flight}` | Retired 2026-07-26; returns 410 Gone |

`GET /api` documents `docs` as `https://wifiodds.com/methodology/`.

`/united/data.json` is a required static asset. The Chrome extension fetches it. The `/united/` HTML page is gone. Do not move that JSON path.

## Old encyclopedia URLs

These paths are not current pages. `_redirects` sends each of them to `/` with a 301:

`/airlines/`, `/race/`, `/systems/`, `/united/` (exact, not a glob), `/united/fleet/`, `/united/history/`, `/alaska/`, `/roadmap/`, `/record/`, `/api/docs/`

The `/united/` rule is enumerated exactly so it cannot swallow `/united/data.json`. Do not add a `/united/*` glob.

## Two numbers

| Metric | Question it answers | Public name |
|---|---|---|
| Next-gen odds | Chance of boarding Starlink or Amazon Leo, times the free-for-you factor | next-gen odds |
| Streaming score | Whole-fleet WiFi quality today (fleet share x system quality x free-for-you), published as the floor | Streaming score |

A signed-but-unflown next-gen deal contributes 0 to next-gen odds when the airline has published that none of those aircraft are flying. An airline that has Starlink in service and has **not** published an equipped count stays unpublished on that axis. `pctEquipped()` returns `null` in that case. Do not print that as 0.

Unresolved aircraft stay out of the next-gen denominator and remain visible. Unknown is not zero.

## API names

The JSON API is Cloudflare Pages Functions in `functions/`. There is no `wrangler.toml`. `wrangler` is not installed; `node build/apitest.js` is the local stand-in (run `node build/prerender.js` first).

Current fields: `streamingScore`, `streamingScoreLower`, `streamingScoreUpper`, `streamingScoreExact`.

`connectScore` and its lower/upper/exact siblings remain as **deprecated compatibility aliases**. They equal the Streaming score fields. Do not present ConnectScore as a public ranking encyclopedia. The `/airlines/` pages that once printed it are 301s to `/`.

`nextGenScore` is next-gen odds. When next-gen is unpublished, the public value is JSON `null` with `nextGen.published: false` and `nextGen.ranked: false`.

One formula: scores are computed in `assets/airlines.js`, which must stay a classic browser script (an `export` there breaks the pages). `build/prerender.js` re-emits that file as `functions/_lib/score.mjs`. The API must not drift from the pages.

No third-party requests from the Functions. They read `united/data.json` from the same deploy via `env.ASSETS`.

## Stack

| | |
|---|---|
| Hosting | Cloudflare Pages, GitHub integration. Push to `main` deploys. PRs get preview URLs |
| Build command | `node build/prerender.js` |
| Node | Current LTS. No `package.json`; nothing to install |
| Generated HTML | Committed, because that is what the site serves |

**Never hand-edit a file listed in `build/routes.js`.** The next build overwrites it. Change the generator or the template.

| Path | Role |
|---|---|
| `build/routes.js` | Route table. Source of truth for public HTML |
| `build/prerender.js` | Writes every route, plus `sitemap.xml`, `robots.txt`, `llms.txt`, and `functions/_lib/score.mjs` |
| `build/templates/` | Unique page content poured through the shared chrome |
| `build/lib/` | Shared chrome and page assembly |
| `build/assemble.sh` | Copies the allow-listed files in `build/public-manifest.txt` into `dist/` |
| `functions/api/` | One-line route bindings |
| `functions/_lib/` | API logic, importable from plain `node` |
| `_redirects` | 301s for removed encyclopedia URLs |
| `assets/selectors.json` | Remote selector manifest the extension fetches. Keep this path: `https://wifiodds.com/assets/selectors.json` |

`build/ship.sh` is the sanctioned publish path (`--check-only` builds and verifies without committing). **Never `git add .`.** Stage by explicit path. This tree holds other people's drafts.

The live Pages output directory is a Cloudflare dashboard setting. Do not infer it from this file. `SURFACES.md` lists the public HTML routes that actually ship.

## Local preview

Pages use root-absolute paths (`/assets/airlines.js`). Serve the repo root, not a subdirectory:

```bash
node build/prerender.js
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Verify by **response body**, never by status code. Use a cache-buster:

```bash
curl -sS "http://localhost:8000/?cb=$RANDOM"              | grep -o '<title>[^<]*'
curl -sS "http://localhost:8000/methodology/?cb=$RANDOM"  | grep -o '<title>[^<]*'
curl -sS "http://localhost:8000/technology/?cb=$RANDOM"   | grep -o '<title>[^<]*'
curl -sS "http://localhost:8000/extension/?cb=$RANDOM"    | grep -o '<title>[^<]*'
curl -sS "http://localhost:8000/privacy.html?cb=$RANDOM"  | grep -o '<title>[^<]*'
```

The last line hits the privacy file on a plain static server. Live production URL is `/privacy`.

`python3 -m http.server` does not apply `_redirects` and does not run Pages Functions. Old encyclopedia paths will 404 locally. `/api/*` needs the deployed Functions.

Every homepage figure is baked at build time. JavaScript off still shows the scores.

## Data

`/united/data.json` holds the United roster the extension reads (Starlink tails, mainline vs regional). Keep that path. `build/prepare-daily-data.sh` copies a candidate into this repo from a source worktree that still contains `scripts/update-unitedstarlink.js`; that updater is not in this tree.

`assets/airlines.js` is the scoring map the site and the API share. Change it here and keep the extension's copy in mind until one table replaces both.

Required runtime files are listed in `build/routes.js` as `REQUIRED`. Losing one of them can still return HTTP 200.

## Credits

Fleet verification for United and Alaska comes from the independent community trackers **[unitedstarlinktracker.com](https://unitedstarlinktracker.com)** and **[alaskastarlinktracker.com](https://alaskastarlinktracker.com)**, built by **@martinamps**, which check every tail against the airline's own site. All credit for that data goes to them. Every other airline is compiled from public airline announcements (July 2026).

WiFi Odds is unofficial and is not affiliated with, endorsed by, or sponsored by any airline, Navan, SpaceX/Starlink, Amazon, Viasat, or the community trackers.
