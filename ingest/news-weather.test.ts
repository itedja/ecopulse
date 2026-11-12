import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseVerdicts, buildPrompt, cleanUrl } from './news.ts';
import { parseCapFeed, parseCap, alertKind, provincesMentioned, capCode } from './lib/bmkg-cap.ts';

const PROVS = [
  { id: 11, slug: 'jakarta', name_en: 'Jakarta', name_id: 'Daerah Khusus Jakarta' },
  { id: 21, slug: 'central-kalimantan', name_en: 'Central Kalimantan', name_id: 'Kalimantan Tengah' },
  { id: 33, slug: 'papua', name_en: 'Papua', name_id: 'Papua' },
  { id: 34, slug: 'west-papua', name_en: 'West Papua', name_id: 'Papua Barat' },
  { id: 38, slug: 'southwest-papua', name_en: 'Southwest Papua', name_id: 'Papua Barat Daya' },
];

test('RSS: parses WordPress feed, strips HTML and tracking params', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>Kabut asap &amp; karhutla di Kalimantan Tengah</title>
      <link>https://www.mongabay.co.id/2026/11/10/kabut-asap/?utm_source=rss#more</link>
      <pubDate>Tue, 10 Nov 2026 08:00:00 +0000</pubDate>
      <description><![CDATA[<p>Titik panas meningkat&#8230;</p>]]></description>
      <media:content url="https://img.example/a.jpg" /></item>
    <item><title></title><link>https://x</link></item>
  </channel></rss>`;
  const s = parseFeed(xml);
  assert.equal(s.length, 1);
  assert.equal(s[0].title, 'Kabut asap & karhutla di Kalimantan Tengah');
  assert.equal(s[0].url, 'https://www.mongabay.co.id/2026/11/10/kabut-asap/');
  assert.equal(s[0].published_at, '2026-11-10T08:00:00.000Z');
  assert.equal(s[0].image_url, 'https://img.example/a.jpg');
  assert.ok(!s[0].excerpt.includes('<p>'));
});

test('Atom feeds work too', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Peat fires</title>
    <link href="https://news.example/peat"/><updated>2026-11-09T01:00:00Z</updated><summary>Smoke.</summary></entry></feed>`;
  const s = parseFeed(xml);
  assert.equal(s[0].url, 'https://news.example/peat');
});

test('Model reply: tolerates prose around JSON, drops unknown topics/provinces, blanks irrelevant', () => {
  const raw = 'Here you go:\n```json\n[{"i":0,"relevant":true,"topics":["wildfires","aliens"],"provinces":["central-kalimantan","atlantis"],"summary_en":"A.","summary_id":"B."},' +
    '{"i":1,"relevant":false,"topics":["climate"],"provinces":["jakarta"],"summary_en":"x","summary_id":"y"},{"i":9,"relevant":true}]\n```';
  const v = parseVerdicts(raw, 2, PROVS);
  assert.equal(v.size, 2);
  assert.deepEqual(v.get(0)!.topics, ['wildfires']);
  assert.deepEqual(v.get(0)!.provinces, ['central-kalimantan']);
  assert.equal(v.get(1)!.summary_en, '');
  assert.deepEqual(v.get(1)!.provinces, []);
});

test('Prompt lists province slugs and numbers stories', () => {
  const p = buildPrompt([{ title: 'T', url: 'u', published_at: '', excerpt: 'E', image_url: null }], PROVS);
  assert.ok(p.includes('central-kalimantan') && p.includes('[0] T'));
});

test('cleanUrl leaves normal URLs alone', () => {
  assert.equal(cleanUrl('https://a.id/x?id=5'), 'https://a.id/x?id=5');
});

test('BMKG CAP: feed links, polygon lat/lon order, kind, provinces', () => {
  const feed = `<rss><channel><item><title>Peringatan Dini Cuaca Kalimantan Tengah</title>
    <link>https://cuaca.bmkg.go.id/data/public/cap/detail/en/20261111120000_BMKG021.xml</link></item></channel></rss>`;
  const items = parseCapFeed(feed);
  assert.equal(items[0].code, '20261111120000_BMKG021');
  const cap = parseCap(`<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>BMKG-021</identifier><info><event>Thunderstorm</event><severity>Moderate</severity>
    <effective>2026-11-11T12:00:00+07:00</effective><expires>2026-11-11T15:00:00+07:00</expires>
    <headline>Heavy rain with lightning in Central Kalimantan</headline><description>Expected...</description>
    <area><areaDesc>Palangka Raya, Kalimantan Tengah</areaDesc><polygon>-2.1,113.8 -2.1,114.0 -2.3,114.0 -2.3,113.8 -2.1,113.8</polygon></area>
    </info></alert>`)!;
  assert.equal(cap.effective, '2026-11-11T05:00:00.000Z');
  assert.ok(cap.wkt!.startsWith('SRID=4326;MULTIPOLYGON(((113.8 -2.1, 114 -2.1'));
  assert.equal(alertKind(cap.event, cap.headline!), 'heavy_rain');
  assert.equal(alertKind('Angin Kencang'), 'strong_wind');
  assert.deepEqual(provincesMentioned(cap.areaDesc, PROVS), [21]);
  assert.deepEqual(provincesMentioned('Papua Barat Daya dan DKI Jakarta', PROVS).sort(), [11, 38]);
  assert.equal(capCode('https://x/y/abc.xml?x=1'), 'abc');
});

import { weatherIsDue } from './weather.ts';
test('weather runs at most every ~25 minutes', () => {
  const now = Date.parse('2026-11-12T05:22:00Z');
  assert.equal(weatherIsDue(null, now), true);
  assert.equal(weatherIsDue('2026-11-12T05:07:30Z', now), false);   // 15 min ago → skip
  assert.equal(weatherIsDue('2026-11-12T04:52:00Z', now), true);    // 30 min ago → run
});
