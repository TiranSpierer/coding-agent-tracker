# coding-agent-tracker

Weekly tracker comparing AI coding agent communities on Reddit.

Tracks **members**, **weekly visitors**, and **weekly contributions** across subreddits:

| Subreddit | Agent |
|---|---|
| r/ClaudeCode | Claude Code |
| r/Cline | Cline |
| r/cursor | Cursor |
| r/windsurf | Windsurf |
| r/githubcopilot | GitHub Copilot |
| r/google_antigravity | Antigravity |
| r/codex | Codex |

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run scrape
```

Results are appended to `reddit-stats.csv`.
