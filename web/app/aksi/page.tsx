'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { rememberReturn } from '@/lib/returnTo';
import { preparePhoto, rankProgress } from '@/lib/community';
import { T } from '@/lib/i18n';
import { A, REACTIONS, FLAG_REASONS, aksiError, noteFor, toggleReaction, ago, weekDots,
  type ALang, type Profile, type FeedPost, type PostDetail, type Me, type MyPost, type Reaction, type FlagReason } from '@/lib/aksi';

const PAGE = 12;

// Photos live in a members-only bucket, so each one needs a short-lived signed link.
function usePhotos() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const need = useCallback(async (paths: (string | null)[]) => {
    const fresh = paths.filter((p): p is string => !!p && !asked.current.has(p));
    if (!fresh.length) return;
    fresh.forEach((p) => asked.current.add(p));
    const { data } = await supabase.storage.from('aksi-photos').createSignedUrls(fresh, 3600);
    if (!data) return;
    setUrls((u) => { const n = { ...u }; for (const d of data) if (d.path && d.signedUrl) n[d.path] = d.signedUrl; return n; });
  }, []);
  return { urls, need };
}

const Flame = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4 5 5.5 5 10.5A5.2 5.2 0 0 1 12 18a5.2 5.2 0 0 1-5-5.5c0-1.8.8-3.2 2-4.5.3 1.6 1 2.4 2 3 0-3 .2-6 1-9Z" /><path d="M6 21h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
);

