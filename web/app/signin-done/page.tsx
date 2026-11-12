'use client';
// Google sends the installed app's sign-in here (see lib/handoff.ts).
// - If this page is running inside the installed app itself: sign in directly and open the map.
// - If it's running in a browser sheet: leave the sign-in for the app to collect, then say
//   "go back to the app". The browser itself stays signed out.
import { useEffect, useState } from 'react';
import { sheetClient, pendingCode, clearPending } from '@/lib/handoff';
import { supabase } from '@/lib/supabase';

type State = 'working' | 'done' | 'error';
const TXT = {
  id: { working: 'Menyelesaikan masuk…', done: 'Berhasil masuk', doneSub: 'Tutup jendela ini dan kembali ke aplikasi EcoPulse. Anda akan masuk otomatis dalam beberapa detik.',
    error: 'Masuk tidak berhasil', errorSub: 'Kembali ke aplikasi EcoPulse dan coba lagi. Jika terus gagal, buka ecopulseindonesia.com di Safari dan masuk dari sana.', back: 'Buka EcoPulse' },
  en: { working: 'Finishing sign-in…', done: 'Signed in', doneSub: 'Close this window and go back to the EcoPulse app. You will be signed in automatically in a few seconds.',
    error: 'Sign-in didn’t work', errorSub: 'Go back to the EcoPulse app and try again. If it keeps failing, open ecopulseindonesia.com in Safari and sign in there.', back: 'Open EcoPulse' },
};

export default function SigninDone() {
  const [state, setState] = useState<State>('working');
  const [lang, setLang] = useState<'id' | 'en'>('id');

  useEffect(() => {
    try { if (localStorage.getItem('ep.lang') === 'en') setLang('en'); } catch { /* private mode */ }
    (async () => {
      const code = new URLSearchParams(location.search).get('h');
      const sheet = sheetClient();
      const { data } = await sheet.auth.getSession();   // reads the sign-in Google put in the address
      const s = data.session;
      history.replaceState(null, '', '/signin-done');   // don't leave tokens in the address bar
      if (!code || !s) { setState('error'); return; }
      if (pendingCode() === code) {
        // We are the installed app itself: use the sign-in here.
        clearPending();
        const { error } = await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
        if (error) { setState('error'); return; }
        location.replace('/app?tab=reports');
        return;
      }
      const { error } = await sheet.rpc('put_handoff', { p_code: code, p_refresh_token: s.refresh_token });
      setState(error ? 'error' : 'done');
    })().catch(() => setState('error'));
  }, []);

  const t = TXT[lang];
  return (
    <main className="doc" style={{ textAlign: 'center', paddingTop: 64 }}>
      <span className="brand-mark" aria-hidden="true" style={{ display: 'inline-block' }} />
      {state === 'working' && <h1 style={{ fontSize: 22 }}>{t.working}</h1>}
      {state === 'done' && <><h1 style={{ fontSize: 22 }}>✓ {t.done}</h1><p>{t.doneSub}</p></>}
      {state === 'error' && <><h1 style={{ fontSize: 22 }}>{t.error}</h1><p>{t.errorSub}</p><p><a href="/app?tab=reports">{t.back}</a></p></>}
    </main>
  );
}
