import { test } from '@playwright/test';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import * as cheerio from 'cheerio';
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

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

type SubredditStats = { members: number; weekly_visitors: number; weekly_contributions: number };

function parseNumber(val: string | null | undefined): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, ''), 10) || 0;
}

function parseHeaderTag(html: string): SubredditStats | null {
  const $ = cheerio.load(html);
  const header = $('shreddit-subreddit-header').first();
  if (!header.length) return null;

  const members = parseNumber(header.attr('subscribers'));
  const weekly_visitors = parseNumber(header.attr('weekly-active-users'));
  const weekly_contributions = parseNumber(header.attr('weekly-contributions'));

  if (members > 0 || weekly_visitors > 0) {
    return { members, weekly_visitors, weekly_contributions };
  }
  return null;
}

/**
 * Strategy 1: Fetch page HTML directly and parse with cheerio.
 * Avoids browser overhead and JS challenges.
 */
async function fetchViaHTML(sub: string): Promise<SubredditStats | null> {
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/`, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    return parseHeaderTag(await res.text());
  } catch (err) {
    console.log(`  [HTML] r/${sub} failed: ${err}`);
    return null;
  }
}

/**
 * Strategy 2: about.json API for subscribers (try old.reddit.com first).
 */
async function fetchSubscribersAPI(sub: string): Promise<number> {
  const urls = [
    `https://old.reddit.com/r/${sub}/about.json`,
    `https://www.reddit.com/r/${sub}/about.json`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
      const json = await res.json();
      const count = json?.data?.subscribers ?? 0;
      if (count > 0) return count;
    } catch {}
  }
  return 0;
}

test('scrape reddit coding agent stats', async () => {
  test.setTimeout(180_000);

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const results: Record<string, SubredditStats> = {};

  // ── Pass 1: fast HTML fetch (no browser) ──
  console.log('Pass 1: HTML fetch...');
  await Promise.all(
    SUBREDDITS.map(async (sub) => {
      const stats = await fetchViaHTML(sub);
      if (stats) {
        console.log(`  ✓ r/${sub}: members=${stats.members} visitors=${stats.weekly_visitors} contributions=${stats.weekly_contributions}`);
        results[sub] = stats;
      } else {
        console.log(`  ✗ r/${sub}: no data from HTML`);
      }
    })
  );

  // ── Pass 2: about.json API for missing subscribers ──
  const missingSubs = SUBREDDITS.filter(s => !results[s] || results[s].members === 0);
  if (missingSubs.length > 0) {
    console.log('\nPass 2: about.json API for missing subscribers...');
    await Promise.all(
      missingSubs.map(async (sub) => {
        const count = await fetchSubscribersAPI(sub);
        if (count > 0) {
          console.log(`  ✓ r/${sub}: ${count} subscribers`);
          if (!results[sub]) results[sub] = { members: 0, weekly_visitors: 0, weekly_contributions: 0 };
          results[sub].members = count;
        }
      })
    );
  }

  // ── Pass 3: Playwright + Stealth for missing weekly stats ──
  const needsBrowser = SUBREDDITS.filter(
    s => !results[s] || (results[s].weekly_visitors === 0 && results[s].weekly_contributions === 0)
  );
  if (needsBrowser.length > 0) {
    console.log(`\nPass 3: Playwright + Stealth for ${needsBrowser.length} subreddits...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      viewport: { width: 1920, height: 1080 },
    });

    for (const subreddit of needsBrowser) {
      console.log(`  Fetching r/${subreddit}...`);
      let success = false;

      for (let attempt = 1; attempt <= 3 && !success; attempt++) {
        if (attempt > 1) console.log(`  [Retry ${attempt}/3] r/${subreddit}...`);

        const page = await context.newPage();
        await page.route('**/*', (route) => {
          const type = route.request().resourceType();
          if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type)) {
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

          // Wait for the header element or timeout
          try {
            await page.waitForSelector('shreddit-subreddit-header', { timeout: 20000 });
          } catch {}

          // Parse whatever HTML we got (works even if selector didn't appear)
          const stats = parseHeaderTag(await page.content());
          if (stats && (stats.weekly_visitors > 0 || stats.weekly_contributions > 0)) {
            console.log(`  ✓ r/${subreddit}: visitors=${stats.weekly_visitors} contributions=${stats.weekly_contributions}`);
            if (!results[subreddit]) results[subreddit] = { members: 0, weekly_visitors: 0, weekly_contributions: 0 };
            results[subreddit].weekly_visitors = stats.weekly_visitors;
            results[subreddit].weekly_contributions = stats.weekly_contributions;
            if (stats.members > 0 && results[subreddit].members === 0) {
              results[subreddit].members = stats.members;
            }
            success = true;
          } else {
            console.log(`  ⚠ attempt ${attempt}: no stats found`);
          }
        } catch (err) {
          console.log(`  ⚠ attempt ${attempt} failed: ${err}`);
        } finally {
          if (!page.isClosed()) await page.close();
        }

        if (!success && attempt < 3) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
      }

      if (!success) console.log(`  ✗ r/${subreddit}: failed after 3 attempts`);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    }

    await context.close();
    await browser.close();
  }

  // ── Build output ──
  const scraped = SUBREDDITS.map(sub => ({
    subreddit: sub,
    ...(results[sub] ?? { members: 0, weekly_visitors: 0, weekly_contributions: 0 }),
  }));

  const sorted = scraped.sort((a, b) => b.weekly_visitors - a.weekly_visitors);

  console.log('\n======= RANKING =======');
  sorted.forEach(({ subreddit, members, weekly_visitors, weekly_contributions }, i) => {
    console.log(
      `#${i + 1} r/${subreddit.padEnd(20)} members: ${String(members).padStart(7)} | weekly_visitors: ${String(weekly_visitors).padStart(7)} | weekly_contributions: ${String(weekly_contributions).padStart(6)}`
    );
  });

  // Write CSV (replace same-date rows)
  const newRows = sorted.map(({ subreddit, members, weekly_visitors, weekly_contributions }) =>
    `${date},${subreddit},${members},${weekly_visitors},${weekly_contributions}`
  );
  const header = 'date,subreddit,members,weekly_visitors,weekly_contributions';
  let existingRows: string[] = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    const lines = fs.readFileSync(OUTPUT_FILE, 'utf-8').split('\n').filter(Boolean);
    existingRows = lines.filter(line => line !== header && !line.startsWith(`${date},`));
  }
  fs.writeFileSync(OUTPUT_FILE, [header, ...existingRows, ...newRows].join('\n') + '\n');

  console.log(`\n✓ Stats appended to ${OUTPUT_FILE}`);
});