export default function AksiPage() {
  const auth = useAuth();
  const [lang, setLang] = useState<ALang>('id');
  const [me, setMe] = useState<Me | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [view, setView] = useState<'feed' | 'me'>('feed');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const photos = usePhotos();
  const t = A[lang];

  useEffect(() => { try { const l = localStorage.getItem('ep.lang'); if (l === 'en' || l === 'id') setLang(l); } catch { /* private mode */ } }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);

  const loadMe = useCallback(async () => {
    const { data } = await supabase.rpc('aksi_me');
    const m = (data as Me | null) ?? { member: false };
    setMe(m); setMeReady(true);
    if (m.member && m.lang) setLang(m.lang);          // the language chosen when joining wins here
    photos.need((m.posts ?? []).map((p) => p.photo_path));
  }, [photos.need]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFeed = useCallback(async (before: string | null) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('aksi_feed', { p_before: before, p_limit: PAGE });
    setLoading(false);
    if (error) return;
    const rows = (data as FeedPost[]) ?? [];
    setPosts((cur) => (before ? [...cur, ...rows] : rows));
    setMore(rows.length === PAGE);
    photos.need(rows.map((r) => r.photo_path));
  }, [photos.need]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!auth.ready) return;
    if (!auth.session) { setMe(null); setMeReady(true); setPosts([]); return; }
    setMeReady(false); loadMe();
  }, [auth.ready, auth.session, loadMe]);
  useEffect(() => { if (me?.member) loadFeed(null); }, [me?.member, loadFeed]);

  const react = async (id: string, kind: Reaction) => {
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    const on = !p.my_reactions.includes(kind);
    setPosts((cur) => cur.map((x) => (x.id === id ? toggleReaction(x, kind) : x)));
    const { error } = await supabase.rpc('aksi_react', { p_post: id, p_kind: kind, p_on: on });
    if (error) setPosts((cur) => cur.map((x) => (x.id === id ? toggleReaction(x, kind) : x)));   // put it back
  };

  const signIn = () => { rememberReturn('/aksi'); auth.signIn('/aksi'); };

  const stage = !auth.ready || !meReady ? 'loading' : !auth.session ? 'locked' : !me?.member ? 'join' : 'in';

  return (
    <div className="ak">
      <header className="ak-top">
        <a className="ak-back" href="/app"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>{t.back}</a>
        <div className="ak-title"><b>Aksi</b><span>{t.tag}</span></div>
        {stage === 'in' && (
          <button className="ak-streak" onClick={() => setView('me')} aria-label={t.streak(me?.streak ?? 0)}><Flame />{me?.streak ?? 0}</button>
        )}
      </header>

      {stage === 'loading' && <p className="ak-center muted" role="status">{t.loading}</p>}

      {stage === 'locked' && (
        <main className="ak-gate">
          <p className="ak-tag">{t.tag}</p>
          <h1>{t.lockedTitle}</h1>
          <p>{t.lockedBody}</p>
          <button className="btn-ink full" onClick={signIn}>{t.signIn}</button>
          {auth.waiting && <p className="small muted" role="status">{t.signInWaiting}</p>}
          <p className="small muted">{t.adultsNote}</p>
          <div className="lang ak-lang" role="group" aria-label={t.langPick}>
            <button aria-pressed={lang === 'id'} onClick={() => setLang('id')}>ID</button>
            <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          </div>
        </main>
      )}

      {stage === 'join' && <Join lang={lang} setLang={setLang} onJoined={loadMe} onSignOut={auth.signOut} />}

      {stage === 'in' && me && (
        <>
          <div className="seg ak-tabs" role="group" aria-label="Aksi">
            <button aria-pressed={view === 'feed'} onClick={() => setView('feed')}>{t.feed}</button>
            <button aria-pressed={view === 'me'} onClick={() => setView('me')}>{t.me}</button>
          </div>
          {notice && <p className="ak-notice" role="status">{notice}</p>}

          {view === 'feed' && (
            <main className="ak-feed">
              {!loading && posts.length === 0 && <><p className="ak-center muted">{t.empty}</p><p className="ak-ideas">{t.ideas}</p></>}
              {posts.map((p) => (
                <article key={p.id} className="ak-post">
                  <header>
                    <span className="ak-avatar" aria-hidden="true">{p.nickname.slice(0, 1).toUpperCase()}</span>
                    <div><button className="ak-name" onClick={() => (p.mine ? setView('me') : setWho(p.nickname))}>{p.mine ? t.you : p.nickname}</button><span className="small muted">{T[lang].rep.ranks[p.rank_key as keyof typeof T.en.rep.ranks] ?? ''} · {ago(p.approved_at, now, lang)}</span></div>
                    {p.streak > 0 && <span className="ak-chip" title={t.streak(p.streak)}><Flame />{p.streak}</span>}
                  </header>
                  <button className="ak-photo" onClick={() => setOpenId(p.id)} aria-label={t.comments(p.comments)}>
                    {p.photo_path && photos.urls[p.photo_path] ? <img src={photos.urls[p.photo_path]} alt={p.caption ?? ''} loading="lazy" /> : <span className="ak-ph" />}
                  </button>
                  {p.caption && <p className="ak-caption">{p.caption}</p>}
                  <Reactions lang={lang} post={p} onReact={(k) => react(p.id, k)} />
                  <button className="link-btn ak-comments" onClick={() => setOpenId(p.id)}>{t.comments(p.comments)}</button>
                </article>
              ))}
              {loading && <p className="ak-center muted" role="status">{t.loading}</p>}
              {more && !loading && <button className="btn-outline" onClick={() => loadFeed(posts[posts.length - 1]?.approved_at ?? null)}>{t.more}</button>}
            </main>
          )}

          {view === 'me' && (
            <MePanel lang={lang} me={me} now={now} urls={photos.urls} onOpen={setOpenId} onChanged={loadMe} onSignOut={auth.signOut}
              onLang={async (l) => { setLang(l); try { localStorage.setItem('ep.lang', l); } catch { /* private mode */ } await supabase.rpc('aksi_set_lang', { p_lang: l }); }} />
          )}

          <button className="ak-fab" onClick={() => setComposing(true)}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>{t.newPost}
          </button>

          {composing && auth.userId && (
            <Compose lang={lang} userId={auth.userId} onClose={() => setComposing(false)}
              onSent={() => { setComposing(false); setNotice(t.sent); setView('me'); loadMe(); }} />
          )}
          {who && !openId && <ProfileSheet lang={lang} nickname={who} now={now} urls={photos.urls} needPhoto={photos.need} onOpen={setOpenId} onClose={() => setWho(null)} />}
          {openId && <PostView lang={lang} id={openId} now={now} urls={photos.urls} needPhoto={photos.need} onClose={() => { setOpenId(null); loadFeed(null); }} />}
        </>
      )}
    </div>
  );
}

