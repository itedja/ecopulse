// Landing page: text (Indonesian + English) and the small set of live numbers it shows.
// It uses its own Supabase client that never touches sign-in, so it can't interfere with the
// Google sign-in flow on /app.
import { createClient } from '@supabase/supabase-js';
import type { Lang } from './i18n';
import { latestStories, type Story } from './news';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const liveConfigured = Boolean(url && key);
const db = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export type Place = { en: string; id: string };
export type Live = {
  updatedAt: string | null;
  fires7d: number;
  firesSince: string | null; // set when the fire record is younger than 7 days
  forestAlerts: number;
  reports: number;
  worstAir: (Place & { aqi: number }) | null;
  mostFires: (Place & { n: number }) | null;
  mostForest: (Place & { n: number }) | null;
  firePoints: [number, number][];
  cityPoints: { lon: number; lat: number; aqi: number }[];
  news: Story[];             // the four newest stories
};

type Rank = { name_en: string; name_id: string; fires_7d: number; forest_alerts_7d: number | null; fires_since: string | null };
type Aq = { slug: string; name_en: string; aqi_us: number; computed_at: string; latitude: number; longitude: number };

function top<T>(rows: T[], val: (r: T) => number): T | null {
  let best: T | null = null;
  for (const r of rows) if (val(r) > 0 && (!best || val(r) > val(best))) best = r;
  return best;
}

export async function loadLive(): Promise<Live> {
  const [ranks, aq, cities, reports, fires, news] = await Promise.all([
    db.from('province_rankings_7d').select('name_en, name_id, fires_7d, forest_alerts_7d, fires_since'),
    db.from('city_aq_latest').select('slug, name_en, aqi_us, computed_at, latitude, longitude'),
    db.from('cities').select('slug, name_id'),
    db.from('reports_public').select('id', { count: 'exact', head: true }),
    db.from('hotspots_recent').select('latitude, longitude, province_id').not('province_id', 'is', null).limit(4000),
    db.from('news_feed').select(STORY_COLS).order('published_at', { ascending: false }).limit(12),
  ]);
  const r = (ranks.data ?? []) as Rank[];
  const a = ((aq.data ?? []) as Aq[]).filter((x) => x.aqi_us > 0);
  const idName = new Map(((cities.data ?? []) as { slug: string; name_id: string }[]).map((c) => [c.slug, c.name_id]));
  const worst = top(a, (x) => x.aqi_us);
  const mf = top(r, (x) => x.fires_7d);
  const mfo = top(r, (x) => x.forest_alerts_7d ?? 0);
  const updatedAt = a.reduce<string | null>((m, x) => (!m || x.computed_at > m ? x.computed_at : m), null);
  const since = r[0]?.fires_since ?? null;
  const young = since && Date.now() - new Date(since).getTime() < 7 * 86400_000;
  return {
    updatedAt,
    firesSince: young ? since : null,
    fires7d: r.reduce((s, x) => s + x.fires_7d, 0),
    forestAlerts: r.reduce((s, x) => s + (x.forest_alerts_7d ?? 0), 0),
    reports: reports.count ?? 0,
    worstAir: worst ? { en: worst.name_en, id: idName.get(worst.slug) ?? worst.name_en, aqi: worst.aqi_us } : null,
    mostFires: mf ? { en: mf.name_en, id: mf.name_id, n: mf.fires_7d } : null,
    mostForest: mfo ? { en: mfo.name_en, id: mfo.name_id, n: mfo.forest_alerts_7d ?? 0 } : null,
    firePoints: ((fires.data ?? []) as { latitude: number; longitude: number }[]).map((f) => [f.longitude, f.latitude]),
    cityPoints: a.map((x) => ({ lon: x.longitude, lat: x.latitude, aqi: x.aqi_us })),
    news: latestStories((news.data ?? []) as Story[]),
  };
}

const STORY_COLS = 'id, url, title, published_at, summary_en, summary_id, topics, source_name, image_url';

// One story for its own page, plus the newest few to read next.
export async function loadStory(id: number): Promise<{ story: Story | null; more: Story[] }> {
  const [one, latest] = await Promise.all([
    db.from('news_feed').select(STORY_COLS).eq('id', id).maybeSingle(),
    db.from('news_feed').select(STORY_COLS).order('published_at', { ascending: false }).limit(12),
  ]);
  const story = (one.data as Story | null) ?? null;
  return { story, more: latestStories(((latest.data ?? []) as Story[]).filter((s) => s.id !== id), 3) };
}

