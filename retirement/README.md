# Retirement page

This folder is the closed site. Cloudflare Pages project `wifiodds-site` serves it from a direct upload. `build/prerender.js` does not build it, and `build/assemble.sh` does not copy it into `dist/`.

Upload `retirement/public` only. That directory holds `404.html` and `_headers`. There is no `index.html`, so a request for a missing path returns 404 with this page. That is the status the closed site already uses. Browsers still render the body. `/404` returns 200, because Pages maps `404.html` to that path.

`_headers` keeps `x-wifiodds-state: retired-20261031`, `x-robots-tag: noindex`, and `no-store` on every response. The page also carries `<meta name="robots" content="noindex">`.

Git production deploys for this project are off, and preview deploys are off. Merging a pull request does not publish this page. The daily data refresh workflow is disabled in GitHub Actions. Leave both that way.

To publish, from a checkout with Wrangler logged into the account that owns `wifiodds-site`:

```
npx wrangler pages deploy retirement/public --project-name wifiodds-site --branch main --commit-dirty=true
```

Deploying any other directory would put the old site back. Production deployment `505d5289` (17 Nov 2026) is this page. The bare closed page remains as deployment `035007e6` (31 Oct 2026, message "Owner-requested WiFiOdds retirement; prior deployment retained"). Roll back to `035007e6` from the Pages dashboard if this upload is wrong.