function Reactions({ lang, post, onReact }: { lang: ALang; post: { reactions: Partial<Record<Reaction, number>>; my_reactions: Reaction[] }; onReact: (k: Reaction) => void }) {
  const t = A[lang];
  return (
    <div className="ak-reacts" role="group" aria-label={t.comments(0)}>
      {REACTIONS.map((k) => (
        <button key={k} aria-pressed={post.my_reactions.includes(k)} onClick={() => onReact(k)}>
          {t.reactions[k]}{(post.reactions[k] ?? 0) > 0 && <span className="ak-n">{post.reactions[k]}</span>}
        </button>
      ))}
    </div>
  );
}

function Join({ lang, setLang, onJoined, onSignOut }: { lang: ALang; setLang: (l: ALang) => void; onJoined: () => void; onSignOut: () => void }) {
  const t = A[lang];
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function join() {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('aksi_join', { p_adult: adult, p_rules: agree, p_lang: lang });
    setBusy(false);
    if (e) { setError(t.errors[aksiError(e)]); return; }
    try { localStorage.setItem('ep.lang', lang); } catch { /* private mode */ }
    onJoined();
  }
  return (
    <main className="ak-gate ak-join">
      <h1>{t.joinTitle}</h1>
      <div className="field">
        <span className="label">{t.langPick}</span>
        <div className="seg" role="group" aria-label={t.langPick}>
          <button aria-pressed={lang === 'id'} onClick={() => setLang('id')}>Bahasa Indonesia</button>
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
        </div>
      </div>
      <section className="ak-rules" aria-label={t.rulesTitle}>
        <h2>{t.rulesTitle}</h2>
        <ol>{t.rules.map((r) => <li key={r}>{r}</li>)}</ol>
      </section>
      <label className="check"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /><span>{t.adult}</span></label>
      <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{t.agree}</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-ink full" disabled={!adult || !agree || busy} onClick={join}>{busy ? t.joining : t.join}</button>
      <button className="link-btn" onClick={onSignOut}>{t.signOut}</button>
    </main>
  );
}

function Compose({ lang, userId, onClose, onSent }: { lang: ALang; userId: string; onClose: () => void; onSent: () => void }) {
  const t = A[lang];
  const [photo, setPhoto] = useState<{ blob: Blob; hash: string; url: string; source: 'camera' | 'gallery' } | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined, source: 'camera' | 'gallery') {
    if (!f) return;
    setError(null);
    try {
      const p = await preparePhoto(f);      // re-drawn in the browser: hidden GPS and camera data are dropped
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ ...p, url: URL.createObjectURL(p.blob), source });
    } catch { setError(t.errors.generic); }
  }
  async function send() {
    if (!photo) return;
    setBusy(true); setError(null);
    try {
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from('aksi-uploads').upload(path, photo.blob, { contentType: 'image/jpeg' });
      if (upErr) throw new Error('bad_photo_path');
      const { error: e } = await supabase.rpc('aksi_submit', { p_caption: caption || null, p_upload_path: path, p_photo_hash: photo.hash, p_source: photo.source });
      if (e) throw e;
      onSent();
    } catch (e) { setError(t.errors[aksiError(e)]); } finally { setBusy(false); }
  }
  return (
    <div className="ak-modal" role="dialog" aria-modal="true" aria-label={t.newPost}>
      <div className="ak-sheet">
        <h2>{t.newPost}</h2>
        {photo ? (
          <>
            <img className="ak-preview" src={photo.url} alt="" />
            <button className="link-btn" onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null); }}>{t.change}</button>
          </>
        ) : (
          <div className="ak-pick">
            <button className="btn-outline" onClick={() => camRef.current?.click()}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" /></svg>{t.camera}
            </button>
            <button className="btn-outline" onClick={() => galRef.current?.click()}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>{t.gallery}
            </button>
          </div>
        )}
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0], 'camera'); e.target.value = ''; }} />
        <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0], 'gallery'); e.target.value = ''; }} />
        <label className="field">
          <span className="label">{t.caption}</span>
          <textarea className="input" rows={2} maxLength={300} value={caption} placeholder={t.captionPh} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <p className="ak-ideas">{t.ideas}</p>
        <p className="small muted">{t.childReminder}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="btn-outline" onClick={onClose}>{t.cancel}</button>
          <button className="btn-ink" disabled={!photo || busy} onClick={send}>{busy ? t.posting : t.post}</button>
        </div>
      </div>
    </div>
  );
}

