import { db } from './db.ts';

export type JobResult = { rows: number; partial?: string };

// Wraps a job: logs a row in ingestion_runs, records success/failure, and
// sets a non-zero exit code on failure so GitHub marks the run red.
export async function runJob(job: string, fn: () => Promise<JobResult>): Promise<void> {
  const started = Date.now();
  let runId: number | null = null;

  try {
    const { data } = await db().from('ingestion_runs').insert({ job }).select('id').single();
    runId = data?.id ?? null;
  } catch {
    // Logging must never stop the job itself.
  }

  try {
    const result = await fn();
    const status = result.partial ? 'partial' : 'success';
    console.log(`[${job}] ${status}: ${result.rows} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (result.partial) console.warn(`[${job}] warnings: ${result.partial}`);
    if (runId) {
      await db().from('ingestion_runs').update({
        status, finished_at: new Date().toISOString(), rows_upserted: result.rows,
        error: result.partial ?? null,
      }).eq('id', runId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${job}] FAILED: ${message}`);
    if (runId) {
      await db().from('ingestion_runs').update({
        status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 2000),
      }).eq('id', runId);
    }
    process.exitCode = 1;
  }
}
