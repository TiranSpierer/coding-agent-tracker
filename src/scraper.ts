import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const SUBREDDITS = [
  'ClaudeCode',
  'CLine',
  'cursor',
  'windsurf',
  'GithubCopilot',
  'google_antigravity',
  'codex',
];

const OUTPUT_FILE = path.resolve(__dirname, '..', 'reddit-stats.csv');
const WORKER_URL = process.env.REDDIT_PROXY_URL || 'http://localhost:8787';
const HEADER = 'date,time_utc,subreddit,members,weekly_visitors,weekly_contributions';

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

function getLastBatch(filePath: string): Map<string, { weekly_visitors: number; weekly_contributions: number }> {
  const last = new Map<string, { weekly_visitors: number; weekly_contributions: number }>();
  if (!fs.existsSync(filePath)) return last;

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  if (lines.length < 2) return last;

  const lastDate = lines[lines.length - 1].split(',')[0];
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    if (parts[0] !== lastDate) continue;
    last.set(parts[2], {
      weekly_visitors: +parts[4],
      weekly_contributions: +parts[5],
    });
  }
  return last;
}

async function main() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toISOString().split('T')[1].split('.')[0];

  console.log(`[${date} ${time} UTC] Fetching stats for ${SUBREDDITS.length} subreddits via worker...`);

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

  // Fail if any subreddit has a zero in any stat
  const broken = results.filter(r => r.members === 0 || r.weekly_visitors === 0 || r.weekly_contributions === 0);
  if (broken.length > 0) {
    console.error(`\n✗ ERROR: ${broken.length} subreddit(s) have zero stats:`);
    broken.forEach(r => console.error(`  - r/${r.subreddit}: members=${r.members} visitors=${r.weekly_visitors} contributions=${r.weekly_contributions}`));
    console.error('\nReddit likely changed their challenge or blocked the Worker. See docs/ARCHITECTURE.md for troubleshooting.');
    process.exit(1);
  }

  // Dedup: only append if ALL subreddits have changed weekly_visitors OR weekly_contributions
  const lastBatch = getLastBatch(OUTPUT_FILE);
  if (lastBatch.size > 0) {
    const allChanged = results.every(r => {
      const prev = lastBatch.get(r.subreddit);
      if (!prev) return true;
      return prev.weekly_visitors !== r.weekly_visitors || prev.weekly_contributions !== r.weekly_contributions;
    });

    if (!allChanged) {
      console.log('\n⏭ Weekly stats unchanged — skipping CSV write.');
      return;
    }
    console.log('\n📊 Weekly stats changed — appending new batch.');
  }

  const sorted = results.sort((a, b) => b.weekly_visitors - a.weekly_visitors);

  console.log('\n======= RANKING =======');
  sorted.forEach(({ subreddit, members, weekly_visitors, weekly_contributions }, i) => {
    console.log(
      `#${i + 1} r/${subreddit.padEnd(20)} members: ${String(members).padStart(7)} | weekly_visitors: ${String(weekly_visitors).padStart(7)} | weekly_contributions: ${String(weekly_contributions).padStart(6)}`
    );
  });

  const newRows = sorted.map(({ subreddit, members, weekly_visitors, weekly_contributions }) =>
    `${date},${time},${subreddit},${members},${weekly_visitors},${weekly_contributions}`
  );

  if (!fs.existsSync(OUTPUT_FILE)) {
    fs.writeFileSync(OUTPUT_FILE, [HEADER, ...newRows].join('\n') + '\n');
  } else {
    fs.appendFileSync(OUTPUT_FILE, newRows.join('\n') + '\n');
  }

  console.log(`\n✓ Stats appended to ${OUTPUT_FILE}`);
}

main();
