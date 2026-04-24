# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Scrapes daily Reddit stats (members, visitors, contributions) for 9 coding-agent subreddits via a Cloudflare Worker proxy, stores results in CSV. Runs autonomously every day via GitHub Actions. Dashboard at GitHub Pages.

## Architecture

```
src/scraper.ts (tsx) → CF Worker (worker/index.js) → reddit.com → parse HTML → JSON → CSV
```

- **`src/scraper.ts`** — Orchestrator. Calls the Worker for each subreddit in parallel, retries failures, writes `reddit-stats.csv`. Run with `tsx` (no test framework).
- **`worker/index.js`** — Cloudflare Worker proxy. Solves Reddit's JS bot challenge, parses `<shreddit-subreddit-header>` for weekly stats, fetches `about.json` (with session cookies) for member count.
- **`index.html`** — Static dashboard (Chart.js). Reads CSV client-side. Served via GitHub Pages.
- **Why a Worker?** Reddit blocks all GitHub Actions datacenter IPs. CF Workers run on edge IPs that aren't blocked.

Detailed data flow and endpoint docs: `docs/ARCHITECTURE.md`

## Key constraints

- **Subreddit casing matters.** Names in `src/scraper.ts` MUST use exact canonical casing (`CLine` not `Cline`, `GithubCopilot` not `githubcopilot`). Wrong casing triggers redirects that break the Worker's challenge-solving flow.
- **Any zero = failure.** The scraper exits code 1 if any stat is 0 for any subreddit. This is intentional — it triggers CI failure + email alert. Don't weaken this check.
- **CSV at project root.** Must stay there — GitHub Actions auto-commit targets `reddit-stats.csv`, and `index.html` fetches it via relative path.
- **`index.html` at project root.** GitHub Pages serves from root of main branch. The chart reads `reddit-stats.csv` from the same directory.
- **No cache on the Worker.** Each request hits Reddit fresh.

## Dev workflow

**Do NOT commit or push without explicit user approval.** Always test first, show the user the results, and wait for them to say to commit.

1. **Always branch.** Create a feature branch before making changes: `git checkout -b feat/description`
2. **Run the Worker locally** (no need to deploy during development):
   ```bash
   cd worker && npx wrangler dev    # runs at http://localhost:8787
   ```
   The scraper defaults to `localhost:8787` when `REDDIT_PROXY_URL` isn't set, so no `.env` needed for local dev.
3. **Test the scraper** (in a separate terminal):
   ```bash
   npm run scrape
   ```
4. **Show results to the user and wait for approval before any git operations.**
5. **Only deploy the Worker when changes are final:**
   ```bash
   cd worker && npx wrangler deploy
   ```
6. **Test in CI:**
   ```bash
   gh workflow run "Reddit Stats Tracker" --ref your-branch-name
   gh run watch          # watch the latest run
   ```
7. **Check CI logs for issues:**
   ```bash
   gh run view <run-id> --log | grep "members="
   ```
8. **Merge to main when CI passes:**
   ```bash
   git checkout main && git merge your-branch --no-edit && git push
   ```

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `REDDIT_PROXY_URL` | `.env` (local) / GitHub secret (CI) | Deployed CF Worker URL |

## When things break

Reddit periodically changes their bot detection. If the scraper starts returning 0s, consult `docs/TROUBLESHOOTING.md` — it has step-by-step diagnosis for every failure mode (challenge pattern changed, subreddit renamed, about.json blocked, CAPTCHA upgrade) with exact fix locations.
