import { test } from '@playwright/test';
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
const WORKER_URL = process.env.REDDIT_PROXY_URL || 'http://localhost:8787';

type SubredditStats = {
  subreddit: string;
  members: number;
  weekly_visitors: number;
  weekly_contributions: number;
};

async function fetchSubredditStats(sub: string): Promise<SubredditStats> {
  const res = await fetch(`${WORKER_URL}?sub=${sub}`);
  if (!res.ok) throw new Error(`Worker returned ${res.status}`);
  return await res.json() as SubredditStats;
}

test('scrape reddit coding agent stats', async () => {
  test.setTimeout(60_000);

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

  console.log(`Fetching stats for ${SUBREDDITS.length} subreddits via worker...`);

  // Fetch all in parallel
  const results = await Promise.all(
    SUBREDDITS.map(async (sub) => {
      try {
        const stats = await fetchSubredditStats(sub);
        const status = stats.weekly_visitors > 0 ? '✓' : '⚠ (no weekly stats)';
        console.log(`  ${status} r/${sub}: members=${stats.members} visitors=${stats.weekly_visitors} contributions=${stats.weekly_contributions}`);
        return stats;
      } catch (err) {
        console.log(`  ✗ r/${sub}: ${err}`);
        return { subreddit: sub, members: 0, weekly_visitors: 0, weekly_contributions: 0 };
      }
    })
  );

  // Retry any that missed weekly stats (rate limiting can cause failures)
  const needsRetry = results.filter(r => r.weekly_visitors === 0 && r.weekly_contributions === 0);
  if (needsRetry.length > 0) {
    console.log(`\nRetrying ${needsRetry.length} subreddits sequentially...`);
    for (const entry of needsRetry) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const stats = await fetchSubredditStats(entry.subreddit);
        if (stats.weekly_visitors > 0 || stats.weekly_contributions > 0) {
          console.log(`  ✓ r/${entry.subreddit}: visitors=${stats.weekly_visitors} contributions=${stats.weekly_contributions}`);
          entry.weekly_visitors = stats.weekly_visitors;
          entry.weekly_contributions = stats.weekly_contributions;
          if (stats.members > 0) entry.members = stats.members;
        } else {
          console.log(`  ⚠ r/${entry.subreddit}: still no weekly stats`);
        }
      } catch (err) {
        console.log(`  ✗ r/${entry.subreddit}: ${err}`);
      }
    }
  }

  const sorted = results.sort((a, b) => b.weekly_visitors - a.weekly_visitors);

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
