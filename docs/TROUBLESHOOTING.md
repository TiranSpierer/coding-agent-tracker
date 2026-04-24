# Troubleshooting

## CI failed — subreddits returning 0s

The scraper exits with code 1 if any category has a subreddit returning 0 for any stat. This means Reddit changed something. Note: the scraper still writes CSVs for categories that succeeded — only the failing category is skipped.

### Step 1: Identify what's broken

Run locally to see which subreddits and which stats are failing:

```bash
npm run scrape
```

Look at the output — it will show per-category results, which subs have 0s and for which fields.

### Step 2: Diagnose the cause

**All subreddits return 0 weekly stats (members still work):**
- Reddit likely changed the JS challenge pattern
- The current challenge is `(async e => e+e)("hex")` — solution is `hex + hex`
- Check if the challenge HTML still contains `Please wait for verification`
- Check if the pattern `\("([0-9a-f]+)"\)` still matches
- Fix: update `fetchRedditPage()` in `worker/index.js`

**All subreddits return 0 members (weekly stats still work):**
- Reddit blocked `about.json` from Cloudflare edge IPs
- The Worker already has a fallback: retry with session cookies from the challenge
- If both fail, Reddit may now require a full browser session for `about.json`
- Fix: find where member count appears in the HTML and parse it there, or use a different Reddit endpoint

**Specific subreddits return 0s (others work fine):**
- Likely a subreddit name casing issue — Reddit renamed or changed canonical casing
- Visit `reddit.com/r/<name>` in a browser and check the URL after redirect
- Fix: update the subreddit's `name` field in `subreddits.json` with the canonical name

**An entire category fails but others work:**
- Check the subreddit names in that category's section of `subreddits.json`
- A subreddit may have been renamed, gone private, or been deleted
- Fix: update or remove the broken subreddit entry in `subreddits.json`

**All stats return 0 for all subreddits:**
- The Worker itself may be down or misconfigured
- Test directly: `curl "https://reddit-stats-proxy.<subdomain>.workers.dev?sub=ClaudeCode"`
- If the Worker is responding but returning bad data, Reddit may have deployed a new bot-detection system entirely
- Fix: investigate what Reddit now serves to the Worker (add temporary debug logging to `worker/index.js`, deploy, and check)

### Step 3: Debug the Worker

Add temporary debug output to see what Reddit is serving:

```javascript
// In worker/index.js, inside the fetch handler, before fetchSubredditStats:
if (url.searchParams.get('debug')) {
  const html = await fetchRedditPage(sub);
  return new Response(html.substring(0, 5000), {
    headers: { 'Content-Type': 'text/plain' },
  });
}
```

Deploy and test:

```bash
cd worker && npx wrangler deploy
curl "https://reddit-stats-proxy.<subdomain>.workers.dev?sub=ClaudeCode&debug=1"
```

Look for:
- `Please wait for verification` — challenge page (normal, should be solved automatically)
- `<shreddit-subreddit-header` — the tag with weekly stats (means challenge was solved)
- A CAPTCHA page — Reddit upgraded to real CAPTCHA (needs a new approach)
- An empty or error page — Worker IP may be blocked entirely

### Step 4: Common fixes

| Symptom | Likely cause | Fix location |
|---|---|---|
| Challenge pattern changed | Reddit updated JS challenge | `worker/index.js` → `fetchRedditPage()` |
| No `shreddit-subreddit-header` in HTML | Reddit changed page structure | `worker/index.js` → `parseHeaderTag()` |
| `about.json` returns challenge HTML | IP-level blocking of JSON endpoint | `worker/index.js` → `fetchSubredditStats()` |
| Subreddit redirects to different name | Canonical name changed | `subreddits.json` → subreddit `name` field |
| Worker returns 500 or timeout | Cloudflare Worker issue | Check `wrangler tail` logs |
| CAPTCHA / Turnstile page | Reddit upgraded bot detection | Major rework needed — see below |

### If Reddit deploys real CAPTCHA / Turnstile

This is the nuclear scenario. Options:

1. **Reddit API with OAuth** — Apply for a Reddit app, use OAuth tokens. Rate limited but reliable. Requires approval.
2. **Old Reddit** (`old.reddit.com`) — Sometimes has looser bot detection. Parse the sidebar for subscriber count and check if weekly stats exist anywhere.
3. **Headless browser with CAPTCHA service** — Use a service like 2captcha or CapSolver. Adds cost and complexity.
4. **Accept partial data** — If only weekly stats break but members still work via `about.json`, you could track members-only until a fix is found.

### Redeploying the Worker after fixes

```bash
cd worker
npx wrangler deploy
```

Then test:

```bash
curl "https://reddit-stats-proxy.<subdomain>.workers.dev?sub=ClaudeCode"
```

Expected output:
```json
{"subreddit":"ClaudeCode","members":200000,"weekly_visitors":800000,"weekly_contributions":25000}
```

All three values should be non-zero.