function PostView({ lang, id, now, urls, needPhoto, onClose }: { lang: ALang; id: string; now: number; urls: Record<string, string>; needPhoto: (p: (string | null)[]) => void; onClose: () => void }) {
  const t = A[lang];
  const [post, setPost] = useState<PostDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('aksi_post', { p_post: id });
    const p = data as PostDetail | null;
    setPost(p);
    if (p) needPhoto([p.photo_path]);
  }, [id, needPhoto]);
  useEffect(() => { load(); }, [load]);

  async function react(kind: Reaction) {
    if (!post) return;
    const on = !post.my_reactions.includes(kind);
    setPost(toggleReaction(post, kind));
    const { error: e } = await supabase.rpc('aksi_react', { p_post: id, p_kind: kind, p_on: on });
    if (e) load();
  }
  async function send() {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('aksi_comment', { p_post: id, p_body: text });
    setBusy(false);
    if (e) { setError(t.errors[aksiError(e)]); return; }
    setText(''); load();
  }
  async function flag(reason: FlagReason) {
    await supabase.rpc('aksi_flag', { p_post: id, p_comment: null, p_reason: reason });
    setFlagging(false); setFlagged(true);
  }

  return (
    <div className="ak-modal" role="dialog" aria-modal="true" aria-label={post?.caption ?? 'Aksi'}>
      <div className="ak-sheet ak-view">
        <button className="link-btn ak-close" onClick={onClose}>{t.close}</button>
        {!post ? <p className="ak-center muted" role="status">{t.loading}</p> : (
          <>
            <header className="ak-view-head">
              <b>{post.mine ? t.you : post.nickname}</b>
              <span className="small muted">{ago(post.approved_at ?? new Date(now).toISOString(), now, lang)}</span>
              {post.streak > 0 && <span className="ak-chip"><Flame />{post.streak}</span>}
            </header>
            {post.photo_path && urls[post.photo_path] ? <img className="ak-preview" src={urls[post.photo_path]} alt={post.caption ?? ''} /> : <span className="ak-ph" />}
            {post.caption && <p className="ak-caption">{post.caption}</p>}
            <Reactions lang={lang} post={post} onReact={react} />

            <ul className="ak-clist">
              {post.comments.length === 0 && <li className="muted small">{t.noComments}</li>}
              {post.comments.map((c) => (
                <li key={c.id}><b>{c.mine ? t.you : c.nickname}</b> {c.body}{c.status === 'pending' && <span className="small muted"> · {t.commentPending}</span>}</li>
              ))}
            </ul>
            <div className="ak-cbox">
              <input className="input" value={text} maxLength={200} placeholder={t.commentPh} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && !busy) send(); }} />
              <button className="btn-ink" disabled={!text.trim() || busy} onClick={send}>{t.send}</button>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}

            {!post.mine && (flagged ? <p className="small muted" role="status">{t.flagged}</p> : flagging ? (
              <fieldset className="ak-flag">
                <legend className="label">{t.flagTitle}</legend>
                {FLAG_REASONS.map((r) => <button key={r} className="btn-outline slim" onClick={() => flag(r)}>{t.flagReasons[r]}</button>)}
              </fieldset>
            ) : <button className="link-btn" onClick={() => setFlagging(true)}>{t.flag}</button>)}
          </>
        )}
      </div>
    </div>
  );
}

function WeekRow({ lang, days, now }: { lang: ALang; days: string[]; now: number }) {
  const t = A[lang];
  return (
    <ol className="ak-week" aria-label={t.thisWeek}>
      {weekDots(days, now).map((d, i) => (
        <li key={d.date} className={`${d.done ? 'done' : ''}${d.today ? ' today' : ''}${d.future ? ' future' : ''}`}>
          <span className="ak-dot" aria-hidden="true">{d.done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}</span>
          <span className="ak-wd">{t.weekdays[i]}</span>
          <span className="sr-only">{d.date}{d.done ? ' ✓' : ''}</span>
        </li>
      ))}
    </ol>
  );
}

