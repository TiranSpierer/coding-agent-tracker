# Reddit Community Tracker

Weekly tracker comparing AI communities on Reddit across multiple categories.

Tracks **members**, **weekly visitors**, and **weekly contributions** for each subreddit.

### Coding Agents

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
| r/PiCodingAgent | Pi |

### LLMs

| Subreddit | Model |
|---|---|
| r/ClaudeAI | Claude |
| r/ChatGPT | ChatGPT |
| r/grok | Grok |
| r/GeminiAI | Gemini |

### Companies

| Subreddit | Company |
|---|---|
| r/OpenAI | OpenAI |
| r/Anthropic | Anthropic |
| r/perplexity_ai | Perplexity |

Data is collected hourly via GitHub Actions and stored in per-category CSVs in `data/`.

All categories and subreddits are defined in `subreddits.json` — adding a new category or subreddit requires editing only this file.

**[Live Dashboard](https://tiranspierer.github.io/coding-agent-tracker/)** — interactive chart with metric/subreddit/date filters, collapsible sections per category.

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