export const L = {
  id: {
    nav: { map: 'Peta langsung', get: 'Pasang aplikasi' },
    live: 'LANGSUNG', updated: (m: number) => (m < 1 ? 'baru saja diperbarui' : m < 60 ? `diperbarui ${m} menit lalu` : `diperbarui ${Math.round(m / 60)} jam lalu`),
    h1: 'Lihat apa yang terjadi pada udara dan hutan Indonesia. Saat ini juga.',
    lede: 'Data satelit dan alat pemantau udara dari seluruh Indonesia. Udara diperbarui tiap 15 menit, titik api tiap 3 jam. Gratis, tanpa iklan.',
    ctaApp: 'Pasang aplikasinya, gratis', ctaMap: 'Buka peta langsung',
    nowTitle: 'INDONESIA SAAT INI',
    fires: 'titik api dalam 7 hari terakhir',
    firesSince: (d: string) => `titik api sejak ${d}`,
    air: (c: string) => `udara ${c}`,
    forest: 'peringatan kehilangan hutan, minggu data satelit terbaru',
    reports: 'laporan warga yang masih aktif',
    sources: 'NASA FIRMS · Global Forest Watch · WAQI · OpenAQ',
    mapHint: 'Ketuk untuk membuka peta langsung', legendFire: 'Titik api', legendAir: 'Kualitas udara kota',
    newsEyebrow: 'BERITA TERBARU · DIPERBARUI TIAP JAM', newsTitle: 'Yang terjadi hari ini',
    newsOf: (i: number, n: number) => `${i} dari ${n}`, newsPrev: 'Berita sebelumnya', newsNext: 'Berita berikutnya', newsNewest: 'TERBARU',
    storyHome: 'Beranda', storyOurs: 'RINGKASAN KAMI', storyRead: (src: string) => `Baca selengkapnya di ${src}`,
    storyNote: 'Ringkasan ditulis EcoPulse dengan bantuan AI. Artikel lengkap ada di situs penerbitnya.',
    storyNext: 'BERITA LAINNYA', storyMissing: 'Berita ini tidak ditemukan. Mungkin sudah tidak tersedia.', storyLoading: 'Memuat…',
    worstTitle: 'Terparah di Indonesia saat ini', worstAir: 'UDARA TERBURUK', mostFires: 'TITIK API TERBANYAK', mostForest: 'KEHILANGAN HUTAN TERBANYAK',
    nFires: (n: string) => `${n} titik api`, nAlerts: (n: string) => `${n} peringatan`,
    share: 'Bagikan ke Story', sharing: 'Menyiapkan…',
    featTitle: 'APA YANG BISA DILAKUKAN APLIKASI INI',
    feats: [
      ['Kualitas udara', 'AQI kota Anda, prakiraan 24 jam, dan jam terbaik untuk keluar rumah.'],
      ['Api dan asap', 'Setiap titik api dari satelit, dan apakah asapnya mengarah ke Anda.'],
      ['Kehilangan hutan', 'Di mana hutan dibuka, dan ke mana melaporkannya.'],
      ['Laporan warga', 'Laporkan masalah di sekitar Anda, konfirmasi laporan orang lain, dan naik peringkat.'],
    ] as [string, string][],
    ranksTitle: 'Bantu, dapatkan poin, naik peringkat',
    ranksSub: 'Setiap laporan diperiksa sebelum tampil. Poin didapat saat laporan Anda dikonfirmasi warga lain atau satelit.',
    ranks: [['Pengamat', 0], ['Penjaga', 100], ['Pelindung', 500], ['Pahlawan Hutan', 2000]] as [string, number][],
    pts: (n: string) => `${n} poin`,
    getTitle: 'Pasang EcoPulse di ponsel Anda. Gratis.',
    getSub: 'Buka dari layar utama seperti aplikasi biasa. Tanpa iklan, tanpa biaya, tanpa perlu daftar untuk melihat peta.',
    android: 'ANDROID', iphone: 'IPHONE: 3 KETUKAN',
    install: 'Pasang EcoPulse', installed: 'Sudah terpasang. Buka aplikasinya', openChrome: 'Buka di Chrome untuk memasang',
    androidManual: 'Di Chrome, ketuk menu ⋮ lalu "Tambahkan ke layar utama" atau "Instal aplikasi".',
    iosSteps: ['Buka halaman ini di Safari', 'Ketuk tombol Bagikan (kotak dengan panah ke atas)', 'Pilih "Tambahkan ke Layar Utama", lalu "Tambah"'],
    iosStepsInApp: ['Ketuk ⋯ di pojok kanan atas, lalu "Buka di browser eksternal"', 'Di Safari, ketuk tombol Bagikan', 'Pilih "Tambahkan ke Layar Utama", lalu "Tambah"'],
    desktopNote: 'Di komputer? Buka alamat ini di ponsel Anda untuk memasangnya.',
    banner: (app: string) => `Anda membuka halaman ini di dalam ${app}`,
    bannerIos: 'Untuk memasang aplikasi, ketuk ⋯ di pojok kanan atas, lalu "Buka di browser eksternal".',
    bannerAndroid: 'Untuk memasang aplikasi, buka halaman ini di Chrome.',
    bannerBtn: 'Buka di Chrome',
    footer: 'EcoPulse Indonesia · gratis, nonkomersial, tanpa iklan',
    privacy: 'Privasi', contact: 'Kontak',
    disclaimer: 'Data otomatis dari sumber publik dan bisa terlambat atau keliru. Untuk keadaan darurat, hubungi 112.',
  },
  en: {
    nav: { map: 'Live map', get: 'Get the app' },
    live: 'LIVE', updated: (m: number) => (m < 1 ? 'updated just now' : m < 60 ? `updated ${m} min ago` : `updated ${Math.round(m / 60)} h ago`),
    h1: "See what is happening to Indonesia's air and forests. Right now.",
    lede: 'Satellites and air monitors across Indonesia. Air updates every 15 minutes, fires every 3 hours. Free, no ads.',
    ctaApp: 'Get the free app', ctaMap: 'Open the live map',
    nowTitle: 'INDONESIA RIGHT NOW',
    fires: 'fire hotspots in the last 7 days',
    firesSince: (d: string) => `fire hotspots since ${d}`,
    air: (c: string) => `${c} air`,
    forest: 'forest-loss alerts, latest week of satellite data',
    reports: 'active reports from people',
    sources: 'NASA FIRMS · Global Forest Watch · WAQI · OpenAQ',
    mapHint: 'Tap to open the live map', legendFire: 'Fire hotspot', legendAir: 'City air quality',
    newsEyebrow: 'LATEST NEWS · UPDATED EVERY HOUR', newsTitle: 'What happened today',
    newsOf: (i: number, n: number) => `${i} of ${n}`, newsPrev: 'Previous story', newsNext: 'Next story', newsNewest: 'NEWEST',
    storyHome: 'Home', storyOurs: 'OUR SUMMARY', storyRead: (src: string) => `Read the full story at ${src}`,
    storyNote: 'Summary written by EcoPulse with the help of AI. The full article is on the publisher\'s site.',
    storyNext: 'MORE NEWS', storyMissing: 'This story could not be found. It may no longer be available.', storyLoading: 'Loading…',
    worstTitle: "Indonesia's worst right now", worstAir: 'WORST AIR', mostFires: 'MOST FIRES', mostForest: 'MOST FOREST LOSS',
    nFires: (n: string) => `${n} hotspots`, nAlerts: (n: string) => `${n} alerts`,
    share: 'Share to your Story', sharing: 'Preparing…',
    featTitle: 'WHAT THE APP DOES',
    feats: [
      ['Air quality', "Your city's AQI, a 24-hour forecast and the cleanest time to go out."],
      ['Fire and smoke', 'Every satellite hotspot, and whether the smoke is heading your way.'],
      ['Forest loss', 'Where forest is being cleared, and who to report it to.'],
      ['Community reports', "Report problems near you, confirm other people's, and climb the ranks."],
    ] as [string, string][],
    ranksTitle: 'Help out, earn points, climb the ranks',
    ranksSub: 'Every report is checked before it appears. You earn points when other people or satellites confirm your report.',
    ranks: [['Observer', 0], ['Guardian', 100], ['Protector', 500], ['Forest Hero', 2000]] as [string, number][],
    pts: (n: string) => `${n} pts`,
    getTitle: 'Get EcoPulse on your phone. Free.',
    getSub: 'Opens from your home screen like any app. No ads, no cost, no account needed to see the map.',
    android: 'ANDROID', iphone: 'IPHONE: 3 TAPS',
    install: 'Install EcoPulse', installed: 'Already installed. Open the app', openChrome: 'Open in Chrome to install',
    androidManual: 'In Chrome, tap the ⋮ menu, then "Add to Home screen" or "Install app".',
    iosSteps: ['Open this page in Safari', 'Tap the Share button (square with an up arrow)', 'Choose "Add to Home Screen", then "Add"'],
    iosStepsInApp: ['Tap ⋯ at the top right, then "Open in external browser"', 'In Safari, tap the Share button', 'Choose "Add to Home Screen", then "Add"'],
    desktopNote: 'On a computer? Open this address on your phone to install it.',
    banner: (app: string) => `You opened this inside ${app}`,
    bannerIos: 'To install the app, tap ⋯ at the top right, then "Open in external browser".',
    bannerAndroid: 'To install the app, open this page in Chrome.',
    bannerBtn: 'Open in Chrome',
    footer: 'EcoPulse Indonesia · free, non-commercial, no ads',
    privacy: 'Privacy', contact: 'Contact',
    disclaimer: 'Automatic data from public sources; it can be late or wrong. In an emergency, call 112.',
  },
} satisfies Record<Lang, unknown>;