function ProfileHead({ lang, nickname, rankKey, points, streak, total, days, now, children }: { lang: ALang; nickname: string; rankKey: string; points: number; streak: number; total: number; days: string[]; now: number; children?: React.ReactNode }) {
  const t = A[lang];
  const ranks = T[lang].rep.ranks as Record<string, string>;
  const prog = rankProgress(points);
  return (
    <>
      <section className="ak-phead">
        <span className="ak-avatar big" aria-hidden="true">{nickname.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{nickname}</h1>
          <p className="small muted">{ranks[rankKey] ?? ''} · {points} {t.points} · {t.total(total)}</p>
          {children}
        </div>
      </section>
      <div className="ak-prog" aria-hidden="true"><span style={{ width: `${prog.pct}%` }} /></div>
      <p className="small muted ak-progtext">{prog.next ? t.nextRank(prog.toNext, ranks[prog.next] ?? prog.next) : t.topRank}</p>
      <section className="ak-streakcard">
        <p className="ak-big"><Flame />{streak}</p>
        <p className="ak-streaklabel">{streak > 0 ? t.streak(streak) : t.streakNone}</p>
        <WeekRow lang={lang} days={days} now={now} />
        <p className="small">{t.restNote}</p>
      </section>
    </>
  );
}

function PhotoGrid({ lang, posts, urls, onOpen }: { lang: ALang; posts: { id: string; photo_path: string | null; caption: string | null }[]; urls: Record<string, string>; onOpen: (id: string) => void }) {
  const t = A[lang];
  if (!posts.length) return <p className="muted">{t.noPhotos}</p>;
  return (
    <ul className="ak-grid">
      {posts.map((p) => (
        <li key={p.id}><button onClick={() => onOpen(p.id)} aria-label={p.caption ?? 'Aksi'}>
          {p.photo_path && urls[p.photo_path] ? <img src={urls[p.photo_path]} alt="" loading="lazy" /> : <span className="ak-ph" />}
        </button></li>
      ))}
    </ul>
  );
}

function MePanel({ lang, me, now, urls, onOpen, onChanged, onSignOut, onLang }: { lang: ALang; me: Me; now: number; urls: Record<string, string>; onOpen: (id: string) => void; onChanged: () => void; onSignOut: () => void; onLang: (l: ALang) => void }) {
  const t = A[lang];
  const all = me.posts ?? [];
  const shown = all.filter((p) => p.status === 'approved');
  const other = all.filter((p) => p.status !== 'approved');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.nickname ?? '');
  const [error, setError] = useState<string | null>(null);
  async function saveName() {
    setError(null);
    const { error: e } = await supabase.rpc('set_nickname', { p_nickname: name });
    if (e) { setError(e.message.includes('nickname_taken') ? t.nameTaken : e.message.includes('bad_nickname') ? t.nameBad : t.errors.generic); return; }
    setEditing(false); onChanged();
  }
  return (
    <main className="ak-me">
      <ProfileHead lang={lang} nickname={me.nickname ?? ''} rankKey={me.rank_key ?? ''} points={me.points ?? 0} streak={me.streak ?? 0}
        total={me.approved_total ?? 0} days={shown.map((p) => p.action_day)} now={now}>
        {editing ? (
          <div className="ak-nameedit">
            <input className="input" value={name} maxLength={24} aria-label={t.editName} onChange={(e) => setName(e.target.value)} />
            <button className="btn-ink" onClick={saveName}>{t.save}</button>
            <button className="link-btn" onClick={() => { setEditing(false); setError(null); }}>{t.cancel}</button>
            <p className="small muted">{t.nameHint}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        ) : <button className="link-btn" onClick={() => { setName(me.nickname ?? ''); setEditing(true); }}>{t.editName}</button>}
      </ProfileHead>

      <h2>{t.myPosts}</h2>
      <PhotoGrid lang={lang} posts={shown} urls={urls} onOpen={onOpen} />

      {other.length > 0 && (
        <>
          <h2>{t.waiting}</h2>
          <ul className="ak-mine">
            {other.map((p) => <MyPostRow key={p.id} lang={lang} p={p} url={p.photo_path ? urls[p.photo_path] : undefined} onChanged={onChanged} />)}
          </ul>
        </>
      )}

      <h2>{t.settings}</h2>
      <div className="field">
        <span className="label">{t.langPick}</span>
        <div className="seg" role="group" aria-label={t.langPick}>
          <button aria-pressed={lang === 'id'} onClick={() => onLang('id')}>Bahasa Indonesia</button>
          <button aria-pressed={lang === 'en'} onClick={() => onLang('en')}>English</button>
        </div>
      </div>
      <details className="ak-rules">
        <summary>{t.rulesTitle}</summary>
        <ol>{t.rules.map((r) => <li key={r}>{r}</li>)}</ol>
      </details>
      <button className="btn-outline" onClick={onSignOut}>{t.signOut}</button>
    </main>
  );
}

