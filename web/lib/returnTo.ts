'use client';
import { supabase } from './supabase';

// After Google sign-in the browser may land on the home page instead of the page the person started
// from. Remember where they were (only pages on this allow-list) and send them back once signed in.
const KEY = 'ep.after';
const ALLOWED = ['/aksi'];
const MAX_AGE_MS = 15 * 60_000;

export function rememberReturn(path: string): void {
  if (!ALLOWED.includes(path)) return;
  try { localStorage.setItem(KEY, JSON.stringify({ path, t: Date.now() })); } catch { /* private mode */ }
}

export function pendingReturn(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { path?: unknown; t?: unknown };
    if (typeof j.path !== 'string' || typeof j.t !== 'number') return null;
    if (!ALLOWED.includes(j.path) || now - j.t > MAX_AGE_MS || now < j.t) return null;
    return j.path;
  } catch { return null; }
}

export async function resumeReturn(): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return; }
  if (!raw) return;
  const path = pendingReturn(raw, Date.now());
  const clear = () => { try { localStorage.removeItem(KEY); } catch { /* private mode */ } };
  if (!path || window.location.pathname === path) { clear(); return; }
  const { data } = await supabase.auth.getSession();
  if (data.session) { clear(); window.location.replace(path); }
}
