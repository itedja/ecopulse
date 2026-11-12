import { ImageResponse } from 'next/og';

// The preview card shown when the link is shared on WhatsApp, Instagram, X, LINE, etc.
export const alt = 'EcoPulse Indonesia: udara, api, dan hutan Indonesia secara langsung';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0E1116"/><ellipse cx="13.5" cy="27" rx="10" ry="3.3" transform="rotate(40 13.5 27)" fill="#fff"/><ellipse cx="27.5" cy="41.5" rx="8.5" ry="2.4" transform="rotate(4 27.5 41.5)" fill="#2E9E5B"/><ellipse cx="29" cy="25.5" rx="6" ry="7.2" transform="rotate(-25 29 25.5)" fill="#fff"/><path d="M39.5 22Q44.5 28.5 39.5 36" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none"/><ellipse cx="53" cy="32.5" rx="8" ry="4.1" transform="rotate(-10 53 32.5)" fill="#fff"/></svg>`;
const logoSrc = `data:image/svg+xml;base64,${Buffer.from(LOGO).toString('base64')}`;

export default function OgImage() {
  const chip = (color: string, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#FFFFFF', border: '2px solid #E3E6EA', borderRadius: 40, padding: '12px 24px', fontSize: 28, fontWeight: 600 }}>
      <div style={{ width: 18, height: 18, borderRadius: 9, background: color }} />{label}
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#F4F5F7', padding: 72, color: '#0E1116' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <img src={logoSrc} width={84} height={84} alt="" />
          <div style={{ fontSize: 44, fontWeight: 700 }}>EcoPulse</div>
          <div style={{ fontSize: 34, color: '#5B6470' }}>Indonesia</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2 }}>Udara, api, dan hutan Indonesia. Saat ini juga.</div>
          <div style={{ fontSize: 32, color: '#4B5563' }}>Peta langsung, diperbarui setiap 15 menit. Gratis, tanpa iklan.</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {chip('#D93A2B', 'Kualitas udara')}{chip('#C2410C', 'Titik api')}{chip('#8B5E34', 'Hutan hilang')}{chip('#0F766E', 'Laporan warga')}
        </div>
      </div>
    ),
    size,
  );
}
