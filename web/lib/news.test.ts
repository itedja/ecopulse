import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestStories, storiesFor, timeAgo, parseStoryId, storyHref, topicTag, summaryOf, safeUrl } from './news.ts';
import { contrast } from './contrast.ts';

const s = (id: number, at: string, title = `t${id}`, url = `https://x.test/${id}`) => ({ id, url, title, published_at: at });

test('carousel: the four newest stories, newest first', () => {
  const rows = [s(1, '2026-11-14T01:00:00Z'), s(2, '2026-11-14T05:00:00Z'), s(3, '2026-11-13T05:00:00Z'), s(4, '2026-11-14T09:00:00Z'), s(5, '2026-11-12T05:00:00Z')];
  assert.deepEqual(latestStories(rows).map((r) => r.id), [4, 2, 1, 3]);
  assert.equal(rows[0].id, 1, 'input is not reordered');
});

test('carousel: the same article never shows twice', () => {
  const rows = [s(1, '2026-11-14T09:00:00Z', 'Haze returns'), s(2, '2026-11-14T08:00:00Z', 'haze returns ', 'https://x.test/other'),
    s(3, '2026-11-14T07:00:00Z', 'Different', 'https://x.test/1'), s(4, '2026-11-14T06:00:00Z')];
  assert.deepEqual(latestStories(rows).map((r) => r.id), [1, 4]);
  assert.deepEqual(latestStories([]), []);
});

test('time ago in both languages', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(timeAgo('2026-11-14T11:59:40Z', now, 'id'), 'baru saja');
  assert.equal(timeAgo('2026-11-14T11:18:00Z', now, 'id'), '42 menit lalu');
  assert.equal(timeAgo('2026-11-14T09:00:00Z', now, 'en'), '3 h ago');
  assert.equal(timeAgo('2026-11-12T09:00:00Z', now, 'id'), '2 hari lalu');
  assert.equal(timeAgo('2026-11-14T13:00:00Z', now, 'en'), 'just now', 'a clock that is ahead never shows a negative time');
  assert.equal(timeAgo('not a date', now, 'en'), 'just now');
});

test('story links round-trip and reject anything that is not a number', () => {
  assert.equal(parseStoryId(storyHref(123).split('?')[1]), 123);
  for (const bad of ['', 'id=', 'id=abc', 'id=1;drop', 'id=-4', 'id=1.5', 'x=3']) assert.equal(parseStoryId(bad), null, bad);
});

test('topic tags: map colours, readable on white and on the cloth ground', () => {
  assert.deepEqual(topicTag(['climate', 'wildfires'], 'id'), { label: 'Api', color: '#B8400E' });
  assert.equal(topicTag([], 'en').label, 'Environment');
  for (const t of ['wildfires', 'air_pollution', 'forestry_carbon', 'floods', 'unknown']) for (const bg of ['#FFFFFF', '#F4F1EA']) {
    assert.ok(contrast(topicTag([t], 'en').color, bg) >= 4.5, `${t} on ${bg}`);
  }
});

test('summary falls back to the other language; only web links are trusted', () => {
  assert.equal(summaryOf({ summary_en: 'EN', summary_id: null }, 'id'), 'EN');
  assert.equal(summaryOf({ summary_en: null, summary_id: null }, 'en'), '');
  assert.equal(safeUrl('https://a.test/x'), 'https://a.test/x');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '', null, undefined]) assert.equal(safeUrl(bad), null);
});

test('carousel prefers the reader\'s language, fills with the other, and stays newest first', () => {
  const r = (id: number, at: string, language: string) => ({ ...s(id, at), language });
  const rows = [r(1, '2026-11-15T09:00:00Z', 'en'), r(2, '2026-11-15T08:00:00Z', 'id'), r(3, '2026-11-15T07:00:00Z', 'en'),
    r(4, '2026-11-15T06:00:00Z', 'en'), r(5, '2026-11-15T05:00:00Z', 'id'), r(6, '2026-11-15T04:00:00Z', 'en'),
    r(7, '2026-11-14T20:00:00Z', 'id'), r(8, '2026-11-14T10:00:00Z', 'id'), r(9, '2026-11-14T09:00:00Z', 'id')];
  assert.deepEqual(storiesFor(rows, 'id').map((x) => x.id), [2, 5, 7, 8], 'four Indonesian stories exist, so all four are Indonesian');
  assert.deepEqual(storiesFor(rows, 'en').map((x) => x.id), [1, 3, 4, 6]);
  // Only two Indonesian stories: the two newest English ones fill in, and the order is by time.
  assert.deepEqual(storiesFor(rows.slice(0, 6), 'id').map((x) => x.id), [1, 2, 3, 5]);
  // An Indonesian story older than 72 h before the newest story is not pulled ahead of fresh news.
  const stale = [r(1, '2026-11-15T09:00:00Z', 'en'), r(2, '2026-11-15T08:00:00Z', 'en'), r(3, '2026-11-15T07:00:00Z', 'en'),
    r(4, '2026-11-15T06:00:00Z', 'en'), r(5, '2026-11-10T05:00:00Z', 'id')];
  assert.deepEqual(storiesFor(stale, 'id').map((x) => x.id), [1, 2, 3, 4]);
  assert.deepEqual(storiesFor([], 'id'), []);
  // Rows without a language (older data) still show.
  assert.deepEqual(storiesFor([s(1, '2026-11-15T09:00:00Z')], 'id').map((x) => x.id), [1]);
});
