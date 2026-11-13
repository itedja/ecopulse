// Plain-language legal notes. Every statement here comes from the law itself, a court ruling,
// or (where marked) a party's own public statement, and every note links its sources.
// Checked November 2026. Not legal advice; the notes say so.
import type { Lang } from './i18n';

export type LegalSource = { label: string; url: string };
export type LegalNoteData = {
  title: Record<Lang, string>;
  lead: Record<Lang, string>;
  points: Record<Lang, string[]>;
  sources: LegalSource[];
};

const UU_PPLH = { label: 'UU 32/2009 (PPLH)', url: 'https://peraturan.bpk.go.id/Details/38771/uu-no-32-tahun-2009' };
const MK_119 = { label: 'Putusan MK 119/PUU-XXIII/2025', url: 'https://www.mkri.id/berita/mk-tegaskan-perlindungan-hukum-bagi-aktivis-lingkungan-23697' };

// Shown where people report a problem: fear of being sued or reported to police stops many reports.
export const PROTECTED: LegalNoteData = {
  title: { en: 'The law protects you', id: 'Anda dilindungi hukum' },
  lead: {
    en: 'People who stand up for a good and healthy environment cannot be prosecuted or sued for doing so (Environment Law 32/2009, Article 66).',
    id: 'Orang yang memperjuangkan hak atas lingkungan hidup yang baik dan sehat tidak dapat dituntut pidana maupun digugat perdata karena perjuangannya (UU 32/2009, Pasal 66).',
  },
  points: {
    en: [
      'In August 2025 the Constitutional Court ruled that this protection covers everyone, including people who report, witnesses, experts and activists (Decision 119/PUU-XXIII/2025).',
      'You also have the right to complain about suspected pollution or environmental damage (Article 65(5)).',
      'Report what you actually saw, from a safe place. Do not confront anyone.',
    ],
    id: [
      'Pada Agustus 2025 Mahkamah Konstitusi memutuskan perlindungan ini berlaku untuk setiap orang, termasuk pelapor, saksi, ahli, dan aktivis (Putusan 119/PUU-XXIII/2025).',
      'Anda juga berhak mengadukan dugaan pencemaran atau perusakan lingkungan (Pasal 65 ayat 5).',
      'Laporkan apa yang benar-benar Anda lihat, dari tempat yang aman. Jangan menegur siapa pun.',
    ],
  },
  sources: [
    UU_PPLH,
    MK_119,
    { label: 'Permen LHK 10/2024', url: 'https://peraturan.bpk.go.id/Download/360471/Permen%20LHK%20No%2010%20Tahun%202024.pdf' },
  ],
};

// Shown on the air card when air is unhealthy for sensitive groups or worse.
export const CLEAN_AIR: LegalNoteData = {
  title: { en: 'Clean air is your right', id: 'Udara bersih adalah hak Anda' },
  lead: {
    en: 'The Constitution gives everyone the right to a good and healthy environment (Article 28H(1)).',
    id: 'UUD 1945 menjamin hak setiap orang atas lingkungan hidup yang baik dan sehat (Pasal 28H ayat 1).',
  },
  points: { en: [], id: [] },
  sources: [MK_119, UU_PPLH],
};

