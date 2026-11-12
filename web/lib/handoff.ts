'use client';
// Sign-in for the installed app (home-screen icon). See supabase/migrations/009_signin_handoff.sql.
//
// The installed app can't receive a Google sign-in directly on iPhone: Google opens in a browser
// sheet with separate storage. So the app makes a one-time code, the sheet signs in and leaves the
// sign-in under that code, and the app collects it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const KEY = 'ep.handoff';            // { code, started } kept by the installed app while it waits
const MAX_AGE_MS = 10 * 60_000;      // same as the database expiry

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'missing';

// A separate client for the sheet: "implicit" sign-in (no stored secret needed, so it works in a
// fresh browser), keeps nothing in storage, never refreshes. Its sign-in is only passed along.
let sheet: SupabaseClient | null = null;
export function sheetClient(): SupabaseClient {
  sheet ??= createClient(url, anon, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: true, storageKey: 'ep-handoff' },
  });
  return sheet;
}

export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function newCode(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function pendingCode(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, started } = JSON.parse(raw) as { code: string; started: number };
    if (Date.now() - started > MAX_AGE_MS) { localStorage.removeItem(KEY); return null; }
    return code;
  } catch { return null; }
}
export function clearPending() { try { localStorage.removeItem(KEY); } catch { /* private mode */ } }

// Installed app: remember a fresh code and open Google sign-in. Google returns to /signin-done.
export async function startHandoff(): Promise<void> {
  const code = newCode();
  try { localStorage.setItem(KEY, JSON.stringify({ code, started: Date.now() })); } catch { /* private mode */ }
  const { data, error } = await sheetClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/signin-done?h=${code}`, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw error ?? new Error('no_url');
  window.location.assign(data.url);
}
