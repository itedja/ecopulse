'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured, type MyProfile } from './supabase';
import { isInstalledApp, startHandoff, pendingCode, clearPending } from './handoff';

const CLAIM_EVERY_MS = 2_500;

// Signed-in state + the person's own profile (points, rank, their reports).
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);   // installed app waiting for the browser sign-in

  const reloadProfile = useCallback(async () => {
    const { data } = await supabase.rpc('my_profile');
    setProfile((data as MyProfile | null) ?? null);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) reloadProfile(); else setProfile(null);
  }, [session, reloadProfile]);

  // Installed app: collect the sign-in the browser sheet left for us (checks while the app is open,
  // and straight away when the person comes back to it).
  useEffect(() => {
    if (!ready || session || !supabaseConfigured) { if (session) { clearPending(); setWaiting(false); } return; }
    let busy = false;
    const claim = async () => {
      const code = pendingCode();
      setWaiting(!!code);
      if (!code || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const { data } = await supabase.rpc('claim_handoff', { p_code: code });
        if (typeof data === 'string' && data) {
          clearPending();
          const { error } = await supabase.auth.refreshSession({ refresh_token: data });
          if (error) console.warn('handoff sign-in failed', error.message);
          setWaiting(false);
        }
      } finally { busy = false; }
    };
    claim();
    const id = setInterval(claim, CLAIM_EVERY_MS);
    const onShow = () => { if (document.visibilityState === 'visible') claim(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow); };
  }, [ready, session]);

  const signIn = useCallback(async () => {
    if (isInstalledApp()) { setWaiting(true); await startHandoff(); return; }
    // Normal browser: come back to the same page (and tab) after Google.
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/?tab=reports' } });
  }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null); }, []);
  const cancelWaiting = useCallback(() => { clearPending(); setWaiting(false); }, []);

  return { session, userId: session?.user.id ?? null, profile, ready, signIn, signOut, reloadProfile, waiting, cancelWaiting };
}
