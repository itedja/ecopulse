// "How you can help" guide. Every contact here was checked against an official or news source
// (November 2026). Keep it short: one clear official channel per issue, then ways to join in.
import type { Lang } from './i18n';

export type HelpLink = { kind: 'web' | 'tel' | 'wa' | 'sms' | 'mail'; label: string; value: string };
export type HelpItem = {
  role: 'report' | 'join' | 'donate' | 'daily';
  title: Record<Lang, string>;
  body: Record<Lang, string>;
  links?: HelpLink[];
};
export type HelpIssue = { key: string; label: Record<Lang, string>; items: HelpItem[] };

export function href(l: HelpLink): string {
  switch (l.kind) {
    case 'tel': return `tel:${l.value}`;
    case 'wa': return `https://wa.me/${l.value.replace(/[^0-9]/g, '')}`;
    case 'sms': return `sms:${l.value}`;
    case 'mail': return `mailto:${l.value}`;
    default: return l.value;
  }
}

const LAPOR: HelpItem = {
  role: 'report',
  title: { en: 'Report it to the government (LAPOR!)', id: 'Laporkan ke pemerintah (LAPOR!)' },
  body: {
    en: 'The national complaints service. It forwards your report to the environment ministry or your local environment office (DLH), and you can track the answer. Include the exact place, the time, photos and the likely source.',
    id: 'Layanan pengaduan nasional. Laporan diteruskan ke Kementerian Lingkungan Hidup atau Dinas Lingkungan Hidup (DLH) setempat, dan tanggapannya bisa dipantau. Sertakan lokasi persis, waktu, foto, dan dugaan sumbernya.',
  },
  links: [{ kind: 'web', label: 'lapor.go.id', value: 'https://www.lapor.go.id/' }, { kind: 'sms', label: 'SMS 1708', value: '1708' }],
};

const SUNGAI_WATCH: HelpItem = {
  role: 'join',
  title: { en: 'Join a river cleanup: Sungai Watch', id: 'Ikut bersih sungai: Sungai Watch' },
  body: {
    en: 'Runs trash barriers and weekly volunteer cleanups (Bali and East Java). You can volunteer, report a dirty river or sponsor a barrier.',
    id: 'Memasang penghalang sampah dan bersih sungai mingguan bersama relawan (Bali dan Jawa Timur). Bisa jadi relawan, melaporkan sungai kotor, atau mendanai penghalang.',
  },
  links: [{ kind: 'web', label: 'sungaiwatch.com', value: 'https://sungaiwatch.com' }],
};

const PANDAWARA: HelpItem = {
  role: 'join',
  title: { en: 'Join a cleanup: Pandawara Group', id: 'Ikut aksi bersih: Pandawara Group' },
  body: {
    en: 'Youth group from Bandung that announces open river and beach cleanups on social media. Follow them to hear when one is near you.',
    id: 'Kelompok anak muda asal Bandung yang mengumumkan aksi bersih sungai dan pantai terbuka lewat media sosial. Ikuti untuk tahu jadwal di dekat Anda.',
  },
  links: [{ kind: 'web', label: 'Instagram @pandawaragroup', value: 'https://www.instagram.com/pandawaragroup/' }],
};

const GAKKUM_FOREST: HelpItem = {
  role: 'report',
  title: { en: 'Report it to the Ministry of Forestry (Gakkum)', id: 'Laporkan ke Kementerian Kehutanan (Gakkum)' },
  body: {
    en: 'Official complaint portal for forest crime: illegal logging, encroachment, illegal mining and wildlife crime. You can track your report.',
    id: 'Portal pengaduan resmi kejahatan kehutanan: pembalakan liar, perambahan, tambang ilegal, dan kejahatan satwa. Laporan bisa dipantau.',
  },
  links: [
    { kind: 'web', label: 'pengaduan.gakkum.kehutanan.go.id', value: 'https://pengaduan.gakkum.kehutanan.go.id/' },
    { kind: 'tel', label: '+62 852-7014-9194', value: '+6285270149194' },
  ],
};

