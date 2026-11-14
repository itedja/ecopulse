import type { Metadata } from 'next';
import StoryPage from '@/components/StoryPage';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Berita · EcoPulse Indonesia',
  description: 'Ringkasan berita lingkungan Indonesia, dengan tautan ke artikel lengkap di situs penerbitnya.',
  robots: { index: false },   // the article belongs to its publisher; search engines should index theirs
};

export default function News() {
  return <StoryPage />;
}
