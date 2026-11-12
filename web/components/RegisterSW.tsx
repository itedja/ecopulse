'use client';
import { useEffect } from 'react';

// Registers the tiny service worker that makes EcoPulse installable and shows an offline page.
export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
