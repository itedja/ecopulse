import type { Metadata } from 'next';
import { SOURCES, KIND_LABEL, type Source } from '@/lib/sources';

export const metadata: Metadata = {
  title: 'Cara kami memeriksa data · EcoPulse Indonesia',
  description: 'Setiap sumber data EcoPulse Indonesia, seberapa sering diperbarui, dan mana yang pengukuran serta mana yang perkiraan.',
  alternates: { canonical: '/data' },
};

const CONTACT = 'ecopulseindonesia@gmail.com';

function Entry({ s, lang }: { s: Source; lang: 'id' | 'en' }) {
  const L = lang === 'id'
    ? { from: 'Sumber', updates: 'Pembaruan', what: 'Apa isinya', ours: 'Yang kami lakukan', limits: 'Batasan' }
    : { from: 'Source', updates: 'Updates', what: 'What it is', ours: 'What we do with it', limits: 'Limits' };
  return (
    <section className="src">
      <h3>{s.title[lang]} <span className={`src-kind k-${s.kind}`}>{KIND_LABEL[s.kind][lang]}</span></h3>
      <dl>
        <dt>{L.from}</dt>
        <dd>{s.from.map((f, i) => (
          <span key={f.url}>{i > 0 && ' · '}{f.url.startsWith('/') ? <a href={f.url}>{f.name}</a> : <a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>}</span>
        ))}</dd>
        <dt>{L.updates}</dt><dd>{s.updates[lang]}</dd>
        <dt>{L.what}</dt><dd>{s.what[lang]}</dd>
        <dt>{L.ours}</dt><dd>{s.ours[lang]}</dd>
        <dt>{L.limits}</dt><dd>{s.limits[lang]}</dd>
      </dl>
    </section>
  );
}

export default function DataPage() {
  return (
    <main className="doc">
      <a href="/" className="doc-back">← EcoPulse</a>
      <h1>Cara kami memeriksa data</h1>
      <p className="muted">Diperbarui 15 November 2026 · <a href="#en">English</a></p>

      <p>EcoPulse Indonesia tidak membuat angka sendiri. Setiap angka di aplikasi berasal dari sumber di bawah ini, dan aplikasi menuliskan sumbernya.
        Halaman ini menjelaskan dari mana tiap data berasal, seberapa sering kami memeriksanya, apa yang kami lakukan terhadapnya, dan apa batasannya.</p>
      <p>Tiap sumber diberi salah satu label: <b>pengukuran</b> (alat di darat), <b>deteksi satelit</b>, <b>perkiraan model</b> (hitungan komputer, bukan pengukuran),
        <b> peringatan resmi</b>, <b>laporan warga</b>, atau <b>berita</b>.</p>

      {SOURCES.map((s) => <Entry key={s.key} s={s} lang="id" />)}

      <h2>Peta dasar</h2>
      <p>Peta © kontributor <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>, disajikan oleh <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>.
        Batas provinsi: CC BY 4.0 (denyherianto).</p>

      <h2>Yang perlu diingat</h2>
      <ul>
        <li>EcoPulse adalah panduan umum, bukan nasihat medis dan bukan sumber resmi pemerintah.</li>
        <li>“Diperiksa tiap 15 menit” berarti kami mengambil data sesering itu. Sumbernya sendiri bisa memperbarui lebih jarang, dan jadwal kami bisa terlambat beberapa menit.</li>
        <li>Menemukan angka yang keliru? Tulis ke <a href={`mailto:${CONTACT}`}>{CONTACT}</a> (Tim EcoPulse Indonesia). Kami akan memeriksanya.</li>
      </ul>

      <h2 id="en">English</h2>
      <p>EcoPulse Indonesia does not make up its own numbers. Every number in the app comes from one of the sources below, and the app names the source.
        This page says where each kind of data comes from, how often we check it, what we do with it, and what its limits are.</p>
      <p>Each source carries one label: <b>measurement</b> (instruments on the ground), <b>satellite detection</b>, <b>model estimate</b> (computer calculation, not a measurement),
        <b> official notice</b>, <b>community report</b>, or <b>news</b>.</p>

      {SOURCES.map((s) => <Entry key={s.key} s={s} lang="en" />)}

      <h2>Base map</h2>
      <p>Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, served by <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>.
        Province borders: CC BY 4.0 (denyherianto).</p>

      <h2>Keep in mind</h2>
      <ul>
        <li>EcoPulse is general guidance, not medical advice and not an official government source.</li>
        <li>“Checked every 15 minutes” means we fetch that often. The source itself may update less often, and our schedule can run a few minutes late.</li>
        <li>Found a number that looks wrong? Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> (Tim EcoPulse Indonesia). We will check it.</li>
      </ul>
    </main>
  );
}
