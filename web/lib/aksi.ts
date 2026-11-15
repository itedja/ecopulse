// Aksi: the members-only feed of small environmental actions (#SatuAksiSehari).
// Types, wording in both languages, and small pure helpers. All reads and writes go through the
// aksi_* database functions (migration 018), which check membership on the server.
export type ALang = 'id' | 'en';
export const REACTIONS = ['good_job', 'proud', 'congrats', 'thanks'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const FLAG_REASONS = ['not_real', 'child_visible', 'unsafe', 'hateful', 'spam', 'other'] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export type FeedPost = {
  id: string; caption: string | null; photo_path: string | null; action_day: string; approved_at: string;
  nickname: string; rank_key: string; streak: number; mine: boolean;
  reactions: Partial<Record<Reaction, number>>; my_reactions: Reaction[]; comments: number;
};
export type Comment = { id: string; body: string; status: 'approved' | 'pending'; created_at: string; nickname: string; mine: boolean };
export type PostDetail = Omit<FeedPost, 'comments'> & { status: string; comments: Comment[] };
export type MyPost = { id: string; caption: string | null; status: 'pending' | 'approved' | 'rejected' | 'held';
  screening_note: string | null; photo_path: string | null; action_day: string; created_at: string; appeal_status: 'open' | 'upheld' | 'denied' | null };
export type Me = { member: boolean; lang?: ALang; nickname?: string; points?: number; rank_key?: string; streak?: number;
  posted_today?: boolean; approved_total?: number; suspended_until?: string | null; posts?: MyPost[] };

const CODES = ['sign_in_required', 'not_a_member', 'adults_only', 'rules_required', 'bad_photo_path', 'duplicate_photo', 'daily_limit',
  'caption_too_long', 'bad_comment', 'post_not_found', 'cannot_appeal', 'already_appealed', 'message_too_long'] as const;
export type AksiError = (typeof CODES)[number] | 'generic';
export function aksiError(err: unknown): AksiError {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  return CODES.find((c) => msg.includes(c)) ?? 'generic';
}

// The screening job writes the reason as "Bahasa Indonesia / English". Show the reader's half.
export function noteFor(note: string | null, lang: ALang): string {
  if (!note) return '';
  const parts = note.split(' / ');
  if (parts.length < 2) return note.trim();
  return (lang === 'id' ? parts[0] : parts.slice(1).join(' / ')).trim();
}

// Optimistic update after tapping a quick comment.
export function toggleReaction<P extends { reactions: Partial<Record<Reaction, number>>; my_reactions: Reaction[] }>(p: P, kind: Reaction): P {
  const on = !p.my_reactions.includes(kind);
  const n = Math.max(0, (p.reactions[kind] ?? 0) + (on ? 1 : -1));
  return { ...p, reactions: { ...p.reactions, [kind]: n }, my_reactions: on ? [...p.my_reactions, kind] : p.my_reactions.filter((k) => k !== kind) };
}

export function ago(iso: string, now: number, lang: ALang): string {
  const m = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return lang === 'en' ? `${m} min ago` : `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return lang === 'en' ? `${h} h ago` : `${h} jam lalu`;
  const d = Math.round(h / 24);
  return lang === 'en' ? `${d} d ago` : `${d} hari lalu`;
}

export type Profile = { nickname: string; rank_key: string; points: number; mine: boolean; streak: number; approved_total: number;
  days: string[]; posts: { id: string; photo_path: string | null; caption: string | null; action_day: string; approved_at: string }[] };

// Today's date in Jakarta (UTC+7, no daylight saving), as YYYY-MM-DD.
export function jakartaDay(now: number): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}

// The current week, Monday to Sunday, for the row of dots on a profile.
export function weekDots(days: string[], now: number): { date: string; done: boolean; today: boolean; future: boolean }[] {
  const today = jakartaDay(now);
  const t = new Date(today + 'T00:00:00Z');
  const monday = t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400_000;
  const done = new Set(days);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday + i * 86400_000).toISOString().slice(0, 10);
    return { date, done: done.has(date), today: date === today, future: date > today };
  });
}

export const RULES_VERSION = 1;

export const A = {
  id: {
    tag: '#SatuAksiSehari', back: 'Peta', feed: 'Aksi', me: 'Profil',
    lockedTitle: 'Satu aksi kecil setiap hari.',
    lockedBody: 'Aksi adalah ruang anggota EcoPulse untuk berbagi foto aksi kecil bagi lingkungan: memungut sampah, menanam, membawa botol sendiri. Hanya anggota yang bisa melihatnya.',
    signIn: 'Masuk dengan Google', signInWaiting: 'Selesaikan masuk dengan Google, lalu kembali ke sini.', adultsNote: 'Khusus usia 18 tahun ke atas.',
    joinTitle: 'Sebelum bergabung', adult: 'Saya berusia 18 tahun atau lebih.', agree: 'Saya setuju dengan aturan komunitas di bawah ini.',
    langPick: 'Bahasa', join: 'Gabung', joining: 'Sebentar…', rulesTitle: 'Aturan komunitas',
    rules: [
      'Unggah foto Anda sendiri tentang aksi nyata untuk lingkungan. Lucu atau aneh boleh. Foto buatan AI, foto stok, dan tangkapan layar tidak.',
      'Tidak ada wajah anak di bawah 18 tahun yang bisa dikenali dalam foto.',
      'Jangan mendekati api, lahan terbakar, atau lokasi pembukaan hutan untuk mengambil foto. Keselamatan lebih penting.',
      'Tidak ada data pribadi orang lain: nomor telepon, alamat, kartu identitas, pelat nomor.',
      'Tidak menuduh orang atau perusahaan melanggar hukum. Untuk masalah lingkungan, gunakan menu Lapor.',
      'Bersikap ramah. Tidak ada kata kasar, pelecehan, atau ujaran kebencian dalam bahasa apa pun.',
      'Setiap foto dan komentar diperiksa otomatis oleh AI (Claude) sebelum tampil. Pemeriksaan ini bisa keliru; Anda bisa mengajukan banding satu kali per unggahan.',
    ],
    empty: 'Belum ada aksi. Jadilah yang pertama hari ini.', more: 'Muat lagi', loading: 'Memuat…',
    newPost: 'Aksi baru', camera: 'Ambil foto', gallery: 'Pilih dari galeri', caption: 'Keterangan (opsional)', captionPh: 'Apa yang Anda lakukan?',
    ideas: 'Tidak harus sampah. Contoh: botol minum sendiri, tas belanja sendiri, memilah sampah di rumah, menyiram tanaman, jalan kaki atau naik sepeda, mematikan lampu yang tidak dipakai.',
    childReminder: 'Pastikan tidak ada wajah anak yang terlihat.', post: 'Kirim', posting: 'Mengirim…', cancel: 'Batal', change: 'Ganti foto',
    sent: 'Terkirim. Foto sedang diperiksa, biasanya beberapa menit.',
    streak: (n: number) => `${n} hari beruntun`, streakNone: 'Mulai rangkaian Anda hari ini', today: 'Hari ini sudah', todayNot: 'Belum ada aksi hari ini',
    restNote: 'Satu hari libur per minggu tidak memutus rangkaian.', points: 'poin', total: (n: number) => `${n} aksi`,
    reactions: { good_job: 'Kerja bagus', proud: 'Bangga padamu', congrats: 'Selamat', thanks: 'Terima kasih sudah menjaga Indonesia' } as Record<Reaction, string>,
    comments: (n: number) => (n === 0 ? 'Komentar' : `${n} komentar`), commentPh: 'Tulis komentar yang ramah…', send: 'Kirim',
    commentPending: 'sedang diperiksa', noComments: 'Belum ada komentar.', close: 'Tutup',
    flag: 'Laporkan', flagTitle: 'Mengapa Anda melaporkan ini?', flagged: 'Terima kasih. Kami akan memeriksanya.',
    flagReasons: { not_real: 'Bukan foto asli', child_visible: 'Wajah anak terlihat', unsafe: 'Berbahaya', hateful: 'Kasar atau penuh kebencian', spam: 'Spam', other: 'Lainnya' } as Record<FlagReason, string>,
    myPosts: 'Unggahan saya', status: { pending: 'Sedang diperiksa', approved: 'Tampil', rejected: 'Ditolak', held: 'Ditahan untuk diperiksa' } as Record<string, string>,
    appeal: 'Ajukan banding', appealPh: 'Jelaskan singkat mengapa foto ini seharusnya diterima (opsional)', appealSend: 'Kirim banding',
    appealOpen: 'Banding terkirim. Tim EcoPulse Indonesia akan memeriksanya.', appealDenied: 'Banding ditolak.', remove: 'Hapus', removeAsk: 'Hapus unggahan ini?',
    profile: 'Profil', thisWeek: 'Minggu ini', weekdays: ['S', 'S', 'R', 'K', 'J', 'S', 'M'], waiting: 'Menunggu dan ditolak', noPhotos: 'Belum ada aksi yang tampil.',
    editName: 'Ubah nama', nameHint: '3 sampai 24 huruf, angka, titik, atau garis bawah.', save: 'Simpan', nameTaken: 'Nama itu sudah dipakai.', nameBad: 'Nama harus 3 sampai 24 huruf, angka, titik, atau garis bawah.',
    nextRank: (n: number, r: string) => `${n} poin lagi menuju ${r}`, topRank: 'Peringkat tertinggi', notFound: 'Profil tidak ditemukan.',
    settings: 'Pengaturan', signOut: 'Keluar', you: 'Anda',
    errors: {
      sign_in_required: 'Silakan masuk dulu.', not_a_member: 'Anda belum bergabung dengan Aksi.', adults_only: 'Aksi hanya untuk usia 18 tahun ke atas.',
      rules_required: 'Anda perlu menyetujui aturan komunitas.', bad_photo_path: 'Foto gagal diunggah. Coba lagi.', duplicate_photo: 'Foto ini sudah pernah diunggah.',
      daily_limit: 'Batas harian tercapai. Coba lagi besok.', caption_too_long: 'Keterangan terlalu panjang (maksimal 300 karakter).', bad_comment: 'Komentar harus 1 sampai 200 karakter.',
      post_not_found: 'Unggahan tidak ditemukan.', cannot_appeal: 'Unggahan ini tidak bisa diajukan banding.', already_appealed: 'Banding sudah pernah diajukan.',
      message_too_long: 'Pesan terlalu panjang (maksimal 500 karakter).', generic: 'Ada yang salah. Coba lagi.',
    } as Record<AksiError, string>,
  },
  en: {
    tag: '#SatuAksiSehari', back: 'Map', feed: 'Aksi', me: 'Profile',
    lockedTitle: 'One small action a day.',
    lockedBody: 'Aksi is the EcoPulse members’ space for sharing photos of small actions for the environment: picking up litter, planting, carrying your own bottle. Only members can see it.',
    signIn: 'Sign in with Google', signInWaiting: 'Finish signing in with Google, then come back here.', adultsNote: 'For ages 18 and over only.',
    joinTitle: 'Before you join', adult: 'I am 18 or older.', agree: 'I agree to the community rules below.',
    langPick: 'Language', join: 'Join', joining: 'One moment…', rulesTitle: 'Community rules',
    rules: [
      'Post your own photo of a real action for the environment. Funny or odd is fine. AI-made images, stock photos and screenshots are not.',
      'No recognisable faces of anyone under 18 in a photo.',
      'Do not go near fires, burning land or forest-clearing sites to take a photo. Your safety comes first.',
      'No other people’s personal information: phone numbers, addresses, ID cards, licence plates.',
      'Do not accuse a person or company of breaking the law. For environmental problems, use Report.',
      'Be kind. No vulgar language, harassment or hate speech in any language.',
      'Every photo and comment is checked automatically by AI (Claude) before it appears. The check can be wrong; you can appeal once per post.',
    ],
    empty: 'No actions yet. Be the first today.', more: 'Load more', loading: 'Loading…',
    newPost: 'New action', camera: 'Take a photo', gallery: 'Choose from gallery', caption: 'Caption (optional)', captionPh: 'What did you do?',
    ideas: 'It does not have to be litter. Examples: your own water bottle, your own shopping bag, sorting waste at home, watering a plant, walking or cycling, switching off lights you are not using.',
    childReminder: 'Make sure no child’s face is visible.', post: 'Post', posting: 'Posting…', cancel: 'Cancel', change: 'Change photo',
    sent: 'Sent. Your photo is being checked, usually a few minutes.',
    streak: (n: number) => `${n}-day streak`, streakNone: 'Start your streak today', today: 'Done today', todayNot: 'No action yet today',
    restNote: 'One rest day a week does not break your streak.', points: 'points', total: (n: number) => `${n} ${n === 1 ? 'action' : 'actions'}`,
    reactions: { good_job: 'Good job', proud: 'Proud of you', congrats: 'Congrats', thanks: 'Thanks for saving Indonesia' } as Record<Reaction, string>,
    comments: (n: number) => (n === 0 ? 'Comment' : `${n} ${n === 1 ? 'comment' : 'comments'}`), commentPh: 'Write a kind comment…', send: 'Send',
    commentPending: 'being checked', noComments: 'No comments yet.', close: 'Close',
    flag: 'Report', flagTitle: 'Why are you reporting this?', flagged: 'Thank you. We will look at it.',
    flagReasons: { not_real: 'Not a real photo', child_visible: 'A child’s face is visible', unsafe: 'Dangerous', hateful: 'Rude or hateful', spam: 'Spam', other: 'Other' } as Record<FlagReason, string>,
    myPosts: 'My posts', status: { pending: 'Being checked', approved: 'Visible', rejected: 'Rejected', held: 'Held for review' } as Record<string, string>,
    appeal: 'Appeal', appealPh: 'Briefly say why this photo should be accepted (optional)', appealSend: 'Send appeal',
    appealOpen: 'Appeal sent. Tim EcoPulse Indonesia will look at it.', appealDenied: 'Appeal denied.', remove: 'Delete', removeAsk: 'Delete this post?',
    profile: 'Profile', thisWeek: 'This week', weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], waiting: 'Waiting and rejected', noPhotos: 'No visible actions yet.',
    editName: 'Change name', nameHint: '3 to 24 letters, numbers, dots or underscores.', save: 'Save', nameTaken: 'That name is taken.', nameBad: 'A name must be 3 to 24 letters, numbers, dots or underscores.',
    nextRank: (n: number, r: string) => `${n} points to ${r}`, topRank: 'Highest rank reached', notFound: 'Profile not found.',
    settings: 'Settings', signOut: 'Sign out', you: 'You',
    errors: {
      sign_in_required: 'Please sign in first.', not_a_member: 'You have not joined Aksi yet.', adults_only: 'Aksi is for ages 18 and over only.',
      rules_required: 'You need to agree to the community rules.', bad_photo_path: 'The photo failed to upload. Try again.', duplicate_photo: 'This photo was already posted.',
      daily_limit: 'Daily limit reached. Try again tomorrow.', caption_too_long: 'Caption is too long (300 characters at most).', bad_comment: 'A comment must be 1 to 200 characters.',
      post_not_found: 'Post not found.', cannot_appeal: 'This post cannot be appealed.', already_appealed: 'An appeal was already sent.',
      message_too_long: 'Message is too long (500 characters at most).', generic: 'Something went wrong. Try again.',
    } as Record<AksiError, string>,
  },
};