// Another member's profile, opened by tapping their name in the feed.
function ProfileSheet({ lang, nickname, now, urls, needPhoto, onOpen, onClose }: { lang: ALang; nickname: string; now: number; urls: Record<string, string>; needPhoto: (p: (string | null)[]) => void; onOpen: (id: string) => void; onClose: () => void }) {
  const t = A[lang];
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    supabase.rpc('aksi_profile', { p_nickname: nickname }).then(({ data }) => {
      if (!live) return;
      const pr = (data as Profile | null) ?? null;
      setP(pr);
      if (pr) needPhoto(pr.posts.map((x) => x.photo_path));
    });
    return () => { live = false; };
  }, [nickname, needPhoto]);
  return (
    <div className="ak-modal" role="dialog" aria-modal="true" aria-label={`${t.profile}: ${nickname}`}>
      <div className="ak-sheet ak-me">
        <button className="link-btn ak-close" onClick={onClose}>{t.close}</button>
        {p === undefined ? <p className="ak-center muted" role="status">{t.loading}</p> : p === null ? <p className="ak-center muted">{t.notFound}</p> : (
          <>
            <ProfileHead lang={lang} nickname={p.nickname} rankKey={p.rank_key} points={p.points} streak={p.streak} total={p.approved_total} days={p.days} now={now} />
            <PhotoGrid lang={lang} posts={p.posts} urls={urls} onOpen={onOpen} />
          </>
        )}
      </div>
    </div>
  );
}

function MyPostRow({ lang, p, url, onChanged }: { lang: ALang; p: MyPost; url?: string; onChanged: () => void }) {
  const t = A[lang];
  const [appealing, setAppealing] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canAppeal = (p.status === 'rejected' || p.status === 'held') && !p.appeal_status;
  async function appeal() {
    setError(null);
    const { error: e } = await supabase.rpc('aksi_appeal', { p_post: p.id, p_message: msg || null });
    if (e) { setError(t.errors[aksiError(e)]); return; }
    setAppealing(false); onChanged();
  }
  async function remove() {
    if (!window.confirm(t.removeAsk)) return;
    await supabase.rpc('aksi_delete_post', { p_post: p.id });
    onChanged();
  }
  return (
    <li className={`ak-row s-${p.status}`}>
      {url ? <img src={url} alt="" /> : <span className="ak-thumb" aria-hidden="true" />}
      <div>
        <p><b>{t.status[p.status]}</b>{p.caption ? ` · ${p.caption}` : ''}</p>
        {p.status === 'rejected' && p.screening_note && <p className="small">{noteFor(p.screening_note, lang)}</p>}
        {p.appeal_status === 'open' && <p className="small muted">{t.appealOpen}</p>}
        {p.appeal_status === 'denied' && <p className="small muted">{t.appealDenied}</p>}
        {appealing && (
          <div className="ak-appeal">
            <textarea className="input" rows={2} maxLength={500} value={msg} placeholder={t.appealPh} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn-ink" onClick={appeal}>{t.appealSend}</button>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="ak-rowact">
          {canAppeal && !appealing && <button className="link-btn" onClick={() => setAppealing(true)}>{t.appeal}</button>}
          <button className="link-btn" onClick={remove}>{t.remove}</button>
        </p>
      </div>
    </li>
  );
}
