import { test, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SUBREDDITS = [
  'ClaudeCode',
  'Cline',
  'cursor',
  'windsurf',
  'githubcopilot',
  'google_antigravity',
  'codex',
];

const OUTPUT_FILE = path.resolve(__dirname, 'reddit-stats.csv');

const BLOCKED_RESOURCES = ['image', 'stylesheet', 'font', 'media', 'other'];

function parseNumber(val: string | null): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, ''), 10) || 0;
}

async function fetchSubscribers(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  await Promise.all(
    SUBREDDITS.map(async (sub) => {
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/about.json`, {
          headers: { 'User-Agent': 'RedditTracker/1.0' },
        });
        const json = await res.json();
        results[sub] = json?.data?.subscribers ?? 0;
        console.log(`  [API] r/${sub}: ${results[sub]} subscribers`);
      } catch (err) {
        console.log(`  [API] r/${sub} failed: ${err}`);
        results[sub] = 0;
      }
    })
  );
  return results;
}

test('scrape reddit coding agent stats', async () => {
  test.setTimeout(120_000);

  // Get current date in Israel time using formatting (YYYY-MM-DD)
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

  // Fire off all API subscriber calls immediately (these are fine in parallel)
  const membersPromise = fetchSubscribers();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  // Scrape sequentially to avoid Reddit bot detection
  const scraped: { subreddit: string; weekly_visitors: number; weekly_contributions: number }[] = [];

  for (const subreddit of SUBREDDITS) {
    console.log(`\nFetching r/${subreddit}...`);
    
    let weeklyVisitorsVal = 0;
    let weeklyContributionsVal = 0;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      if (attempts > 1) {
        console.log(`  [Retry ${attempts}/${maxAttempts}] Fetching r/${subreddit}...`);
      }
      
      const page = await context.newPage();

      await page.route('**/*', (route) => {
        if (BLOCKED_RESOURCES.includes(route.request().resourceType())) {
          route.abort();
        } else {
          route.continue();
        }
      });

      try {
        await page.goto(`https://www.reddit.com/r/${subreddit}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        await page.waitForSelector('shreddit-subreddit-header', { timeout: 15000 });

        const weeklyVisitorsAttr = await page.getAttribute('shreddit-subreddit-header', 'weekly-active-users');
        const weeklyContributionsAttr = await page.getAttribute('shreddit-subreddit-header', 'weekly-contributions');

        weeklyVisitorsVal = parseNumber(weeklyVisitorsAttr);
        weeklyContributionsVal = parseNumber(weeklyContributionsAttr);

        if (weeklyVisitorsVal > 0 || weeklyContributionsVal > 0) {
          console.log(`  ✓ weekly_visitors: ${weeklyVisitorsAttr || 0} | weekly_contributions: ${weeklyContributionsAttr || 0}`);
          await page.close();
          break;
        } else {
          console.log(`  ⚠ got 0 stats on attempt ${attempts}`);
        }
      } catch (err) {
        console.log(`  ⚠ failed on attempt ${attempts}: ${err}`);
      } finally {
        if (!page.isClosed()) {
          await page.close();
        }
      }

      if (attempts < maxAttempts) {
        // Random delay before retry
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    if (weeklyVisitorsVal === 0 && weeklyContributionsVal === 0) {
      console.log(`  ✗ failed to get stats for r/${subreddit} after ${maxAttempts} attempts`);
    }

    scraped.push({ subreddit, weekly_visitors: weeklyVisitorsVal, weekly_contributions: weeklyContributionsVal });

    // Random delay between requests to avoid bot detection
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  await context.close();
  await browser.close();

  const members = await membersPromise;

  // Sort by visitors descending
  const sorted = scraped.sort((a, b) => b.weekly_visitors - a.weekly_visitors);

  // Print ranking
  console.log('\n======= RANKING =======');
  sorted.forEach(({ subreddit, weekly_visitors, weekly_contributions }, i) => {
    console.log(
      `#${i + 1} r/${subreddit.padEnd(20)} members: ${String(members[subreddit] ?? 0).padStart(7)} | weekly_visitors: ${String(weekly_visitors).padStart(7)} | weekly_contributions: ${String(weekly_contributions).padStart(6)}`
    );
  });

  // Append to CSV
  const csvExists = fs.existsSync(OUTPUT_FILE);
  const needsHeader = !csvExists || fs.statSync(OUTPUT_FILE).size === 0;
  const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });
  if (needsHeader) {
    stream.write('date,subreddit,members,weekly_visitors,weekly_contributions\n');
  }
  for (const { subreddit, weekly_visitors, weekly_contributions } of sorted) {
    stream.write(`${date},${subreddit},${members[subreddit] ?? 0},${weekly_visitors},${weekly_contributions}\n`);
  }
  stream.end();

  console.log(`\n✓ Stats appended to ${OUTPUT_FILE}`);
});
