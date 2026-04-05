# coding-agent-tracker

Weekly tracker comparing AI coding agent communities on Reddit.

Tracks **members**, **weekly visitors**, and **weekly contributions** across subreddits:

| Subreddit | Agent |
|---|---|
| r/ClaudeCode | Claude Code |
| r/CLine | Cline |
| r/cursor | Cursor |
| r/windsurf | Windsurf |
| r/GithubCopilot | GitHub Copilot |
| r/google_antigravity | Antigravity |
| r/codex | Codex |

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and set the worker URL:

```bash
cp .env.example .env
```

### Cloudflare Worker (required for CI)

The scraper uses a Cloudflare Worker proxy to bypass Reddit's datacenter IP blocking. Deploy it once:

```bash
cd worker
npx wrangler deploy
```

Set the deployed URL in `.env` and as a GitHub Actions secret:

```bash
gh secret set REDDIT_PROXY_URL -b "https://reddit-stats-proxy.<your-subdomain>.workers.dev"
```

## Run

```bash
npm run scrape
```

Results are appended to `reddit-stats.csv`.

## Automation

A GitHub Actions workflow runs every Saturday at 00:00 UTC, scraping stats and auto-committing the updated CSV.
