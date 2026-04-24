# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Scrapes daily Reddit stats (members, visitors, contributions) for multiple categories of subreddits (coding agents, LLMs, companies) via a Cloudflare Worker proxy, stores results in per-category CSVs. Runs autonomously every day via GitHub Actions. Dashboard at GitHub Pages.

## Architecture

```
subreddits.json (config) → src/scraper.ts (tsx) → CF Worker (worker/index.js) → reddit.com → parse HTML → JSON → data/*.csv
```

- **`subreddits.json`** — Single source of truth for all categories and subreddits. Both the scraper and dashboard read this file. Adding a new category = editing this one file.
- **`src/scraper.ts`** — Orchestrator. Reads config, calls the Worker for each subreddit in parallel (deduped across categories), retries failures, writes per-category CSVs to `data/`. Run with `tsx` (no test framework).
- **`worker/index.js`** — Cloudflare Worker proxy. Solves Reddit's JS bot challenge, parses `<shreddit-subreddit-header>` for weekly stats, fetches `about.json` (with session cookies) for member count.
- **`index.html`** — Static dashboard (Chart.js). Fetches `subreddits.json` and per-category CSVs client-side. Renders collapsible sections, each with its own chart, controls, and stat cards. Served via GitHub Pages.
- **Why a Worker?** Reddit blocks all GitHub Actions datacenter IPs. CF Workers run on edge IPs that aren't blocked.

Detailed data flow and endpoint docs: `docs/ARCHITECTURE.md`

## Key constraints

- **Subreddit casing matters.** Names in `subreddits.json` MUST use exact canonical casing (`CLine` not `Cline`, `GithubCopilot` not `githubcopilot`). Wrong casing triggers redirects that break the Worker's challenge-solving flow.
- **Per-category error isolation.** If a category has any subreddit with zero stats, that category's CSV is not written (no corrupt data). Other categories still get written. The scraper exits code 1 if any category fails (triggers CI alert).
- **CSVs in `data/` directory.** One CSV per category (`data/coding-agents.csv`, `data/llms.csv`, etc.). GitHub Actions auto-commits `data/*.csv`. The dashboard fetches them via relative paths.
- **`subreddits.json` at project root.** Both the scraper and dashboard depend on this file. It must be included in GitHub Pages deployment.
- **`index.html` at project root.** GitHub Pages serves from root of main branch.
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
   This writes per-category CSVs to `data/`.
4. **Test the dashboard:**
   ```bash
   npx serve .    # serves index.html, subreddits.json, data/ at http://localhost:3000
   ```
5. **Show results to the user and wait for approval before any git operations.**
6. **Only deploy the Worker when changes are final:**
   ```bash
   cd worker && npx wrangler deploy
   ```
7. **Test in CI:**
   ```bash
   gh workflow run "Reddit Stats Tracker" --ref your-branch-name
   gh run watch          # watch the latest run
   ```
8. **Check CI logs for issues:**
   ```bash
   gh run view <run-id> --log | grep "members="
   ```
9. **Merge to main when CI passes:**
   ```bash
   git checkout main && git merge your-branch --no-edit && git push
   ```

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `REDDIT_PROXY_URL` | `.env` (local) / GitHub secret (CI) | Deployed CF Worker URL |

## When things break

Reddit periodically changes their bot detection. If the scraper starts returning 0s, consult `docs/TROUBLESHOOTING.md` — it has step-by-step diagnosis for every failure mode (challenge pattern changed, subreddit renamed, about.json blocked, CAPTCHA upgrade) with exact fix locations.
