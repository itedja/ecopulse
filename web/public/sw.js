// EcoPulse service worker. Kept deliberately small: it never caches live data (that must always be
// fresh). It only shows a simple offline page when a page can't load because there is no internet.
const OFFLINE = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EcoPulse · offline</title><body style="font-family:system-ui,sans-serif;background:#F4F5F7;color:#0E1116;padding:32px;line-height:1.5">
<h1 style="font-size:22px">Tidak ada koneksi internet</h1><p>EcoPulse membutuhkan internet untuk menampilkan data terbaru. Coba lagi setelah tersambung.</p>
<h2 style="font-size:16px;color:#5B6470">No internet connection</h2><p style="color:#5B6470">EcoPulse needs the internet to show the latest data. Try again once you're connected.</p>
<button onclick="location.reload()" style="min-height:48px;padding:0 20px;border-radius:12px;border:0;background:#0E1116;color:#fff;font-weight:700">Coba lagi / Retry</button></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;   // everything else: the browser's normal behaviour
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
