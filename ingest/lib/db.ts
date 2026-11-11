import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';

let client: SupabaseClient | null = null;

// Server client: uses the service_role key, so it can write to every table.
// Never use this key in the website.
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// Upsert in chunks so one run never sends a request that is too large.
export async function upsertChunked<T extends object>(
  table: string,
  rows: T[],
  onConflict: string,
  opts: { ignoreDuplicates?: boolean; chunk?: number } = {},
): Promise<number> {
  const size = opts.chunk ?? 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const { error } = await db()
      .from(table)
      .upsert(part, { onConflict, ignoreDuplicates: opts.ignoreDuplicates ?? false });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    written += part.length;
  }
  return written;
}
