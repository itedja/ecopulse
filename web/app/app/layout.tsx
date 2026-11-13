import type { Metadata } from 'next';

// The live map gets its own title so it reads as a page of the site in search results,
// not a second copy of the home page.
export const metadata: Metadata = {
  title: 'Peta langsung · EcoPulse Indonesia',
  description: 'Peta kualitas udara, titik api, kehilangan hutan, peringatan cuaca BMKG, dan laporan warga. Pilih kota Anda.',
  alternates: { canonical: '/app' },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
