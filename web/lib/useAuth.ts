'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured, type MyProfile } from './supabase';

// Signed-in state + the person's own profile (points, rank, their reports).
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [ready, setReady] = useState(false);

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

  const signIn = useCallback(async () => {
    // Come back to the same page (and tab) after Google.
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/?tab=reports' } });
  }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null); }, []);

  return { session, userId: session?.user.id ?? null, profile, ready, signIn, signOut, reloadProfile };
}
