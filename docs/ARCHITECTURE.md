# Architecture

## Overview

This project scrapes weekly stats (members, visitors, contributions) from 9 Reddit coding-agent subreddits and stores them in a CSV. It runs autonomously via GitHub Actions on a recurring schedule.

```
GitHub Actions (CI)
  └── src/scraper.ts          (tsx — plain Node script)
        └── fetch(`CF_WORKER_URL?sub=X`)
              └── worker/index.js   (Cloudflare Worker on edge network)
                    ├── GET reddit.com/r/X/     (HTML, with JS challenge solving)
                    │     └── parse <shreddit-subreddit-header> for weekly stats
                    └── GET reddit.com/r/X/about.json  (JSON, with session cookies)
                          └── parse .data.subscribers for member count
```

## Why a Cloudflare Worker?

Reddit blocks all requests from GitHub Actions' datacenter IPs — API, browser, everything. Cloudflare Workers run on edge IPs that Reddit treats as regular traffic.

## How the Worker solves Reddit's JS challenge

Reddit serves a bot-detection challenge page instead of the real content:

1. Worker fetches `https://www.reddit.com/r/{sub}/`
2. Reddit returns an HTML page containing `Please wait for verification` and a JS snippet: `(async e => e+e)("hex_string")`
3. Worker extracts the hex string and computes the solution: `hex + hex` (string concatenation)
4. Worker also extracts hidden form fields from the challenge page: `js_challenge`, `token`, and `jsc_orig_r`
5. Worker re-fetches with all form fields as query params (`?solution=...&js_challenge=1&token=...&jsc_orig_r=`), forwarding cookies and `Referer` header from step 2
6. Reddit returns the real page with `<shreddit-subreddit-header>` containing `weekly-active-users` and `weekly-contributions` attributes

## How member count is fetched

The HTML header tag does NOT contain subscriber count. Instead:

1. Worker fetches `https://www.reddit.com/r/{sub}/about.json` (no cookies needed from most IPs)
2. If that returns 0 (blocked), it retries with the session cookies obtained from the JS challenge
3. Parses `json.data.subscribers`

## Subreddit name casing matters

Reddit redirects non-canonical subreddit names (e.g., `Cline` → `CLine`). This redirect breaks the challenge-solving flow because cookies are bound to the original URL. Always use the exact canonical name as shown on Reddit.

Current canonical names (as of April 2026):
- `ClaudeCode`, `CLine`, `cursor`, `windsurf`, `GithubCopilot`, `google_antigravity`, `codex`, `RooCode`, `PiCodingAgent`

To find a subreddit's canonical name: visit `reddit.com/r/name` and check the URL after redirect.

## Data flow

1. `src/scraper.ts` calls the Worker for all 9 subreddits in parallel
2. Any that return 0 for weekly stats get retried sequentially (1s delay)
3. Results are sorted by weekly visitors and written to `reddit-stats.csv`
4. Same-date rows are replaced (idempotent — safe to run multiple times per day)
5. If any stat is 0 for any subreddit, the script exits with code 1 (CI failure + email alert)

## File map

| File | Purpose |
|---|---|
| `src/scraper.ts` | Main scraper script, run with `tsx` |
| `worker/index.js` | Cloudflare Worker proxy |
| `worker/wrangler.toml` | Worker deployment config |
| `index.html` | Dashboard (Chart.js), served via GitHub Pages |
| `reddit-stats.csv` | Output data (auto-committed by CI) |
| `.github/workflows/reddit-tracker.yml` | Daily cron + manual trigger |
| `.env` / `.env.example` | `REDDIT_PROXY_URL` for local runs |
| `docs/ARCHITECTURE.md` | This file |
| `docs/TROUBLESHOOTING.md` | When things break |

## Key environment variables

| Variable | Where | Purpose |
|---|---|---|
| `REDDIT_PROXY_URL` | `.env` (local) / GitHub secret (CI) | URL of the deployed Cloudflare Worker |

## Deploying the Worker

```bash
cd worker
npx wrangler deploy
```

The Worker URL is `https://reddit-stats-proxy.<your-subdomain>.workers.dev`. Set it as a GitHub Actions secret:

```bash
gh secret set REDDIT_PROXY_URL -b "https://reddit-stats-proxy.<your-subdomain>.workers.dev"
```
