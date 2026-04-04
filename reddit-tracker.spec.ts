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

const OUTPUT_FILE = path.join(__dirname, 'reddit-stats.csv');

function parseNumber(val: string | null): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, ''), 10) || 0;
}

async function fetchSubscribers(): Promise<Record<string, number>> {
  const members: Record<string, number> = {};
  for (const sub of SUBREDDITS) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/about.json`, {
        headers: { 'User-Agent': 'RedditTracker/1.0' },
      });
      const json = await res.json();
      members[sub] = json?.data?.subscribers ?? 0;
      console.log(`  [API] r/${sub}: ${members[sub]} members`);
    } catch (err) {
      console.log(`  [API] r/${sub} failed: ${err}`);
      members[sub] = 0;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return members;
}

test('scrape reddit coding agent stats', async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const page = await context.newPage();

  const date = new Date().toISOString().split('T')[0];

  // Kick off API fetch in parallel with Playwright scraping
  const membersPromise = fetchSubscribers();

  const results: { subreddit: string; visitors: number; contributions: number }[] = [];

  for (const subreddit of SUBREDDITS) {
    console.log(`\nFetching r/${subreddit}...`);

    try {
      await page.goto(`https://www.reddit.com/r/${subreddit}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForSelector('shreddit-subreddit-header', { timeout: 15000 });

      const visitors = await page.getAttribute('shreddit-subreddit-header', 'weekly-active-users');
      const contributions = await page.getAttribute('shreddit-subreddit-header', 'weekly-contributions');

      results.push({
        subreddit,
        visitors: parseNumber(visitors),
        contributions: parseNumber(contributions),
      });

      console.log(`  ✓ visitors: ${visitors} | contributions: ${contributions}`);
    } catch (err) {
      console.log(`  ✗ failed: ${err}`);
      results.push({ subreddit, visitors: 0, contributions: 0 });
    }

    await page.waitForTimeout(2000);
  }

  await page.close();
  await context.close();
  await browser.close();

  // Wait for API results
  const members = await membersPromise;

  // Sort by visitors descending
  const sorted = results.sort((a, b) => b.visitors - a.visitors);

  // Print ranking
  console.log('\n======= RANKING =======');
  sorted.forEach(({ subreddit, visitors, contributions }, i) => {
    console.log(
      `#${i + 1} r/${subreddit.padEnd(20)} members: ${String(members[subreddit] ?? 0).padStart(7)} | visitors: ${String(visitors).padStart(7)} | contributions: ${String(contributions).padStart(6)}`
    );
  });

  // Append to CSV
  const csvExists = fs.existsSync(OUTPUT_FILE);
  const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });
  if (!csvExists) {
    stream.write('date,subreddit,members,visitors,contributions\n');
  }
  for (const { subreddit, visitors, contributions } of sorted) {
    stream.write(`${date},${subreddit},${members[subreddit] ?? 0},${visitors},${contributions}\n`);
  }
  stream.end();

  console.log(`\n✓ Stats appended to ${OUTPUT_FILE}`);
});
