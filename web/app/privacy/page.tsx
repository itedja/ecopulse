import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy · EcoPulse Indonesia' };

const CONTACT = 'ecopulseindonesia@gmail.com';

export default function Privacy() {
  return (
    <main className="doc">
      <a href="/" className="doc-back">← EcoPulse</a>
      <h1>Privacy</h1>
      <p className="muted">Last updated 12 November 2026 · <a href="#id">Bahasa Indonesia</a></p>

      <p>EcoPulse Indonesia is a free, non-commercial map of air quality, fires, forest loss and community reports in Indonesia.
        It has no ads, sells nothing and does not sell or share your data.</p>

      <h2>If you only look at the map</h2>
      <p>You do not need an account. We do not use tracking or advertising cookies. Your language and city choice are saved only in your own browser.</p>

      <h2>If you sign in with Google</h2>
      <ul>
        <li><b>What we receive from Google:</b> your email address and a Google account ID, used only to sign you in. They are never shown to anyone.
          We do not receive your Google password, contacts, files or anything else.</li>
        <li><b>What is public:</b> your nickname (random at first, and you can change it), your points and rank, and reports you post
          (unless you choose to hide your nickname on a report).</li>
      </ul>

      <h2>If you post a report or confirm one</h2>
      <ul>
        <li><b>Location:</b> your phone's location is used to place the report and to check you are nearby. The public map only ever shows it
          rounded to about 1 km. The exact location is kept private and used only for these checks.</li>
        <li><b>Photos:</b> before upload, the photo is re-drawn in your browser, which removes hidden data such as GPS position and camera details.
          The original upload is deleted after the check.</li>
        <li><b>Automatic check:</b> report text and photos are checked by an AI service (Anthropic&apos;s Claude) for spam, personal information and
          unsafe content before they are published. Anthropic does not use this data to train its models.</li>
        <li><b>How long:</b> reports disappear from the map after a set time unless people nearby confirm them.</li>
      </ul>

      <h2>Where data is stored</h2>
      <p>Data is stored with Supabase (database and photos, servers in Singapore). The website is hosted by Vercel.</p>

      <h2>Your choices</h2>
      <p>You can sign out at any time. To delete your account and everything linked to it, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        from the email you signed in with. We will delete it within 30 days.</p>

      <h2 id="id">Bahasa Indonesia</h2>
      <p>EcoPulse Indonesia adalah peta gratis dan nonkomersial. Tanpa iklan, dan data Anda tidak dijual atau dibagikan.</p>
      <ul>
        <li>Melihat peta tidak perlu akun dan tidak memakai cookie pelacak atau iklan.</li>
        <li>Jika masuk dengan Google, kami hanya menerima email dan ID akun Google untuk masuk. Keduanya tidak pernah ditampilkan.
          Yang publik hanya nama panggilan, poin, peringkat, dan laporan Anda (nama bisa disembunyikan per laporan).</li>
        <li>Lokasi laporan ditampilkan publik hanya dibulatkan ~1 km. Lokasi persis disimpan privat untuk pengecekan.</li>
        <li>Foto digambar ulang di browser sehingga data tersembunyi (GPS, kamera) terhapus. Teks dan foto diperiksa otomatis oleh AI (Claude dari Anthropic) sebelum dipublikasikan.</li>
        <li>Data disimpan di Supabase (Singapura); situs di-host oleh Vercel.</li>
        <li>Untuk menghapus akun dan semua datanya, kirim email ke <a href={`mailto:${CONTACT}`}>{CONTACT}</a> dari email yang Anda pakai untuk masuk.</li>
      </ul>
    </main>
  );
}
