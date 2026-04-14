import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const SUBREDDIT = 'ClaudeCode';
const OUTPUT_FILE = path.resolve(__dirname, 'weekly-reset-probe.csv');
const WORKER_URL = process.env.REDDIT_PROXY_URL || 'http://localhost:8787';
const HEADER = 'date,time_utc,subreddit,members,weekly_visitors,weekly_contributions';

async function main() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS

  console.log(`[${date} ${time} UTC] Probing r/${SUBREDDIT}...`);

  try {
    const res = await fetch(`${WORKER_URL}?sub=${SUBREDDIT}`);
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    const stats = await res.json() as { subreddit: string; members: number; weekly_visitors: number; weekly_contributions: number };

    console.log(`  members=${stats.members} visitors=${stats.weekly_visitors} contributions=${stats.weekly_contributions}`);

    const row = `${date},${time},${stats.subreddit},${stats.members},${stats.weekly_visitors},${stats.weekly_contributions}`;

    if (!fs.existsSync(OUTPUT_FILE)) {
      fs.writeFileSync(OUTPUT_FILE, HEADER + '\n' + row + '\n');
    } else {
      fs.appendFileSync(OUTPUT_FILE, row + '\n');
    }

    console.log(`Appended to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error(`  Failed: ${err}`);
    process.exit(1);
  }
}

main();