// Shown on repeat-fire cards: the general law on burning land. Never applied to a specific
// company or person here; that needs an official finding.
export const FIRE_LAW: LegalNoteData = {
  title: { en: 'The law on burning land', id: 'Hukum soal membakar lahan' },
  lead: {
    en: 'Clearing land by burning is prohibited (Environment Law 32/2009, Article 69(1)(h)).',
    id: 'Membuka lahan dengan cara membakar dilarang (UU 32/2009, Pasal 69 ayat 1 huruf h).',
  },
  points: {
    en: [
      'There is a narrow exception for local custom: at most 2 hectares per family (Article 69(2), as amended by the Job Creation Law).',
      'A permit holder is strictly liable for fire on its land: it is enough to show the fire happened there, without proving fault (Supreme Court, 297 PK/Pdt/2024).',
      'The map shows heat seen by satellites. It does not say who caused a fire.',
    ],
    id: [
      'Ada pengecualian terbatas untuk kearifan lokal: paling luas 2 hektare per kepala keluarga (Pasal 69 ayat 2, sebagaimana diubah UU Cipta Kerja).',
      'Pemegang izin bertanggung jawab mutlak atas kebakaran di lahannya: cukup dibuktikan kebakaran terjadi di sana, tanpa membuktikan kesalahan (Putusan MA 297 PK/Pdt/2024).',
      'Peta ini menunjukkan panas yang dilihat satelit. Peta ini tidak menyatakan siapa penyebab kebakaran.',
    ],
  },
  sources: [
    UU_PPLH,
    { label: 'DPR, Info Singkat Agustus 2025', url: 'https://berkas.dpr.go.id/pusaka/files/info_singkat/Info%20Singkat-XVII-15-I-P3DI-Agustus-2025-189.pdf' },
    { label: 'MA 297 PK/Pdt/2024', url: 'https://marinews.mahkamahagung.go.id/putusan/yurisprudensi-ma-korporasi-bebas-pidana-namun-tetap-0zn' },
  ],
};

// Extra for the Jakarta area, where citizens won a court case about the air.
export const JAKARTA_CASE: LegalNoteData = {
  title: { en: 'The courts have ruled on Jakarta’s air', id: 'Pengadilan sudah memutus soal udara Jakarta' },
  lead: {
    en: 'In 2021, 32 citizens won a lawsuit: the court found the President, three ministers and the Jakarta governor had acted unlawfully on air pollution and ordered them to act.',
    id: 'Pada 2021, 32 warga memenangkan gugatan: pengadilan menyatakan Presiden, tiga menteri, dan Gubernur DKI melakukan perbuatan melawan hukum terkait polusi udara dan memerintahkan mereka bertindak.',
  },
  points: {
    en: [
      'Upheld by the Jakarta High Court (2022) and the Supreme Court (2023, No. 2560 K/Pdt/2023). The ruling is final.',
      'Orders include tightening national air standards, supervising the Jakarta, Banten and West Java governors on cross-border emissions, and measuring the health impact.',
      'In September 2026 the plaintiffs’ coalition said the ruling had not yet been fully carried out.',
    ],
    id: [
      'Dikuatkan Pengadilan Tinggi Jakarta (2022) dan Mahkamah Agung (2023, No. 2560 K/Pdt/2023). Putusan ini sudah berkekuatan hukum tetap.',
      'Perintahnya antara lain memperketat baku mutu udara nasional, mengawasi Gubernur DKI, Banten, dan Jawa Barat soal emisi lintas batas, dan menghitung dampak kesehatan.',
      'Pada September 2026 koalisi penggugat menyatakan putusan ini belum dilaksanakan sepenuhnya.',
    ],
  },
  sources: [
    { label: 'Putusan 374/Pdt.G/LH/2019/PN Jkt.Pst', url: 'https://putusan3.mahkamahagung.go.id/direktori/putusan/zaec2b0d732a5e24a30f313033353330.html' },
    { label: 'LBH Jakarta', url: 'https://bantuanhukum.or.id/?p=26360' },
    { label: 'Koalisi IBUKOTA, Sep 2026', url: 'https://www.greenpeace.org/indonesia/siaran-pers/67777/hari-udara-bersih-2026-menang-di-pengadilan-kapan-warga-menang-di-udara/' },
  ],
};

// The lawsuit covers Jakarta and orders supervision of Banten (Tangerang) on cross-border emissions.
export const JAKARTA_AREA = new Set(['jakarta', 'tangerang']);

export const NOT_ADVICE: Record<Lang, string> = {
  en: 'General information, not legal advice. Sources:',
  id: 'Informasi umum, bukan nasihat hukum. Sumber:',
};
