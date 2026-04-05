# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Scrapes weekly Reddit stats (members, visitors, contributions) for 7 coding-agent subreddits via a Cloudflare Worker proxy, stores results in CSV. Runs autonomously every Saturday via GitHub Actions.

## Architecture

```
src/scraper.ts (tsx) → CF Worker (worker/index.js) → reddit.com → parse HTML → JSON → CSV
```

- **`src/scraper.ts`** — Orchestrator. Calls the Worker for each subreddit in parallel, retries failures, writes `reddit-stats.csv`. Run with `tsx` (no test framework).
- **`worker/index.js`** — Cloudflare Worker proxy. Solves Reddit's JS bot challenge, parses `<shreddit-subreddit-header>` for weekly stats, fetches `about.json` (with session cookies) for member count.
- **Why a Worker?** Reddit blocks all GitHub Actions datacenter IPs. CF Workers run on edge IPs that aren't blocked.

Detailed data flow and endpoint docs: `docs/ARCHITECTURE.md`

## Key constraints

- **Subreddit casing matters.** Names in `src/scraper.ts` MUST use exact canonical casing (`CLine` not `Cline`, `GithubCopilot` not `githubcopilot`). Wrong casing triggers redirects that break the Worker's challenge-solving flow.
- **Any zero = failure.** The scraper exits code 1 if any stat is 0 for any subreddit. This is intentional — it triggers CI failure + email alert. Don't weaken this check.
- **CSV at project root.** Must stay there — GitHub Actions auto-commit targets `reddit-stats.csv`.
- **No cache on the Worker.** Each request hits Reddit fresh.

## Dev workflow

1. **Always branch.** Create a feature branch before making changes: `git checkout -b feat/description`
2. **Test locally first:**
   ```bash
   npm run scrape
   ```
   Requires `REDDIT_PROXY_URL` in `.env` pointing to the deployed Worker.
3. **If you changed `worker/index.js`, redeploy before testing:**
   ```bash
   cd worker && npx wrangler deploy
   ```
4. **Test in CI:**
   ```bash
   gh workflow run "Reddit Stats Tracker" --ref your-branch-name
   gh run watch          # watch the latest run
   ```
5. **Check CI logs for issues:**
   ```bash
   gh run view <run-id> --log | grep "members="
   ```
6. **Merge to main when CI passes, then push:**
   ```bash
   git checkout main && git merge your-branch --no-edit && git push
   ```

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `REDDIT_PROXY_URL` | `.env` (local) / GitHub secret (CI) | Deployed CF Worker URL |

## When things break

Reddit periodically changes their bot detection. If the scraper starts returning 0s, consult `docs/TROUBLESHOOTING.md` — it has step-by-step diagnosis for every failure mode (challenge pattern changed, subreddit renamed, about.json blocked, CAPTCHA upgrade) with exact fix locations.
