// Daily housekeeping: deletes old data, expires stale reports, and on Mondays
// builds last week's province leaderboard.
import { isMain } from './lib/main.ts';
import { db } from './lib/db.ts';
import { runJob } from './lib/run.ts';

// Monday of the previous week (UTC), as YYYY-MM-DD.
export function lastWeekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday - 7);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await runJob('maintenance', async () => {
    const { error: pErr } = await db().rpc('purge_old_data');
    if (pErr) throw new Error(`purge_old_data: ${pErr.message}`);

    const { data: expired, error: eErr } = await db().rpc('expire_reports');
    if (eErr) throw new Error(`expire_reports: ${eErr.message}`);

    // Rebuild last week's stats every day (cheap, and self-heals if a Monday run failed).
    const week = lastWeekStart();
    const { error: wErr } = await db().rpc('refresh_province_weekly_stats', { p_week_start: week });
    if (wErr) throw new Error(`weekly stats: ${wErr.message}`);

    console.log(`  purged old rows, expired ${expired ?? 0} reports, rebuilt week of ${week}`);
    return { rows: Number(expired ?? 0) };
  });
}

if (isMain(import.meta.url)) main();
