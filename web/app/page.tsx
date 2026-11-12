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

export default function Home() {
  return <Landing />;
}
