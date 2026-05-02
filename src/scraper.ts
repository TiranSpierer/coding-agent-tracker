import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

type SubredditEntry = { name: string; label: string; color: string };
type Category = { id: string; name: string; description: string; subreddits: SubredditEntry[] };
type Config = { categories: Category[] };

type SubredditStats = {
  subreddit: string;
  members: number;
  weekly_visitors: number;
  weekly_contributions: number;
};

const CONFIG_PATH = path.resolve(__dirname, '..', 'subreddits.json');
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const WORKER_URL = process.env.REDDIT_PROXY_URL || 'http://localhost:8787';
const HEADER = 'date,time_utc,subreddit,members,weekly_visitors,weekly_contributions';

function loadConfig(): Config {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function getCsvPath(categoryId: string): string {
  return path.resolve(DATA_DIR, `${categoryId}.csv`);
}

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
  const config = loadConfig();
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toISOString().split('T')[1].split('.')[0];

  // Flatten all subreddits across categories (deduped)
  const allSubNames = new Set<string>();
  for (const cat of config.categories) {
    for (const sub of cat.subreddits) allSubNames.add(sub.name);
  }

  const allSubs = [...allSubNames];
  console.log(`[${date} ${time} UTC] Fetching stats for ${allSubs.length} subreddits across ${config.categories.length} categories via worker...`);

  // Fetch all in parallel
  const resultsMap = new Map<string, SubredditStats>();
  const fetchResults = await Promise.all(
    allSubs.map(async (sub) => {
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

  for (const r of fetchResults) resultsMap.set(r.subreddit, r);

  // Retry with exponential backoff: 2min, 4min, 8min
  const RETRY_DELAYS = [2 * 60, 4 * 60, 8 * 60];
  let needsRetry = fetchResults.filter(r =>
    r.members === 0 || r.weekly_visitors === 0 || r.weekly_contributions === 0
  );

  for (let attempt = 0; attempt < RETRY_DELAYS.length && needsRetry.length > 0; attempt++) {
    const delaySec = RETRY_DELAYS[attempt];
    console.log(`\nRetry ${attempt + 1}/${RETRY_DELAYS.length}: waiting ${delaySec / 60}min before retrying ${needsRetry.length} subreddit(s)...`);
    await new Promise(r => setTimeout(r, delaySec * 1000));

    for (const entry of needsRetry) {
      try {
        const stats = await fetchSubredditStats(entry.subreddit);
        const fixed = (entry.members === 0 && stats.members > 0) ||
          (entry.weekly_visitors === 0 && stats.weekly_visitors > 0) ||
          (entry.weekly_contributions === 0 && stats.weekly_contributions > 0);
        if (fixed) {
          if (stats.members > 0) entry.members = stats.members;
          if (stats.weekly_visitors > 0) entry.weekly_visitors = stats.weekly_visitors;
          if (stats.weekly_contributions > 0) entry.weekly_contributions = stats.weekly_contributions;
          resultsMap.set(entry.subreddit, entry);
          console.log(`  ✓ r/${entry.subreddit}: members=${entry.members} visitors=${entry.weekly_visitors} contributions=${entry.weekly_contributions}`);
        } else {
          console.log(`  ⚠ r/${entry.subreddit}: still has zeros`);
        }
      } catch (err) {
        console.log(`  ✗ r/${entry.subreddit}: ${err}`);
      }
    }

    needsRetry = needsRetry.filter(r =>
      r.members === 0 || r.weekly_visitors === 0 || r.weekly_contributions === 0
    );
  }

  if (needsRetry.length > 0) {
    console.log(`\n⚠ ${needsRetry.length} subreddit(s) still have zeros after all retries:`);
    needsRetry.forEach(r => console.log(`  - r/${r.subreddit}: members=${r.members} visitors=${r.weekly_visitors} contributions=${r.weekly_contributions}`));
  }

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Process each category independently
  const failedCategories: string[] = [];

  for (const category of config.categories) {
    console.log(`\n─── ${category.name} ───`);

    const catResults = category.subreddits
      .map(s => resultsMap.get(s.name))
      .filter((r): r is SubredditStats => r !== undefined);

    // Validate: any zero stats = category failure
    const broken = catResults.filter(r => r.members === 0 || r.weekly_visitors === 0 || r.weekly_contributions === 0);
    if (broken.length > 0) {
      console.error(`✗ ${broken.length} subreddit(s) have zero stats:`);
      broken.forEach(r => console.error(`  - r/${r.subreddit}: members=${r.members} visitors=${r.weekly_visitors} contributions=${r.weekly_contributions}`));
      failedCategories.push(category.id);
      continue;
    }

    // Dedup check against this category's CSV
    const csvPath = getCsvPath(category.id);
    const lastBatch = getLastBatch(csvPath);

    if (lastBatch.size > 0) {
      const hasNewSubs = catResults.some(r => !lastBatch.has(r.subreddit));
      const allChanged = catResults.every(r => {
        const prev = lastBatch.get(r.subreddit);
        if (!prev) return true;
        return prev.weekly_visitors !== r.weekly_visitors || prev.weekly_contributions !== r.weekly_contributions;
      });

      if (!hasNewSubs && !allChanged) {
        console.log('⏭ Weekly stats unchanged — skipping CSV write.');
        continue;
      }
      if (hasNewSubs) console.log('🆕 New subreddit(s) detected — appending batch.');
      else console.log('📊 Weekly stats changed — appending new batch.');
    }

    const sorted = catResults.sort((a, b) => b.weekly_visitors - a.weekly_visitors);

    sorted.forEach(({ subreddit, members, weekly_visitors, weekly_contributions }, i) => {
      console.log(
        `  #${i + 1} r/${subreddit.padEnd(20)} members: ${String(members).padStart(7)} | weekly_visitors: ${String(weekly_visitors).padStart(7)} | weekly_contributions: ${String(weekly_contributions).padStart(6)}`
      );
    });

    const newRows = sorted.map(({ subreddit, members, weekly_visitors, weekly_contributions }) =>
      `${date},${time},${subreddit},${members},${weekly_visitors},${weekly_contributions}`
    );

    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, [HEADER, ...newRows].join('\n') + '\n');
    } else {
      fs.appendFileSync(csvPath, newRows.join('\n') + '\n');
    }

    console.log(`✓ Stats appended to ${csvPath}`);
  }

  if (failedCategories.length > 0) {
    console.error(`\n✗ ERROR: Failed categories: ${failedCategories.join(', ')}`);
    console.error('Reddit likely changed their challenge or blocked the Worker. See docs/TROUBLESHOOTING.md');
    process.exit(1);
  }

  console.log('\n✓ All categories processed successfully.');
}

main();
