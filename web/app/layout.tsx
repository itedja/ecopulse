import type { Metadata, Viewport } from 'next';
import './globals.css';
import RegisterSW from '@/components/RegisterSW';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ecopulseindonesia.com'),
  title: 'EcoPulse Indonesia: udara, api, dan hutan secara langsung',
  description: 'Kualitas udara, titik api, kehilangan hutan, peringatan cuaca, dan laporan warga di seluruh Indonesia. Gratis dan otomatis.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'EcoPulse', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#0E1116', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}<RegisterSW /></body>
    </html>
  );
}
