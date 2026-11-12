'use client';
import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { T, type Lang } from '@/lib/i18n';
import { KINDS, errorCode, getPosition, preparePhoto, type Kind } from '@/lib/community';

type Props = { lang: Lang; userId: string; initialKind?: Kind | null; onDone: () => void; onCancel: () => void };

export default function ReportForm({ lang, userId, initialKind, onDone, onCancel }: Props) {
  const t = T[lang].rep;
  const [kind, setKind] = useState<Kind | null>(initialKind ?? null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; hash: string; url: string } | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function locate() {
    setLocating(true); setError(null);
    try { setPos(await getPosition()); } catch (e) { setError(t.errors[errorCode(e)]); } finally { setLocating(false); }
  }

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      const p = await preparePhoto(f);
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ ...p, url: URL.createObjectURL(p.blob) });
    } catch { setError(t.errors.generic); }
  }

  async function submit() {
    if (!kind || !pos) return;
    setBusy(true); setError(null);
    try {
      let path: string | null = null;
      if (photo) {
        path = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from('report-uploads').upload(path, photo.blob, { contentType: 'image/jpeg' });
        if (upErr) throw new Error('bad_photo_path');
      }
      const { error: rpcErr } = await supabase.rpc('submit_report', {
        p_kind: kind, p_title: title, p_description: desc || null, p_lat: pos.lat, p_lon: pos.lon,
        p_accuracy_m: pos.accuracy, p_upload_path: path, p_photo_hash: photo?.hash ?? null, p_anonymous: anon,
      });
      if (rpcErr) throw rpcErr;
      onDone();
    } catch (e) {
      setError(t.errors[errorCode(e)]);
    } finally { setBusy(false); }
  }

  const ready = kind && title.trim().length >= 3 && pos && !busy;

  return (
    <section className="card report-form" aria-label={t.formTitle}>
      <h2 className="report-form-title">{t.formTitle}</h2>

      <fieldset className="field">
        <legend className="label">{t.kind}</legend>
        <div className="kind-grid">
          {KINDS.map((k) => (
            <button key={k} type="button" className="kind" aria-pressed={kind === k} onClick={() => setKind(k)}>{t.kinds[k]}</button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="label">{t.title}</span>
        <input className="input" value={title} maxLength={120} placeholder={t.titlePh} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="field">
        <span className="label">{t.desc}</span>
        <textarea className="input" rows={3} value={desc} maxLength={1000} placeholder={t.descPh} onChange={(e) => setDesc(e.target.value)} />
      </label>

      <div className="field">
        <span className="label">{t.photo}</span>
        {photo ? (
          <div className="photo-row">
            <img src={photo.url} alt="" className="photo-preview" />
            <button type="button" className="btn-outline slim" onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null); }}>{t.photoRemove}</button>
          </div>
        ) : (
          <button type="button" className="btn-outline" onClick={() => fileRef.current?.click()}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
            {t.photoAdd}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
        <span className="small muted">{t.photoHint}</span>
      </div>

      <div className="field">
        <span className="label">{t.where}</span>
        <button type="button" className={pos ? 'btn-outline done' : 'btn-outline'} onClick={locate} disabled={locating}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
          {locating ? t.locating : t.locate}
        </button>
        {pos && <span className="mono small">{t.located(pos.accuracy)}</span>}
      </div>

      <label className="check">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
        <span>{t.anon}</span>
      </label>

      <p className="small muted rules">{t.rules}</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn-outline" onClick={onCancel}>{t.cancel}</button>
        <button type="button" className="btn-ink" onClick={submit} disabled={!ready}>{busy ? t.sending : t.submit}</button>
      </div>
    </section>
  );
}
