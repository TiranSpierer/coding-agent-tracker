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

type SubredditStats = { members: number; weekly_visitors: number; weekly_contributions: number };

function parseNumber(val: string | null | undefined): number {
  if (!val) return 0;
  return parseInt(val.replace(/,/g, ''), 10) || 0;
}

function parseNewRedditHeader(html: string): SubredditStats | null {
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

function parseOldRedditSidebar(html: string): number {
  const $ = cheerio.load(html);
  // old.reddit.com sidebar: <span class="subscribers"><span class="number">200,000</span></span>
  const subsText = $('.subscribers .number').first().text();
  return parseNumber(subsText);
}

test('scrape reddit coding agent stats', async () => {
  test.setTimeout(300_000);

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const results: Record<string, SubredditStats> = {};

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    viewport: { width: 1920, height: 1080 },
  });

  // ── Step 1: Warm up session via old.reddit.com (sets cookies, establishes session) ──
  console.log('Step 1: Warming up session via old.reddit.com...');
  const warmupPage = await context.newPage();
  try {
    await warmupPage.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log('  ✓ old.reddit.com loaded, cookies set');
  } catch (err) {
    console.log(`  ⚠ warmup failed: ${err}`);
  } finally {
    await warmupPage.close();
  }

  // ── Step 2: Scrape each subreddit ──
  for (const subreddit of SUBREDDITS) {
    console.log(`\nFetching r/${subreddit}...`);
    if (!results[subreddit]) {
      results[subreddit] = { members: 0, weekly_visitors: 0, weekly_contributions: 0 };
    }

    // 2a: Try old.reddit.com for subscribers (reliable, simple HTML)
    const oldPage = await context.newPage();
    try {
      await oldPage.goto(`https://old.reddit.com/r/${subreddit}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      const members = parseOldRedditSidebar(await oldPage.content());
      if (members > 0) {
        console.log(`  [old] members: ${members}`);
        results[subreddit].members = members;
      } else {
        console.log(`  [old] no subscriber data found`);
      }
    } catch (err) {
      console.log(`  [old] failed: ${err}`);
    } finally {
      await oldPage.close();
    }

    // 2b: Try new Reddit for weekly stats
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (results[subreddit].weekly_visitors > 0) break;
      if (attempt > 1) console.log(`  [new] retry ${attempt}/2...`);

      const newPage = await context.newPage();
      await newPage.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      try {
        await newPage.goto(`https://www.reddit.com/r/${subreddit}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Wait for potential JS challenge redirect, then content
        try {
          await newPage.waitForSelector('shreddit-subreddit-header', { timeout: 25000 });
        } catch {
          // Check if we ended up on a challenge page
          const url = newPage.url();
          if (url.includes('js_challenge') || url.includes('solution=')) {
            console.log(`  [new] JS challenge detected, waiting for resolution...`);
            try {
              await newPage.waitForSelector('shreddit-subreddit-header', { timeout: 15000 });
            } catch {}
          }
        }

        const stats = parseNewRedditHeader(await newPage.content());
        if (stats && (stats.weekly_visitors > 0 || stats.weekly_contributions > 0)) {
          console.log(`  [new] visitors: ${stats.weekly_visitors} | contributions: ${stats.weekly_contributions}`);
          results[subreddit].weekly_visitors = stats.weekly_visitors;
          results[subreddit].weekly_contributions = stats.weekly_contributions;
          if (stats.members > 0 && results[subreddit].members === 0) {
            results[subreddit].members = stats.members;
          }
        } else {
          // Debug: log page title to understand what Reddit returned
          const title = await newPage.title();
          console.log(`  [new] attempt ${attempt}: no stats (page title: "${title}")`);
        }
      } catch (err) {
        console.log(`  [new] attempt ${attempt} error: ${err}`);
      } finally {
        if (!newPage.isClosed()) await newPage.close();
      }

      if (results[subreddit].weekly_visitors === 0 && attempt < 2) {
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
      }
    }

    // 2c: Fallback for subscribers via about.json API
    if (results[subreddit].members === 0) {
      for (const domain of ['old.reddit.com', 'www.reddit.com', 'api.reddit.com']) {
        try {
          const res = await fetch(`https://${domain}/r/${subreddit}/about.json`, {
            headers: { 'User-Agent': BROWSER_UA },
          });
          const json = await res.json();
          const count = json?.data?.subscribers ?? 0;
          if (count > 0) {
            console.log(`  [API ${domain}] members: ${count}`);
            results[subreddit].members = count;
            break;
          }
        } catch {}
      }
    }

    // Brief delay between subreddits
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  await context.close();
  await browser.close();

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
