import type { Metadata } from 'next';
import './aksi.css';

// Members-only: nothing here for search engines to index.
export const metadata: Metadata = {
  title: 'Aksi · EcoPulse Indonesia',
  description: 'Satu aksi kecil untuk lingkungan setiap hari. Ruang anggota EcoPulse Indonesia.',
  alternates: { canonical: '/aksi' },
  robots: { index: false, follow: false },
};

export default function AksiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
