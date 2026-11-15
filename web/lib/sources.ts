// The one list behind the "how we check our data" page. Every line here must match what the ingest
// code and the database actually do. If a job, a time window or a rule changes, change it here too.
export type Kind = 'measured' | 'satellite' | 'model' | 'official' | 'community' | 'news';
type Two = { id: string; en: string };
export type Source = {
  key: string; kind: Kind; title: Two; from: { name: string; url: string }[];
  updates: Two; what: Two; ours: Two; limits: Two;
};

export const KIND_LABEL: Record<Kind, Two> = {
  measured: { id: 'Pengukuran', en: 'Measurement' },
  satellite: { id: 'Deteksi satelit', en: 'Satellite detection' },
  model: { id: 'Perkiraan model', en: 'Model estimate' },
  official: { id: 'Peringatan resmi', en: 'Official notice' },
  community: { id: 'Laporan warga', en: 'Community report' },
  news: { id: 'Berita', en: 'News' },
};

export const SOURCES: Source[] = [
  {
    key: 'air', kind: 'measured',
    title: { id: 'Kualitas udara saat ini', en: 'Air quality now' },
    from: [{ name: 'OpenAQ', url: 'https://openaq.org' }, { name: 'World Air Quality Index Project', url: 'https://waqi.info' }],
    updates: { id: 'Diperiksa sekitar tiap 15 menit.', en: 'Checked about every 15 minutes.' },
    what: {
      id: 'Bacaan dari stasiun pemantau udara di darat. OpenAQ memberi kadar PM2.5; World Air Quality Index Project memberi angka indeks dari stasiun.',
      en: 'Readings from air monitoring stations on the ground. OpenAQ gives PM2.5 concentrations; the World Air Quality Index Project gives index values from stations.',
    },
    ours: {
      id: 'Angka kota adalah nilai tengah (median) dari stasiun dalam jarak 30 km yang bacaannya tidak lebih dari 3 jam. Kadar PM2.5 diubah menjadi AQI memakai skala US EPA (batas tahun 2024). Kartu menulis berapa stasiun yang melaporkan PM2.5.',
      en: 'A city number is the middle value (median) of stations within 30 km whose reading is no more than 3 hours old. PM2.5 is converted to AQI with the US EPA scale (2024 breakpoints). The card says how many stations reported PM2.5.',
    },
    limits: {
      id: 'Data belum divalidasi oleh pengelola stasiun. Kota tanpa stasiun dalam 30 km tidak punya angka. Ini bukan ISPU resmi pemerintah.',
      en: 'The data has not been validated by the station operators. A city with no station within 30 km has no number. This is not the government’s official ISPU.',
    },
  },
  {
    key: 'airforecast', kind: 'model',
    title: { id: 'Perkiraan udara 24 jam', en: '24-hour air outlook' },
    from: [{ name: 'Open-Meteo', url: 'https://open-meteo.com' }],
    updates: { id: 'Diperiksa sekitar tiap 15 menit.', en: 'Checked about every 15 minutes.' },
    what: { id: 'Perkiraan PM2.5 per jam dari model komputer, untuk tiap kota.', en: 'Hourly PM2.5 forecast from a computer model, for each city.' },
    ours: { id: 'Diubah menjadi AQI dengan skala yang sama, lalu ditampilkan sebagai deret warna dan “udara paling bersih”.', en: 'Converted to AQI with the same scale, then shown as the colour strip and the “cleanest air” window.' },
    limits: { id: 'Ini perkiraan, bukan pengukuran. Bisa berbeda dari angka stasiun.', en: 'This is a forecast, not a measurement. It can differ from the station number.' },
  },
  {
    key: 'fire', kind: 'satellite',
    title: { id: 'Titik api', en: 'Fire hotspots' },
    from: [{ name: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov' }],
    updates: { id: 'Diperiksa tiap 3 jam.', en: 'Checked every 3 hours.' },
    what: {
      id: 'Titik panas yang dideteksi sensor VIIRS pada tiga satelit (S-NPP, NOAA-20, NOAA-21), data hampir-waktu-nyata.',
      en: 'Heat detections from the VIIRS sensor on three satellites (S-NPP, NOAA-20, NOAA-21), near-real-time data.',
    },
    ours: {
      id: 'Peta menampilkan deteksi 48 jam terakhir. Di peringkat provinsi, deteksi berkeyakinan rendah tidak dihitung, dan tempat yang sama pada hari yang sama dihitung satu kali.',
      en: 'The map shows detections from the last 48 hours. In province rankings, low-confidence detections are left out, and the same place on the same day counts once.',
    },
    limits: {
      id: 'Titik api adalah deteksi panas dari satelit, bukan kebakaran yang sudah dipastikan di lapangan. Awan dan asap tebal bisa menutupi api.',
      en: 'A hotspot is a heat detection from space, not a fire confirmed on the ground. Cloud and thick smoke can hide fires.',
    },
  },
  {
    key: 'repeat', kind: 'satellite',
    title: { id: 'Area api berulang', en: 'Repeat-fire areas' },
    from: [{ name: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov' }],
    updates: { id: 'Dimuat ulang secara manual, tidak terjadwal.', en: 'Reloaded by hand, not on a schedule.' },
    what: { id: 'Arsip deteksi VIIRS (S-NPP dan NOAA-20) untuk 5 tahun kalender terakhir.', en: 'The VIIRS detection archive (S-NPP and NOAA-20) for the last 5 calendar years.' },
    ours: {
      id: 'Dikelompokkan ke petak sekitar 2 km. Petak ditampilkan bila ada deteksi pada sedikitnya 2 dari 5 tahun. Tempat yang oleh NASA diberi label bukan kebakaran lahan (gunung api, industri) tidak ditampilkan.',
      en: 'Grouped into cells of about 2 km. A cell is shown when it had detections in at least 2 of the 5 years. Places NASA labels as not a vegetation fire (volcanoes, industry) are left out.',
    },
    limits: { id: 'Menunjukkan di mana satelit berulang kali melihat panas. Tidak menunjukkan penyebab atau siapa yang bertanggung jawab.', en: 'It shows where satellites saw heat again and again. It does not show the cause or who is responsible.' },
  },
  {
    key: 'forest', kind: 'satellite',
    title: { id: 'Hutan hilang', en: 'Forest loss' },
    from: [{ name: 'Global Forest Watch', url: 'https://www.globalforestwatch.org' }],
    updates: { id: 'Diperiksa sekali sehari.', en: 'Checked once a day.' },
    what: { id: 'Peringatan deforestasi terpadu (integrated alerts) dari Global Forest Watch.', en: 'Integrated deforestation alerts from Global Forest Watch.' },
    ours: {
      id: 'Hanya peringatan dengan tingkat keyakinan tertinggi, 30 hari terakhir, dikelompokkan ke petak sekitar 1 km. Ringkasan singkat pada kartu ditulis otomatis oleh AI (Claude) dari angka peringatan itu.',
      en: 'Only alerts at the highest confidence level, last 30 days, grouped into cells of about 1 km. The short summary on the card is written automatically by AI (Claude) from those alert numbers.',
    },
    limits: { id: 'Peringatan satelit belum diperiksa di lapangan, dan tidak menyatakan apakah suatu pembukaan lahan sah atau tidak.', en: 'Satellite alerts are not checked on the ground, and they do not say whether a clearing is legal or not.' },
  },
  {
    key: 'emit', kind: 'model',
    title: { id: 'Sumber emisi besar', en: 'Big emission sources' },
    from: [{ name: 'Climate TRACE (CC BY 4.0)', url: 'https://climatetrace.org' }],
    updates: { id: 'Diperiksa sekali sebulan. Angka adalah total per tahun, untuk tahun penuh terbaru yang tersedia.', en: 'Checked once a month. Figures are yearly totals for the latest full year available.' },
    what: {
      id: 'Perkiraan emisi tiap fasilitas (pembangkit listrik, pabrik, operasi bahan bakar fosil, tambang, sampah) beserta nama dan pemilik sebagaimana dicantumkan Climate TRACE.',
      en: 'Estimated emissions for each facility (power, manufacturing, fossil-fuel operations, mining, waste), with the name and owners as listed by Climate TRACE.',
    },
    ours: {
      id: 'Fasilitas ditampilkan bila perkiraannya melewati salah satu batas per tahun: 100.000 t CO2e, 50 t PM2.5, 500 t SO2, atau 500 t NOx.',
      en: 'A facility is shown when its estimate passes any of these yearly thresholds: 100,000 t CO2e, 50 t PM2.5, 500 t SO2, or 500 t NOx.',
    },
    limits: {
      id: 'Ini perkiraan model Climate TRACE, bukan pengukuran di cerobong dan bukan laporan resmi perusahaan. Tercantum di sini tidak berarti suatu fasilitas melanggar aturan.',
      en: 'These are Climate TRACE model estimates, not stack measurements and not official company reports. Being listed here does not mean a facility broke any rule.',
    },
  },
  {
    key: 'wind', kind: 'model',
    title: { id: 'Angin dan hujan', en: 'Wind and rain' },
    from: [{ name: 'Open-Meteo (CC BY 4.0)', url: 'https://open-meteo.com' }],
    updates: { id: 'Diperiksa sekitar tiap 15 menit.', en: 'Checked about every 15 minutes.' },
    what: { id: 'Prakiraan angin dan hujan per jam untuk 72 jam ke depan.', en: 'Hourly wind and rain forecast for the next 72 hours.' },
    ours: { id: 'Dipakai untuk panah angin dan keterangan arah asap.', en: 'Used for the wind arrows and the smoke-direction note.' },
    limits: { id: 'Ini prakiraan model, bukan pengukuran.', en: 'This is a model forecast, not a measurement.' },
  },
  {
    key: 'bmkg', kind: 'official',
    title: { id: 'Peringatan cuaca dan gempa', en: 'Weather warnings and earthquakes' },
    from: [{ name: 'BMKG', url: 'https://www.bmkg.go.id' }],
    updates: { id: 'Diperiksa sekitar tiap 15 menit.', en: 'Checked about every 15 minutes.' },
    what: { id: 'Peringatan dini cuaca BMKG, serta daftar gempa BMKG (magnitudo 5 ke atas dan gempa dirasakan terbaru).', en: 'BMKG early weather warnings, and BMKG’s earthquake lists (magnitude 5 and above, and the latest felt quake).' },
    ours: { id: 'Ditampilkan apa adanya untuk provinsi yang disebut dalam peringatan.', en: 'Shown as issued, for the provinces named in the warning.' },
    limits: { id: 'Bisa terlambat beberapa menit. Untuk keadaan darurat, ikuti kanal resmi BMKG dan BPBD setempat.', en: 'It can be a few minutes behind. In an emergency, follow BMKG and your local disaster agency directly.' },
  },
  {
    key: 'reports', kind: 'community',
    title: { id: 'Laporan warga', en: 'Community reports' },
    from: [{ name: 'Pengguna EcoPulse', url: '/app' }],
    updates: { id: 'Laporan baru diperiksa tiap beberapa menit.', en: 'New reports are screened every few minutes.' },
    what: { id: 'Foto dan keterangan singkat yang dikirim pengguna.', en: 'Photos and short notes sent by users.' },
    ours: {
      id: 'Sebelum tampil, teks dan foto diperiksa otomatis oleh AI (Claude) untuk spam, data pribadi, dan konten tidak aman. Laporan tampil dengan tanda “belum dikonfirmasi” sampai dikonfirmasi warga di sekitar, dan dibandingkan dengan titik api serta peringatan hutan dari satelit. Lokasi publik dibulatkan sekitar 1 km.',
      en: 'Before it appears, the text and photo are checked automatically by AI (Claude) for spam, personal information and unsafe content. A report is marked “not confirmed yet” until people nearby confirm it, and it is compared with satellite hotspots and forest alerts. The public location is rounded to about 1 km.',
    },
    limits: { id: 'Laporan adalah pengamatan warga, bukan temuan resmi. Laporan hilang dari peta setelah waktu tertentu bila tidak dikonfirmasi.', en: 'A report is a resident’s observation, not an official finding. Reports leave the map after a set time unless confirmed.' },
  },
  {
    key: 'news', kind: 'news',
    title: { id: 'Berita lingkungan', en: 'Environmental news' },
    from: [{ name: 'Umpan RSS penerbit berita', url: '/news' }],
    updates: { id: 'Diperiksa tiap jam.', en: 'Checked every hour.' },
    what: { id: 'Judul dan tautan dari umpan RSS penerbit. Nama penerbit tertulis di tiap berita.', en: 'Headlines and links from publishers’ RSS feeds. Each story names its publisher.' },
    ours: { id: 'AI (Claude) memilih berita lingkungan Indonesia dan menulis ringkasan dua kalimat. Isi artikel tidak disalin.', en: 'AI (Claude) picks Indonesian environmental stories and writes a two-sentence summary. Article text is not copied.' },
    limits: { id: 'Ringkasan bisa keliru. Baca artikel aslinya lewat tautan.', en: 'A summary can be wrong. Read the original through the link.' },
  },
  {
    key: 'rank', kind: 'measured',
    title: { id: 'Peringkat provinsi', en: 'Province rankings' },
    from: [{ name: 'OpenAQ', url: 'https://openaq.org' }, { name: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov' }, { name: 'Global Forest Watch', url: 'https://www.globalforestwatch.org' }],
    updates: { id: 'Dihitung ulang dari data 7 hari terakhir.', en: 'Recalculated from the last 7 days of data.' },
    what: { id: 'Udara, titik api, dan hutan hilang per provinsi.', en: 'Air, hotspots and forest loss per province.' },
    ours: {
      id: 'Udara: median PM2.5 antarstasiun OpenAQ di provinsi itu. Bila hanya ada 1 atau 2 stasiun, ditandai “data terbatas”. Tiap peringkat menulis sejak kapan datanya tersedia.',
      en: 'Air: the median PM2.5 across OpenAQ stations in the province. With only 1 or 2 stations it is marked “limited data”. Each ranking says when its data starts.',
    },
    limits: { id: 'Provinsi tanpa stasiun tidak punya peringkat udara. Peringkat membandingkan data yang tersedia, bukan penilaian resmi.', en: 'A province with no station has no air ranking. Rankings compare the data available; they are not an official assessment.' },
  },
];
