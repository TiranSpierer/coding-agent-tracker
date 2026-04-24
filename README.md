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
| r/RooCode | Roo Code |
| r/PiCodingAgent | Pi Coding Agent |

Data is collected daily via GitHub Actions and stored in `reddit-stats.csv`.

**[Live Dashboard](https://tiranspierer.github.io/coding-agent-tracker/)** — interactive chart with metric/agent/date filters.

## Setup

```bash
npm install
cp .env.example .env
```

Set `REDDIT_PROXY_URL` in `.env` to the deployed Cloudflare Worker URL.

### Deploy the Worker (one-time)

```bash
cd worker
npx wrangler deploy
```

Then set the URL as a GitHub Actions secret:

```bash
gh secret set REDDIT_PROXY_URL -b "https://reddit-stats-proxy.<your-subdomain>.workers.dev"
```

## Run

```bash
npm run scrape
```
