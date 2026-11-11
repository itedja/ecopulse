export type Lang = 'en' | 'id';

export const T = {
  en: {
    tagline: 'Air, fire and forest, live across Indonesia',
    aqiLabel: 'US AQI · PM2.5',
    cats: { good: 'Good', moderate: 'Moderate', sensitive: 'Unhealthy for sensitive groups', unhealthy: 'Unhealthy', very_unhealthy: 'Very unhealthy', hazardous: 'Hazardous' },
    verdict: {
      good: 'Great air today. Enjoy the outdoors.',
      moderate: 'Air is acceptable. Sensitive people may want shorter outdoor workouts.',
      sensitive: 'Children, older adults and people with asthma should limit long outdoor exertion.',
      unhealthy: 'Skip outdoor sports today.',
      very_unhealthy: 'Avoid outdoor exertion. Keep windows closed.',
      hazardous: 'Stay indoors if you can. Health warning for everyone.',
    },
    cleanest: (from: string, to: string) => `Cleanest window: ${from}–${to}.`,
    exercise: 'Exercise', mask: 'Mask outside', smoke: 'Smoke drift',
    smokeNone: 'None inbound', nearest: (km: number) => `nearest ${km} km`, smokeYes: (n: number) => `${n} fires upwind`,
    smokeCalm: 'Wind too light',
    forecast: 'Next 24 hours', now: 'Now',
    updated: (m: number) => (m < 1 ? 'Updated just now' : m < 60 ? `Updated ${m} min ago` : `Updated ${Math.round(m / 60)} h ago`),
    stations: (n: number) => `${n} station${n === 1 ? '' : 's'}`,
    noData: 'No live reading for this city right now.',
    layers: { air: 'Air', fire: 'Fire', wind: 'Wind', alerts: 'Rain & quakes' },
    tabs: { map: 'Map', news: 'News' },
    news: 'Environmental news', newsEmpty: 'No stories yet. The feed updates every hour.',
    alerts: 'Weather warnings', alertsNone: 'No active BMKG warnings for this province.',
    fires24: (n: number) => `${n} fires within 100 km in 48 h`,
    disclaimer: 'General guidance, not medical advice. Readings are unvalidated.',
    loading: 'Loading live data…',
    city: 'City',
  },
  id: {
    tagline: 'Udara, api, dan hutan — langsung dari seluruh Indonesia',
    aqiLabel: 'AQI AS · PM2.5',
    cats: { good: 'Baik', moderate: 'Sedang', sensitive: 'Tidak sehat bagi kelompok rentan', unhealthy: 'Tidak sehat', very_unhealthy: 'Sangat tidak sehat', hazardous: 'Berbahaya' },
    verdict: {
      good: 'Udara bagus hari ini. Nikmati waktu di luar.',
      moderate: 'Udara cukup baik. Kelompok rentan sebaiknya mempersingkat olahraga di luar.',
      sensitive: 'Anak-anak, lansia, dan penderita asma sebaiknya membatasi aktivitas berat di luar.',
      unhealthy: 'Hindari olahraga di luar hari ini.',
      very_unhealthy: 'Hindari aktivitas berat di luar. Tutup jendela.',
      hazardous: 'Sebisa mungkin tetap di dalam. Peringatan kesehatan untuk semua.',
    },
    cleanest: (from: string, to: string) => `Udara paling bersih: ${from}–${to}.`,
    exercise: 'Olahraga', mask: 'Masker di luar', smoke: 'Arah asap',
    smokeNone: 'Tidak menuju ke sini', nearest: (km: number) => `terdekat ${km} km`, smokeYes: (n: number) => `${n} titik api di hulu angin`,
    smokeCalm: 'Angin terlalu lemah',
    forecast: '24 jam ke depan', now: 'Kini',
    updated: (m: number) => (m < 1 ? 'Baru diperbarui' : m < 60 ? `Diperbarui ${m} menit lalu` : `Diperbarui ${Math.round(m / 60)} jam lalu`),
    stations: (n: number) => `${n} stasiun`,
    noData: 'Belum ada data langsung untuk kota ini.',
    layers: { air: 'Udara', fire: 'Api', wind: 'Angin', alerts: 'Hujan & gempa' },
    tabs: { map: 'Peta', news: 'Berita' },
    news: 'Berita lingkungan', newsEmpty: 'Belum ada berita. Diperbarui setiap jam.',
    alerts: 'Peringatan cuaca', alertsNone: 'Tidak ada peringatan BMKG aktif untuk provinsi ini.',
    fires24: (n: number) => `${n} titik api dalam radius 100 km (48 jam)`,
    disclaimer: 'Panduan umum, bukan nasihat medis. Data belum divalidasi.',
    loading: 'Memuat data langsung…',
    city: 'Kota',
  },
} as const;

// Indonesia has three time zones; each featured city uses its own.
const WITA = new Set(['banjarmasin', 'samarinda', 'balikpapan', 'denpasar', 'makassar']);
const WIT = new Set(['jayapura']);
export function cityTimeZone(slug: string): { tz: string; label: string } {
  if (WIT.has(slug)) return { tz: 'Asia/Jayapura', label: 'WIT' };
  if (WITA.has(slug)) return { tz: 'Asia/Makassar', label: 'WITA' };
  return { tz: 'Asia/Jakarta', label: 'WIB' };
}

export function hhmm(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
}
