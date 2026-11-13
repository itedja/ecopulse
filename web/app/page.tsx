import type { Metadata } from 'next';
import Landing from '@/components/Landing';
import './landing.css';

export const metadata: Metadata = {
  title: 'EcoPulse Indonesia: udara, api, dan hutan Indonesia secara langsung',
  description: 'Peta langsung titik api, kualitas udara, dan kehilangan hutan di seluruh Indonesia. Udara diperbarui tiap 15 menit, titik api tiap 3 jam. Gratis, tanpa iklan.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'EcoPulse Indonesia',
    description: 'Udara, api, dan hutan Indonesia secara langsung. Gratis, tanpa iklan.',
    type: 'website', locale: 'id_ID', siteName: 'EcoPulse Indonesia', url: '/',
  },
};

// The installed app (home-screen icon) always opens on the map, never on this page.
// Runs before anything is drawn, so there's no flash of the landing page.
const OPEN_MAP_IF_INSTALLED = `try{if((window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true){location.replace('/app'+location.search)}}catch(e){}`;

// Tells Google the site's name, so results show "EcoPulse Indonesia" instead of the bare domain.
const SITE_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'EcoPulse Indonesia',
  alternateName: ['EcoPulse', 'ecopulseindonesia.com'],
  url: 'https://www.ecopulseindonesia.com/',
});

export default function Home() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: OPEN_MAP_IF_INSTALLED }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: SITE_JSON_LD }} />
      <Landing />
    </>
  );
}
