import type { Metadata, Viewport } from 'next';
import './globals.css';
import RegisterSW from '@/components/RegisterSW';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ecopulseindonesia.com'),
  title: 'EcoPulse Indonesia: udara, api, dan hutan secara langsung',
  description: 'Kualitas udara, titik api, kehilangan hutan, peringatan cuaca, dan laporan warga di seluruh Indonesia. Gratis dan otomatis.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'EcoPulse', statusBarStyle: 'default' },
  // Google search shows a square PNG/ICO most reliably (multiples of 48 px); browsers can use the SVG.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: { siteName: 'EcoPulse Indonesia' },
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