export const HELP: HelpIssue[] = [
  {
    key: 'fire_smoke',
    label: { en: 'Fire & smoke', id: 'Api & asap' },
    items: [
      {
        role: 'report',
        title: { en: 'Report a forest or land fire (Kemenhut fire post)', id: 'Laporkan kebakaran hutan & lahan (Posko Karhutla)' },
        body: {
          en: "The Ministry of Forestry's fire post asks people to report smoke, flames or burning land as early as possible so fire crews (Manggala Agni) can respond.",
          id: 'Posko Karhutla Kementerian Kehutanan meminta warga melapor asap, api, atau lahan terbakar sedini mungkin agar regu Manggala Agni bisa bergerak.',
        },
        links: [
          { kind: 'wa', label: 'WhatsApp +62 813-1003-5000', value: '+6281310035000' },
          { kind: 'tel', label: '021-5704618', value: '0215704618' },
          { kind: 'mail', label: 'posko.karhutla@kehutanan.go.id', value: 'posko.karhutla@kehutanan.go.id' },
        ],
      },
      {
        role: 'donate',
        title: { en: 'Back community fire patrols', id: 'Dukung patroli api warga' },
        body: {
          en: 'BOS Foundation and Borneo Nature Foundation run fire detection and village firefighting teams in Kalimantan peatlands.',
          id: 'BOS Foundation dan Borneo Nature Foundation menjalankan tim deteksi dan pemadam api desa di lahan gambut Kalimantan.',
        },
        links: [
          { kind: 'web', label: 'BOS Foundation', value: 'https://www.orangutan.or.id/fightfires' },
          { kind: 'web', label: 'Borneo Nature Foundation', value: 'https://www.borneonaturefoundation.org/' },
        ],
      },
      {
        role: 'daily',
        title: { en: 'Every day', id: 'Sehari-hari' },
        body: {
          en: 'Never clear land or burn trash with fire; it is illegal and can spread into peat. When smoke is heavy, wear an N95 mask and keep windows closed.',
          id: 'Jangan membuka lahan atau membakar sampah dengan api; itu melanggar hukum dan bisa merambat ke gambut. Saat asap tebal, pakai masker N95 dan tutup jendela.',
        },
      },
    ],
  },
  {
    key: 'deforestation',
    label: { en: 'Forest loss', id: 'Hutan hilang' },
    items: [
      GAKKUM_FOREST,
      {
        role: 'join',
        title: { en: 'Support forest defenders: WALHI', id: 'Dukung pembela hutan: WALHI' },
        body: {
          en: "Indonesia's largest environmental network, with offices in most provinces. Supports communities fighting forest and land conflicts.",
          id: 'Jaringan lingkungan terbesar di Indonesia dengan kantor di sebagian besar provinsi. Mendampingi warga dalam konflik hutan dan lahan.',
        },
        links: [{ kind: 'web', label: 'walhi.or.id', value: 'https://www.walhi.or.id/' }],
      },
      {
        role: 'daily',
        title: { en: 'Stay safe', id: 'Utamakan keselamatan' },
        body: {
          en: 'Do not go to clearing sites or confront anyone. A photo from a safe distance and the location are enough for a report.',
          id: 'Jangan mendatangi lokasi pembukaan lahan atau menegur siapa pun. Foto dari jarak aman dan lokasinya sudah cukup untuk laporan.',
        },
      },
    ],
  },
  {
    key: 'river_pollution',
    label: { en: 'River pollution', id: 'Sungai tercemar' },
    items: [
      LAPOR,
      SUNGAI_WATCH,
      PANDAWARA,
      {
        role: 'daily',
        title: { en: 'Every day', id: 'Sehari-hari' },
        body: {
          en: 'Nothing goes into the river: no trash, no nappies, no oil. Use a trash bin even when there is no bin nearby; carry it home.',
          id: 'Tidak ada yang dibuang ke sungai: sampah, popok, maupun minyak. Bawa pulang sampah Anda jika tidak ada tempat sampah.',
        },
      },
    ],
  },
  {
    key: 'trash_dumping',
    label: { en: 'Trash dumping', id: 'Sampah liar' },
    items: [
      LAPOR,
      PANDAWARA,
      SUNGAI_WATCH,
      {
        role: 'daily',
        title: { en: 'Every day', id: 'Sehari-hari' },
        body: {
          en: 'Sort your waste and take plastics and paper to a waste bank (bank sampah) near you. Never burn trash.',
          id: 'Pilah sampah dan bawa plastik serta kertas ke bank sampah terdekat. Jangan membakar sampah.',
        },
      },
    ],
  },
  {
    key: 'flooding',
    label: { en: 'Flooding', id: 'Banjir' },
    items: [
      {
        role: 'report',
        title: { en: 'Emergency numbers', id: 'Nomor darurat' },
        body: {
          en: '112 is the single emergency number (free). 117 is the national disaster agency (BNPB), 115 is search and rescue (Basarnas).',
          id: '112 adalah nomor darurat tunggal (gratis). 117 untuk BNPB, 115 untuk pencarian dan pertolongan (Basarnas).',
        },
        links: [
          { kind: 'tel', label: '112', value: '112' },
          { kind: 'tel', label: 'BNPB 117', value: '117' },
          { kind: 'tel', label: 'Basarnas 115', value: '115' },
        ],
      },
      {
        role: 'daily',
        title: { en: 'Before the rain', id: 'Sebelum hujan' },
        body: {
          en: 'Keep drains near your home clear of trash, and keep a small bag ready with documents, medicine, a torch and a power bank.',
          id: 'Bersihkan saluran air dekat rumah dari sampah, dan siapkan tas kecil berisi dokumen, obat, senter, dan power bank.',
        },
      },
    ],
  },
  {
    key: 'air_pollution',
    label: { en: 'Air pollution', id: 'Polusi udara' },
    items: [
      { ...LAPOR, title: { en: 'Report a smoke source (LAPOR!)', id: 'Laporkan sumber asap (LAPOR!)' } },
      {
        role: 'join',
        title: { en: 'Join the clean-air movement: Bicara Udara', id: 'Ikut gerakan udara bersih: Bicara Udara' },
        body: {
          en: 'Non-profit that educates the public and pushes for clean-air policy. Has a free knowledge hub and programmes for parents, schools and young people.',
          id: 'Lembaga nirlaba yang mengedukasi publik dan mendorong kebijakan udara bersih. Punya pusat pengetahuan gratis dan program untuk orang tua, sekolah, dan anak muda.',
        },
        links: [{ kind: 'web', label: 'bicaraudara.id', value: 'https://bicaraudara.id/' }],
      },
      {
        role: 'daily',
        title: { en: 'Every day', id: 'Sehari-hari' },
        body: {
          en: "Check the map before outdoor exercise, use public transport when you can, and don't burn trash.",
          id: 'Cek peta sebelum olahraga di luar, gunakan transportasi umum bila bisa, dan jangan membakar sampah.',
        },
      },
    ],
  },
  {
    key: 'wildlife',
    label: { en: 'Wildlife', id: 'Satwa' },
    items: [
      { ...GAKKUM_FOREST, title: { en: 'Report wildlife trade (Gakkum)', id: 'Laporkan perdagangan satwa (Gakkum)' } },
      {
        role: 'daily',
        title: { en: 'Every day', id: 'Sehari-hari' },
        body: {
          en: "Never buy wild animals or animal parts, online or at markets. If you see a protected animal kept at home or sold online, report it with the link or location. Don't try to rescue it yourself.",
          id: 'Jangan membeli satwa liar atau bagian tubuhnya, online maupun di pasar. Jika melihat satwa dilindungi dipelihara atau dijual online, laporkan beserta tautan atau lokasinya. Jangan coba menyelamatkannya sendiri.',
        },
      },
    ],
  },
];

export const ROLE_LABEL: Record<HelpItem['role'], Record<Lang, string>> = {
  report: { en: 'Report', id: 'Lapor' },
  join: { en: 'Join', id: 'Ikut' },
  donate: { en: 'Donate', id: 'Donasi' },
  daily: { en: 'Every day', id: 'Sehari-hari' },
};

// Report kinds that share a guide.
export function helpFor(kind: string): HelpIssue | undefined {
  const map: Record<string, string> = { illegal_logging: 'deforestation' };
  return HELP.find((h) => h.key === (map[kind] ?? kind));
}
