import type { Metadata } from 'next';
import Landing from '@/components/Landing';
import './landing.css';

export const metadata: Metadata = {
  title: 'EcoPulse Indonesia: udara, api, dan hutan Indonesia secara langsung',
  description: 'Lihat titik api, kualitas udara, dan kehilangan hutan di seluruh Indonesia, diperbarui setiap 15 menit. Aplikasi gratis, tanpa iklan.',
  openGraph: {
    title: 'EcoPulse Indonesia',
    description: 'Udara, api, dan hutan Indonesia secara langsung. Gratis, tanpa iklan.',
    type: 'website', locale: 'id_ID',
  },
};

// The installed app (home-screen icon) always opens on the map, never on this page.
// Runs before anything is drawn, so there's no flash of the landing page.
const OPEN_MAP_IF_INSTALLED = `try{if((window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true){location.replace('/app'+location.search)}}catch(e){}`;

export default function Home() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: OPEN_MAP_IF_INSTALLED }} />
      <Landing />
    </>
  );
}
